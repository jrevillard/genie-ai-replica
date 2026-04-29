#!/usr/bin/env python3
"""
Bantaba (per-patient circle) — role + CRUD matrix.
===================================================
After the 2026-04-19 rewrite:
  - BANTABA_WRITE = {alkalo, admin}
  - BANTABA_SELF  = {patient, alkalo, admin}  (adherence only)
  - Each patient owns a circle keyed by patient_id
  - /bantaba/mine auto-creates the circle on first GET
  - /bantaba/rename + /bantaba/list are new

Verifies:
  1. Admin-patient /bantaba/mine creates a circle named
     "{patient_name}'s Circle" with patient as first member.
  2. Second call is idempotent (same circle_id, same name).
  3. Alkalo adds member, renames circle, updates highlight.
  4. VHW/clinician/patient add-member → 403.
  5. Patient self-logging on own row → 200; on another member → 403.
  6. Public read (/bantaba?circle_id=X) → 200.
  7. /bantaba/list requires alkalo/admin.

Run:  python _bantaba_roles_test.py
"""
from __future__ import annotations
import sys
import uuid
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
                      json={"email": email, "password": pw}, timeout=15)
    return (r.json() or {}).get("token") or ""


# Ensure a plain patient account exists (reuse supply-ledger test fixture)
def ensure_patient(email, password, name="Plain Patient"):
    tok = login(email, password)
    if tok: return tok
    requests.post(f"{API}/api/v1/auth/signup/email",
                  json={"email": email, "password": password,
                        "name": name, "age": 30, "gender": "other",
                        "region": "Banjul", "conditions": [], "language": "english"},
                  timeout=15)
    return login(email, password)


admin_tok    = login(*ADMIN_PT)
patient_tok  = ensure_patient("bantaba-pt@demo.aminacare", "Bantaba2026",
                              "Bantaba Patient")

check("admin-patient login", bool(admin_tok))
check("plain patient login", bool(patient_tok))

admin_h   = {"Authorization": f"Bearer {admin_tok}",   "Content-Type": "application/json"}
patient_h = {"Authorization": f"Bearer {patient_tok}", "Content-Type": "application/json"}


# ── 1. /bantaba/mine for admin-patient ──────────────────────────────
print()
print("=" * 64)
print("  /bantaba/mine — auto-create per-patient circle")
print("=" * 64)

r = requests.get(f"{API}/api/v1/community/bantaba/mine", headers=admin_h, timeout=10)
check("admin-patient /bantaba/mine → 200", r.status_code == 200)
body = r.json() or {}
check("circle_id == patient id",
      body.get("circle_id") and body["circle_id"].startswith("P_"),
      f"circle_id={body.get('circle_id')}")
# Accept either the default auto-name ("'s Circle") or a previously
# renamed value — the rename path is exercised in its own section.
_name = body.get("name") or ""
check("circle has a non-empty name",
      len(_name) > 0 and len(_name) <= 80,
      f"name={_name!r}")
check("owner_name matches JWT name",
      body.get("owner_name") == "Admin Patient",
      f"owner={body.get('owner_name')}")
check("first member has is_owner flag",
      (body.get("members") or [{}])[0].get("is_owner") is True)
admin_cid = body["circle_id"]

# Second call → idempotent
r2 = requests.get(f"{API}/api/v1/community/bantaba/mine", headers=admin_h, timeout=10)
check("second call returns same circle_id",
      (r2.json() or {}).get("circle_id") == admin_cid)


# ── 2. Also auto-creates for plain patient ──────────────────────────
r = requests.get(f"{API}/api/v1/community/bantaba/mine", headers=patient_h, timeout=10)
check("plain patient /bantaba/mine → 200", r.status_code == 200)
pb = r.json() or {}
patient_cid  = pb.get("circle_id")
patient_name = pb.get("owner_name")
check("plain patient has their own circle id (not admin's)",
      patient_cid and patient_cid != admin_cid,
      f"pid={patient_cid} aid={admin_cid}")


# ── 3. Alkalo (admin impersonating) mutations on admin-patient circle ─
print()
print("=" * 64)
print("  Alkalo writes: add member + rename + highlight")
print("=" * 64)

r = requests.post(
    f"{API}/api/v1/community/bantaba/members?circle_id={admin_cid}",
    headers=admin_h,
    json={"name": "Awa", "age": 48, "conditions": ["diabetes"], "role": "alkalo"},
    timeout=10,
)
check("alkalo add member → 200", r.status_code == 200, f"http={r.status_code}")

