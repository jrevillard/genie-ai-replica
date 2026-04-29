#!/usr/bin/env python3
"""
Seed the two patient accounts referenced as caregiver-linked patients
in DEVELOPER_SETUP.md:

    - Dado Badjie   (dado.badjie@demo.aminacare  / DadoBadjie2026)
    - Seedy Mendy   (seedy.mendy@demo.aminacare  / SeedyMendy2026)

These are the patients that caregiver Fatou Jallow (phone 3110001, PIN
1111) is documented as watching over. They were omitted from the
earlier `seed_demo_patients.py` batch, so this script backfills them.

Deterministic + idempotent — same email/password on every run; an
existing account is re-used rather than failing.

Usage:
    python scripts/seed_dado_seedy.py
    python scripts/seed_dado_seedy.py --api http://localhost:8000
"""
from __future__ import annotations
import argparse
import sys
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


DEFAULT_API = "http://localhost:8000"


PATIENTS = [
    {
        "email":      "dado.badjie@demo.aminacare",
        "password":   "DadoBadjie2026",
        "name":       "Dado Badjie",
        "age":        58,
        "gender":     "female",
        "region":     "Brikama",
        "conditions": ["hypertension"],
        "language":   "english",
    },
    {
        "email":      "seedy.mendy@demo.aminacare",
        "password":   "SeedyMendy2026",
        "name":       "Seedy Mendy",
        "age":        64,
        "gender":     "male",
        "region":     "Brikama",
        "conditions": ["hypertension", "diabetes"],
        "language":   "english",
    },
]


def _signup(api, p):
    return requests.post(
        f"{api}/api/v1/auth/signup/email",
        json={
            "email":    p["email"],   "password":   p["password"],
            "name":     p["name"],    "age":        p["age"],
            "gender":   p["gender"],  "region":     p["region"],
            "conditions": p["conditions"], "language": p["language"],
        }, timeout=15,
    )


def _login(api, email, password):
    r = requests.post(
        f"{api}/api/v1/auth/login/email",
        json={"email": email, "password": password}, timeout=15,
    )
    return (r.json() or {}).get("token", "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=DEFAULT_API)
    args = ap.parse_args()

    print("=" * 72)
    print("  AMINA — Seed caregiver-linked patients (Dado + Seedy)")
    print("=" * 72)
    print(f"  API: {args.api}\n")

    results = []
    for p in PATIENTS:
        print(f"--- {p['name']} ({p['email']}) ---")
        sr = _signup(args.api, p)
        if sr.status_code == 200:
            print("    [OK]   signup created")
        else:
            body = (sr.json() or {})
            if "already" in str(body).lower() or sr.status_code == 409:
                print("    [SKIP] account already exists, re-using")
            else:
                print(f"    [WARN] signup returned http={sr.status_code}  {body}")

        tok = _login(args.api, p["email"], p["password"])
        if not tok:
            print("    [FAIL] could not log in after signup.")
            results.append({"email": p["email"], "password": p["password"],
                            "name": p["name"], "pid": ""})
            continue

        import base64, json
        try:
            segs = tok.split(".")
            pad = "=" * (-len(segs[1]) % 4)
            payload = json.loads(base64.urlsafe_b64decode(segs[1] + pad))
            pid = payload.get("sub") or ""
        except Exception:
            pid = ""
        print(f"    [OK]   login (pid={pid})")

        results.append({
            "email": p["email"], "password": p["password"],
            "name":  p["name"],  "pid": pid,
        })
        print()

    print("=" * 72)
    print("  LOGIN CREDENTIALS  (use email tab on the AuthScreen)")
    print("=" * 72)
    print(f"  {'Name':<16}{'Email':<34}{'Password'}")
    print("  " + "-" * 68)
    for r in results:
        print(f"  {r['name']:<16}{r['email']:<34}{r['password']}")
    print()
    print("  Linked caregiver: Fatou Jallow  (phone 3110001, PIN 1111)")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
