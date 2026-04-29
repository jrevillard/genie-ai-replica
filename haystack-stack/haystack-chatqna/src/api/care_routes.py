"""
Patient Care CRUD API — Medicine Supply + Dual-Path Care

Role model (two-layer)
----------------------
Every write is gated against an **effective role** resolved by
`_resolve_effective_role(request, body_role)`:

  1. The HTTP `Authorization: Bearer <jwt>` header carries the user's
     **true role** (set by the login endpoint + signed). This is the
     authoritative source of truth.
  2. The POST/PUT body's `role` field is an **impersonation hint**.
     The resolver only honors it when the JWT role is "admin" — so a
     non-admin client cannot self-promote by sending `role: "admin"`
     in the body.
  3. Missing JWT falls back to trusting the body role (legacy demo
     path — kept so the 97-check sanity script + the existing scripts
     under scripts/ keep working without every caller being updated).
     Set CARE_REQUIRE_JWT=true in the backend env to make JWT
     mandatory for production deployments.

Role matrix (enforced by the effective role returned from the resolver):
  - Supply writes:   {clinician, vhw, admin}
  - Care-path writes:{clinician,      admin}
  - Everything else: 403

Reads are public (no role gate).
"""

import os
import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List

from src.services.auth import verify_jwt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/care", tags=["care"])

# If "true" the resolver refuses requests that don't carry a JWT. Kept
# "false" by default so the existing demo / sanity scripts keep working.
CARE_REQUIRE_JWT = (os.getenv("CARE_REQUIRE_JWT", "false") or "").lower() == "true"

# Dev / local-stack escape hatch.
# When CARE_TRUST_BODY_ROLE=true, the resolver ignores the JWT's role claim
# and returns whatever role the request body declares. This is needed in
# local dev where the user logs in as a patient and then uses the
# floating RoleSwitcher to "act as" clinician / vhw — without this flag
# the JWT role beats the body claim and every supply/care-path write is
# rejected with 403 even though the form is visible. KEEP "false" in
# production: any patient could otherwise self-promote to admin by
# sending {"role":"admin"} in the body. Set it true in
# haystack-stack/.env for local development only.
CARE_TRUST_BODY_ROLE = (os.getenv("CARE_TRUST_BODY_ROLE", "false") or "").lower() == "true"

# Role split (per product 2026-04-30, supersedes 2026-04-19):
#   - Medicine supply is CLINIC-owned — the clinic pharmacist / clinician
#     records dispenses; VHWs should NOT edit supply rows in the field
#     because their stock doesn't match the facility's dispense log.
#   - Dual-path care is shared — VHWs log traditional visits and in-
#     community BP checks; clinicians log modern-facility handoffs and
#     adjust care plans. Both write the same ledger now (per user req
#     2026-04-30: "both can update"). Read-only restrictions removed.
#   - "admin" stays in both sets so the role-switcher can impersonate
#     either clinician or VHW for debugging / demo.
SUPPLY_WRITE_ROLES   = {"clinician",                "admin"}
CAREPATH_WRITE_ROLES = {"clinician", "vhw",         "admin"}

# Per-tab override — imams may update the *traditional* care path only
# (faith-based / herbal recommendations, dua, community elder advice).
# They cannot touch modern-facility entries, care-plan interactions, or
# progress markers; those tabs still use CAREPATH_WRITE_ROLES.
CAREPATH_TRADITIONAL_WRITE_ROLES = CAREPATH_WRITE_ROLES | {"imam"}
# Back-compat alias for any legacy callers still importing WRITE_ROLES.
WRITE_ROLES = SUPPLY_WRITE_ROLES


def _get_service():
    from src.agent.amina_agent import get_agent
    from src.services.patient_care import PatientCareService
    return PatientCareService(get_agent().memory_manager.redis)


def _check_write_role(role: Optional[str]):
    """Supply-side write gate (VHW + clinician + admin)."""
    if not role or role not in SUPPLY_WRITE_ROLES:
        raise HTTPException(
            status_code=403,
            detail=f"Write access requires role 'clinician', 'vhw', or 'admin'. Got: '{role}'",
        )


