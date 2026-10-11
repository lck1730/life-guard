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
import base64
import binascii
import hmac
import json
import logging
import os
import re
import secrets
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from ..config import WALL_SLUG, settings
from ..core import records as rec
from ..core import reminders as rem
from ..core.hub import hub
from ..db import execute, fetch_all, fetch_one, now
from ..core.messages import create_message
# ⚠️ 这里**只 import 函数**，而且放函数外用 ✓ —— routes_workshop 不 import 本模块 ✓，
#    所以没有环 ✓。
from .workshop import _save as _ws_save
from .workshop import push_workshop_status, start_waiting, stop_waiting

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
    # ★★ **回空壳，不回那条记录** ✗→✓（2026-10-11 用户：
    #   「id 漏了…说创建了"××"类型的记录，这个按理也不该说，只说记住了就好」✓）。
    #
    # ⚠️ **它说漏的东西，全是我们递给它的** ✗ —— 实测它把 `id=1` 报给了用户 ✓，
    #    那串 id 就是从这儿来的 ✓。**光在提示词里写"别说"是没用的** ✗
    #    （这条已经实证过一次 ✓），**别给它可说的东西**才是闸门 ✓。
    #
    # ⚠️ **id 它真的不需要** ✗：要改/删**先 `record_query` 拿** ✓（那一步本来就有 ✓，
    #    也正是"不许凭印象报数字"那条要求的 ✓）。加完这一条就结束了 ✓。
    return {"ok": True}


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
    # ★ **同样不回空壳** ✗→✓ —— `kind` 是**它自己刚传进来的** ✓，
    #   回显一遍没有半点信息量 ✓，却给了它一句"我建了个什么"可以复述 ✓
    #   （用户原话：「说创建了"××"类型的记录，这个按理也不该说」✓）。
    return {"ok": True}


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
    await rem.add(body.group_id, body.text, int(fire_at), repeat_daily=body.repeat_daily)
    # ★ **不回 `id`、也不回 `fire_at`** ✗→✓（2026-10-11，同上面两条）——
    #   · `id` 是内部编号 ✓，说给用户听毫无意义 ✓（要取消先 `reminder_list` ✓）
    #   · `fire_at` 是 **unix 秒** ✗ —— 实测它**拿去自己换算、还算错了** ✓，
    #     然后把那句错话+一串推理讲给了用户听 ✓（"返回的时间是 10 月 11 号…"✗）。
    #     我们自己算好给他就行 ✓，别把生料丢给他去加工 ✓。
    # ⚠️ `when`（人话时间 ✓）**留着** ✓ —— 他要跟用户核对"定在什么时候" ✓，
    #    而且那是**我们算好的**✓，他不用再动脑子 ✓。
    return {"ok": True,
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
    #
    # ⚠️ `str.startswith` → `is_relative_to` ✗→✓ —— 2026-10-07（做创意工坊时顺路修的）：
    #    前缀比较对 `/a/b` vs `/a/bc` 会**误判通过** ✗（`/a/bc/x` 确实"以 /a/b 开头"✓）。
    #    `main.py` 的组件渲染是同一个写法 ✓，一起改了 ✓ ——
    #    同一个错在两处，改一处等于没改 ✗。
    full = (settings.media_dir / row["media_path"]).resolve()
    if not full.is_relative_to(settings.media_dir.resolve()):
        log.error("media_path 越界：%r", row["media_path"])
        return {"ok": False, "error": "文件路径异常"}
    if not full.exists():
        return {"ok": False, "error": "图片文件不在了（可能被清理过）"}

    # ★★ **回的是字节，不是路径** ✗→✓（2026-10-11 实测发现这条路是断的）
    #
    # ⚠️ **原来这里回的是一个本地绝对路径** ✓，叫 agent 把它交给 `vision_analyze` ✓ ——
    #    而 **agent 读不到那个路径** ✗：媒体目录在 `/opt/lifeguard-chat/data/` 底下 ✓，
    #    而 `data/` 是 **700、归 lifeguard** ✓，agent 跑在 `hermes` 名下 ✓ →
    #    权限链断在那一层 ✓（实测 `sudo -u hermes test -r <那张图>` → 读不到 ✓）。
    #    也就是说：**"回忆某张历史图片"这个能力，从分账号那天起就是哑的** ✗ ——
    #    它拿到一个读不了的路径，`vision_analyze` 一开就报错 ✓。
    #    （⚠️ 只影响"回忆旧图" ✓；**你当场发的那张它看得见** ✓ ——
    #      那条路是把图**内联成 base64** 塞进请求的 ✓，不经过文件系统 ✓。）
    #
    # ⚠️ **修的时候别去给 agent 开"读文件"的口子** ✗ —— 那会把我上面说的那层
    #    **文件系统隔离整个拆掉** ✓（现在它读不到任何群的任何媒体 ✓，那是硬闸 ✓）。
    #    反着来：**由我们把字节给它** ✓。插件那边拿到 base64 之后**写进自己的空间** ✓
    #    （插件跑在 hermes 名下 ✓，写自己的地方当然可以 ✓），再把那个路径交给
    #    `vision_analyze` ✓ —— 隔离一点没松，只是把"谁去取"换了个方向 ✓。
    #
    # ⚠️ **`path` 这个字段就不给了** ✗ —— 与其给一个**读不了的路径** ✓
    #    （下一个人还会照着它去试 ✓，就像原来那样 ✓），不如干脆不给 ✓。
    ext = Path(str(row["media_path"])).suffix.lower() or ".jpg"
    mime = {".png": "image/png", ".webp": "image/webp",
            ".gif": "image/gif"}.get(ext, "image/jpeg")
    return {
        "ok": True,
        "message_id": row["id"],
        "ext": ext,
        "mime": mime,
        "data_b64": base64.b64encode(full.read_bytes()).decode("ascii"),
        "size_bytes": full.stat().st_size,
        "sender": row["sender_nickname"] or "某人",
        "at": time.strftime("%Y-%m-%d %H:%M", time.localtime(row["created_at"])),
    }


# ── 发图（反过来：**它 → 你**）──────────────────────────────────────────
#
# ★ 2026-10-11 用户报的：「管家和 diy 助手没法给我发图片」✓。
#
# ⚠️ **缺的从来不是"渲染"、也不是"存储"** ✗ —— 前端早就认
#    `msg_type === 'image'` ✓（**不分是谁发的** ✓，见 `04-chat.js` ✓），
#    `create_message` 也早就收 `media_path` ✓。缺的是**中间那一步**：
#    它手上有一张图，而**没有任何动作能把它送出来** ✓。
#    这正是这个项目反复栽的那个形状（"数据存了，但没告诉它"✓）。
#
# ★ **图从哪儿来** ✓（用户 2026-10-11 定的，三种都算 ✓）：
#     · 它自己截的（浏览器那条路 ✓）
#     · 它工作区里的一个文件 ✓
#     · 你发过的那张（`/image` 早就把路径给它了 ✓）
#   → 所以这个接口收的是**字节** ✓，不关心源头 ✓。
#
# ⚠️ **为什么是它把字节送来，而不是我们按路径去读** ✗ ——
#    服务跑在 `lifeguard` 账号下 ✓，agent 的文件在 `hermes` 那边 ✓ →
#    我们**读不到** ✓（这正是"代码归 root、两边分账号"的代价之一 ✓）。
#    而插件跑在 Hermes 进程里 ✓，它读得到自己的文件 ✓。
#    → "读文件"那一步在它那边做 ✓，"存 + 发"这一步在我们这边做 ✓。

#: 收得下的图片类型 ✓ —— **白名单，不是"以 image/ 开头就行"** ✗
#: （同 `media.py` 那条规矩 ✓：存下来的扩展名**一律用我们表里那个** ✓ ——
#:   不然等于让人用一个自造的名字把东西塞进一个能被浏览器直接打开的目录 ✓）。
_SEND_IMG = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif",
}
_SEND_IMG_MAX = 12 * 1024 * 1024       # 12MB —— 截图和手机照片都够 ✓


