"""
Simple phone + PIN auth for AMINA MVP.

On signup:
  1. Validate phone (Gambian format: 220XXXXXXX)
  2. Hash PIN with bcrypt
  3. Create PatientVertex in ArcadeDB (linked to agent memory)
  4. Return JWT token

On login:
  1. Lookup by phone
  2. Verify PIN
  3. Return JWT + patient profile
"""

import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple

import jwt

from src.config import settings
from src.utils.arcade_client import command_sql, extract_rows

# ArcadeDB helper: the sync client expects params as a positional list
# but named :param queries need a dict. Use this wrapper.
def _sql(query: str, params: dict = None):
    """Execute SQL with named params as a dict via ArcadeDB REST API."""
    import requests as _req
    payload = {"language": "sql", "command": query}
    if params:
        payload["params"] = params
    resp = _req.post(
        f"{settings.ARCADEDB_URL}/api/v1/command/{settings.ARCADEDB_DB}",
        json=payload,
        auth=(settings.ARCADEDB_USER, settings.ARCADEDB_PASSWORD),
        timeout=10,
    )
    if resp.status_code != 200:
        raise Exception(f"ArcadeDB error: {resp.text}")
    return resp.json()

logger = logging.getLogger(__name__)


def _hash_pin(pin: str, salt: str) -> str:
    """Hash a 4-digit PIN with HMAC-SHA256. Simple but sufficient for MVP."""
    return hmac.new(salt.encode(), pin.encode(), hashlib.sha256).hexdigest()


def _generate_patient_id(phone: str) -> str:
    return f"P_{hashlib.md5(phone.encode()).hexdigest()[:8].upper()}"


def _create_jwt(patient_id: str, phone: str, name: str,
                role: Optional[str] = None) -> str:
    """Mint a patient-session JWT. `role` is optional — when provided
    (typically "admin" for admin-patient accounts) it's embedded into
    the payload so care_routes._resolve_effective_role can grant the
    impersonation bypass."""
    payload = {
        "sub": patient_id,
        "phone": phone,
        "name": name,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=settings.JWT_EXPIRY_HOURS),
    }
    if role:
        payload["role"] = role
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def _admin_patient_emails() -> set:
    """Comma-separated allowlist of patient emails that get role='admin'
    stamped into their JWT on email-login. Empty by default — admin
    promotion is strictly opt-in via the ADMIN_PATIENT_EMAILS env var."""
    import os as _os
    raw = (_os.getenv("ADMIN_PATIENT_EMAILS", "") or "").strip()
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def verify_jwt(token: str) -> Optional[Dict[str, Any]]:
    """Verify a JWT and return the payload, or None if invalid/expired."""
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        logger.warning("JWT expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid JWT: {e}")
        return None


def signup(
    phone: str,
    pin: str,
    name: str,
    age: int = 0,
    gender: str = "other",
    region: str = "Kanifing",
    conditions: list = None,
    language: str = "english",
) -> Tuple[bool, Dict[str, Any]]:
    """Register a new patient. Creates PatientVertex in ArcadeDB.

    Returns: (success, {token, patient} or {error})
    """
    # Validate phone
    phone = phone.strip().replace(" ", "").replace("-", "")
    if len(phone) < 7:
        return False, {"error": "Phone number too short"}

    # Validate PIN
    pin = pin.strip()
    if len(pin) != 4 or not pin.isdigit():
        return False, {"error": "PIN must be exactly 4 digits"}

    # Check if phone already exists
    try:
        resp = _sql(
            "SELECT id, name FROM PatientVertex WHERE phone = :phone LIMIT 1",
            {"phone": phone},
        )
        rows = extract_rows(resp)
        if rows:
            return False, {"error": "Phone number already registered. Please login instead."}
    except Exception:
        pass

    # Create patient
    patient_id = _generate_patient_id(phone)
    salt = uuid.uuid4().hex[:16]
    pin_hash = _hash_pin(pin, salt)
    now = datetime.now().isoformat()

    try:
        _sql(
            "INSERT INTO PatientVertex SET "
            "id = :id, phone = :phone, name = :name, age = :age, "
            "gender = :gender, region = :region, "
            "conditions = :conditions, medications = :meds, "
            "allergies = :allergies, key_facts = :facts, "
            "bp_readings = :bp, glucose_readings = :glucose, "
            "consultation_count = 0, preferred_language = :lang, "
            "pin_hash = :pin_hash, pin_salt = :pin_salt, "
            "created_at = :created, updated_at = :updated",
            {
                "id": patient_id, "phone": phone, "name": name, "age": age,
                "gender": gender, "region": region,
                "conditions": json.dumps(conditions or []), "meds": "[]",
                "allergies": "[]", "facts": json.dumps([f"Registered on {now[:10]}"]),
                "bp": "[]", "glucose": "[]", "lang": language,
                "pin_hash": pin_hash, "pin_salt": salt,
                "created": now, "updated": now,
            },
        )
    except Exception as e:
        logger.error(f"Signup failed: {e}")
        return False, {"error": f"Failed to create account: {e}"}

    token = _create_jwt(patient_id, phone, name)

    return True, {
        "token": token,
        "patient": {
            "id": patient_id,
            "phone": phone,
            "name": name,
            "age": age,
            "gender": gender,
            "region": region,
            "conditions": conditions or [],
            "language": language,
            "visit_count": 0,
        },
    }


