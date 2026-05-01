"""
AMINA — Seed the "admin patient" account
============================================
Creates a patient-side account whose email is in the ADMIN_PATIENT_EMAILS
allowlist. When the holder logs in via Email → AuthScreen, the resulting
JWT carries `role: "admin"` so they experience the normal patient UI BUT
gain the role-switcher pill + admin-bypass on care writes.

Run (from inside or outside the container):
    python scripts/seed_admin_patient.py
    python scripts/seed_admin_patient.py --email me@my.org --password MySecret123

The script uses the public /auth/signup/email endpoint (idempotent —
duplicate emails are detected + reported cleanly; no double-insert).

Default creds:
    email    admin@demo.aminacare
    password Amina2026

After seeding, the holder logs in via the AuthScreen → Email tab with
those credentials. No further setup required.
"""

from __future__ import annotations
import argparse
import os
import sys
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


DEFAULT_API      = os.getenv("API", "http://localhost:8000")
DEFAULT_EMAIL    = "admin@demo.aminacare"
DEFAULT_PASSWORD = "Amina2026"
DEFAULT_NAME     = "Admin Patient"


def signup(api: str, email: str, password: str, name: str) -> dict:
    r = requests.post(
        f"{api}/api/v1/auth/signup/email",
        json={
            "email":    email,
            "password": password,
            "name":     name,
            "age":      35,
            "gender":   "other",
            "region":   "Kanifing",
            "conditions": [],
            "language": "english",
        },
        timeout=20,
    )
    try:
        return {"status": r.status_code, **(r.json() or {})}
    except Exception:
        return {"status": r.status_code, "error": r.text[:300]}


def login(api: str, email: str, password: str) -> dict:
    r = requests.post(
        f"{api}/api/v1/auth/login/email",
        json={"email": email, "password": password},
        timeout=15,
    )
    try:
        return {"status": r.status_code, **(r.json() or {})}
    except Exception:
        return {"status": r.status_code, "error": r.text[:300]}


def decode_token_role(tok: str) -> str:
    """Print-only utility: peek at the role claim of a JWT we just
    received from our own login endpoint, purely so the operator can
    visually confirm the seed produced the expected role. The result
    is shown in a banner for human eyeballs and never used to gate
    any security decision -- the server already validated the
    signature when it minted the token. Skipping verification here
    avoids needing the JWT_SECRET inside this dev/seed script.
    """
    if not tok:
        return "(empty)"
    try:
        import jwt as pyjwt
        # Dev-script print-only peek (see docstring above); result not used for auth.
        payload = pyjwt.decode(tok, options={"verify_signature": False})  # nosemgrep: python.jwt.security.unverified-jwt-decode.unverified-jwt-decode
        return payload.get("role") or "(no role claim)"
    except Exception as e:
        return f"(decode failed: {e})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api",      default=DEFAULT_API)
    ap.add_argument("--email",    default=DEFAULT_EMAIL)
    ap.add_argument("--password", default=DEFAULT_PASSWORD)
    ap.add_argument("--name",     default=DEFAULT_NAME)
    args = ap.parse_args()

    print("=" * 64)
    print("  AMINA — Seed admin patient account")
    print("=" * 64)
    print(f"  API:      {args.api}")
    print(f"  Email:    {args.email}")
    print(f"  Password: {args.password}")
    print()

    # Step 1 — idempotent signup
    r = signup(args.api, args.email, args.password, args.name)
    already = "already" in str(r.get("error") or "").lower()
    if r.get("success"):
        print(f"  [OK]   signup created (patient_id={r.get('patient', {}).get('id')})")
    elif already:
        print(f"  [SKIP] account already exists — re-using it")
    else:
        print(f"  [WARN] signup returned: {r}")

    # Step 2 — verify login works + JWT has role=admin (which proves the
    #          ADMIN_PATIENT_EMAILS env var is correctly wired)
    login_r = login(args.api, args.email, args.password)
    tok = login_r.get("token") or ""
    role = decode_token_role(tok)
    success = bool(login_r.get("success") or tok)
    print()
    print(f"  login: http={login_r.get('status')}  success={success}")
    print(f"  JWT role claim: {role}")
    print()

    if not success:
        print("  [FAIL] login returned no token — check the backend logs")
        return 1
    if role != "admin":
        print(f"  [WARN] expected role='admin', got {role!r}")
        print(f"         Check that ADMIN_PATIENT_EMAILS includes {args.email!r}")
        print(f"         (currently only applied after a container restart)")
        return 2

    print("  [PASS] admin-patient flow is fully wired.")
    print()
    print("=" * 64)
    print(f"  Log in via AuthScreen → Email tab:")
    print(f"      email:    {args.email}")
    print(f"      password: {args.password}")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    sys.exit(main())