def _check_carepath_write_role(role: Optional[str], tab: Optional[str] = None):
    """
    Care-path (dual-path) write gate.

    Tabs and their writers:
      - traditional: clinician, vhw, imam, admin
      - modern / interaction / progress: clinician, vhw, admin

    `tab` is the dual-path entry type ("traditional" | "modern" |
    "interaction" | "progress"). Pass it through from the route. When
    omitted (legacy callers) we fall back to the strict set so existing
    code stays as-restrictive-as-before.
    """
    allowed = CAREPATH_TRADITIONAL_WRITE_ROLES if tab == "traditional" else CAREPATH_WRITE_ROLES
    if not role or role not in allowed:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Care-path edits are locked. Got: '{role}'. "
                f"Allowed for tab '{tab or '*'}': {sorted(allowed)}."
            ),
        )


def _resolve_effective_role(request: Request, body_role: Optional[str]) -> str:
    """
    Two-layer role resolution.

      1. Read the JWT from the Authorization: Bearer header.
      2. If a valid JWT is present:
            - JWT role == "admin"  → admin may IMPERSONATE: use body_role
              (falling back to "admin" if body is blank/None).
            - JWT role is anything else → IGNORE body_role entirely;
              return the JWT role. Prevents a non-admin caller from
              self-promoting by sending `role: "admin"` in the body.
      3. No JWT:
            - If CARE_REQUIRE_JWT is set → raise 401.
            - Else fall back to body_role (legacy demo / sanity path).

    Returned role is lowercased. Permission gating is then done by the
    caller with `_check_write_role(...)` / `_check_carepath_write_role(...)`.
    """
    auth = (request.headers.get("Authorization") or "").strip()
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()

    body_role_norm = (body_role or "").strip().lower() or None

    # Dev escape hatch — see CARE_TRUST_BODY_ROLE comment at top of file.
    # When enabled we honor the body role unconditionally, which is what
    # the floating RoleSwitcher needs in local dev (patient JWT but
    # acting-as clinician / vhw). Production: keep this flag off.
    if CARE_TRUST_BODY_ROLE and body_role_norm:
        return body_role_norm

    if token:
        payload = verify_jwt(token)
        if payload:
            true_role = (payload.get("role") or "").strip().lower() or "patient"
            if true_role == "admin":
                # Admin impersonation path. If the body doesn't carry a
                # role, act as admin. Log the impersonation so audit
                # tooling can see it without having to dig into Redis.
                effective = body_role_norm or "admin"
                if effective != "admin":
                    logger.info(
                        f"care: admin impersonating role='{effective}' "
                        f"(sub={payload.get('sub')})"
                    )
                return effective
            # Non-admin JWT — ignore body_role to stop privilege escalation.
            if body_role_norm and body_role_norm != true_role:
                logger.info(
                    f"care: ignoring body role='{body_role_norm}' "
                    f"(JWT role='{true_role}', sub={payload.get('sub')})"
                )
            return true_role
        # Present but invalid JWT — treat as no credentials.
        logger.info("care: Authorization header carried invalid JWT; falling through")

    # No (or invalid) JWT — strict mode rejects; legacy demo mode accepts.
    if CARE_REQUIRE_JWT:
        raise HTTPException(
            status_code=401,
            detail="CARE_REQUIRE_JWT=true: care writes need an Authorization: Bearer <jwt>",
        )
    return body_role_norm or ""


# ── READ ──────────────────────────────────────────────────────

@router.get("/supply/{session_id}")
async def get_supply(session_id: str):
    svc = _get_service()
    return await svc.get_supply(session_id)


@router.get("/dualpath/{session_id}")
async def get_dual_path(session_id: str):
    svc = _get_service()
    return await svc.get_dual_path(session_id)


@router.get("/{session_id}")
async def get_all_care_data(session_id: str):
    """Get both supply + dual-path in one call."""
    svc = _get_service()
    return {
        "supply": await svc.get_supply(session_id),
        "dual_path": await svc.get_dual_path(session_id),
    }


# ── WRITE: MEDICINE SUPPLY ────────────────────────────────────