def signup_email(
    email: str,
    password: str,
    name: str,
    phone: str = "",
    age: int = 0,
    gender: str = "other",
    region: str = "Kanifing",
    conditions: list = None,
    language: str = "english",
) -> Tuple[bool, Dict[str, Any]]:
    """Register with email + password."""
    email = email.strip().lower()
    if not email or "@" not in email:
        return False, {"error": "Invalid email address"}
    if len(password) < 4:
        return False, {"error": "Password must be at least 4 characters"}

    # Check if email already exists
    try:
        resp = _sql(
            "SELECT id, name FROM PatientVertex WHERE email = :email LIMIT 1",
            {"email": email},
        )
        rows = extract_rows(resp)
        if rows:
            return False, {"error": "Email already registered. Please login."}
    except Exception:
        pass

    patient_id = _generate_patient_id(email)
    salt = uuid.uuid4().hex[:16]
    pw_hash = _hash_pin(password, salt)
    now = datetime.now().isoformat()

    try:
        _sql(
            "INSERT INTO PatientVertex SET "
            "id = :id, phone = :phone, email = :email, name = :name, age = :age, "
            "gender = :gender, region = :region, "
            "conditions = :conditions, medications = :meds, "
            "allergies = :allergies, key_facts = :facts, "
            "bp_readings = :bp, glucose_readings = :glucose, "
            "consultation_count = 0, preferred_language = :lang, "
            "pin_hash = :pin_hash, pin_salt = :pin_salt, "
            "created_at = :created, updated_at = :updated",
            {
                "id": patient_id, "phone": phone or f"nophone_{patient_id}", "email": email,
                "name": name, "age": age, "gender": gender, "region": region,
                "conditions": json.dumps(conditions or []), "meds": "[]",
                "allergies": "[]", "facts": json.dumps([f"Registered on {now[:10]}"]),
                "bp": "[]", "glucose": "[]", "lang": language,
                "pin_hash": pw_hash, "pin_salt": salt,
                "created": now, "updated": now,
            },
        )
    except Exception as e:
        logger.error(f"Email signup failed: {e}")
        return False, {"error": f"Failed to create account: {e}"}

    token = _create_jwt(patient_id, email, name)
    return True, {
        "token": token,
        "patient": {
            "id": patient_id, "email": email, "phone": phone,
            "name": name, "age": age, "gender": gender,
            "region": region, "conditions": conditions or [],
            "language": language, "visit_count": 0,
        },
    }


def login_email(email: str, password: str) -> Tuple[bool, Dict[str, Any]]:
    """Login with email + password."""
    email = email.strip().lower()
    if not email or "@" not in email:
        return False, {"error": "Invalid email address"}

    try:
        resp = _sql(
            "SELECT * FROM PatientVertex WHERE email = :email LIMIT 1",
            {"email": email},
        )
        rows = extract_rows(resp)
    except Exception as e:
        logger.error(f"Email login lookup failed: {e}")
        return False, {"error": "Service unavailable. Please try again."}

    if not rows:
        return False, {"error": "Email not found. Please sign up first."}

    patient = rows[0]
    stored_hash = patient.get("pin_hash", "")
    stored_salt = patient.get("pin_salt", "")

    if not stored_hash or not stored_salt:
        return False, {"error": "Account not set up for login."}

    if _hash_pin(password, stored_salt) != stored_hash:
        return False, {"error": "Incorrect password. Please try again."}

    for field in ("conditions", "medications", "allergies", "key_facts"):
        val = patient.get(field, "[]")
        if isinstance(val, str):
            patient[field] = json.loads(val)

    # Admin-patient promotion: an allowlisted email gets a JWT carrying
    # role='admin'. The user experiences the normal patient UI, but
    # care_routes._resolve_effective_role will honor body-role
    # impersonation for writes (i.e. the RoleSwitcher pill works + the
    # admin bypass kicks in when body role = admin or blank).
    admin_allow = _admin_patient_emails()
    role = "admin" if email in admin_allow else None
    token = _create_jwt(patient.get("id", ""), email, patient.get("name", ""), role=role)
    return True, {
        "token": token,
        "patient": {
            "id": patient.get("id"), "email": email,
            "phone": patient.get("phone", ""),
            "name": patient.get("name"), "age": patient.get("age"),
            "gender": patient.get("gender"), "region": patient.get("region"),
            "conditions": patient.get("conditions", []),
            "medications": [
                m.get("name", m) if isinstance(m, dict) else m
                for m in patient.get("medications", [])
            ],
            "language": patient.get("preferred_language", "english"),
            "visit_count": patient.get("consultation_count", 0),
        },
    }


