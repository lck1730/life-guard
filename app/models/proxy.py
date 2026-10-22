"""`/v1/*` —— **给 Hermes 用的模型端点** ✓（每一次模型调用都从这儿过）。

## 它做的事只有三件

1. 读请求体，拿 `model` 那个字段（那是**用途名**：`chat`/`aux` ✓）
2. 查池子：这个用途指着哪套配置 ✓ → 把 `model` 换成**真模型名**、换上那套的 key
3. **原样流式转发** ✓，连同上游的错也原样回 ✓

## ⚠️ 三条踩过的东西，一条都不能省

- **先读 body、再挑配置** ✗→✓ —— "这一轮是哪个用途"写在 body 里 ✓，
  原来"先选配置后读 body"的顺序**拿不到它** ✓。
- **只改 `model` 一个字段** ✓，其余原样透传 —— **越少自作聪明越不容易坏** ✓。
- **必须真流式** ✗→✓ —— 原来那个独立服务靠 HTTP/1.0"关连接表示结束" ✓；
  现在用 `StreamingResponse` ✓，**绝不能先攒完再发** ✗
  （攒了的话 SSE 就不流了 ✓，Hermes 那边会一直等 ✓）。

## 为什么不鉴权

Hermes 拿一个**假的 key**（`local-models-gateway`）打过来 ✓，它没有 App 的登录票 ✓。
所以这条路**和原来一样不鉴权** ✓ —— 它的可达性和 8722 那个端口**完全一样** ✓
（只绑 127.0.0.1 + WireGuard ✓），**不是新开的口子** ✓。
"""
from __future__ import annotations

import json
import logging
import os
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from . import store

log = logging.getLogger("lifeguard.models")

router = APIRouter(tags=["models"])

#: 一轮对话可能很长 ✓（和原来那个服务一样给 600 秒 ✓）。
TIMEOUT = httpx.Timeout(600.0, connect=15.0)

#: 上一次在上游请求里看见的 `model` 名字（只为**去重日志**用 ✓，不参与任何判断 ✓）。
_last_seen: str | None = None

#: 上一次送下来的**工具名字集合**（同样只为去重日志 ✓）。
_last_tools: str | None = None

#: 请求体的落盘目录 ✓——只在**出事了**才去翻 ✗。
#:
#: ⚠️ **不能放 `/tmp`** ✗ —— 这个服务开了 `PrivateTmp=yes` ✓，
#: 它看到的 `/tmp` 是**它自己那份私有的** ✗，我们这边根本看不见 ✓
#: （2026-10-15 就在这儿栽了一次：落盘函数没报错、日志也没错，
#: 就是**文件在另一个文件系统里** ✗）。所以落到 App 自己的 var 目录 ✓。
_REQ_DUMP_DIR = "/opt/lifeguard-chat/var/hermes-reqs"

#: 开关是一个**标记文件** ✓：`touch var/reqs.dump` 就开，`rm` 就关 ✗。
#: 不用改代码、不用重启、不用动 systemd 单元 ✓ —— 平时关着，盘上不留聊天记录 ✗。
_REQ_DUMP_FLAG = "/opt/lifeguard-chat/var/reqs.dump"

#: 标记文件**刚**被删掉时打一行日志 ✓ —— 否则"我到底关没关"只能靠猜 ✗
#: （2026-10-15 就是靠猜，猜错了两次 ✗）。
_flag_seen: bool | None = None

#: 最多留几份 ✓（40G 的盘，别为诊断把它写满 ✗）。
_REQ_DUMP_KEEP = 6

#: 每条消息正文最多记多少字 ✓。
#: ⚠️ **别调太小** ✗ —— Hermes 的系统提示一份就有 2 万多字 ✓，
#: 我们想确认的「今天几号那句在不在里面」常常**拼在尾巴上** ✗。
#: 截在 8000 时它恰好被切掉 ✓，于是"搜不到"被误读成"没送出去" ✗ ——
#: 那是一种**比 bug 更贵的错**：按错的诊断去改代码 ✓。留 6 万字够用 ✓。
_MSG_KEEP = 60000


