"""群与消息路由。"""

from __future__ import annotations

import json
import logging
import os
import re

from typing import Any

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Request,
                     UploadFile, status)
from pydantic import BaseModel, Field

log = logging.getLogger("lifeguard.groups")

from .agent_status import clean_prompt, dumps
from .auth import current_user, require_member
from .config import settings
from .db import execute, fetch_all, fetch_one, now
from .messages import (
    agent_name_for,
    broadcast_group_update,
    create_message,
    list_messages,
)

router = APIRouter(prefix="/api/groups", tags=["groups"])


class SendMessageIn(BaseModel):
    # ★ 2026-10-08 加了 `file`（文档）和 `audio`（**上传的音频**，和"按住说的 voice"分开 ✓）
    msg_type: str = Field(default="text", pattern="^(text|image|voice|file|audio)$")
    content: str | None = None
    media_path: str | None = None
    media_meta: dict | None = None
    reply_to: int | None = None
    # 被 @ 的对象。用字符串以容纳两种：`"agent"` 表示管家，数字字符串表示成员 user_id。
    # 显式传而不是从正文里解析——解析 @ 在中文里很容易误判。
    mentions: list[str] = Field(default_factory=list)


async def _groups_for(user_id: int) -> list[dict]:
    """我的群列表。

    必须带上 `agent_name` 和 `profile`——客户端靠前者显示管家昵称
    （用户在设置里改过之后，界面上要立刻跟着变），靠后者做未来多空间的判断。
    早期漏了这两列，结果 App 永远显示默认的"管家"。
    """
    return await fetch_all(
        """SELECT g.id, g.name, g.owner_id, g.invite_code, g.created_at, g.profile, g.agent_name,
                  g.agent_status, g.agent_user_prompt, g.agent_avatar,
                  (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
           WHERE gm.user_id = ?
           ORDER BY g.id DESC""",
        (user_id,),
    )


def _prefer_current(groups: list[dict], ws: str) -> list[dict]:
    """把"**你此刻进的那个空间**"排到最前 ✓。

    ⚠️ **两条路必须调同一个它** ✗→✓ —— 2026-10-06 的 bug 正出在口径不一致上：
      · `/bootstrap` 排了 ✓（前端取 `[0]` 拿到的就是"你点的那个" ✓）
      · `/groups` **没排** ✗（它是 `ORDER BY id DESC` ✓，新的排前面 ✓）
    → 页面**刚进来是对的** ✓、**保存后刷一下就串到另一个空间** ✗
    → 用户看到的是"我给『测试』改了个名字，它**自己变成了『测试2』**" ✓。

    抽出来，两边都调它 ✓ —— 以后再加入口也不会各排各的 ✓。
    （这是"同一个信息两种口径 = 迟早走岔"的又一个实例 ✓。）
    """
    if not ws:
        return groups
    want = f"chat-{ws}"
    return sorted(groups, key=lambda x: 0 if x.get("profile") == want else 1)


def _versioned(rel: str) -> str:
    """给一张静态图补上版本号 ✓ —— 2026-10-06。

    ## 为什么非补不可

    那一层静态文件是按"**URL 里有没有 `?v=`**"决定能不能长期缓存的 ✓。
    没有版本号的图 → 每次用之前都得重新问服务器 ✓（`no-cache` ✓）→
    在答复回来之前浏览器**不能画** ✓ → **每次都闪一下** ✓（用户看到的正是这个 ✓）。

    ## 版本号从哪来

    · 上传时已经写进去了 ✓（那种直接放行 ✓）
    · 老的没有 ✗ → **拿文件的修改时间**当版本 ✓：换图必然改 mtime ✓，
      URL 自然就变了 ✓（和"换头像时 `?v=` 会变"是同一个道理 ✓）。
    · 文件不在（还没配过 ✓）→ 返回空串 ✓ 让调用方去用默认那张 ✓。
    """
    if not rel:
        return ""
    if "?v=" in rel:
        return rel
    p = settings.ui_dir / rel.split("?")[0]
    try:
        return f"{rel}?v={int(p.stat().st_mtime)}"
    except OSError:
        return ""


