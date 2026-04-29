"""
Medication Audit Logger — every medication-related query is logged
for safety review, regardless of whether it was blocked or allowed.
"""

from typing import Optional
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)


async def log_medication_query(
    redis_client,
    session_id: str,
    query_text: str,
    detected_intent: str,
    action_taken: str,
    response_given: str,
    vhw_alerted: bool = False,
    facility_referred: Optional[str] = None,
):
    """Append a medication query to the audit log in Redis.

    Key: medication_audit:{session_id}
    Also appends to the global recent-audit stream.
    """
    entry = {
        "timestamp": datetime.now().isoformat(),
        "session_id": session_id,
        "query": query_text[:500],
        "intent": detected_intent,
        "action": action_taken,
        "response": response_given[:300],
        "vhw_alerted": vhw_alerted,
        "facility_referred": facility_referred,
    }
    try:
        # Per-session log
        key = f"medication_audit:{session_id}"
        redis_client.lpush(key, json.dumps(entry, default=str))
        redis_client.ltrim(key, 0, 99)  # cap at 100 per session
        redis_client.expire(key, 90 * 86400)  # 90 day retention

        # Global recent stream
        redis_client.lpush("medication_audit:recent", json.dumps(entry, default=str))
        redis_client.ltrim("medication_audit:recent", 0, 999)
    except Exception as e:
        logger.warning(f"Medication audit log failed: {e}")
