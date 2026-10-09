"""管家状态条的三档文案 —— **它的形状只在这一个文件里定义** ✓。

## 为什么单独一个文件

这份配置有**三个读者** ✗：启动时的数据迁移、`PATCH /groups/{id}` 接口、
每一轮的编排层（`orchestrator/agent.py`）。三处各写一份"默认值 / 怎么兜底"，
它们**一定会走岔** ✗ —— 2026-10-06 那天在别的地方栽过两次同一个形状：
**同一个信息两处 = 迟早走岔** ✓（群名存在两个库里、群列表两条查询口径不同 ✓）。

所以：形状 + 默认值 + 兜底规则，**全在这儿** ✓，谁要都从这儿拿 ✓。

## 形状

```json
{
  "idle":     {"on": true,  "lines": ["正在窥屏…"], "every": 600},
  "thinking": {"on": true,  "lines": ["正在思考…"]},
  "silent":   {"on": true,  "lines": ["打算继续窥屏…"]}
}
```

- `on`    —— 这一档显不显示 ✓
- `lines` —— 这一档可以显示好几句 ✓
- `every` —— **只有 idle 有** ✓：每多少秒换一句 ✓

## 三档的语义（用户 2026-10-06 定的）

| 档 | 什么时候出现 | 换法 | 能不能关 |
|---|---|---|---|
| `idle` | 平时（它一直在窥屏 ✓） | **按时间**轮换 ✓ | 能 ✓ |
| `thinking` | 有人说话了、它在想怎么回 ✓ | **随机**挑一句 ✓ | **不能** ✗ |
| `silent` | 它决定**不插嘴** ✓ | **随机**挑一句 ✓ | 能 ✓ |

`thinking` 那一档**恒为 on** ✓ —— 而且是**在这儿强制** ✓，不是在界面上藏开关 ✗。
界面藏起来只是"请求"✓，绕过去（直接打接口、改库）就没用了 ✗。
"""

from __future__ import annotations

import json
import logging
import random

log = logging.getLogger("lifeguard.agent_status")

KINDS = ("idle", "thinking", "silent")

#: 一档最多几句。够用就行 —— 这不是给人堆文案的地方 ✓
MAX_LINES = 20
#: 一句最长几个字。它显示在顶栏群名下面那一条，长了自己就被截 ✓
MAX_LINE_LEN = 40
#: 待机轮换间隔的上下限（秒）。下限 60：比这更快就成了"闪"✗，不是状态条 ✓
EVERY_MIN = 60
EVERY_MAX = 24 * 3600
#: 「给管家的话」上限（字）。它每一轮都进 prompt ✓，不限就等于让人往里灌垃圾 ✗
#: ★ **2000 → 800**（2026-10-09 用户定的：「将字数上限设为800」✓）——
#:   前端那个计数器用的也是它（两边写死的数**必须一致** ✗，
#:   不然会出现「输入框让你写到 800、后端悄悄截到别的数」那种错 ✓）。
MAX_PROMPT = 800

DEFAULT_CONFIG: dict = {
    "idle": {"on": True, "lines": ["正在窥屏…"], "every": 600},
    "thinking": {"on": True, "lines": ["正在思考…"]},
    "silent": {"on": True, "lines": ["打算继续窥屏…"]},
}


def _clamp_int(v, lo: int, hi: int, fallback: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, n))


def _clean_lines(v) -> list[str]:
    """把传进来的东西收拾成"一串非空的短句" ✓。"""
    if isinstance(v, str):
        # 允许前端图省事传一个字符串（按行拆 ✓）—— 不该因为这点差异就整段作废 ✗
        v = v.splitlines()
    if not isinstance(v, (list, tuple)):
        return []
    out: list[str] = []
    for x in v:
        s = str(x or "").strip()[:MAX_LINE_LEN]
        if s and s not in out:          # 去重 ✓：同一句写两遍没有意义，还会让"随机"失真 ✓
            out.append(s)
        if len(out) >= MAX_LINES:
            break
    return out


def normalize(raw) -> dict:
    """**任何输入都吐一份能用的配置** ✓ —— 这是这个模块存在的理由。

    输入可以是：JSON 字符串 / dict / None / 一坨坏数据 ✓。
    输出保证：三档齐全 ✓、`lines` 非空 ✓、`every` 在范围内 ✓、
    `thinking.on` 恒为 True ✓。
    """
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except (ValueError, TypeError):
            log.warning("agent_status 存的不是合法 JSON，按默认值处理：%r", raw[:120])
            raw = {}
    if not isinstance(raw, dict):
        raw = {}

    cfg: dict = {}
    for kind in KINDS:
        src = raw.get(kind)
        if not isinstance(src, dict):
            src = {}
        d = DEFAULT_CONFIG[kind]
        lines = _clean_lines(src.get("lines")) or list(d["lines"])
        item = {"on": bool(src.get("on", d["on"])), "lines": lines}
        if kind == "idle":
            item["every"] = _clamp_int(src.get("every"), EVERY_MIN, EVERY_MAX, d["every"])
        cfg[kind] = item

    # ★ `rev`：**每存一次 +1**（由服务端加 ✓，见 routes_groups 那段）。
    #   它进待机轮换的**相位** ✓ —— 于是"改完点保存，屏幕上立刻能看到变化" ✓。
    #   不加它的话，用户改完文案可能十分钟里什么都看不到 ✗
    #   → "保存没生效"这句结论就写进他的经验里了 ✓（然后他会反复点保存 ✓）。
    cfg["rev"] = _clamp_int((raw.get("rev") if isinstance(raw, dict) else 0),
                            0, 10 ** 9, 0)

    # ★★ **「思考中」恒开** ✓ —— 用户只给这一档保留了强制 ✓
    #   （原话："只有思考中需要保留" ✓）。
    #   放在 normalize 里 = 无论从哪条路进来（接口 / 迁移 / 直接改库 ✓）
    #   都会被掰回来 ✓。界面藏开关只是"请求"✗，这一句才是拦得住的 ✓。
    cfg["thinking"]["on"] = True
    return cfg


def dumps(cfg) -> str:
    return json.dumps(normalize(cfg), ensure_ascii=False, separators=(",", ":"))


def pick(cfg: dict, kind: str) -> str | None:
    """从某一档里挑一句。**关掉的档返回 None** ✓（= 什么都不显示 ✓）。

    `idle` 不走这儿 ✓ —— 它是**按时钟轮换**的 ✓（见前端），
    服务端不必每十分钟推一次消息 ✗。这里返回第一句只是给"随手要一个"的场合兜底 ✓。
    """
    it = (cfg or {}).get(kind) or {}
    if not it.get("on"):
        return None
    lines = it.get("lines") or []
    if not lines:
        return None
    if kind == "idle":
        return lines[0]
    return random.choice(lines)


def clean_prompt(raw) -> str:
    """「给管家的话」—— 收尾存下来之前走它 ✓。"""
    s = str(raw or "").strip()
    if len(s) > MAX_PROMPT:
        log.warning("「给管家的话」超长（%d 字），截到 %d", len(s), MAX_PROMPT)
        s = s[:MAX_PROMPT]
    return s
