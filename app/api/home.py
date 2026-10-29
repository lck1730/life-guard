"""「纸上小屋」用的公开接口：账本 / 提醒 / 回忆墙。

## 为什么单独一个文件

这三样以前只有 agent 那条内部通道（`/api/internal/tools/*` ✓，要内部票 ✓）。
界面上要用它们，就必须有一条**走用户会话**的路 ✓（cookie 鉴权 ✓）。
⚠️ 不复用内部通道 ✗ —— 那条是以 agent 身份写库的 ✓，给它开个浏览器口子
等于把"以 agent 身份做事"的权限发给网页 ✓。

定下的规矩和别处一样：**每个口子第一件事都是 `require_member`** ✓
（它同时拦住"正在退出"的空间 ✓，见 auth.py 那段 ✓）。
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..auth import current_user, require_member
from ..core import records as rec
from ..core import reminders as rem
from ..db import execute, fetch_all, fetch_one, now

log = logging.getLogger("lifeguard.home")

router = APIRouter(prefix="/api/groups", tags=["home"])


def _when(ts: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ts)))


# ── 账本 ──────────────────────────────────────────────────────────────


class RecordIn(BaseModel):
    amount: float = Field(description="正数=支出，负数=收入")
    category: str = ""
    note: str = ""
    spent_at: int | None = None


@router.get("/{group_id}/records")
async def list_records(
    group_id: int,
    kind: str = "bookkeeping",
    limit: int = Query(300, ge=1, le=1000),
    user: dict = Depends(current_user),
) -> dict:
    await require_member(group_id, user["id"])
    out = await rec.query(group_id, kind, limit=limit)
    # ★ 2026-10-28（纸上小屋 P2）：**补上 `created_at`** ✓ —— 界面要按天分堆 ✓，
    #   而 `core.records.query()` 只把 `fields`（JSON blob）摊平吐出来 ✓，
    #   **行上的 `created_at` 不在里面** ✗（它属于表、不属于 blob ✓）。
    #   ⚠️ 在这里补、**不去动 `core/records.py`** ✓ —— 那是 agent 也在用的口径 ✓，
    #     给它加字段会顺带改变管家看到的东西 ✓（这个口子只服务网页 ✓）。
    #   ⚠️ 分批查 ✓ —— SQLite 的变量数有上限 ✓（1000 条一下子用完会报错 ✓）。
    items = out.get("items") or []
    ids = [int(it["id"]) for it in items if it.get("id") is not None]
    born: dict[int, int] = {}
    for i in range(0, len(ids), 400):
        chunk = ids[i:i + 400]
        rows = await fetch_all(
            "SELECT id, created_at FROM records WHERE id IN ("
            + ",".join("?" * len(chunk)) + ")",
            tuple(chunk),
        )
        for r in rows:
            born[int(r["id"])] = r["created_at"]
    for it in items:
        if it.get("id") is not None:
            it["created_at"] = born.get(int(it["id"]))
    return out


@router.post("/{group_id}/records")
async def add_record(
    group_id: int, body: RecordIn, user: dict = Depends(current_user),
) -> dict:
    """手动记一笔。**走 `core.records.add`** ✓ —— 校验和去重都在那儿 ✓，
    这里不另写一遍（两处各判一次迟早走岔 ✓）。"""
    await require_member(group_id, user["id"])
    if not body.note.strip() and not body.category.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "写一句备注吧")
    if abs(body.amount) > 10_000_000:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "这个数目太大了")
    fields = {
        "amount": round(body.amount, 2),
        "category": body.category.strip() or "其他",
        "note": body.note.strip(),
    }
    if body.spent_at:
        fields["spent_at"] = int(body.spent_at)
    item, err = await rec.add(group_id, "bookkeeping", fields, created_by=user["id"])
    if err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, err)
    return item or {}


# ── 提醒 ──────────────────────────────────────────────────────────────


class ReminderIn(BaseModel):
    text: str
    fire_at: int | None = None
    in_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 365)
    hour: int | None = Field(default=None, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    repeat_daily: bool = False


@router.get("/{group_id}/reminders")
async def list_reminders(group_id: int, user: dict = Depends(current_user)) -> dict:
    await require_member(group_id, user["id"])
    rows = await rem.list_for(group_id)
    # ★ 2026-10-28：补上 `created_at` ✓ —— 今日卡的"今天的小事"要按**今天建的**
    #   挑出来 ✓，而 `core.reminders.list_for()` 是 agent 也在用的口径 ✓。
    #   ⚠️ 在这里补、不动那个查询 ✓（和上面 records 那段同一条理由 ✓）。
    ids = [int(r["id"]) for r in rows if r.get("id") is not None]
    if ids:
        born = {
            int(x["id"]): x["created_at"]
            for x in await fetch_all(
                "SELECT id, created_at FROM reminders WHERE id IN ("
                + ",".join("?" * len(ids)) + ")", tuple(ids))
        }
        for r in rows:
            if r.get("id") is not None:
                r["created_at"] = born.get(int(r["id"]))
    for r in rows:
        r["when"] = _when(r["fire_at"])
    return {"items": rows}


@router.post("/{group_id}/reminders")
async def add_reminder(
    group_id: int, body: ReminderIn, user: dict = Depends(current_user),
) -> dict:
    await require_member(group_id, user["id"])
    text = body.text.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "要提醒什么？")
    fire_at = body.fire_at
    if fire_at is None and body.in_minutes is not None:
        fire_at = now() + int(body.in_minutes) * 60
    if fire_at is None and body.hour is not None:
        # 服务器在北京时区，和用户一致（和 internal 那条同口径 ✓）
        lt = time.localtime()
        target = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday,
                              body.hour, body.minute, 0, 0, 0, -1))
        if target <= now():
            target += 86400
        fire_at = int(target)
    if fire_at is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "选个时间")
    rid = await rem.add(group_id, text, int(fire_at), repeat_daily=body.repeat_daily)
    row = await fetch_one(
        "SELECT id, text, fire_at, repeat_daily, enabled, last_fired_at, created_at "
        "FROM reminders WHERE id = ?", (rid,))
    if row:
        row["when"] = _when(row["fire_at"])
    return row or {}


@router.delete("/{group_id}/reminders/{reminder_id}")
async def cancel_reminder(
    group_id: int, reminder_id: int, user: dict = Depends(current_user),
) -> dict:
    await require_member(group_id, user["id"])
    ok = await rem.cancel(group_id, reminder_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这条提醒")
    return {"ok": True}


# ── 回忆墙 ────────────────────────────────────────────────────────────


class MemoryIn(BaseModel):
    message_id: int | None = None
    text: str | None = None


@router.get("/{group_id}/memories")
async def list_memories(
    group_id: int, limit: int = Query(200, ge=1, le=500),
    user: dict = Depends(current_user),
) -> dict:
    await require_member(group_id, user["id"])
    rows = await fetch_all(
        "SELECT id, message_id, msg_type, text, media_path, media_meta, "
        "sender_nick, created_at FROM memories "
        "WHERE group_id = ? ORDER BY id DESC LIMIT ?",
        (group_id, limit),
    )
    return {"items": rows}


@router.post("/{group_id}/memories")
async def add_memory(
    group_id: int, body: MemoryIn, user: dict = Depends(current_user),
) -> dict:
    """把一句话钉到墙上。

    ★ 存的是**快照** ✓ —— 原消息以后删了，墙上那张还在 ✓（见 db.py 那段 ✓）。
    """
    await require_member(group_id, user["id"])
    msg_type, text, media_path, media_meta, nick = "text", "", None, None, None
    if body.message_id:
        row = await fetch_one(
            """SELECT m.id, m.msg_type, m.content, m.media_path, m.media_meta,
                      m.sender_type, m.deleted_at, u.nickname
               FROM messages m LEFT JOIN users u ON u.id = m.sender_id
               WHERE m.id = ? AND m.group_id = ?""",
            (int(body.message_id), group_id),
        )
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这条消息")
        # ★ 2026-10-29：擦掉的那行**钉不了** ✓ —— 正文已经清空了 ✓，
        #   硬钉上来就是一张空白拍立得 ✓（看着像坏了 ✓）。
        if row["deleted_at"]:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "这行已经被擦掉了")
        dup = await fetch_one(
            "SELECT id FROM memories WHERE group_id = ? AND message_id = ?",
            (group_id, int(body.message_id)),
        )
        if dup:
            return {"id": dup["id"], "duplicated": True}
        msg_type = row["msg_type"] or "text"
        text = row["content"] or ""
        media_path = row["media_path"]
        media_meta = row["media_meta"]
        nick = row["nickname"] if row["sender_type"] == "user" else None
        if not nick:
            g = await fetch_one("SELECT agent_name FROM groups WHERE id = ?", (group_id,))
            nick = (g or {}).get("agent_name") or "管家"
    else:
        text = (body.text or "").strip()
        if not text:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "写点什么再钉")
        if len(text) > 500:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "太长了，留一句就够")
        nick = user["nickname"]

    mid = await execute(
        """INSERT INTO memories
           (group_id, message_id, msg_type, text, media_path, media_meta,
            sender_nick, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (group_id, int(body.message_id) if body.message_id else None,
         msg_type, text, media_path, media_meta,
         nick, user["id"], now()),
    )
    log.info("回忆墙 +1 group=%s memory=%s", group_id, mid)
    return await fetch_one(
        "SELECT id, message_id, msg_type, text, media_path, media_meta, "
        "sender_nick, created_at FROM memories WHERE id = ?", (mid,)) or {}


