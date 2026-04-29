"""
AMINA Care — Patient Consent Management
==========================================
Phase 2.5 — patient-level consent for external data sharing.

Manages per-patient, per-scope consent flags with an append-only audit
trail. Consent is versioned — every change creates a new ConsentAuditVertex
record so regulators can prove what the patient agreed to at the time of
a Tracker push.

Scopes supported:
  - dhis2_aggregate   (always granted — no PII leaves AMINA anyway)
  - dhis2_tracker     (patient-level push to DHIS2 Tracker)
  - fhir_export       (FHIR Bundle download by third parties)
  - research          (de-identified research cohorts)

Design:
  - Consent state lives on PatientVertex as JSON: consent_flags
  - Every update writes a ConsentAuditVertex row
  - get_consent() is the authoritative check for Tracker/FHIR push code
  - Consent version bumps by 1 on every change
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


CONSENT_SCOPES = [
    "dhis2_aggregate",
    "dhis2_tracker",
    "fhir_export",
    "research",
]

# Default consent state for new patients
DEFAULT_CONSENT = {
    "dhis2_aggregate": True,    # no PII, always granted
    "dhis2_tracker":   False,   # explicit opt-in required
    "fhir_export":     False,
    "research":        False,
}


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


# ── Schema ────────────────────────────────────────────────────────────────────

def ensure_consent_schema() -> None:
    """Create ConsentAuditVertex + consent_flags property on PatientVertex.
    Safe to call repeatedly."""
    stmts = [
        "CREATE VERTEX TYPE ConsentAuditVertex IF NOT EXISTS",
        "CREATE PROPERTY ConsentAuditVertex.audit_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsentAuditVertex.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsentAuditVertex.logged_at IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsentAuditVertex.scope IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsentAuditVertex.old_value IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY ConsentAuditVertex.new_value IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY ConsentAuditVertex.consent_version IF NOT EXISTS INTEGER",
        "CREATE PROPERTY ConsentAuditVertex.actor IF NOT EXISTS STRING",
        "CREATE PROPERTY ConsentAuditVertex.reason IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.consent_flags IF NOT EXISTS STRING",
        "CREATE PROPERTY PatientVertex.consent_version IF NOT EXISTS INTEGER",
    ]
    for stmt in stmts:
        try:
            command_sql(stmt)
        except Exception as e:
            logger.debug(f"consent schema step: {stmt[:60]}... -> {e}")


# ── Read API ──────────────────────────────────────────────────────────────────

def _load_patient_consent(patient_id: str) -> Dict:
    """Return consent flags for a patient (or defaults if none set)."""
    try:
        resp = command_sql(
            "SELECT consent_flags, consent_version FROM PatientVertex WHERE id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = (resp or {}).get("result", [])
        if not rows:
            return {"flags": dict(DEFAULT_CONSENT), "version": 0, "exists": False}
        raw = rows[0].get("consent_flags") or ""
        version = int(rows[0].get("consent_version") or 0)
        if not raw:
            return {"flags": dict(DEFAULT_CONSENT), "version": version, "exists": True}
        try:
            flags = json.loads(raw)
        except Exception:
            flags = dict(DEFAULT_CONSENT)
        # Merge with defaults so new scopes don't break old records
        merged = dict(DEFAULT_CONSENT)
        merged.update(flags)
        return {"flags": merged, "version": version, "exists": True}
    except Exception as e:
        logger.error(f"consent: failed to load for {patient_id}: {e}")
        return {"flags": dict(DEFAULT_CONSENT), "version": 0, "exists": False}


def get_consent(patient_id: str, scope: str) -> bool:
    """
    Authoritative consent check. Returns True only if the patient has
    explicitly consented to the given scope.
    """
    if scope not in CONSENT_SCOPES:
        logger.warning(f"consent: unknown scope {scope!r}")
        return False
    state = _load_patient_consent(patient_id)
    return bool(state["flags"].get(scope, False))


def get_all_consents(patient_id: str) -> Dict:
    """Full consent snapshot for a patient (for admin UI + patient self-service)."""
    return _load_patient_consent(patient_id)


# ── Write API ─────────────────────────────────────────────────────────────────

def set_consent(
    patient_id: str,
    scope: str,
    value: bool,
    actor: str = "patient",
    reason: str = "",
) -> Dict:
    """
    Update a single consent flag for a patient. Every update:
      1. Reads current state
      2. Bumps consent_version
      3. Writes new state to PatientVertex
      4. Writes an append-only ConsentAuditVertex row

    Args:
        patient_id: AMINA patient ID
        scope:      One of CONSENT_SCOPES
        value:      True (grant) / False (revoke)
        actor:      Who made the change — 'patient' | 'admin:{username}' | 'system'
        reason:     Optional free-text reason (shown in audit log)

    Returns:
        { ok: bool, patient_id, scope, old_value, new_value, new_version }
    """
    if scope not in CONSENT_SCOPES:
        return {"ok": False, "error": f"unknown scope {scope!r}"}

    # Load current state (may create defaults if none)
    current = _load_patient_consent(patient_id)
    flags = dict(current["flags"])
    old_value = bool(flags.get(scope, False))
    new_value = bool(value)
    new_version = int(current["version"]) + 1

    # No-op guard — still write the audit entry for traceability
    if old_value == new_value:
        _write_audit(patient_id, scope, old_value, new_value, new_version - 1, actor, "no-op: " + reason)
        return {
            "ok": True, "patient_id": patient_id, "scope": scope,
            "old_value": old_value, "new_value": new_value,
            "new_version": new_version - 1, "noop": True,
        }

    flags[scope] = new_value

    try:
        command_sql(
            "UPDATE PatientVertex SET consent_flags = :flags, consent_version = :ver, "
            "consent_updated_at = :ts WHERE id = :pid",
            {
                "flags": json.dumps(flags),
                "ver":   new_version,
                "ts":    _now_iso(),
                "pid":   patient_id,
            },
        )
    except Exception as e:
        logger.error(f"consent: update failed for {patient_id}/{scope}: {e}")
        return {"ok": False, "error": str(e)}

    _write_audit(patient_id, scope, old_value, new_value, new_version, actor, reason)

    return {
        "ok": True,
        "patient_id":  patient_id,
        "scope":       scope,
        "old_value":   old_value,
        "new_value":   new_value,
        "new_version": new_version,
    }


def _write_audit(
    patient_id: str,
    scope: str,
    old_value: bool,
    new_value: bool,
    version: int,
    actor: str,
    reason: str,
) -> None:
    """Append-only audit write. Silent on failure — never blocks consent change."""
    try:
        record = {
            "audit_id":        uuid.uuid4().hex,
            "patient_id":      patient_id,
            "logged_at":       _now_iso(),
            "scope":           scope,
            "old_value":       bool(old_value),
            "new_value":       bool(new_value),
            "consent_version": int(version),
            "actor":           actor or "system",
            "reason":          (reason or "")[:300],
        }
        command_sql(
            "INSERT INTO ConsentAuditVertex CONTENT " + json.dumps(record)
        )
    except Exception as e:
        logger.debug(f"consent audit write failed (non-fatal): {e}")


def get_audit_history(patient_id: str, limit: int = 50) -> List[Dict]:
    """Return consent change history for a patient, newest first."""
    try:
        resp = command_sql(
            "SELECT audit_id, logged_at, scope, old_value, new_value, "
            "consent_version, actor, reason FROM ConsentAuditVertex "
            "WHERE patient_id = :pid ORDER BY logged_at DESC LIMIT :lim",
            {"pid": patient_id, "lim": limit},
        )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"consent: audit query failed for {patient_id}: {e}")
        return []