class UpdateSupplyRequest(BaseModel):
    medication_name: str
    tablets_remaining: Optional[int] = None
    cost_per_pack: Optional[str] = None
    refill_location: Optional[str] = None
    in_stock: Optional[bool] = None
    role: str = "clinician"  # clinician | vhw


@router.put("/supply/{session_id}")
async def update_supply(session_id: str, req: UpdateSupplyRequest, request: Request):
    effective = _resolve_effective_role(request, req.role)
    _check_write_role(effective)
    svc = _get_service()
    return await svc.update_supply(
        session_id,
        medication_name=req.medication_name,
        tablets_remaining=req.tablets_remaining,
        cost_per_pack=req.cost_per_pack,
        refill_location=req.refill_location,
        in_stock=req.in_stock,
        updated_by=effective,
    )


class DispenseDoseRequest(BaseModel):
    medication_name: str
    role: str = "clinician"


@router.post("/supply/{session_id}/dispense")
async def dispense_dose(session_id: str, req: DispenseDoseRequest):
    """Simulate daily dose consumption (decrement tablets_remaining)."""
    _check_write_role(req.role)
    svc = _get_service()
    return await svc.dispense_dose(session_id, req.medication_name)


# ── WRITE: TRADITIONAL CARE ──────────────────────────────────

class UpdateTraditionalRequest(BaseModel):
    practitioner: Optional[str] = None
    practices: Optional[List[str]] = None
    last_visit_days_ago: Optional[int] = None
    notes: Optional[str] = None
    role: str = "clinician"


@router.put("/dualpath/{session_id}/traditional")
async def update_traditional(session_id: str, req: UpdateTraditionalRequest, request: Request):
    effective = _resolve_effective_role(request, req.role)
    _check_carepath_write_role(effective)
    svc = _get_service()
    return await svc.update_traditional_care(
        session_id,
        practitioner=req.practitioner,
        practices=req.practices,
        last_visit_days_ago=req.last_visit_days_ago,
        notes=req.notes,
        updated_by=effective,
    )


# ── WRITE: MODERN CARE ───────────────────────────────────────

class UpdateModernRequest(BaseModel):
    facility: Optional[str] = None
    chw_name: Optional[str] = None
    medications: Optional[List[str]] = None
    last_visit_days_ago: Optional[int] = None
    notes: Optional[str] = None
    role: str = "clinician"


@router.put("/dualpath/{session_id}/modern")
async def update_modern(session_id: str, req: UpdateModernRequest, request: Request):
    effective = _resolve_effective_role(request, req.role)
    _check_carepath_write_role(effective)
    svc = _get_service()
    return await svc.update_modern_care(
        session_id,
        facility=req.facility,
        chw_name=req.chw_name,
        medications=req.medications,
        last_visit_days_ago=req.last_visit_days_ago,
        notes=req.notes,
        updated_by=effective,
    )


# ── WRITE: INTERACTION FLAG ──────────────────────────────────

class UpdateInteractionRequest(BaseModel):
    safe: bool
    notes: str
    role: str = "clinician"


@router.put("/dualpath/{session_id}/interaction")
async def update_interaction(session_id: str, req: UpdateInteractionRequest, request: Request):
    effective = _resolve_effective_role(request, req.role)
    _check_carepath_write_role(effective)
    svc = _get_service()
    return await svc.update_interaction_flag(
        session_id,
        safe=req.safe,
        notes=req.notes,
        checked_by=effective,
    )


# ── WRITE: PROGRESS ──────────────────────────────────────────

class UpdateProgressRequest(BaseModel):
    bp_current: Optional[str] = None
    months_on_plan: Optional[int] = None
    message: Optional[str] = None
    role: str = "clinician"


@router.put("/dualpath/{session_id}/progress")
async def update_progress(session_id: str, req: UpdateProgressRequest, request: Request):
    effective = _resolve_effective_role(request, req.role)
    _check_carepath_write_role(effective)
    svc = _get_service()
    return await svc.update_progress(
        session_id,
        bp_current=req.bp_current,
        months_on_plan=req.months_on_plan,
        message=req.message,
        updated_by=effective,
    )
