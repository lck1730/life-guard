"""模型池的存取 —— `var/models.json`（格式和原来那个独立服务**一字不差**）。

⚠️ 这个文件里装着**所有上游的 key** ✗：删一条配置就真的没了 ✓，
   所以 `save()` 每次动手前**先往 `var/models-keep/` 留一份旧账** ✓。
"""
from __future__ import annotations

import json
import logging
import os
import time

from ..config import settings

log = logging.getLogger("lifeguard.models")

#: 两个槽 —— **只保留给 Hermes 的分流用** ✓：调用方（profile 的 `model.default` /
#: `delegation.model` / `auxiliary.*.model`）会把 `chat` / `aux` 写进请求的 `model` ✓。
#: 界面上**不再区分** ✓ —— 用户 2026-10-22 定的：聊天和压缩共用一个模型 ✓。
#: 选一次会同时写两个槽 ✓；`pick()` 里任一槽空着会用另一个兜底 ✓。
#: **改名字要三处一起改** ✗（`tools/set-profile-role.sh`、`set-context-length.sh` 各有一份 ✓）。
ROLES = ("chat", "aux")

#: ★ 2026-10-23：**读图单独一档** ✓ —— 和上面两个槽不一样：
#: 它们只存"哪一套配置"（模型名用配置顶层的 `model` ✓），
#: 而读图存的是「**哪一套 + 哪个模型名**」✓ —— 一套配置里往往有好几个模型 ✓，
#: 读图和聊天多半不是同一个 ✓（实测：商汤的 glm-5.2 纯文本 / flash-lite 能收图 ✓）。
#:
#: ⚠️ profile 的 `auxiliary.vision.model` 写的是**用途名 `vision`** ✓ ——
#: 所以换读图模型**只改这个文件** ✓，不用 root 再去写 `/root/.hermes` ✓。
VISION = "vision"

#: 给人看的名字 —— 报错、日志用它 ✓。
#: ⚠️ 界面上不显示这两个名字了 ✓（只有一个「模型」）—— 这里留着只为日志能分得清 ✓。
ROLE_LABEL = {"chat": "生活管家·chat", "aux": "辅助·压缩"}

#: 能配上下文长度的组 —— **和 `tools/set-context-length.sh` 里那份一致** ✓。
#: 两边都把关 ✓：这边挡"别把脏东西排进队" ✓，那边挡"排进来的也别信" ✓。
CONTEXT_GROUPS = ("chat",)
#: 不再是三个档位，改成**范围** ✓（用户 2026-10-07："改成可以自己输入的" ✓）。
CONTEXT_MIN = 64000
CONTEXT_MAX = 2000000
#: 旧账留几份。
KEEP_KEEP = 20


def _conf():
    return settings.models_conf


def _keep_dir():
    return settings.models_keep_dir


