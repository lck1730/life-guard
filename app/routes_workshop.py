"""创意工坊的「对话」—— 一条**任务**一段。

## 它和群聊根本上是两件事

群聊是"群里好几个人在说话、它自己决定要不要插嘴" ✓ —— 所以那边有判断闸、
缓冲合并、说话前的复审、`[SILENT]` 那些标记 ✓。
**工坊里是你一个人对着它说话** ✓ —— 那些闸一个都不需要 ✓，
留着只会带来"它怎么又不理我" ✓（App 管家那边已经踩过这个结论 ✓）。

所以这里**直接走 `_stream_completion`** ✓，不过编排层那套 ✓。

## 三层，各管各的（★ 2026-10-07 重写的核心）

    profile（SOUL / 技能 / 长期记忆）   每群一份   ← **共用**：它记得群里的事 ✓
    会话（Hermes 那边的对话历史）      每任务一份 ← **分开**：做 A 时的话不进 B ✓
    对话（界面上的这些气泡）           每任务一份 ← **分开**：`workshop_messages.task_id`

★ **为什么从"每用户"改成"每任务"** ✗→✓：
  原来会话 id 是 `…-diy-u<用户>` ✓ —— 于是**同一个人的两条对话在 Hermes 那边是同一条** ✗，
  做 A 时说过的话在做 B 的时候还在上下文里 ✓。界面上看着隔开了 ✓，它脑子里是混的 ✓。
  现在带上任务号 → 真分开了 ✓（见 `diy_session_id_for` ✓）。

⚠️ **钥匙不能是 slug** ✗ —— slug 要到流程第 ③ 步（用户确认）才由 agent 定下来 ✓，
   而"＋做一个新的"在那之前就得有身份 ✗。所以要有 `workshop_tasks` 这张表 ✓。

## 切换 = 终止（用户 2026-10-07 定的）

**同时只允许一个任务在构建** ✓。**打开另一个任务**时：

1. 掐掉正在跑的那一轮（`asyncio.Task.cancel()` ✓）→ httpx 的流随之关闭 ✓
2. **Hermes 那边会自己掐** ✓：我们对 `/v1/chat/completions` 断流之后，
   它接住 → `_abandon_agent_task(...)` → `request_hard_interrupt(agent, …)`
   + `_reap_disconnected_agent_processes(...)`（收掉它派出去的后台进程，也就是子代理 ✓）
   —— **已核实源码** ✓（`gateway/platforms/api_server_openai_routes.py:965` ✓）
3. **作废这个任务名下还没用掉的票** ✓ —— 那个子代理就算写完了也落不了地 ✓。
   这是"终止"里**唯一能由我们持久保证**的一半 ✓。
4. 在对话里补一行说明 ✓ —— **不静默消失** ✓（项目铁律：失败要看得见 ✓）

⚠️ **不把它包装成硬保证** ✗ —— 我们**不可能**点名杀 Hermes 进程里的某个子代理 ✗。
   我们能做的是断流 + 作废票；第 2 步是 Hermes 自己的行为 ✓，我们只是**触发**它 ✓。

## 消息放哪

`workshop_messages` 表 ✓，**不是** `messages` ✗ —— 群聊一个字都不会多 ✓。
主群里只会多出**两条系统消息**（开工 / 做好 ✓），那是服务端在
`components/confirm` 和 `components/save` 里发的 ✓，不靠它记得 ✓。
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .auth import current_user, require_member
from .db import execute, fetch_all, fetch_one, now
from .hub import hub
from .orchestrator.agent import (
    _group_profile,
    _stream_completion,
    diy_session_id_for,
    diy_persona,
)

log = logging.getLogger("lifeguard.workshop")
router = APIRouter(prefix="/api/workshop", tags=["workshop"])

#: 工坊的锁 —— **和群聊那把分开** ✓。
#:
#: ⚠️ 合成一把的话，做组件那几分钟**主群完全不理人** ✓ ——
#:    用户会以为坏了 ✓（那正是最不该在"做个新东西"时发生的事 ✓）。
#:    代价是同一个 profile 上可能同时跑两个 turn ✓ —— 但那本来就是 Hermes 支持的 ✓。
_diy_locks: dict[tuple[int, int], asyncio.Lock] = {}

#: 「现在哪条任务在跑」—— 每 `(群, 用户)` 至多一条 ✓。
#:
#: ⚠️ **判断"忙不忙"看这里，不看锁** ✗→✓（2026-10-07）：
#:    切换时要 `cancel()` ✓，而锁是在被掐掉的那个协程**退栈的过程中**才放的 ✓ ——
#:    中间那几毫秒锁还锁着 ✓。拿锁当判据的话，用户切过去一张嘴就被告知
#:    「它手上还有活」✓ —— 而它明明已经被掐了 ✗（"明明成功了却像失败" ✓）。
#:    这里一 `pop` 就立刻不忙 ✓，锁只负责把两个 `_run_turn` 串起来 ✓。
_running: dict[tuple[int, int], tuple[int, asyncio.Task]] = {}


def _lock_for(group_id: int, user_id: int) -> asyncio.Lock:
    key = (group_id, user_id)
    if key not in _diy_locks:
        _diy_locks[key] = asyncio.Lock()
    return _diy_locks[key]


def _busy(group_id: int, user_id: int) -> bool:
    item = _running.get((group_id, user_id))
    return bool(item) and not item[1].done()


async def _push(user_id: int, payload: dict[str, Any]) -> None:
    """定向推给**一个人** ✓ —— 不是 broadcast 给全群 ✓（工坊是你自己的事 ✓）。"""
    try:
        await hub.send_to_user(user_id, payload)
    except Exception:  # noqa: BLE001
        log.debug("工坊推送失败 user=%s", user_id, exc_info=True)


async def push_workshop_status(group_id: int, state: str,
                               task_id: int | None = None) -> None:
    """推一条「开工了 / 做好了」。

    ★ 2026-10-07：**带上任务号，并且定向发给那个人** ✗→✓ ——
      "正在做"这个状态本来就没法从流里看出来 ✓（我们只取正文 ✓，不看工具事件 ✓），
      所以服务端在**准确的那一刹那**推 ✓（`components/confirm` / `save` 里 ✓）。
      带上任务号之后，前端只认**自己正在看的**那条 ✓ ——
      别人在做组件时不会在他屏幕上闪一行 ✓。

    ⚠️ 拿不到任务号时**退回广播** ✓ —— 那是迁移前的老路径 ✓（票里没记是谁派的 ✓）。
      工坊页对未知/无关的推送本来就忽略 ✓，所以退回去是安全的 ✓，只是多推几条 ✓。
    """
    uid = None
    if task_id:
        row = await fetch_one("SELECT user_id FROM workshop_tasks WHERE id = ?",
                              (int(task_id),))
        uid = int(row["user_id"]) if row else None
    if uid:
        await _push(uid, {"type": "ws_status",
                          "data": {"group_id": group_id, "task_id": int(task_id),
                                   "state": state}})
        return
    from .messages import group_member_ids
    try:
        await hub.broadcast(await group_member_ids(group_id),
                            {"type": "ws_status",
                             "data": {"group_id": group_id, "task_id": None,
                                      "state": state}})
    except Exception:  # noqa: BLE001
        log.debug("工坊状态推送失败 group=%s", group_id, exc_info=True)


#: 组件短名的形状 ✓ —— 和 `main.py` 的 `_SLUG_RE`、`routes_internal.py` 的
#: `_slug_ok` **同一个形状** ✓。三份是历史原因（三个模块各要一份 ✓），
#: 但形状只有这一个 ✓ —— 改的话三处一起改 ✓。
_SLUG_OK = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")


# ── 任务 ────────────────────────────────────────────────────────────────

async def _own_task(group_id: int, user_id: int, task_id: int) -> dict:
    """拿到**自己的**一条任务；不是自己的就当它不存在 ✓（404 ✓）。

    ⚠️ **别人的对话看不见** ✓ —— 和消息那条规矩一致 ✓（`:user_id` 一起查 ✓，
       而不是"查出来再判"✗：查出来再判的话，那个 `if` 漏了就是泄露 ✓）。
    """
    row = await fetch_one(
        "SELECT * FROM workshop_tasks WHERE id = ? AND group_id = ? AND user_id = ?",
        (int(task_id), group_id, user_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这条对话")
    return dict(row)


async def _kept_slugs(group_id: int) -> set[str]:
    """这个群里**已经保留**的组件短名 ✓（有 live 版就算 ✓）。"""
    rows = await fetch_all(
        "SELECT DISTINCT slug FROM components WHERE group_id = ? AND state = 'live'",
        (group_id,))
    return {str(r["slug"]) for r in rows}


async def _task_payload(group_id: int, user_id: int, task_id: int) -> dict | None:
    """一条对话的**完整样子** ✓ —— 和列表里那一项**同一个形状** ✓。

    ⚠️ **故意从 `_my_tasks` 里挑** ✗→✓ —— 另写一份的话，两边的字段迟早对不上 ✓
       （前端是同一段代码在渲染它们 ✓ —— "同一个东西两处形状"是这个项目反复栽的坑 ✓）。
       代价是多一次列表查询 ✓ —— 一条对话最多几十行 ✓，不值一提 ✓。
    """
    items = await _my_tasks(group_id, user_id)
    return next((x for x in items if int(x["id"]) == int(task_id)), None)


async def _my_tasks(group_id: int, user_id: int) -> list[dict]:
    """我这些对话 —— 最近动过的排前面 ✓（第一条就是"上次那个" ✓）。

    名字从**它做出来的组件**上取 ✓（一条任务做出好几版是常事 ✓，取最新那版 ✓）；
    还没做成组件的（"＋做一个新的"之后就说了两句 ✓）名字是空的 ✓，
    界面上显示「还没起名」✓。
    """
    rows = await fetch_all(
        "SELECT t.id, t.created_at, t.updated_at,"
        "       COALESCE(t.slug,"
        "         (SELECT c.slug FROM components c WHERE c.task_id = t.id"
        "           ORDER BY c.version DESC LIMIT 1)) AS slug,"
        "       (SELECT c.title FROM components c WHERE c.task_id = t.id"
        "         ORDER BY c.version DESC LIMIT 1) AS title"
        "  FROM workshop_tasks t"
        " WHERE t.group_id = ? AND t.user_id = ?"
        " ORDER BY t.updated_at DESC, t.id DESC",
        (group_id, user_id))
    # 每个 slug 的版本情况 —— 一次查完 ✓（对话一多，逐个查就是 N+1 ✓）
    vers: dict[str, dict] = {}
    for v in await fetch_all(
            "SELECT slug, MAX(version) AS latest,"
            "       MAX(CASE WHEN state = 'live' THEN version END) AS live_v,"
            "       (SELECT title FROM components x WHERE x.group_id = c.group_id"
            "         AND x.slug = c.slug ORDER BY x.version DESC LIMIT 1) AS title"
            "  FROM components c WHERE group_id = ? GROUP BY slug", (group_id,)):
        vers[str(v["slug"])] = {"latest": int(v["latest"] or 0),
                                "live": int(v["live_v"]) if v["live_v"] else None,
                                "title": str(v["title"] or "")}
    out: list[dict] = []
    for r in rows:
        slug = str(r["slug"] or "")
        info = vers.get(slug) or {}
        out.append({"id": int(r["id"]),
                    "slug": slug,
                    # 名字优先用"这条对话自己做出来的那一版"的标题 ✓；
                    # 还没做出来（从「继续改」进来的 ✓）就用**那个组件现有的标题** ✓ ——
                    # 不然切换列表里会是一条没名字的东西 ✓，用户根本认不出是哪条 ✓。
                    "title": str(r["title"] or info.get("title") or ""),
                    "kept": bool(slug) and info.get("live") is not None,
                    "latest_version": info.get("latest") or None,
                    "live_version": info.get("live"),
                    "created_at": int(r["created_at"]),
                    "updated_at": int(r["updated_at"])})
    return out


async def _unfixed_budget(group_id: int, user_id: int) -> dict:
    """「未固化」还有几个名额 ✓ —— 用户 2026-10-07 定的上限是 **3** ✓，**按群算** ✓。

       未固化数 = 这个群里「没有任何已保留版本的 slug 数」
                + 「本群所有还没做出组件的对话数」

    ⚠️ **按群算**（不是按人 ✓）—— 组件库本来就是群共有的 ✓，
       没固化的东西也按群数 ✓（用户 2026-10-07 确认 ✓）。
    ⚠️ 第二项是**跨用户**的 ✓（不筛 user ✓）——
       否则两个人各占三个、群里就有六个半成品 ✓，和"按群算"自相矛盾 ✓。
    ⚠️ **改一个已保留的组件、出新版不占额度** ✓ —— 两条路都堵上了 ✓：
       · 组件那条：那个 slug 已经有 live 了 ✓，不在第一项里 ✓
       · 对话那条：`t.slug` 非空 = **冲着已有组件去的** ✓，也不进第二项 ✓
         （2026-10-07 补的 ✓ —— 少了这半条，"手上有 3 个半成品"的时候
          **连改一个早就保留好的组件都会被拦** ✗，而那是用户最烦的那种拦 ✓）
    """
    kept = await _kept_slugs(group_id)
    slugs = await fetch_all(
        "SELECT DISTINCT slug FROM components WHERE group_id = ?", (group_id,))
    unfixed_slugs = [str(r["slug"]) for r in slugs if str(r["slug"]) not in kept]
    unnamed = await fetch_one(
        "SELECT COUNT(*) AS n FROM workshop_tasks t"
        " WHERE t.group_id = ? AND t.slug IS NULL AND NOT EXISTS"
        "   (SELECT 1 FROM components c WHERE c.task_id = t.id)",
        (group_id,))
    n_unnamed = int((unnamed or {}).get("n") or 0)
    used = len(unfixed_slugs) + n_unnamed
    return {"used": used, "limit": 3, "left": max(0, 3 - used),
            "slugs": unfixed_slugs, "unnamed": n_unnamed}


# ── 终止 ────────────────────────────────────────────────────────────────

async def _void_tickets(task_id: int) -> int:
    """把这个任务名下**还没用掉**的票一次性作废 ✓。

    ⚠️ 这是"切换 = 终止"里**唯一能由我们持久保证**的一半 ✓（见文件头那段 ✓）：
      那个子代理可能还在写 ✓，写完主对话也会照常调 `component_save` ✓ ——
      但票作废了 ✓，`components_save` 会拒 ✓，**东西进不来** ✓。
    """
    n = await execute(
        "UPDATE component_tickets SET expires_at = 0"
        " WHERE task_id = ? AND used_at IS NULL AND expires_at > 0",
        (int(task_id),))
    return int(n or 0)


async def _abort(group_id: int, user_id: int) -> int | None:
    """掐掉正在跑的那一轮 ✓，返回被掐的任务号（没在跑就是 None ✓）。

    ⚠️ **不发 `await task`** ✗→✓ —— `cancel()` 之后的那个 task 会以
       `CancelledError` 收场 ✓，而**在调用方这边 `await` 它会把同一个异常抛给调用方** ✓
       —— 那会把**这个 HTTP 请求自己**也取消掉 ✓（用户看到的是"点了没反应" ✓，
       而真正发生的是一次莫名其妙的 500 ✓）。
       所以只发信号、不等它 ✓：它自己会在下一个 await 点退栈 ✓，
       连接跟着关掉 ✓（Hermes 那边下一次往流里写就会发现 ✓）。
    """
    key = (group_id, user_id)
    item = _running.pop(key, None)
    if not item:
        return None
    task_id, task = item
    if not task.done():
        task.cancel()
    await _void_tickets(task_id)
    return task_id


# ── 一轮对话 ────────────────────────────────────────────────────────────

async def _save(group_id: int, user_id: int, task_id: int,
                sender: str, content: str) -> dict:
    mid = await execute(
        "INSERT INTO workshop_messages(group_id, user_id, sender_type, content,"
        " created_at, task_id) VALUES(?,?,?,?,?,?)",
        (group_id, user_id, sender, content, now(), int(task_id)))
    row = await fetch_one("SELECT * FROM workshop_messages WHERE id = ?", (mid,))
    return dict(row or {})


async def _touch(task_id: int) -> None:
    """这条任务"最近动过" ✓ —— 它决定默认打开哪一条 ✓（最近那条 ✓）。"""
    await execute("UPDATE workshop_tasks SET updated_at = ? WHERE id = ?",
                  (now(), int(task_id)))


async def _run_turn(group_id: int, user_id: int, task_id: int, text: str) -> None:
    """跑一轮工坊对话 —— 后台任务 ✓（POST 立刻返回，正文走 WebSocket 推 ✓）。"""
    key = (group_id, user_id)
    async with _lock_for(group_id, user_id):
        # ⚠️ **进锁之后再登记** ✗→✓ —— 反过来的话，等锁的那几毫秒里
        #    `_running` 已经是新的了 ✓，而旧的那条刚被 `_abort` 摘掉 ✓ ——
        #    中间会出现"以为在跑，其实没在跑"的窗口 ✓。
        if _running.get(key, (None, None))[0] != task_id:
            # 已经被切走了（`_abort` 在等锁的过程中把它摘了 ✓）→ 这一轮直接作废 ✓
            return
        await _push(user_id, {"type": "ws_status",
                              "data": {"group_id": group_id, "task_id": task_id,
                                       "state": "thinking"}})
        try:
            profile = await _group_profile(group_id)
            system = await diy_persona(group_id, task_id)
            parts: list[str] = []
            async for piece in _stream_completion(
                group_id, text, [], profile,
                system=system,
                session_id=diy_session_id_for(group_id, user_id, task_id),
            ):
                parts.append(piece)
                await _push(user_id, {"type": "ws_stream",
                                      "data": {"group_id": group_id,
                                               "task_id": task_id, "delta": piece}})
            answer = "".join(parts).strip()
        except Exception:  # noqa: BLE001
            log.exception("工坊这一轮失败了 group=%s user=%s task=%s",
                          group_id, user_id, task_id)
            answer = ""
        finally:
            await _push(user_id, {"type": "ws_status",
                                  "data": {"group_id": group_id, "task_id": task_id,
                                           "state": "idle"}})

        if not answer:
            # ⚠️ **失败必须让人看见** ✓ —— 项目铁律（`orchestrator/__init__.py` 那句）。
            #    静默失败在这个架构里格外坏 ✓：用户不知道是"它还在想"还是"它挂了" ✓。
            answer = "（这一轮没跑通——看一眼 App 管家那边，或者再说一遍。）"
        row = await _save(group_id, user_id, task_id, "agent", answer)
        await _touch(task_id)
        await _push(user_id, {"type": "ws_message", "data": row})


class TaskSayIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


async def _assert_open(group_id: int) -> None:
    row = await fetch_one("SELECT workshop_enabled FROM groups WHERE id = ?", (group_id,))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"群 {group_id} 不存在")
    if not row.get("workshop_enabled"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "这个群的创意工坊关着")


# ── 接口 ────────────────────────────────────────────────────────────────

@router.get("/{group_id}/tasks")
async def tasks_list(group_id: int, user: dict = Depends(current_user)) -> dict:
    """我这些对话 ✓ + 默认该打开哪一条（**最近动过的那个** ✓）。

    ⚠️ **"上次那个"由服务端算** ✗→✓ —— 不放 localStorage ✓：
       壳里的存储会被清 ✓、换手机就没了 ✓，而这件事**本来就该跟着人走** ✓。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    items = await _my_tasks(group_id, user["id"])
    return {"tasks": items,
            "current": items[0]["id"] if items else None,
            "budget": await _unfixed_budget(group_id, user["id"]),
            "busy": _busy(group_id, user["id"])}


