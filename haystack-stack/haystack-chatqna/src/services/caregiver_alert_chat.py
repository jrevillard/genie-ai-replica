"""
Caregiver Alert Chat — In-chat alert sending via AMINA
=======================================================

When a caregiver says "send alert" (or similar) in the chat, AMINA
detects the intent, asks for details (severity + message), then
auto-sends the alert through patient_alert_service.send_patient_alert().

Multi-turn state is stored in Redis with a short TTL so the alert
conversation doesn't pollute normal clinical chat.

Redis key: cg_alert_pending:{caregiver_id}:{patient_id}
TTL: 300s (5 minutes to complete the alert flow)
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional, Dict, Any, Tuple

import redis as redis_lib

from src.config import settings

logger = logging.getLogger(__name__)

# ── Alert intent keywords ────────────────────────────────────────────────────

_ALERT_INTENT_PATTERNS = [
    r"\bsend\s*(an?\s*)?alert",
    r"\balert\s*(the\s*)?patient",
    r"\bnotify\s*(the\s*)?patient",
    r"\bsend\s*(a\s*)?notification",
    r"\bsend\s*(a\s*)?message\s*to\s*(the\s*)?patient",
    r"\bsend\s*(a\s*)?reminder",
    r"\bpush\s*(a\s*)?notification",
    r"\bescalate\s*alert",
    r"\bemergency\s*alert",
    r"\bwarning\s*alert",
]

_SEVERITY_MAP = {
    "emergency": "emergency",
    "urgent": "emergency",
    "critical": "emergency",
    "warning": "warning",
    "warn": "warning",
    "concern": "warning",
    "info": "info",
    "reminder": "info",
    "check-in": "info",
    "checkin": "info",
    "check in": "info",
}


# ── Redis state management ───────────────────────────────────────────────────

_redis_client: Optional[redis_lib.Redis] = None
_ALERT_TTL = 300  # 5 minutes


def _get_redis() -> redis_lib.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
        )
    return _redis_client


def _alert_key(cg: str, pid: str) -> str:
    return f"cg_alert_pending:{cg}:{pid}"


def _get_pending(cg: str, pid: str) -> Optional[Dict]:
    try:
        raw = _get_redis().get(_alert_key(cg, pid))
        return json.loads(raw) if raw else None
    except Exception:
        return None


def _set_pending(cg: str, pid: str, state: Dict) -> None:
    try:
        _get_redis().setex(_alert_key(cg, pid), _ALERT_TTL, json.dumps(state))
    except Exception:
        pass


def _clear_pending(cg: str, pid: str) -> None:
    try:
        _get_redis().delete(_alert_key(cg, pid))
    except Exception:
        pass


# ── Intent detection ─────────────────────────────────────────────────────────

def detect_alert_intent(message: str) -> bool:
    lower = message.lower()
    for pattern in _ALERT_INTENT_PATTERNS:
        if re.search(pattern, lower):
            return True
    return False


def _extract_severity(message: str) -> Optional[str]:
    lower = message.lower()
    for keyword, severity in _SEVERITY_MAP.items():
        if keyword in lower:
            return severity
    return None


def _extract_alert_message(message: str) -> Optional[str]:
    """Try to extract the alert content from the caregiver's response."""
    lower = message.lower().strip()

    # If it's very short, it's probably just severity or "yes"
    if len(message.strip()) < 10:
        return None

    # Remove common prefixes
    for prefix in ["the message is", "message:", "alert:", "tell them", "say"]:
        if lower.startswith(prefix):
            return message[len(prefix):].strip().strip('"').strip("'")

    # If the message is a proper sentence (not just a keyword), use it as-is
    if len(message.strip()) > 15 and not detect_alert_intent(message):
        return message.strip()

    return None


# ── Multi-turn alert conversation ────────────────────────────────────────────

def handle_alert_flow(
    message: str,
    caregiver_id: str,
    caregiver_name: str,
    patient_id: str,
    patient_name: str,
) -> Tuple[Optional[str], bool]:
    """
    Process alert intent within the chat flow.

    Returns:
        (response_text, is_complete)
        - response_text: AMINA's response if this is an alert flow turn (None if not)
        - is_complete: True if alert was sent, False if still gathering info

    Flow:
      Turn 1: Caregiver says "send alert" → AMINA asks for severity + message
      Turn 2: Caregiver provides details → AMINA sends alert, confirms
    """
    pending = _get_pending(caregiver_id, patient_id)

    # ── Check if we're mid-flow (Turn 2+) ────────────────────────────────────
    if pending:
        return _handle_alert_followup(
            message, caregiver_id, caregiver_name, patient_id, patient_name, pending,
        )

    # ── Check if this is a new alert intent (Turn 1) ─────────────────────────
    if not detect_alert_intent(message):
        return None, False

    # Check if severity and message are already in the initial message
    severity = _extract_severity(message)
    inline_msg = _try_extract_inline_alert(message)

    if severity and inline_msg:
        # Everything provided in one shot — send immediately
        return _send_alert(
            caregiver_id, caregiver_name, patient_id, patient_name,
            severity, inline_msg,
        )

    # Start the alert flow — ask for details
    _set_pending(caregiver_id, patient_id, {
        "stage": "awaiting_details",
        "severity": severity,  # may be None
        "message": inline_msg,  # may be None
    })

    if severity and not inline_msg:
        response = (
            f"I'll send a **{severity}** alert to {patient_name}. "
            f"What message would you like to include in the alert?"
        )
    elif inline_msg and not severity:
        response = (
            f"I'll send an alert to {patient_name}. "
            f"What severity level should I use?\n\n"
            f"• **Emergency** — immediate attention needed\n"
            f"• **Warning** — important but not urgent\n"
            f"• **Info** — general reminder or check-in"
        )
    else:
        response = (
            f"I can send an alert to **{patient_name}**. Please provide:\n\n"
            f"1. **Severity**: Emergency, Warning, or Info\n"
            f"2. **Message**: What should the alert say?\n\n"
            f"For example: *\"Warning — Please take your evening medication, "
            f"your blood pressure was high today.\"*"
        )

    return response, False


