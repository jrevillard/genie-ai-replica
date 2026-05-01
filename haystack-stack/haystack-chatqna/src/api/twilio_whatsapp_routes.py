"""
AMINA — Twilio WhatsApp MVP adapter.

Why this exists:
    Meta WhatsApp Cloud API requires a Business Portfolio with
    WhatsApp activated, business verification for production use,
    and a 24-hour temporary token for dev. For deployments where
    the Meta dashboard does not surface the WhatsApp product (e.g.
    fresh apps in some regions), Twilio's WhatsApp Sandbox provides
    a faster path to a working WhatsApp channel for the MVP.

What this module is NOT:
    * NOT a replacement for the Meta WhatsApp Cloud API path. The
      existing Meta routes
      (haystack-chatqna/src/api/meta_routes.py) and shared pipeline
      (haystack-chatqna/src/services/meta_bridge.py) remain
      untouched. They will keep working the moment Meta surfaces
      WhatsApp in the dashboard.
    * NOT a wrapper around meta_bridge — Twilio's payload shape and
      response format (TwiML) are different enough that a thin
      isolated adapter is cleaner than coupling the two.

Route:
    POST /api/v1/twilio/whatsapp/webhook
    GET  /api/v1/twilio/whatsapp/health        (route-mounted probe)

Twilio sends application/x-www-form-urlencoded fields. We respond
with TwiML (XML) which Twilio uses to send the reply on our behalf.
This means we don't need a Twilio access-key / outbound API call
for the sandbox MVP — Twilio handles delivery.

Privacy:
    * Phone numbers are NEVER logged in cleartext. They are hashed
      to sha256[:10] for log correlation only.
    * The original sender phone is passed to AminaAgent in E.164 form
      ONLY in-process (so the agent can use it for session lookup)
      — same contract as the Meta WhatsApp adapter.

Optional security:
    * Set TWILIO_AUTH_TOKEN + TWILIO_VALIDATE_SIGNATURE=true to enable
      Twilio's HMAC-SHA1 X-Twilio-Signature validation.
    * Default is OFF (sandbox MVP). MUST be ON before exposing to
      real users.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from typing import Optional
# False positive: xml.sax.saxutils.escape is a string-output sanitizer
# (escapes <, >, & for safe XML output). It does NOT parse XML, so it
# is not vulnerable to the billion-laughs / external-entity attacks
# defusedxml exists to mitigate. defusedxml does not provide a
# replacement for escape().
from xml.sax.saxutils import escape as xml_escape  # nosemgrep: python.lang.security.use-defused-xml.use-defused-xml

from fastapi import APIRouter, BackgroundTasks, Form, Header, HTTPException, Request
from fastapi.responses import Response

logger = logging.getLogger("twilio_whatsapp")

router = APIRouter(prefix="/twilio/whatsapp", tags=["twilio-whatsapp"])


# ── Constants ─────────────────────────────────────────────────────
MAX_REPLY_CHARS = 1500   # WhatsApp readability cap (hard cap is 4096)

UNSUPPORTED_TEXT = (
    "I can only read text messages right now. "
    "Please type your question and I'll help."
)
ERROR_FALLBACK = (
    "Sorry, I had trouble answering just now. Please try again in a moment."
)
EMPTY_AGENT_FALLBACK = "I'm here -- could you tell me a bit more?"


# ── Env config ────────────────────────────────────────────────────
TWILIO_AUTH_TOKEN  = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_VALIDATE_SIGNATURE = (
    os.getenv("TWILIO_VALIDATE_SIGNATURE", "false").strip().lower()
    in ("1", "true", "yes", "on")
)

# ASYNC mode: when both ACCOUNT_SID and AUTH_TOKEN are set, we ack the
# inbound webhook in <100ms and send the actual reply via Twilio's REST
# API in a background task. This is the standard fix for Twilio's 15s
# webhook timeout (error 11200) when the agent's provider-fallback
# chain occasionally takes longer than 15s.
TWILIO_API_BASE = "https://api.twilio.com/2010-04-01"
ASYNC_MODE_AVAILABLE = bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN)
EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>'

# ── Agent-call shape (matches web "Advanced mode") ────────────────
# Without these two kwargs, AminaAgent treats the inbound as a guest
# and routes through the guest greeting / cultural-food template path.
# To match the same response style operators see in web Advanced chat,
# we pass user_role and model_preference explicitly. Both are env-
# tunable so the operator can tweak without code changes.
TWILIO_AGENT_USER_ROLE        = os.getenv("TWILIO_AGENT_USER_ROLE", "patient")
TWILIO_AGENT_MODEL_PREFERENCE = os.getenv("TWILIO_AGENT_MODEL_PREFERENCE", "amina-lora")
# Channel string passed to AminaAgent. Default is "twilio_whatsapp" so
# observability (Evidence Layer, agent traces, tools_used logs) tags
# the channel correctly. AminaAgent does not currently branch response
# shaping on the channel string -- shaping is controlled by user_role
# and model_preference above. If a future shaper does branch on the
# channel name and you want WhatsApp to mimic the web Advanced flow
# byte-for-byte, set TWILIO_AGENT_CHANNEL=web explicitly.
TWILIO_AGENT_CHANNEL          = os.getenv("TWILIO_AGENT_CHANNEL", "twilio_whatsapp")


# ── Helpers ───────────────────────────────────────────────────────
def _strip_whatsapp_prefix(num: str) -> str:
    """`whatsapp:+2207700001234` -> `+2207700001234`. Idempotent."""
    if not num:
        return ""
    if num.startswith("whatsapp:"):
        return num[len("whatsapp:"):]
    return num


def _hash_id(value: str) -> str:
    """sha256[:10] for log correlation; never reversible."""
    if not value:
        return "<empty>"
    h = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"sha256:{h[:10]}"


def _twiml(message_text: str) -> str:
    """Build a TwiML response with proper XML escaping.
    Twilio reads this and sends the message back to the user."""
    safe = xml_escape(message_text or "")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<Response><Message>{safe}</Message></Response>'
    )


def _twiml_response(message_text: str) -> Response:
    """Wrap _twiml() in the FastAPI Response with the correct
    media type Twilio expects."""
    return Response(
        content=_twiml(message_text),
        media_type="application/xml",
        status_code=200,
    )


def _trim_reply(reply: str) -> str:
    if not reply:
        return EMPTY_AGENT_FALLBACK
    reply = reply.strip()
    if not reply:
        return EMPTY_AGENT_FALLBACK
    if len(reply) > MAX_REPLY_CHARS:
        reply = reply[: MAX_REPLY_CHARS - 1].rstrip() + "…"
    return reply


# ── Twilio signature validation (optional) ────────────────────────
def _validate_twilio_signature(
    full_url: str,
    raw_form: dict,
    header_sig: Optional[str],
) -> bool:
    """Twilio's HMAC-SHA1 of (full_url || sorted(k+v))"""
    if not TWILIO_AUTH_TOKEN:
        return False
    if not header_sig:
        return False
    sorted_data = "".join(f"{k}{v}" for k, v in sorted(raw_form.items()))
    payload = (full_url + sorted_data).encode("utf-8")
    expected = base64.b64encode(
        hmac.new(TWILIO_AUTH_TOKEN.encode("utf-8"), payload, hashlib.sha1).digest()
    ).decode("ascii")
    try:
        return hmac.compare_digest(expected, header_sig)
    except Exception:
        return False


