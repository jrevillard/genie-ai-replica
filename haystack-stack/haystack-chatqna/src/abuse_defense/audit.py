"""Admin-action audit log (Phase E).

Every mutation an admin performs against abuse-defense state lands here
as a JSONL row, so we always know who released whom and when. This is
the authoritative audit trail for the manual-release path; Phase E.1
will surface it as part of the admin dashboard.

Disk layout:
    var/abuse_defense/admin_audit_YYYY-MM-DD.jsonl

One JSON object per line:
    {
      "ts":         "2026-05-04T19:23:11.482Z",
      "admin_id":   "<admin_username>",
      "action":     "release_user" | "...",
      "key":        "<user_id or session_id>",
      "reason":     "<free text>",
      "extra":      { ... arbitrary call-site context ... }
    }

NEVER raises. Disk-full / permission errors are logged at WARNING and
swallowed -- a broken audit log must NOT prevent admins from doing
their jobs (the action itself is logged at INFO via the calling
module too, so we still have a fall-back trail in container logs).
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import threading
from typing import Any


_log = logging.getLogger("amina.abuse_defense.audit")
_WRITE_LOCK = threading.Lock()

# Disk layout. Co-located with shadow + admin-flag JSONLs so all
# abuse-defense audit trails live under one folder.
_DEFAULT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "var", "abuse_defense",
)
LOG_DIR = (
    os.environ.get("AMINA_ABUSE_AUDIT_DIR")
    or os.environ.get("AMINA_ABUSE_SHADOW_DIR")
    or os.path.abspath(_DEFAULT_DIR)
)


def _today_path() -> str:
    name = "admin_audit_{date}.jsonl".format(
        date=_dt.datetime.utcnow().strftime("%Y-%m-%d")
    )
    return os.path.join(LOG_DIR, name)


def _ensure_dir() -> None:
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
    except OSError as exc:
        _log.warning("admin-audit log dir not writable (%s): %s", LOG_DIR, exc)


def log_admin_action(
    action: str,
    *,
    admin_id: str,
    key: str,
    reason: str = "",
    **extra: Any,
) -> None:
    """Append one admin-audit row. NEVER raises."""
    try:
        rec = {
            "ts":       _dt.datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "admin_id": admin_id,
            "action":   action,
            "key":      key,
            "reason":   reason or "",
            "extra":    extra or {},
        }
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        path = _today_path()
        _ensure_dir()
        with _WRITE_LOCK:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line)
                fh.write("\n")
    except OSError as exc:
        _log.warning("admin_audit write failed (admin=%s action=%s): %s",
                     admin_id, action, exc)
    except Exception as exc:  # pragma: no cover -- defence in depth
        _log.warning("admin_audit unexpected failure: %s", exc)


def current_log_path() -> str:
    """Diagnostic helper -- return today's expected file path."""
    return _today_path()