class SendImageIn(BaseModel):
    group_id: int
    #: **图片本身的 base64** ✓（也可以连着 `data:image/png;base64,` 前缀一起给 ✓）。
    data_b64: str = Field(min_length=16)
    mime: str = Field(default="image/png", max_length=64)
    #: 配一句话 ✓（可不给 ✓ —— 一张图不配字是允许的 ✓）。
    caption: str = Field(default="", max_length=500)
    #: ★ 工坊那条对话 ✓。**不在工坊里（就是主群聊）给 None** ✓。
    task_id: int | None = None


@router.post("/send-image", dependencies=[Depends(require_internal_token)])
async def send_image(body: SendImageIn) -> dict:
    await _assert_group(body.group_id)
    mime = (body.mime or "").split(";")[0].strip().lower()
    ext = _SEND_IMG.get(mime)
    if not ext:
        return {"ok": False,
                "error": (f"发不了这个类型：{mime or '（没给 mime）'}。"
                          f"图片常见的就 png / jpeg / webp / gif 这几种 —— "
                          f"mime 按实际那个填。")}

    raw = (body.data_b64 or "").strip()
    # ⚠️ **它有时候会把整个 data URL 一起给** ✓（形如 `data:image/png;base64,AAAA` ✓）
    #    —— 那不是错 ✓，剥掉前缀接着用 ✓，别为这种事让它重来一次 ✓。
    if raw.startswith("data:"):
        _, _, raw = raw.partition(",")
    # ⚠️ **base64 允许换行** ✗→✓ —— 它有时候是"按 76 字符折行"那种编码 ✓
    #    （`base64` 命令行工具的默认输出 ✓），带着换行才符合标准 ✓。
    raw = "".join(raw.split())
    try:
        blob = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        return {"ok": False,
                "error": ("那不是一段有效的 base64。"
                          "把图片文件**整个**按 base64 编码后放进来（别截断、别加省略号）。")}
    if not blob:
        return {"ok": False, "error": "解出来是空的"}
    if len(blob) > _SEND_IMG_MAX:
        return {"ok": False,
                "error": (f"这张图太大了（{len(blob) // 1024 // 1024}MB），"
                          f"上限 {_SEND_IMG_MAX // 1024 // 1024}MB。"
                          f"截小一点、或者压一下再发。")}

    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    rel = Path(day) / f"{secrets.token_hex(12)}{ext}"      # ★ 名字由**我们**拼 ✓
    dest = settings.media_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)
    caption = (body.caption or "").strip()

    # ── 工坊那条对话 ──
    if body.task_id:
        row = await fetch_one(
            "SELECT id, user_id FROM workshop_tasks WHERE id = ? AND group_id = ?",
            (int(body.task_id), body.group_id))
        if not row:
            return {"ok": False, "error": f"这个群里没有 id={body.task_id} 的组件对话"}
        uid = int(row["user_id"])
        msg = await _ws_save(body.group_id, uid, int(body.task_id), "agent",
                             caption or "[图片]", msg_type="image",
                             media_path=rel.as_posix())
        # ★ **推给它那条对话的人** ✓ —— 工坊是"你一个人对着它" ✓，
        #   不是广播给全群 ✓（和 `workshop.py` 里 `_push` 同一条规矩 ✓）。
        try:
            await hub.send_to_user(uid, {"type": "ws_message", "data": msg})
        except Exception:  # noqa: BLE001
            log.debug("发图：工坊推送失败 user=%s", uid, exc_info=True)
        log.info("工坊 %s：diy 助手发了一张图 ✓（%d 字节 ✓）", body.task_id, len(blob))
        return {"ok": True, "message_id": msg.get("id"), "path": rel.as_posix()}

    # ── 主群聊（管家）──
    msg = await create_message(
        group_id=body.group_id, sender_id=None, sender_type="agent",
        msg_type="image", content=caption or None, media_path=rel.as_posix(),
    )
    log.info("群 %s：管家发了一张图 ✓（%d 字节 ✓）", body.group_id, len(blob))
    return {"ok": True, "message_id": msg["id"], "path": rel.as_posix()}


