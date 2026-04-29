"""
Observatory Authentication API
================================

MoH government officer authentication for the NCD Observatory.
Triple-factor: Staff ID + NIN (11-digit GAMBIS) + Password → OTP verify.

Endpoints:
  POST /observatory/login        — validate credentials, send OTP
  POST /observatory/verify-otp   — complete login with OTP
  POST /observatory/logout       — invalidate session
  GET  /observatory/session      — check session validity

All endpoints return security headers and audit every event.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.config import settings as _settings
from src.models.gov_auth import (
    NINValidator,
    StaffIDValidator,
    ProfessionalRegValidator,
    PhoneValidator,
    access_level_for_role,
)
from src.services.observatory_rbac import resolve_access
from src.services.observatory_security import (
    check_rate_limit,
    check_session_valid,
    clear_rate_limit,
    create_observatory_jwt,
    create_session,
    generate_otp,
    get_session,
    hash_password,
    invalidate_session,
    log_audit_event,
    mark_session_otp_verified,
    record_failed_attempt,
    send_otp_sms,
    verify_observatory_jwt,
    verify_otp,
    verify_password,
    _hash_ip,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/observatory", tags=["observatory-auth"])


# ── Security headers middleware ─────────────────────────────────

def _security_response(data: dict, status: int = 200) -> JSONResponse:
    resp = JSONResponse(content=data, status_code=status)
    resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; frame-ancestors 'none'"
    )
    return resp


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ── Staff record lookup ─────────────────────────────────────────
# Checks ArcadeDB first; falls back to the seeded officials in
# admin_mv_routes for backwards compatibility.

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
        return None
    return resp.json()


def _ensure_staff_schema():
    _sql("CREATE DOCUMENT TYPE ObservatoryStaff IF NOT EXISTS")
    _sql("CREATE PROPERTY ObservatoryStaff.staff_id IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.full_name IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.nin IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.phone IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.email IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.role IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.region IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.facility IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.professional_reg IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.date_of_birth IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.password_hash IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.must_change_password IF NOT EXISTS BOOLEAN")
    _sql("CREATE PROPERTY ObservatoryStaff.status IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.created_at IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.updated_at IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.start_date IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryStaff.suspended_reason IF NOT EXISTS STRING")
    _sql("CREATE INDEX ON ObservatoryStaff(staff_id) UNIQUE IF NOT EXISTS")
    _sql("CREATE INDEX ON ObservatoryStaff(nin) IF NOT EXISTS")


try:
    _ensure_staff_schema()
except Exception:
    pass


def _find_staff(staff_id: str) -> Optional[Dict[str, Any]]:
    """Look up staff by Staff ID — ArcadeDB first, then seeded fallback."""
    sid = staff_id.strip().upper()

    # ArcadeDB lookup
    try:
        result = _sql(
            "SELECT * FROM ObservatoryStaff WHERE staff_id = :sid LIMIT 1",
            {"sid": sid},
        )
        rows = (result or {}).get("result", [])
        if rows:
            return rows[0]
    except Exception:
        pass

    # Fallback: seeded officials from admin_mv_routes (backwards compat)
    try:
        from src.api.admin_mv_routes import GOV_OFFICIALS, _GOV_SALT
        for o in GOV_OFFICIALS:
            if o["staff_id"].upper() == sid:
                return {
                    "staff_id": o["staff_id"],
                    "full_name": o["name"],
                    "nin": o.get("national_id", ""),
                    "phone": o.get("phone", ""),
                    "email": o.get("email", ""),
                    "role": "director",
                    "region": "Greater Banjul",
                    "password_hash": o["password_hash"],
                    "must_change_password": False,
                    "status": "active",
                    "date_of_birth": "",
                    "professional_reg": "",
                    "_legacy": True,
                    "_legacy_salt": _GOV_SALT,
                }
    except ImportError:
        pass

    return None


def _verify_staff_password(staff: Dict[str, Any], password: str) -> bool:
    stored_hash = staff.get("password_hash", "")
    if not stored_hash:
        return False

    if staff.get("_legacy"):
        import hashlib
        legacy_salt = staff.get("_legacy_salt", "amina-gov-2026-salt")
        computed = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            legacy_salt.encode("utf-8"),
            200_000,
        ).hex()
        import hmac as _hmac
        return _hmac.compare_digest(computed, stored_hash)

    return verify_password(password, stored_hash)


def _validate_nin_for_staff(staff: Dict[str, Any], submitted_nin: str) -> bool:
    stored_nin = staff.get("nin", "")
    if not stored_nin:
        return True

    # Legacy 7-digit NIN: exact match
    if len(stored_nin) <= 7:
        return submitted_nin.strip() == stored_nin

    # New 11-digit NIN: exact match + DOB cross-validation
    if submitted_nin.strip() != stored_nin:
        return False

    dob_str = staff.get("date_of_birth", "")
    if dob_str:
        try:
            staff_dob = date.fromisoformat(dob_str)
            if not NINValidator.cross_validate_dob(submitted_nin, staff_dob):
                return False
        except (ValueError, TypeError):
            pass

    return True


# ══════════════════════════════════════════════════════════════════
#  ENDPOINTS
# ══════════════════════════════════════════════════════════════════


class LoginRequest(BaseModel):
    staff_id: str
    nin: str
    password: str


class VerifyOTPRequest(BaseModel):
    session_id: str
    otp: str


@router.post("/login")
async def observatory_login(req: LoginRequest, request: Request):
    """MoH officer sign-in: Staff ID + NIN + Password → OTP sent."""
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")
    sid = req.staff_id.strip().upper()

    # 1. Rate limit check
    allowed, block_reason, remaining = check_rate_limit(sid, ip)
    if not allowed:
        log_audit_event("login_attempt", sid, ip, ua, False, block_reason)

        if "account_locked" in (block_reason or ""):
            ttl = block_reason.split(":")[-1] if ":" in block_reason else "1800"
            return _security_response({
                "error": "account_locked",
                "message": (
                    f"Account locked for {int(ttl) // 60} minutes. "
                    "Contact ICT Unit if urgent."
                ),
                "locked": True,
            }, 429)

        if block_reason == "account_hard_locked":
            return _security_response({
                "error": "account_hard_locked",
                "message": "Account locked until admin reset. Contact ICT Unit.",
                "locked": True,
            }, 423)

        return _security_response({
            "error": "rate_limited",
            "message": "Too many requests. Please wait.",
        }, 429)

    # 2. Validate Staff ID format
    staff_check = StaffIDValidator.validate(sid)
    if not staff_check["valid"]:
        log_audit_event("login_attempt", sid, ip, ua, False, "invalid_staff_id_format")
        return _security_response({
            "error": "validation_failed",
            "message": staff_check["error"],
        }, 400)

    # 3. Validate NIN format (accept legacy 7-digit or new 11-digit)
    nin_cleaned = req.nin.strip().replace(" ", "").replace("-", "")
    if len(nin_cleaned) == 11:
        nin_check = NINValidator.validate(nin_cleaned)
        if not nin_check["valid"]:
            log_audit_event("login_attempt", sid, ip, ua, False, "invalid_nin_format")
            return _security_response({
                "error": "validation_failed",
                "message": nin_check["error"],
            }, 400)
    elif len(nin_cleaned) != 7 or not nin_cleaned.isdigit():
        log_audit_event("login_attempt", sid, ip, ua, False, "invalid_nin_format")
        return _security_response({
            "error": "validation_failed",
            "message": "NIN must be 7 or 11 digits",
        }, 400)

    # 4. Look up staff record
    staff = _find_staff(sid)
    if not staff:
        record_failed_attempt(sid, ip)
        log_audit_event("login_attempt", sid, ip, ua, False, "staff_not_found")
        _, _, rem = check_rate_limit(sid, ip)
        return _security_response({
            "error": "authentication_failed",
            "message": f"Invalid credentials. {rem} attempts remaining.",
            "attempts_remaining": rem,
            "lockout_at": 5,
        }, 401)

    # 5. Check account status
    if staff.get("status") == "suspended":
        log_audit_event("login_attempt", sid, ip, ua, False, "account_suspended")
        return _security_response({
            "error": "account_suspended",
            "message": "Account suspended. Contact your supervisor.",
        }, 403)

    # 6. Validate NIN against staff record
    if not _validate_nin_for_staff(staff, nin_cleaned):
        record_failed_attempt(sid, ip)
        log_audit_event("login_attempt", sid, ip, ua, False, "nin_mismatch")
        _, _, rem = check_rate_limit(sid, ip)
        return _security_response({
            "error": "authentication_failed",
            "message": f"Invalid credentials. {rem} attempts remaining.",
            "attempts_remaining": rem,
            "lockout_at": 5,
        }, 401)

    # 7. Verify password
    if not _verify_staff_password(staff, req.password):
        record_failed_attempt(sid, ip)
        log_audit_event("login_attempt", sid, ip, ua, False, "invalid_password")
        _, _, rem = check_rate_limit(sid, ip)
        return _security_response({
            "error": "authentication_failed",
            "message": f"Invalid credentials. {rem} attempts remaining.",
            "attempts_remaining": rem,
            "lockout_at": 5,
        }, 401)

    # 8. Credentials valid — create pending session + send OTP
    clear_rate_limit(sid)

    role = staff.get("role", "data_officer")
    region = staff.get("region", "")
    access = resolve_access(role, region, staff.get("facility"))

    officer_data = {
        "staff_id": sid,
        "name": staff.get("full_name", ""),
        "ministry": staff_check.get("ministry", "MOH"),
        "role": role,
        "region": region,
        "access_level": access["access_level"],
        "professional_reg": staff.get("professional_reg", ""),
        "title": staff.get("title", ""),
        "department": staff.get("department", "Ministry of Health"),
    }

    session_id = create_session(sid, ip, ua, officer_data)

    phone = staff.get("phone", "")
    otp = generate_otp(session_id, phone)

    if otp:
        send_otp_sms(phone, otp)
        log_audit_event("otp_sent", sid, ip, ua, True, session_id=session_id)

    phone_masked = f"**{phone[-2:]}" if len(phone) >= 2 else "**"

    log_audit_event("login_attempt", sid, ip, ua, True, session_id=session_id)

    response_data: Dict[str, Any] = {
        "status": "otp_required",
        "session_id": session_id,
        "phone_hint": phone_masked,
        "otp_expires_in": 300,
        "must_change_password": staff.get("must_change_password", False),
        "officer": {
            "name": officer_data["name"],
            "staff_id": sid,
            "role": role,
        },
    }

    if _settings.OTP_DEV_MODE and otp:
        response_data["_dev_otp"] = otp

    return _security_response(response_data)


@router.post("/verify-otp")
async def observatory_verify_otp(req: VerifyOTPRequest, request: Request):
    """Complete login by verifying OTP."""
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")

    session = get_session(req.session_id)
    if not session:
        return _security_response({
            "error": "session_expired",
            "message": "Session expired. Please sign in again.",
        }, 401)

    staff_id = session.get("staff_id", "")

    ok, err = verify_otp(req.session_id, req.otp)
    if not ok:
        log_audit_event("otp_verified", staff_id, ip, ua, False, err, req.session_id)
        return _security_response({
            "error": "otp_failed",
            "message": err or "Invalid verification code",
        }, 401)

    # OTP verified — mint JWT and finalize session
    mark_session_otp_verified(req.session_id)

    officer = session.get("officer", {})
    role = officer.get("role", "data_officer")
    region = officer.get("region", "")
    access = resolve_access(role, region)

    jwt_payload = {
        "sub": staff_id,
        "role": "gov",
        "scope": "gov",
        "observatory_role": role,
        "name": officer.get("name", ""),
        "title": officer.get("title", ""),
        "department": officer.get("department", ""),
        "access_level": access["access_level"],
        "regions": access.get("regions_accessible", []),
        "session_id": req.session_id,
        "ip_hash": _hash_ip(ip),
    }
    token = create_observatory_jwt(jwt_payload)

    log_audit_event("otp_verified", staff_id, ip, ua, True, session_id=req.session_id)
    log_audit_event("observatory_login", staff_id, ip, ua, True, session_id=req.session_id)

    expires_at = datetime.now(timezone.utc).replace(microsecond=0)
    expires_at = expires_at.replace(hour=expires_at.hour + 8) if expires_at.hour < 16 else expires_at

    return _security_response({
        "token": token,
        "officer": officer,
        "session": {
            "expires_in": 28800,
            "expires_at": (
                datetime.now(timezone.utc) + __import__("datetime").timedelta(hours=8)
            ).isoformat().replace("+00:00", "Z"),
            "session_id": req.session_id,
        },
        "observatory_access": access,
    })


@router.post("/logout")
async def observatory_logout(request: Request):
    """Invalidate Observatory session."""
    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")

    auth = (request.headers.get("Authorization") or "").strip()
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""

    payload = verify_observatory_jwt(token) if token else None
    if not payload:
        # Also try the standard JWT verifier for backwards compat
        from src.services.auth import verify_jwt
        payload = verify_jwt(token) if token else None

    staff_id = (payload or {}).get("sub", "unknown")
    session_id = (payload or {}).get("session_id", "")

    if session_id:
        invalidate_session(session_id)

    log_audit_event("logout", staff_id, ip, ua, True, session_id=session_id)

    return _security_response({"status": "logged_out"})


@router.get("/session")
async def observatory_session_check(request: Request):
    """Check if current Observatory session is valid."""
    ip = _client_ip(request)

    auth = (request.headers.get("Authorization") or "").strip()
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""

    if not token:
        return _security_response({"valid": False, "reason": "no_token"}, 401)

    payload = verify_observatory_jwt(token)
    if not payload:
        from src.services.auth import verify_jwt
        payload = verify_jwt(token)

    if not payload:
        return _security_response({"valid": False, "reason": "token_expired"}, 401)

    if payload.get("role") not in ("gov", "admin"):
        return _security_response({"valid": False, "reason": "wrong_role"}, 403)

    session_id = payload.get("session_id", "")
    if session_id:
        valid, reason = check_session_valid(session_id, ip)
        if not valid:
            return _security_response({"valid": False, "reason": reason}, 401)

    return _security_response({
        "valid": True,
        "officer": {
            "staff_id": payload.get("sub"),
            "name": payload.get("name"),
            "role": payload.get("observatory_role"),
            "access_level": payload.get("access_level"),
        },
        "session_id": session_id,
    })
