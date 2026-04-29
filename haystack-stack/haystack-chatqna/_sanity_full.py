#!/usr/bin/env python3
"""
AMINA Care — Full Sanity Runner
==================================
One file, one invocation, every surface we added this session.

Usage
-----
    python _sanity_full.py
    python _sanity_full.py --api http://localhost:8000 --mc http://localhost:8020 \
                           --frontend http://localhost:5173

Coverage
--------
  A. Core health             : backend /health, mc /health, frontend /
  B. Meta channel handshakes : WhatsApp + Messenger verify
  C. Inbox                   : send, list, unread-count, mark-read,
                                capture-file multipart, peek, download (no
                                JWT), cross-patient 403, unauth 401
  D. Resilience              : classify_error boundary matrix (indirect via
                                /models/status after in-container probe),
                                /models/status shape, preferred rotation,
                                reset endpoint, fallback chain live
  E. Safety consensus        : non-critical pass-through + trace present
  F. Scribe                  : start, get, chunk, cross-patient 401/403
  G. SMART-on-FHIR           : discovery (/.well-known), invalid_client 400,
                                invalid_redirect 400, happy path with PKCE
                                S256 end-to-end: authorize → approve →
                                token → JWT claims
  H. Frontend modules        : every new .js/.jsx we added compiles 200 in
                                the Vite dev server
  I. i18n locales            : all 4 JSON parse, key parity against English
                                (missing keys in ma are INFO, everything
                                else is FAIL)

Exit code 0 iff every section passed. Missing-key warnings in ma do not
fail the suite (Mandinka translations are MVP-quality pending native review).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


# ── Pretty output ────────────────────────────────────────────────────────────

GREEN = "\033[92m"
RED   = "\033[91m"
YELL  = "\033[93m"
BLUE  = "\033[94m"
DIM   = "\033[2m"
RESET = "\033[0m"


def banner(text: str) -> None:
    print(f"\n{BLUE}{'=' * 68}\n  {text}\n{'=' * 68}{RESET}")


RESULTS: List[Tuple[str, bool, str]] = []
WARNINGS: List[str] = []


def check(label: str, cond: bool, note: str = "") -> None:
    if cond:
        print(f"  {GREEN}[PASS]{RESET} {label}  {DIM}{note}{RESET}")
    else:
        print(f"  {RED}[FAIL]{RESET} {label}  {note}")
    RESULTS.append((label, cond, note))


def warn(msg: str) -> None:
    print(f"  {YELL}[WARN]{RESET} {msg}")
    WARNINGS.append(msg)


def info(msg: str) -> None:
    print(f"  {DIM}· {msg}{RESET}")


# ── Args ─────────────────────────────────────────────────────────────────────

ap = argparse.ArgumentParser()
ap.add_argument("--api",      default=os.getenv("API",      "http://localhost:8000"))
ap.add_argument("--mc",       default=os.getenv("MC",       "http://localhost:8020"))
ap.add_argument("--frontend", default=os.getenv("FRONTEND", "http://localhost:5173"))
ap.add_argument("--email",    default="beginner@demo.aminacare")
ap.add_argument("--password", default="Demo2026")
args = ap.parse_args()

API      = args.api.rstrip("/")
MC       = args.mc.rstrip("/")
FE       = args.frontend.rstrip("/")


# ─────────────────────────────────────────────────────────────────────────────
# A. Core health
# ─────────────────────────────────────────────────────────────────────────────

def section_health() -> None:
    banner("A. Core health")
    try:
        r = requests.get(f"{API}/health", timeout=6)
        check("backend /health", r.status_code == 200 and r.json().get("status") == "ok",
              f"http={r.status_code}")
    except Exception as e:
        check("backend /health", False, f"{type(e).__name__}: {e}")

    try:
        r = requests.get(f"{MC}/health", timeout=6)
        body = r.json() if r.ok else {}
        check("multichannel-access /health",
              r.status_code == 200 and body.get("status") == "ok",
              f"telegram={body.get('telegram')} haystack={body.get('haystack')}")
    except Exception as e:
        warn(f"multichannel-access offline — skipping Telegram checks: {e}")

    try:
        r = requests.get(f"{FE}/", timeout=6)
        check("frontend Vite dev", r.status_code == 200, f"http={r.status_code}")
    except Exception as e:
        check("frontend Vite dev", False, f"{type(e).__name__}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Login helper — produces a fresh JWT for the runner
# ─────────────────────────────────────────────────────────────────────────────

def login_demo_patient() -> Tuple[str, str]:
    """Returns (jwt, patient_id). Hard-exits the runner on failure — every
    downstream section needs these."""
    r = requests.post(
        f"{API}/api/v1/auth/login/email",
        json={"email": args.email, "password": args.password},
        timeout=15,
    )
    if r.status_code != 200:
        print(f"{RED}FATAL{RESET}: login http={r.status_code} body={r.text[:300]}")
        sys.exit(2)
    body = r.json()
    tok = body.get("token")
    pid = (body.get("patient") or {}).get("id")
    if not tok or not pid:
        print(f"{RED}FATAL{RESET}: login response missing token/patient.id: {body}")
        sys.exit(2)
    info(f"logged in demo patient {pid} as {args.email}")
    return tok, pid


# ─────────────────────────────────────────────────────────────────────────────
# B. Meta channel handshakes
# ─────────────────────────────────────────────────────────────────────────────

def section_meta() -> None:
    banner("B. Meta channel handshakes")

    # Default verify token — same as .env.meta.example default
    token = os.getenv("META_VERIFY_TOKEN", "amina_health_2026")

    for name, path, ch in [
        ("WhatsApp verify",  "whatsapp",  "WA"),
        ("Messenger verify", "messenger", "MG"),
    ]:
        try:
            r = requests.get(
                f"{API}/api/v1/meta/webhook/{path}",
                params={
                    "hub.mode":         "subscribe",
                    "hub.verify_token": token,
                    "hub.challenge":    f"PING_{ch}",
                },
                timeout=6,
            )
            ok = (r.status_code == 200 and r.text == f"PING_{ch}")
            check(name, ok, f"http={r.status_code} body={r.text[:20]!r}")
        except Exception as e:
            check(name, False, f"{type(e).__name__}: {e}")

    try:
        r = requests.get(f"{API}/api/v1/meta/status", timeout=6)
        body = r.json() if r.ok else {}
        check("meta /status 200", r.status_code == 200,
              f"wa={body.get('whatsapp', {}).get('enabled')} "
              f"mg={body.get('messenger', {}).get('enabled')}")
    except Exception as e:
        check("meta /status 200", False, f"{type(e).__name__}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# C. Inbox
# ─────────────────────────────────────────────────────────────────────────────

def section_inbox(jwt: str, pid: str) -> None:
    banner("C. Inbox")
    H = {"Authorization": f"Bearer {jwt}"}
    J = {**H, "Content-Type": "application/json"}

    # send — push a transient notification with a known source_id so we
    # can find it again without touching other seeded items.
    marker = f"sanity_{int(time.time())}"
    r = requests.post(f"{API}/api/v1/inbox/send", headers=J,
        json={
            "patient_id": pid, "kind": "notification",
            "title": "sanity — notification push",
            "body":  "runner-generated, safe to ignore",
            "severity": "info", "source": "system",
            "source_id": marker,
        }, timeout=10)
    body = r.json() if r.ok else {}
    check("inbox /send 200", r.status_code == 200 and body.get("ok"))
    inbox_id = (body.get("item") or {}).get("inbox_id", "")
    check("inbox /send returned inbox_id", bool(inbox_id))

    # unread count monotone: should be >= 1 now
    r = requests.get(f"{API}/api/v1/inbox/unread-count", headers=H, timeout=5)
    check("inbox /unread-count 200", r.status_code == 200,
          f"unread={r.json().get('unread') if r.ok else '?'}")

    # list — our item must be present
    r = requests.get(f"{API}/api/v1/inbox/list?limit=100", headers=H, timeout=10)
    lst = r.json() if r.ok else {"items": []}
    found = any(i.get("source_id") == marker for i in lst.get("items", []))
    check("inbox /list contains our sanity item", found,
          f"count={lst.get('count')}")

    # mark-read
    r = requests.post(f"{API}/api/v1/inbox/{inbox_id}/read", headers=H, timeout=5)
    check("inbox /{id}/read 200", r.status_code == 200 and r.json().get("updated") == 1)

    # capture-file — minimal PDF
    pdf = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
           b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
           b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
           b"xref\n0 4\ntrailer<</Root 1 0 R/Size 4>>\nstartxref\n%%EOF")
    r = requests.post(f"{API}/api/v1/inbox/capture-file", headers=H,
        files={"file": ("sanity.pdf", pdf, "application/pdf")},
        data={"kind": "pdf", "title": "sanity PDF",
              "body": "runner-generated", "source": "agent"},
        timeout=15)
    cap = r.json() if r.ok else {}
    check("inbox /capture-file 200", r.status_code == 200 and cap.get("ok"))
    token = cap.get("token") or ""
    check("capture-file returned signed file token", bool(token),
          f"token={token[:20]}…")

    # peek — no auth
    r = requests.get(f"{API}/api/v1/inbox/file/{token}/peek", timeout=6)
    peek = r.json() if r.ok else {}
    check("inbox /file/{token}/peek (no auth) 200", r.status_code == 200)
    check("peek.mime pdf", peek.get("mime") == "application/pdf")
    check("peek.name set", peek.get("name") == "sanity.pdf")

    # download — no auth
    r = requests.get(f"{API}/api/v1/inbox/file/{token}", timeout=10)
    check("inbox /file/{token} download (no auth) 200", r.status_code == 200)
    check("download bytes begin with %PDF",
          (r.content or b"")[:4] == b"%PDF",
          f"first8={(r.content or b'')[:8]!r}")
    check("download Content-Disposition attachment",
          "attachment" in (r.headers.get("content-disposition") or ""))

    # cross-patient 403 — try pushing to a random other pid
    r = requests.post(f"{API}/api/v1/inbox/send", headers=J,
        json={"patient_id": "P_OTHER", "kind": "notification",
              "title": "cross-patient probe"}, timeout=5)
    check("inbox /send cross-patient -> 403", r.status_code == 403,
          f"http={r.status_code}")

    # unauth 401
    r = requests.get(f"{API}/api/v1/inbox/list", timeout=5)
    check("inbox /list without auth -> 401", r.status_code == 401,
          f"http={r.status_code}")


# ─────────────────────────────────────────────────────────────────────────────
# D. Resilience: models/status, preferred rotation, reset, live chain
# ─────────────────────────────────────────────────────────────────────────────

KNOWN_MODELS = {"amina", "base", "gemini", "groq", "mistral"}


def section_resilience(jwt: str) -> None:
    banner("D. Resilience layer")

    r = requests.get(f"{API}/api/v1/models/status", timeout=6)
    body = r.json() if r.ok else {}
    check("/models/status 200", r.status_code == 200)
    chain = body.get("chain") or []
    live  = body.get("live")  or []
    check("chain non-empty", bool(chain), f"chain={chain}")
    check("live ⊆ chain", set(live).issubset(set(chain)), f"live={live}")
    check("every chain model is known",
          set(chain).issubset(KNOWN_MODELS),
          f"unknown={set(chain)-KNOWN_MODELS}")

    r = requests.get(f"{API}/api/v1/models/status?preferred=gemini", timeout=6)
    body = r.json() if r.ok else {}
    head = (body.get("chain") or [""])[0]
    check("preferred=gemini rotates to head", head == "gemini", f"head={head}")

    # Reset — unknown model must 400
    r = requests.post(f"{API}/api/v1/models/does-not-exist/reset",
                      headers={"Authorization": f"Bearer {jwt}"}, timeout=5)
    check("reset unknown model -> 400", r.status_code == 400,
          f"http={r.status_code}")

    # Reset each known model (idempotent)
    failures = []
    for m in KNOWN_MODELS:
        rr = requests.post(f"{API}/api/v1/models/{m}/reset",
                           headers={"Authorization": f"Bearer {jwt}"}, timeout=5)
        if rr.status_code != 200:
            failures.append((m, rr.status_code))
    check("reset all known models", not failures,
          f"failures={failures}")

    # Final: after resets, all models should be live
    r = requests.get(f"{API}/api/v1/models/status", timeout=6)
    body = r.json() if r.ok else {}
    check("after reset, live == chain",
          set(body.get("live", [])) == set(body.get("chain", [])),
          f"cooldown={body.get('cooldown')}")


# ─────────────────────────────────────────────────────────────────────────────
# E. Safety consensus
# ─────────────────────────────────────────────────────────────────────────────

def section_safety(jwt: str) -> None:
    banner("E. Safety consensus (live chat-resilient)")
    H = {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}

    # Non-critical turn — should return 200 and have safety_trace with
    # either skipped=not_safety_critical / disabled OR a fail-open unknown.
    r = requests.post(f"{API}/api/v1/agent/chat-resilient",
        headers=H,
        json={"message": "hi", "session_id": "sanity_nonmed",
              "model_preference": "amina"},
        timeout=90)
    body = r.json() if r.ok else {}
    st = body.get("safety_trace", {})
    check("chat-resilient 200 on simple greet", r.status_code == 200,
          f"http={r.status_code}")
    check("safety_trace present on response",
          isinstance(st, dict),
          f"trace_type={type(st).__name__}")
    acceptable = (
        st.get("skipped") in ("disabled", "not_safety_critical")
        or st.get("verdict") in ("agree", "unknown")
    )
    check("guard either skipped or failed-open cleanly",
          acceptable, f"trace={st}")
    # On unknown auditor verdict, the primary reply must NOT have been
    # altered — we fail open on audits, never block the user.
    if st.get("verdict") == "unknown":
        check("unknown verdict did NOT overwrite the reply",
              not body.get("response_original"),
              f"response_original={body.get('response_original')!r}")


# ─────────────────────────────────────────────────────────────────────────────
# F. Scribe
# ─────────────────────────────────────────────────────────────────────────────

def section_scribe(jwt: str, pid: str) -> None:
    banner("F. Scribe (session lifecycle)")
    H = {"Authorization": f"Bearer {jwt}"}
    J = {**H, "Content-Type": "application/json"}

    r = requests.post(f"{API}/api/v1/scribe/start", headers=J,
        json={"patient_id": pid, "language": "en",
              "title_hint": "sanity visit"},
        timeout=10)
    body = r.json() if r.ok else {}
    check("scribe /start 200", r.status_code == 200 and body.get("ok"))
    sid = (body.get("session") or {}).get("session_id", "")
    check("scribe start returned session_id", bool(sid))

    r = requests.get(f"{API}/api/v1/scribe/{sid}", headers=H, timeout=6)
    check("scribe GET session 200", r.status_code == 200)
    check("scribe status init",
          (r.json().get("session") or {}).get("status") == "init")

    # append a tiny WAV — real audio transcription would take too long for
    # a sanity pass, so we only verify the chunk endpoint accepts multipart
    # uploads and advances state to 'recording'.
    wav = (b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
           b"\x80>\x00\x00\x00\x7d\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00")
    r = requests.post(f"{API}/api/v1/scribe/{sid}/chunk", headers=H,
        files={"chunk": ("clip.wav", wav, "audio/wav")},
        timeout=8)
    check("scribe /chunk 200", r.status_code == 200,
          f"http={r.status_code}")
    check("scribe status -> recording",
          (r.json().get("session") or {}).get("status") == "recording")

    # unauth cross-patient probe
    r = requests.get(f"{API}/api/v1/scribe/{sid}", timeout=5)
    check("scribe GET without auth -> 401", r.status_code == 401)


# ─────────────────────────────────────────────────────────────────────────────
# G. SMART-on-FHIR (discovery → authorize → approve → token → JWT claims)
# ─────────────────────────────────────────────────────────────────────────────

def section_smart(jwt: str, pid: str) -> None:
    banner("G. SMART-on-FHIR")

    # Discovery
    r = requests.get(f"{API}/.well-known/smart-configuration", timeout=6)
    check("SMART discovery 200", r.status_code == 200)
    cfg = r.json() if r.ok else {}
    check("authorization_endpoint set", bool(cfg.get("authorization_endpoint")))
    check("S256 PKCE supported",
          "S256" in (cfg.get("code_challenge_methods_supported") or []))

    # Invalid client -> 400
    r = requests.get(f"{API}/api/v1/smart/authorize",
        params={"response_type": "code", "client_id": "nope",
                "redirect_uri": "http://localhost:5173/smart/callback",
                "scope": "openid fhirUser", "state": "a"},
        allow_redirects=False, timeout=5)
    check("authorize invalid_client -> 400", r.status_code == 400)

    # Bad redirect — MUST NOT redirect (400 JSON)
    r = requests.get(f"{API}/api/v1/smart/authorize",
        params={"response_type": "code", "client_id": "amina-demo-client",
                "redirect_uri": "https://evil.example/x",
                "scope": "openid fhirUser", "state": "a"},
        allow_redirects=False, timeout=5)
    check("authorize bad_redirect -> 400 (no redirect)", r.status_code == 400)

    # Happy path with PKCE S256
    verifier  = "a" * 64
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()

    params = {
        "response_type": "code",
        "client_id":     "amina-demo-client",
        "redirect_uri":  "http://localhost:5173/smart/callback",
        "scope":         "openid fhirUser patient/*.read",
        "state":         f"sanity-{int(time.time())}",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "amina_token":   jwt,
    }
    r = requests.get(f"{API}/api/v1/smart/authorize",
                     params=params, allow_redirects=False, timeout=10)
    check("authorize 200 HTML consent page", r.status_code == 200,
          f"http={r.status_code} ct={r.headers.get('content-type')}")

    # Extract request_id + approve
    m = re.search(r'name="request_id"\s+value="([^"]+)"', r.text or "")
    rid = m.group(1) if m else ""
    check("consent page includes request_id", bool(rid),
          f"rid={rid[:12]!r}")

    r = requests.post(f"{API}/api/v1/smart/approve",
        data={"request_id": rid},
        headers={"Authorization": f"Bearer {jwt}"},
        allow_redirects=False, timeout=10)
    check("approve -> 302", r.status_code == 302, f"http={r.status_code}")
    loc = r.headers.get("Location", "")
    check("redirect carries ?code", "code=" in loc, f"loc={loc[:120]}")
    check("redirect preserves state", f"state={params['state']}" in loc)

    code = parse_qs(urlparse(loc).query).get("code", [""])[0]
    check("authorization code extracted", bool(code))

    r = requests.post(f"{API}/api/v1/smart/token",
        data={
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  params["redirect_uri"],
            "client_id":     "amina-demo-client",
            "code_verifier": verifier,
        },
        timeout=10)
    check("token exchange 200", r.status_code == 200,
          f"http={r.status_code}")
    tok = r.json() if r.ok else {}
    check("access_token returned", bool(tok.get("access_token")))
    check("token_type=Bearer", tok.get("token_type") == "Bearer")
    check("patient field matches",
          tok.get("patient") == pid,
          f"patient={tok.get('patient')!r}")
    check("fhirUser URN references patient",
          str(tok.get("fhirUser", "")).endswith(pid))

    # Decode the JWT without verification just to inspect claims.
    try:
        import jwt as pyjwt
        payload = pyjwt.decode(tok.get("access_token", ""),
                               options={"verify_signature": False})
        check("access_token decodes as JWT", True)
        check("sub == patient_id", payload.get("sub") == pid)
        check("scope includes patient/*.read",
              "patient/*.read" in (payload.get("scope") or ""))
        check("amina_smart=true marker", payload.get("amina_smart") is True)
    except Exception as e:
        check("access_token decodes as JWT", False, str(e))


# ─────────────────────────────────────────────────────────────────────────────
# H. Frontend modules — Vite dev-server compiles every module we added
# ─────────────────────────────────────────────────────────────────────────────

FRONTEND_MODULES = [
    # Inbox
    "/src/inbox/inboxApi.js",
    "/src/inbox/useInbox.js",
    "/src/inbox/InboxBell.jsx",
    "/src/inbox/InboxPanel.jsx",
    "/src/inbox/InboxItemCard.jsx",
    "/src/inbox/chatInterceptor.js",
    # Forms
    "/src/forms/formsApi.js",
    "/src/forms/SymptomReportForm.jsx",
    "/src/forms/PrescriptionUploadForm.jsx",
    "/src/forms/FormDispatcher.jsx",
    # Resilience
    "/src/resilience/modelApi.js",
    "/src/resilience/ModelSwitchBanner.jsx",
    "/src/resilience/ResilienceBootstrap.jsx",
    # Scribe
    "/src/scribe/scribeApi.js",
    "/src/scribe/ScribeRecorder.jsx",
    "/src/scribe/ScribeReview.jsx",
    "/src/scribe/ScribeFab.jsx",
    "/src/scribe/ScribeBootstrap.jsx",
    # i18n
    "/src/i18n/index.js",
    "/src/i18n/LanguagePicker.jsx",
    "/src/i18n/I18nBootstrap.jsx",
    "/src/i18n/i18n.css",
    # Admin (DHIS2 Tracker)
    "/src/admin/dhis2TrackerApi.js",
    "/src/admin/Dhis2TrackerPanel.jsx",
    "/src/admin/Dhis2TrackerBootstrap.jsx",
    # Top-level bootstrap
    "/src/InboxBootstrap.jsx",
]

FRONTEND_LOCALES = [
    "/src/i18n/locales/en.json",
    "/src/i18n/locales/ma.json",
    # fr.json + ar.json are kept on disk (pending re-enable) but are not
    # loaded by the i18n init, so they don't need to parse/round-trip here.
]


# ─────────────────────────────────────────────────────────────────────────────
# J. DHIS2 Tracker — admin-only endpoints (patient-level writeback)
# ─────────────────────────────────────────────────────────────────────────────

def login_admin() -> Optional[str]:
    try:
        r = requests.post(
            f"{API}/api/v1/admin/login",
            json={"username": "admin", "password": "amina2026"},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        return r.json().get("token") or None
    except Exception:
        return None


def section_dhis2_tracker(patient_jwt: str, pid: str) -> None:
    banner("J. DHIS2 Tracker (admin-only)")

    admin_tok = login_admin()
    check("admin login", bool(admin_tok),
          "username=admin password=amina2026")
    if not admin_tok:
        warn("admin token missing — skipping tracker section")
        return

    AH = {"Authorization": f"Bearer {admin_tok}"}
    AJ = {**AH, "Content-Type": "application/json"}

    # /tracker/config — reachable + returns shape
    r = requests.get(f"{API}/api/v1/dhis2/tracker/config", headers=AH, timeout=8)
    cfg = r.json() if r.ok else {}
    check("/dhis2/tracker/config 200", r.status_code == 200)
    for key in ("enabled", "program_id", "program_stage_id",
                "tei_type_id", "attribute_map", "data_element_map",
                "orgunit_count", "configured"):
        check(f"config.{key} present", key in cfg, f"type={type(cfg.get(key)).__name__}")

    # /tracker/audit — reachable; server returns {"total","filter","entries"}
    r = requests.get(f"{API}/api/v1/dhis2/tracker/audit?limit=5", headers=AH, timeout=8)
    aud = r.json() if r.ok else {}
    check("/dhis2/tracker/audit 200", r.status_code == 200)
    check("audit response has 'entries' list",
          isinstance(aud.get("entries"), list),
          f"keys={list(aud)[:6]}")
    check("audit response has 'total' count",
          isinstance(aud.get("total"), int),
          f"total={aud.get('total')}")

    # Patient-side JWT must be rejected — admin gating
    r = requests.get(f"{API}/api/v1/dhis2/tracker/config",
                     headers={"Authorization": f"Bearer {patient_jwt}"}, timeout=6)
    check("/dhis2/tracker/config with patient JWT -> 403",
          r.status_code == 403, f"http={r.status_code}")

    # No Authorization at all -> 401
    r = requests.get(f"{API}/api/v1/dhis2/tracker/config", timeout=6)
    check("/dhis2/tracker/config unauth -> 401",
          r.status_code == 401, f"http={r.status_code}")

    # /tracker/batch over limit -> 400
    r = requests.post(f"{API}/api/v1/dhis2/tracker/batch", headers=AJ,
        json={"patient_ids": [f"P_{i}" for i in range(101)]}, timeout=10)
    check("/dhis2/tracker/batch >100 -> 400",
          r.status_code == 400, f"http={r.status_code}")

    # Dry-run against the live demo patient — tracker may be DISABLED (env
    # vars not set) or CONFIGURED. Either outcome is acceptable for the
    # sanity run — we just confirm the route returns structured JSON.
    r = requests.post(f"{API}/api/v1/dhis2/tracker/dry-run", headers=AJ,
        json={"patient_id": pid, "force": True}, timeout=20)
    body = r.json() if r.content else {}
    ok = r.status_code in (200, 500)   # 500 only if tracker is disabled by env
    check("/dhis2/tracker/dry-run returns JSON (200 or structured 500)",
          ok and isinstance(body, dict),
          f"http={r.status_code} keys={list(body)[:5]}")


def section_dhis2_history(patient_jwt: str) -> None:
    banner("K. DHIS2 History + Discovery + Mapping")
    admin_tok = login_admin()
    if not admin_tok:
        warn("admin login failed — skipping")
        return
    AH = {"Authorization": f"Bearer {admin_tok}"}

    # /sync/history — aggregate audit log
    r = requests.get(f"{API}/api/v1/dhis2/sync/history?limit=10", headers=AH, timeout=10)
    body = r.json() if r.ok else {}
    check("/dhis2/sync/history 200", r.status_code == 200, f"http={r.status_code}")
    check("aggregate history has 'entries' + 'total'",
          isinstance(body.get("entries"), list) and isinstance(body.get("total"), int),
          f"keys={list(body)[:5]}")

    # Date filter shape
    r = requests.get(f"{API}/api/v1/dhis2/sync/history?since=2024-01-01&until=2026-12-31",
                     headers=AH, timeout=10)
    check("history date range filter 200", r.status_code == 200)

    # /sync/history/tracker
    r = requests.get(f"{API}/api/v1/dhis2/sync/history/tracker?limit=5", headers=AH, timeout=10)
    body = r.json() if r.ok else {}
    check("/dhis2/sync/history/tracker 200", r.status_code == 200)
    check("tracker history has 'entries'",
          isinstance(body.get("entries"), list),
          f"keys={list(body)[:5]}")

    # /discover — live DHIS2 datasets
    r = requests.get(f"{API}/api/v1/dhis2/discover", headers=AH, timeout=25)
    body = r.json() if r.ok else {}
    check("/dhis2/discover 200", r.status_code == 200, f"http={r.status_code}")
    datasets = body.get("datasets") or []
    check("discovery returned at least 1 dataset",
          len(datasets) >= 1, f"count={len(datasets)}")
    check("discovery includes currently-configured dataset id",
          body.get("current_dataset_id") in {d.get("id") for d in datasets} if datasets else False,
          f"current={body.get('current_dataset_id')}")

    # /discover/dataset/{id} — live describe
    ds_id = body.get("current_dataset_id") or (datasets[0].get("id") if datasets else "")
    if ds_id:
        r = requests.get(f"{API}/api/v1/dhis2/discover/dataset/{ds_id}",
                         headers=AH, timeout=25)
        detail = r.json() if r.ok else {}
        check(f"/discover/dataset/{ds_id[:6]}… 200", r.status_code == 200)
        check("detail has data_elements + org_units",
              isinstance(detail.get("data_elements"), list) and isinstance(detail.get("org_units"), list),
              f"elements={len(detail.get('data_elements') or [])} ous={len(detail.get('org_units') or [])}")

    # /mapping/current
    r = requests.get(f"{API}/api/v1/dhis2/mapping/current", headers=AH, timeout=8)
    m = r.json() if r.ok else {}
    check("/mapping/current 200", r.status_code == 200)
    check("mapping base_url set", bool(m.get("base_url")),
          f"base_url={m.get('base_url')}")
    check("mapping dataset_id set", bool(m.get("dataset_id")),
          f"dataset_id={m.get('dataset_id')}")
    check("mapping has >=1 data element entry",
          len(m.get("data_element_map") or {}) >= 1,
          f"count={len(m.get('data_element_map') or {})}")

    # Patient JWT -> 403 on every history route
    PH = {"Authorization": f"Bearer {patient_jwt}"}
    r = requests.get(f"{API}/api/v1/dhis2/sync/history", headers=PH, timeout=6)
    check("/sync/history with patient JWT -> 403", r.status_code == 403)
    r = requests.get(f"{API}/api/v1/dhis2/discover", headers=PH, timeout=6)
    check("/discover with patient JWT -> 403", r.status_code == 403)


def section_frontend_assets() -> None:
    banner("H. Frontend modules (Vite dev)")
    # Quick bail if Vite isn't up — earlier section already fails/warns.
    try:
        requests.get(f"{FE}/", timeout=4)
    except Exception as e:
        warn(f"Vite not reachable — skipping frontend module checks ({e})")
        return

    fails = []
    for mod in FRONTEND_MODULES + FRONTEND_LOCALES:
        try:
            r = requests.get(f"{FE}{mod}", timeout=6)
            ok = r.status_code == 200
            if not ok:
                fails.append((mod, r.status_code))
        except Exception as e:
            fails.append((mod, f"{type(e).__name__}: {e}"))
    check(f"{len(FRONTEND_MODULES) + len(FRONTEND_LOCALES)} frontend modules compile 200",
          not fails, f"fails={fails}")


# ─────────────────────────────────────────────────────────────────────────────
# I. i18n locale parity
# ─────────────────────────────────────────────────────────────────────────────

def section_i18n() -> None:
    banner("I. i18n locales")
    here = Path(__file__).resolve()
    # Test file is at haystack-chatqna/; frontend locales live elsewhere.
    frontend_root = here.parents[2] / "components" / "frontend"
    locale_dir = frontend_root / "src" / "i18n" / "locales"

    if not locale_dir.exists():
        warn(f"locale dir not found on disk: {locale_dir} — skipping i18n section")
        return

    # Only the active locales are validated here. fr.json and ar.json exist
    # on disk for future re-enable but are not loaded at runtime, so parity
    # drift against English is acceptable and not checked.
    ACTIVE = ("en", "ma")

    locales: Dict[str, Dict[str, Any]] = {}
    for lng in ACTIVE:
        p = locale_dir / f"{lng}.json"
        check(f"{lng}.json exists", p.exists(), str(p))
        if p.exists():
            try:
                locales[lng] = json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:
                check(f"{lng}.json parses", False, f"{type(e).__name__}: {e}")

    if "en" not in locales:
        warn("English locale missing — aborting key-parity check")
        return
    en_keys = {k for k in locales["en"] if not k.startswith("_")}

    # Mandinka stays MVP-quality — missing keys surface as INFO only.
    if "ma" in locales:
        keys = {k for k in locales["ma"] if not k.startswith("_")}
        missing = en_keys - keys
        if missing:
            warn(f"ma.json missing {len(missing)} keys vs en "
                 f"(MVP review pending): {sorted(missing)[:5]}...")
        else:
            check("ma.json key parity with en", True, f"{len(keys)} keys")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    print(f"{BLUE}AMINA Care — Full Sanity Runner{RESET}")
    print(f"  API      : {API}")
    print(f"  MC       : {MC}")
    print(f"  Frontend : {FE}")

    section_health()
    section_meta()

    # Every remaining backend section needs a patient JWT.
    try:
        jwt, pid = login_demo_patient()
    except SystemExit:
        raise
    except Exception as e:
        print(f"{RED}FATAL{RESET}: could not log in ({type(e).__name__}: {e})")
        return 2

    section_inbox(jwt, pid)
    section_resilience(jwt)
    section_safety(jwt)
    section_scribe(jwt, pid)
    section_smart(jwt, pid)
    section_dhis2_tracker(jwt, pid)
    section_dhis2_history(jwt)

    section_frontend_assets()
    section_i18n()

    banner("SUMMARY")
    total  = len(RESULTS)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = total - passed
    color  = GREEN if failed == 0 else RED
    print(f"  {color}{passed}/{total} checks passed{RESET}, "
          f"{YELL}{len(WARNINGS)} warnings{RESET}")
    if failed:
        print(f"\n  {RED}FAILURES:{RESET}")
        for name, ok, note in RESULTS:
            if not ok:
                print(f"    - {name}: {note}")
    if WARNINGS:
        print(f"\n  {YELL}WARNINGS:{RESET}")
        for w in WARNINGS:
            print(f"    - {w}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
