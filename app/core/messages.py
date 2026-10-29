"""消息的创建、序列化与广播。

抽成独立模块是因为**编排层和 HTTP 路由都要用**：
- 路由：用户发消息
- 编排层：agent 发言、系统提示

两者必须走同一条落库+广播路径，否则消息顺序和一致性会出问题。
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..db import execute, fetch_all, fetch_one, now
from .bubbles import normalize_bubble
from .hub import hub

# 管家在 App 里的默认显示名（没配群级昵称时用它）
DEFAULT_AGENT_NAME = "管家"

_SELECT = """
SELECT m.id, m.group_id, m.sender_id, m.sender_type, m.msg_type,
       m.content, m.media_path, m.media_meta, m.reply_to, m.mentions, m.created_at,
       -- ★ 2026-10-29：被擦掉的那一行（软删除 ✓，见 db.py 那段）
       m.deleted_at, m.deleted_by,
       -- 群内昵称优先于账号昵称：群昵称可改，账号名是登录凭证，两者互不影响
       COALESCE(gm.nickname, u.nickname) AS sender_nickname,
       u.avatar AS sender_avatar,
       -- ★ 气泡（2026-10-27）：发送者自己选的那一款 ✓。
       --   ⚠️ 人挂在 `group_members` ✓、管家挂在群上 ✓（它没有账号 ✓）——
       --   两个来源都在这一趟里带出来 ✓，前端开页第一帧就能画对 ✓。
       gm.bubble AS sender_bubble,
       g.agent_bubble AS group_agent_bubble,
       -- 被引用的那条（如果有）。**必须在这里 JOIN 出来**：
       -- 客户端要在气泡上方画一小块引用条，光有 reply_to 这个 id 没东西可画，
       -- 让前端再发一次请求去取太重了。
       q.id         AS quote_id,
       q.sender_type AS quote_sender_type,
       q.msg_type   AS quote_msg_type,
       q.content    AS quote_content,
       q.media_meta AS quote_media_meta,
       q.deleted_at AS quote_deleted_at,
       COALESCE(qgm.nickname, qu.nickname) AS quote_sender_nickname
