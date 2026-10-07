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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from .auth import current_user, require_member
from .config import settings
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


# ⚠️ 这里原来有个 `_kept_slugs`（"这个群哪些组件已经保留"✓）——
#    2026-10-07 深夜**跟着"固化"整套一起删了** ✓（用户定的 ✓）。
#    留着它没用，而且会**误导**：以后谁看到它，会以为"保留"还是个概念 ✓。


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
        "SELECT t.id, t.created_at, t.updated_at, t.title AS my_title,"
        "       COALESCE(t.slug,"
        "         (SELECT c.slug FROM components c WHERE c.task_id = t.id"
        "           ORDER BY c.version DESC LIMIT 1)) AS slug,"
        "       (SELECT c.title FROM components c WHERE c.task_id = t.id"
        "         ORDER BY c.version DESC LIMIT 1) AS title"
        "  FROM workshop_tasks t"
        " WHERE t.group_id = ? AND t.user_id = ?"
        " ORDER BY t.updated_at DESC, t.id DESC",
        (group_id, user_id))
    # 每个 slug 现在的标题 —— 一次查完 ✓（对话一多，逐个查就是 N+1 ✓）
    titles: dict[str, str] = {}
    for v in await fetch_all(
            "SELECT slug, (SELECT title FROM components x WHERE x.group_id = c.group_id"
            "         AND x.slug = c.slug ORDER BY x.version DESC LIMIT 1) AS title"
            "  FROM components c WHERE group_id = ? GROUP BY slug", (group_id,)):
        titles[str(v["slug"])] = str(v["title"] or "")
    # ★ **每个组件有哪些人参与过**（2026-10-07 深夜 ✓）——
    #   也是**一次查完** ✓（见 `_participants` 那段 ✓）。
    who = await _participants_all(group_id)
    out: list[dict] = []
    for r in rows:
        slug = str(r["slug"] or "")
        out.append({"id": int(r["id"]),
                    "slug": slug,
                    # 名字的优先顺序 ✓（2026-10-07 晚上排过）：
                    #   ① 这条对话**自己做出来的那一版**叫什么 ✓
                    #   ② 它冲着去的那个组件**现在**叫什么 ✓（从「继续改」进来的 ✓）
                    #   ③ **用户开做时起的那个名字** ✓ —— 还没做成组件时，
                    #      导航上靠它才认得出来 ✓（不然是一排"还没起名" ✓）。
                    "title": str(r["title"] or titles.get(slug) or r["my_title"] or ""),
                    # ★ **谁参与过这个组件**（同一组件下的对话，不管是谁开的 ✓）——
                    #   导航上那一行右边就是这几个头像 ✓。
                    #   ⚠️ 按 **slug** 取，不按对话 ✓：这个组件的对话可能有好几条
                    #      （一人一条 ✓），而"参与构建的人"是整个组件的事 ✓。
                    "people": who.get(slug, []),
                    "busy": _busy_task(group_id, int(r["id"])),
                    "created_at": int(r["created_at"]),
                    "updated_at": int(r["updated_at"])})
    return out


async def _participants_all(group_id: int) -> dict[str, list[dict]]:
    """这个群里**每个组件分别有哪些人参与过** ✓ —— 一次查完 ✓。

    ⚠️ **判据是"有没有为它开过对话"** ✗→✓ —— 不是"有没有落成过一版" ✓。
       一个人跟你聊了半天、最后那版没落成 ✓ —— 他也是**参与过** ✓，
       把他漏掉的话，界面上会显示"这个组件只有一个人做的" ✓，
       而另一个人明明出了力 ✓（这种错很难被当成错，只会让人觉得"记错了" ✓）。
    """
    rows = await fetch_all(
        "SELECT DISTINCT t.slug, t.user_id,"
        "       COALESCE(gm.nickname, u.nickname) AS nickname, u.avatar"
        "  FROM workshop_tasks t"
        "  JOIN users u ON u.id = t.user_id"
        "  LEFT JOIN group_members gm ON gm.group_id = t.group_id"
        "       AND gm.user_id = t.user_id"
        " WHERE t.group_id = ? AND t.slug IS NOT NULL",
        (group_id,))
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r["slug"]), []).append(
            {"user_id": int(r["user_id"]), "nickname": str(r["nickname"] or ""),
             "avatar": str(r["avatar"] or "")})
    for v in out.values():
        v.sort(key=lambda x: x["user_id"])
    return out


def _busy_task(group_id: int, task_id: int) -> bool:
    """这一轮是不是**正在跑** ✓（内存里那张表，见 `_running` ✓）。"""
    for (gid, _uid), (tid, task) in _running.items():
        if gid == group_id and tid == task_id and not task.done():
            return True
    return False


