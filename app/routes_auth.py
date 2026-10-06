"""认证路由。"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from .auth import (
    SESSION_COOKIE,
    authenticate,
    current_user,
    hash_password,
    make_token,
    verify_password,
)
from .config import settings
from .db import execute, fetch_one, now

log = logging.getLogger("lifeguard.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


# 注册接口**刻意不提供**。
#
# 本产品的形态是「账号由后端创建，App 只能登录」（见 app/admin.py）。
# 前端去掉注册入口时，这个接口一度还开着——虽然注册出来的账号不在任何群里、
# 看不到任何数据，但它是个没必要存在的攻击面。
# 建账号请用：.venv/bin/python -m app.admin create-user <用户名> <密码> <昵称>


# ── 登录限流 ──────────────────────────────────────────────────────────
#
# 按**用户名**计数。走 SSH 隧道时所有请求源 IP 都是 127.0.0.1，
# 按 IP 限流等于没限；按用户名至少挡得住针对某个账号的爆破。
#
# 计数窗口 + 锁定时间都在配置里。窗口过期会重新计数，
# 所以"偶尔打错几次"不会把人锁死，只有持续尝试才会。

async def _locked_seconds(username: str) -> int:
    row = await fetch_one("SELECT locked_until FROM login_attempts WHERE username = ?", (username,))
    if not row:
        return 0
    return max(0, int(row["locked_until"]) - now())


async def _record_failure(username: str) -> None:
    ts = now()
    row = await fetch_one("SELECT * FROM login_attempts WHERE username = ?", (username,))
    if not row or ts - int(row["window_start"]) > settings.login_window_seconds:
        # 新窗口
        await execute(
            """INSERT INTO login_attempts (username, fail_count, window_start, locked_until)
               VALUES (?, 1, ?, 0)
               ON CONFLICT(username) DO UPDATE SET fail_count = 1, window_start = ?, locked_until = 0""",
            (username, ts, ts),
        )
        return
    count = int(row["fail_count"]) + 1
    locked_until = ts + settings.login_lockout_seconds if count >= settings.login_max_failures else 0
    await execute(
        "UPDATE login_attempts SET fail_count = ?, locked_until = ? WHERE username = ?",
        (count, locked_until, username),
    )
    if locked_until:
        log.warning("登录失败 %d 次，锁定账号 %s 至 %d", count, username, locked_until)


async def _clear_failures(username: str) -> None:
    await execute("DELETE FROM login_attempts WHERE username = ?", (username,))


@router.post("/login")
async def login(body: LoginIn, response: Response) -> dict:
    """**这个服务的登录已经撤了** —— 会话由「壳」签发。

    2026-10-06 重构：一次登录、多个服务。用户只在壳上登一次，
    其余服务读**同一个 cookie**（cookie 按主机共享、不按端口）。

    这里刻意**保留这个路由**（而不是删掉让它 404）：撞上来的多半是
    一个还没更新的旧界面，让它看见一句人话，比看见一个 404 好排查得多。

    ⚠️ 更要紧的是：**这里不再接受密码**。留着一条能验密码的路，
    就等于留了第二条登录路径 —— 而"只有一处能登录"正是这次重构要拿到的东西。
    """
    raise HTTPException(
        status.HTTP_410_GONE,
        "登录入口已经搬到「壳」了：回 App 的服务列表，或者把地址换成壳那个端口。",
    )


@router.post("/logout")
async def logout(response: Response) -> dict:
    """清掉会话 Cookie。

    **这个接口是必需的，不是可选的**：httpOnly 的意思就是 JS 删不掉它，
    所以"退出登录"必须让服务器来删。
    """
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(current_user)) -> dict:
    return user


class UpdateAccountIn(BaseModel):
    """改账号。两项都可选，只传要改的。

    ⚠️ 账号是**登录凭证**，改它不影响群内昵称（那是 group_members.nickname）。
    这个区分是刻意的：用户在设置里改"昵称"不该把登录名也改掉。
    """

    username: str | None = Field(default=None, min_length=1, max_length=32)
    new_password: str | None = Field(default=None, min_length=6, max_length=128)
    current_password: str = Field(description="改任何一项都要验当前密码")


@router.patch("/me")
async def update_account(
    body: UpdateAccountIn, user: dict = Depends(current_user)
) -> dict:
    row = await fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))
    if not row or not verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "当前密码不正确")

    fields, params = [], []
    if body.username is not None:
        name = body.username.strip()
        if await fetch_one("SELECT id FROM users WHERE username = ? AND id != ?", (name, user["id"])):
            raise HTTPException(status.HTTP_409_CONFLICT, "该用户名已被占用")
        fields.append("username = ?"); params.append(name)
    if body.new_password is not None:
        fields.append("password_hash = ?"); params.append(hash_password(body.new_password))
    if not fields:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "没有要修改的内容")

    params.append(user["id"])
    await execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", params)
    return {"ok": True}


# ── 头像 ─────────────────────────────────────────────────────────────
#
# 头像文件放在 /ui/users/{id}.png，通过已有的 /ui 静态挂载访问。
# /ui 是 no-store 的，所以每次刷新都会拿到最新的图。
# 数据库只存 URL 路径，不存二进制——和消息里的头像一样。

_AVATAR_EXTS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_AVATAR_MAX = 2 * 1024 * 1024  # 2MB，头像不需要大


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
) -> dict:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _AVATAR_EXTS.get(ctype)
    if not ext:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"不支持的头像格式：{ctype}")

    blob = await file.read()
    if not blob:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "空文件")
    if len(blob) > _AVATAR_MAX:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "头像不能超过 2MB")

    uid = user["id"]
    avatar_dir = Path(settings.ui_dir) / "users"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    path = avatar_dir / f"{uid}{ext}"
    path.write_bytes(blob)

    url = f"/ui/users/{uid}{ext}?v={int(time.time()*1000)}"
    await execute("UPDATE users SET avatar = ? WHERE id = ?", (url, uid))

    return {"ok": True, "avatar": url}