# ── 创意工坊：做组件的四个工具 ────────────────────────────────────────────
#
# ## 为什么是"工具"，不是告诉它路径
#
# 本文件上面那段教训（`set_app_theme` 那一节）原话：
# *"说了之后它仍然跑去改 index.html…30 个工具回合折腾完也没干成。
# __给一个名字就是这个动作的工具，它就不用猜了。__"*
#
# ## 两道硬校验落在这儿
#
#   ① **没确认过不许写** ✓ —— 用户在工作坊里确认之前，**世界上不存在可用的票** ✓。
#      写入必须带票 ✓，票只能一次 ✓、30 分钟过期 ✓。这是真的能拦的 ✓。
#   ② **必须由子代理写** ✓ —— ⚠️ **服务端证明不了** ✗，能保证的是**形状** ✓：
#      `save` **只收 handle（服务端发出去的暂存路径）** ✓、**不收正文** ✓ ——
#      于是"在主对话里直接拼一大坨 HTML 塞进来"这条路**在接口层不存在** ✓。
#      至于那个文件到底是谁写的 —— 靠 skill 约定 + 主对话看不到正文来保证 ✓。
#      **不假装它是硬校验** ✗（假装了，将来坏了会以为是代码问题 ✓）。
#
# ## 为什么 save 的群号从票反查
#
# 真正写文件的是**子代理** ✓，而它的会话标识里**没有群号** ✓
# （2026-10-07 实测：子代理的会话 id 形如 20261007_115135_5b1a85 ✓）。
# 所以收尾这一步**不能靠会话推** ✗ —— 票里存着群号 ✓，从票拿 ✓。
# 这一步顺手把"子代理认不出群"那个风险整个绕开了 ✓。

class ComponentConfirmIn(BaseModel):
    group_id: int
    slug: str = Field(min_length=1, max_length=32)
    brief: str = Field(min_length=1, max_length=2000)
    #: ★ 是哪条对话派出去的（2026-10-07 ✓）。**允许为空** ✓ ——
    #: 插件解析不出任务号时照样能开工 ✓，只是"切换时作废票"那一环落空 ✓
    #: （见 `routes_workshop.py` 的 `_void_tickets` ✓）。降级，不是故障 ✓。
    task_id: int | None = None


class ComponentSaveIn(BaseModel):
    #: ⚠️ **只有票** ✗ —— 不收正文、不收群号、不收版本号 ✓（见上面那段 ✓）。
    token: str = Field(min_length=8, max_length=80)
    title: str = Field(default="", max_length=40)
    icon: str = Field(default="", max_length=8)
    note: str = Field(default="", max_length=8000)
    data: dict[str, Any] | None = None
    #: ★ 它**在"组件容纳界面"里怎么展示** ✓（2026-10-07 晚上用户定的 ✓）：
    #: 「每次组件创意时，都要问的一件事是如何在组件容纳界面展示」✓。
    #: 形状 `{"kind":"tile","w":1,"h":1,"tint":"#22334d"}` ✓ ——
    #: 收拾和兜底在 `main.py` 的 `_spot_of`（坏的一律当默认 ✓）。
    spot: dict[str, Any] | None = None


class ComponentSlugIn(BaseModel):
    group_id: int
    slug: str = Field(default="", max_length=32)


#: 组件的图标**要么是一个 emoji，要么是一张内联的小图** ✓。
#
# ★ 2026-10-07 深夜用户提的：「创意工坊组件展览页的图标似乎只能是一种样式，
#   没法用图片？我让 diy 助手换张木鱼图它说换不了」✓。
#
# ⚠️ **必须是"内联的 data URL"，不能是外部地址** ✗ —— 组件和它的图标
#    全都在沙箱里 ✓（外面够不着 ✓，图也不能联网取 ✓）。
#    而 agent 手里没有图片文件 ✓ —— 但它**能画 SVG** ✓：
#    把 SVG 转成 `data:image/svg+xml;base64,…` 就是一张自带的图 ✓ ✓。
#
# ⚠️ **`<img>` 里的 SVG 不能执行脚本** ✓（浏览器的规矩 ✓），所以放它不新增口子 ✓；
#    但**大小要卡死** ✗ —— 图标要塞进每一条列出它的接口里 ✓，
#    一个几百 KB 的图标会把列表接口拖垮 ✓。
_ICON_DATA_RE = re.compile(r"^data:image/(?:png|jpeg|jpg|webp|svg[+]xml);base64,", re.I)
_ICON_MAX = 24 * 1024          # 24KB —— 一个图标够得不能再够了 ✓


