#!/usr/bin/env python3
"""
AMINA Care — Caregiver Dev Account Seeder
==========================================
Creates a caregiver account linked to the dev patient account.

Flow:
  1. Login as patient (testuser@aminacare.dev / Amina2026)
  2. Generate caregiver invite code
  3. Register caregiver (name, phone, PIN)

Usage:
    python scripts/seed_caregiver_account.py
    python scripts/seed_caregiver_account.py --api http://your-server:8000
"""

import argparse
import sys
import requests

# ── Dev caregiver credentials ────────────────────────────────────────────────
CAREGIVER = {
    "name":         "Sarah Care",
    "phone":        "+220 9000001",     # Gambia number, easy to remember
    "pin":          "1234",
    "relationship": "chw",
}

# Patient whose account we'll link to
PATIENT_EMAIL    = "testuser@aminacare.dev"
PATIENT_PASSWORD = "Amina2026"


def banner(text):
    print(f"\n{'='*55}")
    print(f"  {text}")
    print(f"{'='*55}")


def ok(text):
    print(f"  [OK] {text}")


def fail(text):
    print(f"  [FAIL] {text}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000",
                        help="Backend base URL")
    args = parser.parse_args()
    base = args.api.rstrip("/")

    banner("Step 1 — Log in as patient")
    resp = requests.post(f"{base}/api/v1/auth/login/email",
                         json={"email": PATIENT_EMAIL, "password": PATIENT_PASSWORD},
                         timeout=10)
    if resp.status_code != 200:
        fail(f"Patient login failed: {resp.status_code} {resp.text[:200]}")
        sys.exit(1)
    patient_token = resp.json().get("token") or resp.json().get("access_token")
    if not patient_token:
        fail(f"No token in response: {resp.json()}")
        sys.exit(1)
    ok(f"Logged in as {PATIENT_EMAIL}")

    banner("Step 2 — Generate caregiver invite code")
    resp = requests.post(
        f"{base}/api/v1/caregiver/invite",
        headers={"Authorization": f"Bearer {patient_token}"},
        json={
            "permissions": ["vitals", "medications", "alerts", "consultations"],
            "note": "Dev caregiver account",
        },
        timeout=10,
    )
    if resp.status_code != 200:
        fail(f"Invite generation failed: {resp.status_code} {resp.text[:200]}")
        sys.exit(1)
    invite_code = resp.json()["invite_code"]
    ok(f"Invite code: {invite_code} (24h TTL)")

    banner("Step 3 — Register caregiver")
    resp = requests.post(
        f"{base}/api/v1/caregiver/register",
        json={
            "invite_code":  invite_code,
            "phone":        CAREGIVER["phone"],
            "name":         CAREGIVER["name"],
            "pin":          CAREGIVER["pin"],
            "relationship": CAREGIVER["relationship"],
        },
        timeout=10,
    )
    if resp.status_code == 409:
        # Already registered — try login to verify
        print(f"  [INFO] Caregiver phone already registered, verifying login...")
        resp2 = requests.post(
            f"{base}/api/v1/caregiver/login",
            json={"phone": CAREGIVER["phone"], "pin": CAREGIVER["pin"]},
            timeout=10,
        )
        if resp2.status_code == 200:
            data = resp2.json()
            ok(f"Caregiver already exists and login works")
            _print_credentials(data)
            return
        else:
            fail(f"Conflict and login also failed: {resp2.text[:200]}")
            sys.exit(1)

    if resp.status_code != 200:
        fail(f"Registration failed: {resp.status_code} {resp.text[:200]}")
        sys.exit(1)

    data = resp.json()
    ok(f"Caregiver registered: {data.get('caregiver_id')}")
    _print_credentials(data)


def _print_credentials(data):
    banner("Caregiver Account Created")
    print(f"  Name          : {CAREGIVER['name']}")
    print(f"  Phone         : {CAREGIVER['phone']}")
    print(f"  PIN           : {CAREGIVER['pin']}")
    print(f"  Caregiver ID  : {data.get('caregiver_id', 'N/A')}")
    print(f"  Linked patient: {data.get('patient_id', 'N/A')}")
    print(f"  Permissions   : {', '.join(data.get('permissions', []))}")
    print()
    print("  Login in frontend:")
    print(f"    -> Click 'Caregiver Login' on the auth screen")
    print(f"    -> Country: Gambia (+220)   Phone: 9000001")
    print(f"    -> PIN: 1234")
    print()


if __name__ == "__main__":
    main()
