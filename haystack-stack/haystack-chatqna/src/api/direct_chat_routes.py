# src/api/direct_chat_routes.py
"""
Direct Patient ↔ Caregiver Chat
================================

POST /direct-chat/send           — send a message
GET  /direct-chat/messages       — fetch conversation (auto-delivers unread)
POST /direct-chat/read           — mark all messages as read
GET  /direct-chat/unread-count   — fast badge count
GET  /patient/my-caregiver       — patient gets their linked caregiver's profile

Auth:
  Patient endpoints use patient JWT (sub = patient_id, no role field).
  Caregiver endpoints use caregiver JWT (role = "caregiver").
  Both can call /send and /messages; auth determines sender_type.
"""

import json
import logging
from typing import Optional

import jwt as pyjwt
import redis as redis_lib
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from src.config import settings
from src.services.direct_chat_service import (
    send_message, get_messages, mark_read, unread_count,
)

log = logging.getLogger("direct_chat_routes")
router = APIRouter(tags=["direct-chat"])
security = HTTPBearer(auto_error=False)

# ── Redis ─────────────────────────────────────────────────────────────────────

_redis_client: Optional[redis_lib.Redis] = None

def _get_redis() -> redis_lib.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
        )
    return _redis_client


# ── JWT helpers ───────────────────────────────────────────────────────────────

def _decode_token(creds: HTTPAuthorizationCredentials) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    try:
        return pyjwt.decode(creds.credentials, settings.JWT_SECRET, algorithms=["HS256"])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception:
        raise HTTPException(401, "Invalid token")


