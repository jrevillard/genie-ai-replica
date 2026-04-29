"""
Caregiver Privacy Consent — Phase 2 backend service.

Stores caregiver acceptance of the privacy notice + responsibility
agreement defined in the frontend at:
    components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js

Phase 2 deliberate non-goals:
  - Does NOT modify the caregiver registration endpoint (Phase 4 will
    wire the wizard to this service).
  - Does NOT auto-block any route by default. The gate dependency is
    flag-gated by AMINA_CAREGIVER_PRIVACY_REQUIRED (default False).
  - Does NOT build the full append-only audit-event store
    (compliance control AUDIT-005 — separate phase).
  - Does NOT support deletion or update — records are immutable; new
    consent versions write new rows.

Schema (all NEW types, additive):

  CaregiverConsentRecord(
      record_id              STRING (UNIQUE) -- "CGCONSENT-{uuid}"
      caregiver_id           STRING (NOTUNIQUE)
      consent_type           STRING -- "caregiver_privacy_notice"
      policy_version         STRING -- e.g. "1.0"
      notice_version         STRING -- alias of policy_version (kept for forward-compat)
      role                   STRING -- vhw|cbc|chn|tba|family|scout|alkalo
      checkboxes_accepted    BOOLEAN -- true iff all required boxes ticked
      checkbox_count         INTEGER -- number of boxes ticked
      digital_signature_hash STRING -- sha256(signature || caregiver_id)
      guardian_consent       BOOLEAN -- only for under-18 scout flow
      guardian_signature_hash STRING -- sha256(guardian_signature || caregiver_id)
      mandinka_viewed        BOOLEAN
      scroll_completed       BOOLEAN
      method                 STRING -- "app" | "sms" | "voice" | "operator"
      accepted_at            STRING (ISO 8601 UTC) -- client-supplied
      created_at             STRING (ISO 8601 UTC) -- server-set on insert
  )

  HasConsent: edge from CaregiverVertex -> CaregiverConsentRecord.

Privacy posture (per Phase 2 decisions):
  - We do NOT store raw signature, raw guardian name, IP, user-agent,
    phone, or checkbox prose. We store a salted SHA-256 of the
    signature so the user can prove they signed (by re-typing the
    same name) without exposing the name in the database.
  - We do NOT log raw any of the above either; the audit log includes
    only the seven safe fields enumerated in `_AUDIT_SAFE_KEYS`.

Idempotency:
  Re-submitting the same consent (same caregiver_id, same notice
  version, same signature hash) returns the existing record with
  status="already_accepted". A new version OR a different signature
  creates a new record.
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── Public constants ─────────────────────────────────────────────────
#
# Source of truth for the version on the BACKEND side. Must match the
# frontend `CAREGIVER_PRIVACY_NOTICE_VERSION` constant exported from
# components/frontend/src/content/CAREGIVER_PRIVACY_NOTICE.js. A
# mismatch on incoming payload returns HTTP 400 (handled in the route
# layer).
#
# TODO: Automate version sync check in CI (compare this constant with
#       the frontend export at build time).
CAREGIVER_PRIVACY_NOTICE_VERSION: str = "1.0"

# The 5 checkbox ids the wizard sends. Must match the frontend
# `CAREGIVER_PRIVACY_NOTICE.consent_checkboxes` order. Validation
# allows them in any order but requires all 5 to be present and true.
EXPECTED_CHECKBOX_IDS: Tuple[str, ...] = (
    "understand_confidential",
    "accept_responsibility",
    "understand_consequences",
    "agree_delete_on_removal",
    "acknowledge_audit",
)
EXPECTED_CHECKBOX_COUNT: int = len(EXPECTED_CHECKBOX_IDS)

# Vertex / edge type names. Stable -- referenced by tests.
CONSENT_TYPE: str = "caregiver_privacy_notice"
VERTEX_TYPE: str = "CaregiverConsentRecord"
EDGE_TYPE: str = "HasConsent"

# Salt for signature hashing. Treated as static -- the goal is
# prove-by-re-type, not cryptographic secrecy of the name itself.
# The caregiver_id is mixed in so the same name signed by two
# different caregivers produces different hashes (preventing
# cross-caregiver signature replay).
_SIG_HASH_SALT: str = "amina-caregiver-privacy-notice-v1-salt"


# ── Feature flag (env-driven, safe defaults) ─────────────────────────
#
# When False (default), the gate dependency is a no-op pass-through.
# The consent submission endpoint still works; consent records are
# stored if sent. Nothing user-visible changes.
#
# When True, the gate dependency raises 403 with code "consent_required"
# on patient-data caregiver routes for caregivers who have not yet
# accepted the current notice version. Patient chat, admin auth, and
# non-caregiver flows are unaffected.
def _parse_bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


AMINA_CAREGIVER_PRIVACY_REQUIRED: bool = _parse_bool_env(
    "AMINA_CAREGIVER_PRIVACY_REQUIRED", default=False,
)


# ── Helpers ──────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _short_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(8)}"


def hash_signature(signature: str, caregiver_id: str) -> str:
    """
    SHA-256 of (salt || caregiver_id || signature). Stable for a given
    triple. Used so the database stores no raw signature text but the
    user can still prove they signed by re-typing the same name later.
    """
    if not signature or not caregiver_id:
        return ""
    payload = f"{_SIG_HASH_SALT}|{caregiver_id}|{signature.strip()}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# ── Validation (pure; no I/O) ────────────────────────────────────────
#
# Returns a list of stable error codes (strings). Empty list = valid.
# The route layer maps these to HTTP 400 with the codes inlined so the
# frontend can show field-specific messages without parsing English.
def validate_consent_payload(
    payload: Dict[str, Any],
    *,
    role: Optional[str] = None,
    expected_signature_subject: Optional[str] = None,
) -> List[str]:
    errors: List[str] = []

    if not isinstance(payload, dict):
        return ["payload_not_object"]

    # Version match -- reject anything other than the current backend version.
    notice_version = (
        payload.get("notice_version")
        or payload.get("policy_version")
        or payload.get("privacy_notice_version")
        or ""
    )
    if not notice_version:
        errors.append("notice_version_missing")
    elif notice_version != CAREGIVER_PRIVACY_NOTICE_VERSION:
        errors.append("notice_version_mismatch")

    # Checkboxes -- accept either {id: bool} dict or list of ids.
    checkboxes_raw = payload.get("consent_checkboxes") or payload.get("checkboxes") or {}
    accepted_ids = _normalise_checkbox_ids(checkboxes_raw)
    missing = [cid for cid in EXPECTED_CHECKBOX_IDS if cid not in accepted_ids]
    if missing:
        errors.append("checkboxes_incomplete")

    # Digital signature -- non-empty string. Optional name match (the
    # route layer passes the auth name when available).
    signature = (payload.get("digital_signature") or "").strip()
    if not signature:
        errors.append("digital_signature_missing")
    elif expected_signature_subject and \
         signature.lower() != expected_signature_subject.strip().lower():
        errors.append("digital_signature_name_mismatch")

    # Timestamp -- must be ISO-8601-ish. We don't enforce drift; just
    # parse-ability.
    ts = payload.get("consent_timestamp") or payload.get("accepted_at") or ""
    if not ts:
        errors.append("consent_timestamp_missing")
    else:
        try:
            datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            errors.append("consent_timestamp_invalid")

    # Role -- if supplied at the call site, sanity-check.
    if role and role not in {
        "vhw", "cbc", "chn", "tba", "family", "scout", "alkalo",
    }:
        errors.append("role_unrecognised")

    # Scout-specific guardian fields -- required when role=scout AND
    # the wizard reports the user is under 18.
    if role == "scout" and payload.get("requires_guardian_consent") is True:
        if not payload.get("guardian_consent"):
            errors.append("guardian_consent_missing")
        if not (payload.get("guardian_signature") or "").strip():
            errors.append("guardian_signature_missing")

    return errors


def _normalise_checkbox_ids(raw: Any) -> List[str]:
    """Accept dict[id->bool] or list[id]. Returns the list of ids
    that are explicitly true (or simply present, for the list form)."""
    if isinstance(raw, dict):
        return [k for k, v in raw.items() if v is True]
    if isinstance(raw, list):
        return [str(x) for x in raw if x]
    return []


# ── Schema bootstrap (idempotent, lazy) ──────────────────────────────
_SCHEMA_BOOTSTRAPPED: bool = False

_SCHEMA_STMTS: Tuple[str, ...] = (
    f"CREATE VERTEX TYPE {VERTEX_TYPE} IF NOT EXISTS",
    f"CREATE PROPERTY {VERTEX_TYPE}.record_id IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.caregiver_id IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.consent_type IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.policy_version IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.notice_version IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.role IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.checkboxes_accepted IF NOT EXISTS BOOLEAN",
    f"CREATE PROPERTY {VERTEX_TYPE}.checkbox_count IF NOT EXISTS INTEGER",
    f"CREATE PROPERTY {VERTEX_TYPE}.digital_signature_hash IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.guardian_consent IF NOT EXISTS BOOLEAN",
    f"CREATE PROPERTY {VERTEX_TYPE}.guardian_signature_hash IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.mandinka_viewed IF NOT EXISTS BOOLEAN",
    f"CREATE PROPERTY {VERTEX_TYPE}.scroll_completed IF NOT EXISTS BOOLEAN",
    f"CREATE PROPERTY {VERTEX_TYPE}.method IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.accepted_at IF NOT EXISTS STRING",
    f"CREATE PROPERTY {VERTEX_TYPE}.created_at IF NOT EXISTS STRING",
    f"CREATE INDEX IF NOT EXISTS ON {VERTEX_TYPE} (record_id) UNIQUE",
    f"CREATE INDEX IF NOT EXISTS ON {VERTEX_TYPE} (caregiver_id) NOTUNIQUE",
    f"CREATE INDEX IF NOT EXISTS ON {VERTEX_TYPE} (notice_version) NOTUNIQUE",

    f"CREATE EDGE TYPE {EDGE_TYPE} IF NOT EXISTS",
)


def ensure_caregiver_privacy_schema(
    *,
    sql_runner: Optional[Callable[[str], Any]] = None,
) -> None:
    """
    Idempotent schema bootstrap. Safe to call from every worker on
    every request. Lazily called by record_consent / find_consent on
    first use; can also be called from a startup hook.

    The optional sql_runner kwarg lets tests inject a mock without
    monkey-patching the module.
    """
    global _SCHEMA_BOOTSTRAPPED
    if _SCHEMA_BOOTSTRAPPED:
        return
    runner = sql_runner or _default_sql_runner()
    for stmt in _SCHEMA_STMTS:
        try:
            runner(stmt)
        except Exception as e:
            # IF NOT EXISTS handles re-runs; debug-log and continue.
            logger.debug("caregiver privacy schema step skipped: %s -> %s",
                         stmt[:70], e)
    _SCHEMA_BOOTSTRAPPED = True
    logger.info(
        "caregiver_privacy_consent: schema bootstrapped "
        "(%s + %s)", VERTEX_TYPE, EDGE_TYPE,
    )


def _default_sql_runner() -> Callable[[str], Any]:
    """Returns the production SQL runner. Imported lazily so the module
    can be imported without ArcadeDB available (useful for tests)."""
    from src.utils.arcade_client import command_sql  # local import
    return command_sql


def _reset_schema_bootstrap_for_tests() -> None:
    """Test helper. Not called by production code."""
    global _SCHEMA_BOOTSTRAPPED
    _SCHEMA_BOOTSTRAPPED = False


# ── Storage (idempotent insert) ──────────────────────────────────────
def _rows(resp: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not resp:
        return []
    r = resp.get("result")
    if isinstance(r, list):
        return r
    return []


def find_consent_by_signature(
    *,
    caregiver_id: str,
    notice_version: str,
    signature_hash: str,
    sql_runner: Optional[Callable[..., Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Look up an existing consent record matching the (caregiver,
    notice_version, signature_hash) triple. Returns the row or None.
    """
    if not (caregiver_id and notice_version and signature_hash):
        return None
    runner = sql_runner or _default_sql_runner()
    try:
        resp = runner(
            f"SELECT FROM {VERTEX_TYPE} "
            "WHERE caregiver_id = :cg AND notice_version = :nv "
            "AND digital_signature_hash = :sh LIMIT 1",
            {"cg": caregiver_id, "nv": notice_version, "sh": signature_hash},
        )
    except Exception as e:
        logger.debug("find_consent_by_signature: %s", e)
        return None
    rows = _rows(resp)
    return rows[0] if rows else None


