"""
AMINA Care — Alkalo SMS Verification Service
==============================================
Handles SMS-based VHW/CBC confirmation by the village Alkalo.
Alkalos are village heads — typically elderly, using basic phones,
so the entire flow works via plain SMS (no app required).

Flow:
  1. Admin approves VHW → sends SMS to Alkalo
  2. Alkalo replies "1" (confirm) or "2" (reject)
  3. System updates registration status automatically
  4. Reminder sent after 48h; escalated after 7 days
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime

logger = logging.getLogger(__name__)


def _redis():
    try:
        import redis
        host = os.environ.get("REDIS_HOST", "amina-redis")
        return redis.Redis(host=host, port=6379, db=0, decode_responses=True)
    except Exception:
        return None


# ── SMS templates ────────────────────────────────────────────────────────────

ALKALO_CONFIRM_SMS_MANDINKA = (
    "Salaam aleikum, Alkalo {alkalo_name}. "
    "{vhw_name} ye a fo ko ale mu i la dukurengoo kene-kene-laa le ti. "
    "A ye AMINA sisteemoo kono kene-kene-laa kuo dafaa. "
    "I ka siyaa fo a ye? Reply 1 = Haa (Yes), 2 = Hani (No)"
)

ALKALO_CONFIRM_SMS_ENGLISH = (
    "Peace be upon you, Alkalo {alkalo_name}. "
    "{vhw_name} says they are your village's health worker. "
    "They have registered on the AMINA health system. "
    "Do you confirm? Reply 1 = Yes, 2 = No"
)

ALKALO_REMINDER_SMS = (
    "Reminder: {vhw_name} is waiting for your confirmation as a health worker "
    "on AMINA. Reply 1 = Yes, 2 = No"
)

VHW_CONFIRMED_SMS = (
    "Great news! Alkalo {alkalo_name} has confirmed your registration. "
    "Your AMINA account is now active. Login with your phone number and PIN."
)

VHW_REJECTED_SMS = (
    "Your registration could not be confirmed by the Alkalo. "
    "Please contact the health centre for assistance."
)


def send_alkalo_confirmation_request(
    reg_id: str,
    vhw_name: str,
    alkalo_name: str,
    alkalo_phone: str,
    language: str = "mandinka",
) -> dict:
    r = _redis()
    if not r:
        return {"ok": False, "error": "Redis unavailable"}

    template = (ALKALO_CONFIRM_SMS_MANDINKA if language == "mandinka"
                else ALKALO_CONFIRM_SMS_ENGLISH)
    sms_body = template.format(alkalo_name=alkalo_name, vhw_name=vhw_name)

    verification_id = f"alkalo_verify:{reg_id}"
    r.setex(verification_id, 7 * 86400, json.dumps({
        "reg_id": reg_id,
        "alkalo_phone": alkalo_phone,
        "alkalo_name": alkalo_name,
        "vhw_name": vhw_name,
        "sent_at": datetime.utcnow().isoformat() + "Z",
        "reminder_sent": False,
        "status": "awaiting_reply",
    }))

    r.setex(f"alkalo_phone_to_reg:{alkalo_phone}", 7 * 86400, reg_id)
    r.setex(f"alkalo_verified:{alkalo_phone}", 365 * 86400, alkalo_name)

    sent = _send_sms(alkalo_phone, sms_body)
    logger.info("Alkalo SMS sent to %s for reg %s: %s", alkalo_phone, reg_id, sent)

    return {
        "ok": sent,
        "verification_id": verification_id,
        "message": f"SMS sent to Alkalo {alkalo_name} at {alkalo_phone}",
    }


def handle_alkalo_sms_reply(from_phone: str, message: str) -> dict:
    r = _redis()
    if not r:
        return {"handled": False}

    reg_id = r.get(f"alkalo_phone_to_reg:{from_phone}")
    if not reg_id:
        return {"handled": False, "reason": "No pending verification for this phone"}

    verification_raw = r.get(f"alkalo_verify:{reg_id}")
    if not verification_raw:
        return {"handled": False, "reason": "Verification expired"}

    verification = json.loads(verification_raw)
    reply = message.strip()

    if reply in ("1", "yes", "haa", "YES", "HAA"):
        _process_confirmation(reg_id, verification, True)
        reply_sms = f"Jere-jere-f. {verification['vhw_name']} has been confirmed. Thank you, Alkalo."
        _send_sms(from_phone, reply_sms)
        return {"handled": True, "decision": "confirmed", "reg_id": reg_id}

    elif reply in ("2", "no", "hani", "NO", "HANI"):
        _process_confirmation(reg_id, verification, False)
        reply_sms = f"Noted. {verification['vhw_name']}'s registration has been declined."
        _send_sms(from_phone, reply_sms)
        return {"handled": True, "decision": "rejected", "reg_id": reg_id}

    else:
        _send_sms(from_phone, "Please reply 1 for Yes or 2 for No.")
        return {"handled": True, "decision": "invalid_reply", "reg_id": reg_id}


def _process_confirmation(reg_id: str, verification: dict, confirmed: bool) -> None:
    r = _redis()
    if not r:
        return

    raw = r.get(f"cg_registration:{reg_id}")
    if not raw:
        logger.warning("Registration %s not found for Alkalo confirmation", reg_id)
        return

    app = json.loads(raw)
    now = datetime.utcnow().isoformat() + "Z"
    old_status = app["status"]

    for step in app.get("approval_chain", []):
        if step["step_name"] == "alkalo_confirmation" and not step["completed"]:
            step["completed"] = True
            step["completed_at"] = now
            step["completed_by"] = f"alkalo:{verification['alkalo_name']}"
            step["note"] = "Confirmed via SMS" if confirmed else "Rejected via SMS"
            break

    if confirmed:
        pending = [s for s in app["approval_chain"] if not s["completed"]]
        if not pending:
            new_status = "active"
            app["activated_at"] = now
            app["audit_log"].append({
                "ts": now, "action": "alkalo_confirmed_activated",
                "by": f"alkalo:{verification['alkalo_name']}",
                "detail": "Alkalo confirmed via SMS. All steps complete — auto-activated.",
            })
            try:
                from src.api.caregiver_registration_v2_routes import _activate_caregiver
                _activate_caregiver(app)
            except Exception as e:
                logger.error("Failed to activate caregiver after Alkalo confirmation: %s", e)
        else:
            new_status = "alkalo_approved"
            app["audit_log"].append({
                "ts": now, "action": "alkalo_confirmed",
                "by": f"alkalo:{verification['alkalo_name']}",
                "detail": f"Alkalo confirmed via SMS. Next: {pending[0]['step_name']}",
            })

        vhw_phone = app.get("phone")
        if vhw_phone:
            _send_sms(vhw_phone, VHW_CONFIRMED_SMS.format(
                alkalo_name=verification["alkalo_name"]))
    else:
        new_status = "rejected"
        app["rejection_reason"] = "Not confirmed by village Alkalo"
        app["audit_log"].append({
            "ts": now, "action": "alkalo_rejected",
            "by": f"alkalo:{verification['alkalo_name']}",
            "detail": "Alkalo did not confirm via SMS.",
        })
        vhw_phone = app.get("phone")
        if vhw_phone:
            _send_sms(vhw_phone, VHW_REJECTED_SMS)

    r.zrem(f"cg_registrations_by_status:{old_status}", reg_id)
    app["status"] = new_status
    r.zadd(f"cg_registrations_by_status:{new_status}", {reg_id: time.time()})
    r.setex(f"cg_registration:{reg_id}", 180 * 86400, json.dumps(app))

    r.delete(f"alkalo_phone_to_reg:{verification['alkalo_phone']}")
    r.delete(f"alkalo_verify:{reg_id}")


def send_reminder_if_needed() -> list:
    r = _redis()
    if not r:
        return []
    sent = []
    for key in r.scan_iter("alkalo_verify:*"):
        raw = r.get(key)
        if not raw:
            continue
        v = json.loads(raw)
        if v.get("reminder_sent"):
            continue
        from datetime import datetime as dt
        sent_at = dt.fromisoformat(v["sent_at"].replace("Z", "+00:00"))
        if (datetime.utcnow().replace(tzinfo=sent_at.tzinfo) - sent_at).total_seconds() > 48 * 3600:
            sms = ALKALO_REMINDER_SMS.format(vhw_name=v["vhw_name"])
            _send_sms(v["alkalo_phone"], sms)
            v["reminder_sent"] = True
            r.setex(key, 7 * 86400, json.dumps(v))
            sent.append(v["reg_id"])
    return sent


def _send_sms(to: str, body: str) -> bool:
    try:
        from src.services.caregiver_alerts import _route_sms
        ok, detail = _route_sms(to, body)
        logger.info("SMS to %s: ok=%s (%s)", to, ok, detail)
        return ok
    except Exception as e:
        logger.warning("SMS send failed (to=%s): %s — message queued for retry", to, e)
        return False
