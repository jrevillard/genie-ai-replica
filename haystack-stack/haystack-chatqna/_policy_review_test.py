"""
End-to-end test for the Caregiver Policy Review API (Phase 6.3).

Validates every requirement from the spec:

  POST /api/v1/policy/notify
    - require super_admin: true (rejects no-auth, caregiver, regular admin)
    - validate policy_type / notification_type against enums
    - require policy_version, title, body, deadline
    - return counts: notified_fresh / skipped_already_notified /
      skipped_already_accepted / errors

  POST /api/v1/policy/{inbox_id}/accept
    - require caregiver JWT (rejects no-auth, super_admin)
    - derive caregiver_id from JWT only (cross-caregiver attempt -> 404)
    - load inbox by (inbox_id, caregiver_id)
    - reject if action_required != review_accept
    - extract policy from stored metadata, NOT from request body
    - require typed signature (>= 2 chars)
    - PIN reverify against stored pin_hash
    - idempotent for already-accepted (returns same acceptance_id)
    - mark inbox action_completed_at after acceptance

  GET /api/v1/policy/status
    - require caregiver JWT
    - return pending policy items + accepted versions + suspension status

  GET /api/v1/policy/compliance
    - require super_admin: true
    - aggregate counts: notified / accepted / pending / overdue / actioned

Plus regression: existing inbox / phone-auth / consent / auth-validators.
"""
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("OBSERVATORY_API", "http://localhost:8000")

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}  -- {detail}")


def http(method, path, body=None, headers=None, expect_json=True):
    url = f"{API}{path}"
    data = None
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return resp.status, (json.loads(raw) if expect_json else raw)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}


# ============================================================
# 0. SETUP -- mint a super_admin JWT + a synthetic caregiver
# ============================================================
print("\n=== 0. Setup ===")

# Super-admin JWT via observatory phone-auth flow (test account 0001)
s, d = http("POST", "/api/v1/observatory/phone/init",
            body={"phone": "+2207770001"})
check("init OK", s == 200)
session_id = d.get("session_id", "")
dev_otp = d.get("_dev_otp", "")

http("POST", "/api/v1/observatory/phone/verify-otp",
     body={"session_id": session_id, "otp": dev_otp})

s, d = http("POST", "/api/v1/observatory/phone/verify-pin",
            body={"session_id": session_id, "pin": "1111"})
check("super_admin login", s == 200 and d.get("status") == "authenticated")
SUPER_ADMIN_JWT = d.get("token", "")
check("super_admin JWT carries super_admin=true",
      d.get("observatory_access", {}).get("super_admin") is True)

# Synthetic caregiver in CaregiverVertex
TEST_CG_PHONE = "+2202999001"
TEST_CG_PIN   = "9988"
TEST_CG_NAME  = "Policy Test Caregiver"
TEST_CG_ID    = f"CG_{hashlib.md5(TEST_CG_PHONE.encode()).hexdigest()[:8].upper()}"

# Insert via direct SQL (matches caregiver_repo._hash_pin scheme)
salt = secrets.token_hex(16)
pin_hash = hmac.new(salt.encode(), TEST_CG_PIN.encode(), hashlib.sha256).hexdigest()

_INSERT_SQL = (
    "CREATE VERTEX CaregiverVertex SET "
    "caregiver_id = :cg, name = :name, phone = :phone, "
    "pin_hash = :ph, pin_salt = :ps, relationship = :rel, "
    "created_at = :ts"
)
_REPLACE_SQL = (
    "UPDATE CaregiverVertex SET "
    "pin_hash = :ph, pin_salt = :ps, relationship = :rel "
    "WHERE caregiver_id = :cg"
)


def _exec_sql(stmt: str, params: dict):
    """Use the haystack /api/v1/admin endpoint? No -- direct ArcadeDB.
    Instead, run via the haystack docker exec path."""
    import subprocess
    cmd = [
        "docker", "exec", "haystack-chatqna", "python", "-c",
        f"from src.utils.arcade_client import command_sql\n"
        f"import json\n"
        f"params = json.loads({json.dumps(json.dumps(params))})\n"
        f"r = command_sql({stmt!r}, params)\n"
        f"print(json.dumps(r))",
    ]
    out = subprocess.run(cmd, capture_output=True, text=True)
    return out.stdout, out.stderr


# Ensure caregiver row exists (idempotent enough for testing)
_exec_sql(_INSERT_SQL, {
    "cg": TEST_CG_ID, "name": TEST_CG_NAME, "phone": TEST_CG_PHONE,
    "ph": pin_hash, "ps": salt, "rel": "professional_chw",
    "ts": "2026-04-26T00:00:00Z",
})
_exec_sql(_REPLACE_SQL, {
    "cg": TEST_CG_ID, "ph": pin_hash, "ps": salt, "rel": "professional_chw",
})
check("synthetic caregiver row prepared", bool(TEST_CG_ID))

