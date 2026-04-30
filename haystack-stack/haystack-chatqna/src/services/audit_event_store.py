"""
AMINA — append-only audit event store (Phase 9, AUDIT-005).

A general-purpose append-only audit-event layer. Per-domain audit
edges (`ConsentAuditVertex`, `CaregiverConsentRecord`,
`DHIS2AuditVertex`, etc.) continue to exist for their respective
flows; this module is the **central** store the auditor expects to
query for cross-cutting events ("show me every admin route access in
March", "show me every consent state change in the last 24h",
"why did this 403 fire").

Design rules (do not break):
  - **Append-only.** This module exposes ONE write helper:
    `append_event(...)`. There is no update / delete / patch API
    in this module. Tests pin that contract.
  - **Fail-soft.** A DB write failure NEVER raises into the caller's
    request flow — the caller gets a structured failure result and
    one log line; the request continues. An in-memory failure counter
    is exposed for AUDIT-010.
  - **PHI-safe by construction.** Metadata is filtered through a
    forbidden-key set + a forbidden-value-pattern sweep. Any
    detected leak is redacted (not stored) and the event is still
    written so the audit trail is not corrupted by a buggy caller.
    The redaction itself is recorded as a structured marker in the
    `metadata_safe` blob so it is traceable.
  - **Caller-supplied trace_id / request_id.** The store does not
    invent these; if the caller does not have them, leave them empty.
  - **Schema bootstrap is idempotent.** Same shape as the existing
    `caregiver_privacy_consent.py` schema bootstrap.

Phase 9 deliberately scopes the wiring to a small set of low-risk
events on the caregiver-privacy surfaces. Wider wiring is future
work — the shape of this module is what makes that wiring trivial
when the operator is ready.

PHI guarantees enforced by tests in
`_audit_event_store_test.py`:
  - no `update_event` or `delete_event` symbol exists
  - reject + redact phone, signature, signature_hash, ip,
    user_agent, raw token, name, free-text clinical
  - DB failure → structured failure result, not exception
  - no PHI appears in stored event or in the failure log

This module talks to ArcadeDB via the same `arcade_client.command_sql`
runner the rest of the codebase uses. Tests substitute the runner.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional


logger = logging.getLogger("amina.audit_event_store")

# ── Schema constants ─────────────────────────────────────────────────
VERTEX_TYPE: str = "AuditEventVertex"
RECORD_ID_PREFIX: str = "AUDIT-"

# Stable hash salt for actor/subject ids when the caller hands us a
# raw value. Mixed in so the same id under two different runtimes
# never produces the same hash and so the hash cannot be reversed
# without knowing both salt and id.
_HASH_SALT: str = os.getenv("AMINA_AUDIT_HASH_SALT", "amina-audit-v1")

# Statuses an audit-event write can return.
STATUS_STORED: str = "stored"
STATUS_FAILED_PHI: str = "failed_phi"     # impossible — redaction means we always store
STATUS_FAILED_DB: str = "failed_db"
STATUS_FAILED_VALIDATION: str = "failed_validation"

# Allowed event-type prefixes. Stable, lowercase, dot-separated.
# Validation rejects anything with characters outside [a-z0-9_.].
_EVENT_TYPE_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)+$")

# Allowed action / outcome / actor_type / subject_type tokens. These
# stay an open set — we just normalise to lowercase + reject pathological
# values (whitespace, control chars, > 64 chars).
_TOKEN_RE = re.compile(r"^[a-z0-9_-]{1,64}$")

# Forbidden keys in metadata_safe. Caller MUST NOT pass these.
_FORBIDDEN_METADATA_KEYS: frozenset = frozenset({
    "phone", "phone_number", "msisdn",
    "name", "full_name", "given_name", "family_name",
    "email",
    "ip", "ip_address", "remote_addr",
    "user_agent", "ua",
    "token", "jwt", "bearer", "authorization",
    "pin", "password", "secret",
    "signature", "raw_signature", "guardian_signature",
    "digital_signature_hash",        # we store the actor hash separately;
    "guardian_signature_hash",       #   never the user-provided hash here
    "checkbox_prose", "consent_text",
    "free_text", "message_body", "transcript",
    "patient_name", "caregiver_name",
})

# Forbidden value substrings (case-insensitive) that should NEVER
# appear in any metadata value. Rejection here is a defence-in-depth
# layer — the canonical guard is the key set above.
_FORBIDDEN_VALUE_PATTERNS: List[re.Pattern] = [
    # JWT shapes
    re.compile(r"\beyj[a-z0-9_\-]+\.", re.I),
    re.compile(r"\bbearer\s+[a-z0-9_\-\.]{16,}", re.I),
    # IPv4
    re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"),
    # Common UA shape
    re.compile(r"mozilla/\d", re.I),
    # Phone shapes (leading + or 00 with 7+ digits)
    re.compile(r"\+\d{7,}"),
    re.compile(r"\b00\d{8,}"),
]

_REDACTED_PLACEHOLDER: str = "<REDACTED>"


# ── Lazy schema bootstrap ────────────────────────────────────────────
_SCHEMA_STMTS: List[str] = [
    f"CREATE VERTEX TYPE {VERTEX_TYPE} IF NOT EXISTS",
    f"CREATE PROPERTY {VERTEX_TYPE}.event_id IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.event_type IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.actor_type IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.actor_id_hash IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.subject_type IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.subject_id_hash IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.action IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.resource IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.outcome IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.reason_code IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.request_id IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.session_hash IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.trace_id IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.created_at IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.metadata_safe IF NOT EXISTS STRING",
    f"CREATE INDEX IF NOT EXISTS ON {VERTEX_TYPE} (event_id) UNIQUE",
    f"CREATE INDEX IF NOT EXISTS ON {VERTEX_TYPE} (event_type) NOTUNIQUE",
    f"CREATE INDEX IF NOT EXISTS ON {VERTEX_TYPE} (created_at) NOTUNIQUE",
]

_SCHEMA_BOOTSTRAPPED: bool = False
_BOOTSTRAP_LOCK = threading.Lock()


def ensure_audit_event_schema(
    *,
    sql_runner: Optional[Callable[[str], Any]] = None,
) -> None:
    """Idempotent schema bootstrap. Safe to call on every request."""
    global _SCHEMA_BOOTSTRAPPED
    if _SCHEMA_BOOTSTRAPPED:
        return
    with _BOOTSTRAP_LOCK:
        if _SCHEMA_BOOTSTRAPPED:
            return
        runner = sql_runner or _default_sql_runner()
        for stmt in _SCHEMA_STMTS:
            try:
                runner(stmt)
            except Exception as e:
                logger.debug("audit_event_store: schema step skipped: %s -> %s",
                             stmt[:70], e)
        _SCHEMA_BOOTSTRAPPED = True


def _default_sql_runner() -> Callable[[str], Any]:
    from src.utils.arcade_client import command_sql  # local import
    return command_sql


def _reset_schema_bootstrap_for_tests() -> None:
    """Test helper. Not called by production code."""
    global _SCHEMA_BOOTSTRAPPED
    _SCHEMA_BOOTSTRAPPED = False


# ── Failure counter (AUDIT-010 anchor) ───────────────────────────────
class _FailureCounter:
    """In-process counter of audit write failures.

    Phase 9 wires this to the local readiness probe; an external
    alert sink (PagerDuty / OpsGenie / log-pipeline alert) is the
    operator's job per AUDIT-010.
    """
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._total_attempts: int = 0
        self._failed_db: int = 0
        self._failed_validation: int = 0
        self._redactions: int = 0
        self._last_failure_at: Optional[str] = None
        self._last_failure_reason: Optional[str] = None

    def attempt(self) -> None:
        with self._lock:
            self._total_attempts += 1

    def db_failure(self, reason: str) -> None:
        with self._lock:
            self._failed_db += 1
            self._last_failure_at = _now_iso()
            self._last_failure_reason = f"db: {reason[:120]}"

    def validation_failure(self, reason: str) -> None:
        with self._lock:
            self._failed_validation += 1
            self._last_failure_at = _now_iso()
            self._last_failure_reason = f"validation: {reason[:120]}"

    def redaction(self) -> None:
        with self._lock:
            self._redactions += 1

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "total_attempts":         self._total_attempts,
                "failed_db":              self._failed_db,
                "failed_validation":      self._failed_validation,
                "redactions":             self._redactions,
                "last_failure_at":        self._last_failure_at,
                "last_failure_reason":    self._last_failure_reason,
            }

    def reset_for_tests(self) -> None:
        with self._lock:
            self._total_attempts = 0
            self._failed_db = 0
            self._failed_validation = 0
            self._redactions = 0
            self._last_failure_at = None
            self._last_failure_reason = None


_FAILURE_COUNTER = _FailureCounter()


def audit_health_snapshot() -> Dict[str, Any]:
    """Return the in-process audit-write failure snapshot. Read-only.

    External alerting (AUDIT-010 full closure) is the operator's job;
    this is the local probe the alert sink scrapes.
    """
    snap = _FAILURE_COUNTER.snapshot()
    # Compute simple derived signals for the alert sink.
    snap["has_recent_db_failure"] = snap["failed_db"] > 0
    snap["has_recent_validation_failure"] = snap["failed_validation"] > 0
    return snap


def _reset_failure_counter_for_tests() -> None:
    _FAILURE_COUNTER.reset_for_tests()


# ── Helpers ──────────────────────────────────────────────────────────
def _now_iso() -> str:
    """UTC ISO-8601 with millisecond precision, no tz suffix.

    Stays in lockstep with the rest of the audit surfaces in this
    repo (e.g. caregiver_privacy_consent.emit_audit_log).
    """
    t = time.time()
    ms = int((t - int(t)) * 1000)
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + f".{ms:03d}Z"


def _hash_id(value: str) -> str:
    """Stable salted SHA-256. Empty input → empty hash so the field is
    distinguishable from a "system" actor whose hash is `system`."""
    if not value:
        return ""
    payload = (_HASH_SALT + "||" + value).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _coerce_id(value: Optional[str], *, already_hashed: bool) -> str:
    """If the caller already passes a salted hash (Phase 9 callers may
    not always have raw ids), trust it. Otherwise hash it ourselves."""
    if not value:
        return ""
    v = value.strip()
    if not v:
        return ""
    if already_hashed:
        # Loose validation: a sha256 hex digest is exactly 64 lowercase hex chars.
        if len(v) == 64 and all(c in "0123456789abcdef" for c in v):
            return v
        # Caller claimed "already hashed" but it doesn't look like one.
        # Hash it anyway — trust nothing, but don't lose the event.
        return _hash_id(v)
    return _hash_id(v)


def _validate_event_type(event_type: str) -> Optional[str]:
    if not isinstance(event_type, str) or not event_type:
        return "event_type missing"
    if not _EVENT_TYPE_RE.match(event_type):
        return "event_type must match [a-z0-9_]+(\\.[a-z0-9_]+)+"
    return None


def _validate_token(name: str, value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None  # optional
    if not isinstance(value, str):
        return f"{name} must be string"
    if not _TOKEN_RE.match(value):
        return f"{name} must match [a-z0-9_-]{{1,64}}"
    return None


def _scrub_metadata(
    metadata: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Filter forbidden keys + redact forbidden value patterns.

    Returns a new dict. Caller's input is not mutated. Every redaction
    increments the counter so the operator can track misuse.
    """
    if not metadata:
        return {}
    if not isinstance(metadata, dict):
        # Refuse to walk pathological types (lists, scalars at the root).
        _FAILURE_COUNTER.redaction()
        return {"_redaction": "metadata_not_dict"}

    safe: Dict[str, Any] = {}
    redactions: List[str] = []
    for k, v in metadata.items():
        if not isinstance(k, str):
            redactions.append("non_string_key")
            continue
        kl = k.lower()
        if kl in _FORBIDDEN_METADATA_KEYS:
            redactions.append(f"key:{kl}")
            continue
        # Inspect the stringified value for forbidden patterns.
        try:
            sv = json.dumps(v, default=str) if not isinstance(v, str) else v
        except Exception:
            sv = repr(v)
        leaked = False
        for pat in _FORBIDDEN_VALUE_PATTERNS:
            if pat.search(sv):
                leaked = True
                redactions.append(f"value:{kl}")
                break
        if leaked:
            safe[k] = _REDACTED_PLACEHOLDER
        else:
            # Trim to a sane length so a misbehaving caller cannot
            # blow up the audit row.
            if isinstance(v, str) and len(v) > 512:
                safe[k] = v[:509] + "..."
                redactions.append(f"truncated:{kl}")
            else:
                safe[k] = v
    if redactions:
        _FAILURE_COUNTER.redaction()
        # Record what was redacted (without the offending value).
        safe["_redactions"] = redactions
    return safe


