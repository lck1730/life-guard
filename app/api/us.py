"""「我们」—— 两个人的日常记录。

用户 2026-11-01：「将纪念日名字改成『我们』，然后里面是情侣日常记录的功能，
顶部有个在一起时间，设置在一起日期是 2024.7.17，然后下面就是一些可以随时
记录的日常瞬间，支持图片文字（自动记录日期）……支持文字搜索匹配」。

这里只做**数据** ✓ —— 界面在 `static/js/05-us.js` ✓。
· `us_meta` 记在一起的那一天 ✓（一个群一行 ✓）
· `us_moments` 记每一件小事 ✓（文字 / 照片 / 时间 ✓）
"""

from __future__ import annotations

import logging

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ..auth import current_user, require_member
from ..config import settings
from ..db import execute, fetch_all, fetch_one, now

log = logging.getLogger("lifeguard.us")
router = APIRouter(prefix="/api/us", tags=["us"])

#: 默认的在一起日期 ✓。只有这个群（「大象的鼻子很长」）在用 ✓，
#: 但接口按 group 走 ✓ —— 以后再有空间，各自有自己的这一天 ✓。
DEFAULT_TOGETHER_AT = "2024-07-17"

#: 一次给多少条 ✓。手机上一屏放不下更多 ✓，而且时间线是从新往旧翻 ✓。
PAGE_SIZE = 30

#: 只收**图片** ✓（「支持图片文字」✓）。别的文件类型不该出现在回忆里 ✓。
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


class MomentIn(BaseModel):
    group_id: int
    text: str = ""
    media_path: str | None = None


def _safe_media_path(rel: str | None) -> str | None:
    """把客户端给的相对路径**钉死在 media 目录里** ✓。

    ⚠️ 不能只信 `media_path` ✗ —— 那是客户端传上来的 ✓。要确认：
      · 真的在 `data/media` 底下 ✓（`..` 走不出去 ✓）
      · 文件真的在 ✓
      · 确实是图片扩展名 ✓
    否则一条记录就能让 `/media` 去读任意文件 / 把非图片塞进回忆里 ✓。
    """
    raw = (rel or "").strip().lstrip("/")
    if not raw:
        return None
    base = settings.media_dir.resolve()
    p = (base / raw).resolve()
    if not p.is_relative_to(base) or not p.is_file():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这张照片找不到")
    if p.suffix.lower() not in _IMAGE_EXTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "回忆里只放图片")
    return Path(raw).as_posix()


async def _together_at(group_id: int) -> str:
    """取这个群的在一起日期；第一次进来时把默认那天落库 ✓。"""
    row = await fetch_one("SELECT together_at FROM us_meta WHERE group_id = ?", (group_id,))
    if row:
        return row["together_at"]
    await execute(
        "INSERT OR IGNORE INTO us_meta(group_id, together_at, updated_at) VALUES (?, ?, ?)",
        (group_id, DEFAULT_TOGETHER_AT, now()),
    )
    row = await fetch_one("SELECT together_at FROM us_meta WHERE group_id = ?", (group_id,))
    return row["together_at"] if row else DEFAULT_TOGETHER_AT


async def _moment(moment_id: int, group_id: int) -> dict | None:
    return await fetch_one(
        """SELECT m.id, m.text, m.media_path, m.happened_at, m.user_id,
                  u.nickname AS user_name
           FROM us_moments m
           JOIN users u ON u.id = m.user_id
           WHERE m.id = ? AND m.group_id = ? AND m.deleted_at IS NULL""",
        (moment_id, group_id),
    )


@router.get("")
async def list_moments(
    group_id: int = Query(...),
    q: str = Query("", max_length=60),
    before: int = Query(0, ge=0),
    user: dict = Depends(current_user),
) -> dict:
    """时间线，**新的在前** ✓。

    `q` 是文字搜索 ✓ —— 在服务端筛 ✓（不是只筛屏幕上看得到的那几条 ✓）：
    一起过日子会攒很多条 ✓，只筛已加载的那一页 = "明明写过却搜不到" ✗。
    `before` 是上一页最后一条的 id ✓（翻更早的日子 ✓）。
    """
    await require_member(group_id, user["id"])

    where = ["m.group_id = ?", "m.deleted_at IS NULL"]
    params: list = [group_id]
    if q.strip():
        # ⚠️ 用 `instr(lower(...))` 而不是 `LIKE` ✓ —— 后者的 `%` / `_`
        #    是通配符 ✓，用户搜「100%」会变成搜所有以 100 开头的 ✓。
        where.append("instr(lower(m.text), lower(?)) > 0")
        params.append(q.strip())
    if before:
        where.append("m.id < ?")
        params.append(before)

    rows = await fetch_all(
        f"""SELECT m.id, m.text, m.media_path, m.happened_at, m.user_id,
                   u.nickname AS user_name
            FROM us_moments m
            JOIN users u ON u.id = m.user_id
            WHERE {' AND '.join(where)}
            ORDER BY m.happened_at DESC, m.id DESC
            LIMIT ?""",
        (*params, PAGE_SIZE + 1),
    )
    has_more = len(rows) > PAGE_SIZE
    return {
        "together_at": await _together_at(group_id),
        "moments": rows[:PAGE_SIZE],
        "has_more": has_more,
    }


@router.post("/moments")
async def create_moment(
    body: MomentIn,
    user: dict = Depends(current_user),
) -> dict:
    await require_member(body.group_id, user["id"])
    text = (body.text or "").strip()
    if len(text) > 2000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这一段太长了（最多 2000 字）")
    media = _safe_media_path(body.media_path)
    if not text and not media:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "写点什么，或者放一张照片")

    ts = now()
    mid = await execute(
        """INSERT INTO us_moments(group_id, user_id, text, media_path, happened_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (body.group_id, user["id"], text, media, ts, ts),
    )
    row = await _moment(mid, body.group_id)
    if not row:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "没记上，再试一次")
    log.info("us moment #%s in group %s by %s", mid, body.group_id, user["id"])
    return row


@router.delete("/moments/{moment_id}")
async def delete_moment(
    moment_id: int,
    group_id: int = Query(...),
    user: dict = Depends(current_user),
) -> dict:
    """软删 ✓ —— 记录和照片都还在库里 ✓，只是时间线不再显示 ✓。"""
    await require_member(group_id, user["id"])
    row = await fetch_one(
        "SELECT id FROM us_moments WHERE id = ? AND group_id = ? AND deleted_at IS NULL",
        (moment_id, group_id),
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "这条回忆已经不在了")
    await execute(
        "UPDATE us_moments SET deleted_at = ? WHERE id = ?",
        (now(), moment_id),
    )
    return {"ok": True}
