# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Redis-backed governance primitives — Decisions 2 and 8.

All three primitives in this module are **greenfield**. The code audit found no
``XADD``, no ``express-rate-limit``, no ``opossum``, and no circuit-breaker
implementation anywhere in the repo (PRD §10, E5). The closest prior art is
``components/gov-chat-backend/services/translation-service.js``, which is where the
"keep serving when Redis is down" behaviour below is modelled from.

**State lives in Redis, not in-process, deliberately.** NFR18 requires the governance
state to support horizontal scaling. A per-process circuit breaker across three
replicas needs nine consecutive failures before every replica opens, which violates
NFR13's "opens after 3 consecutive failures". A per-process rate limiter multiplies
the effective limit by the replica count.

**Redis-unavailable policy: fail open, loudly.** Redis is shared infrastructure. If
a Redis outage made the limiter and breaker deny everything, one dependency's failure
would take down every tool — the opposite of NFR15's component isolation. Both
primitives therefore allow the call and log a warning. Note this is the reverse of
the PII redactor's BLOCK-on-failure policy (Decision 5), and the asymmetry is
intentional: failing open on rate limits costs throughput control, failing open on
PII redaction costs sovereignty.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from enum import Enum

logger = logging.getLogger(__name__)

DEFAULT_REDIS_URL = "redis://redis-cache:6379"

# Stream names and MAXLEN budgets (Decision 2).
AUDIT_STREAM = "tool-invocation-audit"
AUDIT_STREAM_MAXLEN = 5_000
FEED_EVENTS_STREAM = "feed-ingestion-events"
FEED_EVENTS_STREAM_MAXLEN = 10_000
FEED_EVENTS_DLQ = "feed-ingestion-events-dlq"
FEED_EVENTS_DLQ_MAXLEN = 5_000


def _redis_url() -> str:
    """Resolve the Redis URL, injecting the password when one is configured.

    The deployed ``redis-cache`` service runs with ``--requirepass`` (see
    ``docker-compose.yaml``), so ``TRANSLATION_CACHE_PASSWORD`` must be threaded into
    the URL. The variable keeps its historical name because it is the same Redis
    instance the translation cache already uses — SST adds no new infrastructure
    (NFR17).
    """
    url = os.getenv("REDIS_URL", DEFAULT_REDIS_URL)
    password = os.getenv("TRANSLATION_CACHE_PASSWORD", "")
    if password and "@" not in url:
        scheme, _, rest = url.partition("://")
        return f"{scheme}://:{password}@{rest}"
    return url


async def get_redis_client():
    """Return an async Redis client, or ``None`` when Redis is unreachable.

    ``None`` is a normal return value, not an error: every caller in this module
    treats it as "degrade gracefully". Imported lazily so the module can be imported
    (and unit-tested) without the ``redis`` package installed.
    """
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(_redis_url(), decode_responses=True)
        await client.ping()
        return client
    except Exception as exc:
        logger.warning("Redis unavailable (%s); governance primitives degrade to fail-open", exc)
        return None


# ─────────────────────────── Rate limiter (Decision 8) ───────────────────────────

# Sliding window over a sorted set. Runs as a single Lua script so the
# prune → count → admit sequence is atomic: a check-then-add in Python would let
# concurrent callers race past the limit, which matters because this same limiter
# backs the webhook flood-protection path (FR27's 429 + Retry-After).
_SLIDING_WINDOW_LUA = """
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  return {0, count}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, math.ceil(window * 1000))
return {1, count + 1}
"""


