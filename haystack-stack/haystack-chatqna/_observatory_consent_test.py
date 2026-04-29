"""
End-to-end test for the Observatory synthetic-data governance layer.

Run:  python _observatory_consent_test.py

Covers:
  1. Data-mode endpoint reports synthetic
  2. Disclaimer endpoint returns full text + 6 sections + 2 clauses
  3. Consent endpoint requires both checkboxes
  4. Consent flow: POST -> receipt + cookie + audit
  5. Consent receipt verification (GET /consent/{id})
  6. Consent revocation (DELETE /consent/{id})
  7. X-Data-Classification headers on every Observatory endpoint
  8. Synthetic-metadata template returns required fields
  9. Phone-auth pipeline still green (no regression)
"""
import json
import os
import sys
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


def http(method, path, body=None, want_headers=False):
    url = f"{API}{path}"
    data = None
    h = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body_json = json.loads(resp.read().decode("utf-8") or "{}")
            if want_headers:
                return resp.status, body_json, dict(resp.headers)
            return resp.status, body_json
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}


# ============================================================
# 1. DATA MODE
# ============================================================
print("\n=== 1. Data Mode ===")
s, d = http("GET", "/api/v1/observatory/data-mode")
check("data-mode reachable", s == 200)
check("mode is synthetic", d.get("data_mode") == "synthetic")
check("is_synthetic true", d.get("is_synthetic") is True)
check("is_production false", d.get("is_production") is False)


# ============================================================
# 2. DISCLAIMER
# ============================================================
print("\n=== 2. Disclaimer ===")
s, d = http("GET", "/api/v1/observatory/disclaimer")
check("disclaimer reachable", s == 200)
check("title present", "AMINA NCD Observatory" in (d.get("title") or ""))
check("6 sections", len(d.get("sections", [])) == 6)
check("2 consent clauses", len(d.get("consent_clauses", [])) == 2)
check("data_mode in response", d.get("data_mode") == "synthetic")


# ============================================================
# 3. CONSENT - BOTH BOXES REQUIRED
# ============================================================
print("\n=== 3. Consent Validation ===")

s, d = http("POST", "/api/v1/observatory/consent",
            body={"accepted_synthetic": True, "accepted_no_real_use": False})
check("only synth checked -> 400", s == 400)
check("error code consent_incomplete",
      (d.get("detail") or {}).get("code") == "consent_incomplete")

s, d = http("POST", "/api/v1/observatory/consent",
            body={"accepted_synthetic": False, "accepted_no_real_use": True})
check("only no-real-use checked -> 400", s == 400)

s, d = http("POST", "/api/v1/observatory/consent",
            body={"accepted_synthetic": False, "accepted_no_real_use": False})
check("neither checked -> 400", s == 400)


# ============================================================
# 4. CONSENT ACCEPT - FULL FLOW
# ============================================================
print("\n=== 4. Consent Accept ===")

s, d, headers = http("POST", "/api/v1/observatory/consent",
                     body={"accepted_synthetic": True, "accepted_no_real_use": True},
                     want_headers=True)
check("both checked -> 200", s == 200)
check("status accepted", d.get("status") == "accepted")
check("consent_id returned", bool(d.get("consent_id")))
check("consent_id format", (d.get("consent_id") or "").startswith("CONSENT-"))
check("Set-Cookie header present", "Set-Cookie" in headers
      or any("cookie" in k.lower() for k in headers))

receipt = d.get("receipt", {})
check("receipt has accepted_at", bool(receipt.get("accepted_at")))
check("receipt accepted_synthetic=true", receipt.get("accepted_synthetic") is True)
check("receipt accepted_no_real_use=true", receipt.get("accepted_no_real_use") is True)
check("receipt data_mode synthetic", receipt.get("data_mode") == "synthetic")
check("receipt has version", bool(receipt.get("version")))

CONSENT_ID = d.get("consent_id", "")


# ============================================================
# 5. CONSENT RECEIPT LOOKUP
# ============================================================
print("\n=== 5. Receipt Verification ===")

