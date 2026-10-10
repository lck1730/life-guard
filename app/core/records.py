"""泛用的结构化记录：类型登记、写入校验、汇总。

## 形状

    records(group_id, kind, fields JSON)

一张表承载所有"要能查、能算、以后能画图"的东西。记账只是其中一个 `kind`。

## 为什么泛用，而不是一种任务一张表

**因为可视化层要能泛化。** 按 `(kind, fields)` 渲染，一套代码画所有类型；
一种任务一张表的话，每加一种就得给可视化写一个特例——而"自由绘制的生活管家组件"
正是这个产品下一步要做的事。

## 代价，以及对策

JSON 字段**没有类型约束**，写入会脏：模型可能写 `{"amount": "58元"}`、
字段名写成中文、或者同一件事这次叫 `note` 下次叫 `备注`。跑一段时间数据就烂了，
而烂掉的数据在可视化时才会暴露——那时已经晚了。

所以配套一张 `record_kinds` 登记表，**写入时按登记的 schema 严格校验**：

- 未知字段 → 报错（并列出该类型有哪些字段），这样模型下一次就学乖了
- 缺必填 → 报错
- 类型不对 → 尽量**规范化**（"58元" → 58，"2026-10-03" → 时间戳），规范不了才报错

**校验必须在我们这边做。** 让模型只负责填值、我们负责把关——它的"自觉"我们已经
吃过太多次亏了（比如它说"记下了"而没调工具）。

## 一条不变量：只能往宽长

| 操作 | 允许 |
|---|---|
| 新建一个类型 | ✅ 自由，零摩擦 |
| 给已有类型**加**字段 | ✅ 向后兼容，旧记录不受影响 |
| **改**已有字段的类型 | ❌ 会破坏历史数据、让可视化对不上 |
| **删**字段 | ❌ 同上 |

这样既满足"用户随时能提新需求"（零摩擦建新类型），又不会让已有数据结构漂移。
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

from ..db import execute, fetch_all, fetch_one, now

log = logging.getLogger("lifeguard.records")

# ── 内置类型 ──────────────────────────────────────────────────────────
#
# 内置的只有记账——它是唯一已经在跑、有真实数据的类型。
# 其余类型由 agent 按需自己定义（见 SOUL.md 里的 record_define）。
BUILTIN_KINDS: dict[str, dict[str, Any]] = {
    "bookkeeping": {
        "title": "记账",
        "fields": {
            "amount": {
                "type": "number", "required": True,
                "desc": "金额。正数=支出，负数=收入/退款。单位元",
            },
            "category": {
                "type": "string",
                "desc": "分类：餐饮/交通/购物/居家/医疗/娱乐/其他",
            },
            "note": {"type": "string", "desc": "备注，如「买菜」"},
            "spent_at": {
                "type": "time",
                "desc": "这笔账发生的时间（unix 秒或 YYYY-MM-DD）。不传=现在",
            },
        },
        # 声明"这个类型要能汇总"，query 时会按这个算
        "summary": {"sum": ["amount"], "group_by": ["category"]},
    },
}

_NUM_CLEAN = re.compile(r"[^\d.\-]")


class KindError(ValueError):
    """类型定义的变更不合规（改了/删了已有字段）。"""


# ── 类型登记 ──────────────────────────────────────────────────────────

async def ensure_builtin_kinds(group_id: int) -> None:
    """给这个群把内置类型登记上。建群时和查询时都会调，幂等。"""
    for kind, schema in BUILTIN_KINDS.items():
        await execute(
            "INSERT OR IGNORE INTO record_kinds (group_id, kind, schema, created_at) "
            "VALUES (?,?,?,?)",
            (group_id, kind, json.dumps(schema, ensure_ascii=False), now()),
        )


async def get_kind(group_id: int, kind: str) -> dict[str, Any] | None:
    await ensure_builtin_kinds(group_id)
    row = await fetch_one(
        "SELECT schema FROM record_kinds WHERE group_id = ? AND kind = ?", (group_id, kind)
    )
    if not row:
        return None
    try:
        return json.loads(row["schema"])
    except json.JSONDecodeError:
        return None


async def list_kinds(group_id: int) -> list[dict[str, Any]]:
    await ensure_builtin_kinds(group_id)
    rows = await fetch_all(
        "SELECT kind, schema FROM record_kinds WHERE group_id = ? ORDER BY kind", (group_id,)
    )
    out = []
    for r in rows:
        try:
            s = json.loads(r["schema"])
        except json.JSONDecodeError:
            continue
        out.append({
            "kind": r["kind"],
            "title": s.get("title") or r["kind"],
            "fields": s.get("fields") or {},
        })
    return out


def _diff_schema(old: dict, new: dict) -> str | None:
    """新 schema 相对旧的有没有违规。返回错误说明或 None。

    **只能往宽长**：可以加字段，不能改类型、不能删。理由见模块开头的说明。
    """
    old_f = old.get("fields") or {}
    new_f = new.get("fields") or {}

    for name in old_f:
        if name not in new_f:
            return (f"不能删除已有字段 `{name}`——历史记录里还有它，删了那些数据就成孤儿了。"
                    f"如果它没用了，保留定义、以后不再填即可。")
        if old_f[name].get("type") != new_f[name].get("type"):
            return (f"不能改字段 `{name}` 的类型"
                    f"（{old_f[name].get('type')} → {new_f[name].get('type')}）——"
                    f"已有记录是按旧类型存的，改了对不上。要换类型就新建一个字段名。")
        if old_f[name].get("required") and not new_f[name].get("required"):
            return (f"不能把必填字段 `{name}` 改成可选——历史记录不会因此变得合规。")
    return None


async def define_kind(group_id: int, kind: str, schema: dict[str, Any]) -> str | None:
    """定义一个类型 / 扩展一个类型。返回错误说明或 None（成功）。"""
    kind = (kind or "").strip()
    if not kind or not re.fullmatch(r"[a-z][a-z0-9_]{1,31}", kind):
        return ("类型名必须是英文小写字母开头、只含小写字母/数字/下划线的标识符"
                "（比如 bookkeeping、todo、anniversary）。中文名放 title 里。")
    fields = schema.get("fields")
    if not isinstance(fields, dict) or not fields:
        return "schema.fields 必须是一个非空对象，键是字段名，值至少要有 type。"
    for fname, spec in fields.items():
        if not isinstance(spec, dict) or spec.get("type") not in ("number", "string", "time", "bool"):
            return (f"字段 `{fname}` 的 type 必须是 number / string / time / bool 之一。")

    old = await get_kind(group_id, kind)
    if old:
        problem = _diff_schema(old, schema)
        if problem:
            return problem
        await execute(
            "UPDATE record_kinds SET schema = ? WHERE group_id = ? AND kind = ?",
            (json.dumps(schema, ensure_ascii=False), group_id, kind),
        )
        log.info("group=%s 扩展了记录类型 %s", group_id, kind)
    else:
        await execute(
            "INSERT INTO record_kinds (group_id, kind, schema, created_at) VALUES (?,?,?,?)",
            (group_id, kind, json.dumps(schema, ensure_ascii=False), now()),
        )
        log.info("group=%s 新建了记录类型 %s", group_id, kind)
    return None


# ── 写入校验 ──────────────────────────────────────────────────────────

def _to_number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = _NUM_CLEAN.sub("", v.strip().replace("，", "").replace(",", ""))
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _to_time(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        if s.isdigit():
            return int(s)
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d"):
            try:
                dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
                return int(dt.timestamp())
            except ValueError:
                continue
        # 相对时间交给模型自己换算，这里不猜
    return None


def validate(fields: dict[str, Any], schema: dict[str, Any]) -> tuple[dict | None, str | None]:
    """按 schema 规范化并校验。返回 (规范化后的字段, 错误说明)。

    错误说明是**给模型看的**——所以要写清楚它错在哪、下次该怎么办，
    而不是只丢一个 "invalid" 让它瞎猜（然后它就会开始乱试工具）。
    """
    spec = schema.get("fields") or {}
    unknown = [k for k in fields if k not in spec]
    if unknown:
        return None, (
            f"未知字段 {unknown}。这个类型只有这些字段：{sorted(spec)}。"
            f"如果你需要一个新字段，先调用 record_define 把它加上（可以加，但不能改已有的）。"
        )

    out: dict[str, Any] = {}
    for name, f in spec.items():
        raw = fields.get(name)
        if raw is None or raw == "":
            if f.get("required"):
                return None, f"字段 `{name}` 是必填的（{f.get('desc') or ''}）"
            continue
        t = f.get("type")
        if t == "number":
            val = _to_number(raw)
            if val is None:
                return None, f"字段 `{name}` 要是数字，收到 {raw!r}"
            out[name] = int(val) if float(val).is_integer() else val
        elif t == "time":
            val = _to_time(raw)
            if val is None:
                return None, (f"字段 `{name}` 要是 unix 时间戳或 YYYY-MM-DD，收到 {raw!r}。"
                              f"「昨天」「三天前」这种相对说法你自己换算好再传。")
            out[name] = val
        elif t == "bool":
            if isinstance(raw, bool):
                out[name] = raw
            elif isinstance(raw, str) and raw.strip().lower() in ("true", "false"):
                out[name] = raw.strip().lower() == "true"
            else:
                return None, f"字段 `{name}` 要是 true/false，收到 {raw!r}"
        else:  # string
            out[name] = raw if isinstance(raw, str) else str(raw)

    # 时间字段没传就补当前时刻——记账最常忘的就是这个
    for name, f in spec.items():
        if f.get("type") == "time" and f.get("required") and name not in out:
            out[name] = now()
    return out, None


# ── 读写 ──────────────────────────────────────────────────────────────

async def add(group_id: int, kind: str, fields: dict[str, Any],
              created_by: int | None = None) -> tuple[dict | None, str | None]:
    schema = await get_kind(group_id, kind)
    if schema is None:
        have = [k["kind"] for k in await list_kinds(group_id)]
        return None, (f"没有 `{kind}` 这个类型。现有的：{have}。"
                      f"要新类型就先调 record_define 定义它。")
    clean, err = validate(fields, schema)
    if err:
        return None, err
    rid = await execute(
        "INSERT INTO records (group_id, kind, fields, created_by, created_at) "
        "VALUES (?,?,?,?,?)",
        (group_id, kind, json.dumps(clean, ensure_ascii=False), created_by, now()),
    )
    return {"id": rid, "kind": kind, "fields": clean}, None


# ── 改 / 删 / 撤销 ────────────────────────────────────────────────────
#
# 2026-10-04 补的。在那之前**记录只能加不能改**——记错一笔只能再记一笔对冲，
# 而用户的原话就是"这条记错了"。那时候没别的办法。
#
# 两条设计：
#
# 1. **软删除**（`deleted_at`）：行留着，查询默认不看。
#    账不能无声消失——月底少一笔、又查不出为什么，比记错本身更糟。
# 2. **每次改/删先留痕**（`record_history` 存"改之前"的样子）。
#    用户一定会问"这笔原来记的是多少"，覆盖了就永远答不上来。


async def _get_row(group_id: int, record_id: int) -> dict[str, Any] | None:
    return await fetch_one(
        "SELECT id, kind, fields, deleted_at FROM records WHERE id = ? AND group_id = ?",
        (record_id, group_id),
    )


async def _snapshot(record_id: int, group_id: int, fields_json: str, action: str) -> None:
    """把"改之前"的样子存进历史。"""
    await execute(
        "INSERT INTO record_history (record_id, group_id, action, fields, changed_at) "
        "VALUES (?,?,?,?,?)",
        (record_id, group_id, action, fields_json, now()),
    )


def _parse(s: str) -> dict[str, Any]:
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return {}


async def update(group_id: int, record_id: int, fields: dict[str, Any],
                 ) -> tuple[dict | None, str | None]:
    """改一条。**传哪些字段就改哪些**，其余不动；传 `null` 表示把那个字段清掉。

    校验用的是**合并之后**的完整字段——所以"只想改金额"也得过同一套校验，
    不会因为只传了一个字段就绕过去。
    """
    row = await _get_row(group_id, record_id)
    if not row:
        return None, f"没有 id={record_id} 这条记录（用 record_query 查一下 id）"
    if row["deleted_at"]:
        return None, (f"id={record_id} 已经删掉了，改不了。"
                      f"要改先调 record_restore 把它恢复回来。")

    old = _parse(row["fields"])
    merged = dict(old)
    for k, v in (fields or {}).items():
        if v is None:
            merged.pop(k, None)      # 传 null = 清掉这个字段
        else:
            merged[k] = v

    schema = await get_kind(group_id, row["kind"])
    if schema is None:
        return None, f"类型 `{row['kind']}` 没登记过，改不了"
    clean, err = validate(merged, schema)
    if err:
        return None, err

    await _snapshot(record_id, group_id, row["fields"], "update")
    await execute("UPDATE records SET fields = ? WHERE id = ? AND group_id = ?",
                  (json.dumps(clean, ensure_ascii=False), record_id, group_id))
    return {"id": record_id, "kind": row["kind"], "fields": clean, "was": old}, None


async def delete(group_id: int, record_id: int) -> tuple[dict | None, str | None]:
    """软删除。行还在，只是查询默认不看它——**账不能无声消失**。"""
    row = await _get_row(group_id, record_id)
    if not row:
        return None, f"没有 id={record_id} 这条记录（用 record_query 查一下 id）"
    if row["deleted_at"]:
        return None, f"id={record_id} 之前就删过了"
    await _snapshot(record_id, group_id, row["fields"], "delete")
    await execute("UPDATE records SET deleted_at = ? WHERE id = ? AND group_id = ?",
                  (now(), record_id, group_id))
    return {"id": record_id, "kind": row["kind"], "fields": _parse(row["fields"])}, None


async def restore(group_id: int, record_id: int) -> tuple[dict | None, str | None]:
    """把删掉的恢复回来（"刚才那条删错了"）。"""
    row = await _get_row(group_id, record_id)
    if not row:
        return None, f"没有 id={record_id} 这条记录"
    if not row["deleted_at"]:
        return None, f"id={record_id} 本来就没删"
    await _snapshot(record_id, group_id, row["fields"], "restore")
    await execute("UPDATE records SET deleted_at = NULL WHERE id = ? AND group_id = ?",
                  (record_id, group_id))
    return {"id": record_id, "kind": row["kind"], "fields": _parse(row["fields"])}, None


async def query(group_id: int, kind: str, *, since: int | None = None,
                limit: int = 100, include_deleted: bool = False) -> dict[str, Any]:
    schema = await get_kind(group_id, kind) or {}
    sql = "SELECT id, fields, created_at FROM records WHERE group_id = ? AND kind = ?"
    params: list[Any] = [group_id, kind]
    # 软删除的行默认不出现。除非 include_deleted=True（查"这条去哪了"时用）。
    if not include_deleted:
        sql += " AND deleted_at IS NULL"
    if since:
        sql += " AND created_at >= ?"
        params.append(since)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    rows = await fetch_all(sql, params)
    items = []
    for r in rows:
        try:
            f = json.loads(r["fields"])
        except json.JSONDecodeError:
            continue
        items.append({"id": r["id"], **f})

    result: dict[str, Any] = {"kind": kind, "count": len(items), "items": items}

    # 按 schema 声明算汇总。**在应用层算**——JSON blob 里没法直接 SQL 聚合。
    # 这个规模（几百条）毫秒级；真到几万条再考虑把常用字段提升成真列。
    summ = schema.get("summary") or {}
    for fname in summ.get("sum") or []:
        total = 0.0
        for it in items:
            v = it.get(fname)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                total += v
        result[f"sum_{fname}"] = round(total, 2)
    for fname in summ.get("group_by") or []:
        buckets: dict[str, float] = {}
        for it in items:
            key = str(it.get(fname) or "未分类")
            val = it.get("amount") if isinstance(it.get("amount"), (int, float)) else 1
            buckets[key] = round(buckets.get(key, 0) + val, 2)
        result[f"by_{fname}"] = buckets
    return result


async def _selftest() -> None:
    """给 `python -m app.records` 用的自检：校验逻辑是纯函数，不碰库。"""
    schema = BUILTIN_KINDS["bookkeeping"]
    cases = [
        ({"amount": 58}, "数字直接通过"),
        ({"amount": "58元"}, "带单位的字符串要能规范化"),
        ({"amount": "abc"}, "非数字要报错"),
        ({"金额": 58}, "中文字段名要报未知字段"),
        ({"category": "餐饮"}, "缺必填要给清楚"),
        ({"amount": 1, "spent_at": "2026-10-03"}, "日期字符串要能解析"),
    ]
    for raw, why in cases:
        clean, err = validate(raw, schema)
        print("%-28s → %s" % (why, ("✗ " + err) if err else ("✓ " + str(clean))))
    # 只能往宽长
    wider = {"fields": dict(schema["fields"],
                            refund={"type": "bool", "desc": "是否退款"})}
    print("\n加字段:", _diff_schema(schema, wider) or "✓ 允许")
    narrower = {"fields": {k: v for k, v in schema["fields"].items() if k != "note"}}
    print("删字段:", _diff_schema(schema, narrower) or "✓ 允许（不该）")
    changed = {"fields": dict(schema["fields"], amount={"type": "string"})}
    print("改类型:", _diff_schema(schema, changed) or "✓ 允许（不该）")


if __name__ == "__main__":
    import asyncio

    asyncio.run(_selftest())
