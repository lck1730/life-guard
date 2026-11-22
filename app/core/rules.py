"""规矩 —— 每周的约定：管家立、管家督、管家记。

用户 2026-11-22：「新增一个立规矩板块……比如说每周能吃几次放纵餐，喝几杯
奶茶小甜水……以及每周要做什么事情……主要由管家去添加规矩以及督促……
将立的规矩结构化存储起来……管家可以感知到规矩」。

## 两种规矩

· `limit` —— **不超过** N 次（放纵餐、奶茶）。超了要让人看见，但**不拦**：
  规矩是拿来过的，不是拿来锁人的；记下来才有意义。
· `task`  —— **至少** N 次（跑步、读书）。做到就收工，不重复记。

## 周界

按**本地时区**（服务器 Asia/Beijing / CST）**周一 00:00** 起算 ✓。
进度只算「本周」：上周记的账不背到这一周 ✓。
（`rules` 表留了 `period` 列，目前只有 `week` —— 以后要月规矩再改这里 ✓。）

## 给谁看

· 界面：`GET /api/rules`（`app/api/rules.py`）✓
· 管家：`prompt_section()` 每轮拼进系统提示 ✓（不用它调工具就知道进度 ✓）；
  写操作走内部接口 / 插件工具 ✓（`api/internal.py` 的 `/rules/*`）✓。
"""

from __future__ import annotations

import logging

from datetime import datetime, timedelta
from typing import Any

from ..db import execute, execute_rc, fetch_all, fetch_one, now

log = logging.getLogger("lifeguard.rules")

KINDS = ("limit", "task")
#: 界面用的图标名，钉死在一组里（前端有同名 SVG）✓ —— 模型乱填也不会画不出来 ✓。
ICONS = ("food", "drink", "run", "book", "moon", "heart", "star", "leaf", "spark", "clock")
MAX_TARGET = 99
MAX_TITLE = 40
MAX_NOTE = 200


