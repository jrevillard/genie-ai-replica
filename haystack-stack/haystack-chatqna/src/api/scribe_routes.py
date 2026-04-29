"""
AMINA Care — Scribe API
==========================
Endpoints
---------
    POST /api/v1/scribe/start                -> new session
    GET  /api/v1/scribe/{id}                 -> session state
    POST /api/v1/scribe/{id}/chunk           -> append audio blob (multipart)
    POST /api/v1/scribe/{id}/finish          -> STT + SOAP draft
    POST /api/v1/scribe/{id}/finalize        -> clinician-edited draft + PDF

Auth
----
- Patient JWT:   may scribe for themselves (session.patient_id == sub)
- Caregiver JWT: may scribe for their linked patient
- Admin JWT:     may scribe for any patient
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import jwt
from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, UploadFile,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from src.config import settings
from src.services import scribe_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scribe", tags=["scribe"])
security = HTTPBearer(auto_error=False)


# ── Auth helper — must handle patient / caregiver / admin tokens ────────────

def _decode_any_jwt(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None


def _require_actor(
    creds: HTTPAuthorizationCredentials = Depends(security),
) -> Dict[str, Any]:
    if not creds or not creds.credentials:
        raise HTTPException(401, "Authentication required")
    payload = _decode_any_jwt(creds.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(401, "Invalid token")
    role = payload.get("role") or "patient"
    return {
        "role":        role,
        "actor_id":    payload["sub"],
        "patient_id":  payload.get("patient_id"),   # set on caregiver tokens
        "name":        payload.get("name", ""),
        "raw":         payload,
    }


def _can_scribe_for(actor: Dict[str, Any], patient_id: str) -> bool:
    """Role-scoped authorization — mirrors inbox_routes rules."""
    if not patient_id:
        return False
    role = actor["role"]
    if role == "admin":
        return True
    if role == "caregiver":
        return actor.get("patient_id") == patient_id
    # patient
    return actor["actor_id"] == patient_id


def _assert_actor_can_touch(actor: Dict[str, Any], session_patient_id: str) -> None:
    if not _can_scribe_for(actor, session_patient_id):
        raise HTTPException(403, "not authorised to act on this session")


# ── Payloads ─────────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    patient_id: str = Field(..., min_length=1)
    language:   str = Field("en")
    title_hint: str = Field("", max_length=120)


class FinalizePayload(BaseModel):
    title:         Optional[str] = None
    subjective:    Optional[str] = None
    objective:     Optional[str] = None
    assessment:    Optional[str] = None
    plan:          Optional[str] = None
    flags:         Optional[List[str]] = None
    signed_by_name: str = Field("", max_length=120)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/start")
def start_session(body: StartRequest, actor: dict = Depends(_require_actor)):
    if not _can_scribe_for(actor, body.patient_id):
        raise HTTPException(403, "not authorised to scribe for this patient")
    try:
        s = scribe_service.create_session(
            patient_id=body.patient_id,
            actor_id=actor["actor_id"],
            actor_role=actor["role"],
            language=body.language,
            title_hint=body.title_hint,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("scribe start failed")
        raise HTTPException(500, f"start failed: {type(e).__name__}")
    return {"ok": True, "session": s.public()}


@router.get("/{session_id}")
def get_session_state(session_id: str, actor: dict = Depends(_require_actor)):
    s = scribe_service.get_session(session_id)
    if not s:
        raise HTTPException(404, "session not found")
    _assert_actor_can_touch(actor, s.patient_id)
    return {"ok": True, "session": s.public()}


@router.post("/{session_id}/chunk")
async def append_chunk(
    session_id: str,
    chunk: UploadFile = File(...),
    actor: dict = Depends(_require_actor),
):
    existing = scribe_service.get_session(session_id)
    if not existing:
        raise HTTPException(404, "session not found")
    _assert_actor_can_touch(actor, existing.patient_id)

    data = await chunk.read()
    if not data:
        raise HTTPException(400, "empty chunk")

    try:
        s = scribe_service.append_chunk(session_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("scribe chunk append failed")
        raise HTTPException(500, f"chunk append failed: {type(e).__name__}")
    return {"ok": True, "session": s.public()}


@router.post("/{session_id}/finish")
async def finish(session_id: str, actor: dict = Depends(_require_actor)):
    existing = scribe_service.get_session(session_id)
    if not existing:
        raise HTTPException(404, "session not found")
    _assert_actor_can_touch(actor, existing.patient_id)

    try:
        s = await scribe_service.finish_session(session_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("scribe finish failed")
        raise HTTPException(500, f"finish failed: {type(e).__name__}: {e}")
    return {"ok": True, "session": s.public()}


@router.post("/{session_id}/finalize")
def finalize(
    session_id: str,
    body: FinalizePayload,
    actor: dict = Depends(_require_actor),
):
    existing = scribe_service.get_session(session_id)
    if not existing:
        raise HTTPException(404, "session not found")
    _assert_actor_can_touch(actor, existing.patient_id)

    edited = {}
    for k in ("title", "subjective", "objective", "assessment", "plan"):
        v = getattr(body, k, None)
        if v is not None:
            edited[k] = v
    if body.flags is not None:
        edited["flags"] = body.flags

    try:
        s, artifacts = scribe_service.finalize_session(
            session_id,
            edited_draft=edited,
            signed_by_name=body.signed_by_name or actor.get("name", ""),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("scribe finalize failed")
        raise HTTPException(500, f"finalize failed: {type(e).__name__}: {e}")
    return {
        "ok":           True,
        "session":      s.public(),
        "inbox_item":   artifacts["inbox_item"],
        "file_token":   artifacts["file_token"],
        "file_expires": artifacts["file_expires"],
    }
