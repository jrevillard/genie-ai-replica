"""
Scout Directory Routes — patient-facing scout browsing + help suggestions.

No role gate on read endpoints — any authenticated or anonymous patient
can browse the scout directory. Write endpoints (suggest help, set
availability) require a patient JWT or scout identity.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/scout-directory", tags=["scout-directory"])


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


def _get_service():
    from src.agent.amina_agent import get_agent
    from src.services.scout_directory_service import ScoutDirectoryService
    return ScoutDirectoryService(get_agent().memory_manager.redis)


# ── Public read endpoints ────────────────────────────────────────

@router.get("/list")
async def list_scouts(village: Optional[str] = None):
    svc = _get_service()
    scouts = await svc.list_public_scouts(village=village)
    return {"scouts": scouts, "count": len(scouts)}


@router.get("/scout/{scout_id}")
async def get_scout_detail(scout_id: str):
    svc = _get_service()
    scout = await svc.get_public_scout(scout_id)
    if not scout:
        raise HTTPException(status_code=404, detail="Scout not found")
    return scout


# ── Availability (scout self-service) ────────────────────────────

class SetAvailabilityReq(BaseModel):
    status: str  # available | busy | offline
    note: str = ""


@router.put("/scout/{scout_id}/availability")
async def set_availability(scout_id: str, req: SetAvailabilityReq, request: Request):
    jwt = _jwt_payload(request)
    if not jwt:
        raise HTTPException(status_code=401, detail="Authentication required")
    svc = _get_service()
    result = await svc.set_availability(scout_id, req.status, req.note)
    return {"scout_id": scout_id, "availability": result}


# ── Help suggestions (any patient) ──────────────────────────────

class SuggestHelpReq(BaseModel):
    person_name: str
    person_age: int = 0
    person_village: str = ""
    reason: str
    urgency: str = "normal"
    preferred_scout_id: str = ""


@router.post("/suggest")
async def suggest_help(req: SuggestHelpReq, request: Request):
    jwt = _jwt_payload(request)
    if not jwt:
        raise HTTPException(status_code=401, detail="Patient login required to suggest help")
    if not req.person_name.strip():
        raise HTTPException(status_code=400, detail="person_name is required")
    if not req.reason.strip():
        raise HTTPException(status_code=400, detail="reason is required")

    svc = _get_service()
    suggestion = await svc.create_suggestion(
        suggester_id=jwt.get("sub", ""),
        suggester_name=jwt.get("name", ""),
        person_name=req.person_name,
        person_age=req.person_age,
        person_village=req.person_village,
        reason=req.reason,
        urgency=req.urgency,
        preferred_scout_id=req.preferred_scout_id,
    )
    return {"suggestion": suggestion, "status": "submitted"}


@router.get("/suggestions")
async def list_suggestions(
    request: Request,
    status: Optional[str] = "pending",
    role: Optional[str] = None,
):
    jwt = _jwt_payload(request)
    pid = (jwt or {}).get("sub", "")
    svc = _get_service()
    items = await svc.list_suggestions(status=status or None)
    # Alkalo/admin see ALL suggestions; patients see only their own
    effective_role = role or "patient"
    if effective_role not in ("alkalo", "admin"):
        if pid:
            items = [s for s in items if s.get("suggester_id") == pid]
    return {"suggestions": items, "count": len(items)}


# ── Resolve (Alkalo / admin only) ────────────────────────────────

class ResolveSuggestionReq(BaseModel):
    resolution: str
    role: str


@router.post("/suggestions/{suggestion_id}/resolve")
async def resolve_suggestion(
    suggestion_id: str, req: ResolveSuggestionReq, request: Request,
):
    if req.role not in ("alkalo", "admin"):
        raise HTTPException(status_code=403, detail="Only Alkalo/admin can resolve suggestions")
    svc = _get_service()
    result = await svc.resolve_suggestion(suggestion_id, req.resolution, req.role)
    if not result:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return result
