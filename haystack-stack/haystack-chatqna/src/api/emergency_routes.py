"""
Emergency Escalation API.
=========================

Endpoints (prefix `/api/v1/emergency`)

  POST /alert                       patient fires an SOS
  GET  /for-me                      patient polls their latest alert
                                     (UI surfaces 199 prompt when
                                      state == "hotline_prompted")
  GET  /{alert_id}                  any authed user reads a single alert
  POST /{alert_id}/ack              caregiver says "I'm responding"
  POST /{alert_id}/notify-authorities
                                    caregiver triggers hospital dispatch
  POST /{alert_id}/resolve          caregiver or admin closes the alert
  GET  /active                      list unresolved alerts (admin only)
  GET  /hospitals                   hospital directory (?region=…)
  POST /tick                        manual tick (useful for tests)

Role gating
-----------
  Patient JWT:    /alert (body ignored — identity from sub), /for-me,
                  /{id} (read own only)
  Caregiver JWT:  /ack, /notify-authorities, /{id} (read-only for linked
                  patients), /resolve
  Admin JWT:      everything
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from src.services.emergency_escalation import (
    EmergencyEscalationService, hospitals_for_region, GAMBIA_HOSPITALS,
    HOTLINE_NUMBER, HOTLINE_DISPLAY_NAME, HOTLINE_PROMPT_MIN, ADMIN_ESCALATE_MIN,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/emergency", tags=["emergency"])
security = HTTPBearer(auto_error=False)


# ── dependencies ────────────────────────────────────────────────────

def _service() -> EmergencyEscalationService:
    from src.agent.amina_agent import get_agent
    redis = get_agent().memory_manager.redis
    return EmergencyEscalationService(redis)


def _jwt_payload(creds: Optional[HTTPAuthorizationCredentials]) -> Optional[dict]:
    try:
        if not creds or not creds.credentials:
            return None
        from src.services.auth import verify_jwt
        return verify_jwt(creds.credentials)
    except Exception:
        return None


def _require_patient(creds = Depends(security)) -> dict:
    p = _jwt_payload(creds)
    if not p or not p.get("sub"):
        raise HTTPException(401, "Patient JWT required")
    # Admin-patient (role=admin but sub is a patient id) is allowed too.
    role = p.get("role")
    if role == "caregiver":
        raise HTTPException(403, "Patients only on this endpoint")
    return p


def _require_caregiver_or_admin(creds = Depends(security)) -> dict:
    p = _jwt_payload(creds)
    if not p:
        raise HTTPException(401, "Auth required")
    role = p.get("role")
    if role != "caregiver" and role != "admin":
        raise HTTPException(403, "Caregiver or admin required")
    return p


def _require_admin(creds = Depends(security)) -> dict:
    p = _jwt_payload(creds)
    if not p or p.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return p


# ── schemas ─────────────────────────────────────────────────────────

class CreateAlertRequest(BaseModel):
    message: str
    alert_type: Optional[str] = "emergency_triage"
    region:     Optional[str] = ""  # falls back to patient profile region


class AckRequest(BaseModel):
    # Empty — caregiver identity comes from JWT.
    pass


class NotifyAuthoritiesRequest(BaseModel):
    note: Optional[str] = ""


class ResolveRequest(BaseModel):
    reason: Optional[str] = ""


# ── endpoints ───────────────────────────────────────────────────────

@router.post("/alert")
async def fire_alert(
    body: CreateAlertRequest,
    patient: dict = Depends(_require_patient),
):
    """Patient fires an SOS. Creates the escalation record AND triggers
    caregiver fanout (inbox + SMS) via the service."""
    if not (body.message or "").strip():
        raise HTTPException(400, "message is required")
    patient_id   = patient["sub"]
    patient_name = patient.get("name") or "your patient"
    # Resolve region from patient profile if not explicit.
    region = body.region or ""
    if not region:
        try:
            from src.services.auth import _sql  # type: ignore
            rows = _sql(
                "SELECT region FROM PatientVertex WHERE id = :pid LIMIT 1",
                {"pid": patient_id},
            ) or {}
            items = rows.get("result", []) if isinstance(rows, dict) else rows
            if items and items[0].get("region"):
                region = items[0]["region"]
        except Exception:
            pass

    rec = _service().create_alert(
        patient_id=patient_id, patient_name=patient_name,
        message=body.message, alert_type=body.alert_type,
        region=region,
    )
    return {
        "alert": rec,
        "hotline": {
            "number":                HOTLINE_NUMBER,
            "name":                  HOTLINE_DISPLAY_NAME,
            "prompt_after_minutes":  HOTLINE_PROMPT_MIN,
        },
        "admin_escalation_after_minutes": ADMIN_ESCALATE_MIN,
    }


@router.get("/for-me")
async def latest_for_patient(patient: dict = Depends(_require_patient)):
    """Patient polls their most recent alert. Used by the frontend
    EmergencyEscalationWatcher to show the 'Call 199' prompt when the
    backend has auto-advanced the alert state."""
    rec = _service().get_latest_for_patient(patient["sub"])
    return {
        "alert":   rec,
        "hotline": {"number": HOTLINE_NUMBER, "name": HOTLINE_DISPLAY_NAME},
    }


@router.get("/active")
async def list_active(admin: dict = Depends(_require_admin)):
    """Admin pane — every unresolved alert across the system."""
    return {"alerts": _service().list_active()}


@router.get("/hospitals")
async def list_hospitals(region: str = ""):
    """Public — hospital directory. Default: entire country."""
    if region.strip():
        return {"region": region, "hospitals": hospitals_for_region(region)}
    return {"region": "", "hospitals": GAMBIA_HOSPITALS}


@router.get("/{alert_id}")
async def get_alert(alert_id: str, creds = Depends(security)):
    p = _jwt_payload(creds)
    if not p:
        raise HTTPException(401, "Auth required")
    rec = _service()._load(alert_id)
    if not rec:
        raise HTTPException(404, "alert not found")
    role = p.get("role")
    if role == "admin":
        return rec
    if role == "caregiver":
        # Must be linked to the patient.
        try:
            from src.repositories.caregiver_repo import CaregiverRepository
            repo = CaregiverRepository()
            pts = repo.get_patients_for_caregiver(p["sub"]) or []
            if not any((x.get("id") == rec["patient_id"]) for x in pts):
                raise HTTPException(403, "Not authorized for this alert")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(500, "Auth check failed")
        return rec
    # Patient — own alerts only.
    if rec["patient_id"] != p.get("sub"):
        raise HTTPException(403, "Not your alert")
    return rec


@router.post("/{alert_id}/ack")
async def ack_alert(
    alert_id: str, req: AckRequest,
    caller: dict = Depends(_require_caregiver_or_admin),
):
    """Caregiver (or admin) signals active response."""
    rec = _service()._load(alert_id)
    if not rec:
        raise HTTPException(404, "alert not found")
    cg_id = caller["sub"]
    if caller.get("role") == "caregiver":
        # Verify linkage to prevent random caregivers ack'ing.
        from src.repositories.caregiver_repo import CaregiverRepository
        pts = CaregiverRepository().get_patients_for_caregiver(cg_id) or []
        if not any((x.get("id") == rec["patient_id"]) for x in pts):
            raise HTTPException(403, "Not linked to this patient")
    return _service().caregiver_acknowledge(alert_id, cg_id)


@router.post("/{alert_id}/notify-authorities")
async def notify_authorities(
    alert_id: str, req: NotifyAuthoritiesRequest,
    caller: dict = Depends(_require_caregiver_or_admin),
):
    """Caregiver pushes alert to every hospital in the patient's region."""
    rec = _service()._load(alert_id)
    if not rec:
        raise HTTPException(404, "alert not found")
    cg_id = caller["sub"]
    if caller.get("role") == "caregiver":
        from src.repositories.caregiver_repo import CaregiverRepository
        pts = CaregiverRepository().get_patients_for_caregiver(cg_id) or []
        if not any((x.get("id") == rec["patient_id"]) for x in pts):
            raise HTTPException(403, "Not linked to this patient")
    return _service().notify_authorities(alert_id, cg_id, req.note or "")


@router.post("/{alert_id}/resolve")
async def resolve(
    alert_id: str, req: ResolveRequest,
    caller: dict = Depends(_require_caregiver_or_admin),
):
    role = caller.get("role")
    by   = f"{role}:{caller['sub']}"
    return _service().resolve(alert_id, by_role=by, reason=req.reason or "")


@router.post("/tick")
async def tick(admin: dict = Depends(_require_admin)):
    """Manual tick — useful for tests + admin debugging. The background
    worker calls `_service().tick()` automatically every 30 s."""
    return _service().tick()
