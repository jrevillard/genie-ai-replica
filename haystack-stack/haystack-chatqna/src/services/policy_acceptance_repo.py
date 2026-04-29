"""
Policy Acceptance + Suspension Repository
==========================================

Storage layer for caregiver policy review/acceptance.

Schema (all NEW types, additive — existing CaregiverVertex /
InboxItemVertex / CaregiverSuspensionVertex are untouched as data;
we only ADD optional properties to existing inbox vertex):

  PolicyAcceptanceVertex(
      acceptance_id        STRING (UNIQUE) -- "ACCEPT-{uuid}"
      caregiver_id         STRING (NOTUNIQUE)
      policy_type          STRING -- "patient_privacy" | "caregiver_agreement"
      policy_version       STRING -- e.g. "1.2"
      accepted_at          STRING (ISO 8601 UTC)
      digital_signature    STRING -- typed full name
      checkboxes_json      STRING -- JSON of PolicyAcceptanceCheckboxes
      ip_address           STRING
      user_agent           STRING
      method               STRING -- "app" | "sms"
      related_inbox_id     STRING -- the InboxItemVertex this closed
  )

  CaregiverSuspensionVertex(
      suspension_id        STRING (UNIQUE) -- "SUSP-{uuid}"
      caregiver_id         STRING (NOTUNIQUE)
      suspended_at         STRING
      suspended_by         STRING -- "system" or admin staff_id
      reason               STRING
      related_policy       STRING -- "patient_privacy:1.2"
      restored_at          STRING -- "" while active
      restored_by          STRING -- "" while active
  )

Additive properties on existing InboxItemVertex (idempotent CREATE
PROPERTY IF NOT EXISTS — never disturbs existing rows):
      action_required        STRING (e.g. "review_accept")
      action_completed_at    STRING (ISO when user actioned)
      action_deadline        STRING (ISO; "" if no deadline)
      mandinka_title         STRING
      mandinka_body          STRING
      notification_type      STRING (granular type, see models)

Idempotency
-----------
record_acceptance() takes (caregiver_id, policy_type, policy_version)
as a logical key. If a row with that triple already exists, it returns
the existing row's record without inserting a duplicate. This is the
project's "no data deletion" + "audit-safe" rule applied to writes.

is_suspended() returns True iff any row exists for the caregiver with
restored_at = "" (active). Restoration creates an updated record (sets
restored_at + restored_by), it does NOT delete.
"""
from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.utils.arcade_client import command_sql

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _short_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(8)}"


