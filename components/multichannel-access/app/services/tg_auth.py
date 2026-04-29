# app/services/tg_auth.py

"""
Telegram Auth State Machine — Redis-backed per chat_id.

State diagram:
  idle ──/login──► await_phone_otp ──phone──► await_otp ──code──► logged_in
  idle ──/pin────► await_phone_pin ──phone──► await_pin ──pin───► logged_in
  logged_in ──/vitals──► await_bp ──bp──► await_glucose ──glucose──► logged_in

Redis key: tg_auth:{chat_id}  (hash)
Fields:
  state       — current state string
  phone       — phone number entered during login
  jwt         — patient JWT after successful login
  patient_id  — patient ArcadeDB id
  name        — patient display name
  language    — "en" | "ma"  (Mandinka)
  session_id  — stable session key for this Telegram user
  vitals_bp   — temp storage during vitals flow

TTL: 10min for intermediate states, 7 days for logged_in.
"""

import logging
from typing import Optional, List, Tuple, Dict

log = logging.getLogger("tg_auth")

# ── State constants ────────────────────────────────────────────────────────────
IDLE            = "idle"
AWAIT_PHONE_OTP = "await_phone_otp"
AWAIT_OTP       = "await_otp"
AWAIT_PHONE_PIN = "await_phone_pin"
AWAIT_PIN       = "await_pin"
LOGGED_IN       = "logged_in"
AWAIT_BP        = "await_bp"
AWAIT_GLUCOSE   = "await_glucose"

# Tier 3 — Caregiver auth states
AWAIT_CG_PHONE     = "await_cg_phone"
AWAIT_CG_PIN       = "await_cg_pin"
CG_LOGGED_IN       = "cg_logged_in"
AWAIT_CG_ALERT_MSG = "await_cg_alert_msg"

# Tier 3 — VHW referral flow states
AWAIT_REFER_NAME   = "await_refer_name"
AWAIT_REFER_REASON = "await_refer_reason"
AWAIT_REFER_PHONE  = "await_refer_phone"

INTERMEDIATE_TTL = 600      # 10 minutes — incomplete login flows expire
LOGGED_IN_TTL    = 604800   # 7 days
CG_LOGGED_IN_TTL = 43200    # 12 hours — caregivers log out more often
LOGGED_IN_CHAT_SET = "tg_logged_in_chats"


class TgAuthStore:
    """
    Manages per-user Telegram authentication state in Redis.
    Constructed with a live redis.asyncio client (from SessionStore._redis).
    """

    def __init__(self, redis):
        self._r = redis

    def _key(self, chat_id: int) -> str:
        return f"tg_auth:{chat_id}"

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get(self, chat_id: int) -> Dict:
        data = await self._r.hgetall(self._key(chat_id))
        return data or {}

    async def get_state(self, chat_id: int) -> str:
        val = await self._r.hget(self._key(chat_id), "state")
        return val or IDLE

    async def is_logged_in(self, chat_id: int) -> bool:
        return await self.get_state(chat_id) == LOGGED_IN

    async def get_language(self, chat_id: int) -> str:
        val = await self._r.hget(self._key(chat_id), "language")
        return val or "en"

    # ── Write ─────────────────────────────────────────────────────────────────

    async def set_state(self, chat_id: int, state: str, extra: Dict = None,
                        ttl: int = INTERMEDIATE_TTL):
        key = self._key(chat_id)
        await self._r.hset(key, "state", state)
        if extra:
            await self._r.hset(key, mapping=extra)
        await self._r.expire(key, ttl)

    async def set_logged_in(self, chat_id: int, jwt: str, patient_id: str,
                            name: str, phone: str):
        key = self._key(chat_id)
        session_id = f"tg_{chat_id}"
        await self._r.hset(key, mapping={
            "state":      LOGGED_IN,
            "jwt":        jwt,
            "patient_id": patient_id,
            "name":       name,
            "phone":      phone,
            "language":   "en",
            "session_id": session_id,
        })
        await self._r.expire(key, LOGGED_IN_TTL)
        # Register for nudge scheduler
        await self._r.sadd(LOGGED_IN_CHAT_SET, str(chat_id))
        log.info("auth_login chat_id=%d patient=%s", chat_id, patient_id)

    async def set_language(self, chat_id: int, lang: str):
        key = self._key(chat_id)
        await self._r.hset(key, "language", lang)
        await self._r.expire(key, LOGGED_IN_TTL)

    async def clear(self, chat_id: int):
        await self._r.delete(self._key(chat_id))
        await self._r.srem(LOGGED_IN_CHAT_SET, str(chat_id))
        log.info("auth_logout chat_id=%d", chat_id)

    # ── Caregiver auth ────────────────────────────────────────────────────────

    async def set_cg_logged_in(
        self,
        chat_id: int,
        jwt: str,
        caregiver_id: str,
        name: str,
        phone: str,
        current_patient_id: str = "",
    ):
        key = self._key(chat_id)
        await self._r.hset(key, mapping={
            "state":              CG_LOGGED_IN,
            "jwt":                jwt,
            "caregiver_id":       caregiver_id,
            "name":               name,
            "phone":              phone,
            "current_patient_id": current_patient_id,
        })
        await self._r.expire(key, CG_LOGGED_IN_TTL)
        log.info("cg_auth_login chat_id=%d caregiver=%s", chat_id, caregiver_id)

    async def is_cg_logged_in(self, chat_id: int) -> bool:
        return await self.get_state(chat_id) == CG_LOGGED_IN

    async def cg_logout(self, chat_id: int):
        await self._r.delete(self._key(chat_id))
        log.info("cg_auth_logout chat_id=%d", chat_id)

    async def set_cg_current_patient(self, chat_id: int, patient_id: str):
        key = self._key(chat_id)
        await self._r.hset(key, "current_patient_id", patient_id)
        await self._r.expire(key, CG_LOGGED_IN_TTL)

    # ── Nudge scheduler support ───────────────────────────────────────────────

    async def get_all_logged_in(self) -> List[Tuple[int, str]]:
        """
        Returns [(chat_id, patient_id), ...] for all currently logged-in users.
        Prunes any stale entries where the key has expired.
        """
        raw_ids = await self._r.smembers(LOGGED_IN_CHAT_SET)
        result = []
        stale = []
        for cid_str in raw_ids:
            try:
                cid = int(cid_str)
            except ValueError:
                stale.append(cid_str)
                continue
            data = await self.get(cid)
            if data.get("state") == LOGGED_IN and data.get("patient_id"):
                result.append((cid, data["patient_id"]))
            else:
                stale.append(cid_str)   # key expired or logged out
        if stale:
            await self._r.srem(LOGGED_IN_CHAT_SET, *stale)
        return result
