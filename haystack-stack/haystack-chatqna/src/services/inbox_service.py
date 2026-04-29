"""
AMINA Care — Per-Patient Inbox Service
=========================================
A single unified queue of things the patient needs to see outside the chat
stream: agent-generated PDFs, clinical alerts, email receipts, reminders,
caregiver pings, system notifications.

Storage
-------
ArcadeDB vertex `InboxItemVertex` (persistent, audit-safe — the project's
"no data deletion" rule is honoured: read-state flips a flag, never deletes).

Signed file URLs
----------------
When an inbox item carries an attachment (a PDF the agent generated, a
lab result, etc.) the `attachment_token` field stores an HMAC-signed,
TTL-capped token. Resolving that token hits `file_token_service.resolve()`
which returns bytes + mime-type without exposing absolute paths or requiring
the client to carry JWT across a browser "download as" action.

Schema
------
InboxItemVertex(
    inbox_id             STRING   (uuid4, primary)
    patient_id           STRING   (fk -> PatientVertex)
    kind                 STRING   ("pdf" | "alert" | "notification" |
                                    "report" | "reminder" | "caregiver_ping" |
                                    "email")
    title                STRING
    body                 STRING   (plain text, max 4k chars)
    severity             STRING   ("info" | "warning" | "emergency")
    source               STRING   ("agent" | "caregiver" | "system" |
                                    "nudge_scheduler" | "admin")
    source_id            STRING   (free-form, eg. consultation_id)
    attachment_token     STRING   (empty if no attachment)
    attachment_name      STRING   ("care-plan-2026-04-18.pdf")
    attachment_mime      STRING   ("application/pdf")
    attachment_size      INTEGER
    action_url           STRING   (deep link into the UI, optional)
    metadata             STRING   (JSON-encoded free-form dict)
    read                 BOOLEAN
    read_at              STRING
    created_at           STRING   (ISO 8601 UTC)
    expires_at           STRING   (optional — items past this are hidden,
                                    not deleted)
)

List endpoint returns items newest-first, optionally filtered by kind / read
state / severity. Counts are served separately so the bell badge does not
pull the full payload.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


# ── Constants ────────────────────────────────────────────────────────────────

KINDS = (
    "pdf", "alert", "notification", "report",
    "reminder", "caregiver_ping", "email",
)
SEVERITIES = ("info", "warning", "emergency")
SOURCES    = ("agent", "caregiver", "system", "nudge_scheduler", "admin")

MAX_BODY_CHARS = 4000
DEFAULT_TTL_DAYS = 60


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _iso_in(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat().replace("+00:00", "Z")


def _clip(s: Optional[str], n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else (s[: n - 1] + "…")


# ── Schema bootstrap ─────────────────────────────────────────────────────────

def ensure_inbox_schema() -> None:
    """Idempotent. Creates InboxItemVertex with all properties + indexes."""
    stmts = [
        "CREATE VERTEX TYPE InboxItemVertex IF NOT EXISTS",

        "CREATE PROPERTY InboxItemVertex.inbox_id IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.kind IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.title IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.body IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.severity IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.source IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.source_id IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.attachment_token IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.attachment_name IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.attachment_mime IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.attachment_size IF NOT EXISTS INTEGER",
        "CREATE PROPERTY InboxItemVertex.action_url IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.metadata IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.read IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY InboxItemVertex.read_at IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.created_at IF NOT EXISTS STRING",
        "CREATE PROPERTY InboxItemVertex.expires_at IF NOT EXISTS STRING",

        # Hot query: "give me this patient's inbox, newest first"
        "CREATE INDEX IF NOT EXISTS ON InboxItemVertex (patient_id) NOTUNIQUE",
        # For single-item lookups by id (mark-read, fetch one)
        "CREATE INDEX IF NOT EXISTS ON InboxItemVertex (inbox_id) UNIQUE",
    ]
    for s in stmts:
        try:
            command_sql(s)
        except Exception as e:
            # IF NOT EXISTS takes care of re-runs; everything else is info only.
            logger.debug(f"inbox schema step skipped: {s[:70]}… -> {e}")


# ── Create ───────────────────────────────────────────────────────────────────

def create_item(
    patient_id: str,
    *,
    kind: str,
    title: str,
    body: str = "",
    severity: str = "info",
    source: str = "system",
    source_id: str = "",
    attachment_token: str = "",
    attachment_name: str = "",
    attachment_mime: str = "",
    attachment_size: int = 0,
    action_url: str = "",
    metadata: Optional[Dict[str, Any]] = None,
    ttl_days: int = DEFAULT_TTL_DAYS,
) -> Dict[str, Any]:
    """
    Insert a new InboxItemVertex. Returns the stored record (dict).

    Callers should treat failures as non-fatal — an inbox push should never
    take down the calling code path. We still raise on explicit validation
    errors (unknown kind, missing patient_id) because those are bugs.
    """
    if not patient_id:
        raise ValueError("patient_id is required")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}, got {kind!r}")
    if severity not in SEVERITIES:
        raise ValueError(f"severity must be one of {SEVERITIES}, got {severity!r}")
    if source not in SOURCES:
        # Don't reject — just tag; we may want new sources later without a
        # code change. Log at info so we can spot typos.
        logger.info(f"inbox: unknown source {source!r} accepted for {patient_id}")

    record = {
        "inbox_id":         str(uuid.uuid4()),
        "patient_id":       patient_id,
        "kind":             kind,
        "title":            _clip(title, 200),
        "body":             _clip(body, MAX_BODY_CHARS),
        "severity":         severity,
        "source":           source,
        "source_id":        _clip(source_id, 200),
        "attachment_token": attachment_token or "",
        "attachment_name":  _clip(attachment_name, 200),
        "attachment_mime":  attachment_mime or "",
        "attachment_size":  int(attachment_size or 0),
        "action_url":       _clip(action_url, 500),
        "metadata":         json.dumps(metadata or {}, ensure_ascii=False),
        "read":             False,
        "read_at":          "",
        "created_at":       _now_iso(),
        "expires_at":       _iso_in(ttl_days) if ttl_days else "",
    }

    try:
        command_sql(
            "INSERT INTO InboxItemVertex CONTENT " + json.dumps(record),
        )
    except Exception as e:
        logger.error(f"inbox: insert failed for {patient_id}: {e}")
        raise

    return _record_to_public(record)


# ── Read ─────────────────────────────────────────────────────────────────────

def list_items(
    patient_id: str,
    *,
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
    kind: Optional[str] = None,
    include_expired: bool = False,
) -> List[Dict[str, Any]]:
    """Newest-first list, scoped to one patient."""
    if not patient_id:
        return []

    limit  = max(1, min(int(limit), 200))
    offset = max(0, int(offset))

    clauses = ["patient_id = :pid"]
    params: Dict[str, Any] = {"pid": patient_id}

    if unread_only:
        clauses.append("read = false")
    if kind:
        clauses.append("kind = :kind")
        params["kind"] = kind
    if not include_expired:
        # ISO 8601 compares lexicographically → safe for expiry filter.
        clauses.append("(expires_at = '' OR expires_at > :now)")
        params["now"] = _now_iso()

    sql = (
        "SELECT inbox_id, patient_id, kind, title, body, severity, "
        "source, source_id, attachment_token, attachment_name, "
        "attachment_mime, attachment_size, action_url, metadata, "
        "read, read_at, created_at, expires_at "
        "FROM InboxItemVertex "
        f"WHERE {' AND '.join(clauses)} "
        "ORDER BY created_at DESC "
        f"SKIP {offset} LIMIT {limit}"
    )

    try:
        resp = command_sql(sql, params)
    except Exception as e:
        logger.error(f"inbox: list failed for {patient_id}: {e}")
        return []

    rows = (resp or {}).get("result", []) or []
    return [_record_to_public(r) for r in rows]


def get_item(inbox_id: str, patient_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single item, scoped to patient (prevents IDOR)."""
    if not inbox_id or not patient_id:
        return None
    try:
        resp = command_sql(
            "SELECT inbox_id, patient_id, kind, title, body, severity, "
            "source, source_id, attachment_token, attachment_name, "
            "attachment_mime, attachment_size, action_url, metadata, "
            "read, read_at, created_at, expires_at "
            "FROM InboxItemVertex "
            "WHERE inbox_id = :iid AND patient_id = :pid LIMIT 1",
            {"iid": inbox_id, "pid": patient_id},
        )
        rows = (resp or {}).get("result", []) or []
        return _record_to_public(rows[0]) if rows else None
    except Exception as e:
        logger.error(f"inbox: get failed for {inbox_id}: {e}")
        return None