def _agent_avatar_url(rel) -> str:
    """管家头像的**对外地址** ✓ —— 永远带版本号 ✓，永远有值 ✓。

    ⚠️ 空的时候返回的是**那张默认图的带版本地址** ✓，不是空串 ✗ ——
      空串会让前端退回一个没有版本号的 `/ui/avatar.png` ✓ → 又闪 ✓。
    """
    return _versioned(rel) or _versioned("avatar.png")


def _normalize_rows(rows: list[dict]) -> list[dict]:
    """出去之前把状态配置**过一遍 normalize** ✓ —— 2026-10-06 加。

    ## 为什么读的时候也要过

    `normalize` 里有一条硬规矩：**「思考中」恒开** ✓。
    如果只在写的时候过 ✓，那么**绕过接口**写进来的东西（直接改库 ✓、
    以后新加的某个写入方 ✓）就会原样吐给客户端 ✗ ——
    于是接口会返回一份"系统其实不会照做"的配置 ✗，
    而**界面照着它画，就会画出系统不承认的样子** ✗。

    这和 `_ensure_profile_unique` 是同一个思路 ✓：
    **校验放在最下面那一层，因为只有它绕不过去** ✓。

    多一次 JSON 解析换一句"接口说的和系统做的一定一致" ✓，值 ✓。
    """
    for r in rows:
        try:
            r["agent_status"] = dumps(r.get("agent_status"))
        except Exception:  # noqa: BLE001
            log.warning("群 %s 的状态配置过不了 normalize，按默认值给", r.get("id"))
            r["agent_status"] = dumps(None)
        # ★ 头像一律补版本号 ✓（见 `_agent_avatar_url` 那段）——
        #   "没配头像"照样给一个**带版本的默认图** ✓，
        #   不然前端会退回一个没版本号的 `/ui/avatar.png` → 又闪 ✓。
        r["agent_avatar"] = _agent_avatar_url(r.get("agent_avatar"))
    return rows


@router.get("")
async def my_groups(request: Request,
                    user: dict = Depends(current_user)) -> list[dict]:
    return _normalize_rows(_prefer_current(
        await _groups_for(user["id"]), request.cookies.get("lg_chat_ws") or ""))


@router.get("/bootstrap")
async def bootstrap(
    request: Request,
    limit: int = Query(200, ge=1, le=200),
    user: dict = Depends(current_user),
) -> dict:
    """**一趟拿齐进 App 要的东西。**

    ## 为什么要它

    客户端原来是 `/auth/me` → `/groups` → `/members` → `/messages`，
    **连着四趟** ✗ —— 每趟都要过一遍 WireGuard，加起来就是开 App 时
    那片几百毫秒的"黑屏"（用户直说了：没登录页了，但还是有短暂黑屏）。

    这里并成**一趟**：一次鉴权、一次查库、一次回包。往返次数直接砍到 1/4。

    ⚠️ 路由顺序要紧：**它必须注册在任何 `/{group_id}` 之前** ✗ 否则
    `bootstrap` 会被当成 group_id 解析（然后 422）。

    没有群就返回 `group: null` —— **那不是错误**，是"这个账号还没进任何群"，
    让客户端自己决定怎么说。
    """
    groups = await _groups_for(user["id"])

    # ★ 这个人可能同时在几个工作区里（上限 3 ），而他现在是从哪一个进来的，
    #   由壳那边跳过来时带的 ?ws= 记着（见 main.py:index 里落的那个 cookie ）。
    #   把它排到最前 —— 下面的 groups[0] 于是就是他刚点的那个空间。
    #   界面一个字的改动都不用（前端本来就取第一个 ）。
    ws = request.cookies.get("lg_chat_ws") or ""
    groups = _normalize_rows(_prefer_current(groups, ws))

    # ★ 备注（`{peer_id: note}` ✓）—— **一趟拿齐** ✗→✓（2026-10-08）。
    #   它本来也可以单开一个接口 ✓（`GET /api/notes` 也有 ✓），但这里是
    #   "开一次 App 只走一趟"那条约定的地方 ✓（见这个函数的说明 ✓）——
    #   而备注**每条消息渲染都要用** ✓（决定显示哪个名字 ✓）→
    #   分两趟的话，第一屏消息会先按真名画一遍、再被备注覆盖 ✓（看得见的闪 ✓）。
    notes = {str(r["peer_id"]): r["note"] for r in await fetch_all(
        "SELECT peer_id, note FROM contact_notes WHERE owner_id = ?", (user["id"],))}

    if not groups:
        return {"me": user, "groups": [], "group": None, "members": [],
                "messages": [], "notes": notes}
    g = groups[0]
    mem = await members(g["id"], user=user)          # 复用同一个函数（它也做成员校验）
    msgs = await list_messages(g["id"], after=0, limit=limit)
    return {"me": user, "groups": groups, "group": g, "members": mem,
            "messages": msgs, "notes": notes}


