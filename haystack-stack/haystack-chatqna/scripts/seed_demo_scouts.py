#!/usr/bin/env python3
"""
Seed demo scout patients for end-to-end Scout role testing.
===========================================================

Creates 5 young Gambian-context patient accounts (ages 13-23 — all
within the 12-24 scout eligibility window), submits a scout
application for each, and selectively approves 3 of them so that:

  - 3 patients end up as active Youth Scouts with elders assigned
  - 2 patients remain as pending applications (for the Alkalo inbox
    UX — so there's something to triage in the admin console)

Idempotent:
  - Signup 409 ("already registered") is treated as success and the
    script re-uses the existing account.
  - Scout applications are keyed by applicant_id + uniquified name,
    so re-running after the first pass just no-ops.

Usage:
    python scripts/seed_demo_scouts.py
    python scripts/seed_demo_scouts.py --api http://localhost:8000
    python scripts/seed_demo_scouts.py --approve-all
    python scripts/seed_demo_scouts.py --approve-none

Prints a credential table at the end so you can log in as any of the
seeded scouts and exercise the role's UI.
"""
from __future__ import annotations

import argparse
import sys
import time
from typing import Any, Dict, List, Optional

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


DEFAULT_API = "http://localhost:8000"


# ── 5 young Gambian-context patient profiles ─────────────────────────
#
# Ages chosen to sit inside the 12-24 scout-eligibility band and to
# cover the full range: one early-teen (13), one mid-teen (16), one
# 20, one 22, one at the ceiling (23). Names drawn from common
# Gambian given/family-name combinations — intentionally distinct
# from seed_demo_patients.py so the two scripts can run back-to-back
# without colliding.

SCOUT_PATIENTS: List[Dict[str, Any]] = [
    {
        "email":        "binta.jawara@demo.aminacare",
        "password":     "BintaJawara2026",
        "name":         "Binta Jawara",
        "age":          13,
        "gender":       "female",
        "region":       "Kerewan",
        "conditions":   [],
        "language":     "english",
        "locality":     "Compound near the Kerewan mosque",
        "availability": "After school weekdays, all day Saturday",
        "reason":       "My grandmother lives alone. I want to check on her and our neighbours every week.",
        "phone":        "+220 300 0113",
    },
    {
        "email":        "sulayman.fofana@demo.aminacare",
        "password":     "SulaymanFofana2026",
        "name":         "Sulayman Fofana",
        "age":          16,
        "gender":       "male",
        "region":       "Banjul",
        "conditions":   [],
        "language":     "english",
        "locality":     "Half Die, near the fishing harbour",
        "availability": "Tuesdays + Thursdays after school, weekends",
        "reason":       "I want to help the VHW take blood pressure readings for the elders on my street.",
        "phone":        "+220 300 0216",
    },
    {
        "email":        "mariama.darboe@demo.aminacare",
        "password":     "MariamaDarboe2026",
        "name":         "Mariama Darboe",
        "age":          19,
        "gender":       "female",
        "region":       "Brikama",
        "conditions":   [],
        "language":     "english",
        "locality":     "Brikama Nema, behind the health centre",
        "availability": "Mornings before college, full weekends",
        "reason":       "I'm studying nursing. Checking elders is good practice and my grandfather has diabetes.",
        "phone":        "+220 300 0319",
    },
    {
        "email":        "ebrima.sanneh@demo.aminacare",
        "password":     "EbrimaSanneh2026",
        "name":         "Ebrima Sanneh",
        "age":          22,
        "gender":       "male",
        "region":       "Serrekunda",
        "conditions":   [],
        "language":     "english",
        "locality":     "Serrekunda West, near the taxi rank",
        "availability": "Evenings after work, Sunday mornings",
        "reason":       "Three of the elders on my compound have no family nearby. I want to be that support.",
        "phone":        "+220 300 0422",
    },
    {
        "email":        "aminata.ceesay@demo.aminacare",
        "password":     "AminataCeesay2026",
        "name":         "Aminata Ceesay",
        "age":          23,
        "gender":       "female",
        "region":       "Farafenni",
        "conditions":   [],
        "language":     "english",
        "locality":     "Farafenni East, near the secondary school",
        "availability": "Weekday afternoons, flexible weekends",
        "reason":       "I grew up helping my aunt who has hypertension. I understand BP cuffs and medication timing.",
        "phone":        "+220 300 0523",
    },
]


