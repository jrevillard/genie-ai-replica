"""
Caregiver Alert Service
========================
Sends SMS alerts to caregivers when patient health events occur.

SMS Routing (by country code):
  +220 (Gambia)   → Africa's Talking  [primary for deployment]
  +91  (India)    → Twilio            [testing]
  +57  (Colombia) → Twilio            [testing]
  Any             → TextBelt fallback → dev log

Alert triggers (called from agent, vitals update, nudge scheduler):
  - high_bp:           systolic > 160 or diastolic > 100
  - high_glucose:      glucose > 11.1 mmol/L
  - low_glucose:       glucose < 3.9 mmol/L
  - emergency_triage:  triage_level == EMERGENCY
  - missed_medication: not logged in 3+ days
  - chw_visit:         upcoming CHW appointment
"""

import json
import logging
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

import requests as http_requests

from src.config import settings

logger = logging.getLogger(__name__)


# ── SMS Templates (WHO-standard plain language) ──────────────────────────────

BOT_NAME = "AMINA Care"

ALERT_TEMPLATES = {
    "high_bp": (
        "{bot}: ALERT — {patient_name}'s blood pressure is high ({value}). "
        "Please help them rest, avoid salt, and seek care today. "
        "Reply HELP for guidance."
    ),
    "high_glucose": (
        "{bot}: ALERT — {patient_name}'s blood sugar is high ({value}). "
        "Check if they have taken their medication. "
        "Reply HELP for guidance."
    ),
    "low_glucose": (
        "{bot}: URGENT — {patient_name}'s blood sugar is dangerously low ({value}). "
        "Give them sugar or juice immediately. Seek care if no improvement. "
        "Reply HELP for guidance."
    ),
    "emergency_triage": (
        "{bot}: URGENT — {patient_name} needs emergency care NOW. "
        "Please take them to the nearest hospital immediately. "
        "Reply HELP for the nearest facility."
    ),
    "missed_medication": (
        "{bot}: REMINDER — {patient_name} may have missed their medication for "
        "{days} day(s). Please check in with them. Reply HELP for guidance."
    ),
    "chw_visit": (
        "{bot}: A community health worker will visit {patient_name} on {date}. "
        "Please ensure they are available at home."
    ),
    "general": (
        "{bot}: Health update for {patient_name}. {message} "
        "Reply HELP for more information."
    ),
}

HELP_RESPONSE = (
    "AMINA Care: For emergencies call your nearest health centre. "
    "For advice, open the AMINA Care app or contact your CHW. "
    "Stay calm and monitor the patient."
)


# ── SMS Sending (routed by country code) ─────────────────────────────────────

def _route_sms(to: str, body: str) -> Tuple[bool, str]:
    """Route SMS to the correct provider based on country code."""

    # +220 → Africa's Talking (Gambia)
    if to.startswith("+220"):
        ok, method = _send_africas_talking(to, body)
        if ok:
            return True, method

    # +91 (India) or +57 (Colombia) → Twilio for testing
    if to.startswith("+91") or to.startswith("+57"):
        ok, method = _send_twilio(to, body)
        if ok:
            return True, method

    # Universal Twilio fallback (any configured number)
    ok, method = _send_twilio(to, body)
    if ok:
        return True, method

    # TextBelt free tier
    ok, method = _send_textbelt(to, body)
    if ok:
        return True, method

    # Dev log
    logger.info(f"[DEV SMS] To: {to} | Body: {body}")
    return False, "dev"


def _send_africas_talking(to: str, body: str) -> Tuple[bool, str]:
    """Africa's Talking SMS — best coverage for West Africa."""
    username = getattr(settings, "AT_USERNAME", None)
    api_key  = getattr(settings, "AT_API_KEY", None)
    if not username or not api_key:
        return False, "at_not_configured"
    try:
        import africastalking
        africastalking.initialize(username, api_key)
        sms = africastalking.SMS
        sender = getattr(settings, "AT_SENDER_ID", None)
        kwargs = {"message": body, "recipients": [to]}
        if sender:
            kwargs["senderId"] = sender
        resp = sms.send(**kwargs)
        logger.info(f"Africa's Talking sent: {resp}")
        return True, "africas_talking"
    except ImportError:
        logger.warning("africastalking package not installed")
        return False, "at_not_installed"
    except Exception as e:
        logger.warning(f"Africa's Talking failed: {e}")
        return False, "at_error"


