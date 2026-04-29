#!/usr/bin/env python3
"""
AMINA Care — SMS Routing E2E Test
===================================
Tests live SMS delivery for each country routing tier:

  +220 (Gambia)    → Africa's Talking
  +91  (India)     → Twilio
  +57  (Colombia)  → Twilio
  TextBelt fallback (free tier, any number)

Two modes:
  --direct   Import service layer and call providers directly (no API server needed)
  --api      Send via POST /caregiver/alert/send endpoint (server must be running)

Usage:
    # Test a single number directly (no server needed):
    python scripts/test_sms_routing_e2e.py --direct --to +919876543210

    # Test all tiers with one number per country:
    python scripts/test_sms_routing_e2e.py --direct \
        --india   +919876543210 \
        --colombia +573001234567 \
        --gambia  +2207654321

    # Test via running API server:
    python scripts/test_sms_routing_e2e.py --api \
        --patient-id P_ABC123 \
        --india +919876543210

    # Dry-run: show what WOULD be sent without calling any provider:
    python scripts/test_sms_routing_e2e.py --dry-run --to +919876543210

Required .env / environment variables:
    TWILIO_ACCOUNT_SID    ACxxxxxxxxxxxxxxxx
    TWILIO_AUTH_TOKEN     xxxxxxxxxxxxxxxx
    TWILIO_PHONE_NUMBER   +1xxxxxxxxxx     (your Twilio number)

    # Africa's Talking (Gambia):
    AT_USERNAME           your_AT_username
    AT_API_KEY            your_AT_api_key

    # India production DLT (optional — only needed after DLT approval):
    INDIA_DLT_ENTITY_ID   ...
    INDIA_DLT_TEMPLATE_ID ...
    TWILIO_INDIA_SENDER   AMINAC
"""

import argparse
import os
import sys

import requests as http

# ── Colour helpers ─────────────────────────────────────────────────────────────
OK   = "\033[92m✔\033[0m"
FAIL = "\033[91m✘\033[0m"
INFO = "\033[94mℹ\033[0m"
WARN = "\033[93m⚠\033[0m"
STEP = "\033[1;96m→\033[0m"

def ok(m):   print(f"  {OK}  {m}")
def fail(m): print(f"  {FAIL}  {m}")
def info(m): print(f"  {INFO}  {m}")
def warn(m): print(f"  {WARN}  {m}")
def step(n, m): print(f"\n{STEP} {n}: {m}")


# ── Sample alert messages (real-world templates) ────────────────────────────────

SAMPLE_ALERTS = {
    "+220": {
        "type": "high_bp",
        "patient": "Fatou Jallow",
        "value": "178/105",
        "msg": (
            "AMINA Care: ALERT — Fatou Jallow's blood pressure is high (178/105). "
            "Please help them rest, avoid salt, and seek care today. "
            "Reply HELP for guidance."
        ),
    },
    "+91": {
        "type": "emergency_triage",
        "patient": "Rajesh Kumar",
        "msg": (
            "AMINA Care: URGENT — Rajesh Kumar needs emergency care NOW. "
            "Please take them to the nearest hospital immediately. "
            "Reply HELP for the nearest facility."
        ),
    },
    "+57": {
        "type": "high_glucose",
        "patient": "Maria García",
        "value": "14.2 mmol/L",
        "msg": (
            "AMINA Care: ALERT — Maria García's blood sugar is high (14.2 mmol/L). "
            "Check if they have taken their medication. "
            "Reply HELP for guidance."
        ),
    },
}

def _get_sample(to: str) -> str:
    for prefix, data in SAMPLE_ALERTS.items():
        if to.startswith(prefix):
            return data["msg"]
    return (
        "AMINA Care: Health update for your patient. "
        "Please check in with them. Reply HELP for guidance."
    )


# ── Environment check ──────────────────────────────────────────────────────────

