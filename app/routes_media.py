"""媒体上传（图片 / 语音）。

文件落在 `data/media/`，路径按日期分目录，避免单目录堆积。
数据库只存相对路径，访问走 `/media/<path>` 静态挂载。
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from .auth import current_user
from .config import settings

log = logging.getLogger("lifeguard.media")
router = APIRouter(prefix="/api/media", tags=["media"])

MAX_BYTES = 25 * 1024 * 1024  # 单文件 25MB——够拍照和一分钟语音

_ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/amr": ".amr",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".weba",
}


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
) -> dict:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _ALLOWED.get(ctype)
    if not ext:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"不支持的文件类型：{ctype or '未知'}"
        )

    blob = await file.read()
    if not blob:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "空文件")
    if len(blob) > MAX_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"文件过大（{len(blob) // 1024 // 1024}MB），上限 {MAX_BYTES // 1024 // 1024}MB",
        )

    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    name = f"{secrets.token_hex(12)}{ext}"
    rel = Path(day) / name
    dest = settings.media_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)

    return {
        "path": rel.as_posix(),
        "url": f"/media/{rel.as_posix()}",
        "size": len(blob),
        "content_type": ctype,
        "original_name": file.filename,
    }