def _icon_of(raw: str) -> str:
    """把 agent 给的图标**收拾成能直接用的样子** ✓（坏的一律退回 🧩 ✓）。

    ⚠️ **坏的不抛** ✗→✓ —— 这是模型写的东西 ✓。一个图标写得不对，
       不该让**整个组件**落不下来 ✓（那正是"小事拖垮大事"的形状 ✓）。
    """
    s = (raw or "").strip()
    if not s:
        return "🧩"
    if s.startswith("data:"):
        if _ICON_DATA_RE.match(s) and len(s) <= _ICON_MAX:
            return s
        log.warning("组件图标：data URL 不合法或过大（%d 字节），退回默认", len(s))
        return "🧩"
    # 不是 data URL → 当 emoji 用 ✓。**最多留 4 个字符** ✓
    # （"👨👩👧" 这种组合 emoji 会长一点 ✓，再长就该是写错了 ✓）。
    return s[:4] or "🧩"


def _slug_ok(slug: str) -> bool:
    """和后端 `main.py` 里那条**同一个形状** ✓（小写字母、数字、连字符，≤32）✓。

    中文名会带来 URL 编码、文件名编码两处麻烦 ✓ —— 不值当 ✓。
    """
    return bool(re.match(r"^[a-z0-9][a-z0-9-]{0,31}$", slug or ""))



async def _say_system(group_id: int, text: str, *, no_link: bool = False) -> None:
    """往**主群聊**放一条系统消息。

    ⚠️ **由服务端发，不靠 agent 记得** ✗→✓ —— 这是项目那条铁律：
       *提示词只能请求，不能强制*（见 `orchestrator/agent.py` 里那两段 ✓）。
       让 agent 自己记得发这两条，就是给自己埋一个"它忘了"的故障 ✓。

    发 `system` 类型 ✓（不是 agent 说的 ✓）—— 界面上它是一条居中的提示 ✓，
    不是管家在说话 ✓。
    """
    await create_message(group_id=group_id, sender_id=None,
                         sender_type="system", msg_type="text", content=text,
                         # ★ 「开始做…」那条**不许标蓝可跳** ✗→✓（2026-10-07 深夜用户定的：
                         #   「开始做组件的时候不用标蓝色可跳转，做好后才标」✓）。
                         #   ⚠️ 为什么需要个标记 ✗：客户端是**按名字自动标蓝**的 ✓
                         #      （提到真有的组件就连 ✓）—— 而改一个已有组件时（v2+ ✓），
                         #      这个名字**真的存在** ✓ → 它会被标蓝 ✓ ✗，
                         #      点过去看的是**老的**那一版 ✓（新的还没做出来 ✓）。
                         #      所以"这一条我说的这个名字现在还不是个东西"要**说清楚** ✓。
                         media_meta={"no_link": True} if no_link else None)


