"""
Phase 9 — retention policy + sweeper unit tests (RET-004 / RET-005 / RET-008).

Pure unit tests with an injectable mock query runner. No real ArcadeDB.

Run inside or outside the container:
    PYTHONIOENCODING=utf-8 python _retention_test.py
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "scripts"))

from src.services import retention_policy as rp  # noqa: E402
import retention_sweeper as sweeper             # noqa: E402


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


# ── 1. Retention policy shape pinned ─────────────────────────────────
def test_policy_shape_pinned():
    section("1. RETENTION_POLICY: every entry has the required keys")
    required = {
        "data_class", "store", "vertex_type", "retention_days",
        "ttl_seconds", "mechanism", "sweeper_action",
        "legal_hold_supported", "field_created_at", "notes",
    }
    for key, entry in rp.RETENTION_POLICY.items():
        missing = required - set(entry.keys())
        check(f"entry {key!r} has all required keys",
              not missing, detail=f"missing: {missing}")
        check(f"entry {key!r} mechanism in known set",
              entry["mechanism"] in {"natural", "sweeper", "manual", "external"},
              detail=f"got {entry['mechanism']!r}")


def test_policy_legal_hold_invariants():
    section("2. legal_hold support: clinical record classes flagged")
    must_support = {
        "patient_profile", "vitals", "care_plan", "consultation",
        "consent_audit", "audit_event_store", "caregiver_consent_record",
    }
    holds = set(rp.classes_with_legal_hold())
    missing = must_support - holds
    check("clinical-record + audit classes support legal_hold",
          not missing, detail=f"missing: {missing}")
    # Ephemeral classes MUST NOT claim legal_hold.
    must_not = {"redis_session_cache", "otp", "dialogue_snapshot"}
    leaked = must_not & holds
    check("ephemeral classes do not claim legal_hold",
          not leaked, detail=f"leaked: {leaked}")


def test_classes_with_sweeper_subset():
    section("3. classes_with_sweeper() returns only sweeper-mechanism keys")
    keys = rp.classes_with_sweeper()
    for k in keys:
        entry = rp.RETENTION_POLICY[k]
        check(f"{k} has mechanism=sweeper", entry["mechanism"] == "sweeper",
              detail=f"got {entry['mechanism']}")


# ── 4. Sweeper preview is read-only (no DELETE in calls) ─────────────
class MockRunner:
    def __init__(self, total: int = 1000, candidates: int = 200,
                 held: int = 5):
        self.total = total
        self.candidates = candidates
        self.held = held
        self.calls: List[str] = []

    def __call__(self, sql: str) -> Dict[str, Any]:
        self.calls.append(sql)
        s = sql.upper()
        if "LEGAL_HOLD = TRUE" in s:
            return {"result": [{"n": self.held}]}
        if "WHERE" in s and "<" in s:
            return {"result": [{"n": self.candidates}]}
        if "SELECT COUNT(*) AS N" in s and "WHERE" not in s:
            return {"result": [{"n": self.total}]}
        return {"result": []}


def test_preview_no_destructive_sql():
    section("4. preview path issues no DELETE / DROP / TRUNCATE")
    runner = MockRunner(total=500, candidates=120, held=20)
    out = sweeper.preview_class(
        data_class="vitals", rp=rp, query_runner=runner,
    )
    check("preview ok", out.get("ok") is True
          and out.get("preview") == "ready",
          detail=str(out))
    check("preview computed sweepable correctly",
          out["sweepable"] == 100, detail=str(out))
    forbidden = ("DELETE", "DROP", "TRUNCATE", "ALTER")
    issued = " ".join(runner.calls).upper()
    leaked = [w for w in forbidden if w in issued]
    check("no destructive SQL issued in preview path",
          not leaked, detail=f"leaked: {leaked}")


def test_preview_skips_filesystem_classes():
    section("5. filesystem classes return preview='skipped'")
    runner = MockRunner()
    out = sweeper.preview_class(
        data_class="caregiver_uploads", rp=rp, query_runner=runner,
    )
    check("filesystem class skipped",
          out.get("preview") == "skipped"
          and "filesystem" in (out.get("reason") or ""),
          detail=str(out))
    check("zero SQL issued for filesystem class",
          len(runner.calls) == 0, detail=str(runner.calls))


def test_preview_skips_natural_and_manual():
    section("6. natural + manual mechanisms are skipped")
    runner = MockRunner()
    natural = sweeper.preview_class(
        data_class="redis_session_cache", rp=rp, query_runner=runner,
    )
    check("redis (natural) skipped",
          natural.get("preview") == "skipped"
          and natural.get("reason", "").startswith("mechanism_"),
          detail=str(natural))
    manual = sweeper.preview_class(
        data_class="patient_profile", rp=rp, query_runner=runner,
    )
    check("patient_profile (manual) skipped",
          manual.get("preview") == "skipped",
          detail=str(manual))


def test_preview_unknown_class():
    section("7. unknown class returns ok=False with reason")
    runner = MockRunner()
    out = sweeper.preview_class(
        data_class="this_class_does_not_exist", rp=rp, query_runner=runner,
    )
    check("unknown class -> ok=False",
          out.get("ok") is False
          and out.get("reason") == "unknown_class",
          detail=str(out))


# ── 8. Apply path is gated ───────────────────────────────────────────
def test_apply_refuses_non_sweeper_class():
    section("8. apply refuses filesystem / non-sweeper classes")
    runner = MockRunner()
    for cls in ("caregiver_uploads", "redis_session_cache", "patient_profile"):
        out = sweeper.apply_class(
            data_class=cls, rp=rp, query_runner=runner,
            expected_sweepable=10,
        )
        check(f"apply on {cls!r} refused",
              out.get("ok") is False
              and out.get("reason") == "class_not_eligible_for_apply",
              detail=str(out))
    check("zero SQL issued in refused-apply path",
          len(runner.calls) == 0, detail=str(runner.calls))


def test_apply_aborts_on_drift():
    section("9. apply aborts when live count drifts > 5%")
    runner = MockRunner(total=500, candidates=120, held=20)  # sweepable=100
    out = sweeper.apply_class(
        data_class="vitals", rp=rp, query_runner=runner,
        expected_sweepable=200,  # operator's preview was 200, live is 100
    )
    check("drift > 5% aborts the apply",
          out.get("ok") is False
          and "drift" in (out.get("reason") or ""),
          detail=str(out))
    issued = " ".join(runner.calls).upper()
    check("no DELETE issued on drift abort",
          "DELETE FROM" not in issued, detail=issued[:120])


def test_apply_emits_legal_hold_guard():
    section("10. apply DELETE includes legal_hold guard")
    runner = MockRunner(total=500, candidates=120, held=20)  # sweepable=100
    out = sweeper.apply_class(
        data_class="vitals", rp=rp, query_runner=runner,
        expected_sweepable=100,  # matches live
    )
    issued_delete = next(
        (s for s in runner.calls if s.upper().startswith("DELETE FROM ")),
        None,
    )
    check("delete SQL was emitted", issued_delete is not None,
          detail=str(runner.calls))
    if issued_delete:
        u = issued_delete.upper()
        check("DELETE includes legal_hold guard",
              "LEGAL_HOLD" in u and "FALSE" in u,
              detail=issued_delete)


# ── 11. PHI / payload guarantees ─────────────────────────────────────
def test_preview_returns_counts_only():
    section("11. preview output is counts only — no PHI / row contents")
    runner = MockRunner(total=500, candidates=120, held=20)
    out = sweeper.preview_class(
        data_class="vitals", rp=rp, query_runner=runner,
    )
    forbidden_keys = {
        "phone", "name", "email", "ip", "user_agent",
        "row", "rows", "raw", "data",
    }
    leaked = forbidden_keys & set(out.keys())
    check("preview output keys do not include row payloads",
          not leaked, detail=f"leaked: {leaked}")


# ── Run all ──────────────────────────────────────────────────────────
def main() -> int:
    print("Phase 9 — Retention policy + sweeper test suite")
    print("=" * 64)
    test_policy_shape_pinned()
    test_policy_legal_hold_invariants()
    test_classes_with_sweeper_subset()
    test_preview_no_destructive_sql()
    test_preview_skips_filesystem_classes()
    test_preview_skips_natural_and_manual()
    test_preview_unknown_class()
    test_apply_refuses_non_sweeper_class()
    test_apply_aborts_on_drift()
    test_apply_emits_legal_hold_guard()
    test_preview_returns_counts_only()
    print("\n" + "=" * 64)
    print(f"PASSED: {passed}    FAILED: {failed}")
    if failed:
        for e in errors:
            print(f"  - {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
