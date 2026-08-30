"""
Notifier — tier-keyed alert dispatch.

Channel assignment (WMO colour-code aligned):
  Tier 0  Normal     → structured log only
  Tier 1  Advisory   → log (digest collected end-of-day by ops)
  Tier 2  Warning    → FCM push via backend token registry (async broadcast)
  Tier 3  Severe     → FCM push  +  Twilio SMS
  Tier 4  Emergency  → FCM push  +  Twilio SMS  +  voice call  +  broadcast webhook

All channel implementations are pluggable stubs. Set the corresponding env vars
to activate each channel; missing keys are logged and skipped gracefully.

Deduplication: Notifier checks StorageLayer.was_alert_sent() before dispatching
and records each send via StorageLayer.record_alert_sent().
"""
import hashlib
import json
import logging
import os
from datetime import date

import requests as _requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.core.models import RiskAssessment
from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)


class Notifier:
    def __init__(self, storage: StorageLayer) -> None:
        self._storage = storage
        self._twilio_sid      = os.getenv("TWILIO_ACCOUNT_SID", "")
        self._twilio_token    = os.getenv("TWILIO_AUTH_TOKEN", "")
        self._twilio_from     = os.getenv("TWILIO_PHONE_FROM", "")
        self._broadcast_url   = os.getenv("BROADCAST_WEBHOOK_URL", "")
        self._notification_url = self._resolve_notification_broadcast_url()
        self._notification_secret = os.getenv("NOTIFICATION_BROADCAST_SECRET", "")
        # Retrying session for the backend broadcast endpoint. Retrying POST is
        # safe only because every request carries an idempotency key — the
        # backend dedups on it. allowed_methods must name POST explicitly:
        # urllib3 excludes it by default.
        retry = Retry(
            total=3,
            backoff_factor=1.5,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=frozenset(["POST"]),
            respect_retry_after_header=True,
        )
        self._session = _requests.Session()
        self._session.mount("http://", HTTPAdapter(max_retries=retry))
        self._session.mount("https://", HTTPAdapter(max_retries=retry))

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
        """Send a weather push through the app backend when configured.

        The backend owns device-token matching. Legacy topic FCM remains as a
        fallback for deployments that have not enabled /api/notifications yet.
        """
        backend_payload = {
            "type": "weather_warning",
            "title": f"Weather {a.tier_label} — {a.location}",
            "body": a.reasoning[:200],
            "location": a.location,
            "districts": [a.location],
            "crops": [],
            "alertTypes": ["weather_warning"],
            "tier": a.tier,
            "tierLabel": a.tier_label,
            "data": {
                "type": "weather_warning",
                "tier": str(a.tier),
                "tier_label": a.tier_label,
                "location": a.location,
                "triggers": json.dumps(a.triggers),
                "assessed_at": a.assessed_at,
            },
        }
        bucket = str(getattr(a, "assessed_at", "") or "")[:10] or date.today().isoformat()
        broadcast_id = self._post_notification_broadcast(
            backend_payload,
            f"weather alert for {a.location}",
            self._idempotency_key("weather_warning", a.location, a.tier, bucket),
        )
        if not broadcast_id:
            logger.warning(
                "[NOTIFY] Backend notification URL not configured or failed — weather push for %s not sent",
                a.location,
            )

    def dispatch_potato_alert(self, assessment: dict) -> bool:
        """Broadcast a potato EWS alert through the backend token registry."""
        tier = int(assessment.get("tier", 0) or 0)
        if tier < 2:
            return False

        location = assessment.get("location", "")
        tier_label = assessment.get("tier_label") or assessment.get("tierLabel") or "Warning"
        body = self._potato_message(assessment)
        payload = {
            "type": "potato_ews",
            "title": f"Potato {tier_label} — {location}",
            "body": body[:240],
            "location": location,
            "districts": [location] if location else [],
            "crops": ["potato"],
            "alertTypes": ["potato_ews", "weather_warning"],
            "tier": tier,
            "tierLabel": tier_label,
            "data": {
                "type": "potato_ews",
                "crop": "potato",
                "tier": str(tier),
                "tier_label": tier_label,
                "location": location,
                "forecast_date": assessment.get("forecast_date", ""),
                "triggers": json.dumps(assessment.get("triggers", [])),
                "disease_risks": json.dumps(assessment.get("disease_risks", [])),
            },
        }
        bucket = assessment.get("forecast_date") or date.today().isoformat()
        if self._post_notification_broadcast(
            payload,
            f"potato alert for {location}",
            self._idempotency_key("potato_ews", location, tier, bucket),
        ):
            return True

        logger.warning(
            "[NOTIFY] Backend notification URL not configured or failed — potato alert for %s not pushed",
            location,
        )
        return False

    def dispatch_drought_alert(self, assessment: dict) -> bool:
        """Broadcast a drought EWS alert through the backend token registry."""
        tier = int(assessment.get("tier", 0) or 0)
        if tier < 2:
            return False

        location     = assessment.get("location", "")
        tier_label   = assessment.get("tier_label", "Warning")
        drought_level = assessment.get("drought_level", "MODERATE")
        message      = assessment.get("message", "Drought conditions detected")
        report_filename = assessment.get("report_filename", "")

        payload = {
            "type":       "drought_alert",
            "title":      f"Drought {tier_label} — {location}",
            "body":       message[:240],
            "location":   location,
            "districts":  [location] if location else [],
            "crops":      [],
            "alertTypes": ["drought_alert", "weather_warning"],
            "tier":       tier,
            "tierLabel":  tier_label,
            "data": {
                "type":            "drought_alert",
                "tier":            str(tier),
                "tier_label":      tier_label,
                "location":        location,
                "drought_level":   drought_level,
                "triggers":        json.dumps(assessment.get("triggers", [])),
                "report_filename": report_filename,
            },
        }
        bucket = assessment.get("assessment_date") or date.today().isoformat()
        if self._post_notification_broadcast(
            payload,
            f"drought alert for {location}",
            self._idempotency_key("drought_alert", location, tier, bucket),
        ):
            return True

        logger.warning(
            "[NOTIFY] Backend notification URL not configured — drought alert for %s not pushed",
            location,
        )
        return False

    def dispatch_special_bulletin(self, bulletin: dict) -> bool:
        """Broadcast a BAMIS special bulletin through the backend token registry."""
        tier = int(bulletin.get("tier", 2) or 2)
        title = bulletin.get("title", "BAMIS special weather bulletin")
        tier_label = bulletin.get("tier_label", "Warning")
        message = bulletin.get("message") or title
        hazards = bulletin.get("hazard_types", [])
        danger_terms = bulletin.get("danger_terms", [])

        payload = {
            "type":       "special_bulletin",
            "title":      f"BAMIS {tier_label} — Special Bulletin",
            "body":       message[:240],
            "location":   bulletin.get("location", ""),
            "districts":  bulletin.get("districts", []),
            "crops":      bulletin.get("crops", []),
            "alertTypes": ["special_bulletin", "weather_warning", *hazards],
            "tier":       tier,
            "tierLabel":  tier_label,
            "data": {
                "type":           "special_bulletin",
                "source":         "bamis",
                "tier":           str(tier),
                "tier_label":     tier_label,
                "title":          title,
                "url":            bulletin.get("url", ""),
                "detail_url":     bulletin.get("detail_url", ""),
                "attachment_url": bulletin.get("attachment_url", ""),
                "published_date": bulletin.get("published_date", ""),
                "hazard_types":   json.dumps(hazards),
                "danger_terms":   json.dumps(danger_terms),
            },
        }
        bulletin_ref = (
            bulletin.get("source_id")
            or bulletin.get("url")
            or f"{bulletin.get('published_date', '')}|{title}"
        )
        if self._post_notification_broadcast(
            payload,
            f"BAMIS special bulletin {bulletin.get('source_id', '')}",
            self._idempotency_key("special_bulletin", str(bulletin_ref), tier, bulletin.get("published_date") or date.today().isoformat()),
        ):
            return True

        logger.warning("[NOTIFY] Backend notification URL not configured — BAMIS special bulletin not pushed")
        return False

    def dispatch_potato_sms(self, assessment: dict, message: str | None = None) -> bool:
        """Send the potato EWS display message as an SMS via Twilio."""
        tier = int(assessment.get("tier", 0) or 0)
        if tier < 2:
            logger.info("[NOTIFY] Potato SMS skipped — tier %d is below warning threshold", tier)
            return False

        location = assessment.get("location", "potato alert")
        message_body = message or self._potato_message(assessment)
        return self._send_sms_message(message_body, f"potato alert for {location}")

    def _sms(self, a: RiskAssessment) -> bool:
        """
        Twilio SMS to emergency contact numbers registered for the district.
        In production, fetch phone numbers from ArangoDB emergency_contacts collection.
        """
        message_body = (
            f"WEATHER {a.tier_label.upper()} — {a.location}. "
            f"{'; '.join(a.triggers[:2])}. "
            f"{a.reasoning[:120]}"
        )
        return self._send_sms_message(message_body, f"weather alert for {a.location}")

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

    def _send_sms_message(self, message_body: str, context: str) -> bool:
        if not self._twilio_sid or not self._twilio_token or not self._twilio_from:
            logger.info("[NOTIFY] Twilio not configured — SMS skipped for %s", context)
            return False

        numbers = [n.strip() for n in os.getenv("EMERGENCY_CONTACT_NUMBERS", "").split(",") if n.strip()]
        if not numbers:
            logger.info("[NOTIFY] EMERGENCY_CONTACT_NUMBERS not set — SMS skipped for %s", context)
            return False

        try:
            # Lazy import so Twilio is optional at startup.
            from twilio.rest import Client as TwilioClient  # type: ignore
            client = TwilioClient(self._twilio_sid, self._twilio_token)

            sent = 0
            for number in numbers:
                client.messages.create(
                    body=message_body,
                    from_=self._twilio_from,
                    to=number,
                )
                sent += 1
            logger.info("[NOTIFY] SMS sent for %s to %d number(s)", context, sent)
            return sent > 0
        except ImportError:
            logger.warning("[NOTIFY] twilio package not installed — SMS skipped")
        except Exception as exc:
            logger.error("[NOTIFY] SMS failed for %s: %s", context, exc)
        return False

    @staticmethod
    def _potato_message(assessment: dict) -> str:
        return assessment.get("message") or "; ".join(
            (assessment.get("triggers") or assessment.get("disease_risks") or [])[:2]
        ) or "New potato early warning alert"

    @staticmethod
    def _idempotency_key(kind: str, location: str, tier, bucket: str) -> str:
        """Date-bucketed dedup key. APScheduler has no persistent jobstore, so a
        container restart re-runs the daily pipeline — this key makes the
        backend suppress the re-run's duplicate push instead of double-notifying.
        """
        raw = f"{kind}|{location}|{tier}|{bucket}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]

    def _post_notification_broadcast(
        self, payload: dict, context: str, idempotency_key: str | None = None
    ) -> str | None:
        """POST to the backend broadcast endpoint (now async server-side).

        Returns the broadcastId on success (202 queued / 200 duplicate),
        None on failure. Truthiness preserves the old bool call sites.
        """
        if not self._notification_url:
            return None

        headers = {"Content-Type": "application/json", "x-notification-source": "warning_system_engine"}
        if self._notification_secret:
            headers["x-notification-secret"] = self._notification_secret
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
            payload = {**payload, "idempotencyKey": idempotency_key}

        try:
            resp = self._session.post(
                self._notification_url,
                headers=headers,
                json=payload,
                timeout=(5, 30),
            )
            resp.raise_for_status()
            body = resp.json() if resp.content else {}
            broadcast_id = body.get("broadcastId") or ""
            if body.get("duplicate"):
                logger.info(
                    "[NOTIFY] Backend broadcast duplicate-suppressed for %s (broadcastId=%s)",
                    context, broadcast_id,
                )
            else:
                logger.info(
                    "[NOTIFY] Backend broadcast queued for %s (broadcastId=%s, status=%s)",
                    context, broadcast_id, body.get("status", "unknown"),
                )
            return broadcast_id or "queued"
        except Exception as exc:
            logger.error("[NOTIFY] Backend broadcast failed for %s: %s", context, exc)
            return None

    @staticmethod
    def _resolve_notification_broadcast_url() -> str:
        explicit = os.getenv("NOTIFICATION_BROADCAST_URL", "").strip()
        if explicit:
            return explicit

        base = os.getenv("BACKEND_API_URL", "").strip()
        if not base:
            return ""
        base = base.rstrip("/")
        if base.endswith("/api"):
            return f"{base}/notifications/broadcast"
        return f"{base}/api/notifications/broadcast"

    @staticmethod
    def _channel_name(tier: int) -> str:
        return {
            0: "log",
            1: "log",
            2: "push",
            3: "push+sms",
            4: "push+sms+voice+broadcast",
        }.get(tier, "log")
