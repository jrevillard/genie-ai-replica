#!/usr/bin/env python3
"""
Seed the admin-patient's supply + dual-path ledgers with realistic
Gambia-context data so the UI can be demoed with populated state.

What gets seeded (into the session id you pass)
================================================
  Supply ledger:           5 medicines (Amlodipine is already auto-seeded)
  Dual-path traditional:   6 entries
  Dual-path modern:        6 entries
  Dual-path interaction:   5 entries
  Dual-path progress:      6 entries

Usage
-----
  python scripts/seed_admin_patient_ledgers.py
  python scripts/seed_admin_patient_ledgers.py --sid s_my_demo_session
  python scripts/seed_admin_patient_ledgers.py --api http://localhost:8000

Defaults to session id 's_admin_demo_ledgers'. Idempotent — re-running
appends more entries only up to the 10-entry cap; entries past the cap
are reported as skipped with 'LIMIT_REACHED', they do NOT crash.

After seeding, navigate the frontend to the session (or check the dashboard
for the admin-patient login) and open:

  - The "Supply" edit button → see 6 medicines with status pills
  - The "Care paths" edit button → tabs for all 4 ledger types
  - The Dual-Path Care side panel → full multi-entry tiles for every type

The seed uses the admin-patient JWT so the role-escalation resolver
stamps each entry with updated_by='clinician' (admin impersonating a
clinician — exercises the same path real operators use).
"""
from __future__ import annotations
import argparse
import json
import sys
import time
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


DEFAULT_API   = "http://localhost:8000"
DEFAULT_SID   = "s_admin_demo_ledgers"
ADMIN_EMAIL   = "admin@demo.aminacare"
ADMIN_PW      = "Amina2026"


# ─── realistic Gambia-flavoured demo content ─────────────────────────

SUPPLY_MEDS = [
    # Amlodipine already auto-seeds on first read — skip it to avoid dupe.
    {
        "medication_name":   "Lisinopril",
        "tablets_remaining": 24,
        "cost_per_pack":     "35 dalasi / 30 tablets",
        "refill_location":   "Banjul General Hospital pharmacy",
        "in_stock":          True,
    },
    {
        "medication_name":   "Hydrochlorothiazide",
        "tablets_remaining": 12,
        "cost_per_pack":     "18 dalasi / 30 tablets",
        "refill_location":   "Serrekunda pharmacy",
        "in_stock":          True,
    },
    {
        "medication_name":   "Metformin 500mg",
        "tablets_remaining": 45,
        "cost_per_pack":     "55 dalasi / 60 tablets",
        "refill_location":   "MRC clinic Fajara",
        "in_stock":          True,
    },
    {
        "medication_name":   "Paracetamol 500mg",
        "tablets_remaining": 3,
        "cost_per_pack":     "10 dalasi / 20 tablets",
        "refill_location":   "Village kiosk",
        "in_stock":          False,   # shows Out-of-stock pill
    },
    {
        "medication_name":   "Aspirin 75mg",
        "tablets_remaining": 28,
        "cost_per_pack":     "12 dalasi / 30 tablets",
        "refill_location":   "Kerewan Health Centre",
        "in_stock":          True,
    },
]


TRADITIONAL_ENTRIES = [
    {
        "practitioner": "Local marabout — Mustapha Ceesay",
        "practices":    "Prayers for wellbeing, Bitter leaf tea (herbal)",
        "last_visit_days_ago": 2,
        "notes": "Strong family relationship; patient trusts this guidance before "
                 "adjusting care plan.",
    },
    {
        "practitioner": "Village herbalist — Aja Bojang",
        "practices":    "Moringa leaf infusion, Neem bark tea",
        "last_visit_days_ago": 9,
        "notes": "Moringa taken 3× weekly; monitor for BP effect next visit.",
    },
    {
        "practitioner": "Traditional birth attendant — Kaddy Jallow",
        "practices":    "Postnatal massage, Herbal steam baths",
        "last_visit_days_ago": 21,
        "notes": "Handled last pregnancy; patient values continuity.",
    },
    {
        "practitioner": "Spiritual healer — Alhaji Sillah",
        "practices":    "Baobab bark tea, Community prayer session",
        "last_visit_days_ago": 45,
        "notes": "Patient reports reduced anxiety after sessions.",
    },
    {
        "practitioner": "Bush doctor — Ousman Touray",
        "practices":    "Cassava leaf poultice, Ginger root decoction",
        "last_visit_days_ago": 67,
        "notes": "Used for joint pain; no interaction flagged with current meds.",
    },
    {
        "practitioner": "Kanilai herbalist — Isatou Njie",
        "practices":    "Sorghum-based tonic, Lemongrass tea",
        "last_visit_days_ago": 90,
        "notes": "Consulted during mild fever episode; patient recovered within a week.",
    },
]


