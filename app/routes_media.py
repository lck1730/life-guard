"""媒体上传（图片 / 语音 / **文件** / **音频**）。

文件落在 `data/media/`，路径按日期分目录，避免单目录堆积。
数据库只存相对路径，访问走 `/media/<path>`。

★ 2026-10-08：加了**文件**和**音频**两类 ✓（用户：「两处的＋都新增**文件**
（常规txt，pdf，word，excel，json等）与**音频**；暂不支持视频」✓）。
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

# ── 白名单：**按 content-type 认**，认不出来再**按扩展名认** ✓ ──────────
#
# ⚠️ 第二条（按扩展名）不是"宽松一点"✗，是**必需** ✓ ——
#    2026-10-08 实测：docx / xlsx / 一些安卓文件选择器给的就是
#    `application/octet-stream` ✓（一个什么信息都没有的类型 ✓）。
#    只按 content-type 查表的话，用户传 Word 会看到
#    "不支持的文件类型：application/octet-stream" ✓ ——
#    他会以为是这个 App 不支持 Word ✗，而其实是我们**没认出来** ✓。
#
# ⚠️ 保存时的扩展名**一律用我们自己表里那个** ✗ —— 不信客户端给的任何名字 ✓
#    （否则传一个叫 `x.html` 的东西上来、又按 html 存下来 ✓，
#      而 `/media` 是能直接打开的 ✓ → 等于给了一个上传页面的口子 ✗）。
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
    # 文件（2026-10-08）
    "text/plain": ".txt",
    "text/csv": ".csv",
    "text/markdown": ".md",
    "application/json": ".json",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}

#: 按**扩展名**兜底 ✓（`content-type` 认不出来时才用 ✓）。
_BY_EXT = {
    ".txt": ".txt", ".md": ".md", ".csv": ".csv", ".json": ".json",
    ".pdf": ".pdf", ".doc": ".doc", ".docx": ".docx",
    ".xls": ".xls", ".xlsx": ".xlsx",
    ".jpg": ".jpg", ".jpeg": ".jpg", ".png": ".png", ".webp": ".webp", ".gif": ".gif",
    ".mp3": ".mp3", ".m4a": ".m4a", ".aac": ".aac", ".amr": ".amr",
    ".ogg": ".ogg", ".wav": ".wav", ".weba": ".weba",
}

#: 哪几种能**当成文字读给管家看** ✓（用户定的：「文本类能读」✓）。
#: ⚠️ pdf / word / excel **不在里面** ✗ —— 要读它们得装解析库 ✓，
#:    而那个 venv 是四个服务共用的 ✓（见 `lifeguard-capability-handdown` 那条教训 ✓）
#:    → 代价大、收益小 ✓，留到以后 ✓。它们照样能**收发和下载** ✓，
#:    管家只知道"你发了个 xx.pdf" ✓（它会照实说"我打不开这个格式"✓）。
TEXT_EXTS = {".txt", ".md", ".csv", ".json"}


def _ext_of(filename: str) -> str:
    return Path((filename or "").strip()).suffix.lower()


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
) -> dict:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _ALLOWED.get(ctype)
    if not ext:
        # ② 按扩展名兜底 ✓（见上面那段：`octet-stream` 这一条是必需的 ✓）
        ext = _BY_EXT.get(_ext_of(file.filename or ""))
    if not ext:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"不支持的文件类型：{ctype or '未知'}"
            f"（{_ext_of(file.filename or '') or '没有扩展名'}）—— "
            "图片、音频、txt/md/csv/json/pdf/word/excel 都行",
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
    name = f"{secrets.token_hex(12)}{ext}"          # ★ 名字由**我们**拼 ✓
    rel = Path(day) / name
    dest = settings.media_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)

    return {
        "path": rel.as_posix(),
        "url": f"/media/{rel.as_posix()}",
        "size": len(blob),
        "content_type": ctype,
        "ext": ext,
        "original_name": file.filename,
    }
