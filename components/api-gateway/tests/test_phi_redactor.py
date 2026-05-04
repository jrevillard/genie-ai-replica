"""Phase 3 — PHI redactor test suite (30 cases, A-F).

Self-contained: only imports the module under test. No FastAPI / Docker
required.

Run from the gateway dir:
    python tests/test_phi_redactor.py
"""
from __future__ import annotations

import os
import sys
import time
import unicodedata
from typing import Any, Callable, List, Tuple

# Ensure the app package is importable when running this file directly.
HERE = os.path.dirname(os.path.abspath(__file__))
GATEWAY_ROOT = os.path.abspath(os.path.join(HERE, ".."))
if GATEWAY_ROOT not in sys.path:
    sys.path.insert(0, GATEWAY_ROOT)

from app.phi_redactor import (  # noqa: E402
    PerimeterPHIRedactor,
    SEV_CRITICAL,
    SEV_HIGH,
    SEV_MEDIUM,
    SEV_LOW,
)


# ── Test runner scaffolding ─────────────────────────────────────────

_RESULTS: List[Tuple[str, bool, str]] = []   # (name, passed, detail)


def _test(name: str):
    def deco(fn: Callable[[PerimeterPHIRedactor], None]):
        def wrapper():
            r = PerimeterPHIRedactor()
            try:
                fn(r)
                _RESULTS.append((name, True, ""))
            except AssertionError as e:
                _RESULTS.append((name, False, str(e) or "(no detail)"))
            except Exception as e:
                _RESULTS.append((name, False, f"CRASH: {type(e).__name__}: {e}"))
        wrapper.__name__ = fn.__name__
        return wrapper
    return deco


def _assert(cond: bool, detail: str = "") -> None:
    if not cond:
        raise AssertionError(detail)


# ── GROUP A — Core redaction (8) ────────────────────────────────────

@_test("A1 Gambian phone in response → redacted, soft replacement")
def test_a1(r):
    body = {"response": "Call me at +2207654321 anytime."}
    out, rep = r.redact_outbound(body)
    _assert(rep.redactions_count >= 1, f"expected >=1 redaction, got {rep.redactions_count}")
    _assert("+2207654321" not in out["response"], "Gambian phone still present")
    _assert("[phone number removed for privacy]" in out["response"],
            f"soft replacement missing — got {out['response']!r}")


@_test("A2 Email in response → redacted")
def test_a2(r):
    body = {"response": "Email fjallow@moh.gov.gm for follow-up."}
    out, rep = r.redact_outbound(body)
    _assert(rep.redactions_count >= 1, "no redactions")
    _assert("fjallow@moh.gov.gm" not in out["response"], "email still present")
    _assert("[email removed for privacy]" in out["response"], "soft replacement missing")


@_test("A3 Patient ID in response → redacted + critical alert")
def test_a3(r):
    body = {"response": "Looking up P_FB9591B5 records.", "session_id": "s"}
    out, rep = r.redact_outbound(body)
    _assert("P_FB9591B5" not in out["response"], "patient_id still present")
    _assert(any(a["pattern"] == "patient_id" for a in rep.alerts),
            f"no CRITICAL alert fired — alerts={rep.alerts}")
    _assert(any(red.severity == SEV_CRITICAL for red in rep.redactions),
            "no critical-severity redaction recorded")


@_test("A4 Hard replacement used in non-content (metadata) field")
def test_a4(r):
    body = {"debug_trace": "see admin@example.com for details"}
    out, rep = r.redact_outbound(body)
    _assert("admin@example.com" not in out["debug_trace"], "email still in debug")
    _assert("[REDACTED-EMAIL]" in out["debug_trace"],
            f"expected hard replacement, got {out['debug_trace']!r}")


@_test("A5 Internal URL in response → redacted")
def test_a5(r):
    body = {"response": "Connecting to http://arcadedb:2480 for graph query."}
    out, rep = r.redact_outbound(body)
    _assert("arcadedb" not in out["response"], "internal hostname still present")
    _assert(any(red.pattern == "internal_url" for red in rep.redactions),
            "internal_url pattern not matched")


@_test("A6 Nested {data:{patient:{contact:'+2207654321'}}} → redacted")
def test_a6(r):
    body = {"data": {"patient": {"contact": "+2207654321"}}}
    out, rep = r.redact_outbound(body)
    _assert("+2207654321" not in out["data"]["patient"]["contact"],
            f"nested phone still present: {out}")
    _assert(rep.redactions_count >= 1)