class RateLimiter:
    """Redis sliding-window rate limiter, per-user and per-feed (Decision 8, FR15).

    Scope keys are caller-supplied strings, so the same limiter serves per-user
    tool limits and per-feed webhook limits without branching.
    """

    def __init__(self, client, key_prefix: str = "sst:rl") -> None:
        self._client = client
        self._prefix = key_prefix

    async def check(self, scope: str, limit: int, window_seconds: float) -> tuple[bool, int]:
        """Record an attempt against *scope* and report whether it is admitted.

        Args:
            scope: Limit bucket, e.g. ``"user:abc123"`` or ``"feed:gazette"``.
            limit: Maximum attempts permitted inside the window.
            window_seconds: Sliding window width.

        Returns:
            ``(allowed, current_count)``. When Redis is unavailable, returns
            ``(True, 0)`` — fail open, per the module policy.
        """
        if self._client is None:
            return True, 0
        try:
            allowed, count = await self._client.eval(
                _SLIDING_WINDOW_LUA,
                1,
                f"{self._prefix}:{scope}",
                str(time.time()),
                str(window_seconds),
                str(limit),
                uuid.uuid4().hex,
            )
            return bool(int(allowed)), int(count)
        except Exception as exc:
            logger.warning("Rate-limit check failed for %s (%s); allowing", scope, exc)
            return True, 0

    async def retry_after(self, scope: str, window_seconds: float) -> int:
        """Seconds until the oldest entry leaves the window — the ``Retry-After`` value.

        Returns at least 1, because ``Retry-After: 0`` invites an immediate retry that
        would be rejected again.
        """
        if self._client is None:
            return 1
        try:
            oldest = await self._client.zrange(f"{self._prefix}:{scope}", 0, 0, withscores=True)
            if not oldest:
                return 1
            expires_at = oldest[0][1] + window_seconds
            return max(1, int(expires_at - time.time()) + 1)
        except Exception:
            return max(1, int(window_seconds))


# ─────────────────────────── Circuit breaker (FR41) ───────────────────────────


class BreakerState(str, Enum):
    """CLOSED → OPEN → HALF_OPEN → CLOSED (FR41, NFR13)."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


# Atomic OPEN → HALF_OPEN promotion. Without this, N replicas would each read 'open'
# and each promote independently; the CAS on 'state' means only one wins the trial.
_BREAKER_ALLOW_LUA = """
local key      = KEYS[1]
local now      = tonumber(ARGV[1])
local recovery = tonumber(ARGV[2])

local state = redis.call('HGET', key, 'state')
if not state or state == 'closed' then
  return {1, 'closed'}
end
if state == 'half_open' then
  return {1, 'half_open'}
end

local opened_at = tonumber(redis.call('HGET', key, 'opened_at')) or 0
if now - opened_at >= recovery then
  redis.call('HSET', key, 'state', 'half_open')
  return {1, 'half_open'}
end
return {0, 'open'}
"""

# Exact-threshold trip. HINCRBY is atomic, so the Nth concurrent failure is the one
# that opens the breaker — NFR13 says "3 consecutive failures", not "about 3".
_BREAKER_FAIL_LUA = """
local key       = KEYS[1]
local threshold = tonumber(ARGV[1])
local now       = tonumber(ARGV[2])
local ttl       = tonumber(ARGV[3])

local failures = redis.call('HINCRBY', key, 'failures', 1)
if failures >= threshold then
  redis.call('HSET', key, 'state', 'open', 'opened_at', now)
