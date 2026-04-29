#!/usr/bin/env python3
"""
Dual-Path Ledger — CRUD + 10-cap + role-gate matrix across 4 types.
====================================================================
Verifies /api/v1/care/dualpath_ledger/* for the 4 sections:
traditional / modern / interaction / progress.

Each type:
  - POST add succeeds under clinician / admin JWTs and returns the
    envelope.
  - Over-cap returns 409 LIMIT_REACHED.
  - PATCH updates by index.
  - DELETE removes by index.
  - Patient JWT cannot add/patch/delete (403).

Run:  python _dualpath_ledger_test.py
"""
from __future__ import annotations
import sys
import time
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


API = "http://localhost:8000"
ADMIN_PT = ("admin@demo.aminacare", "Amina2026")

FAIL = []
def check(label, cond, note=""):
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}]  {label}  {note}")
    if not cond:
        FAIL.append(label)


def login(email, pw):
    r = requests.post(f"{API}/api/v1/auth/login/email",
                      json={"email": email, "password": pw},
                      timeout=15)
    return (r.json() or {}).get("token") or ""


admin_tok = login(*ADMIN_PT)
# Patient token for the escalation matrix; use the same seeded account
# the supply-ledger test created.
patient_tok = login("patient-ledger-test@demo.aminacare", "PatientLedger2026")

check("admin-patient login",  bool(admin_tok))
check("patient login",        bool(patient_tok))

sid = f"s_dualpath_{int(time.time())}"
print(f"\n  session = {sid}\n")

admin_h   = {"Authorization": f"Bearer {admin_tok}",   "Content-Type": "application/json"}
patient_h = {"Authorization": f"Bearer {patient_tok}", "Content-Type": "application/json"}


TYPE_PAYLOADS = {
    "traditional": lambda i: {
        "practitioner":        f"marabout-{i}",
        "practices":           ["prayers", "herbal tea"],
        "last_visit_days_ago": 2 + i,
        "notes":               "test",
        "role":                "vhw",
    },
    "modern":      lambda i: {
        "facility":            f"facility-{i}",
        "chw_name":            f"chw-{i}",
        "medications":         ["amlodipine 5mg"],
        "last_visit_days_ago": 3 + i,
        "notes":               "test",
        "role":                "vhw",
    },
    "interaction": lambda i: {
        "safe":  bool(i % 2 == 0),
        "notes": f"interaction-check-{i}",
        "role":  "vhw",
    },
    "progress":    lambda i: {
        "bp_current":     f"13{i}/8{i}",
        "months_on_plan": i + 1,
        "notes":          f"progress-{i}",
        "role":           "vhw",
    },
}


# ── 1. Root GET returns all 4 type envelopes + cap_per_type ──────────
r = requests.get(f"{API}/api/v1/care/dualpath_ledger/{sid}", timeout=10).json()
check("root GET returns 4 type envelopes",
      all(k in r for k in ("traditional", "modern", "interaction", "progress")))
check("cap_per_type = 10", r.get("cap_per_type") == 10)


# ── 2. CRUD per type ─────────────────────────────────────────────────
for type_ in ("traditional", "modern", "interaction", "progress"):
    print(f"\n  --- type={type_} ---")

    # Add 3
    for i in range(3):
        r = requests.post(
            f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}/add",
            headers=admin_h,
            json=TYPE_PAYLOADS[type_](i),
            timeout=10,
        )
        check(f"{type_}: POST add #{i} -> 200",
              r.status_code == 200, f"http={r.status_code}")

    env = requests.get(
        f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}", timeout=10,
    ).json()
    check(f"{type_}: count == 3", env["count"] == 3, f"count={env['count']}")
    check(f"{type_}: cap_remaining == 7", env["cap_remaining"] == 7)

    # PATCH index 1
    r = requests.patch(
        f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}/1",
        headers=admin_h,
        json={"notes": f"patched-{type_}", "role": "vhw"},
        timeout=10,
    )
    check(f"{type_}: PATCH idx=1 -> 200", r.status_code == 200)
    check(f"{type_}: patched notes applied",
          r.json()["entries"][1]["notes"] == f"patched-{type_}")

    # Fill to cap
    env = requests.get(
        f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}", timeout=10,
    ).json()
    while env["count"] < env["cap"]:
        r = requests.post(
            f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}/add",
            headers=admin_h, json=TYPE_PAYLOADS[type_](env["count"]), timeout=10,
        )
        if r.status_code != 200:
            break
        env = r.json()
    check(f"{type_}: filled to cap", env["count"] == env["cap"])

    # Over-cap → 409
    r = requests.post(
        f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}/add",
        headers=admin_h, json=TYPE_PAYLOADS[type_](99), timeout=10,
    )
    check(f"{type_}: over-cap -> 409 LIMIT_REACHED",
          r.status_code == 409, f"http={r.status_code}")
    check(f"{type_}: 409 body has code LIMIT_REACHED",
          (r.json().get("detail") or {}).get("code") == "LIMIT_REACHED")

    # DELETE
    r = requests.delete(
        f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}/0?role=vhw",
        headers=admin_h, timeout=10,
    )
    check(f"{type_}: DELETE idx=0 -> 200", r.status_code == 200)
    check(f"{type_}: count drops to 9 after delete",
          r.json()["count"] == 9)

    # PATCH out-of-range
    r = requests.patch(
        f"{API}/api/v1/care/dualpath_ledger/{sid}/{type_}/999",
        headers=admin_h, json={"role": "vhw"}, timeout=10,
    )
    check(f"{type_}: PATCH 999 -> 404", r.status_code == 404)


# ── 3. Role-escalation matrix (patient can't mutate) ─────────────────
print("\n  --- role-escalation matrix ---")
r = requests.post(
    f"{API}/api/v1/care/dualpath_ledger/{sid}/traditional/add",
    headers=patient_h,
    json=TYPE_PAYLOADS["traditional"](0),
    timeout=10,
)
check("patient JWT + body role=vhw -> 403",
      r.status_code == 403, f"http={r.status_code}")

r = requests.patch(
    f"{API}/api/v1/care/dualpath_ledger/{sid}/modern/0",
    headers=patient_h, json={"role": "vhw"}, timeout=10,
)
check("patient PATCH -> 403", r.status_code == 403)

r = requests.delete(
    f"{API}/api/v1/care/dualpath_ledger/{sid}/modern/0?role=vhw",
    headers=patient_h, timeout=10,
)
check("patient DELETE -> 403", r.status_code == 403)

# Public read still works
r = requests.get(f"{API}/api/v1/care/dualpath_ledger/{sid}",
                 headers=patient_h, timeout=10)
check("patient GET root -> 200 (read is public)", r.status_code == 200)


# ── 4. Unknown type -> 404 UNKNOWN_TYPE ──────────────────────────────
r = requests.post(
    f"{API}/api/v1/care/dualpath_ledger/{sid}/bogus/add",
    headers=admin_h,
    json={"practitioner": "x", "role": "vhw"},
    timeout=10,
)
check("unknown type -> 404 UNKNOWN_TYPE", r.status_code == 404,
      f"http={r.status_code}")


print()
print("=" * 70)
print("  SUMMARY")
print("=" * 70)
if FAIL:
    print(f"  FAILED ({len(FAIL)}):")
    for f in FAIL:
        print(f"    - {f}")
    sys.exit(1)
print("  ALL PASS — dual-path ledger CRUD + 10-cap + role gate are wired.")
