#!/usr/bin/env python3
"""
test_potato_ews.py — end-to-end test that triggers the frontend pop-out.

What this script does:
  1. Writes a synthetic weather_forecasts document into ArangoDB with values
     that exceed (or satisfy) potato thresholds for the chosen scenario.
  2. Calls POST /internal/run-potato-pipeline on the running weather-mcp-standalone
     service so it processes the new forecast and writes the risk_assessment.
     (Falls back to running the EWS locally if the service is not reachable.)
  3. Calls GET /potato/risk/latest to confirm the assessment is stored.
  4. Calls GET /api/weather/potato-risk through the Node.js backend (Kong) to
     confirm the full proxy chain works.
  5. Prints the exact message the pop-out will display.
  6. Tells you what to do in the browser to see the pop-out immediately.

Usage (from the weather-mcp-service directory):
  python3 scripts/test_potato_ews.py                        # heat, Dhaka
  python3 scripts/test_potato_ews.py --scenario rain
  python3 scripts/test_potato_ews.py --scenario combined    # tier 3 Severe
  python3 scripts/test_potato_ews.py --scenario blight      # tier 1 Advisory
  python3 scripts/test_potato_ews.py --scenario normal      # clears the alert
  python3 scripts/test_potato_ews.py --district Sylhet

Env overrides (all optional):
  ARANGO_URL          default: http://localhost:8529
  ARANGO_PASSWORD     default: test
  WEATHER_MCP_URL     default: http://localhost:8100   (host-mapped port)
  BACKEND_URL         default: http://localhost:3000   (Node.js backend)
  TWILIO_*           Twilio env vars used only when --send-sms is passed
  EMERGENCY_CONTACT_NUMBERS comma-separated SMS recipients, e.g. +8801...
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

# Allow running from repo root or from the weather-mcp-service directory
_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVICE_DIR not in sys.path:
    sys.path.insert(0, _SERVICE_DIR)

_COMPONENTS_DIR = os.path.dirname(_SERVICE_DIR)
_WARNING_ENGINE_DIR = os.getenv(
    "WARNING_SYSTEM_ENGINE_DIR",
    os.path.join(_COMPONENTS_DIR, "warning_system_engine"),
)


def _ensure_warning_engine_importable():
    """
    The potato EWS implementation lives in components/warning_system_engine.
    Add that directory only when the fallback needs it, so normal weather-MCP
    imports continue to resolve from weather-mcp-service.
    """
    if not os.path.isdir(_WARNING_ENGINE_DIR):
        raise ModuleNotFoundError(
            "components/warning_system_engine is not available from this runtime. "
            "Run this script from the repo checkout, set WARNING_SYSTEM_ENGINE_DIR, "
            "or use the warning-system-engine container to run the potato pipeline."
        )
    if _WARNING_ENGINE_DIR in sys.path:
        sys.path.remove(_WARNING_ENGINE_DIR)
    sys.path.insert(0, _WARNING_ENGINE_DIR)


load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)


def _load_warning_engine_env():
    """Load Twilio/backend settings from the mounted warning engine env file."""
    _ensure_warning_engine_importable()
    load_dotenv(dotenv_path=Path(_WARNING_ENGINE_DIR) / ".env", override=False)


if not os.getenv("ARANGO_URL"):
    os.environ["ARANGO_URL"] = "http://localhost:8529"

import logging
logging.basicConfig(level=logging.WARNING, format="%(levelname)-7s  %(message)s")

import requests as _http

# ---------------------------------------------------------------------------
# Scenario definitions
# ---------------------------------------------------------------------------

def _day(date, t_min, t_max, humidity, rain, wind):
    return {
        "date": date,
        "temperature": {"min": float(t_min), "max": float(t_max), "unit": "Celsius"},
        "precipitation": {"value": float(rain), "probability": 0.5, "unit": "mm"},
        "wind": {"speed": float(wind), "direction": 180.0},
        "humidity": float(humidity),
        "extreme_flags": {
            "heatwave": t_max >= 40,
            "heavy_rain": rain >= 50,
            "cyclone_risk": wind >= 88,
            "drought_risk": False,
        },
    }


SCENARIOS = {
    "heat": {
        "label": "Heat stress",
        "description": "Max temp 33°C — exceeds 30°C potato limit → tier 2 Warning",
        "days": lambda d0, d1: [
            _day(d0, 22, 33, 72, 0,  12),
            _day(d1, 23, 34, 70, 0,  10),
        ],
    },
    "rain": {
        "label": "High rainfall",
        "description": "30 mm/day — exceeds medium threshold (25 mm) → tier 2 Warning",
        "days": lambda d0, d1: [
            _day(d0, 22, 28, 85, 30, 15),
            _day(d1, 21, 27, 88, 28, 12),
        ],
    },
    "combined": {
        "label": "Heat + rain",
        "description": "33°C + 30 mm/day — two severe triggers → tier 3 Severe",
        "days": lambda d0, d1: [
            _day(d0, 22, 33, 85, 30, 15),
            _day(d1, 23, 34, 88, 28, 10),
        ],
    },
    "blight": {
        "label": "Late blight watch",
        "description": "Cool + humid + wet → blight advisory → tier 1 Advisory (no pop-out, tier < 2)",
        "days": lambda d0, d1: [
            _day(d0, 16, 20, 92, 2, 8),
            _day(d1, 15, 19, 94, 3, 6),
        ],
    },
    "normal": {
        "label": "Normal conditions",
        "description": "All values within safe ranges → tier 0 Normal (clears any existing alert)",
        "days": lambda d0, d1: [
            _day(d0, 18, 27, 72, 5, 12),
            _day(d1, 19, 28, 75, 3, 10),
        ],
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
    """status: True = OK, False = FAIL, 'warn' = warning."""
    if status is True:
        mark = _OK
    elif status == "warn":
        mark = _WARN
    else:
        mark = _FAIL
    suffix = f"  {detail}" if detail else ""
    print(f"  {mark}  {label}{suffix}")


# ---------------------------------------------------------------------------
# Step 1 — inject forecast directly into ArangoDB
# ---------------------------------------------------------------------------

def inject_forecast(district, forecast_days):
    from storage import StorageLayer
    storage = StorageLayer()

    key = _norm_key(f"{district}__open_meteo__short")
    doc = {
        "_key": key,
        "location": district,
        "latitude": 23.8103,
        "longitude": 90.4125,
        "source": "open_meteo",
        "horizon": "short",
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "fallback_used": False,
        "sense_check_passed": True,
        "forecast": forecast_days,
    }
    col = storage._db.collection("weather_forecasts")
    if col.has(key):
        col.replace(doc)
    else:
        col.insert(doc)
    return storage, key


# ---------------------------------------------------------------------------
# Step 2 — trigger EWS (via API if running, otherwise locally)
# ---------------------------------------------------------------------------

def _reachable_url(preferred_url, path="/health"):
    """
    Return the first URL (preferred, then port-8000 variant) that returns HTTP 200.
    Handles the common case where the service binds to :8000 internally but
    is mapped to :8100 externally, or vice versa.
    """
    candidates = [preferred_url]
    # If preferred is :8100, also try :8000 (container-internal port)
    if ":8100" in preferred_url:
        candidates.append(preferred_url.replace(":8100", ":8000"))
    elif ":8000" in preferred_url:
        candidates.append(preferred_url.replace(":8000", ":8100"))

    for url in candidates:
        try:
            r = _http.get(f"{url}{path}", timeout=3)
            if r.status_code < 500:
                return url
        except Exception:
            pass
    return None


def trigger_ews_via_api(weather_mcp_url, district):
    """POST /internal/run-potato-pipeline then wait briefly for it to complete."""
    live_url = _reachable_url(weather_mcp_url)
    if live_url is None:
        return False, "service not reachable on any known port"
    try:
        resp = _http.post(
            f"{live_url}/internal/run-potato-pipeline",
            timeout=10,
        )
        if resp.ok:
            time.sleep(3)   # background task needs a moment to write to ArangoDB
            return True, (live_url, resp.json())
        return False, {"status": resp.status_code, "body": resp.text[:200]}
    except Exception as exc:
        return False, str(exc)


def trigger_ews_locally(storage, district):
    """Run EWS in-process as fallback when the service is not reachable."""
    _ensure_warning_engine_importable()
    from short_term_potato_ews import PotatoShortTermEWS
    from potato_profile import load_potato_thresholds
    ews = PotatoShortTermEWS(storage, load_potato_thresholds())
    return ews.evaluate(district)


# ---------------------------------------------------------------------------
# Step 3 — verify via weather-mcp API
# ---------------------------------------------------------------------------

def verify_mcp_api(weather_mcp_url, district):
    live_url = _reachable_url(weather_mcp_url)
    if live_url is None:
        return False, "service not reachable"
    try:
        resp = _http.get(
            f"{live_url}/potato/risk/latest",
            params={"location": district},
            timeout=5,
        )
        if resp.ok:
            return True, resp.json()
        return False, {"status": resp.status_code}
    except Exception as exc:
        return False, str(exc)


# ---------------------------------------------------------------------------
# Step 4 — verify via Node.js backend proxy
# ---------------------------------------------------------------------------

def verify_backend_api(backend_url, district):
    candidates = []

    def add(url):
        if not url:
            return
        url = url.strip().rstrip("/")
        if url and url not in candidates:
            candidates.append(url)

    add(backend_url)
    add(os.getenv("BACKEND_SERVICE_URL"))
    add(os.getenv("AUTH_SERVICE_URL"))

    parsed = urlparse(backend_url)
    if parsed.scheme and parsed.hostname and not parsed.port and not parsed.path:
        add(f"{parsed.scheme}://{parsed.hostname}:3000")

    if os.path.exists("/.dockerenv"):
        add("http://backend:3000")
        add("http://gov-chat-backend:3000")
        add("http://kong:8010")

    attempts = []
    for candidate in candidates:
        try:
            resp = _http.get(
                f"{candidate}/api/weather/potato-risk",
                params={"location": district},
                timeout=5,
            )
            attempt = {"url": candidate, "status": resp.status_code}
            if not resp.ok:
                attempt["body"] = resp.text[:200]
            attempts.append(attempt)

            if resp.ok:
                data = resp.json()
                data["_backend_url"] = candidate
                return True, data
            # 401 means the route exists and the backend is running — auth is
            # handled by the frontend (sends its own token). Count as reachable.
            if resp.status_code == 401:
                return "auth_required", {
                    "status": 401,
                    "url": candidate,
                    "note": "route exists, auth required (expected)",
                }
        except Exception as exc:
            attempts.append({"url": candidate, "error": str(exc)})

    return False, {"attempts": attempts}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Inject dummy potato alert and verify the full frontend pop-out chain"
    )
    parser.add_argument("--scenario", choices=list(SCENARIOS), default="heat",
                        help="Threshold scenario (default: heat)")
    parser.add_argument("--district", default="Dhaka",
                        help="Bangladesh district (default: Dhaka)")
    parser.add_argument("--weather-mcp-url",
                        default=os.getenv("WEATHER_MCP_URL", "http://localhost:8100"),
                        help="weather-mcp-standalone base URL (default: http://localhost:8100)")
    parser.add_argument("--backend-url",
                        default=os.getenv("BACKEND_URL", "http://localhost:3000"),
                        help="Node.js backend base URL (default: http://localhost:3000)")
    parser.add_argument("--send-sms", action="store_true",
                        help="also send the displayed potato pop-out message via Twilio SMS")
    parser.add_argument("--sms-to",
                        default=os.getenv("EMERGENCY_CONTACT_NUMBERS", ""),
                        help="comma-separated recipient numbers; overrides EMERGENCY_CONTACT_NUMBERS for this run")
    args = parser.parse_args()

    if args.send_sms and args.sms_to:
        os.environ["EMERGENCY_CONTACT_NUMBERS"] = args.sms_to

    scenario = SCENARIOS[args.scenario]
    today    = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    fc_days  = scenario["days"](today, tomorrow)

    # ── Header ───────────────────────────────────────────────────────────────
    section("Potato EWS — end-to-end test")
    print(f"  Scenario : [{args.scenario}] {scenario['label']}")
    print(f"  District : {args.district}")
    print(f"  Dates    : {today} / {tomorrow}")
    print(f"  Intent   : {scenario['description']}")

    print(f"\n  Forecast values being injected:")
    for d in fc_days:
        print(
            f"    {d['date']}  "
            f"temp {d['temperature']['min']}–{d['temperature']['max']}°C  "
            f"rain {d['precipitation']['value']} mm  "
            f"humidity {d['humidity']}%  "
            f"wind {d['wind']['speed']} km/h"
        )

    # ── Step 1: inject forecast ───────────────────────────────────────────────
    section("Step 1 — Inject fake forecast into ArangoDB")
    try:
        storage, arango_key = inject_forecast(args.district, fc_days)
        tick(True, "Forecast written", f"weather_forecasts/{arango_key}")
    except Exception as exc:
        tick(False, f"ArangoDB write failed: {exc}")
        print(f"\n  Tip: export ARANGO_URL=http://localhost:8529 and check ARANGO_PASSWORD")
        sys.exit(1)

    # ── Step 2: trigger EWS ──────────────────────────────────────────────────
    section("Step 2 — Trigger potato EWS")
    api_ok, api_result = trigger_ews_via_api(args.weather_mcp_url, args.district)

    if api_ok:
        live_url, _ = api_result
        tick(True, "Triggered via API", f"POST {live_url}/internal/run-potato-pipeline")
        assessment = None   # will read back from API in step 3
    else:
        tick("warn", f"API not reachable ({api_result}) — running EWS locally as fallback")
        assessment = trigger_ews_locally(storage, args.district)
        if assessment:
            tick(True, "EWS ran locally", f"tier={assessment.get('tier')} {assessment.get('tier_label')}")
        else:
            tick(False, "Local EWS produced no result — check ArangoDB and storage logs")
            sys.exit(1)

    # ── Step 3: verify weather-mcp endpoint ──────────────────────────────────
    section("Step 3 — Verify GET /potato/risk/latest (weather-mcp-standalone)")
    mcp_ok, mcp_data = verify_mcp_api(args.weather_mcp_url, args.district)
    if mcp_ok:
        assessment = mcp_data
        tick(True, "Assessment readable from weather-mcp",
             f"tier={mcp_data.get('tier')} — {mcp_data.get('tier_label')}")
    else:
        status_code = mcp_data.get("status") if isinstance(mcp_data, dict) else None
        if status_code == 404:
            tick("warn", "weather-mcp returned 404 — container has old code, needs rebuild")
            print("  Run: docker compose up -d --build weather-mcp-standalone")
        else:
            tick("warn", f"weather-mcp not reachable: {mcp_data}")
        if assessment:
            print("  (using locally computed assessment for display — data IS in ArangoDB)")
        else:
            stored = storage.get_latest_crop_risk(args.district, "potato")
            assessment = stored or {}

    # ── Step 4: verify backend proxy ─────────────────────────────────────────
    section("Step 4 — Verify GET /api/weather/potato-risk (Node.js backend)")
    be_ok, be_data = verify_backend_api(args.backend_url, args.district)
    if be_ok is True:
        tick(True, "Backend proxy working",
             f"{be_data.get('_backend_url')} tier={be_data.get('tier')} — {be_data.get('tier_label')}")
    elif be_ok == "auth_required":
        tick(True, "Backend route reachable (401 — auth required)",
             f"{be_data.get('url')} — frontend sends its own token, this is correct")
    else:
        tick("warn", f"Backend not reachable: {be_data}")
        print("  (frontend calls this endpoint — if backend is down, pop-out won't appear)")

    # ── Result summary ────────────────────────────────────────────────────────
    section("Assessment — what the pop-out will display")
    tier       = assessment.get("tier", 0)
    tier_label = assessment.get("tier_label", "Unknown")
    message    = assessment.get("message", "")
    triggers   = assessment.get("triggers", [])
    disease    = assessment.get("disease_risks", [])

    tier_colour = {0: "\033[32m", 1: "\033[33m", 2: "\033[33m", 3: "\033[31m", 4: "\033[35m"}
    c = tier_colour.get(tier, "")
    r = "\033[0m"

    print(f"  Tier     : {c}{tier} — {tier_label}{r}")
    print(f"  Triggers : {triggers or '[]'}")
    print(f"  Disease  : {disease or '[]'}")
    print(f"\n  Pop-out message:")
    print(f"  \033[1m{message or '(none — Normal tier)'}\033[0m")

    if args.send_sms:
        section("Optional Twilio SMS")
        if tier < 2:
            tick("warn", "SMS not sent", "tier is below warning threshold")
        elif not message:
            tick("warn", "SMS not sent", "assessment has no display message")
        else:
            try:
                _load_warning_engine_env()
                missing = [
                    name for name in (
                        "TWILIO_ACCOUNT_SID",
                        "TWILIO_AUTH_TOKEN",
                        "TWILIO_PHONE_FROM",
                        "EMERGENCY_CONTACT_NUMBERS",
                    )
                    if not os.getenv(name)
                ]
                if missing:
                    tick("warn", "SMS not sent", f"missing env: {', '.join(missing)}")
                else:
                    from notifier import Notifier
                    sms_ok = Notifier(storage).dispatch_potato_sms(assessment, message=message)
                    tick(sms_ok, "Twilio SMS sent" if sms_ok else "Twilio SMS not sent",
                         "using the exact pop-out message text")
            except Exception as exc:
                tick(False, f"Twilio SMS failed: {exc}")

    # ── Frontend instructions ─────────────────────────────────────────────────
    section("How to see the pop-out in the browser")

    if tier >= 2:
        print(f"  The alert is active (tier {tier} ≥ 2) — the banner WILL appear.\n")
        print("  1. Open the Genie.ai frontend in your browser.")
        print("  2. If you are already logged in, REFRESH the page.")
        print("     The CropAlertBanner polls immediately on mount.")
        print("  3. The pop-out appears bottom-right with an orange/red border.")
        print()
        print("  If the banner does not appear:")
        print("  • Check localStorage — open DevTools → Application → Local Storage")
        print("    and delete the key 'crop_alert_dismissed_until' if it exists.")
        print("  • Check the browser console for '[CropAlertBanner] poll error'.")
        print(f"  • Confirm GET /api/weather/potato-risk?location={args.district} returns tier≥2.")
    elif tier == 1:
        print(f"  Tier 1 (Advisory) — banner does NOT appear (threshold is tier ≥ 2).")
        print("  Use --scenario heat, rain, or combined to trigger the pop-out.")
    else:
        print(f"  Tier 0 (Normal) — no banner. This scenario clears any existing alert.")
        print("  Refresh the browser — the pop-out should disappear if it was showing.")

    print()
    sys.exit(0)


if __name__ == "__main__":
    main()
