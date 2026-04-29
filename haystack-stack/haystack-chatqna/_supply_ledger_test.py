#!/usr/bin/env python3
"""
Supply Ledger — end-to-end CRUD + cap + role-gate matrix.
=========================================================
Verifies the new /api/v1/care/supply_ledger/* endpoints:

  - Public GET returns envelope {medications, count, cap,
    cap_remaining, limit_reached}.
  - Admin-patient JWT can POST new entries, the count grows, cap
    remaining decreases, duplicate names auto-suffix.
  - Filling beyond cap returns 409 LIMIT_REACHED (not silent append).
  - PATCH updates a specific index without reordering siblings.
  - DELETE removes by index and re-derives envelope.
  - Patient JWT cannot add/patch/delete (403).
  - Old medications survive adds (the existing Amlodipine row is
    preserved — the ledger appends, it does not overwrite).

Run:  python _supply_ledger_test.py
"""
from __future__ import annotations
import sys
import time
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


API      = "http://localhost:8000"
ADMIN_PT = ("admin@demo.aminacare", "Amina2026")

FAIL = []
def check(label, cond, note=""):
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}]  {label}  {note}")
    if not cond:
        FAIL.append(label)


def login(email, password):
    r = requests.post(f"{API}/api/v1/auth/login/email",
                      json={"email": email, "password": password},
                      timeout=15)
    return (r.json() or {}).get("token") or ""


# Ensure we have a patient login (seed one if missing)
def ensure_patient_login():
    tok = login("patient-ledger-test@demo.aminacare", "PatientLedger2026")
    if tok:
        return tok
    requests.post(
        f"{API}/api/v1/auth/signup/email",
        json={
            "email":    "patient-ledger-test@demo.aminacare",
            "password": "PatientLedger2026",
            "name":     "Patient Ledger Test",
            "age":      30, "gender": "other", "region": "Banjul",
            "conditions": [], "language": "english",
        },
        timeout=15,
    )
    return login("patient-ledger-test@demo.aminacare", "PatientLedger2026")


admin_tok   = login(*ADMIN_PT)
patient_tok = ensure_patient_login()

check("admin-patient login", bool(admin_tok))
check("patient login",       bool(patient_tok))

sid = f"s_ledger_{int(time.time())}"
print(f"\n  session = {sid}\n")

admin_h   = {"Authorization": f"Bearer {admin_tok}",   "Content-Type": "application/json"}
patient_h = {"Authorization": f"Bearer {patient_tok}", "Content-Type": "application/json"}

# 1. Initial GET — unauthenticated is fine; backend auto-seeds Amlodipine.
r = requests.get(f"{API}/api/v1/care/supply_ledger/{sid}", timeout=10)
env = r.json()
check("GET envelope shape",
      all(k in env for k in ("medications","count","cap","cap_remaining","limit_reached")),
      f"keys={list(env.keys())}")
check("default cap is 10", env["cap"] == 10, f"cap={env['cap']}")
check("auto-seed produced at least 1 row",
      env["count"] >= 1, f"count={env['count']}")
seed_name = env["medications"][0]["name"]
check("seed medication is Amlodipine (pre-existing row preserved)",
      seed_name == "Amlodipine", f"first={seed_name!r}")

# 2. POST add 3 new rows as admin-patient impersonating clinician.
for i in range(3):
    r = requests.post(
        f"{API}/api/v1/care/supply_ledger/{sid}/add",
        headers=admin_h,
        json={
            "medication_name":  f"ledger-med-{i}",
            "tablets_remaining": 20 + i,
            "tablets_per_day":  1,
            "cost_per_pack":    f"{10+i} dalasi",
            "refill_location":  "Ledger clinic",
            "in_stock":         (i != 1),   # row 1 out-of-stock for pill test
            "role":             "clinician",
        },
        timeout=10,
    )
    check(f"POST add row #{i} → 200", r.status_code == 200, f"http={r.status_code}")

env = requests.get(f"{API}/api/v1/care/supply_ledger/{sid}", timeout=10).json()
check("count after 3 adds", env["count"] == 4, f"count={env['count']}")
check("cap_remaining updates", env["cap_remaining"] == 6, f"rem={env['cap_remaining']}")
check("seed row still present",
      any(m["name"] == "Amlodipine" for m in env["medications"]))
check("added names are present",
      all(any(m["name"] == f"ledger-med-{i}" for m in env["medications"]) for i in range(3)))