@router.post("/components/confirm", dependencies=[Depends(require_internal_token)])
async def components_confirm(body: ComponentConfirmIn) -> dict:
    """**用户在工作坊里确认了细节** → 发一张票 + 开一个暂存文件。

    ⚠️ 票和 handle 都**由服务端生成** ✓ —— 主对话只是把它们转给子代理 ✓。
       `brief` 存进票里 ✓：子代理的 brief 就有了**权威来源** ✓，
       主对话不必"凭记忆复述用户要什么" ✓（子代理看不到会话 ✓）。
    """
    await _assert_group(body.group_id)
    slug = body.slug.strip().lower()
    if not _slug_ok(slug):
        return {"ok": False,
                "error": ("短名只能用**小写字母、数字、连字符**，不超过 32 位，"
                          "而且要用英文（比如 bookkeeping-panel，不要用中文）。"
                          "起一个说得清它干嘛的英文短名。")}
    token = secrets.token_hex(16)
    handle = str(settings.staging_dir / (token + ".html"))
    ts = int(time.time())
    # ★ 票记住**是哪条对话派出去的** ✗→✓（2026-10-07）——
    #   用户切走的时候按它作废 ✓（见 `routes_workshop.py` 的 `_void_tickets` ✓）。
    #   ⚠️ 只认**这个群里**的任务 ✓；认不出来就当没给 ✓（降级 ✓）——
    #      绝不因为一个对不上的任务号把"开工"这一步整个拦掉 ✗
    #      （组件做不出来比"票没绑上"严重得多 ✓）。
    task_id = body.task_id
    wait_uid = None
    if task_id:
        row = await fetch_one(
            "SELECT id, user_id FROM workshop_tasks WHERE id = ? AND group_id = ?",
            (int(task_id), body.group_id))
        if not row:
            log.warning("组件开工：任务号 %s 不属于群 %s，按没给处理",
                        task_id, body.group_id)
            task_id = None
        else:
            wait_uid = int(row["user_id"])
    await execute(
        "INSERT INTO component_tickets(token, group_id, slug, brief, handle,"
        " created_at, expires_at, task_id) VALUES(?,?,?,?,?,?,?,?)",
        # ⚠️ **2 小时，不是 30 分钟** ✗→✓ —— 用户 2026-10-07 指出的：
        #    「派票 30 分钟过期，但子代理未必 30 分钟交差」✓ —— 对 ✓。
        #    写一个组件要读、改、试、再改 ✓，慢起来十几二十分钟很正常 ✓；
        #    过期了它只会看到一句「重新确认一次」✓ —— 那一轮就白干了 ✗。
        #    票是**一次性**的 ✓（用掉就作废 ✓），所以放宽时限不多出风险 ✓。
        (token, body.group_id, slug, body.brief.strip(), handle, ts, ts + 7200, task_id))
    # ★ **不发"开工"那条了** ✗→✓（2026-10-11 用户定：只提示一次，落在**做成**那一刻 ✓）。
    #    理由写在这儿，免得下一个人觉得漏了又加回来 ✗：
    #    · 它唯一的用处是让人知道"在做" ✓ —— 那个由下面的 `push_workshop_status`
    #      推的"正在做"状态承担 ✓；而且真正该提示的时候，已经是在工坊里拦人 ✓。
    #    · 少一条就少一条**特殊路径** ✓ —— `_say_system(no_link=True)` 那个标记
    #      **就是为它存在的** ✗（那时组件还不存在，名字真存在 → 标蓝会跳到旧版 ✓），
    #      它没了，那个特例也一并退场 ✓。
    #    · 文案里那句"下一版是 v几"需要 `max(version)+1` ✓ —— 那整段查询跟着删了 ✓
    #      （真正的版本号在 `components_save` 里现算 ✓，那边才是权威 ✓）。
    # ⚠️ **"正在做"这个状态由服务端在准确的那一刹那推出** ✗→✓ ——
    #    因为它没法从流里看出来 ✓（我们只取正文 ✓，不看工具事件 ✓）。
    #    而这一刻服务端**知道** ✓（就是子代理该上场的时候 ✓）。
    await push_workshop_status(body.group_id, "working", task_id)
    # ★ **从这一刻起，得有人替它开口** ✗→✓（2026-10-07 深夜）——
    #   子代理是异步的 ✓，结果**只有下一轮才看得到** ✓，而工坊的下一轮
    #   只有用户说话才会来 ✓ → 不问的话"做好了"要等他开口 ✓（用户报的就是这个 ✓）。
    #   见 `routes_workshop.poke_loop` ✓。
    if task_id and wait_uid:
        await start_waiting(body.group_id, wait_uid, int(task_id))
    log.info("组件开工：群 %s 的 %s（票 %s…）", body.group_id, slug, token[:8])
    return {
        "ok": True, "token": token, "slug": slug, "handle": handle,
        "next": ("把这个 handle 原样交给子代理，让它把**整份 HTML 写进那个文件**"
                 "（单文件、不引外部资源）。它写完只回一句结论。"
                 "然后你调 component_save，**带上这张 token**，并把 title/icon/note/data 填上。"
                 "⚠️ token 和 handle 一个字都别改，原样传。"),
    }


