"""
AMINA — central retention policy module (Phase 9, RET-008).

Single source of truth for default TTLs / retention windows by data
class. Read-only at runtime (the TTL values are constants); the
retention sweeper script consumes this module to decide what to
preview / purge.

Design rules:
  - Pure data + tiny query helpers. No DB calls in this module.
  - Stable, machine-friendly keys for each data class so the sweeper
    and tests can pin behaviour.
  - **legal_hold flag is a first-class concept.** Any record class
    that supports legal hold sets `legal_hold_supported: True` and
    the sweeper MUST honour it (skip records with `legal_hold=true`).
  - Source values mirror docs/compliance/RETENTION_POLICY.md. If you
    change a TTL here, update that document in the same change.
  - Defaults are conservative: a class without an explicit
    retention is left out (the sweeper refuses to touch unknown
    classes).

Public surface:
    RETENTION_POLICY            : dict of policy entries (immutable)
    get_policy(data_class)      : entry by stable key, or None
    classes_with_sweeper()      : keys the sweeper is allowed to act on
    classes_with_legal_hold()   : subset that must respect legal_hold
"""
from __future__ import annotations

from typing import Dict, List, Optional


# Stable retention policy table. Each entry shape:
#   {
#     "data_class":            "human-friendly label",
#     "store":                 "redis" | "arcadedb" | "filesystem" | "none",
#     "vertex_type":           "<ArcadeDB type>" | None,
#     "retention_days":        int  (or 0 for "TTL-only / not-day-bounded"),
#     "ttl_seconds":           int | None  (set when the store enforces TTL),
#     "mechanism":             "natural" | "sweeper" | "manual" | "external",
#     "sweeper_action":        "delete" | "tombstone" | "anonymise" | "purge_file" | None,
#     "legal_hold_supported":  bool,
#     "field_created_at":      "<created_at column>" | None,
#     "notes":                 "free text",
#   }
RETENTION_POLICY: Dict[str, Dict[str, object]] = {
    # ── Ephemeral stores (TTL enforced by the store itself) ────────
    "redis_session_cache": {
        "data_class":           "Redis session cache",
        "store":                "redis",
        "vertex_type":          None,
        "retention_days":       1,
        "ttl_seconds":          24 * 60 * 60,
        "mechanism":            "natural",
        "sweeper_action":       None,
        "legal_hold_supported": False,
        "field_created_at":     None,
        "notes":                "Redis TTL on session keys; sweeper is a no-op here.",
    },
    "otp": {
        "data_class":           "OTP",
        "store":                "redis",
        "vertex_type":          None,
        "retention_days":       0,
        "ttl_seconds":          10 * 60,
        "mechanism":            "natural",
        "sweeper_action":       None,
        "legal_hold_supported": False,
        "field_created_at":     None,
        "notes":                "10-minute TTL enforced by Redis.",
    },

    # ── Conversational state ───────────────────────────────────────
    "dialogue_snapshot": {
        "data_class":           "Conversation dialogue snapshot",
        "store":                "redis",
        "vertex_type":          None,
        "retention_days":       7,
        "ttl_seconds":          7 * 24 * 60 * 60,
        "mechanism":            "natural",
        "sweeper_action":       None,
        "legal_hold_supported": False,
        "field_created_at":     None,
        "notes":                "Rolling 7-day retention; Redis TTL.",
    },

    # ── Long-lived clinical records (ArcadeDB) ─────────────────────
    "patient_profile": {
        "data_class":           "Patient profile",
        "store":                "arcadedb",
        "vertex_type":          "PatientVertex",
        "retention_days":       0,
        "ttl_seconds":          None,
        "mechanism":            "manual",
        "sweeper_action":       "tombstone",
        "legal_hold_supported": True,
        "field_created_at":     "created_at",
        "notes":                "Active care period. Deletable on data-rights request "
                                "via consent_routes withdraw + tombstone sweep.",
    },
    "vitals": {
        "data_class":           "Vitals reading",
        "store":                "arcadedb",
        "vertex_type":          "VitalReading",
        "retention_days":       5 * 365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "delete",
        "legal_hold_supported": True,
        "field_created_at":     "created_at",
        "notes":                "5-year clinical-record norm (proposed).",
    },
    "care_plan": {
        "data_class":           "Care plan",
        "store":                "arcadedb",
        "vertex_type":          "CarePlanVertex",
        "retention_days":       5 * 365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "delete",
        "legal_hold_supported": True,
        "field_created_at":     "created_at",
        "notes":                "5-year clinical-record norm (proposed).",
    },
    "consultation": {
        "data_class":           "Consultation record",
        "store":                "arcadedb",
        "vertex_type":          "ConsultationVertex",
        "retention_days":       5 * 365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "delete",
        "legal_hold_supported": True,
        "field_created_at":     "created_at",
        "notes":                "5-year clinical-record norm (proposed).",
    },
    "consent_audit": {
        "data_class":           "Consent audit edges",
        "store":                "arcadedb",
        "vertex_type":          "ConsentAuditVertex",
        "retention_days":       7 * 365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "delete",
        "legal_hold_supported": True,
        "field_created_at":     "created_at",
        "notes":                "7-year retention to match clinical-record audit norm.",
    },
    "audit_event_store": {
        "data_class":           "Central audit event store",
        "store":                "arcadedb",
        "vertex_type":          "AuditEventVertex",
        "retention_days":       7 * 365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "delete",
        "legal_hold_supported": True,
        "field_created_at":     "created_at",
        "notes":                "Phase 9 (AUDIT-005) central audit store; "
                                "matches consent_audit retention.",
    },
    "caregiver_consent_record": {
        "data_class":           "Caregiver privacy consent record",
        "store":                "arcadedb",
        "vertex_type":          "CaregiverConsentRecord",
        "retention_days":       7 * 365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "delete",
        "legal_hold_supported": True,
        "field_created_at":     "created_at",
        "notes":                "7-year retention to match audit norms; "
                                "immutable history is preserved across notice "
                                "version bumps.",
    },

    # ── Filesystem record classes ──────────────────────────────────
    "evidence_layer_traces": {
        "data_class":           "Evidence-layer JSONL traces",
        "store":                "filesystem",
        "vertex_type":          None,
        "retention_days":       90,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "purge_file",
        "legal_hold_supported": False,
        "field_created_at":     "mtime",
        "notes":                "Local file store under evidence_reports/.",
    },
    "evidence_layer_reports": {
        "data_class":           "Evidence-layer eval reports (md)",
        "store":                "filesystem",
        "vertex_type":          None,
        "retention_days":       365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "purge_file",
        "legal_hold_supported": False,
        "field_created_at":     "mtime",
        "notes":                "Markdown reports; 1-year retention.",
    },
    "caregiver_uploads": {
        "data_class":           "Caregiver uploads",
        "store":                "filesystem",
        "vertex_type":          None,
        "retention_days":       30,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "purge_file",
        "legal_hold_supported": False,
        "field_created_at":     "mtime",
        "notes":                "Caregiver-side bind-mounted dir.",
    },
    "education_certs": {
        "data_class":           "Education certificates",
        "store":                "filesystem",
        "vertex_type":          None,
        "retention_days":       0,
        "ttl_seconds":          None,
        "mechanism":            "manual",
        "sweeper_action":       None,
        "legal_hold_supported": False,
        "field_created_at":     "mtime",
        "notes":                "Lifetime of caregiver verification; manual review.",
    },

    # ── Training-export samples (only with explicit consent) ───────
    "training_export_samples": {
        "data_class":           "Training-export samples (with training consent)",
        "store":                "filesystem",
        "vertex_type":          None,
        "retention_days":       2 * 365,
        "ttl_seconds":          None,
        "mechanism":            "sweeper",
        "sweeper_action":       "purge_file",
        "legal_hold_supported": False,
        "field_created_at":     "mtime",
        "notes":                "2-year anonymised retention.",
    },

    # ── Backups ────────────────────────────────────────────────────
    "backups_incremental": {
        "data_class":           "Backups (incremental)",
        "store":                "filesystem",
        "vertex_type":          None,
        "retention_days":       30,
        "ttl_seconds":          None,
        "mechanism":            "external",
        "sweeper_action":       None,
        "legal_hold_supported": True,
        "field_created_at":     "mtime",
        "notes":                "Pilot operator schedules + encrypts; "
                                "deletion proof TBD per RET-006.",
    },
    "backups_archive": {
        "data_class":           "Backups (monthly archive)",
        "store":                "filesystem",
        "vertex_type":          None,
        "retention_days":       365,
        "ttl_seconds":          None,
        "mechanism":            "external",
        "sweeper_action":       None,
        "legal_hold_supported": True,
        "field_created_at":     "mtime",
        "notes":                "1-year monthly archive.",
    },
}


def get_policy(data_class: str) -> Optional[Dict[str, object]]:
    return RETENTION_POLICY.get(data_class)


def classes_with_sweeper() -> List[str]:
    """Stable-sorted keys whose `mechanism` is 'sweeper'.

    The retention sweeper is allowed to ACT on these classes (still
    only ever in dry-run by default). Everything else the sweeper
    must skip with a `mechanism_skipped` reason code.
    """
    return sorted(
        k for k, v in RETENTION_POLICY.items()
        if v.get("mechanism") == "sweeper"
    )


def classes_with_legal_hold() -> List[str]:
    """Subset of policy entries that support legal_hold. The sweeper
    MUST exclude `legal_hold=true` rows from any deletion."""
    return sorted(
        k for k, v in RETENTION_POLICY.items()
        if v.get("legal_hold_supported") is True
    )


__all__ = [
    "RETENTION_POLICY",
    "get_policy",
    "classes_with_sweeper",
    "classes_with_legal_hold",
]
