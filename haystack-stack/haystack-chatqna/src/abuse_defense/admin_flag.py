"""Admin-flag JSONL writer (Phase D).

When ``cooldown.activate()`` reports ``just_admin_flagged=True``, the
defender writes a single JSONL row here so a human admin can review
the user. This is a low-tech log file in Phase D; Phase E will add
the proper admin dashboard that consumes these rows.

Disk layout:
    var/abuse_defense/admin_flag_YYYY-MM-DD.jsonl

One JSON object per line:
    {
      "ts":       "2026-05-04T19:23:11.482Z",
      "key":      "<user_id or session_id>",
      "reason":   "lifetime_terminations_threshold",
      "extra":    { ... arbitrary call-site context ... }
    }

NEVER raises. Disk-full / permission errors are logged at WARNING and
swallowed -- the user never sees the abuse-defense system fall over
because of an admin notification problem.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import threading
from typing import Any


_log = logging.getLogger("amina.abuse_defense.admin_flag")
_WRITE_LOCK = threading.Lock()

# Disk layout. Defaults to the same var/abuse_defense/ folder as the
# shadow JSONL so all abuse-defense audit trails are co-located.
_DEFAULT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "var", "abuse_defense",
)
LOG_DIR = (
    os.environ.get("AMINA_ABUSE_ADMIN_FLAG_DIR")
    or os.environ.get("AMINA_ABUSE_SHADOW_DIR")        # tests share this
    or os.path.abspath(_DEFAULT_DIR)
)


def _today_path() -> str:
    name = "admin_flag_{date}.jsonl".format(
        date=_dt.datetime.utcnow().strftime("%Y-%m-%d")
    )
    return os.path.join(LOG_DIR, name)


def _ensure_dir() -> None:
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
    except OSError as exc:
        _log.warning("admin-flag log dir not writable (%s): %s", LOG_DIR, exc)


def flag(
    key: str,
    *,
    reason: str = "lifetime_terminations_threshold",
    **extra: Any,
) -> None:
    """Append one admin-flag row. NEVER raises."""
    try:
        rec = {
            "ts":     _dt.datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "key":    key,
            "reason": reason,
            "extra":  extra or {},
        }
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))

        path = _today_path()
        _ensure_dir()
        with _WRITE_LOCK:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line)
                fh.write("\n")
    except OSError as exc:
        _log.warning("admin_flag write failed (%s): %s", key, exc)
    except Exception as exc:  # pragma: no cover -- defence in depth
        _log.warning("admin_flag unexpected failure (%s): %s", key, exc)


def current_log_path() -> str:
    """Diagnostic helper -- return today's expected file path."""
    return _today_path()
