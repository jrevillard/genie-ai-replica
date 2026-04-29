"""
VHW Referral Service — Warm handoff from Village Health Worker to AMINA.

When a VHW introduces a patient to AMINA, the referral is stored in Redis.
On the patient's first call, AMINA opens with the VHW's endorsement instead
of a cold introduction.

TTL: 30 days — referrals expire if not consumed.

Performance: single Redis GET on first call, ~2ms.
"""

from typing import Dict, Any, Optional
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)


REFERRAL_TTL_DAYS = 30


def _referral_key(session_id: str) -> str:
    return f"referral:{session_id}"


def _referral_key_by_phone(phone: str) -> str:
    # Phones are the canonical patient ID for rural users
    clean = (phone or "").replace(" ", "").replace("+", "").replace("-", "")
    return f"referral:phone:{clean}"


class ReferralStore:
    def __init__(self, redis_client):
        self.redis = redis_client

    async def create_referral(
        self,
        vhw_name: str,
        vhw_id: str,
        patient_phone: Optional[str] = None,
        patient_name: Optional[str] = None,
        session_id: Optional[str] = None,
        reason: Optional[str] = None,
        village: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a referral. Keyed by phone OR session_id (whichever is provided)."""
        if not (patient_phone or session_id):
            return {"error": "patient_phone or session_id required"}

        referral = {
            "vhw_name": vhw_name,
            "vhw_id": vhw_id,
            "patient_phone": patient_phone,
            "patient_name": patient_name,
            "reason": reason or "follow-up care",
            "village": village,
            "created_at": datetime.now().isoformat(),
            "consumed": False,
        }
        ttl = REFERRAL_TTL_DAYS * 86400
        try:
            if patient_phone:
                self.redis.setex(_referral_key_by_phone(patient_phone), ttl, json.dumps(referral))
            if session_id:
                self.redis.setex(_referral_key(session_id), ttl, json.dumps(referral))
        except Exception as e:
            logger.error(f"Failed to store referral: {e}")
            return {"error": str(e)}
        return {"ok": True, "referral": referral}

    async def get_referral(
        self, session_id: str, phone: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Look up a referral by session_id or phone. Returns None if not found."""
        try:
            # Try session_id first
            raw = self.redis.get(_referral_key(session_id))
            if not raw and phone:
                raw = self.redis.get(_referral_key_by_phone(phone))
            if not raw:
                return None
            return json.loads(raw)
        except Exception as e:
            logger.warning(f"Failed to load referral: {e}")
            return None

    async def consume_referral(
        self, session_id: str, phone: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Mark a referral as consumed (used once). Returns the referral."""
        referral = await self.get_referral(session_id, phone)
        if not referral or referral.get("consumed"):
            return referral
        referral["consumed"] = True
        referral["consumed_at"] = datetime.now().isoformat()
        ttl = REFERRAL_TTL_DAYS * 86400
        try:
            self.redis.setex(_referral_key(session_id), ttl, json.dumps(referral))
            if phone:
                self.redis.setex(_referral_key_by_phone(phone), ttl, json.dumps(referral))
        except Exception:
            pass
        return referral


def build_vhw_greeting_line(referral: Dict[str, Any]) -> str:
    """Build the VHW-endorsement opener. Zero LLM."""
    vhw = referral.get("vhw_name", "your CHW")
    reason = referral.get("reason", "your health")
    return f"Your health worker {vhw} told me about you. She cares about you very much and asked me to help with {reason}."