# ── Twilio outbound (REST API; for async-mode replies) ────────────
async def _send_via_twilio_rest(
    *, to: str, from_: str, body: str,
) -> tuple:
    """POST a WhatsApp message to Twilio's REST API.

    Used in ASYNC mode after the inbound webhook has already been acked.
    Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.

    Returns (ok: bool, error_message: Optional[str]). NEVER raises.
    """
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        return (False, "twilio_credentials_missing")
    url = f"{TWILIO_API_BASE}/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    auth = base64.b64encode(
        f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode("utf-8")
    ).decode("ascii")
    data = {"From": from_, "To": to, "Body": body}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                url, data=data,
                headers={
                    "Authorization": f"Basic {auth}",
                    "Content-Type":  "application/x-www-form-urlencoded",
                },
            )
            if r.status_code >= 300:
                # Trim body to avoid leaking long Twilio error pages.
                snippet = (r.text or "")[:240]
                return (False, f"twilio_rest_status={r.status_code}: {snippet}")
            return (True, None)
    except Exception as e:
        return (False, f"twilio_rest_exc={e.__class__.__name__}:{str(e)[:160]}")


async def _agent_then_send_via_rest(
    *,
    message: str,
    session_id: str,
    sender_name,
    phone,
    to: str,
    from_: str,
) -> None:
    """Background task: run agent, then send via Twilio REST.
    NEVER raises; logs outcome with redacted sender."""
    sender_log = _hash_id(to)
    try:
        reply = await _call_agent(
            message=message, session_id=session_id,
            sender_name=sender_name, phone=phone,
        )
        ok, err = await _send_via_twilio_rest(to=to, from_=from_, body=reply)
        if ok:
            logger.info(
                "twilio_whatsapp async_send sender=%s in_chars=%d out_chars=%d sent=True",
                sender_log, len(message), len(reply),
            )
        else:
            logger.warning(
                "twilio_whatsapp async_send sender=%s in_chars=%d out_chars=%d sent=False err=%s",
                sender_log, len(message), len(reply), err,
            )
    except Exception as e:
        logger.exception(
            "twilio_whatsapp async_send crashed sender=%s: %s", sender_log, e,
        )


