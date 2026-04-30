"""
Phase 5 — caregiver privacy WARN-ONLY backend test suite.

Covers the new Phase 5 surface ONLY:
  - is-stale detection on top of Phase 2's has_current_consent
  - structured warning log shape (safe-fields-only)
  - ASGI middleware injecting X-Caregiver-Privacy-Stale on caregiver
    routes only, never blocking, never leaking PHI
  - re-accept idempotency via the REUSED Phase 2 endpoint
    (POST /caregiver/privacy/consent — no new route in Phase 5)
  - flag independence: warn-only is independent of the enforcement
    flag AMINA_CAREGIVER_PRIVACY_REQUIRED

No real ArcadeDB. No real network. No real secrets. Tests inject a
mock SQL runner everywhere a DB call would happen, and a stub ASGI
app + send/receive callables for the middleware.

Run inside or outside the container:
    PYTHONIOENCODING=utf-8 python _caregiver_privacy_warn_test.py
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import sys
from typing import Any, Dict, List, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Pin both flags to the Phase 5 default state BEFORE the modules are
# imported. The service modules read env at import time.
os.environ.setdefault("AMINA_CAREGIVER_PRIVACY_REQUIRED", "false")
os.environ.setdefault("AMINA_CAREGIVER_PRIVACY_WARN_ONLY", "true")

# Provide a stable JWT secret for the middleware's decode path. The
# real settings module reads from env; we patch the secret on the
# imported module post-import to be sure.
os.environ.setdefault("JWT_SECRET", "phase5-test-secret")

from src.services import caregiver_privacy_consent as cpc       # noqa: E402
from src.services import caregiver_privacy_warn as cpw          # noqa: E402

# Make sure the JWT secret used inside the warn module matches the
# one we sign tokens with below. The service imports `settings` from
# src.config; we reach into it to be deterministic.
try:
    from src.config import settings as _settings
    _settings.JWT_SECRET = "phase5-test-secret"
except Exception:  # pragma: no cover  (defensive — config may not exist outside container)
    pass

import jwt  # PyJWT, already a project dep


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


# ── Mock SQL runner — copied/adapted from the Phase 2 test ───────────
class MockDB:
    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self.calls: List[Tuple[str, Dict[str, Any]]] = []

    def __call__(self, sql: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        params = dict(params or {})
        self.calls.append((sql.strip(), params))
        s = sql.upper()
        if (s.startswith("CREATE VERTEX TYPE")
                or s.startswith("CREATE EDGE TYPE")
                or s.startswith("CREATE PROPERTY")
                or s.startswith("CREATE INDEX")):
            return {"result": []}
        if s.startswith("SELECT FROM"):
            cg = params.get("cg")
            nv = params.get("nv")
            sh = params.get("sh")
            matches = [
                r for r in self.rows
                if r.get("caregiver_id") == cg
                and r.get("notice_version") == nv
                and (sh is None or r.get("digital_signature_hash") == sh)
            ]
            matches.sort(key=lambda r: r.get("created_at", ""), reverse=True)
            return {"result": matches[:1]}
        if s.startswith("INSERT INTO"):
            self.rows.append(dict(params))
            return {"result": [dict(params)]}
        if s.startswith("CREATE EDGE"):
            return {"result": []}
        return {"result": []}


def _fresh_db() -> MockDB:
    cpc._reset_schema_bootstrap_for_tests()
    return MockDB()


def _good_payload() -> Dict[str, Any]:
    """Minimal valid Phase 2 payload (mirrors the existing test)."""
    return {
        "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
        "consent_checkboxes": {
            cb_id: True for cb_id in cpc.EXPECTED_CHECKBOX_IDS
        },
        "digital_signature": "Aisha Touray",
        "method": "app",
        "scroll_completed": True,
    }


def _make_jwt(caregiver_id: str = "cg-warn-001",
              role: str = "caregiver") -> str:
    return jwt.encode(
        {"sub": caregiver_id, "role": role},
        "phase5-test-secret", algorithm="HS256",
    )


# ── 1. Stale detection (the warn signal) ─────────────────────────────
def test_stale_detection_no_record_is_stale():
    section("1. Stale detection: no record -> stale=True")
    db = _fresh_db()
    # Patch find_current_consent's default sql_runner so the warn
    # service's _is_stale_safe call uses our mock without us having to
    # plumb a runner kwarg through it. cpc.has_current_consent uses
    # _default_sql_runner() under the hood; we monkey-patch.
    orig = cpc._default_sql_runner
    cpc._default_sql_runner = lambda: db
    try:
        check("no record -> _is_stale_safe True",
              cpw._is_stale_safe("cg-warn-empty") is True)
    finally:
        cpc._default_sql_runner = orig


def test_stale_detection_current_record_not_stale():
    section("2. Stale detection: current-version record -> stale=False")
    db = _fresh_db()
    cpc.record_consent(
        caregiver_id="cg-warn-002", role="vhw",
        payload=_good_payload(), sql_runner=db,
    )
    orig = cpc._default_sql_runner
    cpc._default_sql_runner = lambda: db
    try:
        check("current record -> _is_stale_safe False",
              cpw._is_stale_safe("cg-warn-002") is False)
    finally:
        cpc._default_sql_runner = orig


def test_stale_detection_fail_open_on_storage_error():
    section("3. Stale detection: storage error -> stale=False (fail-open)")

    def boom():
        raise RuntimeError("simulated storage outage")
    orig = cpc._default_sql_runner
    cpc._default_sql_runner = boom
    try:
        check("storage exception -> _is_stale_safe returns False",
              cpw._is_stale_safe("cg-warn-003") is False)
    finally:
        cpc._default_sql_runner = orig


# ── 4. JWT decode path (best-effort, never raises) ───────────────────
def test_decode_caregiver_id_valid_token():
    section("4. JWT decode: valid caregiver token -> id")
    tok = _make_jwt("cg-warn-jwt-1")
    out = cpw._decode_caregiver_id(tok)
    check("valid caregiver token -> caregiver_id returned",
          out == "cg-warn-jwt-1", detail=f"got {out!r}")


def test_decode_caregiver_id_wrong_role():
    section("5. JWT decode: non-caregiver role -> None")
    tok = jwt.encode({"sub": "p-1", "role": "patient"},
                     "phase5-test-secret", algorithm="HS256")
    out = cpw._decode_caregiver_id(tok)
    check("patient token -> None (silent skip)", out is None)


def test_decode_caregiver_id_garbage_token():
    section("6. JWT decode: garbage token -> None (no raise)")
    out = cpw._decode_caregiver_id("not.a.jwt")
    check("garbage token -> None", out is None)


# ── 7. Stale warning log shape (safe fields only) ────────────────────
def test_stale_warning_log_has_only_safe_fields():
    section("7. Stale warning log: structured shape, no PHI")
    log = logging.getLogger("src.services.caregiver_privacy_warn")
    log.setLevel(logging.WARNING)
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.WARNING)
    log.addHandler(handler)
    try:
        cpw._emit_stale_warning("cg-warn-log-1")
    finally:
        log.removeHandler(handler)

    line = buf.getvalue()
    # Must contain the structured marker.
    check("log line carries event_type marker",
          "event_type=caregiver_privacy_consent_stale" in line)
    check("log line contains caregiver_id token",
          "caregiver_id=cg-warn-log-1" in line)
    check("log line contains notice_version",
          "notice_version=" in line)
    check("log line contains required_flag",
          "required_flag=" in line)
    check("log line contains warn_only flag",
          "warn_only=" in line)
    # And must NOT contain anything PHI-shaped. These mirror the Phase
    # 2 audit-log forbidden list — same threat model.
    forbidden = (
        "Aisha Touray", "+220",        # names + phone
        "127.0.0.1", "Mozilla",        # IP + UA
        "I understand", "I accept",    # checkbox prose
        "@",                           # email
        "digital_signature",           # raw signature label
    )
    for needle in forbidden:
        check(f"log line free of {needle!r}", needle not in line)


# ── 8. ASGI middleware: header on caregiver routes ───────────────────
async def _run_middleware(path: str, token: str = "",
                          handler_status: int = 200,
                          stale_value: bool = True):
    """
    Drive the warn-only middleware against a stub downstream app and
    capture the response-start headers it emits. We monkey-patch the
    stale-check so the test does not need an in-process DB.
    """
    captured: Dict[str, Any] = {"headers": [], "status": None, "body_called": False}

    # Stub downstream app — emits a basic 200 with one body part.
    async def stub_app(scope, receive, send):
        captured["body_called"] = True
        await send({
            "type": "http.response.start",
            "status": handler_status,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b"{}"})

    # Monkey-patch the stale check so we don't need a DB.
    orig = cpw._is_stale_safe
    cpw._is_stale_safe = lambda cg: stale_value
    try:
        mw = cpw.CaregiverPrivacyWarnMiddleware(stub_app)
        scope = {
            "type": "http",
            "path": path,
            "headers": [],
        }
        if token:
            scope["headers"] = [
                (b"authorization", f"Bearer {token}".encode("latin-1")),
            ]

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                captured["status"] = message["status"]
                captured["headers"] = list(message.get("headers") or [])

        await mw(scope, receive, send)
    finally:
        cpw._is_stale_safe = orig
    return captured


def _hdr(captured: Dict[str, Any], name: bytes) -> bytes:
    for k, v in captured["headers"]:
        if k == name:
            return v
    return b""


def test_middleware_sets_stale_true_on_caregiver_route_with_jwt():
    section("8. Middleware: caregiver route + valid JWT + stale -> header true")
    tok = _make_jwt("cg-warn-mw-1")
    cap = asyncio.run(_run_middleware(
        "/api/v1/caregiver/inbox/list", token=tok, stale_value=True,
    ))
    check("downstream handler still ran (no block)", cap["body_called"] is True)
    check("response status preserved", cap["status"] == 200)
    check("X-Caregiver-Privacy-Stale: true",
          _hdr(cap, b"x-caregiver-privacy-stale") == b"true",
          detail=str(cap["headers"]))


def test_middleware_sets_stale_false_when_consent_current():
    section("9. Middleware: caregiver route + current consent -> header false")
    tok = _make_jwt("cg-warn-mw-2")
    cap = asyncio.run(_run_middleware(
        "/api/v1/caregiver/inbox/list", token=tok, stale_value=False,
    ))
    check("downstream handler still ran", cap["body_called"] is True)
    check("X-Caregiver-Privacy-Stale: false",
          _hdr(cap, b"x-caregiver-privacy-stale") == b"false")


def test_middleware_no_op_on_non_caregiver_route():
    section("10. Middleware: non-caregiver route -> no header, pass-through")
    tok = _make_jwt("cg-warn-mw-3")
    cap = asyncio.run(_run_middleware(
        "/api/v1/agent/chat", token=tok, stale_value=True,
    ))
    check("downstream handler still ran", cap["body_called"] is True)
    check("no X-Caregiver-Privacy-Stale on non-caregiver path",
          _hdr(cap, b"x-caregiver-privacy-stale") == b"")


def test_middleware_no_op_on_unauthenticated_caregiver_route():
    section("11. Middleware: caregiver route + no JWT -> header=false (default)")
    cap = asyncio.run(_run_middleware(
        "/api/v1/caregiver/inbox/list", token="", stale_value=True,
    ))
    check("downstream handler still ran", cap["body_called"] is True)
    # Without a caregiver_id we cannot assert stale; the contract says
    # default to false. This prevents PHI guessing on unauth traffic.
    check("X-Caregiver-Privacy-Stale: false (no caregiver_id)",
          _hdr(cap, b"x-caregiver-privacy-stale") == b"false")


def test_middleware_does_not_block_on_handler_500():
    section("12. Middleware: handler returns 500 -> still pass-through")
    tok = _make_jwt("cg-warn-mw-4")
    cap = asyncio.run(_run_middleware(
        "/api/v1/caregiver/inbox/list", token=tok,
        handler_status=500, stale_value=True,
    ))
    check("status preserved (500)", cap["status"] == 500)
    check("header still present despite handler error",
          _hdr(cap, b"x-caregiver-privacy-stale") == b"true")


def test_middleware_warn_only_flag_off_disables_header():
    section("13. Middleware: AMINA_CAREGIVER_PRIVACY_WARN_ONLY=False -> no header")
    tok = _make_jwt("cg-warn-mw-5")
    orig = cpw.AMINA_CAREGIVER_PRIVACY_WARN_ONLY
    cpw.AMINA_CAREGIVER_PRIVACY_WARN_ONLY = False
    try:
        cap = asyncio.run(_run_middleware(
            "/api/v1/caregiver/inbox/list", token=tok, stale_value=True,
        ))
    finally:
        cpw.AMINA_CAREGIVER_PRIVACY_WARN_ONLY = orig
    check("downstream handler still ran", cap["body_called"] is True)
    check("no header when flag is off",
          _hdr(cap, b"x-caregiver-privacy-stale") == b"")


# ── 14. Re-accept idempotency (REUSED Phase 2 endpoint, no new route) ─
def test_reaccept_creates_first_record_then_idempotent():
    section("14. Re-accept: 1st submit creates row; 2nd identical submit is idempotent")
    db = _fresh_db()
    cg = "cg-warn-reaccept-1"
    payload = _good_payload()

    row1 = cpc.record_consent(
        caregiver_id=cg, role="vhw", payload=payload, sql_runner=db,
    )
    check("first submit -> _status='accepted'",
          row1.get("_status") == "accepted")
    check("first submit -> 1 row in DB",
          len([r for r in db.rows
               if r.get("caregiver_id") == cg]) == 1)

    row2 = cpc.record_consent(
        caregiver_id=cg, role="vhw", payload=payload, sql_runner=db,
    )
    check("second identical submit -> _status='already_accepted'",
          row2.get("_status") == "already_accepted")
    check("second identical submit -> still 1 row (idempotent)",
          len([r for r in db.rows
               if r.get("caregiver_id") == cg]) == 1)


def test_reaccept_new_signature_creates_new_row_old_preserved():
    section("15. Re-accept: changed signature -> new row, old row preserved")
    db = _fresh_db()
    cg = "cg-warn-reaccept-2"
    payload = _good_payload()
    cpc.record_consent(caregiver_id=cg, role="vhw",
                       payload=payload, sql_runner=db)

    payload2 = dict(payload)
    payload2["digital_signature"] = "Mariama Sanneh"
    row = cpc.record_consent(
        caregiver_id=cg, role="vhw", payload=payload2, sql_runner=db,
    )
    rows_for_cg = [r for r in db.rows if r.get("caregiver_id") == cg]
    check("new signature -> new row created",
          row.get("_status") == "accepted" and len(rows_for_cg) == 2)
    sigs = sorted(r.get("digital_signature_hash") for r in rows_for_cg)
    check("both rows preserved with distinct signature hashes",
          len(set(sigs)) == 2)


# ── 16. Independence from enforcement flag ───────────────────────────
def test_warn_only_independent_of_required_flag():
    section("16. Warn-only is independent of AMINA_CAREGIVER_PRIVACY_REQUIRED")
    # Flip enforcement on AND warn-only on; both should coexist.
    cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED = True
    cpw.AMINA_CAREGIVER_PRIVACY_WARN_ONLY = True
    try:
        tok = _make_jwt("cg-warn-indep-1")
        cap = asyncio.run(_run_middleware(
            "/api/v1/caregiver/inbox/list", token=tok, stale_value=True,
        ))
        check("warn-only header still emitted with enforcement on",
              _hdr(cap, b"x-caregiver-privacy-stale") == b"true")
        check("middleware did NOT block (warn-only is observability)",
              cap["body_called"] is True)
    finally:
        cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED = False
        cpw.AMINA_CAREGIVER_PRIVACY_WARN_ONLY = True


# ── Run all ──────────────────────────────────────────────────────────
def main() -> None:
    print("AMINA Caregiver Privacy WARN-ONLY — Phase 5 backend test suite")
    print("=" * 64)
    test_stale_detection_no_record_is_stale()
    test_stale_detection_current_record_not_stale()
    test_stale_detection_fail_open_on_storage_error()
    test_decode_caregiver_id_valid_token()
    test_decode_caregiver_id_wrong_role()
    test_decode_caregiver_id_garbage_token()
    test_stale_warning_log_has_only_safe_fields()
    test_middleware_sets_stale_true_on_caregiver_route_with_jwt()
    test_middleware_sets_stale_false_when_consent_current()
    test_middleware_no_op_on_non_caregiver_route()
    test_middleware_no_op_on_unauthenticated_caregiver_route()
    test_middleware_does_not_block_on_handler_500()
    test_middleware_warn_only_flag_off_disables_header()
    test_reaccept_creates_first_record_then_idempotent()
    test_reaccept_new_signature_creates_new_row_old_preserved()
    test_warn_only_independent_of_required_flag()
    print("\n" + "=" * 64)
    print(f"PASSED: {passed}    FAILED: {failed}")
    if failed:
        print("FAILED CASES:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