FROM messages m
LEFT JOIN users u ON u.id = m.sender_id
LEFT JOIN group_members gm ON gm.group_id = m.group_id AND gm.user_id = m.sender_id
-- 管家的气泡挂群上 ✓（`sender_id` 是 NULL ✓，`gm` 那一支永远空 ✓）
LEFT JOIN groups g ON g.id = m.group_id
LEFT JOIN messages q ON q.id = m.reply_to
LEFT JOIN users qu ON qu.id = q.sender_id
LEFT JOIN group_members qgm ON qgm.group_id = q.group_id AND qgm.user_id = q.sender_id
"""


def _load_json(raw: Any) -> Any:
    if isinstance(raw, str) and raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return raw


def _quote(row: dict[str, Any]) -> dict[str, Any] | None:
    """被引用那条的摘要，给客户端画引用条用。没有引用就返回 None。

    刻意只给**摘要**（昵称 + 一句话 + 类型），不给整条消息：引用条只占一行，
    而且被引用消息的图片不该在这儿再下一遍。
    """
    qid = row.get("quote_id")
    if not qid:
        return None
    # ★ 2026-10-29：引用条指向的那行**已经被擦掉** ✓ —— 只写一道擦痕 ✓，
    #   别再露原来的内容 ✗（正文在库里已经清空 ✓，但类型 / 表情名这些
    #   还留着，不拦一下就会画出"[表情] 猫猫"这种没头没尾的东西 ✓）。
    if row.get("quote_deleted_at"):
        return {
            "id": qid,
            "sender_type": row.get("quote_sender_type"),
            "sender_nickname": row.get("quote_sender_nickname")
            or (DEFAULT_AGENT_NAME if row.get("quote_sender_type") == "agent" else "某人"),
            "msg_type": "text",
            "content": "（这行被擦掉了）",
            "deleted": True,
        }
    kind = row.get("quote_msg_type")
    body = (row.get("quote_content") or "").strip()
    if kind == "image":
        body = "[图片]"
    elif kind == "voice":
        body = f"[语音] {body}" if body else "[语音]"
    elif kind == "sticker":
        # ★ 2026-10-27：`content` 是编号 ✓，引用条上要写名字而不是 "301" ✓
        #   （名字在发送那一刻的快照里 ✓，见 `core/stickers.py`）。
        meta = _load_json(row.get("quote_media_meta")) or {}
        nm = meta.get("name") if isinstance(meta, dict) else None
        body = f"[表情] {nm}" if nm else "[表情]"
    elif not body:
        body = f"[{kind}]"
    return {
        "id": qid,
        "sender_type": row.get("quote_sender_type"),
        "sender_nickname": row.get("quote_sender_nickname")
        or (DEFAULT_AGENT_NAME if row.get("quote_sender_type") == "agent" else "某人"),
        "msg_type": kind,
        # 引用条只占一行，长了就截断——完整内容点进去看
        "content": body[:80],
    }


def serialize(row: dict[str, Any]) -> dict[str, Any]:
    # ★ 2026-10-29：擦掉的那一行 ✓ —— 只剩身份和位置 ✓，
    #   正文 / 附件 / @ 一律不往外吐 ✓（库里也已经清空了 ✓）。
    #   ⚠️ 行**照样返回** ✓ —— 前端要拿它占位、画那道擦痕 ✓。
    deleted = bool(row.get("deleted_at"))
    return {
        "id": row["id"],
        "group_id": row["group_id"],
        "sender_id": row["sender_id"],
        "sender_type": row["sender_type"],
        "sender_nickname": row.get("sender_nickname")
        or (DEFAULT_AGENT_NAME if row["sender_type"] == "agent" else None),
        "sender_avatar": row.get("sender_avatar"),
        # ★ 气泡（2026-10-27）：管家取群上那份 ✓、人取自己那一格 ✓。
        #   ⚠️ 它只是**开页/广播那一下的快照** ✓ —— 前端重画时以**现在的**成员表为准 ✓
        #   （换气泡不重发历史消息 ✓，见 `bubbleForMsg` 那段注释 ✓）。
        "sender_bubble": normalize_bubble(
            row.get("group_agent_bubble") if row["sender_type"] == "agent"
            else row.get("sender_bubble")),
        "msg_type": row["msg_type"],
        "content": None if deleted else row["content"],
        "media_path": None if deleted else row["media_path"],
        "media_meta": None if deleted else _load_json(row.get("media_meta")),
        "mentions": [] if deleted else (_load_json(row.get("mentions")) or []),
        "reply_to": row["reply_to"],
        "quote": _quote(row),
        "created_at": row["created_at"],
        "deleted": deleted,
    }


async def agent_name_for(group_id: int) -> str:
    """这个群里管家的显示名：群级设置优先，否则用全局默认。

    放在这里是为了让路由层和编排层共用同一份逻辑——两边分别实现过一次
    群昵称读取，结果行为不一致过。
    """
    row = await fetch_one("SELECT agent_name FROM groups WHERE id = ?", (group_id,))
    return ((row or {}).get("agent_name") or "").strip() or DEFAULT_AGENT_NAME


async def group_member_ids(group_id: int) -> set[int]:
    rows = await fetch_all("SELECT user_id FROM group_members WHERE group_id = ?", (group_id,))
    return {r["user_id"] for r in rows}


async def get_message(message_id: int) -> dict[str, Any] | None:
    row = await fetch_one(_SELECT + " WHERE m.id = ?", (message_id,))
    return serialize(row) if row else None


async def list_messages(group_id: int, after: int = 0, limit: int = 50,
                        before: int | None = None) -> list[dict[str, Any]]:
    """按 id 升序返回。

    三个方向，各管一件事：

    | 参数 | 场景 |
    |---|---|
    | 都不给 | 首屏：**最新的一批**（取倒序再翻回来，见下） |
    | `after`  | 断线重连后的**增量补拉**（只取比它新的） |
    | `before` | **往回翻历史**（只取比它旧的） |

    ## 为什么"首屏"要单独一条路

    原来首屏是 `after=0 LIMIT 50` —— 那拿的是**最旧的 50 条** ✗ 群里消息一多，
    开 App 看到的就是几天前的对话，得一直往下滚才到今天 ✗
    （以前没露出来，是因为客户端直接要了 200 条、够铺满 ✓）

    现在首屏走"倒序取 50 再翻回正序" ✓ —— 拿到的是**最新的 50 条** ✓
    """
    if before is not None:
        rows = await fetch_all(
            _SELECT + " WHERE m.group_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?",
            (group_id, before, limit),
        )
        return [serialize(r) for r in reversed(rows)]

    if after == 0:
        # 首屏：要**最新**的一批。SQL 里没法"从末尾取 N 条再正序"，
        # 所以倒着取、在 Python 里翻回来。
        rows = await fetch_all(
            _SELECT + " WHERE m.group_id = ? ORDER BY m.id DESC LIMIT ?",
            (group_id, limit),
        )
        return [serialize(r) for r in reversed(rows)]

    rows = await fetch_all(
        _SELECT + " WHERE m.group_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?",
        (group_id, after, limit),
    )
    return [serialize(r) for r in rows]


def _clean_agent_text(text: str) -> str:
    """Agent 消息落库前清理：去掉多余空行、首尾空白。

    模型输出常见 2~4 个连续空行，在聊天界面里显得很散。
    压成最多 1 个空行，既不丢结构也不难读。
    """
    # 折叠 3+ 连续换行 → 最多 2 个（即 1 个空行）
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 去掉首尾空白
    text = text.strip()
    return text


async def create_message(
    *,
    group_id: int,
    sender_id: int | None,
    sender_type: str,
    msg_type: str,
    content: str | None = None,
    media_path: str | None = None,
    media_meta: dict[str, Any] | None = None,
    mentions: list[str] | None = None,
    reply_to: int | None = None,
    broadcast: bool = True,
) -> dict[str, Any]:
    """落库并广播。返回序列化后的消息。"""
    if sender_type == "agent" and content:
        content = _clean_agent_text(content)
    msg_id = await execute(
        """INSERT INTO messages
           (group_id, sender_id, sender_type, msg_type, content, media_path,
            media_meta, mentions, reply_to, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            group_id,
            sender_id,
            sender_type,
            msg_type,
            content,
            media_path,
            json.dumps(media_meta, ensure_ascii=False) if media_meta else None,
            json.dumps(mentions, ensure_ascii=False) if mentions else None,
            reply_to,
            now(),
        ),
    )
    msg = await get_message(msg_id)
    assert msg is not None

    if broadcast:
        await hub.broadcast(
            await group_member_ids(group_id),
            {"type": "message", "data": msg},
        )
    return msg


