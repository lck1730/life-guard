"""应用入口：路由装配 + WebSocket 下行通道。

**消息上行走 HTTP，下行走 WebSocket**——上行用 HTTP 是为了有明确的成功/失败语义，
不会因为连接抖动静默丢消息；下行用 WebSocket 是为了即时性。
"""

from __future__ import annotations

import asyncio
import json
import hashlib
import logging
import re
import shutil
import time

import httpx
from contextlib import asynccontextmanager
from pathlib import Path

from pydantic import BaseModel, Field

import jwt
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"

from . import idle, records as rec, reminders
from .auth import (PREVIEW_SCOPE, SESSION_COOKIE, current_user, decode_token,
                   ensure_user, make_token, new_invite_code, require_member)
from .config import settings
from .db import (close_db, execute, execute_rc, fetch_all, fetch_one, init_db,
                 now)
from .hub import hub
from .messages import current_status_for
from .routes_auth import router as auth_router
from .routes_groups import router as groups_router
from .routes_internal import restart_watcher
from .routes_internal import router as internal_router
from .routes_media import router as media_router
from .routes_workshop import poke_loop
from .routes_workshop import router as workshop_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("lifeguard")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    await init_db()
    log.info("生活管家后端已启动，数据目录 %s", settings.data_dir.resolve())

    # 两个后台循环，都在我们自己的进程里：
    #  - 提醒：到点唤起一次发言（不用 Hermes 内部 cron，那套的投递是断的还会静默失败）
    #  - 空闲唤醒：隔一阵子给它一次"没人叫你，你也可以说点什么"的机会
    # 第三个：**重启排队**。agent 在对话中间调 restart_backend 时，
    # 直接重启会把它正在说的那一轮掐掉（用户那边就是"问了没回"）。
    # 所以那个接口只排队，由这个循环挑"没人在跑"的时机动手。
    tasks = [
        asyncio.create_task(reminders.ticker_loop()),
        asyncio.create_task(idle.loop()),
        asyncio.create_task(restart_watcher()),
        # ★ 工坊的「等子代理交付」✓（2026-10-07 深夜 ✓）——
        #   子代理的结果**只有下一轮才看得到** ✓，而工坊的下一轮只有用户说话才会来 ✓
        #   → 得有人替它开口 ✓。见 `routes_workshop.poke_loop` 那段 ✓。
        asyncio.create_task(poke_loop()),
    ]
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        await close_db()


app = FastAPI(title="生活管家", version="0.1.0", lifespan=lifespan)

# 开发期允许浏览器测试页直连。生产环境应改成具体来源。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(groups_router)
app.include_router(media_router)
app.include_router(internal_router)
app.include_router(workshop_router)

# 禁缓存的头。界面是"改服务器文件 = 用户重开 App 生效"的架构，
# 一旦被 WebView 缓存住，改了不生效，用户会以为改动没做
# （这个坑反复出现过好几次）。所以凡是下发界面的地方都得带上它。
_NO_STORE = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

#: 主页面用的头 ✓ —— 2026-10-06 加，为了"聊天 ⇄ 我的"那一趟的延迟 ✓。
#:
#: ⚠️ **和 `_NO_STORE` 不是一回事，别混** ✗：
#:     · `no-store` = "**别留副本**" ✓（agent 随时会改的东西用这个 ✓，
#:        例如 `/ui/app.js`、头像 ✓ —— 它们小 ✓，重传无所谓 ✓）
#:     · `no-cache` = "留副本，但**每次用之前必须问过服务器**" ✓
#: 所以这里**丢不掉新鲜度** ✓ —— 唯一省掉的是"内容没变时的正文重传" ✓。
#: 群聊这一页 ~100KB ✓，而它进一次就重下一遍 ✓（要过 WireGuard ✓），
#: 一趟 304 就只剩几百字节 ✓。
#:
#: （当初那次"页面改了不生效"的真正原因是：副本在**这些头存在之前**就已经落在
#:   WebView 里了 ✓ —— 和头本身没关系 ✓。这次不会再撞上 ✓：
#:   `no-cache` 的副本每次都会被重新验证 ✓。）
_NO_REVALIDATE = {"Cache-Control": "no-cache", "Pragma": "no-cache"}


settings.ensure_dirs()
app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")


class _NoStoreStatic(StaticFiles):
    """界面层的静态文件。

    ★ 2026-10-06 改：从"一律禁缓存" ✗ 改成**分两种** ✓ ——
      用户报"进群聊头像每次都闪一下" ✓，而真因就在这一层 ✓。

      · **带版本号的**（`?v=<时间戳>` ✓，只用于群头像 ✓）→ **长期缓存** ✓✓。
        URL 带版本 = 内容变了 URL 就变 ✓ → 缓存多久都不会错 ✓。
        这条最要紧 ✓ —— 头像**一次请求都不发**，直接命中缓存 ✓，
        **闪的那一下就是这么没的** ✓。
      · 其余（`app.js` / `theme.css` / 组件 ✓ —— agent 随时会改 ✓）→
        `no-cache` ✓ = "**用之前必须问一句**" ✓。
        Starlette 的 StaticFiles 自带 ETag ✓，没变就是 **304** ✓ ——
        **既不会"改了看不到" ✗，也不用整份重下 ✓**。
        （原来那句 `no-store` 是"**别留副本**" ✗ —— 每次都整份重传 ✓；
          对几 KB 的 css 无所谓 ✓，但这里要的恰恰是"看一眼有没有变" ✓。）
    """

    async def get_response(self, path, scope):  # type: ignore[override]
        resp = await super().get_response(path, scope)
        qs = (scope.get("query_string") or b"").decode("latin-1")
        # ⚠️ **只看"带没带版本号"，不看它在哪个子目录** ✗→✓ —— 2026-10-06：
        #   上一版限定成 `avatars/` 开头 ✓，于是**没配自己头像的群**
        #   用的那张默认图 `/ui/avatar.png` ✗ 落进了"每次都得问一句"那一档 ✗
        #   → **管家的头像照旧闪** ✓（用户一眼就发现了 ✓）。
        #   规则本来就该只有一条 ✓：**URL 带版本号 = 内容变了 URL 就变 = 缓存多久都对** ✓。
        if "v=" in qs:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            resp.headers.update(_NO_REVALIDATE)
        return resp


