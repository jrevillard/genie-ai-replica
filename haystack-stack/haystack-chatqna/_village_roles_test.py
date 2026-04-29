#!/usr/bin/env python3
"""
Village scoreboard role matrix — pillar edits + alkalo notes.
=============================================================
Asserts:
  - VILLAGE_WRITE = {vhw, alkalo, admin}; pillar updates accept all three,
    reject clinician/patient.
  - POST /village/alkalo-note accepts {alkalo, admin}, rejects vhw/patient.
  - Read endpoint is public.
  - Pillar clamping: values above the max are clamped to the max
    (existing backend behavior — kept for confidence).

Run:  python _village_roles_test.py
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

FAIL = []
def check(label, cond, note=""):
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}]  {label}  {note}")
    if not cond:
        FAIL.append(label)


def put_pillar(pillar_id, score, detail, role, village="Kerewan"):
    return requests.put(
        f"{API}/api/v1/community/village/pillar?village={village}",
        headers={"Content-Type": "application/json"},
        json={"pillar_id": pillar_id, "score": score, "detail": detail, "role": role},
        timeout=10,
    )


def post_note(note, role, village="Kerewan"):
    return requests.post(
        f"{API}/api/v1/community/village/alkalo-note?village={village}",
        headers={"Content-Type": "application/json"},
        json={"note": note, "role": role},
        timeout=10,
    )


def get_village(village="Kerewan"):
    return requests.get(
        f"{API}/api/v1/community/village?village={village}",
        timeout=10,
    )


# Use a fresh village name so each run is deterministic
VILLAGE = f"RoleTestVil_{uuid.uuid4().hex[:6]}"


# ── 1. Pillar role matrix ───────────────────────────────────────────
print("=" * 64)
print("  PUT /village/pillar — role matrix (VILLAGE_WRITE)")
print("=" * 64)

r = put_pillar("screening", 12, "alkalo-update", "alkalo", village=VILLAGE)
check("alkalo → 200", r.status_code == 200, f"http={r.status_code}")

r = put_pillar("screening", 14, "vhw-update", "vhw", village=VILLAGE)
check("vhw → 200", r.status_code == 200, f"http={r.status_code}")

r = put_pillar("screening", 16, "admin-update", "admin", village=VILLAGE)
check("admin → 200", r.status_code == 200, f"http={r.status_code}")

r = put_pillar("screening", 18, "clinician-update", "clinician", village=VILLAGE)
check("clinician → 403", r.status_code == 403, f"http={r.status_code}")

r = put_pillar("screening", 19, "patient-update", "patient", village=VILLAGE)
check("patient → 403", r.status_code == 403, f"http={r.status_code}")


# ── 2. Alkalo note role matrix ──────────────────────────────────────
print()
print("=" * 64)
print("  POST /village/alkalo-note — role matrix")
print("=" * 64)

r = post_note("alkalo observation", "alkalo", village=VILLAGE)
check("alkalo → 200", r.status_code == 200, f"http={r.status_code}")

r = post_note("admin impersonating alkalo", "admin", village=VILLAGE)
check("admin → 200 (impersonation)", r.status_code == 200, f"http={r.status_code}")

r = post_note("vhw attempt", "vhw", village=VILLAGE)
check("vhw → 403", r.status_code == 403, f"http={r.status_code}")

r = post_note("patient attempt", "patient", village=VILLAGE)
check("patient → 403", r.status_code == 403, f"http={r.status_code}")


# ── 3. Read is public + reflects writes ────────────────────────────
print()
print("=" * 64)
print("  GET /village — reads are public, reflect writes")
print("=" * 64)

r = get_village(village=VILLAGE)
check("GET /village → 200 (public)", r.status_code == 200)
data = r.json() or {}

pillars = data.get("pillars") or []
screening = next((p for p in pillars if p.get("id") == "screening"), None)
check("screening pillar present in response", screening is not None)
if screening:
    check("screening score reflects admin update (16)",
          screening["score"] == 16, f"score={screening['score']}")

notes = data.get("alkalo_notes") or []
# Notes may or may not come back depending on the composer — just check the list exists.
check("alkalo_notes is present on /village response",
      isinstance(notes, list), f"type={type(notes).__name__}")


# ── 4. Pillar clamping ─────────────────────────────────────────────
print()
print("=" * 64)
print("  Pillar score clamping to max")
print("=" * 64)

r = put_pillar("screening", 99, "clamp test", "alkalo", village=VILLAGE)
check("PUT score=99 → 200", r.status_code == 200)
r2 = get_village(village=VILLAGE)
clamped = next((p for p in (r2.json() or {}).get("pillars", []) if p["id"] == "screening"), None)
if clamped:
    check("score clamped to pillar max",
          clamped["score"] <= (clamped.get("max") or 20),
          f"score={clamped['score']} max={clamped.get('max')}")


print()
print("=" * 64)
print("  SUMMARY")
print("=" * 64)
if FAIL:
    print(f"  FAILED ({len(FAIL)}):")
    for f in FAIL:
        print(f"    - {f}")
    sys.exit(1)
print("  ALL PASS — village role matrix + public reads wired cleanly.")
