# app/services/gateway_client.py

"""
Haystack Gateway Client — calls the Amina agent backend.

Endpoints used:
  POST /api/v1/agent/chat            — ReAct agent chat (primary)
  POST /api/v1/text-chat             — fallback RAG chat
  POST /api/v1/stt                   — audio transcription
  POST /api/v1/tts                   — text-to-speech
  GET  /api/v1/auth/me               — patient profile
  POST /api/v1/auth/otp/send         — send OTP via SMS
  POST /api/v1/auth/otp/verify       — verify OTP, returns JWT
  POST /api/v1/auth/login            — PIN login, returns JWT
  GET  /api/v1/agent/patients/{id}/history  — consultation history
  PUT  /api/v1/patients/{id}/vitals  — update vitals
  GET  /api/v1/agent/care-plan/{sid} — care plan
  GET  /api/v1/agent/nudge           — lifestyle nudge
  POST /api/v1/agent/prescription    — prescription image analysis
  GET  /api/v1/agent/document/{sid}/download/pdf  — consultation PDF
  POST /api/v1/agent/feedback        — thumbs up/down feedback
  POST /api/v1/patient/telegram/save-chat-id  — link Telegram chat_id
"""

import logging
from typing import Optional, List, Dict

import httpx

from app.config import settings

log = logging.getLogger("gateway")


