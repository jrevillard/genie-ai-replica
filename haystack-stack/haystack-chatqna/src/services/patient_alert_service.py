"""
Patient Alert Service
======================
Handles caregiver → patient alerts:
  - Redis queue for in-app notifications (polled by patient frontend)
  - Telegram push for warning/emergency severity
  - Alert rule storage and processing (automated alerts)
"""

import json
import uuid
import logging
import requests
from datetime import datetime, timedelta
from typing import Optional, List

import redis as _redis_lib

from src.config import settings

logger = logging.getLogger(__name__)

# ── Redis keys ────────────────────────────────────────────────────────────────

def _alert_queue_key(patient_id: str) -> str:
    return f"patient_alerts:{patient_id}"

def _rules_key(caregiver_id: str) -> str:
    return f"cg_alert_rules:{caregiver_id}"

def _link_code_key(code: str) -> str:
    return f"tg_link_code:{code}"


def _redis():
    return _redis_lib.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        decode_responses=True,
    )


# ── Telegram helpers ──────────────────────────────────────────────────────────

def _tg_send(chat_id: str, text: str, parse_mode: str = "Markdown") -> bool:
    token = getattr(settings, "TELEGRAM_BOT_TOKEN", "")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram alert skipped")
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": parse_mode},
            timeout=10,
        )
        return r.status_code == 200
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
        return False


def send_telegram_emergency(chat_id: str, caregiver_name: str, message: str) -> bool:
    text = (
        f"🚨 *EMERGENCY ALERT*\n"
        f"From your caregiver: *{caregiver_name}*\n\n"
        f"{message}\n\n"
        f"⚕️ _Please respond immediately or contact emergency services._"
    )
    return _tg_send(chat_id, text)


def send_telegram_warning(chat_id: str, caregiver_name: str, message: str) -> bool:
    text = f"⚠️ *Health Alert* from {caregiver_name}:\n\n{message}"
    return _tg_send(chat_id, text)


def send_telegram_info(chat_id: str, caregiver_name: str, message: str) -> bool:
    text = f"💙 Reminder from your caregiver *{caregiver_name}*:\n\n{message}"
    return _tg_send(chat_id, text)


# ── Telegram link code ────────────────────────────────────────────────────────

def generate_link_code(patient_id: str) -> str:
    """Generate a 6-char alphanumeric code for the patient to send to the bot."""
    code = uuid.uuid4().hex[:6].upper()
    r = _redis()
    r.setex(_link_code_key(code), 600, patient_id)   # 10 min TTL
    return code


def verify_link_code(code: str) -> Optional[str]:
    """Returns patient_id if code is valid and unused, else None."""
    r = _redis()
    patient_id = r.get(_link_code_key(code.upper()))
    if patient_id:
        r.delete(_link_code_key(code.upper()))
    return patient_id


# ── Manual alert ──────────────────────────────────────────────────────────────

def send_patient_alert(
    patient_id: str,
    caregiver_name: str,
    message: str,
    severity: str = "info",           # info | warning | emergency
    telegram_chat_id: Optional[str] = None,
) -> dict:
    """Push alert to patient's Redis queue + inbox + optionally Telegram.

    Three sinks, intentionally:
      * Redis queue  — drives the live top-banner toast / emergency overlay
                       in the patient SPA. Polled every 10 s with clear=false
                       and drained on dismiss via /alerts/read.
      * Inbox item   — durable record. Survives toast dismissal, refreshes,
                       and tab switches. Visible in the inbox bell.
      * Telegram     — out-of-band push if the patient has linked a chat_id.

    Inbox failures are swallowed (logged) — an inbox-schema hiccup must
    never block the live alert from reaching the patient.
    """
    alert = {
        "alert_id":       f"PA_{uuid.uuid4().hex[:8].upper()}",
        "from_caregiver": caregiver_name,
        "message":        message,
        "severity":       severity,
        "sent_at":        datetime.now().isoformat(),
        "read":           False,
    }

    r = _redis()
    key = _alert_queue_key(patient_id)
    r.lpush(key, json.dumps(alert))
    r.ltrim(key, 0, 49)          # keep last 50
    r.expire(key, 86400 * 7)     # 7-day TTL

    # Inbox sink — persistent record viewable from the bell.
    try:
        from src.services import inbox_service as _inbox

        title_prefix = {"emergency": "Emergency",
                        "warning":   "Health alert",
                        "info":      "Message"}.get(severity, "Message")
        _inbox.create_item(
            patient_id=patient_id,
            kind="caregiver_ping",
            title=f"{title_prefix} from {caregiver_name}",
            body=message,
            severity=severity,
            source="caregiver",
            source_id=f"alert:{alert['alert_id']}",
            metadata={"alert_id": alert["alert_id"],
                      "from_caregiver": caregiver_name,
                      "sent_at": alert["sent_at"]},
        )
        alert["inbox_persisted"] = True
    except Exception as exc:
        # Best-effort. The toast still fires from redis.
        import logging
        logging.getLogger(__name__).warning(
            "patient_alert_service: inbox push failed for %s: %s",
            patient_id, exc,
        )
        alert["inbox_persisted"] = False

    # Telegram push
    tg_ok = False
    if telegram_chat_id:
        if severity == "emergency":
            tg_ok = send_telegram_emergency(telegram_chat_id, caregiver_name, message)
        elif severity == "warning":
            tg_ok = send_telegram_warning(telegram_chat_id, caregiver_name, message)
        else:
            tg_ok = send_telegram_info(telegram_chat_id, caregiver_name, message)

    alert["telegram_sent"] = tg_ok
    return alert


