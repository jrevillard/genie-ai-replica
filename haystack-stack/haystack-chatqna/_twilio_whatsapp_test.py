"""
Twilio WhatsApp adapter — self-contained test suite.

Run inside the haystack-chatqna container:
    docker exec haystack-chatqna python /app/_twilio_whatsapp_test.py

Covers:
  * helpers: phone strip, hash redaction, TwiML build, reply trim
  * TwiML XML escaping (XSS-safe, valid XML)
  * Route happy path: text payload returns <Message>
  * Route unsupported: empty body returns canned UNSUPPORTED_TEXT
  * Route unsupported: media payload returns canned UNSUPPORTED_TEXT
  * Route fallback: agent returning ERROR_FALLBACK still produces valid TwiML
  * Independent _call_agent test: exception inside the agent is swallowed
"""
from __future__ import annotations

import asyncio
import os
import sys
import xml.etree.ElementTree as ET

# Bootstrap path
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Force defaults — the route module reads env at import time.
# IMPORTANT: explicitly clear ACCOUNT_SID so the sync TwiML path is the
# active one for the inherited test cases below. The new async path has
# its own dedicated section at the end of the file.
os.environ["TWILIO_AUTH_TOKEN"]         = ""
os.environ["TWILIO_ACCOUNT_SID"]        = ""
os.environ["TWILIO_VALIDATE_SIGNATURE"] = "false"

passed = 0
failed = 0
errors: list = []


def section(name: str) -> None:
    print(f"\n=== {name} ===")


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


# ── 1. Helpers ────────────────────────────────────────────────────
section("1. Helpers")
from src.api.twilio_whatsapp_routes import (  # noqa: E402
    _strip_whatsapp_prefix,
    _hash_id,
    _twiml,
    _trim_reply,
    MAX_REPLY_CHARS,
    UNSUPPORTED_TEXT,
    ERROR_FALLBACK,
    EMPTY_AGENT_FALLBACK,
)

check("strip whatsapp: prefix",
      _strip_whatsapp_prefix("whatsapp:+2207700001234") == "+2207700001234")
check("strip handles plain phone",
      _strip_whatsapp_prefix("+2207700001234") == "+2207700001234")
check("strip handles empty string",
      _strip_whatsapp_prefix("") == "")
check("strip is idempotent",
      _strip_whatsapp_prefix(_strip_whatsapp_prefix("whatsapp:+220")) == "+220")

h = _hash_id("+2207700001234")
check("hash starts with sha256:",     h.startswith("sha256:"))
check("hash is 17 chars total",       len(h) == len("sha256:") + 10)
check("hash deterministic",
      _hash_id("+2207700001234") == _hash_id("+2207700001234"))
check("hash differs across inputs",
      _hash_id("+1") != _hash_id("+2"))
check("hash empty -> <empty>",        _hash_id("") == "<empty>")
check("hash never echoes input",      "+2207700001234" not in h)

# Reply trimming
short = _trim_reply("hello")
check("trim_reply preserves short", short == "hello")
big = "x" * (MAX_REPLY_CHARS + 200)
trimmed = _trim_reply(big)
check("trim_reply caps at MAX_REPLY_CHARS", len(trimmed) <= MAX_REPLY_CHARS)
check("trim_reply ellipsis appended",       trimmed.endswith("…"))
check("trim_reply empty -> EMPTY_AGENT_FALLBACK",
      _trim_reply("") == EMPTY_AGENT_FALLBACK)
check("trim_reply whitespace-only -> EMPTY_AGENT_FALLBACK",
      _trim_reply("   \n\t  ") == EMPTY_AGENT_FALLBACK)


# ── 2. TwiML XML escaping ─────────────────────────────────────────
section("2. TwiML XML escaping")

twiml = _twiml("hello world")
check("twiml has xml prolog", twiml.startswith('<?xml'))
check("twiml has Response",   "<Response>" in twiml)
check("twiml has Message",    "<Message>"  in twiml)
check("twiml contains body",  "hello world" in twiml)

hostile = _twiml("<script>alert('xss')</script> & friends")
check("twiml escapes < to &lt;",      "<script>"   not in hostile)
check("twiml escapes & to &amp;",     "&amp;"      in hostile)
check("twiml does NOT preserve raw &", "& friends" not in hostile)

# Round-trip XML parse — the *wire format* must not contain raw <script>.
# After parsing, ElementTree decodes &lt; back to <, which is fine because
# WhatsApp renders the message as text, not HTML. The protection is
# structural: a malicious agent reply can never alter the XML structure.
parsed = ET.fromstring(hostile)
check("twiml is valid XML", parsed.tag == "Response")
msg_el = parsed.find("Message")
check("twiml has Message element", msg_el is not None)
text = (msg_el.text or "") if msg_el is not None else ""
check("parsed text round-trips alert content",  "alert" in text)
# Critical structural assertion: only ONE Response element, ONE Message child.
# A successful XSS would create extra elements via unescaped < > injection.
check("twiml has exactly one Response root",
      ET.fromstring(hostile).tag == "Response")
