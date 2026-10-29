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
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from ..config import settings
from ..core import records as rec
from ..core import reminders as rem
from ..core.idle import is_idle_turn, note_idle_write_blocked
from ..core.hub import hub
from ..db import execute, fetch_all, fetch_one, now
from ..core.messages import create_message

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


def _idle_write_block(group_id: int) -> dict | None:
    """空闲闲聊轮里，**代码**挡掉所有会改数据的写操作。

    提示词里已经写了"别补记账、别补设提醒"，但那只是请求；2026-10-20 实测
    空闲唤醒仍把旧消息又处理了一遍，同一笔 ¥12.59 记了三次。这里返回的错误串
    是**给模型看的**，要让它明白"不是接口坏了，是这一轮不该写"，不要换个工具重试。
    读操作（record_query / record_kinds / reminder_list）不挡。
    """
    if not is_idle_turn(group_id):
        return None
    # ★ 记下"本轮挡过写"——编排层据此把整条正文作废 ✓（2026-10-21）。
    #   不记的话，它会把被挡的事原样说给群里（"14.21 那笔我没记进去"）。
    note_idle_write_blocked(group_id)
    return {
        "ok": False,
        "error": (
            "现在是空闲闲聊轮，不是用户发起的请求；旧消息都已经处理过了。"
            "**本轮不要补记账、不要补设提醒、不要删改任何东西**。"
            "想说话就直接说，不想说就回 [SILENT]。"
        ),
    }


# ── 结构化记录 ────────────────────────────────────────────────────────

class RecordAddIn(BaseModel):
    group_id: int
    kind: str
    fields: dict[str, Any]
    created_by: int | None = None


@router.post("/records/add", dependencies=[Depends(require_internal_token)])
async def records_add(body: RecordAddIn) -> dict:
    await _assert_group(body.group_id)
    blocked = _idle_write_block(body.group_id)
    if blocked:
        return blocked
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
    blocked = _idle_write_block(body.group_id)
    if blocked:
        return blocked
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
    blocked = _idle_write_block(body.group_id)
    if blocked:
        return blocked
    row, err = await rec.delete(body.group_id, body.record_id)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True, "record": row,
            "note": "删掉了（**只是标记为删，行还在**——账不能无声消失）。"
                    "删错了就调 record_restore 恢复。"}