# ── ⚠️ 这里原来有两条"自己建群 / 自己加入"的路 ✗→✓（2026-10-08 删掉）──
#
#   `POST /api/groups`（建）和 `POST /api/groups/join`（加入）✓ ——
#   它们是**合并之前**的形状 ✓：那时候"加入一个群"是生活管家自己管的 ✓，
#   于是这张表里有自己的一份 `invite_code` ✓。
#   后来壳接管了这件事 ✓（`/api/workspaces` + `/api/workspaces/join` ✓），
#   两条路就**同时存在**了 ✗ —— 而它们的判据不一样 ✓：
#   壳那条认 `workspaces.invite_code` ✓，这条认 `groups.invite_code` ✓，
#   两个码各摇各的 ✓ → **2026-10-08 那个"邀请码不能用"就是这么来的** ✓
#   （界面显示一个、加入认另一个 ✓）。
#
#   合并之后这一半搬进了这个服务 ✓（`routes_shell.py` ✓），
#   两边终于**都在同一个库上了** ✓ → 这两条重复的路**没有存在的理由** ✓。
#   ⚠️ 更要紧的是：留着它们，那道"一个空间最多 3 个人"的闸就**形同虚设** ✗
#      （绕过 `/api/workspaces/join` 走 `/api/groups/join` 就行 ✓）。
#      上限这类东西必须**每条入口都拦** ✓，那就只能留一条入口 ✓。
#
#   它俩各自带的两件事**搬走了**（不是丢了 ✓）：
#     · `check_space(profile)` —— 建空间前校验记忆空间能不能用 ✓
#       → 搬进 `routes_shell.create_space` ✓（那边本来就要建 profile ✓）
#     · `ensure_builtin_kinds(gid)` —— 给新空间登记内置记录类型（记账 ✓）
#       → 同上 ✓（不登记的话它第一次记账会撞一次"没有 bookkeeping 这个类型"✓，
#         能自愈 ✓，但没必要 ✓）
#
#   （`admin.py` 里那条命令行建群的入口**保留** ✓ —— 那是我们自己运维用的 ✓，
#     不走 HTTP ✓，也就不构成"第二条对外的路"✓。）

@router.get("/{group_id}/members")
async def members(group_id: int, user: dict = Depends(current_user)) -> list[dict]:
    """群成员。**管家也在这里面**——它是群里的第三个"人"，
    客户端要能把它和人类成员一起展示。用 `is_agent` 区分。"""
    await require_member(group_id, user["id"])
    rows = await fetch_all(
        # nickname = **在这个群里实际显示的名字**（群昵称优先，没设就用昵称 ✓）；
        # group_nickname = **原始的群昵称**（可能为空 ✓）——
        # 编辑那一栏要的是后者 ✓：把"当前生效的名字"填进去的话，
        # 用户按一下保存就等于**把昵称固化成了群昵称** ✗，以后改昵称就不跟着变了 ✓。
        """SELECT u.id, COALESCE(gm.nickname, u.nickname) AS nickname,
                  gm.nickname AS group_nickname, u.avatar,
                  gm.role, gm.joined_at
           FROM group_members gm JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ? ORDER BY gm.joined_at ASC""",
        (group_id,),
    )
    for r in rows:
        r["is_agent"] = False
    rows.append(
        {
            "id": None,          # 管家没有账号
            "nickname": await agent_name_for(group_id),
            "avatar": None,
            "role": "agent",
            "joined_at": 0,
            "is_agent": True,
        }
    )
    return rows


class UpdateGroupIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    agent_name: str | None = Field(default=None, max_length=32)
    # ⚠️ 旧的 `agent_idle_pool` / `agent_pool_interval` **拿掉了** ✓ —— 2026-10-06。
    #   它们的活儿全并进下面那个 `agent_status` 了 ✓。
    #   留着字段就是**第二条能写同一份真相的路** ✗
    #   （列还在库里 ✓，但那只是"没删" ✗，不是"还能写" ✓）。
    # ★ 三档状态池**整个是一份 JSON** ✓ —— 2026-10-06 从四个散列合并过来 ✓。
    #   这里放宽成 Any ✓：前端偶尔会图省事传字符串 ✓，
    #   而"收拾成合法形状"这件事**只在 app/agent_status.normalize 里做** ✓
    #   （形状的定义只有一处 ✓，见那个文件的说明 ✓）。
    agent_status: Any = None
    # ★ 「给管家的话」✓ —— 每个空间一段，每轮注入 ✓。
    agent_user_prompt: str | None = None
    agent_avatar: str | None = None  # 相对 ui_dir 的路径，如 "avatars/g7.png"


async def _sync_name_to_shell(request: Request, group_id: int, name: str) -> None:
    """把新群名**告诉壳一声** ✓ —— 2026-10-06 加。

    ## 为什么必须同步

    名字存在**两个库里** ✓：壳的 `workspaces.name` ✓、这里的 `groups.name` ✓。
    只说给一个听，两边就**各自漂** ✗ —— 用户实测：
    「在群里把名字改了，回『我的』看，**还是旧的**」✓。
    （「我的」那一页列的就是**壳的**那张表 ✓。）

    ## 为什么带着用户自己的票去

    和 `main.py:enter_workspace` 同一个道理 ✓：壳那边**不需要第二套内部凭证** ✓，
    而且它天然会校验"这人真在这个空间里吗" ✓ ——
    我们自己说"我改了 X 空间"是不算数的 ✗。

    ## ⚠️ 失败**不往上抛**

    名字在本服务**已经改好了** ✓。同步不上是壳那边的事 ✓ ——
    不能因为同步失败就回一句"保存失败" ✗（用户会以为白改了 ✓，然后重复改 ✓）。
    但**一定要记日志** ✓：不记就是**静默漂移** ✗，下次又是"改完没生效" ✓。
    """
    row = await fetch_one("SELECT profile FROM groups WHERE id = ?", (group_id,))
    prof = (row or {}).get("profile") or ""
    # 空间号就在 profile 名里（`chat-<uuid>`）——两边唯一的约定 ✓
    ws = prof[5:] if prof.startswith("chat-") else ""
    if not ws:
        log.warning("改群名：profile 不是 chat- 开头（%r），没法同步给壳", prof)
        return
    token = request.cookies.get("lg_shell_session") or ""
    if not token:
        log.warning("改群名：没有票，没法同步给壳（ws=%s）", ws)
        return
    url = f"{settings.shell_base_url.rstrip('/')}/api/internal/workspace-name"
    try:
        import httpx                      # 本地 import ✓：只有这一条路用得上 ✓
        async with httpx.AsyncClient(timeout=5.0) as cli:
            r = await cli.post(url, json={"ws": ws, "name": name},
                               headers={"Authorization": f"Bearer {token}"})
        if r.status_code != 200:
            log.warning("改群名：壳没接受（HTTP %s）%s", r.status_code, r.text[:120])
    except Exception as exc:  # noqa: BLE001
        log.warning("改群名：问不到壳（%s）—— 两边的名字现在是漂的", exc)


