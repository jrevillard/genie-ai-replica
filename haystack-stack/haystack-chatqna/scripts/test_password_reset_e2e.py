#!/usr/bin/env python3
"""
AMINA Care — Password Reset E2E Test
======================================
Exercises the full password-recovery flow against the running API server:

  Step 1  POST /auth/signup/email          → create a test patient
  Step 2  POST /auth/password/reset/request → request reset link (bot email)
  Step 3  (capture dev_token from response when SMTP is not configured)
  Step 4  POST /auth/password/reset/confirm → set a new password
  Step 5  POST /auth/login/email            → verify new password works
  Step 6  POST /auth/login/email            → verify OLD password is rejected

Usage:
    # Against local dev server (default):
    python scripts/test_password_reset_e2e.py

    # Against a remote server:
    python scripts/test_password_reset_e2e.py --api http://your-server:8000

    # Use an existing patient (skip signup):
    python scripts/test_password_reset_e2e.py --email patient@example.com --skip-signup

    # Also test the email service layer directly (no HTTP):
    python scripts/test_password_reset_e2e.py --test-email-service
"""

import argparse
import json
import sys
import uuid
import os

import requests

# ── Colour helpers ────────────────────────────────────────────────────────────

OK    = "\033[92m✔\033[0m"
FAIL  = "\033[91m✘\033[0m"
INFO  = "\033[94mℹ\033[0m"
WARN  = "\033[93m⚠\033[0m"
STEP  = "\033[1;96m→\033[0m"


