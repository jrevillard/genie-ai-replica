"""
Observatory Staff Management API
==================================

Admin endpoints for managing MoH Observatory staff accounts.
Only accessible by users with "national" access level.

Endpoints:
  POST   /observatory/staff/create        — create staff account
  GET    /observatory/staff               — list staff
  PUT    /observatory/staff/{id}/suspend  — suspend account
  PUT    /observatory/staff/{id}/unlock   — unlock account
  PUT    /observatory/staff/{id}/reset-password — force password reset
  DELETE /observatory/staff/{id}          — deactivate (soft delete)
  GET    /observatory/audit-log           — query audit events
"""
from __future__ import annotations

import logging
import secrets
import string
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.config import settings as _settings
from src.models.gov_auth import (
    NINValidator,
    StaffIDValidator,
    ProfessionalRegValidator,
    PhoneValidator,
    access_level_for_role,
    StaffRole,
)
from src.services.observatory_security import (
    hash_password,
    log_audit_event,
    query_audit_log,
    send_onboarding_sms,
    validate_password_policy,
    verify_observatory_jwt,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/observatory", tags=["observatory-admin"])


# ── Auth helper ──────────────────────────────────────────────────

def _require_national_admin(request: Request) -> Dict[str, Any]:
    auth = (request.headers.get("Authorization") or "").strip()
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""

    payload = verify_observatory_jwt(token) if token else None
    if not payload:
        from src.services.auth import verify_jwt
        payload = verify_jwt(token) if token else None

    if not payload:
        raise HTTPException(status_code=401, detail="Authentication required")

    role = payload.get("role", "")
    access_level = payload.get("access_level", "")
    observatory_role = payload.get("observatory_role", "")

    if role == "admin":
        return payload

    if access_level == "national" or observatory_role in (
        "permanent_secretary", "director", "deputy_director"
    ):
        return payload

    raise HTTPException(status_code=403, detail="National-level access required")


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ── ArcadeDB helper ────────────────────────────────────────────

def _sql(query: str, params: dict = None):
    import requests as _req
    payload = {"language": "sql", "command": query}
    if params:
        payload["params"] = params
    resp = _req.post(
        f"{_settings.ARCADEDB_URL}/api/v1/command/{_settings.ARCADEDB_DB}",
        json=payload,
        auth=(_settings.ARCADEDB_USER, _settings.ARCADEDB_PASSWORD),
        timeout=10,
    )
    if resp.status_code != 200:
        raise Exception(f"ArcadeDB: {resp.text[:300]}")
    return resp.json()


def _rows(resp):
    return resp.get("result", [])


# ── Temp password generator ────────────────────────────────────

def _generate_temp_password() -> str:
    upper = secrets.choice(string.ascii_uppercase)
    lower = "".join(secrets.choice(string.ascii_lowercase) for _ in range(4))
    digits = "".join(secrets.choice(string.digits) for _ in range(2))
    special = secrets.choice("!@#$%&*")
    base = list(upper + lower + digits + special)
    import random
    random.SystemRandom().shuffle(base)
    return "".join(base)


# ══════════════════════════════════════════════════════════════════
#  ENDPOINTS
# ══════════════════════════════════════════════════════════════════


class CreateStaffRequest(BaseModel):
    staff_id: str
    full_name: str
    nin: str
    phone: str
    email: Optional[str] = None
    role: str
    region: Optional[str] = None
    facility: Optional[str] = None
    professional_registration: Optional[str] = None
    date_of_birth: str
    start_date: Optional[str] = None


@router.post("/staff/create")
async def create_staff(req: CreateStaffRequest, request: Request):
    """Create a new Observatory staff account. Admin-only."""
    admin = _require_national_admin(request)
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")
    admin_id = admin.get("sub", "admin")

    # Validate Staff ID
    sid_check = StaffIDValidator.validate(req.staff_id)
    if not sid_check["valid"]:
        raise HTTPException(status_code=400, detail=sid_check["error"])

    # Validate NIN
    nin_check = NINValidator.validate(req.nin)
    if not nin_check["valid"]:
        raise HTTPException(status_code=400, detail=nin_check["error"])

    # Cross-validate NIN DOB vs provided DOB
    from datetime import date
    try:
        provided_dob = date.fromisoformat(req.date_of_birth)
        if not NINValidator.cross_validate_dob(req.nin, provided_dob):
            raise HTTPException(
                status_code=400,
                detail="NIN date of birth does not match provided date of birth",
            )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date_of_birth format (YYYY-MM-DD)")

    # Validate phone
    phone_check = PhoneValidator.validate(req.phone)
    if not phone_check["valid"]:
        raise HTTPException(status_code=400, detail=phone_check["error"])

    # Validate professional registration if provided
    if req.professional_registration:
        reg_check = ProfessionalRegValidator.validate(req.professional_registration)
        if not reg_check["valid"]:
            raise HTTPException(status_code=400, detail=reg_check["error"])

    # Validate role
    valid_roles = {r.value for r in StaffRole}
    if req.role not in valid_roles:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Valid: {', '.join(sorted(valid_roles))}",
        )

    # Check for duplicate Staff ID
    try:
        existing = _sql(
            "SELECT staff_id FROM ObservatoryStaff WHERE staff_id = :sid LIMIT 1",
            {"sid": req.staff_id.strip().upper()},
        )
        if _rows(existing):
            raise HTTPException(status_code=409, detail="Staff ID already exists")
    except HTTPException:
        raise
    except Exception:
        pass

    # Generate temporary password
    temp_password = _generate_temp_password()
    pw_hash = hash_password(temp_password)
    now = datetime.now(timezone.utc).isoformat()

    try:
        _sql(
            "INSERT INTO ObservatoryStaff SET "
            "staff_id = :staff_id, full_name = :full_name, "
            "nin = :nin, phone = :phone, email = :email, "
            "role = :role, region = :region, facility = :facility, "
            "professional_reg = :prof_reg, date_of_birth = :dob, "
            "password_hash = :pw_hash, must_change_password = true, "
            "status = :status, start_date = :start_date, "
            "created_at = :now, updated_at = :now",
            {
                "staff_id": req.staff_id.strip().upper(),
                "full_name": req.full_name,
                "nin": req.nin.strip(),
                "phone": phone_check["normalized"],
                "email": (req.email or "").strip().lower(),
                "role": req.role,
                "region": req.region or "",
                "facility": req.facility or "",
                "prof_reg": req.professional_registration or "",
                "dob": req.date_of_birth,
                "pw_hash": pw_hash,
                "status": "active",
                "start_date": req.start_date or now[:10],
                "now": now,
            },
        )
    except Exception as e:
        logger.error("Staff creation failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to create staff account")

    # Send onboarding SMS
    sms_sent = send_onboarding_sms(
        phone_check["normalized"],
        req.full_name,
        req.staff_id.strip().upper(),
        temp_password,
    )

    log_audit_event(
        "staff_created", req.staff_id.strip().upper(), ip, ua, True,
        extra={"created_by": admin_id, "role": req.role},
    )

    return {
        "staff_id": req.staff_id.strip().upper(),
        "temporary_password": temp_password,
        "must_change_password": True,
        "onboarding_sms_sent": sms_sent,
    }


