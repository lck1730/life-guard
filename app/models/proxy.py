"""`/v1/*` —— **给 Hermes 用的模型端点** ✓（每一次模型调用都从这儿过）。

## 它做的事只有三件

1. 读请求体，拿 `model` 那个字段（那是**用途名**：`chat`/`diy`/`aux` ✓）
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


@router.api_route("/v1/{path:path}",
                  methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def v1_proxy(path: str, request: Request):
    global _last_seen

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

    data = store.load()
    chosen, role = store.pick(data, want)
    if not chosen:
        # 说清楚**是哪一档缺** ✓ —— 泛泛一句"没配模型"等于让人自己猜三个槽哪个空着 ✗
        return JSONResponse(
            {"error": {"message": f"「{store.ROLE_LABEL[role]}」这一档还没选模型"
                                  "（App 的「设置 → 模型」里选一下）",
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