def week_bounds(ts: int | None = None) -> tuple[int, int]:
    """本地周一 00:00 → 下周一 00:00（epoch 秒）✓。"""
    d = datetime.fromtimestamp(now() if ts is None else ts)
    start = (d - timedelta(days=d.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return int(start.timestamp()), int((start + timedelta(days=7)).timestamp())


def _week_label(start: int, end: int) -> str:
    a = datetime.fromtimestamp(start)
    b = datetime.fromtimestamp(end - 1)
    if a.year != b.year:
        return f"{a.year}年{a.month}月{a.day}日–{b.year}年{b.month}月{b.day}日"
    return f"{a.month}月{a.day}日–{b.month}月{b.day}日"


def _clean_title(title: Any) -> str:
    return str(title or "").strip()[:MAX_TITLE]


def _clean_kind(kind: Any) -> str:
    k = str(kind or "").strip().lower()
    return k if k in KINDS else "limit"


def _clean_target(target: Any, *, default: int = 1) -> int:
    try:
        n = int(target)
    except (TypeError, ValueError):
        return default
    return max(1, min(MAX_TARGET, n))


async def _rule_row(rule_id: int, group_id: int) -> dict | None:
    return await fetch_one(
        """SELECT id, group_id, title, kind, target, icon, note, created_by, created_at
           FROM rules WHERE id = ? AND group_id = ? AND deleted_at IS NULL""",
        (rule_id, group_id),
    )


async def _events(group_id: int, rule_ids: list[int], start: int, end: int) -> dict[int, list[dict]]:
    if not rule_ids:
        return {}
    marks = ",".join("?" for _ in rule_ids)
    rows = await fetch_all(
        f"""SELECT id, rule_id, user_id, happened_at, note
            FROM rule_events
            WHERE group_id = ? AND deleted_at IS NULL
              AND happened_at >= ? AND happened_at < ?
              AND rule_id IN ({marks})
            ORDER BY happened_at, id""",
        (group_id, start, end, *rule_ids),
    )
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(int(r["rule_id"]), []).append(r)
    return out


def _shape(rule: dict, events: list[dict]) -> dict:
    target = _clean_target(rule.get("target"))
    kind = _clean_kind(rule.get("kind"))
    count = len(events)
    if kind == "task":
        status = "done" if count >= target else "todo"
    else:
        status = "over" if count > target else ("full" if count == target else "ok")
    return {
        "id": rule["id"],
        "title": rule["title"],
        "kind": kind,
        "target": target,
        "icon": rule.get("icon") or "star",
        "note": rule.get("note") or "",
        "count": count,
        "remaining": max(0, target - count),
        "over": max(0, count - target),
        "status": status,
        # 按时间从早到晚 —— 界面的圆点从左往右就是这一次一次的记录 ✓
        "events": events,
    }


async def list_for_group(group_id: int, ts: int | None = None) -> dict:
    start, end = week_bounds(ts)
    rows = await fetch_all(
        """SELECT id, group_id, title, kind, target, icon, note, created_by, created_at
           FROM rules WHERE group_id = ? AND deleted_at IS NULL
           ORDER BY id""",
        (group_id,),
    )
    by_rule = await _events(group_id, [int(r["id"]) for r in rows], start, end)
    rules = [_shape(r, by_rule.get(int(r["id"]), [])) for r in rows]
    kept = sum(1 for r in rules if r["status"] in ("ok", "full", "done"))
    return {
        "week_start": start,
        "week_end": end,
        "week_label": _week_label(start, end),
        "rules": rules,
        "summary": {"total": len(rules), "kept": kept},
    }


async def _find(group_id: int, *, title: str = "", rule_id: int | None = None) -> tuple[dict | None, str]:
    """按 id 或名字找一条**还活着**的规矩 ✓。

    名字先**全等**（不分大小写），再退到"包含"；包含到多条就让人说全 ——
    猜一条然后改错，比回一句「有好几条」糟得多 ✓。
    """
    if rule_id:
        row = await _rule_row(int(rule_id), group_id)
        if not row:
            return None, "这条规矩已经不在了"
        return row, ""

    name = _clean_title(title)
    if not name:
        return None, "得说清是哪条规矩"
    rows = await fetch_all(
        """SELECT id, group_id, title, kind, target, icon, note, created_by, created_at
           FROM rules WHERE group_id = ? AND deleted_at IS NULL ORDER BY id""",
        (group_id,),
    )
    exact = [r for r in rows if (r["title"] or "").lower() == name.lower()]
    if len(exact) == 1:
        return exact[0], ""
    hits = [r for r in rows if name.lower() in (r["title"] or "").lower()]
    if len(hits) == 1:
        return hits[0], ""
    if not hits:
        names = "、".join(f"「{r['title']}」" for r in rows) or "（还没有立规矩）"
        return None, f"没找到「{name}」。现在的规矩有：{names}"
    names = "、".join(f"「{r['title']}」" for r in hits)
    return None, f"好几条都像「{name}」：{names} —— 说全名"


async def get(group_id: int, rule_id: int) -> dict | None:
    full = await list_for_group(group_id)
    for r in full["rules"]:
        if int(r["id"]) == int(rule_id):
            return r
    return None


async def create(
    group_id: int,
    title: str,
    *,
    kind: str = "limit",
    target: int = 1,
    icon: str = "star",
    note: str = "",
    created_by: int | None = None,
) -> tuple[dict | None, str]:
    name = _clean_title(title)
    if not name:
        return None, "这条规矩得有个名字（比如「奶茶」「跑步」）"
    dup = await fetch_one(
        """SELECT id FROM rules
           WHERE group_id = ? AND deleted_at IS NULL AND lower(title) = lower(?)""",
        (group_id, name),
    )
    if dup:
        return None, f"已经有一条「{name}」了；要改次数就用 rule_update"
    rid = await execute(
        """INSERT INTO rules(group_id, title, kind, target, icon, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (group_id, name, _clean_kind(kind), _clean_target(target),
         icon if icon in ICONS else "star", str(note or "").strip()[:MAX_NOTE],
         created_by, now()),
    )
    row = await _rule_row(rid, group_id)
    if not row:
        return None, "没立上，再试一次"
    log.info("rule #%s %s created in group %s", rid, name, group_id)
    return await get(group_id, rid), ""


async def update(
    group_id: int,
    *,
    title: str = "",
    rule_id: int | None = None,
    new_title: str | None = None,
    kind: str | None = None,
    target: int | None = None,
    icon: str | None = None,
    note: str | None = None,
) -> tuple[dict | None, str]:
    row, err = await _find(group_id, title=title, rule_id=rule_id)
    if not row:
        return None, err
    rid = int(row["id"])

    sets: list[str] = []
    params: list[Any] = []
    if new_title is not None:
        name = _clean_title(new_title)
        if not name:
            return None, "名字不能空着"
        dup = await fetch_one(
            """SELECT id FROM rules
               WHERE group_id = ? AND deleted_at IS NULL AND lower(title) = lower(?)
                 AND id <> ?""",
            (group_id, name, rid),
        )
        if dup:
            return None, f"已经有一条「{name}」了"
        sets.append("title = ?")
        params.append(name)
    if kind is not None:
        sets.append("kind = ?")
        params.append(_clean_kind(kind))
    if target is not None:
        sets.append("target = ?")
        params.append(_clean_target(target))
    if icon is not None:
        sets.append("icon = ?")
        params.append(icon if icon in ICONS else "star")
    if note is not None:
        sets.append("note = ?")
        params.append(str(note).strip()[:MAX_NOTE])
    if not sets:
        return await get(group_id, rid), ""
    params.append(rid)
    await execute(f"UPDATE rules SET {', '.join(sets)} WHERE id = ?", params)
    return await get(group_id, rid), ""


async def _count_this_week(group_id: int, rule_id: int) -> int:
    start, end = week_bounds()
    row = await fetch_one(
        """SELECT COUNT(*) AS n FROM rule_events
           WHERE group_id = ? AND rule_id = ? AND deleted_at IS NULL
             AND happened_at >= ? AND happened_at < ?""",
        (group_id, rule_id, start, end),
    )
    return int((row or {}).get("n") or 0)


async def log_event(
    group_id: int,
    *,
    title: str = "",
    rule_id: int | None = None,
    count: int = 1,
    note: str = "",
    user_id: int | None = None,
) -> tuple[dict | None, str]:
    rule, err = await _find(group_id, title=title, rule_id=rule_id)
    if not rule:
        return None, err
    rid = int(rule["id"])
    n = _clean_target(count)
    target = _clean_target(rule["target"])

    if _clean_kind(rule["kind"]) == "task":
        already = await _count_this_week(group_id, rid)
        if already >= target:
            return None, (
                f"「{rule['title']}」本周已经做到 {already}/{target} 了，不用再记。"
                "要多记就是改规矩了（rule_update）"
            )
        n = min(n, target - already)

    ts = now()
    for i in range(n):
        await execute(
            """INSERT INTO rule_events(group_id, rule_id, user_id, happened_at, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (group_id, rid, user_id, ts + i, str(note or "").strip()[:MAX_NOTE], ts),
        )
    log.info("rule #%s logged %s time(s) in group %s", rid, n, group_id)
    return await get(group_id, rid), ""


async def undo_event(
    group_id: int,
    *,
    title: str = "",
    rule_id: int | None = None,
    count: int = 1,
) -> tuple[dict | None, str]:
    rule, err = await _find(group_id, title=title, rule_id=rule_id)
    if not rule:
        return None, err
    rid = int(rule["id"])
    n = _clean_target(count)
    start, end = week_bounds()
    rows = await fetch_all(
        """SELECT id FROM rule_events
           WHERE group_id = ? AND rule_id = ? AND deleted_at IS NULL
             AND happened_at >= ? AND happened_at < ?
           ORDER BY happened_at DESC, id DESC LIMIT ?""",
        (group_id, rid, start, end, n),
    )
    if not rows:
        return None, f"「{rule['title']}」本周还没有记录，没得撤"
    ts = now()
    for r in rows:
        await execute_rc(
            "UPDATE rule_events SET deleted_at = ? WHERE id = ?",
            (ts, r["id"]),
        )
    log.info("rule #%s undo %s in group %s", rid, len(rows), group_id)
    return await get(group_id, rid), ""


async def remove(group_id: int, *, title: str = "", rule_id: int | None = None) -> tuple[str, str]:
    rule, err = await _find(group_id, title=title, rule_id=rule_id)
    if not rule:
        return "", err
    await execute_rc(
        "UPDATE rules SET deleted_at = ? WHERE id = ?",
        (now(), rule["id"]),
    )
    log.info("rule #%s removed in group %s", rule["id"], group_id)
    return rule["title"], ""


async def prompt_section(group_id: int) -> str:
    """每轮系统提示里的规矩段 ✓ —— 让管家**不用调工具**就知道现在什么进度 ✓。"""
    data = await list_for_group(group_id)
    lines = [
        "## 这个群立的规矩（每周）",
        f"本周是 {data['week_label']}（周一 00:00 起算）✓。",
    ]
    if not data["rules"]:
        lines.append("还没有立规矩。")
    else:
        for r in data["rules"]:
            if r["kind"] == "limit":
                state = {
                    "ok": f"还能 {r['remaining']} 次",
                    "full": "**已经到顶，再记就超了**",
                    "over": f"**已经超了 {r['over']} 次**",
                }[r["status"]]
                lines.append(
                    f"- 【上限】{r['title']}：本周 {r['count']}/{r['target']} 次"
                    f"（{state}）"
                )
            else:
                if r["status"] == "done":
                    state = "**已经做到**"
                else:
                    state = f"还差 {r['remaining']} 次"
                lines.append(
                    f"- 【任务】{r['title']}：本周 {r['count']}/{r['target']} 次"
                    f"（{state}）"
                )
    lines += [
        "",
        "★ 这份进度是**实时**的，你每轮都看得见，**不用调工具去查** ✓。",
        "★ 你负责规矩：新要求 → `rule_add`；他们做到了/吃喝了 → `rule_log`；"
        "记错了 → `rule_undo`；改主意 → `rule_update`；不算了 → `rule_remove` ✓。",
        "⚠️ **别替他们编打卡** ✗ —— 只有他们说了、或者给出明确事实，才记 ✓。"
        "也别每轮都念一遍进度 ✓：相关话题出现时轻轻提一句就够了 ✓；"
        "快到上限、或者本周还没动，可以提醒一下 ✓。",
    ]
    return "\n".join(lines) + "\n"