@router.patch("/{group_id}")
async def update_group(
    request: Request, group_id: int, body: UpdateGroupIn,
    user: dict = Depends(current_user),
) -> dict:
    """改群名 / 改管家昵称。"""
    await require_member(group_id, user["id"])
    fields, params = [], []
    if body.name is not None:
        fields.append("name = ?"); params.append(body.name.strip())
    if body.agent_name is not None:
        # 空字符串 = 恢复默认（用 NULL 表示"跟随全局"）
        fields.append("agent_name = ?"); params.append(body.agent_name.strip() or None)
    if body.agent_status is not None:
        # ⚠️ **一律过 normalize 再存** ✓ —— 夹间隔、去重、截长度、
        #   以及"**思考中恒开**"那条硬规矩，全在那儿 ✓
        #   （见 app/agent_status.py ✓）。接口这层**不做第二遍判断** ✗：
        #   两处各判一次，就一定会有走岔的那天 ✓。
        #
        # ★ `rev` **由服务端 +1，不采信客户端那份** ✓ ——
        #   两个客户端同时改，各算各的 rev 立刻就乱 ✓。
        #   它进待机的轮换相位 ✓ → "改完保存，屏幕上立刻变" ✓
        #   （不加的话，用户可能十分钟里什么都看不到 ✗ → 他会说"保存没生效" ✓）。
        prev = await fetch_one("SELECT agent_status FROM groups WHERE id = ?", (group_id,))
        try:
            old = json.loads((prev or {}).get("agent_status") or "{}")
        except (ValueError, TypeError):
            old = {}
        merged = dict(body.agent_status) if isinstance(body.agent_status, dict) else {}
        merged["rev"] = int((old or {}).get("rev") or 0) + 1
        fields.append("agent_status = ?"); params.append(dumps(merged))
    if body.agent_user_prompt is not None:
        # 空字符串 = **清掉** ✓（存 NULL ✓，不要留一个空串 ✗ ——
        # 那会让"有没有写过"这件事变得没法判断 ✓）
        fields.append("agent_user_prompt = ?")
        params.append(clean_prompt(body.agent_user_prompt) or None)
    if body.agent_avatar is not None:
        fields.append("agent_avatar = ?"); params.append(body.agent_avatar.strip() or None)
    if not fields:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "没有要修改的内容")
    params.append(group_id)
    await execute(f"UPDATE groups SET {', '.join(fields)} WHERE id = ?", params)

    # 改名要广播出去——群里所有人都该立刻看到
    await broadcast_group_update(group_id)
    # ★ 顺手**告诉壳** ✓ —— 「我的」那一页列的是壳那张表 ✓，
    #   不说的话两边名字就各走各的 ✗（见上面那个函数的说明 ✓）。
    if body.name is not None and body.name.strip():
        await _sync_name_to_shell(request, group_id, body.name.strip())
    return await fetch_one("SELECT * FROM groups WHERE id = ?", (group_id,))  # type: ignore[return-value]


# ── 管家头像上传 ──────────────────────────────────────────────
# 每个群一张自己的管家头像，存在 ui/avatars/g{id}.png。
# 和 /api/auth/avatar（用户自己的）走同一个静态目录树，只是子目录不同。
_AGENT_AVATAR_EXTS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_AGENT_AVATAR_MAX = 2 * 1024 * 1024