@router.post("/components/save", dependencies=[Depends(require_internal_token)])
async def components_save(body: ComponentSaveIn) -> dict:
    """**凭票认领** —— 把暂存文件落成组件仓库里的新一版（`draft`）。"""
    row = await fetch_one("SELECT * FROM component_tickets WHERE token = ?", (body.token,))
    if not row:
        return {"ok": False, "error": "这张票不认得（拼错了？还是过期被清了？）"}
    if row["used_at"]:
        return {"ok": False, "error": "这张票**已经用过了**。要再做一版，得重新走一遍确认。"}
    if int(row["expires_at"]) < int(time.time()):
        # ⚠️ 两种"过期"到这儿的说法**要分开** ✗→✓（2026-10-07）：
        #    ① 真的放了两小时（`ts + 7200` ✓）
        #    ② **用户切走了，我们主动作废的** ✓（`_void_tickets` 把 expires_at 写成 0 ✓）
        #    对②说"过期了"会让它以为是慢了、又去重试一遍 ✗ ——
        #    而真相是**这一轮已经被掐了** ✓，该照实说 ✓。
        if int(row["expires_at"]) <= 0:
            return {"ok": False,
                    "error": ("这一轮**已经被掐掉了** —— 用户中途切到别的对话上去了 ✓，"
                              "那次切换会作废这条线上所有的票 ✓。"
                              "**别重试** ✗，等他下次开口再走一遍流程 ✓。")}
        return {"ok": False, "error": "这张票过期了（两小时）。重新确认一次细节再做。"}
    group_id = int(row["group_id"])          # ★ 群号**从票反查** ✓，不从会话推 ✓
    slug = str(row["slug"])
    handle = Path(str(row["handle"] or ""))
    if not handle.is_file():
        return {"ok": False,
                "error": ("暂存文件还不存在 —— 子代理**还没把 HTML 写进去**。"
                          "先让它写完（它回来说写好了），再调这个。")}
    try:
        html = handle.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"ok": False, "error": "暂存文件读不出来：" + str(exc)}
    if not html.strip():
        return {"ok": False, "error": "暂存文件是**空的** —— 让子代理真的写点东西进去。"}
    if len(html) > 400_000:
        return {"ok": False,
                "error": "太大了（" + str(len(html)) + " 字符，上限 40 万）。拆小一点。"}

    # 版本号**服务端自增** ✓ —— 不接受 agent 传 ✗（它会数错自己做过几版 ✓）
    prev = await fetch_one(
        "SELECT COALESCE(MAX(version), 0) AS v FROM components WHERE group_id = ? AND slug = ?",
        (group_id, slug))
    version = int((prev or {}).get("v") or 0) + 1
    # ⚠️ 别去 import `main.group_components_dir` ✗ —— 那是循环导入 ✓。
    #    规则就一条（`var/components/g<群号>/<slug>/v<N>/`）✓，照写 ✓。
    d = settings.components_dir / ("g" + str(group_id)) / slug / ("v" + str(version))
    try:
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(html, encoding="utf-8")
    except OSError as exc:
        return {"ok": False, "error": "写不进组件仓库：" + str(exc)}
    # ★ 记下**是哪条对话做出来的** ✗→✓（2026-10-07）——
    #   组件页的「继续改」靠它回到**当初那条对话** ✓（见 `main.py` 的
    #   `_task_of_slug` ✓）。票上没有就留空 ✓（降级 ✓）。
    task_id = row["task_id"] if "task_id" in row.keys() else None
    # ★ ★ **用户开做时起的名字优先** ✗→✓（2026-10-07 晚上）——
    #   他在＋里点「新建组件」时**先起过一个名** ✓（那正是他心里的名字 ✓）。
    #   这里要是直接用了 agent 填的那个，会出现"我明明叫它记账面板，它自己改成了记账" ✓ ——
    #   而用户**没有任何办法解释** ✓（名字在两个地方各说各话 ✓）。
    #   ⚠️ 只在**两处不一致**的时候才提一句 ✓，别每次都啰嗦 ✓。
    want_title = body.title.strip() or slug
    said = ""
    if task_id:
        t = await fetch_one("SELECT title FROM workshop_tasks WHERE id = ?", (int(task_id),))
        mine = str((t or {}).get("title") or "").strip()
        if mine and mine != want_title:
            said = f"（用户开做时说它叫「{mine}」，所以用了**他起的那个** ✓）"
            want_title = mine
    await execute(
        "INSERT INTO components(group_id, slug, version, state, title, icon,"
        " data_json, note, created_at, task_id, spot_json)"
        " VALUES(?,?,?,'draft',?,?,?,?,?,?,?)",
        (group_id, slug, version, want_title, _icon_of(body.icon),
         json.dumps(body.data or {}, ensure_ascii=False), body.note.strip(),
         int(time.time()), int(task_id) if task_id else None,
         json.dumps(body.spot or {}, ensure_ascii=False)))
    # 对话**定名了** ✓ —— 把 slug 记到任务上 ✓（"＋做一个新的"那条从此知道自己是什么 ✓）。
    # ⚠️ 只在它**还是空的时候**写 ✓（`AND slug IS NULL` ✓）：
    #    从「继续改」开的对话一上来就写着别的 slug ✓，那是**它的目标** ✓，
    #    不该被这一次的落成覆盖掉 ✓（真改错了名，也还有组件表那条链接兜着 ✓）。
    if task_id:
        await execute("UPDATE workshop_tasks SET slug = ? WHERE id = ? AND slug IS NULL",
                      (slug, int(task_id)))
    # ★ **新组件排在容纳界面的最末尾** ✗→✓ —— `INSERT OR IGNORE` 的意思是
    #   "**别再动已经排过的那个**" ✓：做第二版的时候不该把用户拖好的位置重置 ✓。
    #   没这一步的话，新做的组件在容纳界面里会**排在所有排过版的后面** ✓，
    #   看着像"它跑到最后去了" ✓（其实只是没有位置 ✓）。结果一样 ✓，
    #   但有了位置之后，用户下次拖动时它才是个**能一起参与排序**的东西 ✓。
    nxt = await fetch_one(
        "SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM component_spots WHERE group_id = ?",
        (group_id,))
    await execute(
        "INSERT OR IGNORE INTO component_spots(group_id, slug, pos, updated_at)"
        " VALUES(?,?,?,?)",
        (group_id, slug, int((nxt or {}).get("p") or 0), int(time.time())))
    await execute("UPDATE component_tickets SET used_at = ? WHERE token = ?",
                  (int(time.time()), body.token))
    try:
        handle.unlink(missing_ok=True)       # 认领完把暂存文件收掉 ✓（免得越攒越多 ✓）
    except OSError:
        pass
    # ★ **落成了就别再问了** ✗→✓ —— 那个"等交付"的循环到这里就该停 ✓
    #   （不然它会隔一阵继续问"交付了吗"✓，而东西早就落好了 ✓）。
    if task_id:
        await stop_waiting(int(task_id))
    await push_workshop_status(group_id, "done", int(task_id) if task_id else None)
    # ★ 文案是用户 2026-10-07 深夜定的 ✗→✓：
    #   「[组件名称]做完了，快去看看吧。」✓
    #   ⚠️ **名字两侧的「」不要** ✓ —— 客户端会把**名字本身**标成蓝色可点 ✓
    #      （见 `renderContent` 那段 ✓），再加引号就变成"蓝引号包着黑字" ✓，
    #      看着像没生效 ✓。
    await _say_system(group_id, want_title + "做完了，快去看看吧。")
    log.info("组件落成：群 %s 的 %s v%s", group_id, slug, version)
    return {"ok": True, "slug": slug, "version": version, "state": "draft",
            "title": want_title,
            # ⚠️ 这段话是**写给模型看的** ✓ —— 2026-10-07 深夜跟着"固化"整套改过 ✗→✓：
            #    原来它写着"要用户点保留才算定下来" ✓，那会让它转头去跟用户说
            #    「还没固化」✓ —— 而界面上**已经没有这个词了** ✗（用户会去找一个
            #    不存在的东西 ✓）。现在只说事实：做好了、能用了 ✓。
            "note": ("已经做好了 ✓ —— 他随时能在创意工坊里看到它、也能让你接着改 ✓。"
                     "**别提「固化 / 保留 / 未固化」这些词** ✗（界面上没有这套概念了 ✓）。"
                     + said)}