end
redis.call('PEXPIRE', key, ttl)
return {failures, redis.call('HGET', key, 'state') or 'closed'}
"""


class CircuitBreaker:
    """Redis-backed circuit breaker, shared across replicas (FR41, NFR13, NFR18).

    Opens after ``failure_threshold`` consecutive failures and auto-closes on the
    first successful trial call after ``recovery_seconds`` — the trial *is* the
    health check the PRD refers to.

    Breakers are per-name, so one tool's outage cannot open another's (NFR15).
    """

    def __init__(
        self,
        client,
        name: str,
        failure_threshold: int = 3,
        recovery_seconds: float = 60.0,
        key_prefix: str = "sst:cb",
    ) -> None:
        self._client = client
        self._name = name
        self._threshold = failure_threshold
        self._recovery = recovery_seconds
        self._key = f"{key_prefix}:{name}"
        # Outlive the recovery window comfortably. If the key does expire while open,
        # the next call reads no state and is admitted — a slower auto-recovery, which
        # is the safe direction.
        self._ttl_ms = int(max(recovery_seconds * 10, 3600) * 1000)

    async def allow(self) -> tuple[bool, BreakerState]:
        """Report whether a call may proceed, promoting OPEN → HALF_OPEN when due.

        Returns ``(True, CLOSED)`` when Redis is unavailable — fail open.
        """
        if self._client is None:
            return True, BreakerState.CLOSED
        try:
            allowed, state = await self._client.eval(
                _BREAKER_ALLOW_LUA, 1, self._key, str(time.time()), str(self._recovery)
            )
            return bool(int(allowed)), BreakerState(state)
        except Exception as exc:
            logger.warning("Breaker check failed for %s (%s); allowing", self._name, exc)
            return True, BreakerState.CLOSED

    async def record_success(self) -> None:
        """Close the breaker and clear the failure count.

        Called after any successful invocation, not only a HALF_OPEN trial — a success
        in CLOSED state must also reset the counter, or unrelated failures spread over
        hours would eventually trip a healthy backend ("consecutive", NFR13).
        """
        if self._client is None:
            return
        try:
            await self._client.hset(self._key, mapping={"state": BreakerState.CLOSED.value, "failures": 0})
            await self._client.pexpire(self._key, self._ttl_ms)
        except Exception as exc:
            logger.warning("Breaker success write failed for %s (%s)", self._name, exc)

    async def record_failure(self) -> tuple[int, BreakerState]:
        """Increment the failure count, opening the breaker at the threshold."""
        if self._client is None:
            return 0, BreakerState.CLOSED
        try:
            failures, state = await self._client.eval(
                _BREAKER_FAIL_LUA, 1, self._key, str(self._threshold), str(time.time()), str(self._ttl_ms)
            )
            return int(failures), BreakerState(state)
        except Exception as exc:
            logger.warning("Breaker failure write failed for %s (%s)", self._name, exc)
            return 0, BreakerState.CLOSED

    async def state(self) -> BreakerState:
        """Current state, for the admin health overview (FR33, FR45)."""
        if self._client is None:
            return BreakerState.CLOSED
        try:
            raw = await self._client.hget(self._key, "state")
            return BreakerState(raw) if raw else BreakerState.CLOSED
        except Exception:
            return BreakerState.CLOSED


# ─────────────────────────── Audit stream (FR44, NFR7) ───────────────────────────


class AuditStream:
    """Append-only invocation log on a Redis Stream (Decision 2, FR44).

    Records exactly what FR44 requires: user, timestamp, tool, redacted parameters,
    and result summary — plus the ``correlation_id`` that ties an entry to its OTel
    trace, so an auditor can pivot from the log to the span.

    ponytail: this is an append-only log with a MAXLEN cap, NOT cryptographic
    tamper-evidence. The PRD's vision paragraph says "tamper-evident"; the binding
    requirements (FR44, NFR7, NFR8) only specify the fields and their accessibility,
    which this satisfies. Real tamper-evidence needs a hash chain whose head is
    written atomically with each append, plus a verifier command that walks it —
    neither is built, and an unverified chain is theatre. Upgrade path if the
    sovereignty claim needs to be literal: SHA-256 chain with the head CAS'd in the
    same Lua call as the XADD, plus an `audit verify` admin endpoint. Tracked as a
    gap against the §1 vision wording, not against an FR.
    """

    def __init__(self, client, stream: str = AUDIT_STREAM, maxlen: int = AUDIT_STREAM_MAXLEN) -> None:
        self._client = client
        self._stream = stream
        self._maxlen = maxlen

    async def append(
        self,
        *,
        tool_id: str,
        user_id: str,
        correlation_id: str,
        status: str,
        redacted_params: dict | None = None,
        result_summary: str = "",
        governance_decisions: dict | None = None,
    ) -> str | None:
        """Append one invocation record. Returns the stream entry id, or ``None``.

        ponytail: an audit-write failure is logged, not raised. This method runs in the
        POST-execution phase (NFR29), by which point the tool has already executed —
        there is nothing left to block. That is a real hole in NFR7's "every
        invocation audit-logged" under a Redis outage. Closing it properly means
        moving the audit write to the PRE phase and making it blocking, which trades
        NFR7 strictness against NFR28's 50 ms budget. Deliberately deferred; raise it
        if an auditor asks for a completeness guarantee.
        """
        if self._client is None:
            logger.warning("Audit write skipped for %s: Redis unavailable (NFR7 gap)", tool_id)
            return None
        entry = {
            "tool_id": tool_id,
            "user_id": user_id,
            "correlation_id": correlation_id,
            "status": status,
            "timestamp": str(time.time()),
            "params": json.dumps(redacted_params or {}, default=str),
            "result_summary": result_summary,
            "governance": json.dumps(governance_decisions or {}, default=str),
        }
        try:
            return await self._client.xadd(self._stream, entry, maxlen=self._maxlen, approximate=True)
        except Exception as exc:
            logger.warning("Audit write failed for %s (%s); NFR7 gap for this invocation", tool_id, exc)
            return None
