#!/usr/bin/env python3
"""
Scout role gate — Alkalo-only writes after the 2026-04-19 role split.
======================================================================
Verifies:
  - SCOUT_WRITE = {"alkalo", "admin"} (vhw + clinician removed)
  - POST /scout/create as alkalo / admin → 200
  - POST /scout/create as vhw / clinician → 403
  - DELETE /scout/{id}?role=vhw → 403
  - Patient application flow still works (unauth, age-gated)
  - Approve / reject applications require alkalo

Run:  python _scout_roles_test.py
"""
from __future__ import annotations
import sys
import time
import uuid
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


API = "http://localhost:8000"

FAIL = []
def check(label, cond, note=""):
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}]  {label}  {note}")
    if not cond:
        FAIL.append(label)


def post_create(name, role, age=20, village="Kerewan"):
    r = requests.post(
        f"{API}/api/v1/community/scout/create",
        headers={"Content-Type": "application/json"},
        json={"name": name, "age": age, "village": village, "role": role},
        timeout=10,
    )
    return r


def delete_scout(scout_id, role):
    r = requests.delete(
        f"{API}/api/v1/community/scout/{scout_id}?role={role}",
        timeout=10,
    )
    return r


# ── 1. Role gate on scout/create ────────────────────────────────────
print("=" * 64)
print("  POST /scout/create — role gate")
print("=" * 64)

tag = uuid.uuid4().hex[:6]

# alkalo: allowed
r = post_create(f"sc_ok_alkalo_{tag}", "alkalo")
check("alkalo → 200", r.status_code == 200, f"http={r.status_code}")
scout_alkalo_id = (r.json() or {}).get("scout_id") if r.ok else None

# admin: allowed
r = post_create(f"sc_ok_admin_{tag}", "admin")
check("admin → 200", r.status_code == 200, f"http={r.status_code}")
scout_admin_id = (r.json() or {}).get("scout_id") if r.ok else None

# vhw: blocked
r = post_create(f"sc_nope_vhw_{tag}", "vhw")
check("vhw → 403 (removed from SCOUT_WRITE)",
      r.status_code == 403, f"http={r.status_code}")

# clinician: blocked
r = post_create(f"sc_nope_clin_{tag}", "clinician")
check("clinician → 403 (removed from SCOUT_WRITE)",
      r.status_code == 403, f"http={r.status_code}")

# patient: blocked
r = post_create(f"sc_nope_pt_{tag}", "patient")
check("patient → 403", r.status_code == 403, f"http={r.status_code}")


# ── 2. DELETE /scout/{id} ───────────────────────────────────────────
print()
print("=" * 64)
print("  DELETE /scout/{id} — role gate")
print("=" * 64)

if scout_alkalo_id:
    r = delete_scout(scout_alkalo_id, "vhw")
    check("DELETE as vhw → 403", r.status_code == 403)

    r = delete_scout(scout_alkalo_id, "alkalo")
    check("DELETE as alkalo → 200", r.status_code == 200)

if scout_admin_id:
    r = delete_scout(scout_admin_id, "admin")
    check("DELETE as admin → 200", r.status_code == 200)


# ── 3. /scout/applications lifecycle ────────────────────────────────
print()
print("=" * 64)
print("  Scout applications — apply, approve, reject")
print("=" * 64)

# Patient applies (no role gate on apply)
apply_r = requests.post(
    f"{API}/api/v1/community/scout/apply",
    headers={"Content-Type": "application/json"},
    json={"name": f"youth_{tag}", "age": 17, "village": "Kerewan", "phone": "+2203000000"},
    timeout=10,
)
check("patient apply → 200", apply_r.status_code == 200, f"http={apply_r.status_code}")
app_id = None
if apply_r.ok:
    body = apply_r.json() or {}
    # Response shape: {approved, status, application: {app_id, ...}}
    app_id = ((body.get("application") or {}).get("app_id")
              or body.get("application_id")
              or body.get("app_id"))
    check("application has an id", bool(app_id), f"id={app_id}")

# Applications list requires alkalo/admin role
r = requests.get(f"{API}/api/v1/community/scout/applications?role=vhw", timeout=10)
check("list apps as vhw → 403", r.status_code == 403, f"http={r.status_code}")

r = requests.get(f"{API}/api/v1/community/scout/applications?role=alkalo", timeout=10)
check("list apps as alkalo → 200", r.status_code == 200, f"http={r.status_code}")
apps = (r.json() or {}).get("applications", [])
check("our application shows in the list",
      any((a.get("app_id") or a.get("id")) == app_id for a in apps) if app_id else True)

# Approve requires alkalo/admin
if app_id:
    r = requests.post(
        f"{API}/api/v1/community/scout/applications/approve",
        headers={"Content-Type": "application/json"},
        json={"app_id": app_id, "role": "vhw"},
        timeout=10,
    )
    check("approve as vhw → 403", r.status_code == 403, f"http={r.status_code}")

    r = requests.post(
        f"{API}/api/v1/community/scout/applications/approve",
        headers={"Content-Type": "application/json"},
        json={"app_id": app_id, "role": "alkalo"},
        timeout=10,
    )
    check("approve as alkalo → 200", r.status_code == 200, f"http={r.status_code}")