@router.post("/components/list", dependencies=[Depends(require_internal_token)])
async def components_list_tool(body: ComponentSlugIn) -> dict:
    """这个群有哪些组件、各自到哪一步 —— **只回摘要行** ✓。

    ⚠️ **不要回全文** ✗ —— 组件一多，把 N 份 NOTE 全灌进上下文就是灾难 ✓
    （和 `records` 那句"每加一种就得给可视化写个特例"是同类的错 ✓）。
    要看某一个的细节，另调 `components/note` ✓。
    """
    await _assert_group(body.group_id)
    rows = await fetch_all(
        "SELECT slug, version, state, title, icon FROM components"
        " WHERE group_id = ? ORDER BY slug ASC, version DESC", (body.group_id,))
    out: dict[str, dict] = {}
    for r in rows:
        slug = str(r["slug"])
        it = out.setdefault(slug, {"slug": slug, "title": r["title"] or slug,
                                   "icon": r["icon"] or "🧩", "versions": [],
                                   "live": None, "draft": None})
        it["versions"].append(int(r["version"]))
        if r["state"] == "live" and it["live"] is None:
            it["live"] = int(r["version"])
        elif r["state"] == "draft" and it["draft"] is None:
            it["draft"] = int(r["version"])
    return {"ok": True, "components": [out[k] for k in sorted(out)]}


# ── ★ 「组件界面」自己的外观（2026-10-08）─────────────────────────────────
#
# 用户定的：那条叫「组件界面diy」的对话，**可以改 [组件] 界面本身** ✓
#（原话：「提供一个默认组件聊天入口，名字叫[组件界面diy]，这个聊天甚至可以
#   自行diy[组件]界面本身，由于本身就是基本空白，因此可以自由天马行空，
#   甚至将提示的字都去掉，注意，只有这一个入口可以提供此功能」✓）。
#
# ## 存哪
#
# `var/wall/g<群号>/style.css` ✓（和组件仓库同一层 ✓：服务写 ✓、agent **写不进** ✗）。
# 为什么放文件不放库列 ✓：CSS 是**附件**不是**事实** ✓（同 `db.py` 顶上那条对头像的
# 判断 ✓）。为什么不放 `ui/` ✓：那底下是**无鉴权**挂载 ✓，而这是"某个群自己的东西" ✗
#（同 `main.py` 里组件为什么住 `var/` 那一段 ✓）。
#
# ## ⚠️ 闸门在**服务端**，不在提示词里 ✗
#
# 只有**那一条对话**能调它 ✓ —— "我是哪条对话"是从 `session_id` 反查出来的 ✓
#（插件把它一起发上来 ✓），而判据是"这条任务的 slug 是不是 `wall`" ✓。
# 提示词里写一句"只有你能改"是**请求**不是**闸门** ✓（这个项目的老结论 ✓）。

class WallStyleIn(BaseModel):
    group_id: int
    task_id: int | None = None
    css: str = ""
    note: str = ""


def _wall_dir(group_id: int) -> Path:
    d = Path(settings.var_dir) / "wall" / f"g{int(group_id)}"
    d.mkdir(parents=True, exist_ok=True)
    # ⚠️ **权限要显式设** ✗ —— `mkdir` 的 mode 会被 umask 削掉 ✓，
    #    而"agent 写不进"这件事全靠它 ✓（和 `var/components` 一样是 2750 ✓）。
    try:
        os.chmod(d, 0o2750)
    except OSError:
        pass
    return d


async def _wall_task_ok(group_id: int, task_id: int | None) -> str | None:
    """这条对话是不是「组件界面diy」那条 ✓？不是就返回一句给模型看的话。"""
    if not task_id:
        return ("改「组件界面」的外观只能在**「组件界面diy」那条对话**里做 —— "
                "你这条对话没有那个权限。")
    row = await fetch_one(
        "SELECT slug FROM workshop_tasks WHERE id = ? AND group_id = ?",
        (int(task_id), int(group_id)))
    if not row or (row["slug"] or "") != WALL_SLUG:
        return "只有「组件界面diy」那条对话能改组件界面的外观。"
    return None


@router.post("/components/wall-set", dependencies=[Depends(require_internal_token)])
async def wall_style_set(body: WallStyleIn) -> dict:
    """写下这个群的「组件界面」外观 ✓（CSS ✓）。"""
    await _assert_group(body.group_id)
    bad = await _wall_task_ok(body.group_id, body.task_id)
    if bad:
        return {"ok": False, "error": bad}
    css = (body.css or "").strip()
    if not css:
        return {"ok": False, "error": "css 是空的 —— 要恢复默认请用 wall_clear"}
    if len(css) > 200_000:
        return {"ok": False, "error": "太长了（超过 20 万字符）"}
    # ⚠️ **必须自己限定作用域** ✗ —— 这段 CSS 会挂在**整个页面**上 ✓，
    #    不限定的话会改到主群聊、我的、设置页…… ✗（用户要的是改**那一屏** ✓）。
    #    所以这里只做一条**便宜但有效**的检查 ✓：得有 `#workshop` 这个选择器 ✓。
    #    （不引 CSS 解析器 ✓ —— 那要新依赖 ✓，而这一条已经能挡住 99% 的"忘了限定"✓。）
    if "#workshop" not in css:
        return {"ok": False, "error": (
            "css 里必须用 `#workshop` 限定作用域（那一屏的容器 id 就是 `#workshop`）——"
            "不然你会把主群聊、我的、设置页也一起改了。"
            "例：`#workshop .cell { border-radius: 999px; }`")}
    d = _wall_dir(body.group_id)
    (d / "style.css").write_text(css, encoding="utf-8")
    log.info("组件界面外观：群 %s 写了 %d 字符的 CSS（%s）",
             body.group_id, len(css), (body.note or "")[:60])
    return {"ok": True, "bytes": len(css), "note": (
        "已经生效了 —— 用户右滑回群聊、再左滑进来就看得见 ✓"
        "（不用重启任何东西 ✓）。")}