@router.post("/{group_id}/agent-avatar")
async def upload_agent_avatar(
    group_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
) -> dict:
    """上传管家头像，成功后 PATCH 到 groups.agent_avatar。"""
    await require_member(group_id, user["id"])
    ctype = file.content_type or ""
    if ctype not in _AGENT_AVATAR_EXTS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "只支持 png/jpg/webp")
    data = await file.read()
    if len(data) > _AGENT_AVATAR_MAX:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "图片不能超过 2MB")
    # 校验真 JPEG（.jpg 允许 jpg/jpeg 扩展）
    if ctype == "image/jpeg" and not data.startswith(b"\xff\xd8"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不是有效的 JPEG")

    avatar_dir = settings.ui_dir / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    ext = _AGENT_AVATAR_EXTS[ctype]
    avatar_dir.joinpath(f"g{group_id}.png").unlink(missing_ok=True)
    path = avatar_dir / f"g{group_id}{ext}"
    path.write_bytes(data)
    # ★ 把**版本号写进存的那串里** ✓ —— 2026-10-06。
    #   上面那个静态层按"URL 里有没有 `?v=`"决定能不能缓存 ✓，
    #   所以没有版本号的头像**每次都得重下** ✓（也就每次都闪 ✓）。
    #   换图时这个数会变 ✓ → URL 变 → 浏览器自然去取新的 ✓。
    rel = f"avatars/g{group_id}{ext}?v={int(now())}"

    await execute(
        "UPDATE groups SET agent_avatar = ? WHERE id = ?", (rel, group_id)
    )
    await broadcast_group_update(group_id)
    return {"ok": True, "avatar": f"/ui/{rel}"}


class UpdateMeIn(BaseModel):
    nickname: str = Field(min_length=1, max_length=32)


@router.patch("/{group_id}/me")
async def update_my_nickname(
    group_id: int, body: UpdateMeIn, user: dict = Depends(current_user)
) -> dict:
    """改我在**这个群**里的昵称。与账号名无关（账号名是登录凭证）。"""
    await require_member(group_id, user["id"])
    await execute(
        "UPDATE group_members SET nickname = ? WHERE group_id = ? AND user_id = ?",
        (body.nickname.strip(), group_id, user["id"]),
    )
    await broadcast_group_update(group_id)
    return {"ok": True, "nickname": body.nickname.strip()}


@router.get("/{group_id}/messages")
async def messages(
    group_id: int,
    after: int = Query(0, ge=0, description="增量补拉游标：只返回 id 大于它的消息"),
    before: int | None = Query(None, ge=1, description="往回翻历史：只返回 id 小于它的消息"),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(current_user),
) -> list[dict]:
    """三个方向见 `list_messages` 的说明：

    · 都不给 → **最新的一批**（首屏）
    · `?after=` → 增量补拉（断线重连）
    · `?before=` → **往回翻历史**（滚到顶时）
    """
    await require_member(group_id, user["id"])
    return await list_messages(group_id, after=after, limit=limit, before=before)


@router.post("/{group_id}/messages")
async def send_message(
    group_id: int,
    body: SendMessageIn,
    user: dict = Depends(current_user),
) -> dict:
    """发消息走 HTTP 而非 WebSocket——HTTP 有明确的成功/失败返回，
    不会因为连接抖动静默丢消息。WebSocket 只负责下行推送。"""
    await require_member(group_id, user["id"])
    if body.msg_type == "text" and not (body.content or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "文本不能为空")

    # 语音：转写成文字存进 content。
    # **转写失败不拦消息**——音频照样发出去、照样能看到，
    # 只是管家读不到内容而已。为了转写失败让人发不出话，本末倒置。
    content = body.content
    media_meta = dict(body.media_meta or {})
    # ★ `audio`（用户**上传的音频文件** ✓）和 `voice`（按住说的 ✓）**走同一条路** ✓ ——
    #   对管家来说都是"一段话"，它不需要知道是录的还是传的 ✓。
    if body.msg_type in ("voice", "audio") and body.media_path and not (content or "").strip():
        from .stt import transcribe

        audio = settings.media_dir / body.media_path
        text = await transcribe(audio) if audio.exists() else None
        if text:
            content = text
            media_meta["transcript"] = text
        else:
            media_meta["transcript_failed"] = True
            log.info("音频转写失败或为空：%s", body.media_path)

    # ★ **文本类文件读进来** ✗→✓（2026-10-08 用户定的："文本类能读"✓）——
    #   txt / md / csv / json 直接读 ✓，截断之后放进 `content` ✓
    #   （和语音转写同一个模式 ✓：管家看到的是一段带前缀的文字 ✓，
    #    而不是"这里有个文件但你打不开" ✗）。
    #
    #   ⚠️ **只读我们自己白名单里的扩展名** ✗ —— `media_path` 是客户端给的 ✓，
    #      拼路径之前必须确认它没跑出 `media_dir` ✓（`is_relative_to` ✓，
    #      和组件那个渲染端点一个做法 ✓）。
    #   ⚠️ pdf / word / excel **不读** ✗（要装解析库 ✓，见 `routes_media` 那段 ✓）→
    #      管家只知道文件名和大小 ✓，它会照实说"我打不开这个格式" ✓。
    if body.msg_type == "file" and body.media_path and not (content or "").strip():
        from .routes_media import TEXT_EXTS
        p = (settings.media_dir / body.media_path).resolve()
        base = settings.media_dir.resolve()
        ok = p.is_relative_to(base) and p.suffix.lower() in TEXT_EXTS and p.is_file()
        if ok:
            try:
                raw = p.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:  # noqa: BLE001
                raw = ""
                log.info("读文件失败：%s（%s）", body.media_path, exc)
            if raw.strip():
                text = raw.strip()[:4000]        # ⚠️ 截断 ✓：别让一个 2MB 的日志把上下文吃光 ✗
                content = text
                media_meta["text"] = text
                media_meta["truncated"] = len(raw) > len(text)
        else:
            # 不读的类型（pdf/word/excel…）→ **说清楚它是什么** ✓，
            # 免得管家猜"这个文件里是什么" ✓（它会编 ✓）。
            media_meta.setdefault("opaque", True)

    # 「反馈：」是用户和它之间的约定（见 SOUL.md）——以这个前缀开头是在**评价它的
    # 表现**，不是在聊生活。**我们不做任何处理**：识别和吸收都是它自己的事。
    #
    # 为什么不在代码里处理：用正则认前缀容易，但"这条反馈该覆盖哪一条旧认知"
    # 需要理解力，只有它做得到。
    #
    # 那为什么还要留一条日志：因为这一环是整套设计里**最软的**（全靠它自觉）。
    # 没有观测的话，"它到底有没有去调 `memory` 把反馈写进去"就无从判断——
    # 只能靠"怎么还是老样子"这种迟钝的体感。搜 `feedback group=` 就能看到
    # 你反馈过几次、反馈了什么，再对着它的记忆文件看有没有落下去。
    if re.match(r"^\s*反馈\s*[:：]", content or ""):
        log.info("feedback group=%s user=%s: %s",
                 group_id, user.get("nickname"), (content or "").strip()[:200])

    # 引用：必须确认被引用的那条**就在这个群里**。
    #
    # 不能只靠外键——`reply_to` 上的外键只管"这条消息存在"，不管"它在哪个群"。
    # 不查的话，改一下请求里的 id 就能让气泡上的引用条显示**别的群**的消息内容，
    # 而我们整套隔离就是靠"群之间的数据互不可见"。这是一条越权读取的口子。
    if body.reply_to:
        if not await fetch_one(
            "SELECT id FROM messages WHERE id = ? AND group_id = ?",
            (body.reply_to, group_id),
        ):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "被引用的消息不在这个群里")

    msg = await create_message(
        group_id=group_id,
        sender_id=user["id"],
        sender_type="user",
        msg_type=body.msg_type,
        content=content,
        media_path=body.media_path,
        media_meta=media_meta or None,
        mentions=body.mentions,
        reply_to=body.reply_to,
    )

    # 编排层在这里被唤醒（Phase 1 的核心）。延迟导入避免循环依赖。
    # 用 schedule 而非 await：不能让发送方一直等 agent 说完话。
    from .orchestrator import schedule

    schedule(msg)
    return msg