check("twiml has exactly one Message child",
      len(parsed.findall("Message")) == 1)
check("no script tag injected as XML element",
      parsed.find(".//script") is None)


# ── 3. Route — happy path (text payload) ──────────────────────────
section("3. Route — text payload returns Message TwiML")

from fastapi import FastAPI                          # noqa: E402
from fastapi.testclient import TestClient            # noqa: E402
import src.api.twilio_whatsapp_routes as twr         # noqa: E402

# Save and replace _call_agent so no real LLM is invoked.
_orig_call_agent = twr._call_agent

async def _fake_agent_echo(*, message, session_id, sender_name, phone):
    # Echo the input + the caller-supplied identifiers so we can verify
    # they were threaded correctly.
    return f"AMINA-ECHO::msg={message}|sid_prefix={session_id[:18]}|name={sender_name or 'NA'}|phone={phone or 'NA'}"

twr._call_agent = _fake_agent_echo

app = FastAPI()
app.include_router(twr.router, prefix="/api/v1")
client = TestClient(app)

resp = client.post(
    "/api/v1/twilio/whatsapp/webhook",
    data={
        "From":        "whatsapp:+2207700001234",
        "To":          "whatsapp:+14155238886",
        "Body":        "my BP is 145 over 90",
        "MessageSid":  "SMTEST_TEXT",
        "ProfileName": "Tester",
        "NumMedia":    "0",
    },
)
check("text 200",                resp.status_code == 200)
check("text content-type xml",   "xml" in resp.headers.get("content-type",""))
body = resp.text
check("text body has <Response>", "<Response>" in body)
check("text body has <Message>",  "<Message>"  in body)
check("text body invokes echo",   "AMINA-ECHO::" in body)
check("text body carries message",
      "msg=my BP is 145 over 90" in body)
check("text body session id is twilio_whatsapp_*",
      "sid_prefix=twilio_whatsapp_" in body)
check("text body carries ProfileName",
      "name=Tester" in body)
check("text body carries E164 phone",
      "phone=+2207700001234" in body)

# Body should NOT contain the raw whatsapp: prefix
check("body never contains 'whatsapp:' prefix",
      "whatsapp:+" not in body)


# ── 4. Route — empty body returns unsupported TwiML ───────────────
section("4. Route — empty body -> unsupported")

resp = client.post(
    "/api/v1/twilio/whatsapp/webhook",
    data={
        "From":       "whatsapp:+2207700001234",
        "To":         "whatsapp:+14155238886",
        "Body":       "",
        "MessageSid": "SMTEST_EMPTY",
        "NumMedia":   "0",
    },
)
check("empty body 200",                  resp.status_code == 200)
check("empty body returns unsupported",  UNSUPPORTED_TEXT in resp.text)
check("empty body still valid TwiML XML",
      ET.fromstring(resp.text).tag == "Response")
check("empty body did NOT call agent (no echo)",
      "AMINA-ECHO::" not in resp.text)


# ── 5. Route — media returns unsupported TwiML ────────────────────
section("5. Route — media -> unsupported")

resp = client.post(
    "/api/v1/twilio/whatsapp/webhook",
    data={
        "From":             "whatsapp:+2207700001234",
        "To":               "whatsapp:+14155238886",
        "Body":             "look at this",
        "MessageSid":       "SMTEST_MEDIA",
        "NumMedia":         "1",
        "MediaUrl0":        "https://api.twilio.com/example.jpg",
        "MediaContentType0":"image/jpeg",
    },
)
check("media 200",                   resp.status_code == 200)
check("media returns unsupported",   UNSUPPORTED_TEXT in resp.text)
check("media did NOT call agent",    "AMINA-ECHO::" not in resp.text)
check("media TwiML valid XML",
      ET.fromstring(resp.text).tag == "Response")


# ── 6. Route — agent error -> friendly fallback TwiML ─────────────
section("6. Route — agent fallback")

async def _agent_returns_fallback(*, message, session_id, sender_name, phone):
    # Mimic what _call_agent does on its own when the inner agent crashes.
    return ERROR_FALLBACK

twr._call_agent = _agent_returns_fallback

resp = client.post(
    "/api/v1/twilio/whatsapp/webhook",
    data={
        "From":       "whatsapp:+2207700009999",
        "To":         "whatsapp:+14155238886",
        "Body":       "trigger error",
        "MessageSid": "SMTEST_ERR",
        "NumMedia":   "0",
    },
)
check("error 200 (NEVER 5xx)",      resp.status_code == 200)
check("error returns ERROR_FALLBACK", ERROR_FALLBACK in resp.text)
check("error TwiML valid XML",
      ET.fromstring(resp.text).tag == "Response")


# ── 7. Independent _call_agent: exception inside agent is caught ──
section("7. _call_agent swallows agent exceptions")

twr._call_agent = _orig_call_agent  # restore real wrapper

# Patch get_agent so the wrapper's try/except trips.
import src.api.twilio_whatsapp_routes as twr2  # noqa: E402
class _BoomAgent:
    async def process_message(self, *args, **kwargs):
        raise RuntimeError("simulated LLM provider crash")

