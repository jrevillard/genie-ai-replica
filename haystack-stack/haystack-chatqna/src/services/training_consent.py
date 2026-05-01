"""
AMINA Care — Training Consent Store
====================================
Dedicated, self-contained consent store for the legal basis
"use my conversations to train the AMINA LoRA model".

Kept separate from consent_service.py so we can:

  1. Support BOTH patient and caregiver actors (consent_service.py is
     patient-only — /consent/me blocks role=caregiver).
  2. Ship as a fully additive module (no existing files are modified).
  3. Provide a single, separable audit trail specifically for training-
     data usage, which regulators prefer kept distinct from data-sharing
     consent (DHIS2, FHIR export, research).

Storage:
  - TrainingConsentVertex      — current state, keyed by (actor_role, actor_id)
  - TrainingConsentAuditVertex — append-only audit trail

Scope identifier:
  - "amina_training"  (TRAINING_SCOPE)
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Dict, List

from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)

TRAINING_SCOPE = "amina_training"
VALID_ROLES = ("patient", "caregiver")


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


# ── Schema ────────────────────────────────────────────────────────────────────

def ensure_training_consent_schema() -> None:
    """Create TrainingConsentVertex + TrainingConsentAuditVertex. Idempotent."""
    stmts = [
        "CREATE VERTEX TYPE TrainingConsentVertex IF NOT EXISTS",
        "CREATE PROPERTY TrainingConsentVertex.consent_id IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentVertex.actor_role IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentVertex.actor_id IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentVertex.value IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY TrainingConsentVertex.version IF NOT EXISTS INTEGER",
        "CREATE PROPERTY TrainingConsentVertex.updated_at IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentVertex.decided IF NOT EXISTS BOOLEAN",
        "CREATE VERTEX TYPE TrainingConsentAuditVertex IF NOT EXISTS",
        "CREATE PROPERTY TrainingConsentAuditVertex.audit_id IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentAuditVertex.actor_role IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentAuditVertex.actor_id IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentAuditVertex.logged_at IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentAuditVertex.old_value IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY TrainingConsentAuditVertex.new_value IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY TrainingConsentAuditVertex.consent_version IF NOT EXISTS INTEGER",
        "CREATE PROPERTY TrainingConsentAuditVertex.actor IF NOT EXISTS STRING",
        "CREATE PROPERTY TrainingConsentAuditVertex.reason IF NOT EXISTS STRING",
    ]
    for stmt in stmts:
        try:
            command_sql(stmt)
        except Exception as e:
            logger.debug(f"training consent schema step: {stmt[:60]}... -> {e}")


# ── Read API ──────────────────────────────────────────────────────────────────

def _load(actor_role: str, actor_id: str) -> Dict:
    if actor_role not in VALID_ROLES or not actor_id:
        return {"value": False, "version": 0, "decided": False, "exists": False, "updated_at": ""}
    try:
        resp = command_sql(
            "SELECT value, version, decided, updated_at FROM TrainingConsentVertex "
            "WHERE actor_role = :r AND actor_id = :i LIMIT 1",
            {"r": actor_role, "i": actor_id},
        )
        # BUG-035: ArcadeDB can return ``{"result": None}`` on certain
        # failure shapes. ``(resp or {}).get("result", [])`` returns
        # ``None`` in that case (the default applies only when the key
        # is missing, not when its value is None). The ``isinstance``
        # check below normalises any non-list shape to ``[]`` so the
        # ``if not rows`` guard reliably trips and we never index a
        # non-list with ``rows[0]``.
        rows = (resp or {}).get("result", [])
        if not isinstance(rows, list):
            rows = []
        if not rows:
            return {"value": False, "version": 0, "decided": False, "exists": False, "updated_at": ""}
        row = rows[0]
        return {
            "value":      bool(row.get("value") or False),
            "version":    int(row.get("version") or 0),
            "decided":    bool(row.get("decided") or False),
            "updated_at": row.get("updated_at") or "",
            "exists":     True,
        }
    except Exception as e:
        logger.error(f"training_consent: load failed for {actor_role}/{actor_id}: {e}")
        return {"value": False, "version": 0, "decided": False, "exists": False, "updated_at": ""}


def get_training_consent(actor_role: str, actor_id: str) -> Dict:
    """Full training-consent snapshot for an actor."""
    return _load(actor_role, actor_id)


def is_training_allowed(actor_role: str, actor_id: str) -> bool:
    """Authoritative gate — used by training_export.run_export()."""
    if not actor_id:
        return False
    return bool(_load(actor_role, actor_id).get("value", False))


# ── Write API ─────────────────────────────────────────────────────────────────

def set_training_consent(
    actor_role: str,
    actor_id: str,
    value: bool,
    actor: str = "self",
    reason: str = "",
) -> Dict:
    """
    Upsert a training-consent decision. Every call:
      1. Reads current state
      2. Bumps version
      3. Writes new state
      4. Appends an audit row
    """
    if actor_role not in VALID_ROLES:
        return {"ok": False, "error": f"invalid actor_role {actor_role!r}"}
    if not actor_id:
        return {"ok": False, "error": "actor_id required"}

    current = _load(actor_role, actor_id)
    old_value = bool(current.get("value", False))
    new_value = bool(value)
    new_version = int(current.get("version", 0)) + 1
    now = _now_iso()

    try:
        if current.get("exists"):
            command_sql(
                "UPDATE TrainingConsentVertex SET value = :v, version = :ver, "
                "updated_at = :t, decided = :d "
                "WHERE actor_role = :r AND actor_id = :i",
                {
                    "v": new_value, "ver": new_version, "t": now, "d": True,
                    "r": actor_role, "i": actor_id,
                },
            )
        else:
            record = {
                "consent_id": uuid.uuid4().hex,
                "actor_role": actor_role,
                "actor_id":   actor_id,
                "value":      new_value,
                "version":    new_version,
                "updated_at": now,
                "decided":    True,
            }
            command_sql(
                "INSERT INTO TrainingConsentVertex CONTENT " + json.dumps(record)
            )
    except Exception as e:
        logger.error(f"training_consent: write failed for {actor_role}/{actor_id}: {e}")
        return {"ok": False, "error": str(e)}

    _write_audit(actor_role, actor_id, old_value, new_value, new_version, actor, reason)

    return {
        "ok":          True,
        "actor_role":  actor_role,
        "actor_id":    actor_id,
        "old_value":   old_value,
        "new_value":   new_value,
        "new_version": new_version,
    }


def _write_audit(
    actor_role: str,
    actor_id: str,
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
            "actor_role":      actor_role,
            "actor_id":        actor_id,
            "logged_at":       _now_iso(),
            "old_value":       bool(old_value),
            "new_value":       bool(new_value),
            "consent_version": int(version),
            "actor":           actor or "system",
            "reason":          (reason or "")[:300],
        }
        command_sql(
            "INSERT INTO TrainingConsentAuditVertex CONTENT " + json.dumps(record)
        )
    except Exception as e:
        logger.debug(f"training consent audit write failed (non-fatal): {e}")


def get_audit_history(actor_role: str, actor_id: str, limit: int = 50) -> List[Dict]:
    try:
        resp = command_sql(
            "SELECT audit_id, logged_at, old_value, new_value, "
            "consent_version, actor, reason FROM TrainingConsentAuditVertex "
            "WHERE actor_role = :r AND actor_id = :i ORDER BY logged_at DESC LIMIT :lim",
            {"r": actor_role, "i": actor_id, "lim": limit},
        )
        return (resp or {}).get("result", [])
    except Exception as e:
        logger.error(f"training_consent: audit query failed: {e}")
        return []


# ── Bulk helpers (used by the exporter) ──────────────────────────────────────

def list_consented_actor_ids(actor_role: str) -> List[str]:
    """Return IDs of all actors of the given role who have opted in."""
    if actor_role not in VALID_ROLES:
        return []
    try:
        resp = command_sql(
            "SELECT actor_id FROM TrainingConsentVertex "
            "WHERE actor_role = :r AND value = true",
            {"r": actor_role},
        )
        return [r["actor_id"] for r in (resp or {}).get("result", []) if r.get("actor_id")]
    except Exception as e:
        logger.error(f"training_consent: list_consented_actor_ids({actor_role}) failed: {e}")
        return []
