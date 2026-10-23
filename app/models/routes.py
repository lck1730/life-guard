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
import struct
import time
import zlib

import httpx
from fastapi import (APIRouter, Depends, File, Form, HTTPException, Response,
                     UploadFile, status)
from pydantic import BaseModel, Field

from ..auth import current_user
from ..config import settings
from ..db import fetch_one
from . import magicube, probe, store

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


@router.get("/magicube", dependencies=[Depends(require_admin)])
async def get_magicube(refresh: bool = False) -> dict:
    """魔塔的魔粒余额 / 今日签到 / 今日消耗 ✓ —— **只读** ✓（见 magicube 模块说明 ✓）。"""
    return await magicube.summary(force=refresh)


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


# ── 读图那一档 ─────────────────────────────────────────────────────────
#
# ★ 2026-10-23：**读图单独配** ✓（用户：「单独开个入口可以配置生活管家的读图模型…
#   还可以自定义一张测试图片描述」✓）。
#
#   为什么单独一档 ✗：聊天用的模型和收图的模型常常不是同一个 ✓
#   （实测：商汤的 glm-5.2 是纯文本 ✓、flash-lite 才收图 ✓）——
#   以前只能让 profile 直接点名一个模型名 ✓，而那个名字能不能用
#   **取决于 chat 当时选着哪一家** ✗（chat 换到 Agnes 之后，
#   商汤那个名字就悄悄失效了 ✓，界面上却看不出来 ✗）。
#
#   现在 models.json 里存「哪一套 + 哪个模型名」✓，profile 里只写用途名 `vision` ✓
#   → 换模型只改这个文件 ✓，不用 root 再去写 `/root/.hermes` ✓。

class VisionIn(BaseModel):
    cid: str = ""
    model: str = ""


def _row_of(c: dict, model: str) -> dict | None:
    """这一套里那个模型名的清单行 ✓（老数据可能是字符串 ✓，也认 ✓）。"""
    for r in c.get("models") or []:
        if isinstance(r, dict) and r.get("id") == model:
            return r
    return None


def _mark_img(d: dict, cid: str, model: str, ok: bool) -> None:
    """把「这个模型真能读图」的结论记在**清单那一行**上 ✓。

    ⚠️ 记在模型行、不记在 `vision` 槽上 ✗ —— `vision` 是"现在用谁" ✓，
       这个标记是"它够不够格进候选" ✓，换一个用不该把别的模型的结论抹掉 ✓。
    """
    c = next((x for x in d.get("configs") or [] if x.get("id") == cid), None)
    if not c:
        return
    rows = c.setdefault("models", [])
    row = _row_of(c, model)
    if row is None:
        row = {"id": model[:200], "ctx": int(c.get("context") or 0),
               "ok": None, "at": 0, "msg": ""}
        rows.insert(0, row)
    row["img"] = bool(ok)
    row["img_at"] = int(time.time())


def _colors_ok(text: str) -> bool:
    """内置那张**上红下蓝**的图，答对了两块颜色才算真的看见 ✓。

    ⚠️ 只看 `ok` 不够 ✗ —— 有的模型把图丢掉、照样回一句"我看到了" ✓；
       `image_tokens` 也不是每家都报 ✓（商汤就不报 ✓）。
       红/蓝是**固定答案** ✓，蒙对两块的概率很低 ✓。
    """
    t = (text or "").lower()
    return (("红" in t) or ("red" in t)) and (("蓝" in t) or ("blue" in t))


