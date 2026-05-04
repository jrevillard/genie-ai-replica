"""Abuse-defense configuration.

Phase A (today) reads only ABUSE_DEFENSE_ENABLED -- it gates whether
``classify()`` even bothers compiling its patterns. Later phases will
read the rest (cool-down windows, escalation thresholds, admin flag
threshold, etc.).

ABUSE_DEFENSE_MODE values (deployed progressively across phases):
    "off"     -- no detection at all (default for now)
    "shadow"  -- classify + log; no user-visible effect            (Phase B)
    "warn"    -- show warnings but don't terminate                 (Phase C)
    "enforce" -- full pipeline incl. termination + admin flag      (Phase D)
"""
from __future__ import annotations

import os


def _bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


# Master flag. Phase A keeps the classifier loadable but inert when
# this is false (returns CLEAN immediately so callers can wire it in
# defensively without behaviour change).
ABUSE_DEFENSE_ENABLED = _bool("AMINA_ABUSE_DEFENSE_ENABLED", True)

# Mode -- only used by later phases. Phase A ignores this.
ABUSE_DEFENSE_MODE = (os.environ.get("AMINA_ABUSE_DEFENSE_MODE") or "off").strip().lower()
if ABUSE_DEFENSE_MODE not in ("off", "shadow", "warn", "enforce"):
    ABUSE_DEFENSE_MODE = "off"


# ── Phase B+ tunables (here for completeness; Phase A doesn't use them) ──
# Cool-down ladder after termination (seconds).
ABUSE_COOLDOWN_FIRST  = int(os.environ.get("AMINA_ABUSE_COOLDOWN_FIRST",  "1800"))     # 30 min
ABUSE_COOLDOWN_SECOND = int(os.environ.get("AMINA_ABUSE_COOLDOWN_SECOND", "86400"))    # 24 h
ABUSE_COOLDOWN_THIRD  = int(os.environ.get("AMINA_ABUSE_COOLDOWN_THIRD",  "604800"))   # 7 days

# Step-down timer: N seconds clean -> drop one warning level.
ABUSE_COOLDOWN_DECAY  = int(os.environ.get("AMINA_ABUSE_COOLDOWN_DECAY",  "900"))      # 15 min

# Coercive abuse skips one warning level.
ABUSE_COERCIVE_FAST_TRACK = _bool("AMINA_ABUSE_COERCIVE_FAST_TRACK", True)

# Lifetime-terminations threshold for auto-flag to admin.
ABUSE_ADMIN_FLAG_THRESHOLD = int(os.environ.get("AMINA_ABUSE_ADMIN_FLAG_THRESHOLD", "3"))


def snapshot() -> dict:
    """For /security/status diagnostics in later phases."""
    return {
        "abuse_defense_enabled":     ABUSE_DEFENSE_ENABLED,
        "abuse_defense_mode":        ABUSE_DEFENSE_MODE,
        "cooldown_first_s":          ABUSE_COOLDOWN_FIRST,
        "cooldown_second_s":         ABUSE_COOLDOWN_SECOND,
        "cooldown_third_s":          ABUSE_COOLDOWN_THIRD,
        "cooldown_decay_s":          ABUSE_COOLDOWN_DECAY,
        "coercive_fast_track":       ABUSE_COERCIVE_FAST_TRACK,
        "admin_flag_threshold":      ABUSE_ADMIN_FLAG_THRESHOLD,
    }
