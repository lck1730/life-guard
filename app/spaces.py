"""记忆空间 —— 群与 Hermes profile 目录的**一对一**绑定。

## 这不是"约定"，是硬约束

`profiles/couple/` 就是"你们俩这个空间"。它底下的 `SOUL.md`、`memories/MEMORY.md`、
`memories/USER.md`、`skills/` 全是 **Profile 级**的——只要有两个群指向同一个 profile，
这些文件就被两个群共用，A 群的私事会被注入到 B 群。

**实测发生过**：早期在企业微信里聊的私事（公司破产、情绪状态）漏进了后来新建的测试群。

所以这里的规则是：

    一个群  ⇄  一个 profile 目录        （双向唯一，谁都别想共用）

而不是"同一个 profile 下的群共享记忆"。后者在别处也许说得通，在这个产品里不成立：
一个群就是一段关系（你俩、或某一对朋友），不同关系之间不该看见彼此的记忆。

## 三层拦截，一层比一层硬

1. 命令/接口层：`check()` —— 建群前就把话说清楚，不让人糊里糊涂建出一个会漏的群
2. 数据层：`groups.profile` 上建了唯一索引（见 db.py），重复直接写不进去
3. 兜底层：写不进去时抛错，而不是静默用默认值顶替

早先的毛病恰恰是**默认值**：`create-group` 的 profile 是可选参数、默认 `couple`，
数据库列也 `DEFAULT 'couple'`。于是"这个群属于哪个空间"这个**本该由人明确做的决定**，
被静默代办了——建朋友群时忘了写参数，就落进你们的空间，而且不报任何错。
"""

from __future__ import annotations

from pathlib import Path

from .config import settings
from .db import fetch_one

# Hermes 的全局家目录。**不能拿来当记忆空间**：所有没指定 profile 的入口
# （CLI、cron、其它适配器）都会落到那里，等于把我们的群和别的东西混在一份记忆里。
GLOBAL_PROFILE = "default"

# 插在报错里的操作指引。写在常量里是为了 CLI 和 API 报同一套话，
# 而不是两处各写一遍然后慢慢写歪（这个项目已经吃过一次亏）。
_NEW_SPACE_STEPS = (
    "  先把这个空间建出来，否则这个群的管家每次说话都会静默 401。\n"
    "  实测走通的步骤（2026-10-04 用一个 testspace 空间验证过）：\n"
    "    1) hermes profile create {p}\n"
    "       —— 它会自动带上 config.yaml（**模型配置已经继承好了**，不用再配）、\n"
    "       SOUL.md、skills/、memories/，并提示 \"no API keys yet\"\n"
    "    2) 在 {d}/.env 里写两个键（**两个都要**，少一个都是静默 401 或模型调用失败）：\n"
    "         DOTS_API_KEY=<和 couple 一样的那个>\n"
    "         API_SERVER_KEY=<新生成的随机值，每个空间必须不同>\n"
    "    3) bash deploy.sh --all        # --plugin 同步工具、--soul 同步人格与技能\n"
    "    4) ssh ... systemctl --user restart hermes-gateway.service\n"
    "    5) 验一下它真的起来了：\n"
    "         curl -H \"Authorization: Bearer <它的 key>\" \\\n"
    "              http://127.0.0.1:8642/p/{p}/v1/models     # 应返回 200"
)


def profile_dir(profile: str) -> Path:
    """某个记忆空间在 Hermes 那边的家目录。

    `default` 的家在 Hermes **根目录**下，不是 `profiles/default/`——这是 Hermes
    自己的约定。写错了会读不到 API_SERVER_KEY，然后在 `/p/<name>/` 上静默 401。
    """
    if not profile or profile == GLOBAL_PROFILE:
        return settings.hermes_home
    return settings.hermes_home / "profiles" / profile


async def taken_by(profile: str) -> dict | None:
    """这个空间是不是已经被某个群占了。返回 {id, name} 或 None。"""
    return await fetch_one(
        "SELECT id, name FROM groups WHERE profile = ? LIMIT 1", (profile,)
    )


async def check(profile: str) -> str | None:
    """建群/改群之前校验。返回 None = 可以用；返回字符串 = **给用户看的拒绝理由**。

    刻意返回"能照做的话"而不是一个错误码：这个函数唯一的用处就是让人看懂
    自己错在哪、下一步做什么。只报 `invalid profile` 等于没报。
    """
    p = (profile or "").strip()
    if not p:
        return "记忆空间不能为空。"

    if p == GLOBAL_PROFILE:
        return (
            f"不能用 `{GLOBAL_PROFILE}` 做记忆空间——那是 Hermes 的全局家目录，\n"
            "  CLI、cron 这些没指定 profile 的入口都会落到那里，等于把群和别的东西\n"
            "  混进同一份记忆。请另起一个名字，比如 `couple`、`friend-zhang`。"
        )

    row = await taken_by(p)
    if row:
        return (
            f"记忆空间 `{p}` 已经被群「{row['name']}」(id={row['id']}) 占用了。\n"
            "  **一个群 ⇄ 一个空间，双向唯一，不能共用**——共用会让 Hermes 的\n"
            "  MEMORY.md / USER.md（Profile 级单文件）把一边的私事注入到另一边。\n"
            f"  另起一个名字，比如 `{p}-2`；或者先确认那个群是不是该挪走。"
        )

    # ★ 和旧后端不一样：**看我们自己的钥匙串，不去看 Hermes 的家目录**
    #
    # 旧后端跑在 lifeguard 名下，`/root/.hermes` 就是它的家 ✓，所以它直接去看
    # profile 目录在不在 ✓。
    #
    # 这个服务跑在 lifeguard 名下 ✗ —— **它进不去 /root/.hermes** ✓（700 ✓），
    # 那是设计的一部分 ✓：它读不到别人工作区的记忆 ✗。
    #
    # 于是"这个空间能不能用"的判据换成：**有没有人把这份 key 交给我** ✓。
    #
    #     /opt/lifeguard-chat/keys/<profile>     root:lifeguard 640
    #
    # 这条不只是"换个地方读" ✗ —— 它顺带把能力边界收紧了 ✓：
    # **它只能用被明确交给它的那些空间** ✓，多一个都不行 ✓。
    key_file = Path(settings.hermes_keys_dir) / p
    try:
        handed = key_file.read_text(encoding="utf-8").strip()
    except OSError:
        handed = ""
    if not handed:
        return (
            f"还没有拿到 `{p}` 这个空间的钥匙（{key_file} 不在或为空）。\n"
            "  空间要先由「壳」开通好、并把 key 交接过来，才能挂上去用。\n"
            f"  开通：`lifeguard-provision <uuid>`（profile 名就是 `chat-<uuid>`）。"
        )

    return None
