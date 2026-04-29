"""
Patient AMINA ID — lookup + circle linking endpoints.

Every patient has a unique AMINA ID (their patient_id formatted as
AMINA-XXXXXXXX). This module provides:

  GET  /patient/amina-id          → returns the caller's own AMINA ID
  GET  /patient/lookup/{amina_id} → resolves an AMINA ID to a public profile
  POST /bantaba/members/request   → updated to accept candidate_amina_id

The lookup returns ONLY the public-safe fields: name, age, conditions,
region. No phone, no medications, no vitals.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["patient-id"])


# ── Helpers ──────────────────────────────────────────────────────────

def _jwt_payload(request: Request) -> Optional[dict]:
    try:
        auth = request.headers.get("Authorization", "") if request else ""
        tok = auth.replace("Bearer ", "").strip() if auth.lower().startswith("bearer ") else ""
        if not tok:
            return None
        from src.services.auth import verify_jwt
        return verify_jwt(tok)
    except Exception:
        return None


def _normalize_amina_id(raw: str) -> str:
    """Strip 'AMINA-' prefix if present, uppercase, strip whitespace."""
    s = raw.strip().upper()
    if s.startswith("AMINA-"):
        s = s[6:]
    return s.strip()


def _format_amina_id(patient_id: str) -> str:
    return f"AMINA-{patient_id.upper()}"


# ── GET /patient/amina-id — return caller's own ID ──────────────────

@router.get("/patient/amina-id")
async def get_my_amina_id(request: Request):
    """Returns the authenticated patient's AMINA ID for sharing."""
    jwt = _jwt_payload(request)
    if not jwt:
        raise HTTPException(status_code=401, detail="Authentication required")
    pid = jwt.get("sub", "")
    name = jwt.get("name", "")
    if not pid:
        raise HTTPException(status_code=400, detail="No patient ID in token")
    return {
        "amina_id": _format_amina_id(pid),
        "patient_id": pid,
        "name": name,
    }


# ── GET /patient/lookup/{amina_id} — resolve to public profile ─────

@router.get("/patient/lookup/{amina_id}")
async def lookup_patient_by_amina_id(amina_id: str):
    """Resolve an AMINA ID to a public-safe patient profile.

    Returns name, age, conditions, region. Does NOT expose phone,
    medications, vitals, or any private health data.
    """
    pid = _normalize_amina_id(amina_id)
    if not pid or len(pid) < 4:
        raise HTTPException(status_code=400, detail="Invalid AMINA ID format")

    from src.repositories.patient_repo import PatientRepository
    repo = PatientRepository()
    patient = await repo.get_patient(pid)

    if not patient:
        raise HTTPException(
            status_code=404,
            detail="No patient found with this AMINA ID. Please check the code and try again.",
        )

    conditions = []
    if patient.conditions:
        conditions = [c.value if hasattr(c, "value") else str(c) for c in patient.conditions]

    return {
        "found": True,
        "amina_id": _format_amina_id(pid),
        "patient_id": pid,
        "name": patient.name or "",
        "age": patient.age or 0,
        "conditions": conditions,
        "region": patient.region.value if hasattr(patient.region, "value") else str(patient.region or ""),
    }


# ── POST /bantaba/members/request-by-id — link via AMINA ID ────────

class LinkByIdRequest(BaseModel):
    candidate_amina_id: str
    relation: str
    reason: str

@router.post("/bantaba/members/request-by-id")
async def request_add_member_by_id(req: LinkByIdRequest, request: Request):
    """Patient submits a circle-add request using the candidate's AMINA ID.

    The candidate MUST be an existing AMINA patient. Their name, age, and
    conditions are auto-filled from their profile — no free-text needed.
    Still goes through Alkalo approval.
    """
    jwt = _jwt_payload(request)
    if not jwt:
        raise HTTPException(status_code=401, detail="Patient JWT required")
    requester_pid = jwt.get("sub", "")
    requester_name = jwt.get("name", "")
    if not requester_pid:
        raise HTTPException(status_code=400, detail="JWT missing sub claim")

    candidate_pid = _normalize_amina_id(req.candidate_amina_id)
    if not candidate_pid:
        raise HTTPException(status_code=400, detail="candidate_amina_id is required")
    if candidate_pid == requester_pid:
        raise HTTPException(status_code=400, detail="You cannot add yourself to your own circle")
    if not req.relation.strip():
        raise HTTPException(status_code=400, detail="relation is required")
    if not req.reason.strip():
        raise HTTPException(status_code=400, detail="reason is required")

    from src.repositories.patient_repo import PatientRepository
    repo = PatientRepository()
    candidate = await repo.get_patient(candidate_pid)
    if not candidate:
        raise HTTPException(
            status_code=404,
            detail="No patient found with this AMINA ID. Ask them to check their code.",
        )

    candidate_conditions = []
    if candidate.conditions:
        candidate_conditions = [c.value if hasattr(c, "value") else str(c) for c in candidate.conditions]

    from src.services.community_admin import CommunityAdmin
    admin = CommunityAdmin()
    circle = await admin.ensure_patient_circle(requester_pid, requester_name)

    created = await admin.create_add_request(
        requester_id=requester_pid,
        requester_name=requester_name,
        requester_circle_id=circle.get("circle_id") or requester_pid,
        candidate_name=candidate.name or "",
        candidate_age=candidate.age or 0,
        candidate_conditions=candidate_conditions,
        relation=req.relation.strip(),
        reason=req.reason.strip(),
        phone="",
    )

    # Patch the Redis entry to include the linked AMINA ID so the
    # Alkalo approval flow (and future queries) know this member
    # is a real account, not a free-text entry.
    import json
    try:
        created["candidate_amina_id"] = candidate_pid
        created["is_linked_account"] = True
        admin.redis.hset(
            admin._REQUESTS_KEY,
            created["req_id"],
            json.dumps(created, default=str),
        )
    except Exception as exc:
        logger.warning(f"Failed to patch request with amina_id: {exc}")

    return {
        "request": created,
        "status": "queued",
        "candidate": {
            "amina_id": _format_amina_id(candidate_pid),
            "name": candidate.name or "",
        },
    }