# agent 自己那块：/ui/theme.css（覆盖样式）、/ui/avatar.png（它的头像）、
# /ui/components/...（它做的组件）。归服务用户所有，它随时可以改。
app.mount("/ui", _NoStoreStatic(directory=settings.ui_dir), name="ui")


@app.get("/health")
async def health() -> dict:
    # `service` 这个标记是**给人看的**：对讲机在隔壁端口，它的 /health 也是
    # {"status":"ok"}，两边长得一模一样——2026-10-04 用户就把 App 的地址填成了
    # 对讲机那个端口，而壳认不出来。留个标记，以后谁看一眼就知道连的是谁。
    return {"status": "ok", "service": "lifeguard"}


# APK 放这儿。**刻意不加 no-store**：它是几十兆的静态文件，
# 每次重下反而更糟；而且文件名带版本号，天然不会撞缓存。
app.mount("/releases", StaticFiles(directory=settings.releases_dir), name="releases")


@app.get("/api/app/latest")
async def app_latest() -> dict:
    """手机问"有没有新版"。

    ## 为什么这个接口**故意不鉴权**

    它要在"壳太旧、连页面都渲染不出来"的时候也能用——那正是它存在的理由。
    加鉴权就等于说"你得先能进去，才能知道自己进不去"。

    所以它吐的东西必须是最少的：**一个版本号 + 一个文件路径 + 一段说明**，
    不碰任何用户数据、不碰群、不碰消息。

    ## 为什么是服务端说了算，而不是手机自己找

    手机只报"我是 versionCode=3"。比大小、决定要不要升级，都在服务端——
    这样**发不发新版是你能控制的**（不想让人升，就别动 latest.json）。
    """
    f = settings.releases_dir / "latest.json"
    if not f.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "还没有发布过任何版本")
    try:
        import json as _json
        return _json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        log.exception("releases/latest.json 读不出来")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "latest.json 格式不对")


# ── 进一个工作区 ─────────────────────────────────────────────────────────────
#
# 用户是从「壳」点进来的：`8741/?ws=<uuid>` ✓。
#
# ## 为什么"这人真在这个空间里吗"要去问壳
#
# 成员关系的事实**归壳** ✓（它持有 users / workspaces / members ✓），
# 本服务只镜像一份"我见过的工作区" ✓，用来放消息和账本 ✓。
#
# ## 为什么带着**用户自己的票**去问
#
# 那样壳那边**不需要第二套内部凭证** ✓，而且回答天然是"针对这个人的" ✓ ——
# 壳**不相信调用方自称的 user_id** ✗（那正是要避免的东西 ✓）。
# 一个 cookie 就够：它本来就会跟着请求过来 ✓（cookie 按主机共享、不按端口 ✓）。
async def enter_workspace(request: Request, ws: str) -> str | None:
    """成功返回 None；失败返回一句给用户看的话。"""

    token = request.cookies.get(SESSION_COOKIE) or ""
    if not token:
        return "还没有登录（先回壳登录一次）"

    url = f"{settings.shell_base_url.rstrip('/')}/api/internal/membership?ws={ws}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(url, headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 403:
            return "你不在这个工作区里"
        if r.status_code != 200:
            return f"壳那边没答上来（HTTP {r.status_code}）"
        info = r.json()
    except Exception as exc:  # noqa: BLE001
        return f"问不到壳（{exc}）—— 它可能没起来"

    # ⚠️ **先把用户行补出来** ✗ —— groups.owner_id 是外键，
    # 用户行不在，下面那条 INSERT 会直接 FOREIGN KEY constraint failed ✗
    #（进工作区走的是 cookie ✓，没经过常规鉴权那条路 ✓，所以这里得自己补 ✓）。
    uid = int(info["user_id"])
    # ⚠️ 这两个值要**每次都同步** ✗ —— 票里的昵称是**签发那一刻**的快照 ✓，
    # 用户后来改了昵称/用户名，票还是旧的 ✓。
    # 症状就是：设置里「我的」那一行写着**上一个昵称** ✗（2026-10-06 实测 ✓）。
    # 进工作区这一步本来就要问壳 ✓，顺路把这两个值带回来最省事 ✓。
    await ensure_user(uid, (info.get("nickname") or "").strip(),
                      (info.get("username") or "").strip(), authoritative=True,
                      avatar=(info.get("avatar") or "").strip())

    # ── 把"我见过这个工作区"在本地补出来 ──
    #
    # 用 profile 做键 ✓（一个工作区 ⇄ 一个 profile，两边唯一 ✓），
    # 所以重复进同一个工作区不会造出第二个群 ✓。
    profile = info.get("profile") or ""
    if not profile:
        return "壳那边没给 profile 名"
    # ★ **邀请码以壳为准** ✗→✓（2026-10-08 用户报的：「testuser那个群的邀请码
    #   不能用」✓）。
    #
    #   这张表原来**自己摇一个码** ✓（下面那个 `new_invite_code()` ✓）——
    #   那是**壳之前**的老做法 ✓（那时"加入一个群"是生活管家自己管的 ✓）。
    #   现在加入是**壳**管的 ✓（`/api/workspaces/join` 认的是
    #   `workspaces.invite_code` ✓），于是两边各有一个"邀请码" ✗ ——
    #   设置页显示的是**这一个** ✗、加入时认的是**那一个** ✗ →
    #   照抄界面上那个码，永远进不去 ✓（而且不报错，只说"没有这个邀请码"✓）。
    #
    #   所以**每次进工作区顺路把它抄成壳那一份** ✓ —— 名字本来就是这么同步的 ✓
    #   （同一处、同一个来源 ✓），邀请码跟着走最省事、也不会再多一个会漂的字段 ✓。
    #   ⚠️ 壳没给（老壳 / 字段缺）就**留着原值** ✗ —— 清成空的，界面会变成
    #      "这个群没有邀请码" ✓，那比显示一个旧码更难解释 ✓。
    code = (info.get("invite_code") or "").strip()
    row = await fetch_one("SELECT id FROM groups WHERE profile = ?", (profile,))
    if row:
        gid = int(row["id"])
        if code:
            await execute("UPDATE groups SET name = ?, invite_code = ? WHERE id = ?",
                          (info.get("name") or "空间", code, gid))
        else:
            await execute("UPDATE groups SET name = ? WHERE id = ?",
                          (info.get("name") or "空间", gid))
    else:
        gid = await execute(
            "INSERT INTO groups(name, owner_id, profile, invite_code, created_at) "
            "VALUES(?,?,?,?,?)",
            (info.get("name") or "空间", int(info["user_id"]), profile,
             code or new_invite_code(), int(time.time())),
        )
    await execute(
        "INSERT OR IGNORE INTO group_members(group_id, user_id, role, joined_at) "
        "VALUES(?,?,?,?)",
        (gid, uid, info.get("role") or "member", int(time.time())),
    )
    log.info("工作区 %s（profile=%s）→ 本地群 id=%s，用户 %s 已就位",
             ws, profile, gid, info.get("user_id"))
    return None