@router.get("/staff")
async def list_staff(
    request: Request,
    role: Optional[str] = None,
    region: Optional[str] = None,
    status: Optional[str] = None,
):
    """List Observatory staff accounts. Admin-only."""
    _require_national_admin(request)

    clauses = []
    params: Dict[str, Any] = {}

    if role:
        clauses.append("role = :role")
        params["role"] = role
    if region:
        clauses.append("region = :region")
        params["region"] = region
    if status:
        clauses.append("status = :status")
        params["status"] = status

    where = " AND ".join(clauses) if clauses else "1=1"
    query = (
        f"SELECT staff_id, full_name, role, region, facility, "
        f"status, email, phone, professional_reg, start_date, created_at "
        f"FROM ObservatoryStaff WHERE {where} "
        f"ORDER BY created_at DESC LIMIT 200"
    )

    try:
        result = _sql(query, params)
        staff_list = _rows(result)
    except Exception as e:
        logger.error("Staff list query failed: %s", e)
        staff_list = []

    # Also include seeded officials for backwards compatibility
    seeded = []
    try:
        from src.api.admin_mv_routes import GOV_OFFICIALS
        for o in GOV_OFFICIALS:
            sid = o["staff_id"]
            if not any(s.get("staff_id") == sid for s in staff_list):
                seeded.append({
                    "staff_id": sid,
                    "full_name": o["name"],
                    "role": "director",
                    "region": "Greater Banjul",
                    "facility": "",
                    "status": "active",
                    "email": o.get("email", ""),
                    "phone": o.get("phone", ""),
                    "professional_reg": "",
                    "start_date": "2026-01-01",
                    "created_at": "2026-01-01T00:00:00Z",
                    "_seeded": True,
                })
    except ImportError:
        pass

    return {"staff": staff_list + seeded, "total": len(staff_list) + len(seeded)}


class SuspendRequest(BaseModel):
    reason: str