@_test("A7 Multiple patterns in one response → all caught, count >= 2")
def test_a7(r):
    body = {"response": "Reach Fatou at fatou@example.com or +2207654321 today."}
    out, rep = r.redact_outbound(body)
    _assert(rep.redactions_count >= 2, f"expected >=2 redactions, got {rep.redactions_count}")
    _assert("fatou@example.com" not in out["response"])
    _assert("+2207654321" not in out["response"])


@_test("A8 Redaction report includes correct field paths and pattern names")
def test_a8(r):
    body = {"data": {"contact": "+2207654321"}, "info": "user: alice@x.com"}
    out, rep = r.redact_outbound(body)
    summary = rep.summary_for_audit()
    fields  = {entry["field"] for entry in summary}
    patterns = {entry["pattern"] for entry in summary}
    _assert("$.data.contact" in fields,
            f"expected '$.data.contact' in field paths, got {fields}")
    _assert("$.info" in fields, f"expected '$.info' in field paths, got {fields}")
    _assert("gambian_phone" in patterns and "email" in patterns,
            f"missing pattern names — got {patterns}")


# ── GROUP B — False-positive avoidance (8) ──────────────────────────

@_test("B1 Blood pressure '180/110' → NOT redacted")
def test_b1(r):
    body = {"response": "BP today is 180/110, please rest."}
    out, rep = r.redact_outbound(body)
    _assert("180/110" in out["response"], f"BP got mangled — got {out['response']!r}")
    _assert(rep.redactions_count == 0,
            f"false positive: {rep.summary_for_audit()}")


@_test("B2 Blood sugar '250 mg/dL' → NOT redacted")
def test_b2(r):
    body = {"response": "Blood sugar reading was 250 mg/dL this morning."}
    out, rep = r.redact_outbound(body)
    _assert("250 mg/dL" in out["response"])
    _assert(rep.redactions_count == 0, f"false positive: {rep.summary_for_audit()}")


@_test("B3 Medication '500mg metformin' → NOT redacted")
def test_b3(r):
    body = {"response": "Take 500 mg metformin twice daily as prescribed."}
    out, rep = r.redact_outbound(body)
    _assert("500" in out["response"])
    _assert(rep.redactions_count == 0, f"false positive: {rep.summary_for_audit()}")


@_test("B4 Port number 'port 8000' → NOT redacted")
def test_b4(r):
    body = {"response": "The backend listens on port 8000."}
    out, rep = r.redact_outbound(body)
    _assert("port 8000" in out["response"])
    _assert(rep.redactions_count == 0, f"false positive: {rep.summary_for_audit()}")


@_test("B5 Year '2026' → NOT redacted")
def test_b5(r):
    body = {"response": "The protocol was updated in 2026."}
    out, rep = r.redact_outbound(body)
    _assert("2026" in out["response"])
    _assert(rep.redactions_count == 0)


@_test("B6 Patient count '1247 consultations' → NOT redacted")
def test_b6(r):
    body = {"response": "We logged 1247 consultations this week."}
    out, rep = r.redact_outbound(body)
    _assert("1247" in out["response"])
    _assert(rep.redactions_count == 0, f"false positive: {rep.summary_for_audit()}")


@_test("B7 Short hex 'ABC123' → NOT redacted")
def test_b7(r):
    body = {"response": "Reference code ABC123 was issued."}
    out, rep = r.redact_outbound(body)
    _assert("ABC123" in out["response"])
    _assert(rep.redactions_count == 0)


@_test("B8 Public URL 'https://amina.health' → NOT redacted")
def test_b8(r):
    body = {"response": "More info at https://amina.health/docs"}
    out, rep = r.redact_outbound(body)
    _assert("https://amina.health" in out["response"],
            f"public URL got redacted — got {out['response']!r}")
    _assert(rep.redactions_count == 0, f"false positive: {rep.summary_for_audit()}")


# ── GROUP C — Risk mitigations (6) ──────────────────────────────────

@_test("C1 Full-width Unicode digits ＋２２０７６５４３２１ → detected via NFKC")
def test_c1(r):
    body = {"response": "Call ＋２２０７６５４３２１ today."}
    out, rep = r.redact_outbound(body)
    # After NFKC normalisation the digits become ASCII, then the
    # gambian_phone pattern matches. Output contains the soft repl.
    _assert("[phone number removed for privacy]" in out["response"]
            or any(red.pattern == "gambian_phone" for red in rep.redactions),
            f"NFKC bypass failed — got {out['response']!r}, redactions={rep.summary_for_audit()}")


