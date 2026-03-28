"""
Notifier — tier-keyed alert dispatch.

Channel assignment (WMO colour-code aligned):
  Tier 0  Normal     → structured log only
  Tier 1  Advisory   → log (digest collected end-of-day by ops)
  Tier 2  Warning    → Firebase FCM push to district topic subscribers
  Tier 3  Severe     → FCM push  +  Twilio SMS
  Tier 4  Emergency  → FCM push  +  Twilio SMS  +  voice call  +  broadcast webhook

All channel implementations are pluggable stubs. Set the corresponding env vars
to activate each channel; missing keys are logged and skipped gracefully.

Deduplication: Notifier checks StorageLayer.was_alert_sent() before dispatching
and records each send via StorageLayer.record_alert_sent().
"""
import json
import logging
import os

import requests as _requests

from models import RiskAssessment, TIER_COLOURS
from storage import StorageLayer

logger = logging.getLogger(__name__)


class Notifier:
    def __init__(self, storage: StorageLayer) -> None:
        self._storage = storage
        self._fcm_key         = os.getenv("FCM_SERVER_KEY", "")
        self._twilio_sid      = os.getenv("TWILIO_ACCOUNT_SID", "")
        self._twilio_token    = os.getenv("TWILIO_AUTH_TOKEN", "")
        self._twilio_from     = os.getenv("TWILIO_PHONE_FROM", "")
        self._broadcast_url   = os.getenv("BROADCAST_WEBHOOK_URL", "")

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def dispatch(self, assessment: RiskAssessment) -> None:
        """
        Route the assessment to the appropriate notification channel(s).
        Silently skips if a same-tier (or higher) alert was already sent
        for this location in the last 12 hours.
        """
        tier = assessment.tier

        if tier == 0:
            self._log(assessment)
            return

        if self._storage.was_alert_sent(assessment.location, tier, within_hours=12):
            logger.info(
                "[NOTIFY] Suppressed duplicate tier-%d alert for %s",
                tier, assessment.location,
            )
            return

        # Always log
        self._log(assessment)

        if tier >= 2:
            self._push(assessment)

        if tier >= 3:
            self._sms(assessment)

        if tier >= 4:
            self._voice(assessment)
            self._broadcast(assessment)

        channel = self._channel_name(tier)
        self._storage.record_alert_sent(assessment.location, tier, channel)
        logger.info(
            "[NOTIFY] Alert dispatched — tier=%d location=%s channel=%s",
            tier, assessment.location, channel,
        )

    # ------------------------------------------------------------------
    # Channel implementations
    # ------------------------------------------------------------------

    def _log(self, a: RiskAssessment) -> None:
        level = logging.WARNING if a.tier >= 2 else logging.INFO
        logger.log(
            level,
            "[RISK] %s (Tier %d) — %s | %s",
            a.tier_label.upper(), a.tier, a.location, "; ".join(a.triggers),
        )

    def _push(self, a: RiskAssessment) -> None:
        """
        Firebase Cloud Messaging push to topic /topics/weather_{district}.
        Topic subscribers are users who have opted in to weather alerts for
        that district in the frontend app.
        """
        if not self._fcm_key:
            logger.info("[NOTIFY] FCM_SERVER_KEY not set — push skipped for %s", a.location)
            return

        topic_slug = a.location.lower().replace(" ", "_").replace("'", "").replace("\u2019", "")
        topic = f"/topics/weather_{topic_slug}"
        payload = {
            "to": topic,
            "notification": {
                "title": f"Weather {a.tier_label} — {a.location}",
                "body": a.reasoning[:200],
                "color": TIER_COLOURS[a.tier],
            },
            "data": {
                "tier":      str(a.tier),
                "tier_label": a.tier_label,
                "location":  a.location,
                "triggers":  json.dumps(a.triggers),
                "assessed_at": a.assessed_at,
            },
        }
        try:
            resp = _requests.post(
                "https://fcm.googleapis.com/fcm/send",
                headers={
                    "Authorization": f"key={self._fcm_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=10,
            )
            resp.raise_for_status()
            logger.info("[NOTIFY] FCM push sent to %s (topic %s)", a.location, topic)
        except Exception as exc:
            logger.error("[NOTIFY] FCM push failed for %s: %s", a.location, exc)

    def _sms(self, a: RiskAssessment) -> None:
        """
        Twilio SMS to emergency contact numbers registered for the district.
        In production, fetch phone numbers from ArangoDB emergency_contacts collection.
        """
        if not self._twilio_sid:
            logger.info("[NOTIFY] Twilio not configured — SMS skipped for %s", a.location)
            return

        message_body = (
            f"WEATHER {a.tier_label.upper()} — {a.location}. "
            f"{'; '.join(a.triggers[:2])}. "
            f"{a.reasoning[:120]}"
        )
        try:
            # Lazy import so Twilio is optional at startup
            from twilio.rest import Client as TwilioClient  # type: ignore
            client = TwilioClient(self._twilio_sid, self._twilio_token)

            # TODO: replace with real recipient numbers from emergency_contacts collection
            demo_numbers: list[str] = os.getenv("EMERGENCY_CONTACT_NUMBERS", "").split(",")
            for number in filter(None, demo_numbers):
                client.messages.create(
                    body=message_body,
                    from_=self._twilio_from,
                    to=number.strip(),
                )
            logger.info("[NOTIFY] SMS sent for %s", a.location)
        except ImportError:
            logger.warning("[NOTIFY] twilio package not installed — SMS skipped")
        except Exception as exc:
            logger.error("[NOTIFY] SMS failed for %s: %s", a.location, exc)

    def _voice(self, a: RiskAssessment) -> None:
        """
        Tier-4 emergency: trigger an IVR voice call via Twilio Voice.
        Reads a pre-recorded TwiML message URL from env.
        """
        if not self._twilio_sid:
            logger.warning("[NOTIFY] Twilio not configured — voice call skipped for %s", a.location)
            return

        twiml_url = os.getenv(
            "EMERGENCY_TWIML_URL",
            "http://demo.twilio.com/docs/voice.xml",
        )
        try:
            from twilio.rest import Client as TwilioClient  # type: ignore
            client = TwilioClient(self._twilio_sid, self._twilio_token)
            demo_numbers = os.getenv("EMERGENCY_CONTACT_NUMBERS", "").split(",")
            for number in filter(None, demo_numbers):
                client.calls.create(
                    url=twiml_url,
                    from_=self._twilio_from,
                    to=number.strip(),
                )
            logger.warning("[NOTIFY] Voice calls initiated for %s tier-4", a.location)
        except ImportError:
            logger.warning("[NOTIFY] twilio package not installed — voice skipped")
        except Exception as exc:
            logger.error("[NOTIFY] Voice call failed for %s: %s", a.location, exc)

    def _broadcast(self, a: RiskAssessment) -> None:
        """
        Post a structured JSON payload to the government broadcast webhook
        (national alert platform or emergency management system).
        """
        if not self._broadcast_url:
            logger.warning(
                "[NOTIFY] BROADCAST_WEBHOOK_URL not set — tier-4 alert for %s NOT broadcast",
                a.location,
            )
            return

        payload = {
            "alert_type":  "WEATHER_EMERGENCY",
            "location":    a.location,
            "tier":        a.tier,
            "tier_label":  a.tier_label,
            "reasoning":   a.reasoning,
            "triggers":    a.triggers,
            "assessed_at": a.assessed_at,
        }
        try:
            resp = _requests.post(self._broadcast_url, json=payload, timeout=10)
            resp.raise_for_status()
            logger.warning("[NOTIFY] Emergency broadcast sent for %s", a.location)
        except Exception as exc:
            logger.error("[NOTIFY] Broadcast failed for %s: %s", a.location, exc)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _channel_name(tier: int) -> str:
        return {
            0: "log",
            1: "log",
            2: "push",
            3: "push+sms",
            4: "push+sms+voice+broadcast",
        }.get(tier, "log")