@app.get("/")
async def index(request: Request, ws: str | None = None) -> Response:
    """网页界面。客户端（App 里的 WebView 和浏览器）都从这里加载。

    ## 壳是我们的，**行为现在也可以是 agent 的**

    这个页面（`static/index.html`）是**壳**：登录、WebSocket、消息渲染都在里面。
    它归 root，agent 改不了——**但它读得到**（读得到是必须的，否则它没法知道
    自己能挂哪些钩子）。

    它改不了壳，但可以往 `ui/` 里写两样东西，这里都会挂上去：

    | 文件 | 挂在哪 | 作用 |
    |---|---|---|
    | `ui/theme.css` | 内联进 `<head>` | 覆盖样式（配色、版式、气泡形状） |
    | `ui/app.js` | 页面**末尾** | 它写的脚本，跑在页面自己的脚本之后 |

    **为什么现在才敢开 `app.js` 这个口子**：登录凭证已经从网页的
    `localStorage` 搬进了 httpOnly Cookie（见 `auth.py` 的 `SESSION_COOKIE`）。
    页面上任何一段 JS——包括它写的——**都读不到令牌**。
    所以"它能写 JS"不再等于"它能偷走你的登录态"，这条线才画得下去。

    **文件不存在就什么都不做**——这就是"它改坏了"的自愈方式：删掉即回默认。
    删掉 `app.js`，交互立刻回到原样，不需要重新部署任何东西。
    """
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    theme = settings.theme_path
    if theme.exists():
        try:
            css = theme.read_text(encoding="utf-8", errors="replace")
        except OSError:
            css = ""
        if css.strip():
            # 砍个上限：这是别人（agent）写的东西，不该有能力把响应撑爆
            css = css[:200_000]
            html = html.replace(
                "</head>", f"<style id=\"agent-theme\">\n{css}\n</style>\n</head>", 1
            )
            log.info("已注入 agent 主题（%d 字符）", len(css))
    # ── agent 写的前端脚本 ──
    #
    # ★ **一个功能一个文件。** 从 2026-10-05 起改成这样：
    #
    #     ui/app.js          ← 旧的单个文件，继续兼容（它俩功能都在这）
    #     ui/app/*.js        ← 按文件名排序，**全部**加载
    #
    # **为什么**：以前所有界面改动都堆在 app.js 一个文件里，而 agent 每加一个
    # 功能就**整体重写**它 ✗ —— 它没有"别把旧的弄丢"的机制，漏一次就真没了
    # （用户实测丢过两回，原话是"弄别的功能就容易波及"）。
    # 改成目录之后，**加功能 = 新增文件**，从结构上就碰不到别人 ✓
    #
    # 附带的好处：一个文件报错**只影响它自己** ✓（分开的 <script> 标签各自独立），
    # 爆炸半径从"整个界面扩展全挂"缩到"那个功能挂了" ✓
    #
    # 用 <script src> 而不是内联：改一次就生效（文件禁缓存），
    # 而且报错时能看到 `ui/app/xx.js:行号`，不是一坨内联代码。
    scripts: list[str] = []
    if (settings.ui_dir / "app.js").exists():
        scripts.append("/ui/app.js")
    appdir = settings.ui_dir / "app"
    if appdir.is_dir():
        scripts += ["/ui/app/" + f.name for f in sorted(appdir.glob("*.js"))]
    if scripts:
        html = html.replace(
            "</body>",
            "".join(f'<script src="{s}"></script>\n' for s in scripts) + "</body>",
            1,
        )
        log.info("已挂载 %d 个 agent 脚本：%s", len(scripts), ", ".join(scripts))
    # ★ 副作用**先跑**，和"发不发正文"无关 ✓ —— 2026-10-06。
    #   304 只是"正文不用重传了" ✓，不是"这次进来什么都没做" ✗：
    #   进工作区那一步还要**镜像昵称和头像** ✓（见 enter_workspace ✓），
    #   少了它，"换了头像之后头像不更新" ✓ 会以最莫名其妙的方式回来 ✓。
    if ws:
        # 记下"这台设备正在哪个工作区" ✓ —— 后面 bootstrap / WebSocket
        # 都靠它选对那一个群 ✓（一个人可能有 ≤3 个工作区 ✓）。
        #
        # 失败**不拦路** ✓：页面照常渲染 ✓，前端拿不到数据会自己显示出来 ✓
        # —— 白屏比一句错误难排查得多 ✗。
        problem = await enter_workspace(request, ws)
        if problem:
            log.warning("进工作区 %s 没成功：%s", ws, problem)

    # ★ ETag 把 `ws` **和当前 cookie 里的 ws** 一起算进去 ✗→✓ —— 2026-10-07。
    #
    # 用户报的：「切到测试2群之后，再切回测试群回不去了」✓。机制（已用 curl 复现）：
    #
    #   切群靠**设 cookie** ✓（页面不从 URL 读 ws ✗，它读 `lg_chat_ws` ✓）；
    #   而 ETag 命中时走 **304** ✓，那条路上**不带 `Set-Cookie`** ✗。于是 A→B→A：
    #
    #     ① `?ws=A`（第一次）→ 200 + cookie=A ✓
    #     ② `?ws=B`          → 200 + cookie=B ✓
    #     ③ `?ws=A`（第二次）→ ETag 和①**一模一样** → **304** ✗ → cookie 还是 B ✗
    #
    #   → 页面按 A 的地址加载 ✓，而它读到的 cookie 是 B ✗ → **显示 B** ✓
    #   —— 就是"回不去" ✓。
    #
    # ⚠️ 为什么**把 cookie 算进 ETag**，而不是"在 304 上也带 Set-Cookie" ✗→✓：
    #   后者能行 ✓（304 上带 Set-Cookie 是标准允许的 ✓），但它依赖各家浏览器的
    #   实现一致 ✓ —— 而 WebView 是**这个问题唯一发生的地方** ✓（浏览器里本来
    #   就很少"拿着旧 ETag 切回去"✓）。**把 ETag 做成"它必然不匹配"** ✓
    #   不依赖任何浏览器行为 ✓，代价只是**换群那一次**重传一遍正文 ✓
    #   （~100KB ✓，而这正是唯一需要重传的时候 ✓）。
    _cur = request.cookies.get("lg_chat_ws") or ""
    etag = ('"' + hashlib.sha256((ws or "").encode() + _cur.encode() + html.encode())
            .hexdigest()[:16] + '"')
    inm = request.headers.get("if-none-match") or ""
    if etag in [x.strip() for x in inm.split(",")]:
        return Response(status_code=304, headers=dict(_NO_REVALIDATE, ETag=etag))

    resp = HTMLResponse(html, headers=dict(_NO_REVALIDATE, ETag=etag))
    if ws:
        # ⚠️ **带上 `max_age`** ✗→✓ —— 原来是个没有期限的会话 cookie ✓，
        #   一旦它丢了，`bootstrap` 会退化成"按 id 倒序取第一个" ✓ →
        #   **可能进错空间** ✗（那种错还很难看出来 ✓）。
        #   30 天，够长 ✓；而且 304 那条路上我们不再能重设它 ✓
        #   （304 上带 Set-Cookie 各家的处理不一致 ✗），所以它必须自己撑住 ✓。
        resp.set_cookie("lg_chat_ws", ws, path="/", httponly=True, samesite="lax",
                        max_age=30 * 24 * 3600)
    return resp


