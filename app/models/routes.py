"""`/api/models/*` —— 换模型那个界面用的接口。**全部管理员专属** ✓。

## 和原来那个独立服务比，鉴权换了

原来它认两种票（自己签的 `X-Models-Token` + 壳的 cookie，**手写 HMAC 验签** ✓）。
并进来之后**只剩一种** ✓：App 自己的登录票 + 这条 `require_admin` ✓。

⚠️ 管理员这一判断**读库、不读票** ✗→✓ —— 票里的 `adm` 是**签发那一刻的快照** ✓，
   刚设成管理员的人**得重新登录**才带上它 ✗。读库就没这个毛病 ✓
   （而且库里那份才是事实 ✓）。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time

import httpx
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


# ── 问供应商"有哪些模型" / 单测一个 ─────────────────────────────────────
#
# ★ 2026-10-22 加的（用户：设置页做成和「远程CC」一样，模型名列表也一致）。
#   两个接口都**先认存着的那一套**，再认传上来的值 —— 界面上 key 是掩码，
#   原样传回来只会传来一串圆点，拿它去问必然问不动。所以 `cid` 在的时候，
#   缺的字段一律回落到存着的那份。

class AvailIn(BaseModel):
    cid: str = ""
    base_url: str = ""
    api_key: str = ""


class PingIn(BaseModel):
    cid: str = ""
    base_url: str = ""
    api_key: str = ""
    model: str = ""


def _fetch_model_list(base_url: str, api_key: str) -> list[dict]:
    """问上游 `GET {base_url}/models` —— **照抄，别猜**。

    ⚠️ 这里的 `base_url` 是 **OpenAI 那套**（带 `/v1`，见 `probe._call` 里拼的
       `/chat/completions`）—— 所以这里只接 `/models`，别再加 `/v1`。
       （「远程CC」那边是 Anthropic 协议、base 不带 `/v1` —— 两边不同，别照抄那一行。）
    ★ 只留**支持工具调用**的：生活管家干活全靠工具，一个不调工具的模型放进来，
      症状是「它答应了但什么都没干」—— 比报错难查。
    ⚠️ 问不到就回空表，**不抛** —— 这只是锦上添花，不该把编辑页搞失败。
    """
    if not (base_url and api_key):
        return []
    try:
        r = httpx.get(base_url.rstrip("/") + "/models", timeout=12,
                      headers={"Authorization": f"Bearer {api_key}",
                               "Accept": "application/json"})
        if r.status_code >= 400:
            log.info("问模型列表：HTTP %s", r.status_code)
            return []
        data = r.json()
    except Exception as e:  # noqa: BLE001
        log.info("问不到模型列表：%s", e)
        return []

    out = []
    for m in (data.get("data") or []):
        if not isinstance(m, dict) or not m.get("id"):
            continue
        feats = m.get("supported_features") or []
        if feats and "tools" not in feats:
            continue
        try:
            ctx = int(m.get("context_length") or 0)
        except (TypeError, ValueError):
            ctx = 0
        out.append({"id": str(m["id"]), "context": ctx})
    out.sort(key=lambda x: (-x["context"], x["id"]))
    return out


def _resolve(body) -> tuple[dict, str, str]:
    """`(存着的那套, base_url, api_key)` —— 空的一律回落到存着的那份。"""
    d = store.load()
    ent = next((x for x in d["configs"] if x["id"] == body.cid), {}) if body.cid else {}
    base = (body.base_url or "").strip() or str(ent.get("base_url") or "")
    key = (body.api_key or "").strip() or str(ent.get("api_key") or "")
    return ent, base.rstrip("/"), key


@router.post("/available", dependencies=[Depends(require_admin)])
async def available(body: AvailIn) -> dict:
    """这一套方案下，那个端点**有哪些模型能选** —— 给下拉用。"""
    _, base, key = _resolve(body)
    rows = await asyncio.to_thread(_fetch_model_list, base, key)
    return {"ok": True, "list": rows}


@router.post("/ping", dependencies=[Depends(require_admin)])
async def ping(body: PingIn) -> dict:
    """**测某一个模型名** —— 下拉里每一行那颗「测」用的。

    结果**不落盘**：落盘的是前端那份清单（用户按「保存」时整份交上来）——
    和「远程CC」一个规矩：测了不等于存了，存了才记得住。
    """
    ent, base, key = _resolve(body)
    model = (body.model or "").strip()
    if not model:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "得有个模型名")
    cfg = {**ent, "base_url": base, "api_key": key, "model": model,
           "name": ent.get("name") or "这一套"}
    res = await asyncio.to_thread(probe.ping, cfg, model)
    return {"ok": bool(res.get("ok")), "message": res.get("message") or ""}


# ── 写 ────────────────────────────────────────────────────────────────

class ConfigIn(BaseModel):
    name: str = ""
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    # ★ 2026-10-22（设置页学「远程CC」）：
    #   `context` = 这个模型窗口多大（空 = 不改 / 不填）；
    #   `models`  = 下拉里那份**他自己维护的模型名清单**（带每个名字的测试结果）。
    context: str = ""
    models: list[dict] | None = None


def _ctx(v: str) -> str:
    """上下文长度只收数字（空串 = 不填 / 不改）。"""
    t = (v or "").strip()
    if not t:
        return ""
    if not t.isdigit():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "上下文长度得是个正整数")
    return t


def _rows(inp: list[dict] | None) -> list[dict]:
    """把前端交上来的模型名清单**洗一遍**再落盘。

    ⚠️ 这份清单也算外部输入 —— 只收认识的那几个字段，名字去重，长度封顶。
    """
    out: list[dict] = []
    seen: set[str] = set()
    for r in inp or []:
        if not isinstance(r, dict):
            continue
        mid = str(r.get("id") or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        try:
            ctx = int(r.get("ctx") or 0)
        except (TypeError, ValueError):
            ctx = 0
        ok = r.get("ok")
        out.append({"id": mid[:200], "ctx": ctx,
                    "ok": ok if isinstance(ok, bool) else None,
                    "at": float(r.get("at") or 0),
                    "msg": str(r.get("msg") or "")[:300]})
        if len(out) >= 50:
            break
    return out


def _with_current(cfg: dict) -> list[dict]:
    """当前在用的那个模型名必须在清单里 —— 不然下拉里看不见它。"""
    rows = cfg.get("models") or []
    if cfg.get("model") and not any(r.get("id") == cfg["model"] for r in rows):
        rows = [{"id": cfg["model"], "ctx": int(cfg.get("context") or 0),
                 "ok": None, "at": 0, "msg": ""}] + rows
    return rows


@router.post("/configs", dependencies=[Depends(require_admin)], status_code=201)
async def create_config(body: ConfigIn) -> dict:
    cfg = {"id": hashlib.sha1(f"{time.time()}{body.model_dump()}".encode()).hexdigest()[:10],
           "name": (body.name or "").strip(),
           "base_url": (body.base_url or "").strip().rstrip("/"),
           "model": (body.model or "").strip(),
           "api_key": (body.api_key or "").strip(),
           "context": _ctx(body.context),
           "models": _rows(body.models),
           "test": None}
    if not all([cfg["name"], cfg["base_url"], cfg["model"], cfg["api_key"]]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "四项都要填")
    cfg["models"] = _with_current(cfg)
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
    ctx = _ctx(body.context)
    if ctx:
        c["context"] = ctx
    if body.models is not None:
        c["models"] = _rows(body.models)
    c["models"] = _with_current(c)
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
