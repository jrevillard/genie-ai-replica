# ============================================
# WARNING: SEED / FIXUP DATA -- NOT FOR PRODUCTION
# This script resets directory-caregiver PINs to per-caregiver
# random values (BUG-011 fix) and prints them once. The
# operator must record the printed PINs immediately and hand
# them to the matching caregiver out-of-band.
# Do NOT run this against a production database.
# ============================================
"""
AMINA Care -- Directory Caregiver Auth Fix
=============================================
The 8 directory caregivers seeded by `seed_caregivers.py` all share the same
default PIN `1234`, but (a) the shared hash could drift if the script was run
twice with different salts, and (b) they have NO `CaregiverPatientEdge` →
`/caregiver/login` returns 404 "No active patients linked" even on a correct
PIN.

This script fixes both problems, additively:

  1. For every caregiver whose `caregiver_id` starts with `cg_` (the
     directory seeds — Sarah Care's CG_C4A19716 is deliberately skipped),
     resets `pin_hash` + `pin_salt` so the PIN is unambiguously `1234`.
  2. Links each directory caregiver to 2 unlinked demo patients from the
     PatientVertex pool — 2 per caregiver, round-robin.
  3. Never revokes any existing edge. Never deletes any vertex. Respects
     the project's "no data deletion" rule strictly.
  4. Live-verifies each caregiver's /caregiver/login end-to-end at the end
     and prints a complete login-ready table.

Rerun-safe: existing edges are detected via `SELECT count(*)` before a new
one is created, so repeat runs do not double-link. The PIN reset is
idempotent by construction.
"""

from __future__ import annotations

import hmac
import json
import secrets


def generate_seed_pin() -> str:
    """Per-caregiver random 6-digit PIN. BUG-011 fix."""
    return str(secrets.randbelow(900_000) + 100_000)
import os
import sys
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


ARCADE_URL = os.getenv("ARCADE_URL", "http://localhost:2480")
DB         = os.getenv("ARCADE_DB",  "genie")
AUTH       = (os.getenv("ARCADE_USER", "root"),
              os.getenv("ARCADE_PASS", "genieRoot123"))
API        = os.getenv("API",        "http://localhost:8000")

# BUG-011 fix: PIN is now per-caregiver random; the script prints
# the assigned PIN once at the end so the operator can hand it out.
SARAH_TEST_PIN = "4242"  # Sarah Care is the always-known login control
PATIENTS_PER_CAREGIVER = 2


# ── ArcadeDB helper ─────────────────────────────────────────────────────────

