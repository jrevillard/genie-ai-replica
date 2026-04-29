"""
Observatory Auth — End-to-End Integration Test
Run from haystack-chatqna dir:  python _observatory_e2e_test.py
Requires the container to be running on localhost:8000.
"""
import json
import sys
import urllib.request
import urllib.error

API = "http://localhost:8000/api/v1"
PASS = 0
FAIL = 0


def post(path, body, token=None, method="POST"):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode(),
        headers=headers, method=method,
    )
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


def put(path, body, token=None):
    return post(path, body, token, method="PUT")


def get(path, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{API}{path}", headers=headers)
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}  -- {detail}")


# =================================================================
# STEP 1: Admin Login (seeded Dr. Mariama Ceesay)
# =================================================================
print("\n" + "=" * 60)
print("  STEP 1: Admin Login (Seeded Director)")
print("=" * 60)

d, code = post("/observatory/login", {
    "staff_id": "MOH-2026-0001",
    "nin": "9876543",
    "password": "GambiaGov2026!",
})
check("Admin login -> otp_required", d.get("status") == "otp_required")
check("Session ID starts with OBS-", d.get("session_id", "").startswith("OBS-"))
check("Phone hint present", len(d.get("phone_hint", "")) > 0)
check("Dev OTP present", len(str(d.get("_dev_otp", ""))) == 6)

admin_session = d["session_id"]
admin_otp = str(d["_dev_otp"])

d2, code2 = post("/observatory/verify-otp", {
    "session_id": admin_session,
    "otp": admin_otp,
})
check("OTP verify -> token returned", "token" in d2)
check("Officer name", d2.get("officer", {}).get("name") == "Dr. Mariama Ceesay")
check("Access level: national", d2.get("observatory_access", {}).get("access_level") == "national")
check("All 7 regions", len(d2.get("observatory_access", {}).get("regions_accessible", [])) == 7)
check("No PII access", d2.get("observatory_access", {}).get("pii_access") is False)
check("Can export", d2.get("observatory_access", {}).get("can_export") is True)

ADMIN_TOKEN = d2["token"]
print(f"\n  Admin token: {ADMIN_TOKEN[:40]}... ({len(ADMIN_TOKEN)} chars)")


# =================================================================
# STEP 2: Create 5 Test Officials
# =================================================================
print("\n" + "=" * 60)
print("  STEP 2: Create 5 Government Officials")
print("=" * 60)

officials = [
    {
        "staff_id": "MOH-2025-0101",
        "full_name": "Dr. Lamin Touray",
        "nin": "15068512345",
        "phone": "+2207234567",
        "email": "lamin.touray@moh.gov.gm",
        "role": "regional_health_director",
        "region": "North Bank",
        "professional_registration": "GMDC-2020-045",
        "date_of_birth": "1985-06-15",
        "start_date": "2025-03-01",
    },
    {
        "staff_id": "MOH-2024-0250",
        "full_name": "Ms. Binta Jatta",
        "nin": "22039012345",
        "phone": "+2205678901",
        "email": "binta.jatta@moh.gov.gm",
        "role": "chn",
        "region": "Upper River",
        "date_of_birth": "1990-03-22",
        "start_date": "2024-06-15",
    },
    {
        "staff_id": "MOH-2026-0078",
        "full_name": "Mr. Ousman Ceesay",
        "nin": "10078812345",
        "phone": "+2203456789",
        "email": "ousman.ceesay@moh.gov.gm",
        "role": "pharmacist",
        "region": "Kanifing",
        "facility": "Kanifing General Hospital",
        "professional_registration": "GPC-2022-018",
        "date_of_birth": "1988-07-10",
        "start_date": "2026-01-10",
    },
    {
        "staff_id": "MOH-2025-0192",
        "full_name": "Ms. Isatou Sowe",
        "nin": "03059212345",
        "phone": "+2209876543",
        "email": "isatou.sowe@moh.gov.gm",
        "role": "m_and_e_officer",
        "region": "Central River",
        "date_of_birth": "1992-05-03",
        "start_date": "2025-09-01",
    },
    {
        "staff_id": "MOH-2024-0015",
        "full_name": "Dr. Abdoulie Bah",
        "nin": "18117512345",
        "phone": "+2207891234",
        "email": "abdoulie.bah@moh.gov.gm",
        "role": "deputy_director",
        "region": "Greater Banjul",
        "professional_registration": "GMDC-2018-012",
        "date_of_birth": "1975-11-18",
        "start_date": "2024-02-01",
    },
]