# 3. Duplicate-name auto-suffix.
r = requests.post(
    f"{API}/api/v1/care/supply_ledger/{sid}/add",
    headers=admin_h,
    json={"medication_name": "ledger-med-0", "tablets_remaining": 5, "role": "clinician"},
    timeout=10,
)
check("duplicate name is still accepted (auto-suffix)", r.status_code == 200)
added = r.json().get("added_name")
check("duplicate gets ' (2)' suffix",
      added == "ledger-med-0 (2)", f"got={added!r}")

# 4. Fill to the cap → next add returns 409 LIMIT_REACHED.
while True:
    env = requests.get(f"{API}/api/v1/care/supply_ledger/{sid}", timeout=10).json()
    if env["count"] >= env["cap"]:
        break
    r = requests.post(
        f"{API}/api/v1/care/supply_ledger/{sid}/add",
        headers=admin_h,
        json={"medication_name": f"fill-{env['count']}", "role": "clinician"},
        timeout=10,
    )
    if r.status_code != 200:
        break

env = requests.get(f"{API}/api/v1/care/supply_ledger/{sid}", timeout=10).json()
check("filled to cap", env["count"] == env["cap"], f"count={env['count']}")
check("limit_reached flag set", env["limit_reached"] is True)

r = requests.post(
    f"{API}/api/v1/care/supply_ledger/{sid}/add",
    headers=admin_h,
    json={"medication_name": "overflow", "role": "clinician"},
    timeout=10,
)
check("over-cap add → 409 LIMIT_REACHED",
      r.status_code == 409, f"http={r.status_code}")
body = r.json()
check("409 body carries code=LIMIT_REACHED",
      (body.get("detail") or {}).get("code") == "LIMIT_REACHED",
      f"body={body}")

# 5. PATCH a specific row by index.
target_idx = 1
r = requests.patch(
    f"{API}/api/v1/care/supply_ledger/{sid}/medications/{target_idx}",
    headers=admin_h,
    json={"tablets_remaining": 77, "cost_per_pack": "patched cost",
          "role": "clinician"},
    timeout=10,
)
check("PATCH by index → 200", r.status_code == 200)
env = r.json()
patched = env["medications"][target_idx]
check("patched row has new tablets_remaining",
      patched["tablets_remaining"] == 77, f"val={patched['tablets_remaining']}")
check("patched row has new cost",
      patched["cost_per_pack"] == "patched cost")
check("siblings unchanged",
      env["medications"][0]["name"] == seed_name)

# 6. PATCH out-of-range index → 404
r = requests.patch(
    f"{API}/api/v1/care/supply_ledger/{sid}/medications/999",
    headers=admin_h, json={"role": "clinician"}, timeout=10,
)
check("PATCH out-of-range → 404", r.status_code == 404)

# 7. DELETE a row — count drops, cap re-opens.
before = env["count"]
r = requests.delete(
    f"{API}/api/v1/care/supply_ledger/{sid}/medications/{target_idx}?role=clinician",
    headers=admin_h, timeout=10,
)
check("DELETE by index → 200", r.status_code == 200)
env = r.json()
check("count drops by 1", env["count"] == before - 1)
check("limit_reached cleared", env["limit_reached"] is False)
check("cap_remaining > 0 after delete", env["cap_remaining"] >= 1)

# 8. Role gate — patient cannot add / patch / delete.
r = requests.post(
    f"{API}/api/v1/care/supply_ledger/{sid}/add",
    headers=patient_h,
    json={"medication_name": "hack-attempt", "role": "clinician"},
    timeout=10,
)
check("patient JWT + body role=clinician → 403 (escalation blocked)",
      r.status_code == 403, f"http={r.status_code}")

r = requests.patch(
    f"{API}/api/v1/care/supply_ledger/{sid}/medications/0",
    headers=patient_h, json={"tablets_remaining": 1, "role": "clinician"},
    timeout=10,
)
check("patient PATCH → 403", r.status_code == 403)

r = requests.delete(
    f"{API}/api/v1/care/supply_ledger/{sid}/medications/0?role=clinician",
    headers=patient_h, timeout=10,
)
check("patient DELETE → 403", r.status_code == 403)

# 9. Public GET still works for patient (read is intentionally public).
r = requests.get(f"{API}/api/v1/care/supply_ledger/{sid}",
                 headers=patient_h, timeout=10)
check("patient GET ledger → 200 (read is public)", r.status_code == 200)


print()
print("=" * 70)
print("  SUMMARY")
print("=" * 70)
if FAIL:
    print(f"  FAILED ({len(FAIL)}):")
    for f in FAIL:
        print(f"    - {f}")
    sys.exit(1)
print("  ALL PASS — supply ledger CRUD + 10-cap + role gate are wired.")
