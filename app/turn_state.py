"""一轮发言的运行时锚点。

`run_turn` 开始生成前记下"这一轮看到的最大消息 id"；`check_new_messages` 工具
据此回答"有没有比你正在回的那批更新的消息"。

## 为什么需要它

复审从"外部脚本掐着两阶段走"改成"**它自己调工具问**"之后，它得能问出那个问题。
但它不知道自己在回哪几条——喂给它的那份对话里没有消息 id。所以锚点由我们记。

## 为什么用内存不用数据库

它只在一轮的生命周期内有意义。进程重启后任何进行中的轮次本来就作废了，
留一份过期的锚点在库里只会让"新消息"的判断出错。**存内存，重启即清空，语义正确。**

（同一进程既跑编排层又提供内部接口，所以插件能读到这份内存状态。）
"""

from __future__ import annotations

_anchors: dict[int, int] = {}
# agent 自己调 check_new_messages 时**已经看到**的最大 id。
# 外部复审靠它去重：它检过的，外面就不要再问一遍——否则同一批新消息
# 会被处理两次（它先改一遍，外部复审又让它改一遍），而且两轮之间用户
# 可能又说了话，第二轮改出来的版本反而更旧。
_checked: dict[int, int] = {}


def set_anchor(group_id: int, max_message_id: int) -> None:
    """一轮开始时记下"这一轮看到的最大消息 id"。"""
    _anchors[group_id] = int(max_message_id)
    _checked[group_id] = 0


def get_anchor(group_id: int) -> int:
    """这一轮看到的最大消息 id。没有进行中的轮次时返回 0（=一切都算新）。"""
    return _anchors.get(group_id, 0)


def note_checked(group_id: int, max_message_id: int) -> None:
    """agent 自己查过一次新消息，记下它看到哪条为止。"""
    _checked[group_id] = max(_checked.get(group_id, 0), int(max_message_id))


def get_checked(group_id: int) -> int:
    """它自己已经看到哪条为止了。外部复审只处理比这个更新的。"""
    return _checked.get(group_id, 0)


def clear(group_id: int) -> None:
    _anchors.pop(group_id, None)
    _checked.pop(group_id, None)