s, d = http("GET", f"/api/v1/observatory/consent/{CONSENT_ID}")
check("receipt lookup -> 200", s == 200)
check("valid=true", d.get("valid") is True)
check("receipt staff_id matches", d.get("receipt", {}).get("consent_id") == CONSENT_ID)

s, d = http("GET", "/api/v1/observatory/consent/CONSENT-bogus123")
check("bogus receipt -> 404", s == 404)
check("error code consent_not_found",
      (d.get("detail") or {}).get("code") == "consent_not_found")

s, d = http("GET", "/api/v1/observatory/consent/notvalid")
check("malformed id -> 400", s == 400)


# ============================================================
# 6. SYNTHETIC HEADERS ON OBSERVATORY ENDPOINTS
# ============================================================
print("\n=== 6. X-Data-Classification Headers ===")

probes = [
    ("/api/v1/observatory/phone/facilities",   "GET"),
    ("/api/v1/observatory/data-mode",          "GET"),
    ("/api/v1/observatory/disclaimer",         "GET"),
    ("/api/v1/observatory/synthetic-metadata", "GET"),
]
for path, method in probes:
    s, d, h = http(method, path, want_headers=True)
    headers_lower = {k.lower(): v for k, v in h.items()}
    check(f"  classification header on {path}",
          headers_lower.get("x-data-classification") == "SYNTHETIC")
    check(f"  real-data header on {path}",
          headers_lower.get("x-real-data") == "false")
    check(f"  environment header on {path}",
          headers_lower.get("x-environment") == "demonstration")
    check(f"  disclaimer header on {path}",
          "synthetic" in (headers_lower.get("x-data-disclaimer") or "").lower())


# ============================================================
# 7. SYNTHETIC METADATA TEMPLATE
# ============================================================
print("\n=== 7. Synthetic Metadata Template ===")

s, d = http("GET", "/api/v1/observatory/synthetic-metadata")
check("template reachable", s == 200)
required_keys = [
    "is_synthetic", "generated_by", "generated_at",
    "synthetic_version", "based_on_real_data",
    "safe_to_display", "safe_to_export",
    "safe_for_decisions", "safe_for_citation",
]
for k in required_keys:
    check(f"  template has {k}", k in d)

check("is_synthetic=True",         d.get("is_synthetic")        is True)
check("based_on_real_data=False",  d.get("based_on_real_data")  is False)
check("safe_for_decisions=False",  d.get("safe_for_decisions")  is False)
check("safe_for_citation=False",   d.get("safe_for_citation")   is False)


# ============================================================
# 8. CONSENT REVOKE
# ============================================================
print("\n=== 8. Consent Revoke ===")

s, d = http("DELETE", f"/api/v1/observatory/consent/{CONSENT_ID}")
check("revoke -> 200", s == 200)
check("status revoked", d.get("status") == "revoked")

s, d = http("GET", f"/api/v1/observatory/consent/{CONSENT_ID}")
check("revoked receipt -> 404", s == 404)


# ============================================================
# 9. PHONE-AUTH STILL WORKS (no regression)
# ============================================================
print("\n=== 9. Phone-Auth Smoke (no regression) ===")

s, d = http("POST", "/api/v1/observatory/phone/init",
            body={"phone": "+2207770001"})
check("init still works", s == 200)
check("status otp_required", d.get("status") == "otp_required")

dev_otp = d.get("_dev_otp")
session_id = d.get("session_id")
if dev_otp and session_id:
    s, d2 = http("POST", "/api/v1/observatory/phone/verify-otp",
                 body={"session_id": session_id, "otp": dev_otp})
    check("verify-otp still works", s == 200)

    s, d3 = http("POST", "/api/v1/observatory/phone/verify-pin",
                 body={"session_id": session_id, "pin": "1111"})
    check("verify-pin still works", s == 200)
    check("token still minted", bool(d3.get("token")))
    check("officer name has -Demo suffix",
          "Demo" in (d3.get("officer", {}).get("name") or ""))


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'=' * 60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'=' * 60}")
sys.exit(1 if FAIL > 0 else 0)