@_test("C2 Depth >10 nested JSON → warning logged, no crash, structure preserved")
def test_c2(r):
    # Build 12-level nest
    body: Any = "leaf"
    for _ in range(12):
        body = {"k": body}
    out, rep = r.redact_outbound(body)
    _assert(rep.skipped_deep_count >= 1, "depth cap not hit")
    # The nested leaf may not have been scanned but the structure
    # must round-trip without exception.
    _assert(out is not None)


@_test("C3 String >50KB → skipped, warning logged, no crash")
def test_c3(r):
    huge = "a" * 60_000
    body = {"response": huge}
    out, rep = r.redact_outbound(body)
    _assert(rep.skipped_long_count >= 1, "long-string cap not hit")
    _assert(out["response"] == huge, "huge string was modified despite skip")


@_test("C4 Bare 11-digit number in CONTENT → NOT redacted")
def test_c4(r):
    body = {"response": "Order number 12345678901 is being processed."}
    out, rep = r.redact_outbound(body)
    # long_digit_run is severity=medium with redact_in_content=False,
    # so should be flagged but not replaced in a content field.
    _assert("12345678901" in out["response"],
            f"bare 11-digit got redacted in content — got {out['response']!r}")
    # We allow it to be 'flagged' (not zero count) — only the
    # ACTION should be 'flagged', not 'redacted'.
    redacted_actions = [r for r in rep.redactions if r.action == "redacted"]
    _assert(not redacted_actions, f"unexpected redaction: {redacted_actions}")


@_test("C5 International phone WITH + in metadata field → redacted")
def test_c5(r):
    body = {"caller_phone": "+919876543210"}
    out, rep = r.redact_outbound(body)
    _assert("+919876543210" not in out["caller_phone"],
            f"intl phone in metadata still present — got {out['caller_phone']!r}")
    _assert("[REDACTED-PHONE-INTL]" in out["caller_phone"]
            or "[REDACTED-PHONE]" in out["caller_phone"]
            or "[REDACTED-NUMBER]" in out["caller_phone"],
            f"hard replacement missing — got {out['caller_phone']!r}")


@_test("C6 International phone WITH + in CONTENT field → flagged only, NOT replaced")
def test_c6(r):
    body = {"response": "Text +919876543210 for help."}
    out, rep = r.redact_outbound(body)
    _assert("+919876543210" in out["response"],
            f"intl phone in content was replaced — got {out['response']!r}")
    flagged = [r for r in rep.redactions if r.action == "flagged"]
    _assert(any(f.pattern == "international_phone" for f in flagged),
            f"international_phone not flagged — redactions={rep.summary_for_audit()}")


# ── GROUP D — Inbound checking (4) ──────────────────────────────────

@_test("D1 Phone in session_id → rejected 400")
def test_d1(r):
    body = {"message": "hi", "session_id": "+2207654321-abc"}
    ok, info = r.check_inbound(body)
    _assert(not ok, "should have rejected")
    _assert(info is not None and info.field.endswith("session_id"),
            f"unexpected field — info={info}")


@_test("D2 Phone in message field → allowed (patient owns own PII)")
def test_d2(r):
    body = {"message": "Call me at +2207654321", "session_id": "abc"}
    ok, info = r.check_inbound(body)
    _assert(ok, f"should have allowed — info={info}")
    _assert(info is None)


@_test("D3 Patient ID in session_id → rejected 400")
def test_d3(r):
    body = {"message": "hi", "session_id": "P_FB9591B5"}
    ok, info = r.check_inbound(body)
    _assert(not ok, "should have rejected on critical PHI in metadata")
    _assert(info is not None and info.pattern == "patient_id",
            f"wrong pattern — info={info}")


@_test("D4 Clean request → allowed")
def test_d4(r):
    body = {"message": "What helps with diabetes?", "session_id": "abc-123"}
    ok, info = r.check_inbound(body)
    _assert(ok, f"should have allowed clean request — info={info}")


# ── GROUP E — Performance (2) ───────────────────────────────────────