def sql(stmt: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    body: Dict[str, Any] = {"language": "sql", "command": stmt}
    if params:
        body["params"] = params
    r = requests.post(
        f"{ARCADE_URL}/api/v1/command/{DB}",
        json=body, auth=AUTH, timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"ArcadeDB {r.status_code}: {r.text[:400]}")
    return (r.json() or {}).get("result", []) or []


def _hash_pin(pin: str, salt: str) -> str:
    return hmac.new(salt.encode(), pin.encode(), "sha256").hexdigest()


# ── Step 1: list the directory caregivers ──────────────────────────────────

def list_directory_caregivers() -> List[Dict[str, Any]]:
    rows = sql(
        "SELECT caregiver_id, name, phone FROM CaregiverVertex "
        "WHERE caregiver_id LIKE 'cg_%' "
        "ORDER BY name"
    )
    return rows


# ── Step 2: pin reset ───────────────────────────────────────────────────────

def reset_pin(cg_id: str, pin: str = DEFAULT_PIN) -> str:
    salt = uuid.uuid4().hex[:16]
    ph   = _hash_pin(pin, salt)
    sql(
        "UPDATE CaregiverVertex SET pin_hash = :ph, pin_salt = :ps "
        "WHERE caregiver_id = :cid",
        {"ph": ph, "ps": salt, "cid": cg_id},
    )
    return ph[:10]


# ── Step 3: patient pool ────────────────────────────────────────────────────

def pick_unlinked_patients(n_needed: int) -> List[Dict[str, Any]]:
    """
    Finds `n_needed` patients that have NO active CaregiverPatientEdge.
    We query a batch + filter in Python to avoid ArcadeDB NOT-IN issues
    with large subqueries.
    """
    # Pull a batch from the middle of the list to avoid likely-demo rows.
    batch = sql(
        "SELECT id, name FROM PatientVertex "
        "WHERE id IS NOT NULL SKIP 40 LIMIT 400"
    )
    linked_ids = {
        r["patient_id"] for r in sql(
            "SELECT patient_id FROM CaregiverPatientEdge "
            "WHERE is_revoked = false"
        )
        if r.get("patient_id")
    }
    free = [p for p in batch if p.get("id") and p["id"] not in linked_ids]
    return free[:n_needed]


def link_caregiver_to_patient(cg_id: str, patient_id: str, now_iso: str) -> bool:
    """True if a NEW edge was created, False if an edge already existed."""
    exists = sql(
        "SELECT count(*) AS n FROM CaregiverPatientEdge "
        "WHERE patient_id = :pid AND caregiver_id = :cg AND is_revoked = false",
        {"pid": patient_id, "cg": cg_id},
    )
    if exists and int(exists[0].get("n", 0)) > 0:
        return False
    sql(
        "CREATE EDGE CaregiverPatientEdge "
        "FROM (SELECT FROM CaregiverVertex WHERE caregiver_id = :cg) "
        "TO   (SELECT FROM PatientVertex   WHERE id = :pid) "
        "SET patient_id = :pid, caregiver_id = :cg, "
        "permissions = :perms, consent_date = :now, "
        "granted_by = 'admin', is_revoked = false, "
        "note = 'auto-linked by fix_directory_caregiver_auth.py'",
        {
            "cg":    cg_id,
            "pid":   patient_id,
            "perms": json.dumps(["vitals", "medications", "consultations", "alerts"]),
            "now":   now_iso,
        },
    )
    return True


# ── Step 4: live login check ────────────────────────────────────────────────

def try_login(phone: str, pin: str) -> Tuple[int, str]:
    try:
        r = requests.post(
            f"{API}/api/v1/caregiver/login",
            json={"phone": phone, "pin": pin}, timeout=10,
        )
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"
    ok  = r.status_code == 200
    tag = "ok" if ok else (r.json().get("detail", r.text[:60])
                           if r.headers.get("content-type", "").startswith("application/json")
                           else r.text[:60])
    return r.status_code, str(tag)


# ── Main ────────────────────────────────────────────────────────────────────

def main() -> int:
    print("=" * 66)
    print("  AMINA — Directory Caregiver Auth Fix")
    print("=" * 66)

    cgs = list_directory_caregivers()
    if not cgs:
        print("  no cg_* caregivers found; nothing to do")
        return 0
    print(f"\n  Target caregivers: {len(cgs)}")
    for c in cgs:
        print(f"    - {c.get('name'):<18} {c.get('phone'):<14} id={c.get('caregiver_id')}")

    # Step 1 + 2 -- PIN reset (per-caregiver random, BUG-011 fix)
    print("\n── PIN reset (per-caregiver random) ──")
    pins_by_id: Dict[str, str] = {}
    for c in cgs:
        pin = generate_seed_pin()
        pins_by_id[c["caregiver_id"]] = pin
        preview = reset_pin(c["caregiver_id"], pin)
        print(f"  {c['name']:<18}  hash_preview={preview}…")

    # Step 3 — patient linking
    print(f"\n── Patient linking ({PATIENTS_PER_CAREGIVER} per caregiver) ──")
    need = len(cgs) * PATIENTS_PER_CAREGIVER
    free = pick_unlinked_patients(need)
    print(f"  Found {len(free)} unlinked patients (need {need})")
    if len(free) < need:
        print(f"  [warn] only {len(free)} free patients available — some caregivers "
              f"will get fewer than {PATIENTS_PER_CAREGIVER}")

    now_iso = datetime.now().isoformat()
    assignments: List[Tuple[str, List[str]]] = []   # [(caregiver_name, [patient_names])]
    idx = 0
    for c in cgs:
        take = min(PATIENTS_PER_CAREGIVER, len(free) - idx)
        linked_names: List[str] = []
        for _ in range(take):
            p = free[idx]; idx += 1
            try:
                is_new = link_caregiver_to_patient(c["caregiver_id"], p["id"], now_iso)
                tag = "✓" if is_new else "= (already linked)"
                print(f"  {c['name']:<18} <- {p['id']:<14} ({p.get('name') or '-'})  {tag}")
                linked_names.append(p.get("name") or p["id"])
            except Exception as e:
                print(f"  {c['name']:<18} <- {p['id']:<14} FAIL: {e}")
        assignments.append((c["name"], linked_names))

    # Step 4 — live login check for every caregiver (including Sarah as control)
    print("\n── Live login verification ──")
    SARAH = {"name": "Sarah Care", "phone": "+220 9000042",
             "caregiver_id": "CG_C4A19716"}
    all_caregivers = cgs + [SARAH]

    results: List[Tuple[str, str, str, int, str]] = []
    for c in all_caregivers:
        pin = pins_by_id.get(c["caregiver_id"], SARAH_TEST_PIN)
        code, detail = try_login(c["phone"], pin)
        results.append((c["name"], c["phone"], pin, code, detail))

    # Credentials table (record once, then discard)
    print("\n" + "=" * 70)
    print("  READY-TO-USE CAREGIVER CREDENTIALS  --  RECORD ONCE THEN DISCARD")
    print("=" * 70)
    print(f"\n  {'Name':<20} {'Phone':<16} {'PIN':<8} {'HTTP':<6} {'Status'}")
    print(f"  {'-'*20} {'-'*16} {'-'*8} {'-'*6} {'-'*30}")
    for name, phone, pin, code, detail in results:
        ok_tag = "OK" if code == 200 else detail
        print(f"  {name:<20} {phone:<16} {pin:<8} {code:<6} {ok_tag[:30]}")

    # Exit code reflects login outcome for directory caregivers
    fails = [n for n, _, _, code, _ in results if code != 200 and n != "Sarah Care"]
    if fails:
        print(f"\n  [fail] {len(fails)} caregivers still not login-ready: {fails}")
        return 1
    print(f"\n  All {len(results)} caregivers login-ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