@router.post("/vision", dependencies=[Depends(require_admin)])
async def set_vision(body: VisionIn) -> dict:
    """把读图指到「某一套的某个模型」✓；两个都空 = 取消单独配（跟着聊天模型走）✓。

    ★ **只收验过的** ✓（用户 2026-10-23：「要真的能读图的才能进」✓）——
      `img` 是之前拿内置红蓝图当场问出来的结论 ✓，不是按名字猜的 ✓。
    """
    cid = (body.cid or "").strip()
    model = (body.model or "").strip()
    d = store.load()
    if not cid and not model:
        d.pop(store.VISION, None)
        store.save(d)
        log.info("读图 → 取消单独配（跟着聊天模型走）")
        return {"ok": True, "vision": store.vision_state(d)}
    c = next((x for x in d["configs"] if x["id"] == cid), None)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "池子里没有这一套")
    if not model:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "得选一个模型名")
    row = _row_of(c, model)
    if not (row and row.get("img") is True):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"「{model}」还没验过能读图 —— 先让它看一次内置那张")
    d[store.VISION] = {"cid": cid, "model": model[:200], "at": int(time.time())}
    store.save(d)
    log.info("读图 → %s · %s", c.get("name"), model)
    return {"ok": True, "vision": store.vision_state(d)}


def _mime_of(b: bytes) -> str:
    """只看**文件头**认格式 ✓ —— 不信任浏览器报的 content-type ✗
    （实测：改个扩展名就能让它报错 ✓，而上游拿到错的 mime 会直接 400 ✓）。"""
    if b.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if b.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if b.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return ""


def _builtin_png() -> bytes:
    """一张 96×64、**上红下蓝**的图 ✓ —— 不带任何人的照片 ✓。

    为什么要有它 ✗：不给图的时候也得能测 ✓ —— 用户可能只是想确认
    "这个模型到底收不收图" ✓，不想拿自己的照片去试 ✓。
    答案也是**一眼能判对错**的 ✓（红 / 蓝），不像"描述这张图"怎么说都行 ✓。
    """
    w, h = 96, 64
    rows = []
    for y in range(h):
        color = b"\xdc\x28\x28" if y < h // 2 else b"\x28\x3c\xdc"
        rows.append(b"\x00" + color * w)      # 每行开头那个 0 = filter type ✓
    raw = b"".join(rows)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _test_img_path():
    """**常驻测试图**存这儿 —— 用户换过就在，删掉就回到内置红蓝图 ✓。

    ★ 2026-10-23（用户：「可以选择常驻的测试图并且显示出来，然后可以随时替换，
      默认红蓝图」✓）—— 一张图存服务端 ✓，换了就是覆盖 ✓，不堆历史 ✓。
    ⚠️ 放 `var/` 下、**不挂静态** ✓：只能走管理员接口取 ✓（和 `var/` 里别的一样 ✓）。
    """
    return settings.var_dir / "vision" / "test.img"


def _resident_img() -> tuple[bytes, str] | None:
    """读常驻图；没有 / 读不出来 / 认不出格式 → None（调用方退回红蓝图 ✓）。"""
    p = _test_img_path()
    try:
        b = p.read_bytes()
    except FileNotFoundError:
        return None
    except OSError as e:  # noqa: BLE001
        log.warning("常驻测试图读不出来（%s）：%s —— 先用内置红蓝图", p, e)
        return None
    mime = _mime_of(b)
    if not b or not mime:
        log.warning("常驻测试图认不出来（%s）—— 先用内置红蓝图", p)
        return None
    return b, mime


#: 上传封顶 8 MB ✓ —— 手机拍的原图常常五六兆 ✓，再大上游也未必收 ✓；
#: 界面那边已经缩过一道 ✓，这儿是后端自己的底线 ✓。
_VISION_MAX = 8 * 1024 * 1024


# ── 常驻测试图 ────────────────────────────────────────────────────────
#
# ★ 2026-10-23：用户要「可以选择常驻的测试图并且显示出来，然后可以随时替换，
#   默认红蓝图」✓。三件事拆成三个动作 ✓：
#     GET    读现在这张（没有就是内置红蓝图 ✓，靠 `X-Image-Kind` 说清是哪种 ✓）
#     POST   换一张（覆盖 ✓，不堆历史 ✓）
#     DELETE 恢复默认（就是删掉这个文件 ✓）
# ⚠️ 这张图**只管"看一眼模型怎么答"** ✗ —— 「能不能读图」的资格依旧只拿
#    内置红蓝图判 ✓（下面 `/vision/test` 里的 `use=builtin` ✓）。

