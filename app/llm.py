"""编排层自用的轻量模型客户端。

与 Hermes 分开：接话判断这类辅助任务只需要一次便宜的补全，
不需要 agent 的完整工具链和记忆注入。混用会让每次判断都背上
agent 的启动开销。
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("lifeguard.llm")


async def complete(
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 512,
    temperature: float = 0.3,
    model: str | None = None,
    no_thinking: bool = False,
) -> str:
    """一次非流式补全，返回正文。失败抛 httpx 异常，由调用方决定降级策略。

    `no_thinking=True` 会传 `reasoning_effort: "none"` 关掉推理（Dots 实测支持，
    reasoning_content 归零）。**分类、打分这类简单任务应该关掉**——
    推理模型在这类任务上会"想很久还吐不出正文"，既慢又脆（实测踩过）。
    """
    payload: dict[str, Any] = {
        "model": model or settings.llm_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if no_thinking:
        payload["reasoning_effort"] = "none"
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
    async with httpx.AsyncClient(timeout=settings.llm_timeout) as client:
        resp = await client.post(
            f"{settings.llm_base_url.rstrip('/')}/chat/completions",
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = (msg.get("content") or "").strip()
    if not content:
        # 推理模型（如 Dots）在 token 被"思考"吃光时，正文会是空的，
        # 但结论常常已经写在 reasoning_content 里。实测这是判断闸静默失败的
        # 主要原因——不兜这一下，调用方只会看到 None。
        content = (msg.get("reasoning_content") or "").strip()
    return content


async def complete_json(messages: list[dict[str, str]], **kw: Any) -> dict | None:
    """要求模型输出 JSON 的场景。解析失败返回 None，由调用方降级。"""
    raw = await complete(messages, **kw)
    if not raw:
        return None
    # 容忍 ```json 围栏
    if raw.startswith("```"):
        raw = raw.split("```")[1] if len(raw.split("```")) > 1 else raw
        raw = raw.removeprefix("json").strip()
    try:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            return json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        log.warning("complete_json: 无法解析模型输出: %r", raw[:200])
    return None
