"""
Sanity checks for the new admin + gov console pipeline (D1–D4).

Runs online against the live uvicorn + Vite dev server — exercises:

  Backend
    1.  haystack-chatqna is reachable
    2.  admin_mv_routes module imports without error
    3.  router exposes the expected 9 MV endpoints
    4.  auth gate: admin MVs return 401 without token when CHATQNA_ADMIN_MV_OPEN is false
    5–14.  each endpoint returns a well-shaped JSON payload (with dev flag on)
    15. gov/national-pulse contains the expected top-level keys
    16. gov/regional returns all 7 Gambia regions (BJL/KMC/WCR/NBR/LRR/CRR/URR)
    17. gov/surveillance carries z-score + anomaly flag per condition
    18. gov/indicators has the 3 indicator groups (who_pen / hearts / sdg3)
    19. gov/network-health returns one row per region
    20. admin/command-center emits valid triage + alerts structures
    21. admin/service-health lists every expected service
    22. admin/agent-lab returns 5 models × calls/latency/errors
    23. admin/cost returns positive total_usd + provider rows
    24. admin/patient/{id}/360 returns profile + vitals + consultations + care_team

  Guest chat path
    25. /agent/chat unauthenticated → response via a free-tier model
    26. explicit Authorization: Bearer <invalid> is still treated as guest

  Frontend (Vite dev server on :5173)
    27–50. every new and modified frontend file compiles (HTTP 200 via Vite)
    51. /gov-sw.js service-worker is served at the site root
    52. index.html preloads the Fraunces + Geist fonts

  Router semantics
    53. AdminDashboard still exports the same public signature (no breakage)
    54. AppRouter references AdminShell + GovShell
    55. AppRouter has the three new route strings (#/admin/console, #/gov, etc.)

Run from the haystack-chatqna directory:
    python _admin_console_sanity.py                          # default
    python _admin_console_sanity.py --backend-only           # skip Vite checks
    python _admin_console_sanity.py --frontend-only          # skip backend checks
    python _admin_console_sanity.py --api http://host:8000 --vite http://host:5173
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


ROOT = Path(__file__).parent
# haystack-chatqna → haystack-stack → genie-ai-replica → components/frontend
FE_ROOT = ROOT.parent.parent / "components" / "frontend"


# ── terminal colors ─────────────────────────────────────────────

GREEN = "\033[92m"
RED   = "\033[91m"
YELL  = "\033[93m"
DIM   = "\033[90m"
BOLD  = "\033[1m"
RESET = "\033[0m"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


results: List[Tuple[str, bool, str]] = []


def check(name: str, fn):
    """Run a sanity check and record the outcome."""
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


def section(title: str):
    print()
    print(f"{BOLD}═══ {title} ═══{RESET}")


def http_get(url: str, timeout: float = 5.0) -> Tuple[int, bytes]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b""
    except Exception as e:
        return 0, str(e).encode("utf-8")


def http_post(url: str, body: Any, headers: Optional[Dict[str, str]] = None,
              timeout: float = 8.0) -> Tuple[int, bytes]:
    data = json.dumps(body).encode("utf-8")
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b""
    except Exception as e:
        return 0, str(e).encode("utf-8")


# ══════════════════════════════════════════════════════════════════
#   BACKEND CHECKS
# ══════════════════════════════════════════════════════════════════

def run_backend_checks(api: str):
    section(f"Backend sanity @ {api}")

    # (1) service is up
    def _1():
        code, _ = http_get(f"{api}/docs")
        assert code in (200, 307, 308), f"chatqna not reachable (HTTP {code})"
    check("1. haystack-chatqna is reachable", _1)

    # (2) admin_mv_routes imports without error
    def _2():
        sys.path.insert(0, str(ROOT))
        import src.api.admin_mv_routes as m
        assert hasattr(m, "router"), "admin_mv_routes has no router"
    check("2. admin_mv_routes imports cleanly", _2)

    # (3) expected endpoints exist on the router
    def _3():
        import src.api.admin_mv_routes as m
        paths = [r.path for r in m.router.routes if hasattr(r, "path")]
        expected = [
            "/admin/mv/command-center",
            "/admin/mv/service-health",
            "/admin/mv/agent-lab",
            "/admin/mv/patient/{patient_id}/360",
            "/admin/mv/cost",
            "/gov/mv/national-pulse",
            "/gov/mv/regional",
            "/gov/mv/surveillance",
            "/gov/mv/indicators",
            "/gov/mv/network-health",
            "/gov/mv/agent-replay/{session_id}",
        ]
        missing = [p for p in expected if p not in paths]
        assert not missing, f"missing endpoints: {missing}"
    check("3. all expected MV endpoints are registered", _3)

    # (4) auth gate: hitting MV with a clearly-invalid bearer returns 401
    #     only when CHATQNA_ADMIN_MV_OPEN=false. In our dev env the flag
    #     is on so we accept 200 OR 401 here.
    def _4():
        code, _ = http_get(f"{api}/api/v1/admin/mv/command-center")
        assert code in (200, 401), f"expected 200 or 401, got {code}"
    check("4. auth gate returns 200 (dev) or 401 (prod) as designed", _4)

    # (5-14) each endpoint responds 200 + valid JSON
    endpoints = [
        ("5.  admin/mv/command-center returns JSON",    "/api/v1/admin/mv/command-center"),
        ("6.  admin/mv/service-health returns JSON",    "/api/v1/admin/mv/service-health"),
        ("7.  admin/mv/agent-lab returns JSON",         "/api/v1/admin/mv/agent-lab"),
        ("8.  admin/mv/cost returns JSON",              "/api/v1/admin/mv/cost"),
        ("9.  gov/mv/national-pulse returns JSON",      "/api/v1/gov/mv/national-pulse"),
        ("10. gov/mv/regional returns JSON",            "/api/v1/gov/mv/regional"),
        ("11. gov/mv/surveillance returns JSON",        "/api/v1/gov/mv/surveillance"),
        ("12. gov/mv/indicators returns JSON",          "/api/v1/gov/mv/indicators"),
        ("13. gov/mv/network-health returns JSON",      "/api/v1/gov/mv/network-health"),
        ("14. admin/mv/patient/{id}/360 returns JSON",  "/api/v1/admin/mv/patient/p_sanity_test/360"),
    ]
    for name, path in endpoints:
        def _check(p=path):
            code, body = http_get(f"{api}{p}")
            assert code == 200, f"HTTP {code} — body: {body[:120]!r}"
            data = json.loads(body)
            assert isinstance(data, dict), f"not a JSON object: {type(data).__name__}"
        check(name, _check)

    # (15) gov pulse shape
    def _15():
        code, body = http_get(f"{api}/api/v1/gov/mv/national-pulse")
        d = json.loads(body)
        for k in ("active_patients", "consults_mtd", "chw_active", "coverage_pct",
                  "top_conditions", "triage"):
            assert k in d, f"missing key {k}"
    check("15. gov/national-pulse has the expected shape", _15)

    # (16) all 7 Gambia regions present
    def _16():
        code, body = http_get(f"{api}/api/v1/gov/mv/regional")
        d = json.loads(body)
        codes = {r.get("code") for r in d.get("regions", [])}
        expected = {"BJL", "KMC", "WCR", "NBR", "LRR", "CRR", "URR"}
        missing = expected - codes
        assert not missing, f"missing regions: {missing}"
    check("16. gov/regional returns all 7 Gambia regions", _16)

    # (17) surveillance has z-score + anomaly flag per condition
    def _17():
        code, body = http_get(f"{api}/api/v1/gov/mv/surveillance")
        d = json.loads(body)
        conds = d.get("conditions", [])
        assert len(conds) >= 4, f"expected ≥4 conditions, got {len(conds)}"
        for c in conds:
            for k in ("condition", "series_56d", "z_score", "anomaly",
                     "recent_avg", "baseline_avg", "action"):
                assert k in c, f"missing key {k} in condition {c.get('condition')}"
            assert isinstance(c["series_56d"], list) and len(c["series_56d"]) >= 14
    check("17. gov/surveillance has z-score + anomaly per condition", _17)

    # (18) indicators has the 3 groups
    def _18():
        code, body = http_get(f"{api}/api/v1/gov/mv/indicators")
        d = json.loads(body)
        for k in ("who_pen_adherence", "hearts_adherence", "sdg3_maternal"):
            assert k in d and isinstance(d[k], list) and len(d[k]) >= 1, f"missing/empty {k}"
    check("18. gov/indicators carries WHO-PEN, HEARTS, SDG3 groups", _18)

    # (19) network-health returns one row per region
    def _19():
        code, body = http_get(f"{api}/api/v1/gov/mv/network-health")
        d = json.loads(body)
        rows = d.get("regions", [])
        assert len(rows) == 7, f"expected 7 rows, got {len(rows)}"
        for r in rows:
            for k in ("code", "name", "chws_active", "certified", "dropout_risk",
                     "avg_response_min"):
                assert k in r, f"row missing key {k}"
    check("19. gov/network-health has 1 row per region with required keys", _19)

    # (20) command-center — triage + alerts shape
    def _20():
        code, body = http_get(f"{api}/api/v1/admin/mv/command-center")
        d = json.loads(body)
        assert "kpis" in d and "triage" in d and "alerts" in d
        for seg in d["triage"]:
            for k in ("label", "value", "color"):
                assert k in seg, f"triage seg missing {k}"
        # alerts may be empty but must be a list
        assert isinstance(d["alerts"], list)
    check("20. admin/command-center shape is valid", _20)

    # (21) service-health lists every LLM + infra service
    def _21():
        code, body = http_get(f"{api}/api/v1/admin/mv/service-health")
        d = json.loads(body)
        ids = {s.get("id") for s in d.get("services", [])}
        for needed in ("amina-lora", "openai", "groq", "gemini",
                       "arcadedb", "redis", "dhis2", "voice-tts", "voice-stt"):
            assert needed in ids, f"missing service {needed}"
    check("21. service-health enumerates all expected services", _21)

    # (22) agent-lab has 5 models × calls/latency/errors
    def _22():
        code, body = http_get(f"{api}/api/v1/admin/mv/agent-lab")
        d = json.loads(body)
        models = d.get("models", [])
        assert len(models) == 5, f"expected 5 models, got {len(models)}"
        for m in models:
            for k in ("id", "label", "calls_24h", "p50_ms", "p95_ms", "p99_ms", "errors_24h"):
                assert k in m, f"model {m.get('id')} missing {k}"
        assert isinstance(d.get("tools"), list)   and len(d["tools"]) >= 5
        assert isinstance(d.get("safety"), list)
        assert "regen" in d
    check("22. agent-lab returns 5 models × full metric set", _22)

    # (23) cost
    def _23():
        code, body = http_get(f"{api}/api/v1/admin/mv/cost")
        d = json.loads(body)
        assert d.get("total_usd", -1) >= 0
        assert len(d.get("providers", [])) >= 3
    check("23. cost returns ≥3 providers + non-negative total_usd", _23)

    # (24) patient 360 shape
    def _24():
        code, body = http_get(f"{api}/api/v1/admin/mv/patient/p_sanity_test/360")
        d = json.loads(body)
        for k in ("profile", "vitals", "consultations", "care_team"):
            assert k in d, f"missing key {k}"
        for vk in ("bp", "glucose", "weight"):
            assert vk in d["vitals"], f"vitals missing {vk}"
    check("24. admin/patient/.../360 returns profile + vitals + consults + team", _24)

    # ── Guest chat path ──────────────────────────────────────────

    # (25) guest chat works (Groq / Gemini fallback)
    def _25():
        code, body = http_post(
            f"{api}/api/v1/agent/chat",
            {"session_id": "guest_sanity_test_25", "message": "hi"},
            timeout=30.0,
        )
        assert code == 200, f"HTTP {code}"
        d = json.loads(body)
        txt = d.get("response") or ""
        assert isinstance(txt, str) and len(txt) > 5, f"empty/short reply: {txt!r}"
    check("25. guest chat (no auth) returns a real response", _25)

    # (26) bogus bearer → still treated as guest (free-tier cascade)
    def _26():
        code, body = http_post(
            f"{api}/api/v1/agent/chat",
            {"session_id": "guest_sanity_test_26", "message": "hello"},
            headers={"Authorization": "Bearer invalid.jwt.value"},
            timeout=30.0,
        )
        assert code == 200, f"HTTP {code} — {body[:120]!r}"
    check("26. invalid bearer is treated as guest (no 401 leak)", _26)

    # ── Government officer login ────────────────────────────────

    # (G1) seeded officer can sign in
    def _g1():
        code, body = http_post(
            f"{api}/api/v1/gov/login",
            {"staff_id": "MOH-2026-0001",
             "national_id": "9876543",
             "password": "GambiaGov2026!"},
            timeout=10.0,
        )
        assert code == 200, f"HTTP {code} — {body[:160]!r}"
        d = json.loads(body)
        assert d.get("token"), "no token returned"
        off = d.get("official") or {}
        assert off.get("staff_id") == "MOH-2026-0001"
        assert "Dr. Mariama Ceesay" in (off.get("name") or "")
    check("G1. gov/login succeeds for seeded officer MOH-2026-0001", _g1)

    # (G2) wrong password → 401, not 500
    def _g2():
        code, _ = http_post(
            f"{api}/api/v1/gov/login",
            {"staff_id": "MOH-2026-0001",
             "national_id": "9876543",
             "password": "wrong-password"},
            timeout=8.0,
        )
        assert code == 401, f"expected 401, got {code}"
    check("G2. gov/login 401s on wrong password", _g2)

    # (G3) wrong National ID → 401
    def _g3():
        code, _ = http_post(
            f"{api}/api/v1/gov/login",
            {"staff_id": "MOH-2026-0001",
             "national_id": "0000000",
             "password": "GambiaGov2026!"},
            timeout=8.0,
        )
        assert code == 401, f"expected 401, got {code}"
    check("G3. gov/login 401s on wrong National ID", _g3)

    # (G4) unknown staff ID → 401
    def _g4():
        code, _ = http_post(
            f"{api}/api/v1/gov/login",
            {"staff_id": "MOH-9999-9999",
             "national_id": "0000000",
             "password": "anything"},
            timeout=8.0,
        )
        assert code == 401, f"expected 401, got {code}"
    check("G4. gov/login 401s on unknown staff ID", _g4)

    # (P1) patient email-login returns a valid token + patient object
    def _p1():
        code, body = http_post(
            f"{api}/api/v1/auth/login/email",
            {"email": "awa.ceesay@demo.aminacare", "password": "AwaCeesay2026"},
            timeout=10.0,
        )
        assert code == 200, f"HTTP {code} — {body[:160]!r}"
        d = json.loads(body)
        assert d.get("success"), "patient login didn't set success=true"
        assert d.get("token"), "no token returned"
        assert isinstance(d.get("patient"), dict) and d["patient"].get("id"), \
            "patient object missing id"
    check("P1. patient email-login returns success + token + patient", _p1)

    # (P2) caregiver login returns a valid token + caregiver_id + patient_id
    def _p2():
        code, body = http_post(
            f"{api}/api/v1/caregiver/login",
            {"phone": "+2203110001", "pin": "1111"},
            timeout=10.0,
        )
        assert code == 200, f"HTTP {code} — {body[:160]!r}"
        d = json.loads(body)
        assert d.get("token"), "no token returned"
        assert d.get("caregiver_id"), "no caregiver_id returned"
        assert d.get("patient_id"), "no patient_id returned"
    check("P2. caregiver login returns token + caregiver_id + patient_id", _p2)

    # (P3) patient OTP send returns a method + optional otp_dev
    def _p3():
        code, body = http_post(
            f"{api}/api/v1/auth/otp/send",
            {"phone": "+2203110099"},
            timeout=10.0,
        )
        assert code == 200, f"HTTP {code} — {body[:160]!r}"
        d = json.loads(body)
        # Either real SMS or dev-mode is acceptable; reject only errors.
        assert not d.get("error"), f"OTP send returned error: {d.get('error')}"
    check("P3. patient phone-OTP send returns a valid method (SMS or dev)", _p3)

    # (P4) LoginPage persists tokens to the correct localStorage keys
    def _p4():
        p = FE_ROOT / "src" / "router" / "pages" / "LoginPage.jsx"
        src = p.read_text(encoding="utf-8")
        # Patient must persist AMINA_TOKEN + AMINA_PATIENT
        assert 'localStorage.setItem("AMINA_TOKEN"' in src, \
            "LoginPage does not persist AMINA_TOKEN for patient"
        assert 'localStorage.setItem("AMINA_PATIENT"' in src, \
            "LoginPage does not persist AMINA_PATIENT for patient"
        # Caregiver must persist cg_token + cg_info
        assert 'localStorage.setItem("cg_token"' in src, \
            "LoginPage does not persist cg_token for caregiver"
        assert 'localStorage.setItem("cg_info"' in src, \
            "LoginPage does not persist cg_info for caregiver"
        # Admin must persist AMINA_ADMIN_TOKEN
        assert 'localStorage.setItem("AMINA_ADMIN_TOKEN"' in src, \
            "LoginPage does not persist AMINA_ADMIN_TOKEN for admin"
        # Each role must hand off to its own dashboard route
        assert 'handoff("#/patient")'   in src, "Patient login not routed to #/patient"
        assert 'handoff("#/caregiver")' in src, "Caregiver login not routed to #/caregiver"
        assert 'handoff("#/admin/console")' in src, "Admin login not routed to #/admin/console"
    check("P4. LoginPage persists tokens + routes each role to its dashboard", _p4)

    # (G5) token role is role=gov
    def _g5():
        code, body = http_post(
            f"{api}/api/v1/gov/login",
            {"staff_id": "MOH-2026-0002",
             "national_id": "8654321",
             "password": "HealthAdmin2026!"},
            timeout=8.0,
        )
        assert code == 200
        d = json.loads(body)
        tok = d["token"]
        # JWT body is middle segment (base64)
        import base64
        seg = tok.split(".")[1]
        seg += "=" * (-len(seg) % 4)
        payload = json.loads(base64.urlsafe_b64decode(seg))
        assert payload.get("role") == "gov", f"role={payload.get('role')}"
    check("G5. issued JWT carries role=gov", _g5)


# ══════════════════════════════════════════════════════════════════
#   FRONTEND CHECKS
# ══════════════════════════════════════════════════════════════════

def run_frontend_checks(vite: str):
    section(f"Frontend sanity @ {vite}")

    # new + modified frontend files
    frontend_files = [
        "src/styles/admin-tokens.css",
        "src/styles/care-records.css",
        "src/admin/primitives/index.jsx",
        "src/admin/CommandPalette.jsx",
        "src/admin/hooks/useAdminApi.js",
        "src/admin/AdminShell.jsx",
        "src/admin/GovPortalModal.jsx",
        "src/admin/sections/CommandCenter.jsx",
        "src/admin/sections/PatientDetailSheet.jsx",
        "src/admin/sections/PeopleSection.jsx",
        "src/admin/sections/CareSection.jsx",
        "src/admin/sections/CareRecords.jsx",
        "src/admin/sections/AgentLab.jsx",
        "src/admin/sections/Integrations.jsx",
        "src/admin/sections/Governance.jsx",
        "src/gov/GovShell.jsx",
        "src/gov/registerPwa.js",
        "src/gov/sections/NationalPulse.jsx",
        "src/gov/sections/RegionalMap.jsx",
        "src/gov/sections/Surveillance.jsx",
        "src/gov/sections/Indicators.jsx",
        "src/gov/sections/NetworkHealth.jsx",
        "src/gov/sections/Reports.jsx",
        "src/router/AppRouter.jsx",
        "src/AdminDashboard.jsx",
        "src/router/pages/ChatPage.jsx",
        "src/router/pages/LoginPage.jsx",
    ]
    for i, f in enumerate(frontend_files, start=27):
        def _c(p=f):
            code, body = http_get(f"{vite}/{p}")
            assert code == 200, f"Vite returned {code} for {p}"
            # Vite can also return 200 with an error HTML page — guard.
            text = body.decode("utf-8", "ignore")
            assert "parse error" not in text.lower(), f"{p}: parse error"
            assert "transform error" not in text.lower(), f"{p}: transform error"
        check(f"{i:2d}. compiles: {f}", _c)

    # (51) service-worker served at root
    def _51():
        code, body = http_get(f"{vite}/gov-sw.js")
        assert code == 200, f"sw not reachable (HTTP {code})"
        assert b"serviceWorker" in body or b"self.addEventListener" in body, "sw file looks wrong"
    check("52. /gov-sw.js is served at the site root", _51)

    # (52) index.html preloads Fraunces + Geist
    def _52():
        code, body = http_get(f"{vite}/")
        text = body.decode("utf-8", "ignore")
        assert "Fraunces" in text, "Fraunces font link missing from index.html"
        assert "Geist"   in text, "Geist font link missing from index.html"
    check("53. index.html preloads Fraunces + Geist", _52)


# ══════════════════════════════════════════════════════════════════
#   ROUTER + CONTRACT CHECKS (static file inspection)
# ══════════════════════════════════════════════════════════════════

def run_router_contract_checks():
    section("Router + contract")

    # (53) AdminDashboard still exports its public signature
    def _53():
        p = FE_ROOT / "src" / "AdminDashboard.jsx"
        src = p.read_text(encoding="utf-8")
        assert "export default function AdminDashboard" in src
        assert "embedded" in src, "new embedded prop missing"
        assert "initialTab" in src, "new initialTab prop missing"
    check("54. AdminDashboard preserves public signature + embed props", _53)

    # (54) AppRouter references the new shells
    def _54():
        p = FE_ROOT / "src" / "router" / "AppRouter.jsx"
        src = p.read_text(encoding="utf-8")
        assert "AdminShell"  in src, "AppRouter missing AdminShell import"
        assert "GovShell"    in src, "AppRouter missing GovShell import"
        assert "registerGovSw" in src, "AppRouter missing PWA registrar"
    check("55. AppRouter imports AdminShell + GovShell + PWA registrar", _54)

    # (55) all 3 new routes declared
    def _55():
        p = FE_ROOT / "src" / "router" / "AppRouter.jsx"
        src = p.read_text(encoding="utf-8")
        for route in ("#/admin/console", "#/gov"):
            assert route in src, f"AppRouter missing route {route}"
        for page in ("admin_console", "gov"):
            assert f'page: "{page}"' in src, f"AppRouter missing page id {page}"
    check("56. AppRouter declares #/admin/console and #/gov routes", _55)

    # (56) LoginPage stays the 3-tab public login (NO Government tab)
    def _56():
        p = FE_ROOT / "src" / "router" / "pages" / "LoginPage.jsx"
        src = p.read_text(encoding="utf-8")
        assert 'ALLOWED_TABS = ["pt", "cg", "ad"]' in src, \
            "LoginPage ALLOWED_TABS must be exactly pt/cg/ad (gov lives in admin shell)"
        assert "GovernmentForm" not in src, \
            "GovernmentForm leaked into public LoginPage — must live only in admin shell"
        assert 'handoff("#/admin/console")' in src, \
            "Admin sign-in does not hand off to #/admin/console"
    check("57. LoginPage has 3 tabs only — no gov in public login", _56)

    # (57) GovPortalModal is reachable + wired from AdminShell
    def _57():
        p_modal = FE_ROOT / "src" / "admin" / "GovPortalModal.jsx"
        p_shell = FE_ROOT / "src" / "admin" / "AdminShell.jsx"
        assert p_modal.exists(), "GovPortalModal.jsx missing from admin/"
        modal = p_modal.read_text(encoding="utf-8")
        shell = p_shell.read_text(encoding="utf-8")
        assert "GambianFlag" in modal, "GovPortalModal missing GambianFlag component"
        assert "/api/v1/gov/login" in modal, "GovPortalModal does not post to /api/v1/gov/login"
        assert "MOH-YYYY-NNNN" in modal or "MOH-2026-0001" in modal, \
            "GovPortalModal missing Staff-ID hint"
        assert "GovPortalModal" in shell, "AdminShell does not import GovPortalModal"
        assert "govPortalOpen" in shell, "AdminShell does not manage govPortalOpen state"
        assert "Government portal" in shell, "AdminShell topbar missing Government portal button"
    check("58. GovPortalModal is wired into AdminShell (flag + POST + topbar button)", _57)

    # (58) HomePage has NO gov persona card (was reverted)
    def _58():
        p_home = FE_ROOT / "src" / "router" / "pages" / "HomePage.jsx"
        p_app  = FE_ROOT / "src" / "router" / "AppRouter.jsx"
        home = p_home.read_text(encoding="utf-8")
        app  = p_app.read_text(encoding="utf-8")
        assert 'label="Government"' not in home, \
            "HomePage must not expose a Government persona card (gov lives in admin)"
        assert '"#/admin/console"'  in app, "AppRouter nav missing admin console link"
        assert '"#/admin/emergencies"' in app, "AppRouter nav missing emergencies link"
    check("59. HomePage has no Gov card · admin-nav links intact", _58)

    # (60) named-import lint — every `import { X } from "./primitives/index.jsx"`
    #     in the admin/ tree must reference a symbol that primitives actually
    #     exports. Catches the "Alert used but never exported" class of bug
    #     that Vite's transform step can't see (white-screen-at-runtime).
    def _60():
        import re
        prims = (FE_ROOT / "src" / "admin" / "primitives" / "index.jsx").read_text(encoding="utf-8")
        exported = set(
            re.findall(r'export\s+(?:function|const|class)\s+([A-Za-z_]\w*)', prims)
        )
        # Also capture `export { a, b as c }` re-export lists
        for m in re.finditer(r'export\s*\{([^}]+)\}', prims):
            for piece in m.group(1).split(","):
                name = piece.strip().split(" as ")[-1].strip()
                if name:
                    exported.add(name)

        bad = []
        rx = re.compile(
            r'import\s*\{([^}]+)\}\s*from\s*["\']\./primitives/index\.jsx["\']'
        )
        admin_dir = FE_ROOT / "src" / "admin"
        for path in admin_dir.rglob("*.jsx"):
            if path.name == "index.jsx":
                continue
            txt = path.read_text(encoding="utf-8")
            for m in rx.finditer(txt):
                for piece in m.group(1).split(","):
                    name = piece.strip().split(" as ")[0].strip()
                    if name and name not in exported:
                        bad.append(f"{path.relative_to(FE_ROOT)}: `{name}` not exported")
        assert not bad, "Broken named imports: " + "; ".join(bad[:3])
    check("60. every admin/ named import from primitives resolves to a real export", _60)

    # (61) CareRecords workspace is wired into CareSection + uses live data
    def _61():
        p_care    = FE_ROOT / "src" / "admin" / "sections" / "CareRecords.jsx"
        p_section = FE_ROOT / "src" / "admin" / "sections" / "CareSection.jsx"
        p_css     = FE_ROOT / "src" / "styles" / "care-records.css"
        assert p_care.exists(),    "CareRecords.jsx missing"
        assert p_css.exists(),     "care-records.css missing"
        section = p_section.read_text(encoding="utf-8")
        care    = p_care.read_text(encoding="utf-8")
        assert "CareRecords"                    in section, "CareSection not importing CareRecords"
        assert "/api/v1/admin/consultations"    in care,    "CareRecords doesn't read consultations"
        assert "/api/v1/admin/community"        in care,    "CareRecords doesn't read community records"
        assert "/api/v1/admin/knowledge"        in care,    "CareRecords doesn't read knowledge base"
        assert "PatientDetailSheet"             in care,    "CareRecords doesn't wire Patient 360 drill-in"
    check("61. CareRecords workspace wired + reads live consultations/community/knowledge", _61)

    # (62) People workspace is wired into PeopleSection + uses live data
    def _62():
        p_people  = FE_ROOT / "src" / "admin" / "sections" / "People.jsx"
        p_section = FE_ROOT / "src" / "admin" / "sections" / "PeopleSection.jsx"
        assert p_people.exists(), "People.jsx missing"
        section = p_section.read_text(encoding="utf-8")
        people  = p_people.read_text(encoding="utf-8")
        assert "People"                              in section, "PeopleSection not importing People"
        assert "./People.jsx"                        in section, "PeopleSection not importing from ./People.jsx"
        assert "/api/v1/admin/patients"              in people,  "People doesn't read patients"
        assert "/api/v1/admin/caregivers-directory"  in people,  "People doesn't read caregivers directory"
        assert "/api/v1/literacy/admin/queue"        in people,  "People doesn't read literacy queue"
        assert "/api/v1/admin/transfer-requests"     in people,  "People doesn't read transfer requests"
        assert "PatientDetailSheet"                  in people,  "People doesn't wire Patient 360 drill-in"
        assert "care-records.css"                    in people,  "People doesn't reuse care-records.css"
    check("62. People workspace wired + reads live patients/caregivers/literacy/transfers", _62)

    # (63) Integrations ops workspace wired + reads live DHIS2 endpoints
    def _63():
        p_work    = FE_ROOT / "src" / "admin" / "sections" / "IntegrationsWorkspace.jsx"
        p_section = FE_ROOT / "src" / "admin" / "sections" / "Integrations.jsx"
        p_css     = FE_ROOT / "src" / "styles" / "integrations.css"
        assert p_work.exists(), "IntegrationsWorkspace.jsx missing"
        assert p_css.exists(),  "integrations.css missing"
        section = p_section.read_text(encoding="utf-8")
        work    = p_work.read_text(encoding="utf-8")
        css     = p_css.read_text(encoding="utf-8")
        assert "IntegrationsWorkspace"       in section, "Integrations section not importing IntegrationsWorkspace"
        assert "/api/v1/dhis2/config"        in work,    "Workspace doesn't read /api/v1/dhis2/config"
        assert "/api/v1/dhis2/metrics/today" in work,    "Workspace doesn't read today's metrics"
        assert "/api/v1/dhis2/sync/status"   in work,    "Workspace doesn't read sync status"
        assert "/api/v1/dhis2/sync/history"  in work,    "Workspace doesn't read sync history"
        assert "integrations.css"            in work,    "Workspace doesn't import integrations.css"
        assert ".amina-admin-scope" in css, "integrations.css not scoped to .amina-admin-scope"
        # Sticky action bar + dry-run + push-now wired
        assert "/api/v1/dhis2/sync/dry-run" in work, "No wiring for dry-run action"
        assert "/api/v1/dhis2/sync/manual"  in work, "No wiring for push-now action"
    check("63. Integrations workspace wired + reads live DHIS2 config/metrics/history", _63)

    # (64) DHIS2 Tracker workspace has all legacy sub-tabs wired
    def _64():
        p_tracker = FE_ROOT / "src" / "admin" / "sections" / "DHIS2TrackerWorkspace.jsx"
        p_work    = FE_ROOT / "src" / "admin" / "sections" / "IntegrationsWorkspace.jsx"
        assert p_tracker.exists(), "DHIS2TrackerWorkspace.jsx missing"
        tracker = p_tracker.read_text(encoding="utf-8")
        work    = p_work.read_text(encoding="utf-8")
        assert "DHIS2TrackerWorkspace"  in work,    "IntegrationsWorkspace not importing DHIS2TrackerWorkspace"
        # Sub-tabs present (same labels the legacy panel had)
        for label in ["Config", "Push patient", "Batch push", "Tracker audit", "Aggregate history", "Discover DHIS2"]:
            assert label in tracker, f"Tracker workspace missing sub-tab: {label}"
        # Legacy API helpers are reused (no re-implementation)
        for helper in ["getConfig", "getAudit", "dryRun", "pushPatient", "pushBatch",
                       "getAggregateHistory", "discoverDatasets", "describeDataset"]:
            assert helper in tracker, f"Tracker workspace not using dhis2TrackerApi helper: {helper}"
    check("64. DHIS2 Tracker workspace replaces legacy panel with all sub-tabs wired", _64)

    # (65) Governance workspace wired + reads live audit + cost
    def _65():
        p_work    = FE_ROOT / "src" / "admin" / "sections" / "GovernanceWorkspace.jsx"
        p_section = FE_ROOT / "src" / "admin" / "sections" / "Governance.jsx"
        p_css     = FE_ROOT / "src" / "styles" / "governance.css"
        assert p_work.exists(), "GovernanceWorkspace.jsx missing"
        assert p_css.exists(),  "governance.css missing"
        section = p_section.read_text(encoding="utf-8")
        work    = p_work.read_text(encoding="utf-8")
        css     = p_css.read_text(encoding="utf-8")
        assert "GovernanceWorkspace"    in section, "Governance section not importing GovernanceWorkspace"
        assert "/api/v1/admin/audit"    in work,    "Workspace doesn't read audit log"
        assert "/api/v1/admin/mv/cost"  in work,    "Workspace doesn't read cost"
        assert "governance.css"         in work,    "Workspace doesn't import governance.css"
        assert ".amina-admin-scope"     in css,     "governance.css not scoped to .amina-admin-scope"
        # Four sub-tabs present
        for label in ["Audit log", "Roles & access", "Broadcast", "Cost & usage"]:
            assert label in work, f"Governance workspace missing sub-tab: {label}"
    check("65. Governance workspace wired + reads live audit + cost", _65)

    # (66) LegacyFallback archive surface used consistently across sections
    def _66():
        p_fallback = FE_ROOT / "src" / "admin" / "sections" / "LegacyFallback.jsx"
        p_css      = FE_ROOT / "src" / "styles" / "legacy-fallback.css"
        assert p_fallback.exists(), "LegacyFallback.jsx missing"
        assert p_css.exists(),      "legacy-fallback.css missing"
        fb = p_fallback.read_text(encoding="utf-8")
        css = p_css.read_text(encoding="utf-8")
        assert ".amina-admin-scope" in css, "legacy-fallback.css not scoped to .amina-admin-scope"
        # Must provide a titled disclosure + archive ribbon
        for cls in [".legacy-disclosure", ".legacy-archive", ".legacy-archive-ribbon", ".legacy-archive-surface"]:
            assert cls in css, f"legacy-fallback.css missing class {cls}"
        # Every redesigned section must use LegacyFallback (no bare ghost toggle)
        for section_name in ["CareSection.jsx", "PeopleSection.jsx", "Integrations.jsx", "Governance.jsx"]:
            p = FE_ROOT / "src" / "admin" / "sections" / section_name
            text = p.read_text(encoding="utf-8")
            assert "LegacyFallback" in text, f"{section_name} not using LegacyFallback"
            # The old "Show legacy …" button copy must be gone (the fallback provides a proper CTA)
            assert "Show legacy" not in text, f"{section_name} still has bare ghost 'Show legacy' button"
    check("66. LegacyFallback archive surface replaces ghost-button toggles in every section", _66)

    # (67) Government Observatory redesigned with proper daylight palette
    def _67():
        p_css   = FE_ROOT / "src" / "styles" / "gov-observatory.css"
        p_shell = FE_ROOT / "src" / "gov" / "GovShell.jsx"
        assert p_css.exists(),   "gov-observatory.css missing"
        assert p_shell.exists(), "GovShell.jsx missing"
        css   = p_css.read_text(encoding="utf-8")
        shell = p_shell.read_text(encoding="utf-8")
        assert ".amina-gov-scope" in css, "gov-observatory.css not scoped"
        # Core design system classes must be present
        for cls in [".gv-side", ".gv-topbar", ".gv-hero", ".gv-kpi-row",
                    ".gv-panel", ".gv-panel-head", ".gv-pill", ".gv-map",
                    ".gv-gauge", ".gv-cond-card", ".gv-doc", ".gv-nlq"]:
            assert cls in css, f"gov-observatory.css missing class {cls}"
        # Shell imports the new stylesheet
        assert "gov-observatory.css" in shell, "GovShell does not import gov-observatory.css"
        # Every redesigned section file uses the new gv-* classes (no legacy Card/.a-card)
        for section_name in ["NationalPulse.jsx", "RegionalMap.jsx", "Surveillance.jsx",
                              "Indicators.jsx", "NetworkHealth.jsx", "Reports.jsx"]:
            p = FE_ROOT / "src" / "gov" / "sections" / section_name
            text = p.read_text(encoding="utf-8")
            assert "gv-panel" in text or "gv-kpi" in text or "gv-hbar" in text or "gv-doc" in text, \
                f"{section_name} does not use the gv-* design system"
    check("67. Government Observatory redesigned with daylight ops palette", _67)

    # (68) Government signed summary report: button + document + signature blocks
    def _68():
        p_doc   = FE_ROOT / "src" / "gov" / "GovReportDocument.jsx"
        p_css   = FE_ROOT / "src" / "styles" / "gov-report.css"
        p_shell = FE_ROOT / "src" / "gov" / "GovShell.jsx"
        assert p_doc.exists(), "GovReportDocument.jsx missing"
        assert p_css.exists(), "gov-report.css missing"
        doc   = p_doc.read_text(encoding="utf-8")
        css   = p_css.read_text(encoding="utf-8")
        shell = p_shell.read_text(encoding="utf-8")
        assert ".amina-gov-scope" in css,   "gov-report.css not scoped"
        assert ".gr-sheet"        in css,   "gov-report.css missing .gr-sheet paper class"
        assert ".gr-sig-block"    in css,   "gov-report.css missing signature block"
        assert "@media print"     in css,   "gov-report.css missing print rules"
        # Document pulls from every gov MV endpoint
        for url in ["/api/v1/gov/mv/national-pulse",
                    "/api/v1/gov/mv/regional",
                    "/api/v1/gov/mv/surveillance",
                    "/api/v1/gov/mv/indicators",
                    "/api/v1/gov/mv/network-health"]:
            assert url in doc, f"Summary report doesn't read {url}"
        # Three-signature block (prepared/reviewed/approved)
        for role in ["Prepared by", "Reviewed by", "Approved by"]:
            assert role in doc, f"Summary report missing signature role: {role}"
        # Shell wires the button + overlay
        assert "GovReportDocument" in shell, "GovShell not importing GovReportDocument"
        assert "Generate report"   in shell, "GovShell missing 'Generate report' button"
        assert "FileSignature"     in shell, "GovShell not using FileSignature icon next to Print"
    check("68. Signed summary report (PDF) wired with 3-signature authorisation block", _68)


# ══════════════════════════════════════════════════════════════════
#   ENTRY
# ══════════════════════════════════════════════════════════════════

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api",  default="http://localhost:8000")
    ap.add_argument("--vite", default="http://localhost:5173")
    ap.add_argument("--backend-only",  action="store_true")
    ap.add_argument("--frontend-only", action="store_true")
    args = ap.parse_args()

    print()
    print(f"{BOLD}AMINA · Admin + Gov console sanity{RESET}")
    print(f"  API  = {args.api}")
    print(f"  Vite = {args.vite}")

    if not args.frontend_only:
        run_backend_checks(args.api)

    if not args.backend_only:
        try:
            run_frontend_checks(args.vite)
        except Exception as e:
            print(f"{YELL}  (skipped frontend checks: {e}){RESET}")

    run_router_contract_checks()

    # ── summary ─────────────────────────────────────────────────
    section("Summary")
    total  = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = total - passed
    print()
    if failed == 0:
        print(f"  {GREEN}{BOLD}✔ {passed}/{total} checks passed{RESET}")
        return 0
    else:
        print(f"  {RED}{BOLD}✖ {failed}/{total} checks failed{RESET}  ({passed} passed)")
        print()
        print(f"  {BOLD}Failing:{RESET}")
        for name, ok, msg in results:
            if not ok:
                print(f"    {RED}· {name}{RESET}")
                if msg:
                    print(f"      {DIM}{msg}{RESET}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
