# app/services/session_store.py

"""
Redis Session Store — conversation history per user.
Each session: channel:user_id → JSON list of {role, content} messages.
TTL: 24 hours (configurable).
"""

import json
import logging
from typing import Optional, List, Dict

import redis.asyncio as redis

from app.config import settings

log = logging.getLogger("sessions")


class SessionStore:
    def __init__(self):
        self._redis: Optional[redis.Redis] = None

    async def start(self):
        self._redis = redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
        )
        await self._redis.ping()
        log.info("redis_sessions_connected")

    async def stop(self):
        if self._redis:
            await self._redis.aclose()

    async def ping(self) -> bool:
        try:
            return await self._redis.ping()
        except Exception:
            return False

    def _key(self, channel: str, user_id: str) -> str:
        return f"session:{channel}:{user_id}"

    async def get_history(self, channel: str, user_id: str) -> List[Dict[str, str]]:
        """Get conversation history for a user."""
        try:
            raw = await self._redis.get(self._key(channel, user_id))
            if not raw:
                return []
            return json.loads(raw)
        except Exception as e:
            log.warning("get_history_error: %s", str(e))
            return []

    async def add_message(self, channel: str, user_id: str, role: str, content: str):
        """Add a message to conversation history."""
        key = self._key(channel, user_id)
        try:
            history = await self.get_history(channel, user_id)
            history.append({"role": role, "content": content})

            # Trim to max history
            if len(history) > settings.MAX_HISTORY:
                history = history[-settings.MAX_HISTORY:]

            await self._redis.set(
                key,
                json.dumps(history, ensure_ascii=False),
                ex=settings.SESSION_TTL,
            )
        except Exception as e:
            log.warning("add_message_error: %s", str(e))

    async def clear(self, channel: str, user_id: str):
        """Clear conversation history."""
        try:
            await self._redis.delete(self._key(channel, user_id))
        except Exception:
            pass