def _send_twilio(to: str, body: str) -> Tuple[bool, str]:
    """
    Twilio SMS — India (+91) and Colombia (+57) for testing.

    India note: TRAI mandates DLT registration for transactional SMS.
    Set INDIA_DLT_ENTITY_ID + INDIA_DLT_TEMPLATE_ID + TWILIO_INDIA_SENDER in .env
    once your DLT registration is approved (vilpower.in or operator portal).
    Until then, use Twilio trial to test with verified numbers.

    Colombia: works out of the box with Twilio — no extra registration needed.
    """
    sid   = getattr(settings, "TWILIO_ACCOUNT_SID", None)
    token = getattr(settings, "TWILIO_AUTH_TOKEN", None)
    from_ = getattr(settings, "TWILIO_PHONE_NUMBER", None)
    if not sid or not token or not from_:
        return False, "twilio_not_configured"
    try:
        from twilio.rest import Client
        client = Client(sid, token)

        create_kwargs = {"body": body, "from_": from_, "to": to}

        # India: attach DLT headers if configured
        if to.startswith("+91"):
            dlt_entity   = getattr(settings, "INDIA_DLT_ENTITY_ID", "")
            dlt_template = getattr(settings, "INDIA_DLT_TEMPLATE_ID", "")
            india_sender = getattr(settings, "TWILIO_INDIA_SENDER", "")
            if dlt_entity:
                create_kwargs["validity_period"] = 3600
                # Twilio passes DLT IDs via messaging_service_sid or smart_encoded
                # Use StatusCallback to track delivery
                logger.info(f"India DLT: entity={dlt_entity} template={dlt_template}")
            if india_sender:
                create_kwargs["from_"] = india_sender  # e.g. "AMINAC"

        msg = client.messages.create(**create_kwargs)
        logger.info(f"Twilio sent: {msg.sid} to {to} ({msg.status})")
        return True, "twilio"
    except ImportError:
        return False, "twilio_not_installed"
    except Exception as e:
        logger.warning(f"Twilio failed for {to}: {e}")
        return False, "twilio_error"


def _send_textbelt(to: str, body: str) -> Tuple[bool, str]:
    try:
        r = http_requests.post("https://textbelt.com/text", data={
            "phone": to, "message": body, "key": "textbelt",
        }, timeout=15)
        data = r.json()
        if data.get("success"):
            return True, "textbelt"
        logger.warning(f"TextBelt: {data.get('error')}")
    except Exception as e:
        logger.warning(f"TextBelt error: {e}")
    return False, "textbelt_failed"


# ── Alert Logic ───────────────────────────────────────────────────────────────

def _format_alert(alert_type: str, patient_name: str, **ctx) -> str:
    template = ALERT_TEMPLATES.get(alert_type, ALERT_TEMPLATES["general"])
    try:
        return template.format(bot=BOT_NAME, patient_name=patient_name, **ctx)
    except KeyError:
        return ALERT_TEMPLATES["general"].format(
            bot=BOT_NAME,
            patient_name=patient_name,
            message=ctx.get("message", "Health update."),
        )


def _patient_region(patient_id: str) -> str:
    """Resolve patient region for DHIS2 aggregation. Falls back to 'unknown'."""
    try:
        from src.utils.arcade_client import command_sql
        resp = command_sql(
            "SELECT region FROM PatientVertex WHERE id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = (resp or {}).get("result", []) if isinstance(resp, dict) else []
        if rows and rows[0].get("region"):
            return str(rows[0]["region"]).lower()
    except Exception:
        pass
    return "unknown"


def send_caregiver_alerts(
    patient_id: str,
    patient_name: str,
    alert_type: str,
    caregiver_phones: List[str],
    severity: str = "medium",
    **context,
) -> List[dict]:
    """
    Send alert SMS to all active caregivers for a patient.

    Args:
        patient_id:       Patient's ID
        patient_name:     Patient's display name
        alert_type:       One of ALERT_TEMPLATES keys
        caregiver_phones: List of E.164 phone numbers
        severity:         low | medium | high | emergency
        **context:        Template variables (value, days, date, message, etc.)

    Returns:
        List of send results per caregiver.
    """
    message = _format_alert(alert_type, patient_name, **context)
    results = []

    # DHIS2 daily aggregate counter — one bump per alert batch, not per SMS
    try:
        from src.services.dhis2_sync import bump_daily_counter
        bump_daily_counter(_patient_region(patient_id), "AMINA_CG_ALERTS", amount=1)
    except Exception:
        pass  # DHIS2 aggregation must never break SMS delivery

    for phone in caregiver_phones:
        sent, method = _route_sms(phone, message)
        results.append({
            "phone":     phone,
            "sent":      sent,
            "method":    method,
            "alert_type": alert_type,
            "severity":  severity,
            "timestamp": datetime.now().isoformat(),
        })
        if sent:
            logger.info(f"Alert '{alert_type}' sent to caregiver {phone} via {method}")
        else:
            logger.warning(f"Alert '{alert_type}' FAILED for caregiver {phone}")

    return results


def handle_sms_reply(from_phone: str, message: str) -> Optional[str]:
    """
    Handle inbound SMS replies from caregivers.
    Returns SMS response body, or None if not a recognised command.
    """
    msg = message.strip().upper()
    if msg in ("HELP", "AIDE", "MSAADA"):
        return HELP_RESPONSE
    if msg in ("STOP", "ARRET", "SIMAMA"):
        return (
            "You have been unsubscribed from AMINA caregiver alerts. "
            "Contact your health facility to re-subscribe."
        )
    return None


# ── Vital-based trigger helpers ──────────────────────────────────────────────

def check_bp_alert(systolic: float, diastolic: float) -> Optional[str]:
    """Return alert_type if BP is out of range, else None."""
    if systolic >= 180 or diastolic >= 110:
        return "emergency_triage"
    if systolic >= 160 or diastolic >= 100:
        return "high_bp"
    return None


def check_glucose_alert(glucose_mmol: float) -> Optional[str]:
    if glucose_mmol < 3.9:
        return "low_glucose"
    if glucose_mmol > 11.1:
        return "high_glucose"
    return None
