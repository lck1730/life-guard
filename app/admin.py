"""后端管理命令。

**为什么要有它**：App 是"只能登录"的产品形态——注册、建群、邀请都不在前端留口子。
所以这些操作必须在服务器上完成。用法：

    cd /opt/lifeguard
    .venv/bin/python -m app.admin create-user    <用户名> <密码> <昵称>
    .venv/bin/python -m app.admin list-users
    .venv/bin/python -m app.admin set-password   <用户名> <新密码>
    .venv/bin/python -m app.admin create-group   <群名> <记忆空间>
    .venv/bin/python -m app.admin add-member     <群id> <用户名>
    .venv/bin/python -m app.admin list-groups

**建群 = 开一个新的"记忆空间"。** 一个群 ⇄ 一个 Hermes profile 目录，双向唯一：
`profiles/couple/` 里那份记忆只属于你们俩那个群，别的群（朋友、另一个 cp）
必须各自另开一个目录。**不存在多群共享一个空间这种事**——共用会让 Hermes 的
MEMORY.md / USER.md（Profile 级单文件）把一边的私事注入到另一边（实测发生过）。

细则和报错话术见 `app/spaces.py`。
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from .auth import hash_password, new_invite_code
from .db import close_db, execute, fetch_all, fetch_one, init_db, now  # noqa: F401
from .core.spaces import check as check_space
from .core.spaces import profile_dir


async def _create_user(username: str, password: str, nickname: str) -> None:
    if await fetch_one("SELECT id FROM users WHERE username = ?", (username,)):
        print(f"✗ 用户名 {username!r} 已存在")
        return
    uid = await execute(
        "INSERT INTO users (username, password_hash, nickname, created_at) VALUES (?,?,?,?)",
        (username, hash_password(password), nickname, now()),
    )
    print(f"✓ 已创建用户 id={uid}  用户名={username}  昵称={nickname}")


async def _set_password(username: str, password: str) -> None:
    row = await fetch_one("SELECT id FROM users WHERE username = ?", (username,))
    if not row:
        print(f"✗ 找不到用户 {username!r}")
        return
    await execute(
        "UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"])
    )
    print(f"✓ 已更新 {username} 的密码")


async def _list_users() -> None:
    rows = await fetch_all("SELECT id, username, nickname, created_at FROM users ORDER BY id")
    if not rows:
        print("(还没有用户)")
        return
    print(f"{'id':<5}{'用户名':<20}{'昵称':<20}")
    for r in rows:
        print(f"{r['id']:<5}{r['username']:<20}{r['nickname']:<20}")


async def _create_group(name: str, profile: str, owner_username: str | None) -> None:
    profile = (profile or "").strip()

    # **建群 = 开一个新的记忆空间**，两件事本来就是一件。所以先校验空间，
    # 不合格就一个群都不建——建出来的只会是个每次说话都静默 401 的哑群。
    problem = await check_space(profile)
    if problem:
        print(f"✗ 不能建群：{problem}")
        return

    # 这个产品里没有"群主"概念（群由后端创建，认证走账号），但表结构有 NOT NULL，
    # 所以指定一个账号占位；不指定就取最早创建的账号。
    if owner_username:
        owner = await fetch_one("SELECT id FROM users WHERE username = ?", (owner_username,))
        if not owner:
            print(f"✗ 找不到用户 {owner_username!r}")
            return
    else:
        owner = await fetch_one("SELECT id FROM users ORDER BY id LIMIT 1")
        if not owner:
            print("✗ 还没有任何账号——先 create-user，再建群")
            return

    for _ in range(5):
        code = new_invite_code()
        if not await fetch_one("SELECT id FROM groups WHERE invite_code = ?", (code,)):
            break
    gid = await execute(
        "INSERT INTO groups (name, owner_id, invite_code, created_at, profile) VALUES (?,?,?,?,?)",
        (name, owner["id"], code, now(), profile),
    )
    # （这里原本还会往 agent_state 插一行编排层状态。那张表已随判断闸一起删除。
    #   插件和技能也在这时候注册上——不注册的话那个空间的 agent 根本没工具可用。）
    from . import records as _rec

    await _rec.ensure_builtin_kinds(gid)

    # 把"群 ⇄ 目录"这层一一对应**印出来**。用户看不到的东西就等于不存在——
    # 之前 list-groups 不显示空间、建群又不报空间，导致"落进谁的空间"完全不可见。
    print(f"✓ 已创建群 id={gid}  名称={name}  邀请码={code}")
    print(f"  记忆空间：{profile}  →  {profile_dir(profile)}")


async def _add_member(group_id: int, username: str) -> None:
    g = await fetch_one("SELECT id FROM groups WHERE id = ?", (group_id,))
    u = await fetch_one("SELECT id, nickname FROM users WHERE username = ?", (username,))
    if not g:
        print(f"✗ 找不到群 {group_id}")
        return
    if not u:
        print(f"✗ 找不到用户 {username!r}")
        return
    if await fetch_one(
        "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?", (group_id, u["id"])
    ):
        print(f"· {username} 已在群 {group_id} 中")
        return
    await execute(
        "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?,?,?)",
        (group_id, u["id"], "member", now()),
    )
    print(f"✓ 已把 {username}（昵称 {u['nickname']}）加入群 {group_id}")


async def _list_groups() -> None:
    rows = await fetch_all(
        """SELECT g.id, g.name, g.profile,
                  (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS n
           FROM groups g ORDER BY g.id"""
    )
    if not rows:
        print("(还没有群)")
        return
    print(f"{'id':<5}{'群名':<22}{'记忆空间':<12}{'成员数':<6}")
    for r in rows:
        print(f"{r['id']:<5}{r['name']:<22}{r['profile']:<12}{r['n']:<6}")


async def main() -> int:
    p = argparse.ArgumentParser(prog="app.admin", description="生活管家后端管理")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("create-user", help="创建账号")
    a.add_argument("username"); a.add_argument("password"); a.add_argument("nickname")

    a = sub.add_parser("set-password", help="改密码")
    a.add_argument("username"); a.add_argument("password")

    sub.add_parser("list-users", help="列出账号")

    a = sub.add_parser(
        "create-group",
        help="建群 = 开一个新的记忆空间（空间名必填，一个群一个空间）",
    )
    a.add_argument("name")
    # **必填，刻意不给默认值。** 早先是 `nargs="?", default="couple"`，
    # 于是"这个群属于哪个记忆空间"这个本该由人明确做的决定被静默代办了：
    # 建朋友群时忘了写，就落进你们的空间，而且不报任何错。
    a.add_argument("profile", help="记忆空间名。新的人/新的关系必须用新名字，不能复用")
    a.add_argument("--owner", default=None, help="占位用的账号（可不填，默认取最早的账号）")

    a = sub.add_parser("add-member", help="把账号加入群")
    a.add_argument("group_id", type=int); a.add_argument("username")

    sub.add_parser("list-groups", help="列出群")

    args = p.parse_args()
    await init_db()
    try:
        if args.cmd == "create-user":
            await _create_user(args.username, args.password, args.nickname)
        elif args.cmd == "set-password":
            await _set_password(args.username, args.password)
        elif args.cmd == "list-users":
            await _list_users()
        elif args.cmd == "create-group":
            await _create_group(args.name, args.profile, args.owner)
        elif args.cmd == "add-member":
            await _add_member(args.group_id, args.username)
        elif args.cmd == "list-groups":
            await _list_groups()
    finally:
        await close_db()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