MODERN_ENTRIES = [
    {
        "facility":   "Kerewan Health Centre",
        "chw_name":   "VHW Mariama Jallow",
        "medications": "Amlodipine 5mg daily",
        "last_visit_days_ago": 7,
        "notes": "Routine BP check; plan continuing. CHW to follow up in 2 weeks.",
    },
    {
        "facility":   "Banjul General Hospital",
        "chw_name":   "Dr Alieu Sanneh",
        "medications": "Lisinopril 10mg, Hydrochlorothiazide 25mg",
        "last_visit_days_ago": 14,
        "notes": "Added ACE inhibitor; titrate after next reading.",
    },
    {
        "facility":   "Brikama Clinic",
        "chw_name":   "CHW Fatou Saine",
        "medications": "Metformin 500mg twice daily",
        "last_visit_days_ago": 30,
        "notes": "Fasting sugar measured; lifestyle advice given.",
    },
    {
        "facility":   "MRC Gambia Unit — Fajara",
        "chw_name":   "Nurse Ramatoulie Bah",
        "medications": "Specialty BP monitoring, Aspirin 75mg",
        "last_visit_days_ago": 52,
        "notes": "Cardio screening; enrolled in longitudinal BP study.",
    },
    {
        "facility":   "Serrekunda Pharmacy",
        "chw_name":   "Pharmacist Lamin Ceesay",
        "medications": "Paracetamol 500mg PRN",
        "last_visit_days_ago": 75,
        "notes": "Consultation for mild pain; counselled on dose ceiling.",
    },
    {
        "facility":   "Farafenni Regional Hospital",
        "chw_name":   "Dr Binta Diallo",
        "medications": "Initial Amlodipine prescription",
        "last_visit_days_ago": 120,
        "notes": "First BP diagnosis at 160/100; plan started here.",
    },
]


INTERACTION_ENTRIES = [
    {
        "safe":  True,
        "notes": "Bitter leaf tea has no documented interaction with amlodipine.",
    },
    {
        "safe":  False,
        "notes": "Licorice root tea can raise BP — counsel to avoid while on "
                 "antihypertensives. Flagged to the marabout.",
    },
    {
        "safe":  True,
        "notes": "Moringa leaf infusion — moderate hypoglycaemic effect; safe with "
                 "metformin but monitor fasting sugars.",
    },
    {
        "safe":  False,
        "notes": "Baobab fruit shares tartaric acid content; use caution if "
                 "combining with hydrochlorothiazide (K+ loss).",
    },
    {
        "safe":  True,
        "notes": "Neem oil used topically only; zero systemic interaction expected.",
    },
]


PROGRESS_ENTRIES = [
    { "bp_current": "160/100", "months_on_plan": 0, "notes": "Baseline at diagnosis (Farafenni)." },
    { "bp_current": "154/96",  "months_on_plan": 1, "notes": "Started amlodipine 5mg; mild ankle swelling reported." },
    { "bp_current": "146/92",  "months_on_plan": 2, "notes": "Continued amlodipine; added dietary salt reduction." },
    { "bp_current": "140/88",  "months_on_plan": 3, "notes": "Lisinopril 10mg added; BP trending down." },
    { "bp_current": "135/85",  "months_on_plan": 4, "notes": "Current reading — pressure controlled; traditional + modern working together." },
    { "bp_current": "132/82",  "months_on_plan": 5, "notes": "Follow-up; consider dose reduction if next reading holds." },
]


# ─── runner ──────────────────────────────────────────────────────────

