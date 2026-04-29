"""
AMINA Care -- Meta shared-pipeline tests
==========================================
Covers the Phase Meta-Shared-Pipeline contract:

  1. Messenger text payload normalises into MetaInboundMessage
  2. Messenger attachment-only payload triggers unsupported path
  3. Messenger echo / read / delivery events are ignored
  4. WhatsApp text payload normalises into MetaInboundMessage
  5. WhatsApp image / audio / document payloads trigger unsupported path
  6. Shared pipeline calls agent EXACTLY ONCE per text message
  7. Shared pipeline does NOT call agent for unsupported media
  8. Shared pipeline calls the correct adapter send_text
  9. Signature verification accepts valid signatures
 10. Signature verification rejects invalid signatures (when APP_SECRET set)
 11. Empty APP_SECRET -> verification skipped (demo/dev mode)
 12. /meta/status shape: enabled bool + signature_checks bool

The tests stub `_call_agent` and each adapter's `send_text` so no
real network is touched, no Meta credentials are required, and no
real Facebook/WhatsApp messages are sent. Run with:

    python _meta_shared_pipeline_test.py
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import sys
from typing import List

# Make `src.*` importable when run from inside or outside the container.
_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC  = os.path.join(_HERE, "src")
if os.path.isdir(_SRC) and _SRC not in sys.path:
    sys.path.insert(0, _HERE)

from src.services import meta_bridge  # noqa: E402
from src.services.meta_bridge import (  # noqa: E402
    MessengerBridge,
    MetaInboundMessage,
    UNSUPPORTED_TEXT_REPLY,
    WhatsAppBridge,
    handle_meta_payload,
    verify_xhub_signature,
)


# ── tiny test runner ─────────────────────────────────────────────────
passed = 0
failed = 0
errors: List[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        msg = f"  [FAIL] {label}"
        if detail:
            msg += f" -- {detail}"
        print(msg)
        errors.append(label)


def section(name: str) -> None:
    print(f"\n=== {name} ===")


# ── stub injection helpers ──────────────────────────────────────────
class _SendCapture:
    def __init__(self) -> None:
        self.calls: List[tuple[str, str]] = []

    async def __call__(self, to: str, text: str) -> bool:
        self.calls.append((to, text))
        return True


class _AgentCaptureFactory:
    """Patch in a fake _call_agent that records every invocation."""

    def __init__(self) -> None:
        self.calls: List[dict] = []
        self._orig = None

    def __enter__(self):
        self._orig = meta_bridge._call_agent

        async def fake(message, session_id, channel, sender_name=None, phone=None):
            self.calls.append({
                "message":     message,
                "session_id":  session_id,
                "channel":     channel,
                "sender_name": sender_name,
                "phone":       phone,
            })
            return f"reply for {channel}: ok"

        meta_bridge._call_agent = fake
        return self

    def __exit__(self, *a):
        meta_bridge._call_agent = self._orig


def _patch_send(adapter_cls, capture: _SendCapture):
    """Swap adapter.send_text with the capture and return a restorer."""
    orig = adapter_cls.send_text
    adapter_cls.send_text = staticmethod(capture)

    def restore():
        adapter_cls.send_text = staticmethod(orig)

    return restore


# ── fixtures ────────────────────────────────────────────────────────
def _messenger_text_payload(psid: str, text: str, mid: str = "mid:1") -> dict:
    return {
        "object": "page",
        "entry": [{
            "messaging": [{
                "sender":    {"id": psid},
                "recipient": {"id": "PAGE_ID"},
                "timestamp": 0,
                "message":   {"mid": mid, "text": text},
            }],
        }],
    }


def _messenger_attachment_payload(psid: str, att_type: str = "image") -> dict:
    return {
        "object": "page",
        "entry": [{
            "messaging": [{
                "sender":    {"id": psid},
                "recipient": {"id": "PAGE_ID"},
                "message":   {
                    "mid":         "mid:img1",
                    "attachments": [{"type": att_type, "payload": {"url": "..."}}],
                },
            }],
        }],
    }


def _messenger_noise_payload() -> dict:
    return {
        "object": "page",
        "entry": [{
            "messaging": [
                {"sender": {"id": "PSID-A"}, "delivery": {"watermark": 1}},
                {"sender": {"id": "PSID-B"}, "read":     {"watermark": 1}},
                {"sender": {"id": "PSID-C"},
                 "message": {"mid": "mid:echo", "text": "echo", "is_echo": True}},
            ],
        }],
    }


def _whatsapp_text_payload(wa_id: str, text: str) -> dict:
    return {
        "entry": [{
            "changes": [{
                "value": {
                    "contacts": [{"wa_id": wa_id, "profile": {"name": "Test User"}}],
                    "messages": [{
                        "from": wa_id,
                        "id":   "wamid.HBgL...",
                        "type": "text",
                        "text": {"body": text},
                    }],
                },
            }],
        }],
    }


def _whatsapp_media_payload(wa_id: str, msg_type: str = "image") -> dict:
    return {
        "entry": [{
            "changes": [{
                "value": {
                    "contacts": [{"wa_id": wa_id}],
                    "messages": [{
                        "from": wa_id,
                        "id":   "wamid.IMG...",
                        "type": msg_type,
                        msg_type: {"id": "MEDIA_ID", "mime_type": f"{msg_type}/jpeg"},
                    }],
                },
            }],
        }],
    }


# ── 1. Messenger text parse ─────────────────────────────────────────
def test_messenger_text_parse():
    section("1. Messenger text payload normalises into MetaInboundMessage")
    msgs = MessengerBridge.parse_inbound(_messenger_text_payload("PSID-1", "hello"))
    check("returns 1 message", len(msgs) == 1, detail=f"got {len(msgs)}")
    if not msgs:
        return
    m = msgs[0]
    check("channel == messenger",      m.channel == "messenger")
    check("sender_id == PSID-1",       m.sender_id == "PSID-1")
    check("session_id == messenger_PSID-1", m.session_id == "messenger_PSID-1")
    check("text == hello",             m.text == "hello")
    check("unsupported_type is None",  m.unsupported_type is None)
    check("has_attachments False",     m.has_attachments is False)
    check("message_id present",        m.message_id == "mid:1")


# ── 2. Messenger attachment-only ────────────────────────────────────
def test_messenger_attachment_only():
    section("2. Messenger attachment-only payload triggers unsupported path")
    msgs = MessengerBridge.parse_inbound(_messenger_attachment_payload("PSID-2", "image"))
    check("returns 1 message", len(msgs) == 1)
    if not msgs:
        return
    m = msgs[0]
    check("text empty",                m.text == "")
    check("unsupported_type == image", m.unsupported_type == "image")
    check("has_attachments True",      m.has_attachments is True)


# ── 3. Messenger echo / read / delivery ignored ─────────────────────
def test_messenger_noise_ignored():
    section("3. Messenger echo / read / delivery events are ignored")
    msgs = MessengerBridge.parse_inbound(_messenger_noise_payload())
    check("returns 0 messages", len(msgs) == 0, detail=f"got {len(msgs)}")


# ── 4. WhatsApp text parse ──────────────────────────────────────────
def test_whatsapp_text_parse():
    section("4. WhatsApp text payload normalises into MetaInboundMessage")
    msgs = WhatsAppBridge.parse_inbound(_whatsapp_text_payload("2207000001", "hi"))
    check("returns 1 message", len(msgs) == 1)
    if not msgs:
        return
    m = msgs[0]
    check("channel == whatsapp",          m.channel == "whatsapp")
    check("sender_id == 2207000001",      m.sender_id == "2207000001")
    check("session_id has whatsapp_ prefix",
          m.session_id == "whatsapp_2207000001")
    check("text == hi",                   m.text == "hi")
    check("phone normalised to +<...>",   m.phone == "+2207000001")
    check("sender_name == Test User",     m.sender_name == "Test User")
    check("unsupported_type is None",     m.unsupported_type is None)


# ── 5. WhatsApp media triggers unsupported ──────────────────────────
def test_whatsapp_media_unsupported():
    section("5. WhatsApp image/audio/document payload triggers unsupported path")
    for kind in ("image", "audio", "document", "video", "sticker"):
        msgs = WhatsAppBridge.parse_inbound(_whatsapp_media_payload("220700009", kind))
        ok = (
            len(msgs) == 1
            and msgs[0].text == ""
            and msgs[0].unsupported_type == kind
        )
        check(f"unsupported '{kind}' shape ok", ok,
              detail=str(msgs))


# ── 6+7+8. Pipeline behaviour: text exactly once + unsupported zero + correct send ──
def test_pipeline_routing():
    section("6. Shared pipeline calls agent exactly once per text message")
    cap = _SendCapture()
    restore = _patch_send(MessengerBridge, cap)
    try:
        with _AgentCaptureFactory() as agent_calls:
            asyncio.run(handle_meta_payload(
                "messenger", _messenger_text_payload("PSID-X", "hello")))
            check("agent called once",
                  len(agent_calls.calls) == 1,
                  detail=f"calls={agent_calls.calls}")
            check("agent received the right message",
                  agent_calls.calls and agent_calls.calls[0]["message"] == "hello")
            check("agent received correct channel",
                  agent_calls.calls and agent_calls.calls[0]["channel"] == "messenger")
        section("8. Shared pipeline calls the correct adapter send_text")
        check("MessengerBridge.send_text called once",
              len(cap.calls) == 1, detail=f"calls={cap.calls}")
        if cap.calls:
            to, body = cap.calls[0]
            check("send_text targets PSID-X",     to == "PSID-X")
            check("send_text body is agent reply",
                  body == "reply for messenger: ok")
    finally:
        restore()

    section("7. Shared pipeline does NOT call agent for unsupported media")
    cap2 = _SendCapture()
    restore2 = _patch_send(WhatsAppBridge, cap2)
    try:
        with _AgentCaptureFactory() as agent_calls:
            asyncio.run(handle_meta_payload(
                "whatsapp", _whatsapp_media_payload("220700001", "image")))
            check("agent NOT called for unsupported",
                  len(agent_calls.calls) == 0,
                  detail=f"calls={agent_calls.calls}")
        check("send_text called with the unsupported canned reply",
              len(cap2.calls) == 1
              and cap2.calls[0][1] == UNSUPPORTED_TEXT_REPLY,
              detail=str(cap2.calls))
    finally:
        restore2()


# ── 9 + 10 + 11. Signature verification ─────────────────────────────
def test_signature_verification():
    section("9-11. Signature verification accepts valid + rejects invalid")
    body = b'{"object":"page","entry":[]}'
    secret = "S3CRET-NOT-PRINTED"
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    bad = "sha256=0000000000000000000000000000000000000000000000000000000000000000"

    check("valid signature accepted",
          verify_xhub_signature(body, sig, secret) is True)
    check("invalid signature rejected",
          verify_xhub_signature(body, bad, secret) is False)
    check("missing header rejected when secret set",
          verify_xhub_signature(body, "", secret) is False)
    check("malformed header rejected when secret set",
          verify_xhub_signature(body, "garbage", secret) is False)
    check("empty secret -> verification skipped (demo/dev)",
          verify_xhub_signature(body, "", "") is True)


# ── 12. /meta/status shape ──────────────────────────────────────────
def test_status_shape():
    section("12. /meta/status shape")
    # Mirror the route by calling the same fields it returns.
    from src.services.meta_bridge import (
        MESSENGER_APP_SECRET,
        WHATSAPP_APP_SECRET,
    )
    payload = {
        "whatsapp":  {
            "enabled":          WhatsAppBridge.enabled(),
            "signature_checks": bool(WHATSAPP_APP_SECRET),
        },
        "messenger": {
            "enabled":          MessengerBridge.enabled(),
            "signature_checks": bool(MESSENGER_APP_SECRET),
        },
    }
    blob = json.dumps(payload)
    check("status shape stable (top-level keys)",
          set(payload.keys()) == {"whatsapp", "messenger"})
    for ch in ("whatsapp", "messenger"):
        check(f"{ch}.enabled is bool",
              isinstance(payload[ch]["enabled"], bool))
        check(f"{ch}.signature_checks is bool",
              isinstance(payload[ch]["signature_checks"], bool))
    # Sanity: serialise without secret content.
    check("no token-shape strings in /status payload",
          "AAH" not in blob and "EAA" not in blob)


# ── runner ──────────────────────────────────────────────────────────
def main() -> int:
    test_messenger_text_parse()
    test_messenger_attachment_only()
    test_messenger_noise_ignored()
    test_whatsapp_text_parse()
    test_whatsapp_media_unsupported()
    test_pipeline_routing()
    test_signature_verification()
    test_status_shape()

    print()
    print("=" * 60)
    print(f"  RESULTS:  {passed} passed,  {failed} failed")
    print("=" * 60)
    if failed:
        print("\nFailed: " + ", ".join(errors))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