created = []
for i, off in enumerate(officials, 1):
    d, code = post("/observatory/staff/create", off, ADMIN_TOKEN)
    ok = "temporary_password" in d
    pw = d.get("temporary_password", "")
    sms = d.get("onboarding_sms_sent", False)
    label = f"{off['full_name']} ({off['role']}, {off['region']})"
    check(f"Create #{i}: {label}", ok, f"code={code} resp={d}")
    if ok:
        print(f"     Staff ID: {off['staff_id']}  Temp PW: {pw}  SMS: {sms}")
        created.append({**off, "password": pw})


# =================================================================
# STEP 3: List Staff
# =================================================================
print("\n" + "=" * 60)
print("  STEP 3: List All Staff")
print("=" * 60)

d, code = get("/observatory/staff", ADMIN_TOKEN)
total = d.get("total", 0)
check("Staff list returns data", total >= 5, f"total={total}")
print(f"  Total staff: {total}")
for s in d.get("staff", []):
    tag = " [seeded]" if s.get("_seeded") else ""
    print(f"    {s.get('staff_id',''):16}  {s.get('full_name',''):24}  "
          f"role={s.get('role',''):28}  region={s.get('region','')}{tag}")


# =================================================================
# STEP 4: Login Each Created Official
# =================================================================
print("\n" + "=" * 60)
print("  STEP 4: Login Test for Each Official")
print("=" * 60)

EXPECTED_ACCESS = {
    "regional_health_director": ("regional", ["North Bank"], False),
    "chn":                      ("data_entry", ["Upper River"], False),
    "pharmacist":               ("facility", ["Kanifing"], False),
    "m_and_e_officer":          ("regional", ["Central River"], False),
    "deputy_director":          ("national", None, True),  # None = all 7
}

for off in created:
    print(f"\n  --- {off['full_name']} ({off['staff_id']}) ---")
    role = off["role"]
    exp_level, exp_regions, exp_national = EXPECTED_ACCESS[role]

    # Login
    d, code = post("/observatory/login", {
        "staff_id": off["staff_id"],
        "nin": off["nin"],
        "password": off["password"],
    })
    check(f"{off['staff_id']} login", d.get("status") == "otp_required",
          f"code={code} resp={d}")
    if d.get("status") != "otp_required":
        continue

    check(f"  must_change_password=True", d.get("must_change_password") is True)

    # Verify OTP
    d2, code2 = post("/observatory/verify-otp", {
        "session_id": d["session_id"],
        "otp": str(d["_dev_otp"]),
    })
    check(f"  OTP verify -> token", "token" in d2, f"code={code2}")
    if "token" not in d2:
        continue

    acc = d2.get("observatory_access", {})
    check(f"  access_level={exp_level}", acc.get("access_level") == exp_level,
          f"got={acc.get('access_level')}")

    if exp_regions is not None:
        check(f"  regions={exp_regions}", acc.get("regions_accessible") == exp_regions,
              f"got={acc.get('regions_accessible')}")
    else:
        check(f"  all 7 regions (national)", len(acc.get("regions_accessible", [])) == 7)

    check(f"  can_view_national={exp_national}", acc.get("can_view_national") == exp_national)
    check(f"  pii_access=False", acc.get("pii_access") is False)

    # Session check
    tok = d2["token"]
    d3, _ = get("/observatory/session", tok)
    check(f"  session valid", d3.get("valid") is True, f"resp={d3}")


# =================================================================
# STEP 5: Security Tests
# =================================================================
print("\n" + "=" * 60)
print("  STEP 5: Security Tests")
print("=" * 60)

target = created[0]

# 5a. Wrong password
print("\n  5a. Wrong password:")
d, code = post("/observatory/login", {
    "staff_id": target["staff_id"],
    "nin": target["nin"],
    "password": "WrongPassword123!",
})
check("Wrong PW -> 401", code == 401)
check("Error=authentication_failed", d.get("error") == "authentication_failed")
check("Attempts remaining shown", d.get("attempts_remaining") is not None)
print(f"     Remaining: {d.get('attempts_remaining')}")

