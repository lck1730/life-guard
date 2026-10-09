"""「壳」搬过来的那一半：**登录 / 注册 / 账号 / 生活空间**。

★ 2026-10-08 合并那次 ✗→✓。

## 为什么会有这个文件

原来这些住在一个**独立服务**里（`tools/lifeguard-shell.py`，端口 8730，用户 `lgshell`，
标准库 `http.server` 手写路由 ✓）。它是"门"：所有人开 App 都先到它那儿 ✓，
它发一张票 ✓，别的服务认这张票 ✓。

用户 2026-10-08 定的：**不再区分「壳」和「生活管家」** ✓ ——
「所有界面都在一个服务上，包括最开始的登录」✓。于是这一半搬进来 ✓。

## 搬的时候守的几条

1. **路径一个字没改** ✗→✓（`/api/login`、`/api/workspaces`、`/avatars/<id>` …）——
   手机上缓存着老页面、老表单、老书签 ✓，改路径只会制造"看着在、点了 404"✓。
2. **票据形状一个字没改** ✗→✓（见 `auth.make_session_token`）——
   模型网关（8722）和 App 管家（8742）**也在拿同一把密钥验这张票** ✓。
3. **语义一个字没改**：注册要内测码 ✓、登录限流 ✓、改用户名/密码要先验当前密码 ✓、
   令牌只进 cookie 不进响应体 ✓、头像只收 JPEG 且验魔数 ✓。
   「去向由地址决定」那条（`/` 判去向、`/login` 清票、`/me` 到了就画）搬到了 `main.py` ✓。

## 和"生活管家"那一半的关系

它们**共用一张 users 表** ✓（合并前是两张：壳那张是权威 ✓、这边是按需镜像 ✗）。
共用的原因不用解释，一句话：**同一个信息存在两处，迟早走岔** ✓
（这个项目为这条栽过至少三次：群名 ✓、邀请码 ✓、屏名 ✓）。
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .auth import (
    SESSION_COOKIE,
    SESSION_HOURS,
    hash_password,
    make_session_token,
    new_invite_code,
    new_uuid,
    verify_password_any,
)
from .config import settings
from .db import execute, execute_rc, fetch_all, fetch_one, now

log = logging.getLogger("lifeguard.shell")

router = APIRouter()

# ⚠️ 用户名规则：**和壳那边一个字都不差** ✗（`tools/lifeguard-shell.py` 的 `_USERNAME_RE` ✓）。
#   放宽过一次（2026-10-07，用户要 `LTrunk!` / `LYYY!` ✓）——
#   加进来的只有一批标点 ✓，**`'` `"` `\` `/` 仍然不给** ✗：
#   它们不是"打不出来"就是"要在别处转义" ✓，收益抵不上麻烦 ✓。
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.!@#$%&*-]{3,24}$")

MAX_AVATAR_BYTES = 1_500_000        # 前端会先缩到 256px ✓，这儿只是最后一道 ✓
#: JPEG 的魔数：FF D8 FF ✓ —— 用 `bytes([...])` 写，
#: 免得在源码里跟转义序列（反斜杠 x ff 那一串）打架 ✗。
JPEG_MAGIC = bytes([255, 216, 255])


# ── 会话 cookie ──────────────────────────────────────────────────────────────
#
# ⚠️ **cookie 名一个字没改** ✗（`lg_shell_session` ✓）——改了 = 所有人重登一遍 ✓，
#    而且模型网关/App 管家那边也认这个名字 ✓。
# ⚠️ httpOnly ✓ —— 页面上任何一段 JS 都读不到它 ✓
#    （这是"敢让 agent 写前端"的全部前提 ✓，见 auth.py 顶上那段 ✓）。
#    ⚠️ 所以**退出登录必须走服务端** ✓：JS 删不掉 httpOnly 的东西 ✓。


def _set_session(response: Response, token: str, *, max_age: int) -> None:
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=max_age, httponly=True, samesite="lax", path="/",
    )


def _clear_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


# ── 登录限流 ─────────────────────────────────────────────────────────────────
#
# ⚠️ 这一套**必须有** ✗：密码是用户自设的短密码 ✓，而这个服务只走 WireGuard ✓、
#    但"内网就安全"是错觉 ✓（谁连上 VPN 谁就能爆破 ✓）。
# 按**用户名**计数、不按 IP ✓ —— 手机过来的源地址全都一样（转发进程 ✓），
# 按 IP 限流等于没限 ✓。


async def _locked_seconds(username: str) -> int:
    row = await fetch_one(
        "SELECT locked_until FROM login_attempts WHERE username = ?", (username,))
    if not row:
        return 0
    return max(0, int(row["locked_until"]) - now())


async def _note_failure(username: str) -> None:
    row = await fetch_one(
        "SELECT fail_count, window_start FROM login_attempts WHERE username = ?", (username,))
    t = now()
    if not row or t - int(row["window_start"]) > settings.login_window_seconds:
        await execute(
            "INSERT INTO login_attempts(username, fail_count, window_start, locked_until) "
            "VALUES(?,1,?,0) ON CONFLICT(username) DO UPDATE SET "
            "fail_count=1, window_start=?, locked_until=0", (username, t, t))
        return
    count = int(row["fail_count"]) + 1
    lock = t + settings.login_lockout_seconds if count >= settings.login_max_failures else 0
    await execute("UPDATE login_attempts SET fail_count=?, locked_until=? WHERE username=?",
                  (count, lock, username))


async def _clear_failures(username: str) -> None:
    await execute("DELETE FROM login_attempts WHERE username = ?", (username,))


# ── 当前用户 ─────────────────────────────────────────────────────────────────
#
# ⚠️ 这个和 `auth.current_user` **不是一回事**，别搞混 ✗：
#     · `auth.current_user` —— 鉴权依赖 ✓，用在**所有需要登录的接口**上 ✓
#       （它还会拦预览票的写操作 ✓）。
#     · 这里这个 —— 给**这个文件里**那些返回"账号资料"的接口用 ✓（多查几列 ✓）。
async def _me(request: Request) -> dict | None:
    from .auth import decode_token   # 本地 import：避免和 auth 的模块级循环 ✓

    raw = request.cookies.get(SESSION_COOKIE) or ""
    payload = decode_token(raw)
    if not payload:
        return None
    row = await fetch_one(
        "SELECT id, username, nickname, avatar, is_admin FROM users WHERE id = ?",
        (int(payload["sub"]),))
    return row or None


async def _require_me(request: Request) -> dict:
    me = await _me(request)
    if not me:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    return me


# ── 生活空间 ─────────────────────────────────────────────────────────────────


async def _my_spaces(user_id: int) -> list[dict]:
    rows = await fetch_all("""
        SELECT g.id, g.uuid, g.name, g.invite_code, g.profile, gm.role,
               (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) AS members
        FROM group_members gm JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = ? ORDER BY g.id
    """, (user_id,))
    out = []
    for r in rows:
        d = dict(r)
        # ★ 「满了没」是**算出来的**，不是存下来的 ✓ ——
        #   这样"有人退出 → 名额自动回来"是免费的 ✓，不用谁去改一个标志位 ✓
        #   （存一个 `full` 列的话，就一定会有它和成员数对不上的那一天 ✓）。
        d["full"] = int(d["members"]) >= settings.max_space_members
        d["expired"] = d["full"]      # 老页面读这个名字 ✓，一起给，省得它 404
        out.append(d)
    return out


async def _space_count(user_id: int) -> int:
    row = await fetch_one("SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?",
                          (user_id,))
    return int(row["n"]) if row else 0


# ── 开通空间：排队 + 等结果 ──────────────────────────────────────────────────
#
# ## ★ 为什么是"排队"而不是"自己动手"
#
# 这件事要写 `/root/.hermes`（700 lifeguard ✓），所以它需要特权 ✓。
# 最直接的做法是在这里 `sudo` 一下 ✗ —— **2026-10-06 实测：不行** ✗。
# （壳那边当时是 NoNewPrivileges / ProtectHome 挡住的 ✓；这个服务连那两个开关都不用开 ✓，
#   因为它根本进不去 `/root`（`/root` 是 711 ✓、`.hermes` 是 700 lifeguard ✓）。）
#
# 所以方向反过来：**我们只排队，不动手** ✓。
#
#     var/provision/req-<uuid>    ← 我们写（那个目录归 lgshell ✓ 但 2775/755 都写得进 ✓）
#           ↓  root 的 systemd `.path` 单元看见文件变了就喊人
#     var/provision/done-<uuid>   ← 那边的结果
#           ↓  我们轮询等它
#
# 代价是开通变成异步 ✓（约 5 秒 ✓，页面上本来就有"正在开通…"✓）。
#
# ⚠️ **队列目录的属主是 lgshell** ✗（那是壳建的 ✓）—— 合并之后写它的换成了 `lgchat` ✓
#    → 部署脚本必须把那个目录改成 `lgshell:lgcode 2775` ✓（见 deploy-chat.sh 里那条 ✓）。
#    不改成 2775 的话，症状是"建空间永远卡在正在开通"✓，而 worker 那边一条日志都没有 ✓。
PROVISION_WAIT_SECONDS = 180


async def provision(uuid: str, wait: int = PROVISION_WAIT_SECONDS) -> tuple[bool, str]:
    """让 root 那位把这个空间的 Hermes profile 准备好。成功返回 (True, 说明)。"""
    q = Path(settings.provision_queue)
    req, done = q / f"req-{uuid}", q / f"done-{uuid}"
    try:
        q.mkdir(parents=True, exist_ok=True)
        done.unlink(missing_ok=True)          # 别把上一轮的旧结果当这次的 ✗
        req.write_text("", encoding="utf-8")
    except OSError as exc:
        return False, f"排不进队列（{q}）：{exc}"

    for _ in range(wait):
        await asyncio.sleep(1)
        try:
            if not done.exists():
                continue
            text = done.read_text(encoding="utf-8", errors="replace")
            done.unlink(missing_ok=True)
        except OSError:
            continue
        ok = "rc=0" in text
        return ok, "".join(l for l in text.splitlines() if not l.startswith("rc="))[-600:]

    return False, (f"开通排队超过 {wait} 秒还没结果。\n"
                   "  多半是那个 root 的 worker 没起来 —— 看 `systemctl status lifeguard-provision.path`。")


# ── 请求体 ───────────────────────────────────────────────────────────────────


class RegisterIn(BaseModel):
    code: str = Field(default="", max_length=32)        # 内测码
    username: str = Field(default="", max_length=64)
    password: str = Field(default="", max_length=128)
    password2: str = Field(default="", max_length=128)


class LoginIn(BaseModel):
    username: str = Field(default="", max_length=64)
    password: str = Field(default="", max_length=128)


class UpdateMeIn(BaseModel):
    # ⚠️ 全给默认空串 ✓ —— "没传"和"传了空"在语义上是**同一件事**：
    #    这次不打算改这一项 ✓。用 `None` 反而要多一层判空 ✓。
    nickname: str = Field(default="", max_length=64)
    username: str = Field(default="", max_length=64)
    password: str = Field(default="", max_length=128)
    current_password: str = Field(default="", max_length=128)


class AvatarIn(BaseModel):
    data: str = ""


class SpaceNewIn(BaseModel):
    name: str = Field(default="", max_length=32)


class SpaceJoinIn(BaseModel):
    code: str = Field(default="", max_length=32)


# ── 注册 / 登录 / 退出 ───────────────────────────────────────────────────────


@router.post("/api/register")
async def register(body: RegisterIn, response: Response) -> dict:
    """注册。**内测码是闸门** ✓ —— 没有它建不了号 ✓。"""
    code = body.code.strip().upper()
    username = body.username.strip()

    # ⚠️ **顺序是有讲究的**：先验内测码 ✓。
    #    反过来的话，没码的人也能靠"用户名被占了没 / 密码太短"这些回包
    #    **试探**系统里有什么 ✗ —— 那是白送的信息 ✓。
    row = await fetch_one("SELECT used_by FROM beta_codes WHERE code = ?", (code,))
    if not row:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "内测码不对")
    if row["used_by"] is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "这个内测码已经用过了")
    if not _USERNAME_RE.match(username):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "用户名要 3~24 位：字母数字和 ._!@#$%&*- 可用")
    if len(body.password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "密码至少 6 位")
    if body.password != body.password2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "两次输入的密码不一样")
    if await fetch_one("SELECT id FROM users WHERE username = ?", (username,)):
        raise HTTPException(status.HTTP_409_CONFLICT, "这个用户名已经有人用了")

    # 昵称**先默认成用户名** ✓ —— 注册的时候他连空间都还没建 ✓，
    # 问他要昵称纯属多余 ✗（之后在「我的」里随时能改 ✓）。
    nickname = username
    uid = await execute(
        "INSERT INTO users(username, password_hash, nickname, is_admin, created_at) "
        "VALUES(?,?,?,0,?)", (username, hash_password(body.password), nickname, now()))
    await execute("UPDATE beta_codes SET used_by = ?, used_at = ? WHERE code = ?",
                  (uid, now(), code))
    token = make_session_token(uid, is_admin=False, nickname=nickname)
    _set_session(response, token, max_age=SESSION_HOURS * 3600)
    return {"id": uid, "username": username, "nickname": nickname}


@router.post("/api/login")
async def login(body: LoginIn, response: Response) -> dict:
    username = body.username.strip()
    left = await _locked_seconds(username)
    if left > 0:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"失败次数太多，请 {left // 60 + 1} 分钟后再试")
    row = await fetch_one(
        "SELECT id, nickname, is_admin, password_hash FROM users WHERE username = ?",
        (username,))
    # ⚠️ **验密码一律走 `verify_password_any`** ✗ —— 它认两种哈希格式 ✓。
    #    直接调 bcrypt 的话，存量那些 scrypt 用户**永远登不进去** ✓，
    #    而且报的是"用户名或密码不对"✓（看起来像他自己记错了 ✓，最难查的一种 ✓）。
    # ⚠️ 用户名不存在和密码不对**回同一句话** ✓ —— 分开说等于给了一个
    #    "这个用户名存在吗"的探测接口 ✗。
    if not row or not verify_password_any(body.password, row["password_hash"]):
        await _note_failure(username)
        await asyncio.sleep(0.4)          # 拖一下暴力破解 ✓
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码不对")
    await _clear_failures(username)
    # ⚠️ 令牌**只在 cookie 里** ✓，不进响应体 ✗ ——
    #    响应体是 JS 读得到的 ✓，装一份在那儿等于 cookie 白改 ✓。
    token = make_session_token(int(row["id"]), is_admin=bool(row["is_admin"]),
                               nickname=row["nickname"] or username)
    _set_session(response, token, max_age=SESSION_HOURS * 3600)
    return {"id": row["id"], "username": username, "nickname": row["nickname"],
            "is_admin": bool(row["is_admin"])}


@router.post("/api/logout")
async def logout() -> JSONResponse:
    """退出。**必须由服务端清** ✓ —— httpOnly 的 cookie 页面删不掉 ✓。

    ⚠️ 真正的"登出"还有另一半：前端要**真导航**去 `/login` ✓，
    由那一页把内存里的东西全部丢掉 ✓（见 main.py 里 `/login` 那段 ✓）。
    """
    r = JSONResponse({"ok": True})
    _clear_session(r)
    return r


# ── 账号资料 ─────────────────────────────────────────────────────────────────


@router.get("/api/me")
async def read_me(request: Request) -> dict:
    me = await _me(request)
    if not me:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    pref = await fetch_one("SELECT last_ws FROM user_prefs WHERE user_id = ?", (me["id"],))
    # ★ 顺带把「自我介绍」带回来 ✓（一人一空间 ✓ → 不用问是哪个空间 ✓）。
    intro = await fetch_one(
        "SELECT self_intro FROM group_members WHERE user_id = ? ORDER BY joined_at LIMIT 1",
        (me["id"],))
    return {**me, "is_admin": bool(me["is_admin"]),
            "last_ws": (pref or {}).get("last_ws"),
            "self_intro": (intro or {}).get("self_intro") or ""}


class SelfIntroIn(BaseModel):
    #: ⚠️ **空字符串是"擦掉"的意思** ✓ —— 所以不能用"空 = 没改"那套 ✗
    #:（用户会想"我不写了"✓）。这里本来就是"整段替换"的语义 ✓，写空就是空 ✓。
    #: ★ **500 → 800**（2026-10-09 用户定的：「将字数上限设为800」✓）——
    #:   和前端的 `maxLength` 必须是同一个数 ✓。
    text: str = Field(default="", max_length=800)


@router.post("/api/me/self-intro")
async def set_self_intro(body: SelfIntroIn, request: Request) -> dict:
    """写/改/擦掉**自己的自我介绍** ✓ —— 用户 2026-10-08 定的 ✓（≤800 字 ✓）。

    它跟着每一轮的 `_group_persona` 进 prompt ✓（见那边那段说明 ✓），
    所以改完**下一句话它就知道了** ✓，不用等什么重建 ✓。
    """
    me = await _require_me(request)
    text = body.text.strip()[:500]
    n = await execute_rc(
        "UPDATE group_members SET self_intro = ? WHERE user_id = ?", (text or None, me["id"]))
    if not n:
        # 还没进任何空间 ✓ —— 那也没有"群成员"这一行可写 ✓
        raise HTTPException(status.HTTP_409_CONFLICT, "你还没有生活空间，先建一个")
    return {"self_intro": text}


@router.get("/api/notes")
async def list_notes(request: Request) -> dict:
    """我给别人起的备注 ✓（`{peer_id: note}` ✓）—— 只有我自己看得到 ✓。"""
    me = await _require_me(request)
    rows = await fetch_all(
        "SELECT peer_id, note FROM contact_notes WHERE owner_id = ?", (me["id"],))
    return {"notes": {str(r["peer_id"]): r["note"] for r in rows}}


class NoteIn(BaseModel):
    peer_id: int
    note: str = Field(default="", max_length=24)


@router.post("/api/notes")
async def set_note(body: NoteIn, request: Request) -> dict:
    """设/清**别人的备注** ✓（空 = 取消备注 ✓，回到用原本的昵称 ✓）。

    ⚠️ 它**只影响显示** ✓ —— 不进 prompt ✓、也不改对方的昵称 ✓
    （用户原话："对方不感知" ✓，见 `db.py` 那张表的说明 ✓）。
    """
    me = await _require_me(request)
    if int(body.peer_id) == int(me["id"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "给自己起备注没意义")
    note = body.note.strip()[:24]
    if note:
        await execute(
            "INSERT INTO contact_notes(owner_id, peer_id, note, updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(owner_id, peer_id) DO UPDATE SET note=excluded.note, "
            "updated_at=excluded.updated_at", (me["id"], int(body.peer_id), note, now()))
    else:
        await execute("DELETE FROM contact_notes WHERE owner_id = ? AND peer_id = ?",
                      (me["id"], int(body.peer_id)))
    return {"peer_id": int(body.peer_id), "note": note}


@router.api_route("/api/me", methods=["PATCH", "POST"])
async def update_me(body: UpdateMeIn, response: Response, me: dict = Depends(_require_me)) -> dict:
    """改昵称 / 用户名 / 密码。

    ⚠️ 原来这里是 `POST /api/me` ✓（壳的手写路由把 PATCH 转给了 POST ✓）——
    现在两个方法都收 ✓，因为老页面发的是 PATCH ✓、以后可能有人发 POST ✓。
    """
    nickname = body.nickname.strip()
    username = body.username.strip()
    password = body.password
    if not any((nickname, username, password)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "没有要改的东西")

    # ⚠️ **改身份要先证明是本人** ✗ —— 光凭一个 cookie 就允许改密码，
    #    等于"手机被人拿到一会儿就能把账号夺走" ✗。
    #    ⚠️ 改昵称**不要求** ✓ —— 那只是个显示名 ✓，改错了无所谓 ✓。
    if username or password:
        row = await fetch_one("SELECT password_hash FROM users WHERE id = ?", (me["id"],))
        if not row or not verify_password_any(body.current_password, row["password_hash"]):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "当前密码不对")

    if username and not _USERNAME_RE.match(username):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "用户名要 3~24 位：字母数字和 ._!@#$%&*- 可用")
    if username and await fetch_one("SELECT id FROM users WHERE username = ? AND id <> ?",
                                    (username, me["id"])):
        raise HTTPException(status.HTTP_409_CONFLICT, "这个用户名已经有人用了")
    if password and len(password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "密码至少 6 位")

    if nickname:
        await execute("UPDATE users SET nickname = ? WHERE id = ?", (nickname[:24], me["id"]))
    if username:
        await execute("UPDATE users SET username = ? WHERE id = ?", (username, me["id"]))
    if password:
        await execute("UPDATE users SET password_hash = ? WHERE id = ?",
                      (hash_password(password), me["id"]))
        await _clear_failures(username or me["username"])
    # ⚠️ 改完**重发一张票** ✓ —— 票里带着昵称/管理员位 ✓，
    #    不重发的话别的服务那边认的还是旧的 ✓（模型网关、App 管家都在认 ✓）。
    fresh = await fetch_one(
        "SELECT id, username, nickname, avatar, is_admin FROM users WHERE id = ?",
        (me["id"],))
    token = make_session_token(int(fresh["id"]), is_admin=bool(fresh["is_admin"]),
                               nickname=fresh["nickname"])
    _set_session(response, token, max_age=SESSION_HOURS * 3600)
    return {**fresh, "is_admin": bool(fresh["is_admin"])}


# ── 头像 ─────────────────────────────────────────────────────────────────────


@router.post("/api/avatar")
async def upload_avatar(body: AvatarIn, me: dict = Depends(_require_me)) -> dict:
    """收头像。**只认一种形状** ✗：`data:image/jpeg;base64,...` ✓。

    前端用 canvas 先把图缩到 256px 再转 JPEG ✓ —— 所以这里别的形状
    （png / svg / 裸 base64 / 随便什么）**一律拒** ✓。
    **不做"宽松解析"** ✗：宽松的解析器是漏洞的老家 ✓。
    """
    raw = body.data or ""
    if not raw.startswith("data:image/jpeg;base64,"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "只收 JPEG（前端会自己转）")
    try:
        blob = base64.b64decode(raw.split(",", 1)[1], validate=True)
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "图片数据坏了")
    if not blob or len(blob) > MAX_AVATAR_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "图片太大（超过 1.5M）")
    if blob[:3] != JPEG_MAGIC:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这不是一张 JPEG")

    d = Path(settings.avatar_dir)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{me['id']}.jpg").write_bytes(blob)
    # ⚠️ URL 上的 `?v=` 是**版本戳** ✓ —— 头像要长缓存（`immutable` ✓），
    #    所以"改了之后怎么看见"全靠它 ✓。**别把时间戳拼进文件路径** ✗
    #    （那是"防缓存"✓，和"能缓存"正好相反 ✓，这个项目为此栽过一次 ✓）。
    url = f"/avatars/{me['id']}?v={now()}"
    await execute("UPDATE users SET avatar = ? WHERE id = ?", (url, me["id"]))
    return {"avatar": url}


@router.get("/avatars/{uid}")
async def get_avatar(uid: int, request: Request, v: str = "") -> Response:
    """头像文件。**要登录** ✓（和原来壳那边一样 ✓）。

    ⚠️ 缓存头是**故意长**的（`immutable` ✓）—— 因为这个 URL 自己带版本戳 ✓
    （`?v=` ✓）。不带 `?v=` 的老 URL 会被浏览器缓存住 ✓ ——
    那是老页面的问题 ✓，不是这一层的 ✓。
    """
    me = await _me(request)
    if not me:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    p = Path(settings.avatar_dir) / f"{int(uid)}.jpg"
    if not p.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "这个人没有头像")
    return FileResponse(p, media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


# ── 生活空间：建 / 加入 / 看 ─────────────────────────────────────────────────
#
# ★ 2026-10-08 起规则变了（用户定的）：
#     · **一个人只有一个空间** ✓（原来是 3 ✓）
#     · **一个空间最多 3 个真人** ✓（管家不算 ✓ —— 它不是 `group_members` 里的行 ✓）
#     · **满员之后邀请码失效** ✓ —— 但**码不删** ✗：
#       有人退出，名额就该自动回来 ✓（删了码要重新生成 + 重新通知 ✓，
#       而"满员"本来就只是个算得出来的状态 ✓）。
#
# ⚠️ 上限一律拦在**写入层** ✗（不是界面上灰一下 ✓）——
#    界面只是体验 ✓，能被绕过的检查等于没有 ✓。


@router.get("/api/workspaces")
async def list_spaces(request: Request) -> dict:
    me = await _require_me(request)
    return {"workspaces": await _my_spaces(me["id"]),
            "max": settings.max_spaces_per_user}


@router.post("/api/workspaces")
async def create_space(body: SpaceNewIn, request: Request) -> dict:
    """建一个生活空间：开通它的记忆空间 → 校验收到的钥匙 → 落库。

    ★ 2026-10-08 合并时**顺序改过一次** ✗→✓：

      原来（壳那边）是"先插两行 → 开通 → 失败就把那两行撤掉" ✓。
      可"这个空间能不能用"的判据（`spaces.check` ✓）**恰恰是查那把钥匙在不在** ✓
      —— 而钥匙是**开通那一步交过来的** ✓ → 所以校验必须排在开通**之后** ✓。

      ⚠️ 那两件事原来**分在两个服务里** ✗：壳负责"插行 + 开通" ✓，
         生活管家那条 `POST /api/groups` 负责 `check_space` + 登记内置类型 ✓。
         于是"建一个空间"这件事**跨了两次 HTTP**✓，
         而其中任何一半失败都会留下一个**半成品**（有行没钥匙 / 有钥匙没行 ✓）。
         现在都在一个函数里 ✓，顺序也理顺了 ✓。

    ⚠️ 开通成功、落库失败 → 留下一个**孤儿 profile**（无害 ✓ 可重试 ✓）。
       反过来（先落库、开通失败）会留下"有名字但用不了"的空壳 ✗ ——
       用户天天点它、天天失败 ✓，比孤儿难排查得多 ✓。
    """
    me = await _require_me(request)
    if await _space_count(me["id"]) >= settings.max_spaces_per_user:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "你已经有一个生活空间了" if settings.max_spaces_per_user == 1
            else f"一个账号最多 {settings.max_spaces_per_user} 个生活空间")

    name = body.name.strip()[:32] or "我的空间"
    uuid = new_uuid()                      # 8 位 hex ✓ 也是 profile 名的一部分 ✓
    profile = f"chat-{uuid}"
    code = ""
    for _ in range(6):                     # 邀请码要唯一 ✓ 撞了就再摇一个 ✓
        cand = new_invite_code(settings.invite_code_len)
        if not await fetch_one("SELECT id FROM groups WHERE invite_code = ?", (cand,)):
            code = cand
            break
    if not code:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "邀请码没摇出来，再试一次")

    # ① **先开通**（唯一需要特权的那一步 ✓ 约 5 秒 ✓）——
    #    它会建出 profile、装上 SOUL/插件、并把那把 key 交过来 ✓。
    ok, detail = await provision(uuid)
    if not ok:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            f"空间没开通起来：\n{detail}")

    # ② 开通完了才校验"我们真拿到这把钥匙了" ✓（就是 `spaces.check` ✓）。
    #    走到这儿还不过，说明开通那一步**没做全** ✓ —— 那是要看见的错误 ✓，不是可以忽略的 ✓。
    from .spaces import check as check_space
    problem = await check_space(profile)
    if problem:
        log.error("开通跑完了但校验没过（uuid=%s）：%s", uuid, problem)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, problem)

    # ③ 落库
    gid = await execute(
        "INSERT INTO groups(uuid, name, owner_id, profile, invite_code, created_at) "
        "VALUES(?,?,?,?,?,?)", (uuid, name, me["id"], profile, code, now()))
    await execute("INSERT INTO group_members(group_id, user_id, role, joined_at) "
                  "VALUES(?,?,?,?)", (gid, me["id"], "owner", now()))

    # ④ 内置的记录类型（记账那一种 ✓）先登记上。
    #    不登记它也能自愈（`record_kinds` 会自动补 ✓），但没必要让它撞一次 ✓。
    #    （这条原来在生活管家那条 `POST /api/groups` 里 ✓，那条路 2026-10-08 删了 ✓。）
    from . import records as rec
    await rec.ensure_builtin_kinds(gid)

    return {"uuid": uuid, "name": name, "profile": profile,
            "invite_code": code, "detail": detail}


@router.get("/api/workspaces/mine")
async def my_space(request: Request) -> dict:
    """我这个空间的样子 ✓ —— 给「生活空间」那一屏用 ✓。

    ⚠️ 单独开这一条而不是复用 `list_spaces` ✗：那一屏要的是**一个**空间 ✓，
       而且它要 `alone`（"只剩我一个真人"✓）—— 那是"能不能退出"的判据 ✓，
       让服务端算 ✓（前端算出来的东西不能当防线 ✓，见 `leave_space` ✓）。
    """
    me = await _require_me(request)
    spaces = await _my_spaces(me["id"])
    if not spaces:
        return {"space": None}
    s = spaces[0]
    n = await fetch_one("SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?",
                        (s["id"],))
    return {"space": {**s, "alone": int(n["n"]) <= 1,
                      "max": settings.max_space_members}}


class SpaceNameIn(BaseModel):
    name: str = Field(default="", max_length=32)


@router.post("/api/workspaces/rename")
async def rename_space(body: SpaceNameIn, request: Request) -> dict:
    """改空间名 ✓ —— 名字**只有这一处**了 ✗→✓（合并之前它存在两个库里 ✓，
    改一个另一个不跟着 → 用户看到"改完名字，回『我的』还是旧的" ✓）。"""
    me = await _require_me(request)
    name = body.name.strip()[:32]
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "名字不能空着")
    spaces = await _my_spaces(me["id"])
    if not spaces:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "你还没有生活空间")
    await execute("UPDATE groups SET name = ? WHERE id = ?", (name, spaces[0]["id"]))
    return {"name": name}


# ── ★ 退出生活空间：**全删** ✗→✓（2026-10-08 用户定的）────────────────────
#
# 用户的原话：「红色的退出该空间，目前仅支持空间只有一个人时退出，
#   退出时删除服务器里对应的群聊记忆，二次防呆提示」✓。
# 追问之后他确认：**全删** ✓ —— 消息、账本、提醒、组件文件、工坊对话，
#   以及 Hermes 那份长期记忆（profile）✓，这个空间从服务器上彻底消失 ✓。
#
# ## 为什么是"两段"，而不是一把删干净
#
#   删 profile 那一步**只有 root 干得了** ✗（`/root/.hermes` 是 700 lifeguard ✓，
#   而这个服务跑在 lgchat 名下 ✓）→ 它得走队列 ✓（和开通同一条路 ✓）。
#   而队列是**异步**的 ✓（几秒到几十秒 ✓），用户不能在那儿干等 ✓。
#
#   所以：
#     ① 先打标记 `groups.deleting_at` ✓ → **当场**对它的人不可用 ✓
#        （拦在 `require_member` ✓，见那段 ✓）
#     ② 把这个人的成员行删掉 ✓ → 下次 bootstrap 就"没有空间"✓ → 落到初始化屏 ✓
#     ③ 往队列写 `del-<uuid>` ✓
#     ④ 后台等 worker 的回复 ✓，成功后**才**真删库行 + 删那两个目录 ✓
#
#   ⚠️ **顺序反过来会留下一件更难解释的东西** ✗：
#      先删库行、再去删 profile ✓ → 万一删 profile 失败 ✓，
#      服务器上就躺着一份**谁的记录里都不存在**的记忆 ✓（下一次建空间
#      还会撞上这个 profile 名 ✓，而 uuid 是随机的 → 撞不上 ✓，就纯是垃圾 ✓）。
#      按现在这个顺序，最坏是"库里标记着正在退出、profile 还在"✓ ——
#      看得见 ✓、能重试 ✓、也能人工收 ✓。
LEAVE_FINALIZE_SECONDS = 240      # 等 worker 的上限 ✓（正常的删目录只要一两秒 ✓）


@router.post("/api/workspaces/leave")
async def leave_space(request: Request) -> dict:
    """退出我唯一的生活空间。**全删** ✓。"""
    me = await _require_me(request)
    spaces = await _my_spaces(me["id"])
    if not spaces:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "你还没有生活空间")
    s = spaces[0]
    gid = int(s["id"])

    # ⚠️ **服务端再判一次"只剩我一个"** ✗ —— 界面把按钮灰掉只是体验 ✓，
    #    能被绕过的检查等于没有 ✓（这个项目的老规矩 ✓）。
    others = await fetch_one(
        "SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND user_id <> ?",
        (gid, me["id"]))
    if int(others["n"]) > 0:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "当前空间人数超过1人，暂不支持退出")

    uuid = (s["uuid"] or "").strip()
    if not uuid:
        # 老空间可能没有 uuid（合并之前建的 ✓）—— 从 profile 里抠出来 ✓
        prof = s.get("profile") or ""
        uuid = prof[5:] if prof.startswith("chat-") else ""
    if not uuid:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            "这个空间没有编号，退不了 —— 找管理员看看")

    # ①② 打标记 + 搬走我自己
    await execute("UPDATE groups SET deleting_at = ? WHERE id = ?", (now(), gid))
    await execute("DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
                  (gid, me["id"]))
    await execute("UPDATE user_prefs SET default_ws = NULL, last_ws = NULL WHERE user_id = ?",
                  (me["id"],))

    # ③ 排队让 root 去删那份记忆（profile + 钥匙）
    q = Path(settings.provision_queue)
    try:
        q.mkdir(parents=True, exist_ok=True)
        (q / f"del-{uuid}").write_text("", encoding="utf-8")
    except OSError as exc:
        log.error("退出空间：写不进队列（%s）：%s", q, exc)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            f"退出的请求没排进去（{exc}）—— 过一会儿再试一次")

    # ④ 后台收尾（**不阻塞这一请求** ✓：用户此刻就该被送回初始化屏 ✓）
    asyncio.create_task(_finalize_leave(uuid, gid))
    log.info("空间 %s 已标记退出（群 id=%s，用户 %s）", uuid, gid, me["id"])
    return {"ok": True, "uuid": uuid, "leaving": True,
            "note": "空间正在退出：消息和记忆都在删了，删完就没了。"}


async def _finalize_leave(uuid: str, gid: int) -> None:
    """等 worker 删完 → 把库里和磁盘上剩下的那点真删掉。

    ⚠️ 它跑在**后台** ✓（`asyncio.create_task` ✓）—— 服务重启会把它丢掉 ✓，
    所以它不是唯一的路 ✓：`_sweep_leaving()`（启动时跑一次 ✓）会把
    "标着正在退出、worker 也已经答完"的空间收掉 ✓。**两道路**是有意的 ✓：
    只靠后台任务的话，重启一次就有一堆永远"正在退出"的空间 ✓。
    """
    q = Path(settings.provision_queue)
    done = q / f"done-{uuid}"
    for _ in range(LEAVE_FINALIZE_SECONDS):
        await asyncio.sleep(1)
        try:
            text = done.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "rc=0" not in text:
            log.error("退出空间 %s：worker 说没删成 —— %s", uuid, text.strip()[:300])
            return          # ⚠️ **不清标记** ✓：留着让运维/重试看得见 ✓
        try:
            done.unlink()
        except OSError:
            pass
        await _hard_delete_space(uuid, gid)
        return
    log.warning("退出空间 %s：等了 %d 秒还没等到 worker 的回复（profile 可能还留着）",
                uuid, LEAVE_FINALIZE_SECONDS)


async def _hard_delete_space(uuid: str, gid: int) -> None:
    """真删：库行 + 组件文件 + 组件界面外观。

    ⚠️ 库行靠 `ON DELETE CASCADE` ✗ —— 但**不是每张表都写了级联** ✓，
       所以这里**显式删**那几张不带级联的 ✓（组件相关那四张 ✓），
       最后才删 `groups` 那一行 ✓（其它带级联的由它带走 ✓）。
       （"以为有级联、其实没写"是最典型的那种半删 ✓：消息没了、组件还在 ✓。）
    """
    import shutil

    for table in ("component_spots", "component_tickets", "components",
                  "workshop_messages", "workshop_tasks"):
        try:
            await execute(f"DELETE FROM {table} WHERE group_id = ?", (gid,))
        except Exception:  # noqa: BLE001
            log.exception("退出空间：清 %s 失败（继续清别的）", table)
    await execute("DELETE FROM groups WHERE id = ?", (gid,))

    for sub in ("components", "wall"):
        d = Path(settings.var_dir) / sub / f"g{gid}"
        if not d.exists():
            continue
        # ⚠️ **`ignore_errors=True` 会把失败吞掉** ✗→✓（2026-10-08 实测撞到）——
        #    它让"删不掉"（权限不对 ✓、文件被别人占着 ✓）变成**一声不吭** ✓，
        #    而这一段的整个意义就是"删干净" ✓ —— 删不掉却报"已经彻底删掉" ✓
        #    正是这个项目最烦的那种错：**看着成了、其实没成** ✓。
        #    所以照旧用 ignore_errors（一个删不掉的文件不该让整件事失败 ✓），
        #    但**删完要看一眼** ✓，没删掉就说出声 ✓（留给人工/下次启动再收 ✓）。
        shutil.rmtree(d, ignore_errors=True)
        if d.exists():
            log.warning("退出空间 %s：目录没删干净 → %s（属主/权限对不上？）", uuid, d)
    log.info("空间 %s 已经彻底删掉（群 id=%s）", uuid, gid)


async def sweep_leaving() -> None:
    """**启动时收一遍"正在退出"的空间** ✓ —— 见 `_finalize_leave` 那段说明 ✓。

    为什么非有它不可 ✗：那个后台任务活在进程里 ✓ —— 服务一重启就没了 ✓，
    于是一个"标记了、worker 也删完了、但库行还没删"的空间会**永远停在那儿** ✓
    （用户看不到它 ✓（成员行删了 ✓），可它占着库、占着磁盘 ✓，
     而且它的 profile 已经没了 → 谁也不知道它是什么 ✓）。

    顺带它还**补一次请求** ✓：万一当初那个 `del-<uuid>` 没写进队列
    （磁盘满 ✓、权限不对 ✓），这里会再写一次 ✓ —— 删是幂等的 ✓（`rm -rf` ✓），
    重复请求无害 ✓。
    """
    try:
        rows = await fetch_all(
            "SELECT id, uuid, profile FROM groups WHERE deleting_at IS NOT NULL")
    except Exception:  # noqa: BLE001
        log.exception("收退出空间：查库失败")
        return
    if not rows:
        return
    q = Path(settings.provision_queue)
    for r in rows:
        uuid = (r["uuid"] or "").strip()
        if not uuid and (r["profile"] or "").startswith("chat-"):
            uuid = r["profile"][5:]
        if not uuid:
            log.warning("有个空间标着退出但没有编号（群 id=%s）—— 手工看一下", r["id"])
            continue
        done = q / f"done-{uuid}"
        try:
            text = done.read_text(encoding="utf-8", errors="replace") if done.exists() else ""
        except OSError:
            text = ""
        if "rc=0" in text:
            try:
                done.unlink()
            except OSError:
                pass
            await _hard_delete_space(uuid, int(r["id"]))
            continue
        if text:
            # worker 答了，但**答的是"没删成"** ✓ → 不清标记 ✓（看得见 ✓ 能重来 ✓）
            log.error("退出空间 %s：worker 说没删成 —— %s", uuid, text.strip()[:200])
            continue
        # worker 还没答（或者请求压根没写进去）→ **补一次** ✓
        try:
            (q / f"del-{uuid}").write_text("", encoding="utf-8")
            log.info("退出空间 %s：补了一次删除请求", uuid)
        except OSError as exc:
            log.warning("退出空间 %s：补请求也写不进去（%s）", uuid, exc)


@router.post("/api/workspaces/join")
async def join_space(body: SpaceJoinIn, request: Request) -> dict:
    """凭邀请码进一个生活空间 ✓。

    ⚠️ 「满员就进不来」这一条**就是**用户说的"邀请码失效" ✓ ——
       码本身**不删** ✗（见 `_my_spaces` 那段：有人退出，名额自动回来 ✓）。
    """
    me = await _require_me(request)
    code = body.code.strip().upper()
    row = await fetch_one("SELECT id, uuid, name FROM groups WHERE invite_code = ?", (code,))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这个邀请码")
    if await fetch_one("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?",
                       (row["id"], me["id"])):
        # 已经在里面了 = 成功 ✓（重按一次不该报错 ✗）
        return {"uuid": row["uuid"], "name": row["name"], "already": True}
    if await _space_count(me["id"]) >= settings.max_spaces_per_user:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "你已经有一个生活空间了，先退出原来那个才能进新的")

    # ★ **满员就进不来** ✓ —— 这一条就是"邀请码失效"的全部实现 ✓。
    n = await fetch_one("SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?",
                        (row["id"],))
    if int(n["n"]) >= settings.max_space_members:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"这个生活空间已经满了（最多 {settings.max_space_members} 个人）")

    await execute("INSERT INTO group_members(group_id, user_id, role, joined_at) "
                  "VALUES(?,?,?,?)", (row["id"], me["id"], "member", now()))
    return {"uuid": row["uuid"], "name": row["name"]}


# ── 探针（原来壳上有两个，页面在用它俩）──────────────────────────────────────
#
# 它们是**排查"连没连上"用的** ✓：一个不要求登录（能连上就留痕 ✓），
# 一个要求登录。删了的话，下次"手机连不上"就少了一条判据 ✓。


@router.get("/api/debug/boot")
async def debug_boot(request: Request) -> Response:
    log.info("BOOT %s", str(request.query_params)[:600])
    return Response(content=b"", media_type="image/gif")


@router.post("/api/debug/measure")
async def debug_measure(payload: dict, request: Request) -> dict:
    await _require_me(request)
    log.info("MEASURE %s", json.dumps(payload, ensure_ascii=False)[:1500])
    return {"ok": True}