async def erase_message(group_id: int, message_id: int, by_user_id: int) -> dict[str, Any]:
    """把一条消息**擦掉** ✓（2026-10-29）。

    软删除：行留着（引用条 / 日期胶带要靠它占位 ✓），
    正文、附件路径、@ 一并清空 ✓ —— 擦掉就是擦掉，库里也别留着 ✓。

    ⚠️ **谁擦的由调用方先判** ✓（路由层要回 403 给"擦别人的" ✓）——
       这里只管落库和广播，不做权限判断 ✓。
    ⚠️ 广播的是一整条**序列化后的消息**（`deleted: true` ✓）——
       客户端拿它原地换掉那一行 ✓，和 `message` 事件同一个形状 ✓。
    """
    await execute(
        """UPDATE messages
              SET deleted_at = ?, deleted_by = ?,
                  content = NULL, media_path = NULL, media_meta = NULL, mentions = NULL
            WHERE id = ? AND group_id = ?""",
        (now(), by_user_id, message_id, group_id),
    )
    msg = await get_message(message_id)
    assert msg is not None

    # ★ 它**还没来得及看**的那条，从上下文缓冲里拿掉 ✓ ——
    #   不然管家下一轮还会对着这行已经不存在的话回一句 ✓（说得还挺对 ✓，
    #   但两个人那边谁也看不到它在回应什么 ✓）。
    #   已经 drain 走的不动 ✓（那已经是它记下的事了，擦不掉 ✓）。
    from ..agent import buffer as agent_buffer

    await agent_buffer.drop(group_id, message_id)

    await hub.broadcast(
        await group_member_ids(group_id),
        {"type": "message_deleted", "data": msg},
    )
    return msg


# ── agent 的"正在输入"与流式输出 ──────────────────────────────────────

async def broadcast_group_update(group_id: int) -> None:
    """群设置变了（群名 / 成员昵称 / 管家昵称）。

    只发一个信号，具体内容让客户端自己拉——避免这里和客户端的
    数据形状耦合（之前消息序列化就吃过这个亏）。
    """
    await hub.broadcast(
        await group_member_ids(group_id),
        {"type": "group_update", "data": {"group_id": group_id}},
    )


async def agent_typing(group_id: int, state: str) -> None:
    """兼容旧事件。新客户端请用 agent_status。"""
    await hub.broadcast(
        await group_member_ids(group_id),
        {"type": "agent_typing", "data": {"group_id": group_id, "state": state}},
    )


# 管家此刻在干嘛。**故意做成独立事件而不是消息**——状态只在顶栏显示，
# 不占用消息气泡。这样"它在偷听"和"它在回你"是两件视觉上完全不同的事。
AGENT_STATUS_THINKING = "thinking"   # 判断闸在跑
AGENT_STATUS_LURKING = "lurking"     # 判断为不回复
AGENT_STATUS_SILENT = "silent"       # 不打算理你们（短暂显示后自动回到 idle）
AGENT_STATUS_IDLE = "idle"           # 平时

# 每种状态可以带自定义文案（"正在思考…"、"不打算理你们"）。
# 只存**当前**这一次的文字；客户端断线重连时从 DB 里的配置值读，不依赖这里。
_current_status_text: dict[int, str] = {}


# 每个群"此刻"的状态。存在的理由：客户端断线重连（退出重进、锁屏、网络抖动）
# 之后，光靠事件流是补不回来的——它会以为 agent 闲着，实际那边可能还在跑。
# 所以重连时要把这份快照发回去。
_current_status: dict[int, str] = {}


async def agent_status(group_id: int, state: str, text: str | None = None) -> None:
    """改管家状态。`text` 是这次状态显示的文案；不传用调用方的默认。"""
    _current_status[group_id] = state
    _current_status_text[group_id] = text or ""
    await hub.broadcast(
        await group_member_ids(group_id),
        {
            "type": "agent_status",
            "data": {"group_id": group_id, "state": state, "text": text or ""},
        },
    )


def current_status_for(group_id: int) -> str:
    return _current_status.get(group_id, AGENT_STATUS_IDLE)


def current_status_text_for(group_id: int) -> str:
    return _current_status_text.get(group_id, "")


async def agent_stream(group_id: int, *, delta: str | None, done: bool = False) -> None:
    """流式片段。仅用于即时显示，不落库——最终文本由 create_message 落库。"""
    await hub.broadcast(
        await group_member_ids(group_id),
        {
            "type": "agent_stream",
            "data": {"group_id": group_id, "delta": delta or "", "done": done},
        },
    )
