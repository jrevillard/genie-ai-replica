# src/services/direct_chat_service.py
"""
Direct Patient ↔ Caregiver messaging.

Storage: Redis list  key = dchat:{patient_id}:{caregiver_id}
Each entry is a JSON object:
  {
    "id":          str (uuid4),
    "sender_type": "patient" | "caregiver",
    "sender_id":   str,
    "text":        str,
    "ts":          float (unix timestamp),
    "status":      "sent" | "delivered" | "read" | "failed"
  }

Status lifecycle (WhatsApp-style):
  sent      → stored by sender
  delivered → upgraded when recipient fetches messages
  read      → upgraded when recipient explicitly calls mark_read()

TTL: 30 days.  Max messages kept: 200.
"""

import json
import time
import uuid
import logging
from typing import List, Dict, Optional

log = logging.getLogger("direct_chat")

CHAT_TTL    = 60 * 60 * 24 * 30   # 30 days
MAX_MSGS    = 200


def _chat_key(patient_id: str, caregiver_id: str) -> str:
    return f"dchat:{patient_id}:{caregiver_id}"


def _load(redis, patient_id: str, caregiver_id: str) -> List[Dict]:
    key = _chat_key(patient_id, caregiver_id)
    raw = redis.get(key)
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return []


def _save(redis, patient_id: str, caregiver_id: str, messages: List[Dict]):
    # Keep only last MAX_MSGS messages
    if len(messages) > MAX_MSGS:
        messages = messages[-MAX_MSGS:]
    key = _chat_key(patient_id, caregiver_id)
    redis.set(key, json.dumps(messages), ex=CHAT_TTL)


def send_message(
    redis,
    patient_id: str,
    caregiver_id: str,
    sender_type: str,   # "patient" | "caregiver"
    sender_id: str,
    text: str,
) -> Dict:
    """Append a new message. Returns the new message dict."""
    messages = _load(redis, patient_id, caregiver_id)
    msg = {
        "id":          str(uuid.uuid4()),
        "sender_type": sender_type,
        "sender_id":   sender_id,
        "text":        text.strip(),
        "ts":          time.time(),
        "status":      "sent",
    }
    messages.append(msg)
    _save(redis, patient_id, caregiver_id, messages)
    log.info("direct_chat_send %s->%s len=%d", sender_type, sender_id[:8], len(text))
    return msg


def get_messages(
    redis,
    patient_id: str,
    caregiver_id: str,
    recipient_type: str,   # the caller — "patient" | "caregiver"
) -> List[Dict]:
    """
    Fetch conversation.
    Side-effect: all messages from the OTHER party with status='sent' are upgraded to 'delivered'.
    """
    messages = _load(redis, patient_id, caregiver_id)
    other = "caregiver" if recipient_type == "patient" else "patient"
    changed = False
    for msg in messages:
        if msg["sender_type"] == other and msg["status"] == "sent":
            msg["status"] = "delivered"
            changed = True
    if changed:
        _save(redis, patient_id, caregiver_id, messages)
    return messages


def mark_read(
    redis,
    patient_id: str,
    caregiver_id: str,
    reader_type: str,    # "patient" | "caregiver"
) -> int:
    """Mark all delivered messages from the OTHER party as 'read'. Returns count updated."""
    messages = _load(redis, patient_id, caregiver_id)
    other = "caregiver" if reader_type == "patient" else "patient"
    count = 0
    for msg in messages:
        if msg["sender_type"] == other and msg["status"] == "delivered":
            msg["status"] = "read"
            count += 1
    if count:
        _save(redis, patient_id, caregiver_id, messages)
    log.info("direct_chat_read reader=%s count=%d", reader_type, count)
    return count


def unread_count(
    redis,
    patient_id: str,
    caregiver_id: str,
    recipient_type: str,   # "patient" | "caregiver"
) -> int:
    """Count messages from the other side that are not yet read."""
    messages = _load(redis, patient_id, caregiver_id)
    other = "caregiver" if recipient_type == "patient" else "patient"
    return sum(1 for m in messages if m["sender_type"] == other and m["status"] != "read")
