"""
Observatory Phone-Auth API
==========================

Live primary auth pipeline for the MoH Observatory:
  phone -> 6-digit OTP -> 4-digit PIN -> JWT.

Endpoints (mounted under /api/v1):
  GET  /observatory/phone/facilities      list facilities (for dropdown)
  POST /observatory/phone/init            phone + facility -> send OTP
  POST /observatory/phone/verify-otp      session + OTP    -> pending PIN
  POST /observatory/phone/verify-pin      session + PIN    -> JWT
  GET  /observatory/phone/session         validate Bearer JWT

Includes 3 super-admin test accounts (MOH-2024-0001/0002/0003) that
bypass all RBAC restrictions and are seeded to ArcadeDB on import.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from src.config import settings as _settings
from src.models.gov_auth import HealthRegion
from src.models.phone_auth import (
    FacilityRegistry,
    PINValidator,
    SUPER_ADMINS,
    find_super_admin_by_phone,
    is_super_admin_role,
    normalize_phone,
    super_admin_access,
)
from src.services import observatory_phone_security as _phs
from src.services import observatory_security as _obs
from src.services.observatory_rbac import resolve_access

logger = logging.getLogger(__name__)

router = APIRouter(tags=["observatory-phone-auth"])


# ══════════════════════════════════════════════════════════════════
#  ARCADEDB SCHEMA + SUPER-ADMIN SEEDING
# ══════════════════════════════════════════════════════════════════

def _sql(query: str, params: Optional[Dict[str, Any]] = None):
    try:
        import requests
        payload: Dict[str, Any] = {"language": "sql", "command": query}
        if params:
            payload["params"] = params
        resp = requests.post(
            f"{_settings.ARCADEDB_URL}/api/v1/command/{_settings.ARCADEDB_DB}",
            json=payload,
            auth=(_settings.ARCADEDB_USER, _settings.ARCADEDB_PASSWORD),
            timeout=5,
        )
        return resp.json() if resp.status_code == 200 else None
    except Exception as e:
        logger.debug("phone-auth SQL failed: %s", e)
        return None


def _ensure_phone_schema():
    """Add phone-flow fields to ObservatoryStaff. Additive only."""
    _sql("CREATE DOCUMENT TYPE ObservatoryStaff IF NOT EXISTS")
    _sql("CREATE PROPERTY ObservatoryStaff.phone_normalized IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.pin_hash IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.super_admin IF NOT EXISTS BOOLEAN")
    _sql("CREATE PROPERTY ObservatoryStaff.title IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.department IF NOT EXISTS STRING")
    _sql("CREATE INDEX ON ObservatoryStaff(phone_normalized) IF NOT EXISTS")


_INSERT_FIELDS = (
    "staff_id, full_name, title, department, nin, phone, phone_normalized, "
    "email, role, region, facility, date_of_birth, password_hash, pin_hash, "
    "super_admin, status, must_change_password, created_at, updated_at"
)
_INSERT_VALUES = (
    ":staff_id, :full_name, :title, :department, :nin, :phone, :phone_normalized, "
    ":email, :role, :region, :facility, :date_of_birth, :password_hash, :pin_hash, "
    ":super_admin, :status, :must_change_password, :created_at, :updated_at"
)


def _seed_super_admins():
    """Write the 3 super-admin records to ArcadeDB. Idempotent."""
    for sa in SUPER_ADMINS:
        try:
            existing = _sql(
                "SELECT @rid FROM ObservatoryStaff WHERE staff_id = :sid LIMIT 1",
                {"sid": sa["staff_id"]},
            )
            existing_rows = (existing or {}).get("result", [])

            now = datetime.now(timezone.utc).isoformat()
            row = {
                "staff_id":             sa["staff_id"],
                "full_name":            sa["full_name"],
                "title":                sa["title"],
                "department":           sa["department"],
                "nin":                  sa["nin"],
                "phone":                sa["phone"],
                "phone_normalized":     sa["phone_normalized"],
                "email":                sa["email"],
                "role":                 sa["role"],
                "region":               sa["region"],
                "facility":             sa["facility"],
                "date_of_birth":        sa["date_of_birth"],
                "password_hash":        _obs.hash_password(sa["password"]),
                "pin_hash":             _phs.hash_pin(sa["pin"]),
                "super_admin":          True,
                "status":               "active",
                "must_change_password": False,
                "created_at":           now,
                "updated_at":           now,
            }

            if existing_rows:
                update_set = (
                    "full_name = :full_name, title = :title, department = :department, "
                    "nin = :nin, phone = :phone, phone_normalized = :phone_normalized, "
                    "email = :email, role = :role, region = :region, facility = :facility, "
                    "date_of_birth = :date_of_birth, password_hash = :password_hash, "
                    "pin_hash = :pin_hash, super_admin = :super_admin, status = :status, "
                    "must_change_password = :must_change_password, updated_at = :updated_at"
                )
                _sql(
                    f"UPDATE ObservatoryStaff SET {update_set} WHERE staff_id = :staff_id",
                    row,
                )
            else:
                _sql(
                    f"INSERT INTO ObservatoryStaff SET "
                    f"staff_id = :staff_id, full_name = :full_name, title = :title, "
                    f"department = :department, nin = :nin, phone = :phone, "
                    f"phone_normalized = :phone_normalized, email = :email, "
                    f"role = :role, region = :region, facility = :facility, "
                    f"date_of_birth = :date_of_birth, password_hash = :password_hash, "
                    f"pin_hash = :pin_hash, super_admin = :super_admin, "
                    f"status = :status, must_change_password = :must_change_password, "
                    f"created_at = :created_at, updated_at = :updated_at",
                    row,
                )
            logger.info(
                "Observatory super-admin seeded: %s (%s)",
                sa["staff_id"], sa["full_name"],
            )
        except Exception as e:
            logger.warning(
                "Failed to seed super-admin %s: %s",
                sa.get("staff_id"), e,
            )


try:
    _ensure_phone_schema()
    _seed_super_admins()
except Exception as e:
    logger.warning("Phone-auth schema/seed init failed (non-fatal): %s", e)


# ══════════════════════════════════════════════════════════════════
#  STAFF LOOKUP
# ══════════════════════════════════════════════════════════════════

def _find_staff_by_phone(phone: str) -> Optional[Dict[str, Any]]:
    """Find a staff record by phone. Super-admins resolve in-memory
    so they always work even when ArcadeDB is unavailable.
    """
    norm = normalize_phone(phone)
    if not norm:
        return None

    # 1. In-memory super-admins (always available)
    sa = find_super_admin_by_phone(norm)
    if sa:
        sa["password_hash"] = _obs.hash_password(sa["password"])
        sa["pin_hash"] = _phs.hash_pin(sa["pin"])
        return sa

    # 2. ArcadeDB lookup
    try:
        result = _sql(
            "SELECT * FROM ObservatoryStaff "
            "WHERE phone_normalized = :p AND status = 'active' LIMIT 1",
            {"p": norm},
        )
        rows = (result or {}).get("result", [])
        if rows:
            return rows[0]
    except Exception as e:
        logger.debug("phone lookup failed: %s", e)

    return None


# ══════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════

def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:200]


def _security_headers(response: Response):
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"


def _build_jwt_payload(
    staff: Dict[str, Any],
    facility_id: Optional[str],
    session_id: str,
    ip: str,
) -> Dict[str, Any]:
    role = staff.get("role", "data_officer")
    region = staff.get("region", HealthRegion.REGION_1.value)

    if is_super_admin_role(role) or staff.get("super_admin"):
        access = super_admin_access()
    else:
        access = resolve_access(role, region)

    return {
        "sub":                staff.get("staff_id", ""),
        "name":               staff.get("full_name", ""),
        "role":               role,
        "region":             region,
        "facility":           facility_id or staff.get("facility", ""),
        "access_level":       access["access_level"],
        "regions":            access["regions_accessible"],
        "can_view_national":  access["can_view_national"],
        "can_view_regional":  access["can_view_regional"],
        "can_view_facility":  access["can_view_facility"],
        "can_export":         access["can_export"],
        "can_submit_data":    access["can_submit_data"],
        "pii_access":         access["pii_access"],
        "super_admin":        access.get("super_admin", False),
        "session_id":         session_id,
        "auth_method":        "phone",
        "ip_hash":            _obs._hash_ip(ip),
    }, access


# ══════════════════════════════════════════════════════════════════
#  REQUEST MODELS
# ══════════════════════════════════════════════════════════════════

class PhoneInitRequest(BaseModel):
    phone: str = Field(..., description="Gambian phone, e.g. +220XXXXXXX")
    facility_id: Optional[str] = Field(
        None, description="Optional facility code from /facilities"
    )


class PhoneOtpRequest(BaseModel):
    session_id: str
    otp: str = Field(..., min_length=6, max_length=6)


class PhonePinRequest(BaseModel):
    session_id: str
    pin: str = Field(..., min_length=4, max_length=4)


# ══════════════════════════════════════════════════════════════════
#  ENDPOINTS
# ══════════════════════════════════════════════════════════════════

@router.get("/observatory/phone/facilities")
def list_facilities(region: Optional[str] = None):
    """List available facilities (optionally filtered by region)."""
    return {
        "facilities": FacilityRegistry.list(region=region),
        "regions":    [r.value for r in HealthRegion],
    }


@router.post("/observatory/phone/init")
def phone_init(req: PhoneInitRequest, request: Request, response: Response):
    """Step 1: validate phone + facility, send OTP."""
    _security_headers(response)
    ip = _client_ip(request)
    ua = _user_agent(request)
    raw_phone = (req.phone or "").strip()

    norm = normalize_phone(raw_phone)
    if not norm:
        _phs.log_phone_audit(
            "init_invalid_format", raw_phone, ip_address=ip,
            success=False, failure_reason="invalid_phone_format",
        )
        raise HTTPException(400, detail={
            "code": "invalid_phone",
            "message": "Phone must be a valid Gambian number (+220XXXXXXX).",
        })

    facility = None
    if req.facility_id:
        facility = FacilityRegistry.get(req.facility_id)
        if not facility:
            raise HTTPException(400, detail={
                "code": "invalid_facility",
                "message": f"Unknown facility code: {req.facility_id}",
            })

    allowed, reason, remaining = _phs.check_phone_rate_limit(norm, ip)
    if not allowed:
        if reason and reason.startswith("phone_locked"):
            _phs.log_phone_audit(
                "init_locked", norm, ip_address=ip,
                success=False, failure_reason=reason,
            )
            return {
                "locked": True,
                "message": "Account temporarily locked. Try again in 30 minutes.",
            }
        if reason == "phone_hard_locked":
            return {
                "locked": True,
                "message": "Account locked. Contact MoH ICT Unit to unlock.",
            }
        _phs.log_phone_audit(
            "init_rate_limited", norm, ip_address=ip,
            success=False, failure_reason=reason,
        )
        raise HTTPException(429, detail={
            "code": "rate_limited",
            "message": "Too many attempts. Try again later.",
        })

    staff = _find_staff_by_phone(norm)
    if not staff:
        _phs.record_phone_failed_attempt(norm, ip)
        _phs.log_phone_audit(
            "init_unknown_phone", norm, ip_address=ip,
            success=False, failure_reason="phone_not_registered",
        )
        raise HTTPException(401, detail={
            "code": "phone_not_recognized",
            "message": "This phone is not registered with the MoH ICT Unit.",
        })

    if staff.get("status") and staff["status"] != "active":
        return {
            "locked": True,
            "message": f"Account is {staff['status']}. Contact MoH ICT Unit.",
        }

    session_id = _phs.create_pending_session(
        phone=norm,
        ip=ip,
        user_agent=ua,
        facility_id=req.facility_id,
        staff_record=staff,
    )

    otp = _obs.generate_otp(session_id, norm)
    if otp is None:
        raise HTTPException(429, detail={
            "code": "otp_limit",
            "message": "OTP request limit reached. Try again later.",
        })
    _obs.send_otp_sms(norm, otp)

    _phs.log_phone_audit(
        "init_otp_sent", norm,
        staff_id=staff.get("staff_id", ""), ip_address=ip,
        success=True, session_id=session_id,
        extra={"facility_id": req.facility_id or ""},
    )

    payload = {
        "status":              "otp_required",
        "session_id":          session_id,
        "phone_hint":          norm[-4:],
        "facility":            facility,
        "expires_in_seconds":  300,
        "attempts_remaining":  remaining,
    }
    if getattr(_settings, "OTP_DEV_MODE", False):
        payload["_dev_otp"] = otp
    return payload


@router.post("/observatory/phone/verify-otp")
def phone_verify_otp(
    req: PhoneOtpRequest, request: Request, response: Response
):
    """Step 2: verify 6-digit OTP, advance to PIN stage."""
    _security_headers(response)
    ip = _client_ip(request)

    pending = _phs.get_pending_session(req.session_id)
    if not pending:
        raise HTTPException(401, detail={
            "code": "session_invalid",
            "message": "Session expired. Please start sign-in again.",
        })
    if pending.get("stage") != "phone_otp":
        raise HTTPException(400, detail={
            "code": "wrong_stage",
            "message": "OTP already verified for this session.",
        })

    phone = pending.get("phone", "")
    staff_id = pending.get("staff_id", "")

    ok, err = _obs.verify_otp(req.session_id, req.otp)
    if not ok:
        _phs.record_phone_failed_attempt(phone, ip)
        _phs.log_phone_audit(
            "otp_invalid", phone, staff_id=staff_id,
            ip_address=ip, success=False,
            failure_reason=err, session_id=req.session_id,
        )
        raise HTTPException(401, detail={
            "code": "invalid_otp",
            "message": err or "Invalid verification code",
        })

    if not _phs.advance_pending_to_pin(req.session_id):
        raise HTTPException(500, detail={"code": "session_advance_failed"})

    _phs.log_phone_audit(
        "otp_verified", phone, staff_id=staff_id,
        ip_address=ip, success=True, session_id=req.session_id,
    )

    return {
        "status":     "pin_required",
        "session_id": req.session_id,
        "stage":      "pin_pending",
    }


@router.post("/observatory/phone/verify-pin")
def phone_verify_pin(
    req: PhonePinRequest, request: Request, response: Response
):
    """Step 3: verify 4-digit PIN, mint JWT."""
    _security_headers(response)
    ip = _client_ip(request)
    ua = _user_agent(request)

    pending = _phs.get_pending_session(req.session_id)
    if not pending:
        raise HTTPException(401, detail={
            "code": "session_invalid",
            "message": "Session expired. Please start sign-in again.",
        })
    if pending.get("stage") != "pin_pending":
        raise HTTPException(400, detail={
            "code": "wrong_stage",
            "message": "OTP must be verified before PIN.",
        })

    phone = pending.get("phone", "")
    staff_id = pending.get("staff_id", "")

    pin_check = PINValidator.validate(req.pin)
    if not pin_check["valid"]:
        raise HTTPException(400, detail={
            "code":    "invalid_pin_format",
            "message": pin_check["error"],
        })

    staff = _find_staff_by_phone(phone)
    if not staff:
        raise HTTPException(401, detail={
            "code":    "staff_not_found",
            "message": "Account not found.",
        })

    pin_hash = staff.get("pin_hash") or ""
    if not pin_hash:
        _phs.log_phone_audit(
            "pin_no_hash", phone, staff_id=staff_id,
            ip_address=ip, success=False,
            failure_reason="pin_not_set", session_id=req.session_id,
        )
        raise HTTPException(401, detail={
            "code":    "pin_not_set",
            "message": "PIN not set. Contact MoH ICT Unit.",
        })

    if not _phs.verify_pin(req.pin, pin_hash):
        count, locked = _phs.record_pin_attempt(phone, success=False)
        _phs.log_phone_audit(
            "pin_invalid", phone, staff_id=staff_id,
            ip_address=ip, success=False,
            failure_reason="wrong_pin", session_id=req.session_id,
            extra={"attempt_count": count, "locked": locked},
        )
        if locked:
            _phs.consume_pending_session(req.session_id)
            return {
                "locked":  True,
                "message": "Too many wrong PIN attempts. Locked 30 minutes.",
            }
        raise HTTPException(401, detail={
            "code":               "invalid_pin",
            "message":            "Incorrect PIN.",
            "attempts_remaining": max(0, 5 - count),
        })

    _phs.record_pin_attempt(phone, success=True)
    _phs.clear_phone_rate_limit(phone)

    obs_session_id = _obs.create_session(
        staff_id=staff.get("staff_id", ""),
        ip=ip, user_agent=ua,
        officer_data={
            "staff_id":   staff.get("staff_id", ""),
            "name":       staff.get("full_name", ""),
            "role":       staff.get("role", ""),
            "region":     staff.get("region", ""),
            "facility":   pending.get("facility_id") or staff.get("facility", ""),
            "phone":      phone,
            "title":      staff.get("title", ""),
            "department": staff.get("department") or staff.get("facility", ""),
            "ministry":   "Ministry of Health",
        },
    )
    _obs.mark_session_otp_verified(obs_session_id)

    payload, access = _build_jwt_payload(
        staff, pending.get("facility_id"), obs_session_id, ip,
    )
    token = _obs.create_observatory_jwt(payload)

    _phs.consume_pending_session(req.session_id)
    _phs.log_phone_audit(
        "login_success", phone, staff_id=staff.get("staff_id", ""),
        ip_address=ip, success=True, session_id=obs_session_id,
        extra={"super_admin": access.get("super_admin", False)},
    )

    return {
        "status": "authenticated",
        "token":  token,
        "officer": {
            "staff_id":   staff.get("staff_id", ""),
            "name":       staff.get("full_name", ""),
            "title":      staff.get("title", ""),
            "role":       staff.get("role", ""),
            "region":     staff.get("region", ""),
            "facility":   pending.get("facility_id") or staff.get("facility", ""),
            "department": staff.get("department") or staff.get("facility", ""),
            "ministry":   "Ministry of Health",
            "phone":      phone,
        },
        "observatory_access":   access,
        "must_change_password": staff.get("must_change_password", False),
    }


@router.get("/observatory/phone/session")
def phone_session(request: Request, response: Response):
    """Validate Bearer JWT in Authorization header."""
    _security_headers(response)
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, detail={"code": "no_token"})
    token = auth.split(" ", 1)[1].strip()
    payload = _obs.verify_observatory_jwt(token)
    if not payload:
        raise HTTPException(401, detail={"code": "invalid_token"})

    ip = _client_ip(request)
    if not _obs.verify_jwt_ip(payload, ip):
        raise HTTPException(401, detail={"code": "ip_mismatch"})

    sid = payload.get("session_id")
    if sid:
        valid, err = _obs.check_session_valid(sid, ip)
        if not valid:
            raise HTTPException(401, detail={"code": err})

    return {
        "valid": True,
        "officer": {
            "staff_id":    payload.get("sub"),
            "name":        payload.get("name"),
            "role":        payload.get("role"),
            "region":      payload.get("region"),
            "facility":    payload.get("facility"),
            "super_admin": payload.get("super_admin", False),
        },
        "access_level": payload.get("access_level"),
        "regions":      payload.get("regions", []),
        "auth_method":  payload.get("auth_method", "phone"),
    }
