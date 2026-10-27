"""气泡皮肤的**唯一形状定义** ✓（2026-10-27）。

四个 id 是前后端共用的契约 ✓：`plain`（默认）/ `duck` / `pig` / `cat`。
前端那一份在 `static/js/01-core.js` 的 `BUBBLES` ✓（名字和说明在那儿 ✓），
这里只管**合法性** ✓。

## 为什么单独一个模块

和 `core/agent_status.py` 的 `normalize` 同一个理由 ✓：
**形状只定义一次** ✗→✓ —— 写接口（`POST /api/me/bubble`、
`PATCH /api/groups/{id}` 的 `agent_bubble`）要校验 ✓，
读接口（`members` / `bootstrap` / 消息序列化）要归一 ✓。
两处各写一串白名单，迟早有一天只改了一边 ✓
（这个项目在群名、邀请码、屏名上都栽过同样的跟头 ✓）。

## 为什么库里存 NULL 而不是 'plain'

和 `agent_name` / `agent_user_prompt` 同一套 ✓：「没选过」和「明确选了默认」
在**行为上**没区别 ✓，但 NULL 让"老行 / 没设过"一眼看得见 ✓，
而且默认值将来要换的时候只需要改这一个文件 ✓。
"""

from __future__ import annotations

from typing import Any

BUBBLES = ("plain", "duck", "pig", "cat")
BUBBLE_DEFAULT = "plain"


def normalize_bubble(value: Any) -> str:
    """任何来路的值 → 合法 id ✓（不认识的一律回默认 ✓，不抛错 ✓）。

    读接口用它 ✓：老行是 NULL ✓、手改库写了个不存在的 id ✓ ——
    这些都不该让某一屏白掉 ✓，按默认画就好 ✓。
    """
    v = str(value or "").strip()
    return v if v in BUBBLES else BUBBLE_DEFAULT


def store_bubble(value: Any) -> str | None:
    """要落库的值：默认存 NULL ✓，其余原样 ✓。

    ⚠️ **不合法的一律回默认 → NULL** ✓（不在这一层抛 422 ✓ ——
    想报错的是接口层 ✓，这里只负责"存成什么" ✓）。
    """
    v = normalize_bubble(value)
    return None if v == BUBBLE_DEFAULT else v