def _rows(resp: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not resp:
        return []
    r = resp.get("result")
    if isinstance(r, list):
        return r
    return []


# ──────────────────────────────────────────────────────────────────
#  Schema bootstrap
# ──────────────────────────────────────────────────────────────────

_SCHEMA_STMTS: List[str] = [
    # ── PolicyAcceptanceVertex ──
    "CREATE VERTEX TYPE PolicyAcceptanceVertex IF NOT EXISTS",
    "CREATE PROPERTY PolicyAcceptanceVertex.acceptance_id IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.caregiver_id IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.policy_type IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.policy_version IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.accepted_at IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.digital_signature IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.checkboxes_json IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.ip_address IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.user_agent IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.method IF NOT EXISTS STRING",
    "CREATE PROPERTY PolicyAcceptanceVertex.related_inbox_id IF NOT EXISTS STRING",
    "CREATE INDEX IF NOT EXISTS ON PolicyAcceptanceVertex (acceptance_id) UNIQUE",
    "CREATE INDEX IF NOT EXISTS ON PolicyAcceptanceVertex (caregiver_id) NOTUNIQUE",
    "CREATE INDEX IF NOT EXISTS ON PolicyAcceptanceVertex (policy_type) NOTUNIQUE",

    # ── CaregiverSuspensionVertex ──
    "CREATE VERTEX TYPE CaregiverSuspensionVertex IF NOT EXISTS",
    "CREATE PROPERTY CaregiverSuspensionVertex.suspension_id IF NOT EXISTS STRING",
    "CREATE PROPERTY CaregiverSuspensionVertex.caregiver_id IF NOT EXISTS STRING",
    "CREATE PROPERTY CaregiverSuspensionVertex.suspended_at IF NOT EXISTS STRING",
    "CREATE PROPERTY CaregiverSuspensionVertex.suspended_by IF NOT EXISTS STRING",
    "CREATE PROPERTY CaregiverSuspensionVertex.reason IF NOT EXISTS STRING",
    "CREATE PROPERTY CaregiverSuspensionVertex.related_policy IF NOT EXISTS STRING",
    "CREATE PROPERTY CaregiverSuspensionVertex.restored_at IF NOT EXISTS STRING",
    "CREATE PROPERTY CaregiverSuspensionVertex.restored_by IF NOT EXISTS STRING",
    "CREATE INDEX IF NOT EXISTS ON CaregiverSuspensionVertex (suspension_id) UNIQUE",
    "CREATE INDEX IF NOT EXISTS ON CaregiverSuspensionVertex (caregiver_id) NOTUNIQUE",

    # ── Additive properties on existing InboxItemVertex ──
    # These are CREATE PROPERTY IF NOT EXISTS on an existing vertex type;
    # they never disturb pre-existing rows (rows that lack them simply
    # read back as null, which the new code paths treat as "no action").
    "CREATE PROPERTY InboxItemVertex.action_required IF NOT EXISTS STRING",
    "CREATE PROPERTY InboxItemVertex.action_completed_at IF NOT EXISTS STRING",
    "CREATE PROPERTY InboxItemVertex.action_deadline IF NOT EXISTS STRING",
    "CREATE PROPERTY InboxItemVertex.mandinka_title IF NOT EXISTS STRING",
    "CREATE PROPERTY InboxItemVertex.mandinka_body IF NOT EXISTS STRING",
    "CREATE PROPERTY InboxItemVertex.notification_type IF NOT EXISTS STRING",
]


_SCHEMA_BOOTSTRAPPED = False


def ensure_policy_schema() -> None:
    """Idempotent schema bootstrap. Safe to call from every worker."""
    global _SCHEMA_BOOTSTRAPPED
    if _SCHEMA_BOOTSTRAPPED:
        return
    for stmt in _SCHEMA_STMTS:
        try:
            command_sql(stmt)
        except Exception as e:
            # IF NOT EXISTS handles re-runs; everything else is informational.
            logger.debug("policy schema step skipped: %s -> %s", stmt[:70], e)
    _SCHEMA_BOOTSTRAPPED = True
    logger.info(
        "policy_acceptance_repo: schema bootstrapped "
        "(PolicyAcceptanceVertex + CaregiverSuspensionVertex + 6 InboxItemVertex props)"
    )


# ──────────────────────────────────────────────────────────────────
#  Acceptance — idempotent insert + lookups
# ──────────────────────────────────────────────────────────────────

def find_acceptance(
    caregiver_id: str,
    policy_type: str,
    policy_version: str,
) -> Optional[Dict[str, Any]]:
    """Return the existing acceptance row for the (caregiver,type,version)
    triple, or None if not yet accepted."""
    if not (caregiver_id and policy_type and policy_version):
        return None
    try:
        resp = command_sql(
            "SELECT FROM PolicyAcceptanceVertex "
            "WHERE caregiver_id = :cg AND policy_type = :pt "
            "AND policy_version = :pv LIMIT 1",
            {"cg": caregiver_id, "pt": policy_type, "pv": policy_version},
        )
    except Exception as e:
        logger.debug("find_acceptance failed (returning None): %s", e)
        return None
    rows = _rows(resp)
    return rows[0] if rows else None


def has_accepted(
    caregiver_id: str,
    policy_type: str,
    policy_version: str,
) -> bool:
    return find_acceptance(caregiver_id, policy_type, policy_version) is not None


def record_acceptance(
    *,
    caregiver_id: str,
    policy_type: str,
    policy_version: str,
    digital_signature: str,
    checkboxes: Dict[str, bool],
    ip_address: str = "",
    user_agent: str = "",
    method: str = "app",
    related_inbox_id: str = "",
) -> Dict[str, Any]:
    """
    Idempotent. If the (caregiver_id, policy_type, policy_version) triple
    already has an acceptance, returns the existing row with status="already_accepted".
    Otherwise inserts a new PolicyAcceptanceVertex with status="accepted".
    """
    if not caregiver_id:
        raise ValueError("caregiver_id required")
    if not policy_type:
        raise ValueError("policy_type required")
    if not policy_version:
        raise ValueError("policy_version required")
    if not digital_signature.strip():
        raise ValueError("digital_signature required")

    existing = find_acceptance(caregiver_id, policy_type, policy_version)
    if existing:
        logger.info(
            "policy_acceptance_repo: idempotent hit -- caregiver=%s policy=%s v%s already accepted",
            caregiver_id, policy_type, policy_version,
        )
        return {**existing, "_status": "already_accepted"}

    row = {
        "acceptance_id":     _short_id("ACCEPT"),
        "caregiver_id":      caregiver_id,
        "policy_type":       policy_type,
        "policy_version":    policy_version,
        "accepted_at":       _now_iso(),
        "digital_signature": digital_signature.strip()[:120],
        "checkboxes_json":   json.dumps(checkboxes, sort_keys=True),
        "ip_address":        (ip_address or "")[:64],
        "user_agent":        (user_agent or "")[:200],
        "method":            method,
        "related_inbox_id":  related_inbox_id or "",
    }

    try:
        command_sql(
            "CREATE VERTEX PolicyAcceptanceVertex SET "
            "acceptance_id = :acceptance_id, "
            "caregiver_id = :caregiver_id, "
            "policy_type = :policy_type, "
            "policy_version = :policy_version, "
            "accepted_at = :accepted_at, "
            "digital_signature = :digital_signature, "
            "checkboxes_json = :checkboxes_json, "
            "ip_address = :ip_address, "
            "user_agent = :user_agent, "
            "method = :method, "
            "related_inbox_id = :related_inbox_id",
            row,
        )
    except Exception as e:
        # Race condition fallback: another worker just inserted -- re-read.
        logger.warning("record_acceptance insert raced (%s) -- reading existing", e)
        existing = find_acceptance(caregiver_id, policy_type, policy_version)
        if existing:
            return {**existing, "_status": "already_accepted"}
        raise

    logger.info(
        "policy_acceptance_repo: NEW acceptance %s caregiver=%s policy=%s v%s",
        row["acceptance_id"], caregiver_id, policy_type, policy_version,
    )
    return {**row, "_status": "accepted"}


def list_acceptances_for_caregiver(caregiver_id: str) -> List[Dict[str, Any]]:
    if not caregiver_id:
        return []
    try:
        resp = command_sql(
            "SELECT FROM PolicyAcceptanceVertex WHERE caregiver_id = :cg "
            "ORDER BY accepted_at DESC LIMIT 200",
            {"cg": caregiver_id},
        )
    except Exception as e:
        logger.debug("list_acceptances_for_caregiver failed: %s", e)
        return []
    return _rows(resp)


def list_acceptances_for_policy(
    policy_type: str,
    policy_version: str,
) -> List[Dict[str, Any]]:
    """Used by the future compliance dashboard."""
    if not (policy_type and policy_version):
        return []
    try:
        resp = command_sql(
            "SELECT FROM PolicyAcceptanceVertex "
            "WHERE policy_type = :pt AND policy_version = :pv "
            "ORDER BY accepted_at DESC LIMIT 5000",
            {"pt": policy_type, "pv": policy_version},
        )
    except Exception as e:
        logger.debug("list_acceptances_for_policy failed: %s", e)
        return []
    return _rows(resp)


# ──────────────────────────────────────────────────────────────────
#  Suspension — append-only audit trail
# ──────────────────────────────────────────────────────────────────

def is_suspended(caregiver_id: str) -> bool:
    """True iff there's any active suspension (restored_at = '') for caregiver."""
    if not caregiver_id:
        return False
    try:
        resp = command_sql(
            "SELECT FROM CaregiverSuspensionVertex "
            "WHERE caregiver_id = :cg AND (restored_at IS NULL OR restored_at = '') "
            "LIMIT 1",
            {"cg": caregiver_id},
        )
    except Exception as e:
        logger.debug("is_suspended failed (defaulting to False): %s", e)
        return False
    return len(_rows(resp)) > 0


def get_active_suspension(caregiver_id: str) -> Optional[Dict[str, Any]]:
    if not caregiver_id:
        return None
    try:
        resp = command_sql(
            "SELECT FROM CaregiverSuspensionVertex "
            "WHERE caregiver_id = :cg AND (restored_at IS NULL OR restored_at = '') "
            "ORDER BY suspended_at DESC LIMIT 1",
            {"cg": caregiver_id},
        )
    except Exception as e:
        logger.debug("get_active_suspension failed: %s", e)
        return None
    rows = _rows(resp)
    return rows[0] if rows else None


def record_suspension(
    *,
    caregiver_id: str,
    reason: str,
    suspended_by: str = "system",
    related_policy: str = "",
) -> Dict[str, Any]:
    """Append a new suspension. Idempotent in the weak sense -- if there's
    already an active suspension for this caregiver, returns it without
    creating a duplicate."""
    if not caregiver_id:
        raise ValueError("caregiver_id required")
    existing = get_active_suspension(caregiver_id)
    if existing:
        logger.info(
            "record_suspension: caregiver %s already actively suspended (suspension_id=%s)",
            caregiver_id, existing.get("suspension_id"),
        )
        return {**existing, "_status": "already_suspended"}

    row = {
        "suspension_id":  _short_id("SUSP"),
        "caregiver_id":   caregiver_id,
        "suspended_at":   _now_iso(),
        "suspended_by":   suspended_by,
        "reason":         (reason or "")[:500],
        "related_policy": related_policy or "",
        "restored_at":    "",
        "restored_by":    "",
    }
    command_sql(
        "CREATE VERTEX CaregiverSuspensionVertex SET "
        "suspension_id = :suspension_id, "
        "caregiver_id = :caregiver_id, "
        "suspended_at = :suspended_at, "
        "suspended_by = :suspended_by, "
        "reason = :reason, "
        "related_policy = :related_policy, "
        "restored_at = :restored_at, "
        "restored_by = :restored_by",
        row,
    )
    logger.warning(
        "policy_acceptance_repo: SUSPENDED caregiver=%s reason=%r",
        caregiver_id, reason,
    )
    return {**row, "_status": "suspended"}


def restore_caregiver(
    caregiver_id: str,
    restored_by: str = "system",
) -> Optional[Dict[str, Any]]:
    """Restore an active suspension (if any) by setting restored_at.
    Returns the updated row, or None if no active suspension."""
    active = get_active_suspension(caregiver_id)
    if not active:
        return None
    suspension_id = active.get("suspension_id")
    now = _now_iso()
    try:
        command_sql(
            "UPDATE CaregiverSuspensionVertex SET "
            "restored_at = :restored_at, restored_by = :restored_by "
            "WHERE suspension_id = :sid",
            {"restored_at": now, "restored_by": restored_by, "sid": suspension_id},
        )
    except Exception as e:
        logger.warning("restore_caregiver UPDATE failed: %s", e)
        return None
    active["restored_at"] = now
    active["restored_by"] = restored_by
    logger.info(
        "policy_acceptance_repo: RESTORED caregiver=%s suspension_id=%s",
        caregiver_id, suspension_id,
    )
    return active


# ──────────────────────────────────────────────────────────────────
#  Inbox-item helpers (idempotent dedup + policy metadata stamping)
# ──────────────────────────────────────────────────────────────────

def make_policy_source_id(policy_type: str, policy_version: str) -> str:
    """Deterministic, stable source_id used as the per-caregiver dedup
    key on InboxItemVertex. Two broadcasts with the same (type, version)
    cannot produce duplicate inbox items for the same caregiver because
    a (patient_id, source_id) lookup will hit the existing row."""
    return f"policy:{policy_type}:{policy_version}"


def find_inbox_item_by_source_id(
    caregiver_id: str,
    source_id: str,
) -> Optional[Dict[str, Any]]:
    """Per-caregiver idempotency lookup. Returns the existing InboxItemVertex
    row if (patient_id, source_id) already has one, else None. The existing
    inbox uses `patient_id` as the owner field for caregivers too.
    """
    if not (caregiver_id and source_id):
        return None
    try:
        resp = command_sql(
            "SELECT FROM InboxItemVertex "
            "WHERE patient_id = :cg AND source_id = :sid LIMIT 1",
            {"cg": caregiver_id, "sid": source_id},
        )
    except Exception as e:
        logger.debug("find_inbox_item_by_source_id failed: %s", e)
        return None
    rows = _rows(resp)
    return rows[0] if rows else None


def update_inbox_policy_metadata(
    inbox_id: str,
    *,
    notification_type: str,
    action_required: str,
    action_deadline: str = "",
    mandinka_title: str = "",
    mandinka_body: str = "",
) -> bool:
    """Stamp the policy-specific fields onto an existing InboxItemVertex.
    Called immediately after inbox_service.create_item() so the new
    additive properties are populated. Idempotent: re-running with the
    same values is a no-op at the data level."""
    if not inbox_id:
        return False
    try:
        command_sql(
            "UPDATE InboxItemVertex SET "
            "notification_type = :nt, "
            "action_required = :ar, "
            "action_deadline = :ad, "
            "mandinka_title = :mt, "
            "mandinka_body = :mb "
            "WHERE inbox_id = :id",
            {
                "id": inbox_id,
                "nt": notification_type or "",
                "ar": action_required or "",
                "ad": action_deadline or "",
                "mt": mandinka_title or "",
                "mb": mandinka_body or "",
            },
        )
        return True
    except Exception as e:
        logger.warning("update_inbox_policy_metadata failed: %s", e)
        return False


def mark_inbox_item_actioned(inbox_id: str) -> bool:
    """Stamp action_completed_at on an existing InboxItemVertex.
    Does NOT touch the existing `read` flag -- the existing inbox_service
    handles that separately. Returns True on success."""
    if not inbox_id:
        return False
    try:
        command_sql(
            "UPDATE InboxItemVertex SET action_completed_at = :ts "
            "WHERE inbox_id = :id",
            {"ts": _now_iso(), "id": inbox_id},
        )
        return True
    except Exception as e:
        logger.debug("mark_inbox_item_actioned failed: %s", e)
        return False


__all__ = [
    "ensure_policy_schema",
    "find_acceptance",
    "has_accepted",
    "record_acceptance",
    "list_acceptances_for_caregiver",
    "list_acceptances_for_policy",
    "is_suspended",
    "get_active_suspension",
    "record_suspension",
    "restore_caregiver",
    "make_policy_source_id",
    "find_inbox_item_by_source_id",
    "update_inbox_policy_metadata",
    "mark_inbox_item_actioned",
]
