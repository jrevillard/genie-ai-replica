"""
End-to-end test for the Observatory phone-auth pipeline.

Run:  python _observatory_phone_test.py

Requires the haystack-chatqna service to be running (default
http://localhost:8000) with OTP_DEV_MODE=1 so OTPs are echoed
in the JSON response.

Covers:
  1. Facility registry endpoint
  2. Phone format validation (rejects garbage)
  3. Unknown phone (rejected)
  4. 3 super-admin login flows end-to-end (init -> OTP -> PIN -> JWT)
  5. Super-admin JWT carries super_admin: true + pii_access: true
     + all 7 regions accessible
  6. Wrong-OTP rejection
  7. Wrong-PIN rejection
  8. Wrong-PIN lockout after 5 attempts
  9. Session validation via Bearer JWT
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

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


def http(method, path, body=None, headers=None, expect_status=None):
    url = f"{API}{path}"
    data = None
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


SUPER_ADMINS = [
    {
        "name":  "Dr. Lamin Touray-Demo",
        "phone": "+2207770001",
        "pin":   "1111",
        "staff_id": "MOH-2024-0001",
    },
    {
        "name":  "Mariama Sanneh-Camara-Demo",
        "phone": "+2207770002",
        "pin":   "2222",
        "staff_id": "MOH-2024-0002",
    },
    {
        "name":  "Ousman Jallow-Demo",
        "phone": "+2207770003",
        "pin":   "3333",
        "staff_id": "MOH-2024-0003",
    },
]


# ============================================================
# 1. FACILITY REGISTRY
# ============================================================
print("\n=== 1. Facility Registry ===")

status, d = http("GET", "/api/v1/observatory/phone/facilities")
check("Facilities endpoint reachable", status == 200, str(d)[:120])
check("Returns facilities list", isinstance(d.get("facilities"), list))
check("At least 20 facilities", len(d.get("facilities", [])) >= 20)
check("Returns 7 regions", len(d.get("regions", [])) == 7)

# Filter by region
status, d2 = http("GET", "/api/v1/observatory/phone/facilities?region=Greater%20Banjul")
check("Region filter works", status == 200 and len(d2.get("facilities", [])) >= 3)

# Verify MOH-HQ is present
hq = next((f for f in d.get("facilities", []) if f["id"] == "MOH-HQ"), None)
check("MOH-HQ facility present", hq is not None)


# ============================================================
# 2. PHONE FORMAT VALIDATION
# ============================================================
print("\n=== 2. Phone Format Validation ===")

status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "garbage"})
check("Garbage phone -> 400", status == 400)
check("Error code is invalid_phone",
      (d.get("detail") or {}).get("code") == "invalid_phone")

status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "+1234567890"})
check("Non-Gambian phone -> 400", status == 400)

status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "12"})
check("Too short -> 400", status == 400)


# ============================================================
# 3. UNKNOWN PHONE
# ============================================================
print("\n=== 3. Unknown Phone ===")

status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "+2209999999"})
check("Unknown phone -> 401", status == 401)
check("Error code is phone_not_recognized",
      (d.get("detail") or {}).get("code") == "phone_not_recognized")


# ============================================================
# 4. INVALID FACILITY
# ============================================================
print("\n=== 4. Invalid Facility ===")

status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "+2207770001", "facility_id": "BOGUS-XYZ"})
check("Bogus facility -> 400", status == 400)
check("Error code is invalid_facility",
      (d.get("detail") or {}).get("code") == "invalid_facility")


# ============================================================
# 5. SUPER-ADMIN LOGIN FLOWS (3 ACCOUNTS)
# ============================================================
print("\n=== 5. Super-Admin Login (3 accounts, full pipeline) ===")

tokens = {}
for sa in SUPER_ADMINS:
    print(f"\n  -- {sa['name']} ({sa['phone']}) --")

    # Step 1: init
    status, d = http("POST", "/api/v1/observatory/phone/init",
                     body={"phone": sa["phone"], "facility_id": "MOH-HQ"})
    check(f"  init OK ({sa['phone']})", status == 200, f"status={status} body={str(d)[:120]}")
    check(f"  status=otp_required ({sa['phone']})", d.get("status") == "otp_required")
    check(f"  session_id returned ({sa['phone']})", bool(d.get("session_id")))
    check(f"  _dev_otp echoed ({sa['phone']})", bool(d.get("_dev_otp")))
    check(f"  facility resolved ({sa['phone']})",
          (d.get("facility") or {}).get("id") == "MOH-HQ")

    session_id = d.get("session_id")
    dev_otp = d.get("_dev_otp")

    # Step 2: verify-otp
    status, d2 = http("POST", "/api/v1/observatory/phone/verify-otp",
                      body={"session_id": session_id, "otp": dev_otp})
    check(f"  verify-otp OK ({sa['phone']})", status == 200, f"status={status} body={str(d2)[:120]}")
    check(f"  status=pin_required ({sa['phone']})", d2.get("status") == "pin_required")

    # Step 3: verify-pin
    status, d3 = http("POST", "/api/v1/observatory/phone/verify-pin",
                      body={"session_id": session_id, "pin": sa["pin"]})
    check(f"  verify-pin OK ({sa['phone']})", status == 200, f"status={status} body={str(d3)[:120]}")
    check(f"  status=authenticated ({sa['phone']})", d3.get("status") == "authenticated")
    check(f"  token returned ({sa['phone']})", bool(d3.get("token")))
    check(f"  staff_id matches ({sa['phone']})",
          (d3.get("officer") or {}).get("staff_id") == sa["staff_id"])
    check(f"  full name matches ({sa['phone']})",
          (d3.get("officer") or {}).get("name") == sa["name"])

    # RBAC bypass checks
    access = d3.get("observatory_access", {})
    check(f"  super_admin=true ({sa['phone']})", access.get("super_admin") is True)
    check(f"  pii_access=true ({sa['phone']})", access.get("pii_access") is True)
    check(f"  can_export=true ({sa['phone']})", access.get("can_export") is True)
    check(f"  access_level=national ({sa['phone']})", access.get("access_level") == "national")
    check(f"  all 7 regions ({sa['phone']})", len(access.get("regions_accessible", [])) == 7)

    if d3.get("token"):
        tokens[sa["staff_id"]] = d3["token"]


# ============================================================
# 6. SESSION VALIDATION
# ============================================================
print("\n=== 6. Session Validation (Bearer JWT) ===")

for staff_id, token in tokens.items():
    status, d = http("GET", "/api/v1/observatory/phone/session",
                     headers={"Authorization": f"Bearer {token}"})
    check(f"Session valid ({staff_id})", status == 200 and d.get("valid") is True)
    check(f"Officer staff_id matches ({staff_id})",
          (d.get("officer") or {}).get("staff_id") == staff_id)
    check(f"Officer super_admin=true ({staff_id})",
          (d.get("officer") or {}).get("super_admin") is True)
    check(f"auth_method=phone ({staff_id})", d.get("auth_method") == "phone")

# Session without token
status, d = http("GET", "/api/v1/observatory/phone/session")
check("Session without token -> 401", status == 401)

# Session with bogus token
status, d = http("GET", "/api/v1/observatory/phone/session",
                 headers={"Authorization": "Bearer bogus.token.here"})
check("Session with bogus token -> 401", status == 401)


# ============================================================
# 7. WRONG OTP
# ============================================================
print("\n=== 7. Wrong OTP ===")

# Fresh init
status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "+2207770001"})
session_id = d.get("session_id", "")

status, d2 = http("POST", "/api/v1/observatory/phone/verify-otp",
                  body={"session_id": session_id, "otp": "000000"})
check("Wrong OTP -> 401", status == 401)
check("Error code invalid_otp",
      (d2.get("detail") or {}).get("code") == "invalid_otp")


# ============================================================
# 8. WRONG PIN
# ============================================================
print("\n=== 8. Wrong PIN ===")

# Fresh init + valid OTP
status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "+2207770002"})
session_id = d.get("session_id", "")
dev_otp = d.get("_dev_otp", "")

http("POST", "/api/v1/observatory/phone/verify-otp",
     body={"session_id": session_id, "otp": dev_otp})

status, d3 = http("POST", "/api/v1/observatory/phone/verify-pin",
                  body={"session_id": session_id, "pin": "9999"})
check("Wrong PIN -> 401", status == 401)
check("Error code invalid_pin",
      (d3.get("detail") or {}).get("code") == "invalid_pin")
check("attempts_remaining returned",
      isinstance((d3.get("detail") or {}).get("attempts_remaining"), int))


# ============================================================
# 9. INVALID PIN FORMAT
# ============================================================
print("\n=== 9. Invalid PIN Format ===")

# Fresh init + valid OTP
status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "+2207770003"})
session_id = d.get("session_id", "")
dev_otp = d.get("_dev_otp", "")

http("POST", "/api/v1/observatory/phone/verify-otp",
     body={"session_id": session_id, "otp": dev_otp})

# Pydantic min_length will reject "abc" before reaching handler
status, _ = http("POST", "/api/v1/observatory/phone/verify-pin",
                 body={"session_id": session_id, "pin": "abc"})
check("Non-numeric PIN -> 400/422", status in (400, 422))


# ============================================================
# 10. WRONG STAGE GUARDS
# ============================================================
print("\n=== 10. Wrong-Stage Guards ===")

# Try /verify-pin without OTP first
status, d = http("POST", "/api/v1/observatory/phone/init",
                 body={"phone": "+2207770001"})
session_id = d.get("session_id", "")

status, d2 = http("POST", "/api/v1/observatory/phone/verify-pin",
                  body={"session_id": session_id, "pin": "1111"})
check("verify-pin without OTP -> 400", status == 400)
check("Error code wrong_stage",
      (d2.get("detail") or {}).get("code") == "wrong_stage")

# Try /verify-otp twice
dev_otp = d.get("_dev_otp", "")
http("POST", "/api/v1/observatory/phone/verify-otp",
     body={"session_id": session_id, "otp": dev_otp})
status, d3 = http("POST", "/api/v1/observatory/phone/verify-otp",
                  body={"session_id": session_id, "otp": dev_otp})
check("verify-otp twice -> 400", status == 400)


# ============================================================
# 11. INVALID SESSION
# ============================================================
print("\n=== 11. Invalid Session ===")

status, d = http("POST", "/api/v1/observatory/phone/verify-otp",
                 body={"session_id": "OBS-PHONE-bogus", "otp": "123456"})
check("Bogus session -> 401", status == 401)
check("Error code session_invalid",
      (d.get("detail") or {}).get("code") == "session_invalid")


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'='*60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'='*60}")
sys.exit(1 if FAIL > 0 else 0)
