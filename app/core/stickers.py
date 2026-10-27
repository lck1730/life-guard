"""表情包清单。

**唯一的映射表**是 `app/static/stickers/stickers.json` —— 前端挑表情、
后端校验、管家工具的描述全从这一份读，别在代码里另写一份编号。

一条表情消息只存**编号**（`msg_type="sticker"`、`content="301"`），
图片路径由这里补上。这样：
  · 编号 ⇄ 图 的对应只在一处维护 ✓
  · 换了图片、改了名字，历史消息不用回填（路径在 `media_path` 里存着快照）✓
  · 「3xx 是管家的」这条所有权也写在清单里，不靠编号猜 ✓
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

STICKER_DIR = Path(__file__).resolve().parents[1] / "static" / "stickers"
MANIFEST = STICKER_DIR / "stickers.json"

_ID_RE = re.compile(r"^\d{3}$")

#: 带 mtime 的缓存：清单改了不用重启后端 ✓，改完读下一条消息就生效 ✓。
_cache: tuple[int, dict[str, Any]] | None = None


def _load() -> dict[str, Any]:
    global _cache
    try:
        mtime = MANIFEST.stat().st_mtime_ns
    except OSError:
        return {"version": 1, "stickers": [], "categories": []}
    if _cache and _cache[0] == mtime:
        return _cache[1]
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": 1, "stickers": [], "categories": []}
    if not isinstance(data, dict):
        return {"version": 1, "stickers": [], "categories": []}
    data.setdefault("version", 1)
    data.setdefault("stickers", [])
    data.setdefault("categories", [])
    _cache = (mtime, data)
    return data


def catalog() -> dict[str, Any]:
    """整份清单（前端 `/static/stickers/stickers.json` 读的也是它）。"""
    return _load()


def get(sid: str | None) -> dict[str, Any] | None:
    """按编号取一条。格式不对或不在清单里都返回 None。"""
    sid = str(sid or "").strip()
    if not _ID_RE.match(sid):
        return None
    for s in _load().get("stickers", []):
        if str(s.get("id")) == sid:
            return s
    return None


def version() -> int:
    try:
        return int(_load().get("version") or 1)
    except (TypeError, ValueError):
        return 1


def media_path(s: dict[str, Any]) -> str:
    """消息里存的图片路径（相对 `/static`）✓ —— **带版本号** ✓。

    静态层看到 `?v=` 就回 immutable 长缓存 ✓（见 `main.py` 的 `_NoStoreStatic`）✓，
    所以表情发过一次之后就是本地缓存，不占隧道 ✓。
    """
    return f"{s['file']}?v={version()}"


def sticker_meta(s: dict[str, Any]) -> dict[str, Any]:
    """消息上的快照：名字、分类、所有权跟着消息走。"""
    return {
        "sticker": str(s["id"]),
        "name": s.get("name") or "",
        "category": s.get("category") or "",
        "owner": s.get("owner") or "",
    }


def label(sid: str) -> str:
    """给人和模型看的一句话：`猫猫管家·早安`。"""
    s = get(sid)
    if not s:
        return f"未知表情 {sid}" if sid else "表情"
    cat = next((c.get("name") for c in _load().get("categories", [])
                if c.get("key") == s.get("category")), s.get("category") or "")
    name = s.get("name") or ""
    return f"{cat}·{name}" if cat and name else (name or cat or "表情")


def meaning(sid: str) -> str:
    return str((get(sid) or {}).get("meaning") or "")


def describe_for_agent(sid: str, *, sender_type: str = "user") -> str:
    """写进管家看到的记录里的那一句。

    ⚠️ **编号要给它** ✓ —— 用户定的就是这个：表情有编号，含义是初始的，
       要结合语境理解 ✓。所有权也写出来 ✓：
       群友发了管家的表情，管家才知道可以怎么接 ✓。
    """
    s = get(sid)
    if not s:
        return "[表情]（清单里没有这个编号）"
    text = f"[表情 {sid}｜{label(sid)}｜初始含义：{s.get('meaning') or '未标注'}]"
    if sender_type == "user" and s.get("owner") == "butler":
        text += "（群友发了管家的猫猫表情）"
    return text
