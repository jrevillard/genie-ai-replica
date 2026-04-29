"""
Phase 2 — caregiver privacy consent backend test suite.

Covers ONLY the new Phase 2 backend surface:
  - validate_consent_payload (pure)
  - hash_signature (pure)
  - ensure_caregiver_privacy_schema (idempotent)
  - record_consent (idempotent insert; safe-fields-only at rest)
  - find_current_consent / has_current_consent
  - emit_audit_log (safe-fields-only logging)
  - check_caregiver_consent_or_raise (flag-off vs flag-on)

No real ArcadeDB, no real provider calls. Tests inject a mock
sql_runner everywhere a DB call would happen.

Run inside or outside the container:
    PYTHONIOENCODING=utf-8 python _caregiver_privacy_consent_test.py
"""
from __future__ import annotations

import io
import logging
import os
import sys
from typing import Any, Dict, List, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Force flag default-off BEFORE the service module is imported. The
# service reads the env var at import time. Tests that exercise the
# flag-on path mutate the module attribute directly afterwards.
os.environ.setdefault("AMINA_CAREGIVER_PRIVACY_REQUIRED", "false")

from src.services import caregiver_privacy_consent as cpc       # noqa: E402

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


# ── Mock DB helper ───────────────────────────────────────────────────
class MockDB:
    """In-memory pretend ArcadeDB. Knows enough SQL flavour to satisfy
    the service module: SELECT FROM <V> WHERE k = :k, INSERT INTO <V>
    SET k = :k..., CREATE EDGE FROM..., CREATE VERTEX/INDEX/PROPERTY."""
    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self.calls: List[Tuple[str, Dict[str, Any]]] = []

    def __call__(self, sql: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        params = dict(params or {})
        self.calls.append((sql.strip(), params))
        s = sql.upper()

        # Schema-bootstrap statements: no-op.
        if s.startswith("CREATE VERTEX TYPE") or \
           s.startswith("CREATE EDGE TYPE")  or \
           s.startswith("CREATE PROPERTY")    or \
           s.startswith("CREATE INDEX"):
            return {"result": []}

        if s.startswith("SELECT FROM"):
            # Two known shapes:
            #   ... WHERE caregiver_id = :cg AND notice_version = :nv AND
            #       digital_signature_hash = :sh LIMIT 1
            #   ... WHERE caregiver_id = :cg AND notice_version = :nv
            #       ORDER BY created_at DESC LIMIT 1
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

        # Unknown shape -- return empty rather than raise so the test
        # surface is forgiving.
        return {"result": []}


def _fresh_db() -> MockDB:
    """Each test that talks to the DB gets its own fresh instance.
    Also resets the schema-bootstrap flag so every test exercises it."""
    cpc._reset_schema_bootstrap_for_tests()
    return MockDB()


# ── 1. Pure validation ───────────────────────────────────────────────
def test_validation_happy_path():
    section("1. validate_consent_payload happy path")
    payload = {
        "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
        "consent_checkboxes": {
            "understand_confidential":   True,
            "accept_responsibility":     True,
            "understand_consequences":   True,
            "agree_delete_on_removal":   True,
            "acknowledge_audit":         True,
        },
        "digital_signature": "Fatou Example",
        "consent_timestamp": "2026-04-29T12:00:00Z",
    }
    errs = cpc.validate_consent_payload(payload, role="vhw")
    check("happy payload returns no errors", errs == [], detail=str(errs))


def test_validation_error_paths():
    section("2. validate_consent_payload — error codes")
    base = {
        "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
        "consent_checkboxes": {cid: True for cid in cpc.EXPECTED_CHECKBOX_IDS},
        "digital_signature": "Fatou Example",
        "consent_timestamp": "2026-04-29T12:00:00Z",
    }

    # Wrong notice version -> notice_version_mismatch
    bad = {**base, "notice_version": "0.99"}
    check("wrong version -> notice_version_mismatch",
          "notice_version_mismatch" in cpc.validate_consent_payload(bad, role="vhw"))

    # Missing notice version -> notice_version_missing
    bad = {**base}
    bad.pop("notice_version")
    check("missing version -> notice_version_missing",
          "notice_version_missing" in cpc.validate_consent_payload(bad, role="vhw"))

    # Incomplete checkboxes -> checkboxes_incomplete
    bad = {**base, "consent_checkboxes": {
        "understand_confidential": True, "accept_responsibility": True,
    }}
    check("4-of-5 checkboxes -> checkboxes_incomplete",
          "checkboxes_incomplete" in cpc.validate_consent_payload(bad, role="vhw"))

    # Empty signature -> digital_signature_missing
    bad = {**base, "digital_signature": "   "}
    check("empty signature -> digital_signature_missing",
          "digital_signature_missing" in cpc.validate_consent_payload(bad, role="vhw"))

    # Wrong signature subject -> digital_signature_name_mismatch
    bad = {**base}
    errs = cpc.validate_consent_payload(
        bad, role="vhw", expected_signature_subject="Lamin Testcase",
    )
    check("subject mismatch -> digital_signature_name_mismatch",
          "digital_signature_name_mismatch" in errs)

    # Bad timestamp -> consent_timestamp_invalid
    bad = {**base, "consent_timestamp": "notatime"}
    check("garbage timestamp -> consent_timestamp_invalid",
          "consent_timestamp_invalid" in cpc.validate_consent_payload(bad, role="vhw"))

    # Missing timestamp -> consent_timestamp_missing
    bad = {**base}
    bad.pop("consent_timestamp")
    check("missing timestamp -> consent_timestamp_missing",
          "consent_timestamp_missing" in cpc.validate_consent_payload(bad, role="vhw"))

    # Unknown role -> role_unrecognised
    check("bad role -> role_unrecognised",
          "role_unrecognised" in cpc.validate_consent_payload(base, role="hacker"))

    # Scout under-18 missing guardian -> guardian_consent_missing
    scout = {**base, "requires_guardian_consent": True,
             "guardian_consent": False, "guardian_signature": ""}
    errs = cpc.validate_consent_payload(scout, role="scout")
    check("scout missing guardian_consent -> guardian_consent_missing",
          "guardian_consent_missing" in errs)
    check("scout missing guardian_signature -> guardian_signature_missing",
          "guardian_signature_missing" in errs)


def test_validation_accepts_list_form_checkboxes():
    section("3. validate_consent_payload accepts both dict + list checkbox forms")
    payload_list = {
        "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
        "consent_checkboxes": list(cpc.EXPECTED_CHECKBOX_IDS),
        "digital_signature": "Fatou Example",
        "consent_timestamp": "2026-04-29T12:00:00Z",
    }
    errs = cpc.validate_consent_payload(payload_list, role="vhw")
    check("list-form checkboxes accepted", errs == [], detail=str(errs))


# ── 4. Signature hashing ─────────────────────────────────────────────
def test_signature_hash_properties():
    section("4. hash_signature properties")
    h1 = cpc.hash_signature("Fatou Example", "cg-synth-001")
    h2 = cpc.hash_signature("Fatou Example", "cg-synth-001")
    h3 = cpc.hash_signature("Fatou Example", "cg-synth-002")
    h4 = cpc.hash_signature(" fatou example ", "cg-synth-001")  # trim only

    check("same name + same id produces same hash", h1 == h2)
    check("hash is 64-hex (sha256)",
          len(h1) == 64 and all(c in "0123456789abcdef" for c in h1))
    check("different caregiver_id -> different hash", h1 != h3)
    check("trim applied; case NOT folded -> different hash from cased",
          h1 != h4)
    check("empty signature -> empty hash",
          cpc.hash_signature("", "cg-synth-001") == "")


# ── 5. Schema bootstrap idempotency ──────────────────────────────────
def test_schema_bootstrap_idempotent():
    section("5. ensure_caregiver_privacy_schema is idempotent")
    db = _fresh_db()
    cpc.ensure_caregiver_privacy_schema(sql_runner=db)
    first_call_count = len(db.calls)
    cpc.ensure_caregiver_privacy_schema(sql_runner=db)
    second_call_count = len(db.calls)
    check("first bootstrap emits >= 1 schema stmt", first_call_count >= 1)
    check("second bootstrap is a no-op (no extra stmts)",
          second_call_count == first_call_count,
          detail=f"first={first_call_count} second={second_call_count}")


# ── 6. record_consent: insert + idempotent re-submit ─────────────────
def _good_payload():
    return {
        "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
        "consent_checkboxes": {cid: True for cid in cpc.EXPECTED_CHECKBOX_IDS},
        "digital_signature": "Fatou Example",
        "consent_timestamp": "2026-04-29T12:00:00Z",
        "mandinka_viewed":   True,
        "scroll_completed":  True,
    }


def test_record_consent_inserts_and_idempotent():
    section("6. record_consent inserts then is idempotent on re-submit")
    db = _fresh_db()
    out1 = cpc.record_consent(
        caregiver_id="cg-synth-001", role="vhw",
        payload=_good_payload(), sql_runner=db,
    )
    check("first submit returns _status='accepted'",
          out1.get("_status") == "accepted")
    check("first submit row has record_id starting with CGCONSENT-",
          out1.get("record_id", "").startswith("CGCONSENT-"))
    check("first submit stored signature HASH (not raw)",
          out1.get("digital_signature_hash") and
          len(out1["digital_signature_hash"]) == 64 and
          "Fatou Example" not in out1.get("digital_signature_hash", ""))

    rows_after_first = sum(1 for c in db.calls if c[0].upper().startswith("INSERT INTO"))
    check("first submit caused exactly one INSERT", rows_after_first == 1,
          detail=f"got {rows_after_first}")

    # Re-submit identical payload -> idempotent
    out2 = cpc.record_consent(
        caregiver_id="cg-synth-001", role="vhw",
        payload=_good_payload(), sql_runner=db,
    )
    check("re-submit returns _status='already_accepted'",
          out2.get("_status") == "already_accepted")
    check("re-submit returns SAME record_id",
          out2.get("record_id") == out1.get("record_id"))

    rows_after_second = sum(1 for c in db.calls if c[0].upper().startswith("INSERT INTO"))
    check("re-submit caused NO additional INSERT", rows_after_second == 1,
          detail=f"got {rows_after_second}")


def test_record_consent_new_signature_creates_new_row():
    section("7. record_consent with a different signature creates a NEW row")
    db = _fresh_db()
    p1 = _good_payload()
    p2 = {**_good_payload(), "digital_signature": "Lamin Testcase"}

    out1 = cpc.record_consent(caregiver_id="cg-synth-002", role="vhw",
                              payload=p1, sql_runner=db)
    out2 = cpc.record_consent(caregiver_id="cg-synth-002", role="vhw",
                              payload=p2, sql_runner=db)
    check("two different signatures -> two different record_ids",
          out1.get("record_id") != out2.get("record_id"))
    check("both stored as accepted (not idempotent because content differs)",
          out1.get("_status") == "accepted" and out2.get("_status") == "accepted")


def test_record_consent_persists_safe_fields_only():
    section("8. Stored row contains hashes, NOT raw signature/name/IP/UA")
    db = _fresh_db()
    out = cpc.record_consent(
        caregiver_id="cg-synth-003", role="vhw",
        payload=_good_payload(), sql_runner=db,
    )
    forbidden_substrings = (
        "Fatou Example",       # raw signature name
        "+220",                # raw phone
        "127.0.0.1",           # raw IP
        "Mozilla",             # raw UA
        "I understand",        # checkbox prose
    )
    blob = repr(out).lower()
    for needle in forbidden_substrings:
        check(f"stored row free of {needle!r}", needle.lower() not in blob)


# ── 9. find_current_consent / has_current_consent ────────────────────
def test_find_and_has_current_consent():
    section("9. find_current_consent / has_current_consent")
    db = _fresh_db()
    # Before any insert: no consent.
    check("has_current_consent=False before any record",
          cpc.has_current_consent("cg-synth-004", sql_runner=db) is False)
    cpc.record_consent(caregiver_id="cg-synth-004", role="vhw",
                       payload=_good_payload(), sql_runner=db)
    check("has_current_consent=True after record",
          cpc.has_current_consent("cg-synth-004", sql_runner=db) is True)
    row = cpc.find_current_consent("cg-synth-004", sql_runner=db)
    check("find_current_consent returns the row",
          row is not None and row.get("caregiver_id") == "cg-synth-004")


# ── 10. emit_audit_log: safe fields only (PHI-free) ──────────────────
def test_audit_log_safe_fields_only():
    section("10. emit_audit_log emits only safe fields")

    # Capture log output via a string handler attached to the audit logger.
    audit_logger = logging.getLogger("caregiver_privacy_consent.audit")
    audit_logger.setLevel(logging.INFO)
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.INFO)
    audit_logger.addHandler(handler)
    try:
        emitted = cpc.emit_audit_log(
            caregiver_id="cg-synth-005", role="vhw",
            accepted_at="2026-04-29T12:00:00Z", method="app",
            consent_version="1.0", policy_version="1.0",
        )
    finally:
        audit_logger.removeHandler(handler)

    # The returned dict must contain ONLY the 7 safe keys.
    expected_keys = {
        "caregiver_id", "consent_version", "policy_version",
        "role", "accepted_at", "method", "required_flag",
    }
    check("emitted dict has exactly the 7 safe keys",
          set(emitted.keys()) == expected_keys,
          detail=str(set(emitted.keys()) ^ expected_keys))

    line = buf.getvalue()
    check("log line contains the event_type marker",
          "event_type=caregiver_privacy_consent_captured" in line)
    check("log line contains caregiver_id token",
          "caregiver_id=cg-synth-005" in line)
    check("log line contains required_flag token",
          "required_flag=" in line)
    # Must NOT contain forbidden substrings.
    for needle in ("Fatou", "+220", "127.0.0.1", "Mozilla",
                   "I understand", "I accept"):
        check(f"log line free of {needle!r}", needle not in line)


