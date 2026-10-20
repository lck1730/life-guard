"""★ 编排层 —— 本项目的核心。

Hermes 的 API Server 是纯"喂一句回一句"，没有任何消息监听或回复决策能力
（见计划文件的调研结论）。"听全量消息、自主判断何时接话"这件事完全由这里实现。

流程：
    用户消息 → 落库广播（在路由层已完成）
             → 追加进该群上下文缓冲
             → 过闸判断该不该接话
             → 命中则把缓冲的上下文打包喂给 Hermes
             → 流式回复广播回群
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from ..config import settings
from ..core.messages import (
    AGENT_STATUS_LURKING,
    AGENT_STATUS_THINKING,
    agent_name_for,
    create_message,
)
from . import agent as agent_client
from . import buffer as ctx_buffer
from . import gate

log = logging.getLogger("lifeguard.agent")

# 每个群同时只允许一个 agent turn 在跑。并发触发会让 agent 对着自己
# 刚说的话再回一遍（自问自答）。
_locks: dict[int, asyncio.Lock] = {}


def _lock_for(group_id: int) -> asyncio.Lock:
    if group_id not in _locks:
        _locks[group_id] = asyncio.Lock()
    return _locks[group_id]


async def run_idle_turn(group_id: int, pending: list[dict[str, Any]]) -> None:
    """跑一次空闲闲聊轮。

    ★ **必须和用户触发的轮次共用同一把群锁** —— 否则空闲轮会和用户轮叠在一起：
      空闲轮的"禁止写"标记会误伤用户轮，用户轮的新消息也会被空闲轮当成旧消息。
      标记只在锁内、本轮期间有效（见 core/idle.py 的 is_idle_turn）。
    """
    from ..core.idle import set_idle_turn

    async with _lock_for(group_id):
        set_idle_turn(group_id, True)
        try:
            await agent_client.run_turn(group_id, pending, must_speak=False)
        finally:
            set_idle_turn(group_id, False)


# 持有进行中的任务引用，防止被 GC 提前回收。
_background: set[asyncio.Task] = set()


# ── 正在跑的轮次计数 ──────────────────────────────────────────────────
#
# **为什么需要它**：agent 现在有个工具能重启后端（`restart_backend`）。
# 而它调那个工具的时候，**正在跑的这一轮就是被重启掐死的那一轮**——
# 2026-10-04 实测：它调完 restart_backend，后端重启、它自己那条 SSE 断掉、
# 整轮被判定为 interrupted，用户 @ 它的话**一个字都没回**。
#
# 所以重启改成"排队"：等没有轮次在跑的时候才真重启。
# 这个计数就是那个"有没有人在跑"的依据。
_turns_in_flight = 0


def _enter_turn() -> None:
    global _turns_in_flight
    _turns_in_flight += 1


def _exit_turn() -> None:
    global _turns_in_flight
    _turns_in_flight = max(0, _turns_in_flight - 1)


def turns_in_flight() -> int:
    return _turns_in_flight


def schedule(msg: dict[str, Any]) -> None:
    """把消息交给编排层，**立即返回**。

    必须异步化：`on_user_message` 里可能跑一整轮 agent（几十秒）。
    如果它在 HTTP 请求链路里被 await，发消息的人会一直卡着等 agent 说完话，
    体验上就是"发出去的瞬间 App 卡死"。

    顺序性由 `_lock_for(group_id)` 保证——同一群的任务仍串行执行。
    """
    task = asyncio.create_task(on_user_message(msg))
    _background.add(task)
    task.add_done_callback(_background.discard)


async def on_user_message(msg: dict[str, Any]) -> None:
    """编排入口。**绝不能抛异常**——否则任务会被静默吞掉，群会莫名不再响应。"""
    must_speak = False
    try:
        group_id = msg["group_id"]

        # agent 自己的话不进缓冲，否则会被当成新输入再次触发。
        if msg.get("sender_type") == "agent":
            return

        await ctx_buffer.append(msg)

        async with _lock_for(group_id):
            # 缓冲里没有属于这条消息的东西，说明它已经被上一轮"复审"吃掉了——
            # 它是在管家思考期间到达的，并进了上一轮那句话（见 agent._reconsider）。
            #
            # 这里直接退出：不必再花一次模型判断，也不会让顶栏无谓地闪一下
            # "思考中"再弹回"窥屏"。**这是"只回一条"的关键收口**——
            # 少了它，消息虽然并进上一轮了，它自己的任务仍会再开一轮，
            # 于是用户又收到第二条。
            if not await ctx_buffer.peek(group_id):
                log.info("group=%s 消息已被上一轮并掉，不再单独触发", group_id)
                return

            # 让群里看见它在"想"。这一步可能要跑一次模型判断，不给反馈会显得它没反应。
            await agent_client.emit_status(group_id, AGENT_STATUS_THINKING)

            decision = await gate.should_speak(
                group_id,
                msg,
                agent_name=await agent_name_for(group_id),
                trigger_user_id=msg.get("sender_id"),
            )
            if not decision.speak:
                # 用 INFO 而不是 DEBUG：判断闸的决策必须是可观测的。
                # 早期打 DEBUG 导致排查时完全看不到它为什么不接话，
                # 只能靠猜（浪费了好几轮）。
                log.info("group=%s 不接话: %s", group_id, decision.reason)
                await agent_client.emit_status(group_id, AGENT_STATUS_LURKING)
                return

            pending = await ctx_buffer.drain(group_id)
            if not pending:
                return

            # 记一次"真的要跑一轮"——熔断靠它（见 gate.py）。
            # **放在这里而不是 should_speak 里**：要数的是一次 agent 调用，
            # 不是一次判断。判断现在几乎不花钱（没有 LLM 调用），数的应该是真开销。
            gate.note_turn(group_id)

            log.info(
                "group=%s 接话 (%s, must_speak=%s, 档位=%s)，上下文 %d 条",
                group_id,
                decision.reason,
                decision.must_speak,
                settings.agent_effort_mentioned
                if decision.deep
                else settings.agent_effort_casual,
                len(pending),
            )
            must_speak = decision.must_speak
            _enter_turn()
            try:
                await agent_client.run_turn(
                    group_id, pending, must_speak=decision.must_speak, deep=decision.deep
                )
            finally:
                _exit_turn()
    except Exception as exc:
        gid = msg.get("group_id")
        log.exception("编排层处理消息失败 group=%s", gid)

        # ★ ① **状态切回"窥屏"。这一步原来漏了。**
        #
        # 2026-10-06 实测：任何一轮失败之后，顶栏就永远停在「正在思考中」✗
        # —— 因为异常路径压根没碰过状态，而正常路径才切得回去。
        # 用户看到的就是"它一直在想，但永远不说话"。
        try:
            await agent_client.emit_status(gid, AGENT_STATUS_LURKING)
        except Exception:  # noqa: BLE001
            log.exception("连状态都没切回来 group=%s", gid)

        # ★ ② **任何**轮次失败都要出声，不只是被点名的。
        #
        # 2026-10-04 我只做了 must_speak 那一半 ✓ —— 而那只是"它被 @ 了"的少数。
        # 2026-10-06 的代价：agent.py 里两个不存在的名字（`fetch_sync`、`_idle_status`）
        # 让**每一轮**都在 1 毫秒内炸掉 ✗，群里**一点痕迹都没有** ✗，
        # 从 01:31 瘫到 10:30 —— 用户是自己发现的，不是被通知的 ✗
        #
        # SOUL.md 里那条铁律（系统答应了却没做到，还不吭声，是最坏的故障）
        # 在这里同样适用：**失败必须让用户看见**。
        try:
            await create_message(
                group_id=gid,
                sender_id=None,
                sender_type="system",
                msg_type="text",
                content="⚠️ 刚才那一轮**中途失败了**，没能回上话。再说一遍就行；"
                        "如果反复出现，去看设置里的运维提示。",
            )
        except Exception:  # noqa: BLE001
            log.exception("连兜底的系统消息都没发出去")


# （原来这里还有个 on_agent_state_reset：群被删时清内存态。它从来没有调用方——
#   建群删群都在后台 CLI 里做，没人会经过这里。已删，免得留个像是"有人会调"的假接口。）


__all__ = ["on_user_message", "schedule", "settings", "turns_in_flight"]