def ok(msg):   print(f"  {OK}  {msg}")
def fail(msg): print(f"  {FAIL}  {msg}"); sys.exit(1)
def info(msg): print(f"  {INFO}  {msg}")
def warn(msg): print(f"  {WARN}  {msg}")
def step(n, msg): print(f"\n{STEP} Step {n}: {msg}")


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def post(api_base: str, path: str, body: dict) -> dict:
    url = f"{api_base}/api/v1{path}"
    try:
        r = requests.post(url, json=body, timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.ConnectionError:
        fail(f"Cannot connect to {url} — is the server running?")
    except Exception as exc:
        fail(f"Request to {path} failed: {exc}")


# ── Direct email service test (bypasses HTTP, tests SMTP/log directly) ────────

def test_email_service_direct(recipient: str):
    """Import and call the email service layer directly — no HTTP."""
    print("\n" + "─" * 60)
    print("  Direct email service test")
    print("─" * 60)

    # Ensure src is importable when running from project root
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

    try:
        from src.services.email_service import send_password_reset_email
        from src.config import settings
    except ImportError as exc:
        fail(f"Cannot import service layer: {exc}\n       Run from the haystack-chatqna directory.")

    smtp_host = getattr(settings, "SMTP_HOST", "")
    if smtp_host:
        info(f"SMTP configured: {smtp_host}:{getattr(settings, 'SMTP_PORT', 587)}")
        info(f"Sending real email to {recipient} …")
    else:
        warn("SMTP not configured — email will be printed to stdout/log (dev mode)")

    fake_token = uuid.uuid4().hex
    sent = send_password_reset_email(
        to_email=recipient,
        patient_name="Test Patient",
        reset_token=fake_token,
    )

    if smtp_host:
        if sent:
            ok(f"Email delivered to {recipient}")
        else:
            fail(f"SMTP configured but delivery failed — check SMTP credentials")
    else:
        ok("Email body printed to log (dev mode — set SMTP_HOST to send real emails)")

    print()


# ── Main E2E flow ─────────────────────────────────────────────────────────────

def run_e2e(api_base: str, email: str, skip_signup: bool):
    old_password = "Test1234"
    new_password = "NewPass99"
    name         = "AMINA Test Patient"

    print("\n" + "═" * 60)
    print("  AMINA Care — Password Reset E2E Test")
    print(f"  API:   {api_base}")
    print(f"  Email: {email}")
    print("═" * 60)

    # ── Step 1: Signup ────────────────────────────────────────────────────────
    if not skip_signup:
        step(1, "Create test patient (email signup)")
        d = post(api_base, "/auth/signup/email", {
            "email": email, "password": old_password,
            "name": name, "age": 30, "gender": "other",
            "region": "Kanifing", "conditions": [], "language": "english",
        })
        if d.get("success"):
            ok(f"Patient created: id={d['patient']['id']}")
        elif "already registered" in (d.get("error") or ""):
            warn("Email already registered — continuing with existing account")
        else:
            fail(f"Signup failed: {d.get('error')}")
    else:
        step(1, "Skipping signup (--skip-signup)")
        info(f"Using existing account: {email}")

    # ── Step 2: Request password reset ───────────────────────────────────────
    step(2, "Request password reset (AMINA bot sends email)")
    d = post(api_base, "/auth/password/reset/request", {"email": email})

    if not d.get("success"):
        fail(f"Reset request failed: {d}")

    ok("Reset request accepted")

    dev_token = d.get("dev_token")
    if dev_token:
        warn("SMTP not configured — dev_token returned in response (not in production!)")
        info(f"dev_token: {dev_token}")
    else:
        ok("Email sent via SMTP (dev_token not exposed — production behaviour)")
        info("Check your inbox for the reset link from AMINA Care")
        # In production we cannot proceed automatically — user must click the link
        print("\n  ⚠  SMTP is configured. Cannot auto-proceed.")
        print("     Click the link in the email then re-run with:")
        print(f"     --token <token> flag (not yet implemented) or use the frontend.\n")
        return

    # ── Step 3: Confirm reset with dev_token ──────────────────────────────────
    step(3, "Confirm reset with token from email link")
    d = post(api_base, "/auth/password/reset/confirm", {
        "token": dev_token, "new_password": new_password,
    })
    if d.get("success"):
        ok("Password updated successfully")
    else:
        fail(f"Reset confirm failed: {d.get('error')}")

    # ── Step 4: Login with NEW password ──────────────────────────────────────
    step(4, "Login with NEW password (should succeed)")
    d = post(api_base, "/auth/login/email", {"email": email, "password": new_password})
    if d.get("success"):
        ok(f"Login OK  — token: {d['token'][:40]}…")
        ok(f"Patient: {d['patient']['name']} (id={d['patient']['id']})")
    else:
        fail(f"Login with new password failed: {d.get('error')}")

    # ── Step 5: Login with OLD password must fail ─────────────────────────────
    step(5, "Login with OLD password (should be rejected)")
    d = post(api_base, "/auth/login/email", {"email": email, "password": old_password})
    if not d.get("success"):
        ok(f"Old password correctly rejected: \"{d.get('error')}\"")
    else:
        fail("Old password still works — password was NOT updated correctly!")

    # ── Step 6: Token replay must fail ───────────────────────────────────────
    step(6, "Replay used token (should be rejected — one-time use)")
    d = post(api_base, "/auth/password/reset/confirm", {
        "token": dev_token, "new_password": "ShouldNotWork",
    })
    if not d.get("success"):
        ok(f"Token correctly invalidated: \"{d.get('error')}\"")
    else:
        fail("Token was accepted a second time — one-time use NOT enforced!")

    # ── Done ──────────────────────────────────────────────────────────────────
    print("\n" + "═" * 60)
    print(f"  {OK}  All steps passed — password reset flow is working correctly.")
    print("═" * 60 + "\n")


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMINA password reset E2E test")
    parser.add_argument("--api",  default="http://localhost:8000", help="API base URL")
    parser.add_argument("--email", default=f"amina_test_{uuid.uuid4().hex[:6]}@example.com",
                        help="Email address to use (auto-generated if omitted)")
    parser.add_argument("--skip-signup", action="store_true",
                        help="Skip signup — use an existing account")
    parser.add_argument("--test-email-service", action="store_true",
                        help="Also test the email service layer directly (requires src/ on PYTHONPATH)")
    args = parser.parse_args()

    if args.test_email_service:
        test_email_service_direct(args.email)

    run_e2e(args.api, args.email, args.skip_signup)
