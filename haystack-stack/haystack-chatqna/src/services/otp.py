"""
OTP Service for AMINA — Phone verification via SMS.

Flow:
  1. User enters phone → POST /auth/otp/send
  2. OTP generated → stored in Redis (5 min TTL) → sent via SMS
  3. User enters OTP → POST /auth/otp/verify
  4. Verified → JWT token returned → auto-create account if new

SMS Providers (tried in order):
  1. Twilio (production) — set TWILIO_ACCOUNT_SID + AUTH_TOKEN + PHONE
  2. TextBelt (free, 1 SMS/day) — works without any config
  3. Dev fallback — OTP returned in API response
"""

import random
import logging
import re
import json
from typing import Tuple, Dict, Any, Optional

import requests as http_requests

from src.config import settings

logger = logging.getLogger(__name__)

OTP_LENGTH = 6
OTP_TTL = 300       # 5 minutes
MAX_ATTEMPTS = 5
LOCKOUT_TTL = 900   # 15 min lockout


def _normalize_phone(phone: str) -> str:
    """Normalize any phone format to E.164 (+XXXXXXXXXXX)."""
    phone = re.sub(r"[\s\-\(\).]", "", phone.strip())
    if phone.startswith("+"):
        return phone

    # India: 10 digits starting with 6-9
    if len(phone) == 10 and phone[0] in "6789":
        return f"+91{phone}"
    if phone.startswith("91") and len(phone) == 12:
        return f"+{phone}"
    if phone.startswith("0") and len(phone) == 11 and phone[1] in "6789":
        return f"+91{phone[1:]}"

    # Gambia: 7 digits
    if len(phone) == 7 and phone[0] in "23456789":
        return f"+220{phone}"
    if phone.startswith("220") and len(phone) == 10:
        return f"+{phone}"

    # Colombia: 10 digits starting with 3
    if len(phone) == 10 and phone[0] == "3":
        return f"+57{phone}"
    if phone.startswith("57") and len(phone) == 12:
        return f"+{phone}"

    # Generic
    if len(phone) >= 10:
        return f"+{phone}"
    return phone


def _generate_otp() -> str:
    return str(random.SystemRandom().randint(100000, 999999))


def _otp_key(phone): return f"otp:{phone}"
def _attempts_key(phone): return f"otp_attempts:{phone}"
def _lockout_key(phone): return f"otp_lockout:{phone}"


def _send_sms(to: str, body: str) -> Tuple[bool, str]:
    """Try to send SMS. Returns (success, method_used).

    Tries in order: Twilio → TextBelt → dev fallback.
    """
    # 1. Twilio (if configured)
    if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
        try:
            from twilio.rest import Client
            client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
            msg = client.messages.create(body=body, from_=settings.TWILIO_PHONE_NUMBER, to=to)
            logger.info(f"Twilio SMS sent: {msg.sid}")
            return True, "twilio"
        except ImportError:
            logger.warning("Twilio package not installed, falling through to TextBelt")
        except Exception as e:
            logger.warning(f"Twilio failed: {e}, falling through to TextBelt")

    # 2. TextBelt (free, 1 SMS/day, no signup)
    try:
        r = http_requests.post("https://textbelt.com/text", data={
            "phone": to,
            "message": body,
            "key": "textbelt",  # free tier key
        }, timeout=15)
        data = r.json()
        if data.get("success"):
            logger.info(f"TextBelt SMS sent to {to}, quota remaining: {data.get('quotaRemaining')}")
            return True, "textbelt"
        else:
            logger.warning(f"TextBelt failed: {data.get('error', 'unknown')}")
    except Exception as e:
        logger.warning(f"TextBelt request failed: {e}")

    # 3. Dev fallback
    return False, "dev"


def send_otp(phone: str, redis_client) -> Tuple[bool, Dict[str, Any]]:
    """Generate OTP, store in Redis, send via SMS."""
    normalized = _normalize_phone(phone)

    if len(normalized) < 8:
        return False, {"error": "Phone number too short. Include country code."}

    # Check lockout
    if redis_client.get(_lockout_key(normalized)):
        return False, {"error": "Too many attempts. Wait 15 minutes."}

    # Generate and store
    otp = _generate_otp()
    redis_client.setex(_otp_key(normalized), OTP_TTL, otp)
    redis_client.delete(_attempts_key(normalized))

    # Send SMS
    sms_body = f"Your AMINA verification code is: {otp}\n\nExpires in 5 minutes. Do not share."
    sent, method = _send_sms(normalized, sms_body)

    result = {
        "phone": normalized,
        "expires_in": OTP_TTL,
        "method": method,
    }

    if sent:
        result["message"] = f"OTP sent to {normalized} via {method}"
        # Don't expose OTP when actually sent
        if settings.OTP_DEV_MODE:
            result["otp_dev"] = otp
    else:
        # Dev fallback — show OTP in response
        result["message"] = f"SMS unavailable. Your code is: {otp}"
        result["otp_dev"] = otp
        result["method"] = "dev"

    return True, result


def verify_otp(phone: str, otp: str, redis_client) -> Tuple[bool, Dict[str, Any]]:
    """Verify OTP. Returns (success, {phone} or {error})."""
    normalized = _normalize_phone(phone)

    if redis_client.get(_lockout_key(normalized)):
        return False, {"error": "Account locked. Wait 15 minutes."}

    stored = redis_client.get(_otp_key(normalized))
    if not stored:
        return False, {"error": "OTP expired or not sent. Request a new one."}

    attempts = int(redis_client.get(_attempts_key(normalized)) or 0)
    if attempts >= MAX_ATTEMPTS:
        redis_client.setex(_lockout_key(normalized), LOCKOUT_TTL, "1")
        redis_client.delete(_otp_key(normalized))
        return False, {"error": "Too many wrong attempts. Locked for 15 minutes."}

    if otp.strip() != stored:
        redis_client.incr(_attempts_key(normalized))
        redis_client.expire(_attempts_key(normalized), OTP_TTL)
        remaining = MAX_ATTEMPTS - attempts - 1
        return False, {"error": f"Wrong code. {remaining} attempt(s) left."}

    # Success
    redis_client.delete(_otp_key(normalized))
    redis_client.delete(_attempts_key(normalized))
    return True, {"phone": normalized}
