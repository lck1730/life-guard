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

from .core import idle, records as rec, reminders
# ⚠️ `ensure_user` / `new_invite_code` **合并之后这里不再需要** ✗→✓：
#    前者是"按需镜像用户行"的工具 ✓（现在用户表就是本地的 ✓，注册时建 ✓），
#    后者是"本地摇邀请码"（现在只有建空间那一处摇 ✓，在 `routes_shell` 里 ✓）。
from .auth import (SESSION_COOKIE, current_user, decode_token, require_member)
from .config import WALL_SLUG, settings
from .db import (close_db, execute, execute_rc, fetch_all, fetch_one, init_db,
                 now)
from .core.hub import hub
from .core.messages import current_status_for
# ★ 2026-10-11：**模型服务并进来了** ✓ —— 它现在是这个 App 的两块：
#   · `/v1/*`  给 Hermes 当模型端点（每次模型调用都从这儿过 ✓）
#   · `/api/models/*`  换模型的界面（**管理员专属** ✓）
#   见 `chat/app/models/__init__.py`（那里写了合并的取舍和代价 ✓）。
from .models.proxy import router as models_proxy_router
from .models.routes import router as models_router
from .api.groups import router as groups_router
from .api.internal import router as internal_router
from .api.media import router as media_router
from .api.shell import router as shell_router
from .api.shell import sweep_leaving as shell_router_sweep
from .api.workshop import poke_loop
from .api.workshop import router as workshop_router

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
    # ★ 启动时先收一遍"正在退出"的空间 ✓（2026-10-08）——
    #   那个收尾的后台任务活在进程里 ✓，重启就没了 ✓ →
    #   没这一步的话，"标记了退出、worker 也删完了"的空间会永远停在那儿 ✓。
    #   ⚠️ **不等它** ✓（`create_task` 就行 ✓）：它是收尾，不该挡住开机 ✓；
    #      慢一点没关系 ✓（那个空间对用户已经不可见了 ✓）。
    asyncio.create_task(shell_router_sweep())

    tasks = [
        asyncio.create_task(reminders.ticker_loop()),
        asyncio.create_task(idle.loop()),
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

app.include_router(groups_router)
app.include_router(media_router)
app.include_router(internal_router)
app.include_router(workshop_router)
# ★ 2026-10-08 合并：**「壳」那一半搬进来了** ✓（登录 / 注册 / 账号 / 生活空间 ✓）。
#   路径一个字没改 ✓ —— 手机上缓存着老页面、老书签 ✓。
#   ⚠️ 挂载顺序有讲究 ✗：它必须在 `groups_router` **之后** ——
#       `/api/workspaces` 和 `/api/groups` 不冲突 ✓，但 `/api/me`
#       （本文件这条 ✓）和 `auth_router` 的 `/api/auth/me` 也不能撞 ✓。
app.include_router(shell_router)
# ★ 模型那两块 ✓ —— 放最后：`/v1/{path:path}` 是个 catch-all ✓，
#   虽然和 `/api/*` 不冲突 ✓，但排在有具体路径的那些后面**更不容易出事** ✓。
app.include_router(models_router)
app.include_router(models_proxy_router)

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
# ★ 2026-10-08：`/media` **从"裸挂载"改成带鉴权** ✗→✓。
#
#   原来它是 `app.mount("/media", StaticFiles(...))` ✓ —— **没有任何鉴权** ✗：
#   谁知道路径谁就拿得到 ✓（`/media/20261008/<32位hex>.jpg` ✓ 猜不到 ✓，
#   但"猜不到"不是"拿不到"✓ —— 它是**公开**的 ✓）。
#   图片时代还能将就 ✓（名字是随机 24 字节 ✓），**文件时代不行了** ✗：
#   用户会传账本截图、体检报告、家里地址那种东西 ✓，
#   而"文件夹里的一堆文件名"一旦泄出去，等于告诉别人你有什么 ✓。
#
#   ⚠️ 同源的话**前端一行都不用改** ✗ —— 浏览器会自己带上 cookie ✓
#   （`<img src="/media/…">` ✓、`<audio src>` ✓、下载链接 ✓ 都是同源请求 ✓）。
#   ⚠️ 组件 iframe（**不透明源** ✓）本来就带不上 cookie ✗ ——
#      但组件从来不是靠 URL 取数据的 ✓（数据是保存时声明、由主页面塞进
#      `window.__LG_DATA__` 的 ✓），所以它不受影响 ✓。
#   ⚠️ 代价：媒体不再走 `immutable` 长缓存了 ✓（要过一遍鉴权 ✓）——
#      同机同进程 ✓，这点开销可以接受 ✓。


@app.get("/media/{path:path}")
async def media_file(path: str, user: dict = Depends(current_user)) -> Response:
    """取媒体（图片 / 语音 / 文件 / 音频）✓ —— **要登录** ✓。"""
    base = settings.media_dir.resolve()
    p = (settings.media_dir / path).resolve()
    # ⚠️ **路径穿越要挡住** ✗ —— `path` 是 URL 里来的 ✓（和组件那个端点一个做法 ✓）
    if not p.is_relative_to(base) or not p.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这个文件")
    # ⚠️ 不给 `immutable` ✗（那要求 URL 自己带版本号 ✓，而媒体路径本身是随机的 ✓
    #     —— 随机名 = 内容变了名字就变 ✓，其实也可以长缓存 ✓；
    #     但**下载**那种"点一下"的场景更在意"拿到最新的" ✓，就统一 no-cache ✓。）
    return FileResponse(p, headers=dict(_NO_REVALIDATE))


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
@app.get("/static/app.js")
async def app_js() -> Response:
    """把 `static/js/*.js` **按文件名顺序拼起来**发出去 ✓。

    ★ 2026-10-11：那 5,478 行是一个**闭包**（`me`/`group`/`$`/`api`… 共享同一个作用域 ✓）。
      拆成多个 `<script>` 会**拆散作用域** ✗ → 所有共享状态都得改成显式的模块导入 ✗
      （几千行的重构 ✓，而这套前端**没有行为测试** ✗）。
      所以改成：**仓库里按屏分成 6 个文件 ✓（改代码好找 ✓），服务端拼成一个 ✓
      （浏览器拿到的还是 1 个 ✓，一次请求 ✓ —— 手机要过 WireGuard ✓，少一次往返是实打实的 ✓）。**

    ⚠️ 这条路**必须排在下面那条 `/static` 挂载前面** ✗（Starlette 按注册顺序匹配 ✓，
      挂载是按前缀吃 ✓ —— 排在后面就永远轮不到它 ✗）。
    ⚠️ 每次重新读 ✓（不加缓存 ✓）：这是 6 个小文件 ✓、本机磁盘 ✓，
      而"改了不生效"是这个项目踩过最多次的坑 ✗ —— 省这点 IO 不值 ✗。
    """
    parts = sorted((STATIC_DIR / "js").glob("*.js"))
    body = "".join(p.read_text(encoding="utf-8") for p in parts)
    return Response(body, media_type="application/javascript", headers=dict(_NO_STORE))


app.mount("/ui", _NoStoreStatic(directory=settings.ui_dir), name="ui")

# ★ 2026-10-11：**样式和脚本也搬出 HTML 了** ✗→✓ ——
#   `static/app.css`（1,422 行）+ `static/app.js`（5,896 行 ✓，那个 IIFE 原样 ✓），
#   `index.html` 从 **7,857 行降到 ~540 行**（纯标记 ✓）。
#
#   ⚠️ 走 `_NoStoreStatic` 是**必须的、不是讲究** ✗ —— 界面是"改服务器文件 =
#      用户重开 App 生效"的架构 ✓，外链的 js/css 一旦被 WebView 缓存住，
#      改了不生效 ✓（这个坑这个项目反复踩过 ✓，见上面 `_NO_STORE` 那段 ✓）。
app.mount("/static", _NoStoreStatic(directory=STATIC_DIR), name="static")


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


# ── 进一个生活空间 ───────────────────────────────────────────────────────────
#
# 用户带着地址进来：`/?ws=<uuid>` ✓（App 开机 → 门 → 这里 ✓）。
#
# ## ★ 2026-10-08：这一段从 77 行**塌到十几行** ✓
#
#   原来它要**带着用户的票去问壳**：「这人真在这个空间里吗」✓
#   （`GET {shell}/api/internal/membership?ws=…` ✓），
#   然后把名字 / 邀请码 / 角色**抄回本地** ✓ ——
#   因为"谁是哪个空间的成员"这个事实**归壳** ✗（壳持有 users/workspaces/members ✓），
#   这边只是一份**镜像** ✓（用来放消息、账本、组件 ✓）。
#
#   合并之后那个事实就在**这个库**里 ✓（`group_members` + `groups` ✓），
#   所以这一趟跨服务往返整个没有了 ✓：
#   不需要问谁 ✓、不需要抄 ✓、也不会再有"两边漂了"这种事 ✓
#   （用户为"同一个信息存两处"栽过至少三次 ✓：群名 ✓、邀请码 ✓、屏名 ✓）。
async def enter_workspace(request: Request, ws: str) -> str | None:
    """成功返回 None；失败返回一句给用户看的话。"""
    token = request.cookies.get(SESSION_COOKIE) or ""
    payload = decode_token(token) if token else None
    if not payload:
        return "还没有登录"

    uid = int(payload["sub"])
    row = await fetch_one("""
        SELECT g.id, g.profile FROM groups g
        JOIN group_members gm ON gm.group_id = g.id
        WHERE g.uuid = ? AND gm.user_id = ?
    """, (ws, uid))
    if not row:
        return "你不在这个生活空间里"

    # ★ 「我上次在哪个空间」记在这儿 ✓ —— 原来是壳的 `/api/enter` 管的 ✓。
    #   一人一空间之后它几乎没用了（只有一个 ✓），但留着：
    #   同一个人换设备、或者以后真允许多空间时，它是"该落哪一屏"的判据 ✓。
    #   ⚠️ 存的必须是**自己真在里面的**空间 ✓ —— 上面那条 join 已经把这件事
    #      验过了（查不到就是不在 ✓），所以这一句不用再判 ✓。
    await execute(
        "INSERT INTO user_prefs(user_id, last_ws) VALUES(?,?) "
        "ON CONFLICT(user_id) DO UPDATE SET last_ws = excluded.last_ws", (uid, ws))
    log.info("进入空间 %s（profile=%s，群 id=%s，用户 %s）",
             ws, row["profile"], row["id"], uid)
    return None


def _render_page(route: str) -> str:
    """把 `static/index.html` 拼出来：注入 agent 的主题/脚本 + **告诉前端"你在哪个地址"** ✓。

    ★ `window.__ROUTE__` 是 2026-10-08 合并那次加的 ✓ —— 原来"你在哪个地址"
    这件事由**壳**在服务端把 `__ROUTE__` 塞进它自己那份页面 ✓
    （`/` 判去向 · `/login` 清票 · `/me` 到了就画 ✓）。
    合并之后页面只剩这一个 ✓，所以这个变量也搬进来了 ✓。

    ⚠️ **它是唯一一条"去向"的判据** ✗，不许再加第二个标记 ——
    这个项目为"标记会丢"栽过一整轮（见 `memory/route-not-flag.md` ✓）：
    地址不会丢 ✓，标记会 ✓。
    """
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    # ⚠️ 注入点必须是 `<head>` 之后（**在那段大脚本之前** ✓）——
    #    页面末尾那个 IIFE 开局就要读它 ✓。
    html = html.replace(
        "<head>",
        f'<head>\n<script>window.__ROUTE__={json.dumps(route)};</script>',
        1,
    )
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
    return html


def _etag(*parts: str) -> str:
    return '"' + hashlib.sha256("\x00".join(parts).encode()).hexdigest()[:16] + '"'


@app.get("/login")
async def page_login(request: Request) -> Response:
    """登录页。

    ★ **这个地址自己就把票清掉** ✗→✓ —— 这条是壳那边立的规矩（2026-10-06 ✓），
    合并时**原样搬过来** ✓：

      · 这就是"退出登录 = 清空登录信息"的**全部实现** ✓ ——
        不需要 `logout=1` 标记 ✓、不依赖"页面看得见 cookie"（**看不见** ✗
        httpOnly ✓）、也不依赖"从别的端口发的删 cookie 手机认不认"（**实测不认** ✗）。
      · 副作用正好是要的 ✓：登出之后**必须重新输密码** ✓ ——
        就算谁手动把地址敲成 `/login`，票也会被清掉 ✓（这正是"登出"的语义 ✓）。
    """
    html = _render_page("login")
    etag = _etag("login", html)
    if etag in [x.strip() for x in (request.headers.get("if-none-match") or "").split(",")]:
        r = Response(status_code=304, headers=dict(_NO_REVALIDATE, ETag=etag))
        r.delete_cookie(SESSION_COOKIE, path="/")
        return r
    resp = HTMLResponse(html, headers=dict(_NO_REVALIDATE, ETag=etag))
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@app.get("/me")
async def page_me(request: Request) -> Response:
    """「我的」。

    ★ 它**是一个地址** ✓ —— 到了就画 ✓，**永不自动跳走** ✓。
    这条是那次重构的全部成果（`memory/route-not-flag.md` ✓）：
    原来它只是"规则没跳走时剩下的结果" ✗ → 想停在它上面就得偷偷带个标记 ✗ →
    而标记要跨三跳才到得了 ✓ → 任何一跳丢了就被弹回群聊 ✓。**改成地址之后没有标记可丢** ✓。
    """
    html = _render_page("me")
    etag = _etag("me", html)
    if etag in [x.strip() for x in (request.headers.get("if-none-match") or "").split(",")]:
        return Response(status_code=304, headers=dict(_NO_REVALIDATE, ETag=etag))
    return HTMLResponse(html, headers=dict(_NO_REVALIDATE, ETag=etag))


@app.get("/admin")
async def page_admin() -> Response:
    """★ 这个 App 里**没有管理那套**了 ✗→✓（2026-10-08 用户定的）。

    App 管家 / 模型那两个入口是**管理员专属**的 ✓，用户说「这个 App 里不管，
    回头弄个别的 app，专属于我自己的技术 app」✓。
    所以这个地址**只留一个 302** ✓（老书签/老页面点到它不至于 404 ✓）。

    ⚠️ 2026-10-10 起：**App 管家（8742）已经拆掉了** ✗ —— 现在只剩
       模型服务（`http://<host>:8722/` ✓）和这个生活管家 ✓。
    浏览器直接开就行 ✓ —— 只是这个 App 里不再有入口 ✓。
    """
    return RedirectResponse("/me", status_code=302)


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
    html = _render_page("landing")
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




async def _ensure_wall(group_id: int) -> None:
    """保证这个群有「组件界面diy」那一格 ✓，而且**排在第一个** ✓。

    ★ 用户 2026-10-08 定的 ✓（原话：「提供一个默认组件聊天入口，名字叫[组件界面diy]…
       **并且这个不可删除**，其他的依旧按照原来的进行」✓）。

    ⚠️ 它**不是一个真的组件** ✗ —— 它没有 HTML 文件 ✓、点了也不会去渲染什么 ✓
       （前端认这个 slug ✓，点了就直接进它那条对话 ✓）。
       库里那一行只是"让它在收纳页上有一格"✓、以及"让那条对话有个 slug 可挂"✓。
    ⚠️ **懒建** ✓：谁先进收纳页/谁先下拉，谁就把它建出来 ✓ ——
       不需要在开通工作区那一步多写一段 ✓（老空间也不用补数据 ✓）。
    """
    await _ensure_wall_task(group_id)      # ← 顺手把对话建出来 ✓（见它那段 ✓）
    row = await fetch_one(
        "SELECT id FROM components WHERE group_id = ? AND slug = ? LIMIT 1",
        (group_id, WALL_SLUG))
    if row:
        return
    await execute(
        "INSERT INTO components(group_id, slug, version, state, title, icon, "
        "data_json, created_at) VALUES(?,?,?,?,?,?,?,?)",
        (group_id, WALL_SLUG, 1, "live", "组件界面diy", "🎨", "{}", now()))
    # ★ 排在**第一个** ✓ —— 位置表里给个 -1 ✓（`_scan_components` 按 pos 排 ✓，
    #   没排过的垫底 ✓，所以 -1 稳在开头 ✓）。
    await execute(
        "INSERT INTO component_spots(group_id, slug, pos, updated_at) VALUES(?,?,?,?) "
        "ON CONFLICT(group_id, slug) DO UPDATE SET pos=excluded.pos",
        (group_id, WALL_SLUG, -1, now()))
    log.info("群 %s：建出了「组件收纳页」那一格", group_id)


async def _ensure_wall_task(group_id: int) -> int | None:
    """保证「组件收纳页」在**创意工坊里也有一条对话** ✓（2026-10-09 用户定的：
    「没有[组件收纳页]的修改入口，应该在创意工坊里默认存在且不可删除」✓）。

    ⚠️ 它和普通对话有两点不同 ✗：
      · **每个人都能看见** ✓（`_my_tasks` 里对它不做 user_id 过滤 ✓）——
        它不是"谁开的对话" ✓，它是这个群的一件东西 ✓。
      · **删不掉** ✓（`task_delete` 里拦 ✓）—— 删了那一屏就没人能改了 ✓。
    归属写成**建群那个人** ✓（库里得有个 user_id ✓，反正是共用的 ✓）。
    """
    row = await fetch_one(
        "SELECT id FROM workshop_tasks WHERE group_id = ? AND slug = ? ORDER BY id LIMIT 1",
        (group_id, WALL_SLUG))
    if row:
        return int(row["id"])
    owner = await fetch_one(
        "SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at LIMIT 1",
        (group_id,))
    if not owner:
        return None
    tid = await execute(
        "INSERT INTO workshop_tasks(group_id, user_id, slug, title, created_at, updated_at) "
        "VALUES(?,?,?,?,?,?)",
        (group_id, int(owner["user_id"]), WALL_SLUG, "组件收纳页", now(), now()))
    log.info("群 %s：建出了「组件收纳页」那条对话（id=%s）", group_id, tid)
    return int(tid)


async def _scan_components(group_id: int) -> list[dict]:
    """这个群有哪些组件 —— **以库为准** ✓。

    ⚠️ **列表从库读，不从目录扫** ✗→✓ —— 组件是什么样在库里 ✓，
       扫目录只知道"有哪些文件夹" ✗（那是**实现细节** ✓，不该拿它当账本 ✓）。

    ★ 2026-10-07 深夜：**"哪一版是保留的 / 哪一版是攒着的"整套去掉了** ✗→✓ ——
      用户定了「组件聊天没有所谓的固化和非固化概念了」✓。
      所以每个 slug 回的就是**最新的那一版**长什么样 ✓
      （名字、图标、怎么摆 ✓）—— 界面上不再有任何"状态"要表达 ✓。
    """
    await _ensure_wall(group_id)
    rows = await fetch_all(
        "SELECT slug, version, state, title, icon, note, spot_json, created_at"
        " FROM components WHERE group_id = ? ORDER BY slug ASC, version DESC",
        (group_id,),
    )
    spots = await _spots_of(group_id)
    out: dict[str, dict] = {}
    for r in rows:
        slug = str(r["slug"])
        # ★ **「组件界面diy」不进这一列** ✗→✓（2026-10-09 用户定的：
        #   「组件收纳界面不要有组件界面diy这个图标和入口，它本身点进去
        #     不是一个独立组件」✓）。
        #   ⚠️ 它那一行**还在库里** ✓（`_ensure_wall` 照旧建 ✓ ——
        #      改名/删除那两道闸门认的就是这个 slug ✓），只是**不列出来** ✓。
        #   ⚠️ 也不用前端过滤 ✗ —— 过滤写在显示层的话，
        #      "空状态"就成了前端自己的判断 ✓（只有这一格时该说"还没有组件"✓）。
        if slug == WALL_SLUG:
            continue
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
    # ★ 「组件界面diy」**不能改名** ✗→✓（2026-10-08 用户定的："这个不可删除"✓）——
    #   它的名字是**那条对话的名字**的一部分 ✓（用户靠它认路 ✓），
    #   而且它的 slug 是**保留字** ✓ —— 改了名只会让人以为换了个东西 ✓。
    if name == WALL_SLUG:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "「组件界面diy」改不了名 —— 它是进组件界面的那条对话")
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