def load() -> dict:
    conf = _conf()
    if not conf.exists():
        return {"configs": [], "roles": {}}
    try:
        d = json.loads(conf.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        # ★ 2026-10-22：**读失败必须吭声** ✗→✓ —— 这里以前是**静默**返回空池 ✓，
        #   于是"文件权限不对 / 读不出来"在界面上长得跟**"我存的模型没了"**一模一样 ✗
        #   （实测：`var/models.json` 被 root 改成 600 之后，商汤就这么"消失"了 ✓）。
        #   池子空着本身是合法的（还没选模型 ✓），所以**不能**靠"空不空"报警 ✗，
        #   只能在这一步说 ✓。
        log.error("模型池读不出来（%s）：%s —— 界面会显示成没配过", conf, e)
        return {"configs": [], "roles": {}}
    if not isinstance(d.get("roles"), dict):
        d["roles"] = {}

    # ── 一次性迁移：老库的 `active` → 三个槽 ──────────────────────────────
    # 用户 2026-10-07："池子里不要有当前模型，每个用途都自己决定" ✓ —— 老库里那个
    # `active` 就是"全局当前在用的那一个" ✓。**直接删会让管家当场哑** ✗（三个槽全空
    # ＝没有模型可用 ✓），所以先把它的值铺进三个槽、再把这个键删掉 ✓。
    #
    # ⚠️ 判断"迁过没有"**不能靠 `roles` 空不空** ✗ —— 用户把三个槽全清空之后也是空的 ✓，
    #    会被误判成"没迁过"、又把老的 `active` 塞回来 ✓。**靠 `"active" in d`** ✓。
    if "active" in d:
        old = d.pop("active")
        if old and any(x.get("id") == old for x in d.get("configs", [])):
            for r in ROLES:
                d["roles"].setdefault(r, old)
            log.info("把老的「当前模型」铺进三个用途槽（%s）", old)
        save(d)
    return d


def save(data: dict) -> None:
    """存盘。**存之前先留一份旧账** ✗→✓ ——
    测试时删掉池子里的一条 → 它的 key 只在 `models.json` 里 ✓（界面上永远读不到 key ✓、
    别处也没有副本 ✓）→ **再也找不回来** ✗。一个装着全部上游凭据的文件，
    一条历史都不留，这本身就不该 ✓。
    """
    conf, keep = _conf(), _keep_dir()
    conf.parent.mkdir(parents=True, exist_ok=True)
    try:
        if conf.exists():
            old = conf.read_text(encoding="utf-8")
            if old.strip() and old != json.dumps(data, ensure_ascii=False, indent=2):
                keep.mkdir(parents=True, exist_ok=True)
                os.chmod(keep, 0o700)
                # ⚠️ 文件名用**毫秒** ✗→✓：用秒的话同一秒里连着改两次，
                #    第二份会覆盖第一份 ✓（实测撞过：清空 + 选回来两步，
                #    中间那个状态没了 ✓）。
                p = keep / f"models-{int(time.time() * 1000)}.json"
                p.write_text(old, encoding="utf-8")
                os.chmod(p, 0o600)     # 里面是明文 key ✓，目录 700 了、文件也别松 ✓
                for f in sorted(keep.glob("models-*.json"))[:-KEEP_KEEP]:
                    f.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        # **备份失败不能挡住正事** ✓（写不进去也要能改配置 ✓），但要说一声 ✓
        log.warning("旧账没留上（%s）—— 这次改动一旦删错就找不回来了", e)

    tmp = conf.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, conf)
    os.chmod(conf, 0o600)


def pick(data: dict, want: str) -> tuple[dict | None, str]:
    """按用途挑配置。返回 `(配置|None, 实际按哪个用途走的)`。

    ★ 2026-10-22：界面只选一个模型 ✓，所以这里**两个槽互为兜底** ✓ ——
      `aux` 空着就借 `chat` 的、`chat` 空着就借 `aux` 的 ✓。
      为什么：Hermes 的压缩走 `aux` ✓，如果只写了 `chat`、压缩那一路就会 503 ✓，
      而 Hermes 压缩失败会**静默丢历史** ✗（用户只知道它变笨了 ✓）。
      共用一个模型之后，这种"一半有、一半没有"只可能是旧配置或写失败 ✓，
      兜底比报错好 ✓（`models.json` 里两个槽正常是同进同退的 ✓）。
    没标用途的那些还是走 `chat` ✓（最"主"的一档 ✓）。
    ⚠️ 槽里指着的模型**被删掉**之后返回 `None` ✓（界面显示成"还没选" ✓，
       而不是继续装作选着 ✓）。
    """
    role = want if want in ROLES else "chat"
    roles = data.get("roles") or {}
    other = "aux" if role == "chat" else "chat"
    rid = roles.get(role) or roles.get(other)
    c = next((x for x in data["configs"] if x["id"] == rid), None) if rid else None
    return c, role


def role_names(data: dict) -> dict:
    """把三个槽翻成人看得懂的名字 —— 前端只认名字、不认 id ✓。
    槽里指着一个**已经不在了**的 id → 回空名 ✓（界面据此显示"还没选" ✓）。
    """
    out = {}
    for r in ROLES:
        rid = (data.get("roles") or {}).get(r)
        c = next((x for x in data["configs"] if x["id"] == rid), None) if rid else None
        out[r] = {"id": rid if c else None, "name": (c or {}).get("name") or "",
                  "label": ROLE_LABEL[r]}
    return out


