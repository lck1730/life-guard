"""WebSocket 连接注册表与广播。

这个规模（2-10 人）用进程内字典即可，不需要 Redis 之类的 fan-out。
每条连接按 user_id 索引，同时记录该用户订阅的群，广播时按群过滤。
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("lifeguard.hub")


class Hub:
    def __init__(self) -> None:
        # user_id -> 该用户的连接（同一账号多端登录时会有多条）
        self._conns: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def add(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns[user_id].add(ws)

    async def remove(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns[user_id].discard(ws)
            if not self._conns[user_id]:
                self._conns.pop(user_id, None)

    def online_users(self) -> set[int]:
        return set(self._conns)

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> None:
        for ws in list(self._conns.get(user_id, ())):
            try:
                await ws.send_json(payload)
            except Exception:
                # 连接已坏由读循环负责清理，这里静默跳过，避免一条坏连接拖垮广播。
                log.debug("send_to_user failed user=%s", user_id, exc_info=True)

    async def broadcast(self, user_ids: set[int], payload: dict[str, Any]) -> None:
        """并发推送给一组用户，单条失败不影响其余。"""
        if not user_ids:
            return
        await asyncio.gather(
            *(self.send_to_user(uid, payload) for uid in user_ids),
            return_exceptions=True,
        )


hub = Hub()
