"""
AMINA Care — Consent API Routes
=================================
Patient-level consent management for external data sharing.

  GET  /consent/me                   → Patient views their own consent flags
  POST /consent/me                   → Patient updates their own consent
  GET  /consent/me/history           → Patient views their own consent history
  GET  /consent/{patient_id}         → Admin views a patient's consent state
  POST /consent/{patient_id}         → Admin overrides a patient's consent (audited)
  GET  /consent/{patient_id}/history → Admin views audit history for a patient
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.services.auth import verify_jwt
from src.services import consent_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/consent", tags=["consent"])


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _require_token(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = verify_jwt(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


def _require_patient(request: Request) -> dict:
    payload = _require_token(request)
    if payload.get("role") in ("admin", "caregiver"):
        raise HTTPException(status_code=403, detail="Patients only")
    return payload


def _require_admin(request: Request) -> dict:
    payload = _require_token(request)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


# ── Models ───────────────────────────────────────────────────────────────────

class ConsentUpdate(BaseModel):
    scope:  str
    value:  bool
    reason: Optional[str] = ""


# ── Patient self-service ────────────────────────────────────────────────────

@router.get("/me")
async def my_consent(request: Request):
    """Patient views their own consent flags."""
    patient = _require_patient(request)
    pid = patient.get("sub")
    state = consent_service.get_all_consents(pid)
    return {
        "patient_id": pid,
        "flags":      state["flags"],
        "version":    state["version"],
        "scopes":     consent_service.CONSENT_SCOPES,
    }


@router.post("/me")
async def update_my_consent(body: ConsentUpdate, request: Request):
    """Patient updates one of their own consent flags."""
    patient = _require_patient(request)
    pid = patient.get("sub")
    result = consent_service.set_consent(
        patient_id=pid,
        scope=body.scope,
        value=body.value,
        actor="patient",
        reason=body.reason or "",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "update failed"))
    return result


@router.get("/me/history")
async def my_consent_history(request: Request):
    """Patient views their own consent change history."""
    patient = _require_patient(request)
    pid = patient.get("sub")
    return {
        "patient_id": pid,
        "history":    consent_service.get_audit_history(pid, limit=50),
    }


# ── Admin ────────────────────────────────────────────────────────────────────

@router.get("/{patient_id}")
async def get_patient_consent(patient_id: str, request: Request):
    """Admin views a specific patient's consent state."""
    admin = _require_admin(request)
    state = consent_service.get_all_consents(patient_id)
    return {
        "patient_id": patient_id,
        "flags":      state["flags"],
        "version":    state["version"],
        "scopes":     consent_service.CONSENT_SCOPES,
    }


@router.post("/{patient_id}")
async def admin_update_consent(patient_id: str, body: ConsentUpdate, request: Request):
    """Admin overrides a patient's consent (audited with admin username as actor)."""
    admin = _require_admin(request)
    actor = f"admin:{admin.get('sub','unknown')}"
    result = consent_service.set_consent(
        patient_id=patient_id,
        scope=body.scope,
        value=body.value,
        actor=actor,
        reason=body.reason or "admin override",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "update failed"))
    return result


@router.get("/{patient_id}/history")
async def patient_consent_history(patient_id: str, request: Request):
    """Admin views consent change history for a patient."""
    _require_admin(request)
    return {
        "patient_id": patient_id,
        "history":    consent_service.get_audit_history(patient_id, limit=200),
    }
