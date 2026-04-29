"""
Caregiver API Routes
=====================
Consent-first, HIPAA-minimum-necessary caregiver proxy access.

Patient flows:
  POST /caregiver/invite          → generate 6-char invite code (24h TTL)
  GET  /caregiver/list            → list my caregivers
  POST /caregiver/revoke          → revoke a caregiver's access

Caregiver flows:
  POST /caregiver/register        → register with invite code
  POST /caregiver/login           → get caregiver JWT
  GET  /caregiver/dashboard       → patient summary (scoped to permissions)
  GET  /caregiver/alerts          → alert history for their patient
  POST /caregiver/chat            → AMINA chat in caregiver mode

Internal:
  POST /caregiver/alert/send      → trigger alert (admin/agent use)
  POST /caregiver/sms/reply       → inbound SMS webhook (Africa's Talking / Twilio)
"""

import json
import random
import string
import logging
from datetime import datetime, timedelta
from typing import Optional, List

import jwt
from fastapi import APIRouter, HTTPException, Depends, Request, UploadFile, File, Form
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from src.config import settings
from src.models.caregiver import (
    CaregiverInviteRequest, CaregiverRegisterRequest, CaregiverLoginRequest,
    CaregiverRevokeRequest, CaregiverAlertRequest,
)
from src.repositories.caregiver_repo import CaregiverRepository
from src.services.caregiver_alerts import (
    send_caregiver_alerts, handle_sms_reply, check_bp_alert, check_glucose_alert,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/caregiver", tags=["caregiver"])
security = HTTPBearer(auto_error=False)

_repo = CaregiverRepository()


# ── JWT helpers ──────────────────────────────────────────────────────────────

def _caregiver_jwt(caregiver_id: str, phone: str, name: str,
                   patient_id: str, permissions: List[str]) -> str:
    payload = {
        "sub":         caregiver_id,
        "phone":       phone,
        "name":        name,
        "role":        "caregiver",
        "patient_id":  patient_id,
        "permissions": permissions,
        "iat":         datetime.utcnow(),
        "exp":         datetime.utcnow() + timedelta(hours=24),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def _get_patient_jwt(token: str) -> Optional[dict]:
    """Verify a patient JWT (no role field = patient)."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("role") in ("admin", "caregiver"):
            return None
        return payload
    except Exception:
        return None


def _get_caregiver_jwt(token: str) -> Optional[dict]:
    """Verify a caregiver JWT."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("role") != "caregiver":
            return None
        return payload
    except Exception:
        return None


def _require_patient(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    payload = _get_patient_jwt(creds.credentials)
    if not payload:
        raise HTTPException(401, "Invalid or expired patient token")
    return payload


def _require_caregiver(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    payload = _get_caregiver_jwt(creds.credentials)
    if not payload:
        raise HTTPException(401, "Invalid or expired caregiver token")
    return payload


# ── Redis helpers ────────────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    return _redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        decode_responses=True,
    )


def _invite_key(code: str) -> str:
    return f"caregiver_invite:{code.upper()}"


def _alert_log_key(patient_id: str) -> str:
    return f"caregiver_alerts:{patient_id}"


# ── Patient endpoints ────────────────────────────────────────────────────────

@router.post("/invite")
async def generate_invite(
    body: CaregiverInviteRequest,
    patient: dict = Depends(_require_patient),
):
    """Patient generates a one-time invite code for a caregiver."""
    code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    redis = _get_redis()
    redis.setex(
        _invite_key(code),
        86400,  # 24h TTL
        json.dumps({
            "patient_id":  patient["sub"],
            "permissions": [p.value if hasattr(p, "value") else p
                            for p in body.permissions],
            "note":        body.note or "",
            "created_at":  datetime.now().isoformat(),
        }),
    )
    return {
        "invite_code":  code,
        "expires_in":   "24 hours",
        "permissions":  body.permissions,
        "message":      f"Share code {code} with your caregiver. Expires in 24 hours.",
    }


@router.get("/list")
async def list_caregivers(patient: dict = Depends(_require_patient)):
    """Patient sees all their caregivers."""
    caregivers = _repo.get_caregivers_for_patient(patient["sub"])
    return {"caregivers": caregivers, "total": len(caregivers)}


@router.post("/revoke")
async def revoke_caregiver(
    body: CaregiverRevokeRequest,
    patient: dict = Depends(_require_patient),
):
    """Patient revokes a caregiver's access."""
    ok = _repo.revoke_access(body.caregiver_id, patient["sub"])
    if not ok:
        raise HTTPException(400, "Could not revoke access")

    # Notify caregiver via SMS
    cg = _repo.get_by_id(body.caregiver_id)
    if cg:
        try:
            from src.services.caregiver_alerts import _route_sms
            _route_sms(
                cg["phone"],
                f"AMINA Care: Your caregiver access for {patient.get('name', 'the patient')} "
                f"has been revoked by the patient.",
            )
        except Exception:
            pass

    return {"message": "Caregiver access revoked", "caregiver_id": body.caregiver_id}


# ── Caregiver registration / login ───────────────────────────────────────────

@router.post("/register")
async def register_caregiver(body: CaregiverRegisterRequest):
    """Caregiver registers using patient's invite code."""
    redis = _get_redis()
    raw = redis.get(_invite_key(body.invite_code))
    if not raw:
        raise HTTPException(400, "Invalid or expired invite code")

    invite = json.loads(raw)
    patient_id = invite["patient_id"]
    permissions = invite["permissions"]

    # Validate PIN
    pin = body.pin.strip()
    if len(pin) != 4 or not pin.isdigit():
        raise HTTPException(400, "PIN must be exactly 4 digits")

    # Create caregiver if not exists
    try:
        cg = _repo.get_by_phone(body.phone)
        if not cg:
            cg = _repo.create(
                phone=body.phone,
                name=body.name,
                pin=pin,
                relationship=body.relationship.value,
            )
        caregiver_id = cg["caregiver_id"]
    except ValueError as e:
        raise HTTPException(409, str(e))

    # Link to patient
    linked = _repo.link_to_patient(
        caregiver_id=caregiver_id,
        patient_id=patient_id,
        permissions=permissions,
        granted_by=patient_id,
        note=invite.get("note", ""),
    )
    if not linked:
        raise HTTPException(500, "Failed to link caregiver to patient")

    # Invalidate invite code (one-time use)
    redis.delete(_invite_key(body.invite_code))

    # Notify patient via SMS
    try:
        import requests as _req
        resp = _req.get(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={"language": "sql",
                  "command": "SELECT phone, name FROM PatientVertex WHERE id = :pid LIMIT 1",
                  "params": {"pid": patient_id}},
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=5,
        )
        rows = resp.json().get("result", [])
        if rows:
            p = rows[0]
            from src.services.caregiver_alerts import _route_sms
            _route_sms(
                p["phone"],
                f"AMINA Care: {body.name} has been granted caregiver access to your "
                f"health profile. Reply STOP to revoke.",
            )
    except Exception as e:
        logger.warning(f"Patient notification failed: {e}")

    token = _caregiver_jwt(caregiver_id, body.phone, body.name, patient_id, permissions)
    return {
        "token":        token,
        "caregiver_id": caregiver_id,
        "patient_id":   patient_id,
        "permissions":  permissions,
        "message":      "Registration successful. You now have caregiver access.",
    }


@router.post("/login")
async def login_caregiver(body: CaregiverLoginRequest):
    """Caregiver logs in with phone + PIN."""
    cg = _repo.verify_pin(body.phone, body.pin)
    if not cg:
        raise HTTPException(401, "Invalid phone or PIN")

    # Get all linked patients
    patients = _repo.get_patients_for_caregiver(cg["caregiver_id"])
    if not patients:
        raise HTTPException(404, "No active patients linked to this caregiver account")

    primary = patients[0]
    permissions = primary.get("_permissions", [])
    limit = int(cg.get("patient_limit") or 10)

    token = _caregiver_jwt(
        cg["caregiver_id"], body.phone, cg["name"],
        primary["id"], permissions,
    )
    return {
        "token":         token,
        "caregiver_id":  cg["caregiver_id"],
        "name":          cg["name"],
        "patient_id":    primary["id"],
        "patient_count": len(patients),
        "patient_limit": limit,
        "permissions":   permissions,
    }


# ── Caregiver profile ────────────────────────────────────────────────────────

@router.get("/profile")
async def get_caregiver_profile(caregiver: dict = Depends(_require_caregiver)):
    """Return own caregiver profile (name, bio, specialization, photo)."""
    cg = _repo.get_by_id(caregiver["sub"])
    if not cg:
        raise HTTPException(404, "Caregiver not found")
    return {
        "caregiver_id":   cg["caregiver_id"],
        "name":           cg.get("name", ""),
        "phone":          cg.get("phone", ""),
        "bio":            cg.get("bio", ""),
        "specialization": cg.get("specialization", ""),
        "profile_photo":  cg.get("profile_photo", ""),
        "created_at":     cg.get("created_at", ""),
        "last_login":     cg.get("last_login", ""),
    }


class UpdateProfileRequest(BaseModel):
    name:           Optional[str] = None
    bio:            Optional[str] = None
    specialization: Optional[str] = None
    profile_photo:  Optional[str] = None   # base64 data-URL ("data:image/jpeg;base64,…")


@router.put("/profile")
async def update_caregiver_profile(
    body: UpdateProfileRequest,
    caregiver: dict = Depends(_require_caregiver),
):
    """Update name, bio, specialization, or profile photo."""
    # Validate photo size if provided (max ~1 MB as base64 ≈ 1.33 MB raw)
    if body.profile_photo and len(body.profile_photo) > 1_400_000:
        raise HTTPException(400, "Photo too large. Please use an image under 1 MB.")

    _repo.update_profile(
        caregiver_id  = caregiver["sub"],
        name          = body.name,
        bio           = body.bio,
        specialization= body.specialization,
        photo         = body.profile_photo,
    )
    updated = _repo.get_by_id(caregiver["sub"]) or {}
    return {
        "message": "Profile updated successfully",
        "profile": {
            "name":           updated.get("name", ""),
            "bio":            updated.get("bio", ""),
            "specialization": updated.get("specialization", ""),
            "profile_photo":  updated.get("profile_photo", ""),
        },
    }


# ── Patient list + limit management ─────────────────────────────────────────

# Phase-2 demonstration of the privacy-consent gate. The dependency is a
# no-op pass-through whenever AMINA_CAREGIVER_PRIVACY_REQUIRED=false
# (default), so existing behaviour is preserved. When that env flag is
# flipped true, this single route returns 403 consent_required for any
# caregiver who has not accepted the current notice version. Other
# patient-data routes will adopt the same dependency in a later phase.
from src.api.caregiver_privacy_routes import (  # noqa: E402  (deliberate inline import)
    require_caregiver_privacy_consent as _require_caregiver_privacy_consent,
)


@router.get(
    "/patients",
    dependencies=[Depends(_require_caregiver_privacy_consent)],
)
async def list_patients(caregiver: dict = Depends(_require_caregiver)):
    """List all patients under this caregiver with their basic info."""
    cg = _repo.get_by_id(caregiver["sub"])
    limit = int(cg.get("patient_limit") or 10) if cg else 10
    patients = _repo.get_patients_for_caregiver(caregiver["sub"])

    summaries = []
    for p in patients:
        perms = p.get("_permissions", [])
        summaries.append({
            "patient_id":   p.get("id"),
            "name":         p.get("name"),
            "age":          p.get("age"),
            "gender":       p.get("gender"),
            "region":       p.get("region"),
            "conditions":   json.loads(p["conditions"]) if isinstance(p.get("conditions"), str) else (p.get("conditions") or []),
            "triage_status": p.get("triage_status") or "STABLE",
            "last_bp":      p.get("last_bp"),
            "last_glucose": p.get("last_glucose"),
            "permissions":  perms,
        })

    return {
        "patients":   summaries,
        "count":      len(summaries),
        "limit":      limit,
        "can_add":    len(summaries) < limit,
        "slots_left": max(0, limit - len(summaries)),
    }


class UpdateLimitRequest(BaseModel):
    limit: int


PLAN_TIERS = [10, 25, 50, 100]


@router.put("/limit")
async def update_patient_limit(
    body: UpdateLimitRequest,
    caregiver: dict = Depends(_require_caregiver),
):
    """Upgrade (or set custom) patient limit. Allowed tiers: 10, 25, 50, 100, or any custom > current."""
    cg = _repo.get_by_id(caregiver["sub"])
    current_limit = int(cg.get("patient_limit") or 10) if cg else 10
    current_count = _repo.get_active_patient_count(caregiver["sub"])

    if body.limit < current_count:
        raise HTTPException(
            400,
            f"Cannot set limit below current patient count ({current_count})",
        )
    if body.limit < 1:
        raise HTTPException(400, "Limit must be at least 1")

    _repo.update_patient_limit(caregiver["sub"], body.limit)
    return {
        "message":     f"Patient limit updated to {body.limit}",
        "old_limit":   current_limit,
        "new_limit":   body.limit,
        "patient_count": current_count,
    }


# ── Patient removal (caregiver-initiated, with justification audit) ──────────

REMOVAL_REASONS = [
    "Patient has recovered and no longer requires caregiver support",
    "Patient relocated outside the caregiver's service area",
    "Patient or family requested removal from the care programme",
    "Duplicate registration — patient is already registered under another caregiver",
    "Patient is deceased (attach certified death certificate)",
    "Caregiver capacity limit reached — patient being transferred to another caregiver",
    "Patient consistently non-compliant and declined further engagement (3+ documented attempts)",
    "Other (see additional notes below)",
]


class RemovePatientRequest(BaseModel):
    patient_id:         str
    reason_code:        int            # 0-based index into REMOVAL_REASONS
    custom_note:        Optional[str] = ""
    additional_notes:   Optional[str] = ""
    caregiver_full_name: Optional[str] = ""   # printed on form (may differ from account name)
    caregiver_title:    Optional[str] = ""    # e.g. "Community Health Worker"


@router.post("/remove-patient")
async def request_patient_removal(
    body: RemovePatientRequest,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Caregiver-initiated patient removal.

    Flow:
      1. Validate the caregiver has active access to this patient.
      2. Validate reason_code and notes.
      3. Store a pending-removal record in Redis (TTL 30 days).
      4. Return all form data needed for the frontend to render + download the PDF.
         (Actual DB revocation happens via POST /caregiver/confirm-removal after
          the signed PDF is returned.)

    Returns: form data dict — the frontend generates the print-ready PDF.
    """
    import uuid
    import redis as redis_lib
    from src.config import settings as cfg

    caregiver_id = caregiver["sub"]

    # Validate access
    if not _repo.is_active_caregiver(caregiver_id, body.patient_id):
        raise HTTPException(403, "You do not have active access to this patient")

    # Validate reason code
    if not (0 <= body.reason_code < len(REMOVAL_REASONS)):
        raise HTTPException(400, f"Invalid reason_code. Must be 0–{len(REMOVAL_REASONS)-1}")

    reason_text = REMOVAL_REASONS[body.reason_code]
    if body.reason_code == len(REMOVAL_REASONS) - 1 and not (body.custom_note or "").strip():
        raise HTTPException(400, "A custom note is required when reason is 'Other'")

    # Load caregiver and patient info for the form
    cg = _repo.get_by_id(caregiver_id) or {}
    patients = _repo.get_patients_for_caregiver(caregiver_id)
    patient_info = next((p for p in patients if p.get("id") == body.patient_id or p.get("patient_id") == body.patient_id), {})

    # Generate reference number
    ref_num = f"AMINA-REM-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    submitted_at = datetime.utcnow().isoformat() + "Z"

    # Store pending removal in Redis (TTL 30 days = 2 592 000 s)
    record = {
        "ref_num":          ref_num,
        "submitted_at":     submitted_at,
        "caregiver_id":     caregiver_id,
        "patient_id":       body.patient_id,
        "reason_code":      body.reason_code,
        "reason_text":      reason_text,
        "custom_note":      body.custom_note or "",
        "additional_notes": body.additional_notes or "",
        "status":           "pending_signature",
    }
    try:
        r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
        r.setex(f"removal:{ref_num}", 2_592_000, json.dumps(record))
        # Also index by caregiver for listing
        r.sadd(f"removals:{caregiver_id}", ref_num)
        r.expire(f"removals:{caregiver_id}", 2_592_000)
    except Exception as e:
        logger.warning(f"remove-patient: Redis store failed (continuing): {e}")

    logger.info(f"remove-patient: ref={ref_num} cg={caregiver_id} patient={body.patient_id} reason={body.reason_code}")

    # Build caregiver display name
    cg_name    = body.caregiver_full_name or cg.get("name", "")
    cg_title   = body.caregiver_title or cg.get("specialization", "Caregiver")
    cg_phone   = cg.get("phone", "")

    # Build patient display info
    p_name     = patient_info.get("name", body.patient_id)
    p_age      = patient_info.get("age", "")
    p_gender   = patient_info.get("gender", "")
    p_region   = patient_info.get("region", "")
    p_id       = body.patient_id

    return {
        "ref_num":          ref_num,
        "submitted_at":     submitted_at,
        "status":           "pending_signature",
        # Form fields for PDF rendering
        "form": {
            "ref_num":           ref_num,
            "submitted_at":      submitted_at,
            "reason_code":       body.reason_code,
            "reason_text":       reason_text,
            "custom_note":       body.custom_note or "",
            "additional_notes":  body.additional_notes or "",
            "caregiver_name":    cg_name,
            "caregiver_title":   cg_title,
            "caregiver_phone":   cg_phone,
            "caregiver_id":      caregiver_id,
            "patient_name":      p_name,
            "patient_age":       str(p_age) if p_age else "",
            "patient_gender":    p_gender,
            "patient_region":    p_region,
            "patient_id":        p_id,
        },
        "next_step": (
            "Print and sign this form. Both the requesting caregiver and a supervising authority "
            "must sign. Return the signed form to the district health office or upload a scan to "
            "confirm removal. Reference number: " + ref_num
        ),
    }


@router.post("/confirm-removal")
async def confirm_patient_removal(
    ref_num: str,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Confirm a pending removal after the signed PDF has been submitted.
    Executes the actual DB revocation.

    In production this would require an authority JWT or uploaded scan.
    For now it accepts the ref_num and caregiver JWT as confirmation.
    """
    import redis as redis_lib
    from src.config import settings as cfg

    caregiver_id = caregiver["sub"]

    # Load pending record
    try:
        r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
        raw = r.get(f"removal:{ref_num}")
    except Exception:
        raw = None

    if not raw:
        raise HTTPException(404, f"Removal request {ref_num} not found or expired")

    record = json.loads(raw)

    if record["caregiver_id"] != caregiver_id:
        raise HTTPException(403, "This removal request belongs to a different caregiver")

    if record["status"] == "completed":
        raise HTTPException(409, "This removal has already been processed")

    patient_id = record["patient_id"]

    # Execute the actual revocation
    ok = _repo.revoke_access(caregiver_id, patient_id)
    if not ok:
        raise HTTPException(500, "Failed to revoke access in database")

    # Update Redis record
    record["status"]       = "completed"
    record["completed_at"] = datetime.utcnow().isoformat() + "Z"
    try:
        r.setex(f"removal:{ref_num}", 2_592_000, json.dumps(record))
    except Exception:
        pass

    logger.info(f"confirm-removal: ref={ref_num} patient={patient_id} cg={caregiver_id} — COMPLETED")

    return {
        "message":    f"Patient {patient_id} has been removed from your panel.",
        "ref_num":    ref_num,
        "patient_id": patient_id,
        "status":     "completed",
    }


@router.get("/removal-requests")
async def list_removal_requests(
    caregiver: dict = Depends(_require_caregiver),
):
    """List all pending and completed removal requests for this caregiver."""
    import redis as redis_lib
    from src.config import settings as cfg

    caregiver_id = caregiver["sub"]
    results = []

    try:
        r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
        ref_nums = r.smembers(f"removals:{caregiver_id}") or set()
        for ref in ref_nums:
            raw = r.get(f"removal:{ref}")
            if raw:
                rec = json.loads(raw)
                results.append({
                    "ref_num":      rec["ref_num"],
                    "patient_id":   rec["patient_id"],
                    "reason_text":  rec["reason_text"],
                    "submitted_at": rec["submitted_at"],
                    "status":       rec["status"],
                })
    except Exception as e:
        logger.warning(f"removal-requests list failed: {e}")

    results.sort(key=lambda x: x["submitted_at"], reverse=True)
    return {"removal_requests": results, "total": len(results)}


# ── Caregiver dashboard ──────────────────────────────────────────────────────

@router.get("/dashboard")
async def caregiver_dashboard(
    pid: Optional[str] = None,
    caregiver: dict = Depends(_require_caregiver),
):
    """Caregiver gets a patient's summary (scoped to permissions). ?pid= overrides JWT patient."""
    patient_id = pid or caregiver["patient_id"]

    # If pid override, verify caregiver actually has access to that patient
    if pid and pid != caregiver["patient_id"]:
        if not _repo.is_active_caregiver(caregiver["sub"], pid):
            raise HTTPException(403, "You do not have access to this patient")

    permissions = caregiver.get("permissions", [])

    # Lazily fire any due alert rules for this caregiver
    try:
        from src.services.patient_alert_service import process_due_rules
        import requests as _req_tg
        tg_resp = _req_tg.post(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={"language": "sql",
                  "command": "SELECT telegram_chat_id FROM PatientVertex WHERE id = :pid LIMIT 1",
                  "params": {"pid": patient_id}},
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=5,
        )
        tg_rows = tg_resp.json().get("result", [])
        patient_tg_id = tg_rows[0].get("telegram_chat_id") if tg_rows else None
        process_due_rules(caregiver["sub"], caregiver["name"], patient_tg_id)
    except Exception as _e:
        logger.warning(f"process_due_rules failed: {_e}")

    # Fetch patient
    import requests as _req
    resp = _req.post(
        f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
        json={"language": "sql",
              "command": "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1",
              "params": {"pid": patient_id}},
        auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
        timeout=10,
    )
    rows = resp.json().get("result", [])
    if not rows:
        raise HTTPException(404, "Patient not found")

    p = rows[0]

    # Parse JSON fields
    for field in ("conditions", "medications", "bp_readings", "glucose_readings"):
        val = p.get(field, "[]")
        if isinstance(val, str):
            try:
                p[field] = json.loads(val)
            except Exception:
                p[field] = []

    # Use stored triage_status as the base; BP readings can escalate it but not downgrade
    _TRIAGE_SEVERITY = {"STABLE": 0, "SELF_CARE": 0, "MONITOR": 1, "CHW_VISIT": 1,
                        "ELEVATED": 2, "FACILITY": 2, "EMERGENCY": 3}
    stored_triage = p.get("triage_status") or "STABLE"

    summary = {
        "patient_id":    p.get("id"),
        "name":          p.get("name"),
        "age":           p.get("age"),
        "conditions":    p.get("conditions", []),
        "triage_status": stored_triage,
    }

    # Vitals (only if permitted)
    if "vitals" in permissions:
        bp_list = p.get("bp_readings", [])
        glu_list = p.get("glucose_readings", [])
        latest_bp  = bp_list[-1] if bp_list else None
        latest_glu = glu_list[-1] if glu_list else None

        # Use structured readings first, fall back to denormalised last_bp string
        summary["latest_bp"] = (
            f"{latest_bp.get('systolic', '?')}/{latest_bp.get('diastolic', '?')} mmHg"
            if latest_bp else p.get("last_bp") or None
        )
        summary["latest_glucose"] = (
            f"{latest_glu.get('value', '?')} mmol/L"
            if latest_glu else (f"{p['last_glucose']} mmol/L" if p.get("last_glucose") else None)
        )
        summary["last_updated"] = (
            (latest_bp.get("recorded_at") if latest_bp else None) or p.get("last_consultation")
        )

        # BP-based escalation — only upgrade triage, never downgrade stored value
        systolic = diastolic = None
        if latest_bp:
            systolic  = float(latest_bp.get("systolic", 0) or 0)
            diastolic = float(latest_bp.get("diastolic", 0) or 0)
        elif p.get("last_bp"):
            try:
                parts = p["last_bp"].replace(" mmHg", "").split("/")
                systolic, diastolic = float(parts[0]), float(parts[1])
            except Exception:
                pass
        if systolic and diastolic:
            alert = check_bp_alert(systolic, diastolic)
            bp_triage = None
            if alert == "emergency_triage":
                bp_triage = "EMERGENCY"
            elif alert == "high_bp":
                bp_triage = "ELEVATED"
            # Only override if BP-derived status is more severe
            if bp_triage and _TRIAGE_SEVERITY.get(bp_triage, 0) > _TRIAGE_SEVERITY.get(stored_triage, 0):
                summary["triage_status"] = bp_triage

    # Medications (only if permitted)
    if "medications" in permissions:
        meds = p.get("medications", [])
        summary["medications"] = [
            m.get("name", m) if isinstance(m, dict) else m for m in meds
        ]

    # Recent consultations (summary only, if permitted)
    if "consultations" in permissions:
        cr = _req.post(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={"language": "sql",
                  "command": "SELECT id, started_at, triage_level, summary "
                             "FROM ConsultationRecord WHERE patient_id = :pid "
                             "ORDER BY started_at DESC LIMIT 5",
                  "params": {"pid": patient_id}},
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=10,
        )
        summary["recent_consultations"] = cr.json().get("result", [])

    return summary


# ── AMINA insights: analyze last 10 patient consultations ────────────────────

def _insights_cache_key(caregiver_id: str, patient_id: str) -> str:
    return f"cg_insights:{caregiver_id}:{patient_id}"


@router.get("/insights")
async def caregiver_insights(
    pid: Optional[str] = None,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    AMINA analyzes the patient's last 10 conversations and returns structured
    key points for the caregiver. Cached in Redis for 1 hour.
    """
    import requests as _req
    from openai import OpenAI

    patient_id = pid or caregiver["patient_id"]

    # Access check
    if pid and pid != caregiver["patient_id"]:
        if not _repo.is_active_caregiver(caregiver["sub"], pid):
            raise HTTPException(403, "You do not have access to this patient")

    redis = _get_redis()
    cache_key = _insights_cache_key(caregiver["sub"], patient_id)

    # Return cached insights if fresh
    cached = redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Fetch last 10 consultations
    resp = _req.post(
        f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
        json={"language": "sql",
              "command": "SELECT started_at, ended_at, triage_level, summary, "
                         "symptoms_reported, recommendations, messages "
                         "FROM ConsultationRecord WHERE patient_id = :pid "
                         "ORDER BY started_at DESC LIMIT 10",
              "params": {"pid": patient_id}},
        auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
        timeout=10,
    )
    consultations = resp.json().get("result", [])

    if not consultations:
        empty = {
            "patient_id": patient_id,
            "total_analyzed": 0,
            "generated_at": datetime.now().isoformat(),
            "narrative": "No consultation history available yet for this patient.",
            "health_trends": [],
            "key_symptoms": [],
            "medication_signals": [],
            "risk_flags": [],
            "recommendations": [],
            "triage_summary": {"SELF_CARE": 0, "CHW_VISIT": 0, "FACILITY": 0, "EMERGENCY": 0},
        }
        redis.setex(cache_key, 3600, json.dumps(empty))
        return empty

    # Build analysis prompt from consultation data
    patient_context = []
    triage_counts = {"SELF_CARE": 0, "CHW_VISIT": 0, "FACILITY": 0, "EMERGENCY": 0}

    for i, c in enumerate(consultations):
        triage = c.get("triage_level", "SELF_CARE")
        if triage in triage_counts:
            triage_counts[triage] += 1

        syms = c.get("symptoms_reported", "[]")
        if isinstance(syms, str):
            try: syms = json.loads(syms)
            except: syms = []

        recs = c.get("recommendations", "[]")
        if isinstance(recs, str):
            try: recs = json.loads(recs)
            except: recs = []

        patient_context.append(
            f"Consultation {i+1} ({c.get('started_at','')[:10]}) — "
            f"Triage: {triage}\n"
            f"Summary: {c.get('summary','No summary')}\n"
            f"Symptoms: {', '.join(syms) if syms else 'none reported'}\n"
            f"Recommendations: {'; '.join(recs) if recs else 'none'}"
        )

    context_text = "\n\n".join(patient_context)

    prompt = f"""You are AMINA, an AI health assistant reviewing a patient's last {len(consultations)} consultations to create a caregiver briefing.

Patient consultation history:
{context_text}

Analyze this history and provide a structured JSON response with these exact keys:
- "narrative": 2-3 sentence overall health narrative for the caregiver
- "health_trends": list of 3-5 strings describing observable trends (improving/worsening/stable patterns)
- "key_symptoms": list of the most significant recurring symptoms
- "medication_signals": list of observations about medication adherence or side effects mentioned
- "risk_flags": list of any concerning patterns or red flags the caregiver should know about
- "recommendations": list of 3-4 practical actions the caregiver can support

Respond ONLY with valid JSON, no extra text."""

    try:
        client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=800,
            response_format={"type": "json_object"},
        )
        analysis = json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"Insights LLM call failed: {e}")
        # Fallback: aggregate without LLM
        all_symptoms = []
        all_recs = []
        for c in consultations:
            s = c.get("symptoms_reported", "[]")
            r = c.get("recommendations", "[]")
            if isinstance(s, str):
                try: s = json.loads(s)
                except: s = []
            if isinstance(r, str):
                try: r = json.loads(r)
                except: r = []
            all_symptoms.extend(s)
            all_recs.extend(r)

        analysis = {
            "narrative": f"Patient has had {len(consultations)} consultations. "
                         f"{triage_counts.get('FACILITY',0)} required facility visits.",
            "health_trends": ["Data aggregated from consultation history"],
            "key_symptoms": list(dict.fromkeys(all_symptoms))[:6],
            "medication_signals": [],
            "risk_flags": ["Manual review recommended" if triage_counts.get("FACILITY",0) > 1 else "No critical flags"],
            "recommendations": list(dict.fromkeys(all_recs))[:4],
        }

    result = {
        "patient_id":      patient_id,
        "total_analyzed":  len(consultations),
        "generated_at":    datetime.now().isoformat(),
        "triage_summary":  triage_counts,
        **analysis,
    }

    redis.setex(cache_key, 3600, json.dumps(result))
    return result


@router.get("/alerts")
async def get_alerts(caregiver: dict = Depends(_require_caregiver)):
    """Alert history for the caregiver's patient (last 30)."""
    redis = _get_redis()
    raw_alerts = redis.lrange(_alert_log_key(caregiver["patient_id"]), 0, 29)
    alerts = []
    for raw in raw_alerts:
        try:
            alerts.append(json.loads(raw))
        except Exception:
            pass
    return {"alerts": alerts, "total": len(alerts)}


# ── AMINA chat in caregiver mode ─────────────────────────────────────────────

class CaregiverChatRequest(BaseModel):
    message: str
    patient_id: Optional[str] = None   # overrides JWT patient_id when caregiver has multiple patients
    session_id: Optional[str] = None
    model_preference: Optional[str] = None  # "base"|"gemini"|"groq"|"mistral"|"amina"


@router.post("/chat")
async def caregiver_chat(
    body: CaregiverChatRequest,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    AMINA clinical briefing pipeline for caregivers.

    Unlike the patient pipeline (conversational, asks follow-up questions),
    this pipeline synthesises the patient's consultation history, vitals, and
    behavior profile into data-grounded reports — never asking questions back.
    """
    from src.services.caregiver_amina_service import caregiver_amina_chat

    # Resolve patient: body overrides JWT (multi-patient caregivers)
    patient_id = body.patient_id or caregiver.get("patient_id", "")

    # Verify caregiver has access to this patient
    if patient_id and patient_id != caregiver.get("patient_id"):
        if not _repo.is_active_caregiver(caregiver["sub"], patient_id):
            raise HTTPException(403, "You do not have access to this patient")

    result = await caregiver_amina_chat(
        message=body.message,
        caregiver_id=caregiver["sub"],
        caregiver_name=caregiver.get("name", "Caregiver"),
        patient_id=patient_id,
        session_id=body.session_id,
        model_preference=body.model_preference,
    )
    return result


# ── Voice chat endpoint ──────────────────────────────────────────────────────

@router.post("/voice-chat")
async def caregiver_voice_chat(
    file:       UploadFile = File(...),
    patient_id: str        = Form(default=""),
    session_id: str        = Form(default=""),
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Voice pipeline for caregiver AMINA:
      1. Whisper STT  → transcript
      2. caregiver_amina_chat()  → clinical response text
      3. Piper TTS  → WAV audio bytes (base64 in JSON)

    Returns JSON:
      { transcript, response, action, has_audio, audio_b64, citations, ... }
    """
    import base64
    from src.services.stt_whisper import transcribe
    from src.services.tts_piper import synthesize
    from src.services.caregiver_amina_service import caregiver_amina_chat

    # ── 1. Read and transcribe audio ──────────────────────────────────────────
    audio_bytes = await file.read()
    if not audio_bytes or len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file is empty or too short")

    transcript = await transcribe(audio_bytes, file.filename or "audio.webm")
    if not transcript or not transcript.strip():
        raise HTTPException(status_code=422, detail="Could not transcribe audio — please try again")

    logger.info(f"caregiver_voice: transcript='{transcript[:80]}...'")

    # ── 2. Resolve patient access ─────────────────────────────────────────────
    resolved_patient_id = patient_id or caregiver.get("patient_id", "")
    if resolved_patient_id and resolved_patient_id != caregiver.get("patient_id"):
        if not _repo.is_active_caregiver(caregiver["sub"], resolved_patient_id):
            raise HTTPException(403, "You do not have access to this patient")

    # ── 3. Run caregiver intelligence pipeline ────────────────────────────────
    result = await caregiver_amina_chat(
        message      = transcript,
        caregiver_id = caregiver["sub"],
        caregiver_name = caregiver.get("name", "Caregiver"),
        patient_id   = resolved_patient_id,
        session_id   = session_id or None,
    )

    response_text = result.get("response", "")

    # ── 4. TTS synthesis ──────────────────────────────────────────────────────
    # Only synthesise if response is not a full briefing (too long for TTS)
    action = result.get("action", "question")
    tts_text = response_text
    if action == "report" and len(response_text) > 800:
        # For long reports, synthesise a short summary lead-in instead
        lines = [l.strip() for l in response_text.split("\n") if l.strip() and "**" not in l]
        tts_text = " ".join(lines[:3])[:400]

    audio_bytes_out = await synthesize(tts_text)
    has_audio = bool(audio_bytes_out and len(audio_bytes_out) > 100)
    audio_b64 = base64.b64encode(audio_bytes_out).decode() if has_audio else ""

    return {
        **result,
        "transcript": transcript,
        "has_audio":  has_audio,
        "audio_b64":  audio_b64,
    }


# ── Alert send endpoint (internal / admin) ───────────────────────────────────

@router.post("/alert/send")
async def send_alert(body: CaregiverAlertRequest):
    """Trigger an alert SMS to all caregivers of a patient.
    Called by the vitals update endpoint, agent, or nudge scheduler.
    """
    redis = _get_redis()

    # Get caregivers for patient
    caregivers = _repo.get_caregivers_for_patient(body.patient_id)
    active_phones = [
        cg["phone"] for cg in caregivers
        if not cg.get("is_revoked") and "alerts" in cg.get("permissions", [])
    ]

    if not active_phones:
        return {"message": "No active caregivers with alert permission", "sent": 0}

    results = send_caregiver_alerts(
        patient_id=body.patient_id,
        patient_name="your patient",
        alert_type=body.alert_type,
        caregiver_phones=active_phones,
        severity=body.severity,
        message=body.message,
    )

    # Log alert to Redis
    alert_record = {
        "alert_id":   str(__import__("uuid").uuid4())[:8],
        "alert_type": body.alert_type,
        "message":    body.message,
        "severity":   body.severity,
        "sent_to":    len([r for r in results if r["sent"]]),
        "created_at": datetime.now().isoformat(),
    }
    redis.lpush(_alert_log_key(body.patient_id), json.dumps(alert_record))
    redis.ltrim(_alert_log_key(body.patient_id), 0, 99)  # keep last 100

    return {
        "sent":    len([r for r in results if r["sent"]]),
        "failed":  len([r for r in results if not r["sent"]]),
        "results": results,
    }


# ── Patient alert endpoints ──────────────────────────────────────────────────

class SendPatientAlertRequest(BaseModel):
    patient_id: str
    message: str
    severity: str = "info"           # info | warning | emergency
    use_telegram: bool = False        # push to Telegram if patient has chat_id linked


class AlertRuleRequest(BaseModel):
    patient_id: str
    label: str
    message: str
    severity: str = "info"
    frequency: str = "daily"         # daily | weekly | hourly
    send_time: Optional[str] = "09:00"
    interval_hours: Optional[int] = None


@router.post("/send-patient-alert")
async def send_patient_alert_endpoint(
    body: SendPatientAlertRequest,
    caregiver: dict = Depends(_require_caregiver),
):
    """Caregiver manually sends an alert to a patient (queued in Redis + optional Telegram)."""
    from src.services.patient_alert_service import send_patient_alert

    # Verify caregiver has access to this patient
    if body.patient_id != caregiver["patient_id"]:
        if not _repo.is_active_caregiver(caregiver["sub"], body.patient_id):
            raise HTTPException(403, "You do not have access to this patient")

    # Resolve Telegram chat_id for the patient if escalation requested
    telegram_chat_id = None
    if body.use_telegram:
        import requests as _req
        resp = _req.post(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={"language": "sql",
                  "command": "SELECT telegram_chat_id FROM PatientVertex WHERE id = :pid LIMIT 1",
                  "params": {"pid": body.patient_id}},
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=5,
        )
        rows = resp.json().get("result", [])
        if rows:
            telegram_chat_id = rows[0].get("telegram_chat_id")

    alert = send_patient_alert(
        patient_id=body.patient_id,
        caregiver_name=caregiver["name"],
        message=body.message,
        severity=body.severity,
        telegram_chat_id=telegram_chat_id,
    )
    return {"alert": alert, "telegram_chat_id": telegram_chat_id}


@router.post("/alert-rules")
async def create_alert_rule_endpoint(
    body: AlertRuleRequest,
    caregiver: dict = Depends(_require_caregiver),
):
    """Create an automated alert rule that fires on schedule."""
    from src.services.patient_alert_service import create_alert_rule

    if body.patient_id != caregiver["patient_id"]:
        if not _repo.is_active_caregiver(caregiver["sub"], body.patient_id):
            raise HTTPException(403, "You do not have access to this patient")

    rule = create_alert_rule(
        caregiver_id=caregiver["sub"],
        patient_id=body.patient_id,
        label=body.label,
        message=body.message,
        severity=body.severity,
        frequency=body.frequency,
        send_time=body.send_time,
        interval_hours=body.interval_hours,
    )
    return {"rule": rule}


@router.get("/alert-rules")
async def get_alert_rules_endpoint(
    pid: Optional[str] = None,
    caregiver: dict = Depends(_require_caregiver),
):
    """List all alert rules for this caregiver (optionally filtered by patient)."""
    from src.services.patient_alert_service import get_alert_rules

    rules = get_alert_rules(caregiver["sub"])
    if pid:
        rules = [r for r in rules if r.get("patient_id") == pid]
    return {"rules": rules, "total": len(rules)}


@router.delete("/alert-rules/{rule_id}")
async def delete_alert_rule_endpoint(
    rule_id: str,
    caregiver: dict = Depends(_require_caregiver),
):
    """Delete an alert rule by ID."""
    from src.services.patient_alert_service import delete_alert_rule

    ok = delete_alert_rule(caregiver["sub"], rule_id)
    if not ok:
        raise HTTPException(404, "Rule not found")
    return {"message": "Rule deleted", "rule_id": rule_id}


# ── Inbound SMS webhook ──────────────────────────────────────────────────────

@router.post("/sms/reply")
async def sms_reply_webhook(request: Request):
    """
    Inbound SMS webhook for Africa's Talking and Twilio.
    Both send POST with 'from'/'From' and 'text'/'Body' fields.
    """
    form = await request.form()
    from_phone = form.get("from") or form.get("From") or ""
    message    = form.get("text") or form.get("Body") or ""

    if not from_phone or not message:
        return {"message": "ignored"}

    response = handle_sms_reply(from_phone, message.strip())
    if response:
        # Send response back
        from src.services.caregiver_alerts import _route_sms
        _route_sms(from_phone, response)

    return {"message": "processed"}


# ── Access assertion helper ──────────────────────────────────────────────────

def _assert_patient_access(caregiver: dict, patient_id: str) -> None:
    """Raise 403 if caregiver does not have active access to patient_id."""
    if patient_id == caregiver.get("patient_id"):
        return
    if not _repo.is_active_caregiver(caregiver["sub"], patient_id):
        raise HTTPException(403, "You do not have access to this patient")


# ═══════════════════════════════════════════════════════════════════════════════
# Tier 1 — Predictive Risk endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/predictions/{patient_id}")
async def get_patient_predictions(
    patient_id: str,
    force_refresh: bool = False,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Return the Clinical Risk Index (CRI) and 7-day vital trajectory
    for a specific patient.

    Query param: ?force_refresh=true  — bypass Redis cache
    """
    _assert_patient_access(caregiver, patient_id)

    from src.services.caregiver_amina_service import _load_patient_data
    from src.services.predictive_engine import compute_cri

    try:
        patient_data = await _load_patient_data(patient_id)
        patient_name = patient_data["profile"].get("name", "")
        risk = compute_cri(
            patient_id   = patient_id,
            patient_data = patient_data,
            patient_name = patient_name,
            force_refresh= force_refresh,
        )
        return {
            "patient_id":       patient_id,
            "cri":              risk.cri,
            "cri_label":        risk.cri_label,
            "escalation_prob":  risk.escalation_prob,
            "adherence_decay":  risk.adherence_decay,
            "warnings":         risk.warnings,
            "proactive_message": risk.proactive_message,
            "vital_forecasts": [
                {
                    "vital":           vf.vital,
                    "current":         vf.current,
                    "projected_7d":    vf.projected_7d,
                    "slope_per_day":   vf.slope_per_day,
                    "breaches_target": vf.breaches_target,
                    "target":          vf.target,
                    "warning":         vf.warning,
                }
                for vf in risk.vital_forecasts
            ],
            "computed_at": risk.computed_at,
        }
    except Exception as e:
        logger.error(f"predictions: failed for {patient_id}: {e}")
        raise HTTPException(500, "Failed to compute predictive risk")


# ═══════════════════════════════════════════════════════════════════════════════
# Tier 3 — Population Cluster / Panel endpoints
# ═══════════════════════════════════════════════════════════════════════════════

async def _build_panel_records(caregiver_id: str, caregiver: dict) -> list:
    """
    Build the list of patient records for cluster detection.
    Each record includes CRI, SDOH, urgency, recent symptoms.
    """
    from src.services.caregiver_amina_service import _load_patient_data
    from src.services.predictive_engine import compute_cri
    from src.services.sdoh_service import get_sdoh_score

    try:
        patients = _repo.get_patients_for_caregiver(caregiver_id)
    except Exception:
        patients = []

    records = []
    for p in patients:
        pid  = p.get("id", "")
        name = p.get("name", "Unknown")
        if not pid:
            continue
        try:
            data = await _load_patient_data(pid)
            profile = data.get("profile", {})
            region  = profile.get("region", "unknown")

            # Latest symptoms from most recent consultation
            consults = data.get("consultations", [])
            recent_syms: list = []
            if consults:
                latest = consults[0]
                recent_syms = latest.get("symptoms_reported", [])
                if latest.get("summary"):
                    recent_syms.append(latest["summary"])

            # CRI
            cri_val = 0.0
            cri_label = "unknown"
            try:
                risk = compute_cri(pid, data, name)
                cri_val   = risk.cri
                cri_label = risk.cri_label
            except Exception:
                pass

            # SDOH
            sdoh_label = "unknown"
            sdoh_score_val = 0.3
            try:
                sd = get_sdoh_score(pid, profile, caregiver)
                sdoh_label     = sd.sdoh_label
                sdoh_score_val = sd.overall_sdoh_score
            except Exception:
                pass

            records.append({
                "patient_id":      pid,
                "patient_name":    name,
                "region":          region,
                "cri":             cri_val,
                "cri_label":       cri_label,
                "urgency_score":   0,   # populated below if enrichment available
                "sdoh_label":      sdoh_label,
                "sdoh_score":      sdoh_score_val,
                "clinical_flags":  [],
                "recent_symptoms": recent_syms,
                "last_visit_date": consults[0].get("started_at", "") if consults else "",
            })
        except Exception as e:
            logger.warning(f"panel: failed to load {pid}: {e}")

    return records


@router.get("/panel")
async def get_patient_panel(
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 3 — Return the full CHW priority queue for this caregiver's panel.
    Patients are ranked by composite CRI × SDOH × urgency score.
    """
    caregiver_id = caregiver["sub"]

    try:
        records = await _build_panel_records(caregiver_id, caregiver)
        from src.services.cluster_detector import detect_clusters
        report = detect_clusters(records)

        return {
            "panel_size":      report.panel_size,
            "has_emergency":   report.has_emergency,
            "has_alerts":      report.has_alerts,
            "alert_summary":   report.alert_summary,
            "priority_queue": [
                {
                    "rank":               p.rank,
                    "patient_id":         p.patient_id,
                    "patient_name":       p.patient_name,
                    "region":             p.region,
                    "composite_score":    p.composite_score,
                    "cri":                p.cri,
                    "urgency_score":      p.urgency_score,
                    "sdoh_label":         p.sdoh_label,
                    "top_flags":          p.top_flags,
                    "recommended_action": p.recommended_action,
                }
                for p in report.priority_queue
            ],
            "heatmap": [
                {
                    "region":          h.region,
                    "patient_count":   h.patient_count,
                    "high_risk_count": h.high_risk_count,
                    "dominant_symptom":h.dominant_symptom,
                    "alert_level":     h.alert_level,
                }
                for h in report.heatmap
            ],
            "generated_at": report.generated_at,
        }
    except Exception as e:
        logger.error(f"panel: cluster detection failed: {e}")
        raise HTTPException(500, "Failed to build patient panel")


@router.get("/cluster-alerts")
async def get_cluster_alerts(
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 3 — Return active outbreak pattern alerts across this caregiver's panel.
    Only returns alerts with severity 'watch', 'alert', or 'emergency'.
    """
    caregiver_id = caregiver["sub"]

    try:
        records = await _build_panel_records(caregiver_id, caregiver)
        from src.services.cluster_detector import detect_clusters
        report = detect_clusters(records)

        return {
            "panel_size":    report.panel_size,
            "has_emergency": report.has_emergency,
            "alert_count":   len(report.outbreak_alerts),
            "alerts": [
                {
                    "disease":         a.disease,
                    "severity":        a.severity,
                    "confirmed_cases": a.confirmed_cases,
                    "region":          a.region,
                    "detected_at":     a.detected_at,
                    "matched_symptoms":a.matched_symptoms,
                    "confidence":      a.confidence,
                    "action_required": a.action_required,
                    "who_reportable":  a.who_reportable,
                }
                for a in report.outbreak_alerts
            ],
            "symptom_clusters": [
                {
                    "symptom":       c.symptom,
                    "patient_count": c.patient_count,
                    "frequency_7d":  c.frequency_7d,
                    "frequency_14d": c.frequency_14d,
                    "trend_label":   c.trend_label,
                    "is_trending":   c.is_trending,
                }
                for c in report.symptom_clusters[:10]
            ],
            "generated_at": report.generated_at,
        }
    except Exception as e:
        logger.error(f"cluster-alerts: failed: {e}")
        raise HTTPException(500, "Failed to generate cluster alerts")


@router.get("/weekly-digest")
async def get_weekly_digest(
    force: bool = False,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 3 — Return weekly digest for this caregiver's panel.
    Uses lazy scheduling (no daemon): returns None if digest is not yet due,
    unless ?force=true is passed.

    Uses Redis key  digest_ts:{caregiver_id}  to track last generation timestamp.
    """
    import redis as redis_lib
    from src.config import settings as cfg

    caregiver_id = caregiver["sub"]

    # Check schedule
    last_digest_iso = None
    try:
        r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
        last_digest_iso = r.get(f"digest_ts:{caregiver_id}")
    except Exception:
        pass

    try:
        records = await _build_panel_records(caregiver_id, caregiver)
        from src.services.cluster_detector import build_weekly_digest

        digest = build_weekly_digest(
            caregiver_id    = caregiver_id,
            patient_records = records,
            last_digest_iso = None if force else last_digest_iso,
        )

        if digest is None:
            return {
                "due": False,
                "message": "Weekly digest not due yet. Use ?force=true to generate immediately.",
                "last_generated": last_digest_iso,
            }

        # Persist the generation timestamp
        try:
            r.setex(f"digest_ts:{caregiver_id}", 86400 * 8, digest.generated_at)
        except Exception:
            pass

        return {
            "due":                  True,
            "generated_at":         digest.generated_at,
            "panel_size":           digest.panel_size,
            "critical_patients":    digest.critical_patients,
            "new_outbreak_alerts":  digest.new_outbreak_alerts,
            "top_symptoms":         digest.top_symptoms,
            "summary_text":         digest.summary_text,
            "priority_queue": [
                {
                    "rank":               p.rank,
                    "patient_id":         p.patient_id,
                    "patient_name":       p.patient_name,
                    "composite_score":    p.composite_score,
                    "cri":                p.cri,
                    "recommended_action": p.recommended_action,
                }
                for p in digest.priority_queue[:10]
            ],
            "outbreak_alerts": [
                {
                    "disease":         a.disease,
                    "severity":        a.severity,
                    "confirmed_cases": a.confirmed_cases,
                    "region":          a.region,
                    "action_required": a.action_required,
                }
                for a in digest.outbreak_alerts
            ],
            "heatmap": [
                {
                    "region":      h.region,
                    "alert_level": h.alert_level,
                    "high_risk":   h.high_risk_count,
                }
                for h in digest.heatmap
            ],
        }
    except Exception as e:
        logger.error(f"weekly-digest: failed for {caregiver_id}: {e}")
        raise HTTPException(500, "Failed to generate weekly digest")


# ═══════════════════════════════════════════════════════════════════════════════
# Tier 4 — Automated Care Protocol endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/care-plan/{patient_id}")
async def get_care_plan(
    patient_id: str,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 4 — Return the current care plan for a patient.
    Care plans are auto-generated when the caregiver generates a SOAP report.
    If no plan exists yet, returns 404.
    """
    _assert_patient_access(caregiver, patient_id)

    import redis as redis_lib
    from src.config import settings as cfg
    from src.services.care_protocol_engine import get_care_plan as _get_plan

    r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
    plan = _get_plan(patient_id, r)
    if not plan:
        raise HTTPException(404, "No care plan found for this patient. Generate a clinical report first.")

    return {
        "plan_id":          plan.plan_id,
        "patient_id":       plan.patient_id,
        "patient_name":     plan.patient_name,
        "caregiver_id":     plan.caregiver_id,
        "generated_at":     plan.generated_at,
        "overall_status":   plan.overall_status,
        "completion_pct":   plan.completion_pct,
        "overdue_count":    plan.overdue_count,
        "items": [
            {
                "task_id":      item.task_id,
                "category":     item.category,
                "description":  item.description,
                "rationale":    item.rationale,
                "due_date":     item.due_date,
                "priority":     item.priority,
                "responsible":  item.responsible,
                "status":       item.status,
                "completed_at": item.completed_at,
                "skipped_reason": item.skipped_reason,
            }
            for item in plan.items
        ],
    }


class TaskActionRequest(BaseModel):
    note: Optional[str] = ""


@router.post("/care-plan/{patient_id}/task/{task_id}/complete")
async def complete_care_task(
    patient_id: str,
    task_id: str,
    body: TaskActionRequest = TaskActionRequest(),
    caregiver: dict = Depends(_require_caregiver),
):
    """Mark a care plan task as completed."""
    _assert_patient_access(caregiver, patient_id)

    import redis as redis_lib
    from src.config import settings as cfg
    from src.services.care_protocol_engine import complete_task as _complete

    r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
    plan = _complete(patient_id, task_id, r)
    if not plan:
        raise HTTPException(404, "Care plan or task not found")

    # Record activity
    try:
        from src.services.burnout_monitor import record_activity, ACTIVITY_TASK_DONE
        record_activity(caregiver["sub"], ACTIVITY_TASK_DONE, r)
    except Exception:
        pass

    return {
        "message":       f"Task {task_id} marked as completed",
        "completion_pct": plan.completion_pct,
        "overdue_count":  plan.overdue_count,
        "overall_status": plan.overall_status,
    }


@router.post("/care-plan/{patient_id}/task/{task_id}/skip")
async def skip_care_task(
    patient_id: str,
    task_id: str,
    body: TaskActionRequest = TaskActionRequest(),
    caregiver: dict = Depends(_require_caregiver),
):
    """Mark a care plan task as skipped with an optional reason."""
    _assert_patient_access(caregiver, patient_id)

    import redis as redis_lib
    from src.config import settings as cfg
    from src.services.care_protocol_engine import skip_task as _skip

    r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
    reason = (body.note or "").strip() or "Skipped by caregiver"
    plan = _skip(patient_id, task_id, reason, r)
    if not plan:
        raise HTTPException(404, "Care plan or task not found")

    return {
        "message":       f"Task {task_id} skipped",
        "completion_pct": plan.completion_pct,
        "overall_status": plan.overall_status,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Tier 5 — Caregiver Performance & Burnout Monitor endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/burnout-risk")
async def get_burnout_risk(
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 5 — Return current burnout risk score for this caregiver.
    Combines caseload complexity, task backlog, and activity signals.
    """
    caregiver_id = caregiver["sub"]

    import redis as redis_lib
    from src.config import settings as cfg
    from src.services.burnout_monitor import compute_burnout_risk

    try:
        r       = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
        records = await _build_panel_records(caregiver_id, caregiver)
        risk    = compute_burnout_risk(caregiver_id, records, r)

        return {
            "burnout_score":   risk.burnout_score,
            "burnout_label":   risk.burnout_label,
            "burnout_message": risk.burnout_message,
            "computed_at":     risk.computed_at,
            "caseload": {
                "total_patients":       risk.caseload.total_patients,
                "high_risk_count":      risk.caseload.high_risk_count,
                "critical_count":       risk.caseload.critical_count,
                "avg_cri":              risk.caseload.avg_cri,
                "caseload_ratio":       risk.caseload.caseload_ratio,
                "region_spread":        risk.caseload.region_spread,
                "complexity_score":     risk.caseload.complexity_score,
            },
            "tasks": {
                "overdue_count":        risk.tasks.overdue_count,
                "completed_last_7d":    risk.tasks.completed_last_7d,
                "completion_rate_7d":   risk.tasks.completion_rate_7d,
            },
            "activity": {
                "visits_last_7d":       risk.activity.visits_last_7d,
                "soap_notes_last_7d":   risk.activity.soap_notes_last_7d,
                "last_activity_date":   risk.activity.last_activity_date,
                "days_since_activity":  risk.activity.days_since_activity,
                "inactivity_flag":      risk.activity.inactivity_flag,
            },
            "risk_factors": [
                {"factor": f.factor, "severity": f.severity, "detail": f.detail}
                for f in risk.risk_factors
            ],
            "recommendations": risk.recommendations,
        }
    except Exception as e:
        logger.error(f"burnout-risk: failed for {caregiver_id}: {e}")
        raise HTTPException(500, "Failed to compute burnout risk")


@router.get("/performance")
async def get_performance_report(
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 5 — Return 7-day performance report for this caregiver.
    Includes highlights, improvement areas, and burnout risk summary.
    """
    caregiver_id = caregiver["sub"]

    import redis as redis_lib
    from src.config import settings as cfg
    from src.services.burnout_monitor import get_performance_report as _get_report

    try:
        r       = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
        records = await _build_panel_records(caregiver_id, caregiver)
        report  = _get_report(caregiver_id, records, r)

        return {
            "caregiver_id":      report.caregiver_id,
            "period_start":      report.period_start,
            "period_end":        report.period_end,
            "patients_managed":  report.patients_managed,
            "visits_completed":  report.visits_completed,
            "soap_notes_created": report.soap_notes_created,
            "care_tasks_done":   report.care_tasks_done,
            "highlights":        report.highlights,
            "improvement_areas": report.improvement_areas,
            "burnout_score":     report.burnout_risk.burnout_score,
            "burnout_label":     report.burnout_risk.burnout_label,
            "burnout_message":   report.burnout_risk.burnout_message,
            "risk_factors": [
                {"factor": f.factor, "severity": f.severity, "detail": f.detail}
                for f in report.burnout_risk.risk_factors
            ],
        }
    except Exception as e:
        logger.error(f"performance: failed for {caregiver_id}: {e}")
        raise HTTPException(500, "Failed to generate performance report")


# ═══════════════════════════════════════════════════════════════════════════════
# Tier 6 — Longitudinal Outcome Tracker endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/outcomes/{patient_id}")
async def get_patient_outcomes(
    patient_id: str,
    force: bool = False,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 6 — Return longitudinal outcome summary for a patient.
    Shows CRI trajectory over 30 / 90 / 180-day windows + sparkline.
    """
    _assert_patient_access(caregiver, patient_id)

    import redis as redis_lib
    from src.config import settings as cfg
    from src.services.outcome_tracker import get_patient_outcomes as _get_outcomes

    r = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
    summary = _get_outcomes(patient_id, r, force=force)
    if not summary:
        return {
            "patient_id":   patient_id,
            "has_data":     False,
            "message":      "No outcome data available yet. CRI snapshots are recorded each time a clinical report is generated.",
        }

    return {
        "has_data":            True,
        "patient_id":          summary.patient_id,
        "computed_at":         summary.computed_at,
        "current_cri":         summary.current_cri,
        "current_label":       summary.current_label,
        "overall_trajectory":  summary.overall_trajectory,
        "interpretation":      summary.interpretation,
        "snapshot_count":      summary.snapshot_count,
        "first_recorded":      summary.first_recorded,
        "deltas": [
            {
                "days":          d.days,
                "baseline_cri":  d.baseline_cri,
                "current_cri":   d.current_cri,
                "delta":         d.delta,
                "trajectory":    d.trajectory,
                "baseline_date": d.baseline_date,
            }
            for d in summary.deltas
        ],
        "sparkline": [
            {"date": p.date, "cri": p.cri}
            for p in summary.sparkline
        ],
    }


@router.get("/population-outcomes")
async def get_population_outcomes(
    force: bool = False,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Tier 6 — Return aggregated outcome statistics across the caregiver's full panel.
    Shows improving / stable / declining / critical patient counts and improvement rate.
    """
    caregiver_id = caregiver["sub"]

    import redis as redis_lib
    from src.config import settings as cfg
    from src.services.outcome_tracker import get_population_outcomes as _get_pop

    try:
        r       = redis_lib.Redis(host=cfg.REDIS_HOST, port=cfg.REDIS_PORT, decode_responses=True)
        records = await _build_panel_records(caregiver_id, caregiver)
        pop     = _get_pop(caregiver_id, records, r, force=force)

        return {
            "caregiver_id":     pop.caregiver_id,
            "computed_at":      pop.computed_at,
            "total_patients":   pop.total_patients,
            "avg_cri":          pop.avg_cri,
            "improving_count":  pop.improving_count,
            "stable_count":     pop.stable_count,
            "declining_count":  pop.declining_count,
            "critical_count":   pop.critical_count,
            "new_count":        pop.new_count,
            "improvement_rate": pop.improvement_rate,
            "trajectory_groups": [
                {
                    "label":      g.label,
                    "count":      g.count,
                    "proportion": g.proportion,
                    "avg_cri":    g.avg_cri,
                }
                for g in pop.trajectory_groups
            ],
            "recommendations": pop.recommendations,
        }
    except Exception as e:
        logger.error(f"population-outcomes: failed for {caregiver_id}: {e}")
        raise HTTPException(500, "Failed to compute population outcomes")
