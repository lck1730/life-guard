"""`/api/models/*` —— 换模型那个界面用的接口。**全部管理员专属** ✓。

## 和原来那个独立服务比，鉴权换了

原来它认两种票（自己签的 `X-Models-Token` + 壳的 cookie，**手写 HMAC 验签** ✓）。
并进来之后**只剩一种** ✓：App 自己的登录票 + 这条 `require_admin` ✓。

⚠️ 管理员这一判断**读库、不读票** ✗→✓ —— 票里的 `adm` 是**签发那一刻的快照** ✓，
   刚设成管理员的人**得重新登录**才带上它 ✗。读库就没这个毛病 ✓
   （而且库里那份才是事实 ✓）。
"""
from __future__ import annotations

import hashlib
import logging
import os
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import current_user
from ..config import settings
from ..db import fetch_one
from . import probe, store

log = logging.getLogger("lifeguard.models")

router = APIRouter(prefix="/api/models", tags=["models"])


async def require_admin(user: dict = Depends(current_user)) -> dict:
    row = await fetch_one("SELECT is_admin FROM users WHERE id = ?", (user["id"],))
    if not (row and row["is_admin"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "这一页只有管理员能进")
    return user


# ── 读 ────────────────────────────────────────────────────────────────

@router.get("/configs", dependencies=[Depends(require_admin)])
async def list_configs() -> dict:
    """池子 + 三个用途槽 + 上下文长度现状 ✓。

    ★ **key 一个字都不回** ✗ —— 见 `store.public_view` 那段（掩码被当新 key 提交过 ✓）。
    """
    return store.public_view(store.load())


@router.get("/progress", dependencies=[Depends(require_admin)])
async def get_progress() -> dict:
    """测模型要几秒到十几秒 ✓，界面轮询这个把"它现在在干什么"显示在底部 ✓。"""
    return dict(probe.progress)


@router.get("/status", dependencies=[Depends(require_admin)])
async def get_status() -> dict:
    d = store.load()
    names = store.role_names(d)
    return {"configured": all(v["name"] for v in names.values()),
            "roles": {k: v["name"] for k, v in names.items()},
            "count": len(d["configs"])}


# ── 写 ────────────────────────────────────────────────────────────────

class ConfigIn(BaseModel):
    name: str = ""
    base_url: str = ""
    model: str = ""
    api_key: str = ""


@router.post("/configs", dependencies=[Depends(require_admin)], status_code=201)
async def create_config(body: ConfigIn) -> dict:
    cfg = {"id": hashlib.sha1(f"{time.time()}{body.model_dump()}".encode()).hexdigest()[:10],
           "name": (body.name or "").strip(),
           "base_url": (body.base_url or "").strip().rstrip("/"),
           "model": (body.model or "").strip(),
           "api_key": (body.api_key or "").strip(),
           "test": None}
    if not all([cfg["name"], cfg["base_url"], cfg["model"], cfg["api_key"]]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "四项都要填")
    d = store.load()
    d["configs"].append(cfg)
    store.save(d)
    return {"ok": True, "id": cfg["id"]}


@router.patch("/configs/{cid}", dependencies=[Depends(require_admin)])
async def edit_config(cid: str, body: ConfigIn) -> dict:
    """**空的字段 = 不改**（不是"清空"）✓。

    key 尤其要紧 ✓：前端拿不到原值（见 `public_view` ✓），所以它留空是正常的 ✓，
    不能因此把 key 抹掉 ✗ —— 那是"改个名字就把 key 弄没了" ✓。
    """
    d = store.load()
    c = next((x for x in d["configs"] if x["id"] == cid), None)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这一套")
    for k in ("name", "base_url", "model", "api_key"):
        v = getattr(body, k)
        if v:
            c[k] = v.strip().rstrip("/") if k == "base_url" else v.strip()
    c["test"] = None          # 改过就得重测 ✓（旧结论不作数 ✓）
    store.save(d)
    return {"ok": True}


@router.delete("/configs/{cid}", dependencies=[Depends(require_admin)])
async def delete_config(cid: str) -> dict:
    d = store.load()
    before = len(d["configs"])
    d["configs"] = [x for x in d["configs"] if x["id"] != cid]
    # 指着它的用途槽一起清掉 ✓ —— 留着死 id 不会出事 ✓（`pick`/`role_names` 都当空处理 ✓），
    # 但那是垃圾 ✓，而且直接看 `models.json` 的时候**误导人** ✗。
    freed = ["模型"] if any((d.get("roles") or {}).get(r) == cid
                           for r in store.ROLES) else []
    for r in store.ROLES:
        if (d.get("roles") or {}).get(r) == cid:
            d["roles"].pop(r, None)
    store.save(d)
    if freed:
        log.warning("删掉的是正在用的模型 —— 现在没有模型可用了")
    return {"ok": len(d["configs"]) < before, "freed": freed}


@router.post("/configs/{cid}/test", dependencies=[Depends(require_admin)])
async def test_config(cid: str) -> dict:
    """跑一遍连通 + 调工具测试（**同步阻塞** ✓，界面靠 `/progress` 看进度 ✓）。"""
    d = store.load()
    c = next((x for x in d["configs"] if x["id"] == cid), None)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这一套")
    res = probe.test_config(c)
    d = store.load()           # 测试期间可能有人动过池子 ✓，重新读一遍再写回 ✓
    for x in d["configs"]:
        if x["id"] == cid:
            x["test"] = res
    store.save(d)
    return {"ok": True, "result": res}


class RoleIn(BaseModel):
    role: str
    id: str = ""


@router.post("/roles", dependencies=[Depends(require_admin)])
async def set_role(body: RoleIn) -> dict:
    """选模型 / 清空模型 ✓。

    ★ 2026-10-22：界面只发 `role="model"` ✓ —— **一次写两个槽** ✓
      （Hermes 的聊天走 `chat`、压缩走 `aux` ✓，两边必须指同一个 ✓）。
    旧名 `chat` / `aux` 仍然收 ✓（兼容以前的前端 / 手工调用 ✓），
    但界面上不会再用到 ✓。
    """
    role = (body.role or "").strip()
    if role not in store.ROLES and role != "model":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"没有这个用途：{role}")
    rid = (body.id or "").strip()
    d = store.load()
    if rid and not any(x["id"] == rid for x in d["configs"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "池子里没有这一套")
    targets = store.ROLES if role == "model" else (role,)
    d.setdefault("roles", {})
    for r in targets:
        if rid:
            d["roles"][r] = rid
        else:
            # 空 = 没有模型 ✓（两个槽一起清 ✓，不留一半 ✓）
            d["roles"].pop(r, None)
    store.save(d)
    names = store.role_names(d)
    picked = next((x for x in d["configs"] if x["id"] == rid), None) if rid else None
    # **不拦，但要说** ✓：选一个测不通的也能选 ✓（可能是网络抖了一下 ✓），
    # 只是它会哑 ✓ —— 所以把这件事回给界面 ✓，别让它以为万事大吉 ✗。
    warn = ""
    if picked and not (picked.get("test") or {}).get("ok"):
        warn = f"「{picked['name']}」现在测不通 —— 会哑"
    log.info("模型 → %s", (names.get("chat") or names.get("aux") or {}).get("name")
             or "（空着）")
    return {"ok": True, "roles": names, "warn": warn}


class ContextIn(BaseModel):
    group: str = "chat"
    tokens: int = Field(default=0)


@router.post("/context", dependencies=[Depends(require_admin)])
async def set_context(body: ContextIn) -> dict:
    """上下文长度：**只排队** ✓ —— 我们不提权 ✓（profile 归 root ✓）。

    白名单在这儿先过一遍 ✓（写得进去就不会有脏文件 ✓），
    但真正说了算的是脚本那一边 ✓（**队列内容也算外部输入** ✓）。
    """
    grp = (body.group or "").strip()
    n = int(body.tokens or 0)
    if grp not in store.CONTEXT_GROUPS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"没有这一组：{grp}")
    if not (store.CONTEXT_MIN <= n <= store.CONTEXT_MAX):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"要在 {store.CONTEXT_MIN // 1000}k ~ {store.CONTEXT_MAX // 1000}k 之间")
    q = settings.ctx_queue
    try:
        q.mkdir(parents=True, exist_ok=True)
        tmp = q / f".req-{int(time.time())}-{id(body)}"
        tmp.write_text(f"{grp} {n}\n", encoding="utf-8")
        os.replace(tmp, q / f"req-{int(time.time() * 1000)}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"排不进队：{e}")
    log.info("排队改上下文长度 %s → %s", grp, n)
    return {"ok": True, "queued": True}
