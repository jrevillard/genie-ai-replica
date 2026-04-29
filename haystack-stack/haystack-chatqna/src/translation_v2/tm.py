"""Translation memory cache — v2 layer.

Versioned Redis cache keyed by (provider, provider_version, source,
target, text_hash). Sits *on top of* — not in place of — the legacy
translator's own Redis cache.

Access pattern when USE_V2_TM_CACHE is ON:
  1. v2 TM lookup. Hit → return, skip legacy entirely.
  2. Miss → call legacy translate() (which does its own cache lookup).
  3. On legacy success, write result back to v2 TM for next time.

Reuses the existing memory_manager Redis client. No new connection.

Per the "no edits to existing code" rule, this file stores under a
distinct namespace (`v2:tm:*`) so nothing collides with the legacy
cache keys (`translate:*`).
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_TTL_SECONDS = 30 * 86400


class TranslationMemory:
    """Versioned Redis-backed TM for v2.

    Parameters
    ----------
    redis_client
        Injectable. If omitted, resolves lazily via the legacy
        `memory_manager.get_memory_manager().redis`. Tests inject a
        `FakeRedis`; production uses the shared connection.
    ttl_seconds
        Cache TTL. Defaults to 30 days, matching the legacy cache.
    """

    NAMESPACE = "v2:tm"

    def __init__(
        self,
        redis_client: Any | None = None,
        ttl_seconds: int = _DEFAULT_TTL_SECONDS,
    ) -> None:
        self._redis = redis_client
        self._ttl = ttl_seconds

    @property
    def redis(self) -> Any:
        if self._redis is None:
            from src.agent.memory_manager import get_memory_manager
            self._redis = get_memory_manager().redis
        return self._redis

    def _key(
        self,
        text: str,
        source: str,
        target: str,
        provider: str,
        provider_version: str,
    ) -> str:
        # Normalize leading/trailing whitespace so cosmetic differences don't
        # multiply cache entries. Everything else stays intact (case, punctuation).
        norm = text.strip()
        h = hashlib.sha1(f"{source}|{target}|{norm}".encode("utf-8")).hexdigest()[:16]
        return f"{self.NAMESPACE}:{provider}:{provider_version}:{source}:{target}:{h}"

    async def get(
        self,
        text: str,
        source: str,
        target: str,
        provider: str,
        provider_version: str = "v1",
    ) -> str | None:
        """Lookup a prior translation. Never raises — returns None on error."""
        if not text or not text.strip():
            return None
        try:
            value = self.redis.get(
                self._key(text, source, target, provider, provider_version)
            )
            return value if value is not None else None
        except Exception as e:
            logger.warning("v2 TM read failed: %s", e)
            return None

    async def put(
        self,
        text: str,
        translation: str,
        source: str,
        target: str,
        provider: str,
        provider_version: str = "v1",
    ) -> None:
        """Write a translation. Never raises — swallows Redis errors."""
        if not text or not text.strip() or not translation:
            return
        try:
            self.redis.setex(
                self._key(text, source, target, provider, provider_version),
                self._ttl,
                translation,
            )
        except Exception as e:
            logger.warning("v2 TM write failed: %s", e)
