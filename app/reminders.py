"""提醒 —— 由业务系统持有，**不用 Hermes 内部 cron**。

## 为什么不用 Hermes 的 cron

一次真实事故：agent 自己用 Hermes cron 建了个「每晚10点记账提醒」。
任务每晚真的跑、真的调了 `ledger_query`、真的生成了一段带真实账目的提醒——**

    然后输出被丢进虚空。

投递配置是 `deliver: origin` 而 `origin: null`，没有投递目标；而它
**连错都不报**（`last_status: ok`、`last_delivery_error: null`）。
agent 因为记忆里写着「已设置定时任务」，就一直以为办妥了；
用户则一直没收到，只能反过来问「你是不是忘了啥」。

教训：**提醒是业务功能，该由业务系统持有**——可查、可取消、失败会出现在
我们自己的日志里，而不是躺在一个 agent 够得着、我们又看不见的地方。

## 到点了怎么触发

不是我们拼一句话发出去，而是**唤起一次正常的 agent 发言**：
合成一条"提醒到点了"的假消息塞进 pending，然后走 `run_turn(must_speak=True)`。

这样提醒能享受到全部现有能力：查账、看记忆、按人格措辞。
代价是到点时会跑一次完整调用——但那正是"像朋友提醒而不是像闹钟"的来源。
"""

from __future__ import annotations

import asyncio
import logging

from .db import execute, fetch_all, fetch_one, now

log = logging.getLogger("lifeguard.reminders")

POLL_SECONDS = 30
# 错过的重复提醒最多补一次；超过这个宽限期就顺延到下一个周期，
# 而不是"欠了多少天就补多少天"（服务器停一天不该在群里连发 24 条）。
GRACE_SECONDS = 3600


async def add(group_id: int, text: str, fire_at: int, *, repeat_daily: bool = False) -> int:
    return await execute(
        "INSERT INTO reminders (group_id, text, fire_at, repeat_daily, enabled, created_at) "
        "VALUES (?,?,?,?,1,?)",
        (group_id, text.strip(), int(fire_at), 1 if repeat_daily else 0, now()),
    )


async def list_for(group_id: int) -> list[dict]:
    return await fetch_all(
        """SELECT id, text, fire_at, repeat_daily, enabled, last_fired_at
           FROM reminders WHERE group_id = ? ORDER BY enabled DESC, fire_at ASC""",
        (group_id,),
    )


async def cancel(group_id: int, reminder_id: int) -> bool:
    row = await fetch_one(
        "SELECT id FROM reminders WHERE id = ? AND group_id = ?", (reminder_id, group_id)
    )
    if not row:
        return False
    await execute("UPDATE reminders SET enabled = 0 WHERE id = ?", (reminder_id,))
    return True


def _next_fire(fire_at: int, repeat_daily: int, ts: int) -> int:
    """算下一次该什么时候响。重复提醒顺延到**未来**的那个点，不补历史。"""
    if not repeat_daily:
        return fire_at
    nxt = fire_at
    while nxt <= ts:
        nxt += 86400
    return nxt


async def _fire(r: dict) -> None:
    """唤起一次 agent 发言。延迟导入避免和编排层循环依赖。"""
    from .orchestrator import agent as agent_client

    pending = [{
        "group_id": r["group_id"],
        "sender_id": None,
        "sender_type": "system",
        "sender_nickname": None,
        "msg_type": "text",
        "content": f"（提醒到点了）{r['text']}",
        "mentions": [],
        "media_path": None,
        "media_meta": None,
        "created_at": now(),
    }]
    log.info("提醒触发 group=%s reminder=%s: %s", r["group_id"], r["id"], r["text"][:40])
    # must_speak：提醒是"答应过要说的"，不该被它自己判成 [SILENT] 咽回去
    await agent_client.run_turn(r["group_id"], pending, must_speak=True)


_ticking = False


async def tick() -> int:
    """扫一遍到点的提醒并触发。返回触发了几条。测试可以直接调它。"""
    global _ticking
    if _ticking:                      # 上一轮还没跑完（某条提醒的发言很慢），别叠上去
        return 0
    _ticking = True
    try:
        ts = now()
        rows = await fetch_all(
            "SELECT id, group_id, text, fire_at, repeat_daily FROM reminders "
            "WHERE enabled = 1 AND fire_at <= ? ORDER BY fire_at LIMIT 20",
            (ts,),
        )
        for r in rows:
            # **先认领再执行。** 反过来的话，`_fire` 跑得慢时下一轮 tick 会把它再捞
            # 出来触发一遍——提醒会重复发。
            next_at = _next_fire(r["fire_at"], r["repeat_daily"], ts)
            stale = ts - r["fire_at"] > GRACE_SECONDS
            await execute(
                "UPDATE reminders SET fire_at = ?, last_fired_at = ?, enabled = ? WHERE id = ?",
                (next_at if r["repeat_daily"] else r["fire_at"], ts,
                 1 if r["repeat_daily"] else 0, r["id"]),
            )
            if stale and r["repeat_daily"]:
                log.info("提醒 %s 错过了太久（%ds），顺延到 %s 不再补发",
                         r["id"], ts - r["fire_at"], next_at)
                continue
            try:
                await _fire(r)
            except Exception:
                log.exception("提醒触发失败 reminder=%s", r["id"])
        return len(rows)
    finally:
        _ticking = False


async def ticker_loop() -> None:
    """常驻后台任务。由 main.py 的 lifespan 启动、退出时取消。"""
    log.info("提醒轮询已启动（每 %ds 一次）", POLL_SECONDS)
    while True:
        try:
            await asyncio.sleep(POLL_SECONDS)
            await tick()
        except asyncio.CancelledError:
            log.info("提醒轮询已停止")
            raise
        except Exception:
            # **绝不能因为一次异常就退出循环**——那样提醒会永久静默失效，
            # 而且和那次 cron 事故一样，外面看不出来。
            log.exception("提醒轮询出错（继续）")
