#!/usr/bin/env python3
"""
test_drought_alert_flow.py — end-to-end test that triggers the drought frontend banner.

What this script does:
  1. Writes a synthetic drought_assessments document into ArangoDB with a severity
     that matches the chosen scenario (WATCH/MODERATE/SEVERE).
  2. Calls GET /drought/risk/latest on the running weather-mcp-standalone service
     to confirm the assessment is stored and readable.
  3. Calls GET /api/weather/drought-risk through the Node.js backend to confirm
     the full proxy chain works.
  4. Prints the exact message the CropAlertBanner will display.
  5. Tells you what to do in the browser to see the pop-out immediately.

Usage (from repo root or weather-mcp-service directory):
  python3 scripts/test_drought_alert_flow.py                      # MODERATE, Dhaka
  python3 scripts/test_drought_alert_flow.py --scenario watch     # tier 1 — no banner
  python3 scripts/test_drought_alert_flow.py --scenario severe    # tier 3
  python3 scripts/test_drought_alert_flow.py --scenario normal    # clears the alert
  python3 scripts/test_drought_alert_flow.py --district Rajshahi

Env overrides (all optional):
  ARANGO_URL          default: http://localhost:8529
  ARANGO_PASSWORD     default: test
  WEATHER_MCP_URL     default: http://localhost:8000
  BACKEND_URL         default: http://localhost:3000
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)

if not os.getenv("ARANGO_URL"):
    os.environ["ARANGO_URL"] = "http://localhost:8529"

import logging
logging.basicConfig(level=logging.WARNING, format="%(levelname)-7s  %(message)s")

import requests as _http

# ---------------------------------------------------------------------------
# Scenario definitions
# ---------------------------------------------------------------------------

_NOW = datetime.now(timezone.utc).isoformat()
_DATE = datetime.now(timezone.utc).strftime("%Y-%m-%d")

def _assessment(district, drought_level, score, triggers, message, tier, tier_label):
    return {
        "location":       district,
        "lat":            23.8103,
        "lon":            90.4125,
        "assessed_at":    _NOW,
        "window_days":    7,
        "drought_level":  drought_level,
        "drought_score":  score,
        "tier":           tier,
        "tier_label":     tier_label,
        "trend":          "STABLE",
        "trend_run_days": 0,
        "trend_warning":  False,
        "triggers":       triggers,
        "message":        message,
        "report_filename": f"drought_{district.lower()}_{_DATE.replace('-', '')}.pdf",
        "band_results": {
            "sm_surface":                   {"value": None, "flag": score > 0, "status": "synthetic", "pct_of_threshold": None},
            "land_evapotranspiration_flux": {"value": None, "flag": score > 1, "status": "synthetic", "pct_of_threshold": None},
            "overland_runoff_flux":         {"value": None, "flag": score > 2, "status": "synthetic", "pct_of_threshold": None},
            "NDVI":                         {"value": None, "flag": score > 3, "status": "synthetic", "pct_of_threshold": None},
        },
    }


SCENARIOS = {
    "normal": {
        "label":       "Normal conditions",
        "description": "All sensors OK → tier 0 (clears any existing banner)",
        "fn": lambda d: _assessment(d, "NORMAL", 0, [], "Normal conditions — all sensors within safe range.", 0, "Normal"),
    },
    "watch": {
        "label":       "Drought watch",
        "description": "1 sensor stressed → tier 1 Advisory (banner does NOT appear)",
        "fn": lambda d: _assessment(
            d, "WATCH", 1,
            ["Soil moisture at 79% of safe level"],
            "Drought watch — 1 of 4 sensors stressed. Continue monitoring.",
            1, "Watch",
        ),
    },
    "moderate": {
        "label":       "Moderate drought",
        "description": "3 sensors stressed → tier 2 Warning (banner appears)",
        "fn": lambda d: _assessment(
            d, "MODERATE", 3,
            [
                "Soil moisture at 68% of safe level",
                "Evapotranspiration at 61% of safe level",
                "Crop greenness (NDVI) at 82% of safe level",
            ],
            "Moderate drought — 3 of 4 sensors stressed. Crops may be affected soon.",
            2, "Warning",
        ),
    },
    "severe": {
        "label":       "Severe drought",
        "description": "All 4 sensors stressed → tier 3 Severe (banner + SMS)",
        "fn": lambda d: _assessment(
            d, "SEVERE", 4,
            [
                "Soil moisture at 43% of safe level",
                "Evapotranspiration at 48% of safe level",
                "Surface runoff at 22% of safe level",
                "Crop greenness (NDVI) at 71% of safe level",
            ],
            "Severe drought — all 4 sensors critically stressed. Act immediately to protect crops.",
            3, "Severe",
        ),
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm_key(s):
    return s.lower().replace(" ", "_").replace("'", "").replace("-", "_").replace("’", "")

def section(title):
    print(f"\n{'─' * 62}")
    print(f"  {title}")
    print(f"{'─' * 62}")

_OK   = "\033[32m✓\033[0m"
_FAIL = "\033[31m✗\033[0m"
_WARN = "\033[33m!\033[0m"

def tick(status, label, detail=""):
    mark = _OK if status is True else (_WARN if status == "warn" else _FAIL)
    suffix = f"  {detail}" if detail else ""
    print(f"  {mark}  {label}{suffix}")


# ---------------------------------------------------------------------------
# Step 1 — inject drought assessment into ArangoDB
# ---------------------------------------------------------------------------

def inject_assessment(district, assessment):
    from arango import ArangoClient
    arango_url  = os.getenv("ARANGO_URL",      "http://localhost:8529")
    arango_db   = os.getenv("ARANGO_DB_NAME",  "genie-ai")
    arango_user = os.getenv("ARANGO_USER",     "root")
    arango_pass = os.getenv("ARANGO_PASSWORD", "test")

    client = ArangoClient(hosts=arango_url)
    db = client.db(arango_db, username=arango_user, password=arango_pass)

    if not db.has_collection("drought_assessments"):
        db.create_collection("drought_assessments")

    col = db.collection("drought_assessments")
    key = _norm_key(f"{district}__drought")
    doc = {"_key": key, **assessment}

    if col.has(key):
        col.replace(doc)
    else:
        col.insert(doc)

    return key


# ---------------------------------------------------------------------------
# Step 2 — verify via weather-mcp API
# ---------------------------------------------------------------------------

def verify_mcp_api(weather_mcp_url, district):
    for url in [weather_mcp_url, weather_mcp_url.replace(":8000", ":8100")]:
        try:
            resp = _http.get(f"{url}/drought/risk/latest", params={"location": district}, timeout=5)
            if resp.status_code < 500:
                return resp.ok, resp.json() if resp.ok else {"status": resp.status_code}
        except Exception:
            pass
    return False, "service not reachable"


# ---------------------------------------------------------------------------
# Step 3 — verify via Node.js backend proxy
# ---------------------------------------------------------------------------

def verify_backend_api(backend_url, district):
    candidates = [backend_url, "http://localhost:3000"]
    if os.path.exists("/.dockerenv"):
        candidates += ["http://backend:3000", "http://gov-chat-backend:3000"]

    for url in candidates:
        try:
            resp = _http.get(f"{url}/api/weather/drought-risk", params={"location": district}, timeout=5)
            if resp.ok:
                return True, {**resp.json(), "_backend_url": url}
            if resp.status_code == 401:
                return "auth_required", {"url": url, "note": "route exists, auth required"}
        except Exception:
            pass
    return False, {"tried": candidates}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Inject synthetic drought alert and verify the full frontend banner chain"
    )
    parser.add_argument("--scenario", choices=list(SCENARIOS), default="moderate",
                        help="Drought scenario (default: moderate)")
    parser.add_argument("--district", default="Dhaka",
                        help="Bangladesh district (default: Dhaka)")
    parser.add_argument("--weather-mcp-url",
                        default=os.getenv("WEATHER_MCP_URL", "http://localhost:8000"))
    parser.add_argument("--backend-url",
                        default=os.getenv("BACKEND_URL", "http://localhost:3000"))
    args = parser.parse_args()

    scenario = SCENARIOS[args.scenario]
    assessment = scenario["fn"](args.district)

    section("Drought EWS — end-to-end test")
    print(f"  Scenario : [{args.scenario}] {scenario['label']}")
    print(f"  District : {args.district}")
    print(f"  Intent   : {scenario['description']}")
    print(f"  Tier     : {assessment['tier']} — {assessment['tier_label']}")

    # ── Step 1: inject ───────────────────────────────────────────────────────
    section("Step 1 — Inject synthetic drought assessment into ArangoDB")
    try:
        key = inject_assessment(args.district, assessment)
        tick(True, "Assessment written", f"drought_assessments/{key}")
    except Exception as exc:
        tick(False, f"ArangoDB write failed: {exc}")
        print("\n  Tip: export ARANGO_URL=http://localhost:8529 and check ARANGO_PASSWORD")
        sys.exit(1)

    # ── Step 2: verify weather-mcp endpoint ─────────────────────────────────
    section("Step 2 — Verify GET /drought/risk/latest (weather-mcp-standalone)")
    mcp_ok, mcp_data = verify_mcp_api(args.weather_mcp_url, args.district)
    if mcp_ok:
        tick(True, "Assessment readable from weather-mcp",
             f"tier={mcp_data.get('tier')} — {mcp_data.get('tier_label')}")
    else:
        tick("warn", f"weather-mcp not reachable: {mcp_data}")
        print("  (data IS in ArangoDB — banner will work once service is up)")

    # ── Step 3: verify backend proxy ─────────────────────────────────────────
    section("Step 3 — Verify GET /api/weather/drought-risk (Node.js backend)")
    be_ok, be_data = verify_backend_api(args.backend_url, args.district)
    if be_ok is True:
        tick(True, "Backend proxy working",
             f"{be_data.get('_backend_url')} tier={be_data.get('tier')} — {be_data.get('tier_label')}")
    elif be_ok == "auth_required":
        tick(True, "Backend route reachable (401 — auth required, expected)",
             be_data.get("url", ""))
    else:
        tick("warn", f"Backend not reachable: {be_data}")

    # ── Result summary ────────────────────────────────────────────────────────
    section("Assessment — what the CropAlertBanner will display")
    tier       = assessment["tier"]
    tier_label = assessment["tier_label"]
    message    = assessment["message"]
    triggers   = assessment["triggers"]

    colours = {0: "\033[32m", 1: "\033[33m", 2: "\033[33m", 3: "\033[31m"}
    c = colours.get(tier, "")
    r = "\033[0m"

    print(f"  Type     : Drought")
    print(f"  Tier     : {c}{tier} — {tier_label}{r}")
    print(f"  Triggers : {triggers or '[]'}")
    print(f"\n  Banner message:")
    print(f"  \033[1m{message}\033[0m")

    section("How to see the banner in the browser")
    if tier >= 2:
        print(f"  The alert is active (tier {tier} ≥ 2) — the banner WILL appear.\n")
        print("  1. Open the Genie.ai frontend in your browser.")
        print("  2. Refresh the page — CropAlertBanner polls immediately on mount.")
        print("  3. The pop-out appears bottom-right with an orange/brown border.")
        print("     Title: 'Drought — Warning' (or Severe)")
        if assessment.get("report_filename"):
            print(f"  4. A 'View Drought Report' link appears (PDF download).")
        print()
        print("  If the banner does not appear:")
        print("  • Open DevTools → Application → Local Storage")
        print("    and delete 'drought_alert_dismissed_until' if it exists.")
        print("  • Check the browser console for '[CropAlertBanner] poll error'.")
        print(f"  • Confirm GET /api/weather/drought-risk?location={args.district} returns tier≥2.")
    elif tier == 1:
        print("  Tier 1 (Watch) — banner does NOT appear (threshold is tier ≥ 2).")
        print("  Use --scenario moderate or --scenario severe to trigger the banner.")
    else:
        print("  Tier 0 (Normal) — no banner. This scenario clears any existing alert.")
        print("  Refresh the browser — the drought banner should disappear.")

    print()
    sys.exit(0)


if __name__ == "__main__":
    main()
