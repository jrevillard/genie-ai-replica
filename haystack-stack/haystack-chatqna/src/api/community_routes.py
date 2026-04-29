"""Community feature endpoints — Bantaba, Scouts, Scoreboard, Seasonal, Healer Bridge.

Includes role-gated CRUD for community admin:
  VHW:       Bantaba members + adherence, Scout assignments + checks, Scoreboard pillars
  Alkalo:    Bantaba approval, Scoreboard notes
  Clinician: Scout review, Seasonal custom tips
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List

from src.services import community


def _jwt_payload(request: Request) -> Optional[dict]:
    """Best-effort JWT decode for endpoints that need the caller's
    identity. Returns None if no token or verification fails — callers
    must treat that as an auth failure."""
    try:
        auth = request.headers.get("Authorization", "") if request else ""
        tok = auth.replace("Bearer ", "").strip() if auth.lower().startswith("bearer ") else ""
        if not tok:
            return None
        from src.services.auth import verify_jwt  # local import → avoid circular
        return verify_jwt(tok)
    except Exception:
        return None

router = APIRouter(prefix="/community", tags=["community"])

# Role access matrices — scout ownership moved to Alkalo per the
# 2026-04-19 role split (same change set that moved supply → clinician
# and care-path → vhw). Alkalos know which youths to trust with elder
# check-ins in their village, so they own create / remove / assign.
# Admin stays in the set so the role-switcher can impersonate.
BANTABA_WRITE  = {"alkalo", "admin"}          # full management (add/remove/rename/highlight)
BANTABA_SELF   = {"patient", "alkalo", "admin"}  # self-actions (log own adherence)
VILLAGE_WRITE  = {"vhw", "alkalo", "admin"}   # + admin so the role-switcher can impersonate
SCOUT_WRITE    = {"alkalo", "admin"}
SEASONAL_WRITE = {"clinician"}


def _get_admin():
    from src.agent.amina_agent import get_agent
    from src.services.community_admin import CommunityAdminService
    return CommunityAdminService(get_agent().memory_manager.redis)


def _check(role, allowed):
    if not role or role not in allowed:
        raise HTTPException(status_code=403, detail=f"Requires role: {', '.join(allowed)}. Got: '{role}'")


@router.get("/bantaba")
async def bantaba_circle(
    request: Request,
    user_id: Optional[str] = None,
    circle_id: Optional[str] = None,
):
    """Get a Bantaba circle. If circle_id is given, return that specific
    circle. Otherwise, if a patient JWT is present, return their circle.
    Falls back to the shared demo circle for unauthenticated callers."""
    admin = _get_admin()
    if circle_id:
        return await admin.get_bantaba(circle_id)
    jwt = _jwt_payload(request)
    pid = jwt.get("sub", "") if jwt else ""
    if pid:
        try:
            return await admin.ensure_patient_circle(
                pid, jwt.get("name", ""),
            )
        except Exception:
            pass
    try:
        return await admin.get_bantaba()
    except Exception:
        return community.get_bantaba_circle(user_id)


@router.get("/scout")
async def youth_scout(user_id: Optional[str] = None):
    """Get the youth scout's profile — reads from Redis first, falls back to mock."""
    try:
        admin = _get_admin()
        return await admin.get_scout()
    except Exception:
        return community.get_youth_scout(user_id)


@router.get("/village")
async def village_scoreboard(village: str = "Kerewan"):
    """Village health scoreboard — reads from Redis first, falls back to mock."""
    try:
        admin = _get_admin()
        return await admin.get_village(village)
    except Exception:
        return community.get_village_scoreboard(village)


@router.get("/seasonal")
async def seasonal_rhythm():
    """Current Gambian season + relevant NCD health guidance."""
    return community.get_seasonal_rhythm()


@router.get("/healer-bridge")
async def healer_bridge(user_id: Optional[str] = None, session_id: Optional[str] = None):
    """Dual-path care status — enriched with live supply + dualpath from patient_care."""
    data = community.get_healer_bridge(user_id)
    return await _enrich_healer_bridge(data, session_id)