@router.put("/staff/{staff_id}/suspend")
async def suspend_staff(staff_id: str, req: SuspendRequest, request: Request):
    """Suspend a staff account. Requires reason."""
    admin = _require_national_admin(request)
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")
    admin_id = admin.get("sub", "admin")

    now = datetime.now(timezone.utc).isoformat()
    try:
        _sql(
            "UPDATE ObservatoryStaff SET status = 'suspended', "
            "suspended_reason = :reason, updated_at = :now "
            "WHERE staff_id = :sid",
            {"reason": req.reason, "now": now, "sid": staff_id.strip().upper()},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to suspend: {e}")

    log_audit_event(
        "account_suspended", staff_id.strip().upper(), ip, ua, True,
        extra={"suspended_by": admin_id, "reason": req.reason},
    )

    return {"status": "suspended", "staff_id": staff_id.strip().upper()}


@router.put("/staff/{staff_id}/unlock")
async def unlock_staff(staff_id: str, request: Request):
    """Unlock a locked account. Logs which admin unlocked it."""
    admin = _require_national_admin(request)
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")
    admin_id = admin.get("sub", "admin")

    sid = staff_id.strip().upper()
    now = datetime.now(timezone.utc).isoformat()

    # Clear Redis rate limit locks
    try:
        from src.services.observatory_security import _get_redis
        r = _get_redis()
        if r:
            r.delete(f"obs_lock:{sid}")
            r.delete(f"obs_hardlock:{sid}")
            r.delete(f"obs_rate:{sid}")
            r.delete(f"obs_lockcount:{sid}")
    except Exception:
        pass

    # Reactivate account in DB
    try:
        _sql(
            "UPDATE ObservatoryStaff SET status = 'active', "
            "suspended_reason = '', updated_at = :now "
            "WHERE staff_id = :sid",
            {"now": now, "sid": sid},
        )
    except Exception:
        pass

    log_audit_event(
        "account_unlocked", sid, ip, ua, True,
        extra={"unlocked_by": admin_id},
    )

    return {"status": "unlocked", "staff_id": sid}


@router.put("/staff/{staff_id}/reset-password")
async def reset_staff_password(staff_id: str, request: Request):
    """Force password reset. Generates temporary password, sends SMS."""
    admin = _require_national_admin(request)
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")
    admin_id = admin.get("sub", "admin")

    sid = staff_id.strip().upper()
    temp_password = _generate_temp_password()
    pw_hash = hash_password(temp_password)
    now = datetime.now(timezone.utc).isoformat()

    # Get phone for SMS
    phone = ""
    name = ""
    try:
        result = _sql(
            "SELECT phone, full_name FROM ObservatoryStaff WHERE staff_id = :sid LIMIT 1",
            {"sid": sid},
        )
        rows = _rows(result)
        if rows:
            phone = rows[0].get("phone", "")
            name = rows[0].get("full_name", "")
    except Exception:
        pass

    try:
        _sql(
            "UPDATE ObservatoryStaff SET password_hash = :pw, "
            "must_change_password = true, updated_at = :now "
            "WHERE staff_id = :sid",
            {"pw": pw_hash, "now": now, "sid": sid},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {e}")

    sms_sent = False
    if phone:
        sms_sent = send_onboarding_sms(phone, name or sid, sid, temp_password)

    log_audit_event(
        "password_changed", sid, ip, ua, True,
        extra={"reset_by": admin_id, "method": "admin_reset"},
    )

    return {
        "staff_id": sid,
        "temporary_password": temp_password,
        "must_change_password": True,
        "sms_sent": sms_sent,
    }


@router.delete("/staff/{staff_id}")
async def deactivate_staff(staff_id: str, request: Request):
    """Deactivate (not delete) a staff account. Preserves audit history."""
    admin = _require_national_admin(request)
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")
    admin_id = admin.get("sub", "admin")

    sid = staff_id.strip().upper()
    now = datetime.now(timezone.utc).isoformat()

    try:
        _sql(
            "UPDATE ObservatoryStaff SET status = 'deactivated', updated_at = :now "
            "WHERE staff_id = :sid",
            {"now": now, "sid": sid},
        )
    except Exception:
        pass

    # Invalidate any active sessions
    try:
        from src.services.observatory_security import _get_redis
        r = _get_redis()
        if r:
            session_id = r.get(f"obs_staff_session:{sid}")
            if session_id:
                r.delete(f"obs_session:{session_id}")
                r.delete(f"obs_staff_session:{sid}")
    except Exception:
        pass

    log_audit_event(
        "account_deactivated", sid, ip, ua, True,
        extra={"deactivated_by": admin_id},
    )

    return {"status": "deactivated", "staff_id": sid}


@router.get("/audit-log")
async def get_audit_log(
    request: Request,
    staff_id: Optional[str] = None,
    event_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 100,
):
    """Query Observatory audit events. Admin-only."""
    _require_national_admin(request)

    events = query_audit_log(
        staff_id=staff_id,
        event_type=event_type,
        from_date=from_date,
        to_date=to_date,
        limit=min(limit, 500),
    )

    return {"events": events, "total": len(events)}
