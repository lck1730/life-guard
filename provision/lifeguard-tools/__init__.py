"""生活管家的自定义工具。

## 这里有什么（★ 每加一个工具，`_TOOLS` 里那个 schema **必须**有两样：
##   顶层 `description` ✓ 和一个 `parameters` 包装 ✓ ——
##    少任一样，`register()` 就抛 ✓ → **整个插件加载失败** ✓（所有工具全没 ✓），
##    而且只在 gateway 启动时才炸 ✓、日志里只有一行 WARNING ✓。
##    2026-10-11 就是栽在这上面 ✓（`wall_style_set` / `wall_clear` 两样都缺 ✓）。
##    `tools/deploy-chat.sh` 现在会**照 Hermes 的样子真的注册一遍** ✓，缺了当场拦下 ✓。）

| 工具 | 干什么 |
|---|---|
| `record_add` / `record_query` | 读写**结构化记录**（记账是其中一种） |
| `record_define` / `record_kinds` | 定义新的记录类型 / 看现有的 |
| `group_say` | 主动往群里说一句（不因为谁叫你） |
| `look_at_image` | 拿某张历史图片的本地路径，好交给 `vision_analyze` 看 |
| `send_photo` | **反过来：把一张图发出去**（截图 / 你工作区里的图 / 用户发过的那张） |
| `send_sticker` | 发一张你自己的「猫猫管家」表情（只能发 3xx） |
| `reminder_add` / `reminder_list` / `reminder_cancel` | 设/看/取消提醒 |

**"有没有新消息"不在这里**——那件事改由编排层主动推，见文件末尾的说明。

## 为什么记忆不在这里

这里曾经有个 `remember` 工具，把群记忆写进我们自己的表。它存在的唯一理由
（"Hermes 内置记忆是 Profile 级、多群会串味"）随着「一个群 ⇄ 一个 profile 空间」
成为硬约束（见 `app/spaces.py`，数据层还有唯一索引）**已经不成立了**。
留着是纯负债，而且会和内置的 `memory` 工具**打架**——实测中模型先调我们的
`remember` 再调内置的，同一件事写进两个地方。**记忆交给内置的 `memory` 工具。**
规则写在 `profiles/<空间>/SOUL.md`（仓库里的 `hermes/SOUL.md`）。

## 为什么记账要走"结构化记录"而不是自由文本

账目要**确定性**：金额、分类、时间必须可查可算、以后能画图。塞进 2200 字符的
自由文本记忆里，模型会说"记下了"但文件是空的——记账不是记印象，差一个字都不行。

## 群隔离怎么实现

工具的 `session_id` 是 Hermes 注入的上下文，其值就是我们通过
`X-Hermes-Session-Id` 传的 `lifeguard-group-<群id>`。
所以工具天然知道自己在服务哪个群，不需要模型传 group_id（实测已验证）。
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("lifeguard.tools")

# 插件自己的配置。刻意不读 ~/.hermes/.env——Hermes 不会把 .env 导出到
# 进程环境（实测 /proc/<pid>/environ 里没有那些变量），读它只会拿到空值。
_CONFIG_PATH = Path(__file__).with_name("config.env")

_SESSION_RE = re.compile(r"lifeguard-group-(\d+)")

# ★ 创意工坊的**任务号**（2026-10-07 ✓）—— 会话 id 长这样：
#
#     lifeguard-group-3-diy-u2-t7
#                       ^^^^^^  ^
#                       谁      哪条对话
#
# 用途只有一个：`component_confirm` 把它一起报上去 ✓，票记住是**哪条对话**
# 派出去的 ✓，用户切走时按它作废 ✓（见 `routes_workshop.py` 的 `_void_tickets` ✓）。
#
# ⚠️ `_SESSION_RE` 是 `search` ✓，所以群号的新老两种会话都解析得出来 ✓；
#    这个任务号是**新加的** ✓，老会话（`…-diy-u2`）匹配不到 ✓ → 返回 None ✓，
#    而**拿不到任务号不影响做组件** ✓（票里留空 ✓，只是少一条链接 ✓）。
#    降级是设计的一部分 ✓，不是"加了个可能崩的东西" ✓。
_TASK_RE = re.compile(r"-diy-u\d+-t(\d+)")


def _load_config() -> dict[str, str]:
    cfg: dict[str, str] = {
        # ⚠️⚠️ **默认值必须是 8730** ✗→✓（2026-10-09 用户实测报的：
        #   「喵喵这边连不上生活管家后端啦，component_note / component_list
        #     都回「无法连接」——现在动不了 wall 的任何一笔」✓）。
        #   真因：合并之后**聊天服务搬到了 8730** ✓，而这个默认值还写着
        #   **8720**（合并前的旧后端 ✓）、每个 profile 的 `config.env` 里
        #   还写着 **8741**（合并后退役的那个 ✓）→ 插件**每一次调用**都撞在
        #   一个没人听的端口上 ✓ → `All connection attempts failed` ✓
        #   → 所有 lifeguard 工具**全哑** ✓（agent 那边只看到"无法连接" ✓）。
        #   ⚠️ 这个默认值只在"profile 里没有 config.env"时生效 ✓ ——
        #      所以**光改这儿不够** ✓，得把每个 profile 的实际值一起改 ✓
        #      （见 `tools/provision-workspace.sh` 和部署时写的那一份 ✓）。
        "LIFEGUARD_API_BASE": os.environ.get("LIFEGUARD_API_BASE", "http://127.0.0.1:8730"),
        "LIFEGUARD_INTERNAL_TOKEN": os.environ.get("LIFEGUARD_INTERNAL_TOKEN", ""),
    }
    # ⚠️ 读文件这一段**必须容错**。2026-10-04 它整个抛出去过：
    #    `[TOOL_ERROR] Tool execution failed: PermissionError: .../config.env`。
    #    模型看不懂、修不了，而且它的第一反应是"换个方式再试"，不是"这是权限问题"
    #    ——它当场就把工具调用改成 `cat config.env` 又撞一次墙。
    #    读不到就静默退回环境变量，后面那句"凭证未配置"至少是人话。
    try:
        text = _CONFIG_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        log.error("读不到插件配置 %s（%s）——lifeguard 工具会全部不可用", _CONFIG_PATH, exc)
        return cfg
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip()
    return cfg


def _group_id_from(session_id: str | None) -> int | None:
    if not session_id:
        return None
    m = _SESSION_RE.search(str(session_id))
    return int(m.group(1)) if m else None


def _task_id_from(session_id: str | None) -> int | None:
    """这条会话属于**创意工坊的哪条对话** ✓；不在工坊里、或者是老会话 → None ✓。

    ⚠️ **None 是正常值，不是错误** ✗ —— 群聊那条会话（`lifeguard-group-3` ✓）、
       迁移前的老工坊会话（`…-diy-u2` ✓）都返回 None ✓，而它们照样该能干活 ✓。
       所以调用方**不要**拿它去判"行不行" ✓（见 `_component_confirm` ✓）。
    """
    if not session_id:
        return None
    m = _TASK_RE.search(str(session_id))
    return int(m.group(1)) if m else None


async def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """调用后端内部接口。异常一律转成可读的错误串——工具抛异常会让
    agent 收到一堆栈信息，它既看不懂也修不了。"""
    import httpx

    cfg = _load_config()
    token = cfg["LIFEGUARD_INTERNAL_TOKEN"]
    if not token:
        return {"error": "lifeguard 内部凭证未配置（config.env 缺 LIFEGUARD_INTERNAL_TOKEN）"}

    url = cfg["LIFEGUARD_API_BASE"].rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, json=payload, headers={"X-Internal-Token": token})
        if resp.status_code >= 400:
            return {"error": f"后端返回 {resp.status_code}: {resp.text[:200]}"}
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        log.warning("调用 lifeguard 后端失败 %s: %s", path, exc)
        return {"error": f"无法连接 lifeguard 后端：{exc}"}


def _ok(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def _need_group(session_id: str | None) -> int | dict[str, Any]:
    gid = _group_id_from(session_id)
    if gid is None:
        return {"error": f"无法从会话标识推断群 id（session_id={session_id!r}）"}
    return gid


def _fail(res: dict[str, Any]) -> str | None:
    """后端返回 error 时把它原样交给模型——那句话是**写给它看的**，
    写清楚了它错在哪、下一步该干什么。糊成"后端返回 400"它就只会开始乱试。"""
    if isinstance(res, dict) and res.get("error"):
        return _ok({"ok": False, "error": res["error"]})
    return None


# ── 结构化记录 ────────────────────────────────────────────────────────

_RECORD_ADD_SCHEMA = {
    "description": (
        "往某个类型的结构化记录里加一条。**记账就用这个，类型是 bookkeeping**。"
        "字段名必须和该类型已登记的完全一致；不确定有哪些字段就先调 record_kinds 看看。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "description": "记录类型，如 bookkeeping。不确定就先用 record_kinds 列出来"},
            "fields": {
                "type": "object",
                "description": (
                    "这条记录的字段。bookkeeping 的字段："
                    "amount（数字，必填。正数=支出，负数=收入/退款，单位元）、"
                    "category（分类，如 餐饮/购物/出行/居住/通讯/衣服/人情/计生/零食/水果/运动/收入/其他；新分类可直接写）、"
                    "note（备注）、spent_at（发生时间，YYYY-MM-DD 或 unix 秒，不填=现在）。"
                    "「昨天」这种相对说法**你自己换算好**再传。"
                ),
            },
        },
        "required": ["kind", "fields"],
    },
}


async def _record_add(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/records/add", {
        "group_id": gid,
        "kind": (args.get("kind") or "").strip(),
        "fields": args.get("fields") or {},
    })
    return _fail(res) or _ok(res)


_RECORD_QUERY_SCHEMA = {
    "description": (
        "查某个类型的结构化记录。**问花了多少钱、最近记了什么，用它——不要凭印象报数字。**"
        "会顺带返回该类型声明好的汇总（bookkeeping 给的是金额合计和分类合计）。"
        "**每条都会带 id**——要改、要删都靠那个 id。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "description": "记录类型，如 bookkeeping"},
            "days": {"type": "integer", "description": "查最近多少天。默认 30，查全部给 3650"},
        },
        "required": ["kind"],
    },
}


async def _record_query(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    try:
        days = int(args.get("days") or 30)
    except (TypeError, ValueError):
        days = 30
    res = await _post("/api/internal/tools/records/query", {
        "group_id": gid, "kind": (args.get("kind") or "").strip(), "days": days,
    })
    return _fail(res) or _ok(res)


# ── 改 / 删 / 撤销 ────────────────────────────────────────────────────
#
# 2026-10-04 补的。在那之前记录**只能加不能改**——用户说"这条记错了"，
# 我只能再记一笔对冲。现在能改了，而且**改之前的样子会留痕**，
# 所以可以放心答"原来记的是多少"。
#
# 一条要紧的：**先 `record_query` 拿到 id，再动手**。别凭印象猜 id。

_RECORD_UPDATE_SCHEMA = {
    "description": (
        "**改一条已经记下的记录。** 用户说「记错了」「金额不对」「不是那个分类」时用它。\n"
        "先 `record_query` 查到那条的 **id**，再把**要改的字段**传进来——"
        "没传的字段保持原样。要把某个字段清空就传 null。\n"
        "**返回里带 `was`（改之前的样子）**，用户问「原来是记的什么」时可以据此回答。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "record_id": {"type": "integer", "description": "record_query 里给出的 id"},
            "fields": {"type": "object", "description": "只放要改的字段，例如 {\"amount\": 58}"},
        },
        "required": ["record_id", "fields"],
    },
}


async def _record_update(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/records/update", {
        "group_id": gid,
        "record_id": int(args.get("record_id") or 0),
        "fields": args.get("fields") or {},
    })
    return _fail(res) or _ok(res)


_RECORD_DELETE_SCHEMA = {
    "description": (
        "**删一条记错的记录。**（不是「再记一笔对冲」——那会让账目里多出一条假的。）\n"
        "**删的是软删除**：对账不再算它，但行还留着、也留了痕。删错了调 `record_restore` 能回来。\n"
        "先 `record_query` 拿到 id。"
    ),
    "parameters": {
        "type": "object",
        "properties": {"record_id": {"type": "integer", "description": "record_query 里给出的 id"}},
        "required": ["record_id"],
    },
}


async def _record_delete(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/records/delete", {
        "group_id": gid, "record_id": int(args.get("record_id") or 0),
    })
    return _fail(res) or _ok(res)


_RECORD_RESTORE_SCHEMA = {
    "description": "把之前删掉的一条恢复回来（「刚才那条删错了」）。",
    "parameters": {
        "type": "object",
        "properties": {"record_id": {"type": "integer", "description": "那条记录的 id"}},
        "required": ["record_id"],
    },
}


async def _record_restore(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/records/restore", {
        "group_id": gid, "record_id": int(args.get("record_id") or 0),
    })
    return _fail(res) or _ok(res)


_RECORD_KINDS_SCHEMA = {
    "description": "列出这个群已经定义过哪些记录类型、各自有哪些字段。不确定用哪个类型时先看它。",
    "parameters": {"type": "object", "properties": {}, "required": []},
}


async def _record_kinds(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/records/kinds", {"group_id": gid})
    return _fail(res) or _ok(res)


_RECORD_DEFINE_SCHEMA = {
    "description": (
        "定义一个新的记录类型，或者给已有类型**加**字段。"
        "比如要开始记待办、纪念日、体重，就先用它建好结构，之后再 record_add。"
        "**只能往宽了长**：可以加字段，不能改已有字段的类型、也不能删字段——"
        "历史记录是按旧定义存的，改了就对不上。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "description": "类型名：英文小写字母开头，只含小写字母/数字/下划线，如 todo、anniversary"},
            "title": {"type": "string", "description": "中文显示名，如「待办」「纪念日」"},
            "fields": {
                "type": "object",
                "description": (
                    "字段定义。键是字段名（同样用英文标识符），值形如 "
                    '{"type": "number|string|time|bool", "required": true/false, "desc": "说明"}'
                ),
            },
            "summary": {
                "type": "object",
                "description": '可选。声明"这个类型要能汇总"，形如 {"sum": ["amount"], "group_by": ["category"]}',
            },
        },
        "required": ["kind", "fields"],
    },
}


async def _record_define(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    schema: dict[str, Any] = {"fields": args.get("fields") or {}}
    if args.get("title"):
        schema["title"] = args["title"]
    if args.get("summary"):
        schema["summary"] = args["summary"]
    res = await _post("/api/internal/tools/records/define", {
        "group_id": gid, "kind": (args.get("kind") or "").strip(), "schema": schema,
    })
    return _fail(res) or _ok(res)


# ── 主动说话 ──────────────────────────────────────────────────────────

_SAY_SCHEMA = {
    "description": (
        "**主动**往群里说一句——不因为谁叫你，而是你自己有话要说。"
        "比如你答应过要提的事、时间到了该说的事、或者你确实想到了什么有用的。"
        "**少用**：有这个能力不代表该经常用。用户没在跟你说话时，绝大多数情况下不该开口。"
        "想清楚了再说，别用它刷存在感。"
    ),
    "parameters": {
        "type": "object",
        "properties": {"text": {"type": "string", "description": "要说的话"}},
        "required": ["text"],
    },
}


async def _group_say(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    text = (args.get("text") or "").strip()
    if not text:
        return _ok({"ok": False, "error": "text 不能为空"})
    res = await _post("/api/internal/tools/say", {"group_id": gid, "text": text})
    return _fail(res) or _ok(res)


# ── 发图（2026-10-11 用户报的「管家和 diy 助手没法给我发图片」）───────────
#
# ⚠️ **它一直"知道图在哪"，只是发不出去** ✗ —— 这正是用户的原话：
#    「主要是他知道图在哪的时候却发不出来」✓。
#    所以这一条**不解一个新的难题** ✓：三种来源最后都落到"磁盘上一个文件" ✓：
#      · 它自己截的图（截图那条路会把文件写到盘上 ✓）
#      · 它工作区里的图 ✓
#      · 你发过的那张（`look_at_image` 早就把 path 给它了 ✓）
#
# ⚠️ **为什么读文件这一步在插件里、不在后端** ✗ ——
#    后端跑在 `lifeguard` 账号下 ✓，**读不到 agent 那边的文件** ✓
#    （"代码归 root、两边分账号"的代价之一 ✓）；
#    而插件**跑在 Hermes 进程里** ✓，读得到自己的文件 ✓。
#    → 分工：**这边读字节 ✓，后端只负责存和发 ✓**（见 `internal.py` 那段 ✓）。
_SEND_PHOTO_SCHEMA = {
    "description": (
        "把一张图片发给用户（主群聊、组件对话里都能发）。"
        "path 是本机图片文件的路径：你自己截的图、你工作区里的图、"
        "或者用户之前发过的哪一张（look_at_image 会给你 path）都行。"
        "caption 可选，配一句话。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "图片文件的本地路径"},
            "caption": {"type": "string", "description": "配的一句话（可不填）"},
        },
        "required": ["path"],
    },
}

#: 按**后缀**认 mime ✓ —— 文件就在手边 ✓，后缀是最省事也最准的线索 ✓
#: （和后端那张表**一一对应** ✓：这边认了、那边不认，就会白跑一趟 ✓）。
_MIME_BY_EXT = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif",
}
_MAX_PHOTO = 12 * 1024 * 1024


async def _send_photo(args: dict, session_id: str | None = None, **_: Any) -> str:
    import base64

    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    raw = str(args.get("path") or "").strip()
    if not raw:
        return _ok({"ok": False, "error": "path 要给一个图片文件的路径"})
    p = Path(raw).expanduser()
    if not p.is_file():
        return _ok({"ok": False,
                    "error": (f"找不到这个文件：{raw}。"
                              f"要给它一个**真实存在**的图片文件路径 —— "
                              f"截图/生成完确认一下它落在哪，再把这个路径传进来。")})
    mime = _MIME_BY_EXT.get(p.suffix.lower())
    if not mime:
        return _ok({"ok": False,
                    "error": (f"这个后缀发不了：{p.suffix or '（没有后缀）'}。"
                              f"图得是 png / jpg / jpeg / webp / gif 这几种 —— "
                              f"别的先转成其中一种再发。")})
    size = p.stat().st_size
    if not size:
        return _ok({"ok": False, "error": "这个文件是空的"})
    if size > _MAX_PHOTO:
        return _ok({"ok": False,
                    "error": (f"这张图太大了（{size // 1024 // 1024}MB），"
                              f"上限 {_MAX_PHOTO // 1024 // 1024}MB —— "
                              f"先压小或裁一下再发。")})
    payload: dict[str, Any] = {
        "group_id": gid,
        "data_b64": base64.b64encode(p.read_bytes()).decode("ascii"),
        "mime": mime,
        "caption": str(args.get("caption") or "").strip(),
    }
    # ★ **工坊那条对话要带上任务号** ✓ —— 后端据此把消息落进那条对话、
    #   并且**只推给那个人** ✓（工坊是你一个人对着它 ✓，
    #   所以工坊里发的图**不会冒到主群聊** ✓，反过来也一样 ✓）。
    tid = _task_id_from(session_id)
    if tid is not None:
        payload["task_id"] = tid
    res = await _post("/api/internal/tools/send-image", payload)
    return _fail(res) or _ok({"ok": True, **res})


# ── 发表情（2026-10-27）───────────────────────────────────────────────
#
# ★ **清单只有一份** ✓：`/opt/lifeguard-chat/app/static/stickers/stickers.json`。
#   这里的枚举、名字都从它读 ✓ —— 以后加表情只改清单 + 图，
#   **不要在这份代码里再抄一遍编号** ✗（抄了就会有一天对不上 ✓）。
#   ⚠️ 读不到清单时用下面的兜底 ✓ —— 插件加载失败会让**所有工具**一起没 ✓，
#      这个代价太大，不能因为一份 JSON 就炸 ✗。
_STICKER_MANIFEST = Path("/opt/lifeguard-chat/app/static/stickers/stickers.json")

_FALLBACK_STICKERS = [
    {"id": "301", "name": "早安"}, {"id": "302", "name": "记账啦！"},
    {"id": "303", "name": "真棒"}, {"id": "304", "name": "辛苦啦"},
    {"id": "305", "name": "早点休息"}, {"id": "306", "name": "摸摸头"},
]


def _butler_stickers() -> list[dict]:
    try:
        data = json.loads(_STICKER_MANIFEST.read_text(encoding="utf-8"))
        items = [s for s in data.get("stickers", [])
                 if isinstance(s, dict) and s.get("owner") == "butler"]
        if items:
            return items
    except (OSError, ValueError, TypeError) as exc:  # noqa: BLE001
        log.warning("读表情清单失败，用兜底列表：%s", exc)
    return _FALLBACK_STICKERS


_BUTLER_STICKERS = _butler_stickers()
_BUTLER_STICKER_IDS = [str(s["id"]) for s in _BUTLER_STICKERS]
_STICKER_CHOICES = "；".join(
    f"{s['id']} {s.get('name') or ''}".strip() for s in _BUTLER_STICKERS)

_SEND_STICKER_SCHEMA = {
    "description": (
        "发一张你自己的「猫猫管家」表情。只能发 3xx 这一套；"
        "1xx 医生猪猪、2xx 程序猪猪是群友的，不能发。"
        "表情是补充语气，别刷屏，也别拿它代替该说的回答。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sticker_id": {
                "type": "string",
                "enum": _BUTLER_STICKER_IDS,
                "description": "发哪一张：" + _STICKER_CHOICES,
            },
        },
        "required": ["sticker_id"],
    },
}


async def _send_sticker(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    sid = str(args.get("sticker_id") or "").strip()
    if sid not in _BUTLER_STICKER_IDS:
        return _ok({"ok": False,
                    "error": (f"你没有编号 {sid or '（空）'} 这个表情。"
                              f"你能发的只有：{_STICKER_CHOICES}。")})
    res = await _post("/api/internal/tools/send-sticker",
                      {"group_id": gid, "sticker_id": sid})
    return _fail(res) or _ok({"ok": True, **res})


# ── 提醒 ──────────────────────────────────────────────────────────────

_REMINDER_ADD_SCHEMA = {
    "description": (
        "设一个提醒。到点系统会唤起你，由你在那个时刻决定说什么、怎么说。"
        "所以 text 写的是**提醒什么事**（比如「提醒两人今天记账了没有」），"
        "不是最终要发的那句话。重复的每日提醒用 hour+minute+repeat_daily。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "提醒什么事，例如「提醒两人记账」"},
            "in_minutes": {"type": "integer", "description": "多少分钟后提醒一次"},
            "hour": {"type": "integer", "description": "几点（0-23，服务器本地时区），配 repeat_daily 就是每天这个点"},
            "minute": {"type": "integer", "description": "几分（0-59）"},
            "repeat_daily": {"type": "boolean", "description": "是否每天重复"},
        },
        "required": ["text"],
    },
}


async def _reminder_add(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    payload = {"group_id": gid, "text": (args.get("text") or "").strip()}
    for k in ("in_minutes", "hour", "minute", "repeat_daily"):
        if args.get(k) is not None:
            payload[k] = args[k]
    res = await _post("/api/internal/tools/reminders/add", payload)
    return _fail(res) or _ok(res)


_REMINDER_LIST_SCHEMA = {
    "description": "看看这个群现在有哪些提醒（含时间、是否重复、是否还生效）。要取消或改之前先用它拿 id。",
    "parameters": {"type": "object", "properties": {}, "required": []},
}


async def _reminder_list(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/reminders/list", {"group_id": gid})
    return _fail(res) or _ok(res)


_REMINDER_CANCEL_SCHEMA = {
    "description": "取消一个提醒。id 从 reminder_list 里拿。",
    "parameters": {
        "type": "object",
        "properties": {"reminder_id": {"type": "integer", "description": "reminder_list 给出的 id"}},
        "required": ["reminder_id"],
    },
}


async def _reminder_cancel(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/reminders/cancel", {
        "group_id": gid, "reminder_id": int(args.get("reminder_id") or 0),
    })
    return _fail(res) or _ok(res)


# ── 改这个 App（外观 / 行为 / 代码 / 重启 / 回滚）—— **2026-10-07 深夜整个挪走了** ──
#
# ★ 原来这里装着 10 个工具（`set_app_theme` / `clear_app_theme` / `set_app_script` /
#   `clear_app_script` / `app_preview` / `app_logs` / `snapshot_app` / `restart_backend` /
#   `rollback_app` / `restore_shell`）✓ —— 现在**一个都不在这儿** ✗ ✓。
#
# ⚠️ **为什么挪** ✗→✓：生活管家**每个群都有一个** ✓，而它们全是**非管理员** ✓ ——
#    让每个群的管家都能改代码、重启后端、回滚整份仓库，本来就不该 ✓。
#    那是 **App 管家**的活儿 ✓，而它**只属于管理员** ✓（见 `hermes-plugin/app-butler-tools/` ✓）。
#
# ⚠️ **「告诉它可以做」不如「给它一个叫这个动作的工具」** ✓ —— 反过来也成立 ✓：
#    **不想让它做，就别把那个工具放在它的抽屉里** ✗ ✓（SOUL 里写一句"不归你"是
#    请求，不是闸门 ✓ —— 这个项目的老规矩 ✓）。

# ── 看图 ──────────────────────────────────────────────────────────────

_IMAGE_SCHEMA = {
    "description": (
        "拿到某张图片的本地路径，好让你能再看见它。"
        "你在对话里看到 `[图片 #157]` 这种标记——那说明那条消息里有图，"
        "但图片本身不会一直留在你的上下文里，过了那一轮你就看不见了。"
        "想回忆某张图、或者用户问起某张早先发的图，用它按 id 取路径，"
        "**再把路径传给 `vision_analyze` 真的看一眼**。"
        "比凭印象猜强得多——「上次那张图」到底是哪张，猜错会很难看。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "message_id": {"type": "integer", "description": "消息 id，就是 `[图片 #157]` 里的那个数字"},
        },
        "required": ["message_id"],
    },
}


#: 图片落到这儿 ✓ —— **agent 自己那块地方**（profile 家目录下的 `cache/` ✓）。
_IMG_DIR = ("cache", "lifeguard-images")


def _profile_home() -> Path:
    """这个插件所在的 **profile 家目录** ✓。

    ⚠️ **从自己的文件路径推** ✗→✓ —— 不读环境变量 ✓：
       插件就住在 `<家>/plugins/lifeguard-tools/__init__.py` ✓ → **上三级**就是家 ✓。
       环境变量在 gateway 进程里是什么、插件加载时还在不在 ✓，都不是我们能担保的 ✓；
       而 `__file__` 一定在 ✓。
    """
    return Path(__file__).resolve().parents[2]


def _prune_images(d: Path) -> None:
    """顺手清掉旧图 ✓ —— 每次调用做一次 ✓，不另开定时器 ✓。

    ⚠️ **不清就会一直堆** ✗（用户手机里那些照片一张几十 MB ✓）。
       按**一天**清 ✓：同一天里他会来回看同一张 ✓（文件名就是消息号 ✓，会复用 ✓）；
       隔天的再要看就重新调一次 ✓ —— 那本来也得重新调 ✓。
    """
    if not d.is_dir():
        return
    cutoff = time.time() - 86400
    for f in d.iterdir():
        try:
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


async def _look_at_image(args: dict, session_id: str | None = None, **_: Any) -> str:
    """★ **把一张历史图片变成"它看得见的东西"** ✓。

    ⚠️ **这里做的是"落地一个文件"** ✗→✓（2026-10-11 实测：这条路原来是断的）——
       原来是后端回一个**本地绝对路径** ✓、叫它交给 `vision_analyze` ✓，
       可**它读不到那个路径** ✗（媒体在 `lifeguard` 名下、`data/` 是 700 ✓）。
       现在后端回的是**字节** ✓（见 `internal.py` 那段 ✓），
       我们**写进自己的空间** ✓，那个路径才是它能读的 ✓。
    ⚠️ **别反过来去申请"读媒体目录"的权限** ✗ —— 那会把文件系统那层隔离整个拆掉 ✓；
       现在这样：**谁去取**换了个方向 ✓，门一点没松 ✓。
    """
    import base64

    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    try:
        mid = int(args.get("message_id"))
    except (TypeError, ValueError):
        return _ok({"ok": False, "error": "message_id 必须是数字"})
    res = await _post("/api/internal/tools/image", {"group_id": gid, "message_id": mid})
    bad = _fail(res)
    if bad:
        return bad
    raw = str(res.get("data_b64") or "")
    if not res.get("ok") or not raw:
        return _ok({"ok": False, "error": "后端没给出图片内容"})
    ext = str(res.get("ext") or ".jpg")
    # ⚠️ 后缀是后端给的没错 ✓，但它要**进文件名** ✓ → 形状再夹一道 ✓
    #    （`ext` 里要是带出个 `/` 或 `..` ✓，那就是一次路径穿越 ✓）。
    if not re.fullmatch(r"\.[A-Za-z0-9]{1,5}", ext):
        ext = ".jpg"
    d = _profile_home().joinpath(*_IMG_DIR)
    try:
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{mid}{ext}"
        p.write_bytes(base64.b64decode(raw))
    except Exception as exc:  # noqa: BLE001
        return _ok({"ok": False, "error": f"图片落地失败：{exc}"})
    _prune_images(d)
    # ★ **把真实像素尺寸告诉它** ✗→✓（2026-10-23：满盘菜看成空盘那次）
    #   它猜「整张图」是 1080×1080，于是给 vision_analyze 传了 `region [0,0,1080,1080]` ✓；
    #   可原图是 3072×4096 ✓ —— 那一刀只裁到**左上角的盘沿** ✓，
    #   模型照实说「白盘子 + 酱汁残渣」✓，它再一转述就成了「吃完了」✗。
    #   ⚠️ 光说「别裁剪」不够 ✓：它当初裁就是因为**不知道原图多大** ✓。
    w = h = None
    try:
        from PIL import Image as _PILImage
        with _PILImage.open(p) as _im:
            w, h = _im.size
    except Exception:  # noqa: BLE001 —— 拿不到尺寸不能挡着看图 ✗
        pass
    size_note = f"这张图是 {w}×{h} 像素。" if (w and h) else ""
    return _ok({
        "ok": True,
        "path": str(p),
        "sender": res.get("sender"),
        "at": res.get("at"),
        "size_bytes": res.get("size_bytes"),
        **({"width": w, "height": h} if (w and h) else {}),
        "hint": (size_note +
                 "要看清内容，把这个 path 传给 vision_analyze 看**整张**。"
                 "⚠️ 看整图时**别传 region** —— region 是按原图像素裁一块，"
                 "没看整图就裁，很容易只看到一个角（满盘菜看成空盘就是这么来的）。"
                 "只有已经看过整张、要再盯某个小字/细节时才用 region。"
                 "想让它更准就把你真正关心的事写进 question，别只问「这是什么」。"),
    })


# ── "有没有新消息"不在这里 ─────────────────────────────────────────
#
# 这里曾经有个 `check_new_messages`，让它定稿前自己查一眼。**整个删掉了**——
# 那是"拉"：查不查由它决定（实测 3 轮里只查了 1 次，会漏），而且那次查出来是空的
# （`{"count": 0}`），白花一整次 18.6K 的往返。
#
# 现在改成"推"：只要它思考期间真的来了新消息，**编排层一定把新的送回去让它判断**，
# 漏不掉，而且只在真有消息时才花那一次往返。见 app/orchestrator/agent.py 的 run_turn。


# ── 注册 ──────────────────────────────────────────────────────────────

# ── 创意工坊：做组件（2026-10-07）────────────────────────────────────────
#
# ## 这套工具存在的理由
#
# SOUL.md 里早先写的是"组件就是文件，你直接写就行" ✗ —— 那是把**路径**交给它 ✓，
# 而这个项目已经为此栽过一次（见上面 `set_app_theme` 那段原话：
# *"说了之后它仍然跑去改 index.html…30 个工具回合折腾完也没干成"* ✓）。
#
# 而且现在组件仓库**对 agent 只读** ✓（`2750`，见 `tools/deploy-chat.sh` ✓）——
# 它**写不进** ✓，所以"写文件"这条路本来也走不通了 ✓。
#
# ## 流程（用户在创意工坊里确认细节之后）✓
#
#     component_confirm(slug, brief)          → 拿到一张票 + 一个暂存路径
#     delegate_task(让子代理把 HTML 写进那个路径)  ← 主对话看不到正文
#     component_save(token, title, icon, note, data)   ← 凭票落成（**未固化**的一版）
#
# ⚠️ **子代理不能调这些工具** ✗ —— 它的会话标识里没有群号 ✓
#    （`_need_group` 会失败 ✓）。所以收尾那一步**必须主对话来做** ✓，
#    而 `component_save` 的群号**从票里反查** ✓（见后端那段 ✓）。
_COMPONENT_CONFIRM_SCHEMA = {
    "description": (
        "**用户确认了组件需求之后**调这个 —— 它会发一张「票」，并且开一个暂存文件。\n"
        "⚠️ 什么时候调：用户已经把**要什么**说清楚了（你问过、他答过），"
        "你**不再需要澄清**了。别在还没问清的时候就调 ✗。\n"
        "问的是**体验**（给谁看、想看什么、多久看一次），**不是技术细节** ✗ ——"
        "用户不需要知道 HTML 还是 CSS。\n"
        "返回里给你的 `token` 和 `handle`：\n"
        "  · `handle` 原样交给子代理，让它把**整份 HTML 写进那个文件**\n"
        "  · `token` 等你调 `component_save` 时**原样带上**\n"
        "⚠️ 两个都一个字别改 ✗。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "slug": {"type": "string",
                     "description": ("英文短名，小写字母/数字/连字符，≤32 位，"
                                     "例如 bookkeeping-panel。**不能用中文** ✗")},
            "brief": {"type": "string",
                      "description": ("用户确认下来的那句需求，一两句话。"
                                      "这句话会原样交给子代理（它看不到你们的对话）")},
        },
        "required": ["slug", "brief"],
    },
}

_COMPONENT_SAVE_SCHEMA = {
    "description": (
        "**子代理写完之后调这个** —— 把那个暂存文件落成创意工坊里的一版组件。\n"
        "⚠️ 先确认子代理**真的写完了**（它得回过来说写好了）✗。\n"
        "落成之后它是**未固化**的一版 ✓ —— **还不算数** ✗：要用户在创意工坊里点"
        "「保留」才定下来 ✓。所以**别跟用户说「已经保留 / 已经能用了」** ✗。\n"
        "⚠️ 这个工具**不收 HTML** ✗ —— 正文在那份暂存文件里 ✓，"
        "你只管把 token 和几个说明字段带过来 ✓。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "token": {"type": "string", "description": "component_confirm 给你的那张票，原样带过来"},
            "title": {"type": "string", "description": "给人看的中文标题，例如「记账面板」"},
            "icon": {"type": "string",
                     "description": ("一个 emoji 当图标，例如 💰。"
                                     "**也可以是一张你自己画的图** ✓ —— "
                                     "把 SVG 写成 "
                                     "`data:image/svg+xml;base64,<base64>` 传进来就行"
                                     "（⚠️ 必须 base64 ✓，上限 24KB ✓；"
                                     "**不能给网址** ✗ —— 沙箱里取不到外面）")},
            "note": {"type": "string",
                     "description": ("这个组件的**工程笔记**（给以后的你看的）：这版为什么这么做、"
                                     "试过什么不行的、还有什么没做。**不是你在群里的第二套记忆** ✗ ——"
                                     "群成员偏好那些归你的内置记忆。")},
            "data": {"type": "object",
                     "description": ("它要什么数据。现在只支持 "
                                     '{"records": {"kind": "bookkeeping", "days": 30}}。'
                                     "⚠️ 别声明服务端不会取的种类 ✗（那会让组件里一片空白）")},
            # ★ 它在**组件容纳界面**里怎么摆（2026-10-07 晚上加 ✓）——
            #   用户明说的：「每次组件创意时，都要问的一件事是如何在组件容纳界面展示」✓。
            #   所以**问过再填** ✓；没问的话就填默认那个 ✓（别编 ✓）。
            "spot": {"type": "object",
                     "description": ("它在**组件容纳界面**（群聊右上角那张表）里长什么样。"
                                     "形状："
                                     '{"w": 1, "h": 1, "tint": "#22334d"}。'
                                     "`w`/`h` 是占几个格子（1-3，默认 1×1 = "
                                     "上面图标、下面名字，跟手机桌面一样）；"
                                     "`tint` 是可选底色，**必须**是 #rrggbb 那种写法 "
                                     "（别的写法会被丢掉）。"
                                     "⚠️ 这个是**问过用户**再填的 ✗ —— 他说随便，你就自己定一个 ✓。")},
        },
        "required": ["token"],
    },
}

_COMPONENT_LIST_SCHEMA = {
    "description": (
        "这个群已经有哪些组件、各自到哪一步（已保留 / 未固化 / 旧版）。\n"
        "用户说「改一下那个记账面板」「上次那个还在吗」之前**先调它** ✓ —— 别凭印象 ✗。\n"
        "只回摘要行；要看某一个的细节（历史版本、工程笔记）再调 component_note。"
    ),
    "parameters": {"type": "object", "properties": {}},
}

_COMPONENT_NOTE_SCHEMA = {
    "description": (
        "某一个组件的**工程笔记**（历次版本的说明 + 做的时候记下来的东西）。\n"
        "**改动已有的组件之前先读它** ✓ —— 里面记着「这版为什么这么做」「试过什么不行的」，"
        "读了才不会把上一版踩过的坑再踩一遍。"
    ),
    "parameters": {
        "type": "object",
        "properties": {"slug": {"type": "string", "description": "组件的英文短名（component_list 里有）"}},
        "required": ["slug"],
    },
}


async def _component_confirm(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/components/confirm", {
        "group_id": gid,
        "slug": (args.get("slug") or "").strip(),
        "brief": (args.get("brief") or "").strip(),
        # ★ 这条对话是哪一条（2026-10-07 ✓）—— 服务端拿它把票绑到对话上 ✓，
        #   用户切走时按它作废 ✓。**解析不出来就是 None** ✓，照常开工 ✓。
        "task_id": _task_id_from(session_id),
    })
    return _fail(res) or _ok(res)


async def _component_save(args: dict, session_id: str | None = None, **_: Any) -> str:
    # ⚠️ **这里故意不调 `_need_group`** ✗→✓ —— 群号在**票**里 ✓，
    #    由服务端反查 ✓。理由：真正写文件的是**子代理** ✓，
    #    而它的会话标识里没有群号 ✓（2026-10-07 实测）——
    #    收尾这一步不能依赖会话 ✓。
    res = await _post("/api/internal/tools/components/save", {
        "token": (args.get("token") or "").strip(),
        "title": (args.get("title") or "").strip(),
        "icon": (args.get("icon") or "").strip(),
        "note": (args.get("note") or "").strip(),
        "data": args.get("data") if isinstance(args.get("data"), dict) else None,
        # ★ 它在容纳界面里怎么摆 ✓（收拾和兜底在服务端 ✓，坏的一律当默认 ✓）。
        "spot": args.get("spot") if isinstance(args.get("spot"), dict) else None,
    })
    return _fail(res) or _ok(res)


async def _component_list(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/components/list", {"group_id": gid})
    return _fail(res) or _ok(res)


async def _component_note(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/components/note", {
        "group_id": gid, "slug": (args.get("slug") or "").strip(),
    })
    return _fail(res) or _ok(res)


# ★ 「组件界面」自己的外观（2026-10-08）—— **只有「组件界面diy」那条对话能用** ✓
#
# 用户原话：「提供一个默认组件聊天入口，名字叫[组件界面diy]，这个聊天甚至可以
#   自行diy[组件]界面本身，由于本身就是基本空白，因此可以自由天马行空，
#   甚至将提示的字都去掉，注意，**只有这一个入口可以提供此功能**」✓。
#
# ⚠️ **"只有这一个入口"不是靠这两句描述保住的** ✗ —— 闸门在服务端 ✓：
#    它拿 `task_id` 去查"这条任务的 slug 是不是 `wall`" ✓（`_wall_task_ok` ✓），
#    不是的话直接拒 ✓。提示词里写"只有你能"是**请求**不是闸门 ✓（这个项目的老结论 ✓）。
_WALL_SET_SCHEMA = {
    # ⚠️ **这一行是必需的、不是装饰** ✗→✓（2026-10-11 抓到的真 bug）——
    #    `register()` 里有一句 `schema["description"][:80]` ✓，没有它就 **KeyError** ✓ →
    #    **整个插件加载失败** ✓（`lifeguard-tools` 的工具**一个都不注册** ✗，
    #    记账、提醒、说话、做组件全没了 ✓），而且只在 gateway 启动时炸 ✓ —— **静默** ✓。
    #    这两个 schema 从 2026-10-08 加进来起就没有这一行 ✓，一直没人发现 ✓。
    "description": ("改「组件界面」（组件收纳页）自己的外观：写一段 CSS。"
                    "那一屏的容器 id 是 #workshop，随便改它里面的长相 —— "
                    "但**别去动 #workshop 本身的骨架属性**（定位、尺寸、层级），"
                    "那会让它不再盖住整屏。会覆盖上一次写的。"),
    # ⚠️ **`parameters` 这一层不能少** ✗→✓（2026-10-11，同一天抓到的**第二个**毛病）——
    #    另外 17 个 schema 全都是 `{"description": …, "parameters": {…}}` ✓，
    #    只有这两个**把 JSON Schema 直接摊在顶层** ✗ →
    #    交到 Hermes 手上的就是一个**没有 `parameters` 的工具** ✓（它认不出来的形状 ✓）。
    #    ⚠️ 这两处是**两个独立的错** ✓（少 `description` / 少 `parameters` 包装），
    #      只是恰好都在同两个 schema 上 ✓ —— 别以为修了一个另一个就好了 ✓。
    "parameters": {
        "type": "object",
        "properties": {
            "css": {"type": "string", "description":
                    "要写进 CSS 的内容。**必须用 `#workshop` 限定作用域**"
                    "（那一屏的容器 id 就是 `#workshop`）——不然会改到主群聊、我的、设置页。"
                    "例：`#workshop .canvas { gap: 22px; }` 或 "
                    "`#workshop .cell { border-radius: 999px; background: #1a2233; }`。"
                    "可以天马行空：渐变、动画（@keyframes）、阴影、字体、"
                    "甚至 `#workshop .wsempty { display:none }` 把那句提示藏掉。"},
            "note": {"type": "string", "description": "这次改了什么的简短说明（给人看）"},
        },
        "required": ["css"],
    },
}

_WALL_CLEAR_SCHEMA = {
    # ⚠️ 和上面 `_WALL_SET_SCHEMA` **同两个坑** ✓ —— 缺 `description` 或
    #    缺 `parameters` 包装，任一个都会让**整个插件加载失败** ✓。
    "description": "把「组件界面」的外观恢复成默认（清掉之前写的那段 CSS）。",
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {"type": "string", "description": "为什么恢复默认（一句话，给人看）"},
        },
    },
}


async def _wall_style_set(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/components/wall-set", {
        "group_id": gid,
        "task_id": _task_id_from(session_id),     # ★ 闸门靠它 ✓
        "css": args.get("css") or "",
        "note": args.get("note") or "",
    })
    return _fail(res) or _ok(res)


async def _wall_clear(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/components/wall-clear", {"group_id": gid})
    return _fail(res) or _ok(res)


# ── 规矩（每周上限 / 每周任务）—— 2026-11-22 ──────────────────────────
#
# 管家**每轮都能在系统提示里看到进度**（`rules.prompt_section()` ✓），
# 所以 `rule_list` 不是每天都要调的 ✓ —— 这里放的是**操作** ✓。
#
# ⚠️ 按**名字**操作，不按 id ✓ —— 后端回给模型的规矩不带 id ✓（免得它念出来）✓；
#    `rules_core` 先找全等、再找包含 ✓，说「奶茶」就能找到「奶茶小甜水」✓。
#    包含匹配万一撞上两条，后端会回一句"有两条都像"，让它把名字说全 ✓。

_RULE_ICONS = ["food", "drink", "run", "book", "moon", "heart", "star", "leaf", "spark", "clock"]

_RULE_LIST_SCHEMA = {
    "description": (
        "看这个群这周立了哪些规矩、各记了几次。"
        "系统提示里每轮已经带了进度，**一般不用调**；"
        "只有想知道上周之外的细节、或确认某条规矩是否还在时才用。"
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}


async def _rule_list(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/rules/list", {"group_id": gid})
    return _fail(res) or _ok(res)


_RULE_ADD_SCHEMA = {
    "description": (
        "给这个群立一条**每周**的规矩。两种："
        "kind=limit 是**上限**（「每周最多 2 次放纵餐」「最多 3 杯奶茶」），"
        "kind=task 是**任务**（「每周至少跑 3 次」「读 2 本书」）。"
        "他们说「以后每周……」「要不立个规矩」时就用这个。"
        "立之前先看看系统提示里有没有同名的，别立重了。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description":
                      "规矩的名字，短一点好认，比如「奶茶」「放纵餐」「跑步」。"
                      "不要写成一句话。"},
            "kind": {"type": "string", "enum": ["limit", "task"], "description":
                     "limit=每周不超过 N 次；task=每周至少 N 次。默认 limit。"},
            "target": {"type": "integer", "description":
                       "每周的次数上限/目标。比如「一周两杯奶茶」→ 2。"},
            "icon": {"type": "string", "enum": _RULE_ICONS, "description":
                     "界面上配的图标，按事情选：吃的 food、喝的 drink、运动 run、"
                     "读书 book、睡觉 moon、感情 heart、其他 star/leaf/spark/clock。"},
            "note": {"type": "string", "description": "一句备注（可空）"},
        },
        "required": ["title", "target"],
    },
}


async def _rule_add(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    payload = {
        "group_id": gid,
        "title": (args.get("title") or "").strip(),
        "kind": (args.get("kind") or "limit").strip().lower(),
        "target": args.get("target") or 1,
        "icon": (args.get("icon") or "star").strip().lower(),
        "note": (args.get("note") or "").strip(),
    }
    res = await _post("/api/internal/tools/rules/add", payload)
    return _fail(res) or _ok(res)


_RULE_LOG_SCHEMA = {
    "description": (
        "**记一次**：他们这周又喝了一杯奶茶 / 又吃了顿放纵餐 / 又跑了一次步 → 记上。"
        "上限规矩记超了也照样记（超了要让人看见）；任务规矩到顶就不再记。"
        "⚠️ **只有他们真的说了、或者给出明确事实，才记**；别替他们编打卡。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "哪条规矩，说名字就行（比如「奶茶」）"},
            "count": {"type": "integer", "description": "记几次，默认 1"},
            "note": {"type": "string", "description": "这次是什么（可空），比如「下午一杯霸王茶姬」"},
        },
        "required": ["title"],
    },
}


async def _rule_log(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    payload = {
        "group_id": gid,
        "title": (args.get("title") or "").strip(),
        "count": args.get("count") or 1,
    }
    if args.get("note"):
        payload["note"] = str(args["note"]).strip()
    res = await _post("/api/internal/tools/rules/log", payload)
    return _fail(res) or _ok(res)


_RULE_UNDO_SCHEMA = {
    "description": "**撤一次**：记错了（其实没喝 / 记重了）→ 把最近的那一次撤掉。",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "哪条规矩，说名字就行"},
            "count": {"type": "integer", "description": "撤几次，默认 1"},
        },
        "required": ["title"],
    },
}


async def _rule_undo(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/rules/undo", {
        "group_id": gid,
        "title": (args.get("title") or "").strip(),
        "count": args.get("count") or 1,
    })
    return _fail(res) or _ok(res)


_RULE_UPDATE_SCHEMA = {
    "description": (
        "改一条已有的规矩：改次数、改名字、从上限改成任务、换图标或备注。"
        "只传要改的那几项，其它不动。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "现在这条规矩的名字"},
            "new_title": {"type": "string", "description": "要改成的新名字（不改就不传）"},
            "kind": {"type": "string", "enum": ["limit", "task"], "description": "改成上限 limit / 任务 task"},
            "target": {"type": "integer", "description": "新的每周次数"},
            "icon": {"type": "string", "enum": _RULE_ICONS, "description": "换图标"},
            "note": {"type": "string", "description": "换备注；传空串就是清掉"},
        },
        "required": ["title"],
    },
}


async def _rule_update(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    payload: dict[str, Any] = {
        "group_id": gid,
        "title": (args.get("title") or "").strip(),
    }
    for k in ("new_title", "kind", "target", "icon", "note"):
        if args.get(k) is not None:
            payload[k] = str(args[k]).strip() if k in ("new_title", "kind", "icon", "note") else args[k]
    res = await _post("/api/internal/tools/rules/update", payload)
    return _fail(res) or _ok(res)


_RULE_REMOVE_SCHEMA = {
    "description": (
        "**结束**一条规矩（他们说不算了 / 换规矩了）。这条规矩和它这周的记录都不再显示；"
        "数据留着但看不到了。改了次数用 rule_update，别用这个。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "哪条规矩，说名字就行"},
        },
        "required": ["title"],
    },
}


async def _rule_remove(args: dict, session_id: str | None = None, **_: Any) -> str:
    gid = _need_group(session_id)
    if isinstance(gid, dict):
        return _ok(gid)
    res = await _post("/api/internal/tools/rules/remove", {
        "group_id": gid,
        "title": (args.get("title") or "").strip(),
    })
    return _fail(res) or _ok(res)


_TOOLS = [
    ("record_add", _RECORD_ADD_SCHEMA, _record_add, "📝"),
    ("record_query", _RECORD_QUERY_SCHEMA, _record_query, "🔎"),
    ("record_update", _RECORD_UPDATE_SCHEMA, _record_update, "✏️"),
    ("record_delete", _RECORD_DELETE_SCHEMA, _record_delete, "🗑"),
    ("record_restore", _RECORD_RESTORE_SCHEMA, _record_restore, "♻️"),
    ("record_kinds", _RECORD_KINDS_SCHEMA, _record_kinds, "📚"),
    ("record_define", _RECORD_DEFINE_SCHEMA, _record_define, "🧱"),
    ("group_say", _SAY_SCHEMA, _group_say, "💬"),
    ("look_at_image", _IMAGE_SCHEMA, _look_at_image, "🖼"),
    ("send_photo", _SEND_PHOTO_SCHEMA, _send_photo, "📤"),
    ("send_sticker", _SEND_STICKER_SCHEMA, _send_sticker, "😺"),
    # ★ 创意工坊（2026-10-07）—— 做组件的四个 ✓
    ("component_confirm", _COMPONENT_CONFIRM_SCHEMA, _component_confirm, "🧪"),
    ("component_save", _COMPONENT_SAVE_SCHEMA, _component_save, "📦"),
    ("component_list", _COMPONENT_LIST_SCHEMA, _component_list, "🗂"),
    ("component_note", _COMPONENT_NOTE_SCHEMA, _component_note, "📖"),
    # ★ 组件界面自己的外观（2026-10-08）—— 只有「组件界面diy」那条对话能调 ✓
    ("wall_style_set", _WALL_SET_SCHEMA, _wall_style_set, "🎨"),
    ("wall_clear", _WALL_CLEAR_SCHEMA, _wall_clear, "🧹"),
    ("reminder_add", _REMINDER_ADD_SCHEMA, _reminder_add, "⏰"),
    ("reminder_list", _REMINDER_LIST_SCHEMA, _reminder_list, "📋"),
    ("reminder_cancel", _REMINDER_CANCEL_SCHEMA, _reminder_cancel, "🗑"),
    # ★ 规矩（2026-11-22）—— 管家立 / 督 / 记 ✓
    ("rule_list", _RULE_LIST_SCHEMA, _rule_list, "📜"),
    ("rule_add", _RULE_ADD_SCHEMA, _rule_add, "🪧"),
    ("rule_log", _RULE_LOG_SCHEMA, _rule_log, "✅"),
    ("rule_undo", _RULE_UNDO_SCHEMA, _rule_undo, "↩️"),
    ("rule_update", _RULE_UPDATE_SCHEMA, _rule_update, "✏️"),
    ("rule_remove", _RULE_REMOVE_SCHEMA, _rule_remove, "🗑"),
]


#: ★ **这几个是"你自己内部的动作"** ✗→✓（2026-10-11 用户：
#:   「id 漏了…说创建了"××"类型的记录，这个按理也不该说，只说记住了就好」✓）。
#:
#: ⚠️ **为什么写在工具描述里、而不只是 SOUL** ✗ ——
#:   模型看到**工具 schema 的那一刻**，正是它准备调这个工具的时刻 ✓：
#:   提醒贴得越近越管用 ✓。而且这类"说漏"是**被工具返回勾出来的** ✓
#:   （返回里有什么，它就容易复述什么 ✓）——
#:   后端返回已经在收了 ✓（见 `internal.py` 那三处 ✓），
#:   这里再在同一处补一句"别汇报"，两头夹 ✓。
_INTERNAL_TOOLS = frozenset((
    "record_add", "record_define", "record_update", "record_delete", "record_restore",
    "reminder_add", "reminder_cancel",
))
_INTERNAL_NOTE = (
    "\n【别汇报】这是**你自己内部的动作** —— 跟他说一句「记下了」/「设好了」就够了，"
    "别说出你建了什么类型、编号是多少、存在哪儿 ✓。"
)


def register(ctx) -> None:
    for name, schema, handler, emoji in _TOOLS:
        # ⚠️ **复制一份再改** ✗ —— 那几个 schema 是模块级字典 ✓，
        #    就地改会把它们改脏（同一次加载里别处再读到就是改过的 ✓）。
        if name in _INTERNAL_TOOLS:
            schema = dict(schema)
            schema["description"] = schema["description"] + _INTERNAL_NOTE
        ctx.register_tool(
            name=name,
            toolset="lifeguard",
            schema=schema,
            handler=handler,
            is_async=True,
            description=schema["description"][:80],
            emoji=emoji,
        )
    log.info("lifeguard-tools 已注册 %d 个工具", len(_TOOLS))

