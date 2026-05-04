"""Phase 4 — L2 Adaptive rate limiting.

Sliding-window log algorithm in Redis. Per-IP and per-caller (JWT sub)
quotas, per-endpoint tier configuration, adaptive throttling tied to
recent backend p95 latency. Falls back to a process-local in-memory
counter when Redis is unreachable so the demo never hard-fails on a
Redis blip (BUG-016 pattern from the existing AMINA codebase).

Why this is the FIRST step in the pipeline:
  * cheapest possible drop — no JSON parse, no JWT verify, no regex
  * mitigates volumetric and credential-stuffing attacks before they
    consume meaningful compute
  * an attacker who knows how to bypass rate limit by rotating IPs
    will still be caught downstream by L4-L7

What this is NOT:
  * not a DDoS shield (that's Cloudflare's job, layered separately)
  * not a backend health probe — it only reads recent latency that
    the gateway itself observed via the proxy
  * not a per-user fairness scheduler — single tier per (ip, key)

Tunables are in config.py; defaults are deliberately generous so the
default-OFF compose flag is the only thing standing between this and
unintended throttling during the UNICC demo.
"""
from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional, Tuple

from . import config

logger = logging.getLogger(__name__)


# ── Endpoint tier table ──────────────────────────────────────────────
# (per_ip_per_min, per_caller_per_min, burst). Numbers from the Phase 4
# brief, halved for the chat tier because it's the most expensive.

@dataclass
class _Tier:
    name:        str
    per_ip:      int   # requests/min/ip
    per_caller:  int   # requests/min/caller (JWT sub)
    burst:       int   # max in any 10-second window

DEFAULT_TIER = _Tier(name="default", per_ip=60,  per_caller=600,  burst=10)

ENDPOINT_TIERS: Dict[str, _Tier] = {
    "/health":                          _Tier("health",       300, 3000, 60),
    "/api/v1/public/security/status":   _Tier("status",       120, 1200, 30),
    "/api/v1/public/chat":              _Tier("chat",          30,  300,  5),
    "/api/v1/public/translate":         _Tier("translate",    120, 1200, 20),
    "/api/v1/admin/issue-token":        _Tier("admin_token",   10,   60,  3),
    "/api/v1/admin/jwt-public-key":     _Tier("admin_pubkey", 120, 1200, 30),
}


def tier_for(path: str) -> _Tier:
    return ENDPOINT_TIERS.get(path, DEFAULT_TIER)


# ── Adaptive throttle state ──────────────────────────────────────────
# We watch our own proxy histogram. If the gateway's recent backend
# requests had p95 > _BACKEND_PRESSURE_MS for over _PRESSURE_WINDOW_S,
# we cut the chat tier in half until things normalise.

_BACKEND_PRESSURE_MS  = 3000.0
_PRESSURE_WINDOW_S    = 30.0
_LATENCY_MAX_SAMPLES  = 200    # bound memory; oldest evicted first

_latency_samples: Deque[Tuple[float, float]] = deque(maxlen=_LATENCY_MAX_SAMPLES)


def record_backend_latency(ms: float) -> None:
    """Called by the proxy after each backend round-trip."""
    _latency_samples.append((time.time(), float(ms)))


def _recent_p95() -> float:
    """p95 over the last _PRESSURE_WINDOW_S of latency samples."""
    if not _latency_samples:
        return 0.0
    cutoff = time.time() - _PRESSURE_WINDOW_S
    recent = [m for ts, m in _latency_samples if ts >= cutoff]
    if len(recent) < 5:
        return 0.0
    recent.sort()
    idx = int(len(recent) * 0.95)
    return recent[min(idx, len(recent) - 1)]


def _adaptive_multiplier(path: str) -> float:
    """Returns a quota multiplier in (0.0, 1.0]. 1.0 = no throttle."""
    if path != "/api/v1/public/chat":
        return 1.0
    p95 = _recent_p95()
    if p95 > _BACKEND_PRESSURE_MS:
        # Halve chat capacity. Could go more aggressive but the legit
        # caller experience matters too.
        return 0.5
    return 1.0


# ── Redis client (lazy) ──────────────────────────────────────────────

_redis = None
_redis_failed_until: float = 0.0   # circuit-breaker; skip redis until this ts


