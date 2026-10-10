"""空闲唤醒 —— 让"它自己冒泡"真的能做到。

## 为什么需要它

`group_say` 工具给了它主动说话的能力，但**能力需要有人来唤起**：一轮只能由
"有人发消息"或"提醒到点"触发。群里半天没人吭声的时候，它根本没有开口的机会——
那样"主动冒泡"就只剩"别人说话时它多插一句"，不是真的主动。

所以这里补一个定时唤醒：隔一阵子唤起它一次，告诉它"你有阵子没说话了，想说什么
就说，不想说就不说"。

## 为什么间隔是**随机**的（1~4 小时）

固定间隔会变成"它每 2 小时准时报到"——那比不说话更像机器人。
用户在意的正是"像个群里的人"，而人的这种话头本来就是不均匀的。

随机还顺带解决了另一个问题：如果每次唤醒都精确踩点，用两天你就会开始
预期它什么时候冒泡，那点"活人感"就没了。

## 为什么只在这些小时里醒

半夜三点群里冒出一句"今天天气不错"是事故，不是惊喜。
默认 9:00–23:00，可配。

## 为什么状态放内存

`next_at` 只在进程内有意义。重启后重新摇一次骰子（1~4 小时后才会冒泡）——
这个语义是对的：**重启不该触发一次"它想你了"**。
"""

from __future__ import annotations

import asyncio
import logging
import random
import time

from ..config import settings
from ..db import fetch_all

log = logging.getLogger("lifeguard.idle")

# group_id -> 下次该醒的时刻（monotonic 不适用，用 wall clock 便于日志）
_next_at: dict[int, float] = {}

POLL_SECONDS = 120          # 每两分钟看一眼就够，这不是个精确的东西


def _roll(from_ts: float) -> float:
    lo = settings.idle_wake_min_hours * 3600
    hi = settings.idle_wake_max_hours * 3600
    return from_ts + random.uniform(lo, hi)


def _in_window(hour: int) -> bool:
    a, b = settings.idle_wake_from_hour, settings.idle_wake_to_hour
    if a == b:
        return True                     # 相等 = 全天
    if a < b:
        return a <= hour < b
    return hour >= a or hour < b        # 跨午夜，比如 22 → 6


async def _wake(group_id: int) -> None:
    """唤起它一次。**must_speak=False**——它完全可以决定不吭声，
    硬逼它说话就变成"为了冒泡而冒泡"，那正是要避免的。"""
    from ..agent import agent as agent_client

    pending = [{
        "group_id": group_id,
        "sender_id": None,
        "sender_type": "system",
        "sender_nickname": None,
        "msg_type": "text",
        "content": (
            "（没有人找你，群里安静了一阵子。）\n"
            "你可以说点什么，也可以不说。想说的话没有范围——"
            "接着最近聊过的事说、突然想到的、或者纯粹一句玩梗都行。\n"
            "凭你现在的感觉来。**没什么想说的就回 [SILENT]**，不用为了说话而说话。"
        ),
        "mentions": [],
        "media_path": None,
        "media_meta": None,
        "created_at": int(time.time()),
    }]
    log.info("空闲唤醒了 group=%s", group_id)
    await agent_client.run_turn(group_id, pending, must_speak=False)


async def tick() -> int:
    """扫一遍所有群，该醒的醒。返回唤醒了几次。测试可以直接调它。"""
    if settings.idle_wake_max_hours <= 0:
        return 0                        # 配成 0 = 关闭
    if not _in_window(time.localtime().tm_hour):
        return 0

    now = time.time()
    fired = 0
    for g in await fetch_all("SELECT id FROM groups"):
        gid = g["id"]
        nxt = _next_at.get(gid)
        if nxt is None:
            # 本进程第一次见到这个群：摇一次骰子，先等一会儿再说。
            # 不在开始时立刻冒泡——刚重启就"想你了"很怪。
            _next_at[gid] = _roll(now)
            continue
        if now < nxt:
            continue
        _next_at[gid] = _roll(now)      # 先重置再执行，避免唤醒很慢时被重复触发
        try:
            await _wake(gid)
            fired += 1
        except Exception:
            log.exception("空闲唤醒失败 group=%s", gid)
    return fired


async def loop() -> None:
    log.info("空闲唤醒已启动（每隔 %d~%d 小时，仅 %d:00–%d:00）",
             settings.idle_wake_min_hours, settings.idle_wake_max_hours,
             settings.idle_wake_from_hour, settings.idle_wake_to_hour)
    while True:
        try:
            await asyncio.sleep(POLL_SECONDS)
            await tick()
        except asyncio.CancelledError:
            log.info("空闲唤醒已停止")
            raise
        except Exception:
            # 和提醒轮询同理：**不能因为一次异常就退出循环**，
            # 那样这个功能会永久静默失效，外面还看不出来。
            log.exception("空闲唤醒出错（继续）")