class TaskNewIn(BaseModel):
    #: 冲着哪个组件去的 ✓。空 = 做一个全新的 ✓（主行动：输入框 ＋ → 创意工坊 ✓）。
    slug: str = Field(default="", max_length=32)


@router.post("/{group_id}/tasks")
async def tasks_new(group_id: int, body: TaskNewIn | None = None,
                    user: dict = Depends(current_user)) -> dict:
    """开一条新的对话 ✓ —— 「未固化最多 3 个」就拦在这儿 ✓。

    ⚠️ **从「继续改」进来的（带了 slug）不走额度** ✓ —— 那是动一个**已经保留好**的
       组件 ✓，没在库里多出任何东西 ✓。额度管的是"半成品堆着不收拾" ✓，
       不该顺手把"改进已有的东西"也一起拦住 ✗。
       （只有那个 slug **已经保留过**才免额度 ✓ —— 拿一个不存在的 slug 来是绕不过的 ✓，
        它照样算一条半成品 ✓。）
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    want = (body.slug if body else "").strip().lower()
    if want and not _SLUG_OK.match(want):
        want = ""                       # 形状不对就当没给 ✓（不拦，当"做一个新的" ✓）
    continuing = bool(want) and want in await _kept_slugs(group_id)

    if not continuing:
        budget = await _unfixed_budget(group_id, user["id"])
        if budget["used"] >= budget["limit"]:
            held = []
            if budget["slugs"]:
                held.append("、".join(budget["slugs"]))
            if budget["unnamed"]:
                held.append(f"{budget['unnamed']} 条还没做成组件的对话")
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "已经有 " + str(budget["used"]) + " 个没固化的了（上限 "
                + str(budget["limit"]) + " 个）：" + "；".join(held)
                + "。**先保留一个，或者删掉一个** ✓ 再做新的 ✓。")
    ts = now()
    tid = await execute(
        "INSERT INTO workshop_tasks(group_id, user_id, created_at, updated_at, slug)"
        " VALUES(?,?,?,?,?)", (group_id, user["id"], ts, ts, want or None))
    log.info("工坊新任务：群 %s 用户 %s 任务 %s（冲着 %s）",
             group_id, user["id"], tid, want or "新组件")
    return {"ok": True, "task": await _task_payload(group_id, user["id"], tid),
            "messages": []}


@router.post("/{group_id}/tasks/{task_id}/open")
async def task_open(group_id: int, task_id: int,
                    user: dict = Depends(current_user)) -> dict:
    """**打开 / 切到这条** ✓ —— 打开的同时**掐掉上一条还在跑的** ✓（用户定的 ✓）。

    ⚠️ **打开同一条不算切换** ✓ —— 重复打开不该把自己正在跑的那轮掐掉 ✓
       （界面每次进这一屏都会调它 ✓，那是常态 ✓）。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    row = await _own_task(group_id, user["id"], task_id)
    running = _running.get((group_id, user["id"]))
    if running and running[0] != int(task_id):
        killed = await _abort(group_id, user["id"])
        if killed:
            log.info("工坊切换：群 %s 用户 %s 掐掉任务 %s，打开 %s",
                     group_id, user["id"], killed, task_id)
            await _save(group_id, user["id"], killed, "agent",
                        "（你切走了，这一轮掐掉了）")
    await _touch(row["id"])
    rows = await fetch_all(
        "SELECT id, sender_type, content, created_at FROM workshop_messages"
        " WHERE task_id = ? ORDER BY id ASC LIMIT 200", (int(task_id),))
    return {"ok": True, "task_id": int(task_id),
            "task": await _task_payload(group_id, user["id"], task_id),
            "messages": [dict(r) for r in rows],
            "busy": _busy(group_id, user["id"])}


