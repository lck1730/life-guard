"""每群的滚动上下文缓冲。

**为什么需要它**：Hermes 只能看到我们主动喂进去的东西。如果只把"触发它的那条"
发过去，agent 就不知道前因后果（比如群里刚讨论过"周末去哪"，然后有人说"那就定这吧"）。

策略：所有消息先进缓冲，真正要发言时才把整段缓冲打包成一次 prompt 送过去。
这样 agent 有完整上下文，而我们只在真正需要时才付一次 agent 调用的钱。
"""

from __future__ import annotations

from collections import deque
from typing import Any

from ..config import settings

# 上限留一点余量：缓冲本身可能比送给模型的多，超出部分是给"最近发生了什么"
# 的判断用的，不一定全进 prompt。
_MAX_BUFFER = 200

_buffers: dict[int, deque[dict[str, Any]]] = {}


def _deque_for(group_id: int) -> deque[dict[str, Any]]:
    if group_id not in _buffers:
        _buffers[group_id] = deque(maxlen=_MAX_BUFFER)
    return _buffers[group_id]


async def append(msg: dict[str, Any]) -> None:
    _deque_for(msg["group_id"]).append(msg)


async def peek(group_id: int, limit: int | None = None) -> list[dict[str, Any]]:
    """看但不消费——接话判断需要它。"""
    items = list(_deque_for(group_id))
    return items[-limit:] if limit else items


async def drain(group_id: int) -> list[dict[str, Any]]:
    """取出并清空。agent 发言后调用，避免同一条消息被算进下一次触发。"""
    dq = _deque_for(group_id)
    items = list(dq)
    dq.clear()
    return items[-settings.context_window_messages :]


async def consume_upto(group_id: int, max_message_id: int) -> int:
    """丢掉缓冲里 **id ≤ max_message_id** 的消息，返回丢了几条。

    用途：一轮发言**已经考虑过**某些排队消息——复审把它们并进了最终那句话。
    这些就不该再触发下一轮；但**在这之后**到达的必须留着。

    为什么按 id 而不是按条数：现在有**两层**复审（它自己的工具 + 外部兜底），
    两层覆盖的范围不一样，用"丢几条"表达不了"丢到哪一条为止"。

    也不能图省事直接 `drain`——那会把"刚好在锁释放前一瞬到达"的消息一起吞掉，
    而它有自己的任务在等锁，等到的会是空缓冲，于是永远没人回它
    （就是"它不理我了"那个老毛病）。
    """
    dq = _deque_for(group_id)
    n = 0
    while dq and int(dq[0].get("id") or 0) <= max_message_id:
        dq.popleft()
        n += 1
    return n


async def drop(group_id: int, message_id: int) -> None:
    """从缓冲里拿掉**一条**（被擦掉的那条 ✓，2026-10-29）。

    ⚠️ **只动这一条** ✓ —— 别拿 `clear` 凑 ✓：缓冲里别的消息还等着
       这一轮的上下文 ✓，清空等于把它前因后果一起吞了 ✓。
    缓冲里没有就算了 ✓（多半已经 `drain` 走 ✓ —— 那部分擦不掉，
    它已经看过了 ✓）。
    """
    dq = _buffers.get(group_id)
    if not dq:
        return
    for item in list(dq):
        if int(item.get("id") or 0) == int(message_id):
            try:
                dq.remove(item)
            except ValueError:          # 期间被别处拿走了 ✓ —— 没事 ✓
                pass


async def clear(group_id: int) -> None:
    _buffers.pop(group_id, None)
