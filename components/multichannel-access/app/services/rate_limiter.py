# app/services/rate_limiter.py

"""
Redis Rate Limiter — sliding window per user.
Default: 30 messages per 60 seconds.
Uses Redis sorted sets for efficient sliding window.
"""

import logging
import time
from typing import Optional

import redis.asyncio as redis

from app.config import settings

log = logging.getLogger("ratelimit")


class RateLimiter:
    def __init__(self, redis_client: redis.Redis):
        self._redis = redis_client

    async def check(self, channel: str, user_id: str) -> bool:
        """
        Returns True if allowed, False if rate-limited.
        Uses Redis sorted set with timestamp scores for sliding window.
        """
        key = f"rate:{channel}:{user_id}"
        now = time.time()
        window_start = now - settings.RATE_LIMIT_WINDOW

        try:
            pipe = self._redis.pipeline()
            # Remove old entries outside window
            pipe.zremrangebyscore(key, 0, window_start)
            # Count entries in window
            pipe.zcard(key)
            # Add current request
            pipe.zadd(key, {str(now): now})
            # Set expiry on key
            pipe.expire(key, settings.RATE_LIMIT_WINDOW * 2)
            results = await pipe.execute()

            count = results[1]  # zcard result

            if count >= settings.RATE_LIMIT_PER_USER:
                log.warning("rate_limited channel=%s user=%s count=%d", channel, user_id, count)
                return False

            return True

        except Exception as e:
            log.warning("rate_check_error: %s", str(e))
            return True  # Allow on error (fail open)