# ── 组件层：agent 自己做的可视化小工具 ────────────────────────────────
#
# ## 它和 `ui/app.js` 的分工
#
# `app.js` 能改**整个界面**，那是"它来做产品"。组件层要的是另一件事：
# **给它一块安全的白板**——画图表、做面板，怎么写都不会把 App 弄坏。
#
# ## 为什么这样就安全
#
# 组件跑在 **`srcdoc` + `sandbox="allow-scripts"`** 的 iframe 里——
# 没有 `allow-same-origin`，所以它是**不透明源**：
#   · 读不到 localStorage / Cookie（拿不到登录态）
#   · 碰不到父页面（改不了界面）
#   · 它自己写的任何 JS 只影响那一小块画布
#
# 代价是**它也没法自己去取数据**（跨源请求被拦）。所以数据由页面
# （已登录的那一侧）取好、直接塞进去给它。**数据流是单向下发的**，
# 组件那边碰不到任何接口。
#
# ## 它是什么
#
# ## 它放在哪（2026-10-07 改过）
#
# **每个群一份** ✓：`var/components/g<群号>/<名字>/index.html`，可选 `meta.json`：
#     {"title": "记账面板", "icon": "💰", "data": {"records": {"kind": "bookkeeping", "days": 30}}}
#
# 原来是一个全局目录 ✗ —— 每个群看到的是同一批组件 ✓。搬到 `var/` 还有两个理由 ✓：
#   · `ui/` 整个挂在 `/ui` 上**无鉴权** ✓ → 放那儿等于跨群可猜 ✗
#   · `ui/**` 按 `SOUL-app-butler.md` 是**归 App 管家管**的 ✗
#
# ⚠️ 而 `var/components` 的权限是 **2750（组只读）** ✓ ——
# **agent 写不进这个目录** ✓，所以"没确认过不许写"才是真的拦得住 ✓（见方案第七节 ✓）。

@app.get("/api/components")
async def components_list(
    group_id: int = Query(...), user: dict = Depends(current_user)
) -> dict:
    await require_member(group_id, user["id"])
    return {"components": await _scan_components(group_id)}


def group_components_dir(group_id: int) -> Path:
    """这个群的组件仓库：`var/components/g<群号>/`。

    ⚠️ **按群分层是这次改动的核心** ✗→✓ —— 原来扫的是一个全局目录 ✓，
    `group_id` 只拿去查成员 ✓ —— 于是**每个群看到的是同一批组件** ✗。
    分层之后跨群隔离是**结构上**的 ✓，不靠"别人猜不到你的群号" ✓。
    """
    return settings.components_dir / f"g{int(group_id)}"


def component_version_dir(group_id: int, slug: str, version: int) -> Path:
    """一版组件住的地方：`g<群号>/<slug>/v<N>/`。

    ⚠️ **一版一个目录** ✗→✓ —— "不满意再做一版、旧的留着不删"要有地方落 ✓。
    覆盖同一个目录就没法回头看了 ✓。
    """
    return group_components_dir(group_id) / slug / f"v{int(version)}"


#: 「容纳界面」里允许的展示种类 ✓。**先只有 `tile`**（上面图标、下面名字 ✓）。
#:
#: ⚠️ 用户 2026-10-07 说的是「可以传统的上面图标下面名称，**也可以其他**，不局限」✓ ——
#:    所以这里是个**开放的口子**：agent 在保存时声明 `kind` ✓，
#:    以后要加"活的小窗口"那种，是往这张表里加一项 ✓ + 前端加一个分支 ✓，
#:    不用改数据模型 ✓（`spot_json` 本来就是自由 JSON ✓）。
_SPOT_KINDS = ("tile",)