def _get_redis():
    """Returns a redis-py client, or None if unavailable."""
    global _redis
    if not config.RATE_LIMIT_ENABLED:
        return None
    if time.time() < _redis_failed_until:
        return None
    if _redis is not None:
        return _redis
    try:
        import redis  # type: ignore
        _redis = redis.Redis.from_url(
            config.RATE_LIMIT_REDIS_URL,
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
            decode_responses=True,
        )
        # Ping once at first use; failures are tolerated below.
        _redis.ping()
        return _redis
    except Exception as e:
        logger.warning("rate_limit: redis unavailable (%s); falling back to in-memory", e)
        _mark_redis_down()
        return None


def _mark_redis_down(seconds: float = 30.0) -> None:
    global _redis_failed_until, _redis
    _redis_failed_until = time.time() + seconds
    _redis = None


# ── In-memory fallback ───────────────────────────────────────────────
# Per-key deque of timestamps. Cheap to maintain, bounded by the
# largest tier (per_caller=3000 entries worst case for /health).

_inmem: Dict[str, Deque[float]] = {}
_inmem_max_keys = 50_000


def _inmem_count(key: str, window_s: int, now: float) -> int:
    dq = _inmem.get(key)
    if dq is None:
        return 0
    cutoff = now - window_s
    while dq and dq[0] < cutoff:
        dq.popleft()
    return len(dq)