def _msg_view(m: dict) -> dict:
    """一条消息的**带正文**视图 ✓。

    ⚠️ 为什么要正文 ✗ —— "它不认我们说的今天几号"这种问题，
    **只有看到真正送出去的每个字才能定位** ✗：可能我们那句根本没进去 ✗，
    可能是 Hermes 在更前面又塞了一句日期 ✓，两种的修法完全相反 ✓。
    这些文件只在本机（不进公网 ✓）、只留 6 份 ✓，查完可以删 ✗。
    """
    c = m.get("content")
    if isinstance(c, list):            # 多模态：只看文字那几段
        c = "".join(str(p.get("text", "")) for p in c
                    if isinstance(p, dict) and p.get("type") == "text")
    c = str(c or "")
    return {"role": str(m.get("role")), "chars": len(c),
            "tool_calls": bool(m.get("tool_calls")),
            "content": c[:_MSG_KEEP] + ("…（截断）" if len(c) > _MSG_KEEP else "")}


def _dump_request(body: dict, want: str) -> None:
    """把上游送下来的请求体落一份 ✓。

    **为什么非得有这个东西** ✗→✓（2026-10-15 查「它为啥不查时间」那次）——
    模型不查时间，可能是**它手里没这个工具** ✗，也可能是**它有工具但装傻** ✓，
    也可能是**提示词里那句日期压根没送出去** ✗ ——
    这三种的**修法完全相反**，而只看响应**猜不出来** ✗。
    Hermes 自己那侧的日志（`agent.log`）一轮对话下来**只有一行 HTTP 200** ✗，
    工具的来龙去脉一个字都没有 ✗ —— 所以这儿是唯一能看见的地方 ✓。

    ⚠️ 平时**关着** ✓（标记文件不在就不写 ✗）—— 这些文件里是**真实的群聊内容** ✗，
    查完就删 ✗，别让"临时诊断"变成长期行为记录 ✗。
    """
    global _flag_seen

    on = os.path.exists(_REQ_DUMP_FLAG)
    if on != _flag_seen:                     # 只在那一下记一行 ✓
        _flag_seen = on
        log.info("上游请求落盘：%s（开关：%s）",
                 "打开" if on else "关闭", _REQ_DUMP_FLAG)
    if not on:
        return

    try:
        tools = body.get("tools") or []
        names = [t.get("function", {}).get("name")
                 for t in tools if isinstance(t, dict)]
        msgs = [_msg_view(m)
                for m in (body.get("messages") or []) if isinstance(m, dict)]
        dump = {"model_wanted": want, "model_sent": body.get("model"),
                "stream": bool(body.get("stream")),
                "tool_count": len(names), "tools": names,
                "messages": msgs,
                "extra_keys": sorted(k for k in body
                                      if k not in ("model", "messages", "tools",
                                                   "stream", "temperature",
                                                   "max_tokens"))}
        d = _REQ_DUMP_DIR
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            return
        files = sorted(os.listdir(d))
        if len(files) >= _REQ_DUMP_KEEP:      # 旧的先删 ✓，不然这份留不下
            for f in files[:len(files) - _REQ_DUMP_KEEP + 1]:
                try:
                    os.unlink(os.path.join(d, f))
                except OSError:
                    pass
        with open(os.path.join(d, f"{int(time.time())}-{want or 'none'}.json"),
                  "w") as fh:
            json.dump(dump, fh, ensure_ascii=False, indent=1)
    except Exception:  # noqa: BLE001 —— 诊断挂了不能把模型调用挂掉 ✗
        log.exception("请求体落盘失败")


