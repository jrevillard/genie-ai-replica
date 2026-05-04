"""Admin reporting + release helpers (Phase E).

Pure functions over the existing audit JSONL files and the cool-down
state store. NO FastAPI in here -- the route layer in
``src/api/abuse_admin_routes.py`` consumes these helpers and adds
admin authentication.

Read paths (no mutation):
    list_admin_flags(days_back=30)
    list_recent_classifications(limit=100, *, abuse_only=False, days_back=7)
    get_user_state(key)
    aggregate_stats(days_back=7)
    status_snapshot()

Write paths (mutate, audit-logged):
    release_user(key, *, admin_id, reason)

Conventions:
    * NEVER raise. On internal failure the helpers degrade to safe
      defaults (empty list, empty dict, False return). Admin tools
      should always be able to render *something* even when the
      underlying state is wedged.
    * Read paths only touch JSONL files via line-by-line iteration so
      a giant log doesn't load entirely into memory.
    * Mutation paths write to the audit log BEFORE clearing state, so
      a Redis flap that loses the clear still leaves a trail of who
      tried to release whom.
"""
from __future__ import annotations

import datetime as _dt
import glob
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from . import config, cooldown, state, audit, shadow, admin_flag


_log = logging.getLogger("amina.abuse_defense.admin_api")


# ── helpers ──────────────────────────────────────────────────────────

def _jsonl_dir() -> str:
    """Same directory used by shadow.py / admin_flag.py / audit.py."""
    return shadow.LOG_DIR


def _date_window_paths(prefix: str, days_back: int) -> List[str]:
    """Return absolute paths for ``<prefix>_YYYY-MM-DD.jsonl`` covering
    the last ``days_back`` days (inclusive of today). Missing files are
    skipped silently."""
    out: List[str] = []
    today = _dt.datetime.utcnow().date()
    for d in range(max(0, int(days_back)) + 1):
        day = today - _dt.timedelta(days=d)
        path = os.path.join(
            _jsonl_dir(),
            f"{prefix}_{day.strftime('%Y-%m-%d')}.jsonl",
        )
        if os.path.exists(path):
            out.append(path)
    return out


def _iter_jsonl(path: str):
    """Yield one record per non-empty line. Skips malformed rows with a
    WARNING log line; never raises on file IO."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line_no, raw in enumerate(fh, start=1):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    yield json.loads(raw)
                except json.JSONDecodeError as exc:
                    _log.warning("malformed JSONL at %s:%d: %s", path, line_no, exc)
                    continue
    except OSError as exc:
        _log.warning("could not read %s: %s", path, exc)


# ── Read API ────────────────────────────────────────────────────────

def status_snapshot() -> Dict[str, Any]:
    """Return current module configuration + ladder. Used by the
    /status admin endpoint so admin tools can render the active mode
    and tunables without round-tripping back to the env."""
    try:
        snap = {
            "enabled":           bool(config.ABUSE_DEFENSE_ENABLED),
            "mode":              str(config.ABUSE_DEFENSE_MODE or "off"),
            "cooldown_first_s":  int(config.ABUSE_COOLDOWN_FIRST  or 0),
            "cooldown_second_s": int(config.ABUSE_COOLDOWN_SECOND or 0),
            "cooldown_third_s":  int(config.ABUSE_COOLDOWN_THIRD  or 0),
            "cooldown_decay_s":  int(config.ABUSE_COOLDOWN_DECAY  or 0),
            "coercive_fast_track":   bool(config.ABUSE_COERCIVE_FAST_TRACK),
            "admin_flag_threshold":  int(config.ABUSE_ADMIN_FLAG_THRESHOLD or 0),
            "log_dir":           shadow.LOG_DIR,
        }
        return snap
    except Exception as exc:
        _log.warning("status_snapshot failed: %s", exc)
        return {"enabled": False, "mode": "off"}


def list_admin_flags(days_back: int = 30) -> List[Dict[str, Any]]:
    """Read all admin-flag rows over the last ``days_back`` days.
    Returns newest first. Each row is a dict shaped by admin_flag.flag().
    """
    try:
        rows: List[Dict[str, Any]] = []
        for path in _date_window_paths("admin_flag", days_back):
            for rec in _iter_jsonl(path):
                rows.append(rec)
        rows.sort(key=lambda r: r.get("ts", ""), reverse=True)
        return rows
    except Exception as exc:
        _log.warning("list_admin_flags failed: %s", exc)
        return []


def list_recent_classifications(
    limit: int = 100,
    *,
    abuse_only: bool = False,
    days_back: int = 7,
    category: Optional[str] = None,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Read the shadow JSONL backwards-in-time, returning at most
    ``limit`` recent rows. Filters: abuse_only, exact category, user_id,
    session_id. Newest first.
    """
    try:
        out: List[Dict[str, Any]] = []
        # Walk newest-day-first so we can short-circuit when limit is met.
        for path in _date_window_paths("shadow", days_back):
            day_rows: List[Dict[str, Any]] = []
            for rec in _iter_jsonl(path):
                day_rows.append(rec)
            # Within a single day, append in file order then reverse.
            day_rows.reverse()
            for rec in day_rows:
                if abuse_only and not rec.get("is_abuse"):
                    continue
                if category and rec.get("category") != category:
                    continue
                if user_id and rec.get("user_id") != user_id:
                    continue
                if session_id and rec.get("session_id") != session_id:
                    continue
                out.append(rec)
                if len(out) >= max(1, int(limit)):
                    return out
        return out
    except Exception as exc:
        _log.warning("list_recent_classifications failed: %s", exc)
        return []


