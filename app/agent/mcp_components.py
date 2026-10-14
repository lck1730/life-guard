#!/usr/bin/env python3
"""组件工具 MCP server（stdio / newline-delimited JSON-RPC 2.0）。

给 Claude Code 子进程用：把 lifeguard 的 internal 组件接口暴露成 4 个工具，
让 claude 能读组件笔记、开工起票、凭票落版、列组件 —— 落盘走正规
``components/save``（版本自增 / 票据 / 校验 / DB 记录全不绕过）。

★ 鉴权凭据 ``LG_INTERNAL_TOKEN``、群号 ``LG_GROUP_ID``、后端地址
  ``LIFEGUARD_API_BASE`` 都从 spawn env 读 —— 不落盘、不碰 ``.env`` 硬底线
  （token 由 lifeguard 后端从 ``settings.internal_token`` 取了在 spawn 时塞进来）。

★ 这个文件是给 claude 子进程 ``--mcp-config`` 拉起的独立进程，**不是** lifeguard
  自己 import 的模块 —— 所以不依赖 lifeguard 的 app 包，只用 stdlib + httpx。
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

API_BASE = os.environ.get("LIFEGUARD_API_BASE", "http://127.0.0.1:8730").rstrip("/")
TOKEN = os.environ.get("LG_INTERNAL_TOKEN", "")
GROUP_ID = os.environ.get("LG_GROUP_ID", "")

# ★ 2026-10-13：不再起 claude 子进程 ✓ —— 编码执行器改成 httpx 直连，
#   工具派发**在进程内**调（agent.py import 本模块 ✓）。子进程那一套 env
#   （spawn 时塞 LG_INTERNAL_TOKEN / LG_GROUP_ID ✓）在进程内没有 ✓，
#   所以加这一份 `_CTX`：进程内路径调 `configure(...)` 覆盖 ✓，
#   子进程路径（已废弃 ✓，但文件留着不删）照旧读 env ✓。
_CTX: dict = {"token": TOKEN, "group_id": GROUP_ID, "api_base": API_BASE}


def configure(*, token: str, group_id, api_base: str) -> None:
    """进程内用：agent.py 调一次，把 token/群号/后端地址塞进来 ✓。"""
    _CTX["token"] = token
    _CTX["group_id"] = str(group_id)
    _CTX["api_base"] = (api_base or "").rstrip("/")


async def _post(path: str, payload: dict) -> dict:
    """照抄 ``provision/lifeguard-tools/__init__.py`` 里那套 ``_post``。"""
    token = _CTX["token"]
    if not token:
        return {"error": "LG_INTERNAL_TOKEN 未配置（进程内未 configure / spawn 时没传）"}
    gid = _CTX["group_id"]
    if gid and "group_id" not in payload:
        payload = {**payload, "group_id": int(gid)}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                _CTX["api_base"] + path,
                json=payload,
                headers={"X-Internal-Token": token},
            )
        if resp.status_code >= 400:
            return {"error": f"后端 {resp.status_code}: {resp.text[:200]}"}
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"连不上 lifeguard 后端：{exc}"}


TOOLS = [
    {
        "name": "list_components",
        "description": "列出本群所有组件（slug、标题、图标、各版本号、live/draft 版本）。无入参。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "read_component_note",
        "description": (
            "读某个组件的工程笔记 + 版本元数据（第几版、哪版最新、spot 摆放、NOTE 正文）。"
            "注意：不含 HTML 源码——HTML 用你的内置 Read 工具直接读 cwd 下的 "
            "`<slug>/v<版本>/index.html`。"
        ),
        "inputSchema": {"type": "object",
                         "properties": {"slug": {"type": "string"}},
                         "required": ["slug"]},
    },
    {
        "name": "read_component_html",
        "description": (
            "读某个组件**当前最新版**的完整 HTML 源码 ✗。改现成组件**必须先调它** ✗，"
            "在这份源码上改 ✗，别凭空重写 ✗（凭空重写会丢掉之前几版的修复 ✓）。"
            "配合 read_component_note 一起看：note 给的是笔记和版次，这个给的是真源码。"
        ),
        "inputSchema": {"type": "object",
                         "properties": {"slug": {"type": "string"}},
                         "required": ["slug"]},
    },
    {
        "name": "confirm_component",
        "description": (
            "开工：为某个组件开一张落版票（2 小时内一次性，用过即作废），返回 token。"
            "改或新建组件前必须先调它拿 token。"
        ),
        "inputSchema": {"type": "object",
                         "properties": {"slug": {"type": "string"},
                                        "brief": {"type": "string"},
                                        "task_id": {"type": "integer"}},
                         "required": ["slug", "brief"]},
    },
    {
        "name": "save_component",
        "description": (
            "凭票落版：把整份 HTML 写成该组件的新版本。token 来自 confirm_component。"
            "version 由服务端自增、group_id 从票反查——都不要传。data 声明形如 "
            '{"records":{"kind":"bookkeeping","days":90}}。'
        ),
        "inputSchema": {"type": "object",
                         "properties": {"token": {"type": "string"},
                                        "html": {"type": "string"},
                                        "title": {"type": "string"},
                                        "icon": {"type": "string"},
                                        "note": {"type": "string"},
                                        "data": {"type": "object"},
                                        "spot": {"type": "object"}},
                         "required": ["token", "html"]},
    },
    {
        "name": "set_wall_style",
        "description": (
            "改「组件界面」本身的外观（那张摆所有组件的表 ✓）。写一段 CSS，"
            "作用域**必须用 `#workshop` 限定**（例：`#workshop .cell { border-radius: 999px; }`），"
            "不然会改到主群聊 / 我的 / 设置页 ✗。生效不用重启 ✓。要恢复默认用 clear_wall_style ✓。"
        ),
        "inputSchema": {"type": "object",
                         "properties": {"css": {"type": "string"},
                                        "note": {"type": "string"}},
                         "required": ["css"]},
    },
    {
        "name": "clear_wall_style",
        "description": "清掉「组件界面」的外观 CSS、恢复默认 ✓。无入参 ✓。",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


async def call_tool(name: str, args: dict) -> dict:
    if name == "list_components":
        return await _post("/api/internal/tools/components/list", {})
    if name == "read_component_note":
        return await _post("/api/internal/tools/components/note",
                           {"slug": args.get("slug", "")})
    if name == "read_component_html":
        return await _post("/api/internal/tools/components/html",
                           {"slug": args.get("slug", "")})
    if name == "confirm_component":
        return await _post("/api/internal/tools/components/confirm",
                           {"slug": args["slug"], "brief": args.get("brief", ""),
                            "task_id": args.get("task_id")})
    if name == "save_component":
        keep = ("token", "html", "title", "icon", "note", "data", "spot")
        return await _post("/api/internal/tools/components/save",
                           {k: v for k, v in args.items() if k in keep})
    if name == "set_wall_style":
        # ⚠️ 路由前缀是 `/api/internal/tools` ✓（router prefix ✓）——
        #    上一版写成 `/api/internal/components/wall-set`（少 `/tools/`）✗，
        #    一直 404、wall 工具从没真调通 ✗。2026-10-13 修 ✓。
        return await _post("/api/internal/tools/components/wall-set",
                           {"css": args.get("css", ""), "note": args.get("note", "")})
    if name == "clear_wall_style":
        return await _post("/api/internal/tools/components/wall-clear", {})
    return {"error": f"未知工具：{name}"}


def _respond(req_id, result) -> None:
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req_id, "result": result}) + "\n")
    sys.stdout.flush()


def _error(req_id, code, msg) -> None:
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req_id,
                                 "error": {"code": code, "message": msg}}) + "\n")
    sys.stdout.flush()


async def handle(msg: dict) -> None:
    req_id = msg.get("id")
    method = msg.get("method", "")
    if method == "initialize":
        _respond(req_id, {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "lifeguard-components", "version": "1.0"},
        })
    elif method == "notifications/initialized":
        return  # notification，不回
    elif method == "tools/list":
        _respond(req_id, {"tools": TOOLS})
    elif method == "tools/call":
        params = msg.get("params", {}) or {}
        name = params.get("name")
        args = params.get("arguments", {}) or {}
        res = await call_tool(name, args)
        text = json.dumps(res, ensure_ascii=False)
        is_error = bool(res.get("error") or res.get("ok") is False)
        _respond(req_id, {"content": [{"type": "text", "text": text}],
                          "isError": is_error})
    else:
        _error(req_id, -32601, f"method not found: {method}")


async def main() -> None:
    loop = asyncio.get_event_loop()
    while True:
        # stdin 是阻塞的，扔到线程里读，别卡住事件循环
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            await handle(msg)
        except Exception as exc:  # noqa: BLE001
            _error(msg.get("id"), -32603, f"internal: {exc}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