@router.get("/vision/image", dependencies=[Depends(require_admin)])
async def get_vision_image() -> Response:
    """界面里显示的那张常驻图 ✓ —— 从来没换过就吐内置红蓝图 ✓。"""
    r = _resident_img()
    if r:
        b, mime = r
        kind = "custom"
    else:
        b, mime, kind = _builtin_png(), "image/png", "builtin"
    return Response(b, media_type=mime,
                    headers={"X-Image-Kind": kind, "Cache-Control": "no-store"})


@router.post("/vision/image", dependencies=[Depends(require_admin)])
async def set_vision_image(file: UploadFile = File(...)) -> dict:
    """换常驻图 ✓ —— 验格式、验大小，**原子替换**（写一半断电不会留半张 ✓）。"""
    b = await file.read()
    if not b:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这张图是空的")
    if len(b) > _VISION_MAX:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            "图太大了（最多 8 MB）")
    mime = _mime_of(b)
    if not mime:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "这张图认不出来 —— 要 PNG / JPEG / GIF / WebP")
    p = _test_img_path()
    tmp = p.with_name("test.tmp")
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(b)
        os.replace(tmp, p)
    except OSError as e:  # noqa: BLE001
        log.error("常驻测试图存不下（%s）：%s", p, e)
        try:
            tmp.unlink()
        except OSError:
            pass
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            "存不下这张图") from e
    log.info("常驻测试图换了：%s，%s 字节", mime, len(b))
    return {"ok": True, "kind": "custom", "mime": mime, "bytes": len(b)}


@router.delete("/vision/image", dependencies=[Depends(require_admin)])
async def reset_vision_image() -> dict:
    """恢复默认红蓝图 ✓（删掉常驻图；本来就没有也算成功 ✓）。"""
    p = _test_img_path()
    try:
        p.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:  # noqa: BLE001
        log.error("常驻测试图删不掉（%s）：%s", p, e)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            "恢复不了") from e
    log.info("常驻测试图恢复成内置红蓝图")
    return {"ok": True, "kind": "builtin"}


