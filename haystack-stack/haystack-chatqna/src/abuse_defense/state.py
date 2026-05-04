"""Per-session warning ladder state machine (Phase C, Phase D refactor).

Originally in-memory. Reworked 2026-05-04 to be Redis-backed with an
in-memory fallback so the ladder survives across uvicorn workers.

THE BUG THIS FIXES (2026-05-04):
    haystack-chatqna boots with `uvicorn --workers 4`. With process-
    local in-memory state, each worker had its own _STATE dict, and a
    user's 4 abusive messages round-robined across workers — the
    ladder never accumulated past level 1 on any single worker. UNICC
    smoke surfaced this as "two consecutive abuses both returned
    WARNING_1 instead of WARNING_1 then WARNING_2".

    Fix: store the ladder in Redis (one key per session) so all
    workers share the same view. Same fail-open posture as cooldown.py:
    if Redis is unreachable, every helper degrades to the in-memory
    dict. Worst case during a Redis outage is per-worker partitioning
    again (same as before this refactor); never a 5xx, never silenced
    AMINA.

Levels:

    0 -- clean (default; no warning has ever been shown)
    1 -- WARNING_1 has been shown
    2 -- WARNING_2 has been shown
    3 -- WARNING_3 (pre-termination) has been shown
            -- in WARN mode this is the cap (no termination)
            -- in ENFORCE mode the next abuse triggers session_terminate
               (one-shot per user) or cool-down (subsequent cycles)

Decay:
    Every ``ABUSE_COOLDOWN_DECAY`` seconds elapsed since the last STEP
    drops the level by one. So a user at level 2 who stays clean for
    two decay windows (default 30 min) returns to level 0.

Stepping:
    A normal abuse hit bumps level by +1.
    A coercive abuse hit (with ``ABUSE_COERCIVE_FAST_TRACK=true``) bumps
    by +2 -- it skips one warning level.

This module is internally thread-safe via a single recursive lock.
NEVER raises -- on any internal error every public helper returns 0
(level) or no-ops, to fail safe (don't accidentally warn when state
is corrupt; let traffic through).
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Dict, Optional

from . import config


_log = logging.getLogger("amina.abuse_defense.state")

_LOCK: threading.RLock = threading.RLock()

# In-memory fallback. Keyed by Redis key shape so one read/write path.
_INMEM: Dict[str, dict] = {}

# Lazy Redis client — sticky None on first failure so subsequent calls
# don't keep retrying on a hot path.
_redis_client = None
_redis_failed: bool = False


def _get_redis():
    """Return a Redis client or None. Sticky failure once we've seen one."""
    global _redis_client, _redis_failed
    if _redis_failed:
        return None
    if _redis_client is not None:
        return _redis_client

    # Tests force in-memory by setting this env var.
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
            "Redis unavailable for warning-ladder state, using in-memory fallback: %s",
            exc,
        )
        _redis_failed = True
        return None


def _key(session_id: str) -> str:
    return f"abuse:state:{session_id}"


def _decay_seconds() -> int:
    return int(config.ABUSE_COOLDOWN_DECAY or 0)


def _max_level() -> int:
    return 3


# Per-session record schema (JSON-serialised in Redis):
#   level             int   0..3
#   last_step_ts      float epoch — last successful step()
#   last_activity_ts  float epoch — last classify call
#   violations        int   lifetime count for this session
#   last_categories   list  rolling tail of category strings


def _read(session_id: str) -> dict:
    """Read the state record. Returns {} on miss / on any error."""
    rkey = _key(session_id)
    try:
        r = _get_redis()
        if r is not None:
            try:
                raw = r.get(rkey)
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                _log.warning("redis read failed for %s: %s", session_id, exc)
                # Fall through to in-mem.
        return dict(_INMEM.get(rkey, {}))
    except Exception:
        return {}


def _write(session_id: str, data: dict, *, ttl_s: int = 24 * 3600) -> None:
    """Persist the state record. Best-effort; never raises."""
    rkey = _key(session_id)
    try:
        r = _get_redis()
        if r is not None:
            try:
                r.set(rkey, json.dumps(data), ex=max(60, int(ttl_s)))
                # Mirror to in-mem so reads stay fast and survive a flap.
                _INMEM[rkey] = dict(data)
                return
            except Exception as exc:
                _log.warning("redis write failed for %s: %s", session_id, exc)
        _INMEM[rkey] = dict(data)
    except Exception as exc:
        _log.warning("state._write unexpected failure for %s: %s", session_id, exc)


