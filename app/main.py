"""应用入口：路由装配 + WebSocket 下行通道。

**消息上行走 HTTP，下行走 WebSocket**——上行用 HTTP 是为了有明确的成功/失败语义，
不会因为连接抖动静默丢消息；下行用 WebSocket 是为了即时性。
"""

from __future__ import annotations

import asyncio
import json
import hashlib
import logging
import time

import httpx
from contextlib import asynccontextmanager
from pathlib import Path

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
from .db import close_db, execute, fetch_all, fetch_one, init_db, now
from .hub import hub
from .messages import current_status_for
from .routes_auth import router as auth_router
from .routes_groups import router as groups_router
from .routes_internal import restart_watcher
from .routes_internal import router as internal_router
from .routes_media import router as media_router

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
    row = await fetch_one("SELECT id FROM groups WHERE profile = ?", (profile,))
    if row:
        gid = int(row["id"])
        await execute("UPDATE groups SET name = ? WHERE id = ?", (info.get("name") or "空间", gid))
    else:
        gid = await execute(
            "INSERT INTO groups(name, owner_id, profile, invite_code, created_at) "
            "VALUES(?,?,?,?,?)",
            (info.get("name") or "空间", int(info["user_id"]), profile,
             new_invite_code(), int(time.time())),
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

    # ★ ETag 把 `ws` 算进去 ✓ —— 换工作区 = 不同的 ETag = 老老实实 200 ✓。
    #   （同一页里 `ws` 编进 cookie 的设定 ✓，所以两者必须一起变 ✓，
    #     不然会出现"页面是新的、cookie 还是上一个空间"✗。）
    etag = '"' + hashlib.sha256((ws or "").encode() + html.encode()).hexdigest()[:16] + '"'
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
# 就是文件：`ui/components/<名字>/index.html`，可选 `meta.json`：
#     {"title": "记账面板", "icon": "💰", "data": {"records": {"kind": "bookkeeping", "days": 30}}}
# agent 用普通文件工具就能写——不需要为它造一套新的工具接口。

@app.get("/api/components")
async def components_list(
    group_id: int = Query(...), user: dict = Depends(current_user)
) -> dict:
    await require_member(group_id, user["id"])
    return {"components": _scan_components()}


def _scan_components() -> list[dict]:
    out: list[dict] = []
    base = settings.components_dir
    if not base.is_dir():
        return out
    for d in sorted(base.iterdir()):
        if not d.is_dir() or not (d / "index.html").exists():
            continue
        meta: dict = {}
        mf = d / "meta.json"
        if mf.exists():
            try:
                meta = json.loads(mf.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                log.warning("组件 %s 的 meta.json 读不出来，用默认值", d.name)
        out.append({"name": d.name,
                    "title": str(meta.get("title") or d.name),
                    "icon": str(meta.get("icon") or "🧩")})
    return out


@app.get("/api/components/{name}")
async def component_render(
    name: str, group_id: int = Query(...), user: dict = Depends(current_user)
) -> dict:
    """把一个组件连同它要的数据一起交出去。

    **路径穿越要挡住**：`name` 是 URL 里来的，`../` 一下就能读到别处去。
    只允许单层目录名、且必须真的在 components_dir 底下。
    """
    await require_member(group_id, user["id"])
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "组件名不合法")
    d = (settings.components_dir / name).resolve()
    if not str(d).startswith(str(settings.components_dir.resolve())) or not d.is_dir():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"没有 `{name}` 这个组件")

    html_file = d / "index.html"
    if not html_file.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"组件 `{name}` 没有 index.html")
    try:
        html = html_file.read_text(encoding="utf-8", errors="replace")[:400_000]
    except OSError:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "组件读不出来")

    meta: dict = {}
    mf = d / "meta.json"
    if mf.exists():
        try:
            meta = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass

    data: dict = {}
    spec = meta.get("data") or {}
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

    return {"name": name,
            "title": str(meta.get("title") or name),
            "icon": str(meta.get("icon") or "🧩"),
            "html": html,
            "data": data}


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