def get_user_state(key: str) -> Dict[str, Any]:
    """Combined snapshot for one user/session key. Includes:
        cooldown record, current cooldown remaining, warning ladder
        snapshot for THIS key (if it doubles as a session_id), and
        recent admin-audit rows.
    """
    if not key:
        return {}
    try:
        cd = cooldown.snapshot(key) or {}
        remaining = cooldown.remaining_s(key)
        ladder = state.snapshot(key)  # only meaningful if key was a session_id

        # Recent admin actions touching this key (last 30 days).
        recent_actions: List[Dict[str, Any]] = []
        for path in _date_window_paths("admin_audit", 30):
            for rec in _iter_jsonl(path):
                if rec.get("key") == key:
                    recent_actions.append(rec)
        recent_actions.sort(key=lambda r: r.get("ts", ""), reverse=True)

        # Recent abuse-flag rows touching this key.
        recent_flags: List[Dict[str, Any]] = []
        for rec in list_admin_flags(days_back=90):
            if rec.get("key") == key:
                recent_flags.append(rec)

        return {
            "key":                   key,
            "cooldown_record":       cd,
            "cooldown_remaining_s":  remaining,
            "is_locked":             remaining > 0,
            "had_session_terminate": bool(cd.get("had_session_terminate", False)),
            "lifetime_terminations": int(cd.get("lifetime_terminations", 0) or 0),
            "warning_ladder":        ladder,
            "recent_admin_actions":  recent_actions[:50],
            "recent_admin_flags":    recent_flags[:50],
        }
    except Exception as exc:
        _log.warning("get_user_state(%s) failed: %s", key, exc)
        return {"key": key, "error": "snapshot_failed"}


def aggregate_stats(days_back: int = 7) -> Dict[str, Any]:
    """Roll up shadow JSONL rows over a window. Returns counts by
    category, severity, route, and abuse/distress/frustration flags.
    Always returns a well-formed dict (zero counts when no rows)."""
    try:
        by_cat:   Dict[str, int] = {}
        by_sev:   Dict[str, int] = {}
        by_route: Dict[str, int] = {}
        is_abuse_n      = 0
        is_distress_n   = 0
        is_frustration_n = 0
        total = 0

        for path in _date_window_paths("shadow", days_back):
            for rec in _iter_jsonl(path):
                total += 1
                c = rec.get("category") or "unknown"
                s = rec.get("severity") or "none"
                r = rec.get("route")    or "unknown"
                by_cat[c]   = by_cat.get(c, 0) + 1
                by_sev[s]   = by_sev.get(s, 0) + 1
                by_route[r] = by_route.get(r, 0) + 1
                if rec.get("is_abuse"):       is_abuse_n      += 1
                if rec.get("is_distress"):    is_distress_n   += 1
                if rec.get("is_frustration"): is_frustration_n += 1

        return {
            "days_back":         days_back,
            "total_messages":    total,
            "by_category":       dict(sorted(by_cat.items(), key=lambda kv: -kv[1])),
            "by_severity":       dict(sorted(by_sev.items(), key=lambda kv: -kv[1])),
            "by_route":          dict(sorted(by_route.items(), key=lambda kv: -kv[1])),
            "is_abuse_count":       is_abuse_n,
            "is_distress_count":    is_distress_n,
            "is_frustration_count": is_frustration_n,
        }
    except Exception as exc:
        _log.warning("aggregate_stats failed: %s", exc)
        return {
            "days_back":            days_back,
            "total_messages":       0,
            "by_category":          {},
            "by_severity":          {},
            "by_route":             {},
            "is_abuse_count":       0,
            "is_distress_count":    0,
            "is_frustration_count": 0,
        }