@router.post("/components/wall-clear", dependencies=[Depends(require_internal_token)])
async def wall_style_clear(body: ComponentSlugIn) -> dict:
    """把「组件界面」的外观**恢复默认** ✓（删掉那个文件 ✓）。"""
    await _assert_group(body.group_id)
    f = Path(settings.var_dir) / "wall" / f"g{int(body.group_id)}" / "style.css"
    if f.exists():
        f.unlink(missing_ok=True)
        return {"ok": True, "note": "已经恢复默认外观 ✓"}
    return {"ok": True, "note": "本来就是默认外观 ✓"}


@router.post("/components/note", dependencies=[Depends(require_internal_token)])
async def components_note(body: ComponentSlugIn) -> dict:
    """某一个组件的**工程笔记** ✓ —— 「回顾之前的组件」就靠它 ✓。

    ⚠️ 说清它是什么、不是什么 ✗→✓ —— **它是这个组件的笔记，不是它在群里的第二套记忆** ✓。
       项目已经否过一次同样形状的东西（`db.py` 里 `group_memory` 那段停用注释 ✓：
       *「只追加、不整理、不总结、不去重、不衰减…留着只会和内置记忆打架」*✓）。
       群成员的偏好、聊过的事，那些归**它的内置记忆** ✓，不归这儿 ✓。
    """
    await _assert_group(body.group_id)
    slug = (body.slug or "").strip().lower()
    if not _slug_ok(slug):
        return {"ok": False, "error": "短名不合法（小写字母、数字、连字符）"}
    rows = await fetch_all(
        "SELECT version, state, title, note, spot_json, created_at, enabled_at"
        " FROM components WHERE group_id = ? AND slug = ? ORDER BY version ASC",
        (body.group_id, slug))
    if not rows:
        return {"ok": False, "error": "这个群还没有 " + slug + " 这个组件"}

    # ★ **头部由服务端写** ✗→✓ —— 2026-10-07。
    #
    # 为什么不让它自己记："这是第几版、哪一版在跑、什么时候建的"是**事实** ✓，
    # 而让它自己复述 = 让它**回忆** ✓ —— 它会记错自己做过几版 ✓
    # （这个项目在别处吃过同类的亏 ✓：两套事实各记各的，迟早走岔 ✓）。
    # 所以：**下面这几行是服务端给的** ✓，`note` 那部分才是它写的 ✓。
    from datetime import datetime, timezone
    def _d(ts):
        if not ts:
            return ""
        return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%d %H:%M")
    # ⚠️ 这里的说法**是给模型看的** ✓ —— 2026-10-07 深夜跟着"固化"整套改过 ✗→✓：
    #    它自己得能读懂"第几版、哪一版最新" ✓，但**不能再拿"保留/未固化"那张嘴** ✗
    #    （它会照抄过去跟用户说 ✓，而界面上那两个词已经没了 ✓）。
    label = {"live": "现在用的那一版", "draft": "最新的一版",
             "archived": "旧版（被新版顶下来了）"}
    head = [f"# {rows[-1]['title'] or slug}（`{slug}`）", ""]
    for r in rows:
        line = (f"- **v{r['version']}** · {label.get(r['state'], r['state'])}"
                f" · 建于 {_d(r['created_at'])}")
        if r["enabled_at"]:
            line += f" · 启用 {_d(r['enabled_at'])}"
        head.append(line)
    head.append("")
    # ★ 它**现在在"组件容纳界面"里是怎么摆的** ✓ —— 也是**事实** ✓，
    #   所以由服务端报 ✓（见上面那段理由 ✓）。改版时它得知道现在长什么样 ✓，
    #   不然会把"用户拖过位置/上版声明过 tint"这些当成不存在 ✓。
    sp = rows[-1]["spot_json"] if "spot_json" in rows[-1].keys() else None
    try:
        spd = json.loads(sp or "{}") or {}
    except Exception:  # noqa: BLE001
        spd = {}
    if isinstance(spd, dict) and spd:
        head.append("它在**组件容纳界面**里现在是这样摆的："
                    + json.dumps(spd, ensure_ascii=False)
                    + "（`w`/`h` 是占几个格子、`tint` 是底色 ✓。）")
        head.append("")
    head.append("（上面这几行是**系统记的**，不是谁的回忆 ✓；下面就都是那个组件自己的笔记 ✓。）")
    body_note = next((r["note"] for r in reversed(rows) if r["note"]), "")
    skeleton = ("## 用户要什么\n\n## 为什么长这样\n\n## 试过但没用的\n\n"
                "## 数据依赖\n\n## 还没做的\n")
    return {"ok": True, "slug": slug, "versions": [dict(r) for r in rows],
            "readable": "\n".join(head) + "\n\n" + (body_note or
                "（这一版还没写笔记 ✓ —— 下次改动时按下面这几节补上 ✓）\n\n" + skeleton),
            "about": ("这是**这个组件自己的笔记**（像 README）✓，不是你在群里的第二套记忆 ✓。"
                      "群成员的偏好、聊过的事，那些归你的内置记忆 ✓。")}