async def _enrich_healer_bridge(data: dict, session_id: Optional[str] = None) -> dict:
    """Merge live supply + dualpath data from patient_care Redis into the healer bridge card."""
    if not session_id:
        return data
    try:
        from src.agent.amina_agent import get_agent
        from src.services.patient_care import PatientCareService
        svc = PatientCareService(get_agent().memory_manager.redis)

        # Merge supply data
        supply = await svc.get_supply(session_id)
        if supply and supply.get("medications"):
            med = supply["medications"][0]
            data["supply"] = {
                "medicine": med.get("name", ""),
                "days_remaining": med.get("days_remaining", 0),
                "where_to_refill": f"{med.get('refill_location', '')} — {med.get('cost_per_pack', '')}",
                "in_stock": med.get("in_stock", True),
                "tablets_remaining": med.get("tablets_remaining", 0),
            }

        # Merge dualpath data
        dp = await svc.get_dual_path(session_id)
        if dp:
            if dp.get("traditional_care"):
                data["traditional_care"] = dp["traditional_care"]
            if dp.get("modern_care"):
                data["modern_care"] = dp["modern_care"]
            if dp.get("interactions_flag"):
                data["interactions_flag"] = dp["interactions_flag"]
            if dp.get("progress"):
                data["progress"] = dp["progress"]
    except Exception:
        pass  # Fall back to mock data if care service fails
    return data


@router.get("/all")
async def all_features(
    request: Request,
    user_id: Optional[str] = None,
    village: str = "Kerewan",
    session_id: Optional[str] = None,
):
    """Return all community features in ONE call.
    Always returns the shared community bantaba. If a patient JWT is
    present, also returns their personal circle as ``my_circle``."""
    admin = _get_admin()
    jwt = _jwt_payload(request)
    pid  = jwt.get("sub", "") if jwt else ""
    pname = jwt.get("name", "") if jwt else ""

    try:
        bantaba = await admin.get_bantaba()
    except Exception:
        bantaba = community.get_bantaba_circle(user_id)

    my_circle = None
    if pid:
        try:
            my_circle = await admin.ensure_patient_circle(pid, pname)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "ensure_patient_circle failed for %s: %s", pid, exc,
            )

    try:
        scout = await admin.get_scout()
    except Exception:
        scout = community.get_youth_scout(user_id)
    try:
        village_data = await admin.get_village(village)
    except Exception:
        village_data = community.get_village_scoreboard(village)

    healer = community.get_healer_bridge(user_id)
    healer = await _enrich_healer_bridge(healer, session_id)

    return {
        "bantaba": bantaba,
        "my_circle": my_circle,
        "scout": scout,
        "village": village_data,
        "seasonal": community.get_seasonal_rhythm(),
        "healer_bridge": healer,
    }


# ═══════════════════════════════════════════════════════════════
# ADMIN CRUD — role-gated writes
# ═══════════════════════════════════════════════════════════════

# Returns the role access matrix so the frontend knows which buttons to show
@router.get("/permissions")
async def get_permissions():
    return {
        "bantaba": list(BANTABA_WRITE),
        "village": list(VILLAGE_WRITE),
        "scout": list(SCOUT_WRITE),
        "seasonal": list(SEASONAL_WRITE),
        "supply": ["clinician", "vhw"],
        "dualpath": ["clinician", "vhw"],
    }


# ── BANTABA ADMIN ─────────────────────────────────────────────

class AddMemberReq(BaseModel):
    name: str
    age: int
    conditions: List[str] = []
    role: str


@router.post("/bantaba/members")
async def add_bantaba_member(req: AddMemberReq, circle_id: str = "default"):
    _check(req.role, BANTABA_WRITE)
    return await _get_admin().add_member(circle_id, req.name, req.age, req.conditions, req.role)


@router.delete("/bantaba/members/{member_id}")
async def remove_bantaba_member(member_id: str, role: str = "vhw", circle_id: str = "default"):
    _check(role, BANTABA_WRITE)
    return await _get_admin().remove_member(circle_id, member_id)


class LogAdherenceReq(BaseModel):
    member_id: str
    adherence_week: int
    role: str