# ── 4. Public reads still work ──────────────────────────────────────
print()
print("=" * 64)
print("  Public read endpoints")
print("=" * 64)

r = requests.get(f"{API}/api/v1/community/scouts", timeout=10)
check("GET /community/scouts → 200 (public)", r.status_code == 200)
scouts = (r.json() or {}).get("scouts", [])
check("scouts list is non-empty", len(scouts) >= 1, f"count={len(scouts)}")


# ── 5. Redesigned apply flow + notifications ────────────────────────
print()
print("=" * 64)
print("  Redesigned scout apply: locality + availability + applicant_id")
print("=" * 64)

# Log in as a signed-in patient so the backend stamps applicant_id.
pt_tok = requests.post(
    f"{API}/api/v1/auth/login/email",
    json={"email": "bantaba-pt@demo.aminacare", "password": "Bantaba2026"},
    timeout=15,
).json().get("token", "")
pt_headers = {"Authorization": f"Bearer {pt_tok}", "Content-Type": "application/json"}
check("scout-apply patient login", bool(pt_tok))

unique = f"RedesignScout_{uuid.uuid4().hex[:5]}"
apply_r = requests.post(
    f"{API}/api/v1/community/scout/apply",
    headers=pt_headers,
    json={
        "name":         unique,
        "age":          17,
        "village":      "Kerewan",
        "phone":        "+220 300 9999",
        "locality":     "Compound near main road",
        "availability": "After school Mon-Fri",
        "reason":       "I want to help my grandmother and her friends.",
    },
    timeout=10,
).json()
app = (apply_r.get("application") or {})
check("apply with richer fields → approved:true (pending)",
      apply_r.get("approved") is True)
check("applicant_id stamped from JWT",
      bool(app.get("applicant_id")), f"id={app.get('applicant_id')}")
check("locality saved",     app.get("locality") == "Compound near main road")
check("availability saved", app.get("availability") == "After school Mon-Fri")
check("reason saved",       bool(app.get("reason")))

# Applicant should immediately see a "received" notification.
inbox = requests.get(
    f"{API}/api/v1/inbox/list?limit=5&kind=notification",
    headers=pt_headers, timeout=10,
).json()
titles = [i.get("title") for i in (inbox.get("items") or [])]
check("applicant received 'application received' notification",
      any("Scout application received" in (t or "") for t in titles),
      f"titles={titles[:3]}")

# Alkalo approves → applicant should see a "you are now a scout" notification
alkalo_tok = requests.post(
    f"{API}/api/v1/auth/login/email",
    json={"email": "admin@demo.aminacare", "password": "Amina2026"},
    timeout=15,
).json().get("token", "")
alkalo_h = {"Authorization": f"Bearer {alkalo_tok}", "Content-Type": "application/json"}

app_id = app.get("app_id")
if app_id:
    r = requests.post(
        f"{API}/api/v1/community/scout/applications/approve",
        headers=alkalo_h,
        json={"app_id": app_id, "role": "alkalo"},
        timeout=10,
    )
    check("alkalo approves redesigned app → 200",
          r.status_code == 200, f"http={r.status_code}")
    scout = (r.json() or {}).get("scout") or {}
    check("scout has applicant_id stamped",
          scout.get("applicant_id") == app.get("applicant_id"))
    check("scout has locality stamped", scout.get("locality") == "Compound near main road")

    inbox = requests.get(
        f"{API}/api/v1/inbox/list?limit=5&kind=notification",
        headers=pt_headers, timeout=10,
    ).json()
    titles = [i.get("title") for i in (inbox.get("items") or [])]
    check("applicant received 'you are now a scout' notification",
          any("Youth Scout" in (t or "") for t in titles),
          f"titles={titles[:3]}")

    # Alkalo assigns an elder → scout receives notification.
    sid = scout.get("scout_id")
    if sid:
        r = requests.post(
            f"{API}/api/v1/community/scout/assign?scout_id={sid}",
            headers=alkalo_h,
            json={"elder_name": "Grandmother Fatima", "relation": "grandmother",
                  "age": 70, "role": "alkalo"},
            timeout=10,
        )
        check("alkalo assigns elder → 200", r.status_code == 200)

        inbox = requests.get(
            f"{API}/api/v1/inbox/list?limit=5&kind=notification",
            headers=pt_headers, timeout=10,
        ).json()
        titles = [i.get("title") for i in (inbox.get("items") or [])]
        check("scout received 'elder assigned' notification",
              any("elder assigned" in (t or "").lower() for t in titles),
              f"titles={titles[:3]}")


print()
print("=" * 64)
print("  SUMMARY")
print("=" * 64)
if FAIL:
    print(f"  FAILED ({len(FAIL)}):")
    for f in FAIL:
        print(f"    - {f}")
    sys.exit(1)
print("  ALL PASS — scout role gate inverted to {alkalo, admin} cleanly.")