def check_env():
    print("\n" + "─" * 60)
    print("  Environment check")
    print("─" * 60)

    twilio_sid   = os.getenv("TWILIO_ACCOUNT_SID", "")
    twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "")
    twilio_from  = os.getenv("TWILIO_PHONE_NUMBER", "")
    at_user      = os.getenv("AT_USERNAME", "")
    at_key       = os.getenv("AT_API_KEY", "")

    twilio_ready = bool(twilio_sid and twilio_token and twilio_from)
    at_ready     = bool(at_user and at_key)

    if twilio_ready:
        ok(f"Twilio configured (SID: {twilio_sid[:8]}… | from: {twilio_from})")
    else:
        warn("Twilio NOT configured — India/Colombia SMS will fail")
        info("Set: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER")

    if at_ready:
        ok(f"Africa's Talking configured (user: {at_user})")
    else:
        warn("Africa's Talking NOT configured — Gambia SMS will fall through to Twilio/TextBelt")
        info("Set: AT_USERNAME, AT_API_KEY")

    # India DLT
    dlt_entity = os.getenv("INDIA_DLT_ENTITY_ID", "")
    if dlt_entity:
        ok(f"India DLT configured (entity: {dlt_entity[:8]}…)")
    else:
        info("India DLT not set (optional — only needed after DLT registration at vilpower.in)")

    return twilio_ready, at_ready


# ── Direct service layer test ──────────────────────────────────────────────────