def find_current_consent(
    caregiver_id: str,
    *,
    sql_runner: Optional[Callable[..., Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Latest consent row for this caregiver matching the CURRENT notice
    version. Returns None if the caregiver has never accepted, or has
    only accepted earlier versions.
    """
    if not caregiver_id:
        return None
    runner = sql_runner or _default_sql_runner()
    try:
        resp = runner(
            f"SELECT FROM {VERTEX_TYPE} "
            "WHERE caregiver_id = :cg AND notice_version = :nv "
            "ORDER BY created_at DESC LIMIT 1",
            {"cg": caregiver_id, "nv": CAREGIVER_PRIVACY_NOTICE_VERSION},
        )
    except Exception as e:
        logger.debug("find_current_consent: %s", e)
        return None
    rows = _rows(resp)
    return rows[0] if rows else None


def has_current_consent(
    caregiver_id: str,
    *,
    sql_runner: Optional[Callable[..., Any]] = None,
) -> bool:
    return find_current_consent(caregiver_id, sql_runner=sql_runner) is not None


def record_consent(
    *,
    caregiver_id: str,
    role: str,
    payload: Dict[str, Any],
    method: str = "app",
    sql_runner: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """
    Idempotent consent insert. Returns:
        {"_status": "accepted" | "already_accepted",
         ...row fields...}

    Raises ValueError on missing caregiver_id (programmer error). The
    route layer is expected to validate the payload first; this
    function trusts its inputs and just persists them.
    """
    if not caregiver_id:
        raise ValueError("caregiver_id required")
    if not role:
        raise ValueError("role required")

    runner = sql_runner or _default_sql_runner()
    ensure_caregiver_privacy_schema(sql_runner=runner)

    notice_version = (
        payload.get("notice_version")
        or payload.get("policy_version")
        or payload.get("privacy_notice_version")
        or CAREGIVER_PRIVACY_NOTICE_VERSION
    )
    accepted_at = (
        payload.get("consent_timestamp")
        or payload.get("accepted_at")
        or _now_iso()
    )

    signature = (payload.get("digital_signature") or "").strip()
    sig_hash = hash_signature(signature, caregiver_id)

    guardian_signature = (payload.get("guardian_signature") or "").strip()
    guardian_consent = bool(payload.get("guardian_consent"))
    guardian_sig_hash = (
        hash_signature(guardian_signature, caregiver_id)
        if guardian_signature else ""
    )

    accepted_ids = _normalise_checkbox_ids(
        payload.get("consent_checkboxes") or payload.get("checkboxes") or {}
    )
    checkbox_count = sum(1 for cid in EXPECTED_CHECKBOX_IDS if cid in accepted_ids)
    checkboxes_accepted = checkbox_count == EXPECTED_CHECKBOX_COUNT

    # Idempotency: if (caregiver, version, sig_hash) already exists,
    # return the existing row.
    existing = find_consent_by_signature(
        caregiver_id=caregiver_id,
        notice_version=notice_version,
        signature_hash=sig_hash,
        sql_runner=runner,
    )
    if existing:
        logger.info(
            "caregiver_privacy_consent: idempotent hit -- caregiver=%s v%s",
            caregiver_id, notice_version,
        )
        return {**existing, "_status": "already_accepted"}

    record_id = _short_id("CGCONSENT")
    created_at = _now_iso()

    row = {
        "record_id":              record_id,
        "caregiver_id":           caregiver_id,
        "consent_type":           CONSENT_TYPE,
        "policy_version":         notice_version,
        "notice_version":         notice_version,
        "role":                   role,
        "checkboxes_accepted":    checkboxes_accepted,
        "checkbox_count":         checkbox_count,
        "digital_signature_hash": sig_hash,
        "guardian_consent":       guardian_consent,
        "guardian_signature_hash": guardian_sig_hash,
        "mandinka_viewed":        bool(payload.get("mandinka_viewed")),
        "scroll_completed":       bool(payload.get("scroll_completed")),
        "method":                 method,
        "accepted_at":            accepted_at,
        "created_at":             created_at,
    }

    placeholders = ", ".join(f"{k} = :{k}" for k in row.keys())
    try:
        runner(f"INSERT INTO {VERTEX_TYPE} SET {placeholders}", row)
    except Exception as e:
        logger.warning("caregiver_privacy_consent: insert failed: %s", e)
        raise

    # Edge from caregiver -> consent record. Best-effort -- the row
    # already provides caregiver_id, so a missing edge does not
    # invalidate the record (and CaregiverVertex may not exist yet
    # for synthetic / test caregivers).
    try:
        runner(
            f"CREATE EDGE {EDGE_TYPE} "
            "FROM (SELECT FROM CaregiverVertex WHERE id = :cg) "
            f"TO   (SELECT FROM {VERTEX_TYPE} WHERE record_id = :rid)",
            {"cg": caregiver_id, "rid": record_id},
        )
    except Exception as e:
        logger.debug("HasConsent edge skipped (non-fatal): %s", e)

    return {**row, "_status": "accepted"}


# ── Audit log emission (safe fields ONLY) ────────────────────────────
#
# Phase 2 uses the existing stdlib logger pattern. The full append-only
# audit-event store (compliance control AUDIT-005) is a later phase --
# do not build it here. The seven keys below are the ONLY keys allowed
# to leave this function. Tests assert the allow-list.
_AUDIT_SAFE_KEYS: Tuple[str, ...] = (
    "caregiver_id",
    "consent_version",
    "policy_version",
    "role",
    "accepted_at",
    "method",
    "required_flag",
)
_AUDIT_LOGGER = logging.getLogger("caregiver_privacy_consent.audit")


def emit_audit_log(
    *,
    caregiver_id: str,
    role: str,
    accepted_at: str,
    method: str = "app",
    consent_version: str = CAREGIVER_PRIVACY_NOTICE_VERSION,
    policy_version: Optional[str] = None,
    action: str = "captured",
) -> Dict[str, Any]:
    """
    Emit a structured AUDIT log line. Returns the safe payload for
    test inspection. Never raises.

    NEVER includes: phone, free-text signature, IP, user-agent, or
    checkbox prose -- enforced by `_AUDIT_SAFE_KEYS`.
    """
    safe = {
        "caregiver_id":   caregiver_id or "",
        "consent_version": consent_version,
        "policy_version":  policy_version or consent_version,
        "role":            role or "",
        "accepted_at":     accepted_at or "",
        "method":          method or "",
        "required_flag":   AMINA_CAREGIVER_PRIVACY_REQUIRED,
    }
    # Belt-and-suspenders: filter through the allow-list before emitting.
    safe = {k: v for k, v in safe.items() if k in _AUDIT_SAFE_KEYS}
    try:
        _AUDIT_LOGGER.info(
            "CAREGIVER_PRIVACY_CONSENT_AUDIT event_type=caregiver_privacy_consent_%s "
            "caregiver_id=%s consent_version=%s policy_version=%s role=%s "
            "accepted_at=%s method=%s required_flag=%s",
            action,
            safe["caregiver_id"],
            safe["consent_version"],
            safe["policy_version"],
            safe["role"],
            safe["accepted_at"],
            safe["method"],
            safe["required_flag"],
        )
    except Exception as e:
        logger.debug("audit log emit failed (non-fatal): %s", e)
    return safe


# ── Gate dependency (FastAPI-friendly, but importable as plain func) ─
class ConsentRequiredError(Exception):
    """Raised when AMINA_CAREGIVER_PRIVACY_REQUIRED=true and the
    caregiver has not accepted the current notice version. The route
    layer translates this to HTTP 403."""
    def __init__(self, caregiver_id: str = "") -> None:
        super().__init__("caregiver_privacy_consent_required")
        self.caregiver_id = caregiver_id


def check_caregiver_consent_or_raise(
    caregiver_id: str,
    *,
    sql_runner: Optional[Callable[..., Any]] = None,
) -> bool:
    """
    Phase 2 gate primitive (framework-agnostic). When the flag is off,
    returns True immediately. When the flag is on, returns True if the
    caregiver has accepted the current notice version, else raises
    ConsentRequiredError.
    """
    # Re-read the module attribute each call so tests can mutate it
    # at runtime via `module.AMINA_CAREGIVER_PRIVACY_REQUIRED = True`.
    import sys
    self_mod = sys.modules[__name__]
    required = bool(getattr(self_mod, "AMINA_CAREGIVER_PRIVACY_REQUIRED", False))
    if not required:
        return True
    if has_current_consent(caregiver_id, sql_runner=sql_runner):
        return True
    raise ConsentRequiredError(caregiver_id=caregiver_id)


# ── Public surface ───────────────────────────────────────────────────
__all__ = [
    "CAREGIVER_PRIVACY_NOTICE_VERSION",
    "CONSENT_TYPE",
    "VERTEX_TYPE",
    "EDGE_TYPE",
    "EXPECTED_CHECKBOX_IDS",
    "EXPECTED_CHECKBOX_COUNT",
    "AMINA_CAREGIVER_PRIVACY_REQUIRED",
    "ConsentRequiredError",
    "validate_consent_payload",
    "hash_signature",
    "ensure_caregiver_privacy_schema",
    "record_consent",
    "find_consent_by_signature",
    "find_current_consent",
    "has_current_consent",
    "emit_audit_log",
    "check_caregiver_consent_or_raise",
]
