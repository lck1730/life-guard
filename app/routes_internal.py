"""内部接口 —— 供 Hermes 插件调用。

| 能力 | 接口 | 谁定 |
|---|---|---|
| 读写**结构化记录**（记账及以后的各类） | `/records/*` | 表在我们这，类型由它定义 |
| **主动往群里说话** | `/say` | 它想说什么它定，**频率上限我们定** |
| 设提醒 | `/reminders/*` | 由我们持有并触发（不用 Hermes cron） |
| **看图** | `/image` | 我们只给本地路径，看是它自己的事 |

**"有没有新消息"不在这里。** 早先有个 `/new_messages` 给 `check_new_messages`
工具用，让它自己来问——那是"拉"：查不查由它决定（**会漏**），而且它有一半时候
查出来是空的（**白花一整次往返**）。现在复审改成由编排层在轮次结束时**主动推**
回去，见 `orchestrator/agent.py` 的 run_turn。

**安全**：这些接口能直接写业务库、还能以 agent 身份往群里发消息，所以必须鉴权：
需要 `X-Internal-Token`，值等于配置里的 `LG_INTERNAL_TOKEN`；
**未配置 token 时整个路由组拒绝服务（fail closed）**，而不是放行。
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from .config import settings
from . import records as rec
from . import reminders as rem
from .auth import PREVIEW_SCOPE, make_token
from .config import settings
from .db import fetch_all, fetch_one, now
from .messages import create_message

log = logging.getLogger("lifeguard.internal")
router = APIRouter(prefix="/api/internal/tools", tags=["internal"])


async def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    if not settings.internal_tools_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "内部工具接口未启用")
    # 定长比较，避免时序侧信道
    if not hmac.compare_digest(x_internal_token, settings.internal_token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "内部凭证无效")


async def _assert_group(group_id: int) -> None:
    if not await fetch_one("SELECT id FROM groups WHERE id = ?", (group_id,)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"群 {group_id} 不存在")


# ── 结构化记录 ────────────────────────────────────────────────────────

class RecordAddIn(BaseModel):
    group_id: int
    kind: str
    fields: dict[str, Any]
    created_by: int | None = None


@router.post("/records/add", dependencies=[Depends(require_internal_token)])
async def records_add(body: RecordAddIn) -> dict:
    await _assert_group(body.group_id)
    record, err = await rec.add(body.group_id, body.kind, body.fields, body.created_by)
    if err:
        # **错误串是要给模型看的**，所以原样返回而不是 400。
        # 抛 HTTP 错误的话工具那边只会拿到"后端返回 400"，模型看到的是一句
        # 它既看不懂也修不了的话——它接下来就会开始乱试别的工具（踩过）。
        return {"ok": False, "error": err}
    return {"ok": True, "record": record}


class RecordUpdateIn(BaseModel):
    group_id: int
    record_id: int
    fields: dict[str, Any]


@router.post("/records/update", dependencies=[Depends(require_internal_token)])
async def records_update(body: RecordUpdateIn) -> dict:
    await _assert_group(body.group_id)
    row, err = await rec.update(body.group_id, body.record_id, body.fields)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True, "record": row}


class RecordIdIn(BaseModel):
    group_id: int
    record_id: int


@router.post("/records/delete", dependencies=[Depends(require_internal_token)])
async def records_delete(body: RecordIdIn) -> dict:
    await _assert_group(body.group_id)
    row, err = await rec.delete(body.group_id, body.record_id)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True, "record": row,
            "note": "删掉了（**只是标记为删，行还在**——账不能无声消失）。"
                    "删错了就调 record_restore 恢复。"}


@router.post("/records/restore", dependencies=[Depends(require_internal_token)])
async def records_restore(body: RecordIdIn) -> dict:
    await _assert_group(body.group_id)
    row, err = await rec.restore(body.group_id, body.record_id)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True, "record": row}


class RecordQueryIn(BaseModel):
    group_id: int
    kind: str
    since: int | None = None
    days: int | None = None
    limit: int = Field(default=100, ge=1, le=500)
    # 查"这条去哪了"时才打开——平时默认不看软删除的
    include_deleted: bool = False


@router.post("/records/query", dependencies=[Depends(require_internal_token)])
async def records_query(body: RecordQueryIn) -> dict:
    await _assert_group(body.group_id)
    since = body.since
    if since is None and body.days:
        since = now() - int(body.days) * 86400
    data = await rec.query(body.group_id, body.kind, since=since, limit=body.limit,
                           include_deleted=body.include_deleted)
    return {"ok": True, **data}


class KindListIn(BaseModel):
    group_id: int


@router.post("/records/kinds", dependencies=[Depends(require_internal_token)])
async def records_kinds(body: KindListIn) -> dict:
    await _assert_group(body.group_id)
    return {"ok": True, "kinds": await rec.list_kinds(body.group_id)}


class KindDefineIn(BaseModel):
    group_id: int
    kind: str
    schema_: dict[str, Any] = Field(alias="schema")

    model_config = {"populate_by_name": True}


@router.post("/records/define", dependencies=[Depends(require_internal_token)])
async def records_define(body: KindDefineIn) -> dict:
    await _assert_group(body.group_id)
    err = await rec.define_kind(body.group_id, body.kind, body.schema_)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True, "kind": body.kind}


# ── 主动往群里说话 ────────────────────────────────────────────────────
#
# 这条接口让 agent 能**绕过编排层**直接发消息。自主权明显变大，
# 所以频率上限必须由我们卡死——不能靠它自觉（"少用"写在 SOUL.md 里是引导，
# 不是保证）。
_say_log: dict[int, list[float]] = {}


class SayIn(BaseModel):
    group_id: int
    text: str = Field(min_length=1, max_length=2000)


@router.post("/say", dependencies=[Depends(require_internal_token)])
async def say(body: SayIn) -> dict:
    await _assert_group(body.group_id)
    gid, text = body.group_id, body.text.strip()

    # 熔断：一小时最多 N 条主动发言。**这是安全，不是品味**——
    # 它不评判"该不该冒泡"，只拦"冒泡得不对劲"（循环、跑飞）。
    window = _say_log.setdefault(gid, [])
    cutoff = time.time() - 3600
    window[:] = [t for t in window if t > cutoff]
    if len(window) >= settings.proactive_say_per_hour:
        log.warning("group=%s 主动发言达到上限（%d/小时），拦下：%s",
                    gid, settings.proactive_say_per_hour, text[:40])
        return {"ok": False,
                "error": (f"这一小时你已经主动说了 {len(window)} 次，到上限了。"
                          f"这条没发出去。除非是用户明确在等你回，否则先别急着冒泡。")}
    window.append(time.time())

    msg = await create_message(
        group_id=gid, sender_id=None, sender_type="agent", msg_type="text", content=text,
    )
    log.info("group=%s 主动发言：%s", gid, text[:60])
    return {"ok": True, "message_id": msg["id"]}


# ── 提醒 ──────────────────────────────────────────────────────────────

class ReminderAddIn(BaseModel):
    group_id: int
    text: str = Field(min_length=1, max_length=500)
    fire_at: int | None = None          # unix 秒
    in_minutes: int | None = None       # 或"多少分钟后"
    hour: int | None = Field(default=None, ge=0, le=23)   # 或"每天几点"（配 repeat_daily）
    minute: int = Field(default=0, ge=0, le=59)
    repeat_daily: bool = False


@router.post("/reminders/add", dependencies=[Depends(require_internal_token)])
async def reminders_add(body: ReminderAddIn) -> dict:
    await _assert_group(body.group_id)
    fire_at = body.fire_at
    if fire_at is None and body.in_minutes is not None:
        fire_at = now() + int(body.in_minutes) * 60
    if fire_at is None and body.hour is not None:
        # 按服务器本地时区的今天/明天那个点（服务器在北京时区，和用户一致）
        lt = time.localtime()
        target = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday,
                              body.hour, body.minute, 0, 0, 0, -1))
        if target <= now():
            target += 86400
        fire_at = int(target)
    if fire_at is None:
        return {"ok": False, "error": "要给个时间：fire_at（unix 秒）、in_minutes（几分钟后）、"
                                      "或者 hour+minute（几点，配 repeat_daily 就是每天）。"}
    rid = await rem.add(body.group_id, body.text, int(fire_at), repeat_daily=body.repeat_daily)
    return {"ok": True, "id": rid, "fire_at": int(fire_at),
            "when": time.strftime("%Y-%m-%d %H:%M", time.localtime(int(fire_at)))}


class ReminderListIn(BaseModel):
    group_id: int


@router.post("/reminders/list", dependencies=[Depends(require_internal_token)])
async def reminders_list(body: ReminderListIn) -> dict:
    await _assert_group(body.group_id)
    rows = await rem.list_for(body.group_id)
    for r in rows:
        r["when"] = time.strftime("%Y-%m-%d %H:%M", time.localtime(r["fire_at"]))
    return {"ok": True, "reminders": rows}


class ReminderCancelIn(BaseModel):
    group_id: int
    reminder_id: int


@router.post("/reminders/cancel", dependencies=[Depends(require_internal_token)])
async def reminders_cancel(body: ReminderCancelIn) -> dict:
    await _assert_group(body.group_id)
    ok = await rem.cancel(body.group_id, body.reminder_id)
    return {"ok": ok} if ok else {"ok": False, "error": f"没有 id={body.reminder_id} 的提醒"}


# ── 界面外观（agent 自己的地盘）────────────────────────────────────────
#
# **为什么给工具，而不是只告诉它「ui/theme.css 归你」——实测失败过。**
#
# 说了之后它仍然跑去改 `index.html`（配色变量确实定义在那儿），30 个工具回合
# 折腾完也没干成。因为它"想改外观"时的第一反应是"找到那个文件、改掉它"，
# 而不是"写一个覆盖文件让界面去读"。
#
# ➜ **给一个名字就是这个动作的工具，它就不用猜了。**
#   这是一条通用的经验：**「告诉它可以做」不如「给它一个叫这个动作的工具」。**
#
# **写的是 theme.css，不是 index.html。** 壳里存着登录凭证，改它等于能读走账号；
# 而这个覆盖文件只进 CSS，CSS 读不到任何东西，所以随便它写。
# 「删掉就回默认」这条也由工具兜住（clear_app_theme），它自己就能自愈。

class ThemeIn(BaseModel):
    group_id: int
    css: str = Field(min_length=1, max_length=200_000)


@router.post("/theme/set", dependencies=[Depends(require_internal_token)])
async def theme_set(body: ThemeIn) -> dict:
    await _assert_group(body.group_id)
    path = settings.theme_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.css, encoding="utf-8")
    log.info("group=%s 改了外观（%d 字节）", body.group_id, len(body.css))
    return {
        "ok": True, "bytes": len(body.css),
        "note": "已生效——让用户重开 App 就能看到。不满意随时再调；想回默认就调 clear_app_theme。",
    }


@router.post("/theme/clear", dependencies=[Depends(require_internal_token)])
async def theme_clear(body: KindListIn) -> dict:
    await _assert_group(body.group_id)
    settings.theme_path.unlink(missing_ok=True)
    log.info("group=%s 把外观恢复默认了", body.group_id)
    return {"ok": True, "note": "外观已回到默认。"}


# ── 前端脚本（agent 的地盘，2026-10-04 开的）──────────────────────────
#
# **为什么现在才敢开**：登录凭证已经从页面的 localStorage 搬进了 httpOnly
# Cookie（`auth.py` 的 SESSION_COOKIE）。页面上任何一段 JS —— 包括下面这个
# `ui/app.js` —— **都读不到令牌**。在那之前，"让它写前端"就等于"让它能偷
# 你们的登录态"，所以只敢让它写 CSS。
#
# 界面钩子（`window.LifeGuard`）在 `static/index.html` 末尾定义。它读得到那个
# 文件（root 只读），所以它**能自己去看有哪些钩子**——这正是"读得到"的意义。
#
# **改坏了怎么办**：调 `/script/clear` 删掉，界面立刻回到原样，不用重新部署。

class ScriptIn(BaseModel):
    group_id: int
    js: str = Field(min_length=1, max_length=200_000)


@router.post("/script/set", dependencies=[Depends(require_internal_token)])
async def script_set(body: ScriptIn) -> dict:
    await _assert_group(body.group_id)
    path = settings.script_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.js, encoding="utf-8")
    log.info("group=%s 写了前端脚本（%d 字节）", body.group_id, len(body.js))
    return {
        "ok": True, "bytes": len(body.js),
        "note": ("已生效——让用户重开 App 就能看到。**你自己是看不见效果的**"
                 "（你不在那个页面上），所以不确定的地方要跟用户确认，"
                 "或者让用户描述他看到的现象。想撤掉就调 clear_app_script。"),
    }


@router.post("/script/clear", dependencies=[Depends(require_internal_token)])
async def script_clear(body: KindListIn) -> dict:
    await _assert_group(body.group_id)
    settings.script_path.unlink(missing_ok=True)
    log.info("group=%s 把前端脚本撤了", body.group_id)
    return {"ok": True, "note": "已撤掉，界面回到原样。"}


# ── 改后端代码（agent 的地盘，2026-10-04 开的）────────────────────────
#
# ## 方针
#
# 用户 2026-10-04 重新划了线：**只守"链路"，不守文件。**
# 他要的不是"代码别被改"，而是"**我永远还能联系上它**"。
# 所以后端代码现在归它、它想改就改——**只要改完服务还能起来**。
#
# ## 护栏：重启前必须自检
#
# 这一条是整个放开动作的**承重墙**：
# 语法/导入过不了就**不重启**，老进程继续跑着服务。
# 于是"它改崩了"最坏也只是"改了不生效"，而**不是"联系不上了"**。
# 起不来的话它连报错都拿不到（服务没了，工具也没了），只能靠对讲机。
# 有了这道闸，那种情况基本不会发生。
#
# ## 回滚
#
# `/opt/lifeguard` 是 git 仓库（见 tools/deploy-talk.sh 旁边那份说明）。
# 改之前 `snapshot`、改坏了 `rollback`，都是它的工具。

APP_ROOT = Path(__file__).resolve().parent.parent
# ⚠️ **下面这两条原来指的是旧后端的家** ✗→✓ —— 2026-10-07：
#   `APP_ROOT/.venv` 和 `APP_ROOT/lifeguard.log` 在这个服务里**都不存在** ✓，
#   而它们从不报错、只是**默默地什么都不做** ✗：
#     · venv 不对 → 重启前那三道自检**跑不起来** → 一律拒绝重启 ✗（看着像"代码有问题"✓）
#     · 日志不对 → 「第一件该做的事是看日志」变成永远回一句"没有日志文件" ✗
#   所以它们现在从 `config.py` 读 ✓ —— 那个文件里写着来历 ✓。
VENV_PY = Path(settings.venv_python)
LOG_FILE = Path(settings.log_file)


def _run(args: list[str], timeout: int = 120) -> tuple[int, str]:
    p = subprocess.run(args, cwd=str(APP_ROOT), capture_output=True,
                       text=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr)


def _git(args: list[str], timeout: int = 60) -> tuple[int, str]:
    """跑一条 git 命令 —— **永远带上 `safe.directory`**（2026-10-07 修）。

    为什么非带不可：这个仓库现在归 `lifeguard`（agent），
    而**服务自己**跑在另一个用户下 -> git 认为"这不是我的仓库"，
    每条命令都 `fatal: detected dubious ownership`。

    实测出来的后果很阴：`snapshot` 好歹回了 `{"ok": false}`，
    而 `restart` 那条路把这段错误**当成"存好了"**塞进 note 里，
    然后**照常重启了** —— 也就是"没存就重启"，
    恰恰是这张网最该拦住的场景。
    """
    # ⚠️ **这里是 `_run`，不是 `_git`** ✗→✓ —— 2026-10-07：
    #   我加这个帮手时用一条正则替换"所有 `_run(["git", …`" ✓，
    #   而**这一行本身**也长那样 ✗ → 它被替换成了它自己 ✓ →
    #   **无限递归** ✗（`RecursionError`，接口回 500 ✓）。
    #   静态检查一条都拦不住 ✗：语法对 ✓、名字都有定义 ✓、import 也都在 ✓
    #   —— 只有真跑一遍才看得见 ✓。
    return _run(["git", "-c", f"safe.directory={APP_ROOT}", *args], timeout=timeout)


# 重启**排队**，不是立刻。
#
# ## 为什么不能立刻
#
# `restart_backend` 是 agent 在**一轮对话中间**调的。而那一轮正是后端自己
# 在跑、通过 SSE 从 Hermes 读回复的那一轮。立刻 `os._exit(0)` 的结果是：
#
#   后端重启 → 后端和 Hermes 之间那条流断掉 → Hermes 判定 sse_client_disconnected
#   → **整轮 interrupted** → 用户 @ 它的话，一个字都没回，而且没有任何提示。
#
# 2026-10-04 实测就是这么翻的车（用户在群里连问两句都没回应，
# 它对讲机里却好好的——因为对讲机不经这条流）。
#
# ## 所以
#
# 先自检（过不了直接拒绝），过了就**排上队**；等没有轮次在跑的时候才真重启。
# 于是它这一轮能把话说完、回复正常发到群里，然后服务再重启。
_restart_wanted = False
_restart_requested_at = 0.0
_RESTART_MAX_WAIT = 300.0   # 万一某轮卡死，最多等 5 分钟，不能永远不重启


def _request_restart() -> None:
    global _restart_wanted, _restart_requested_at
    if not _restart_wanted:
        _restart_requested_at = time.time()
    _restart_wanted = True


# ★ **问 Hermes 有没有人在跑，而不是问自己。**（2026-10-06 加）
#
# `orchestrator.turns_in_flight()` 是**进程内存里**的数 ✗ —— 后端一重启就归零 ✓。
# 而"重启"恰恰是这个守卫要拦的事 ✗，于是：
#
#   2026-10-06 实测 —— 我部署时重启了后端 → 计数器归零 ✓ →
#   随后 agent 自己调的 restart_backend 就被**放行** ✗ →
#   把它**正在跑的那一轮**掐死 ✗
#   （回复 18:38:22 才生成，可那条 SSE 18:38:03 就断了，没人听 ✗）
#
# Hermes 把"谁正持有这个会话"写在它自己的 state.db（`session_turn_leases`）✓ ——
# 那是**跨进程**的事实 ✓，后端重启也不会消失 ✓。所以它才是可靠的那把尺子。
def _hermes_turn_holder() -> str | None:
    """Hermes 那边还有会话在跑吗？有就返回一句人话，没有返回 None。

    ⚠️ **读不了就当"没有"** ✓ —— 超时上限（`_RESTART_MAX_WAIT`）还在兜底 ✓，
    绝不能让"查不动"变成"永远不重启" ✗（那就比原问题更糟了）。
    """
    import sqlite3

    now_ = time.time()
    home = Path(settings.hermes_home)
    dbs = [home / "state.db", *sorted(home.glob("profiles/*/state.db"))]
    for db in dbs:
        if not db.exists():
            continue
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2.0)
            try:
                n = conn.execute(
                    "SELECT COUNT(*) FROM session_turn_leases WHERE expires_at > ?",
                    (now_,),
                ).fetchone()[0]
            finally:
                conn.close()
        except Exception:  # noqa: BLE001
            log.warning("读不了 %s 的会话租约，这一轮当它空闲", db, exc_info=True)
            continue
        if n:
            return f"Hermes 上还有 {n} 个会话在跑（{db.parent.name}）"
    return None


async def restart_watcher() -> None:
    """后台小循环：没人在跑就把进程交出去，systemd（Restart=always）拉起来。

    ⚠️ 这里用**轮询**而不是 `loop.call_later`：重启要等的是一个会变化的条件
    （还有没有轮次在跑），不是一段固定时间。
    （另：早先用 `asyncio.create_task` 定时那个写法**被 GC 掉过**——
      接口照常回"正在重启"、PID 却一动不动。那种假成功最难查。）
    """
    from . import orchestrator  # 延迟导入，免得和主模块绕成环

    while True:
        await asyncio.sleep(2.0)
        if not _restart_wanted:
            continue
        # 两个来源都要看：本地计数器（后端自己发起的轮次）+ Hermes 的租约
        # （跨进程，重启也不会丢）。见上面 _hermes_turn_holder 那段。
        holder = _hermes_turn_holder()
        idle = orchestrator.turns_in_flight() == 0 and holder is None
        overdue = (time.time() - _restart_requested_at) > _RESTART_MAX_WAIT
        if idle or overdue:
            await asyncio.sleep(0.8)   # 让最后那句话先发出去
            log.warning("按 agent 的要求重启后端（%s）",
                        "已经没人在跑了" if idle
                        else f"等超时了，不再等（{holder or '本地还有轮次在跑'}）")
            os._exit(0)


def _preflight() -> str | None:
    """过不了就返回**给它看的错误原文**，过得了返回 None。

    三道：先语法（快），再真 import 一遍（语法过了不代表 import 得动——
    少个模块、循环导入、名字写错，都只有 import 才暴露），
    最后查"调用的名字/导入的名字到底存不存在"。

    ## ★ 第三道是 2026-10-06 的事故之后补的

    agent 在 `orchestrator/agent.py` 里写了：

        from ..db import fetch_sync      ← 这个函数**不存在**（我们的 db 是异步的）
        await _idle_status(group_id)     ← 这个函数**从没定义过**

    而那个 import 写在**函数里面** → 模块导入时根本不执行它 →
    于是：语法过 ✓、`import app.main` 过 ✓、**服务正常起来了** ✓
    —— 可**每一轮跑到那儿就炸** ✗。从 01:31 瘫到 10:30，
    用户看到的是「一直在思考中」，而群里**一点痕迹都没有** ✗。

    **教训**：「起得来」和「能干活」是两回事 ✗ ——
    前两道只保证前者，第三道才碰得到后者。
    （这也是那个"假成功"的老毛病：接口回得好好的，实际什么也没发生。）
    见 `app/preflight.py` 的说明与边界。
    """
    rc, out = _run([str(VENV_PY), "-m", "compileall", "-q", "app"], timeout=60)
    if rc != 0:
        return "**语法没过**，没重启（老代码还在跑）：\n```\n" + out[-1500:] + "\n```"
    rc, out = _run([str(VENV_PY), "-c", "import app.main"], timeout=120)
    if rc != 0:
        return "**语法过了但导入失败**（少了模块？名字写错？循环导入？），没重启：\n```\n" + out[-1500:] + "\n```"
    rc, out = _run([str(VENV_PY), "-m", "app.preflight"], timeout=120)
    if rc != 0:
        return ("**静态检查没过**——有名字或 import 指向不存在的东西"
                "（前两道**看不见**这一类，见上面那段），没重启：\n```\n"
                + out[-2000:] + "\n```")
    return None


class LogsIn(BaseModel):
    lines: int = Field(default=80, ge=1, le=2000)


@router.post("/app/logs", dependencies=[Depends(require_internal_token)])
async def app_logs(body: LogsIn) -> dict:
    """看后端自己的日志——改崩了以后第一件该做的事。"""
    if not LOG_FILE.exists():
        return {"ok": False, "error": f"没有日志文件 {LOG_FILE}"}
    text = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    tail = "\n".join(text[-body.lines:])
    # 顺带把进程状态也给它，省一次往返
    alive = "未知"
    try:
        # ⚠️ 服务名是 `lifeguard-chat` ✓，不是 `lifeguard` ✗（那是旧后端 ✓）——
        #   写错了不报错，只是状态永远显示"未知" ✓。
        p = subprocess.run(["systemctl", "is-active", settings.service_name],
                           capture_output=True, text=True, timeout=10)
        alive = p.stdout.strip()
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "service": alive, "lines": len(text), "tail": tail}


class SnapshotIn(BaseModel):
    note: str = Field(default="", max_length=200)


@router.post("/app/snapshot", dependencies=[Depends(require_internal_token)])
async def app_snapshot(body: SnapshotIn) -> dict:
    """**动手改代码之前先存一档。** 改坏了就靠它回去。"""
    _git(["add", "-A"], timeout=60)
    rc, out = _git(["commit", "-q", "-m", body.note or "agent 改动"], timeout=60)
    _, head = _git(["log", "--oneline", "-1"], timeout=30)
    if rc != 0 and "nothing to commit" not in out:
        return {"ok": False, "error": out[-600:]}
    return {"ok": True, "commit": head.strip(),
            "note": "存好了。接下来放心改，改坏了用 rollback_app 回到这一档。"}


def _autocommit(note: str) -> tuple[str | None, str | None]:
    """把当前改动存一档 —— **返回 `(commit, 出错原因)`** （2026-10-07 改）。

    ⚠️ 原来它只返回一个字符串，而 git 失败时 `git log --oneline -1`
    **也会失败** -> 返回的是**那段报错文字** -> 被当成"存好的 commit 号"
    塞进重启的说明里 -> **"没存就重启"**。
    而这恰恰是这张网最该拦住的事：那个 SOUL 敢说"放手改、改坏了能退回来"，
    靠的就是"每次重启前都存了一档"。
    

    **为什么必须自动做，而不是让它调 `snapshot_app`**：
    实测。它写完那个 ↻ 按钮，`git status` 里明明白白一个 ` M ui/app.js`
    ——**它没存**。而"改之前先存一档"这条写在 SOUL.md 里，属于**请求**，
    不是**保证**。我们自己的教训就是这么来的（见 [[lifeguard-publish-once-design]]）：
    **能做成动作的，别指望提示词。**

    接到"重启"这个动作上是最省事的位置：它每改完一轮代码总要重启一次才能生效。
    """
    _git(["add", "-A"], timeout=60)
    msg = (note or "").strip() or "agent 改动（没说明改了什么）"
    rc, out = _git(["commit", "-q", "-m", msg], timeout=60)
    if rc != 0 and "nothing to commit" not in out:
        return None, " ".join(out.strip().split())[-300:]
    _, head = _git(["log", "--oneline", "-1"], timeout=30)
    h = head.strip()
    # ⚠️ 还要再确认它**长得像个 commit** —— 上面那条失败路径就是这么漏过去的
    #   （`git log` 的报错也是"一行文字"）。
    return (h.split()[0] if h and not h.startswith("fatal") else None), None


class RestartIn(BaseModel):
    note: str = Field(default="", max_length=200)


@router.post("/app/restart", dependencies=[Depends(require_internal_token)])
async def app_restart(body: RestartIn) -> dict:
    """**先存档，再自检，过了才重启。** 见文件头那段说明——这是承重墙。"""
    commit, save_err = _autocommit(body.note)
    if commit:
        log.info("重启前自动存了一档：%s", commit)
    elif save_err:
        # **要说出来**：没存上就等于这张网这一轮是空的。
        # （不拦着重启：真拦住的话，git 一出毛病整个服务就再也重启不了了，
        #   而"它正在修的就是 git"这种情形完全可能。）
        log.warning("重启前没存上档：%s", save_err)

    err = _preflight()
    if err:
        log.warning("agent 要重启，但自检没过，拒绝：%s", err[:200])
        return {"ok": False, "error": err,
                "saved": commit,
                "save_error": save_err,
                "note": "**服务没重启，还在用老代码正常跑着**（所以你现在还能跟我说话）。"
                        + (f"改动已经自动存成一档了（`{commit}`），就算没改对也没丢。"
                           if commit else
                           (f"⚠️ **这一档没存上**：{save_err}"
                            if save_err else "（这次没有代码改动要存。）"))
                        + "按上面的错误改掉，再调一次。"}

    _request_restart()
    return {"ok": True,
            "saved": commit,
            "save_error": save_err,
            "note": "自检通过，**已安排重启**：等这一轮把话说完就重启"
                    "（这样不会把你自己正在说的这句话掐掉）。"
                    "过一会儿再确认它活了就行。"
                    + (f"这次改动已存为 `{commit}`。" if commit else
                       (f"⚠️ **这一档没存上**（{save_err}）—— 重启前先把它修好，"
                        "不然改坏了没有回头路。" if save_err
                        else "（这次没有代码改动要存。）"))}


# ── 壳的回头路 ────────────────────────────────────────────────────────
#
# `static/index.html` 是**唯一"改坏了 App 就打不开"的地方**。别的层出问题你还能
# 进去用，壳出问题等于门从里面锁上了——你只能走对讲机喊话。
#
# 所以给它一条**最短的回头路**：不用翻 git 历史、不用想 commit 号，
# 一个动作回到"上一次动它之前"。
#
# 为什么不需要另做备份机制：`restart_backend` 每轮都会自动存一档
# （见 `_autocommit`），所以壳的每一版**本来就在历史里**。
# 这里只是替它走一遍 `git log` + `git checkout`——
# 把"知道该敲什么命令"这件事从它脑子里挪到工具上。
#
# （原本想的是"页面心跳断了就自动回滚"。那个太绕：要点火、要计时、
#   还得赌用户在那个窗口里开了 App。而真正需要的只是"一个能回到上一版的按钮"，
#   反正用户已经在用对讲机喊它了。）

SHELL_PATH = "app/static/index.html"


class ShellRestoreIn(BaseModel):
    steps: int = Field(default=1, ge=1, le=20)


@router.post("/shell/restore", dependencies=[Depends(require_internal_token)])
async def shell_restore(body: ShellRestoreIn) -> dict:
    # 先把"现在这个（大概已经崩了的）状态"存一档。
    # 不是舍不得——是万一它其实改对了一半，用户还想找回来看看。
    if _git(["status", "--porcelain", "--", SHELL_PATH], timeout=30)[1].strip():
        _autocommit("壳改崩的那一版（自动留档）")

    _, out = _git(["log", "--format=%h %ad %s", "--date=format:%m-%d %H:%M",
                   "-10", "--", SHELL_PATH], timeout=30)
    commits = [l for l in out.strip().splitlines() if l.strip()]
    if len(commits) <= body.steps:
        return {"ok": False,
                "error": f"`{SHELL_PATH}` 的历史只有 {len(commits)} 档，退不了 {body.steps} 步。",
                "history": "\n".join(commits)}
    target_line = commits[body.steps]
    target = target_line.split()[0]
    rc, err = _git(["checkout", target, "--", SHELL_PATH], timeout=60)
    if rc != 0:
        return {"ok": False, "error": f"退回失败：{err[-400:]}"}
    log.warning("壳被退回 %s（%s）", target, target_line)
    return {
        "ok": True,
        "restored": target_line,
        "history": "\n".join(commits[:6]),
        "note": "壳退回去了。**让用户重开一次 App**。"
                "还不满意就再调一次（再往前退一版）；想退回整份代码就 rollback_app。",
    }


class RollbackIn(BaseModel):
    commit: str = Field(default="", max_length=80)


@router.post("/app/rollback", dependencies=[Depends(require_internal_token)])
async def app_rollback(body: RollbackIn) -> dict:
    """回到某一档。**不传 commit 就先把它列出来**（免得瞎猜）。"""
    if not body.commit.strip():
        _, out = _git(["log", "--oneline", "-15"], timeout=30)
        return {"ok": True, "commits": out.strip(),
                "note": "把要回到的那一档的 commit 传进来（用短 hash 就行）。"}
    ref = body.commit.strip()
    rc, out = _git(["checkout", ref, "--", "."], timeout=60)
    if rc != 0:
        return {"ok": False, "error": f"回滚失败：{out[-600:]}"}
    err = _preflight()
    if err:
        return {"ok": False,
                "error": f"已经回到 {ref}，但**那一档自检也没过**，所以没重启：\n{err}",
                "note": "再往前找一档（rollback_app 不传参可以列出来）。"}
    _request_restart()
    return {"ok": True, "commit": ref,
            "note": f"已回到 {ref}，自检通过，**已安排重启**（等这一轮说完话）。"}


# ── 看图 ──────────────────────────────────────────────────────────────
#
# 图片**本来就持久化着**（`data/media/` 按日期分目录，消息上有 media_path），
# 缺的从来不是存储，而是"给它一个按 id 取用的入口"：
# Hermes 不把图片存进会话历史，所以过了那一轮它就再也看不见了——
# 用户之后聊到那张图，它只能反问「那刚才那张图拍的是啥」（实测就这么翻车过）。
#
# 这里只回**本地绝对路径**，不代它去看。看是它自己的事：把路径传给 Hermes 的
# `vision_analyze`，那个工具走的是"原生"通道，能让它**真的看见**图，
# 比我们代它生成一段描述强得多（描述是有损的，而且它想问什么我们猜不到）。

class ImageIn(BaseModel):
    group_id: int
    message_id: int


@router.post("/image", dependencies=[Depends(require_internal_token)])
async def image_path(body: ImageIn) -> dict:
    await _assert_group(body.group_id)
    row = await fetch_one(
        """SELECT m.id, m.msg_type, m.media_path, m.created_at,
                  COALESCE(gm.nickname, u.nickname) AS sender_nickname
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
           LEFT JOIN group_members gm
                  ON gm.group_id = m.group_id AND gm.user_id = m.sender_id
           WHERE m.id = ? AND m.group_id = ?""",
        (body.message_id, body.group_id),
    )
    if not row:
        return {"ok": False, "error": f"这个群里没有 id={body.message_id} 的消息"}
    if row["msg_type"] != "image" or not row["media_path"]:
        return {"ok": False,
                "error": f"#{body.message_id} 是一条 {row['msg_type']} 消息，不是图片"}

    # 只允许访问媒体目录内的路径。media_path 是我们自己写进去的，但
    # 这道检查很便宜，而一旦被绕过就是任意文件读取。
    full = (settings.media_dir / row["media_path"]).resolve()
    if not str(full).startswith(str(settings.media_dir.resolve())):
        log.error("media_path 越界：%r", row["media_path"])
        return {"ok": False, "error": "文件路径异常"}
    if not full.exists():
        return {"ok": False, "error": "图片文件不在了（可能被清理过）"}

    return {
        "ok": True,
        "message_id": row["id"],
        "path": str(full),
        "size_bytes": full.stat().st_size,
        "sender": row["sender_nickname"] or "某人",
        "at": time.strftime("%Y-%m-%d %H:%M", time.localtime(row["created_at"])),
        "hint": ("要看清内容，把这个 path 传给 vision_analyze（它的 question 参数问你想知道的）。"
                 "想让它更准就把你真正关心的事写进 question，别只问「这是什么」。"),
    }


# ── 给 agent 的眼睛：一张只读的预览门票 ────────────────────────────────
#
# agent 有 `browser_exec`（Browser Use CLI 那一套）——能开**真浏览器**、
# 能截图、能点击，还能用 `vision_analyze` 看自己截的图。实测这条链是通的。
#
# 但它**没有你们的密码**，打不开这个 App，那就等于没眼睛。
# 这边给它一张**短时、只读**的门票：拿 url 去 browser_exec 打开，
# 换到一次会话 cookie，然后跳回首页正常渲染。
#
# 写操作会被 `auth.current_user` 拦掉（见那边的 `PREVIEW_SCOPE`）——
# **不给它这条限制，就等于让它能冒你们的名发消息。**

class PreviewIn(BaseModel):
    group_id: int


@router.post("/preview", dependencies=[Depends(require_internal_token)])
async def preview_ticket(body: PreviewIn) -> dict:
    await _assert_group(body.group_id)
    # 用群里**最早加入的那个成员**当"看的人"。
    # 为什么不专建一个预览账号：要看的正是**这个群真实的样子**，
    # 换个不在群里的账号，页面里什么都没有，看了等于没看。
    row = await fetch_one(
        """SELECT u.id, u.nickname FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ? ORDER BY gm.joined_at LIMIT 1""",
        (body.group_id,),
    )
    if not row:
        return {"ok": False, "error": "这个群里还没有人，没得看"}
    ticket = make_token(row["id"], scope=PREVIEW_SCOPE, minutes=10)
    return {
        "ok": True,
        "url": f"{settings.app_base_url}/preview?t={ticket}",
        "as": row["nickname"],
        "note": ("拿这个 url 用 browser_exec 打开 → 截图 → vision_analyze 看那张图。"
                 "**这是只读会话**：能看到真实界面和消息，但发消息、改设置会被拒。"
                 "票 10 分钟内有效，打开一次就作数。"),
    }


# （这里原本有 `/new_messages`，给一个 `check_new_messages` 工具用，让它自己来问
#   "有没有比我正在回的这批更新的消息"。**整个拿掉了**——那是"拉"：
#   查不查由它决定（会漏），而且它有一半时候查出来是空的（白花一整次往返）。
#   现在复审改成由编排层在轮次结束时**主动推**回去，见 orchestrator/agent.py。）