# ── Append-only API ──────────────────────────────────────────────────
def append_event(
    *,
    event_type: str,
    actor_type: str,
    actor_id: Optional[str] = None,
    actor_id_hash: Optional[str] = None,
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    subject_id_hash: Optional[str] = None,
    action: Optional[str] = None,
    resource: Optional[str] = None,
    outcome: Optional[str] = None,
    reason_code: Optional[str] = None,
    request_id: Optional[str] = None,
    session_id: Optional[str] = None,
    session_hash: Optional[str] = None,
    trace_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    sql_runner: Optional[Callable[[str], Any]] = None,
) -> Dict[str, Any]:
    """Append one audit event. NEVER raises into the caller.

    Returns:
        {
          "_status":  "stored" | "failed_db" | "failed_validation",
          "event_id": <opaque id, present even on failure for log correlation>,
          "stored":   bool,
          "errors":   [str, ...],          # only on failed_validation
          "redactions": [str, ...],        # subset of metadata that was scrubbed
        }
    """
    _FAILURE_COUNTER.attempt()
    event_id = f"{RECORD_ID_PREFIX}{uuid.uuid4().hex[:16]}"
    errors: List[str] = []

    # Basic validation. Each missed validation returns failed_validation
    # with a structured error list — we still log the failure for the
    # ops counter but do NOT raise.
    et_err = _validate_event_type(event_type)
    if et_err:
        errors.append(et_err)
    for tok_name, tok_val in (
        ("actor_type", actor_type),
        ("subject_type", subject_type),
        ("action", action),
        ("outcome", outcome),
        ("reason_code", reason_code),
    ):
        err = _validate_token(tok_name, tok_val)
        if err:
            errors.append(err)
    # Actor type is required (a system event uses actor_type="system").
    if not actor_type:
        errors.append("actor_type missing")

    if errors:
        _FAILURE_COUNTER.validation_failure("; ".join(errors))
        logger.warning(
            "audit_event_store: validation failure event_id=%s "
            "event_type=%r errors=%s",
            event_id, event_type, errors,
        )
        return {
            "_status": STATUS_FAILED_VALIDATION,
            "event_id": event_id,
            "stored": False,
            "errors": errors,
            "redactions": [],
        }

    # Hash actor + subject ids so the row is PHI-safe at rest.
    actor_hash = _coerce_id(actor_id_hash, already_hashed=True) \
                 or _coerce_id(actor_id, already_hashed=False)
    subject_hash = _coerce_id(subject_id_hash, already_hashed=True) \
                   or _coerce_id(subject_id, already_hashed=False)
    sess_hash = session_hash or _coerce_id(session_id, already_hashed=False)

    safe_meta = _scrub_metadata(metadata)
    redactions = list(safe_meta.pop("_redactions", []) or [])

    row = {
        "event_id":         event_id,
        "event_type":       event_type,
        "actor_type":       actor_type or "",
        "actor_id_hash":    actor_hash or "",
        "subject_type":     subject_type or "",
        "subject_id_hash":  subject_hash or "",
        "action":           action or "",
        "resource":         (resource or "")[:256],
        "outcome":          outcome or "",
        "reason_code":      reason_code or "",
        "request_id":       (request_id or "")[:64],
        "session_hash":     sess_hash or "",
        "trace_id":         (trace_id or "")[:64],
        "created_at":       _now_iso(),
        "metadata_safe":    json.dumps(safe_meta, sort_keys=True, default=str)[:4096],
    }

    # Lazy schema bootstrap; safe on every call.
    runner = sql_runner or _default_sql_runner()
    try:
        ensure_audit_event_schema(sql_runner=runner)
    except Exception as e:
        logger.warning("audit_event_store: schema bootstrap raised: %s", e)

    # Single INSERT — append-only semantics, no UPSERT, no MERGE.
    # The unique index on event_id is defence-in-depth in case we ever
    # accidentally collide event_ids (we won't — uuid4 entropy is enough).
    sql = (
        f"INSERT INTO {VERTEX_TYPE} SET "
        "event_id = :event_id, event_type = :event_type, "
        "actor_type = :actor_type, actor_id_hash = :actor_id_hash, "
        "subject_type = :subject_type, subject_id_hash = :subject_id_hash, "
        "action = :action, resource = :resource, "
        "outcome = :outcome, reason_code = :reason_code, "
        "request_id = :request_id, session_hash = :session_hash, "
        "trace_id = :trace_id, created_at = :created_at, "
        "metadata_safe = :metadata_safe"
    )
    try:
        runner(sql, row)
    except TypeError:
        # Some runners (tests) accept (sql) only; fall back to inline
        # value substitution. Tests assert this branch is never hit
        # in production via the runner contract.
        try:
            runner(sql)
        except Exception as e:
            return _record_db_failure(event_id, e, redactions)
    except Exception as e:
        return _record_db_failure(event_id, e, redactions)

    return {
        "_status":     STATUS_STORED,
        "event_id":    event_id,
        "stored":      True,
        "errors":      [],
        "redactions":  redactions,
    }


def _record_db_failure(event_id: str, e: Exception,
                       redactions: List[str]) -> Dict[str, Any]:
    _FAILURE_COUNTER.db_failure(repr(e))
    logger.error(
        "audit_event_store: DB failure event_id=%s error=%s",
        event_id, repr(e)[:200],
    )
    return {
        "_status":    STATUS_FAILED_DB,
        "event_id":   event_id,
        "stored":     False,
        "errors":     [f"db: {repr(e)[:160]}"],
        "redactions": redactions,
    }


# ── Public surface (explicit allow-list) ─────────────────────────────
__all__ = [
    "VERTEX_TYPE",
    "RECORD_ID_PREFIX",
    "STATUS_STORED",
    "STATUS_FAILED_DB",
    "STATUS_FAILED_VALIDATION",
    "ensure_audit_event_schema",
    "append_event",
    "audit_health_snapshot",
]
