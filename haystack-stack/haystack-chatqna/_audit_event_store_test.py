"""
Phase 9 — append-only audit event store unit tests (AUDIT-005).

Pure unit tests with an injectable mock SQL runner. No real ArcadeDB.

Run inside or outside the container:
    PYTHONIOENCODING=utf-8 python _audit_event_store_test.py
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

from src.services import audit_event_store as aes  # noqa: E402


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


# ── Mock SQL runner ──────────────────────────────────────────────────
class MockDB:
    """Two-arg signature: runner(sql, params) -> dict.

    Stores INSERT params in self.rows; ignores schema statements.
    The append_event implementation calls the two-arg form first.
    """
    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self.calls: List[Tuple[str, Dict[str, Any]]] = []
        self.fail_next: bool = False
        self.fail_message: str = "synthetic-db-error"

    def __call__(self, sql: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        params = dict(params or {})
        self.calls.append((sql.strip(), params))
        if self.fail_next:
            raise RuntimeError(self.fail_message)
        s = sql.upper().lstrip()
        if s.startswith("CREATE VERTEX TYPE") or \
           s.startswith("CREATE PROPERTY")    or \
           s.startswith("CREATE INDEX"):
            return {"result": []}
        if s.startswith("INSERT INTO"):
            self.rows.append(dict(params))
            return {"result": [dict(params)]}
        return {"result": []}


def _fresh_db() -> MockDB:
    aes._reset_schema_bootstrap_for_tests()
    aes._reset_failure_counter_for_tests()
    return MockDB()


# ── 1. Append succeeds + row shape ───────────────────────────────────
def test_append_event_stores_row():
    section("1. append_event stores a clean row")
    db = _fresh_db()
    out = aes.append_event(
        event_type="caregiver_privacy.consent.captured",
        actor_type="caregiver",
        actor_id="cg-test-001",
        subject_type="caregiver",
        subject_id="cg-test-001",
        action="grant",
        resource="/api/v1/caregiver/privacy/consent",
        outcome="success",
        reason_code="ok",
        request_id="req-abc-123",
        sql_runner=db,
    )
    check("status stored", out["_status"] == aes.STATUS_STORED,
          detail=str(out))
    check("stored=True", out.get("stored") is True)
    check("event_id starts with prefix",
          out.get("event_id", "").startswith("AUDIT-"))
    check("exactly one INSERT executed",
          sum(1 for c in db.calls if c[0].upper().startswith("INSERT INTO")) == 1)
    # Row has all required fields.
    row = db.rows[0]
    expected_keys = {
        "event_id", "event_type", "actor_type", "actor_id_hash",
        "subject_type", "subject_id_hash", "action", "resource",
        "outcome", "reason_code", "request_id", "session_hash",
        "trace_id", "created_at", "metadata_safe",
    }
    check("row has all 15 expected keys",
          set(row.keys()) == expected_keys,
          detail=str(set(row.keys()) ^ expected_keys))
    # actor_id was hashed (no raw caregiver id in storage)
    check("actor_id_hash is salted sha256",
          len(row["actor_id_hash"]) == 64
          and "cg-test-001" not in row["actor_id_hash"])


# ── 2. Event IDs unique across many calls ────────────────────────────
def test_event_ids_unique():
    section("2. event_ids are unique across many appends")
    db = _fresh_db()
    seen = set()
    for i in range(200):
        out = aes.append_event(
            event_type="test.unique.id",
            actor_type="system",
            sql_runner=db,
        )
        seen.add(out["event_id"])
    check("200 events => 200 unique ids", len(seen) == 200,
          detail=f"got {len(seen)}")


# ── 3. No update / delete API exists (append-only contract) ──────────
def test_no_update_or_delete_api():
    section("3. module exposes no update/delete API")
    forbidden = (
        "update_event", "delete_event", "patch_event",
        "remove_event", "edit_event", "modify_event", "purge_event",
    )
    leaked = [n for n in forbidden if hasattr(aes, n)]
    check("no update/delete-shaped helpers present",
          not leaked, detail=f"leaked: {leaked}")
    # Public surface is exactly the explicit __all__ + module-private symbols
    # — no hidden write helpers besides append_event.
    public = [n for n in aes.__all__ if not n.startswith("_")]
    write_helpers = [n for n in public if "event" in n.lower()
                     and n != "append_event"
                     and n != "ensure_audit_event_schema"]
    check("only append_event is a public 'event' write helper",
          not write_helpers, detail=f"unexpected: {write_helpers}")


# ── 4. Forbidden metadata keys are dropped ───────────────────────────
def test_metadata_forbidden_keys_dropped():
    section("4. forbidden metadata keys are dropped + counted")
    db = _fresh_db()
    out = aes.append_event(
        event_type="test.metadata.scrub",
        actor_type="caregiver",
        actor_id="cg-test-meta",
        metadata={
            "phone":     "+220-leak-this",
            "name":      "Should not store",
            "ip":        "127.0.0.1",
            "user_agent":"Mozilla/5.0",
            "token":     "eyj.fake.jwt",
            "safe_kind": "soft_modal",
        },
        sql_runner=db,
    )
    check("status stored despite scrubbing",
          out["_status"] == aes.STATUS_STORED)
    import json as _json
    blob = _json.loads(db.rows[0]["metadata_safe"])
    # Every forbidden key dropped
    for forbidden in ("phone", "name", "ip", "user_agent", "token"):
        check(f"metadata_safe drops forbidden key {forbidden!r}",
              forbidden not in blob)
    # Safe key kept
    check("safe_kind preserved", blob.get("safe_kind") == "soft_modal")
    # Counter saw the redaction
    snap = aes.audit_health_snapshot()
    check("redaction counter incremented",
          snap["redactions"] >= 1, detail=str(snap))


# ── 5. Forbidden value patterns are redacted ─────────────────────────
def test_metadata_forbidden_value_patterns_redacted():
    section("5. forbidden value patterns redacted (safe key, unsafe value)")
    db = _fresh_db()
    out = aes.append_event(
        event_type="test.metadata.value_scrub",
        actor_type="caregiver",
        actor_id="cg-test-meta-2",
        metadata={
            "note": "user reported their IP 192.168.1.99 changed",
            "blob": {"trace": "Bearer abcdef0123456789abcdef0123456789"},
            "kind": "info",
        },
        sql_runner=db,
    )
    check("status stored", out["_status"] == aes.STATUS_STORED)
    import json as _json
    blob = _json.loads(db.rows[0]["metadata_safe"])
    check("forbidden IPv4 in value -> redacted placeholder",
          blob.get("note") == "<REDACTED>",
          detail=str(blob))
    check("forbidden bearer-token shape -> redacted placeholder",
          blob.get("blob") == "<REDACTED>",
          detail=str(blob))
    check("clean key still preserved",
          blob.get("kind") == "info")


# ── 6. DB failure -> safe failure result, no exception ───────────────
def test_db_failure_returns_safe_result():
    section("6. DB failure -> failed_db result, safe error log, no raise")
    db = _fresh_db()
    db.fail_next = True

    audit_logger = logging.getLogger("amina.audit_event_store")
    audit_logger.setLevel(logging.ERROR)
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setLevel(logging.ERROR)
    audit_logger.addHandler(h)

    raised = False
    out = None
    try:
        out = aes.append_event(
            event_type="test.db.failure",
            actor_type="caregiver",
            actor_id="cg-fail-1",
            metadata={"phone": "+220-leak", "kind": "ok"},
            sql_runner=db,
        )
    except Exception:
        raised = True
    finally:
        audit_logger.removeHandler(h)

    check("never raises into caller", not raised)
    check("status failed_db", out and out["_status"] == aes.STATUS_FAILED_DB)
    check("stored=False", out and out["stored"] is False)
    check("event_id present even on failure",
          out and out.get("event_id", "").startswith("AUDIT-"))
    log_blob = buf.getvalue()
    check("error log line emitted",
          "audit_event_store: DB failure" in log_blob,
          detail=log_blob[:160])
    # The error log must NOT echo the forbidden metadata — caller's
    # leaked fields must not surface even in the failure path.
    for forbidden_token in ("+220-leak", "Mozilla", "127.0.0.1", "eyj"):
        check(f"failure log free of {forbidden_token!r}",
              forbidden_token not in log_blob)
    snap = aes.audit_health_snapshot()
    check("failure counter incremented",
          snap["failed_db"] >= 1, detail=str(snap))
    check("has_recent_db_failure marker on snapshot",
          snap["has_recent_db_failure"] is True)


# ── 7. Validation failure -> structured errors ───────────────────────
def test_validation_errors_returned():
    section("7. invalid event_type / tokens -> failed_validation")
    db = _fresh_db()
    out = aes.append_event(
        event_type="bad event type with spaces",   # invalid
        actor_type="System Person",                # invalid token (space, mixed case)
        sql_runner=db,
    )
    check("status failed_validation",
          out["_status"] == aes.STATUS_FAILED_VALIDATION)
    check("errors list non-empty", len(out.get("errors") or []) >= 2)
    check("never inserted",
          sum(1 for c in db.calls if c[0].upper().startswith("INSERT INTO")) == 0)


# ── 8. Stored row has zero PHI / token / IP / UA ─────────────────────
def test_stored_row_phi_free():
    section("8. stored row + metadata_safe contains zero PHI tokens")
    db = _fresh_db()
    out = aes.append_event(
        event_type="caregiver_privacy.consent.captured",
        actor_type="caregiver",
        actor_id="cg-fatou-test",
        subject_id="cg-fatou-test",
        action="grant",
        outcome="success",
        metadata={
            "phone":      "+220-leak-please-redact",
            "name":       "Fatou Test",
            "ip":         "127.0.0.1",
            "user_agent": "Mozilla/5.0 (Windows NT 10.0)",
            "token":      "eyj.tampered.jwt",
            "method":     "app",
            "notice":     "1.0",
        },
        sql_runner=db,
    )
    check("status stored", out["_status"] == aes.STATUS_STORED)
    blob = repr(db.rows[0]).lower()
    forbidden = (
        "fatou", "+220-leak", "127.0.0.1", "mozilla",
        "user-agent", "eyj", "bearer ",
    )
    leaked = [n for n in forbidden if n in blob]
    check("stored row contains no raw PHI / token shapes",
          not leaked, detail=f"leaked: {leaked}")
    # The actor id is stored as the hash, never the raw value.
    check("raw actor id not in row",
          "cg-fatou-test" not in blob)


# ── 9. Health snapshot is read-only and shape-stable ─────────────────
def test_health_snapshot_shape():
    section("9. audit_health_snapshot shape (AUDIT-010 anchor)")
    aes._reset_failure_counter_for_tests()
    db = _fresh_db()
    aes.append_event(event_type="t.h.attempt", actor_type="system",
                     sql_runner=db)
    db2 = MockDB(); db2.fail_next = True
    aes.append_event(event_type="t.h.dbfail", actor_type="system",
                     sql_runner=db2)
    aes.append_event(event_type="bad event", actor_type="system",
                     sql_runner=db)  # validation fail

    snap = aes.audit_health_snapshot()
    expected_keys = {
        "total_attempts", "failed_db", "failed_validation",
        "redactions", "last_failure_at", "last_failure_reason",
        "has_recent_db_failure", "has_recent_validation_failure",
    }
    check("snapshot has the canonical 8 keys",
          set(snap.keys()) == expected_keys,
          detail=str(set(snap.keys()) ^ expected_keys))
    check("total_attempts >= 3", snap["total_attempts"] >= 3,
          detail=str(snap))
    check("failed_db >= 1", snap["failed_db"] >= 1)
    check("failed_validation >= 1", snap["failed_validation"] >= 1)
    check("last_failure_reason is a short safe string",
          isinstance(snap["last_failure_reason"], str)
          and len(snap["last_failure_reason"]) < 256)
    # Raw failure traceback / PHI must not be in the reason field.
    rfr = snap["last_failure_reason"] or ""
    for n in ("traceback", "/app/", "Mozilla", "127.0.0.1"):
        check(f"last_failure_reason free of {n!r}",
              n.lower() not in rfr.lower())


# ── 10. actor_id_hash already-hashed pass-through ────────────────────
def test_actor_id_hash_passthrough():
    section("10. actor_id_hash (already hashed) is trusted as-is")
    db = _fresh_db()
    pre_hashed = "f" * 64  # valid sha256 shape
    out = aes.append_event(
        event_type="test.hash.passthrough",
        actor_type="system",
        actor_id_hash=pre_hashed,
        sql_runner=db,
    )
    check("status stored", out["_status"] == aes.STATUS_STORED)
    check("row stores the supplied hash verbatim",
          db.rows[0]["actor_id_hash"] == pre_hashed)


# ── Run all ──────────────────────────────────────────────────────────
def main() -> int:
    print("Phase 9 — Audit Event Store (AUDIT-005) test suite")
    print("=" * 64)
    test_append_event_stores_row()
    test_event_ids_unique()
    test_no_update_or_delete_api()
    test_metadata_forbidden_keys_dropped()
    test_metadata_forbidden_value_patterns_redacted()
    test_db_failure_returns_safe_result()
    test_validation_errors_returned()
    test_stored_row_phi_free()
    test_health_snapshot_shape()
    test_actor_id_hash_passthrough()
    print("\n" + "=" * 64)
    print(f"PASSED: {passed}    FAILED: {failed}")
    if failed:
        for e in errors:
            print(f"  - {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