def _spot_of(raw: Any) -> dict:
    """把一版的展示声明**收拾成能直接用的形状** ✓。

    ⚠️ **坏的一律当默认，绝不抛** ✗→✓ —— 这是模型写的东西 ✓（它可能写个
       `"w": "大"` 或者干脆一段散文 ✓）。一个组件长得不对，不该让**整屏
       容纳界面**打不开 ✓ —— 那正是"一个坏掉的东西拖垮整个页面"的形状 ✓。

    形状：`{"kind": "tile", "w": 1, "h": 1, "tint": null}` ✓
      · `w`/`h`：占几个格子 ✓（1..3 ✓ —— 不封顶的话它能声明一个占满整屏的 ✓，
        "容纳界面"就没法容纳别的了 ✓）
      · `tint`：可选底色 ✓（**只认 `#rrggbb`** ✓ —— 它会被写进样式里 ✓，
        别的写法（`url(...)`、`expression(...)`）一律丢掉 ✓）
    """
    d: Any = {}
    try:
        d = json.loads(raw or "{}")
    except Exception:  # noqa: BLE001
        d = {}
    if not isinstance(d, dict):
        d = {}

    def _n(v: Any, dv: int) -> int:
        try:
            return max(1, min(3, int(v)))
        except (TypeError, ValueError):
            return dv

    kind = str(d.get("kind") or "tile")
    tint = d.get("tint")
    if not isinstance(tint, str) or not re.match(r"^#[0-9a-fA-F]{6}$", tint):
        tint = None
    return {"kind": kind if kind in _SPOT_KINDS else "tile",
            "w": _n(d.get("w"), 1), "h": _n(d.get("h"), 1), "tint": tint}


async def _spots_of(group_id: int) -> dict[str, int]:
    """这个群每个组件**摆在哪个格子** ✓（没排过的就没有这一项 ✓）。"""
    rows = await fetch_all(
        "SELECT slug, pos FROM component_spots WHERE group_id = ?", (group_id,))
    return {str(r["slug"]): int(r["pos"]) for r in rows}


async def _scan_components(group_id: int) -> list[dict]:
    """这个群有哪些组件 —— **以库为准** ✓。

    ⚠️ **列表从库读，不从目录扫** ✗→✓ —— 组件是什么样在库里 ✓，
       扫目录只知道"有哪些文件夹" ✗（那是**实现细节** ✓，不该拿它当账本 ✓）。

    ★ 2026-10-07 深夜：**"哪一版是保留的 / 哪一版是攒着的"整套去掉了** ✗→✓ ——
      用户定了「组件聊天没有所谓的固化和非固化概念了」✓。
      所以每个 slug 回的就是**最新的那一版**长什么样 ✓
      （名字、图标、怎么摆 ✓）—— 界面上不再有任何"状态"要表达 ✓。
    """
    rows = await fetch_all(
        "SELECT slug, version, state, title, icon, note, spot_json, created_at"
        " FROM components WHERE group_id = ? ORDER BY slug ASC, version DESC",
        (group_id,),
    )
    spots = await _spots_of(group_id)
    out: dict[str, dict] = {}
    for r in rows:
        slug = str(r["slug"])
        it = out.setdefault(slug, {"slug": slug, "title": r["title"] or slug,
                                   "icon": r["icon"] or "🧩", "note": r["note"] or "",
                                   "spot": _spot_of(r["spot_json"]),
                                   "pos": spots.get(slug), "versions": []})
        # 行是按版本**倒序**来的 ✓ → 第一条就是最新的 ✓（`setdefault` 那次就落定了 ✓）
        it["versions"].append(int(r["version"]))
    # ⚠️ **排过版的按位置排** ✓ —— 没排过的（刚做完、还没被挪过 ✓）排在最后面 ✓
    #    按 slug 排 ✓（稳定、可预期 ✓：同一个东西每次进来看都在同一个地方 ✓）。
    #    这就是"容纳界面"里那个顺序 ✓（用户在调整模式里拖出来的 ✓）。
    return sorted(out.values(),
                  key=lambda x: ((x["pos"] if x["pos"] is not None else 10**6), x["slug"]))


#: 组件短名的形状。**只允许小写字母、数字、连字符** ✓ ——
#: 中文名会带来 URL 编码、文件名编码两处麻烦 ✓，不值当 ✓。
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")


def valid_slug(name: str) -> bool:
    return bool(name) and bool(_SLUG_RE.match(name))


async def _pick_component_version(group_id: int, slug: str, version: int | None) -> dict | None:
    """挑一版：给了版本号就用它 ✓，没给就是**最新的那一版** ✓。

    ★ 2026-10-07 深夜：原来这里**先找 `state='live'` 那一版** ✗→✓ ——
      那是"保留/正在用"还在的时候的规矩 ✓。那套一撤 ✓，这个优先顺序就没意义了 ✓，
      而且**有害** ✗：库里还留着几个老的 live ✓ ——
      于是"点开看看"会看到**几个月前被保留过的那一版** ✓，
      而不是他刚做完的那一版 ✓（而界面上没有任何东西能解释这件事 ✓）。
    """
    if version:
        return await fetch_one(
            "SELECT * FROM components WHERE group_id = ? AND slug = ? AND version = ?",
            (group_id, slug, int(version)))
    return await fetch_one(
        "SELECT * FROM components WHERE group_id = ? AND slug = ? "
        "ORDER BY version DESC LIMIT 1", (group_id, slug))