@router.post("/records/restore", dependencies=[Depends(require_internal_token)])
async def records_restore(body: RecordIdIn) -> dict:
    await _assert_group(body.group_id)
    blocked = _idle_write_block(body.group_id)
    if blocked:
        return blocked
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
    blocked = _idle_write_block(body.group_id)
    if blocked:
        return blocked
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
    blocked = _idle_write_block(body.group_id)
    if blocked:
        return blocked
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
    blocked = _idle_write_block(body.group_id)
    if blocked:
        return blocked
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
        """SELECT m.id, m.msg_type, m.media_path, m.created_at, m.deleted_at,
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
    # ★ 2026-10-29：被擦掉的那行**它不是图片了** ✓ —— 别回一句
    #   "#123 是一条 image 消息，不是图片" ✗（它自己看着都糊涂 ✓）。
    if row["deleted_at"]:
        return {"ok": False, "error": f"#{body.message_id} 已经被擦掉了"}
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

    # ── 主群聊（管家）──
    msg = await create_message(
        group_id=body.group_id, sender_id=None, sender_type="agent",
        msg_type="image", content=caption or None, media_path=rel.as_posix(),
    )
    log.info("群 %s：管家发了一张图 ✓（%d 字节 ✓）", body.group_id, len(blob))
    return {"ok": True, "message_id": msg["id"], "path": rel.as_posix()}


# ── 发表情（2026-10-27）───────────────────────────────────────────────
#
# ★ **管家只能发 3xx 猫猫管家** ✓ —— 这一条必须卡在**后端** ✗，不能只写在
#   工具描述 / SOUL 里：1xx / 2xx 是群友的表情 ✓，让管家发等于它在替人说话 ✓。
#   （和"能力边界用有没有这个工具来划"是同一个思路：规则贴着执行点最硬 ✓。）
class SendStickerIn(BaseModel):
    group_id: int
    sticker_id: str = Field(min_length=3, max_length=3)


@router.post("/send-sticker", dependencies=[Depends(require_internal_token)])
async def send_sticker(body: SendStickerIn) -> dict:
    await _assert_group(body.group_id)
    from ..core import stickers as sticker_core

    s = sticker_core.get(body.sticker_id)
    if not s:
        return {"ok": False, "error": f"没有编号 {body.sticker_id} 这个表情"}
    if s.get("owner") != "butler":
        return {"ok": False,
                "error": (f"{sticker_core.label(body.sticker_id)} 是群友的表情，"
                          f"不是你的。你只能发猫猫管家那一套（301-306）。")}
    msg = await create_message(
        group_id=body.group_id, sender_id=None, sender_type="agent",
        msg_type="sticker", content=str(s["id"]),
        media_path=sticker_core.media_path(s),
        media_meta=sticker_core.sticker_meta(s),
    )
    log.info("群 %s：管家发了一张表情 %s ✓", body.group_id, body.sticker_id)
    return {"ok": True, "message_id": msg["id"]}


# ── 组件仓库的公共校验 ─────────────────────────────────────────────────
#
# 创意工坊/DIY 助手已经下线，但组件本身还在：列表、渲染、导入、删版本
# 仍然由 main.py 使用。这里只保留那几条**纯校验 / 纯仓库维护**的公共件。
#
#: 一版 HTML 的上限 —— 和 main.py 的 component_render 里那个截断同一个数。
_HTML_MAX = 400_000


def _records_spec(spec: Any) -> dict[str, Any] | None:
    """从组件的 `data` 声明里取出 records 那份（认嵌套和扁平两种写法）。"""
    if not isinstance(spec, dict):
        return None
    if isinstance(spec.get("records"), dict):
        return spec["records"]
    if isinstance(spec.get("kind"), str):
        return spec
    return None


B = chr(92).__add__
_QC = "'" + '"'
_WS = B("s")
_SRC = "src" + B("b") + _WS + "*?="
_HREF = "href" + B("b") + _WS + "*?="
_VOPEN = _WS + "*?[" + _QC + "]"
_PR = "//" + "([^" + _QC + "/]|" + "$)"
_ABS = "/" + "(?![/" + _QC + "])"
_REMOTE = "(?:" + "https?:" + "|" + _PR + ")"

_RE_LINK_CSS = re.compile("<link" + _WS + "*?rel" + _WS + "*?=" + _WS + "*?["
                          + _QC + "]stylesheet", re.I)
_RE_SCRIPT_SRC = re.compile("<script" + _WS + "*?" + _SRC + _VOPEN, re.I)
_RE_IMPORT = re.compile("@import", re.I)
_RE_URL_ABS = re.compile(_SRC + _VOPEN + _REMOTE + "|" + _HREF + _VOPEN
                         + _REMOTE, re.I)
_RE_PATH_ABS = re.compile(_SRC + _VOPEN + _ABS + "|" + _HREF + _VOPEN + _ABS,
                          re.I)

_HTML_EXT_RULES = (
    (_RE_LINK_CSS,  "里面链了外部样式表（link rel=stylesheet）"),
    (_RE_SCRIPT_SRC, "里面引了外部脚本（script src=…）"),
    (_RE_IMPORT,    "CSS 里有 @import"),
    (_RE_URL_ABS,   "里面用了外部地址（http:// 或 //）"),
    (_RE_PATH_ABS,  "里面用了站点内的绝对路径（src=/… 或 href=/…）"),
)


def _validate_component_html(html: str) -> str:
    """导入前校验 —— 返回空串 = 通过，返回原因 = 不通过。"""
    h = (html or "").strip()
    if not h:
        return "导入的内容是空的"
    if len(h) > _HTML_MAX:
        return ("太大了（" + str(len(h)) + " 字符，上限 "
                + str(_HTML_MAX) + "）。拆小一点，或者只导出那一部分。")
    if "<html" not in h.lower() and "<body" not in h.lower():
        return "这不是一份完整的页面（找不到 html 或 body 标签）"
    for pat, why in _HTML_EXT_RULES:
        if pat.search(h):
            return why
    return ""


#: 一个组件在仓库里只留几版（当前 + 最近两版）。
_VERSIONS_KEEP = 3


async def _prune_component_versions(group_id: int, slug: str,
                                    keep: int = _VERSIONS_KEEP) -> list[int]:
    """只留最新的 `keep` 版，老的连库带盘一起收掉。

    ⚠️ 先删库再删盘：反过来的话删库失败会留下"库说有、盘上没了"的空组件。
    """
    rows = await fetch_all(
        "SELECT version FROM components WHERE group_id = ? AND slug = ?"
        " ORDER BY version DESC",
        (group_id, slug))
    if len(rows) <= keep:
        return []
    out = []
    for r in rows[keep:]:
        ver = int(r["version"])
        await execute(
            "DELETE FROM components WHERE group_id = ? AND slug = ? AND version = ?",
            (group_id, slug, ver))
        d = settings.components_dir / ("g" + str(group_id)) / slug / ("v" + str(ver))
        if d.is_relative_to(settings.components_dir) and d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
        out.append(ver)
    if out:
        log.info("组件收版本：群 %s 的 %s 只留最新 %d 版，收了 v%s",
                 group_id, slug, keep, out)
    return out