def vision_state(data: dict, *, fallback: bool = True) -> dict:
    """读图那一档现在指着谁（哪一套 + 哪个模型名）。

    `fallback=True`（界面用）→ 没配就回"**跟着聊天模型**"的那个真实名字 ✓
      （界面上显示成"还没单独配，跟着聊天模型走" ✓，但不至于空着 ✓）；
    `fallback=False`（网关用）→ 没配就回空的 ✓ —— 网关自己退回去挑 `chat` ✓，
      但这儿**不能装作已经配了** ✓（否则日志里看不出"是退回去的" ✓）。
    """
    v = data.get(VISION) if isinstance(data.get(VISION), dict) else {}
    cid = str(v.get("cid") or "")
    c = next((x for x in (data.get("configs") or []) if x.get("id") == cid), None)
    if c:
        m = str(v.get("model") or "").strip() or str(c.get("model") or "")
        return {"id": cid, "name": c.get("name") or "", "model": m,
                "label": f"{c.get('name') or ''} · {m}".strip(" ·"), "set": True}
    if not fallback:
        return {"id": None, "name": "", "model": "", "label": "", "set": False}
    c, _ = pick(data, "chat")
    if c:
        m = str(c.get("model") or "")
        return {"id": c["id"], "name": c.get("name") or "", "model": m,
                "label": f"{c.get('name') or ''} · {m}".strip(" ·"), "set": False}
    return {"id": None, "name": "", "model": "", "label": "", "set": False}


def context_state() -> dict:
    """界面要显示的"上下文长度现在是多少" —— **从 root 写出来的那份状态文件读** ✓。

    ⚠️ **不能拿"用户点了哪个按钮"当现状显示** ✗ —— 那是自己骗自己：
       写 profile 的活是 root 干的 ✓，成不成只有它知道 ✓
       （见 `tools/set-context-length.sh` 的 `write_state` ✓）。
       所以这里只**转述** ✓、不猜 ✓；文件不在就明说"还没同步过" ✓。
    """
    try:
        d = json.loads(settings.ctx_state.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            return d
    except Exception:  # noqa: BLE001
        pass
    return {"at": 0, "last": {}, "groups": {}, "stale": True}


def public_view(data: dict) -> dict:
    """给界面看的池子 —— ★ **key 一个字都不回** ✗。

    踩过两件事，都是这个设计带来的：
      · 原来回"前 6 位 + …" ✓，但各家 key 格式不一样（`sk-` / `ak_` / 没有前缀 ✓），
        截前 6 位既没意义又难看 ✓
      · 更要命：编辑表单把那个掩码值填回输入框 ✓，用户改个别的字段一提交 ✓，
        **掩码串就被当成新 key 存进去了** → key 当场废掉 ✗（用户实测撞到 ✓）
    所以只回"有没有配"和**末 4 位**（够确认是哪把 ✓），**不回可直接提交的值** ✗。
    """
    # ★ 2026-10-22：每套多回 `context`（窗口多大）和 `models`（模型名清单）——
    #   界面学「远程CC」：一行一套，模型名后面显示 `模型 · 256K`。
    #   ⚠️ 以前没存 context 时借用 profile 当前生效的数 → 四套全显示 1M ✗。
    #   ★ 2026-10-23：**各套只报自己的** ✓ —— 没存就回空串，界面显示 `—` ✓。
    ctx = context_state()
    out = []
    for c in data["configs"]:
        k = c.get("api_key") or ""
        out.append({**c, "api_key": "", "has_key": bool(k),
                    "key_tail": k[-4:] if len(k) > 8 else "",
                    "context": str(c.get("context") or ""),
                    "models": c.get("models") if isinstance(c.get("models"), list) else []})
    return {"configs": out, "roles": role_names(data), "context": ctx,
            # ★ 2026-10-23：读图那一档 —— 界面靠它画"现在用的" + 打勾 ✓。
            "vision": vision_state(data)}