# ── Agent wrapper (isolated; does NOT couple to meta_bridge) ──────
async def _call_agent(
    *,
    message: str,
    session_id: str,
    sender_name: Optional[str],
    phone: Optional[str],
) -> str:
    """Call AminaAgent.process_message and extract a reply string.

    Passes user_role + model_preference + channel so the agent applies
    the same flow that web "Advanced mode" gets. Without these the
    inbound is treated as a guest and the agent's guest-greeting path
    fires (cultural-food intro instead of clinical intake).

    NEVER raises -- returns ERROR_FALLBACK on any failure so we can
    always answer Twilio with a valid response.
    """
    try:
        from src.agent.amina_agent import get_agent
        agent = get_agent()
        kwargs = {
            "message":     message,
            "session_id":  session_id,
            "patient_name": sender_name,
            "phone":       phone,
            "channel":     TWILIO_AGENT_CHANNEL,
        }
        # Only pass user_role / model_preference when explicitly set --
        # passing empty strings can confuse downstream pickers.
        if TWILIO_AGENT_USER_ROLE:
            kwargs["user_role"] = TWILIO_AGENT_USER_ROLE
        if TWILIO_AGENT_MODEL_PREFERENCE:
            kwargs["model_preference"] = TWILIO_AGENT_MODEL_PREFERENCE
        result = await agent.process_message(**kwargs)
        return _trim_reply(((result or {}).get("response") or ""))
    except Exception as e:
        logger.exception("twilio_whatsapp agent call failed: %s", e)
        return ERROR_FALLBACK


