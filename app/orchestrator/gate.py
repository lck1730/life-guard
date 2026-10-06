"""接话判断 —— 现在只剩两样：**被点名**和**熔断**。

## 为什么把判断撤了

这里原先有一整套：冷却、当日预算、语义打分（一次独立的便宜模型调用）、
沉默补偿、@别人惩罚……实测数据说它**性价比是负的**：

    走到语义打分这一步的：  36 次
      ├─ 判「该说」→ 变成一次完整 agent 调用      34 次
      └─ 判「不该说」→ 省下了一次 agent 调用       2 次   ← 这道闸的全部战果

也就是说它拦下的只有 5.5%，代价却是：

- **每条回复前多一次 LLM 调用**（1~3 秒）——闸跑在 agent 之前，是串行的
- 一整套要调参、要排查、要写文档的子系统
- 更麻烦的是**它是瞎的**：那次调用是独立的，看不到 Hermes 的任何记忆、人格、技能，
  只能看 14 条群聊记录。它判的是"这句话**孤立地看**该不该接"，
  而不是"**这个群里这个管家**此刻该不该接"——而后者才是用户真正在意的。

所以判断交回给 agent 自己（规则写在 SOUL.md 的「插嘴」一节）：它有自己的上下文和记忆，
而且能通过用户的「反馈：」慢慢把感觉调准。**这是它该长的本事，不该由我们写死。**

## 留下的两样，理由都不是"品味"

1. **被点名** —— 用户的**显式命令**。既然叫了它，就必答，这不是判断问题。
   而且它有代码兜底（见 agent.run_turn：不许沉默 + 复审不提供沉默选项）。
2. **熔断** —— **安全，不是判断**。它不评判"该不该说"，只在"说得不对劲"时刹车：
   防循环、防消息风暴、防一次事故烧掉一整天。
   分界线是——**它拦的从来不是"这句话"，而是"这个频率"。**
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any

from ..config import settings

log = logging.getLogger("lifeguard.gate")


@dataclass(slots=True)
class Decision:
    speak: bool
    reason: str
    # 被点名时为 True：agent 不允许以沉默应对（run_turn 里有代码兜底）。
    must_speak: bool = False
    # 用户**显式 @** 了它 —— 值得动用高推理档位。
    # 只有 @ 才算；在正文里打字叫它的名字不算（那是随口喊一声）。
    deep: bool = False


def _mentions(msg: dict[str, Any], target: str) -> bool:
    """消息是否 @ 了 target（"agent" 或某人的 user_id 字符串）。"""
    return target in (msg.get("mentions") or [])


def _is_at_mention(msg: dict[str, Any]) -> bool:
    """是否**显式 @** 了管家（客户端 @ 谁就往 mentions 里传谁）——可靠信号。"""
    return _mentions(msg, "agent")


def _mentions_agent(msg: dict[str, Any], agent_name: str = "") -> bool:
    """是否在叫管家（@ 或打字叫名字都算）。

    优先看**显式的 mentions 字段**（客户端 @ 谁就传谁）——可靠。
    退回到文本匹配：正文里出现管家名字也算（用户可能直接打字叫它）。
    """
    if _is_at_mention(msg):
        return True
    name = (agent_name or settings.agent_name or "").strip()
    text = (msg.get("content") or "")
    if not name or not text:
        return False
    if name in text:
        return True
    # 群聊里 @ 常被渲染成 @名字，去掉前导 @ 再比一次
    return any(part.strip().lstrip("@").lstrip("＠") == name for part in text.split())


# ── 熔断 ──────────────────────────────────────────────────────────────
#
# 内存态，重启即清空。语义上是对的：熔断本来就是"刚刚是不是跑疯了"，
# 进程重启后"刚刚"不存在了。库里存一份反而会让它带着历史包袱。

_recent_turns: dict[int, deque[float]] = defaultdict(deque)


def breaker_tripped(group_id: int) -> bool:
    dq = _recent_turns[group_id]
    cutoff = time.monotonic() - 60
    while dq and dq[0] < cutoff:
        dq.popleft()
    return len(dq) >= settings.breaker_turns_per_minute


def note_turn(group_id: int) -> None:
    """记一次"真的要跑一轮了"。由编排层在 run_turn 之前调用。"""
    _recent_turns[group_id].append(time.monotonic())


async def should_speak(
    group_id: int,
    trigger: dict[str, Any],
    *,
    agent_name: str = "",
    trigger_user_id: int | None = None,  # 保留签名以兼容调用方；判断已不再用它
) -> Decision:
    """这个群此刻要不要为这条消息跑一轮 agent。

    **没有 LLM 调用。** 这是撤掉语义闸最直接的收益：每条消息少一次 1~3 秒的往返。
    """
    if _mentions_agent(trigger, agent_name):
        at = _is_at_mention(trigger)
        return Decision(
            True,
            "@ 被点名" if at else "被叫名字",
            must_speak=True,
            deep=at,
        )

    if breaker_tripped(group_id):
        log.warning("group=%s 熔断：一分钟内轮次已达上限 %d，跳过这条",
                    group_id, settings.breaker_turns_per_minute)
        return Decision(False, f"熔断（1 分钟内已跑 {settings.breaker_turns_per_minute} 轮）")

    # 其余全部交给它自己判断——该不该说写在 SOUL.md 里，不在我们这。
    return Decision(True, "交给管家自己判断")