@app.get("/api/wall-css")
async def wall_css(group_id: int = Query(...), user: dict = Depends(current_user)) -> dict:
    """这一屏（[组件]界面）自己的外观 ✓ —— 由「组件界面diy」那条对话写 ✓。

    ⚠️ **要登录 + 要是成员** ✓（`require_member` ✓）—— 这段 CSS 属于**这个群** ✓，
       别的群的人不该读到 ✓（虽然 CSS 本身不敏感 ✓，但"谁有什么组件"是隐私 ✓）。

    返回空串 = 没改过 ✓ → 前端就当"没有自定义外观" ✓（默认样子 ✓）。
    """
    await require_member(group_id, user["id"])
    f = Path(settings.var_dir) / "wall" / f"g{int(group_id)}" / "style.css"
    try:
        css = f.read_text(encoding="utf-8", errors="replace")
    except OSError:
        css = ""
    return {"css": css[:200_000]}


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
    # ★ **「组件界面diy」删不掉** ✗→✓（用户原话："并且这个不可删除"✓）——
    #   它删不得还有个更硬的理由 ✓：它是**唯一**能改组件界面外观的入口 ✓
    #   （见 `routes_internal` 的 `_wall_task_ok` ✓）→ 删了那个能力就没人够得着了 ✓。
    if name == WALL_SLUG:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "「组件界面diy」删不掉 —— 组件界面本身要靠它来改")
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