# ── Routes ────────────────────────────────────────────────────────
@router.post("/webhook")
async def twilio_whatsapp_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    From: str        = Form(""),
    To: str          = Form(""),
    Body: str        = Form(""),
    MessageSid: str  = Form(""),
    ProfileName: str = Form(""),
    NumMedia: str    = Form("0"),
    x_twilio_signature: Optional[str] = Header(default=None, alias="X-Twilio-Signature"),
):
    """Inbound Twilio WhatsApp webhook.

    Returns TwiML so Twilio sends the reply back to the user without
    requiring an outbound API call from us.

    Always returns HTTP 200 for a well-formed Twilio request — Twilio
    retries on 5xx, so failures are converted to TwiML fallbacks
    instead of error codes.
    """
    # Optional signature validation (off by default for sandbox MVP).
    if TWILIO_VALIDATE_SIGNATURE and TWILIO_AUTH_TOKEN:
        try:
            form = await request.form()
            form_dict = {k: v for k, v in form.items() if isinstance(v, str)}
        except Exception:
            form_dict = {}
        # Twilio sends to the public URL; trust the header proxies set.
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        host  = request.headers.get("x-forwarded-host",  request.headers.get("host", ""))
        path  = request.url.path
        full_url = f"{proto}://{host}{path}" if host else str(request.url)
        if not _validate_twilio_signature(full_url, form_dict, x_twilio_signature):
            logger.warning("twilio_whatsapp signature mismatch from %s",
                           _hash_id(From))
            raise HTTPException(status_code=403, detail="bad_signature")

    sender_log = _hash_id(From)
    phone_e164 = _strip_whatsapp_prefix(From)
    text       = (Body or "").strip()

    try:
        n_media = int(NumMedia or "0")
    except (TypeError, ValueError):
        n_media = 0
    has_media = n_media > 0

    # Unsupported: empty body OR media attachment (no media handling yet).
    if not text or has_media:
        logger.info(
            "twilio_whatsapp unsupported sender=%s msg_id_present=%s "
            "has_media=%s body_chars=%d",
            sender_log, bool(MessageSid), has_media, len(text),
        )
        return _twiml_response(UNSUPPORTED_TEXT)

    # Stable per-sender session id so multi-turn works without ever
    # storing the raw phone number anywhere.
    session_id = (
        f"twilio_whatsapp_"
        f"{hashlib.sha256(From.encode('utf-8')).hexdigest()[:16]}"
    )

    sender_name = (ProfileName or "").strip() or None
    safe_phone  = phone_e164 if phone_e164.startswith("+") else None

    # ── ASYNC mode ──
    # When ACCOUNT_SID + AUTH_TOKEN are both set, ack immediately with
    # empty TwiML and send the reply via Twilio's REST API in a
    # background task. This sidesteps Twilio's 15s webhook timeout
    # (error 11200) on slow agent turns.
    if ASYNC_MODE_AVAILABLE:
        background_tasks.add_task(
            _agent_then_send_via_rest,
            message=text,
            session_id=session_id,
            sender_name=sender_name,
            phone=safe_phone,
            to=From,    # whatsapp:+918420736098 (full prefix preserved for Twilio API)
            from_=To,   # whatsapp:+14155238886  (sandbox / business number)
        )
        logger.info(
            "twilio_whatsapp acked-async sender=%s msg_id_present=%s in_chars=%d",
            sender_log, bool(MessageSid), len(text),
        )
        return Response(
            content=EMPTY_TWIML,
            media_type="application/xml",
            status_code=200,
        )

    # ── SYNC mode (fallback) ──
    # Inline TwiML response. Works when the agent finishes in <15s. May
    # produce 11200 errors on slow turns. Set TWILIO_ACCOUNT_SID to
    # promote to async mode.
    reply = await _call_agent(
        message=text,
        session_id=session_id,
        sender_name=sender_name,
        phone=safe_phone,
    )

    logger.info(
        "twilio_whatsapp handled sender=%s msg_id_present=%s "
        "in_chars=%d out_chars=%d",
        sender_log, bool(MessageSid), len(text), len(reply),
    )
    return _twiml_response(reply)


@router.get("/health")
async def twilio_whatsapp_health():
    """Liveness probe — confirms the route module is mounted.
    NEVER returns secrets."""
    return {
        "status":               "ok",
        "channel":              "twilio_whatsapp",
        "signature_validation": TWILIO_VALIDATE_SIGNATURE,
        "auth_token_present":   bool(TWILIO_AUTH_TOKEN),
        "account_sid_present":  bool(TWILIO_ACCOUNT_SID),
        "async_mode":           ASYNC_MODE_AVAILABLE,
        "agent_user_role":      TWILIO_AGENT_USER_ROLE or "<unset>",
        "agent_model_pref":     TWILIO_AGENT_MODEL_PREFERENCE or "<unset>",
        "agent_channel":        TWILIO_AGENT_CHANNEL,
    }