async def _editing_map(group_id: int) -> dict[str, dict]:
    """**哪个组件正被人改着** ✓ —— 键是 slug，值是那个人 ✓。

    ⚠️ 这是**内存里的**（`_running`）不是库里的 ✗ —— 也**只能是内存里的** ✓：
       "正在改"就是"这个进程里有一条流还开着" ✓，服务一重启它当然就没了 ✓
       （那时候流也断了 ✓）。写进库里反而会留下**永远不会消的**"某某正在改" ✓。
    """
    out: dict[str, dict] = {}
    live = [(k, v) for k, v in _running.items()
            if k[0] == group_id and not v[1].done()]
    if not live:
        return out
    ids = [v[0] for _, v in live]
    q = ",".join("?" * len(ids))
    rows = await fetch_all(
        f"SELECT t.id, t.user_id, COALESCE(t.slug, '') AS slug,"
        f"       COALESCE(gm.nickname, u.nickname) AS nickname"
        f"  FROM workshop_tasks t"
        f"  JOIN users u ON u.id = t.user_id"
        f"  LEFT JOIN group_members gm ON gm.group_id = t.group_id"
        f"       AND gm.user_id = t.user_id"
        f" WHERE t.id IN ({q})", tuple(ids))
    for r in rows:
        slug = str(r["slug"] or "")
        if slug:
            out[slug] = {"user_id": int(r["user_id"]),
                         "nickname": str(r["nickname"] or "")}
    return out


async def _assistant(group_id: int) -> dict:
    """这个群的 **diy 小助手**叫什么、头像是什么 ✓。

    ⚠️ 和群管家**分开** ✓（见 `db.py` 那两列 ✓）：
       群聊里说话的是**管家** ✓，做组件时陪着聊的是 **diy 小助手** ✓。
    """
    row = await fetch_one(
        "SELECT diy_name, diy_avatar FROM groups WHERE id = ?", (group_id,))
    name = str((row or {}).get("diy_name") or "").strip() or "diy 小助手"
    rel = str((row or {}).get("diy_avatar") or "").strip()
    return {"name": name, "avatar": ("/ui/" + rel) if rel else ""}


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


# ── diy 小助手（头像 + 昵称）────────────────────────────────────────────
#
# ★ 2026-10-07 深夜用户定的：agent 在工坊里叫 **diy 小助手** ✓，
#   它的头像和昵称从**导航界面右上角**进去设置 ✓，**每个组件里通用** ✓
#   （就是这个群一份 ✓，不是每条对话一份 ✓）。
#
# ⚠️ **和群管家是两套** ✗ —— 群里说话的那个管家叫别的名字 ✓、头像是另一张 ✓。
#    共用一个的话，改这边会顺手改掉群聊里的 ✓ —— 而用户完全没料到 ✓。

_DIY_EXTS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_DIY_MAX = 2 * 1024 * 1024


class DiyAssistantIn(BaseModel):
    name: str = Field(min_length=1, max_length=24)


@router.get("/{group_id}/assistant")
async def assistant_get(group_id: int, user: dict = Depends(current_user)) -> dict:
    """这个小助手叫什么、头像是什么 ✓。"""
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    return await _assistant(group_id)


@router.patch("/{group_id}/assistant")
async def assistant_patch(group_id: int, body: DiyAssistantIn,
                          user: dict = Depends(current_user)) -> dict:
    """改昵称 ✓ —— **空名字不许** ✗（界面上得有个称呼 ✓）。"""
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    await execute("UPDATE groups SET diy_name = ? WHERE id = ?",
                  (body.name.strip(), group_id))
    log.info("diy 小助手改名：群 %s → %r（用户 %s）", group_id, body.name.strip(), user["id"])
    return await _assistant(group_id)