@router.post("/{group_id}/tasks/{task_id}/chat")
async def task_say(group_id: int, task_id: int, body: TaskSayIn,
                   user: dict = Depends(current_user)) -> dict:
    """说一句。

    ⚠️ **立刻返回，正文走 WebSocket** ✗→✓ —— 一轮可能包含"问清细节 → 派子代理"，
       几十秒到几分钟 ✓。HTTP 里等它 = 客户端超时 ✓，而且中间看不到任何东西 ✓。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    row = await _own_task(group_id, user["id"], task_id)
    text = body.content.strip()

    # ⚠️ **同时只能做或改一个** ✗→✓ —— 用户 2026-10-07 定的 ✓。
    #
    # 判据是 `_running` 而不是锁 ✓（见文件头那段 ✓）：锁是被掐掉的那个协程
    # 退栈时才放的 ✓，中间那几毫秒拿它当判据就会误报"它手上还有活" ✓。
    #
    # ⚠️ 而且是**当场说清楚**，不是排队 ✗→✓ —— 排队的话用户看到的是
    #    "我说话了，它没理我" ✓，过一会儿它突然回一句**上一个**的答案 ✓。
    if _busy(group_id, user["id"]):
        return {"ok": False, "busy": True,
                "error": ("它手上还有一个在做（要么在问你，要么在等那个小助手写完）✓。"
                          "**等这一轮完了再说** ✓，或者切到别的对话去 ✓"
                          "（切走会把这一轮掐掉 ✓）。")}
    msg = await _save(group_id, user["id"], row["id"], "user", text)
    await _touch(row["id"])
    await _push(user["id"], {"type": "ws_message", "data": msg})

    key = (group_id, user["id"])
    task = asyncio.create_task(_run_turn(group_id, user["id"], row["id"], text))
    _running[key] = (int(row["id"]), task)

    def _done(t: asyncio.Task, _key: tuple[int, int] = key,
              _task: asyncio.Task = task) -> None:
        # 只摘自己那一条 ✓ —— 期间换过任务的话，`_running` 里已经是别人的了 ✓，
        # 这时候摘会把**新那条**误判成"没在跑" ✓。
        cur = _running.get(_key)
        if cur and cur[1] is _task:
            _running.pop(_key, None)

    task.add_done_callback(_done)
    return {"ok": True, "message": msg}


@router.delete("/{group_id}/tasks/{task_id}")
async def task_delete(group_id: int, task_id: int,
                      user: dict = Depends(current_user)) -> dict:
    """删掉这条对话 ✓ —— 未固化的腾额度就靠它 ✓。

    ⚠️ 正在跑的那条不许删 ✓ —— 删掉行之后它还在后台推消息 ✓，
       而 `workshop_messages` 的外键会把它写进一个不存在的任务里 ✓（或者直接报错 ✓）。
       要删先切走 ✓（切走就掐了 ✓）。
    ⚠️ 它做出来的**组件不跟着删** ✓ —— 那是另一件事 ✓（组件页上删 ✓，
       见 `main.py` 的 `component_delete` ✓）。这里只把链接松开 ✓。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    row = await _own_task(group_id, user["id"], task_id)
    running = _running.get((group_id, user["id"]))
    if running and running[0] == int(task_id) and not running[1].done():
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "这条正在做，删不了。先切到别的对话，再回来删。")
    await execute("DELETE FROM workshop_messages WHERE task_id = ?", (int(task_id),))
    await execute("UPDATE components SET task_id = NULL WHERE task_id = ?",
                  (int(task_id),))
    await execute("DELETE FROM workshop_tasks WHERE id = ?", (int(task_id),))
    log.info("工坊删任务：群 %s 用户 %s 任务 %s", group_id, user["id"], row["id"])
    return {"ok": True}
