#!/usr/bin/env python3
"""
test_pipeline.py — Open-Meteo → ArangoDB pipeline smoke test.

Runs 3 batches of Open-Meteo ingestion for a small set of districts,
stores each batch in ArangoDB, and verifies the documents land correctly.

Usage
-----
From the HOST machine (ArangoDB mapped to localhost:8529 — default):
    cd components/weather-mcp-service
    python3 scripts/test_pipeline.py

From INSIDE the container (uses internal Docker DNS):
    docker exec -it weather-mcp-standalone bash
    python scripts/test_pipeline.py

Optional env overrides:
    ARANGO_URL      default: http://localhost:8529  (host)
                    inside container: http://arango-vector-db:8529
    ARANGO_DB_NAME  genie-ai
    ARANGO_USER     root
    ARANGO_PASSWORD test
    TEST_DISTRICTS  Dhaka,Sylhet,Rangpur   (comma-separated, overrides default 5)
    BATCHES         3                      (number of batches to run)
"""
import os
import sys
import time
import json
import logging
from datetime import datetime, timezone

# Allow running from repo root or from the weather-mcp-service directory
_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVICE_DIR not in sys.path:
    sys.path.insert(0, _SERVICE_DIR)

# ---------------------------------------------------------------------------
# ArangoDB URL — default to localhost:8529 (host-mapped port) so the script
# works when run directly on the VM without any env override.
# Inside the container, arango-vector-db:8529 is used automatically when
# ARANGO_URL is already set in the container environment.
# ---------------------------------------------------------------------------
if not os.getenv("ARANGO_URL"):
    os.environ["ARANGO_URL"] = "http://localhost:8529"

from data_ingestor import DataIngestor
from storage import StorageLayer
from risk_engine import RiskEngine

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_DEFAULT_DISTRICTS = ["Dhaka", "Sylhet", "Rangpur", "Chattogram", "Rajshahi"]

DISTRICTS = [
    d.strip()
    for d in os.getenv("TEST_DISTRICTS", "").split(",")
    if d.strip()
] or _DEFAULT_DISTRICTS

