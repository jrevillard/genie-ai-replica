"""
AMINA Care — Caregiver Registration v2 + Admin Approval API
=============================================================
Multi-role registration with approval chain, document uploads,
and admin review workflow for Gambian community health workers.

Routes (mounted under /api/v1):
  POST /caregiver-v2/register          — multi-role registration
  GET  /caregiver-v2/status/{reg_id}   — check application status
  POST /caregiver-v2/upload-doc/{reg_id} — upload additional document

  Admin:
    GET  /caregiver-v2/admin/applications        — list all applications
    GET  /caregiver-v2/admin/applications/{reg_id} — single application detail
    GET  /caregiver-v2/admin/document/{reg_id}/{doc_key} — view uploaded doc
    POST /caregiver-v2/admin/review/{reg_id}     — approve / reject / request-info
    POST /caregiver-v2/admin/activate/{reg_id}   — force-activate (admin override)
    POST /caregiver-v2/admin/suspend/{reg_id}    — suspend active caregiver
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from src.services.auth import verify_jwt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/caregiver-v2", tags=["caregiver-registration-v2"])

_UPLOAD_DIR = os.environ.get("CG_UPLOAD_DIR", "/app/data/caregiver_uploads")
_MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
_ALLOWED_MIMES = {"image/jpeg", "image/png", "application/pdf"}


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _require_token(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = verify_jwt(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


def _require_admin(request: Request) -> dict:
    payload = _require_token(request)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


# ── Redis helpers ────────────────────────────────────────────────────────────

def _redis():
    try:
        import redis
        host = os.environ.get("REDIS_HOST", "amina-redis")
        return redis.Redis(host=host, port=6379, db=0, decode_responses=True)
    except Exception:
        return None


def _gen_reg_id() -> str:
    return f"CG-{uuid.uuid4().hex[:5].upper()}"


def _save_application(app: dict) -> bool:
    r = _redis()
    if not r:
        return False
    rid = app["registration_id"]
    r.setex(f"cg_registration:{rid}", 180 * 86400, json.dumps(app))  # 6 months
    r.zadd("cg_registrations_all", {rid: time.time()})
    r.zadd(f"cg_registrations_by_status:{app['status']}", {rid: time.time()})
    if app.get("role"):
        r.zadd(f"cg_registrations_by_role:{app['role']}", {rid: time.time()})
    return True


def _get_application(rid: str) -> Optional[dict]:
    r = _redis()
    if not r:
        return None
    raw = r.get(f"cg_registration:{rid}")
    return json.loads(raw) if raw else None


def _update_status(app: dict, old_status: str, new_status: str) -> None:
    r = _redis()
    if not r:
        return
    rid = app["registration_id"]
    r.zrem(f"cg_registrations_by_status:{old_status}", rid)
    app["status"] = new_status
    r.zadd(f"cg_registrations_by_status:{new_status}", {rid: time.time()})
    r.setex(f"cg_registration:{rid}", 180 * 86400, json.dumps(app))


# ── File storage ─────────────────────────────────────────────────────────────

def _save_upload(reg_id: str, doc_key: str, data: bytes, mime: str) -> dict:
    ext = ".jpg" if "jpeg" in mime else ".png" if "png" in mime else ".pdf"
    dest_dir = os.path.join(_UPLOAD_DIR, reg_id)
    os.makedirs(dest_dir, exist_ok=True)
    filename = f"{doc_key}{ext}"
    path = os.path.join(dest_dir, filename)
    with open(path, "wb") as f:
        f.write(data)
    return {"path": path, "filename": filename, "mime": mime, "size": len(data)}


def _read_upload(reg_id: str, doc_key: str) -> Optional[tuple]:
    dest_dir = os.path.join(_UPLOAD_DIR, reg_id)
    if not os.path.isdir(dest_dir):
        return None
    for ext in (".jpg", ".png", ".pdf"):
        path = os.path.join(dest_dir, f"{doc_key}{ext}")
        if os.path.isfile(path):
            mime = ("image/jpeg" if ext == ".jpg"
                    else "image/png" if ext == ".png"
                    else "application/pdf")
            with open(path, "rb") as f:
                return f.read(), mime
    return None


# ── Validation ───────────────────────────────────────────────────────────────

_GAMBIAN_PHONE = re.compile(r"^\+?220\d{7}$")

ROLE_FIELD_MAP = {
    "vhw":    ("years_as_vhw",),
    "cbc":    ("years_as_cbc",),
    "chn":    ("facility_name", "employee_id"),
    "tba":    ("years_as_tba",),
    "family": ("patient_invite_code", "relationship"),
    "scout":  ("age",),
    "alkalo": ("years_as_alkalo", "district"),
}


def _validate_registration(data: dict) -> List[str]:
    from src.models.caregiver_roles import REGISTRATION_REQUIREMENTS
    errors: List[str] = []
    role = data.get("role", "")
    reqs = REGISTRATION_REQUIREMENTS.get(role)
    if not reqs:
        return [f"Unknown role: {role}"]

    for field in reqs["required_fields"]:
        mapped = {"years_as_vhw": "years_experience", "years_as_cbc": "years_experience",
                  "years_as_tba": "years_experience", "years_as_alkalo": "years_experience"
                  }.get(field, field)
        val = data.get(mapped) or data.get(field)
        if val is None or (isinstance(val, str) and not val.strip()):
            errors.append(f"Missing required field: {field}")

    phone = (data.get("phone") or "").strip()
    if phone and not _GAMBIAN_PHONE.match(phone.replace(" ", "")):
        errors.append("Phone must be Gambian format: +220XXXXXXX")

    pin = data.get("pin", "")
    if len(pin) != 4 or not pin.isdigit():
        errors.append("PIN must be exactly 4 digits")

    if role == "scout":
        age = data.get("age")
        if age is not None and (age < 15 or age > 25):
            errors.append("Youth scouts must be aged 15-25")
        if age is not None and age < 18:
            if not data.get("guardian_name"):
                errors.append("Guardian name required for scouts under 18")
            if not data.get("guardian_phone"):
                errors.append("Guardian phone required for scouts under 18")

    return errors


# ── Request models ───────────────────────────────────────────────────────────

class ReviewBody(BaseModel):
    decision: str  # "approve", "reject", "request_info"
    note: Optional[str] = ""
    rejection_reason: Optional[str] = None
    alkalo_phone: Optional[str] = None  # for VHW/CBC → send to Alkalo
    skip_remaining: bool = False        # admin override → activate immediately


class SuspendBody(BaseModel):
    reason: str


# ── Public endpoints ─────────────────────────────────────────────────────────

@router.post("/register")
async def register_caregiver_v2(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    errors = _validate_registration(body)
    if errors:
        raise HTTPException(400, detail={"errors": errors})

    from src.models.caregiver_roles import (
        REGISTRATION_REQUIREMENTS, ROLE_LABELS, CaregiverApprovalStatus,
    )

    role = body["role"]
    reqs = REGISTRATION_REQUIREMENTS[role]
    reg_id = _gen_reg_id()
    now = datetime.utcnow().isoformat() + "Z"

    chain = []
    for step_name in reqs["approval_chain"]:
        chain.append({
            "step_name": step_name,
            "completed": False,
            "completed_at": None,
            "completed_by": None,
            "note": None,
        })

    # For family caregivers, validate invite code
    if role == "family":
        invite_code = (body.get("patient_invite_code") or "").strip().upper()
        r = _redis()
        if r:
            invite_key = f"caregiver_invite:{invite_code}"
            invite_data = r.get(invite_key)
            if not invite_data:
                raise HTTPException(400, "Invalid or expired invite code")

    app = {
        "registration_id": reg_id,
        "caregiver_id": None,
        "role": role,
        "role_label": ROLE_LABELS.get(role, role),
        "status": CaregiverApprovalStatus.PENDING.value,
        "full_name": body["full_name"].strip(),
        "phone": body["phone"].strip(),
        "pin": body["pin"],
        "village": (body.get("village") or "").strip() or None,
        "health_region": (body.get("health_region") or "").strip() or None,
        "registration_data": {
            k: v for k, v in body.items()
            if k not in ("full_name", "phone", "pin", "role")
        },
        "uploaded_documents": {},
        "approval_chain": chain,
        "submitted_at": now,
        "reviewed_at": None,
        "reviewed_by": None,
        "activated_at": None,
        "rejection_reason": None,
        "audit_log": [
            {"ts": now, "action": "registered", "by": "self",
             "detail": f"Registered as {ROLE_LABELS.get(role, role)}"},
        ],
    }

    if not _save_application(app):
        raise HTTPException(500, "Failed to save registration")

    timeout = reqs.get("approval_timeout_days", 14)
    next_steps = f"Your application will be reviewed within {timeout} days."
    if role == "family":
        next_steps = "Your patient will receive a notification to confirm."

    return {
        "ok": True,
        "registration_id": reg_id,
        "status": "pending",
        "role": role,
        "role_label": ROLE_LABELS.get(role, role),
        "next_steps": next_steps,
        "message": f"Registration submitted. We will SMS you at {body['phone']} when approved.",
    }


@router.get("/status/{reg_id}")
async def check_status(reg_id: str):
    app = _get_application(reg_id)
    if not app:
        raise HTTPException(404, "Registration not found")
    return {
        "registration_id": app["registration_id"],
        "status": app["status"],
        "role": app["role"],
        "full_name": app["full_name"],
        "submitted_at": app["submitted_at"],
        "approval_chain": app["approval_chain"],
        "rejection_reason": app.get("rejection_reason"),
    }


@router.post("/upload-doc/{reg_id}")
async def upload_document(
    reg_id: str,
    request: Request,
    doc_key: str = Form(...),
    file: UploadFile = File(...),
):
    app = _get_application(reg_id)
    if not app:
        raise HTTPException(404, "Registration not found")

    mime = file.content_type or "application/octet-stream"
    if mime not in _ALLOWED_MIMES:
        raise HTTPException(400, f"File type {mime} not allowed. Use JPG, PNG, or PDF.")

    data = await file.read()
    if len(data) > _MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 5 MB)")
    if not data:
        raise HTTPException(400, "Empty file")

    saved = _save_upload(reg_id, doc_key, data, mime)
    app["uploaded_documents"][doc_key] = {
        "filename": file.filename or saved["filename"],
        "mime": mime,
        "size": saved["size"],
        "uploaded_at": datetime.utcnow().isoformat() + "Z",
    }
    now = datetime.utcnow().isoformat() + "Z"
    app["audit_log"].append({
        "ts": now, "action": "document_uploaded", "by": "self",
        "detail": f"Uploaded {doc_key}: {file.filename}",
    })
    _save_application(app)

    return {"ok": True, "doc_key": doc_key, "size": saved["size"]}


# ── Admin endpoints ──────────────────────────────────────────────────────────

@router.get("/admin/applications")
async def list_applications(
    request: Request,
    status: Optional[str] = None,
    role: Optional[str] = None,
    region: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
):
    _require_admin(request)
    r = _redis()
    if not r:
        return {"applications": [], "total": 0}

    if status:
        rids = r.zrevrange(f"cg_registrations_by_status:{status}", 0, limit - 1)
    elif role:
        rids = r.zrevrange(f"cg_registrations_by_role:{role}", 0, limit - 1)
    else:
        rids = r.zrevrange("cg_registrations_all", 0, limit - 1)

    apps = []
    for rid in rids:
        raw = r.get(f"cg_registration:{rid}")
        if not raw:
            continue
        app = json.loads(raw)
        if region and (app.get("health_region") or "").lower() != region.lower():
            continue
        if search:
            q = search.lower()
            hay = " ".join(filter(None, [
                app.get("full_name"), app.get("phone"),
                app.get("village"), app.get("registration_id"),
            ])).lower()
            if q not in hay:
                continue
        app.pop("pin", None)
        apps.append(app)

    status_counts = {}
    for s in ("pending", "admin_reviewed", "alkalo_approved", "active",
              "suspended", "rejected", "more_info_needed"):
        status_counts[s] = r.zcard(f"cg_registrations_by_status:{s}") or 0

    return {
        "applications": apps[:limit],
        "total": len(apps),
        "status_counts": status_counts,
    }


@router.get("/admin/applications/{reg_id}")
async def get_application_detail(reg_id: str, request: Request):
    _require_admin(request)
    app = _get_application(reg_id)
    if not app:
        raise HTTPException(404, "Application not found")
    app.pop("pin", None)
    return app


@router.get("/admin/document/{reg_id}/{doc_key}")
async def get_document(reg_id: str, doc_key: str, request: Request):
    _require_admin(request)
    result = _read_upload(reg_id, doc_key)
    if not result:
        raise HTTPException(404, "Document not found")
    blob, mime = result
    return Response(
        content=blob,
        media_type=mime,
        headers={
            "Content-Disposition": f'inline; filename="{doc_key}"',
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/admin/review/{reg_id}")
async def review_application(reg_id: str, body: ReviewBody, request: Request):
    admin = _require_admin(request)
    admin_id = admin.get("sub", "unknown")
    app = _get_application(reg_id)
    if not app:
        raise HTTPException(404, "Application not found")

    now = datetime.utcnow().isoformat() + "Z"
    old_status = app["status"]

    if body.decision == "approve":
        # Mark admin_review step as complete
        for step in app["approval_chain"]:
            if step["step_name"] == "admin_review" and not step["completed"]:
                step["completed"] = True
                step["completed_at"] = now
                step["completed_by"] = f"admin:{admin_id}"
                step["note"] = body.note or ""
                break

        if body.skip_remaining:
            for step in app["approval_chain"]:
                if not step["completed"]:
                    step["completed"] = True
                    step["completed_at"] = now
                    step["completed_by"] = f"admin:{admin_id} (override)"
            _update_status(app, old_status, "active")
            app["activated_at"] = now
            app["audit_log"].append({
                "ts": now, "action": "admin_override_activate",
                "by": f"admin:{admin_id}",
                "detail": f"Force-activated. Note: {body.note or 'N/A'}",
            })
            _activate_caregiver(app)
        else:
            next_step = _next_pending_step(app)
            if next_step == "alkalo_confirmation":
                _update_status(app, old_status, "admin_reviewed")
                app["audit_log"].append({
                    "ts": now, "action": "approved_sent_to_alkalo",
                    "by": f"admin:{admin_id}",
                    "detail": f"Approved. Sent to Alkalo for confirmation. Note: {body.note or 'N/A'}",
                })
                if body.alkalo_phone:
                    app["registration_data"]["alkalo_phone"] = body.alkalo_phone
            elif next_step == "facility_verification":
                _update_status(app, old_status, "admin_reviewed")
                app["audit_log"].append({
                    "ts": now, "action": "approved_pending_facility",
                    "by": f"admin:{admin_id}",
                    "detail": f"Approved. Pending facility verification.",
                })
            elif next_step is None:
                _update_status(app, old_status, "active")
                app["activated_at"] = now
                app["audit_log"].append({
                    "ts": now, "action": "activated",
                    "by": f"admin:{admin_id}",
                    "detail": "All approval steps complete. Activated.",
                })
                _activate_caregiver(app)
            else:
                _update_status(app, old_status, "admin_reviewed")
                app["audit_log"].append({
                    "ts": now, "action": "approved_next_step",
                    "by": f"admin:{admin_id}",
                    "detail": f"Approved. Next: {next_step}",
                })

        app["reviewed_at"] = now
        app["reviewed_by"] = f"admin:{admin_id}"

    elif body.decision == "reject":
        _update_status(app, old_status, "rejected")
        app["rejection_reason"] = body.rejection_reason or body.note or "Rejected by admin"
        app["reviewed_at"] = now
        app["reviewed_by"] = f"admin:{admin_id}"
        app["audit_log"].append({
            "ts": now, "action": "rejected",
            "by": f"admin:{admin_id}",
            "detail": f"Rejected. Reason: {app['rejection_reason']}",
        })

    elif body.decision == "request_info":
        _update_status(app, old_status, "more_info_needed")
        app["reviewed_at"] = now
        app["reviewed_by"] = f"admin:{admin_id}"
        app["audit_log"].append({
            "ts": now, "action": "info_requested",
            "by": f"admin:{admin_id}",
            "detail": f"More info requested: {body.note or 'N/A'}",
        })

    else:
        raise HTTPException(400, f"Invalid decision: {body.decision}")

    _save_application(app)
    return {"ok": True, "status": app["status"], "registration_id": reg_id}


@router.post("/admin/activate/{reg_id}")
async def force_activate(reg_id: str, request: Request):
    admin = _require_admin(request)
    admin_id = admin.get("sub", "unknown")
    app = _get_application(reg_id)
    if not app:
        raise HTTPException(404, "Application not found")

    now = datetime.utcnow().isoformat() + "Z"
    old_status = app["status"]
    for step in app["approval_chain"]:
        if not step["completed"]:
            step["completed"] = True
            step["completed_at"] = now
            step["completed_by"] = f"admin:{admin_id} (override)"
    _update_status(app, old_status, "active")
    app["activated_at"] = now
    app["audit_log"].append({
        "ts": now, "action": "force_activated",
        "by": f"admin:{admin_id}",
        "detail": "Admin force-activated — all steps bypassed.",
    })
    _activate_caregiver(app)
    _save_application(app)
    return {"ok": True, "status": "active"}


@router.post("/admin/suspend/{reg_id}")
async def suspend_caregiver(reg_id: str, body: SuspendBody, request: Request):
    admin = _require_admin(request)
    admin_id = admin.get("sub", "unknown")
    app = _get_application(reg_id)
    if not app:
        raise HTTPException(404, "Application not found")

    now = datetime.utcnow().isoformat() + "Z"
    old_status = app["status"]
    _update_status(app, old_status, "suspended")
    app["audit_log"].append({
        "ts": now, "action": "suspended",
        "by": f"admin:{admin_id}",
        "detail": f"Suspended. Reason: {body.reason}",
    })
    _save_application(app)
    return {"ok": True, "status": "suspended"}


# ── Internal helpers ─────────────────────────────────────────────────────────

def _next_pending_step(app: dict) -> Optional[str]:
    for step in app["approval_chain"]:
        if not step["completed"]:
            return step["step_name"]
    return None


def _activate_caregiver(app: dict) -> None:
    """Create the CaregiverVertex in ArcadeDB if it doesn't exist."""
    try:
        from src.repositories.caregiver_repo import CaregiverRepository
        repo = CaregiverRepository()
        phone = app["phone"]
        existing = repo.get_by_phone(phone)
        if existing:
            app["caregiver_id"] = existing["caregiver_id"]
            logger.info("Caregiver %s already exists for phone %s", existing["caregiver_id"], phone)
            return

        result = repo.create(
            phone=phone,
            name=app["full_name"],
            pin=app["pin"],
            relationship=app.get("registration_data", {}).get("relationship", app["role"]),
        )
        if result:
            cg_id = result.get("caregiver_id")
            app["caregiver_id"] = cg_id
            logger.info("Created CaregiverVertex %s for %s (%s)", cg_id, app["full_name"], app["role"])
        else:
            logger.warning("Failed to create CaregiverVertex for %s", phone)
    except Exception as e:
        logger.error("_activate_caregiver error: %s", e)


REJECTION_REASONS = [
    "Training certificate not valid",
    "Cannot verify identity",
    "Village/region mismatch",
    "Duplicate registration",
    "Insufficient experience",
    "Photo ID unclear or unreadable",
    "Facility could not confirm employment",
    "Age requirement not met",
    "Other",
]
