"""Shadow-mode logger for the abuse-defense classifier (Phase B).

Wraps ``classifier.classify()`` with a JSONL audit log so we can run
the classifier on real traffic WITHOUT changing any user-visible
behaviour. This is the lowest-risk way to verify the false-positive
rate on Group B (health frustration) and Group C (distress) holds at
0% on real Gambian traffic before any warning is shown.

Design contract -- do NOT change without a safety review:

    1. **Zero behaviour change.** ``log_message()`` MUST NEVER raise.
       Any internal failure (classifier crash, disk-full, JSON encode
       error) is caught and logged at WARNING; the caller is unaware.

    2. **Mode gate.** Reads ``config.ABUSE_DEFENSE_MODE`` at every call
       (NOT at import). Modes:
           "off"     -> short-circuit immediately, no classify, no IO
           "shadow"  -> classify + JSONL append, NO user-visible action
           "warn"    -> Phase C will additionally surface a warning
           "enforce" -> Phase D will additionally terminate
       Phase B implements only the first two; the latter two are
       intentionally no-ops in this module so Phase C+ can layer on
       without changing the shadow contract.

    3. **No DB writes.** JSONL on disk only. Phase D introduces the
       proper hash-chained audit vertex; until then the JSONL is the
       authoritative shadow record.

    4. **Distress is still routed first.** Even in shadow mode the
       classifier returns ``CAT_DISTRESS`` -- callers MAY (and should)
       choose to act on that signal even while abuse handling stays
       inert. We do NOT enforce this here -- the route handler decides.

    5. **PII boundary.** We log a SHA-256 prefix of the message text,
       NEVER the raw text. The first 32 bytes of the digest are enough
       to spot duplicate triggers without storing user content.

Disk layout:
    var/abuse_defense/shadow_YYYY-MM-DD.jsonl

One JSON object per line:
    {
      "ts":        "2026-05-04T19:23:11.482Z",
      "route":     "/api/v1/chat",
      "session_id": "...",
      "user_id":   "...",
      "category":  "directed_abuse",
      "severity":  "high",
      "is_abuse":  true,
      "is_distress": false,
      "is_frustration": false,
      "matched":   ["insult_at_ai"],
      "len":       42,
      "msg_sha":   "a1b2c3d4...",
      "lat_ms":    0.34,
      "extra":     { ... arbitrary call-site context ... }
    }
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import logging
import os
import threading
import time
from typing import Any, Optional

from . import config
from .classifier import classify, Classification


_log = logging.getLogger("amina.abuse_defense.shadow")

# JSONL writes are serialised through a single lock so concurrent
# uvicorn workers / asyncio tasks never interleave bytes mid-line.
_WRITE_LOCK = threading.Lock()

# Disk layout. We default under haystack-chatqna/var/ so the file is
# colocated with other operational logs and not inside src/.
_DEFAULT_LOG_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "var", "abuse_defense",
)
LOG_DIR = os.environ.get("AMINA_ABUSE_SHADOW_DIR") or os.path.abspath(_DEFAULT_LOG_DIR)


def _today_path() -> str:
    name = "shadow_{date}.jsonl".format(
        date=_dt.datetime.utcnow().strftime("%Y-%m-%d")
    )
    return os.path.join(LOG_DIR, name)


def _ensure_dir() -> None:
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
    except OSError as exc:
        # Disk full / permission issue -- log once at WARNING, swallow.
        _log.warning("shadow log dir not writable (%s): %s", LOG_DIR, exc)


def _msg_digest(text: str) -> str:
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()[:32]


def _serialize(
    classification: Classification,
    *,
    route: str,
    text: str,
    session_id: Optional[str],
    user_id: Optional[str],
    extra: dict,
) -> str:
    record = {
        "ts":             _dt.datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
        "route":          route,
        "session_id":     session_id,
        "user_id":        user_id,
        "category":       classification.category,
        "severity":       classification.severity,
        "is_abuse":       classification.is_abuse,
        "is_distress":    classification.is_distress,
        "is_frustration": classification.is_frustration,
        "matched":        list(classification.matched_patterns or []),
        "len":            len(text or ""),
        "msg_sha":        _msg_digest(text or ""),
        "lat_ms":         round(classification.latency_ms, 3),
        "extra":          extra or {},
    }
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"))


def _append_line(line: str) -> None:
    """Append one JSONL line. Best-effort; never raises."""
    path = _today_path()
    try:
        _ensure_dir()
        with _WRITE_LOCK:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line)
                fh.write("\n")
    except OSError as exc:
        _log.warning("shadow log write failed (%s): %s", path, exc)
    except Exception as exc:  # pragma: no cover - defence in depth
        _log.warning("shadow log unexpected failure: %s", exc)


# ── Public API ──────────────────────────────────────────────────────

def log_message(
    text: str,
    *,
    route: str,
    session_id: Optional[str] = None,
    user_id: Optional[str]    = None,
    **extra: Any,
) -> Optional[Classification]:
    """Run the classifier on *text* in shadow mode and append a JSONL row.

    Returns the ``Classification`` so callers can choose to act on
    distress signals (DISTRESS is the only category the route handler
    SHOULD act on in Phase B; abuse signals stay inert until Phase C+).

    Returns ``None`` when the module is disabled or in "off" mode.

    NEVER raises. Any internal failure is logged and swallowed.
    """
    t0 = time.perf_counter()
    try:
        if not config.ABUSE_DEFENSE_ENABLED:
            return None

        mode = (config.ABUSE_DEFENSE_MODE or "off").strip().lower()
        if mode == "off":
            return None

        if not isinstance(text, str):
            text = str(text or "")

        classification = classify(text)

        # Modes "shadow" / "warn" / "enforce" all log the same JSONL row;
        # the difference is what later phases DO with the result. In
        # Phase B we only ship the "shadow" path -- but we never refuse
        # to log just because the mode advanced past us, so a later
        # Phase C/D test run still produces audit data.
        line = _serialize(
            classification,
            route=route,
            text=text,
            session_id=session_id,
            user_id=user_id,
            extra=extra,
        )
        _append_line(line)
        return classification

    except Exception as exc:
        _log.warning(
            "shadow log_message failed (route=%s): %s",
            route, exc, exc_info=False,
        )
        return None
    finally:
        # Cheap guard: if the call took absurdly long, surface a warning
        # so we know to investigate. The Phase B SLA is <2ms.
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if elapsed_ms > 5.0:
            _log.warning(
                "shadow log_message exceeded budget: %.2f ms (route=%s)",
                elapsed_ms, route,
            )


def is_active() -> bool:
    """True iff shadow logging is currently enabled. Useful so callers
    can skip building the ``extra`` dict when the module is off."""
    if not config.ABUSE_DEFENSE_ENABLED:
        return False
    mode = (config.ABUSE_DEFENSE_MODE or "off").strip().lower()
    return mode in ("shadow", "warn", "enforce")


def current_log_path() -> str:
    """Return the JSONL path that today's writes go to. Diagnostic only."""
    return _today_path()
