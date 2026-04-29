"""
Caregiver inbox + chat-notification API.
=========================================
The legacy InboxItemVertex table is id-agnostic — it indexes on
`patient_id` but any stable string works. This router layer exposes
caregiver-scoped reads (list, unread-count, mark-read) under
`/api/v1/caregiver/inbox/*` and two write wrappers that BOTH send the
underlying message AND push a notification to the recipient's inbox:

  POST /caregiver/chat/send       — patient OR caregiver send a chat msg
                                    (calls src.services.direct_chat.send_message
                                    internally, then fires the inbox push on
                                    the recipient side)
  POST /caregiver/emergency/send  — patient fires an emergency; this keeps
                                    the existing SMS fanout intact AND
                                    additionally pushes an inbox item with
                                    severity='emergency' into every linked
                                    caregiver so their bell pulses red.

Role gating:
  - Caregiver JWT (role='caregiver') → can read their own inbox, send
    messages to their linked patient, and mark items read.
  - Patient JWT                      → can fire the chat wrapper (send
    message to their caregiver) and fire the emergency wrapper (fans out
    to every linked caregiver's inbox).
  - Admin JWT                        → no scope enforcement.

All calls are defensive: if the underlying inbox push fails (Arcade
down, schema drift, whatever), the PRIMARY action (chat persistence,
SMS fanout) still succeeds and the response lists `notification_failed`
for debugging.
"""

from __future__ import annotations