# Each suggested elder is assigned to an approved scout on approval.
# (age + relation chosen to make sense for the scout's own age.)
SUGGESTED_ELDERS = [
    {"elder_name": "Grandmother Fatima Jawara",   "relation": "grandmother", "age": 74},
    {"elder_name": "Neighbour Mr. Oulai",          "relation": "neighbour",   "age": 68},
    {"elder_name": "Imam Abdoulie Manneh",         "relation": "neighbour",   "age": 71},
    {"elder_name": "Auntie Isatou Touray",         "relation": "aunt",        "age": 66},
    {"elder_name": "Grandfather Lamin Jatta",      "relation": "grandfather", "age": 78},
]


# ── HTTP helpers ─────────────────────────────────────────────────────

def _signup(api: str, p: Dict[str, Any]) -> requests.Response:
    return requests.post(
        f"{api}/api/v1/auth/signup/email",
        json={
            "email":               p["email"],
            "password":            p["password"],
            "name":                p["name"],
            "age":                 p["age"],
            "gender":              p["gender"],
            "region":              p["region"],
            "conditions":          p["conditions"],
            "preferred_language":  p["language"],
            "phone":               p["phone"],
        },
        timeout=15,
    )


def _login(api: str, email: str, password: str) -> Optional[str]:
    r = requests.post(
        f"{api}/api/v1/auth/login/email",
        json={"email": email, "password": password},
        timeout=15,
    )
    if r.status_code != 200:
        return None
    return (r.json() or {}).get("token")