def login(api: str) -> str:
    r = requests.post(f"{api}/api/v1/auth/login/email",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
                      timeout=15)
    return (r.json() or {}).get("token") or ""


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def seed_supply(api: str, sid: str, tok: str, out: list) -> None:
    print(f"\n  [Supply ledger]")
    for med in SUPPLY_MEDS:
        body = {**med, "role": "clinician"}
        r = requests.post(f"{api}/api/v1/care/supply_ledger/{sid}/add",
                          headers=_hdr(tok), json=body, timeout=10)
        if r.status_code == 200:
            env = r.json()
            print(f"    [OK]   +{med['medication_name']}  (now {env['count']}/{env['cap']})")
            out.append(("supply", med["medication_name"], "added"))
        elif r.status_code == 409:
            print(f"    [SKIP] {med['medication_name']}  (ledger at cap)")
            out.append(("supply", med["medication_name"], "cap"))
        else:
            print(f"    [WARN] {med['medication_name']}  http={r.status_code}  {r.text[:120]}")
            out.append(("supply", med["medication_name"], f"http={r.status_code}"))


def seed_dualpath(api: str, sid: str, tok: str, out: list,
                  type_: str, entries: list) -> None:
    # Dual-path writes are VHW-owned per the 2026-04-19 role split
    # (clinician is reserved for supply, VHW for field care-path
    # logging). The admin-patient JWT impersonates "vhw" so CAREPATH_-
    # WRITE_ROLES = {vhw, admin} lets the write through.
    print(f"\n  [Dual-path / {type_}]")
    for i, e in enumerate(entries):
        body = {**e, "role": "vhw"}
        r = requests.post(
            f"{api}/api/v1/care/dualpath_ledger/{sid}/{type_}/add",
            headers=_hdr(tok), json=body, timeout=10,
        )
        label = (e.get("practitioner") or e.get("facility")
                 or e.get("bp_current")
                 or ("Safe" if e.get("safe") else "Check"))
        if r.status_code == 200:
            env = r.json()
            print(f"    [OK]   +{label}  (now {env['count']}/{env['cap']})")
            out.append((type_, label, "added"))
        elif r.status_code == 409:
            print(f"    [SKIP] {label}  (ledger at cap)")
            out.append((type_, label, "cap"))
        else:
            print(f"    [WARN] {label}  http={r.status_code}  {r.text[:120]}")
            out.append((type_, label, f"http={r.status_code}"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=DEFAULT_API)
    ap.add_argument("--sid", default=DEFAULT_SID,
                    help=f"Session id to seed into (default: {DEFAULT_SID})")
    args = ap.parse_args()

    print("=" * 70)
    print("  AMINA — Seed admin-patient ledgers with demo data")
    print("=" * 70)
    print(f"  API:     {args.api}")
    print(f"  Session: {args.sid}")
    print(f"  Login:   {ADMIN_EMAIL}")

    tok = login(args.api)
    if not tok:
        print("  [FAIL] admin-patient login returned no token.")
        return 1
    print(f"  JWT:     ok ({len(tok)} chars)")

    outcomes: list = []
    seed_supply(args.api, args.sid, tok, outcomes)
    seed_dualpath(args.api, args.sid, tok, outcomes, "traditional", TRADITIONAL_ENTRIES)
    seed_dualpath(args.api, args.sid, tok, outcomes, "modern",      MODERN_ENTRIES)
    seed_dualpath(args.api, args.sid, tok, outcomes, "interaction", INTERACTION_ENTRIES)
    seed_dualpath(args.api, args.sid, tok, outcomes, "progress",    PROGRESS_ENTRIES)

    # Verify final counts
    print("\n" + "=" * 70)
    print("  Final ledger counts")
    print("=" * 70)
    supply_env = requests.get(f"{args.api}/api/v1/care/supply_ledger/{args.sid}", timeout=10).json()
    print(f"  Supply:       {supply_env['count']}/{supply_env['cap']} entries")
    dual_env = requests.get(f"{args.api}/api/v1/care/dualpath_ledger/{args.sid}", timeout=10).json()
    for t in ("traditional", "modern", "interaction", "progress"):
        print(f"  {t:<13s}{dual_env[t]['count']}/{dual_env[t]['cap']} entries")

    added = sum(1 for _, _, s in outcomes if s == "added")
    capped = sum(1 for _, _, s in outcomes if s == "cap")
    errored = sum(1 for _, _, s in outcomes if s not in ("added", "cap"))
    print(f"\n  Summary: +{added} added, {capped} skipped (cap), {errored} errors")

    print("\n" + "=" * 70)
    print(f"  Done. Open the frontend and point the app at session:")
    print(f"    {args.sid}")
    print(f"  Then click:")
    print(f"    • Supply edit button → see the populated supply ledger")
    print(f"    • Care paths button  → tabbed dual-path ledger")
    print(f"    • Dual-Path Care side panel → tile list of every entry")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
