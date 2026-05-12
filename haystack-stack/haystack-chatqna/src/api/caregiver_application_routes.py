"""
Caregiver Application Routes
============================
Enables patients to browse the caregiver directory and formally apply
to a specific caregiver. Caregivers see incoming applications and
accept or decline them.

Patient flows:
  GET  /cg-apply/directory          → list visible caregivers accepting patients
  POST /cg-apply/apply              → patient submits a formal application
  GET  /cg-apply/my-application     → patient checks status of their application
  GET  /cg-apply/application-form   → returns structured form data (for PDF download)

Caregiver flows:
  GET  /cg-apply/incoming           → caregiver sees pending applications
  POST /cg-apply/respond/{app_id}   → accept or decline (with optional note)

Redis key layout
----------------
  cg_application:{app_id}           → full application JSON
  cg_apps_by_patient:{patient_id}   → sorted set  score=ts  member=app_id
  cg_apps_by_caregiver:{cg_id}      → sorted set  score=ts  member=app_id
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Optional, List

import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from src.config import settings
from src.repositories.caregiver_repo import CaregiverRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cg-apply", tags=["caregiver-applications"])
security = HTTPBearer(auto_error=False)

_repo = CaregiverRepository()

APP_TTL = 90 * 24 * 3600   # keep applications 90 days

# ── JWT helpers ───────────────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    return _redis.Redis(
        host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
    )


def _require_patient(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Patient JWT only — also admits ADMIN_PATIENT_EMAILS admins.

    The admin-impersonation flow (env var ADMIN_PATIENT_EMAILS) stamps
    `role=admin` on a real PatientVertex login so the operator can see
    the full patient surface from one account. That means admin tokens
    have a valid PatientVertex `sub` and SHOULD be allowed through
    patient-scoped endpoints — the directory in particular renders
    blank with 0 caregivers if we reject them. Caregivers are still
    blocked: their tokens use caregiver_id not patient_id, so any
    downstream patient-scoped query would mis-attribute work.
    """
    if not creds:
        raise HTTPException(401, "Authentication required")
    try:
        payload = jwt.decode(creds.credentials, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("role") == "caregiver":
            raise HTTPException(403, "Patients only")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid token")


def _require_caregiver(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    try:
        payload = jwt.decode(creds.credentials, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("role") != "caregiver":
            raise HTTPException(403, "Caregivers only")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception:
        raise HTTPException(401, "Invalid token")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cg_card(cg: dict) -> dict:
    """Build public-facing caregiver card for the directory."""
    import json as _json

    def _parse(raw):
        if isinstance(raw, list):
            return raw
        try:
            return _json.loads(raw)
        except Exception:
            return []

    return {
        "caregiver_id":   cg.get("caregiver_id", ""),
        "name":           cg.get("name", ""),
        "specialization": cg.get("specialization", ""),
        "specialty_tags": _parse(cg.get("specialty_tags", "[]")),
        "bio":            cg.get("bio", ""),
        "region":         cg.get("region", ""),
        "years_experience": cg.get("years_experience", 0),
        "languages":      _parse(cg.get("languages", "[]")),
        "max_patients":   cg.get("max_patients", 10),
        "accepting_patients": cg.get("accepting_patients", False),
    }


def _load_application(redis, app_id: str) -> Optional[dict]:
    raw = redis.get(f"cg_application:{app_id}")
    if not raw:
        return None
    return json.loads(raw)


def _save_application(redis, app: dict) -> None:
    app_id = app["app_id"]
    redis.setex(f"cg_application:{app_id}", APP_TTL, json.dumps(app))
    ts = datetime.fromisoformat(app["submitted_at"]).timestamp()
    redis.zadd(f"cg_apps_by_patient:{app['patient_id']}", {app_id: ts})
    redis.expire(f"cg_apps_by_patient:{app['patient_id']}", APP_TTL)
    redis.zadd(f"cg_apps_by_caregiver:{app['caregiver_id']}", {app_id: ts})
    redis.expire(f"cg_apps_by_caregiver:{app['caregiver_id']}", APP_TTL)


# ── Directory endpoint ────────────────────────────────────────────────────────

def _get_all_visible_caregivers() -> list[dict]:
    """Fetch caregivers with is_directory_visible=true from ArcadeDB."""
    import requests as req
    try:
        r = req.post(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={
                "language": "sql",
                "command":  "SELECT * FROM CaregiverVertex WHERE is_directory_visible = true LIMIT 100",
            },
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=10,
        )
        return r.json().get("result", [])
    except Exception as e:
        logger.warning(f"directory fetch failed: {e}")
        return []


@router.get("/directory")
async def caregiver_directory(
    region:     Optional[str] = None,
    specialty:  Optional[str] = None,
    patient:    dict = Depends(_require_patient),
):
    """
    Browse the caregiver directory.
    Optional filters: ?region=wcr  ?specialty=maternal
    """
    caregivers = _get_all_visible_caregivers()

    cards = [_cg_card(cg) for cg in caregivers if cg.get("accepting_patients")]

    if region:
        cards = [c for c in cards if c.get("region", "").lower() == region.lower()]
    if specialty:
        kw = specialty.lower()
        cards = [c for c in cards if kw in c.get("specialization", "").lower()
                 or any(kw in t.lower() for t in c.get("specialty_tags", []))]

    return {
        "total":      len(cards),
        "caregivers": cards,
        "filters":    {"region": region, "specialty": specialty},
    }


# ── Application submission ────────────────────────────────────────────────────

class ApplyRequest(BaseModel):
    caregiver_id:           str
    # Patient-supplied form fields
    primary_concern:        str          # Why do you need a caregiver?
    health_conditions:      List[str]    # Current diagnoses / conditions
    current_medications:    List[str]
    preferred_contact:      str          # phone | sms | in_person
    emergency_contact_name: Optional[str] = ""
    emergency_contact_phone: Optional[str] = ""
    additional_notes:       Optional[str] = ""
    # Pre-filled from patient profile (can be overridden)
    patient_full_name:      Optional[str] = ""
    patient_age:            Optional[str] = ""
    patient_gender:         Optional[str] = ""
    patient_region:         Optional[str] = ""
    patient_phone:          Optional[str] = ""


APPLICATION_STATUS_PENDING  = "pending"
APPLICATION_STATUS_ACCEPTED = "accepted"
APPLICATION_STATUS_DECLINED = "declined"


@router.post("/apply")
async def submit_application(
    body: ApplyRequest,
    patient: dict = Depends(_require_patient),
):
    """
    Patient submits a formal caregiver application.

    - Validates caregiver exists + is accepting patients.
    - Prevents duplicate applications (patient → same caregiver).
    - Stores in Redis; returns form data for PDF download.
    """
    redis = _get_redis()
    patient_id = patient["sub"]

    # Validate caregiver
    cg = _repo.get_by_id(body.caregiver_id)
    if not cg:
        raise HTTPException(404, "Caregiver not found")
    if not cg.get("accepting_patients"):
        raise HTTPException(409, "This caregiver is not currently accepting new patients")

    # Check for existing pending application to the same caregiver
    existing_ids = redis.zrange(f"cg_apps_by_patient:{patient_id}", 0, -1)
    for existing_id in existing_ids:
        existing = _load_application(redis, existing_id)
        if (
            existing
            and existing["caregiver_id"] == body.caregiver_id
            and existing["status"] == APPLICATION_STATUS_PENDING
        ):
            raise HTTPException(
                409,
                f"You already have a pending application to this caregiver (ref: {existing['app_id']})",
            )

    app_id       = f"APP-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    submitted_at = datetime.utcnow().isoformat() + "Z"

    application = {
        "app_id":                 app_id,
        "submitted_at":           submitted_at,
        "status":                 APPLICATION_STATUS_PENDING,
        "patient_id":             patient_id,
        "caregiver_id":           body.caregiver_id,
        "caregiver_name":         cg.get("name", ""),
        "caregiver_specialization": cg.get("specialization", ""),
        "caregiver_region":       cg.get("region", ""),
        "patient_full_name":      body.patient_full_name or patient.get("name", ""),
        "patient_age":            body.patient_age,
        "patient_gender":         body.patient_gender,
        "patient_region":         body.patient_region,
        "patient_phone":          body.patient_phone or patient.get("phone", ""),
        "primary_concern":        body.primary_concern,
        "health_conditions":      body.health_conditions,
        "current_medications":    body.current_medications,
        "preferred_contact":      body.preferred_contact,
        "emergency_contact_name": body.emergency_contact_name or "",
        "emergency_contact_phone": body.emergency_contact_phone or "",
        "additional_notes":       body.additional_notes or "",
        "caregiver_response_note": "",
        "responded_at":           "",
    }

    _save_application(redis, application)
    logger.info(f"cg-apply: new application {app_id} patient={patient_id} cg={body.caregiver_id}")

    return {
        "app_id":       app_id,
        "status":       APPLICATION_STATUS_PENDING,
        "submitted_at": submitted_at,
        "caregiver_name": cg.get("name", ""),
        "caregiver_specialization": cg.get("specialization", ""),
        "message": (
            f"Application submitted successfully. {cg.get('name', 'The caregiver')} will review your "
            "request and respond within 48 hours. Download the PDF form below to submit an offline copy."
        ),
        "form": application,   # used by frontend to render printable PDF
    }


# ── Patient: check own application status ────────────────────────────────────

@router.get("/my-application")
async def get_my_applications(
    patient: dict = Depends(_require_patient),
):
    """Patient checks the status of their caregiver application(s)."""
    redis = _get_redis()
    patient_id = patient["sub"]

    app_ids = redis.zrevrange(f"cg_apps_by_patient:{patient_id}", 0, -1)
    apps = []
    for aid in app_ids:
        app = _load_application(redis, aid)
        if app:
            apps.append({
                "app_id":        app["app_id"],
                "submitted_at":  app["submitted_at"],
                "status":        app["status"],
                "caregiver_name": app["caregiver_name"],
                "caregiver_specialization": app["caregiver_specialization"],
                "responded_at":  app.get("responded_at", ""),
                "caregiver_response_note": app.get("caregiver_response_note", ""),
            })

    return {"applications": apps, "total": len(apps)}


# ── Caregiver: incoming applications ─────────────────────────────────────────

@router.get("/incoming")
async def incoming_applications(
    caregiver: dict = Depends(_require_caregiver),
):
    """Caregiver sees all applications submitted to them."""
    redis = _get_redis()
    cg_id = caregiver["sub"]

    app_ids = redis.zrevrange(f"cg_apps_by_caregiver:{cg_id}", 0, -1)
    apps = []
    for aid in app_ids:
        app = _load_application(redis, aid)
        if app:
            apps.append({
                "app_id":          app["app_id"],
                "submitted_at":    app["submitted_at"],
                "status":          app["status"],
                "patient_id":      app["patient_id"],
                "patient_full_name": app["patient_full_name"],
                "patient_age":     app["patient_age"],
                "patient_gender":  app["patient_gender"],
                "patient_region":  app["patient_region"],
                "patient_phone":   app["patient_phone"],
                "primary_concern": app["primary_concern"],
                "health_conditions": app["health_conditions"],
                "current_medications": app["current_medications"],
                "preferred_contact": app["preferred_contact"],
                "emergency_contact_name": app["emergency_contact_name"],
                "emergency_contact_phone": app["emergency_contact_phone"],
                "additional_notes": app["additional_notes"],
                "responded_at":    app.get("responded_at", ""),
            })

    pending = [a for a in apps if a["status"] == APPLICATION_STATUS_PENDING]
    return {
        "total":    len(apps),
        "pending":  len(pending),
        "applications": apps,
    }


# ── Caregiver: respond (accept / decline) ────────────────────────────────────

class RespondRequest(BaseModel):
    decision: str             # "accept" | "decline"
    note:     Optional[str] = ""


@router.post("/respond/{app_id}")
async def respond_to_application(
    app_id: str,
    body: RespondRequest,
    caregiver: dict = Depends(_require_caregiver),
):
    """
    Caregiver accepts or declines a patient application.

    On accept:
      - Sets application status → accepted.
      - Links patient to caregiver in the DB (calls _repo.link_to_patient).
      - Patient immediately appears in caregiver's panel.

    On decline:
      - Sets application status → declined.
      - No DB changes.
    """
    if body.decision not in ("accept", "decline"):
        raise HTTPException(400, "decision must be 'accept' or 'decline'")

    redis  = _get_redis()
    cg_id  = caregiver["sub"]
    cg     = _repo.get_by_id(cg_id) or {}

    app = _load_application(redis, app_id)
    if not app:
        raise HTTPException(404, f"Application {app_id} not found or expired")
    if app["caregiver_id"] != cg_id:
        raise HTTPException(403, "This application is not addressed to you")
    if app["status"] != APPLICATION_STATUS_PENDING:
        raise HTTPException(409, f"Application is already {app['status']}")

    # Check capacity before accepting
    if body.decision == "accept":
        current_count = _repo.get_active_patient_count(cg_id)
        max_pts = int(cg.get("max_patients") or cg.get("patient_limit") or 10)
        if current_count >= max_pts:
            raise HTTPException(
                409,
                f"Your panel is full ({current_count}/{max_pts}). Update your patient limit first.",
            )

    now = datetime.utcnow().isoformat() + "Z"

    if body.decision == "accept":
        # Link patient in DB with default permissions
        try:
            _repo.link_to_patient(
                caregiver_id = cg_id,
                patient_id   = app["patient_id"],
                permissions  = ["vitals", "medications", "consultations", "alerts"],
                granted_by   = cg_id,
                note         = f"Accepted via AMINA caregiver directory — ref {app_id}",
            )
        except Exception as e:
            logger.error(f"cg-apply: link_to_patient failed for {app_id}: {e}")
            raise HTTPException(500, "Failed to link patient to caregiver panel")

        app["status"] = APPLICATION_STATUS_ACCEPTED
        logger.info(f"cg-apply: {app_id} ACCEPTED — patient={app['patient_id']} cg={cg_id}")
    else:
        app["status"] = APPLICATION_STATUS_DECLINED
        logger.info(f"cg-apply: {app_id} DECLINED — patient={app['patient_id']} cg={cg_id}")

    app["caregiver_response_note"] = (body.note or "").strip()
    app["responded_at"] = now

    # Persist updated record
    redis.setex(f"cg_application:{app_id}", APP_TTL, json.dumps(app))

    return {
        "app_id":   app_id,
        "status":   app["status"],
        "decision": body.decision,
        "patient_id": app["patient_id"],
        "responded_at": now,
        "message": (
            f"Application {app_id} {app['status']}."
            + (f" {app['patient_id']} has been added to your panel." if body.decision == "accept" else "")
        ),
    }


# ── Application form data (for PDF download) ─────────────────────────────────

@router.get("/application-form/{app_id}")
async def get_application_form(
    app_id: str,
    patient: dict = Depends(_require_patient),
):
    """
    Return full application form data for PDF generation.
    Patient can only retrieve their own applications.
    """
    redis = _get_redis()
    app   = _load_application(redis, app_id)
    if not app:
        raise HTTPException(404, f"Application {app_id} not found")
    if app["patient_id"] != patient["sub"]:
        raise HTTPException(403, "You can only access your own application")
    return {"form": app}