# ── Mutation API ────────────────────────────────────────────────────

def release_user(
    key: str,
    *,
    admin_id: str,
    reason: str,
    also_clear_session_terminate: bool = False,
) -> Dict[str, Any]:
    """Manually release a user from cool-down (and optionally also
    clear their had_session_terminate flag). NEVER raises.

    By default we keep `had_session_terminate=True` so a user who has
    been released early still gets cool-down (not session-terminate)
    on their next abuse-past-WARNING-3. Pass
    `also_clear_session_terminate=True` only when the admin explicitly
    wants to give the user a clean slate (rare).

    Always writes one audit row before mutating, so the log is
    authoritative even if the mutate fails.

    Returns:
        {
          "released":            <bool>,
          "had_cooldown":        <bool>,        # was the user actually locked?
          "cleared_session_terminate": <bool>,
          "snapshot_before":     <dict>,
          "snapshot_after":      <dict>,
        }
    """
    snap_before = cooldown.snapshot(key) or {}
    had_cooldown = cooldown.is_locked(key)

    # 1. Audit FIRST (so even a Redis flap on step 2 leaves a trail).
    audit.log_admin_action(
        "release_user",
        admin_id=admin_id,
        key=key,
        reason=reason or "",
        also_clear_session_terminate=bool(also_clear_session_terminate),
        snapshot_before=snap_before,
    )

    cleared_st = False
    try:
        if also_clear_session_terminate:
            # Full reset: drop the entire record. Rare path.
            cooldown.reset(key)
            cleared_st = bool(snap_before.get("had_session_terminate", False))
        else:
            # Soft release: clear the cool-down clock but preserve
            # had_session_terminate, lifetime_terminations,
            # next_cooldown_index, was_admin_flagged.
            new_state = {
                "cooldown_until_ts":     0.0,
                "next_cooldown_index":   int(snap_before.get("next_cooldown_index", 0) or 0),
                "lifetime_terminations": int(snap_before.get("lifetime_terminations", 0) or 0),
                "last_terminated_ts":    float(snap_before.get("last_terminated_ts", 0) or 0),
                "was_admin_flagged":     bool(snap_before.get("was_admin_flagged", False)),
                "had_session_terminate": bool(snap_before.get("had_session_terminate", False)),
                "session_terminate_ts":  float(snap_before.get("session_terminate_ts", 0) or 0),
            }
            cooldown._write(key, new_state, ttl=30 * 86400)

        # Also reset the warning ladder so a returning user starts
        # fresh -- the ladder is keyed on session_id but the admin may
        # be releasing a session_id-shaped key; cheap to attempt either way.
        try:
            state.reset(key)
        except Exception:
            pass

        snap_after = cooldown.snapshot(key) or {}
        return {
            "released":                  True,
            "had_cooldown":              had_cooldown,
            "cleared_session_terminate": cleared_st,
            "snapshot_before":           snap_before,
            "snapshot_after":            snap_after,
        }
    except Exception as exc:
        _log.warning("release_user(%s) failed: %s", key, exc)
        return {
            "released":                  False,
            "had_cooldown":              had_cooldown,
            "cleared_session_terminate": False,
            "snapshot_before":           snap_before,
            "snapshot_after":            cooldown.snapshot(key) or {},
            "error":                     "release_failed",
        }