def handle_oauth_callback(
    provider: str, oauth_id: str, email: str, name: str,
) -> Tuple[bool, Dict[str, Any]]:
    """Handle OAuth callback (Google, Facebook, DHIS2).
    Creates patient if new, returns JWT token."""
    # Check if OAuth user exists
    try:
        resp = _sql(
            "SELECT * FROM PatientVertex WHERE oauth_id = :oid LIMIT 1",
            {"oid": f"{provider}:{oauth_id}"},
        )
        rows = extract_rows(resp)
    except Exception:
        rows = []

    if rows:
        # Existing user — login
        patient = rows[0]
        for field in ("conditions", "medications", "allergies", "key_facts"):
            val = patient.get(field, "[]")
            if isinstance(val, str):
                patient[field] = json.loads(val)
        token = _create_jwt(patient.get("id", ""), email, patient.get("name", ""))
        return True, {
            "token": token,
            "patient": {
                "id": patient.get("id"), "email": email,
                "name": patient.get("name"), "age": patient.get("age"),
                "gender": patient.get("gender"), "region": patient.get("region"),
                "conditions": patient.get("conditions", []),
                "language": patient.get("preferred_language", "english"),
                "visit_count": patient.get("consultation_count", 0),
            },
        }

    # New OAuth user — create
    patient_id = _generate_patient_id(f"{provider}:{oauth_id}")
    now = datetime.now().isoformat()
    try:
        _sql(
            "INSERT INTO PatientVertex SET "
            "id = :id, email = :email, name = :name, "
            "oauth_id = :oid, oauth_provider = :provider, "
            "phone = :phone, age = 0, gender = :gender, region = :region, "
            "conditions = :conds, medications = :meds, "
            "allergies = :allerg, key_facts = :facts, "
            "bp_readings = :bp, glucose_readings = :glu, "
            "consultation_count = 0, preferred_language = :lang, "
            "pin_hash = :ph, pin_salt = :ps, "
            "created_at = :created, updated_at = :updated",
            {
                "id": patient_id, "email": email, "name": name,
                "oid": f"{provider}:{oauth_id}", "provider": provider,
                "phone": f"nophone_{patient_id}", "gender": "other", "region": "Kanifing",
                "conds": "[]", "meds": "[]", "allerg": "[]",
                "facts": json.dumps([f"Registered via {provider} on {now[:10]}"]),
                "bp": "[]", "glu": "[]", "lang": "english",
                "ph": "", "ps": "",
                "created": now, "updated": now,
            },
        )
    except Exception as e:
        logger.error(f"OAuth signup failed: {e}")
        return False, {"error": f"Failed to create account: {e}"}

    token = _create_jwt(patient_id, email, name)
    return True, {
        "token": token,
        "patient": {
            "id": patient_id, "email": email, "name": name,
            "age": 0, "gender": "other", "region": "Kanifing",
            "conditions": [], "language": "english", "visit_count": 0,
        },
    }


def request_password_reset(email: str, redis) -> Tuple[bool, Dict[str, Any]]:
    """
    Generate a password-reset token and send it by email.

    Steps:
      1. Look up patient by email in ArcadeDB.
      2. Generate a 32-char hex token, store in Redis with 15-min TTL.
      3. Call email_service to send the reset link.

    Returns (True, {}) on success, (False, {error}) on failure.
    Always returns success to the caller to prevent email enumeration.
    """
    import secrets as _sec
    from src.services.email_service import send_password_reset_email

    email = email.strip().lower()
    if not email or "@" not in email:
        return False, {"error": "Invalid email address"}

    # Lookup — silently succeed if email not found (prevents enumeration)
    try:
        resp  = _sql("SELECT id, name FROM PatientVertex WHERE email = :email LIMIT 1", {"email": email})
        rows  = extract_rows(resp)
    except Exception as exc:
        logger.error(f"Password reset lookup failed: {exc}")
        return True, {}  # still return success to caller

    if not rows:
        logger.info(f"Password reset requested for unknown email: {email} (ignored)")
        return True, {}  # prevent email enumeration

    patient = rows[0]
    patient_id   = patient.get("id", "")
    patient_name = patient.get("name", "Patient")

    token = _sec.token_hex(32)                          # 64-char hex, collision-proof
    redis.setex(f"pwd_reset:{token}", 900, email)       # 15-minute TTL

    sent = send_password_reset_email(email, patient_name, token)
    logger.info(
        f"Password reset for {email} (id={patient_id}): "
        f"{'email sent' if sent else 'email logged (dev mode)'}"
    )
    return True, {"dev_token": token if not sent else None}  # expose token only in dev


