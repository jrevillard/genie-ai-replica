"""Per-user cool-down state machine (Phase D).

Persists across sessions and across uvicorn workers via Redis. Falls
back to a process-local dict if Redis is unavailable so a Redis
outage NEVER silences a user (fail-open).

State stored under one Redis key per user/session:

    abuse:cooldown:<key>     SET   ex=ttl  json={
        "cooldown_until_ts":     <epoch float>,
        "next_cooldown_index":   <int>,         # 0..3+, next index to use
        "lifetime_terminations": <int>,
        "last_terminated_ts":    <epoch float>,
        "was_admin_flagged":     <bool>,
    }

The "key" is the *caller's* responsibility to supply. The defender
prefers ``user_id`` (sticky across sessions) and falls back to
``session_id`` for guests. Mixing the two is fine -- they live in the
same namespace and never collide because session IDs are UUIDs and
patient IDs are P_*.

Cool-down ladder is read from ``config.ABUSE_COOLDOWN_FIRST/SECOND/THIRD``
(defaults 1800 s / 86400 s / 604800 s). Indices >= len(ladder) clamp to
the last entry (so a fourth termination is still 7 days, not longer).

Admin flag threshold is read from ``config.ABUSE_ADMIN_FLAG_THRESHOLD``
(default 3). On the termination that crosses the threshold for the
first time the activate() call returns ``just_admin_flagged=True`` so
the caller can write the admin-flag JSONL row.

This module is internally thread-safe via a single recursive lock.
EVERY public function is wrapped in try/except and returns the safe
default on failure -- the contract is the same fail-open posture as
defender.evaluate(): we'd rather miss a termination than wrongly lock
out a user during a transient infra issue.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

from . import config


_log = logging.getLogger("amina.abuse_defense.cooldown")
_LOCK: threading.RLock = threading.RLock()

# In-memory fallback. Keyed by the same Redis key (so one read/write path).
_INMEM: Dict[str, dict] = {}

# Lazy Redis client. None until first use; sticky None after a failure
# so we don't pile up connection retries on a hot path.
_redis_client = None
_redis_failed = False


def _get_redis():
    """Return a Redis client or None. Sticky failure once we've seen
    one (subsequent calls in the same process don't keep retrying)."""
    global _redis_client, _redis_failed
    if _redis_failed:
        return None
    if _redis_client is not None:
        return _redis_client

    # Tests/eval can force in-memory by setting this env var.
    if os.environ.get("AMINA_ABUSE_DEFENSE_DISABLE_REDIS") == "1":
        _redis_failed = True
        return None

    try:
        import redis  # type: ignore[import]
        from src.config import settings  # type: ignore[import]
        client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
        client.ping()
        _redis_client = client
        return client
    except Exception as exc:
        _log.warning(
            "Redis unavailable for abuse cool-down, using in-memory fallback: %s",
            exc,
        )
        _redis_failed = True
        return None


def _key(user_or_session_key: str) -> str:
    return f"abuse:cooldown:{user_or_session_key}"


def _ladder() -> List[int]:
    """Read the cool-down ladder fresh each call so test code can edit
    config without bouncing the module."""
    ladder = [
        int(config.ABUSE_COOLDOWN_FIRST  or 0),
        int(config.ABUSE_COOLDOWN_SECOND or 0),
        int(config.ABUSE_COOLDOWN_THIRD  or 0),
    ]
    # Drop any zero entries (mis-config) but keep at least one duration
    # so we always do *some* cool-down; default to 30 min if empty.
    ladder = [d for d in ladder if d > 0] or [1800]
    return ladder


def _admin_threshold() -> int:
    return int(config.ABUSE_ADMIN_FLAG_THRESHOLD or 3)


def _read(key: str) -> dict:
    """Read the state record. Returns {} on miss / on any error."""
    rkey = _key(key)
    try:
        r = _get_redis()
        if r is not None:
            try:
                raw = r.get(rkey)
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                _log.warning("redis read failed for %s: %s", key, exc)
                # Fall through to in-mem read.
        return dict(_INMEM.get(rkey, {}))
    except Exception:
        return {}


def _write(key: str, data: dict, *, ttl: int) -> None:
    """Persist the state record. Best-effort; never raises."""
    rkey = _key(key)
    try:
        r = _get_redis()
        if r is not None:
            try:
                r.set(rkey, json.dumps(data), ex=max(60, int(ttl)))
                # Mirror to in-mem so reads stay fast and survive a
                # subsequent Redis flap mid-test.
                _INMEM[rkey] = dict(data)
                return
            except Exception as exc:
                _log.warning("redis write failed for %s: %s", key, exc)
        _INMEM[rkey] = dict(data)
    except Exception as exc:
        _log.warning("cooldown._write unexpected failure for %s: %s", key, exc)


def _delete(key: str) -> None:
    rkey = _key(key)
    try:
        r = _get_redis()
        if r is not None:
            try:
                r.delete(rkey)
            except Exception as exc:
                _log.warning("redis delete failed for %s: %s", key, exc)
        _INMEM.pop(rkey, None)
    except Exception:
        pass


# ── Public API ──────────────────────────────────────────────────────

def remaining_s(key: str, *, now: Optional[float] = None) -> int:
    """Seconds left in the active cool-down (>0 => user is locked out)."""
    if now is None:
        now = time.time()
    try:
        st = _read(key)
        until = float(st.get("cooldown_until_ts", 0) or 0)
        return max(0, int(until - now))
    except Exception:
        return 0


def is_locked(key: str, *, now: Optional[float] = None) -> bool:
    return remaining_s(key, now=now) > 0


def lifetime_terminations(key: str) -> int:
    try:
        return int(_read(key).get("lifetime_terminations", 0) or 0)
    except Exception:
        return 0


# ── Phase D.5: session-terminate flag ───────────────────────────────
# Tracks whether the user has already used up their "soft" escalation
# (session-terminate) past WARNING_3. Once True, the next abuse-past-
# WARNING-3 jumps directly to cool-down. Sticky for life of the record.

def had_session_terminate(key: str) -> bool:
    """True iff this user has already had a session-terminate."""
    try:
        return bool(_read(key).get("had_session_terminate", False))
    except Exception:
        return False


def mark_session_terminate(key: str, *, now: Optional[float] = None) -> dict:
    """Record that the user has had a session-terminate (the soft step
    BEFORE the first cool-down). Idempotent: calling twice on the same
    key is harmless and the second call is a no-op.

    Returns:
        {
          "had_session_terminate":     True,    # always after this call
          "was_already_session_term":  bool,    # True iff record already had it
        }

    NEVER raises. On internal failure returns the safe default (the
    flag still considered True so the defender does NOT loop on this
    state -- next abuse-past-WARNING-3 will go to cool-down).
    """
    if now is None:
        now = time.time()
    try:
        with _LOCK:
            st = _read(key)
            was_already = bool(st.get("had_session_terminate", False))
            if was_already:
                return {
                    "had_session_terminate":    True,
                    "was_already_session_term": True,
                }
            new_state = {
                "cooldown_until_ts":     float(st.get("cooldown_until_ts", 0) or 0),
                "next_cooldown_index":   int(st.get("next_cooldown_index", 0) or 0),
                "lifetime_terminations": int(st.get("lifetime_terminations", 0) or 0),
                "last_terminated_ts":    float(st.get("last_terminated_ts", 0) or 0),
                "was_admin_flagged":     bool(st.get("was_admin_flagged", False)),
                "had_session_terminate": True,
                "session_terminate_ts":  now,
            }
            _write(key, new_state, ttl=30 * 86400)
            return {
                "had_session_terminate":    True,
                "was_already_session_term": False,
            }
    except Exception as exc:
        _log.warning("cooldown.mark_session_terminate failed for %s: %s", key, exc)
        return {
            "had_session_terminate":    True,
            "was_already_session_term": False,
        }


def activate(key: str, *, now: Optional[float] = None) -> dict:
    """Trigger a termination + start a cool-down for *key*.

    Returns:
        {
          "cooldown_until_ts":      <epoch float>,
          "cooldown_index_used":    <int 0..len(ladder)-1>,
          "duration_s":             <int>,
          "lifetime_terminations":  <int>,
          "just_admin_flagged":     <bool>,
        }

    NEVER raises. On internal failure returns a safe default with
    duration_s=0 -- the caller will see a "no cool-down activated"
    result, which is the fail-open posture we want.
    """
    if now is None:
        now = time.time()
    try:
        with _LOCK:
            st = _read(key)
            ladder = _ladder()
            next_idx = int(st.get("next_cooldown_index", 0) or 0)
            used_idx = min(next_idx, len(ladder) - 1)
            duration = int(ladder[used_idx])
            until = now + duration

            lifetime = int(st.get("lifetime_terminations", 0) or 0) + 1
            was_flagged = bool(st.get("was_admin_flagged", False))
            just_flag = (not was_flagged) and (lifetime >= _admin_threshold())

            new_state = {
                "cooldown_until_ts":     until,
                "next_cooldown_index":   next_idx + 1,
                "lifetime_terminations": lifetime,
                "last_terminated_ts":    now,
                "was_admin_flagged":     was_flagged or just_flag,
                # Preserve the session-terminate flag (Phase D.5) so a
                # user who has already used their "soft" escalation
                # cannot get it back by triggering a cool-down.
                "had_session_terminate": bool(st.get("had_session_terminate", False)),
                "session_terminate_ts":  float(st.get("session_terminate_ts", 0) or 0),
            }
            # TTL: keep around for at least the cool-down + 30 days, so
            # a repeat offender is remembered when they come back later.
            ttl = max(duration + 30 * 86400, 30 * 86400)
            _write(key, new_state, ttl=ttl)

            return {
                "cooldown_until_ts":     until,
                "cooldown_index_used":   used_idx,
                "duration_s":            duration,
                "lifetime_terminations": lifetime,
                "just_admin_flagged":    just_flag,
            }
    except Exception as exc:
        _log.warning("cooldown.activate failed for %s: %s", key, exc)
        return {
            "cooldown_until_ts":     0.0,
            "cooldown_index_used":   0,
            "duration_s":            0,
            "lifetime_terminations": 0,
            "just_admin_flagged":    False,
        }


def reset(key: str) -> None:
    """Drop ALL state for *key* (test / admin helper). NEVER raises."""
    with _LOCK:
        _delete(key)


def reset_all_inmem() -> None:
    """Drop only the in-memory cache. Use in tests to avoid pollution
    between cases. Does NOT touch Redis (so prod data is never lost
    by accident)."""
    with _LOCK:
        _INMEM.clear()


def snapshot(key: str) -> dict:
    """Diagnostic-only view of one key's state."""
    try:
        return dict(_read(key))
    except Exception:
        return {}