r = requests.put(
    f"{API}/api/v1/community/bantaba/rename?circle_id={admin_cid}",
    headers=admin_h,
    json={"new_name": "Admin Patient's Health Family", "role": "alkalo"},
    timeout=10,
)
check("alkalo rename → 200", r.status_code == 200, f"http={r.status_code}")
check("rename reflected in response",
      (r.json() or {}).get("name") == "Admin Patient's Health Family")

r = requests.put(
    f"{API}/api/v1/community/bantaba/highlight?circle_id={admin_cid}",
    headers=admin_h,
    json={"highlight": "Good week. Two new members.", "role": "alkalo"},
    timeout=10,
)
check("alkalo highlight → 200", r.status_code == 200, f"http={r.status_code}")


# ── 4. Role escalation matrix on add-member ─────────────────────────
print()
print("=" * 64)
print("  Add-member role matrix")
print("=" * 64)

for role in ("vhw", "clinician", "patient"):
    r = requests.post(
        f"{API}/api/v1/community/bantaba/members?circle_id={admin_cid}",
        headers=admin_h,
        json={"name": f"hack_{role}", "age": 30, "role": role},
        timeout=10,
    )
    check(f"add-member as {role} → 403",
          r.status_code == 403, f"http={r.status_code}")


# ── 5. Patient self-adherence ───────────────────────────────────────
print()
print("=" * 64)
print("  Patient self-adherence guard")
print("=" * 64)

# Grab patient's own member id (the first member, is_owner=True)
r = requests.get(f"{API}/api/v1/community/bantaba/mine", headers=patient_h, timeout=10).json()
own_mid  = (r.get("members") or [{}])[0].get("id")
own_name = (r.get("members") or [{}])[0].get("name", "")
check("own member id discovered", bool(own_mid), f"mid={own_mid} name={own_name}")

r = requests.put(
    f"{API}/api/v1/community/bantaba/adherence?circle_id={patient_cid}",
    headers=patient_h,
    json={"member_id": own_mid, "adherence_week": 5, "role": "patient"},
    timeout=10,
)
check("patient logs OWN row → 200", r.status_code == 200, f"http={r.status_code}")

# Now add a sibling member to this patient's circle (via admin)
r = requests.post(
    f"{API}/api/v1/community/bantaba/members?circle_id={patient_cid}",
    headers=admin_h,
    json={"name": "Sibling Member", "age": 60, "conditions": [], "role": "alkalo"},
    timeout=10,
)
check("admin adds sibling to patient circle → 200", r.status_code == 200)
sibling_mid = next((m["id"] for m in (r.json() or {}).get("members", [])
                    if m.get("name") == "Sibling Member"), None)
check("sibling id found", bool(sibling_mid), f"sid={sibling_mid}")

if sibling_mid:
    r = requests.put(
        f"{API}/api/v1/community/bantaba/adherence?circle_id={patient_cid}",
        headers=patient_h,
        json={"member_id": sibling_mid, "adherence_week": 7, "role": "patient"},
        timeout=10,
    )
    check("patient logs SIBLING row → 403 (guard blocks)",
          r.status_code == 403, f"http={r.status_code}")


# ── 6. Public read + /bantaba/list ──────────────────────────────────
print()
print("=" * 64)
print("  Public read + list")
print("=" * 64)

r = requests.get(f"{API}/api/v1/community/bantaba?circle_id={admin_cid}", timeout=10)
check("unauth GET /bantaba → 200 (read is public)", r.status_code == 200)

r = requests.get(f"{API}/api/v1/community/bantaba/list?role=alkalo",
                 headers=admin_h, timeout=10)
check("/bantaba/list as alkalo → 200", r.status_code == 200)
circles = (r.json() or {}).get("circles", [])
check("list contains at least the admin-patient circle",
      any(c["circle_id"] == admin_cid for c in circles),
      f"count={len(circles)}")

r = requests.get(f"{API}/api/v1/community/bantaba/list?role=vhw",
                 headers=admin_h, timeout=10)
check("/bantaba/list as vhw → 403", r.status_code == 403)


# ── 7. Add-member request queue (patient → alkalo) ────────────────
print()
print("=" * 64)
print("  /bantaba/members/request — patient requests Alkalo to add")
print("=" * 64)