def _delete(session_id: str) -> None:
    rkey = _key(session_id)
    try:
        r = _get_redis()
        if r is not None:
            try:
                r.delete(rkey)
            except Exception as exc:
                _log.warning("redis delete failed for %s: %s", session_id, exc)
        _INMEM.pop(rkey, None)
    except Exception:
        pass


def _apply_decay(state: dict, now: float) -> dict:
    """Drop level by 1 per full decay window since ``last_step_ts``.
    Mutates ``state`` in place AND returns it. No-op while level==0
    or while less than one window has elapsed."""
    level = int(state.get("level", 0) or 0)
    if level <= 0:
        return state
    decay_s = _decay_seconds()
    if decay_s <= 0:
        return state
    last_step_ts = float(state.get("last_step_ts", 0) or 0)
    if last_step_ts <= 0:
        return state
    elapsed = now - last_step_ts
    if elapsed < decay_s:
        return state
    drops = int(elapsed // decay_s)
    new_level = max(0, level - drops)
    if new_level != level:
        state["level"] = new_level
        # Reset the step clock to NOW so subsequent decays are measured
        # from the most recent drop; this avoids burst-decaying multiple
        # levels at once when the user has actually been gone for hours.
        state["last_step_ts"] = now
    return state


# ── Public API ──────────────────────────────────────────────────────

def step(
    session_id: str,
    category: str,
    *,
    fast_track: bool = False,
    now: Optional[float] = None,
) -> int:
    """Bump the warning ladder for *session_id*; return the post-step level.

    ``fast_track=True`` bumps by +2 (coercive abuse). ``now`` is for tests."""
    if now is None:
        now = time.time()
    try:
        with _LOCK:
            state = _read(session_id)
            state = _apply_decay(state, now)
            level = int(state.get("level", 0) or 0)
            bump = 2 if fast_track else 1
            new_level = min(_max_level(), level + bump)

            cats = list(state.get("last_categories", []) or [])
            cats.append(category or "")
            if len(cats) > 10:
                cats = cats[-10:]

            new_state = {
                "level":            new_level,
                "last_step_ts":     now,
                "last_activity_ts": now,
                "violations":       int(state.get("violations", 0) or 0) + 1,
                "last_categories":  cats,
            }
            _write(session_id, new_state)
            return new_level
    except Exception:
        return 0


def touch(session_id: str, now: Optional[float] = None) -> int:
    """Mark a clean (or distress / frustration) message: apply decay,
    update last-activity, return current level."""
    if now is None:
        now = time.time()
    try:
        with _LOCK:
            state = _read(session_id)
            state = _apply_decay(state, now)
            state["last_activity_ts"] = now
            # Persist the (possibly decayed) state so the decay accumulates.
            if state:
                _write(session_id, state)
            return int(state.get("level", 0) or 0)
    except Exception:
        return 0


def current_level(session_id: str, now: Optional[float] = None) -> int:
    """Return the current level after applying decay. Read-only — does
    NOT persist the decayed state (intentional: avoids write amplification
    from passive level checks)."""
    if now is None:
        now = time.time()
    try:
        with _LOCK:
            state = _read(session_id)
            state = _apply_decay(state, now)
            return int(state.get("level", 0) or 0)
    except Exception:
        return 0


def reset(session_id: str) -> None:
    """Drop all state for *session_id*. Used on session_terminate /
    cooldown activate so the next session starts at level 0."""
    with _LOCK:
        _delete(session_id)


def reset_all() -> None:
    """Drop all per-session state (test helper). Only clears the
    in-memory fallback; does NOT bulk-delete Redis (could affect prod
    state). Tests should use distinct session_ids to avoid collision."""
    with _LOCK:
        _INMEM.clear()


def snapshot(session_id: str) -> dict:
    """Diagnostic-only view of one session's state. Same shape as the
    pre-refactor SessionState dataclass returned."""
    try:
        with _LOCK:
            s = _read(session_id)
            return {
                "level":             int(s.get("level", 0) or 0),
                "violations":        int(s.get("violations", 0) or 0),
                "last_step_ts":      float(s.get("last_step_ts", 0) or 0),
                "last_activity_ts":  float(s.get("last_activity_ts", 0) or 0),
                "last_categories":   list(s.get("last_categories", []) or []),
            }
    except Exception:
        return {
            "level":             0,
            "violations":        0,
            "last_step_ts":      0.0,
            "last_activity_ts":  0.0,
            "last_categories":   [],
        }
