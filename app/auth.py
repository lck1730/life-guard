"""用户、鉴权、邀请码。

直接用 bcrypt 而非 passlib——passlib 1.7.4 与 bcrypt 4.x 有已知的版本探测冲突，
这里不需要那层抽象。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import jwt
from fastapi import HTTPException, Request, status

from .config import settings
from .db import execute, fetch_one, now

# ★ **会话令牌放 Cookie，不放 localStorage。**
#
# 为什么要改（2026-10-04）：令牌存在网页里，**页面上任何一段 JS 都读得到**
# ——包括以后 agent 自己写的那段。那等于「想让它写前端」就必须把你们的
# 登录态交出去，这条路堵死。
#
# 换成 httpOnly Cookie 之后：浏览器**自动**带上，而 JS（任何 JS）**读不到**。
# 于是"壳里存着凭证所以不能下放"这个理由就不成立了，前端可以交给它。
#
# 这是标准做法：HttpOnly 这个属性存在的唯一目的就是这个。
#
# ★ 2026-10-06 重构：**这个服务不再签发会话** ✗ —— 由「壳」签发 ✓。
#
# 一次登录，多个服务 ✓：用户在壳上登一次 ✓，其余服务读**同一个 cookie** ✓。
# cookie 按**主机**共享、不按端口 ✗ —— 所以壳设的那个 cookie，
# 浏览器访问 8741 时**照样带着** ✓（这既是它的用处，也是"cookie 名必须唯一"
# 那条规矩的由来：同名会把别的服务的会话顶掉 ✗）。
SESSION_COOKIE = "lg_shell_session"

# 签发密钥。**它不在这个服务的家目录里** ✓ ——
# `/etc/lifeguard-shell/jwt.secret`，`root:lgauth 640` ✓，
# 本服务在 `lgauth` 组里 ✓ 所以读得到 ✓；
# 而 agent（`lifeguard` 用户）**不在那个组** ✓，偷不到 ✓（偷到就能伪造管理员的票 ✗）。
#
# ⚠️ 路径这一行**原来写错**过 ✗→✓（2026-10-08）：注释里写的是
#    `var/jwt.secret` ✗，而真实位置是 `/etc/...` ✓（`config.shell_jwt_secret` ✓）。
#    代码一直是对的 ✓（它读的是配置 ✓）—— 错的是这段注释 ✓，
#    而注释写错会让人按它去找文件、然后怀疑人生 ✓。
# ⚠️ 合并之后（同一个服务管登录）**这个密钥一份都不许复制** ✗ ——
#    模型网关（8722）和 App 管家（8742）**也拿它验票** ✓，
#    复制出第二份 = 迟早两边签的票互不认账 ✓。
_secret_cache: bytes | None = None


def _shell_secret() -> bytes:
    global _secret_cache
    if _secret_cache is None:
        _secret_cache = Path(settings.shell_jwt_secret).read_bytes()
    return _secret_cache


def _token_from_request(request: Request) -> str | None:
    """先看 Cookie，再退回 Authorization 头。

    头那条是**给脚本用的**（我自己的诊断脚本、以后可能的命令行工具）。
    网页**不再走这条**——它一旦走，就成了"令牌又能被 JS 摸到"。
    """
    raw = request.cookies.get(SESSION_COOKIE)
    if raw:
        return raw
    auth = request.headers.get("authorization", "")
    if auth[:7].lower() == "bearer ":
        return auth[7:].strip() or None
    return None

INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉易混淆的 I/O/0/1

# ── 密码：**两种格式都认** ✗→✓（2026-10-08 合并那次）─────────────────────
#
# 合并之前是两个人各写一套：壳用 `hashlib.scrypt`（标准库 ✓ 为了不引依赖 ✓），
# 这个服务用 `bcrypt`（早就在这儿了 ✓）。**存量用户的哈希是 scrypt 的** ✓
# —— 也就是"能不能登进去"全押在这一段上 ✓。
#
# ⚠️ **迁移期绝不重算哈希** ✗：把 scrypt 改成 bcrypt 要拿到明文 ✗，
#    而唯一能拿到明文的那一刻就是用户**正在登录**的时候 ✓。
#    "顺手在登录时升级一下"听着聪明 ✗ —— 但它的失败模式是
#    **有人那天之后就登不进去了** ✓，而收益只是"库里的格式整齐" ✗。
#    所以：**按前缀分派，谁也不动** ✓（这段一共几十行，永远不坏 ✓）。
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 16384, 8, 1


def hash_password(raw: str) -> str:
    """新密码一律用 **scrypt** ✓ —— 标准库、无依赖、强度足够 ✓。

    代价是每次验证要花 ~50ms —— 那是特性不是缺陷 ✓（它就是在拖慢暴力破解 ✓）。
    """
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(raw.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R,
                        p=_SCRYPT_P, dklen=32)
    return (f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}"
            f"${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}")


def _verify_scrypt(raw: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt_b64, dk_b64 = stored.split("$")
        if kind != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        want = base64.b64decode(dk_b64)
        dk = hashlib.scrypt(raw.encode(), salt=salt, n=int(n), r=int(r), p=int(p),
                            dklen=len(want))
    except Exception:  # noqa: BLE001
        return False
    return hmac.compare_digest(dk, want)          # 常数时间 ✓


def _verify_bcrypt(raw: str, stored: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode(), stored.encode())
    except ValueError:
        return False


def verify_password_any(raw: str, stored: str) -> bool:
    """认两种格式 ✓（按**哈希自己的前缀**分派，不看是谁写的 ✓）。

    ⚠️ 别处**一律调这个** ✗ —— 直接调 bcrypt 的话，
    存量那些 scrypt 用户会**永远登不进去** ✓，而且报的是"密码不对" ✓
    （看起来像他自己记错了密码 ✓，最难查的一种 ✓）。
    """
    if not stored:
        return False
    if stored.startswith("scrypt$"):
        return _verify_scrypt(raw, stored)
    return _verify_bcrypt(raw, stored)


# 老名字，指同一个东西 ✓（合并前这个服务里到处都在调 `verify_password` ✓）
verify_password = verify_password_any


# 预览会话（给 agent 的眼睛用）。见 main.py 的 `/preview` 和
# routes_internal.py 的 `/preview`：agent 有 browser_exec，能开浏览器能截图，
# 但它不知道你们的密码——那就等于没眼睛。这边给它一张**短时、只读**的门票。
PREVIEW_SCOPE = "preview"


def decode_token(raw: str) -> dict | None:
    """验一张票：过了返回 payload ✓，无效/过期返回 None ✓。

    ⚠️⚠️ **一律用壳的密钥，而且只留这一个函数** ✗→✓ —— 2026-10-07：

      `main.py` 里有两处自己写着 `jwt.decode(t, settings.jwt_secret, ...)` ✗
      ——那是**这个服务自己的**密钥（`"dev-only-change-me"` ✗），
      而"一次登录"重构之后，票是**壳**签的 ✓。
      `auth.py` 这一路改了 ✓，那两处**漏了** ✗ →
      **每一次都验不过** ✓。

      代价：**WebSocket 握手 2798 次全被拒、成功 0 次** ✓ ✓
      （没 accept 就 close ✓ → uvicorn 报 403 ✓）
      → 群里**从来不实时** ✗：新消息、管家的回复，
        全都得等下一次整页加载才看得到 ✓。

      所以：**验票只走这里** ✓。别处想验票就调它 ✓，
      不要再自己 `jwt.decode` ✗ —— 同一个规则散在多处，迟早走岔 ✓。
    """
    if not raw:
        return None
    try:
        return jwt.decode(raw, _shell_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def make_token(user_id: int, *, scope: str | None = None, minutes: int | None = None) -> str:
    if minutes is not None:
        exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    else:
        exp = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload: dict = {"sub": str(user_id), "exp": exp}
    if scope:
        payload["scope"] = scope
    # ⚠️ **用壳的密钥签** ✗→✓ —— 2026-10-07：原来用的是这个服务自己的 ✗，
    #   于是签出来的票**自己人都验不过** ✓（`current_user` 拿壳的密钥验 ✓）
    #   → agent 那张"眼睛"预览票兑换完立刻 401 ✓。
    #   票是给**这个服务自己**用的（`scope=preview` ✓），但密钥必须和壳一致 ✓
    #   —— 否则就是两套互不认账的票 ✓。
    return jwt.encode(payload, _shell_secret(), algorithm="HS256")


# ── ★ 会话票（"谁登录了"）✗→✓ 2026-10-08 合并那次 ────────────────────────
#
# 这张票**原来是壳签的** ✓ —— 合并之后由这个服务签 ✓（登录这一步搬过来了）。
# 形状**一个字没改** ✗→✓（`sub` / `adm` / `nick` / `exp` ✓）：
#
#   · `adm` 还有人认 ✓（模型服务那一页要它 ✓ —— 2026-10-10 起
#     App 管家已经拆了 ✗，那边不再需要 ✓、
#     模型网关的页面也要 ✓）—— 少了它，管理员进不去那两个页面 ✓。
#   · `nick` 是"**第一次见到这个人**时给他起个名"用的 ✓（见 `ensure_user` 那段 ✓）。
#     ⚠️ 它是**签发那一刻的快照** ✗ —— 所以**不能拿它去覆盖库里的昵称** ✓
#     （那个 bug 2026-10-06 踩过一次：改完名永远显示旧的 ✓）。
#   · `exp` 720 小时 ✓（30 天 ✓）—— 手机上不用老登录 ✓。
#
# `scope=preview` 那张票是另一回事 ✓（agent 的"眼睛" ✓ 短时只读 ✓），
# 走下面的 `make_token` ✓，别和这张混 ✓。
SESSION_HOURS = int(getattr(settings, "session_hours", 0) or 720)


def make_session_token(user_id: int, *, is_admin: bool, nickname: str = "",
                       hours: int | None = None) -> str:
    payload = {
        "sub": str(user_id),
        "adm": bool(is_admin),
        "nick": (nickname or "")[:32],
        "exp": int(time.time()) + (hours or SESSION_HOURS) * 3600,
    }
    return jwt.encode(payload, _shell_secret(), algorithm="HS256")


def new_invite_code(length: int = 8) -> str:
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(length))


def new_beta_code(length: int = 10) -> str:
    """内测码。**比空间邀请码长** ✓（10 位 vs 8 位 ✓）。

    两者的威胁模型不同 ✓：空间邀请码是"熟人之间分个组" ✓（猜到了也就是混进一个空间 ✓）；
    内测码是**注册的闸门** ✓（猜到了就能建号 ✓）。32 个字母 × 10 位 = 50 bit ✓，
    配上登录限流，瞎猜没戏 ✓。
    """
    return new_invite_code(length)


def new_uuid() -> str:
    """空间号（8 位 hex ✓）—— 同时是 Hermes profile 名的一部分（`chat-<uuid>` ✓）。"""
    return secrets.token_hex(4)


async def create_user(username: str, password: str, nickname: str) -> dict:
    if await fetch_one("SELECT id FROM users WHERE username = ?", (username,)):
        raise HTTPException(status.HTTP_409_CONFLICT, "用户名已被占用")
    uid = await execute(
        "INSERT INTO users (username, password_hash, nickname, created_at) VALUES (?,?,?,?)",
        (username, hash_password(password), nickname, now()),
    )
    return await fetch_one("SELECT id, username, nickname, avatar FROM users WHERE id = ?", (uid,))  # type: ignore[return-value]


async def authenticate(username: str, password: str) -> dict:
    row = await fetch_one("SELECT * FROM users WHERE username = ?", (username,))
    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    return row


async def current_user(request: Request) -> dict:
    raw = _token_from_request(request)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "缺少凭证")
    payload = decode_token(raw)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "凭证无效或已过期")
    # ★ 预览票**只能看**。它是给 agent 那双眼睛用的（开浏览器截图），
    #   不是给它替你们发消息的——所以写操作一律拒掉。
    #   这一条是这个入口敢开的前提：不给它这条限制，就等于让它能冒你们的名。
    if payload.get("scope") == PREVIEW_SCOPE and request.method not in ("GET", "HEAD"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "这是给你「看」的预览会话，不能改东西（发消息、改设置都不行）。",
        )
    uid = int(payload["sub"])
    return await ensure_user(uid, (payload.get("nick") or "").strip())


async def ensure_user(uid: int, nick: str = "", uname: str = "",
                      authoritative: bool = False, avatar: str = "") -> dict:
    """★ 让这个用户在本服务的库里**有一条行** ✓（第一次见到谁就补一条）。

    用户表的**所有权在壳那边** ✓（注册、改名都归它 ✓），这个服务不持有 ✗。
    但它处处要 join 用户表 ✓：发消息要昵称、成员列表要昵称、
    每一轮的人格注入（`_group_persona`）也要 ✓ —— 那些都在**每轮的热路径**上 ✗，
    不能每次都去问壳 ✗（那是每轮多一次跨服务往返 ✗）。

    所以：**按需镜像** ✓，不搞同步任务 ✗。昵称从票里来 ✓（壳签发时塞进 `nick` ✓）；
    用户在壳那边改名后，下次他在壳上重新登录、或者重新进一次工作区时会刷新 ✓。

    ⚠️ **两个地方必须都调它** ✗：一条是常规请求的鉴权 ✓，
    另一条是"进工作区"（`main.py:enter_workspace` ✓）——
    后者会往 groups 里插一行、而 `groups.owner_id` 是外键 ✗，
    用户行不在就会 **FOREIGN KEY constraint failed** ✗
    （2026-10-06 就是这么炸的 ✗：进工作区直接 500 ✗）。
    """
    nick = nick or f"用户{uid}"
    user = await fetch_one(
        "SELECT id, username, nickname, avatar FROM users WHERE id = ?", (uid,)
    )
    if user:
        # ⚠️ **昵称要不要覆盖，取决于"这个名字是谁说的"** ✗ —— 2026-10-06 实测：
        #
        #   · 票说的（这个函数平时被调的地方）→ **不覆盖** ✗
        #     票是**登录那一刻**签的 ✓，里面的昵称是那会儿的快照 ✗。
        #     而每个请求都会走到这儿 ✓ → 壳那边改了名、也同步过来了 ✓，
        #     下一个请求立刻又被票里的旧值冲回去 ✗ ——
        #     表现就是设置里那个昵称**永远是旧的** ✗，刷新多少次都没用 ✓
        #     （我一度以为是页面没刷新 ✗）。
        #
        #   · 壳说的（`authoritative=True`，只有"进工作区"那一步 ✓）→ **覆盖** ✓
        #     壳手里是**账户的真名** ✓，它才是权威 ✓。
        #
        # 一句话：**票只负责"第一次见到谁时给他起个名"** ✓，
        # 之后的每一次改名，都由壳那边说了算 ✓。
        if authoritative and nick and user["nickname"] != nick:
            await execute("UPDATE users SET nickname = ? WHERE id = ?", (nick, uid))
        # ★ 头像和昵称**同一个规矩** ✓ —— 2026-10-06 加。
        #
        #   权威在壳那边 ✓（`/avatars/<id>` 那几个文件也是它管的 ✓）。
        #   这个服务只是**镜像一份路径** ✓，好让消息里的 `sender_avatar` 有值 ✓。
        #
        #   为什么非要镜像、不每次去问壳 ✗：消息查询里要 join 出来 ✓，
        #   那是**每屏几百条**的热路径 ✓，一条消息问一次壳是不可想象的 ✓
        #   （和昵称当初决定镜像的理由一模一样 ✓）。
        #
        #   ⚠️ 空值**不覆盖** ✗：壳那边返回空（这人没上传头像 ✓）时，
        #      不能把本地已经有的擦掉 ✓ —— 那会变成"清一次头像就再也回不来" ✓。
        if authoritative and avatar and user["avatar"] != avatar:
            await execute("UPDATE users SET avatar = ? WHERE id = ?", (avatar, uid))
        #
        # 用户名也补一次 ✓ —— 第一次"见到"这个人的时候，本地插的是 `u<id>`
        # 这个**占位名** ✓（因为票里只有昵称、没有用户名 ✗）。
        # 只在还是占位名的时候改 ✓：username 是带唯一索引的 ✗，
        # 真去撞一个已有的名字会直接报错 ✓，而那不是我们要处理的事 ✓。
        if uname and user["username"] == f"u{uid}":
            await execute("UPDATE users SET username = ? WHERE id = ? AND username = ?",
                          (uname, uid, f"u{uid}"))
        return await fetch_one(
            "SELECT id, username, nickname, avatar FROM users WHERE id = ?", (uid,)) or user
    await execute(
        "INSERT OR IGNORE INTO users(id, username, nickname, password_hash, created_at) "
        "VALUES(?,?,?,?,?)",  # 只在**新行**上用票里的昵称 ✓
        (uid, f"u{uid}", nick, "!", int(time.time())),
    )
    user = await fetch_one(
        "SELECT id, username, nickname, avatar FROM users WHERE id = ?", (uid,)
    )
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在")
    return user


async def require_member(group_id: int, user_id: int) -> dict:
    """成员校验——**所有**涉及空间数据的接口都必须先过这里 ✓。

    ★ 2026-10-08 顺手把"这个空间正在退出"也拦在这儿 ✗→✓。

      退出空间是**两段**的 ✓（见 `routes_shell.leave_space` ✓）：
      先打一个"正在退出"的标记 ✓（它当场就该对用户不可用 ✓），
      再由 root 的 worker 去删那份 profile 记忆 ✓（那个要几秒到几十秒 ✓）。

      ⚠️ 拦在**这一处**是有意的 ✗：群数据有十几个入口 ✓（消息 ✓ 成员 ✓ 账本 ✓
         提醒 ✓ 组件 ✓ 工坊 ✓ …），一个个去加判断迟早漏一个 ✓ ——
         而漏掉的那一个，症状是"退出之后还能看到/还能写" ✓，很难解释 ✓。
         这里一处拦住 = 全都拦住了 ✓（**唯一入口**是这类事情唯一靠得住的写法 ✓）。
    """
    row = await fetch_one(
        """SELECT gm.role, g.deleting_at FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           WHERE gm.group_id = ? AND gm.user_id = ?""",
        (group_id, user_id),
    )
    if not row:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "你不是该群成员")
    if row["deleting_at"]:
        raise HTTPException(status.HTTP_410_GONE, "这个生活空间正在退出，已经不能用了")
    return row