def test_direct(numbers: dict, dry_run: bool):
    """Call _route_sms directly — no HTTP, no server needed."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

    try:
        from src.services.caregiver_alerts import _route_sms, _send_twilio, _send_africas_talking
        from src.config import settings
    except ImportError as e:
        print(f"\n  {FAIL}  Cannot import service layer: {e}")
        print("       Run from the haystack-chatqna/ directory.\n")
        sys.exit(1)

    twilio_ready, at_ready = check_env()
    results = []

    for country, to in numbers.items():
        if not to:
            continue

        body = _get_sample(to)

        step(country, f"Sending to {to}")
        info(f"Message: {body[:80]}…")

        if dry_run:
            warn("DRY RUN — no SMS sent")
            provider = "Africa's Talking" if to.startswith('+220') else 'Twilio'
            info(f"Would route: {to} → {provider}")
            results.append((to, True, "dry_run"))
            continue

        sent, method = _route_sms(to, body)
        if sent:
            ok(f"Sent via {method}")
            results.append((to, True, method))
        else:
            fail(f"Failed (method tried: {method})")
            results.append((to, False, method))

    _print_summary(results, dry_run)


# ── API test (via running server) ──────────────────────────────────────────────

def test_via_api(api_base: str, patient_id: str, numbers: dict, dry_run: bool):
    """POST /caregiver/alert/send for each number — server must be running."""

    step("API", f"Server: {api_base}")
    _, _ = check_env()
    results = []

    for country, to in numbers.items():
        if not to:
            continue

        # Determine alert type from country sample
        sample = next(
            (v for k, v in SAMPLE_ALERTS.items() if to.startswith(k)),
            {"type": "general", "patient": "Test Patient"},
        )

        step(country, f"Sending to {to} via API")
        info(f"Alert type: {sample['type']}")

        if dry_run:
            warn("DRY RUN — request not sent")
            results.append((to, True, "dry_run"))
            continue

        try:
            r = http.post(
                f"{api_base}/api/v1/caregiver/alert/send",
                json={
                    "patient_id":      patient_id,
                    "alert_type":      sample["type"],
                    "caregiver_phones": [to],
                    "severity":        "high",
                    "message":         f"Test alert for {sample['patient']}",
                },
                timeout=20,
            )
            d = r.json()
            sent = d.get("sent", 0) > 0
            if sent:
                method = d.get("results", [{}])[0].get("method", "unknown")
                ok(f"Sent via {method}")
                results.append((to, True, method))
            else:
                fail(f"Response: {d}")
                results.append((to, False, str(d)))
        except Exception as exc:
            fail(f"Request failed: {exc}")
            results.append((to, False, str(exc)))

    _print_summary(results, dry_run)


# ── Test inbound webhook ───────────────────────────────────────────────────────

def test_inbound_webhook(api_base: str):
    """
    Simulate an inbound HELP SMS from a caregiver (Twilio format).
    Twilio sends form-encoded POST to /caregiver/sms/reply.
    """
    step("INBOUND", "Simulating caregiver HELP reply (Twilio webhook format)")
    info("This is what Twilio POSTs when a caregiver replies 'HELP'")

    for from_num, keyword in [("+919876543210", "HELP"), ("+573001234567", "STOP")]:
        try:
            r = http.post(
                f"{api_base}/api/v1/caregiver/sms/reply",
                data={"From": from_num, "Body": keyword},   # Twilio sends form data
                timeout=10,
            )
            d = r.json()
            ok(f"{from_num} sent '{keyword}' → server responded: {d}")
        except Exception as exc:
            fail(f"Webhook test failed for {from_num}: {exc}")

    print()
    info("To register this webhook in Twilio console:")
    info(f"  Messaging → Your Number → Webhook URL:")
    info(f"  {api_base}/api/v1/caregiver/sms/reply")
    info("  Method: HTTP POST")


# ── Summary ────────────────────────────────────────────────────────────────────

def _print_summary(results, dry_run):
    print("\n" + "═" * 60)
    print("  SMS Routing Test Summary")
    print("═" * 60)
    for to, sent, method in results:
        prefix = to[:3]
        country = {"+22": "Gambia", "+91": "India", "+57": "Colombia"}.get(prefix, "Other")
        status = f"{OK} {method}" if sent else f"{FAIL} failed ({method})"
        print(f"  {country:10s} {to:18s} {status}")
    print("═" * 60)
    if dry_run:
        print(f"  {WARN}  Dry run — no actual SMS sent\n")
    elif all(s for _, s, _ in results):
        print(f"  {OK}  All messages delivered\n")
    else:
        failed = [to for to, s, _ in results if not s]
        print(f"  {FAIL}  Some deliveries failed: {', '.join(failed)}\n")
        _print_troubleshoot()


def _print_troubleshoot():
    print("  Troubleshooting:")
    print("  ─────────────────────────────────────────────────────")
    print("  Twilio 'unverified number' error:")
    print("    • Trial account: verify recipient at console.twilio.com/phone-numbers/verified")
    print("    • Production: upgrade Twilio account to remove verified-only restriction")
    print()
    print("  India (+91) delivery failure:")
    print("    • Twilio trial works to verified numbers only")
    print("    • For production: register DLT entity + template at vilpower.in")
    print("    • Set INDIA_DLT_ENTITY_ID, INDIA_DLT_TEMPLATE_ID, TWILIO_INDIA_SENDER in .env")
    print()
    print("  Africa's Talking (+220) failure:")
    print("    • Check AT_USERNAME and AT_API_KEY are set correctly")
    print("    • Use sandbox mode for testing: AT_USERNAME=sandbox")
    print()


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMINA Care SMS routing E2E test")

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--direct", action="store_true", default=True,
                      help="Test via service layer directly (default, no server needed)")
    mode.add_argument("--api", action="store_true",
                      help="Test via running API server")

    parser.add_argument("--api-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--patient-id", default="P_TEST001", help="Patient ID (--api mode)")

    # Target numbers
    parser.add_argument("--to",      help="Send to this single number (any country)")
    parser.add_argument("--india",   help="India recipient number (+91…)")
    parser.add_argument("--colombia",help="Colombia recipient number (+57…)")
    parser.add_argument("--gambia",  help="Gambia recipient number (+220…)")

    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be sent without calling any provider")
    parser.add_argument("--test-inbound", action="store_true",
                        help="Also test inbound SMS webhook (--api URL must be running)")

    args = parser.parse_args()

    # Build number map
    numbers = {}
    if args.to:
        numbers["Custom"] = args.to
    if args.india:
        numbers["India (+91)"] = args.india
    if args.colombia:
        numbers["Colombia (+57)"] = args.colombia
    if args.gambia:
        numbers["Gambia (+220)"] = args.gambia

    if not numbers:
        parser.error(
            "Provide at least one number: --to, --india, --colombia, or --gambia\n"
            "Example: python scripts/test_sms_routing_e2e.py --india +919876543210"
        )

    print("\n" + "═" * 60)
    print("  AMINA Care — SMS Routing E2E Test")
    print("═" * 60)

    if args.api:
        test_via_api(args.api_url, args.patient_id, numbers, args.dry_run)
        if args.test_inbound:
            test_inbound_webhook(args.api_url)
    else:
        test_direct(numbers, args.dry_run)
        if args.test_inbound:
            test_inbound_webhook(args.api_url)
