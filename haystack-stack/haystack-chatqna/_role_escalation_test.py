#!/usr/bin/env python3
"""
Role-escalation + impersonation matrix for /api/v1/care/*.

Verifies the new effective-role resolver:
  - JWT role=admin:    body.role is HONORED (impersonation)
  - JWT role=patient:  body.role is IGNORED (cannot self-promote)
  - No JWT:            body.role is used as-is (legacy demo path)
"""
from __future__ import annotations
import sys
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

API = "http://localhost:8000"

# Login to get real JWTs
ADMIN_TOK = requests.post(
    f"{API}/api/v1/admin/login",
    json={"username": "admin", "password": "amina2026"},
    timeout=10,
).json().get("token")

PATIENT_TOK = requests.post(
    f"{API}/api/v1/auth/login/email",
    json={"email": "beginner@demo.aminacare", "password": "Demo2026"},
    timeout=10,
).json().get("token")

assert ADMIN_TOK,   "could not fetch admin JWT"
assert PATIENT_TOK, "could not fetch patient JWT"


FAILED = []
def check(label, cond, note=""):
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}]  {label}  {note}")
    if not cond:
        FAILED.append(label)


def put_supply(body_role, jwt=None):
    h = {"Content-Type": "application/json"}
    if jwt:
        h["Authorization"] = f"Bearer {jwt}"
    r = requests.put(
        f"{API}/api/v1/care/supply/role_escalation_sess",
        headers=h,
        json={"medication_name": "sanity", "tablets_remaining": 1, "role": body_role},
        timeout=10,
    )
    return r


def put_carepath(body_role, jwt=None):
    h = {"Content-Type": "application/json"}
    if jwt:
        h["Authorization"] = f"Bearer {jwt}"
    r = requests.put(
        f"{API}/api/v1/care/dualpath/role_escalation_sess/traditional",
        headers=h,
        json={"practitioner": "x", "practices": ["y"], "role": body_role},
        timeout=10,
    )
    return r


print("=" * 64)
print("  /care/supply — impersonation matrix")
print("  SUPPLY_WRITE_ROLES = {clinician, admin}  (vhw removed)")
print("=" * 64)
# Admin JWT + impersonate=clinician: allowed
check("admin JWT + body=clinician → 200",
      put_supply("clinician", ADMIN_TOK).status_code == 200)
# Admin JWT + impersonate=vhw: BLOCKED (vhw is NOT in SUPPLY_WRITE_ROLES anymore)
check("admin JWT + body=vhw → 403 (vhw removed from supply write set)",
      put_supply("vhw", ADMIN_TOK).status_code == 403)
# Admin JWT + impersonate=patient: BLOCKED (patient can't write supply)
check("admin JWT + body=patient → 403 (impersonation honored, patient denied)",
      put_supply("patient", ADMIN_TOK).status_code == 403)
# Admin JWT + no body role: bypass (effective='admin', admin is in set)
check("admin JWT + body role blank → 200 (admin bypass)",
      put_supply("", ADMIN_TOK).status_code == 200)

# Patient JWT + body=admin: escalation BLOCKED (body ignored, effective=patient)
check("patient JWT + body=admin → 403 (escalation blocked)",
      put_supply("admin", PATIENT_TOK).status_code == 403)
# Patient JWT + body=clinician: escalation BLOCKED
check("patient JWT + body=clinician → 403 (escalation blocked)",
      put_supply("clinician", PATIENT_TOK).status_code == 403)

# No JWT + body=clinician: legacy path, allowed
check("no JWT + body=clinician → 200 (legacy demo path)",
      put_supply("clinician").status_code == 200)
# No JWT + body=admin: legacy path, allowed (admin is in the set)
check("no JWT + body=admin → 200 (legacy path)",
      put_supply("admin").status_code == 200)
# No JWT + body=patient: legacy path, denied
check("no JWT + body=patient → 403",
      put_supply("patient").status_code == 403)
# No JWT + body=vhw: legacy path, denied (vhw is no longer a supply writer)
check("no JWT + body=vhw → 403 (vhw removed from supply set)",
      put_supply("vhw").status_code == 403)


print()
print("=" * 64)
print("  /care/dualpath/traditional — impersonation matrix")
print("  CAREPATH_WRITE_ROLES = {vhw, admin}  (clinician removed)")
print("=" * 64)
# Admin JWT + impersonate=vhw: allowed (vhw now owns care-path)
check("admin JWT + body=vhw → 200 (vhw added to care-path set)",
      put_carepath("vhw", ADMIN_TOK).status_code == 200)
# Admin JWT + impersonate=clinician: BLOCKED (clinician no longer in set)
check("admin JWT + body=clinician → 403 (clinician removed from care-path set)",
      put_carepath("clinician", ADMIN_TOK).status_code == 403)
# Admin JWT + blank body: bypass (effective='admin')
check("admin JWT + blank body → 200 (admin bypass)",
      put_carepath("", ADMIN_TOK).status_code == 200)

# Patient escalation blocked
check("patient JWT + body=admin → 403 (escalation blocked)",
      put_carepath("admin", PATIENT_TOK).status_code == 403)
check("patient JWT + body=vhw → 403 (escalation blocked)",
      put_carepath("vhw", PATIENT_TOK).status_code == 403)

# Legacy no-JWT paths — inverted to match the new gate split
check("no JWT + body=vhw → 200 (legacy, vhw owns care-path)",
      put_carepath("vhw").status_code == 200)
check("no JWT + body=clinician → 403 (clinician can't write care-path)",
      put_carepath("clinician").status_code == 403)


print()
print("=" * 64)
print("  SUMMARY")
print("=" * 64)
if FAILED:
    print(f"  FAILED ({len(FAILED)}):")
    for f in FAILED:
        print(f"    - {f}")
    sys.exit(1)
print("  ALL PASS")
