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

import base64
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


def ping(cfg: dict, model: str) -> dict:
    """单个模型名，快速测一下 —— 设置页下拉里每一行右边那颗「测」用的。

    ★ 2026-10-22 加的（学「远程CC」的设置页）。
    - `test_config` 测的是**一整套方案**（要连测 3 次工具调用、十几秒）；
    - 这里测的是**这一套方案下的某一个模型名**（两次请求：连通 + 带工具），
      目标是快速给个 ✓/✗，不是统计命中率。

    ⚠️ **判的是"能不能调工具"，不是"能不能回话"** ——
       生活管家干活全靠工具；能聊天却不调工具的模型，症状是
       「它答应了但什么都没干」，比报错更难查。所以「没调工具」如实算 ✗。
    """
    c = {**cfg, "model": model}
    nm = c.get("name") or "这一套"
    _say(f"正在测「{nm}」· {model}：连不连得上…")
    a = _call(c, with_tools=False)
    if not a.get("ok"):
        return {"ok": False, "message": f"连不上：{(a.get('error') or '')[:90]}"}

    _say(f"正在测「{nm}」· {model}：能不能调工具…")
    r = _call(c, with_tools=True)
    if not r.get("ok"):
        return {"ok": False, "message": f"连上了，但带工具那一发失败：{(r.get('error') or '')[:90]}"}
    if r.get("tools"):
        return {"ok": True, "message": "通 ✓ 调工具"}
    return {"ok": False, "message": "通，但**没调工具**（回了文字）—— 干活会哑"}


#: 读图测试的超时 —— 比连通测试长得多 ✓：一张大图 + 会思考的模型（Agnes 那类）
#: 要好几秒到几十秒 ✓，给 45 秒会把"慢"报成"不通" ✗。
_VISION_TIMEOUT = 90.0

#: 读图测试的 `max_tokens` —— **不能给小** ✗→✓（实测：给 40 时 Agnes 把额度
#: 全花在 reasoning 上 ✓，`content` 是空的 ✓，看起来像"收不下图" ✗；
#: 给 200 就正常答"红色" ✓）。空回复的下场和"模型不收图"一模一样 ✓，
#: 所以宁可多给一点 ✓。
#: ★ 2026-10-23 再抬到 1500：商汤 flash-lite 是**会思考的** ✓，500 偶尔被
#:   reasoning 吃光（同一道题一会儿"红色，蓝色"、一会儿空 ✓）。
#:   **空回复 = 判成读不了图** ✗ —— 假阴性会把好模型挡在门外 ✗。
_VISION_MAX_TOKENS = 1500


def vision_test(cfg: dict, model: str, image: bytes, mime: str, prompt: str) -> dict:
    """拿**一张真图**去问这个模型 —— 看它到底收不收图、认不认得出来 ✓。

    为什么非要发图、不能只发一句话 ✗ —— "能不能看图"和"能不能聊天"是两回事 ✓：
    有的模型/代理**把 `image_url` 悄悄丢掉** ✓，照样回一句"我看到了" ✓，
    只有 `prompt_tokens` 从几百掉到二十几 ✓ —— 从回复文字上永远看不出来 ✗。
    所以这儿把 `usage` 里的 `image_tokens` **原样带回去** ✓：它大于 0 才说明图
    真的进去了 ✓（上游不给这个字段时回 None ✓，不假装是 0 ✗）。

    用的是**存下来的那把 key** ✓（key 不出服务端 ✓，界面只拿得到结果 ✓）。
    """
    b64 = base64.b64encode(image).decode("ascii")
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url",
             "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ]}],
        "stream": False,
    }
    url = (cfg.get("base_url") or "").rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {cfg.get('api_key') or ''}"}
    _say(f"正在用「{cfg.get('name') or ''}」· {model} 看图…")

    def ask(limit: int) -> tuple[dict, int]:
        b = {**body, "max_tokens": limit}
        t0 = time.time()
        r = httpx.post(url, json=b, timeout=_VISION_TIMEOUT, headers=headers)
        return r, int((time.time() - t0) * 1000)

    t0 = time.time()
    try:
        limit = _VISION_MAX_TOKENS
        r, ms = ask(limit)
        if r.status_code >= 400:
            _say(f"看图失败：HTTP {r.status_code}")
            return {"ok": False, "ms": ms,
                    "error": f"HTTP {r.status_code}: {r.text[:400]}"}
        d = r.json()
        ch = (d.get("choices") or [{}])[0] or {}
        msg = ch.get("message") or {}
        text = str(msg.get("content") or "").strip()
        # ★ 额度被思考吃光（finish=length、一个字没回）→ **再给一次更大的额度** ✓。
        #   不重试的话，一个会思考、真能读图的模型会被判成"读不了" ✗（假阴性 ✗）。
        if not text and ch.get("finish_reason") == "length":
            _say(f"额度花在思考上了，放大了再问一次…（{ms} ms）")
            limit = min(limit * 2, 4000)
            r, ms = ask(limit)
            if r.status_code >= 400:
                _say(f"看图失败：HTTP {r.status_code}")
                return {"ok": False, "ms": ms,
                        "error": f"HTTP {r.status_code}: {r.text[:400]}"}
            d = r.json()
            ch = (d.get("choices") or [{}])[0] or {}
            msg = ch.get("message") or {}
            text = str(msg.get("content") or "").strip()
        usage = d.get("usage") or {}
        img_tok = ((usage.get("prompt_tokens_details") or {}).get("image_tokens"))
        out = {"ok": True, "ms": ms, "text": text,
               "finish": ch.get("finish_reason"),
               "usage": {"prompt": usage.get("prompt_tokens"),
                         "completion": usage.get("completion_tokens"),
                         "image_tokens": img_tok},
               "tokens": limit,
               "reasoning": str(msg.get("reasoning_content") or "")[:200]}
        if not text:
            # 空回复**不算成功** ✓ —— 和"模型不收图"长得一样，含糊过去等于没测 ✓。
            why = ("额度花在思考上了（finish=%s）" % ch.get("finish_reason")
                   if msg.get("reasoning_content") else
                   "模型一个字都没回（finish=%s）" % ch.get("finish_reason"))
            _say(f"看图没答上来：{why}")
            return {**out, "ok": False, "error": why}
        _say(f"看图通了（{ms} ms，图 token {img_tok}）")
        return out
    except Exception as e:  # noqa: BLE001
        _say(f"看图请求挂了：{type(e).__name__}")
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