# We monkey-patch the import path the wrapper uses.
import sys as _sys
import types as _types
fake_mod = _types.ModuleType("src.agent.amina_agent")
def _fake_get_agent():
    return _BoomAgent()
fake_mod.get_agent = _fake_get_agent
_sys.modules["src.agent.amina_agent"] = fake_mod

reply = asyncio.run(twr2._call_agent(
    message="anything",
    session_id="twilio_whatsapp_x",
    sender_name=None,
    phone=None,
))
check("call_agent returns ERROR_FALLBACK on inner exception",
      reply == ERROR_FALLBACK)


# ── 8. /health probe ──────────────────────────────────────────────
section("8. /health probe (ops liveness)")

twr._call_agent = _fake_agent_echo  # not used here
resp = client.get("/api/v1/twilio/whatsapp/health")
check("health 200", resp.status_code == 200)
j = resp.json()
check("health channel is twilio_whatsapp", j.get("channel") == "twilio_whatsapp")
check("health status is ok",                j.get("status")  == "ok")
check("health has signature_validation key",
      "signature_validation" in j)
check("health has auth_token_present key",
      "auth_token_present" in j)
check("health does NOT echo any token",
      isinstance(j.get("auth_token_present"), bool))


# ── 9. Async mode (background REST API send) ──────────────────────
section("9. Async mode — empty TwiML ack + bg REST send")

# Activate async mode by setting both creds + reloading the module so
# ASYNC_MODE_AVAILABLE recomputes at import time.
os.environ["TWILIO_AUTH_TOKEN"]  = "fake-test-auth-token"
os.environ["TWILIO_ACCOUNT_SID"] = "ACfake1234567890fake1234567890fake"

import importlib
import src.api.twilio_whatsapp_routes as twr_async
importlib.reload(twr_async)

check("async_mode flag flips True when both creds set",
      twr_async.ASYNC_MODE_AVAILABLE is True)

# Capture what _send_via_twilio_rest is asked to send.
sent_payloads: list = []
async def _capture_rest(*, to, from_, body):
    sent_payloads.append({"to": to, "from": from_, "body": body})
    return (True, None)
twr_async._send_via_twilio_rest = _capture_rest

# Stub the agent so we don't need a real LLM.
async def _fake_agent_async(*, message, session_id, sender_name, phone):
    return f"ASYNC-REPLY::{message}"
twr_async._call_agent = _fake_agent_async

app_async = FastAPI()
app_async.include_router(twr_async.router, prefix="/api/v1")
client_async = TestClient(app_async)

resp = client_async.post(
    "/api/v1/twilio/whatsapp/webhook",
    data={
        "From":        "whatsapp:+918420736098",
        "To":          "whatsapp:+14155238886",
        "Body":        "hi async",
        "MessageSid":  "SMASYNC1",
        "ProfileName": "Async Tester",
        "NumMedia":    "0",
    },
)

check("async 200",                          resp.status_code == 200)
check("async returns EMPTY TwiML (<Response/>)",
      resp.text.strip().endswith("<Response/>"))
check("async response < 100 bytes (no Message body)",
      len(resp.text) < 100)
check("async response is valid XML",
      ET.fromstring(resp.text).tag == "Response")
check("async response has NO <Message> element",
      ET.fromstring(resp.text).find("Message") is None)

# FastAPI runs background tasks AFTER the response.
# TestClient awaits them synchronously, so by the time .post() returns
# the bg task has already completed.
check("async bg send was called exactly once",
      len(sent_payloads) == 1)
if sent_payloads:
    p = sent_payloads[0]
    check("async bg send: To preserves whatsapp: prefix",
          p["to"] == "whatsapp:+918420736098")
    check("async bg send: From is the inbound To (sandbox number)",
          p["from"] == "whatsapp:+14155238886")
    check("async bg send: body contains agent reply",
          "ASYNC-REPLY::hi async" in p["body"])

# Async mode also still does unsupported-media canned response (no bg send).
sent_payloads.clear()
resp = client_async.post(
    "/api/v1/twilio/whatsapp/webhook",
    data={
        "From":       "whatsapp:+918420736098",
        "To":         "whatsapp:+14155238886",
        "Body":       "",
        "MessageSid": "SMASYNC_EMPTY",
        "NumMedia":   "0",
    },
)
check("async empty-body still returns inline UNSUPPORTED_TEXT",
      twr_async.UNSUPPORTED_TEXT in resp.text)
check("async empty-body did NOT schedule bg send",
      len(sent_payloads) == 0)

# Health endpoint exposes the new fields.
resp = client_async.get("/api/v1/twilio/whatsapp/health")
j = resp.json()
check("health exposes async_mode=True",      j.get("async_mode") is True)
check("health exposes account_sid_present",  j.get("account_sid_present") is True)
check("health does NOT echo ACCOUNT_SID value",
      isinstance(j.get("account_sid_present"), bool))


# ── Final ─────────────────────────────────────────────────────────
print(f"\n=== Result: {passed} passed / {failed} failed ===")
if failed:
    print("FAILED tests:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
sys.exit(0)
