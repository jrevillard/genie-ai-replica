"""
AMINA v2.0 — #8 Proactive Health Nudges

Scheduled SMS/WhatsApp reminders based on patient care plan and behavior.

Examples:
  - "Fatou, time to check your BP. Last reading was 145/90."
  - "Lamin, have you taken your amlodipine today? Remember: same time as Maghrib."
  - "Omar, your 3-month BP check is due this week. Visit your health post."

Architecture:
  - Nudge templates per condition/action
  - Schedule computed from: care plan, last vital reading, medication frequency
  - Stored in Redis as scheduled jobs (checked by a poll loop or cron)
  - Sent via: SMS (TextBelt/Twilio), WhatsApp (future), push notification (future)

Does NOT depend on Docker cron — uses Redis sorted sets with timestamps.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


# ── Nudge templates (Gambian-contextualized) ──

NUDGE_TEMPLATES = {
    "bp_check": {
        "message": "Salaam aleikum, {name}. It is time to check your blood pressure. Your last reading was {last_bp}. Visit your health post or ask your CHW.",
        "interval_days": 30,
        "conditions": ["hypertension"],
    },
    "glucose_check": {
        "message": "Salaam aleikum, {name}. Please check your blood sugar this week. Your last reading was {last_glucose}. Keeping track helps you and your doctor.",
        "interval_days": 14,
        "conditions": ["diabetes"],
    },
    "medication_reminder": {
        "message": "Salaam aleikum, {name}. Have you taken your {medication} today? Remember to take it {frequency}. Your health depends on it.",
        "interval_days": 1,
        "conditions": [],  # all patients with medications
    },
    "diet_nudge": {
        "message": "Salaam aleikum, {name}. Today's tip: {tip}. Small changes make a big difference for your {condition}.",
        "interval_days": 7,
        "conditions": ["diabetes", "hypertension"],
    },
    "exercise_nudge": {
        "message": "Salaam aleikum, {name}. Have you walked 30 minutes today? Even a walk to the market counts. Your heart will thank you.",
        "interval_days": 3,
        "conditions": ["hypertension", "diabetes"],
    },
    "followup_reminder": {
        "message": "Salaam aleikum, {name}. Your follow-up with Amina is due. How are you feeling? Reply to this message or open the app.",
        "interval_days": 14,
        "conditions": [],
    },
    "ramadan_reminder": {
        "message": "Salaam aleikum, {name}. Ramadan reminder: take your {medication} at Iftar tonight. Check your sugar before Suhoor. Break your fast if sugar drops below 70.",
        "interval_days": 1,
        "conditions": ["diabetes"],
    },
}

DIET_TIPS = [
    "try half a Maggi cube instead of full — your family will not taste the difference",
    "add moringa leaves to your stew today — it is free and full of nutrients",
    "drink bissap (hibiscus) without sugar — it helps blood pressure",
    "swap half the rice in your benachin for vegetables",
    "try chere (millet porridge) for breakfast instead of white bread",
    "eat a banana and an orange today — fruits protect your heart",
    "cook with less palm oil today — try groundnut oil instead",
    "drink bouye (baobab juice) without sugar — full of vitamins",
]


def compute_nudges_for_patient(
    patient: Dict[str, Any],
    redis_client,
) -> List[Dict[str, Any]]:
    """Compute which nudges are due for a patient.

    Checks last nudge sent time and schedules next ones.
    Returns list of nudge dicts ready to send.
    """
    patient_id = patient.get("id", "")
    name = (patient.get("name") or "").split()[0] or "friend"
    conditions = patient.get("conditions", [])
    medications = patient.get("medications", [])
    if isinstance(conditions, str):
        try: conditions = json.loads(conditions)
        except: conditions = []
    if isinstance(medications, str):
        try: medications = json.loads(medications)
        except: medications = []

    due_nudges = []
    now = datetime.now()

    for nudge_type, template in NUDGE_TEMPLATES.items():
        # Check if this nudge applies to this patient's conditions
        if template["conditions"]:
            if not any(c in conditions for c in template["conditions"]):
                continue

        # Medication reminder only for patients with medications
        if nudge_type == "medication_reminder" and not medications:
            continue

        # Check last sent time
        last_key = f"nudge_last:{patient_id}:{nudge_type}"
        last_sent = redis_client.get(last_key)
        if last_sent:
            try:
                last_dt = datetime.fromisoformat(last_sent)
                if (now - last_dt).days < template["interval_days"]:
                    continue  # Not due yet
            except Exception:
                pass

        # Build the nudge message
        msg = template["message"]
        msg = msg.replace("{name}", name)
        msg = msg.replace("{last_bp}", patient.get("last_bp") or "not recorded")
        msg = msg.replace("{last_glucose}", patient.get("last_glucose") or "not recorded")

        if "{medication}" in msg and medications:
            med = medications[0]
            med_name = med.get("name", med) if isinstance(med, dict) else str(med)
            med_freq = med.get("frequency", "as prescribed") if isinstance(med, dict) else "as prescribed"
            msg = msg.replace("{medication}", med_name)
            msg = msg.replace("{frequency}", med_freq)

        if "{tip}" in msg:
            import random
            tip = random.choice(DIET_TIPS)
            msg = msg.replace("{tip}", tip)

        if "{condition}" in msg:
            msg = msg.replace("{condition}", conditions[0] if conditions else "health")

        due_nudges.append({
            "type": nudge_type,
            "patient_id": patient_id,
            "phone": patient.get("phone", ""),
            "message": msg,
            "channel": "sms",  # sms | whatsapp | push
        })

    return due_nudges


def mark_nudge_sent(redis_client, patient_id: str, nudge_type: str):
    """Record that a nudge was sent so it's not repeated too soon."""
    key = f"nudge_last:{patient_id}:{nudge_type}"
    redis_client.setex(key, 365 * 86400, datetime.now().isoformat())