@app.get("/api/components/{name}")
async def component_render(
    name: str, group_id: int = Query(...), v: int | None = Query(None),
    user: dict = Depends(current_user),
) -> dict:
    """把一个组件连同它要的数据一起交出去。

    **路径穿越要挡住**：`name` 是 URL 里来的。两道防护都在 ✓ ——
    名字必须符合 slug 形状 ✓，目录必须真的在**这个群自己的**仓库底下 ✓。
    """
    await require_member(group_id, user["id"])
    if not valid_slug(name):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "组件名不合法")
    row = await _pick_component_version(group_id, name, v)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"没有 `{name}` 这个组件")

    base = group_components_dir(group_id).resolve()
    d = component_version_dir(group_id, name, int(row["version"])).resolve()
    # ⚠️ `str.startswith` → `is_relative_to` ✗→✓ —— 2026-10-07：
    #    前缀比较对 `/a/b` vs `/a/bc` 会**误判通过** ✗（`/a/bc/x` 确实"以 /a/b 开头"✓）。
    #    现在因为"名字必须符合 slug"打不到 ✓，但这是**两道防护里的一道** ✓，
    #    靠另一道恰好能兜住，不该是它继续这么写的理由 ✗。
    #    （`routes_internal.py` 的 `/image` 是同一个写法 ✓ —— 一起改了 ✓。）
    if not d.is_relative_to(base):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"没有 `{name}` 这个组件")
    html_file = d / "index.html"
    if not html_file.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"组件 `{name}` 这一版没有 index.html")
    try:
        html = html_file.read_text(encoding="utf-8", errors="replace")[:400_000]
    except OSError:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "组件读不出来")

    data: dict = {}
    try:
        spec = json.loads(row["data_json"] or "{}") or {}
    except Exception:  # noqa: BLE001
        spec = {}
    if "records" in spec:
        spec_r = spec.get("records") or {}
        try:
            days = int(spec_r.get("days") or 30)
            data["records"] = await rec.query(
                group_id, spec_r.get("kind") or "bookkeeping",
                since=now() - days * 86400, limit=500,
            )
        except Exception:  # noqa: BLE001
            log.exception("组件 %s 取数据失败", name)
            data["records"] = {"error": "数据没取到"}

    # ★ 这一版是**哪条对话**做出来的（2026-10-07 ✓）—— 「继续改」靠它回到
    #   当初那条对话 ✓（不然每次点"继续改"都是一条全新的、什么都不记得的对话 ✓）。
    #
    # ⚠️ **只在自己那条上返回** ✗→✓ —— 组件是全群共有的 ✓，但**对话是个人的** ✓。
    #    别人做的那一版，`task_id` 指向的是**他的**对话 ✓ ——
    #    照原样返回的话，前端会拿它去 `open` ✓，而那个接口按 `user_id` 查 ✓，
    #    结果是个 404 ✓（用户看到"打不开"✗，而这本来该走"开条新的"✓）。
    #    所以这里就查清楚 ✓：不是我的，返回 None ✓，前端去开一条新的 ✓。
    task_id = row["task_id"] if "task_id" in row.keys() else None
    mine = None
    if task_id:
        own = await fetch_one(
            "SELECT id FROM workshop_tasks WHERE id = ? AND group_id = ? AND user_id = ?",
            (int(task_id), group_id, user["id"]))
        mine = int(own["id"]) if own else None
    return {"name": name, "version": int(row["version"]), "state": row["state"],
            "title": str(row["title"] or name),
            "icon": str(row["icon"] or "🧩"),
            "note": str(row["note"] or ""),
            "task_id": mine,
            "html": html,
            "data": data}


# ⚠️ 这里原来有两个接口：`/keep`（保留某一版 ✓）和 `/unkeep`（取消保留 ✓）。
#    **2026-10-07 深夜整个删掉了** ✗→✓ —— 用户定了「组件聊天没有所谓的固化和
#    非固化概念了」✓。概念没了，两个接口就没有语义可言 ✓。
#    ⚠️ `components.state` 那一列**留着不动** ✓ —— 它现在只服务内部
#    （哪一版最新 ✓、旧版怎么排 ✓），界面上一个字都不提 ✓。
#    库里那几个老的 `state='live'` 也不用去洗 ✓ —— 没人再读它了 ✓。



class ComponentSpotsIn(BaseModel):
    #: 组件短名的**完整顺序** ✓（一次全交过来 ✓，不是"谁挪到哪"✗）——
    #: 增量式的话，两次请求之间插进一个新组件就会错位 ✓（而错位是**静默**的 ✓：
    #: 顺序看着还是对的，只是有两个东西悄悄换了位 ✓）。全量提交没有这个窗口 ✓。
    order: list[str] = Field(default_factory=list, max_length=200)


@app.post("/api/components/spots")
async def component_spots_save(
    body: ComponentSpotsIn, group_id: int = Query(...),
    user: dict = Depends(current_user),
) -> dict:
    """**保存"容纳界面"里的排版** ✓ —— 用户在调整模式里拖完、点完成时调它 ✓。

    ⚠️ **不认识的 slug 一律丢掉** ✓，不报错 ✗ —— 客户端手里那份可能是几分钟前的 ✓
       （期间某个组件被删了 ✓）。为一个已经不存在的名字把整次排版拒掉，
       用户看到的是"我拖了半天，它说不行" ✓，而其实九成九是对的 ✓。
    """
    await require_member(group_id, user["id"])
    real = await fetch_all("SELECT DISTINCT slug FROM components WHERE group_id = ?",
                           (group_id,))
    known = {str(r["slug"]) for r in real}
    kept = [s for s in (str(x).strip().lower() for x in body.order) if s in known]
    ts = now()
    for i, slug in enumerate(kept):
        await execute(
            "INSERT INTO component_spots(group_id, slug, pos, updated_at) VALUES(?,?,?,?)"
            " ON CONFLICT(group_id, slug) DO UPDATE SET pos = excluded.pos,"
            " updated_at = excluded.updated_at",
            (group_id, slug, i, ts))
    log.info("组件排版：群 %s 存了 %d 个位置（用户 %s）", group_id, len(kept), user["id"])
    return {"ok": True, "saved": len(kept),
            "ignored": [s for s in body.order if str(s).strip().lower() not in known]}


class ComponentRenameIn(BaseModel):
    #: 新名字 ✓。**只改显示名，不动 `slug`** ✗ —— slug 是目录名和 URL 的一部分 ✓，
    #: 改名会让磁盘上的目录、已经存过的路径全对不上 ✓（而且组件是**一个 HTML 文件**，
    #: 里面可能自己写死了什么 ✓ —— 那更不该由一次改名去动 ✓）。
    title: str = Field(min_length=1, max_length=40)