# 5b. Wrong NIN (valid format but mismatched)
print("\n  5b. Wrong NIN:")
d, code = post("/observatory/login", {
    "staff_id": target["staff_id"],
    "nin": "9999999",
    "password": target["password"],
})
check("Wrong NIN -> 401", code == 401)

# 5c. Invalid Staff ID format
print("\n  5c. Invalid Staff ID format:")
d, code = post("/observatory/login", {
    "staff_id": "BADFORMAT",
    "nin": "1234567",
    "password": "test",
})
check("Bad format -> 400", code == 400)
check("Error=validation_failed", d.get("error") == "validation_failed")

# 5d. Invalid NIN (too short)
print("\n  5d. Invalid NIN (too short):")
d, code = post("/observatory/login", {
    "staff_id": "MOH-2026-0001",
    "nin": "123",
    "password": "test",
})
check("Short NIN -> 400", code == 400)

# 5e. Wrong OTP
print("\n  5e. Wrong OTP:")
d, _ = post("/observatory/login", {
    "staff_id": target["staff_id"],
    "nin": target["nin"],
    "password": target["password"],
})
if d.get("session_id"):
    d2, code2 = post("/observatory/verify-otp", {
        "session_id": d["session_id"],
        "otp": "000000",
    })
    check("Wrong OTP -> 401", code2 == 401)
    check("Error=otp_failed", d2.get("error") == "otp_failed")

# 5f. Non-existent staff
print("\n  5f. Non-existent staff:")
d, code = post("/observatory/login", {
    "staff_id": "MOH-2026-9999",
    "nin": "1234567",
    "password": "test",
})
check("Unknown staff -> 401", code == 401)

# 5g. Duplicate staff creation
print("\n  5g. Duplicate staff ID:")
d, code = post("/observatory/staff/create", officials[0], ADMIN_TOKEN)
check("Duplicate -> 409", code == 409)
check("Already exists message", "already exists" in d.get("detail", "").lower())

# 5h. No auth -> staff create fails
print("\n  5h. Unauthorized staff create:")
d, code = post("/observatory/staff/create", officials[0])
check("No token -> 401", code == 401)


# =================================================================
# STEP 6: Logout
# =================================================================
print("\n" + "=" * 60)
print("  STEP 6: Logout")
print("=" * 60)

d, _ = post("/observatory/login", {
    "staff_id": target["staff_id"],
    "nin": target["nin"],
    "password": target["password"],
})
d2, _ = post("/observatory/verify-otp", {
    "session_id": d["session_id"],
    "otp": str(d["_dev_otp"]),
})
tok = d2["token"]

d3, _ = get("/observatory/session", tok)
check("Before logout: session valid", d3.get("valid") is True)

d4, _ = post("/observatory/logout", {}, tok)
check("Logout status=logged_out", d4.get("status") == "logged_out")

d5, _ = get("/observatory/session", tok)
check("After logout: session invalid", d5.get("valid") is False)
print(f"  Reason: {d5.get('reason', '')}")


# =================================================================
# STEP 7: Admin Operations (suspend, unlock, reset)
# =================================================================
print("\n" + "=" * 60)
print("  STEP 7: Admin Operations")
print("=" * 60)

target2 = created[1]  # Ms. Binta Jatta

# Suspend
print(f"\n  Suspending {target2['staff_id']}...")
d, code = put(f"/observatory/staff/{target2['staff_id']}/suspend",
              {"reason": "Annual leave"}, ADMIN_TOKEN)
check("Suspend -> status=suspended", d.get("status") == "suspended")

# Try login after suspension
d, code = post("/observatory/login", {
    "staff_id": target2["staff_id"],
    "nin": target2["nin"],
    "password": target2["password"],
})
check("Suspended user login blocked", d.get("error") == "account_suspended")

# Unlock
print(f"\n  Unlocking {target2['staff_id']}...")
d, code = put(f"/observatory/staff/{target2['staff_id']}/unlock", {}, ADMIN_TOKEN)
check("Unlock -> status=unlocked", d.get("status") == "unlocked")

# Login after unlock should work
d, code = post("/observatory/login", {
    "staff_id": target2["staff_id"],
    "nin": target2["nin"],
    "password": target2["password"],
})
check("After unlock: login works", d.get("status") == "otp_required")