def _require_patient(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    payload = _decode_token(creds)
    if payload.get("role") in ("admin", "caregiver"):
        raise HTTPException(403, "Patient token required")
    return payload


def _require_caregiver(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    payload = _decode_token(creds)
    if payload.get("role") != "caregiver":
        raise HTTPException(403, "Caregiver token required")
    return payload


def _require_any(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Accepts both patient and caregiver JWTs."""
    return _decode_token(creds)


# ── Models ────────────────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    text: str
    partner_id: str   # patient_id if caller is caregiver, caregiver_id if caller is patient


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/direct-chat/send")
async def send_direct_message(
    body: SendMessageRequest,
    caller: dict = Depends(_require_any),
):
    """Send a message. Caller is identified by JWT; partner_id is the other party."""
    role = caller.get("role")
    if not body.text.strip():
        raise HTTPException(400, "Message text cannot be empty")

    if role == "caregiver":
        caregiver_id = caller["sub"]
        patient_id   = body.partner_id
        sender_type  = "caregiver"
        sender_id    = caregiver_id
        # Verify the patient belongs to this caregiver
        from src.repositories.caregiver_repo import CaregiverRepository
        repo = CaregiverRepository()
        patients = repo.get_patients_for_caregiver(caregiver_id)
        if not any(p.get("id") == patient_id for p in patients):
            raise HTTPException(403, "Patient not linked to this caregiver")
    else:
        patient_id   = caller["sub"]
        caregiver_id = body.partner_id
        sender_type  = "patient"
        sender_id    = patient_id
        # Verify caregiver is linked to this patient
        from src.repositories.caregiver_repo import CaregiverRepository
        repo = CaregiverRepository()
        caregivers = repo.get_caregivers_for_patient(patient_id)
        if not any(c.get("caregiver_id") == caregiver_id for c in caregivers):
            raise HTTPException(403, "Caregiver not linked to this patient")

    redis = _get_redis()
    msg = send_message(
        redis=redis,
        patient_id=patient_id,
        caregiver_id=caregiver_id,
        sender_type=sender_type,
        sender_id=sender_id,
        text=body.text,
    )

    # Inbox notification side-effect (2026-04-19 add). Fires on every
    # successful direct-chat send so the recipient's bell lights up +
    # their ChatToastHost surfaces a pop-up within the next poll tick.
    # Never fatal — any push failure is swallowed + logged, the primary
    # chat persistence above has already succeeded.
    try:
        from src.services.caregiver_notify import (
            notify_caregiver_chat, notify_patient_chat,
        )
        if sender_type == "patient":
            notify_caregiver_chat(
                caregiver_id=caregiver_id,
                patient_id=patient_id,
                patient_name=caller.get("name") or "Your patient",
                text=body.text,
            )
        else:
            # Caregiver → patient. Look up the caregiver's display name
            # so the toast/bell shows a real person instead of "Your
            # caregiver". Best-effort — falls back on failure.
            cg_name = caller.get("name") or ""
            if not cg_name:
                try:
                    from src.repositories.caregiver_repo import CaregiverRepository
                    cg_row = CaregiverRepository().get_by_id(caregiver_id) or {}
                    cg_name = cg_row.get("name") or "Your caregiver"
                except Exception:
                    cg_name = "Your caregiver"
            notify_patient_chat(
                patient_id=patient_id,
                caregiver_id=caregiver_id,
                caregiver_name=cg_name,
                text=body.text,
            )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(
            f"direct-chat inbox side-effect failed: {exc}",
        )

    return {"message": msg, "status": "sent"}


@router.get("/direct-chat/messages")
async def fetch_messages(
    partner_id: str = Query(...),
    caller: dict = Depends(_require_any),
):
    """
    Fetch conversation with a partner.
    Side-effect: messages from partner with status='sent' are upgraded to 'delivered'.
    """
    role = caller.get("role")
    if role == "caregiver":
        caregiver_id   = caller["sub"]
        patient_id     = partner_id
        recipient_type = "caregiver"
    else:
        patient_id     = caller["sub"]
        caregiver_id   = partner_id
        recipient_type = "patient"

    redis = _get_redis()
    messages = get_messages(
        redis=redis,
        patient_id=patient_id,
        caregiver_id=caregiver_id,
        recipient_type=recipient_type,
    )
    return {"messages": messages, "count": len(messages)}


@router.post("/direct-chat/read")
async def mark_messages_read(
    partner_id: str = Query(...),
    caller: dict = Depends(_require_any),
):
    """Mark all delivered messages from partner as 'read'."""
    role = caller.get("role")
    if role == "caregiver":
        caregiver_id = caller["sub"]
        patient_id   = partner_id
        reader_type  = "caregiver"
    else:
        patient_id   = caller["sub"]
        caregiver_id = partner_id
        reader_type  = "patient"

    redis = _get_redis()
    count = mark_read(
        redis=redis,
        patient_id=patient_id,
        caregiver_id=caregiver_id,
        reader_type=reader_type,
    )
    return {"marked_read": count}


@router.get("/direct-chat/unread-count")
async def get_unread_count(
    partner_id: str = Query(...),
    caller: dict = Depends(_require_any),
):
    """Fast unread message count for badge display."""
    role = caller.get("role")
    if role == "caregiver":
        caregiver_id   = caller["sub"]
        patient_id     = partner_id
        recipient_type = "caregiver"
    else:
        patient_id     = caller["sub"]
        caregiver_id   = partner_id
        recipient_type = "patient"

    redis = _get_redis()
    count = unread_count(
        redis=redis,
        patient_id=patient_id,
        caregiver_id=caregiver_id,
        recipient_type=recipient_type,
    )
    return {"unread": count}


# ── Patient: get linked caregiver info ────────────────────────────────────────

@router.get("/patient/my-caregiver")
async def get_my_caregiver(patient: dict = Depends(_require_patient)):
    """
    Returns the first active caregiver linked to this patient,
    including name, specialization, bio, photo.
    Returns 404 if no caregiver is linked.
    """
    from src.repositories.caregiver_repo import CaregiverRepository
    repo = CaregiverRepository()
    caregivers = repo.get_caregivers_for_patient(patient["sub"])
    if not caregivers:
        raise HTTPException(404, "No caregiver linked to your account")

    cg = caregivers[0]
    caregiver_id = cg.get("caregiver_id")

    # Fetch full caregiver record (includes bio, specialization, photo)
    full = repo.get_by_id(caregiver_id) or {}
    return {
        "caregiver_id":    caregiver_id,
        "name":            full.get("name", cg.get("name", "Your Caregiver")),
        "phone":           full.get("phone", ""),
        "relationship":    cg.get("relationship", ""),
        "specialization":  full.get("specialization", ""),
        "bio":             full.get("bio", ""),
        "photo":           full.get("profile_photo", ""),
        "permissions":     cg.get("_permissions", []),
    }


# ── Patient: Caregiver Transfer Request ──────────────────────────────────────
#
# Patient fills in a form explaining why they want to transfer,
# submits it → stored in Redis → admin reviews + approves with new CG.
#
# Redis keys (shared with admin_routes.py):
#   transfer_request:{rid}            → full request JSON
#   transfer_requests_all             → sorted-set  score=ts  member=rid
#   transfer_reqs_by_patient:{pid}    → sorted-set  score=ts  member=rid

_TRANSFER_TTL = 180 * 24 * 3600   # 6 months


class TransferRequestBody(BaseModel):
    reason:                 str           # why they want to leave (required)
    current_caregiver_id:   str           # pre-filled from /my-caregiver
    current_caregiver_name: str
    # Patient-supplied details (pre-filled from profile on the form)
    patient_full_name:      Optional[str] = ""
    patient_age:            Optional[str] = ""
    patient_gender:         Optional[str] = ""
    patient_region:         Optional[str] = ""
    patient_phone:          Optional[str] = ""
    preferred_new_caregiver_specialty: Optional[str] = ""
    preferred_new_region:   Optional[str] = ""
    additional_notes:       Optional[str] = ""


@router.post("/patient/transfer-request")
async def submit_transfer_request(
    body: TransferRequestBody,
    patient: dict = Depends(_require_patient),
):
    """
    Patient submits a formal caregiver transfer request.
    Stored in Redis; admin reviews and either approves (choosing new CG) or declines.
    """
    import uuid
    import datetime as dt
    import json as _json

    r = redis_lib.Redis(
        host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
    )
    patient_id = patient["sub"]

    # Prevent duplicate pending requests
    existing_rids = r.zrange(f"transfer_reqs_by_patient:{patient_id}", 0, -1)
    for existing_rid in existing_rids:
        existing_raw = r.get(f"transfer_request:{existing_rid}")
        if existing_raw:
            existing = _json.loads(existing_raw)
            if existing.get("status") == "pending":
                raise HTTPException(
                    409,
                    f"You already have a pending transfer request (ref: {existing['request_id']}). "
                    "Wait for admin to review it before submitting a new one.",
                )

    rid          = f"TR-{dt.datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    submitted_at = dt.datetime.utcnow().isoformat() + "Z"

    request_doc = {
        "request_id":                rid,
        "submitted_at":              submitted_at,
        "status":                    "pending",
        "patient_id":                patient_id,
        "current_caregiver_id":      body.current_caregiver_id,
        "current_caregiver_name":    body.current_caregiver_name,
        "reason":                    body.reason,
        "patient_full_name":         body.patient_full_name or patient.get("name", ""),
        "patient_age":               body.patient_age or "",
        "patient_gender":            body.patient_gender or "",
        "patient_region":            body.patient_region or "",
        "patient_phone":             body.patient_phone or patient.get("phone", ""),
        "preferred_new_caregiver_specialty": body.preferred_new_caregiver_specialty or "",
        "preferred_new_region":      body.preferred_new_region or "",
        "additional_notes":          body.additional_notes or "",
        # Filled on admin action
        "new_caregiver_id":          "",
        "new_caregiver_name":        "",
        "admin_note":                "",
        "resolved_at":               "",
    }

    ts = dt.datetime.fromisoformat(submitted_at.rstrip("Z")).timestamp()
    r.setex(f"transfer_request:{rid}", _TRANSFER_TTL, _json.dumps(request_doc))
    r.zadd("transfer_requests_all", {rid: ts})
    r.zadd(f"transfer_reqs_by_patient:{patient_id}", {rid: ts})

    return {
        "request_id":   rid,
        "status":       "pending",
        "submitted_at": submitted_at,
        "message": (
            "Your transfer request has been submitted. The AMINA admin team will review it "
            "and notify you within 3–5 business days. Download the PDF below to submit an offline copy."
        ),
        "form": request_doc,
    }


@router.get("/patient/transfer-requests")
async def get_my_transfer_requests(patient: dict = Depends(_require_patient)):
    """Patient checks status of their transfer request(s)."""
    import json as _json
    r = redis_lib.Redis(
        host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
    )
    patient_id = patient["sub"]
    rids = r.zrevrange(f"transfer_reqs_by_patient:{patient_id}", 0, -1)
    requests = []
    for rid in rids:
        raw = r.get(f"transfer_request:{rid}")
        if raw:
            doc = _json.loads(raw)
            requests.append({
                "request_id":            doc["request_id"],
                "submitted_at":          doc["submitted_at"],
                "status":                doc["status"],
                "current_caregiver_name": doc["current_caregiver_name"],
                "new_caregiver_name":    doc.get("new_caregiver_name", ""),
                "admin_note":            doc.get("admin_note", ""),
                "resolved_at":           doc.get("resolved_at", ""),
            })
    return {"requests": requests, "total": len(requests)}