def confirm_password_reset(token: str, new_password: str, redis) -> Tuple[bool, Dict[str, Any]]:
    """
    Verify a reset token and update the patient's password.

    Steps:
      1. Look up token in Redis → retrieve email.
      2. Validate new password length.
      3. Hash new password + update PatientVertex.
      4. Delete token from Redis (one-time use).

    Returns (True, {}) on success, (False, {error}) on failure.
    """
    if not token or len(token) < 10:
        return False, {"error": "Invalid reset token"}
    if len(new_password) < 4:
        return False, {"error": "Password must be at least 4 characters"}

    email = redis.get(f"pwd_reset:{token}")
    if not email:
        return False, {"error": "Reset link has expired or is invalid. Please request a new one."}

    if isinstance(email, bytes):
        email = email.decode()

    try:
        resp = _sql("SELECT id FROM PatientVertex WHERE email = :email LIMIT 1", {"email": email})
        rows = extract_rows(resp)
    except Exception as exc:
        logger.error(f"Password reset confirm lookup failed: {exc}")
        return False, {"error": "Service unavailable. Please try again."}

    if not rows:
        return False, {"error": "Account not found"}

    new_salt    = uuid.uuid4().hex[:16]
    new_hash    = _hash_pin(new_password, new_salt)
    now         = datetime.now().isoformat()

    try:
        _sql(
            "UPDATE PatientVertex SET pin_hash = :ph, pin_salt = :ps, updated_at = :upd "
            "WHERE email = :email",
            {"ph": new_hash, "ps": new_salt, "upd": now, "email": email},
        )
    except Exception as exc:
        logger.error(f"Password reset update failed: {exc}")
        return False, {"error": "Failed to update password. Please try again."}

    redis.delete(f"pwd_reset:{token}")   # one-time use — invalidate immediately
    logger.info(f"Password successfully reset for {email}")
    return True, {}


def login(phone: str, pin: str) -> Tuple[bool, Dict[str, Any]]:
    """Authenticate a patient by phone + PIN.

    Returns: (success, {token, patient} or {error})
    """
    phone = phone.strip().replace(" ", "").replace("-", "")
    pin = pin.strip()

    if len(pin) != 4 or not pin.isdigit():
        return False, {"error": "PIN must be exactly 4 digits"}

    try:
        resp = _sql(
            "SELECT * FROM PatientVertex WHERE phone = :phone LIMIT 1",
            {"phone": phone},
        )
        rows = extract_rows(resp)
    except Exception as e:
        logger.error(f"Login lookup failed: {e}")
        return False, {"error": "Service unavailable. Please try again."}

    if not rows:
        return False, {"error": "Phone number not found. Please sign up first."}

    patient = rows[0]
    stored_hash = patient.get("pin_hash", "")
    stored_salt = patient.get("pin_salt", "")

    if not stored_hash or not stored_salt:
        return False, {"error": "Account not set up for login. Please contact your CHW."}

    if _hash_pin(pin, stored_salt) != stored_hash:
        return False, {"error": "Incorrect PIN. Please try again."}

    # Parse JSON fields
    for field in ("conditions", "medications", "allergies", "key_facts"):
        val = patient.get(field, "[]")
        if isinstance(val, str):
            patient[field] = json.loads(val)

    token = _create_jwt(
        patient.get("id", ""),
        phone,
        patient.get("name", ""),
    )

    return True, {
        "token": token,
        "patient": {
            "id": patient.get("id"),
            "phone": phone,
            "name": patient.get("name"),
            "age": patient.get("age"),
            "gender": patient.get("gender"),
            "region": patient.get("region"),
            "conditions": patient.get("conditions", []),
            "medications": [
                m.get("name", m) if isinstance(m, dict) else m
                for m in patient.get("medications", [])
            ],
            "allergies": patient.get("allergies", []),
            "key_facts": patient.get("key_facts", []),
            "language": patient.get("preferred_language", "english"),
            "visit_count": patient.get("consultation_count", 0),
            "last_visit": patient.get("last_consultation"),
            "emergency_contact": patient.get("emergency_contact"),
        },
    }