# ── Patient poll ──────────────────────────────────────────────────────────────

def get_pending_alerts(patient_id: str, clear: bool = False) -> List[dict]:
    """Fetch all pending alerts for a patient. Optionally clear."""
    r = _redis()
    key = _alert_queue_key(patient_id)
    raw = r.lrange(key, 0, -1)
    alerts = []
    for item in raw:
        try:
            alerts.append(json.loads(item))
        except Exception:
            pass
    if clear:
        r.delete(key)
    return alerts


def mark_alerts_read(patient_id: str):
    """Mark all alerts as read (clear queue)."""
    _redis().delete(_alert_queue_key(patient_id))


# ── Alert rules (automated) ───────────────────────────────────────────────────

def _next_fire(frequency: str, send_time: Optional[str], interval_hours: Optional[int]) -> str:
    now = datetime.now()
    if frequency == "daily" and send_time:
        h, m = map(int, send_time.split(":"))
        candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate.isoformat()
    elif frequency == "hourly":
        return (now + timedelta(hours=interval_hours or 1)).isoformat()
    elif frequency == "weekly" and send_time:
        h, m = map(int, send_time.split(":"))
        candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(weeks=1)
        return candidate.isoformat()
    else:
        return (now + timedelta(hours=interval_hours or 24)).isoformat()


def create_alert_rule(
    caregiver_id: str,
    patient_id: str,
    label: str,
    message: str,
    severity: str,
    frequency: str,          # daily | weekly | hourly
    send_time: Optional[str] = "09:00",
    interval_hours: Optional[int] = None,
) -> dict:
    rule = {
        "rule_id":       f"R_{uuid.uuid4().hex[:8].upper()}",
        "caregiver_id":  caregiver_id,
        "patient_id":    patient_id,
        "label":         label,
        "message":       message,
        "severity":      severity,
        "frequency":     frequency,
        "send_time":     send_time,
        "interval_hours": interval_hours,
        "active":        True,
        "created_at":    datetime.now().isoformat(),
        "next_fire_at":  _next_fire(frequency, send_time, interval_hours),
        "fire_count":    0,
    }
    r = _redis()
    r.lpush(_rules_key(caregiver_id), json.dumps(rule))
    return rule


def get_alert_rules(caregiver_id: str) -> List[dict]:
    r = _redis()
    raw = r.lrange(_rules_key(caregiver_id), 0, -1)
    rules = []
    for item in raw:
        try:
            rules.append(json.loads(item))
        except Exception:
            pass
    return rules


def delete_alert_rule(caregiver_id: str, rule_id: str) -> bool:
    r = _redis()
    key = _rules_key(caregiver_id)
    raw = r.lrange(key, 0, -1)
    remaining = [item for item in raw
                 if json.loads(item).get("rule_id") != rule_id]
    r.delete(key)
    for item in remaining:
        r.rpush(key, item)
    return len(remaining) < len(raw)


def process_due_rules(caregiver_id: str, caregiver_name: str, telegram_chat_id: Optional[str]):
    """Fire any rules that are past their next_fire_at. Returns count fired."""
    r = _redis()
    key = _rules_key(caregiver_id)
    raw = r.lrange(key, 0, -1)
    now = datetime.now()
    updated = []
    fired = 0

    for item in raw:
        try:
            rule = json.loads(item)
        except Exception:
            continue

        if not rule.get("active"):
            updated.append(item)
            continue

        next_fire = datetime.fromisoformat(rule["next_fire_at"])
        if now >= next_fire:
            # Fire the alert
            send_patient_alert(
                patient_id=rule["patient_id"],
                caregiver_name=caregiver_name,
                message=rule["message"],
                severity=rule["severity"],
                telegram_chat_id=telegram_chat_id,
            )
            rule["fire_count"] = rule.get("fire_count", 0) + 1
            rule["last_fired_at"] = now.isoformat()
            rule["next_fire_at"] = _next_fire(
                rule["frequency"], rule.get("send_time"), rule.get("interval_hours")
            )
            fired += 1

        updated.append(json.dumps(rule))

    r.delete(key)
    for item in updated:
        r.rpush(key, item)

    return fired