# ── 11. Gate: flag-off vs flag-on behaviour ──────────────────────────
def test_gate_flag_off_passes_without_record():
    section("11. Gate flag-OFF: no consent record -> still passes")
    db = _fresh_db()
    cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED = False
    try:
        out = cpc.check_caregiver_consent_or_raise(
            "cg-synth-100", sql_runner=db,
        )
        check("flag-off + no record -> returns True", out is True)
    except Exception as e:
        check("flag-off should NOT raise", False, detail=str(e))


def test_gate_flag_on_blocks_without_record():
    section("12. Gate flag-ON: no consent record -> raises ConsentRequiredError")
    db = _fresh_db()
    cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED = True
    raised = False
    try:
        cpc.check_caregiver_consent_or_raise("cg-synth-101", sql_runner=db)
    except cpc.ConsentRequiredError:
        raised = True
    finally:
        cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED = False
    check("flag-on + no record -> ConsentRequiredError raised", raised)


def test_gate_flag_on_passes_with_record():
    section("13. Gate flag-ON: with consent record -> passes")
    db = _fresh_db()
    cpc.record_consent(caregiver_id="cg-synth-102", role="vhw",
                       payload=_good_payload(), sql_runner=db)
    cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED = True
    try:
        out = cpc.check_caregiver_consent_or_raise(
            "cg-synth-102", sql_runner=db,
        )
        check("flag-on + record -> returns True", out is True)
    except Exception as e:
        check("flag-on + record should NOT raise", False, detail=str(e))
    finally:
        cpc.AMINA_CAREGIVER_PRIVACY_REQUIRED = False