@router.delete("/{group_id}/memories/{memory_id}")
async def delete_memory(
    group_id: int, memory_id: int, user: dict = Depends(current_user),
) -> dict:
    await require_member(group_id, user["id"])
    row = await fetch_one(
        "SELECT id FROM memories WHERE id = ? AND group_id = ?", (memory_id, group_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这条回忆")
    await execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    return {"ok": True}


# ── 管家面板的「它记得」 ──────────────────────────────────────────────


@router.get("/{group_id}/digest")
async def group_digest(group_id: int, user: dict = Depends(current_user)) -> dict:
    """管家面板「它记得」用的一份摘要 ✓（2026-10-28）。

    ⚠️ **这不是第二套记忆** ✗→✓ —— 一条都不存 ✓，全是**当场数**出来的 ✓：
      哪天住进来的、收了多少张字条、最后一次记账 / 钉墙是什么 ✓。
      真正的记忆在 Hermes 的 profile 里 ✓（见 `db.py` 里 `group_memory` 那段 ✓），
      网页既看不到也不该去读 ✓。这里只把**本 App 自己的数**摆出来 ✓。

    ⚠️ 用户要的「它记得 / 它的性子 / 它的身体」= 数 / 已有的人格那段 / 配饰 ✓。
      **不另存一份人格** ✗（那是 `groups.agent_user_prompt` 的活儿 ✓）。
    """
    await require_member(group_id, user["id"])
    g = await fetch_one("SELECT id, created_at FROM groups WHERE id = ?", (group_id,))
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这个空间")

    since = int(g["created_at"] or now())
    # "一起住了几天"按**本地日期**算 ✓ —— 用 86400 整除会让 23:50 和 00:10
    # 变成"两天" ✓（人不是那么数的 ✓）。
    d0 = _dt.date.fromtimestamp(since)
    days = max(1, (_dt.date.today() - d0).days + 1)

    msg = await fetch_one(
        "SELECT COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at "
        "FROM messages WHERE group_id = ? AND sender_type <> 'system' "
        "AND deleted_at IS NULL",
        (group_id,),
    )
    people = await fetch_all(
        """SELECT u.id, u.nickname AS account_nick, gm.nickname AS group_nick,
                  gm.role, gm.joined_at
           FROM group_members gm JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ? ORDER BY gm.joined_at ASC""",
        (group_id,),
    )
    members_out = [{
        "id": p["id"],
        "nickname": p["group_nick"] or p["account_nick"] or "",
        "role": p["role"],
        "joined_at": p["joined_at"],
    } for p in people]

    rec = await fetch_one(
        "SELECT COUNT(*) AS n FROM records "
        "WHERE group_id = ? AND kind = 'bookkeeping' AND deleted_at IS NULL",
        (group_id,))
    rem = await fetch_one(
        "SELECT COUNT(*) AS n FROM reminders WHERE group_id = ? AND enabled = 1",
        (group_id,))
    mem = await fetch_one("SELECT COUNT(*) AS n FROM memories WHERE group_id = ?", (group_id,))

    last_rec = await fetch_one(
        "SELECT fields, created_at FROM records "
        "WHERE group_id = ? AND kind = 'bookkeeping' AND deleted_at IS NULL "
        "ORDER BY id DESC LIMIT 1", (group_id,))
    if last_rec:
        try:
            last_rec["fields"] = json.loads(last_rec["fields"] or "{}")
        except (ValueError, TypeError):
            last_rec["fields"] = {}
    last_mem = await fetch_one(
        "SELECT text, media_path, msg_type, created_at FROM memories "
        "WHERE group_id = ? ORDER BY id DESC LIMIT 1", (group_id,))
    last_msg = await fetch_one(
        """SELECT m.content, m.msg_type, m.sender_type, m.created_at,
                  u.nickname AS account_nick
           FROM messages m LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.group_id = ? AND m.sender_type <> 'system'
             AND m.deleted_at IS NULL
           ORDER BY m.id DESC LIMIT 1""", (group_id,))

    return {
        "since": since,
        "days": days,
        "messages": int((msg or {}).get("n") or 0),
        "first_message_at": (msg or {}).get("first_at"),
        "last_message_at": (msg or {}).get("last_at"),
        "members": members_out,
        "counts": {
            "records": int((rec or {}).get("n") or 0),
            "reminders": int((rem or {}).get("n") or 0),
            "memories": int((mem or {}).get("n") or 0),
        },
        "last_record": last_rec,
        "last_memory": last_mem,
        "last_message": last_msg,
    }
