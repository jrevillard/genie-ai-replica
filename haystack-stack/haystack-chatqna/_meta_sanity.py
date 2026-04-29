"""
Sanity checks for the meta ingestion pipeline.

Runs offline — no real Meta call, no real agent call. Verifies:
  1. modules import without error
  2. main.py has meta_router registered
  3. router exposes the expected 5 endpoints
  4. X-Hub-Signature-256 verification: positive, negative, demo-mode
  5. WhatsApp handshake: positive, wrong-token, wrong-mode
  6. Messenger handshake: positive, wrong-token
  7. WhatsApp parse_inbound: text message, image (unsupported), empty
  8. Messenger parse_inbound: text, echo-filtered, delivery-filtered, empty
  9. Agent call path is monkey-patched and receives the right session_id/channel

Run from the haystack-chatqna directory:
    python _meta_sanity.py
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import sys
import traceback
from pathlib import Path

# Ensure `src.*` is importable when run from haystack-chatqna/
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

# Force UTF-8 on Windows consoles
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


GREEN = "\033[92m"
RED   = "\033[91m"
YELL  = "\033[93m"
RESET = "\033[0m"

results: list[tuple[str, bool, str]] = []


def check(name: str, fn):
    try:
        ok = fn()
        if ok is None:
            ok = True
        results.append((name, bool(ok), ""))
        mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"  [{mark}] {name}")
    except AssertionError as e:
        results.append((name, False, str(e)))
        print(f"  [{RED}FAIL{RESET}] {name} — {e}")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"  [{RED}FAIL{RESET}] {name} — {type(e).__name__}: {e}")
        traceback.print_exc()


def banner(text: str):
    print(f"\n{'=' * 60}\n  {text}\n{'=' * 60}")


# ── 1. Module imports ────────────────────────────────────────────────────────

banner("1. module imports")


def test_import_bridge():
    import src.services.meta_bridge as mb  # noqa: F401
    return True


def test_import_routes():
    import src.api.meta_routes as mr  # noqa: F401
    return True


check("import src.services.meta_bridge", test_import_bridge)
check("import src.api.meta_routes",      test_import_routes)


# ── 2. main.py registers the router ──────────────────────────────────────────

banner("2. main.py wiring")


def test_main_imports_meta_router():
    main_text = (ROOT / "src" / "main.py").read_text(encoding="utf-8")
    assert "from src.api.meta_routes import router as meta_router" in main_text, \
        "meta_router import missing from main.py"
    assert "include_router(meta_router" in main_text, \
        "meta_router include_router missing from main.py"
    return True


check("main.py imports and mounts meta_router", test_main_imports_meta_router)


# ── 3. Router endpoints ──────────────────────────────────────────────────────

banner("3. router endpoints")


def test_router_routes():
    from src.api.meta_routes import router
    paths = {(r.path, tuple(sorted(r.methods))) for r in router.routes}
    expected = {
        ("/meta/webhook/whatsapp",  ("GET",)),
        ("/meta/webhook/whatsapp",  ("POST",)),
        ("/meta/webhook/messenger", ("GET",)),
        ("/meta/webhook/messenger", ("POST",)),
        ("/meta/status",            ("GET",)),
    }
    missing = expected - paths
    assert not missing, f"missing routes: {missing}"
    return True


check("router has 5 expected endpoints", test_router_routes)


# ── 4. Signature verification ────────────────────────────────────────────────

banner("4. X-Hub-Signature-256 verification")


def test_sig_positive():
    from src.services.meta_bridge import verify_xhub_signature
    secret = "topsecret"
    body   = b'{"entry":[]}'
    sig    = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert verify_xhub_signature(body, sig, secret) is True
    return True


def test_sig_negative():
    from src.services.meta_bridge import verify_xhub_signature
    assert verify_xhub_signature(b"hello", "sha256=deadbeef", "topsecret") is False
    return True


def test_sig_missing_header():
    from src.services.meta_bridge import verify_xhub_signature
    assert verify_xhub_signature(b"hello", "", "topsecret") is False
    return True


def test_sig_demo_mode():
    # No app_secret → skip verification and accept
    from src.services.meta_bridge import verify_xhub_signature
    assert verify_xhub_signature(b"hello", "", "") is True
    return True


check("signature: valid hmac passes",     test_sig_positive)
check("signature: wrong hex fails",       test_sig_negative)
check("signature: missing header fails",  test_sig_missing_header)
check("signature: demo mode (no secret)", test_sig_demo_mode)


# ── 5. WhatsApp handshake ────────────────────────────────────────────────────

banner("5. WhatsApp verify handshake")


def test_wa_verify_ok():
    from src.services.meta_bridge import WhatsAppBridge, WHATSAPP_VERIFY_TOKEN
    out = WhatsAppBridge.verify("subscribe", WHATSAPP_VERIFY_TOKEN, "CHAL123")
    assert out == "CHAL123", f"expected CHAL123, got {out!r}"
    return True


def test_wa_verify_bad_token():
    from src.services.meta_bridge import WhatsAppBridge
    assert WhatsAppBridge.verify("subscribe", "wrong_token", "CHAL") is None
    return True


def test_wa_verify_bad_mode():
    from src.services.meta_bridge import WhatsAppBridge, WHATSAPP_VERIFY_TOKEN
    assert WhatsAppBridge.verify("unsubscribe", WHATSAPP_VERIFY_TOKEN, "CHAL") is None
    return True


check("WhatsApp verify: correct mode+token",  test_wa_verify_ok)
check("WhatsApp verify: wrong token fails",   test_wa_verify_bad_token)
check("WhatsApp verify: wrong mode fails",    test_wa_verify_bad_mode)


# ── 6. Messenger handshake ───────────────────────────────────────────────────

banner("6. Messenger verify handshake")


def test_msg_verify_ok():
    from src.services.meta_bridge import MessengerBridge, MESSENGER_VERIFY_TOKEN
    assert MessengerBridge.verify("subscribe", MESSENGER_VERIFY_TOKEN, "PING") == "PING"
    return True


def test_msg_verify_bad_token():
    from src.services.meta_bridge import MessengerBridge
    assert MessengerBridge.verify("subscribe", "wrong", "PING") is None
    return True


check("Messenger verify: correct token",     test_msg_verify_ok)
check("Messenger verify: wrong token fails", test_msg_verify_bad_token)


# ── 7. WhatsApp parse_inbound ────────────────────────────────────────────────

banner("7. WhatsApp parse_inbound")


def _wa_payload_text(from_="919876543210", body="Hello Amina"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "ENTRY_ID",
            "changes": [{
                "field": "messages",
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {
                        "display_phone_number": "16505551234",
                        "phone_number_id":      "1234567890",
                    },
                    "contacts": [{
                        "profile": {"name": "Riya"},
                        "wa_id":   from_,
                    }],
                    "messages": [{
                        "from":      from_,
                        "id":        "wamid.HBgLMTIzNA==",
                        "timestamp": "1700000000",
                        "text":      {"body": body},
                        "type":      "text",
                    }],
                },
            }],
        }],
    }


def test_wa_parse_text_india():
    from src.services.meta_bridge import WhatsAppBridge
    msgs = WhatsAppBridge.parse_inbound(_wa_payload_text("919876543210", "India ping"))
    assert len(msgs) == 1
    m = msgs[0]
    assert m.sender_id == "919876543210"
    assert m.text == "India ping"
    assert m.unsupported_type is None
    assert m.sender_name == "Riya"
    return True


def test_wa_parse_text_colombia():
    from src.services.meta_bridge import WhatsAppBridge
    msgs = WhatsAppBridge.parse_inbound(_wa_payload_text("573001234567", "Hola Amina"))
    assert len(msgs) == 1
    assert msgs[0].sender_id == "573001234567"
    assert msgs[0].text == "Hola Amina"
    return True


def test_wa_parse_image_unsupported():
    from src.services.meta_bridge import WhatsAppBridge
    payload = {
        "entry": [{"changes": [{"value": {
            "messages": [{
                "from": "919876543210",
                "id":   "wamid.img",
                "type": "image",
                "image": {"id": "mediaid"},
            }],
        }}]}],
    }
    msgs = WhatsAppBridge.parse_inbound(payload)
    assert len(msgs) == 1
    assert msgs[0].unsupported_type == "image"
    assert msgs[0].text == ""
    return True


def test_wa_parse_empty():
    from src.services.meta_bridge import WhatsAppBridge
    assert WhatsAppBridge.parse_inbound({}) == []
    assert WhatsAppBridge.parse_inbound({"entry": []}) == []
    assert WhatsAppBridge.parse_inbound({"entry": [{"changes": []}]}) == []
    return True


check("WhatsApp parse: India +91 text",    test_wa_parse_text_india)
check("WhatsApp parse: Colombia +57 text", test_wa_parse_text_colombia)
check("WhatsApp parse: image marked unsupported", test_wa_parse_image_unsupported)
check("WhatsApp parse: empty payloads",    test_wa_parse_empty)


# ── 8. Messenger parse_inbound ───────────────────────────────────────────────

banner("8. Messenger parse_inbound")


def _msg_payload_text(psid="100012345", text="Hi from India"):
    return {
        "object": "page",
        "entry": [{
            "id":   "PAGE_ID",
            "time": 1700000000,
            "messaging": [{
                "sender":    {"id": psid},
                "recipient": {"id": "PAGE_ID"},
                "timestamp": 1700000000,
                "message": {
                    "mid":  "mid.12345",
                    "text": text,
                },
            }],
        }],
    }


def test_msg_parse_text_india():
    from src.services.meta_bridge import MessengerBridge
    msgs = MessengerBridge.parse_inbound(_msg_payload_text("111", "Namaste"))
    assert len(msgs) == 1
    assert msgs[0].sender_id == "111"
    assert msgs[0].text == "Namaste"
    return True


def test_msg_parse_text_colombia():
    from src.services.meta_bridge import MessengerBridge
    msgs = MessengerBridge.parse_inbound(_msg_payload_text("222", "Buenos dias"))
    assert len(msgs) == 1
    assert msgs[0].sender_id == "222"
    assert msgs[0].text == "Buenos dias"
    return True


def test_msg_parse_echo_filtered():
    from src.services.meta_bridge import MessengerBridge
    payload = {
        "object": "page",
        "entry": [{"messaging": [{
            "sender":    {"id": "PAGE_ID"},
            "recipient": {"id": "111"},
            "message":   {"mid": "m", "text": "echo", "is_echo": True},
        }]}],
    }
    assert MessengerBridge.parse_inbound(payload) == []
    return True


def test_msg_parse_delivery_filtered():
    from src.services.meta_bridge import MessengerBridge
    payload = {
        "object": "page",
        "entry": [{"messaging": [{
            "sender":    {"id": "111"},
            "recipient": {"id": "PAGE_ID"},
            "delivery":  {"mids": ["m"], "watermark": 1},
        }]}],
    }
    assert MessengerBridge.parse_inbound(payload) == []
    return True


def test_msg_parse_wrong_object():
    from src.services.meta_bridge import MessengerBridge
    assert MessengerBridge.parse_inbound({"object": "instagram", "entry": []}) == []
    return True


check("Messenger parse: India text",    test_msg_parse_text_india)
check("Messenger parse: Colombia text", test_msg_parse_text_colombia)
check("Messenger parse: echoes filtered",    test_msg_parse_echo_filtered)
check("Messenger parse: deliveries filtered", test_msg_parse_delivery_filtered)
check("Messenger parse: non-page object rejected", test_msg_parse_wrong_object)


# ── 9. Agent call path (monkey-patched) ──────────────────────────────────────

banner("9. handle() agent call path — fake agent + fake send")


def test_wa_handle_calls_agent_and_send():
    from src.services import meta_bridge as mb

    captured = {"session_id": None, "channel": None, "sent_to": None, "sent_text": None}

    async def fake_agent_call(message, session_id, channel, sender_name=None, phone=None):
        captured["session_id"] = session_id
        captured["channel"]    = channel
        captured["phone"]      = phone
        return f"ECHO::{message}"

    async def fake_send(to, text):
        captured["sent_to"]   = to
        captured["sent_text"] = text
        return True

    orig_agent = mb._call_agent
    orig_send  = mb.WhatsAppBridge.send_text
    mb._call_agent             = fake_agent_call   # type: ignore
    mb.WhatsAppBridge.send_text = staticmethod(fake_send)  # type: ignore

    try:
        payload = _wa_payload_text("919876543210", "ping from india")
        asyncio.run(mb.WhatsAppBridge.handle(payload))
    finally:
        mb._call_agent             = orig_agent
        mb.WhatsAppBridge.send_text = staticmethod(orig_send)

    assert captured["session_id"] == "whatsapp_919876543210", f"got {captured['session_id']}"
    assert captured["channel"]    == "whatsapp"
    assert captured["phone"]      == "+919876543210"
    assert captured["sent_to"]    == "919876543210"
    assert captured["sent_text"]  == "ECHO::ping from india"
    return True


def test_msg_handle_calls_agent_and_send():
    from src.services import meta_bridge as mb

    captured = {}

    async def fake_agent_call(message, session_id, channel, sender_name=None, phone=None):
        captured["session_id"] = session_id
        captured["channel"]    = channel
        return f"ECHO::{message}"

    async def fake_send(psid, text):
        captured["sent_to"]   = psid
        captured["sent_text"] = text
        return True

    orig_agent = mb._call_agent
    orig_send  = mb.MessengerBridge.send_text
    mb._call_agent              = fake_agent_call  # type: ignore
    mb.MessengerBridge.send_text = staticmethod(fake_send)  # type: ignore

    try:
        payload = _msg_payload_text("PSID_57_xyz", "hola amina")
        asyncio.run(mb.MessengerBridge.handle(payload))
    finally:
        mb._call_agent              = orig_agent
        mb.MessengerBridge.send_text = staticmethod(orig_send)

    assert captured["session_id"] == "messenger_PSID_57_xyz"
    assert captured["channel"]    == "messenger"
    assert captured["sent_to"]    == "PSID_57_xyz"
    assert captured["sent_text"]  == "ECHO::hola amina"
    return True


check("WhatsApp handle: agent called + reply sent",  test_wa_handle_calls_agent_and_send)
check("Messenger handle: agent called + reply sent", test_msg_handle_calls_agent_and_send)


# ── Summary ──────────────────────────────────────────────────────────────────

banner("SUMMARY")
total  = len(results)
passed = sum(1 for _, ok, _ in results if ok)
failed = total - passed
color  = GREEN if failed == 0 else RED
print(f"  {color}{passed}/{total} passed{RESET}")
if failed:
    print(f"  {RED}FAILURES:{RESET}")
    for name, ok, err in results:
        if not ok:
            print(f"    - {name}: {err}")
    sys.exit(1)
print(f"  {GREEN}All sanity checks passed.{RESET}")
sys.exit(0)