@_test("E1 Typical 5-sentence response → <5ms")
def test_e1(r):
    body = {
        "response": (
            "Hello, my friend. For diabetes management, I recommend a "
            "diet rich in moringa leaves and fresh vegetables. You can "
            "find these at the local Lumo market on Thursdays. Aim for "
            "at least 30 minutes of walking each day to keep your blood "
            "sugar in check. Drink plenty of water and avoid sugary "
            "drinks like Fanta and Coca-Cola."
        ),
        "session_id": "test",
    }
    # Warm up the regex cache with one call
    r.redact_outbound(body)
    # Measure 100 iterations to smooth jitter
    t0 = time.perf_counter()
    for _ in range(100):
        r.redact_outbound(body)
    avg_ms = (time.perf_counter() - t0) * 1000 / 100
    _assert(avg_ms < 5.0, f"avg latency {avg_ms:.2f}ms exceeds 5ms budget")


@_test("E2 200-field nested response (worst case) → <20ms")
def test_e2(r):
    # Build a 200-leaf structure
    body = {
        f"field_{i}": {
            "nested": f"value with phone +220{2_000_000 + i}",
        }
        for i in range(100)
    }
    body.update({f"flat_{i}": f"text {i}" for i in range(100)})
    # Warm up
    r.redact_outbound(body)
    t0 = time.perf_counter()
    out, rep = r.redact_outbound(body)
    elapsed = (time.perf_counter() - t0) * 1000
    _assert(elapsed < 20.0, f"latency {elapsed:.2f}ms exceeds 20ms budget")
    # Sanity: redactions actually happened
    _assert(rep.redactions_count >= 50,
            f"expected many redactions, got {rep.redactions_count}")


# ── GROUP F — Edge cases (2) ────────────────────────────────────────

@_test("F1 Empty response body → no crash, 0 redactions")
def test_f1(r):
    out, rep = r.redact_outbound({})
    _assert(out == {})
    _assert(rep.redactions_count == 0)
    out2, rep2 = r.redact_outbound("")
    _assert(out2 == "")
    _assert(rep2.redactions_count == 0)


@_test("F2 Response with None values and integers → no crash, pass-through")
def test_f2(r):
    body = {
        "response":      "ok",
        "is_emergency":  False,
        "triage_level":  None,
        "msg_count":     42,
        "scores":        [0.85, 0.91, 0.77],
    }
    out, rep = r.redact_outbound(body)
    _assert(out["is_emergency"] is False)
    _assert(out["triage_level"] is None)
    _assert(out["msg_count"] == 42)
    _assert(out["scores"] == [0.85, 0.91, 0.77])
    _assert(rep.redactions_count == 0)


# ── Driver ──────────────────────────────────────────────────────────

def _run_all() -> int:
    tests = [
        test_a1, test_a2, test_a3, test_a4, test_a5, test_a6, test_a7, test_a8,
        test_b1, test_b2, test_b3, test_b4, test_b5, test_b6, test_b7, test_b8,
        test_c1, test_c2, test_c3, test_c4, test_c5, test_c6,
        test_d1, test_d2, test_d3, test_d4,
        test_e1, test_e2,
        test_f1, test_f2,
    ]
    print("\n" + "=" * 70)
    print(f"PHI redactor — {len(tests)} tests")
    print("=" * 70)

    t_start = time.perf_counter()
    for t in tests:
        t()
    total_ms = (time.perf_counter() - t_start) * 1000

    passed = sum(1 for _, ok, _ in _RESULTS if ok)
    failed = len(_RESULTS) - passed

    # Per-group rollup
    groups = {"A": [], "B": [], "C": [], "D": [], "E": [], "F": []}
    for name, ok, detail in _RESULTS:
        g = name[0].upper()
        groups.get(g, []).append((name, ok, detail))

    for g, items in groups.items():
        g_pass = sum(1 for _, ok, _ in items if ok)
        marker = "PASS" if g_pass == len(items) else "FAIL"
        print(f"\nGROUP {g}: {g_pass}/{len(items)} {marker}")
        for name, ok, detail in items:
            sym = "  PASS" if ok else "  FAIL"
            print(f"  {sym}  {name}")
            if not ok and detail:
                print(f"           {detail}")

    print()
    print("=" * 70)
    print(f"TOTAL: {passed}/{len(_RESULTS)}  in {total_ms:.0f} ms")
    print("=" * 70)

    # False-positive count = how many of the B tests failed (B tests
    # check that benign queries are NOT redacted).
    benign_failed = sum(1 for n, ok, _ in _RESULTS if n.startswith("B") and not ok)
    print(f"False positives on benign queries: {benign_failed}/8")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(_run_all())