BATCHES = int(os.getenv("BATCHES", "3"))

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("test_pipeline")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def section(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


def verify_storage(storage: StorageLayer, districts: list[str], batch: int) -> dict:
    """
    Query ArangoDB and return counts + sample doc for the test districts.
    """
    results = {}
    for district in districts:
        forecast = storage.get_latest_forecast(district, horizon="short", max_age_hours=2)
        risk     = storage.get_latest_risk(district, horizon="short")
        results[district] = {
            "forecast_stored":  forecast is not None,
            "forecast_source":  forecast.source       if forecast else None,
            "forecast_days":    len(forecast.forecast) if forecast else 0,
            "risk_stored":      risk is not None,
            "risk_tier":        risk.tier              if risk else None,
            "risk_label":       risk.tier_label        if risk else None,
        }
    return results


def print_verification(results: dict, batch: int) -> None:
    ok    = sum(1 for r in results.values() if r["forecast_stored"] and r["risk_stored"])
    total = len(results)
    print(f"\n  Batch {batch} verification — {ok}/{total} districts fully stored\n")
    print(f"  {'District':<18} {'Forecast':^10} {'Source':^12} {'Days':^6} {'Risk':^8} {'Tier':^12}")
    print(f"  {'─'*18} {'─'*10} {'─'*12} {'─'*6} {'─'*8} {'─'*12}")
    for district, r in results.items():
        forecast_ok = "OK" if r["forecast_stored"] else "MISSING"
        risk_ok     = "OK" if r["risk_stored"]     else "MISSING"
        tier_str    = f"{r['risk_tier']} ({r['risk_label']})" if r["risk_tier"] is not None else "—"
        print(
            f"  {district:<18} {forecast_ok:^10} {(r['forecast_source'] or '—'):^12} "
            f"{r['forecast_days']:^6} {risk_ok:^8} {tier_str:^12}"
        )


def print_collection_counts(storage: StorageLayer) -> None:
    for col_name in ("weather_forecasts", "risk_assessments"):
        col   = storage._db.collection(col_name)
        count = col.count()
        print(f"  {col_name:<25} {count:>5} documents")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    section("Setup")
    print(f"  Districts : {', '.join(DISTRICTS)}")
    print(f"  Batches   : {BATCHES}")
    print(f"  ArangoDB  : {os.getenv('ARANGO_URL', 'http://arango-vector-db:8529')}")

    # Initialise components
    log.info("Connecting to ArangoDB …")
    try:
        storage = StorageLayer()
    except Exception as exc:
        log.error("Could not connect to ArangoDB: %s", exc)
        log.error(
            "Tip: if running on the host, ArangoDB must be reachable at %s. "
            "Override with: ARANGO_URL=http://localhost:8529 python3 scripts/test_pipeline.py",
            os.getenv("ARANGO_URL", "http://localhost:8529"),
        )
        sys.exit(1)

    ingestor    = DataIngestor()
    risk_engine = RiskEngine()

    log.info("Connection OK — ArangoDB collections ensured")

    section("Pre-run collection counts")
    print_collection_counts(storage)

    # -----------------------------------------------------------------------
    # Run batches
    # -----------------------------------------------------------------------
    batch_summaries = []

    for batch_num in range(1, BATCHES + 1):
        section(f"Batch {batch_num} / {BATCHES}")
        t_start = time.time()

        # 1. Ingest from Open-Meteo (BMD fallback if needed)
        log.info("[Batch %d] Fetching Open-Meteo data for %d districts …", batch_num, len(DISTRICTS))
        try:
            forecasts = ingestor.ingest_short_term(districts=DISTRICTS, forecast_days=7)
        except Exception as exc:
            log.error("[Batch %d] Ingestion failed: %s", batch_num, exc)
            batch_summaries.append({"batch": batch_num, "status": "ERROR", "error": str(exc)})
            continue

        log.info("[Batch %d] Ingested %d forecasts", batch_num, len(forecasts))

        # 2. Persist + classify
        stored_ok = 0
        errors    = 0
        tier_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}

        for fc in forecasts:
            try:
                key = storage.upsert_forecast(fc)
                log.info("  Stored forecast  _key=%s  source=%s  days=%d",
                         key, fc.source, len(fc.forecast))

                assessment = risk_engine.classify(fc)

                key = storage.upsert_risk_assessment(assessment)
                log.info("  Stored risk      _key=%s  tier=%d (%s)",
                         key, assessment.tier, assessment.tier_label)

                tier_counts[assessment.tier] = tier_counts.get(assessment.tier, 0) + 1
                stored_ok += 1

            except Exception as exc:
                log.error("  Failed for %s: %s", fc.location, exc)
                errors += 1

        elapsed = time.time() - t_start

        # 3. Verify
        verification = verify_storage(storage, DISTRICTS, batch_num)
        print_verification(verification, batch_num)

        summary = {
            "batch":           batch_num,
            "status":          "OK" if errors == 0 else "PARTIAL",
            "stored":          stored_ok,
            "errors":          errors,
            "elapsed_s":       round(elapsed, 1),
            "tier_counts":     tier_counts,
        }
        batch_summaries.append(summary)
        log.info("[Batch %d] Complete in %.1fs — %d stored, %d errors",
                 batch_num, elapsed, stored_ok, errors)

        # Small pause between batches (mirrors real pipeline cadence, speeds up test)
        if batch_num < BATCHES:
            log.info("Waiting 3 s before next batch …")
            time.sleep(3)

    # -----------------------------------------------------------------------
    # Final summary
    # -----------------------------------------------------------------------
    section("Post-run collection counts")
    print_collection_counts(storage)

    section("Final summary")
    all_ok = all(s.get("status") == "OK" for s in batch_summaries)

    for s in batch_summaries:
        tier_str = "  ".join(
            f"T{t}={c}" for t, c in sorted(s.get("tier_counts", {}).items()) if c > 0
        )
        print(
            f"  Batch {s['batch']}  [{s['status']:^7}]  "
            f"stored={s.get('stored', 0)}  errors={s.get('errors', 0)}  "
            f"time={s.get('elapsed_s', '?')}s  {tier_str}"
        )

    print()
    if all_ok:
        print("  RESULT: ALL BATCHES PASSED — data is reaching ArangoDB correctly.")
    else:
        print("  RESULT: SOME BATCHES HAD ERRORS — check logs above.")

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
