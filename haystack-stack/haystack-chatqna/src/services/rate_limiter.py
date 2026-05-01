"""
Redis-backed Rate Limiter
==========================

Pure ASGI middleware that limits per-IP and global request rates on
expensive endpoints (LLM, TTS, STT, voice-chat). Uses Redis fixed-
window counters via INCR + EXPIRE -- one round-trip per request,
no extra pip dependency (slowapi is not installed).

Why this exists
---------------
Nothing today stops a script from hitting `/api/v1/agent/chat-stream`
1000 times per second. That would:
  - Burn through the OpenAI rate limit + monthly cost
  - Exhaust the ArcadeDB connection pool
  - Saturate Redis
  - Crowd legitimate users out of the LLM queue

This middleware caps each (route, IP) pair to a configurable
requests-per-minute and applies a global per-route ceiling so
even a distributed attack can't stampede a single endpoint.

Design
------
- Fixed-window 60-second counters in Redis (`INCR` + first-touch
  `EXPIRE 120`). Fast: one Redis call per request, no Lua.
- Boundary effect: at the minute boundary a client could briefly
  send 2x limit. Acceptable tradeoff for simplicity and zero new
  dependencies.
- Whitelist: 127.0.0.1, ::1, and other docker-internal service IPs
  (172.18.0.x containers calling each other). The docker bridge
  gateway 172.18.0.1 IS rate-limited (real external traffic).
- Returns 429 with Retry-After + X-RateLimit-* headers (RFC 6585).
- If Redis is unavailable, fail-open (log + allow). Better to let
  traffic through than block the entire system on a transient Redis
  outage.

This module is purely additive -- no edits to existing files.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Dict, Iterable, Optional, Tuple

from fastapi import FastAPI

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
#  CONFIG
#
#  per-IP : per-IP requests-per-minute limit
#  global : global (all-IPs) requests-per-minute limit
# ──────────────────────────────────────────────────────────────────

_DEFAULT_LIMITS: Dict[str, Dict[str, int]] = {
    # LLM endpoints (cost per call: ~OpenAI tokens + Haystack RAG)
    "/api/v1/chat":                          {"per_ip": 60,  "global": 600},
    "/api/v1/agent/chat":                    {"per_ip": 60,  "global": 600},
    "/api/v1/agent/chat-stream":             {"per_ip": 60,  "global": 600},

    # TTS (CPU per call)
    "/api/v1/tts":                           {"per_ip": 60,  "global": 600},

    # STT (CPU per call, very expensive)
    "/api/v1/stt":                           {"per_ip": 30,  "global": 200},

    # Voice-chat endpoints (STT + LLM + TTS = the heaviest)
    "/api/v1/voice-chat":                    {"per_ip": 10,  "global": 60},
    "/api/v1/voice-chat-audio":              {"per_ip": 10,  "global": 60},
    "/api/v1/agent/voice-chat":              {"per_ip": 10,  "global": 60},
    "/api/v1/agent/voice-chat-audio":        {"per_ip": 10,  "global": 60},
    "/api/v1/caregiver/voice-chat":          {"per_ip": 10,  "global": 60},
}


# IPs that are NEVER rate-limited (internal health checks, inter-
# service calls). The docker bridge gateway 172.18.0.1 (which is
# what real external clients appear as) is NOT in this set.
_BYPASS_IPS = frozenset({
    "127.0.0.1",
    "::1",
    "localhost",
})


# Internal docker-network container IPs are bypassed too (haystack
# making outbound requests to itself, etc.). Docker bridge default
# is 172.18.0.0/16 but the gateway .1 is real client traffic.
def _is_internal_container_ip(ip: str) -> bool:
    if not ip:
        return False
    if ip in _BYPASS_IPS:
        return True
    # 172.18.0.X where X is NOT 1 (gateway). Containers get 0.2 - 0.254.
    if ip.startswith("172.18.0."):
        try:
            last = int(ip.rsplit(".", 1)[-1])
            return last != 1
        except ValueError:
            return False
    return False


def _resolve_limits() -> Dict[str, Dict[str, int]]:
    """Allow env-var override of any limit:
        RATE_LIMIT_<sanitized_path>_PER_IP=N
        RATE_LIMIT_<sanitized_path>_GLOBAL=N
    Sanitization: replace / and - with _, uppercase. Ex:
        RATE_LIMIT_API_V1_AGENT_CHAT_STREAM_PER_IP=120
    """
    out = {p: dict(d) for p, d in _DEFAULT_LIMITS.items()}
    for path, limits in out.items():
        key_base = "RATE_LIMIT_" + path.replace("/", "_").replace("-", "_").upper().lstrip("_")
        for kind in ("per_ip", "global"):
            env_key = f"{key_base}_{kind.upper()}"
            v = os.getenv(env_key, "").strip()
            if v.isdigit() and int(v) > 0:
                limits[kind] = int(v)
                logger.info("rate_limiter: %s %s overridden to %d via env", path, kind, int(v))
    return out


# ──────────────────────────────────────────────────────────────────
#  REDIS HELPERS (lazy)
# ──────────────────────────────────────────────────────────────────

def _get_redis():
    try:
        # Reuse the observatory_security redis helper -- already
        # configured with the right host/port and timeout.
        from src.services import observatory_security as _obs
        return _obs._get_redis()
    except Exception as e:
        logger.debug("rate_limiter: redis unavailable: %s", e)
        return None


# ──────────────────────────────────────────────────────────────────
#  ASGI MIDDLEWARE
# ──────────────────────────────────────────────────────────────────

class RateLimiterASGI:
    """Per-IP and global rate limiting via Redis fixed-window counters.

    For each (route, ip) pair: INCR ratelimit:{route}:{ip}:{minute}
    For each route globally: INCR ratelimit:{route}:_global:{minute}
    First-touch sets EXPIRE 120 (so old counters self-clean).
    """

    def __init__(self, app, limits: Optional[Dict[str, Dict[str, int]]] = None):
        self.app = app
        self.limits = limits or _resolve_limits()
        # BUG-016 fail-closed fallback: when Redis is down, every
        # (path, ip, minute) gets counted in this dict instead. Keys
        # outside the current minute are pruned each call so the dict
        # never grows past the active window.
        self._memory_counters: Dict[Tuple[str, str, int], int] = {}

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        path = scope.get("path") or ""
        if path not in self.limits:
            return await self.app(scope, receive, send)

        client_ip = self._client_ip(scope)
        if _is_internal_container_ip(client_ip):
            return await self.app(scope, receive, send)

        cfg = self.limits[path]
        decision = self._check_and_increment(path, client_ip, cfg)
        if decision is not None:
            limit, scope_kind, window_left = decision
            return await self._send_429(send, limit, scope_kind, window_left, path)

        return await self.app(scope, receive, send)

    # ── helpers ──────────────────────────────────────────────────

    @staticmethod
    def _client_ip(scope) -> str:
        # Honor X-Forwarded-For if present (we trust the docker bridge).
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in (scope.get("headers") or [])}
        xff = headers.get("x-forwarded-for", "").strip()
        if xff:
            # First IP in the chain
            return xff.split(",")[0].strip()
        client = scope.get("client") or ("", 0)
        return client[0] or "unknown"

    def _check_and_increment(
        self,
        path: str,
        ip: str,
        cfg: Dict[str, int],
    ) -> Optional[Tuple[int, str, int]]:
        """Returns None if request is allowed, else (limit, scope, retry_after_seconds)."""
        now = int(time.time())
        window = now // 60
        window_left = 60 - (now % 60)

        r = _get_redis()
        if not r:
            # BUG-016 fix: was fail-open (return None). Now use an
            # in-memory fixed-window counter with a CONSERVATIVE limit
            # (half the Redis per-IP limit, floor 5/min). This is best-
            # effort -- per-process, not cluster-wide -- but it shuts
            # down trivial DoS while Redis is recovering.
            return self._check_in_memory(path, ip, cfg, window, window_left)

        try:
            # Per-IP key
            ip_key = f"ratelimit:{path}:{ip}:{window}"
            global_key = f"ratelimit:{path}:_global:{window}"

            # Pipeline: INCR both, get values, set TTL on first-touch
            pipe = r.pipeline()
            pipe.incr(ip_key)
            pipe.expire(ip_key, 120)
            pipe.incr(global_key)
            pipe.expire(global_key, 120)
            results = pipe.execute()

            ip_count = int(results[0] or 0)
            global_count = int(results[2] or 0)

            if ip_count > cfg["per_ip"]:
                return cfg["per_ip"], "per-ip", window_left
            if global_count > cfg["global"]:
                return cfg["global"], "global", window_left
        except Exception as e:
            # BUG-016 fix: was fail-open here too. Same in-memory fallback.
            logger.warning("rate_limiter: redis check failed (%s) -- in-memory fallback", e)
            return self._check_in_memory(path, ip, cfg, window, window_left)

        return None

    def _check_in_memory(
        self,
        path: str,
        ip: str,
        cfg: Dict[str, int],
        window: int,
        window_left: int,
    ) -> Optional[Tuple[int, str, int]]:
        """In-memory fail-closed fallback for _check_and_increment.

        Conservative: per-IP limit is min(cfg.per_ip // 2, cfg.per_ip),
        floor 5/min, so even a misconfigured very-low-cost endpoint gets
        protection while Redis is unreachable. Per-process only (does
        not aggregate across workers / containers).
        """
        # Prune any counters that are not in the current window.
        # Bounded work: only entries whose window != current survive.
        stale = [k for k in self._memory_counters if k[2] != window]
        for k in stale:
            self._memory_counters.pop(k, None)

        per_ip_limit = max(5, min(cfg.get("per_ip", 5), cfg.get("per_ip", 5) // 2 or 5))

        key = (path, ip, window)
        n = self._memory_counters.get(key, 0) + 1
        self._memory_counters[key] = n
        if n > per_ip_limit:
            logger.warning(
                "rate_limiter: in-memory limit exceeded path=%s ip=%s n=%d limit=%d",
                path, ip, n, per_ip_limit,
            )
            return per_ip_limit, "per-ip-degraded", window_left
        return None

    async def _send_429(
        self,
        send,
        limit: int,
        scope_kind: str,
        retry_after: int,
        path: str,
    ):
        body = json.dumps({
            "code":           "rate_limited",
            "message": (
                f"Too many requests on {path}. Limit is {limit}/min "
                f"({scope_kind}). Try again in {retry_after} seconds."
            ),
            "limit":          limit,
            "scope":          scope_kind,
            "retry_after":    retry_after,
            "path":           path,
        }).encode("utf-8")

        await send({
            "type": "http.response.start",
            "status": 429,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"retry-after", str(retry_after).encode("ascii")),
                (b"x-ratelimit-limit", str(limit).encode("ascii")),
                (b"x-ratelimit-remaining", b"0"),
                (b"x-ratelimit-scope", scope_kind.encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})


# ──────────────────────────────────────────────────────────────────
#  INSTALLER
# ──────────────────────────────────────────────────────────────────

def install_rate_limiter(
    app: FastAPI,
    limits: Optional[Dict[str, Dict[str, int]]] = None,
) -> None:
    """Install the rate limiter ASGI middleware on `app`."""
    resolved = limits or _resolve_limits()
    app.add_middleware(RateLimiterASGI, limits=resolved)
    logger.info(
        "rate_limiter installed (Redis-backed, fixed-window): %d paths guarded "
        "(internal IPs bypass)",
        len(resolved),
    )
    for path, cfg in resolved.items():
        logger.debug(
            "  rate_limit %s: per_ip=%d/min global=%d/min",
            path, cfg["per_ip"], cfg["global"],
        )


__all__ = ["install_rate_limiter", "RateLimiterASGI"]