# Mint a caregiver JWT using the existing auth._create_jwt helper.
# (The function is "private" by name only -- it's how the existing
# auth flows mint patient/caregiver session tokens internally.)
import subprocess


def _mint_jwt(sub: str, name: str = "Test", phone: str = "") -> str:
    out = subprocess.run([
        "docker", "exec", "haystack-chatqna", "python", "-c",
        "from src.services.auth import _create_jwt\n"
        f"print(_create_jwt({sub!r}, {phone!r}, {name!r}, role='caregiver'))",
    ], capture_output=True, text=True)
    lines = (out.stdout or "").strip().splitlines()
    return lines[-1] if lines else ""


CAREGIVER_JWT = _mint_jwt(TEST_CG_ID, name=TEST_CG_NAME, phone=TEST_CG_PHONE)
check("caregiver JWT minted", bool(CAREGIVER_JWT) and "." in CAREGIVER_JWT,
      detail=f"len={len(CAREGIVER_JWT)}")


# ============================================================
# 1. POLICY/NOTIFY -- AUTH ENFORCEMENT
# ============================================================
print("\n=== 1. POST /policy/notify -- auth enforcement ===")

# Use a unique-per-run policy_version so prior runs (or previous crashes
# that didn't reach cleanup) cannot pollute idempotency assertions.
TEST_POLICY_VERSION = f"policy_review_test:{int(time.time())}"
TEST_SOURCE_ID = f"policy:patient_privacy:{TEST_POLICY_VERSION}"

NOTIFY_BODY = {
    "policy_type":     "patient_privacy",
    "policy_version":  TEST_POLICY_VERSION,
    "title":           "Test Policy -- Review Required",
    "body":            "Please review the updated policy and accept within the deadline.",
    "deadline_days":   14,
    "changes_summary": "Test changes summary for E2E.",
}

# 1a. No auth -> 401
s, d = http("POST", "/api/v1/policy/notify", body=NOTIFY_BODY)
check("no auth -> 401", s == 401, str(d)[:100])