import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Query, Request, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from src.services import inbox_service
from src.services.caregiver_notify import (
    notify_caregiver_chat,
    notify_patient_chat,
    fanout_caregiver_emergency,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/caregiver", tags=["caregiver", "inbox"])
security = HTTPBearer(auto_error=False)


# ── JWT helpers ──────────────────────────────────────────────────────

def _decode(tok: str) -> Optional[dict]:
    try:
        from src.services.auth import verify_jwt
        return verify_jwt(tok)
    except Exception:
        return None


def _payload_caregiver(creds: Optional[HTTPAuthorizationCredentials]) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(401, "Authentication required")
    payload = _decode(creds.credentials) or {}
    role = payload.get("role")
    if role != "caregiver" and role != "admin":
        raise HTTPException(401, "Caregiver or admin token required")
    if role == "caregiver" and not payload.get("sub"):
        raise HTTPException(401, "Caregiver token missing subject")
    return payload


def _payload_any(creds: Optional[HTTPAuthorizationCredentials]) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(401, "Authentication required")
    payload = _decode(creds.credentials) or {}
    if not payload.get("sub"):
        raise HTTPException(401, "Token missing subject")
    return payload


# ── Caregiver inbox reads ────────────────────────────────────────────

@router.get("/inbox/list")
async def caregiver_inbox_list(
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
    kind: Optional[str] = None,
    creds: HTTPAuthorizationCredentials = Depends(security),
):
    """Caregiver inbox list — newest first."""
    jwt = _payload_caregiver(creds)
    owner = jwt["sub"]
    items = inbox_service.list_items(
        owner,
        limit=limit, offset=offset,
        unread_only=bool(unread_only),
        kind=kind or None,
    )
    return {"items": items, "owner_id": owner, "count": len(items)}


@router.get("/inbox/unread-count")
async def caregiver_inbox_unread(
    creds: HTTPAuthorizationCredentials = Depends(security),
):
    """Hot-poll endpoint — cheap COUNT query for the bell badge."""
    jwt = _payload_caregiver(creds)
    owner = jwt["sub"]
    n = inbox_service.unread_count(owner)
    return {"unread": int(n), "owner_id": owner}


@router.post("/inbox/{inbox_id}/read")
async def caregiver_inbox_read(
    inbox_id: str,
    creds: HTTPAuthorizationCredentials = Depends(security),
):
    """Mark a single item read. Only the owner can do this."""
    jwt = _payload_caregiver(creds)
    owner = jwt["sub"]
    try:
        ok = inbox_service.mark_read(inbox_id, owner)
    except Exception as exc:
        raise HTTPException(500, f"mark read failed: {exc}")
    if not ok:
        raise HTTPException(404, "inbox item not found")
    return {"inbox_id": inbox_id, "read": True}


@router.post("/inbox/mark-all-read")
async def caregiver_inbox_mark_all_read(
    creds: HTTPAuthorizationCredentials = Depends(security),
):
    jwt = _payload_caregiver(creds)
    owner = jwt["sub"]
    try:
        n = inbox_service.mark_all_read(owner)
    except Exception as exc:
        raise HTTPException(500, f"mark all read failed: {exc}")
    return {"marked": int(n or 0), "owner_id": owner}


# ── Chat wrapper (sends message + notifies recipient) ────────────────

class ChatWrapRequest(BaseModel):
    text:       str
    partner_id: str   # patient_id if caller is caregiver, caregiver_id if caller is patient


@router.post("/chat/send")
async def chat_send_notify(
    body: ChatWrapRequest,
    creds: HTTPAuthorizationCredentials = Depends(security),
):
    """Send a direct chat message AND drop a notification into the
    recipient's inbox. Matches /direct-chat/send gate rules exactly —
    caller must be linked to partner via CaregiverRepository."""
    jwt = _payload_any(creds)
    role = jwt.get("role")
    if not (body.text or "").strip():
        raise HTTPException(400, "Message text cannot be empty")

    from src.repositories.caregiver_repo import CaregiverRepository
    from src.services.direct_chat_service import send_message

    repo = CaregiverRepository()

    if role == "caregiver":
        caregiver_id = jwt["sub"]
        patient_id   = body.partner_id
        patients     = repo.get_patients_for_caregiver(caregiver_id) or []
        patient      = next((p for p in patients if p.get("id") == patient_id), None)
        if not patient:
            raise HTTPException(403, "Patient not linked to this caregiver")
        sender_type  = "caregiver"
        sender_id    = caregiver_id
        patient_name = patient.get("name") or "your patient"
        cg_name      = jwt.get("name") or "your caregiver"
    else:
        patient_id   = jwt["sub"]
        caregiver_id = body.partner_id
        cgs          = repo.get_caregivers_for_patient(patient_id) or []
        cg_row       = next((c for c in cgs
                             if (c.get("caregiver_id") or c.get("id")) == caregiver_id), None)
        if not cg_row:
            raise HTTPException(403, "Caregiver not linked to this patient")
        sender_type  = "patient"
        sender_id    = patient_id
        patient_name = jwt.get("name") or "your patient"
        cg_name      = cg_row.get("name") or "your caregiver"

    # Persist the chat message via the existing pathway (same storage,
    # same status state machine).
    redis = _get_redis()
    try:
        msg = send_message(
            redis=redis,
            patient_id=patient_id,
            caregiver_id=caregiver_id,
            sender_type=sender_type,
            sender_id=sender_id,
            text=body.text,
        )
    except Exception as exc:
        raise HTTPException(500, f"chat send failed: {exc}")

    # Fire-and-forget notification push to the recipient.
    notified_id = None
    notify_err  = None
    try:
        if sender_type == "patient":
            notified_id = notify_caregiver_chat(
                caregiver_id=caregiver_id,
                patient_id=patient_id,
                patient_name=patient_name,
                text=body.text,
            )
        else:
            notified_id = notify_patient_chat(
                patient_id=patient_id,
                caregiver_id=caregiver_id,
                caregiver_name=cg_name,
                text=body.text,
            )
    except Exception as exc:
        notify_err = str(exc)

    return {
        "message":             msg,
        "status":              "sent",
        "notification_inbox":  notified_id,
        "notification_failed": notify_err,
    }


def _get_redis():
    from src.agent.amina_agent import get_agent
    return get_agent().memory_manager.redis


# ── Emergency wrapper (SMS fanout + inbox fanout) ────────────────────

class EmergencyWrapRequest(BaseModel):
    message:    str
    alert_type: str = "emergency_triage"
    severity:   str = "emergency"


@router.post("/emergency/send")
async def emergency_send_notify(
    body: EmergencyWrapRequest,
    creds: HTTPAuthorizationCredentials = Depends(security),
):
    """Patient-initiated SOS / emergency.

    Does two things:
      1. Calls the existing `/caregiver/alert/send` internally so the
         SMS fanout + audit log stay identical to legacy behaviour.
      2. Pushes an inbox item with severity='emergency' to EVERY linked
         caregiver so the caregiver portal pulses red in-app too.
    """
    jwt = _payload_any(creds)
    if jwt.get("role") == "caregiver":
        raise HTTPException(403, "Caregivers can't fire emergency alerts")
    patient_id   = jwt["sub"]
    patient_name = jwt.get("name") or "your patient"
    if not (body.message or "").strip():
        raise HTTPException(400, "Emergency message is required")

    # --- inbox fanout (always attempted, even if SMS fails) ------------
    inbox_result = fanout_caregiver_emergency(
        patient_id=patient_id,
        patient_name=patient_name,
        message=body.message,
        alert_type=body.alert_type,
    )

    # --- SMS fanout through the existing alert endpoint ----------------
    sms_result: Dict[str, Any] = {"sent": 0, "failed": 0, "results": []}
    try:
        from src.repositories.caregiver_repo import CaregiverRepository
        from src.services.caregiver_alerts import send_caregiver_alerts
        from datetime import datetime
        import json, uuid

        repo = CaregiverRepository()
        cgs  = repo.get_caregivers_for_patient(patient_id) or []
        phones = [cg.get("phone") for cg in cgs
                  if not cg.get("is_revoked")
                  and "alerts" in (cg.get("permissions") or [])
                  and cg.get("phone")]
        if phones:
            sms_list = send_caregiver_alerts(
                patient_id=patient_id,
                patient_name=patient_name,
                alert_type=body.alert_type,
                caregiver_phones=phones,
                severity=body.severity,
                message=body.message,
            ) or []
            sms_result = {
                "sent":    sum(1 for r in sms_list if r.get("sent")),
                "failed":  sum(1 for r in sms_list if not r.get("sent")),
                "results": sms_list,
            }

            # Mirror the existing alert audit log so the dashboards
            # that read `caregiver_alerts:{pid}` stay populated.
            try:
                redis = _get_redis()
                rec = {
                    "alert_id":   str(uuid.uuid4())[:8],
                    "alert_type": body.alert_type,
                    "message":    body.message,
                    "severity":   body.severity,
                    "sent_to":    sms_result["sent"],
                    "created_at": datetime.now().isoformat(),
                    "source":     "emergency_wrapper",
                }
                redis.lpush(f"caregiver_alerts:{patient_id}", json.dumps(rec))
                redis.ltrim(f"caregiver_alerts:{patient_id}", 0, 99)
            except Exception as exc:
                logger.debug(f"emergency audit log skipped: {exc}")
    except Exception as exc:
        logger.warning(f"emergency SMS fanout failed: {exc}")
        sms_result["error"] = str(exc)

    return {
        "patient_id":      patient_id,
        "alert_type":      body.alert_type,
        "severity":        body.severity,
        "inbox_delivered": inbox_result.get("delivered_count", 0),
        "inbox_recipients": inbox_result.get("recipients", []),
        "sms":             sms_result,
    }
