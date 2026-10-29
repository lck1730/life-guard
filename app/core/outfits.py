"""管家配饰的**唯一形状定义** ✓（2026-10-28）。

四个 id 是前后端共用的契约 ✓：`bell`（默认，颈圈铃铛 ✓）/ `bow`（蝴蝶结）/
`scarf`（围巾）/ `wreath`（花环）✓。前端那份画在 `static/js/01-core.js`
的 `applyWear()` 里 ✓，这里只管**合法性** ✓（和 `core/bubbles.py` 同一套理由 ✓：
两处各写一串白名单，迟早只改了一边 ✓）。

⚠️ **它只管长相** ✗→✓ —— 不进提示词、不进记忆 ✓（见 db.py 那条注释 ✓）。
「管家怎么说话」那条路是 `groups.agent_user_prompt` ✓，只有那一条 ✓。
"""

from __future__ import annotations

from typing import Any

OUTFITS = ("bell", "bow", "scarf", "wreath")
OUTFIT_DEFAULT = "bell"


def normalize_outfit(value: Any) -> str:
    """任何来路的值 → 合法 id ✓（不认识的一律回默认 ✓，不抛错 ✓）。"""
    v = str(value or "").strip()
    return v if v in OUTFITS else OUTFIT_DEFAULT


def store_outfit(value: Any) -> str | None:
    """要落库的值：默认（铃铛）存 NULL ✓，其余原样 ✓。

    ⚠️ 不合法的一律回默认 → NULL ✓（报错是接口层的事 ✓，
    这里只负责"存成什么" ✓，和 `store_bubble` 一个分工 ✓）。
    """
    v = normalize_outfit(value)
    return None if v == OUTFIT_DEFAULT else v
