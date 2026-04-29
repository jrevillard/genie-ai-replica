"""
AMINA Care — Training Data API
===============================
Routes (all mounted under /api/v1):

  GET  /training/consent/me            → read current training-consent (patient OR caregiver)
  POST /training/consent/me            → update training-consent
  GET  /training/consent/me/status     → minimal "should show gate" probe
  GET  /training/consent/me/history    → my audit trail

  GET  /training/export/status         → admin dashboard stats
  GET  /training/export/preview        → admin dry-run (counts, no write)
  POST /training/export/run            → admin: run the exporter now

Self-service endpoints accept both patient and caregiver JWTs.
Admin endpoints require role == "admin".
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel

from src.services.auth import verify_jwt
from src.services import training_consent
from src.services import training_export

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training", tags=["training"])


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _require_token(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = verify_jwt(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


def _require_actor(request: Request) -> Tuple[str, str]:
    """
    Accepts either patient or caregiver tokens. Returns (role, actor_id).
    Admin tokens are rejected — admins use the /export endpoints instead.
    """
    payload = _require_token(request)
    role = payload.get("role")
    actor_id = payload.get("sub") or ""
    if not actor_id:
        raise HTTPException(status_code=401, detail="Token has no subject")
    if role == "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin tokens cannot give consent — use your patient or caregiver login",
        )
    # Default (no 'role' claim) is patient; caregiver is explicit.
    normalized = "caregiver" if role == "caregiver" else "patient"
    return normalized, actor_id


def _require_admin(request: Request) -> dict:
    payload = _require_token(request)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


# ── Models ───────────────────────────────────────────────────────────────────

class ConsentBody(BaseModel):
    value:  bool
    reason: Optional[str] = ""


# ── Self-service ─────────────────────────────────────────────────────────────

@router.get("/consent/me")
async def my_training_consent(request: Request):
    role, aid = _require_actor(request)
    state = training_consent.get_training_consent(role, aid)
    return {
        "actor_role": role,
        "actor_id":   aid,
        "value":      state["value"],
        "decided":    state["decided"],
        "version":    state["version"],
        "updated_at": state.get("updated_at", ""),
        "scope":      training_consent.TRAINING_SCOPE,
    }


@router.post("/consent/me")
async def update_my_training_consent(body: ConsentBody, request: Request):
    role, aid = _require_actor(request)
    result = training_consent.set_training_consent(
        actor_role=role,
        actor_id=aid,
        value=body.value,
        actor="self",
        reason=body.reason or "updated via consent gate",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "update failed"))
    return result


@router.get("/consent/me/status")
async def my_training_consent_status(request: Request):
    """Minimal probe: should the first-launch consent gate be shown?"""
    role, aid = _require_actor(request)
    state = training_consent.get_training_consent(role, aid)
    return {
        "decided":    state["decided"],
        "value":      state["value"],
        "needs_gate": not state["decided"],
    }


@router.get("/consent/me/history")
async def my_training_consent_history(request: Request):
    role, aid = _require_actor(request)
    return {
        "actor_role": role,
        "actor_id":   aid,
        "history":    training_consent.get_audit_history(role, aid, limit=50),
    }


# ── Admin ────────────────────────────────────────────────────────────────────

@router.get("/export/status")
async def export_status_route(request: Request):
    _require_admin(request)
    return training_export.export_status()


@router.get("/export/preview")
async def export_preview(request: Request):
    _require_admin(request)
    return training_export.run_export(dry_run=True)


@router.post("/export/run")
async def export_run(
    request: Request,
    system_prompt: Optional[str] = Query(None, description="Override system prompt for SFT examples"),
):
    _require_admin(request)
    return training_export.run_export(system_prompt=system_prompt, dry_run=False)
