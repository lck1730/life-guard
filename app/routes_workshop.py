"""创意工坊的「制作页」—— 工坊里的那段对话。

## 它和群聊根本上是两件事

群聊是"群里好几个人在说话、它自己决定要不要插嘴" ✓ —— 所以那边有判断闸、
缓冲合并、说话前的复审、`[SILENT]` 那些标记 ✓。
**工坊里是你一个人对着它说话** ✓ —— 那些闸一个都不需要 ✓，
留着只会带来"它怎么又不理我" ✓（App 管家那边已经踩过这个结论 ✓）。

所以这里**直接走 `_stream_completion`** ✓，不过编排层那套 ✓。

## 两条会话、一份记忆

    会话 id  lifeguard-group-<群>-diy-u<用户>   ← **每用户一条**（两个人不串话）
    会话 key lifeguard:group:<群>               ← **和主群聊共用**（记忆是同一份）

于是：它**记得群聊里说过什么** ✓（用户要的"方便询问细节"就在这儿 ✓），
但工坊里的来回**不进群聊的会话历史** ✓。

## 消息放哪

`workshop_messages` 表 ✓，**不是** `messages` ✗ —— 群聊一个字都不会多 ✓。
主群里只会多出**两条系统消息**（开工 / 做好 ✓），那是服务端在
`components/confirm` 和 `components/save` 里发的 ✓，不靠它记得 ✓。
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from .auth import current_user, require_member
from .db import execute, fetch_all, fetch_one, now
from .hub import hub
from .orchestrator.agent import (
    _group_profile,
    _stream_completion,
    diy_session_id_for,
    diy_persona,
)

log = logging.getLogger("lifeguard.workshop")
router = APIRouter(prefix="/api/workshop", tags=["workshop"])

#: 工坊的锁 —— **和群聊那把分开** ✓。
#:
#: ⚠️ 合成一把的话，做组件那几分钟**主群完全不理人** ✓ ——
#:    用户会以为坏了 ✓（那正是最不该在"做个新东西"时发生的事 ✓）。
#:    代价是同一个 profile 上可能同时跑两个 turn ✓ —— 但那本来就是 Hermes 支持的 ✓。
_diy_locks: dict[tuple[int, int], asyncio.Lock] = {}
_diy_tasks: set[asyncio.Task] = set()


def _lock_for(group_id: int, user_id: int) -> asyncio.Lock:
    key = (group_id, user_id)
    if key not in _diy_locks:
        _diy_locks[key] = asyncio.Lock()
    return _diy_locks[key]


async def _push(user_id: int, payload: dict[str, Any]) -> None:
    """定向推给**一个人** ✓ —— 不是 broadcast 给全群 ✓（工坊是你自己的事 ✓）。"""
    try:
        await hub.send_to_user(user_id, payload)
    except Exception:  # noqa: BLE001
        log.debug("工坊推送失败 user=%s", user_id, exc_info=True)


async def push_workshop_status(group_id: int, state: str) -> None:
    """给**这个群的成员**推一条工坊状态。

    ⚠️ 为什么是广播给全群而不是发给某一个 ✗→✓ ——
       "它开始做了 / 做好了"这两个时刻发生在**内部工具**里 ✓，
       那时根本不知道谁在工坊页上看着 ✓。发给全群最省事 ✓，
       而**只有工坊页会理这个类型** ✓（群聊页对未知类型是直接忽略的 ✓）。
    """
    from .messages import group_member_ids
    try:
        await hub.broadcast(await group_member_ids(group_id),
                            {"type": "ws_status", "data": {"group_id": group_id, "state": state}})
    except Exception:  # noqa: BLE001
        log.debug("工坊状态推送失败 group=%s", group_id, exc_info=True)


async def _save(group_id: int, user_id: int, slug: str, sender: str, content: str) -> dict:
    mid = await execute(
        "INSERT INTO workshop_messages(group_id, user_id, slug, sender_type, content, created_at)"
        " VALUES(?,?,?,?,?,?)",
        (group_id, user_id, slug, sender, content, now()))
    row = await fetch_one("SELECT * FROM workshop_messages WHERE id = ?", (mid,))
    return dict(row or {})


async def _run_turn(group_id: int, user_id: int, slug: str, text: str) -> None:
    """跑一轮工坊对话 —— 后台任务 ✓（POST 立刻返回，正文走 WebSocket 推 ✓）。"""
    async with _lock_for(group_id, user_id):
        key = {"group_id": group_id, "slug": slug}
        await _push(user_id, {"type": "ws_status", "data": {**key, "state": "thinking"}})
        try:
            profile = await _group_profile(group_id)
            system = await diy_persona(group_id, slug)
            parts: list[str] = []
            async for piece in _stream_completion(
                group_id, text, [], profile,
                system=system,
                session_id=diy_session_id_for(group_id, user_id),
            ):
                parts.append(piece)
                await _push(user_id, {"type": "ws_stream", "data": {**key, "delta": piece}})
            answer = "".join(parts).strip()
        except Exception:  # noqa: BLE001
            log.exception("工坊这一轮失败了 group=%s user=%s", group_id, user_id)
            answer = ""
        finally:
            await _push(user_id, {"type": "ws_status", "data": {**key, "state": "idle"}})

        if not answer:
            # ⚠️ **失败必须让人看见** ✓ —— 项目铁律（`orchestrator/__init__.py` 那句）。
            #    静默失败在这个架构里格外坏 ✓：用户不知道是"它还在想"还是"它挂了" ✓。
            answer = "（这一轮没跑通——看一眼 App 管家那边，或者再说一遍。）"
        row = await _save(group_id, user_id, slug, "agent", answer)
        await _push(user_id, {"type": "ws_message", "data": row})


class WorkshopSayIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    slug: str = Field(default="", max_length=32)


async def _assert_open(group_id: int) -> None:
    row = await fetch_one("SELECT workshop_enabled FROM groups WHERE id = ?", (group_id,))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"群 {group_id} 不存在")
    if not row.get("workshop_enabled"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "这个群的创意工坊关着")


@router.get("/{group_id}/chat")
async def workshop_history(
    group_id: int, slug: str = Query(""), user: dict = Depends(current_user),
) -> dict:
    """**你自己**在这儿的对话 ✓ —— 别人的工坊你看不到 ✓（每人一条会话 ✓）。"""
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    rows = await fetch_all(
        "SELECT id, slug, sender_type, content, created_at FROM workshop_messages"
        " WHERE group_id = ? AND user_id = ? ORDER BY id ASC LIMIT 200",
        (group_id, user["id"]))
    return {"messages": [dict(r) for r in rows]}


@router.post("/{group_id}/chat")
async def workshop_say(
    group_id: int, body: WorkshopSayIn, user: dict = Depends(current_user),
) -> dict:
    """说一句。

    ⚠️ **立刻返回，正文走 WebSocket** ✗→✓ —— 一轮可能包含"问清细节 → 派子代理"，
       几十秒到几分钟 ✓。HTTP 里等它 = 客户端超时 ✓，而且中间看不到任何东西 ✓。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    slug = (body.slug or "").strip().lower()
    text = body.content.strip()
    msg = await _save(group_id, user["id"], slug, "user", text)
    await _push(user["id"], {"type": "ws_message", "data": msg})
    task = asyncio.create_task(_run_turn(group_id, user["id"], slug, text))
    _diy_tasks.add(task)
    task.add_done_callback(_diy_tasks.discard)
    return {"ok": True, "message": msg}
