"""
AMINA Care — Literacy Mode + Education Verification API
=========================================================
Routes (all mounted under /api/v1):

  Patient self-service (patient JWT):
    GET  /literacy/me                         → current profile + onboarding flag
    POST /literacy/me/declare                 → record self-declared education level
    POST /literacy/me/certificate             → upload education certificate (multipart)

  Admin (admin JWT):
    GET  /literacy/admin/queue                → list patients pending review
    GET  /literacy/admin/certificate/{cid}    → fetch a certificate file
    POST /literacy/admin/approve/{patient_id} → approve at a given verified level
    POST /literacy/admin/reject/{patient_id}  → reject (with reason)

Onboarding flow:
  1. Patient logs in
  2. Frontend calls GET /literacy/me → needs_onboarding=true
  3. Frontend shows EducationOnboardingGate (blocking)
  4. Patient picks level + optionally uploads cert
       POST /literacy/me/declare { level }
       POST /literacy/me/certificate (multipart)
  5. Profile status = 'pending', current_mode = 'beginner' (safe floor)
  6. Admin approves → current_mode upgrades to the verified level
"""

from __future__ import annotations

import base64
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from src.services.auth import verify_jwt
from src.services import literacy_service
from src.services import certificate_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/literacy", tags=["literacy"])


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

class DeclareBody(BaseModel):
    level: str


class ApproveBody(BaseModel):
    verified_level: str
    note: Optional[str] = ""


class RejectBody(BaseModel):
    note: str


# ── Patient self-service ────────────────────────────────────────────────────

@router.get("/me")
async def my_literacy(request: Request):
    patient = _require_patient(request)
    pid = patient.get("sub") or ""
    profile = literacy_service.get_profile(pid)
    cert = literacy_service.latest_certificate(pid) if pid else None
    return {
        "patient_id":       pid,
        "declared_level":   profile["declared_level"],
        "verified_level":   profile["verified_level"],
        "current_mode":     profile["current_mode"],
        "status":           profile["status"],
        "needs_onboarding": not profile["declared_level"],
        "requires_cert":    profile["declared_level"] in literacy_service.LEVELS_REQUIRING_CERT,
        "has_certificate":  cert is not None,
        "reviewer_note":    profile.get("reviewer_note", ""),
        "levels":           list(literacy_service.LEVELS),
        "modes":            list(literacy_service.MODES),
    }


@router.post("/me/declare")
async def declare_my_level(body: DeclareBody, request: Request):
    patient = _require_patient(request)
    pid = patient.get("sub") or ""
    result = literacy_service.declare_level(pid, body.level)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "declare failed"))
    return result


@router.post("/me/certificate")
async def upload_my_certificate(
    request: Request,
    declared_level: str = Form(...),
    file: UploadFile = File(...),
):
    patient = _require_patient(request)
    pid = patient.get("sub") or ""

    # Validate declared level pairing (must match profile.declared_level if set)
    level = (declared_level or "").strip().lower()
    if level not in literacy_service.LEVELS:
        raise HTTPException(status_code=400, detail=f"invalid level {declared_level!r}")

    # Read bytes (FastAPI spools to disk for large bodies, fine for <=5MB)
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="empty file")

    mime = file.content_type or "application/octet-stream"
    saved = certificate_storage.save_bytes(payload, mime)
    if not saved.get("ok"):
        raise HTTPException(status_code=400, detail=saved.get("error", "save failed"))

    rec = literacy_service.record_certificate(
        patient_id=pid,
        declared_level=level,
        filename=file.filename or f"certificate{saved['ext']}",
        mime_type=mime,
        size_bytes=saved["size"],
        storage_path=saved["storage_path"],
    )
    if not rec.get("ok"):
        raise HTTPException(status_code=500, detail=rec.get("error", "record failed"))

    return {
        "ok":            True,
        "cert_id":       rec["cert_id"],
        "status":        "pending",
        "size_bytes":    saved["size"],
        "mime_type":     mime,
    }


# ── Admin: queue + decisions ────────────────────────────────────────────────

@router.get("/admin/queue")
async def admin_queue(request: Request, limit: int = 100):
    _require_admin(request)
    return {"queue": literacy_service.list_pending_reviews(limit=limit)}


@router.get("/admin/certificate/{cert_id}")
async def admin_fetch_certificate(cert_id: str, request: Request):
    _require_admin(request)
    cert = literacy_service.get_certificate(cert_id)
    if not cert:
        raise HTTPException(status_code=404, detail="certificate not found")
    blob = certificate_storage.read_file(cert.get("storage_path") or "")
    if blob is None:
        raise HTTPException(status_code=404, detail="certificate file missing")
    mime = cert.get("mime_type") or "application/octet-stream"
    return Response(
        content=blob,
        media_type=mime,
        headers={
            "Content-Disposition": f'inline; filename="{cert.get("filename","certificate")}"',
            "Cache-Control":       "private, no-store",
        },
    )


@router.post("/admin/approve/{patient_id}")
async def admin_approve(patient_id: str, body: ApproveBody, request: Request):
    admin = _require_admin(request)
    reviewer = f"admin:{admin.get('sub','unknown')}"
    result = literacy_service.approve_verification(
        patient_id=patient_id,
        verified_level=body.verified_level,
        reviewer=reviewer,
        note=body.note or "",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "approve failed"))
    return result


@router.post("/admin/reject/{patient_id}")
async def admin_reject(patient_id: str, body: RejectBody, request: Request):
    admin = _require_admin(request)
    reviewer = f"admin:{admin.get('sub','unknown')}"
    result = literacy_service.reject_verification(
        patient_id=patient_id,
        reviewer=reviewer,
        note=body.note or "",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "reject failed"))
    return result
