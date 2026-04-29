"""
Phone-flow security primitives for the Observatory.

Adds onto observatory_security with:
  - 4-digit PIN hashing & verification (separate salt from password)
  - Phone-keyed rate limiting (5 attempts/phone/hr -> 30-min lock,
    3 lockouts/day -> hard lock)
  - Phone-keyed pending sessions (3-stage: phone_otp -> pin_pending
    -> consumed-on-JWT-mint)
  - PIN attempt tracking (5 wrong PINs -> phone lock)
  - Phone-flow audit hooks (reuses ObservatoryAudit type)

Reuses observatory_security primitives where possible:
  - JWT mint  (create_observatory_jwt)
  - OTP      (generate_otp / verify_otp)
  - SMS      (send_otp_sms)
  - Audit    (log_audit_event)
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Any, Dict, Optional, Tuple

from src.services import observatory_security as _obs

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
#  PIN HASHING
# ──────────────────────────────────────────────────────────────────

_PIN_SALT = os.getenv("OBSERVATORY_PIN_SALT", "amina-observatory-2026-pin-salt")
_PIN_ITERATIONS = 100_000  # PINs are short; lockout policy compensates


def hash_pin(pin: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        str(pin).encode("utf-8"),
        _PIN_SALT.encode("utf-8"),
        _PIN_ITERATIONS,
    ).hex()


def verify_pin(pin: str, stored_hash: str) -> bool:
    if not pin or not stored_hash:
        return False
    return hmac.compare_digest(hash_pin(pin), stored_hash)


def validate_pin_policy(pin: str) -> Optional[str]:
    if pin is None or pin == "":
        return "PIN required"
    pin = str(pin).strip()
    if not pin.isdigit():
        return "PIN must be digits only"
    if len(pin) != 4:
        return "PIN must be exactly 4 digits"
    return None


# ──────────────────────────────────────────────────────────────────
#  PHONE-KEYED RATE LIMITING
# ──────────────────────────────────────────────────────────────────

_PHONE_RATE_MAX = 5
_PHONE_RATE_WINDOW = 3600
_PHONE_LOCK_SECONDS = 1800
_PHONE_DAY_LOCK_THRESHOLD = 3


def check_phone_rate_limit(
    phone: str,
    ip: str,
) -> Tuple[bool, Optional[str], int]:
    """Check phone-flow rate limit.
    Returns (allowed, error_reason, attempts_remaining).
    """
    r = _obs._get_redis()
    if not r:
        return True, None, _PHONE_RATE_MAX

    if r.get(f"obs_phone_hardlock:{phone}"):
        return False, "phone_hard_locked", 0

    lock_key = f"obs_phone_lock:{phone}"
    if r.exists(lock_key):
        ttl = r.ttl(lock_key)
        return False, f"phone_locked:{ttl}", 0

    rate_key = f"obs_phone_rate:{phone}"
    count = int(r.get(rate_key) or 0)
    if count >= _PHONE_RATE_MAX:
        r.setex(lock_key, _PHONE_LOCK_SECONDS, "rate_locked")
        lock_count_key = f"obs_phone_lockcount:{phone}"
        locks = r.incr(lock_count_key)
        if locks == 1:
            r.expire(lock_count_key, 86400)
        if locks >= _PHONE_DAY_LOCK_THRESHOLD:
            r.set(f"obs_phone_hardlock:{phone}", "1")
        return False, "too_many_attempts", 0

    return True, None, _PHONE_RATE_MAX - count


def record_phone_failed_attempt(phone: str, ip: str) -> None:
    r = _obs._get_redis()
    if not r:
        return
    pipe = r.pipeline()
    pipe.incr(f"obs_phone_rate:{phone}")
    pipe.expire(f"obs_phone_rate:{phone}", _PHONE_RATE_WINDOW)
    pipe.incr(f"obs_phone_rate_ip:{ip}")
    pipe.expire(f"obs_phone_rate_ip:{ip}", _PHONE_RATE_WINDOW)
    pipe.execute()


def clear_phone_rate_limit(phone: str) -> None:
    r = _obs._get_redis()
    if r:
        r.delete(f"obs_phone_rate:{phone}")
        r.delete(f"obs_phone_lock:{phone}")
        r.delete(f"obs_phone_pinfail:{phone}")


def admin_unlock_phone(phone: str) -> None:
    """Admin override: clear all phone-flow locks including hardlock."""
    r = _obs._get_redis()
    if r:
        clear_phone_rate_limit(phone)
        r.delete(f"obs_phone_hardlock:{phone}")
        r.delete(f"obs_phone_lockcount:{phone}")


# ──────────────────────────────────────────────────────────────────
#  PIN ATTEMPT TRACKING (separate from rate limit)
# ──────────────────────────────────────────────────────────────────

_PIN_MAX_ATTEMPTS = 5
_PIN_ATTEMPT_WINDOW = 3600


def record_pin_attempt(phone: str, success: bool) -> Tuple[int, bool]:
    """Track wrong-PIN attempts. Returns (count, locked).
    On too many wrong PINs, lock the phone for 30 min.
    """
    r = _obs._get_redis()
    if not r:
        return 0, False
    if success:
        r.delete(f"obs_phone_pinfail:{phone}")
        return 0, False
    pipe = r.pipeline()
    pipe.incr(f"obs_phone_pinfail:{phone}")
    pipe.expire(f"obs_phone_pinfail:{phone}", _PIN_ATTEMPT_WINDOW)
    results = pipe.execute()
    count = int(results[0] or 0)
    if count >= _PIN_MAX_ATTEMPTS:
        r.setex(f"obs_phone_lock:{phone}", _PHONE_LOCK_SECONDS, "pin_locked")
        return count, True
    return count, False


# ──────────────────────────────────────────────────────────────────
#  PHONE-KEYED PENDING SESSIONS
#
#  3-stage progression:
#    "phone_otp"   -- after /init,        awaiting OTP entry
#    "pin_pending" -- after /verify-otp,  awaiting PIN entry
#    (after /verify-pin, JWT is minted; pending session is destroyed)
# ──────────────────────────────────────────────────────────────────

_PENDING_TTL = 600  # 10 minutes


def create_pending_session(
    phone: str,
    ip: str,
    user_agent: str,
    facility_id: Optional[str],
    staff_record: Dict[str, Any],
) -> str:
    session_id = f"OBS-PHONE-{secrets.token_hex(8)}"
    r = _obs._get_redis()
    if r:
        prev = r.get(f"obs_phone_pending_session:{phone}")
        if prev:
            r.delete(f"obs_phone_pending:{prev}")

        data = {
            "session_id":  session_id,
            "phone":       phone,
            "ip":          ip,
            "user_agent":  (user_agent or "")[:200],
            "facility_id": facility_id or "",
            "staff_id":    staff_record.get("staff_id", ""),
            "stage":       "phone_otp",
            "created":     time.time(),
        }
        r.setex(
            f"obs_phone_pending:{session_id}",
            _PENDING_TTL,
            json.dumps(data),
        )
        r.setex(
            f"obs_phone_pending_session:{phone}",
            _PENDING_TTL,
            session_id,
        )
    return session_id


def get_pending_session(session_id: str) -> Optional[Dict[str, Any]]:
    r = _obs._get_redis()
    if not r:
        return None
    raw = r.get(f"obs_phone_pending:{session_id}")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def advance_pending_to_pin(session_id: str) -> bool:
    r = _obs._get_redis()
    if not r:
        return False
    raw = r.get(f"obs_phone_pending:{session_id}")
    if not raw:
        return False
    try:
        data = json.loads(raw)
    except Exception:
        return False
    data["stage"] = "pin_pending"
    data["otp_verified_at"] = time.time()
    ttl = r.ttl(f"obs_phone_pending:{session_id}")
    if ttl <= 0:
        ttl = _PENDING_TTL
    r.setex(f"obs_phone_pending:{session_id}", ttl, json.dumps(data))
    return True


def consume_pending_session(session_id: str) -> None:
    r = _obs._get_redis()
    if not r:
        return
    raw = r.get(f"obs_phone_pending:{session_id}")
    if raw:
        try:
            data = json.loads(raw)
            phone = data.get("phone")
            if phone:
                r.delete(f"obs_phone_pending_session:{phone}")
        except Exception:
            pass
    r.delete(f"obs_phone_pending:{session_id}")


# ──────────────────────────────────────────────────────────────────
#  AUDIT LOGGING (phone-flow events)
# ──────────────────────────────────────────────────────────────────

def log_phone_audit(
    event_type: str,
    phone: str,
    staff_id: str = "",
    ip_address: str = "",
    user_agent: str = "",
    success: bool = True,
    failure_reason: Optional[str] = None,
    session_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Write a phone-flow audit event. Reuses ObservatoryAudit type
    with a `phone_` event-type prefix.
    """
    enriched = dict(extra or {})
    enriched["phone_last4"] = phone[-4:] if phone else ""

    fallback_id = f"phone:{phone[-4:]}" if phone else "phone:unknown"
    _obs.log_audit_event(
        event_type=f"phone_{event_type}",
        staff_id=staff_id or fallback_id,
        ip_address=ip_address,
        user_agent=user_agent,
        success=success,
        failure_reason=failure_reason,
        session_id=session_id,
        extra=enriched,
    )


__all__ = [
    "hash_pin",
    "verify_pin",
    "validate_pin_policy",
    "check_phone_rate_limit",
    "record_phone_failed_attempt",
    "clear_phone_rate_limit",
    "admin_unlock_phone",
    "record_pin_attempt",
    "create_pending_session",
    "get_pending_session",
    "advance_pending_to_pin",
    "consume_pending_session",
    "log_phone_audit",
]