@router.post("/vision/test", dependencies=[Depends(require_admin)])
async def vision_test(cid: str = Form(""), model: str = Form(""),
                      prompt: str = Form(""), file: UploadFile | None = File(None),
                      use: str = Form("resident")) -> dict:
    """**拿真图问一次** —— 这张图它到底看没看见 ✓。

    图从哪来（优先级从高到低 ✓）：
      ① 这次临时传的 `file` ✓
      ② `use=builtin` → **强制内置红蓝图** ✓（验资格只走这条 ✓，
         不然用户换了常驻图，新模型就永远盖不上「能读图」的章 ✗）
      ③ 常驻测试图（`var/vision/test.img` ✓，用户换过才有）
      ④ 内置红蓝图 ✓（默认，答案固定、一眼能判对错 ✓）
    提示词可选 ✓：不传就按"用没用红蓝图"给一句默认的 ✓。
    结果**不落盘** ✓ —— 这只是测试，不改任何配置 ✓（`img` 资格除外 ✓）。
    """
    d = store.load()
    c = next((x for x in d["configs"] if x["id"] == (cid or "").strip()), None)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "池子里没有这一套")

    m = (model or "").strip()
    if not m:
        # 没点名 → 用读图那一档现在指着的那个 ✓（测试"现在这套"最自然 ✓）。
        v = store.vision_state(d, fallback=False)
        m = v.get("model") if v.get("id") == c["id"] else ""
    if not m:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "得选一个模型名")

    builtin = True
    image = b""
    if file is not None:
        image = await file.read()
        if len(image) > _VISION_MAX:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                "图太大了（最多 8 MB）")
    if image:
        builtin = False
        mime = _mime_of(image)
        if not mime:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "这张图认不出来 —— 要 PNG / JPEG / GIF / WebP")
    elif (use or "").strip() == "builtin":
        image, mime = _builtin_png(), "image/png"
    else:
        r = _resident_img()
        if r:
            image, mime = r
            builtin = False
        else:
            image, mime = _builtin_png(), "image/png"

    up = (prompt or "").strip()[:500]
    p = up or ("这张图从上到下分别是什么颜色？只答颜色。" if builtin else "描述这张图片。")

    # ★ 只有「内置图 + 没改问题」这一种才当场判合格 ✓ —— 换了问题 / 换成
    #   用户的照片就判不了对错 ✓（照片里有什么我们不知道 ✓），那种只回结果、
    #   不写 `img` 标记 ✓（别拿一次说明不了什么的测试给模型盖章 ✗）。
    verify = builtin and not up

    res = await asyncio.to_thread(probe.vision_test, c, m, image, mime, p)
    verified = None
    if verify:
        # ⚠️ **只有上游真的回了话才判** ✓（哪怕回的是空话）——
        #    429 / 403 / 超时 / 连不上只说明"这一趟没测成" ✓，
        #    拿它盖章"读不了图"是**假阴性** ✗（实测撞过：429 把
        #    deepseek-v4-flash 盖成了"读不了" ✓，之前它还回过话 ✓）。
        #    判不了就**保持原样** ✓（`img` 不清、不写 ✓），下次再验 ✓。
        if "finish" in res:
            verified = bool(res.get("ok")) and _colors_ok(res.get("text") or "")
            try:
                d2 = store.load()      # 测的这几秒里池子可能被改过 ✓，重读再写 ✓
                _mark_img(d2, c["id"], m, verified)
                store.save(d2)
            except Exception as e:  # noqa: BLE001
                log.warning("读图结论没记上（%s）：%s", m, e)
            log.info("读图验「%s · %s」→ %s", c.get("name"), m,
                     "能读" if verified else "读不了")
        else:
            log.info("读图验「%s · %s」没测成（这趟说明不了会不会看图）：%s",
                     c.get("name"), m, str(res.get("error") or "")[:120])
    return {"ok": bool(res.get("ok")), "result": res,
            "name": c.get("name") or "", "model": m,
            "prompt": p, "builtin": builtin, "verified": verified}


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
        img = r.get("img")
        out.append({"id": mid[:200], "ctx": ctx,
                    "ok": ok if isinstance(ok, bool) else None,
                    "at": float(r.get("at") or 0),
                    "msg": str(r.get("msg") or "")[:300],
                    # ★ 读图资格一起留着 ✓ —— 编辑表单把整份清单交回来 ✓，
                    #   这里不认它的话，改个名字就把"验过能读图"抹了 ✗。
                    "img": img if isinstance(img, bool) else None,
                    "img_at": float(r.get("img_at") or 0)})
        if len(out) >= 50:
            break
    return out


def _with_current(cfg: dict) -> list[dict]:
    """当前在用的那个模型名必须在清单里 —— 不然下拉里看不见它。"""
    rows = cfg.get("models") or []
    if cfg.get("model") and not any(r.get("id") == cfg["model"] for r in rows):
        rows = [{"id": cfg["model"], "ctx": int(cfg.get("context") or 0),
                 "ok": None, "at": 0, "msg": "", "img": None, "img_at": 0}] + rows
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
    old_base = str(c.get("base_url") or "")
    for k in ("name", "base_url", "model", "api_key"):
        v = getattr(body, k)
        if v:
            c[k] = v.strip().rstrip("/") if k == "base_url" else v.strip()
    ctx = _ctx(body.context)
    if ctx:
        c["context"] = ctx
    if body.models is not None:
        c["models"] = _rows(body.models)
    # 换了端点 = 换了个上游 ✓ —— 上一家的"能读图"结论不作数 ✓（模型名可能一样）
    if str(c.get("base_url") or "") != old_base:
        for r in c.get("models") or []:
            if isinstance(r, dict):
                r["img"] = None
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
    # ★ 2026-10-23：读图那一档也一起清 ✓ —— 和上面同一个道理 ✓
    #   （`vision_state` 认不出 id 会退回 chat ✓，不会出事 ✓，但留着是垃圾 ✓）。
    if (d.get(store.VISION) or {}).get("cid") == cid:
        d.pop(store.VISION, None)
        freed.append("读图")
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