def _try_extract_inline_alert(message: str) -> Optional[str]:
    """Extract alert message from the initial intent message if present."""
    lower = message.lower()

    # Patterns like "send alert: take your medication"
    for sep in [":", "—", "-", "saying", "that says"]:
        if sep in lower:
            idx = lower.index(sep)
            after = message[idx + len(sep):].strip().strip('"').strip("'")
            # Only use if it's substantial content (not just "to patient" etc.)
            if len(after) > 15 and not any(w in after.lower() for w in ["patient", "them"]):
                return after

    return None


def _handle_alert_followup(
    message: str,
    caregiver_id: str,
    caregiver_name: str,
    patient_id: str,
    patient_name: str,
    pending: Dict,
) -> Tuple[Optional[str], bool]:
    """Handle Turn 2+ of the alert flow."""
    lower = message.lower().strip()

    # Allow cancellation
    if lower in ("cancel", "nevermind", "never mind", "no", "stop", "forget it"):
        _clear_pending(caregiver_id, patient_id)
        return "Alert cancelled. How else can I help you?", True

    severity = pending.get("severity") or _extract_severity(message)
    alert_msg = pending.get("message") or _extract_alert_message(message)

    # If caregiver gave both severity and message in this turn
    if not pending.get("severity") and not pending.get("message"):
        # Try to parse the whole message
        sev_from_msg = _extract_severity(message)
        msg_from_msg = _extract_alert_message(message)
        if sev_from_msg:
            severity = sev_from_msg
        if msg_from_msg:
            alert_msg = msg_from_msg

    # Still need severity
    if not severity and alert_msg:
        _set_pending(caregiver_id, patient_id, {
            "stage": "awaiting_severity",
            "severity": None,
            "message": alert_msg,
        })
        return (
            f"Got it. What severity level?\n\n"
            f"• **Emergency** — immediate attention\n"
            f"• **Warning** — important concern\n"
            f"• **Info** — general reminder"
        ), False

    # Still need message
    if severity and not alert_msg:
        # The whole message might BE the alert content
        if len(message.strip()) > 10:
            alert_msg = message.strip()
        else:
            _set_pending(caregiver_id, patient_id, {
                "stage": "awaiting_message",
                "severity": severity,
                "message": None,
            })
            return (
                f"What message should I include in the **{severity}** alert to {patient_name}?"
            ), False

    # Default severity if we somehow still don't have it
    if not severity:
        severity = "info"
    if not alert_msg:
        alert_msg = message.strip()

    return _send_alert(
        caregiver_id, caregiver_name, patient_id, patient_name,
        severity, alert_msg,
    )


def _send_alert(
    caregiver_id: str,
    caregiver_name: str,
    patient_id: str,
    patient_name: str,
    severity: str,
    alert_message: str,
) -> Tuple[str, bool]:
    """Actually send the alert and return confirmation."""
    from src.services.patient_alert_service import send_patient_alert

    # Resolve Telegram chat_id for the patient
    telegram_chat_id = None
    try:
        from src.utils.arcade_client import command_sql, extract_rows
        resp = command_sql(
            "SELECT telegram_chat_id FROM PatientVertex WHERE id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = extract_rows(resp)
        if rows and rows[0].get("telegram_chat_id"):
            telegram_chat_id = rows[0]["telegram_chat_id"]
    except Exception as e:
        logger.warning(f"alert_chat: telegram_chat_id lookup failed: {e}")

    try:
        result = send_patient_alert(
            patient_id=patient_id,
            caregiver_name=caregiver_name,
            message=alert_message,
            severity=severity,
            telegram_chat_id=telegram_chat_id,
        )

        _clear_pending(caregiver_id, patient_id)

        # Build confirmation
        severity_emoji = {"emergency": "\U0001f6a8", "warning": "\u26a0\ufe0f", "info": "\U0001f499"}
        emoji = severity_emoji.get(severity, "\u2705")
        tg_note = ""
        if result.get("telegram_sent"):
            tg_note = " and via **Telegram**"

        response = (
            f"\u2705 **Alert sent successfully!**\n\n"
            f"**To:** {patient_name}\n"
            f"**Severity:** {severity.capitalize()}\n"
            f"**Message:** {alert_message}\n"
            f"**Delivered:** In-app notification{tg_note}\n\n"
            f"The patient will see this alert in their notifications. "
            f"Is there anything else I can help you with?"
        )
        return response, True

    except Exception as e:
        logger.error(f"alert_chat: send_patient_alert failed: {e}")
        _clear_pending(caregiver_id, patient_id)
        return (
            f"I wasn't able to send the alert due to a technical issue. "
            f"Please try again or use the alert panel directly. Error: {str(e)[:100]}"
        ), True