@app.post("/api/components/{name}/rename")
async def component_rename(
    name: str, body: ComponentRenameIn, group_id: int = Query(...),
    user: dict = Depends(current_user),
) -> dict:
    """**重命名** ✓ —— 用户 2026-10-07 晚上定的：「重命名会同步所有地方」✓。

    ⚠️ **改的是 `components.title`，而且是这个 slug 的**每一版** ✓** ✗→✓ ——
       名字是**这个东西**的名字 ✓，不是"第几版的名字" ✓。
       只改最新那一版的话，界面上会**看人下菜** ✓：
       列表取的是 live 那版的标题 ✓、笔记头部取的是最后一版 ✓、
       某处兜底又用第一版 ✓ —— 于是同一个组件在不同地方叫不同名字 ✓。
       一次全改是**唯一**能保证"同步所有地方"的做法 ✓。

    ⚠️ 它**不需要谁"拥有"这个组件** ✓ —— 组件是**全群共有**的 ✓
       （谁做的、谁改的，只在 `enabled_by` 那种地方留痕 ✓）。
       两个人都能改名 ✓，这是对的 ✓。

    ⚠️ **只改显示名，不动 `slug`** ✗ —— 见 `ComponentRenameIn` 那段 ✓。
    """
    await require_member(group_id, user["id"])
    if not valid_slug(name):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "组件名不合法")
    title = body.title.strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "名字不能是空的")
    # ⚠️ **`execute_rc` 不是 `execute`** ✗→✓（2026-10-07 深夜，见 db.py 那段）——
    #    `execute` 返回的是 `lastrowid` ✓，拿它判"改到没改到"**永远非零** ✗ →
    #    给一个不存在的组件改名会**安静地成功** ✓（这里本来该报 404 ✓）。
    n = await execute_rc("UPDATE components SET title = ? WHERE group_id = ? AND slug = ?",
                         (title, group_id, name))
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"没有 `{name}` 这个组件")
    log.info("组件改名：群 %s 的 %s → %r（用户 %s，%d 版一起改）",
             group_id, name, title, user["id"], n)
    return {"ok": True, "slug": name, "title": title, "versions": int(n)}


@app.delete("/api/components/{name}")
async def component_delete(
    name: str, group_id: int = Query(...), v: int | None = Query(None),
    user: dict = Depends(current_user),
) -> dict:
    """**不传 `v` = 删掉整个组件**（连它的对话 ✓）；传 `v` = 只删那一版。

    ★ 2026-10-07 晚上改的语义 ✗→✓ —— 用户定的：「删除组件**等于删除对话**」✓。
      所以"不传版本号"从我原来的"删掉未固化那几版"改成了**整块删** ✓：
      `components` 全部版本 + 磁盘上的目录 + 它名下的 `workshop_tasks` 和气泡 ✓。
      界面上那条路只有一处（组件管理页的 ⋯ ✓），而且是**两下才删** ✓。

      ⚠️ **按版本删的那条路不删对话** ✓ —— "删掉 v2 这一版"是**改组件** ✓，
         不是"把这个东西连同它的来龙去脉一起抹掉"✓。两者混起来的话，
         用户删掉一个旧版本会连带丢掉整段对话 ✓ —— 那是个很难查的意外 ✓。

    ⚠️ **整块删没有任何"先降下来"的保护** ✓（原来有 ✓ —— 那个时候"不传版本号"
       删的是实验版 ✓，误删代价小 ✓）。现在它就是"把这个东西抹掉" ✓，
       保护在**界面上**：两下才删 ✓，而且第一次点完之后按钮上写着
       "再点一下：连它的对话一起删" ✓ —— **说清代价比拦一道更管用** ✓。
    """
    await require_member(group_id, user["id"])
    if not valid_slug(name):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "组件名不合法")
    where = "group_id = ? AND slug = ?" + (" AND version = ?" if v else "")
    params = (group_id, name, int(v)) if v else (group_id, name)
    rows = await fetch_all(f"SELECT version, state FROM components WHERE {where}", params)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有可删的版本")

    # ★ 整块删（没给版本号）时，把挂在它名下的对话一起收掉 ✓。
    #   ⚠️ 在 DELETE 之前查 ✓ —— 查完就没人知道这些组件是哪条对话做的了 ✓。
    wiped: list[int] = []
    if not v:
        tids = await fetch_all(
            "SELECT DISTINCT task_id FROM components"
            " WHERE group_id = ? AND slug = ? AND task_id IS NOT NULL",
            (group_id, name))
        for t in tids:
            tid = int(t["task_id"])
            await execute("DELETE FROM workshop_messages WHERE task_id = ?", (tid,))
            await execute("DELETE FROM workshop_tasks WHERE id = ?", (tid,))
            wiped.append(tid)

    for r in rows:
        await execute("DELETE FROM components WHERE group_id = ? AND slug = ? AND version = ?",
                      (group_id, name, int(r["version"])))
        d = component_version_dir(group_id, name, int(r["version"]))
        if d.is_relative_to(group_components_dir(group_id)) and d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
    # ⚠️ **排版也要一起收掉** ✗→✓ —— `component_spots` 里的 `slug` **不是外键** ✓
    #    （一个 slug 在 `components` 里是好几十行 ✓，没有"那一行"可以指 ✓），
    #    所以它不会跟着级联删 ✓。忘了这一步的后果：下次同一个 slug 被做出来时，
    #    它会**接着用上一次的位置** ✓ —— 看着像"它自己跑到那儿去了" ✓。
    if not v:
        await execute("DELETE FROM component_spots WHERE group_id = ? AND slug = ?",
                      (group_id, name))
        # ★ **把"冲着它开过"的那些对话的指针清掉** ✗→✓（2026-10-07 深夜，
        #   用户报的"有些显示删不掉" ✓）。
        #   ⚠️ 上面删的是**用它做出来的那条对话** ✓（`task_id` 指回来的 ✓）——
        #      而**别的**对话也可能挂着这个 slug ✓（别人开过、或者开过没做成的 ✓），
        #      它们**不在** `task_id` 那张名单里 ✗ → 不清的话就留着一个**悬空指针** ✓：
        #      导航上那一行还以为自己是个组件 ✓、⋯ 里给的是「删除组件」✓、
        #      一点就 404 ✓ —— 而用户完全看不出为什么 ✗。
        #   清成空之后，那些对话就老实变成"还没做出组件" ✓（可以正常删掉 ✓）。
        n = await execute_rc(
            "UPDATE workshop_tasks SET slug = NULL WHERE group_id = ? AND slug = ?",
            (group_id, name))
        if n:
            log.info("组件删除：顺手把 %d 条对话的悬空指针清了（群 %s 的 %s）",
                     n, group_id, name)
    # ⚠️ 版本删光之后，那个 **slug 目录也要收掉** ✗→✓ ——
    #    不然仓库里会留一堆空壳 ✓（界面看不见 ✓，因为列表是从库读的 ✓，
    #    但下次同一个 slug 再做一版时，`mkdir(parents=True)` 会**默默复用它** ✓ ——
    #    于是"删干净了没有"这件事就没法从目录上看出来 ✓）。
    #    `rmdir` **只在空的时候才成功** ✓ —— 不用自己判空 ✓，也不会误删有内容的 ✓。
    try:
        (group_components_dir(group_id) / name).rmdir()
    except OSError:
        pass                                    # 还有别的版本在，那就该留着 ✓
    log.info("组件删除：群 %s 的 %s，%d 版（连对话 %s 条）",
             group_id, name, len(rows), len(wiped))
    return {"ok": True, "deleted": [int(r["version"]) for r in rows],
            "tasks_deleted": wiped}