def unread_count(patient_id: str) -> int:
    """Cheap — just a COUNT(*). Safe on the hot polling path."""
    if not patient_id:
        return 0
    try:
        resp = command_sql(
            "SELECT count(*) AS n FROM InboxItemVertex "
            "WHERE patient_id = :pid AND read = false "
            "AND (expires_at = '' OR expires_at > :now)",
            {"pid": patient_id, "now": _now_iso()},
        )
        rows = (resp or {}).get("result", []) or []
        if not rows:
            return 0
        val = rows[0].get("n", 0)
        return int(val) if val is not None else 0
    except Exception as e:
        logger.error(f"inbox: unread_count failed for {patient_id}: {e}")
        return 0


# ── Update (read-state only; we never delete) ────────────────────────────────

def mark_read(inbox_id: str, patient_id: str) -> bool:
    if not inbox_id or not patient_id:
        return False
    try:
        command_sql(
            "UPDATE InboxItemVertex SET read = true, read_at = :t "
            "WHERE inbox_id = :iid AND patient_id = :pid",
            {"iid": inbox_id, "pid": patient_id, "t": _now_iso()},
        )
        return True
    except Exception as e:
        logger.error(f"inbox: mark_read failed for {inbox_id}: {e}")
        return False


def mark_all_read(patient_id: str) -> int:
    if not patient_id:
        return 0
    try:
        resp = command_sql(
            "UPDATE InboxItemVertex SET read = true, read_at = :t "
            "WHERE patient_id = :pid AND read = false",
            {"pid": patient_id, "t": _now_iso()},
        )
        # ArcadeDB UPDATE returns number of rows in result[0].count typically.
        rows = (resp or {}).get("result", []) or []
        if rows and isinstance(rows[0], dict):
            return int(rows[0].get("count", 0) or 0)
        return 0
    except Exception as e:
        logger.error(f"inbox: mark_all_read failed for {patient_id}: {e}")
        return 0


