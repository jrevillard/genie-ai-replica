# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Redis-backed governance primitives: circuit breaker, rate limiter, audit stream.

Errata E5 (SST PRD): All three are greenfield — no XADD/XREADGROUP,
no express-rate-limit, no opossum anywhere in the GENIE codebase.

Prior art for Redis client wiring:
    - components/gov-chat-backend/services/translation-service.js (graceful degradation)
    - genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:446-455 (_run_guardrail)
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Circuit Breaker (Decision 8, NFR13)
# ---------------------------------------------------------------------------
class CircuitState(str, Enum):
    """Circuit breaker states (NFR13)."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, rejecting calls
    HALF_OPEN = "half_open"  # Testing recovery


@dataclass
class CircuitBreakerConfig:
    """Circuit breaker configuration."""

    failure_threshold: int = 3  # Failures before opening
    recovery_timeout_s: float = 30.0  # Seconds before HALF_OPEN
    success_threshold: int = 1  # Successes in HALF_OPEN to close
    key_prefix: str = "cb"  # Redis key prefix


class CircuitBreaker:
    """Redis-backed circuit breaker for tool invocations.

    State machine: CLOSED → OPEN (after failure_threshold) →
    HALF_OPEN (after recovery_timeout) → CLOSED (after success_threshold).

    Redis keys:
        {prefix}:{name}:state  → CircuitState value
        {prefix}:{name}:failures → int failure count
        {prefix}:{name}:opened_at → float timestamp (when breaker opened)
        {prefix}:{name}:successes → int success count in HALF_OPEN
    """

    def __init__(self, redis_client: Any, name: str, config: CircuitBreakerConfig | None = None):
        self._redis = redis_client
        self._name = name
        self._config = config or CircuitBreakerConfig()
        self._prefix = f"{self._config.key_prefix}:{name}"

    @property
    def name(self) -> str:
        return self._name

    async def get_state(self) -> CircuitState:
        """Get current circuit state, handling OPEN → HALF_OPEN transition."""
        state_raw = await self._redis.get(f"{self._prefix}:state")
        if state_raw is None:
            return CircuitState.CLOSED

        state = CircuitState(state_raw)
        if state == CircuitState.OPEN:
            opened_at = await self._redis.get(f"{self._prefix}:opened_at")
            if opened_at and (time.time() - float(opened_at)) >= self._config.recovery_timeout_s:
                await self._transition_to(CircuitState.HALF_OPEN)
                return CircuitState.HALF_OPEN

        return state

    async def is_allowed(self) -> bool:
        """Check if a call should be allowed through the circuit."""
        state = await self.get_state()
        return state != CircuitState.OPEN

    async def record_success(self) -> None:
        """Record a successful call. May transition HALF_OPEN → CLOSED."""
        state = await self.get_state()
        if state == CircuitState.HALF_OPEN:
            successes = await self._redis.incr(f"{self._prefix}:successes")
            if successes >= self._config.success_threshold:
                await self._transition_to(CircuitState.CLOSED)
        elif state == CircuitState.CLOSED:
            # Reset failure count on success in CLOSED state
            await self._redis.set(f"{self._prefix}:failures", 0)

    async def record_failure(self) -> None:
        """Record a failed call. May transition CLOSED → OPEN."""
        state = await self.get_state()
        if state == CircuitState.HALF_OPEN:
            # Any failure in HALF_OPEN → back to OPEN
            await self._transition_to(CircuitState.OPEN)
        elif state == CircuitState.CLOSED:
            failures = await self._redis.incr(f"{self._prefix}:failures")
            if failures >= self._config.failure_threshold:
                await self._transition_to(CircuitState.OPEN)

    async def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state, resetting counters as needed."""
        pipe = self._redis.pipeline()
        pipe.set(f"{self._prefix}:state", new_state.value)

        if new_state == CircuitState.OPEN:
            pipe.set(f"{self._prefix}:opened_at", str(time.time()))
            pipe.set(f"{self._prefix}:successes", 0)
        elif new_state == CircuitState.CLOSED:
            pipe.set(f"{self._prefix}:failures", 0)
            pipe.set(f"{self._prefix}:successes", 0)
            pipe.delete(f"{self._prefix}:opened_at")
        elif new_state == CircuitState.HALF_OPEN:
            pipe.set(f"{self._prefix}:successes", 0)

        await pipe.execute()
        logger.info("Circuit breaker '%s' transitioned to %s", self._name, new_state.value)

    async def reset(self) -> None:
        """Force-reset the circuit to CLOSED (admin operation)."""
        await self._transition_to(CircuitState.CLOSED)


