"""
Caregiver Privacy Consent — Phase 2 routes.

Surface:
  POST /api/v1/caregiver/privacy/consent  -> submit acceptance
  GET  /api/v1/caregiver/privacy/status   -> current acceptance state
  GET  /api/v1/caregiver/privacy/version  -> the backend's notice version

These routes are NEVER blocked by the consent gate — they exist
specifically so a caregiver can submit / inspect their own consent.
That matches Phase 2 decision #10 (never block: register, consent
submission, own profile, inbox, health).

Auth pattern is intentionally a copy of the same 7-line
`_require_caregiver` helper used by `caregiver_routes.py`,
`caregiver_application_routes.py`, and `direct_chat_routes.py`. Each
route file is self-contained for auth (project convention).

The flag-gated dependency `require_caregiver_privacy_consent` is
exported from this module so other route files (e.g.
`caregiver_routes.py:list_patients`) can opt in by adding it to
their `dependencies=[...]` list. With the flag default-off, that
addition is a no-op pass-through at runtime.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from src.config import settings
from src.services import caregiver_privacy_consent as cpc

# Phase 9 (AUDIT-005): central append-only audit-event store. Imported
# defensively so a packaging hiccup or DB outage cannot break the route.
# `_safe_audit_event(...)` below wraps every call in try/except so an
# audit-write failure NEVER raises into the user's request.
try:
    from src.services import audit_event_store as _aes  # noqa: F401
    _AUDIT_STORE_AVAILABLE = True
except Exception:
    _aes = None
    _AUDIT_STORE_AVAILABLE = False


def _safe_audit_event(**kwargs) -> None:
    """Best-effort append to the central audit event store. Always
    returns None. Never raises. Drops the event silently if the store
    is unavailable. The store itself enforces PHI-redaction; this
    wrapper just prevents an audit-side outage from leaking up."""
    if not _AUDIT_STORE_AVAILABLE or _aes is None:
        return
    try:
        _aes.append_event(**kwargs)
    except Exception as exc:
        # Defensive double-guard. The store itself is supposed to be
        # fail-soft; if it isn't, we still don't propagate.
        try:
            logging.getLogger(__name__).debug(
                "audit_event append failed (suppressed): %s", exc,
            )
        except Exception:
            pass


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/caregiver/privacy",
    tags=["caregiver-privacy"],
)
security = HTTPBearer(auto_error=False)


# ── Auth helpers (mirror caregiver_routes.py convention) ─────────────
def _get_caregiver_jwt(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=["HS256"],
        )
        if payload.get("role") != "caregiver":
            return None
        return payload
    except Exception:
        return None


def _require_caregiver(
    creds: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    payload = _get_caregiver_jwt(creds.credentials)
    if not payload:
        raise HTTPException(401, "Invalid or expired caregiver token")
    return payload


# ── Pydantic body schemas ────────────────────────────────────────────
class CheckboxState(BaseModel):
    understand_confidential:    Optional[bool] = None
    accept_responsibility:      Optional[bool] = None
    understand_consequences:    Optional[bool] = None
    agree_delete_on_removal:    Optional[bool] = None
    acknowledge_audit:          Optional[bool] = None


class CaregiverConsentRequest(BaseModel):
    # Use the frontend's notice_version (or accept either alias).
    notice_version:        Optional[str] = None
    policy_version:        Optional[str] = None
    privacy_notice_version: Optional[str] = None  # frontend alias

    # Either {id: bool} or [id, ...]. Validated by the service layer.
    consent_checkboxes:    Any = None
    checkboxes:            Any = None

    digital_signature:     str = ""
    consent_timestamp:     Optional[str] = None
    accepted_at:           Optional[str] = None

    # Wizard telemetry (no PHI).
    mandinka_viewed:       bool = False
    scroll_completed:      bool = False
    method:                str = "app"

    # Scout / under-18 path.
    requires_guardian_consent: bool = False
    guardian_consent:          bool = False
    guardian_signature:        str = ""

    class Config:
        extra = "ignore"  # ignore unknown fields; never error on them


class CaregiverConsentResponse(BaseModel):
    status:          str
    record_id:       str
    notice_version:  str
    accepted_at:     str
    method:          str
    role:            str
    required_flag:   bool


class CaregiverConsentStatus(BaseModel):
    """
    Safe consent receipt — never includes raw signature, signature
    hash, guardian signature hash, phone, IP, user-agent, token, or
    checkbox prose. Phase 6.5 extended this from 6 fields to 12 by
    surfacing the wizard-emitted telemetry already stored on each
    CaregiverConsentRecord row (Phase 2 schema). Required for the
    Phase 6 frontend "Download My Consent Record" feature to be a
    complete consent receipt.
    """
    has_current_consent: bool
    notice_version:      str
    accepted_at:         Optional[str]  = None
    record_id:           Optional[str]  = None
    role:                Optional[str]  = None
    required_flag:       bool

    # Phase 6.5: safe stored fields — defaults are conservative
    # (0/false/None) so the no-consent branch returns a structured
    # response without exposing PHI.
    checkbox_count:      Optional[int]  = 0
    checkboxes_accepted: Optional[bool] = False
    guardian_consent:    Optional[bool] = False
    mandinka_viewed:     Optional[bool] = False
    scroll_completed:    Optional[bool] = False
    method:              Optional[str]  = None


# ── Routes ───────────────────────────────────────────────────────────
@router.post("/consent", response_model=CaregiverConsentResponse)
async def submit_caregiver_privacy_consent(
    body: CaregiverConsentRequest,
    caregiver: dict = Depends(_require_caregiver),
) -> CaregiverConsentResponse:
    """
    Idempotent. Re-submitting the same content for the same caregiver
    + version + signature returns status="already_accepted" without
    creating a duplicate row. A new version OR a different signature
    creates a new immutable row.
    """
    caregiver_id = caregiver.get("sub") or caregiver.get("caregiver_id") or ""

    # Phase 10 v1 follow-up — the JWT's `caregiver_role` claim is
    # denormalised metadata, not a hard validation gate. Some legacy
    # caregivers carry their specialisation string (e.g. "Maternal &
    # Child Health") in this slot rather than a canonical role
    # (vhw / cbc / chn / tba / family / scout / alkalo). The validator
    # rejects non-canonical role values with `role_unrecognised`,
    # which would block real caregivers from accepting an updated
    # privacy notice through no fault of their own. Normalise here:
    # if the claim is canonical, pass it; otherwise pass None and let
    # the record store role="unknown". The submission still succeeds.
    raw_role = (caregiver.get("caregiver_role") or "").strip().lower()
    _CANONICAL_ROLES = {"vhw", "cbc", "chn", "tba", "family", "scout", "alkalo"}
    role = raw_role if raw_role in _CANONICAL_ROLES else ""

    payload = body.dict()

    errors = cpc.validate_consent_payload(payload, role=role or None)
    if errors:
        _safe_audit_event(
            event_type="caregiver_privacy.consent.rejected",
            actor_type="caregiver",
            actor_id=caregiver_id,
            subject_type="caregiver",
            subject_id=caregiver_id,
            action="grant",
            resource="/api/v1/caregiver/privacy/consent",
            outcome="failure",
            reason_code="consent_payload_invalid",
            metadata={
                "error_codes":    errors,
                "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
            },
        )
        raise HTTPException(
            status_code=400,
            detail={
                "error":  "consent_payload_invalid",
                "codes":  errors,
                "notice_version_expected": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
            },
        )

    try:
        row = cpc.record_consent(
            caregiver_id=caregiver_id,
            role=role or "unknown",
            payload=payload,
            method=(body.method or "app"),
        )
    except Exception as e:
        logger.warning("caregiver consent record failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail={"error": "consent_storage_failed"},
        )

    cpc.emit_audit_log(
        caregiver_id=caregiver_id,
        role=role or "unknown",
        accepted_at=row.get("accepted_at", ""),
        method=row.get("method", "app"),
        consent_version=row.get("notice_version",
                                cpc.CAREGIVER_PRIVACY_NOTICE_VERSION),
        policy_version=row.get("policy_version",
                               cpc.CAREGIVER_PRIVACY_NOTICE_VERSION),
        action=("captured" if row.get("_status") == "accepted"
                else "reaffirmed"),
    )

    # Phase 9: also append to the central audit store. Fail-soft.
    _safe_audit_event(
        event_type="caregiver_privacy.consent.captured",
        actor_type="caregiver",
        actor_id=caregiver_id,
        subject_type="caregiver",
        subject_id=caregiver_id,
        action="grant",
        resource="/api/v1/caregiver/privacy/consent",
        outcome="success",
        reason_code=("accepted" if row.get("_status") == "accepted"
                     else "already_accepted"),
        metadata={
            "notice_version": row.get("notice_version",
                                      cpc.CAREGIVER_PRIVACY_NOTICE_VERSION),
            "method":         row.get("method", "app"),
            "role":           row.get("role", role or "unknown"),
        },
    )

    return CaregiverConsentResponse(
        status=row.get("_status", "accepted"),
        record_id=row.get("record_id", ""),
        notice_version=row.get("notice_version",
                               cpc.CAREGIVER_PRIVACY_NOTICE_VERSION),
        accepted_at=row.get("accepted_at", ""),
        method=row.get("method", "app"),
        role=row.get("role", role or "unknown"),
        required_flag=cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED,
    )


@router.get("/status", response_model=CaregiverConsentStatus)
async def get_caregiver_privacy_consent_status(
    caregiver: dict = Depends(_require_caregiver),
) -> CaregiverConsentStatus:
    caregiver_id = caregiver.get("sub") or caregiver.get("caregiver_id") or ""
    row = cpc.find_current_consent(caregiver_id) or {}
    _safe_audit_event(
        event_type="caregiver_privacy.status.viewed",
        actor_type="caregiver",
        actor_id=caregiver_id,
        subject_type="caregiver",
        subject_id=caregiver_id,
        action="read",
        resource="/api/v1/caregiver/privacy/status",
        outcome="success",
        reason_code=("has_current_consent" if row else "no_current_consent"),
        metadata={
            "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
            "required_flag":  bool(cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED),
        },
    )
    # Phase 6.5: surface the safe wizard-telemetry fields that are
    # already persisted on the row by `record_consent`. These let the
    # frontend (Phase 6 "Download My Consent Record") build a full
    # consent receipt without a separate /record route. SAFE FIELDS
    # ONLY — the row also contains digital_signature_hash and
    # guardian_signature_hash; both are explicitly NOT surfaced here.
    return CaregiverConsentStatus(
        has_current_consent=bool(row),
        notice_version=cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
        accepted_at=row.get("accepted_at"),
        record_id=row.get("record_id"),
        role=row.get("role"),
        required_flag=cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED,
        checkbox_count=int(row.get("checkbox_count") or 0),
        checkboxes_accepted=bool(row.get("checkboxes_accepted")),
        guardian_consent=bool(row.get("guardian_consent")),
        mandinka_viewed=bool(row.get("mandinka_viewed")),
        scroll_completed=bool(row.get("scroll_completed")),
        method=row.get("method"),
    )


@router.get("/version")
async def get_caregiver_privacy_notice_version() -> Dict[str, Any]:
    """Public — no auth. Lets the frontend confirm the backend version
    without any caregiver context (cheap CORS-friendly check)."""
    return {
        "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
        "required_flag":  cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED,
    }


# ── Reusable gate dependency (importable from other route files) ─────
def require_caregiver_privacy_consent(
    caregiver: dict = Depends(_require_caregiver),
) -> dict:
    """
    Drop-in FastAPI dependency. With the flag off, returns the caller
    transparently. With the flag on, raises HTTP 403 if the caregiver
    has not accepted the current notice version.

    Usage on an existing patient-data caregiver route:

        @router.get("/patients",
                    dependencies=[Depends(require_caregiver_privacy_consent)])
        async def list_patients(caregiver: dict = Depends(_require_caregiver)):
            ...
    """
    caregiver_id = caregiver.get("sub") or caregiver.get("caregiver_id") or ""
    try:
        cpc.check_caregiver_consent_or_raise(caregiver_id)
    except cpc.ConsentRequiredError:
        _safe_audit_event(
            event_type="caregiver_privacy.enforcement.denied",
            actor_type="caregiver",
            actor_id=caregiver_id,
            subject_type="caregiver",
            subject_id=caregiver_id,
            action="check",
            resource="caregiver_privacy_gate",
            outcome="denied",
            reason_code="consent_required",
            metadata={
                "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
                "required_flag":  True,
            },
        )
        raise HTTPException(
            status_code=403,
            detail={
                "error":          "consent_required",
                "code":           "caregiver_privacy_consent_required",
                "message":        "Privacy notice consent required",
                "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
                "submit_url":     "/api/v1/caregiver/privacy/consent",
                "status_url":     "/api/v1/caregiver/privacy/status",
            },
        )
    # Allowed path — only emit when enforcement is on (so we don't
    # spam the audit store with no-op events while flag=false).
    if cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED:
        _safe_audit_event(
            event_type="caregiver_privacy.enforcement.allowed",
            actor_type="caregiver",
            actor_id=caregiver_id,
            subject_type="caregiver",
            subject_id=caregiver_id,
            action="check",
            resource="caregiver_privacy_gate",
            outcome="success",
            reason_code="has_current_consent",
            metadata={
                "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
                "required_flag":  True,
            },
        )
    return caregiver


__all__ = [
    "router",
    "require_caregiver_privacy_consent",
    "CaregiverConsentRequest",
    "CaregiverConsentResponse",
    "CaregiverConsentStatus",
]