@router.post("/{group_id}/assistant-avatar")
async def assistant_avatar(group_id: int, file: UploadFile = File(...),
                           user: dict = Depends(current_user)) -> dict:
    """上传小助手的头像 ✓ —— 抄群管家那一套（同一棵树、同样的大小限制 ✓）。

    ⚠️ 文件名带 `diy-` 前缀 ✓ —— 和管家那张（`avatars/g<群>.png` ✓）**放在同一个目录** ✓。
       不加前缀的话，两个上传接口会**互相覆盖** ✓ ——
       改管家头像会把小助手的换掉 ✓，而两边看起来都"上传成功了" ✓。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    ctype = file.content_type or ""
    if ctype not in _DIY_EXTS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "只支持 png/jpg/webp")
    data = await file.read()
    if len(data) > _DIY_MAX:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "图片不能超过 2MB")
    if ctype == "image/jpeg" and not data.startswith(b"\xff\xd8"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不是有效的 JPEG")

    d = settings.ui_dir / "avatars"
    d.mkdir(parents=True, exist_ok=True)
    ext = _DIY_EXTS[ctype]
    d.joinpath(f"diy-g{group_id}.png").unlink(missing_ok=True)
    d.joinpath(f"diy-g{group_id}{ext}").write_bytes(data)
    # 版本号写进存的那串里 ✓ —— 和管家那张同一个理由（见 routes_groups 那段 ✓）：
    # 没有它浏览器会一直用旧的 ✓（换头像看着"没生效" ✓）。
    rel = f"avatars/diy-g{group_id}{ext}?v={int(now())}"
    await execute("UPDATE groups SET diy_avatar = ? WHERE id = ?", (rel, group_id))
    log.info("diy 小助手换头像：群 %s（用户 %s）", group_id, user["id"])
    return await _assistant(group_id)


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
    """我这些对话 ✓ + 默认该打开哪一条（**最近动过的那个** ✓）+ 助手信息 ✓。

    ⚠️ **"上次那个"由服务端算** ✗→✓ —— 不放 localStorage ✓：
       壳里的存储会被清 ✓、换手机就没了 ✓，而这件事**本来就该跟着人走** ✓。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    items = await _my_tasks(group_id, user["id"])
    return {"tasks": items,
            "current": items[0]["id"] if items else None,
            # ★ 导航那一屏右上角要画**小助手的头像** ✓（点进去是它的设置 ✓）——
            #   顺手带上，省一次往返 ✓。
            "assistant": await _assistant(group_id),
            # ★ **哪个组件正被人改着** ✓（用户定的：「如果有个组件某个用户正在创建
            #   和修改，需要在导航界面标注上」✓）。键是 slug ✓。
            "editing": await _editing_map(group_id),
            "busy": _busy(group_id, user["id"])}


class TaskNewIn(BaseModel):
    #: 冲着哪个组件去的 ✓。空 = 做一个全新的 ✓（主行动：输入框 ＋ → 创意工坊 ✓）。
    slug: str = Field(default="", max_length=32)
    #: ★ **用户给它起的名字** ✓（2026-10-07 晚上用户定的：点「新建组件」先提示命名 ✓）。
    #: ⚠️ 允许为空 ✓ —— "他懒得想名字"是完全正常的 ✓，
    #:    那种情况照旧由 agent 定名 ✓（别为了一个必填项把人挡在门外 ✓）。
    title: str = Field(default="", max_length=40)


@router.post("/{group_id}/tasks")
async def tasks_new(group_id: int, body: TaskNewIn | None = None,
                    user: dict = Depends(current_user)) -> dict:
    """开一条新的对话 ✓。

    ★ 2026-10-07 深夜：**这里原来有一道"未固化最多 3 个"的闸，撤了** ✗→✓ ——
      用户定了「组件聊天没有所谓的固化和非固化概念了，**只要新建了组件，
      就会进入一个对话**，无论是否真正创建了组件」✓。
      概念没了，那道闸就没法表达了 ✓（"未固化几个"这句话本身已经不成立 ✓）。
    """
    await require_member(group_id, user["id"])
    await _assert_open(group_id)
    want = (body.slug if body else "").strip().lower()
    if want and not _SLUG_OK.match(want):
        want = ""                       # 形状不对就当没给 ✓（不拦，当"做一个新的" ✓）
    ts = now()
    got = (body.title if body else "").strip()[:40] if body else ""
    tid = await execute(
        "INSERT INTO workshop_tasks(group_id, user_id, created_at, updated_at, slug, title)"
        " VALUES(?,?,?,?,?,?)",
        (group_id, user["id"], ts, ts, want or None, got or None))
    log.info("工坊新任务：群 %s 用户 %s 任务 %s（冲着 %s，叫 %r）",
             group_id, user["id"], tid, want or "新组件", got)
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
    # ★ **有人正在改这个组件吗** ✓（用户定的：「此时其他用户进入时会被提示」✓）——
    #   ⚠️ 只提示**别人** ✓：自己那条正在跑是**正常状态** ✓
    #      （界面上那个转圈就是它 ✓），再弹一句"你正在改"只会让人莫名其妙 ✓。
    slug = str(row.get("slug") or "")
    editing = (await _editing_map(group_id)).get(slug) if slug else None
    if editing and int(editing["user_id"]) == int(user["id"]):
        editing = None
    return {"ok": True, "task_id": int(task_id),
            "task": await _task_payload(group_id, user["id"], task_id),
            "messages": [dict(r) for r in rows],
            "editing": editing,
            "assistant": await _assistant(group_id),
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