# ── Private: row reshape ─────────────────────────────────────────────────────

def _record_to_public(r: Dict[str, Any]) -> Dict[str, Any]:
    """Strip ArcadeDB internals and decode metadata JSON."""
    md_raw = r.get("metadata") or ""
    try:
        md = json.loads(md_raw) if md_raw else {}
    except Exception:
        md = {"_raw": md_raw}

    return {
        "inbox_id":         r.get("inbox_id") or "",
        "patient_id":       r.get("patient_id") or "",
        "kind":             r.get("kind") or "notification",
        "title":            r.get("title") or "",
        "body":             r.get("body") or "",
        "severity":         r.get("severity") or "info",
        "source":           r.get("source") or "system",
        "source_id":        r.get("source_id") or "",
        "attachment": {
            "token": r.get("attachment_token") or "",
            "name":  r.get("attachment_name") or "",
            "mime":  r.get("attachment_mime") or "",
            "size":  int(r.get("attachment_size") or 0),
        } if r.get("attachment_token") else None,
        "action_url":       r.get("action_url") or "",
        "metadata":         md,
        "read":             bool(r.get("read") or False),
        "read_at":          r.get("read_at") or "",
        "created_at":       r.get("created_at") or "",
        "expires_at":       r.get("expires_at") or "",
    }
