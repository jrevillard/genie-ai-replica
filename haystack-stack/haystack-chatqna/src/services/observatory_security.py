"""
Observatory Security Service
=============================

Handles all security primitives for the MoH Observatory:
  - RS256 JWT (asymmetric; falls back to HS256 if no RSA keys configured)
  - Rate limiting via Redis
  - Session management via Redis (single active session per Staff ID)
  - OTP generation & verification
  - Audit logging to ArcadeDB
  - IP-bound sessions
  - CSRF tokens
  - Password policy enforcement
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import jwt as _pyjwt

from src.config import settings as _settings

logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════
#  RSA KEY MANAGEMENT
# ══════════════════════════════════════════════════════════════════

_rsa_private_key: Optional[str] = None
_rsa_public_key: Optional[str] = None
_jwt_algorithm = "HS256"


def _init_rsa_keys():
    """Load RSA keys for RS256 JWT signing if explicitly configured.

    With multiple uvicorn workers, auto-generated keys are per-process
    and incompatible across workers. Only use RS256 when the operator
    provides a shared key pair via env vars. Otherwise HS256 with a
    shared secret is correct for multi-worker deployments.
    """
    global _rsa_private_key, _rsa_public_key, _jwt_algorithm

    priv = os.getenv("OBSERVATORY_RSA_PRIVATE_KEY", "")
    pub = os.getenv("OBSERVATORY_RSA_PUBLIC_KEY", "")

    if priv and pub:
        _rsa_private_key = priv.replace("\\n", "\n")
        _rsa_public_key = pub.replace("\\n", "\n")
        _jwt_algorithm = "RS256"
        logger.info("Observatory JWT: RS256 with env-provided RSA keys")
        return

    _jwt_algorithm = "HS256"
    logger.info(
        "Observatory JWT: HS256 (set OBSERVATORY_RSA_PRIVATE_KEY + "
        "OBSERVATORY_RSA_PUBLIC_KEY for RS256)"
    )


_init_rsa_keys()


# ══════════════════════════════════════════════════════════════════
#  JWT
# ══════════════════════════════════════════════════════════════════

_OBSERVATORY_JWT_SECRET = os.getenv(
    "OBSERVATORY_JWT_SECRET",
    _settings.JWT_SECRET,
)
_OBSERVATORY_JWT_HOURS = 8


def create_observatory_jwt(payload: Dict[str, Any]) -> str:
    payload["iat"] = datetime.now(timezone.utc)
    payload["exp"] = datetime.now(timezone.utc) + timedelta(hours=_OBSERVATORY_JWT_HOURS)
    payload["iss"] = "amina-observatory"

    if _jwt_algorithm == "RS256" and _rsa_private_key:
        return _pyjwt.encode(payload, _rsa_private_key, algorithm="RS256")
    return _pyjwt.encode(payload, _OBSERVATORY_JWT_SECRET, algorithm="HS256")


def verify_observatory_jwt(token: str) -> Optional[Dict[str, Any]]:
    try:
        if _jwt_algorithm == "RS256" and _rsa_public_key:
            return _pyjwt.decode(
                token, _rsa_public_key,
                algorithms=["RS256"],
                issuer="amina-observatory",
            )
        return _pyjwt.decode(
            token, _OBSERVATORY_JWT_SECRET,
            algorithms=["HS256"],
            issuer="amina-observatory",
        )
    except _pyjwt.ExpiredSignatureError:
        logger.debug("Observatory JWT expired")
        return None
    except _pyjwt.InvalidTokenError as e:
        logger.debug("Invalid observatory JWT: %s", e)
        return None


def verify_jwt_ip(token_payload: Dict[str, Any], current_ip: str) -> bool:
    bound_ip_hash = token_payload.get("ip_hash")
    if not bound_ip_hash:
        return True
    return bound_ip_hash == _hash_ip(current_ip)


def _hash_ip(ip: str) -> str:
    return hashlib.sha256(
        f"obs-ip-bind:{ip}".encode()
    ).hexdigest()[:16]


# ══════════════════════════════════════════════════════════════════
#  PASSWORD HASHING
# ══════════════════════════════════════════════════════════════════

_GOV_SALT_V2 = os.getenv("OBSERVATORY_SALT", "amina-observatory-2026-salt")


def hash_password(password: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        _GOV_SALT_V2.encode("utf-8"),
        200_000,
    ).hex()


def verify_password(password: str, stored_hash: str) -> bool:
    computed = hash_password(password)
    return hmac.compare_digest(computed, stored_hash)


def validate_password_policy(password: str) -> Optional[str]:
    if len(password) < 8:
        return "Password must be at least 8 characters"
    if not any(c.isupper() for c in password):
        return "Password must contain at least 1 uppercase letter"
    if not any(c.isdigit() for c in password):
        return "Password must contain at least 1 number"
    if not any(c in "!@#$%^&*()-_=+[]{}|;:',.<>?/`~" for c in password):
        return "Password must contain at least 1 special character"
    return None


# ══════════════════════════════════════════════════════════════════
#  REDIS HELPERS
# ══════════════════════════════════════════════════════════════════

def _get_redis():
    try:
        import redis
        return redis.Redis(
            host=_settings.REDIS_HOST,
            port=_settings.REDIS_PORT,
            decode_responses=True,
        )
    except Exception as e:
        logger.warning("Observatory: Redis unavailable: %s", e)
        return None


# ══════════════════════════════════════════════════════════════════
#  RATE LIMITING
# ══════════════════════════════════════════════════════════════════

_RATE_STAFF_MAX = 5
_RATE_STAFF_WINDOW = 3600
_RATE_IP_MAX = 20
_RATE_IP_WINDOW = 3600
_RATE_GLOBAL_MAX = 100
_RATE_GLOBAL_WINDOW = 3600
_LOCKOUT_DURATION = 1800
_MAX_LOCKS_PER_DAY = 3


def check_rate_limit(
    staff_id: str,
    ip: str,
) -> Tuple[bool, Optional[str], int]:
    """Check rate limits. Returns (allowed, error_reason, attempts_remaining)."""
    r = _get_redis()
    if not r:
        return True, None, _RATE_STAFF_MAX

    # Check if account is hard-locked (admin reset required)
    hard_lock = r.get(f"obs_hardlock:{staff_id}")
    if hard_lock:
        return False, "account_hard_locked", 0

    # Check if account is temporarily locked
    lock_key = f"obs_lock:{staff_id}"
    if r.exists(lock_key):
        ttl = r.ttl(lock_key)
        return False, f"account_locked:{ttl}", 0

    # Per-staff rate
    staff_key = f"obs_rate:{staff_id}"
    staff_count = int(r.get(staff_key) or 0)
    if staff_count >= _RATE_STAFF_MAX:
        r.setex(lock_key, _LOCKOUT_DURATION, "locked")
        lock_count_key = f"obs_lockcount:{staff_id}"
        locks = r.incr(lock_count_key)
        if locks == 1:
            r.expire(lock_count_key, 86400)
        if locks >= _MAX_LOCKS_PER_DAY:
            r.set(f"obs_hardlock:{staff_id}", "1")
        return False, "too_many_attempts", 0

    # Per-IP rate
    ip_key = f"obs_rate_ip:{ip}"
    ip_count = int(r.get(ip_key) or 0)
    if ip_count >= _RATE_IP_MAX:
        return False, "ip_rate_exceeded", 0

    # Global rate
    global_key = "obs_rate_global"
    global_count = int(r.get(global_key) or 0)
    if global_count >= _RATE_GLOBAL_MAX:
        return False, "global_rate_exceeded", 0

    remaining = _RATE_STAFF_MAX - staff_count
    return True, None, remaining


def record_failed_attempt(staff_id: str, ip: str):
    r = _get_redis()
    if not r:
        return

    staff_key = f"obs_rate:{staff_id}"
    pipe = r.pipeline()
    pipe.incr(staff_key)
    pipe.expire(staff_key, _RATE_STAFF_WINDOW)
    ip_key = f"obs_rate_ip:{ip}"
    pipe.incr(ip_key)
    pipe.expire(ip_key, _RATE_IP_WINDOW)
    global_key = "obs_rate_global"
    pipe.incr(global_key)
    pipe.expire(global_key, _RATE_GLOBAL_WINDOW)
    pipe.execute()


def clear_rate_limit(staff_id: str):
    r = _get_redis()
    if r:
        r.delete(f"obs_rate:{staff_id}")


# ══════════════════════════════════════════════════════════════════
#  OTP
# ══════════════════════════════════════════════════════════════════

_OTP_EXPIRY = 300
_OTP_MAX_REQUESTS = 3


def generate_otp(session_id: str, phone: str) -> Optional[str]:
    r = _get_redis()
    otp = f"{secrets.randbelow(900000) + 100000}"

    if r:
        otp_count_key = f"obs_otp_count:{session_id}"
        count = int(r.get(otp_count_key) or 0)
        if count >= _OTP_MAX_REQUESTS:
            return None
        r.incr(otp_count_key)
        r.expire(otp_count_key, _OTP_EXPIRY * 2)

        r.setex(
            f"obs_otp:{session_id}",
            _OTP_EXPIRY,
            json.dumps({"otp": otp, "phone": phone, "created": time.time()}),
        )

    return otp


def verify_otp(session_id: str, submitted_otp: str) -> Tuple[bool, Optional[str]]:
    r = _get_redis()
    if not r:
        if _settings.OTP_DEV_MODE:
            return True, None
        return False, "OTP service unavailable"

    otp_key = f"obs_otp:{session_id}"
    stored = r.get(otp_key)
    if not stored:
        return False, "OTP expired or not found. Please request a new code."

    data = json.loads(stored)
    if data["otp"] != submitted_otp.strip():
        return False, "Invalid verification code"

    r.delete(otp_key)
    return True, None


# ══════════════════════════════════════════════════════════════════
#  SESSION MANAGEMENT
# ══════════════════════════════════════════════════════════════════

_SESSION_TTL = 28800


def create_session(
    staff_id: str,
    ip: str,
    user_agent: str,
    officer_data: Dict[str, Any],
) -> str:
    session_id = f"OBS-{secrets.token_hex(8)}"
    r = _get_redis()

    if r:
        # Invalidate any previous session for this staff ID
        prev_session = r.get(f"obs_staff_session:{staff_id}")
        if prev_session:
            r.delete(f"obs_session:{prev_session}")
            logger.info("Observatory: invalidated previous session %s for %s", prev_session, staff_id)

        session_data = {
            "session_id": session_id,
            "staff_id": staff_id,
            "ip": ip,
            "user_agent": user_agent,
            "login_time": datetime.now(timezone.utc).isoformat(),
            "last_activity": datetime.now(timezone.utc).isoformat(),
            "officer": officer_data,
            "otp_verified": False,
        }
        r.setex(f"obs_session:{session_id}", _SESSION_TTL, json.dumps(session_data))
        r.setex(f"obs_staff_session:{staff_id}", _SESSION_TTL, session_id)

    return session_id


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    r = _get_redis()
    if not r:
        return None
    data = r.get(f"obs_session:{session_id}")
    if not data:
        return None
    return json.loads(data)


def update_session(session_id: str, updates: Dict[str, Any]):
    r = _get_redis()
    if not r:
        return
    data = r.get(f"obs_session:{session_id}")
    if not data:
        return
    session = json.loads(data)
    session.update(updates)
    session["last_activity"] = datetime.now(timezone.utc).isoformat()
    ttl = r.ttl(f"obs_session:{session_id}")
    if ttl > 0:
        r.setex(f"obs_session:{session_id}", ttl, json.dumps(session))


def mark_session_otp_verified(session_id: str):
    update_session(session_id, {"otp_verified": True})


def invalidate_session(session_id: str):
    r = _get_redis()
    if not r:
        return
    data = r.get(f"obs_session:{session_id}")
    if data:
        session = json.loads(data)
        staff_id = session.get("staff_id")
        if staff_id:
            r.delete(f"obs_staff_session:{staff_id}")
    r.delete(f"obs_session:{session_id}")


def check_session_valid(session_id: str, current_ip: str) -> Tuple[bool, Optional[str]]:
    session = get_session(session_id)
    if not session:
        return False, "session_expired"
    if not session.get("otp_verified"):
        return False, "otp_not_verified"
    if session.get("ip") and session["ip"] != current_ip:
        logger.warning(
            "Observatory: IP change detected for session %s: %s → %s",
            session_id, session["ip"], current_ip,
        )
        return False, "ip_changed"
    return True, None


# ══════════════════════════════════════════════════════════════════
#  AUDIT LOGGING
# ══════════════════════════════════════════════════════════════════

def _sql(query: str, params: dict = None):
    try:
        import requests
        payload = {"language": "sql", "command": query}
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
        logger.debug("Audit SQL failed: %s", e)
        return None


def _ensure_audit_schema():
    _sql("CREATE DOCUMENT TYPE ObservatoryAudit IF NOT EXISTS")
    _sql("CREATE PROPERTY ObservatoryAudit.event_type IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryAudit.staff_id IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryAudit.ip_address IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryAudit.timestamp IF NOT EXISTS STRING")
    _sql("CREATE PROPERTY ObservatoryAudit.success IF NOT EXISTS BOOLEAN")
    _sql("CREATE PROPERTY ObservatoryAudit.session_id IF NOT EXISTS STRING")
    _sql("CREATE INDEX ON ObservatoryAudit(staff_id) IF NOT EXISTS")
    _sql("CREATE INDEX ON ObservatoryAudit(event_type) IF NOT EXISTS")
    _sql("CREATE INDEX ON ObservatoryAudit(timestamp) IF NOT EXISTS")


try:
    _ensure_audit_schema()
except Exception:
    pass


def log_audit_event(
    event_type: str,
    staff_id: str,
    ip_address: str = "",
    user_agent: str = "",
    success: bool = True,
    failure_reason: Optional[str] = None,
    session_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
):
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "event_type": event_type,
        "staff_id": staff_id,
        "ip_address": ip_address,
        "user_agent": user_agent[:200] if user_agent else "",
        "timestamp": now,
        "success": success,
        "failure_reason": failure_reason or "",
        "session_id": session_id or "",
    }
    if extra:
        record["extra"] = json.dumps(extra)

    logger.info(
        "[observatory-audit] %s staff=%s success=%s reason=%s ip=%s",
        event_type, staff_id, success, failure_reason, ip_address,
    )

    try:
        _sql(
            "INSERT INTO ObservatoryAudit SET "
            "event_type = :event_type, staff_id = :staff_id, "
            "ip_address = :ip_address, user_agent = :user_agent, "
            "timestamp = :timestamp, success = :success, "
            "failure_reason = :failure_reason, session_id = :session_id",
            record,
        )
    except Exception as e:
        logger.warning("Audit log persist failed: %s", e)


def query_audit_log(
    staff_id: Optional[str] = None,
    event_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    clauses = []
    params: Dict[str, Any] = {}

    if staff_id:
        clauses.append("staff_id = :staff_id")
        params["staff_id"] = staff_id
    if event_type:
        clauses.append("event_type = :event_type")
        params["event_type"] = event_type
    if from_date:
        clauses.append("timestamp >= :from_date")
        params["from_date"] = from_date
    if to_date:
        clauses.append("timestamp <= :to_date")
        params["to_date"] = to_date

    where = " AND ".join(clauses) if clauses else "1=1"
    query = (
        f"SELECT FROM ObservatoryAudit WHERE {where} "
        f"ORDER BY timestamp DESC LIMIT {min(limit, 500)}"
    )

    result = _sql(query, params)
    if not result:
        return []
    return result.get("result", [])


# ══════════════════════════════════════════════════════════════════
#  CSRF
# ══════════════════════════════════════════════════════════════════

def generate_csrf_token() -> str:
    return secrets.token_hex(32)


def verify_csrf_token(token: str, stored_token: str) -> bool:
    if not token or not stored_token:
        return False
    return hmac.compare_digest(token, stored_token)


# ══════════════════════════════════════════════════════════════════
#  SMS HELPERS
# ══════════════════════════════════════════════════════════════════

def send_otp_sms(phone: str, otp: str) -> bool:
    if _settings.OTP_DEV_MODE:
        logger.info("[observatory-otp] DEV MODE — OTP for %s: %s", phone[-2:], otp)
        return True

    try:
        from src.services.sms_service import send_sms
        message = (
            f"Your AMINA Observatory verification code is: {otp}\n"
            f"Valid for 5 minutes. Do not share this code."
        )
        return send_sms(phone, message)
    except ImportError:
        logger.warning("SMS service not available — OTP logged only")
        logger.info("[observatory-otp] OTP for %s: %s", phone[-2:], otp)
        return False


def send_onboarding_sms(phone: str, name: str, staff_id: str, temp_password: str) -> bool:
    if _settings.OTP_DEV_MODE:
        logger.info(
            "[observatory-onboard] DEV — %s (%s) temp_pw: %s",
            name, staff_id, temp_password,
        )
        return True

    try:
        from src.services.sms_service import send_sms
        message = (
            f"Welcome to the AMINA NCD Observatory, {name}. "
            f"Your Staff ID is {staff_id}. Login at the Observatory "
            f"with your temporary password to set up your account. "
            f"This password expires in 72 hours."
        )
        return send_sms(phone, message)
    except ImportError:
        logger.warning("SMS service not available — onboarding logged only")
        return False