async def send_nudge(nudge: Dict, redis_client) -> bool:
    """Send a nudge via SMS (or other channel in future)."""
    phone = nudge.get("phone", "")
    message = nudge.get("message", "")
    if not phone or not message:
        return False

    from src.services.otp import _send_sms
    sent, method = _send_sms(f"+{phone}" if not phone.startswith("+") else phone, message)

    if sent:
        mark_nudge_sent(redis_client, nudge["patient_id"], nudge["type"])
        logger.info(f"Nudge sent to {nudge['patient_id']}: {nudge['type']} via {method}")
    else:
        logger.warning(f"Nudge failed for {nudge['patient_id']}: {nudge['type']}")

    return sent


async def process_all_nudges(redis_client) -> Dict[str, int]:
    """Process nudges for ALL patients. Called by admin/scheduled job.

    Returns: {sent: N, skipped: N, failed: N}
    """
    from src.utils.arcade_client import async_command_sql, extract_rows

    stats = {"sent": 0, "skipped": 0, "failed": 0}

    try:
        resp = await async_command_sql(
            "SELECT id, name, phone, conditions, medications, last_bp, last_glucose "
            "FROM PatientVertex WHERE phone != '' LIMIT 500",
            [],
        )
        patients = extract_rows(resp)

        for p in patients:
            for f in ("conditions", "medications"):
                v = p.get(f, "[]")
                if isinstance(v, str):
                    try: p[f] = json.loads(v)
                    except: p[f] = []

            nudges = compute_nudges_for_patient(p, redis_client)
            for nudge in nudges:
                sent = await send_nudge(nudge, redis_client)
                if sent:
                    stats["sent"] += 1
                else:
                    stats["failed"] += 1

    except Exception as e:
        logger.error(f"Nudge processing failed: {e}")

    logger.info(f"Nudge processing complete: {stats}")
    return stats