def _apply(api: str, tok: str, p: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.post(
        f"{api}/api/v1/community/scout/apply",
        headers={"Authorization": f"Bearer {tok}",
                 "Content-Type":  "application/json"},
        json={
            "name":         p["name"],
            "age":          p["age"],
            "village":      p["region"],
            "phone":        p["phone"],
            "locality":     p["locality"],
            "availability": p["availability"],
            "reason":       p["reason"],
        },
        timeout=15,
    )
    return {
        "http":  r.status_code,
        "body":  r.json() if r.headers.get("content-type", "").startswith("application/json") else {},
    }


def _list_applications(api: str) -> List[Dict[str, Any]]:
    """Alkalo-gated endpoint — SCOUT_WRITE allows role from body so we
    just pass ?role=alkalo in the query string."""
    r = requests.get(
        f"{api}/api/v1/community/scout/applications?role=alkalo",
        timeout=15,
    )
    if r.status_code != 200:
        return []
    return (r.json() or {}).get("applications", []) or []


def _approve(api: str, app_id: str) -> Dict[str, Any]:
    r = requests.post(
        f"{api}/api/v1/community/scout/applications/approve",
        headers={"Content-Type": "application/json"},
        json={"app_id": app_id, "role": "alkalo"},
        timeout=15,
    )
    return {
        "http":  r.status_code,
        "body":  r.json() if r.headers.get("content-type", "").startswith("application/json") else {},
    }


def _assign_elder(api: str, scout_id: str, elder: Dict[str, Any]) -> int:
    r = requests.post(
        f"{api}/api/v1/community/scout/assign?scout_id={scout_id}",
        headers={"Content-Type": "application/json"},
        json={
            "elder_name": elder["elder_name"],
            "relation":   elder["relation"],
            "age":        elder["age"],
            "role":       "alkalo",
        },
        timeout=15,
    )
    return r.status_code


# ── Main ─────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=DEFAULT_API)
    grp = ap.add_mutually_exclusive_group()
    grp.add_argument("--approve-all", action="store_true",
                     help="Approve every seeded application (fully activates all 5 as scouts)")
    grp.add_argument("--approve-none", action="store_true",
                     help="Leave every application pending (nothing becomes an active scout)")
    args = ap.parse_args()

    print("=" * 72)
    print("  AMINA — Seed 5 demo SCOUT patients (ages 13-23)")
    print("=" * 72)
    print(f"  API: {args.api}")
    if args.approve_all:
        print("  Mode: approve-all  (every applicant becomes an active scout)")
    elif args.approve_none:
        print("  Mode: approve-none (every applicant stays pending)")
    else:
        print("  Mode: mixed  (first 3 approved · last 2 pending for inbox triage)")
    print()

    seeded: List[Dict[str, Any]] = []

    # ── Phase 1 — signup + login + scout application ──────────────
    for p in SCOUT_PATIENTS:
        print(f"--- {p['name']} ({p['age']}) · {p['email']} ---")
        sr = _signup(args.api, p)
        if sr.status_code == 200:
            print("    [OK]   signup created")
        else:
            body = sr.json() if sr.headers.get("content-type", "").startswith("application/json") else {}
            if "already" in str(body).lower() or sr.status_code == 409:
                print("    [SKIP] account already exists, re-using")
            else:
                print(f"    [WARN] signup returned http={sr.status_code}  {body}")

        tok = _login(args.api, p["email"], p["password"])
        if not tok:
            print("    [FAIL] could not log in after signup; skipping.")
            continue

        applied = _apply(args.api, tok, p)
        ah = applied["http"]
        body = applied["body"] or {}
        application = (body.get("application") or {})
        app_id = application.get("app_id") or ""
        if ah == 200:
            print(f"    [OK]   scout application queued · app_id={app_id}")
        elif ah in (400, 409):
            detail = body.get("detail") or body.get("reason") or body
            print(f"    [SKIP] application already pending or duplicate · {detail}")
        else:
            print(f"    [WARN] apply returned http={ah}  {body}")

        seeded.append({
            "name":     p["name"],
            "email":    p["email"],
            "password": p["password"],
            "age":      p["age"],
            "region":   p["region"],
            "token":    tok,
            "app_id":   app_id,
            "approved": False,
            "scout_id": None,
        })

    # ── Phase 2 — approve (selective or exhaustive) ───────────────
    # Re-read the pending queue so we catch apps created in prior runs
    # too (idempotent re-runs should still result in the expected
    # approved/pending distribution).
    pending = {a.get("app_id"): a for a in _list_applications(args.api) if a.get("app_id")}

    if args.approve_all:
        to_approve_idx = list(range(len(seeded)))
    elif args.approve_none:
        to_approve_idx = []
    else:
        to_approve_idx = [0, 1, 2]  # Binta, Sulayman, Mariama

    print()
    print("--- Approvals ---")
    for i, s in enumerate(seeded):
        if i not in to_approve_idx:
            print(f"    [HOLD] {s['name']:<22s} left pending (app_id={s['app_id']})")
            continue
        aid = s["app_id"] or next(
            (apid for apid, rec in pending.items()
             if (rec.get("applicant_name") or rec.get("name")) == s["name"]),
            "",
        )
        if not aid:
            print(f"    [SKIP] {s['name']:<22s} no pending app_id found")
            continue
        res = _approve(args.api, aid)
        if res["http"] == 200:
            scout = (res["body"] or {}).get("scout") or {}
            sid = scout.get("scout_id") or ""
            s["approved"] = True
            s["scout_id"] = sid
            print(f"    [OK]   {s['name']:<22s} approved  scout_id={sid}")

            # Assign a thematic elder so the scout has someone to check on.
            if sid and i < len(SUGGESTED_ELDERS):
                ar = _assign_elder(args.api, sid, SUGGESTED_ELDERS[i])
                tag = "[OK]  " if ar == 200 else f"[WARN·{ar}]"
                print(f"             {tag}  elder assigned: {SUGGESTED_ELDERS[i]['elder_name']}")
        else:
            print(f"    [FAIL] {s['name']:<22s} approve http={res['http']}  {res['body']}")

    # ── Phase 3 — credentials table ───────────────────────────────
    print()
    print("=" * 72)
    print("  Credentials — use these to test the Scout role UI")
    print("=" * 72)
    print(f"  {'Status':<10s}  {'Name':<24s}  {'Age':<4s}  {'Email':<36s}  Password")
    print(f"  {'-'*10}  {'-'*24}  {'-'*4}  {'-'*36}  {'-'*20}")
    for s in seeded:
        status = "SCOUT" if s["approved"] else "PENDING"
        print(f"  {status:<10s}  {s['name']:<24s}  {s['age']:<4d}  {s['email']:<36s}  {s['password']}")

    print()
    print("  Notes")
    print("  -----")
    print("  · SCOUT rows have an approved Youth-Scout profile + an assigned elder.")
    print("    Log in, open the Scouts panel, and you should see the elder card.")
    print("  · PENDING rows show up in the Alkalo/Admin inbox under")
    print("      Admin console → People → Scout applications")
    print("    (requires an alkalo or admin-patient JWT to approve/reject).")
    print("  · Approver role defaults to 'alkalo' from the body (matches")
    print("    SCOUT_WRITE = {'alkalo', 'admin'} in src/api/community_routes.py).")
    print()

    # Quick health summary
    approved_n = sum(1 for s in seeded if s["approved"])
    pending_n  = len(seeded) - approved_n
    print(f"  ✓ {approved_n} active scouts  ·  {pending_n} pending applications")
    return 0


if __name__ == "__main__":
    sys.exit(main())