@router.api_route("/v1/{path:path}",
                  methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def v1_proxy(path: str, request: Request):
    global _last_seen, _last_tools

    raw = await request.body()
    body = None
    if raw:
        try:
            body = json.loads(raw)
        except Exception:  # noqa: BLE001
            body = None

    want = str(body.get("model") or "").strip().lower() if isinstance(body, dict) else ""

    # ★ **上游到底送下来一个什么名字** —— 这一行是唯一能看见它的地方 ✓。
    #   为什么非看不可：Hermes 的 OpenAI 兼容面**默认不认调用方写的 `model`** ✓
    #   （`direct_model_requests` 默认 false ✓），它送下来的是**自己解析出来的那个** ✓。
    #   所以"用途这个信号能不能传下来"**不能靠读源码猜** ✓，只能看这一行 ✓。
    #   去重：同一个名字只记一次 ✓（换名字说明配置动过 ✓，正该记 ✓）。
    if want != _last_seen:
        _last_seen = want
        log.info("上游送下来的 model = %r", want)

    # ★ 和上面 `model` 那句同一个道理 ✓：**只看它送下来的是啥**，不猜 ✗。
    #   为什么非看不可：`current_time` 加了没加、Hermes 送没送出去 ✓
    #   —— Hermes 那侧一轮对话在 `agent.log` 里只剩一行 HTTP 200 ✗，
    #   工具的来龙去脉一个字都没有 ✗，"它为什么不调工具"只能在这里看 ✓。
    if isinstance(body, dict):
        _dump_request(body, want)
        names = sorted({str(t.get("function", {}).get("name") or "")
                        for t in (body.get("tools") or [])
                        if isinstance(t, dict) and t.get("function")})
        tool_key = ",".join(names)
        if tool_key != _last_tools:          # 去重 ✓ —— 每轮都记一遍等于没记
            _last_tools = tool_key
            log.info("上游送下来的工具 %d 个：%s",
                     len(names), tool_key or "（一个都没有）")

    data = store.load()
    chosen, role = store.pick(data, want)
    if not chosen:
        # 2026-10-22 起只有一个模型 ✓ —— 不再是"哪一档缺" ✗
        return JSONResponse(
            {"error": {"message": "还没选模型（App 的「设置 → 模型」里选一下）",
                       "type": "lifeguard_models"}},
            status_code=503)

    if want in store.ROLES:
        log.info("用途 %s → %s", role, chosen.get("name"))

    if isinstance(body, dict):
        body["model"] = chosen.get("model") or body.get("model")
        raw = json.dumps(body).encode()

    url = (chosen.get("base_url") or "").rstrip("/") + "/" + path.lstrip("/")
    headers = {
        "Authorization": f"Bearer {chosen.get('api_key') or ''}",
        "Content-Type": request.headers.get("content-type", "application/json"),
        "Accept": request.headers.get("accept", "*/*"),
        # ★★ **明确跟上游要"别压缩"** ✗→✓（2026-10-11 抓到的一个影响面很大的 bug）——
        #   见下面 `aiter_bytes` 那段 ✓。两条一起上，哪条都别单靠 ✓。
        "Accept-Encoding": "identity",
    }

    client = httpx.AsyncClient(timeout=TIMEOUT)
    try:
        up = await client.send(
            client.build_request(request.method, url, content=raw or None, headers=headers),
            stream=True)
    except Exception as e:  # noqa: BLE001
        await client.aclose()
        return JSONResponse(
            {"error": {"message": f"连不上上游：{e}", "type": "lifeguard_models"}},
            status_code=502)

    async def stream():
        try:
            # ★★ **`aiter_raw` → `aiter_bytes`** ✗→✓（2026-10-11）
            #
            #   ⚠️ **`aiter_raw()` 给的是"原样字节"，httpx 不解压** ✗ ——
            #      而 httpx 默认会跟上游说 `Accept-Encoding: gzip` ✓ →
            #      上游**压缩**了响应 ✓ → 我们原样转给 Hermes ✓，
            #      **却没有把 `Content-Encoding` 一起带上** ✗（回包的头只带了 content-type ✓）
            #      → 对面以为那是明文 ✓ → 当 utf-8 读 ✗ →
            #      `'utf-8' codec can't decode byte 0x8b in position 1` ✓✓
            #      （`1f 8b` 正是 gzip 的魔数 ✓）。
            #
            #   ⚠️ **为什么平时没炸** ✗：群聊那条走的是 **SSE 流式** ✓，
            #      而上游一般**不压** `text/event-stream` ✓ → 一路没事 ✓。
            #      **所有非流式的调用都会中** ✗ —— 2026-10-11 是"看图"（vision）
            #      第一个撞上的 ✓（它走非流式 ✓，而且用的正是我们这条网关 ✓）。
            #
            #   `aiter_bytes()` 会**按 `Content-Encoding` 自己解** ✓（而且是流式解、
            #   不攒整包 ✓）→ 我们转发出去的永远是**解压后的明文** ✓，
            #   和回包上的头（不带 content-encoding ✓）也就自洽了 ✓。
            async for chunk in up.aiter_bytes():
                yield chunk
        finally:
            await up.aclose()
            await client.aclose()

    return StreamingResponse(
        stream(),
        status_code=up.status_code,
        media_type=up.headers.get("content-type", "application/json"),
        headers={"Cache-Control": "no-store"},
    )