def _inmem_add(key: str, now: float) -> None:
    if len(_inmem) > _inmem_max_keys:
        # Evict ~10% of keys (oldest by last-update). Cheap LRU-ish.
        for k in list(_inmem.keys())[: _inmem_max_keys // 10]:
            _inmem.pop(k, None)
    dq = _inmem.setdefault(key, deque())
    dq.append(now)


# ── Public API ───────────────────────────────────────────────────────

@dataclass
class RateLimitOutcome:
    allowed:        bool
    reason:         Optional[str] = None     # "ip", "caller", "burst" if blocked
    limit:          int = 0
    remaining:      int = 0
    reset_seconds:  int = 0
    tier:           str = ""
    backend:        str = "off"               # "redis" | "inmem" | "off"
    adaptive_mult:  float = 1.0


# Stats counters for /security/status
_stats = {
    "checks":           0,
    "throttled":        0,
    "throttled_ip":     0,
    "throttled_caller": 0,
    "throttled_burst":  0,
    "redis_hits":       0,
    "inmem_hits":       0,
    "skipped_disabled": 0,
}


def get_stats() -> Dict[str, int]:
    return dict(_stats)


def check(
    *,
    path:        str,
    ip:          str,
    caller:      Optional[str] = None,
) -> RateLimitOutcome:
    """Return whether this request should be allowed.

    Algorithm:
      1. Resolve tier for path; apply adaptive multiplier.
      2. Check three windows in this order:
           burst (10 s, per-ip)  -> tier.burst
           per-ip   (60 s)       -> int(tier.per_ip * mult)
           per-caller (60 s)     -> int(tier.per_caller * mult), only if caller set
      3. First window that's exceeded -> deny with that reason.
      4. Otherwise increment all counters and allow.

    Stats are incremented exactly once per check. If Redis is healthy
    we use the sliding-window-log pattern via ZADD/ZCARD; otherwise
    we use the in-memory deque.
    """
    _stats["checks"] += 1

    if not config.RATE_LIMIT_ENABLED:
        _stats["skipped_disabled"] += 1
        return RateLimitOutcome(allowed=True, tier=tier_for(path).name, backend="off")

    tier = tier_for(path)
    mult = _adaptive_multiplier(path)
    eff_ip     = max(1, int(tier.per_ip     * mult))
    eff_caller = max(1, int(tier.per_caller * mult))
    eff_burst  = max(1, int(tier.burst))

    now = time.time()
    redis_client = _get_redis()
    backend_label = "redis" if redis_client else "inmem"

    # Keys: scope by tier so chat doesn't share a counter with translate.
    ip_key     = f"gw:rl:{tier.name}:ip:{ip}"
    burst_key  = f"gw:rl:{tier.name}:burst:{ip}"
    caller_key = f"gw:rl:{tier.name}:caller:{caller}" if caller else None

    # ── Redis path ──
    if redis_client is not None:
        try:
            _stats["redis_hits"] += 1
            pipe = redis_client.pipeline()
            score = now
            # 1. Burst (10s window per ip)
            pipe.zremrangebyscore(burst_key, 0, now - 10)
            pipe.zcard(burst_key)
            # 2. Per-ip (60s window)
            pipe.zremrangebyscore(ip_key, 0, now - 60)
            pipe.zcard(ip_key)
            # 3. Per-caller (60s window)
            if caller_key:
                pipe.zremrangebyscore(caller_key, 0, now - 60)
                pipe.zcard(caller_key)
            results = pipe.execute()
            burst_count  = int(results[1])
            ip_count     = int(results[3])
            caller_count = int(results[5]) if caller_key else 0

            if burst_count >= eff_burst:
                _stats["throttled_burst"] += 1
                _stats["throttled"]       += 1
                return RateLimitOutcome(
                    allowed=False, reason="burst",
                    limit=eff_burst, remaining=0,
                    reset_seconds=10, tier=tier.name,
                    backend=backend_label, adaptive_mult=mult,
                )
            if ip_count >= eff_ip:
                _stats["throttled_ip"] += 1
                _stats["throttled"]    += 1
                return RateLimitOutcome(
                    allowed=False, reason="ip",
                    limit=eff_ip, remaining=0,
                    reset_seconds=60, tier=tier.name,
                    backend=backend_label, adaptive_mult=mult,
                )
            if caller_key and caller_count >= eff_caller:
                _stats["throttled_caller"] += 1
                _stats["throttled"]        += 1
                return RateLimitOutcome(
                    allowed=False, reason="caller",
                    limit=eff_caller, remaining=0,
                    reset_seconds=60, tier=tier.name,
                    backend=backend_label, adaptive_mult=mult,
                )

            # Allowed → record this request in all relevant zsets.
            # Use unique member id so two requests in the same ms don't
            # collapse into one zset entry.
            member = f"{score:.6f}-{burst_count}"
            pipe = redis_client.pipeline()
            pipe.zadd(burst_key, {member: score})
            pipe.expire(burst_key, 30)
            pipe.zadd(ip_key, {member: score})
            pipe.expire(ip_key, 120)
            if caller_key:
                pipe.zadd(caller_key, {member: score})
                pipe.expire(caller_key, 120)
            pipe.execute()

            return RateLimitOutcome(
                allowed=True,
                limit=eff_ip,
                remaining=max(0, eff_ip - ip_count - 1),
                reset_seconds=60,
                tier=tier.name,
                backend=backend_label,
                adaptive_mult=mult,
            )
        except Exception as e:
            logger.warning("rate_limit: redis op failed (%s); falling through", e)
            _mark_redis_down()
            backend_label = "inmem"
            # fall through to in-memory path below

    # ── In-memory fallback ──
    _stats["inmem_hits"] += 1
    burst_count  = _inmem_count(burst_key,  10,  now)
    ip_count     = _inmem_count(ip_key,     60,  now)
    caller_count = _inmem_count(caller_key, 60,  now) if caller_key else 0

    if burst_count >= eff_burst:
        _stats["throttled_burst"] += 1
        _stats["throttled"]       += 1
        return RateLimitOutcome(
            allowed=False, reason="burst",
            limit=eff_burst, remaining=0, reset_seconds=10,
            tier=tier.name, backend=backend_label, adaptive_mult=mult,
        )
    if ip_count >= eff_ip:
        _stats["throttled_ip"] += 1
        _stats["throttled"]    += 1
        return RateLimitOutcome(
            allowed=False, reason="ip",
            limit=eff_ip, remaining=0, reset_seconds=60,
            tier=tier.name, backend=backend_label, adaptive_mult=mult,
        )
    if caller_key and caller_count >= eff_caller:
        _stats["throttled_caller"] += 1
        _stats["throttled"]        += 1
        return RateLimitOutcome(
            allowed=False, reason="caller",
            limit=eff_caller, remaining=0, reset_seconds=60,
            tier=tier.name, backend=backend_label, adaptive_mult=mult,
        )

    _inmem_add(burst_key,  now)
    _inmem_add(ip_key,     now)
    if caller_key:
        _inmem_add(caller_key, now)
    return RateLimitOutcome(
        allowed=True,
        limit=eff_ip,
        remaining=max(0, eff_ip - ip_count - 1),
        reset_seconds=60,
        tier=tier.name,
        backend=backend_label,
        adaptive_mult=mult,
    )
