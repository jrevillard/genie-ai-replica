"""
Meta Ingestion Bridge -- WhatsApp Business Cloud + Facebook Messenger.

V2: shared pipeline + thin adapters.
======================================
Both Messenger and WhatsApp now go through ONE inbound-to-agent-to-
outbound pipeline (`handle_meta_payload`). The channel-specific
adapters (`MessengerBridge`, `WhatsAppBridge`) only know how to:

  * `enabled()`              -- does this channel have credentials?
  * `verify(mode, t, ch)`    -- GET handshake echo
  * `parse_inbound(payload)` -> list[MetaInboundMessage]
  * `send_text(to, text)`    -- POST to Graph API

Everything else -- empty/echo/delivery filtering, unsupported-attachment
canned replies, agent invocation, response trimming, safe logging --
lives in the shared pipeline.

Telegram is unrelated and lives in components/multichannel-access.

Public API preserved:
  * `MessengerBridge`, `WhatsAppBridge` classes still exposed.
  * `verify_xhub_signature` still exposed for meta_routes.py.
  * `WHATSAPP_APP_SECRET`, `MESSENGER_APP_SECRET` still exposed.
  * Endpoint paths in meta_routes.py unchanged.

Compat shim:
  * `<Bridge>.handle(payload)` is kept as a deprecated wrapper that
    delegates to `handle_meta_payload(channel_name, payload)`. Existing
    callers (and tests written against the old shape) keep working.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from dataclasses import dataclass, field
from typing import Any, List, Optional, Protocol

import httpx

logger = logging.getLogger(__name__)


# ── Config (read from env so src/config.py is not edited) ────────────────────

GRAPH_API_VERSION = os.getenv("META_GRAPH_VERSION", "v19.0")
GRAPH_BASE        = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

WHATSAPP_ACCESS_TOKEN    = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
WHATSAPP_VERIFY_TOKEN    = os.getenv("WHATSAPP_VERIFY_TOKEN", "amina_health_2026")
WHATSAPP_APP_SECRET      = os.getenv("WHATSAPP_APP_SECRET", "")

MESSENGER_PAGE_ACCESS_TOKEN = os.getenv("MESSENGER_PAGE_ACCESS_TOKEN", "")
MESSENGER_VERIFY_TOKEN      = os.getenv("MESSENGER_VERIFY_TOKEN", "amina_health_2026")
MESSENGER_APP_SECRET        = os.getenv("MESSENGER_APP_SECRET", "")

# Max characters per outbound bubble (Meta caps near 4096; we stay well under)
MAX_REPLY_CHARS = 3500

# Canned reply for any inbound that isn't plain text.
UNSUPPORTED_TEXT_REPLY = (
    "I can only read text messages right now. "
    "Please type your question and I'll help."
)


# ── Shared async HTTP client ─────────────────────────────────────────────────

_client: Optional[httpx.AsyncClient] = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def close_http() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
    _client = None


# ── Signature verification (shared — both channels use X-Hub-Signature-256) ──

def verify_xhub_signature(raw_body: bytes, header_value: str, app_secret: str) -> bool:
    """
    Meta signs webhook POST bodies with HMAC-SHA256(app_secret, raw_body)
    and sends the result in the `X-Hub-Signature-256: sha256=<hex>` header.

    Returns True if the signature matches OR if no app_secret is configured
    (demo/dev mode where we intentionally skip verification).
    """
    if not app_secret:
        return True  # demo mode -- skip
    if not header_value or not header_value.startswith("sha256="):
        return False
    expected = hmac.new(
        app_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, header_value.split("=", 1)[1])


# ── Normalised message envelope ──────────────────────────────────────────────

@dataclass
class MetaInboundMessage:
    """
    Canonical shape that both Messenger and WhatsApp adapters produce.
    Anything that varies between the two providers is normalised at parse
    time so the shared pipeline never branches on the channel.
    """
    channel:          str                    # "messenger" | "whatsapp"
    sender_id:        str                    # PSID for Messenger, wa_id for WhatsApp
    session_id:       str                    # f"{channel}_{sender_id}"
    text:             str = ""
    sender_name:      Optional[str] = None
    phone:            Optional[str] = None   # E.164 with leading "+"
    message_id:       Optional[str] = None
    unsupported_type: Optional[str] = None   # e.g. "image", "audio"; None for text
    has_attachments:  bool = False
    raw:              dict = field(default_factory=dict, repr=False)  # debug only


# ── Adapter protocol (structural) ────────────────────────────────────────────

class MetaAdapter(Protocol):
    channel_name: str

    @staticmethod
    def enabled() -> bool: ...
    @staticmethod
    def verify(mode: str, token: str, challenge: str) -> Optional[str]: ...
    @staticmethod
    def parse_inbound(payload: dict) -> List[MetaInboundMessage]: ...
    @staticmethod
    async def send_text(to: str, text: str) -> bool: ...


# ── Agent call (shared) ──────────────────────────────────────────────────────

async def _call_agent(
    message: str,
    session_id: str,
    channel: str,
    sender_name: Optional[str] = None,
    phone: Optional[str] = None,
) -> str:
    """
    Run the inbound text through the same AminaAgent used by /api/v1/agent/chat.
    Returns the plain-text reply. Falls back to a friendly error on failure.
    """
    try:
        from src.agent.amina_agent import get_agent
        agent = get_agent()
        result: dict[str, Any] = await agent.process_message(
            message=message,
            session_id=session_id,
            patient_name=sender_name,
            phone=phone,
            channel=channel,
        )
        reply = (result or {}).get("response") or ""
        reply = reply.strip() or "I'm here -- could you tell me a bit more?"
        if len(reply) > MAX_REPLY_CHARS:
            reply = reply[: MAX_REPLY_CHARS - 1] + "..."
        return reply
    except Exception as e:
        logger.exception("meta_bridge agent call failed: %s", e)
        return "Sorry, I had trouble answering just now. Please try again in a moment."


# ── Safe logging helpers (no PHI / token leakage) ────────────────────────────

def _mask_sender(sender_id: str) -> str:
    """Return a stable but non-reversible short hash for log lines."""
    if not sender_id:
        return "<empty>"
    h = hashlib.sha256(sender_id.encode("utf-8")).hexdigest()
    return f"sha256:{h[:8]}"


# ── Shared pipeline ─────────────────────────────────────────────────────────

# Adapter registry — populated below after the adapter classes are defined.
_ADAPTERS: dict[str, type] = {}


async def handle_meta_payload(channel_name: str, payload: dict) -> None:
    """
    Shared inbound → agent → outbound pipeline used by every Meta channel.

    Steps:
      1. Look up the adapter for `channel_name`.
      2. Ask the adapter to parse the raw payload into a list of
         MetaInboundMessage envelopes.
      3. Drop empty / echo / no-op events.
      4. For unsupported media (no text but attachments / non-text type)
         reply with the canned UNSUPPORTED_TEXT_REPLY -- no agent call.
      5. For text messages, call the agent once and send the reply
         through the same adapter.
      6. Log only safe metadata (channel, masked sender, char counts,
         message_id presence). Never log raw text or tokens.
    """
    adapter = _ADAPTERS.get(channel_name)
    if adapter is None:
        logger.warning("meta_pipeline unknown channel=%s", channel_name)
        return

    try:
        messages = adapter.parse_inbound(payload)
    except Exception as e:
        logger.exception("meta_pipeline parse_failed channel=%s err=%s", channel_name, e)
        return

    if not messages:
        return

    for msg in messages:
        await _process_one(adapter, msg)


async def _process_one(adapter: type, msg: MetaInboundMessage) -> None:
    if not msg.sender_id:
        return

    sender_log = _mask_sender(msg.sender_id)

    # Unsupported media path: empty text + (typed non-text OR attachments)
    is_unsupported = (
        bool(msg.unsupported_type)
        or (not msg.text and msg.has_attachments)
    )
    if is_unsupported:
        ok = await adapter.send_text(msg.sender_id, UNSUPPORTED_TEXT_REPLY)
        logger.info(
            "meta_pipeline unsupported channel=%s sender=%s type=%s "
            "has_attachments=%s msg_id_present=%s sent=%s",
            msg.channel, sender_log, msg.unsupported_type or "<none>",
            msg.has_attachments, bool(msg.message_id), ok,
        )
        return

    # Pure text. Echoes / empty bodies fall through to here as text="".
    if not msg.text:
        return

    reply = await _call_agent(
        message=msg.text,
        session_id=msg.session_id,
        channel=msg.channel,
        sender_name=msg.sender_name,
        phone=msg.phone,
    )
    ok = await adapter.send_text(msg.sender_id, reply)
    logger.info(
        "meta_pipeline handled channel=%s sender=%s msg_id_present=%s "
        "in_chars=%d out_chars=%d sent=%s",
        msg.channel, sender_log, bool(msg.message_id),
        len(msg.text), len(reply), ok,
    )


# ── WhatsApp Cloud API ───────────────────────────────────────────────────────

class WhatsAppBridge:
    """Thin adapter for WhatsApp Business Cloud API."""

    channel_name = "whatsapp"

    @staticmethod
    def enabled() -> bool:
        return bool(WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID)

    @staticmethod
    def verify(mode: str, token: str, challenge: str) -> Optional[str]:
        if mode == "subscribe" and token == WHATSAPP_VERIFY_TOKEN:
            return challenge
        return None

    @staticmethod
    def parse_inbound(payload: dict) -> List[MetaInboundMessage]:
        """
        WhatsApp webhooks wrap messages in entry[].changes[].value.messages[].
        Status updates (delivery / read receipts) live in
        entry[].changes[].value.statuses[] and are ignored here -- they
        carry no `messages` key so they fall through naturally.
        """
        out: List[MetaInboundMessage] = []
        for entry in payload.get("entry", []) or []:
            for change in entry.get("changes", []) or []:
                value = change.get("value") or {}
                contacts = {
                    c.get("wa_id"): (c.get("profile") or {}).get("name", "")
                    for c in (value.get("contacts") or [])
                }
                for msg in value.get("messages") or []:
                    sender = msg.get("from", "") or ""
                    msg_id = msg.get("id", "") or None
                    msg_type = (msg.get("type") or "").strip()
                    if msg_type == "text":
                        body = ((msg.get("text") or {}).get("body") or "").strip()
                        unsupported = None
                    else:
                        body = ""
                        unsupported = msg_type or "unknown"
                    out.append(MetaInboundMessage(
                        channel="whatsapp",
                        sender_id=sender,
                        session_id=f"whatsapp_{sender}" if sender else "whatsapp_",
                        text=body,
                        sender_name=contacts.get(sender) or None,
                        phone=f"+{sender}" if sender.isdigit() else None,
                        message_id=msg_id,
                        unsupported_type=unsupported,
                        # WhatsApp puts the media object on the typed key
                        # (image, audio, document, ...). Treat any
                        # non-text typed key as "has attachments" too.
                        has_attachments=bool(unsupported and msg.get(unsupported)),
                        raw=msg,
                    ))
        return out

    @staticmethod
    async def send_text(to: str, text: str) -> bool:
        if not WhatsAppBridge.enabled():
            logger.warning("whatsapp disabled -- skipping send to %s", _mask_sender(to))
            return False
        url = f"{GRAPH_BASE}/{WHATSAPP_PHONE_NUMBER_ID}/messages"
        headers = {
            "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
            "Content-Type":  "application/json",
        }
        body = {
            "messaging_product": "whatsapp",
            "recipient_type":    "individual",
            "to":                to,
            "type":              "text",
            "text":              {"preview_url": False, "body": text},
        }
        try:
            r = await _http().post(url, headers=headers, json=body)
            if r.status_code >= 300:
                logger.warning("whatsapp send failed %d: %s", r.status_code, r.text[:300])
                return False
            return True
        except Exception as e:
            logger.exception("whatsapp send error: %s", e)
            return False

    # ── Compat shim ──────────────────────────────────────────────────
    # Old callers / tests that still call `WhatsAppBridge.handle(payload)`
    # keep working. Internally this just delegates to the shared pipeline.
    @staticmethod
    async def handle(payload: dict) -> None:
        await handle_meta_payload("whatsapp", payload)


# ── Facebook Messenger Platform ──────────────────────────────────────────────

class MessengerBridge:
    """Thin adapter for the Messenger Platform."""

    channel_name = "messenger"

    @staticmethod
    def enabled() -> bool:
        return bool(MESSENGER_PAGE_ACCESS_TOKEN)

    @staticmethod
    def verify(mode: str, token: str, challenge: str) -> Optional[str]:
        if mode == "subscribe" and token == MESSENGER_VERIFY_TOKEN:
            return challenge
        return None

    @staticmethod
    def parse_inbound(payload: dict) -> List[MetaInboundMessage]:
        """
        Messenger webhooks wrap messages in entry[].messaging[]. We extract a
        flat list of MetaInboundMessage objects, one per inbound message.
        Postbacks, echoes, delivery / read events are filtered out.
        Attachments without text become unsupported events.
        """
        out: List[MetaInboundMessage] = []
        if payload.get("object") != "page":
            return out
        for entry in payload.get("entry", []) or []:
            for ev in entry.get("messaging", []) or []:
                # Ignore delivery, read events
                if ev.get("delivery") or ev.get("read"):
                    continue
                msg = ev.get("message") or {}
                if msg.get("is_echo"):
                    continue
                psid = (ev.get("sender") or {}).get("id", "") or ""
                if not psid:
                    continue
                text = (msg.get("text") or "").strip()
                attachments = msg.get("attachments") or []
                has_attachments = bool(attachments)
                # Detect type from the first attachment when no text present.
                unsupported = None
                if not text and has_attachments:
                    first = attachments[0] if isinstance(attachments[0], dict) else {}
                    unsupported = (first.get("type") or "attachment") or "attachment"
                out.append(MetaInboundMessage(
                    channel="messenger",
                    sender_id=psid,
                    session_id=f"messenger_{psid}",
                    text=text,
                    sender_name=None,
                    phone=None,
                    message_id=msg.get("mid") or None,
                    unsupported_type=unsupported,
                    has_attachments=has_attachments,
                    raw=msg,
                ))
        return out

    @staticmethod
    async def send_text(to: str, text: str) -> bool:
        if not MessengerBridge.enabled():
            logger.warning("messenger disabled -- skipping send to %s", _mask_sender(to))
            return False
        url = f"{GRAPH_BASE}/me/messages"
        params = {"access_token": MESSENGER_PAGE_ACCESS_TOKEN}
        body = {
            "recipient":      {"id": to},
            "messaging_type": "RESPONSE",
            "message":        {"text": text},
        }
        try:
            r = await _http().post(url, params=params, json=body)
            if r.status_code >= 300:
                logger.warning("messenger send failed %d: %s", r.status_code, r.text[:300])
                return False
            return True
        except Exception as e:
            logger.exception("messenger send error: %s", e)
            return False

    # Compat shim — same as WhatsAppBridge.
    @staticmethod
    async def handle(payload: dict) -> None:
        await handle_meta_payload("messenger", payload)


# Register adapters once classes exist.
_ADAPTERS["whatsapp"]  = WhatsAppBridge
_ADAPTERS["messenger"] = MessengerBridge


__all__ = [
    "MetaInboundMessage",
    "MetaAdapter",
    "WhatsAppBridge",
    "MessengerBridge",
    "handle_meta_payload",
    "verify_xhub_signature",
    "WHATSAPP_APP_SECRET",
    "MESSENGER_APP_SECRET",
    "UNSUPPORTED_TEXT_REPLY",
    "MAX_REPLY_CHARS",
    "close_http",
]
