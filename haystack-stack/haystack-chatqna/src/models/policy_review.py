"""
Caregiver Policy Review Models
==============================

Pydantic models + enums for the policy-review-and-acceptance flow.
This module is purely additive -- no edits to any existing model.

The existing inbox uses a coarse `kind` field (pdf/alert/notification/...).
This module extends that with finer-grained policy notification metadata
that is stored in additional optional properties on InboxItemVertex
(action_required, action_deadline, mandinka_title/body, notification_type).

Existing inbox items pre-dating these properties read back as null and
are treated as no-action items by the new code paths -- nothing breaks.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────────
#  Enums
# ──────────────────────────────────────────────────────────────────

class PolicyType(str, Enum):
    """Two policy documents the platform tracks acceptance for."""
    PATIENT_PRIVACY     = "patient_privacy"
    CAREGIVER_AGREEMENT = "caregiver_agreement"


class NotificationType(str, Enum):
    """
    Granular notification types stored on InboxItemVertex.notification_type.
    Coexists with the existing coarse `kind` field (we keep `kind="alert"`
    or `kind="notification"` for backwards compat; this is the precise type).
    """
    PRIVACY_POLICY_REVIEW   = "privacy_policy_review"
    DATA_AGREEMENT_REVIEW   = "data_agreement_review"
    POLICY_REVIEW_REMINDER  = "policy_review_reminder"
    POLICY_ACCEPTED         = "policy_accepted"
    ACCESS_RESTORED         = "access_restored"
    ACCESS_SUSPENDED        = "access_suspended"


class ActionRequired(str, Enum):
    """What the user must do for this inbox item."""
    NONE              = "none"
    REVIEW_AND_ACCEPT = "review_accept"
    REVIEW_AND_RESPOND = "review_respond"
    ACKNOWLEDGE       = "acknowledge"
    COMPLETE_TASK     = "complete_task"


class CaregiverRole(str, Enum):
    """Roles tracked for compliance + deadline tuning."""
    FAMILY = "family"
    VHW    = "vhw"
    CHN    = "chn"
    SCOUT  = "scout"
    ALKALO = "alkalo"
    OTHER  = "other"


# Default deadline-days per role for policy reviews (per spec section 2)
DEFAULT_DEADLINE_DAYS: Dict[str, int] = {
    "vhw":    7,
    "chn":    7,
    "scout":  7,
    "family": 14,
    "alkalo": 14,
    "other":  14,
}


# ──────────────────────────────────────────────────────────────────
#  Acceptance record  (stored as PolicyAcceptanceVertex)
# ──────────────────────────────────────────────────────────────────

class PolicyAcceptanceCheckboxes(BaseModel):
    """
    The 4 mandatory consent checkboxes (legacy schema, kept for backward
    compatibility with the original section-4 spec). All four must be true
    if the request body includes a `checkboxes` object.

    The frontend (6.5) gates the Accept button on 4 checkboxes locally
    and sends ONLY {typed_signature, pin} -- in that case the route stores
    a "client_gated" audit marker instead of these booleans. This object
    is therefore Optional on the request, but if supplied is fully validated.
    """
    consent_confidential:    bool = Field(..., description="Patient health info is CONFIDENTIAL")
    accept_responsibility:   bool = Field(..., description="Accept FULL RESPONSIBILITY for protecting patient data")
    understand_consequences: bool = Field(..., description="Understand violations may result in legal consequences")
    delete_on_removal:       bool = Field(..., description="Agree to delete patient data if access is removed")

    def all_checked(self) -> bool:
        return (
            self.consent_confidential
            and self.accept_responsibility
            and self.understand_consequences
            and self.delete_on_removal
        )


# Frontend-displayed checkbox wording (v1). Stored in the audit record
# when the request comes via the simplified client-gated path so we can
# show, in court, exactly which sentences a caregiver agreed to.
FRONTEND_CHECKBOX_WORDING_V1: List[str] = [
    "I have read and understood this policy.",
    "I understand my responsibilities.",
    "I agree to follow this policy.",
    "I understand non-compliance may affect access.",
]


class PolicyAcceptance(BaseModel):
    """A signed acceptance record. Stored as PolicyAcceptanceVertex."""
    acceptance_id:     str
    caregiver_id:      str
    policy_type:       str             # PolicyType value
    policy_version:    str
    accepted_at:       str             # ISO 8601
    digital_signature: str             # typed full name
    checkboxes_json:   str             # JSON-encoded PolicyAcceptanceCheckboxes
    ip_address:        str = ""
    user_agent:        str = ""
    method:            str = "app"     # "app" | "sms" (sms reserved for 6.7)
    related_inbox_id:  str = ""        # inbox item this acceptance closed


# ──────────────────────────────────────────────────────────────────
#  Suspension record  (stored as CaregiverSuspensionVertex)
# ──────────────────────────────────────────────────────────────────

class CaregiverSuspension(BaseModel):
    """
    A suspension record. Per default A: stored separately so existing
    CaregiverVertex is untouched.

    Lifecycle: created with restored_at="" (active suspension);
    restoration sets restored_at + restored_by. Records are NEVER deleted
    (audit trail); is_suspended() returns True iff there is any
    suspension row with empty restored_at for the caregiver.
    """
    suspension_id:    str
    caregiver_id:     str
    suspended_at:     str
    suspended_by:     str = "system"   # "system" or admin staff_id
    reason:           str
    related_policy:   str = ""         # "patient_privacy:1.2"
    restored_at:      str = ""
    restored_by:      str = ""


# ──────────────────────────────────────────────────────────────────
#  API request/response models  (used in 6.3)
# ──────────────────────────────────────────────────────────────────

class PolicyNotifyRequest(BaseModel):
    """
    Admin trigger to broadcast a policy update.

    Convention for `policy_version`: stable, document/version-style IDs.
    Recommended formats:
      - "2026-04-26"           (effective-date-based)
      - "v2026.04"             (year.month)
      - "doc-<sha256[:12]>"    (content-hash anchored)
    AVOID human labels like "v1", "draft" -- they collide and break
    idempotency. Combined with `policy_type`, this is the unique key
    used to dedupe broadcasts and acceptance records.
    """
    policy_type:        PolicyType
    policy_version:     str  = Field(..., min_length=1, max_length=120)
    title:              str  = Field(..., min_length=1, max_length=200,
                                     description="English title shown in inbox + review screen")
    body:               str  = Field(..., min_length=1, max_length=4000,
                                     description="English body text shown in review screen")
    mandinka_title:     Optional[str] = Field(None, max_length=200)
    mandinka_body:      Optional[str] = Field(None, max_length=4000)
    deadline_days:      int  = Field(..., ge=1, le=90,
                                     description="Default deadline in days, applied to all roles unless overridden")
    deadline_overrides: Optional[Dict[str, int]] = Field(
        None,
        description="Per-role deadline override, e.g. {'vhw':7,'family':14}; falls back to deadline_days otherwise",
    )
    changes_summary:    str  = Field("", max_length=2000)
    target_roles:       Optional[List[str]] = None  # None = all active caregivers


class PolicyNotifyResult(BaseModel):
    policy_type:       str
    policy_version:    str
    notified_count:    int
    skipped_already_accepted: int
    sample_inbox_ids:  List[str]


class PolicyAcceptRequest(BaseModel):
    """
    Caregiver submits acceptance via the inbox review screen.

    Two equivalent shapes are accepted (backwards compatibility kept by
    Pydantic field aliases / Optional checkboxes):

      Canonical (frontend):
        { "typed_signature": "Fatou Jallow", "pin": "1234" }

      Legacy (original section-4 contract, still supported):
        {
          "checkboxes": { ...4 booleans, all true... },
          "typed_name": "Fatou Jallow",
          "pin": "1234"
        }

    Either `typed_signature` OR `typed_name` is required (the API treats
    them as the same field). If `checkboxes` is omitted, the audit record
    stores client_gated=true with the v1 wording reference.
    """
    model_config = {"populate_by_name": True}

    # Accept either typed_signature (canonical) or typed_name (legacy).
    typed_signature: str = Field(
        ...,
        alias="typed_signature",
        validation_alias="typed_signature",
        min_length=2,
        max_length=120,
        description="Caregiver's typed full name as digital signature. "
                    "Legacy clients may send 'typed_name' instead (see typed_name_legacy).",
    )
    pin: str = Field(..., min_length=4, max_length=8)
    checkboxes: Optional[PolicyAcceptanceCheckboxes] = Field(
        None,
        description="Optional. Legacy clients may send the 4 explicit "
                    "checkbox booleans here; new clients gate locally and "
                    "omit this field (audit logs 'client_gated').",
    )

    @classmethod
    def from_either(cls, body: Dict[str, Any]) -> "PolicyAcceptRequest":
        """Accept either { typed_signature, pin } (canonical) or
        { typed_name, pin, checkboxes } (legacy). Normalises typed_name
        -> typed_signature and constructs the model."""
        b = dict(body or {})
        if "typed_signature" not in b and "typed_name" in b:
            b["typed_signature"] = b.pop("typed_name")
        return cls.model_validate(b)


class PolicyAcceptResult(BaseModel):
    status:            str   # "accepted" | "already_accepted"
    acceptance_id:     str
    policy_type:       str
    policy_version:    str
    accepted_at:       str
    inbox_id:          str


class PolicyStatusResponse(BaseModel):
    caregiver_id:      str
    is_suspended:      bool
    suspension_reason: str = ""
    pending_reviews:   List[Dict[str, Any]] = []
    accepted_versions: List[Dict[str, str]] = []  # [{"policy_type":..., "version":..., "accepted_at":...}]


__all__ = [
    "PolicyType",
    "NotificationType",
    "ActionRequired",
    "CaregiverRole",
    "DEFAULT_DEADLINE_DAYS",
    "PolicyAcceptanceCheckboxes",
    "PolicyAcceptance",
    "CaregiverSuspension",
    "PolicyNotifyRequest",
    "PolicyNotifyResult",
    "PolicyAcceptRequest",
    "PolicyAcceptResult",
    "PolicyStatusResponse",
]
