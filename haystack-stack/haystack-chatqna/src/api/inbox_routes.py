"""
AMINA Care — Inbox API
=========================
Per-patient inbox: persistent queue of PDFs, alerts, notifications, reports,
reminders and caregiver pings, rendered outside the main chat stream.

Endpoints
---------
    GET  /api/v1/inbox/list              — list items (newest first, filters)
    GET  /api/v1/inbox/unread-count      — number (cheap, hot-polled)
    GET  /api/v1/inbox/{inbox_id}        — single item detail
    POST /api/v1/inbox/send              — push item (agent/system/caregiver)
    POST /api/v1/inbox/{inbox_id}/read   — flip read=true
    POST /api/v1/inbox/mark-all-read     — bulk
    POST /api/v1/inbox/capture-file      — multipart upload + item in one call
    GET  /api/v1/inbox/file/{token}      — download via signed URL (no JWT)

Auth
----
All endpoints except `/file/{token}` require a patient JWT. The file token
itself is a bearer credential (like an S3 presigned URL) so downloads work
from clients that cannot send Authorization headers (WhatsApp forwards, native
mobile "Save as" flows, channel bots relaying the link).

Operational notes
-----------------
- `suggest_form` from the agent is read directly by the frontend off the
  existing /agent/chat response — we don't duplicate intent detection here.
- All writes go through inbox_service which validates + clips lengths.
- Failures in /send are surfaced as 500 with a structured error; the caller
  (e.g. caregiver_alerts.push_to_inbox) should swallow and not page.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import jwt
from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, UploadFile,
)
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from src.config import settings
from src.services import file_token_service, inbox_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/inbox", tags=["inbox"])
security = HTTPBearer(auto_error=False)


# ── Auth helpers (local copy of the patient-JWT pattern used elsewhere) ──────

def _patient_from_jwt(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None
    # Patient tokens have no role, OR role="patient". Caregivers/admins are
    # explicitly excluded from the patient-only endpoints.
    if payload.get("role") in ("admin", "caregiver"):
        return None
    return payload


def _require_patient(
    creds: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(401, "Authentication required")
    payload = _patient_from_jwt(creds.credentials)
    if not payload:
        raise HTTPException(401, "Invalid or expired patient token")
    if not payload.get("sub"):
        raise HTTPException(401, "Token missing subject claim")
    return payload


def _require_trusted_caller(
    creds: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    For server-to-server `/send` pushes from caregiver/admin flows.
    Accepts patient, caregiver, OR admin JWTs; rejects anonymous.
    """
    if not creds or not creds.credentials:
        raise HTTPException(401, "Authentication required")
    try:
        payload = jwt.decode(creds.credentials, settings.JWT_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Invalid token")
    return payload


# ── Pydantic bodies ──────────────────────────────────────────────────────────

class InboxSendRequest(BaseModel):
    """Used by callers (agent hooks, caregiver alerts, admin tools) to push."""
    patient_id: str = Field(..., min_length=1)
    kind:       str = Field(..., description="pdf|alert|notification|report|reminder|caregiver_ping|email")
    title:      str = Field(..., min_length=1, max_length=200)
    body:       str = Field("", max_length=4000)
    severity:   str = Field("info",  description="info|warning|emergency")
    source:     str = Field("system", description="agent|caregiver|system|nudge_scheduler|admin")
    source_id:  str = Field("")
    action_url: str = Field("", max_length=500)
    metadata:   Dict[str, Any] = Field(default_factory=dict)
    ttl_days:   int = Field(60, ge=1, le=365)
    # Optional attachment (already tokenized — typically from capture-file).
    attachment_token: str = Field("")
    attachment_name:  str = Field("")
    attachment_mime:  str = Field("")
    attachment_size:  int = Field(0, ge=0)


class InboxSendResponse(BaseModel):
    ok:   bool
    item: Dict[str, Any]


class InboxListResponse(BaseModel):
    items:  List[Dict[str, Any]]
    count:  int
    unread: int


class UnreadCountResponse(BaseModel):
    unread: int


class CaptureFileResponse(BaseModel):
    ok:    bool
    item:  Dict[str, Any]
    token: str
    expires_at: str


class MarkReadResponse(BaseModel):
    ok:      bool
    updated: int


# ── Patient-scoped reads ─────────────────────────────────────────────────────

@router.get("/list", response_model=InboxListResponse)
def list_inbox(
    limit:   int  = Query(50, ge=1, le=200),
    offset:  int  = Query(0,  ge=0),
    unread:  bool = Query(False, description="Only unread items"),
    kind:    Optional[str] = Query(None, description="Filter by kind"),
    patient: dict = Depends(_require_patient),
):
    pid = patient["sub"]
    items = inbox_service.list_items(
        pid, limit=limit, offset=offset, unread_only=unread, kind=kind,
    )
    return InboxListResponse(
        items=items,
        count=len(items),
        unread=inbox_service.unread_count(pid),
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
def get_unread_count(patient: dict = Depends(_require_patient)):
    return UnreadCountResponse(unread=inbox_service.unread_count(patient["sub"]))


@router.get("/{inbox_id}")
def get_inbox_item(inbox_id: str, patient: dict = Depends(_require_patient)):
    item = inbox_service.get_item(inbox_id, patient["sub"])
    if not item:
        raise HTTPException(404, "inbox item not found")
    return item


# ── Writes ───────────────────────────────────────────────────────────────────

@router.post("/send", response_model=InboxSendResponse)
def send_to_inbox(
    body: InboxSendRequest,
    caller: dict = Depends(_require_trusted_caller),
):
    """
    Push an item into a patient's inbox.

    Authorization matrix:
      - patient JWT   → can only send to themselves (caller.sub == body.patient_id)
      - caregiver JWT → can only send to their linked patient
      - admin JWT     → may send to any patient
    """
    role = caller.get("role") or "patient"
    if role == "patient":
        if caller.get("sub") != body.patient_id:
            raise HTTPException(403, "Patients may only push to their own inbox")
    elif role == "caregiver":
        if caller.get("patient_id") != body.patient_id:
            raise HTTPException(403, "Caregiver not linked to this patient")
    # admin: no scope check (already authenticated)

    try:
        item = inbox_service.create_item(
            patient_id=body.patient_id,
            kind=body.kind,
            title=body.title,
            body=body.body,
            severity=body.severity,
            source=body.source,
            source_id=body.source_id,
            attachment_token=body.attachment_token,
            attachment_name=body.attachment_name,
            attachment_mime=body.attachment_mime,
            attachment_size=body.attachment_size,
            action_url=body.action_url,
            metadata=body.metadata,
            ttl_days=body.ttl_days,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception(f"inbox /send failed for {body.patient_id}: {e}")
        raise HTTPException(500, "inbox write failed")

    return InboxSendResponse(ok=True, item=item)


@router.post("/{inbox_id}/read", response_model=MarkReadResponse)
def mark_item_read(inbox_id: str, patient: dict = Depends(_require_patient)):
    ok = inbox_service.mark_read(inbox_id, patient["sub"])
    return MarkReadResponse(ok=ok, updated=1 if ok else 0)


@router.post("/mark-all-read", response_model=MarkReadResponse)
def mark_all_read(patient: dict = Depends(_require_patient)):
    n = inbox_service.mark_all_read(patient["sub"])
    return MarkReadResponse(ok=True, updated=n)


# ── File capture (multipart upload + inbox item in one round-trip) ───────────

@router.post("/capture-file", response_model=CaptureFileResponse)
async def capture_file(
    file:      UploadFile = File(...),
    kind:      str        = Form("pdf"),
    title:     str        = Form(...),
    body:      str        = Form(""),
    severity:  str        = Form("info"),
    source:    str        = Form("agent"),
    source_id: str        = Form(""),
    ttl_days:  int        = Form(60),
    max_downloads: int    = Form(0),
    patient: dict = Depends(_require_patient),
):
    """
    Upload a file and atomically create the inbox item that references it.
    Used by the frontend when the agent emits a downloadable link in chat
    that the patient chooses to archive.
    """
    pid = patient["sub"]
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > 20 * 1024 * 1024:   # 20 MB hard cap
        raise HTTPException(413, "file too large (20 MB max)")

    try:
        issued = file_token_service.ingest_bytes(
            patient_id=pid,
            filename=file.filename or "attachment",
            mime=file.content_type or "application/octet-stream",
            data=data,
            ttl_seconds=int(ttl_days) * 86400,
            max_downloads=max_downloads,
            kind=kind,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception(f"inbox capture-file: ingest failed for {pid}: {e}")
        raise HTTPException(500, "file storage failed")

    try:
        item = inbox_service.create_item(
            patient_id=pid,
            kind=kind,
            title=title,
            body=body,
            severity=severity,
            source=source,
            source_id=source_id,
            attachment_token=issued["token"],
            attachment_name=issued["name"],
            attachment_mime=issued["mime"],
            attachment_size=issued["size"],
            metadata={"ttl_days": ttl_days},
            ttl_days=ttl_days,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception(f"inbox capture-file: item create failed for {pid}: {e}")
        raise HTTPException(500, "inbox write failed")

    return CaptureFileResponse(
        ok=True, item=item, token=issued["token"], expires_at=issued["expires_at"],
    )


# ── Anonymous file download via signed token ─────────────────────────────────

@router.get("/file/{token}")
def download_file(token: str):
    """
    Bearer-token download. No JWT required — the token itself IS the
    authorization (same model as S3 presigned URLs).
    """
    resolved = file_token_service.resolve(token)
    if not resolved:
        raise HTTPException(404, "link expired or invalid")
    meta, data = resolved

    # Force attachment disposition so browsers never inline unexpected mimes.
    safe_name = (meta.get("original_name") or "download").replace('"', "")
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}"',
        "Cache-Control":       "private, no-cache, no-store, must-revalidate",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(
        content=data,
        media_type=meta.get("mime", "application/octet-stream"),
        headers=headers,
    )


@router.get("/file/{token}/peek")
def peek_file(token: str):
    """Metadata-only (name, size, expiry). Useful for UI previews."""
    meta = file_token_service.peek(token)
    if not meta:
        raise HTTPException(404, "link expired or invalid")
    # Drop storage_path / internal fields — peek() already strips it, but
    # be explicit at the boundary.
    return {
        "name":          meta.get("original_name"),
        "mime":          meta.get("mime"),
        "size":          meta.get("size"),
        "expires_at":    meta.get("expires_at"),
        "downloads":     meta.get("downloads"),
        "max_downloads": meta.get("max_downloads"),
        "kind":          meta.get("kind"),
    }
