#!/usr/bin/env python3
"""
AMINA Care — Dev Account Seeder
=================================
Creates standard test accounts in a fresh local ArcadeDB instance.
Run once after `docker compose up` to get a working login.

Usage:
    python scripts/seed_dev_accounts.py

    # Against a remote server:
    python scripts/seed_dev_accounts.py --api http://your-server:8000
"""

import argparse
import requests

DEV_ACCOUNTS = [
    {
        "email":      "testuser@aminacare.dev",
        "password":   "Amina2026",
        "name":       "Test Patient",
        "age":        30,
        "gender":     "other",
        "region":     "Kanifing",
        "conditions": ["hypertension"],
        "language":   "english",
    },
    {
        "email":      "fatou@aminacare.dev",
        "password":   "Amina2026",
        "name":       "Fatou Ceesay",
        "age":        45,
        "gender":     "female",
        "region":     "Banjul",
        "conditions": ["diabetes", "hypertension"],
        "language":   "english",
    },
    {
        "email":      "lamin@aminacare.dev",
        "password":   "Amina2026",
        "name":       "Lamin Jallow",
        "age":        55,
        "gender":     "male",
        "region":     "Kanifing",
        "conditions": ["asthma"],
        "language":   "english",
    },
]

OK   = "\033[92m✔\033[0m"
WARN = "\033[93m⚠\033[0m"
FAIL = "\033[91m✘\033[0m"


def seed(api_base: str):
    print("\n" + "═" * 50)
    print("  AMINA Care — Dev Account Seeder")
    print(f"  API: {api_base}")
    print("═" * 50)

    for acc in DEV_ACCOUNTS:
        try:
            r = requests.post(
                f"{api_base}/api/v1/auth/signup/email",
                json=acc,
                timeout=10,
            )
            d = r.json()
            if d.get("success"):
                print(f"  {OK}  Created: {acc['email']}  (id={d['patient']['id']})")
            elif "already registered" in (d.get("error") or ""):
                print(f"  {WARN}  Already exists: {acc['email']} — skipped")
            else:
                print(f"  {FAIL}  Failed: {acc['email']} — {d.get('error')}")
        except Exception as e:
            print(f"  {FAIL}  Error for {acc['email']}: {e}")

    print("\n" + "═" * 50)
    print("  Login credentials (all accounts):")
    print("  ─────────────────────────────────")
    for acc in DEV_ACCOUNTS:
        print(f"  {acc['name']:20s}  {acc['email']:30s}  {acc['password']}")
    print("═" * 50 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    args = parser.parse_args()
    seed(args.api)