@app.get("/preview")
async def preview(t: str = Query(default="")) -> Response:
    """拿一张**只读**的临时门票打开这个 App —— 给 agent 那双眼睛用。

    ## 为什么需要这个入口

    agent 有 `browser_exec`：能开真浏览器、能截图、能用 `vision_analyze` 看自己
    截的图（实测这条链是通的）。但它**没有用户密码**，打不开这个页面 —— 那就
    等于没眼睛：写前端只能靠读代码猜，而前端的错九成只有真跑一遍才看得见。

    ## 安全

    票是**短时**（10 分钟）、**一次性换 cookie**、而且换来的会话带
    `scope=preview` —— `auth.current_user` 会拒掉它的一切写操作。
    所以它能看到真实界面和消息，**但不能冒你们的名发消息**。
    """
    # ⚠️ 验票走 `decode_token` ✓ —— 别自己 `jwt.decode` ✗（见那个函数的说明 ✓）
    payload = decode_token(t)
    if not payload:
        return HTMLResponse("<meta charset='utf-8'><h1>403</h1>"
                            "<p>这张预览票无效或已过期。重新调 app_preview 拿一张。</p>",
                            status_code=403)
    if payload.get("scope") != PREVIEW_SCOPE:
        return HTMLResponse("<meta charset='utf-8'><h1>403</h1><p>这不是预览票。</p>",
                            status_code=403)
    resp = RedirectResponse("/", status_code=303)
    resp.set_cookie(
        SESSION_COOKIE,
        make_token(int(payload["sub"]), scope=PREVIEW_SCOPE),
        max_age=3600,          # 一小时够它把活干完
        httponly=True,
        samesite="lax",
        path="/",
    )
    log.info("发了一张预览会话（user=%s）——只能看，不能改", payload["sub"])
    return resp


async def _user_from_token(token: str) -> dict | None:
    # ⚠️⚠️ **这一行就是 WebSocket 连不上的原因** ✗→✓ —— 2026-10-07。
    #   原来这里自己拿 `settings.jwt_secret` 验 ✗（这个服务自己的密钥 ✓），
    #   而票是**壳**签的 ✓ → 每次都返回 None ✓ → 下面 `ws.close()` ✓
    #   → 握手被 uvicorn 拒掉、报 **403** ✓（日志里 2798 次、成功 0 次 ✓）。
    payload = decode_token(token)
    if not payload:
        return None
    return await fetch_one(
        "SELECT id, username, nickname, avatar FROM users WHERE id = ?",
        (int(payload["sub"]),),
    )


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str | None = Query(default=None)) -> None:
    # **令牌从 Cookie 取**：浏览器的同源 WS 握手会自动带上 Cookie，
    # 网页那边已经不再往 URL 里塞 token 了（URL 会进日志、进历史，
    # 而且网页 JS 读得到 location——那等于没搬）。
    # `?token=` 留着是**给脚本用的**（我自己的诊断脚本）。
    user = await _user_from_token(ws.cookies.get(SESSION_COOKIE) or token or "")
    if not user:
        await ws.close(code=4401, reason="unauthorized")
        return

    await ws.accept()
    await hub.add(user["id"], ws)
    log.info("ws 连接 user=%s", user["nickname"])

    try:
        # 连上先握手，顺带把该用户所在的群告诉它，方便前端判断订阅范围。
        groups = await fetch_all(
            "SELECT group_id FROM group_members WHERE user_id = ?", (user["id"],)
        )
        gids = [g["group_id"] for g in groups]
        await ws.send_json(
            {
                "type": "ready",
                "data": {
                    "user": user,
                    "group_ids": gids,
                    "online": sorted(hub.online_users()),
                    # 带上各群**当前真实**的 agent 状态。
                    # 断线重连后事件流是有断裂的，不补这一下，
                    # 客户端会以为它闲着，而服务器那边可能还在跑。
                    "agent_status": {str(g): current_status_for(g) for g in gids},
                },
            }
        )

        # 目前没有客户端→服务端的事件（发送走 HTTP）。这里只维持连接，
        # 靠客户端心跳或 TCP 保活；断开即清理。
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("ws 异常退出 user=%s", user["id"], exc_info=True)
    finally:
        await hub.remove(user["id"], ws)
        log.info("ws 断开 user=%s", user["nickname"])