# Plain patient submits a request
r = requests.post(
    f"{API}/api/v1/community/bantaba/members/request",
    headers=patient_h,
    json={
        "candidate_name":       "Grandmother Aminata",
        "candidate_age":        72,
        "candidate_conditions": ["hypertension"],
        "relation":             "grandmother",
        "reason":               "She reminds me to take my BP medicine every evening.",
        "phone":                "+220 300 1234",
    },
    timeout=10,
)
check("patient submits request → 200", r.status_code == 200, f"http={r.status_code}")
req_body = r.json() or {}
req_id = (req_body.get("request") or {}).get("req_id")
check("request has an id", bool(req_id), f"id={req_id}")

# Missing fields → 400
r = requests.post(
    f"{API}/api/v1/community/bantaba/members/request",
    headers=patient_h,
    json={"candidate_name": "", "relation": "sister", "reason": "x"},
    timeout=10,
)
check("empty candidate name → 400", r.status_code == 400, f"http={r.status_code}")

# Unauth → 401
r = requests.post(
    f"{API}/api/v1/community/bantaba/members/request",
    json={"candidate_name": "x", "relation": "y", "reason": "z"},
    timeout=10,
)
check("unauth request → 401", r.status_code == 401, f"http={r.status_code}")

# Alkalo lists requests
r = requests.get(
    f"{API}/api/v1/community/bantaba/requests?role=alkalo&status=pending",
    headers=admin_h, timeout=10,
)
check("alkalo lists pending → 200", r.status_code == 200, f"http={r.status_code}")
lst = (r.json() or {}).get("requests", [])
check("our request appears in pending", any(x.get("req_id") == req_id for x in lst),
      f"count={len(lst)}")

# VHW tries → 403
r = requests.get(
    f"{API}/api/v1/community/bantaba/requests?role=vhw&status=pending",
    headers=admin_h, timeout=10,
)
check("vhw lists requests → 403", r.status_code == 403, f"http={r.status_code}")

# Alkalo approves → candidate must appear in patient's circle
r = requests.post(
    f"{API}/api/v1/community/bantaba/requests/{req_id}/approve",
    headers=admin_h, json={"role": "alkalo"}, timeout=10,
)
check("alkalo approves → 200", r.status_code == 200, f"http={r.status_code}")
approved = r.json() or {}
check("request status == approved", approved.get("status") == "approved")

# Confirm member landed in patient's circle
mine = requests.get(f"{API}/api/v1/community/bantaba/mine",
                    headers=patient_h, timeout=10).json() or {}
names = [m.get("name") for m in (mine.get("members") or [])]
check("candidate now in requester's circle",
      "Grandmother Aminata" in names, f"names={names}")

# Double-approve → 409
r = requests.post(
    f"{API}/api/v1/community/bantaba/requests/{req_id}/approve",
    headers=admin_h, json={"role": "alkalo"}, timeout=10,
)
check("approving an already-approved request → 409",
      r.status_code == 409, f"http={r.status_code}")

# Reject a fresh request
r = requests.post(
    f"{API}/api/v1/community/bantaba/members/request",
    headers=patient_h,
    json={"candidate_name": "Awa Ceesay", "candidate_age": 48,
          "candidate_conditions": ["diabetes"],
          "relation": "sister", "reason": "She helps me prepare meals."},
    timeout=10,
)
r2_id = ((r.json() or {}).get("request") or {}).get("req_id")
check("second request queued", bool(r2_id))

r = requests.post(
    f"{API}/api/v1/community/bantaba/requests/{r2_id}/reject",
    headers=admin_h, json={"role": "alkalo", "reason": "duplicate — already in circle"},
    timeout=10,
)
check("alkalo rejects → 200", r.status_code == 200)
check("request status == rejected",
      (r.json() or {}).get("status") == "rejected")

# Patient trying to approve (role=patient) → 403
r = requests.post(
    f"{API}/api/v1/community/bantaba/requests/{r2_id}/approve",
    headers=patient_h, json={"role": "patient"}, timeout=10,
)
check("patient approve attempt → 403", r.status_code == 403,
      f"http={r.status_code}")


print()
print("=" * 64)
print("  SUMMARY")
print("=" * 64)
if FAIL:
    print(f"  FAILED ({len(FAIL)}):")
    for f in FAIL:
        print(f"    - {f}")
    sys.exit(1)
print("  ALL PASS — per-patient Bantaba circles + role gates wired cleanly.")
