"""规矩的界面接口。

用户 2026-11-22：立规矩板块 —— 每周最多吃几次放纵餐 / 喝几杯奶茶，
或者每周要做到什么；主要由管家添加和督促，界面负责看得见、记得上。

数据在 `app/core/rules.py` ✓；管家那边走 `/api/internal/tools/rules/*` ✓。
这里的每个接口都先 `require_member` ✓ —— 不是这个群的人看不到、也改不了 ✓。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ..auth import current_user, require_member
from ..core import rules as rules_core

log = logging.getLogger("lifeguard.rules.api")
router = APIRouter(prefix="/api/rules", tags=["rules"])


class RuleIn(BaseModel):
    group_id: int
    title: str
    kind: str = "limit"
    target: int = 1
    icon: str = "star"
    note: str = ""


class RulePatchIn(BaseModel):
    group_id: int
    title: str | None = None
    kind: str | None = None
    target: int | None = None
    icon: str | None = None
    note: str | None = None


class RuleLogIn(BaseModel):
    group_id: int
    note: str = ""


async def _member(group_id: int, user: dict) -> None:
    await require_member(group_id, user["id"])


@router.get("")
async def list_rules(
    group_id: int = Query(...),
    user: dict = Depends(current_user),
) -> dict:
    await _member(group_id, user)
    return await rules_core.list_for_group(group_id)


@router.post("")
async def create_rule(body: RuleIn, user: dict = Depends(current_user)) -> dict:
    await _member(body.group_id, user)
    rule, err = await rules_core.create(
        body.group_id,
        body.title,
        kind=body.kind,
        target=body.target,
        icon=body.icon,
        note=body.note,
        created_by=user["id"],
    )
    if not rule:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err or "没立上，再试一次")
    return rule


@router.patch("/{rule_id}")
async def update_rule(
    rule_id: int,
    body: RulePatchIn,
    user: dict = Depends(current_user),
) -> dict:
    await _member(body.group_id, user)
    rule, err = await rules_core.update(
        body.group_id,
        rule_id=rule_id,
        new_title=body.title,
        kind=body.kind,
        target=body.target,
        icon=body.icon,
        note=body.note,
    )
    if not rule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, err or "这条规矩已经不在了")
    return rule


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    group_id: int = Query(...),
    user: dict = Depends(current_user),
) -> dict:
    await _member(group_id, user)
    title, err = await rules_core.remove(group_id, rule_id=rule_id)
    if not title:
        raise HTTPException(status.HTTP_404_NOT_FOUND, err or "这条规矩已经不在了")
    return {"ok": True, "title": title}


@router.post("/{rule_id}/log")
async def log_rule(
    rule_id: int,
    body: RuleLogIn,
    user: dict = Depends(current_user),
) -> dict:
    """记一次 ✓。上限规矩允许记超 ✓（超了要让人看见）；任务规矩到顶就不再记 ✓。"""
    await _member(body.group_id, user)
    rule, err = await rules_core.log_event(
        body.group_id,
        rule_id=rule_id,
        count=1,
        note=body.note,
        user_id=user["id"],
    )
    if not rule:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err or "没记上，再试一次")
    return rule


@router.post("/{rule_id}/undo")
async def undo_rule(
    rule_id: int,
    body: RuleLogIn,
    user: dict = Depends(current_user),
) -> dict:
    await _member(body.group_id, user)
    rule, err = await rules_core.undo_event(body.group_id, rule_id=rule_id, count=1)
    if not rule:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err or "没得撤")
    return rule
