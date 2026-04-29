"""
Patient Alert Routes
=====================
Routes for the patient-side of the caregiver alert system.

  GET  /patient/alerts/pending   — poll pending alerts (clears queue on read)
  POST /patient/telegram/link    — link Telegram chat_id to patient account
  POST /patient/telegram/verify  — verify link code (called by Telegram bot webhook)
"""

import logging
from typing import Optional

import jwt
import requests as _req
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from src.config import settings
from src.services.patient_alert_service import (
    get_pending_alerts,
    mark_alerts_read,
    generate_link_code,
    verify_link_code,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/patient", tags=["patient-alerts"])
security = HTTPBearer(auto_error=False)


# ── JWT auth (patient) ────────────────────────────────────────────────────────

def _require_patient(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    try:
        payload = jwt.decode(creds.credentials, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("role") in ("admin", "caregiver"):
            raise HTTPException(403, "Patient token required")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception:
        raise HTTPException(401, "Invalid token")


# ── Alert polling ─────────────────────────────────────────────────────────────

@router.get("/alerts/pending")
async def get_pending_patient_alerts(
    clear: bool = True,
    patient: dict = Depends(_require_patient),
):
    """
    Returns all pending alerts for the logged-in patient.
    Pass ?clear=false to peek without consuming.
    """
    alerts = get_pending_alerts(patient["sub"], clear=clear)
    return {"alerts": alerts, "count": len(alerts)}


@router.post("/alerts/read")
async def mark_patient_alerts_read(patient: dict = Depends(_require_patient)):
    """Mark all alerts as read (clear queue)."""
    mark_alerts_read(patient["sub"])
    return {"message": "All alerts cleared"}


# ── Telegram linking ──────────────────────────────────────────────────────────

@router.post("/telegram/generate-link")
async def generate_telegram_link(patient: dict = Depends(_require_patient)):
    """
    Generate a 6-char link code. Patient sends this code to the AMINA Telegram
    bot via /link <CODE> to connect their Telegram account.
    """
    code = generate_link_code(patient["sub"])
    return {
        "code": code,
        "instruction": f"Send '/link {code}' to the AMINA bot on Telegram to connect your account.",
        "expires_in": "10 minutes",
    }


class SaveChatIdRequest(BaseModel):
    telegram_chat_id: str


@router.post("/telegram/save-chat-id")
async def save_telegram_chat_id(
    body: SaveChatIdRequest,
    patient: dict = Depends(_require_patient),
):
    """
    Called by the Telegram bot after a patient logs in via OTP/PIN.
    Saves their Telegram chat_id directly (no link code needed — JWT is proof of identity).
    """
    try:
        resp = _req.post(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={
                "language": "sql",
                "command": "UPDATE PatientVertex SET telegram_chat_id = :cid WHERE id = :pid",
                "params": {"cid": body.telegram_chat_id, "pid": patient["sub"]},
            },
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=10,
        )
        if resp.status_code != 200:
            raise Exception(f"ArcadeDB error: {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Failed to save telegram_chat_id: {e}")
        raise HTTPException(500, "Failed to save Telegram link")
    return {"message": "Telegram chat ID saved", "patient_id": patient["sub"]}


class VerifyLinkRequest(BaseModel):
    code: str
    telegram_chat_id: str


@router.post("/telegram/verify-link")
async def verify_telegram_link(body: VerifyLinkRequest):
    """
    Called by the Telegram bot after the patient sends /link <CODE>.
    Saves telegram_chat_id to PatientVertex.
    """
    patient_id = verify_link_code(body.code)
    if not patient_id:
        raise HTTPException(400, "Invalid or expired link code")

    # Save telegram_chat_id to PatientVertex
    try:
        resp = _req.post(
            f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
            json={
                "language": "sql",
                "command": "UPDATE PatientVertex SET telegram_chat_id = :cid WHERE id = :pid",
                "params": {"cid": body.telegram_chat_id, "pid": patient_id},
            },
            auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
            timeout=10,
        )
        if resp.status_code != 200:
            raise Exception(f"ArcadeDB error: {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Failed to save telegram_chat_id: {e}")
        raise HTTPException(500, "Failed to save Telegram link")

    return {
        "message": "Telegram account linked successfully",
        "patient_id": patient_id,
    }
