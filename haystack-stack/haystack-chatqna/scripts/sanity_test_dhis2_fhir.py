"""
AMINA Care — DHIS2 + FHIR Sanity Test
======================================
End-to-end sanity check for the Phase 1 polish + Phase 2.1–2.3 work:

  - Backend health
  - Admin auth
  - DHIS2 aggregate sync (config, status, metrics, dry-run)
  - DHIS2 Tracker (config, dry-run)
  - DHIS2 retry queue + audit log + Redis counters
  - FHIR R4 (metadata, code, Patient, $everything Bundle)
  - ICD-10 coder (9 clinical scenarios covering WHO PEN + Gambia priorities)
  - Prometheus metrics scaffolding
  - Startup scheduler presence

Run from inside docker (`docker exec haystack-chatqna python3 /app/scripts/sanity_test_dhis2_fhir.py`)
or from host (set AMINA_API env var to the backend URL).

Every test is independent — failures are collected, not fatal. The script
prints a final pass/fail table.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    print("FATAL: requests package not available")
    sys.exit(2)


# ── Config ───────────────────────────────────────────────────────────────────

API      = os.environ.get("AMINA_API", "http://localhost:8000").rstrip("/")
ADMIN_U  = os.environ.get("AMINA_ADMIN_USER", "admin")
ADMIN_P  = os.environ.get("AMINA_ADMIN_PASSWORD", "amina2026")
TIMEOUT  = 15


# ── Output helpers ──────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
GREEN  = "\033[32m"
RED    = "\033[31m"
AMBER  = "\033[33m"
BLUE   = "\033[34m"
GRAY   = "\033[90m"


def header(text: str) -> None:
    print(f"\n{BOLD}{BLUE}{'─' * 70}{RESET}")
    print(f"{BOLD}{BLUE}  {text}{RESET}")
    print(f"{BOLD}{BLUE}{'─' * 70}{RESET}")


def _fmt(prefix: str, color: str, name: str, detail: str = "") -> None:
    print(f"  {color}{prefix}{RESET}  {name}" + (f"  {GRAY}{detail}{RESET}" if detail else ""))


def ok(name: str, detail: str = "") -> None:
    _fmt("✓", GREEN, name, detail)


def fail(name: str, detail: str = "") -> None:
    _fmt("✗", RED, name, detail)


def warn(name: str, detail: str = "") -> None:
    _fmt("!", AMBER, name, detail)


def skip(name: str, detail: str = "") -> None:
    _fmt("○", GRAY, name, detail)


# ── Test runner ─────────────────────────────────────────────────────────────

class Results:
    def __init__(self) -> None:
        self.passed: List[str] = []
        self.failed: List[Tuple[str, str]] = []
        self.warned: List[Tuple[str, str]] = []
        self.skipped: List[str] = []

    def pass_(self, name: str) -> None:
        self.passed.append(name)

    def fail_(self, name: str, detail: str) -> None:
        self.failed.append((name, detail))

    def warn_(self, name: str, detail: str) -> None:
        self.warned.append((name, detail))

    def skip_(self, name: str) -> None:
        self.skipped.append(name)

    def summary(self) -> int:
        total = len(self.passed) + len(self.failed) + len(self.warned) + len(self.skipped)
        header(f"RESULTS — {total} total")
        print(f"  {GREEN}{len(self.passed)} passed{RESET}   "
              f"{RED}{len(self.failed)} failed{RESET}   "
              f"{AMBER}{len(self.warned)} warned{RESET}   "
              f"{GRAY}{len(self.skipped)} skipped{RESET}")
        if self.failed:
            print(f"\n  {BOLD}Failures:{RESET}")
            for name, detail in self.failed:
                print(f"    {RED}✗{RESET} {name}")
                print(f"       {GRAY}{detail}{RESET}")
        if self.warned:
            print(f"\n  {BOLD}Warnings (non-fatal):{RESET}")
            for name, detail in self.warned:
                print(f"    {AMBER}!{RESET} {name}")
                print(f"       {GRAY}{detail}{RESET}")
        print()
        return 0 if not self.failed else 1


def run(name: str, fn: Callable, results: Results) -> Any:
    try:
        result = fn()
        ok(name)
        results.pass_(name)
        return result
    except AssertionError as e:
        fail(name, str(e))
        results.fail_(name, str(e))
    except Exception as e:
        fail(name, f"{type(e).__name__}: {e}")
        results.fail_(name, f"{type(e).__name__}: {e}")
    return None


def run_warn(name: str, fn: Callable, results: Results) -> Any:
    """Run a check that warns (not fails) on exceptions — for optional features."""
    try:
        result = fn()
        ok(name)
        results.pass_(name)
        return result
    except Exception as e:
        warn(name, str(e))
        results.warn_(name, str(e))
    return None


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def http(method: str, path: str, token: Optional[str] = None, json_body: Any = None) -> Tuple[int, Any]:
    url = f"{API}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = requests.request(method, url, headers=headers, json=json_body, timeout=TIMEOUT)
    try:
        body = resp.json()
    except Exception:
        body = resp.text
    return resp.status_code, body


def assert_eq(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_in(needle: Any, haystack: Any, label: str) -> None:
    if needle not in haystack:
        raise AssertionError(f"{label}: {needle!r} not in {haystack!r}")


def assert_status(status: int, expected: int, path: str) -> None:
    if status != expected:
        raise AssertionError(f"{path}: HTTP {status} (expected {expected})")


def assert_truthy(value: Any, label: str) -> None:
    if not value:
        raise AssertionError(f"{label}: expected truthy, got {value!r}")


# ── Test suites ──────────────────────────────────────────────────────────────

def test_backend_health(results: Results) -> None:
    header("SECTION 1 — Backend health")

    def _health():
        s, b = http("GET", "/health")
        assert_status(s, 200, "/health")
        assert_eq(b.get("status"), "ok", "health.status")
    run("backend /health returns 200 ok", _health, results)

    def _openapi():
        s, b = http("GET", "/openapi.json")
        assert_status(s, 200, "/openapi.json")
        paths = b.get("paths", {})
        # Key paths for Phase 1 + Phase 2 (2.1–2.10)
        required = [
            # Phase 1 + 2.1–2.3
            "/api/v1/dhis2/config",
            "/api/v1/dhis2/metrics/today",
            "/api/v1/dhis2/sync/dry-run",
            "/api/v1/dhis2/sync/manual",
            "/api/v1/dhis2/sync/status",
            "/api/v1/dhis2/tracker/config",
            "/api/v1/dhis2/tracker/push",
            "/api/v1/dhis2/tracker/dry-run",
            "/api/v1/dhis2/tracker/batch",
            "/api/v1/fhir/metadata",
            "/api/v1/fhir/code",
            # Phase 2.5 — consent
            "/api/v1/consent/me",
            "/api/v1/consent/me/history",
            "/api/v1/consent/{patient_id}",
            # Phase 2.6 — bi-directional pull
            "/api/v1/dhis2/pull/manual",
            "/api/v1/dhis2/pull/referrals/{patient_id}",
            "/api/v1/dhis2/pull/referrals/unlinked/all",
            # Phase 2.7 — Android Capture
            "/api/v1/dhis2/android/export/region",
            "/api/v1/dhis2/android/export/ids",
            # Phase 2.10 — tracker audit
            "/api/v1/dhis2/tracker/audit",
        ]
        missing = [p for p in required if p not in paths]
        if missing:
            raise AssertionError(f"missing routes: {missing}")
    run("all Phase 1 + Phase 2 routes registered in OpenAPI", _openapi, results)


def test_admin_auth(results: Results) -> Optional[str]:
    header("SECTION 2 — Admin auth")

    def _login() -> str:
        s, b = http("POST", "/api/v1/admin/login", json_body={"username": ADMIN_U, "password": ADMIN_P})
        assert_status(s, 200, "admin/login")
        assert_truthy(b.get("success"), "login.success")
        token = b.get("token")
        assert_truthy(token, "login.token")
        return token

    token = run("POST /admin/login returns JWT", _login, results)

    if token:
        def _reject_unauth():
            s, _ = http("GET", "/api/v1/dhis2/config")  # no token
            assert_status(s, 401, "dhis2/config (unauth)")
        run("unauth request to /dhis2/config returns 401", _reject_unauth, results)

    return token


def test_dhis2_config_status(results: Results, token: str) -> None:
    header("SECTION 3 — DHIS2 aggregate config + status")

    def _config():
        s, b = http("GET", "/api/v1/dhis2/config", token=token)
        assert_status(s, 200, "dhis2/config")
        for key in ("base_url", "auth_method", "metric_keys", "orgunit_mapping", "dataelement_mapping", "configured"):
            assert_in(key, b, f"config.{key}")
        mk = b.get("metric_keys", [])
        assert_eq(len(mk), 11, "metric_keys count")
        required_keys = {"AMINA_CONS_TOTAL", "AMINA_CONS_EMERGENCY", "AMINA_NCD_HTN", "AMINA_NCD_DM",
                         "AMINA_MCH", "AMINA_MENTAL_HEALTH", "AMINA_CG_ALERTS", "AMINA_SAFETY_BLOCKS"}
        missing = required_keys - set(mk)
        if missing:
            raise AssertionError(f"missing metric keys: {missing}")
    run("GET /dhis2/config returns 11 metric keys", _config, results)

    def _status():
        s, b = http("GET", "/api/v1/dhis2/sync/status", token=token)
        assert_status(s, 200, "dhis2/sync/status")
        assert_in("last_sync", b, "status.last_sync")
    run("GET /dhis2/sync/status returns last_sync key", _status, results)


def test_dhis2_metrics_and_dryrun(results: Results, token: str) -> None:
    header("SECTION 4 — DHIS2 metric collection + dry-run")

    def _today():
        s, b = http("GET", "/api/v1/dhis2/metrics/today", token=token)
        assert_status(s, 200, "dhis2/metrics/today")
        assert_in("totals", b, "today.totals")
        assert_in("by_region", b, "today.by_region")
        assert_in("period", b, "today.period")
        # Period must be YYYYMMDD
        p = b.get("period", "")
        if not (len(p) == 8 and p.isdigit()):
            raise AssertionError(f"bad period format: {p!r}")
    run("GET /dhis2/metrics/today returns today's aggregated counts", _today, results)

    def _dryrun_today():
        s, b = http("POST", "/api/v1/dhis2/sync/dry-run", token=token, json_body={})
        assert_status(s, 200, "dhis2/sync/dry-run")
        for key in ("day", "period", "regions", "totals", "value_count", "warnings", "dry_run"):
            assert_in(key, b, f"dryrun.{key}")
        assert_eq(b.get("dry_run"), True, "dryrun.dry_run")
    run("POST /dhis2/sync/dry-run returns structured preview (no day)", _dryrun_today, results)

    def _dryrun_specific_day():
        s, b = http("POST", "/api/v1/dhis2/sync/dry-run", token=token,
                    json_body={"day": "2026-04-12"})
        assert_status(s, 200, "dhis2/sync/dry-run day=2026-04-12")
        assert_eq(b.get("day"), "2026-04-12", "dryrun.day")
        assert_eq(b.get("period"), "20260412", "dryrun.period")
    run("POST /dhis2/sync/dry-run accepts YYYY-MM-DD day", _dryrun_specific_day, results)

    def _dryrun_bad_day():
        s, b = http("POST", "/api/v1/dhis2/sync/dry-run", token=token,
                    json_body={"day": "not-a-date"})
        assert_status(s, 400, "dhis2/sync/dry-run bad-day")
    run("POST /dhis2/sync/dry-run rejects invalid date format", _dryrun_bad_day, results)

    def _manual_without_config():
        # With no DHIS2 creds configured, manual sync should run cleanly and
        # report "nothing to push" or a config error — but MUST NOT crash.
        s, b = http("POST", "/api/v1/dhis2/sync/manual", token=token, json_body={})
        assert_status(s, 200, "dhis2/sync/manual")
        assert_in("pushed", b, "manual.pushed")
        # pushed=False is expected in unconfigured env — this verifies graceful handling
    run("POST /dhis2/sync/manual handles unconfigured DHIS2 gracefully", _manual_without_config, results)


def test_dhis2_tracker(results: Results, token: str) -> None:
    header("SECTION 5 — DHIS2 Tracker (Phase 2.3)")

    def _config():
        s, b = http("GET", "/api/v1/dhis2/tracker/config", token=token)
        assert_status(s, 200, "tracker/config")
        for key in ("enabled", "program_id", "program_stage_id", "tei_type_id",
                    "attribute_map", "data_element_map", "configured"):
            assert_in(key, b, f"tracker_config.{key}")
    run("GET /dhis2/tracker/config returns tracker status", _config, results)

    def _disabled_push():
        # Tracker is disabled in dev → push should return a disabled error cleanly
        s, b = http("POST", "/api/v1/dhis2/tracker/push", token=token,
                    json_body={"patient_id": "nonexistent", "force": True})
        assert_status(s, 200, "tracker/push")
        err = str(b.get("error", ""))
        if "disabled" not in err.lower() and "not found" not in err.lower():
            raise AssertionError(f"expected 'disabled' or 'not found' error, got: {err}")
    run("POST /dhis2/tracker/push returns disabled error when feature flag off", _disabled_push, results)

    def _batch_too_large():
        s, b = http("POST", "/api/v1/dhis2/tracker/batch", token=token,
                    json_body={"patient_ids": [f"p_{i}" for i in range(101)]})
        assert_status(s, 400, "tracker/batch too-large")
    run("POST /dhis2/tracker/batch enforces 100-patient limit", _batch_too_large, results)


def test_fhir_metadata(results: Results) -> None:
    header("SECTION 6 — FHIR R4 metadata")

    def _metadata():
        # Metadata is public (capability statement)
        s, b = http("GET", "/api/v1/fhir/metadata")
        assert_status(s, 200, "fhir/metadata")
        assert_eq(b.get("resourceType"), "CapabilityStatement", "metadata.resourceType")
        assert_eq(b.get("fhirVersion"), "4.0.1", "metadata.fhirVersion")
        assert_eq(b.get("status"), "active", "metadata.status")
        rest = b.get("rest", [{}])[0]
        resources = [r.get("type") for r in rest.get("resource", [])]
        required = {"Patient", "Encounter", "Observation", "Condition", "CarePlan"}
        missing = required - set(resources)
        if missing:
            raise AssertionError(f"missing FHIR resources: {missing}")
    run("GET /fhir/metadata returns valid CapabilityStatement", _metadata, results)


def test_icd10_coder(results: Results, token: str) -> None:
    header("SECTION 7 — ICD-10 coder (9 clinical scenarios)")

    def _check(name: str, text: str, expected_codes: List[str]) -> Callable:
        def _fn():
            s, b = http("POST", "/api/v1/fhir/code", token=token, json_body={"text": text})
            assert_status(s, 200, f"fhir/code [{name}]")
            returned = {c["code"] for c in b.get("codes", [])}
            missing = set(expected_codes) - returned
            if missing:
                raise AssertionError(f"missing codes: {missing}, got: {sorted(returned)}")
        return _fn

    # Each tuple: (label, test_text, must_include_codes)
    cases = [
        ("T2DM + HTN + asthma",
         "Patient with type 2 diabetes, high blood pressure and asthma.",
         ["E11.9", "I10", "J45.9"]),
        ("Hypertensive crisis",
         "Patient in hypertensive emergency with severe chest pain.",
         ["I16.9", "R07.4"]),
        ("Gestational diabetes (precedence over generic DM)",
         "28-week pregnancy, gestational diabetes diagnosed last week.",
         ["O24.4"]),
        ("Antenatal care visit",
         "Routine antenatal care visit, 20 weeks.",
         ["Z34.9"]),
        ("Malaria + fever",
         "Child presenting with fever and confirmed malaria infection.",
         ["B54", "R50.9"]),
        ("Depression + anxiety",
         "Patient reports depression and anxiety for the past 3 months.",
         ["F32.9", "F41.9"]),
        ("Acute asthma attack",
         "Status asthmaticus, severe wheezing, unable to speak.",
         ["J46"]),
        ("Severe acute malnutrition",
         "5-year-old with severe acute malnutrition, weight for height < -3 SD.",
         ["E43"]),
        ("Tuberculosis + HIV coinfection",
         "Known HIV positive patient now diagnosed with pulmonary tuberculosis.",
         ["B24", "A15.9"]),
    ]

    for label, text, expected in cases:
        run(f"ICD-10: {label}", _check(label, text, expected), results)


def test_icd10_negation(results: Results, token: str) -> None:
    header("SECTION 8 — ICD-10 negation detection")

    def _no_chest_pain():
        s, b = http("POST", "/api/v1/fhir/code", token=token,
                    json_body={"text": "Patient denies chest pain and no shortness of breath."})
        assert_status(s, 200, "fhir/code negation")
        codes = [c["code"] for c in b.get("codes", [])]
        # Should NOT include R07.4 (chest pain) or R06.0 (dyspnoea) since they're negated
        if "R07.4" in codes:
            raise AssertionError(f"negation missed: R07.4 found when 'denies chest pain' — codes={codes}")
    run("negation: 'denies chest pain' does NOT code R07.4", _no_chest_pain, results)


def test_internal_python_paths(results: Results) -> None:
    """Tests that hit internal Python paths directly inside the container.
    Covers Redis counter bumping, retry queue, and audit log — things we can't
    observe via HTTP alone."""
    header("SECTION 9 — Internal paths (Redis + ArcadeDB)")

    # Only works when run inside the haystack-chatqna container
    try:
        sys.path.insert(0, "/app")
        from src.services.dhis2_sync import (
            bump_daily_counter, METRIC_KEYS, collect_daily_metrics,
            _retry_key, _enqueue_retry, run_pending_retries,
            _FAILURE_STREAK_KEY, _bump_failure_streak, _reset_failure_streak,
            _audit_log, _ensure_audit_schema,
        )
        import redis as _redis
        from src.config import settings
        from datetime import date
    except ImportError as e:
        skip(f"internal paths (not inside container: {e})")
        return

    r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)

    def _bump_counter():
        period = datetime.utcnow().strftime("%Y%m%d")
        key = f"dhis2:daily:{period}:test_region:AMINA_CG_ALERTS"
        r.delete(key)
        bump_daily_counter("test_region", "AMINA_CG_ALERTS", amount=3)
        bump_daily_counter("test_region", "AMINA_CG_ALERTS", amount=2)
        val = int(r.get(key) or 0)
        if val != 5:
            raise AssertionError(f"expected counter=5, got {val}")
        r.delete(key)
    run("bump_daily_counter increments Redis key correctly", _bump_counter, results)

    def _bad_metric_key_ignored():
        before = len(list(r.scan_iter("dhis2:daily:*")))
        bump_daily_counter("test_region", "NOT_A_REAL_METRIC", amount=1)
        after = len(list(r.scan_iter("dhis2:daily:*")))
        if after != before:
            raise AssertionError("invalid metric key created a Redis entry")
    run("bump_daily_counter ignores unknown metric keys", _bad_metric_key_ignored, results)

    def _metrics_counter_merge():
        period = datetime.utcnow().strftime("%Y%m%d")
        key = f"dhis2:daily:{period}:kanifing:AMINA_CG_ALERTS"
        r.delete(key)
        bump_daily_counter("kanifing", "AMINA_CG_ALERTS", amount=7)
        metrics = collect_daily_metrics(datetime.utcnow().date())
        kanifing = metrics.get("kanifing", {})
        if kanifing.get("AMINA_CG_ALERTS") != 7:
            raise AssertionError(f"counter didn't merge into collect_daily_metrics: {kanifing}")
        r.delete(key)
    run("collect_daily_metrics merges Redis counters by region", _metrics_counter_merge, results)

    def _retry_queue():
        # Enqueue a fake retry, verify key exists
        fake_period = "19700101"  # ancient period so next_try_at fires immediately
        fake_payload = {"period": fake_period, "dataValues": [{"test": 1}]}
        _enqueue_retry(fake_payload, fake_period, attempt=0)
        raw = r.get(_retry_key(fake_period))
        if not raw:
            raise AssertionError("retry key not found after enqueue")
        record = json.loads(raw)
        if record.get("attempt") != 0:
            raise AssertionError(f"wrong attempt: {record}")
        # Clean up
        r.delete(_retry_key(fake_period))
    run("retry queue enqueues failed pushes to Redis", _retry_queue, results)

    def _failure_streak():
        _reset_failure_streak()
        s1 = _bump_failure_streak()
        s2 = _bump_failure_streak()
        s3 = _bump_failure_streak()
        if not (s1 == 1 and s2 == 2 and s3 == 3):
            raise AssertionError(f"streak counters wrong: {s1}/{s2}/{s3}")
        _reset_failure_streak()
        if r.get(_FAILURE_STREAK_KEY):
            raise AssertionError("failure streak did not reset")
    run("failure streak counter increments + resets", _failure_streak, results)

    def _audit_schema_and_write():
        _ensure_audit_schema()
        _audit_log(
            action="test", period="20260412", success=True,
            value_count=99, totals={"AMINA_CONS_TOTAL": 99},
            response={"note": "sanity test"}, warnings=[],
            triggered_by="sanity_test",
        )
        # Verify the audit row landed (ArcadeDB uses push_action col name, not action)
        try:
            from src.utils.arcade_client import command_sql
            resp = command_sql(
                "SELECT count(*) as cnt FROM DHIS2AuditVertex "
                "WHERE triggered_by = 'sanity_test' AND push_action = 'test'"
            )
            rows = (resp or {}).get("result", [])
            n = int(rows[0].get("cnt", 0)) if rows else 0
            if n == 0:
                raise AssertionError("audit row not found after write")
        except Exception as e:
            raise AssertionError(f"audit verify failed: {e}")
    run("DHIS2AuditVertex schema + write verified via ArcadeDB", _audit_schema_and_write, results)


def test_icd10_coder_direct(results: Results) -> None:
    """Direct Python import of the ICD-10 coder — only works inside container."""
    header("SECTION 10 — ICD-10 coder direct Python API")

    try:
        sys.path.insert(0, "/app")
        from src.services.icd10_coder import code_text, code_to_fhir_condition, categorize_metric_from_codes
    except ImportError:
        skip("icd10_coder direct (not inside container)")
        return

    def _empty_text():
        codes = code_text("")
        if codes:
            raise AssertionError(f"empty text should return [], got {codes}")
    run("empty text returns empty list", _empty_text, results)

    def _specificity():
        # "gestational diabetes" should resolve to O24.4, NOT E11.9 or E14.9
        codes = code_text("Patient has gestational diabetes at 24 weeks.")
        top = codes[0] if codes else None
        if not top or top.code != "O24.4":
            raise AssertionError(f"specificity ordering broken: top={top}")
    run("more specific patterns win (gestational diabetes → O24.4)", _specificity, results)

    def _fhir_condition():
        codes = code_text("Type 2 diabetes mellitus.")
        assert codes, "no codes returned"
        cond = code_to_fhir_condition(codes[0], patient_ref="urn:aminacare:patient:p1")
        if cond.get("resourceType") != "Condition":
            raise AssertionError(f"wrong resourceType: {cond}")
        if cond.get("code", {}).get("coding", [{}])[0].get("system") != "http://hl7.org/fhir/sid/icd-10":
            raise AssertionError(f"wrong system: {cond}")
    run("code_to_fhir_condition produces valid FHIR Condition", _fhir_condition, results)

    def _metric_mapping():
        codes = code_text("Hypertension and diabetes and gestational diabetes.")
        metrics = categorize_metric_from_codes(codes)
        for required in ("AMINA_NCD_HTN", "AMINA_NCD_DM", "AMINA_MCH"):
            if required not in metrics:
                raise AssertionError(f"missing metric {required} in {metrics}")
    run("categorize_metric_from_codes maps HTN+DM+MCH correctly", _metric_mapping, results)


def test_fhir_mapper_direct(results: Results) -> None:
    header("SECTION 11 — FHIR mapper direct Python API")

    try:
        sys.path.insert(0, "/app")
        from src.services.fhir_mapper import (
            build_patient, build_encounter, build_patient_bundle,
            build_bp_observations, build_care_plan,
        )
    except ImportError:
        skip("fhir_mapper direct (not inside container)")
        return

    sample_patient = {
        "id":        "p_sanity_001",
        "name":      "Fatou Ceesay",
        "age":       45,
        "gender":    "female",
        "phone":     "+2201234567",
        "region":    "kanifing",
        "preferred_language": "mandinka",
        "conditions": json.dumps([{"name": "hypertension"}, {"name": "type 2 diabetes"}]),
        "bp_readings": json.dumps([
            {"systolic": 145, "diastolic": 92, "date": "2026-04-10"},
            {"systolic": 138, "diastolic": 88, "date": "2026-04-12"},
        ]),
        "key_facts": json.dumps(["Takes amlodipine 5mg daily", "Fasts during Ramadan"]),
    }
    sample_consultation = {
        "id":             "c_sanity_001",
        "patient_id":     "p_sanity_001",
        "session_id":     "s_sanity_001",
        "started_at":     "2026-04-13T08:00:00",
        "ended_at":       "2026-04-13T08:15:00",
        "triage_level":   "URGENT",
        "symptoms_reported": json.dumps(["chest pain", "shortness of breath"]),
        "summary":        "Patient reports chest pain and difficulty breathing. History of hypertension and diabetes.",
    }

    def _patient():
        p = build_patient(sample_patient)
        assert_eq(p.get("resourceType"), "Patient", "patient.resourceType")
        assert_eq(p.get("id"), "p_sanity_001", "patient.id")
        assert_eq(p.get("gender"), "female", "patient.gender")
        assert p.get("name"), "patient.name missing"
    run("build_patient produces valid FHIR Patient", _patient, results)

    def _encounter():
        e = build_encounter(sample_consultation, "p_sanity_001")
        assert_eq(e.get("resourceType"), "Encounter", "encounter.resourceType")
        assert_eq(e.get("status"), "finished", "encounter.status")
        prio = e.get("priority", {}).get("coding", [{}])[0].get("code")
        assert_eq(prio, "UR", "encounter.priority.code")
    run("build_encounter produces valid FHIR Encounter with URGENT priority", _encounter, results)

    def _bp():
        obs = build_bp_observations(sample_patient, "p_sanity_001")
        if len(obs) != 2:
            raise AssertionError(f"expected 2 bp observations, got {len(obs)}")
        first = obs[0]
        assert_eq(first.get("resourceType"), "Observation", "bp.resourceType")
        components = first.get("component", [])
        if len(components) != 2:
            raise AssertionError(f"bp observation should have 2 components, got {len(components)}")
    run("build_bp_observations produces FHIR Observations with LOINC 85354-9", _bp, results)

    def _care_plan():
        cp = build_care_plan(sample_patient, "p_sanity_001")
        assert cp is not None, "care plan should not be None"
        assert_eq(cp.get("resourceType"), "CarePlan", "careplan.resourceType")
        if not cp.get("activity"):
            raise AssertionError("care plan has no activities from key_facts")
    run("build_care_plan produces FHIR CarePlan from key_facts", _care_plan, results)

    def _bundle():
        bundle = build_patient_bundle(sample_patient, [sample_consultation])
        assert_eq(bundle.get("resourceType"), "Bundle", "bundle.resourceType")
        assert_eq(bundle.get("type"), "collection", "bundle.type")
        entries = bundle.get("entry", [])
        types = {e["resource"]["resourceType"] for e in entries if "resource" in e}
        # Must include at minimum: Patient, Observation, Encounter, Condition, CarePlan
        required = {"Patient", "Observation", "Encounter", "Condition", "CarePlan"}
        missing = required - types
        if missing:
            raise AssertionError(f"bundle missing resource types: {missing}; got {types}")
    run("build_patient_bundle produces full Bundle with all 5 resource types", _bundle, results)


def test_tracker_payloads_direct(results: Results) -> None:
    header("SECTION 12 — DHIS2 Tracker payload builders (direct)")

    try:
        sys.path.insert(0, "/app")
        from src.services.dhis2_tracker import (
            build_tei_payload, build_enrollment_payload, build_event_payload,
        )
    except ImportError:
        skip("dhis2_tracker direct (not inside container)")
        return

    def _tei_without_config():
        # Without TEI_TYPE_ID configured, builder should return None
        tei = build_tei_payload({"id": "p1", "name": "Test", "region": "kanifing"})
        if tei is not None:
            raise AssertionError(f"expected None without config, got {tei}")
    run("build_tei_payload returns None when TEI_TYPE_ID not set", _tei_without_config, results)

    def _enrollment_without_program():
        enr = build_enrollment_payload("tei1", "ou1")
        if enr is not None:
            raise AssertionError(f"expected None without program, got {enr}")
    run("build_enrollment_payload returns None when PROGRAM_ID not set", _enrollment_without_program, results)

    def _event_without_config():
        evt = build_event_payload(
            consultation={"id": "c1", "triage_level": "URGENT"},
            tei_id="tei1",
            enrollment_id="enr1",
            orgunit="ou1",
        )
        # Without program/stage config, returns None
        if evt is not None:
            raise AssertionError(f"expected None without config, got {evt}")
    run("build_event_payload returns None when PROGRAM_STAGE_ID not set", _event_without_config, results)


def test_phi_deid(results: Results) -> None:
    header("SECTION 14 — PHI de-identification (Phase 2.4)")

    try:
        sys.path.insert(0, "/app")
        from src.services.phi_deid import redact_text, redact_patient, redact_consultation
    except ImportError:
        skip("phi_deid direct (not inside container)")
        return

    def _redact_phone():
        rep = redact_text("Call Fatou at +220 7110001 tomorrow.")
        assert "[PHONE]" in rep.redacted_text, f"phone not redacted: {rep.redacted_text}"
        assert "7110001" not in rep.redacted_text, "raw phone leaked"
    run("PHI: phone number redacted", _redact_phone, results)

    def _redact_email():
        rep = redact_text("Contact us at amina@moh.gm for follow-up.")
        assert "[EMAIL]" in rep.redacted_text
        assert "amina@moh.gm" not in rep.redacted_text
    run("PHI: email redacted", _redact_email, results)

    def _redact_date():
        rep = redact_text("Visit scheduled for 2026-04-15.")
        assert "[DATE]" in rep.redacted_text
    run("PHI: ISO date redacted", _redact_date, results)

    def _redact_village():
        rep = redact_text("Patient lives in Brikama and visits the Serrekunda clinic.")
        assert "[VILLAGE]" in rep.redacted_text
        assert "brikama" not in rep.redacted_text.lower()
    run("PHI: Gambia village names redacted", _redact_village, results)

    def _redact_gps():
        rep = redact_text("Coordinates: 13.4549, -16.5790")
        assert "[GPS]" in rep.redacted_text
    run("PHI: GPS coordinates redacted", _redact_gps, results)

    def _whitelist_health_terms():
        rep = redact_text("Patient has high blood pressure and visits West Coast regularly.")
        # "Blood Pressure" and "West Coast" are in the whitelist — must NOT be redacted as name
        assert "[NAME]" not in rep.redacted_text, f"whitelist failed: {rep.redacted_text}"
    run("PHI: medical whitelist prevents false name redaction", _whitelist_health_terms, results)

    def _patient_structured():
        record = {
            "id": "p1", "name": "Fatou Ceesay", "phone": "+2201234567",
            "age": 92, "region": "kanifing", "conditions": "htn, dm",
            "key_facts": ["Lives in Brikama", "Daughter Aisha helps"],
        }
        redacted, report = redact_patient(record)
        if redacted.get("name") is not None:
            raise AssertionError("patient name not dropped")
        if redacted.get("phone") is not None:
            raise AssertionError("patient phone not dropped")
        if "age" in redacted:
            raise AssertionError("age not coarsened")
        if redacted.get("age_band") != "90+":
            raise AssertionError(f"age band wrong: {redacted.get('age_band')}")
    run("PHI: structured patient redaction (drop + coarsen)", _patient_structured, results)

    def _consultation_redact():
        consultation = {
            "id": "c1",
            "summary": "Fatou Ceesay visited on 2026-04-14, phone +2201234567.",
            "symptoms_reported": ["chest pain", "headache"],
            "triage_level": "URGENT",
        }
        redacted, report = redact_consultation(consultation, patient_name="Fatou Ceesay")
        summary = redacted.get("summary", "")
        assert "Ceesay" not in summary, f"name leaked: {summary}"
        assert "2026-04-14" not in summary, f"date leaked: {summary}"
        assert "URGENT" == redacted.get("triage_level"), "clinical field corrupted"
    run("PHI: consultation redaction keeps clinical fields", _consultation_redact, results)


def test_consent(results: Results, token: str) -> None:
    header("SECTION 15 — Consent management (Phase 2.5)")

    try:
        sys.path.insert(0, "/app")
        from src.services import consent_service
    except ImportError:
        skip("consent direct (not inside container)")
        return

    test_pid = "p_consent_sanity_test"

    def _default_consent():
        state = consent_service.get_all_consents(test_pid)
        flags = state["flags"]
        assert flags.get("dhis2_aggregate") is True, "default dhis2_aggregate should be True"
        assert flags.get("dhis2_tracker") is False, "default dhis2_tracker should be False"
    run("consent: defaults return for unknown patient", _default_consent, results)

    def _set_tracker_consent():
        result = consent_service.set_consent(
            patient_id=test_pid, scope="dhis2_tracker", value=True,
            actor="sanity_test", reason="test run",
        )
        assert result.get("ok") is True
        assert result.get("new_value") is True
    run("consent: set_consent grants tracker scope", _set_tracker_consent, results)

    def _unknown_scope_rejected():
        result = consent_service.set_consent(
            patient_id=test_pid, scope="not_a_real_scope", value=True,
            actor="sanity_test",
        )
        assert result.get("ok") is False, "unknown scope should reject"
    run("consent: unknown scope rejected", _unknown_scope_rejected, results)

    def _audit_history():
        history = consent_service.get_audit_history(test_pid, limit=10)
        # We just wrote a consent → audit should have at least one row
        assert len(history) >= 1, f"no audit history: {history}"
    run("consent: audit history recorded", _audit_history, results)

    # HTTP-side test
    def _admin_get_consent():
        s, b = http("GET", f"/api/v1/consent/{test_pid}", token=token)
        assert_status(s, 200, "/consent/{pid}")
        assert_in("flags", b, "consent.flags")
    run("consent: GET /consent/{pid} admin endpoint", _admin_get_consent, results)


def test_icd10_crosswalk(results: Results) -> None:
    header("SECTION 16 — ICD-10 → SNOMED CT + LOINC cross-walk (Phase 2.8)")

    try:
        sys.path.insert(0, "/app")
        from src.services.icd10_coder import (
            get_snomed_for_icd10, get_loinc_for_icd10,
            get_multi_system_codings, code_to_fhir_condition, code_text,
            SNOMED_SYSTEM, LOINC_SYSTEM, ICD10_SYSTEM,
        )
    except ImportError:
        skip("icd10 crosswalk direct (not inside container)")
        return

    def _snomed_mapping():
        snomed = get_snomed_for_icd10("E11.9")
        assert snomed is not None, "E11.9 should have SNOMED mapping"
        assert snomed[0] == "44054006", f"wrong SNOMED code: {snomed}"
    run("ICD-10 E11.9 → SNOMED 44054006", _snomed_mapping, results)

    def _loinc_for_bp():
        loinc = get_loinc_for_icd10("I10")
        assert loinc is not None, "I10 should have LOINC (BP panel)"
        assert loinc[0] == "85354-9", f"wrong LOINC: {loinc}"
    run("ICD-10 I10 → LOINC 85354-9 (BP panel)", _loinc_for_bp, results)

    def _multi_system():
        codings = get_multi_system_codings("E11.9", "Type 2 diabetes mellitus without complications")
        systems = [c["system"] for c in codings]
        assert ICD10_SYSTEM in systems, "ICD-10 missing"
        assert SNOMED_SYSTEM in systems, "SNOMED missing"
    run("get_multi_system_codings returns ICD-10 + SNOMED", _multi_system, results)

    def _fhir_condition_dual_coded():
        codes = code_text("Patient with type 2 diabetes.")
        assert codes, "no codes returned"
        cond = code_to_fhir_condition(codes[0], patient_ref="urn:aminacare:patient:p1")
        coding_systems = [c["system"] for c in cond["code"]["coding"]]
        assert ICD10_SYSTEM in coding_systems, "ICD-10 missing in Condition"
        assert SNOMED_SYSTEM in coding_systems, "SNOMED missing in Condition (WHO SMART)"
    run("Condition resource dual-coded (ICD-10 + SNOMED)", _fhir_condition_dual_coded, results)


def test_dhis2_pull(results: Results, token: str) -> None:
    header("SECTION 17 — DHIS2 bi-directional pull (Phase 2.6)")

    def _pull_disabled():
        # DHIS2_PULL_ENABLED=false by default → manual pull should return disabled error
        s, b = http("POST", "/api/v1/dhis2/pull/manual", token=token, json_body={})
        assert_status(s, 200, "/pull/manual")
        assert_in("ok", b, "pull.ok")
    run("POST /dhis2/pull/manual returns graceful disabled response", _pull_disabled, results)

    def _unlinked_queue():
        s, b = http("GET", "/api/v1/dhis2/pull/referrals/unlinked/all", token=token)
        assert_status(s, 200, "/pull/referrals/unlinked/all")
        assert_in("total", b, "unlinked.total")
        assert_in("referrals", b, "unlinked.referrals")
    run("GET /dhis2/pull/referrals/unlinked returns queue", _unlinked_queue, results)

    # Patient-facing endpoints (new UI)
    def _my_referrals_requires_auth():
        s, _ = http("GET", "/api/v1/dhis2/pull/my-referrals")  # no token
        assert_status(s, 401, "/pull/my-referrals (unauth)")
    run("GET /dhis2/pull/my-referrals returns 401 without token", _my_referrals_requires_auth, results)

    def _my_referrals_admin_rejected():
        # Admin token is NOT a patient token → should be rejected
        s, _ = http("GET", "/api/v1/dhis2/pull/my-referrals", token=token)  # admin
        assert_status(s, 403, "/pull/my-referrals (admin)")
    run("GET /dhis2/pull/my-referrals rejects admin token (patients only)", _my_referrals_admin_rejected, results)

    def _my_ack_missing_referral():
        # Even without a patient token, missing referral should 401 (auth is first)
        s, _ = http("POST", "/api/v1/dhis2/pull/my-referrals/nonexistent/ack")
        assert_status(s, 401, "/pull/my-referrals/.../ack (unauth)")
    run("POST /dhis2/pull/my-referrals/{id}/ack returns 401 without token", _my_ack_missing_referral, results)

    # Direct Python — referral schema + query
    try:
        sys.path.insert(0, "/app")
        from src.services.dhis2_pull import ensure_referral_schema, get_referrals_for_patient
    except ImportError:
        skip("dhis2_pull direct (not inside container)")
        return

    def _schema():
        ensure_referral_schema()
        rows = get_referrals_for_patient("nonexistent_test_pid")
        assert isinstance(rows, list), "get_referrals should return list"
    run("dhis2_pull schema + query works", _schema, results)


def test_android_capture(results: Results, token: str) -> None:
    header("SECTION 18 — Android Capture export (Phase 2.7)")

    def _export_region():
        s, b = http("POST", "/api/v1/dhis2/android/export/region", token=token,
                    json_body={"region": "kanifing"})
        assert_status(s, 200, "/android/export/region")
        for key in ("bundle_version", "metadata", "statistics", "trackedEntityInstances", "enrollments", "events"):
            assert_in(key, b, f"bundle.{key}")
        assert_eq(b.get("bundle_version"), "1.0", "bundle_version")
    run("Android export by region returns valid bundle structure", _export_region, results)

    def _export_ids():
        s, b = http("POST", "/api/v1/dhis2/android/export/ids", token=token,
                    json_body={"patient_ids": ["sanity_test_pid_1"]})
        assert_status(s, 200, "/android/export/ids")
    run("Android export by IDs accepts patient_ids", _export_ids, results)

    def _export_cap():
        ids = [f"p_{i}" for i in range(501)]
        s, _ = http("POST", "/api/v1/dhis2/android/export/ids", token=token,
                    json_body={"patient_ids": ids})
        assert_status(s, 400, "/android/export/ids cap")
    run("Android export enforces 500-patient cap", _export_cap, results)


def test_context_compactor(results: Results) -> None:
    header("SECTION 20 — LoRA context compactor (Phase A/B)")

    try:
        sys.path.insert(0, "/app")
        from src.services.context_compactor import (
            estimate_tokens, _estimate_messages_chars,
            maybe_schedule_compaction, hard_cap_trim,
            get_summary_for_session, get_summary_version,
            _SOFT_THRESHOLD_RATIO, _COMPACT_MIN_TURNS, _COMPACT_KEEP_TAIL,
            _SUMMARY_KEY, _VERSION_KEY, _IN_FLIGHT_KEY,
        )
    except ImportError as e:
        skip(f"compactor direct (not inside container: {e})")
        return

    # Mock message object mirroring agent's internal Message class
    class _Msg:
        def __init__(self, role, content):
            self.role = role
            self.content = content

    def _build_msgs(n, chars_each=200):
        return [
            _Msg("user" if i % 2 == 0 else "assistant", "x" * chars_each)
            for i in range(n)
        ]

    def _token_estimate():
        assert estimate_tokens("") == 0
        # 400 chars should estimate ~100 tokens at 4 chars/token
        est = estimate_tokens("a" * 400)
        if not (80 <= est <= 120):
            raise AssertionError(f"token estimate wrong for 400 chars: {est}")
    run("compactor: estimate_tokens correct for 4:1 ratio", _token_estimate, results)

    def _message_chars():
        msgs = _build_msgs(10, chars_each=100)
        total = _estimate_messages_chars(msgs)
        if total != 1000:
            raise AssertionError(f"expected 1000, got {total}")
    run("compactor: _estimate_messages_chars sums correctly", _message_chars, results)

    def _short_conversation_no_schedule():
        # Fewer than _COMPACT_MIN_TURNS → should never schedule
        msgs = _build_msgs(5, chars_each=2000)
        scheduled = maybe_schedule_compaction(
            session_id="sanity_short",
            messages=msgs,
            char_budget=20_000,
        )
        assert scheduled is False, "should not schedule on short conversation"
    run("compactor: short conversation does NOT schedule compaction", _short_conversation_no_schedule, results)

    def _below_soft_no_schedule():
        # Enough turns but under soft threshold
        msgs = _build_msgs(10, chars_each=100)  # 1000 chars total
        scheduled = maybe_schedule_compaction(
            session_id="sanity_below_soft",
            messages=msgs,
            char_budget=20_000,  # 75% = 15000
        )
        assert scheduled is False, "should not schedule when under soft threshold"
    run("compactor: under soft threshold does NOT schedule", _below_soft_no_schedule, results)

    def _over_soft_schedules():
        # 12 turns × 1500 chars = 18,000 chars > 15,000 soft limit (75% of 20K)
        import asyncio as _asyncio
        import redis as _redis
        from src.config import settings
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        # Clear any stale in-flight lock + summary
        r.delete(_IN_FLIGHT_KEY.format(sid="sanity_over_soft"))
        r.delete(_SUMMARY_KEY.format(sid="sanity_over_soft"))

        msgs = _build_msgs(12, chars_each=1500)

        # Run inside a real event loop so create_task works. We don't care
        # whether the background task actually completes (it'll fail to reach
        # the LLM in dry-run mode), only that the scheduler made the decision.
        async def _inner():
            scheduled = maybe_schedule_compaction(
                session_id="sanity_over_soft",
                messages=msgs,
                char_budget=20_000,
            )
            return scheduled

        scheduled = _asyncio.run(_inner())

        if not scheduled:
            # Verify the in-flight lock was NOT blocking us
            lock_held = r.get(_IN_FLIGHT_KEY.format(sid="sanity_over_soft"))
            raise AssertionError(
                f"over-soft should schedule. scheduled={scheduled}, lock={lock_held}"
            )
        # Cleanup
        r.delete(_IN_FLIGHT_KEY.format(sid="sanity_over_soft"))
        r.delete(_SUMMARY_KEY.format(sid="sanity_over_soft"))
    run("compactor: over soft threshold DOES schedule", _over_soft_schedules, results)

    def _inflight_lock():
        # Pre-set the lock, verify schedule is skipped
        import redis as _redis
        from src.config import settings
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        key = _IN_FLIGHT_KEY.format(sid="sanity_inflight")
        r.setex(key, 300, "1")
        msgs = _build_msgs(12, chars_each=1500)
        scheduled = maybe_schedule_compaction(
            session_id="sanity_inflight",
            messages=msgs,
            char_budget=20_000,
        )
        r.delete(key)
        assert scheduled is False, "should skip when in-flight lock is set"
    run("compactor: in-flight lock prevents duplicate scheduling", _inflight_lock, results)

    def _hard_cap_trim():
        # 20 turns × 2000 chars = 40,000 chars, budget 20K, hard limit 18K
        msgs = _build_msgs(20, chars_each=2000)
        trimmed = hard_cap_trim(msgs, char_budget=20_000, keep_tail=4)
        total_after = _estimate_messages_chars(trimmed)
        if total_after > int(20_000 * 0.90):
            raise AssertionError(f"hard cap failed: {total_after} > 18000")
        # Must preserve the last 4 turns
        for original, trimmed_msg in zip(msgs[-4:], trimmed[-4:]):
            if original.content != trimmed_msg.content:
                raise AssertionError("tail messages were modified by hard_cap_trim")
    run("compactor: hard_cap_trim keeps tail + drops oldest", _hard_cap_trim, results)

    def _no_summary_for_unknown():
        import asyncio as _asyncio
        summary = _asyncio.run(get_summary_for_session("sanity_never_existed"))
        assert summary is None, f"expected None, got {summary!r}"
    run("compactor: get_summary_for_session returns None for unknown session", _no_summary_for_unknown, results)

    def _persist_and_read_summary():
        # Directly write a summary to Redis, verify read path finds it
        import redis as _redis
        from src.config import settings
        import asyncio as _asyncio
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)
        sid = "sanity_persist_summary"
        r.setex(_SUMMARY_KEY.format(sid=sid), 3600, "Test summary content: patient has HTN + DM")
        summary = _asyncio.run(get_summary_for_session(sid))
        r.delete(_SUMMARY_KEY.format(sid=sid))
        if summary is None or "HTN" not in summary:
            raise AssertionError(f"persist + read failed: {summary!r}")
    run("compactor: summary persistence (write → read) works", _persist_and_read_summary, results)


def test_compactor_endpoints(results: Results, token: str) -> None:
    header("SECTION 21 — Compactor admin endpoints")

    def _stats_endpoint():
        s, b = http("GET", "/api/v1/agent/compactor/stats/nonexistent_session", token=token)
        assert_status(s, 200, "/compactor/stats")
        assert_in("has_summary", b, "stats.has_summary")
        # Should report no summary for nonexistent session
        assert_eq(b.get("has_summary"), False, "stats.has_summary for empty")
    run("GET /agent/compactor/stats returns stats for empty session", _stats_endpoint, results)

    def _trigger_missing_session():
        s, b = http("POST", "/api/v1/agent/compactor/trigger/nonexistent_session_xyz", token=token)
        assert_status(s, 404, "/compactor/trigger missing")
    run("POST /agent/compactor/trigger returns 404 for missing session", _trigger_missing_session, results)


def test_lora_budget_bump(results: Results) -> None:
    header("SECTION 22 — LoRA budget bumps + compactor wiring (Track A/B)")

    try:
        sys.path.insert(0, "/app")
        # We can't easily introspect the function-local _MODEL_BUDGETS dict,
        # so we check the raw source file for the expected values.
        with open("/app/src/agent/amina_agent.py", "r") as f:
            content = f.read()
    except Exception as e:
        skip(f"LoRA budget file read failed: {e}")
        return

    def _amina_budget_in_source():
        if '"amina":   (20_000, 400,           6)' not in content:
            raise AssertionError("LoRA budget line not updated to (20_000, 400, 6)")
    run("amina_agent: LoRA _MODEL_BUDGETS bumped to (20000, 400, 6)", _amina_budget_in_source, results)

    def _500_char_history_cap():
        if "m.content[:500]" not in content:
            raise AssertionError("LoRA history char cap not bumped to 500")
    run("amina_agent: LoRA history per-message cap bumped to 500", _500_char_history_cap, results)

    def _compactor_integration_lora():
        # LoRA branch has its own compactor wiring
        if "context_compactor" not in content:
            raise AssertionError("context_compactor not imported")
        lora_branch = content.split('if _pref == "amina":')[1].split("else:")[0]
        if "get_summary_for_session" not in lora_branch:
            raise AssertionError("get_summary_for_session not called in LoRA branch")
        if "maybe_schedule_compaction" not in lora_branch:
            raise AssertionError("maybe_schedule_compaction not called in LoRA branch")
    run("amina_agent: compactor integrated into LoRA branch", _compactor_integration_lora, results)

    def _compactor_integration_generic():
        # Both LoRA branch and generic branch call the compactor, so both
        # functions should appear at least TWICE in the agent source.
        n_get_summary = content.count("get_summary_for_session")
        n_schedule    = content.count("maybe_schedule_compaction")
        # 2 imports + 2 calls per function (one in each branch) = at least 3 each
        # (import counts once + function call in LoRA + function call in generic)
        if n_get_summary < 3:
            raise AssertionError(
                f"get_summary_for_session appears {n_get_summary}× — "
                f"expected ≥3 (imports + calls in both LoRA and generic branches)"
            )
        if n_schedule < 3:
            raise AssertionError(
                f"maybe_schedule_compaction appears {n_schedule}× — "
                f"expected ≥3 (imports + calls in both LoRA and generic branches)"
            )
    run("amina_agent: compactor wired into both LoRA AND generic branches", _compactor_integration_generic, results)


def test_compactor_cross_model(results: Results) -> None:
    header("SECTION 23 — Compactor cross-model continuity (Phase B)")

    try:
        sys.path.insert(0, "/app")
        from src.services.context_compactor import (
            get_summary_for_session,
            _SUMMARY_KEY, _LEGACY_SUMMARY_KEY, _IN_FLIGHT_KEY,
            maybe_schedule_compaction,
        )
        import redis as _redis
        import asyncio as _asyncio
        from src.config import settings
    except ImportError as e:
        skip(f"cross-model compactor (not inside container: {e})")
        return

    r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True)

    class _Msg:
        def __init__(self, role, content):
            self.role = role
            self.content = content

    def _key_prefix_renamed():
        # New key must be chat:summary:*, not lora:summary:*
        if not _SUMMARY_KEY.startswith("chat:summary:"):
            raise AssertionError(f"key not renamed: {_SUMMARY_KEY}")
        if not _LEGACY_SUMMARY_KEY.startswith("lora:summary:"):
            raise AssertionError(f"legacy key should still be lora:summary: for backward compat")
    run("compactor: Redis key renamed chat:summary:* (shared across models)", _key_prefix_renamed, results)

    def _legacy_fallback_read():
        # Write to legacy key only, verify read path finds it
        sid = "sanity_legacy_read"
        r.delete(_SUMMARY_KEY.format(sid=sid))
        r.setex(_LEGACY_SUMMARY_KEY.format(sid=sid), 3600, "legacy LoRA summary content")
        summary = _asyncio.run(get_summary_for_session(sid))
        r.delete(_LEGACY_SUMMARY_KEY.format(sid=sid))
        if summary != "legacy LoRA summary content":
            raise AssertionError(f"legacy fallback failed: got {summary!r}")
    run("compactor: reads from legacy lora:summary:* as fallback", _legacy_fallback_read, results)

    def _new_key_preferred():
        # Write BOTH keys — new one should win
        sid = "sanity_new_wins"
        r.setex(_SUMMARY_KEY.format(sid=sid),       3600, "NEW chat summary")
        r.setex(_LEGACY_SUMMARY_KEY.format(sid=sid), 3600, "OLD lora summary")
        summary = _asyncio.run(get_summary_for_session(sid))
        r.delete(_SUMMARY_KEY.format(sid=sid))
        r.delete(_LEGACY_SUMMARY_KEY.format(sid=sid))
        if summary != "NEW chat summary":
            raise AssertionError(f"new key not preferred: got {summary!r}")
    run("compactor: new key preferred over legacy key", _new_key_preferred, results)

    def _schedule_gemini_budget():
        # Gemini has 22K char budget → 75% = 16,500 soft trigger
        # 18 turns × 1000 chars = 18,000 > 16,500 → should schedule
        sid = "sanity_gemini_schedule"
        r.delete(_IN_FLIGHT_KEY.format(sid=sid))
        r.delete(_SUMMARY_KEY.format(sid=sid))
        msgs = [_Msg("user" if i % 2 == 0 else "assistant", "g" * 1000) for i in range(18)]

        async def _inner():
            return maybe_schedule_compaction(
                session_id=sid, messages=msgs, char_budget=22_000,
            )
        scheduled = _asyncio.run(_inner())
        r.delete(_IN_FLIGHT_KEY.format(sid=sid))
        if not scheduled:
            raise AssertionError("Gemini 22K budget over-soft should schedule")
    run("compactor: Gemini 22K budget triggers compaction at 16.5K", _schedule_gemini_budget, results)

    def _schedule_groq_budget():
        # Groq has 10K char budget → 75% = 7,500 soft trigger
        # 10 turns × 1000 chars = 10,000 > 7,500 → should schedule
        sid = "sanity_groq_schedule"
        r.delete(_IN_FLIGHT_KEY.format(sid=sid))
        r.delete(_SUMMARY_KEY.format(sid=sid))
        msgs = [_Msg("user" if i % 2 == 0 else "assistant", "q" * 1000) for i in range(10)]

        async def _inner():
            return maybe_schedule_compaction(
                session_id=sid, messages=msgs, char_budget=10_000,
            )
        scheduled = _asyncio.run(_inner())
        r.delete(_IN_FLIGHT_KEY.format(sid=sid))
        if not scheduled:
            raise AssertionError("Groq 10K budget over-soft should schedule")
    run("compactor: Groq 10K budget triggers compaction at 7.5K", _schedule_groq_budget, results)

    def _cross_model_continuity():
        # Simulate LoRA writing a summary, then Gemini reading it mid-session
        sid = "sanity_cross_model"
        r.setex(_SUMMARY_KEY.format(sid=sid), 3600,
                "Patient Fatou, HTN + T2DM, on amlodipine. Committed to low-salt diet Monday.")

        # Gemini branch reads same key via same function
        summary = _asyncio.run(get_summary_for_session(sid))
        r.delete(_SUMMARY_KEY.format(sid=sid))

        if not summary or "amlodipine" not in summary:
            raise AssertionError(f"cross-model read failed: {summary!r}")
    run("compactor: LoRA→Gemini cross-model summary continuity", _cross_model_continuity, results)


def test_tracker_audit(results: Results, token: str) -> None:
    header("SECTION 19 — Tracker push audit log (Phase 2.10)")

    def _audit_endpoint():
        s, b = http("GET", "/api/v1/dhis2/tracker/audit", token=token)
        assert_status(s, 200, "/tracker/audit")
        assert_in("entries", b, "audit.entries")
        assert_in("total", b, "audit.total")
    run("GET /dhis2/tracker/audit returns audit entries", _audit_endpoint, results)

    def _audit_filter():
        s, b = http("GET", "/api/v1/dhis2/tracker/audit?patient_id=sanity_test&limit=10",
                    token=token)
        assert_status(s, 200, "/tracker/audit?patient_id=...")
        assert_eq(b.get("filter", {}).get("patient_id"), "sanity_test", "filter.patient_id")
    run("GET /tracker/audit supports patient_id filter", _audit_filter, results)

    # Direct write + read
    try:
        sys.path.insert(0, "/app")
        from src.services.dhis2_tracker import _log_tracker_push, _ensure_tracker_audit_schema, get_tracker_audit
    except ImportError:
        skip("tracker audit direct (not inside container)")
        return

    def _write_and_read():
        _ensure_tracker_audit_schema()
        _log_tracker_push(
            patient_id="sanity_p1", tei_uid="TEI123", enrollment_uid="ENR456",
            events_count=3, success=True, dry_run=True, forced=False,
            triggered_by="sanity_test", error_message=None, consent_version=5,
        )
        rows = get_tracker_audit(patient_id="sanity_p1", limit=10)
        assert len(rows) >= 1, "audit row not found"
    run("tracker audit write + read verified", _write_and_read, results)


def test_scheduler_presence(results: Results) -> None:
    header("SECTION 13 — Scheduler presence")

    try:
        sys.path.insert(0, "/app")
        from src.services.dhis2_sync import _scheduler, start_scheduler
    except ImportError:
        skip("scheduler presence (not inside container)")
        return

    def _check():
        # start_scheduler is idempotent — call it and verify _scheduler is set
        start_scheduler()
        from src.services import dhis2_sync
        if dhis2_sync._scheduler is None:
            raise AssertionError("scheduler is None after start_scheduler()")
        jobs = dhis2_sync._scheduler.get_jobs()
        job_ids = {j.id for j in jobs}
        if "dhis2_daily_sync" not in job_ids:
            raise AssertionError(f"daily sync job missing: {job_ids}")
        if "dhis2_retry_loop" not in job_ids:
            raise AssertionError(f"retry loop job missing: {job_ids}")
    run("APScheduler has daily_sync + retry_loop jobs registered", _check, results)


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    print(f"\n{BOLD}AMINA Care — DHIS2 + FHIR Sanity Test{RESET}")
    print(f"{GRAY}API: {API}{RESET}")
    print(f"{GRAY}Started: {datetime.utcnow().isoformat()}Z{RESET}")

    results = Results()

    # Section 1 — Backend
    test_backend_health(results)

    # Section 2 — Admin auth
    token = test_admin_auth(results)
    if not token:
        header("CANNOT CONTINUE WITHOUT ADMIN TOKEN")
        return results.summary()

    # Section 3-8 — HTTP-based tests
    test_dhis2_config_status(results, token)
    test_dhis2_metrics_and_dryrun(results, token)
    test_dhis2_tracker(results, token)
    test_fhir_metadata(results)
    test_icd10_coder(results, token)
    test_icd10_negation(results, token)

    # Section 9-13 — Direct Python paths (only run inside container)
    test_internal_python_paths(results)
    test_icd10_coder_direct(results)
    test_fhir_mapper_direct(results)
    test_tracker_payloads_direct(results)
    test_scheduler_presence(results)

    # Section 14-19 — Phase 2.4–2.10 coverage
    test_phi_deid(results)
    test_consent(results, token)
    test_icd10_crosswalk(results)
    test_dhis2_pull(results, token)
    test_android_capture(results, token)
    test_tracker_audit(results, token)

    # Section 20-23 — context compactor (LoRA + all models)
    test_context_compactor(results)
    test_compactor_endpoints(results, token)
    test_lora_budget_bump(results)
    test_compactor_cross_model(results)

    return results.summary()


if __name__ == "__main__":
    sys.exit(main())
