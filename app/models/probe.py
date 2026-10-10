"""测一套配置能不能用 —— **分两档，第二档才是关键**。

① **连通**：发一次最小请求，看能不能拿到回复
② **能不能调工具**：带一个最简单的 `tools` 再发一次

②为什么值钱：有的模型/代理能聊天，但**把工具调用吐成一段文本** ✗（实测撞过 ✓）。
那种模型测连通性是"通"的，用起来却是废的 —— 管家说不做 ✓。

⚠️ ②**要测多次** ✗→✓：调不调工具带随机性 —— 同一个模型多测几次会一会儿"调了"
   一会儿"没调" ✓。单次采样给出的结论是"掷硬币" ✓，没法用来做决定
   （用户实测就是这么发现的："多测几次有时能有时不能" ✓）。
   所以跑 3 次报**命中率** ✓：3/3 → 稳；2/3 → 不稳；0/3 → 真的调不了 ✓。
"""
from __future__ import annotations

import json
import logging
import time

import httpx

log = logging.getLogger("lifeguard.models")

#: 界面底部的进度条读它 ✓（测一套要几秒到十几秒 ✓，不给反馈像卡死了 ✓）。
progress: dict = {"text": "", "at": 0.0}

_PROBE_TOOL = [{
    "type": "function",
    "function": {
        "name": "get_time",
        "description": "Return the current time.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}]
_TOOL_SAMPLES = 3
_TIMEOUT = 45.0


def _say(text: str) -> None:
    progress["text"] = text
    progress["at"] = time.time()
    log.info("%s", text)


def _call(cfg: dict, *, with_tools: bool) -> dict:
    body = {
        "model": cfg.get("model") or "",
        "messages": [{"role": "user",
                      "content": "调用 get_time 工具查一下现在几点。只调工具，不要用文字回答。"}],
        "max_tokens": 64,
        "stream": False,
    }
    if with_tools:
        body["tools"] = _PROBE_TOOL
        body["tool_choice"] = "auto"
    url = (cfg.get("base_url") or "").rstrip("/") + "/chat/completions"
    t0 = time.time()
    try:
        r = httpx.post(url, json=body, timeout=_TIMEOUT,
                       headers={"Authorization": f"Bearer {cfg.get('api_key') or ''}"})
        ms = int((time.time() - t0) * 1000)
        if r.status_code >= 400:
            return {"ok": False, "ms": ms,
                    "error": f"HTTP {r.status_code}: {r.text[:300]}"}
        data = r.json()
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        used_tools = bool(msg.get("tool_calls"))
        text = (msg.get("content") or "")[:200]
        if with_tools:
            if used_tools:
                # ⚠️ **这里必须显式写 `tools: True`** ✗→✓ ——
                #   踩过：第一版提前 return 时漏了这个字段 ✓，
                #   调用方 `b.get("tools")` 拿到 None → 判成 False ✓ →
                #   **能调工具的模型被报成"调不了"** ✗。**假阴性比假阳性更坏** ——
                #   它会让人把好模型换掉 ✓。
                return {"ok": True, "ms": ms, "tools": True, "detail": "调工具 ✓"}
            leaked = "<" in text and ("invoke" in text or "tool" in text.lower())
            return {"ok": True, "ms": ms, "tools": False,
                    "detail": ("没调工具，而是**吐了一段文字**" if leaked else "没调工具（回了文字）")
                              + f"：{text[:80]}"}
        return {"ok": True, "ms": ms, "tools": used_tools, "detail": text[:120] or "(空回复)"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "ms": int((time.time() - t0) * 1000),
                "error": f"{type(e).__name__}: {e}"}


def test_config(cfg: dict) -> dict:
    """跑一遍两档测试。**同步阻塞几秒到十几秒** ✓（界面靠 `progress` 轮询给反馈 ✓）。"""
    nm = cfg.get("name") or "这套"
    _say(f"正在测「{nm}」：连不连得上…")
    a = _call(cfg, with_tools=False)
    if not a.get("ok"):
        _say(f"「{nm}」连不上")
        return {**a, "summary": "不通"}

    hits, ms_list, last_detail = 0, [], ""
    for n in range(_TOOL_SAMPLES):
        _say(f"正在测「{nm}」：能不能调工具（{n + 1}/{_TOOL_SAMPLES}）…")
        r = _call(cfg, with_tools=True)
        if r.get("tools"):
            hits += 1
        if r.get("ms"):
            ms_list.append(r["ms"])
        last_detail = r.get("tools_detail") or r.get("detail") or r.get("error") or ""

    n = _TOOL_SAMPLES
    if hits == n:
        summary = f"通 ✓（调工具 {hits}/{n}）"
    elif hits:
        summary = f"通，但调工具**不稳**（{hits}/{n}）"
    else:
        summary = f"通，但**调不了工具**（{hits}/{n}）"
    _say(f"「{nm}」测完了：{summary}")
    return {
        "ok": True,
        "connect_ms": a.get("ms"),
        "tools_ms": int(sum(ms_list) / len(ms_list)) if ms_list else None,
        "tools": hits == n,          # 严格口径：全中才算"稳"
        "tools_hits": f"{hits}/{n}",
        "tools_any": hits > 0,
        "detail": a.get("detail", ""),
        "tools_detail": last_detail,
        "summary": summary,
    }