# ── 14. Constants pinned (so version drift is loud) ─────────────────
def test_constants_pinned():
    section("14. Public constants are stable")
    check("CAREGIVER_PRIVACY_NOTICE_VERSION == '1.0'",
          cpc.CAREGIVER_PRIVACY_NOTICE_VERSION == "1.0")
    check("EXPECTED_CHECKBOX_COUNT == 5", cpc.EXPECTED_CHECKBOX_COUNT == 5)
    expected_ids = {
        "understand_confidential", "accept_responsibility",
        "understand_consequences", "agree_delete_on_removal",
        "acknowledge_audit",
    }
    check("EXPECTED_CHECKBOX_IDS matches frontend contract",
          set(cpc.EXPECTED_CHECKBOX_IDS) == expected_ids)
    check("CONSENT_TYPE == 'caregiver_privacy_notice'",
          cpc.CONSENT_TYPE == "caregiver_privacy_notice")
    check("VERTEX_TYPE == 'CaregiverConsentRecord'",
          cpc.VERTEX_TYPE == "CaregiverConsentRecord")
    check("EDGE_TYPE == 'HasConsent'", cpc.EDGE_TYPE == "HasConsent")


# ── Run all ──────────────────────────────────────────────────────────
def main():
    print("AMINA Caregiver Privacy Consent — Phase 2 backend test suite")
    print("=" * 64)
    test_validation_happy_path()
    test_validation_error_paths()
    test_validation_accepts_list_form_checkboxes()
    test_signature_hash_properties()
    test_schema_bootstrap_idempotent()
    test_record_consent_inserts_and_idempotent()
    test_record_consent_new_signature_creates_new_row()
    test_record_consent_persists_safe_fields_only()
    test_find_and_has_current_consent()
    test_audit_log_safe_fields_only()
    test_gate_flag_off_passes_without_record()
    test_gate_flag_on_blocks_without_record()
    test_gate_flag_on_passes_with_record()
    test_constants_pinned()
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