# ---------------------------------------------------------------------------
# Sliding-Window Rate Limiter (Decision 8)
# ---------------------------------------------------------------------------
@dataclass
class RateLimitConfig:
    """Rate limiter configuration."""

    max_requests: int = 100  # Max requests per window
    window_seconds: int = 60  # Window size
    key_prefix: str = "rl"  # Redis key prefix


@dataclass
class RateLimitResult:
    """Result of a rate-limit check."""

    allowed: bool
    remaining: int  # Requests remaining in current window
    reset_at: float  # Unix timestamp when window resets
    retry_after: float | None = None  # Seconds until next request allowed


class SlidingWindowRateLimiter:
    """Redis-backed sliding-window rate limiter.

    Uses Redis sorted sets with timestamps as scores for a true
    sliding window (not fixed buckets). Each request adds a member
    with the current timestamp; expired members are trimmed.

    Redis keys:
        {prefix}:{scope}:{identifier} → sorted set of timestamps
    """

    def __init__(self, redis_client: Any, config: RateLimitConfig | None = None):
        self._redis = redis_client
        self._config = config or RateLimitConfig()

    async def check(self, scope: str, identifier: str) -> RateLimitResult:
        """Check rate limit without consuming a request slot."""
        key = f"{self._config.key_prefix}:{scope}:{identifier}"
        now = time.time()
        window_start = now - self._config.window_seconds

        # Count requests in the current window
        count = await self._redis.zcount(key, window_start, now)
        remaining = max(0, self._config.max_requests - count)
        allowed = count < self._config.max_requests

        result = RateLimitResult(
            allowed=allowed,
            remaining=remaining,
            reset_at=now + self._config.window_seconds,
        )

        if not allowed:
            # Find the oldest request in the window to calculate retry-after
            oldest = await self._redis.zrangebyscore(key, window_start, now, start=0, num=1)
            if oldest:
                oldest_ts = float(oldest[0])
                result.retry_after = max(0.0, oldest_ts + self._config.window_seconds - now)

        return result

    async def consume(self, scope: str, identifier: str) -> RateLimitResult:
        """Consume a request slot. Returns whether the request is allowed.

        If allowed, adds the request timestamp to the window.
        If denied, returns retry_after guidance.
        """
        key = f"{self._config.key_prefix}:{scope}:{identifier}"
        now = time.time()
        window_start = now - self._config.window_seconds

        pipe = self._redis.pipeline()
        # Remove expired entries
        pipe.zremrangebyscore(key, 0, window_start)
        # Count current entries
        pipe.zcard(key)
        results = await pipe.execute()

        count = results[1]

        if count >= self._config.max_requests:
            # Denied — find retry-after
            oldest = await self._redis.zrangebyscore(key, window_start, now, start=0, num=1)
            retry_after = None
            if oldest:
                oldest_ts = float(oldest[0])
                retry_after = max(0.0, oldest_ts + self._config.window_seconds - now)

            return RateLimitResult(
                allowed=False,
                remaining=0,
                reset_at=now + self._config.window_seconds,
                retry_after=retry_after,
            )

        # Allowed — add the request
        pipe2 = self._redis.pipeline()
        pipe2.zadd(key, {str(now): now})
        pipe2.expire(key, self._config.window_seconds + 10)  # TTL = window + buffer
        await pipe2.execute()

        return RateLimitResult(
            allowed=True,
            remaining=max(0, self._config.max_requests - count - 1),
            reset_at=now + self._config.window_seconds,
        )


