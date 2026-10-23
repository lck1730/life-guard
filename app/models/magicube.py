"""魔搭（ModelScope）的魔粒：余额 / 今日签到 / 今日消耗 ✓。

用户 2026-10-23：「魔塔需要每天登录获取魔粒值，为魔塔专门开辟魔粒值显示和
每日快速登录的入口，放在 03，用量与签到」✓。

## 这里只做「读」 ✓

用 `var/models.json` 里**魔塔那一套的 `ms-` key** ✓ 调 ModelScope 的 openapi
（balance / earn/rules / transactions ✓）。**key 一个字都不回给界面** ✗。

⚠️ 每日 200 魔粒是**网页登录**发的 ✓ —— 阿里 passport 那一步带验证码 ✗，
   服务器上拿用户名密码自动登不进去（会被风控拦 ✓），所以这里**不碰密码** ✗。
   要「领」，由用户点一下「打开魔搭」✓（手机系统浏览器里已登录的会话会自己到账 ✓），
   回来这里再看状态 ✓。
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time

import httpx

from . import store

log = logging.getLogger("lifeguard.models.magicube")

_BASE = "https://modelscope.cn"
_TTL = 45.0
_cache: dict = {"at": 0.0, "cid": "", "data": None}


def _config() -> dict | None:
    """魔塔那一套 ✓（名字优先 ✓，其次看 base_url 是不是 modelscope.cn ✓）。"""
    data = store.load()
    cands = [c for c in (data.get("configs") or [])
             if c.get("api_key") and "modelscope.cn" in (c.get("base_url") or "")]
    for c in cands:
        if "魔塔" in (c.get("name") or ""):
            return c
    return cands[0] if cands else None


async def _get(client: httpx.AsyncClient, path: str, key: str):
    r = await client.get(
        _BASE + path,
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("success"):
        raise RuntimeError(body.get("message") or body.get("code") or "魔搭没给数据")
    return body.get("data")


def _num(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


async def summary(force: bool = False) -> dict:
    cfg = _config()
    if not cfg:
        return {"ok": False, "why": "模型池里还没有魔塔（ModelScope）这一套"}
    key = cfg.get("api_key") or ""
    cid = cfg.get("id") or ""
    now = time.time()
    if (not force and _cache.get("data") and _cache.get("cid") == cid
            and now - float(_cache.get("at") or 0) < _TTL):
        return _cache["data"]

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            balance, rules, tx = await asyncio.gather(
                _get(client, "/openapi/v1/magicubes/balance", key),
                _get(client, "/openapi/v1/magicubes/earn/rules", key),
                _get(client, "/openapi/v1/magicubes/transactions?page=1&page_size=50", key),
            )
    except Exception as e:  # noqa: BLE001
        log.warning("魔粒查询失败：%s", e)
        return {"ok": False, "why": "魔搭没答话：" + str(e)[:100]}

    rules = rules or []
    login = next((r for r in rules if r.get("rule_key") == "daily_active"), {})
    aliyun = next((r for r in rules if r.get("rule_key") == "aliyun_bindlogin"), {})

    today = dt.date.today().isoformat()
    records = (tx or {}).get("records") or []
    spent = sum(_num(r.get("total_amount")) for r in records
                if r.get("type") == "SPEND_CONFIRM" and r.get("gmt_created") == today)

    data = {
        "ok": True,
        "at": dt.datetime.now().strftime("%H:%M"),
        "available": _num((balance or {}).get("available_balance")),
        "frozen": _num((balance or {}).get("frozen_amount")),
        "login_earned": _num(login.get("today_earned_amount")),
        "login_amount": _num(login.get("amount")),
        "aliyun_earned": _num(aliyun.get("today_earned_amount")),
        "aliyun_amount": _num(aliyun.get("amount")),
        "signed": _num(login.get("today_earned_amount")) > 0,
        "today_spent": spent,
    }
    _cache.update(at=now, cid=cid, data=data)
    return data
