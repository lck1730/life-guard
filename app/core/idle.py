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

# group_id -> 当前这一轮是不是"空闲闲聊"轮。
#
# 只靠提示词说"别补记账"是不够的：2026-10-20 实测，空闲唤醒把旧消息又处理了一遍，
# 同一个 ¥12.59 在 15:28 / 19:20 各记了一次；提示词补上了，但它仍然可能不照做。
# 所以编排层在本轮开始/结束时打标记，内部写接口看到标记就直接拒绝——
# **能改坏的写操作由代码挡，不靠模型自觉**。
_idle_turns: set[int] = set()

# group_id -> 本轮空闲唤醒里，有没有**写操作被挡过**。
#
# 2026-10-21 二狗凭空说「14.21 那笔我没记进去」：空闲轮里它先编了一条不存在的
# 用户消息，再去 record_add，被 `_idle_write_block` 挡住——**账本没脏**，
# 但它随即把"没记进去"说给了群里。闸门只挡了写库，没挡它嘴里的话。
# 所以本轮只要发生过被挡的写，整条正文都不发（判定在 agent/agent.py）。
_idle_write_blocked: set[int] = set()


def set_idle_turn(group_id: int, on: bool) -> None:
    """由编排层在空闲轮开始/结束时调用（见 app/agent/__init__.py）。"""
    if on:
        _idle_turns.add(group_id)
        _idle_write_blocked.discard(group_id)   # 新的一轮，重新计
    else:
        _idle_turns.discard(group_id)
        _idle_write_blocked.discard(group_id)


def is_idle_turn(group_id: int) -> bool:
    return group_id in _idle_turns


def note_idle_write_blocked(group_id: int) -> None:
    """空闲轮里挡下一次写操作时调用（见 api/internal.py）。"""
    if group_id in _idle_turns:
        _idle_write_blocked.add(group_id)


def idle_write_blocked(group_id: int) -> bool:
    """这一轮空闲唤醒里，有没有写操作被挡过。"""
    return group_id in _idle_write_blocked

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
    from ..agent import run_idle_turn

    pending = [{
        "group_id": group_id,
        "sender_id": None,
        "sender_type": "system",
        "sender_nickname": None,
        "msg_type": "text",
        "content": (
            "（群里安静了一阵子。没人叫你，也没人在等你说什么。）\n"
            "想说就说，不想说就回 [SILENT]。\n"
            "⚠️ 别把没发生过的事说成发生过 —— 别说「你刚才说…」「你问的那个…」，"
            "也别凭空提某笔账、某个数字、某件谁做过的事。"
        ),
        "mentions": [],
        "media_path": None,
        "media_meta": None,
        "created_at": int(time.time()),
    }]
    log.info("空闲唤醒了 group=%s", group_id)
    await run_idle_turn(group_id, pending)


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