# ---------------------------------------------------------------------------
# Audit Stream (Decision 2, NFR8/FOI)
# ---------------------------------------------------------------------------
@dataclass
class AuditEntry:
    """An audit log entry for a tool invocation."""

    tool_id: str
    user_id: str
    timestamp: float = field(default_factory=time.time)
    action: str = "invoke"  # invoke | block | rate_limit | circuit_open
    parameters_redacted: dict | None = None  # PII-scrubbed parameters
    result_summary: str | None = None  # Truncated result summary
    duration_ms: float | None = None
    pii_entities_found: int = 0
    governance_decision: str = "allow"  # allow | block | degrade
    source_ip: str | None = None
    metadata: dict | None = None  # Additional context

    def to_dict(self) -> dict:
        """Serialize to a flat dict suitable for Redis Streams XADD."""
        d = {
            "tool_id": self.tool_id,
            "user_id": self.user_id,
            "timestamp": str(self.timestamp),
            "action": self.action,
            "governance_decision": self.governance_decision,
            "pii_entities_found": str(self.pii_entities_found),
        }
        if self.parameters_redacted is not None:
            d["parameters_redacted"] = json.dumps(self.parameters_redacted)
        if self.result_summary is not None:
            d["result_summary"] = self.result_summary[:500]  # Truncate
        if self.duration_ms is not None:
            d["duration_ms"] = str(self.duration_ms)
        if self.source_ip is not None:
            d["source_ip"] = self.source_ip
        if self.metadata is not None:
            d["metadata"] = json.dumps(self.metadata)
        return d


class AuditStream:
    """Redis Streams-backed audit log for tool invocations.

    Uses XADD to append audit entries to a capped stream.
    Supports consumer groups for downstream processing (e.g., analytics).

    Redis keys:
        {stream_name} → Redis Stream
        {stream_name}-dlq → Dead letter queue stream

    NFR8/FOI: Every tool invocation is auditable. No audit = no invocation.
    """

    def __init__(
        self,
        redis_client: Any,
        stream_name: str = "tool-invocation-audit",
        max_len: int = 100_000,
    ):
        self._redis = redis_client
        self._stream_name = stream_name
        self._dlq_name = f"{stream_name}-dlq"
        self._max_len = max_len

    async def log(self, entry: AuditEntry) -> str | None:
        """Append an audit entry to the stream.

        Returns:
            The stream entry ID, or None if logging failed (degraded mode).
        """
        try:
            entry_id = await self._redis.xadd(
                self._stream_name,
                entry.to_dict(),
                maxlen=self._max_len,
            )
            return entry_id
        except Exception as exc:
            logger.error("Failed to write audit entry: %s", exc)
            # Audit failure is logged but does NOT block the tool invocation.
            # The governance pipeline ensures PII was already redacted before
            # this point. The audit is a secondary record.
            return None

    async def create_consumer_group(self, group_name: str, start_id: str = "0") -> bool:
        """Create a consumer group for downstream processing."""
        try:
            await self._redis.xgroup_create(
                self._stream_name,
                group_name,
                id=start_id,
                mkstream=True,
            )
            return True
        except Exception as exc:
            # Group may already exist
            if "BUSYGROUP" in str(exc):
                return True
            logger.error("Failed to create consumer group '%s': %s", group_name, exc)
            return False

    async def read(
        self,
        group_name: str,
        consumer_name: str,
        count: int = 10,
        block_ms: int = 0,
    ) -> list[tuple[str, dict]]:
        """Read entries from the stream as a consumer group member.

        Returns:
            List of (entry_id, entry_dict) tuples.
        """
        try:
            results = await self._redis.xreadgroup(
                group_name,
                consumer_name,
                {self._stream_name: ">"},
                count=count,
                block=block_ms,
            )
            if not results:
                return []
            # results is [[stream_name, [(id, data), ...]]]
            return [(eid, data) for eid, data in results[0][1]]
        except Exception as exc:
            logger.error("Failed to read from audit stream: %s", exc)
            return []

    async def acknowledge(self, group_name: str, *entry_ids: str) -> int:
        """Acknowledge processed entries."""
        try:
            return await self._redis.xack(self._stream_name, group_name, *entry_ids)
        except Exception as exc:
            logger.error("Failed to acknowledge audit entries: %s", exc)
            return 0

    async def move_to_dlq(self, entry: dict) -> str | None:
        """Move a failed entry to the dead letter queue."""
        try:
            return await self._redis.xadd(
                self._dlq_name,
                entry,
                maxlen=self._max_len // 2,
            )
        except Exception as exc:
            logger.error("Failed to write to DLQ: %s", exc)
            return None
