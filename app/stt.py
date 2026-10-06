"""语音转文字。

**用 Dots 自己的多模态能力**，不额外引语音服务——

实测它的 OpenAI 兼容接口接受 `audio_url` 内容片段（`input_audio` 那种格式会被 400 拒掉）：

    {"type":"audio_url","audio_url":{"url":"data:audio/wav;base64,..."}}

配套用服务器上已有的 ffmpeg 把手机录的音频转成 16k 单声道 wav：
体积小、格式确定，省得为 webm/opus/m4a 各种编码分别适配。
"""

from __future__ import annotations

import base64
import logging
import subprocess
from pathlib import Path

import httpx

from .config import settings

log = logging.getLogger("lifeguard.stt")


def _ffmpeg() -> str | None:
    """找 ffmpeg。Hermes 的 tools 目录里有一份，直接复用，不额外装。"""
    import glob

    for pat in (
        str(Path(settings.hermes_home) / "tools" / "ffmpeg-*" / "bin" / "ffmpeg"),
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None


def to_wav16k(src: Path, dst: Path) -> bool:
    """转成 16kHz 单声道 wav。失败返回 False（调用方决定降级）。"""
    ff = _ffmpeg()
    if not ff:
        log.warning("找不到 ffmpeg，跳过转码")
        return False
    try:
        subprocess.run(
            [ff, "-y", "-i", str(src), "-ar", "16000", "-ac", "1", "-f", "wav", str(dst)],
            capture_output=True, timeout=120, check=True,
        )
        return dst.exists() and dst.stat().st_size > 0
    except Exception:
        log.warning("ffmpeg 转码失败：%s", src.name, exc_info=True)
        return False


async def transcribe(audio_path: Path) -> str | None:
    """把音频转写成文字。失败返回 None——调用方保留音频，不要让整条消息发不出去。"""
    if not settings.llm_api_key:
        return None

    wav = audio_path.with_suffix(".16k.wav")
    usable = to_wav16k(audio_path, wav) and wav
    target = wav if usable else audio_path
    if not target.exists():
        return None

    raw = target.read_bytes()
    # 太长就别硬塞了：base64 之后还会膨胀 1/3，而这条链路上限并不宽裕。
    if len(raw) > 12 * 1024 * 1024:
        log.warning("音频过大(%d 字节)，跳过转写", len(raw))
        return None
    b64 = base64.b64encode(raw).decode()

    payload = {
        "model": settings.llm_model,
        # 转写是**机械任务**，不需要推理。开着思考会既慢又容易把正文挤空
        # （判断闸那边踩过同一个坑）。
        "reasoning_effort": "none",
        "max_tokens": 800,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text":
                    "把这段音频逐字转写成文字。只输出转写结果本身，"
                    "不要加任何解释、标点说明或前后缀。听不清的地方就留空。"},
                {"type": "audio_url", "audio_url": {"url": f"data:audio/wav;base64,{b64}"}},
            ],
        }],
    }
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            )
        if resp.status_code >= 400:
            log.warning("转写请求失败 %s: %s", resp.status_code, resp.text[:200])
            return None
        data = resp.json()
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        text = (msg.get("content") or "").strip()
        if not text:   # 兜一下推理模型正文为空的情况
            text = (msg.get("reasoning_content") or "").strip()
        return text or None
    except Exception:
        log.warning("转写异常：%s", audio_path.name, exc_info=True)
        return None
    finally:
        if usable:
            try: wav.unlink()
            except OSError: pass