@router.put("/bantaba/adherence")
async def log_adherence(req: LogAdherenceReq, request: Request, circle_id: str = "default"):
    """Log a member's weekly adherence.

    Alkalo / admin can log for any member. Patients can only log on
    their OWN row — the row's name must match their JWT name claim.
    This stops a malicious patient from editing a sibling's adherence
    by guessing a member_id.
    """
    _check(req.role, BANTABA_SELF)

    if req.role == "patient":
        jwt = _jwt_payload(request)
        if not jwt:
            raise HTTPException(status_code=401, detail="Patient self-logging requires a JWT")
        jwt_name = (jwt.get("name") or "").strip().lower()
        data = await _get_admin().get_bantaba(circle_id)
        target = next((m for m in data.get("members", []) if m.get("id") == req.member_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="member not found")
        if (target.get("name") or "").strip().lower() != jwt_name or not jwt_name:
            raise HTTPException(
                status_code=403,
                detail="Patients may only log adherence on their own row",
            )

    return await _get_admin().log_adherence(circle_id, req.member_id, req.adherence_week, req.role)


class UpdateHighlightReq(BaseModel):
    highlight: str
    role: str


@router.put("/bantaba/highlight")
async def update_highlight(req: UpdateHighlightReq, circle_id: str = "default"):
    _check(req.role, BANTABA_WRITE)
    return await _get_admin().update_bantaba_highlight(circle_id, req.highlight, req.role)


# ── Per-patient circle endpoints (2026-04-19 rewrite) ──────────────

class RenameBantabaReq(BaseModel):
    new_name: str
    role: str


@router.put("/bantaba/rename")
async def rename_bantaba(req: RenameBantabaReq, circle_id: str = "default"):
    """Alkalo / admin rename a circle. Capped to 80 chars server-side."""
    _check(req.role, BANTABA_WRITE)
    return await _get_admin().rename_bantaba(circle_id, req.new_name, req.role)


@router.get("/bantaba/mine")
async def get_my_bantaba(request: Request):
    """Return (and create if missing) the circle owned by the caller.
    Resolves the owner from the patient JWT — no body needed."""
    jwt = _jwt_payload(request)
    if not jwt:
        raise HTTPException(status_code=401, detail="Patient JWT required")
    pid  = jwt.get("sub") or ""
    name = jwt.get("name") or ""
    if not pid:
        raise HTTPException(status_code=400, detail="JWT missing sub claim")
    return await _get_admin().ensure_patient_circle(pid, name)


@router.post("/bantaba/mine")
async def create_my_bantaba(request: Request):
    """Idempotent create for the caller's circle. Same effect as GET,
    exposed as POST so the UI can hit it on login without surprising a
    proxy that treats GETs as safe/cacheable."""
    return await get_my_bantaba(request)


@router.get("/bantaba/list")
async def list_bantaba_circles(role: str = "alkalo"):
    """List every circle so an Alkalo can pick which one to edit."""
    _check(role, BANTABA_WRITE)
    circles = await _get_admin().list_patient_circles()
    return {"circles": circles, "count": len(circles)}


# ── Patient → Alkalo "add member" request queue ──────────────────

class AddMemberRequestReq(BaseModel):
    candidate_name:   str
    candidate_age:    int = 0
    candidate_conditions: List[str] = []
    relation:         str
    reason:           str
    phone:            str = ""


@router.post("/bantaba/members/request")
async def request_add_member(req: AddMemberRequestReq, request: Request):
    """Patient submits a request to add someone to their circle. Routed
    to the Alkalo inbox. Requires the patient's JWT so the requester +
    target circle can't be spoofed — identity is taken from the token."""
    jwt = _jwt_payload(request)
    if not jwt:
        raise HTTPException(status_code=401, detail="Patient JWT required")
    pid   = jwt.get("sub") or ""
    pname = jwt.get("name") or ""
    if not pid:
        raise HTTPException(status_code=400, detail="JWT missing sub claim")

    # Make sure the requester's circle exists (auto-create on first
    # request — same idempotent pattern as /bantaba/mine).
    circle = await _get_admin().ensure_patient_circle(pid, pname)

    if not req.candidate_name.strip():
        raise HTTPException(status_code=400, detail="candidate_name is required")
    if not req.relation.strip():
        raise HTTPException(status_code=400, detail="relation is required")
    if not req.reason.strip():
        raise HTTPException(status_code=400, detail="reason is required")

    created = await _get_admin().create_add_request(
        requester_id=pid,
        requester_name=pname,
        requester_circle_id=circle.get("circle_id") or pid,
        candidate_name=req.candidate_name,
        candidate_age=req.candidate_age,
        candidate_conditions=req.candidate_conditions,
        relation=req.relation,
        reason=req.reason,
        phone=req.phone,
    )
    return {"request": created, "status": "queued"}


@router.get("/bantaba/requests")
async def list_add_requests(
    role: str = "alkalo",
    status: Optional[str] = "pending",
):
    """Alkalo inbox: all pending (or filtered) add-member requests."""
    _check(role, BANTABA_WRITE)
    items = await _get_admin().list_add_requests(status=status or None)
    return {
        "requests": items,
        "count":    len(items),
        "status":   status or "all",
    }


class DecideRequestReq(BaseModel):
    role:   str
    reason: Optional[str] = ""


@router.post("/bantaba/requests/{req_id}/approve")
async def approve_add_request(req_id: str, req: DecideRequestReq):
    """Alkalo approves → candidate auto-added to the requester's circle."""
    _check(req.role, BANTABA_WRITE)
    return await _get_admin().approve_add_request(req_id, req.role)


@router.post("/bantaba/requests/{req_id}/reject")
async def reject_add_request(req_id: str, req: DecideRequestReq):
    """Alkalo rejects → request closed, reason optional (shown to patient)."""
    _check(req.role, BANTABA_WRITE)
    return await _get_admin().reject_add_request(req_id, req.reason or "", req.role)


# ── VILLAGE ADMIN ─────────────────────────────────────────────

class UpdatePillarReq(BaseModel):
    pillar_id: str
    score: int
    detail: Optional[str] = ""
    role: str


@router.put("/village/pillar")
async def update_village_pillar(req: UpdatePillarReq, village: str = "Kerewan"):
    _check(req.role, VILLAGE_WRITE)
    return await _get_admin().update_pillar(village, req.pillar_id, req.score, req.detail, req.role)


class AlkaloNoteReq(BaseModel):
    note: str
    role: str = "alkalo"


@router.post("/village/alkalo-note")
async def add_alkalo_note(req: AlkaloNoteReq, village: str = "Kerewan"):
    # Alkalo owns the note; admin can impersonate via the role-switcher.
    _check(req.role, {"alkalo", "admin"})
    return await _get_admin().add_alkalo_note(village, req.note)


# ── SCOUT ADMIN ───────────────────────────────────────────────

class CreateScoutReq(BaseModel):
    name: str
    age: int
    village: str = "Kerewan"
    role: str


@router.post("/scout/create")
async def create_scout(req: CreateScoutReq):
    """Create a new youth scout profile. VHW/Clinician only. Rejects duplicates."""
    _check(req.role, SCOUT_WRITE)
    result = await _get_admin().create_scout(req.name, req.age, req.village, req.role)
    if result.get("duplicate"):
        raise HTTPException(status_code=409, detail=result.get("error", "Scout already exists"))
    return result


@router.get("/scouts")
async def list_scouts():
    """List all scout profiles with computed badges + duties."""
    admin = _get_admin()
    scouts = await admin.list_scouts()
    # Enrich each scout with computed badge + duty
    enriched = []
    for s in scouts:
        sid = s.get("scout_id", "default")
        try:
            enriched.append(await admin.get_scout(sid))
        except Exception:
            enriched.append(s)
    return {"scouts": enriched}


# NOTE: route order matters in FastAPI. More-specific literal paths must
# be declared BEFORE the `/scout/{scout_id}` parametric route, otherwise
# a GET /scout/applications gets matched with scout_id="applications"
# and returns a synthetic "applications" scout instead of the intended
# list. Hence the applications endpoints live here, *above*
# get_scout_profile.

@router.get("/scout/applications")
async def get_scout_applications(role: str = "alkalo"):
    """List pending scout applications. Alkalo / admin only."""
    _check(role, SCOUT_WRITE)
    return {"applications": await _get_admin().get_pending_applications()}


@router.get("/scout/{scout_id}")
async def get_scout_profile(scout_id: str):
    """Get a single scout profile with badge + duty + greeting."""
    admin = _get_admin()
    return await admin.get_scout(scout_id)


@router.get("/scout/{scout_id}/greeting")
async def get_scout_greeting(scout_id: str):
    """Get the personalized scout greeting (duties + rewards + elder status)."""
    admin = _get_admin()
    data = await admin.get_scout(scout_id)
    return {
        "greeting": data.get("scout_greeting", ""),
        "badge": data.get("badge"),
        "weekly_duty": data.get("weekly_duty"),
    }


@router.delete("/scout/{scout_id}")
async def remove_scout(scout_id: str, role: str = "vhw"):
    """Remove a youth scout. VHW/Clinician only."""
    _check(role, SCOUT_WRITE)
    ok = await _get_admin().remove_scout(scout_id, role)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to remove scout")
    return {"removed": True, "scout_id": scout_id}


class ScoutApplicationReq(BaseModel):
    name: str
    age: int
    village: str = "Kerewan"
    phone: str = ""
    # Richer fields — surfaced in the redesigned form so the Alkalo can
    # assign elders based on proximity + availability. All optional so
    # older callers (sanity scripts) keep working.
    locality:     str = ""
    availability: str = ""
    reason:       str = ""


@router.post("/scout/apply")
async def apply_for_scout(req: ScoutApplicationReq, request: Request):
    """Patient applies to become a youth scout. Age must be 12..24.

    If the caller carries a patient JWT we stamp applicant_id on the
    application so we can notify them on receipt / approve / reject /
    elder-assignment. Unauth applications still work for demo scripts.
    """
    jwt = _jwt_payload(request)
    applicant_id = (jwt or {}).get("sub") or ""

    result = await _get_admin().apply_for_scout(
        req.name, req.age, req.village, req.phone,
        applicant_id=applicant_id,
        locality=req.locality,
        availability=req.availability,
        reason=req.reason,
    )
    if not result.get("approved"):
        raise HTTPException(status_code=400, detail=result.get("reason", "Application rejected"))
    return result


# (get_scout_applications moved up above /scout/{scout_id} — see note)


class ApproveRejectReq(BaseModel):
    app_id: str
    role: str
    reason: str = ""


@router.post("/scout/applications/approve")
async def approve_application(req: ApproveRejectReq):
    """VHW approves a scout application."""
    _check(req.role, SCOUT_WRITE)
    return await _get_admin().approve_scout_application(req.app_id, req.role)


@router.post("/scout/applications/reject")
async def reject_application(req: ApproveRejectReq):
    """VHW rejects a scout application."""
    _check(req.role, SCOUT_WRITE)
    return await _get_admin().reject_scout_application(req.app_id, req.reason, req.role)


class AssignElderReq(BaseModel):
    elder_name: str
    relation: str
    age: int
    role: str


@router.post("/scout/assign")
async def assign_elder(req: AssignElderReq, scout_id: str = "default"):
    _check(req.role, SCOUT_WRITE)
    return await _get_admin().assign_elder(scout_id, req.elder_name, req.relation, req.age, req.role)


class LogCheckReq(BaseModel):
    elder_name: str
    bp: str
    flag: str = "green"  # green | yellow | red
    role: str


@router.put("/scout/check")
async def log_elder_check(req: LogCheckReq, scout_id: str = "default"):
    _check(req.role, SCOUT_WRITE)
    return await _get_admin().log_elder_check(scout_id, req.elder_name, req.bp, req.flag, req.role)


# ── SEASONAL ADMIN ────────────────────────────────────────────

class AddTipReq(BaseModel):
    icon: str = "💡"
    tip: str
    season: str = "general"
    role: str


@router.post("/seasonal/tips")
async def add_custom_tip(req: AddTipReq):
    _check(req.role, SEASONAL_WRITE)
    return await _get_admin().add_custom_tip(req.icon, req.tip, req.season, req.role)


# ── AUDIT LOG ─────────────────────────────────────────────────

@router.get("/audit")
async def get_audit_log(category: Optional[str] = None, limit: int = 20):
    """View recent form changes. Stored in ArcadeDB CommunityAuditLog."""
    from src.db.community_store import get_audit_log
    entries = await get_audit_log(category, limit)
    return {"entries": entries, "count": len(entries)}