class GatewayClient:
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._base = settings.GATEWAY_URL.rstrip("/")

    async def start(self):
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(float(settings.GATEWAY_TIMEOUT), connect=10.0),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=10),
        )
        log.info("gateway_started url=%s", self._base)

    async def stop(self):
        if self._client:
            await self._client.aclose()

    async def health_check(self) -> bool:
        try:
            r = await self._client.get(f"{self._base}/health")
            return r.status_code == 200
        except Exception:
            return False

    # ── Authentication ────────────────────────────────────────────────────────

    async def send_otp(self, phone: str) -> Optional[Dict]:
        """POST /auth/otp/send — sends 6-digit OTP via SMS."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/auth/otp/send",
                json={"phone": phone},
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("send_otp_error: %s", e)
            return None

    async def verify_otp(self, phone: str, otp: str) -> Optional[Dict]:
        """POST /auth/otp/verify — verifies OTP, returns {token, patient{}, session_id}."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/auth/otp/verify",
                json={"phone": phone, "otp": otp},
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("verify_otp_error: %s", e)
            return None

    async def login_pin(self, phone: str, pin: str) -> Optional[Dict]:
        """POST /auth/login — PIN login, returns {token, patient{}, session_id}."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/auth/login",
                json={"phone": phone, "pin": pin},
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("login_pin_error: %s", e)
            return None

    async def get_profile(self, jwt: str) -> Optional[Dict]:
        """GET /auth/me — returns full patient profile."""
        try:
            r = await self._client.get(
                f"{self._base}/api/v1/auth/me",
                headers={"Authorization": f"Bearer {jwt}"},
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("get_profile_error: %s", e)
            return None

    async def save_telegram_chat_id(self, jwt: str, chat_id: str) -> bool:
        """POST /patient/telegram/save-chat-id — links Telegram chat_id to patient account."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/patient/telegram/save-chat-id",
                json={"telegram_chat_id": chat_id},
                headers={"Authorization": f"Bearer {jwt}"},
            )
            return r.status_code == 200
        except Exception as e:
            log.error("save_chat_id_error: %s", e)
            return False

    # ── Agent chat ────────────────────────────────────────────────────────────

    async def agent_chat(
        self,
        message: str,
        session_id: str,
        phone: str = None,
        patient_id: str = None,
    ) -> Optional[Dict]:
        """Anonymous agent chat — ReAct loop with tools and memory."""
        return await self._agent_chat_request(
            message=message, session_id=session_id,
            phone=phone, patient_id=patient_id,
        )

    async def agent_chat_authed(
        self,
        message: str,
        session_id: str,
        patient_id: str,
        language: str = "en",
        jwt: str = None,
    ) -> Optional[Dict]:
        """Authenticated agent chat — passes patient identity and JWT."""
        return await self._agent_chat_request(
            message=message, session_id=session_id,
            patient_id=patient_id, language=language, jwt=jwt,
        )

    async def _agent_chat_request(
        self,
        message: str,
        session_id: str,
        phone: str = None,
        patient_id: str = None,
        language: str = None,
        jwt: str = None,
    ) -> Optional[Dict]:
        try:
            payload = {"message": message, "session_id": session_id, "channel": "telegram"}
            if phone:       payload["phone"] = phone
            if patient_id:  payload["patient_id"] = patient_id
            if language:    payload["language"] = language

            headers = {}
            if jwt:
                headers["Authorization"] = f"Bearer {jwt}"

            r = await self._client.post(
                f"{self._base}/api/v1/agent/chat",
                json=payload, headers=headers,
            )
            if r.status_code != 200:
                log.error("agent_chat_failed status=%d body=%s", r.status_code, r.text[:200])
                return None
            return r.json()
        except Exception as e:
            log.error("agent_chat_error: %s", e)
            return None

    # ── Legacy RAG fallback ───────────────────────────────────────────────────

    async def text_chat(self, text: str, history: List[Dict[str, str]] = None) -> Optional[str]:
        result = await self.agent_chat(message=text, session_id="fallback")
        if result and result.get("response"):
            return result["response"]
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/text-chat",
                json={"text": text, "history": history or []},
            )
            if r.status_code != 200:
                return None
            return r.json().get("answer", "")
        except Exception as e:
            log.error("text_chat_error: %s", e)
            return None

    # ── Patient data ──────────────────────────────────────────────────────────

    async def get_patient_history(self, patient_id: str) -> Optional[Dict]:
        """GET /agent/patients/{id}/history — consultations + key facts + care plan."""
        try:
            r = await self._client.get(
                f"{self._base}/api/v1/agent/patients/{patient_id}/history",
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("get_history_error: %s", e)
            return None

    async def update_vitals(self, patient_id: str, bp: str = None, glucose: str = None) -> bool:
        """PUT /patients/{id}/vitals — update BP and/or glucose."""
        try:
            payload = {}
            if bp:      payload["bp"] = bp
            if glucose: payload["glucose"] = glucose
            r = await self._client.put(
                f"{self._base}/api/v1/patients/{patient_id}/vitals",
                json=payload,
            )
            return r.status_code == 200
        except Exception as e:
            log.error("update_vitals_error: %s", e)
            return False

    async def get_care_plan(self, session_id: str) -> Optional[Dict]:
        """GET /agent/care-plan/{session_id} — returns care plan if generated."""
        try:
            r = await self._client.get(
                f"{self._base}/api/v1/agent/care-plan/{session_id}",
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("get_care_plan_error: %s", e)
            return None

    async def generate_care_plan(self, session_id: str) -> Optional[Dict]:
        """POST /agent/care-plan/{session_id}/generate — generates a fresh care plan."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/agent/care-plan/{session_id}/generate",
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("gen_care_plan_error: %s", e)
            return None

    # ── Nudge ─────────────────────────────────────────────────────────────────

    async def get_nudge(self, patient_id: str = None) -> Optional[Dict]:
        """GET /agent/nudge — today's One-Spoon Swap lifestyle nudge."""
        try:
            params = {}
            if patient_id:
                params["patient_id"] = patient_id
            r = await self._client.get(
                f"{self._base}/api/v1/agent/nudge",
                params=params,
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("get_nudge_error: %s", e)
            return None

    # ── Prescription analysis ─────────────────────────────────────────────────

    async def analyze_prescription(
        self,
        image_bytes: bytes,
        session_id: str = None,
        patient_id: str = None,
        language: str = "en",
    ) -> Optional[Dict]:
        """POST /agent/prescription — photo → medication extraction + AMINA warnings."""
        try:
            files = {"file": ("prescription.jpg", image_bytes, "image/jpeg")}
            data = {"language": language}
            if session_id:  data["session_id"] = session_id
            if patient_id:  data["patient_id"] = patient_id
            r = await self._client.post(
                f"{self._base}/api/v1/agent/prescription",
                files=files, data=data,
                timeout=httpx.Timeout(60.0, connect=10.0),
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("prescription_error: %s", e)
            return None

    # ── Document / PDF ────────────────────────────────────────────────────────

    async def get_consultation_pdf(self, session_id: str) -> Optional[bytes]:
        """GET /agent/document/{session_id}/download/pdf — consultation summary PDF."""
        try:
            r = await self._client.get(
                f"{self._base}/api/v1/agent/document/{session_id}/download/pdf",
                timeout=httpx.Timeout(30.0, connect=10.0),
            )
            if r.status_code == 200 and len(r.content) > 100:
                return r.content
            return None
        except Exception as e:
            log.error("get_pdf_error: %s", e)
            return None

    # ── Feedback ──────────────────────────────────────────────────────────────

    async def send_feedback(
        self,
        session_id: str,
        rating: str,
        message_preview: str = "",
    ) -> bool:
        """POST /agent/feedback — thumbs_up or thumbs_down."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/agent/feedback",
                json={
                    "session_id": session_id,
                    "rating": rating,
                    "message_preview": message_preview[:120],
                },
            )
            return r.status_code == 200
        except Exception as e:
            log.error("feedback_error: %s", e)
            return False

    # ── Caregiver (Tier 3) ────────────────────────────────────────────────────

    async def caregiver_login(self, phone: str, pin: str) -> Optional[Dict]:
        """POST /caregiver/login — PIN login for caregivers, returns {token, caregiver{}, ...}."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/caregiver/login",
                json={"phone": phone, "pin": pin},
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("caregiver_login_error: %s", e)
            return None

    async def get_caregiver_dashboard(self, jwt: str, patient_id: str = None) -> Optional[Dict]:
        """GET /caregiver/dashboard — alerts, stats, pending rules."""
        try:
            params = {}
            if patient_id:
                params["patient_id"] = patient_id
            r = await self._client.get(
                f"{self._base}/api/v1/caregiver/dashboard",
                headers={"Authorization": f"Bearer {jwt}"},
                params=params,
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("cg_dashboard_error: %s", e)
            return None

    async def get_caregiver_patients(self, jwt: str) -> Optional[Dict]:
        """GET /caregiver/patients — list of assigned patients."""
        try:
            r = await self._client.get(
                f"{self._base}/api/v1/caregiver/patients",
                headers={"Authorization": f"Bearer {jwt}"},
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("cg_patients_error: %s", e)
            return None

    async def get_caregiver_insights(self, jwt: str, patient_id: str = None) -> Optional[Dict]:
        """GET /caregiver/insights — AI insights for assigned patients."""
        try:
            params = {}
            if patient_id:
                params["patient_id"] = patient_id
            r = await self._client.get(
                f"{self._base}/api/v1/caregiver/insights",
                headers={"Authorization": f"Bearer {jwt}"},
                params=params,
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("cg_insights_error: %s", e)
            return None

    async def send_cg_patient_alert(
        self,
        jwt: str,
        patient_id: str,
        message: str,
        severity: str = "info",
    ) -> bool:
        """POST /caregiver/send-patient-alert — push alert to patient."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/caregiver/send-patient-alert",
                json={
                    "patient_id": patient_id,
                    "message":    message,
                    "severity":   severity,
                    "use_telegram": False,
                },
                headers={"Authorization": f"Bearer {jwt}"},
            )
            return r.status_code == 200
        except Exception as e:
            log.error("cg_alert_error: %s", e)
            return False

    # ── Community (Tier 3) ────────────────────────────────────────────────────

    async def get_community_all(self, user_id: str, session_id: str) -> Optional[Dict]:
        """GET /community/all — Bantaba threads, village board, seasonal tips, healer bridge."""
        try:
            r = await self._client.get(
                f"{self._base}/api/v1/community/all",
                params={"user_id": user_id, "session_id": session_id},
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("community_all_error: %s", e)
            return None

    # ── Referral (Tier 3) ─────────────────────────────────────────────────────

    async def create_referral(
        self,
        vhw_name: str,
        vhw_id: str,
        patient_phone: str,
        reason: str,
        session_id: str,
    ) -> Optional[Dict]:
        """POST /agent/referrals — VHW warm-handoff referral to AMINA."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/agent/referrals",
                json={
                    "vhw_name":     vhw_name,
                    "vhw_id":       vhw_id,
                    "patient_phone": patient_phone,
                    "reason":       reason,
                    "session_id":   session_id,
                },
            )
            return r.json() if r.status_code == 200 else None
        except Exception as e:
            log.error("referral_error: %s", e)
            return None

    # ── Session continuity (Tier 3) ───────────────────────────────────────────

    async def end_session(self, session_id: str) -> bool:
        """POST /agent/session/end — signal agent to close session and persist memory."""
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/agent/session/end",
                json={"session_id": session_id},
            )
            return r.status_code == 200
        except Exception as e:
            log.error("end_session_error: %s", e)
            return False

    # ── STT / TTS (unchanged) ─────────────────────────────────────────────────

    async def speech_to_text(self, audio_bytes: bytes, filename: str = "audio.ogg") -> Optional[str]:
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/stt",
                files={"file": (filename, audio_bytes, "audio/ogg")},
            )
            if r.status_code != 200:
                return None
            return r.json().get("transcript", "")
        except Exception as e:
            log.error("stt_error: %s", e)
            return None

    async def text_to_speech(self, text: str) -> Optional[bytes]:
        try:
            r = await self._client.post(
                f"{self._base}/api/v1/tts",
                json={"text": text},
            )
            if r.status_code != 200:
                return None
            if len(r.content) < 100:
                return None
            return r.content
        except Exception as e:
            log.error("tts_error: %s", e)
            return None