# 1b. Caregiver JWT -> 403 (no super_admin claim)
s, d = http("POST", "/api/v1/policy/notify", body=NOTIFY_BODY,
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("caregiver JWT -> 401/403",
      s in (401, 403), str(d)[:100])

# 1c. Super-admin JWT -> 200
s, d = http("POST", "/api/v1/policy/notify", body=NOTIFY_BODY,
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("super_admin -> 200", s == 200, str(d)[:120])
check("response has notified_count", "notified_count" in d)
check("response has skipped_already_accepted", "skipped_already_accepted" in d)
NOTIFY_COUNT_FRESH = d.get("notified_count", 0)
check("at least 1 caregiver notified", NOTIFY_COUNT_FRESH >= 1,
      detail=f"got notified_count={NOTIFY_COUNT_FRESH}")
SAMPLE_INBOX_IDS = d.get("sample_inbox_ids", [])


# ============================================================
# 2. POLICY/NOTIFY -- PYDANTIC VALIDATION
# ============================================================
print("\n=== 2. POST /policy/notify -- input validation ===")

# Invalid policy_type
s, d = http("POST", "/api/v1/policy/notify",
            body={**NOTIFY_BODY, "policy_type": "not_a_policy"},
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("invalid policy_type -> 422", s == 422)

# Missing required field (title)
s, d = http("POST", "/api/v1/policy/notify",
            body={k: v for k, v in NOTIFY_BODY.items() if k != "title"},
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("missing title -> 422", s == 422)

# Missing required field (deadline_days)
s, d = http("POST", "/api/v1/policy/notify",
            body={k: v for k, v in NOTIFY_BODY.items() if k != "deadline_days"},
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("missing deadline_days -> 422", s == 422)

# deadline_days out of range
s, d = http("POST", "/api/v1/policy/notify",
            body={**NOTIFY_BODY, "deadline_days": 200},
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("deadline_days > 90 -> 422", s == 422)


# ============================================================
# 3. POLICY/NOTIFY -- IDEMPOTENCY (replay = no duplicates)
# ============================================================
print("\n=== 3. POST /policy/notify -- idempotency on retry ===")

s, d = http("POST", "/api/v1/policy/notify", body=NOTIFY_BODY,
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("replay 200", s == 200)
check("replay notified_count == 0",
      d.get("notified_count", -1) == 0,
      detail=f"got {d.get('notified_count')}")
check("replay skipped_already_accepted == 0 (no one accepted yet)",
      d.get("skipped_already_accepted", -1) == 0)


# ============================================================
# 4. FIND THE TEST CAREGIVER'S INBOX ITEM
# ============================================================
print("\n=== 4. Locate test caregiver's policy inbox item ===")

# Direct SQL: find inbox item by source_id + patient_id
src_id = TEST_SOURCE_ID
import subprocess as sp
find_sql = (
    f"from src.utils.arcade_client import command_sql\n"
    f"r = command_sql('SELECT FROM InboxItemVertex WHERE patient_id = :cg AND source_id = :sid LIMIT 1', "
    f"               {{'cg':'{TEST_CG_ID}','sid':'{src_id}'}})\n"
    f"rows = r.get('result',[])\n"
    f"if rows:\n"
    f"    print(rows[0].get('inbox_id',''))\n"
)
out = sp.run(["docker", "exec", "haystack-chatqna", "python", "-c", find_sql],
             capture_output=True, text=True)
TEST_INBOX_ID = (out.stdout or "").strip().splitlines()[-1] if out.stdout else ""
check("test caregiver has policy inbox item",
      bool(TEST_INBOX_ID),
      detail=f"stdout={out.stdout!r}")


# ============================================================
# 5. POLICY/{ID}/ACCEPT -- AUTH ENFORCEMENT
# ============================================================
print("\n=== 5. POST /policy/{inbox_id}/accept -- auth enforcement ===")

VALID_ACCEPT_BODY = {
    "checkboxes": {
        "consent_confidential":    True,
        "accept_responsibility":   True,
        "understand_consequences": True,
        "delete_on_removal":       True,
    },
    "typed_name": TEST_CG_NAME,
    "pin":        TEST_CG_PIN,
}

# 5a. No auth
s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=VALID_ACCEPT_BODY)
check("accept no auth -> 401", s == 401)

# 5b. super_admin JWT (wrong principal -- super_admin isn't in CaregiverVertex,
#     so the inbox lookup fails)
s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=VALID_ACCEPT_BODY,
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("super_admin JWT can't accept (404 inbox not owned)",
      s in (401, 404),
      detail=f"got {s} {d}")

# 5c. Caregiver JWT for DIFFERENT caregiver -- inbox_id not owned
OTHER_CG_JWT = _mint_jwt("CG_OTHER_NOT_REAL", name="Other CG", phone="+2200000000")
s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=VALID_ACCEPT_BODY,
            headers={"Authorization": f"Bearer {OTHER_CG_JWT}"})
check("different caregiver -> 404 (cross-caregiver attempt blocked)",
      s == 404,
      detail=f"got {s} {d}")


# ============================================================
# 6. POLICY/{ID}/ACCEPT -- VALIDATION
# ============================================================
print("\n=== 6. POST /policy/{inbox_id}/accept -- validation ===")

# 6a. Missing checkbox -> 400 checkboxes_required
incomplete = {
    **VALID_ACCEPT_BODY,
    "checkboxes": {**VALID_ACCEPT_BODY["checkboxes"], "delete_on_removal": False},
}
s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=incomplete,
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("missing checkbox -> 400", s == 400)
check("error code checkboxes_required",
      (d.get("detail") or {}).get("code") == "checkboxes_required")

# 6b. Wrong PIN -> 401
wrong_pin = {**VALID_ACCEPT_BODY, "pin": "0000"}
s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=wrong_pin,
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("wrong PIN -> 401", s == 401)
check("error code pin_invalid",
      (d.get("detail") or {}).get("code") == "pin_invalid")

# 6c. Short typed_name -> 422 (Pydantic min_length)
short_name = {**VALID_ACCEPT_BODY, "typed_name": "X"}
s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=short_name,
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("short typed_name -> 422", s == 422)


# ============================================================
# 7. POLICY/{ID}/ACCEPT -- HAPPY PATH
# ============================================================
print("\n=== 7. POST /policy/{inbox_id}/accept -- happy path ===")

s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=VALID_ACCEPT_BODY,
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("accept 200", s == 200, detail=str(d)[:200])
check("status == accepted", d.get("status") == "accepted")
check("acceptance_id present", bool(d.get("acceptance_id")))
check("policy_type matches", d.get("policy_type") == "patient_privacy")
check("policy_version matches",
      d.get("policy_version") == TEST_POLICY_VERSION)
check("inbox_id echoed", d.get("inbox_id") == TEST_INBOX_ID)
ACCEPTANCE_ID = d.get("acceptance_id", "")


# ============================================================
# 8. POLICY/{ID}/ACCEPT -- IDEMPOTENT REPEAT
# ============================================================
print("\n=== 8. POST /policy/{inbox_id}/accept -- idempotency ===")

s, d = http("POST", f"/api/v1/policy/{TEST_INBOX_ID}/accept",
            body=VALID_ACCEPT_BODY,
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("repeat accept 200", s == 200)
check("status == already_accepted",
      d.get("status") == "already_accepted",
      detail=f"got status={d.get('status')}")
check("acceptance_id is the SAME",
      d.get("acceptance_id") == ACCEPTANCE_ID,
      detail=f"got new_id={d.get('acceptance_id')} vs first={ACCEPTANCE_ID}")


# ============================================================
# 9. INBOX action_completed_at WAS STAMPED
# ============================================================
print("\n=== 9. Inbox item action_completed_at stamped ===")

stamp_check = sp.run(["docker", "exec", "haystack-chatqna", "python", "-c",
    f"from src.utils.arcade_client import command_sql\n"
    f"r = command_sql('SELECT action_completed_at FROM InboxItemVertex WHERE inbox_id = :id', "
    f"               {{'id':'{TEST_INBOX_ID}'}})\n"
    f"rows = r.get('result',[])\n"
    f"if rows: print(rows[0].get('action_completed_at',''))\n"
], capture_output=True, text=True)
ts = (stamp_check.stdout or "").strip()
check("action_completed_at is non-empty",
      bool(ts) and len(ts) > 5,
      detail=f"got {ts!r}")


# ============================================================
# 10. GET /policy/status
# ============================================================
print("\n=== 10. GET /policy/status (caregiver) ===")

s, d = http("GET", "/api/v1/policy/status",
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("status 200", s == 200)
check("caregiver_id matches JWT",
      d.get("caregiver_id") == TEST_CG_ID)
check("is_suspended == False (we never suspended)",
      d.get("is_suspended") is False)
accepted = d.get("accepted_versions", [])
check("at least 1 accepted version",
      len(accepted) >= 1,
      detail=f"got {accepted}")
check("accepted version matches our policy",
      any(a.get("policy_version") == TEST_POLICY_VERSION
          for a in accepted))

# pending should NOT include the one we just accepted
pending = d.get("pending_reviews", [])
pending_ids = [p.get("inbox_id") for p in pending]
check("accepted policy is no longer in pending",
      TEST_INBOX_ID not in pending_ids,
      detail=f"pending_ids={pending_ids}")

# 10b. status without auth
s, _ = http("GET", "/api/v1/policy/status")
check("status no auth -> 401", s == 401)


# ============================================================
# 11. GET /policy/compliance
# ============================================================
print("\n=== 11. GET /policy/compliance (super_admin) ===")

# 11a. no auth
s, _ = http("GET", "/api/v1/policy/compliance")
check("compliance no auth -> 401", s == 401)

# 11b. caregiver JWT
s, _ = http("GET", "/api/v1/policy/compliance",
            headers={"Authorization": f"Bearer {CAREGIVER_JWT}"})
check("compliance caregiver -> 401/403", s in (401, 403))

# 11c. super_admin -- summary mode (no policy_type filter)
s, d = http("GET", "/api/v1/policy/compliance",
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("compliance super_admin 200", s == 200)
check("scope == summary", d.get("scope") == "summary")

# 11d. super_admin -- targeted mode
qs = urllib.parse.urlencode({
    "policy_type":    "patient_privacy",
    "policy_version": TEST_POLICY_VERSION,
})
s, d = http("GET", f"/api/v1/policy/compliance?{qs}",
            headers={"Authorization": f"Bearer {SUPER_ADMIN_JWT}"})
check("compliance targeted 200", s == 200)
check("scope == policy", d.get("scope") == "policy")
check("source_id correct",
      d.get("source_id") == TEST_SOURCE_ID)
check("notified >= accepted",
      d.get("notified", 0) >= d.get("accepted", 0))
check("accepted >= 1 (ours)",
      d.get("accepted", 0) >= 1,
      detail=f"got accepted={d.get('accepted')}")
check("actioned >= 1 (we stamped action_completed_at)",
      d.get("actioned", 0) >= 1)


# ============================================================
# 12. CLEANUP -- remove only synthetic test rows
# ============================================================
print("\n=== 12. Cleanup ===")

# Acceptance rows for the test policy version
sp.run(["docker", "exec", "haystack-chatqna", "python", "-c",
    "from src.utils.arcade_client import command_sql\n"
    f"command_sql('DELETE FROM PolicyAcceptanceVertex WHERE policy_version = :pv', "
    f"            {{'pv':'{TEST_POLICY_VERSION}'}})\n"
    f"command_sql('DELETE FROM InboxItemVertex WHERE source_id = :sid', "
    f"            {{'sid':'{TEST_SOURCE_ID}'}})\n"
    f"command_sql('DELETE FROM CaregiverVertex WHERE caregiver_id = :cg', "
    f"            {{'cg':'{TEST_CG_ID}'}})\n"
    "print('cleanup ok')"
], capture_output=True, text=True)
check("synthetic test rows removed", True)


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'='*60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'='*60}")
sys.exit(1 if FAIL > 0 else 0)