# Password reset
print(f"\n  Resetting password for {target2['staff_id']}...")
d, code = put(f"/observatory/staff/{target2['staff_id']}/reset-password", {}, ADMIN_TOKEN)
check("Reset -> new temp password", "temporary_password" in d)
check("Must change PW flag", d.get("must_change_password") is True)
new_pw = d.get("temporary_password", "")
print(f"  New temp PW: {new_pw}")

# Login with new password
d, code = post("/observatory/login", {
    "staff_id": target2["staff_id"],
    "nin": target2["nin"],
    "password": new_pw,
})
check("Login with new PW works", d.get("status") == "otp_required")

# Deactivate
print(f"\n  Deactivating {target2['staff_id']}...")

# Use urllib DELETE
req = urllib.request.Request(
    f"{API}/observatory/staff/{target2['staff_id']}",
    method="DELETE",
    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
)
try:
    resp = urllib.request.urlopen(req)
    d = json.loads(resp.read())
    code = resp.status
except urllib.error.HTTPError as e:
    d = json.loads(e.read())
    code = e.code

check("Deactivate -> status=deactivated", d.get("status") == "deactivated")


# =================================================================
# STEP 8: Audit Log
# =================================================================
print("\n" + "=" * 60)
print("  STEP 8: Audit Log")
print("=" * 60)

d, _ = get("/observatory/audit-log?limit=20", ADMIN_TOKEN)
events = d.get("events", [])
check("Audit log has events", len(events) > 0, f"count={len(events)}")
print(f"  Total events retrieved: {len(events)}")

event_types = set(e.get("event_type", "") for e in events)
print(f"  Event types seen: {sorted(event_types)}")

check("login_attempt in audit", "login_attempt" in event_types)
check("otp_verified in audit", "otp_verified" in event_types)
check("observatory_login in audit", "observatory_login" in event_types)

for e in events[:10]:
    ts = e.get("timestamp", "")[:19]
    et = e.get("event_type", "")
    sid = e.get("staff_id", "")
    ok = e.get("success", "")
    fr = e.get("failure_reason", "")
    print(f"    {ts}  {et:25}  staff={sid:16}  ok={ok}  {fr}")


# =================================================================
# STEP 9: Backwards Compatibility
# =================================================================
print("\n" + "=" * 60)
print("  STEP 9: Backwards Compatibility")
print("=" * 60)

# Old /gov/login still works
d, code = post("/gov/login", {
    "staff_id": "MOH-2026-0002",
    "national_id": "8654321",
    "password": "HealthAdmin2026!",
})
check("Old /gov/login works", "token" in d, f"code={code}")
check("Old login returns official", d.get("official", {}).get("name") == "Mr. Ebrima Jobarteh")

# Old token works on gov endpoints
old_tok = d.get("token", "")
d2, code2 = get("/gov/mv/national-pulse", old_tok)
check("Old token on gov MV endpoints", code2 == 200, f"code={code2}")


# =================================================================
# SUMMARY
# =================================================================
print(f"\n{'='*60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'='*60}")

# Print the credentials table for reference
print("\n  GENERATED TEST CREDENTIALS:")
print("  " + "-" * 78)
print(f"  {'Staff ID':16}  {'Name':24}  {'NIN':12}  {'Password':14}  Role")
print("  " + "-" * 78)
# Seeded
print(f"  {'MOH-2026-0001':16}  {'Dr. Mariama Ceesay':24}  {'9876543':12}  {'GambiaGov2026!':14}  director [seeded]")
print(f"  {'MOH-2026-0002':16}  {'Mr. Ebrima Jobarteh':24}  {'8654321':12}  {'HealthAdmin2026!':14}  HIS lead [seeded]")
print(f"  {'MOH-2026-0003':16}  {'Ms. Fatoumatta Saidy':24}  {'7123456':12}  {'NCDSurv2026!':14}  NCD lead [seeded]")
# Created
for c in created:
    print(f"  {c['staff_id']:16}  {c['full_name']:24}  {c['nin']:12}  {c['password']:14}  {c['role']}")
print("  " + "-" * 78)
print()

sys.exit(1 if FAIL > 0 else 0)
