"""
Scheduler — APScheduler async jobs for the Warning System Engine.

Short-term pipeline  (daily, 05:00 UTC):
  Read weather_forecasts from ArangoDB → classify → notify tier ≥ 2
  Run PotatoShortTermEWS for all districts → store crop risk assessments

Long-term pipeline  (weekly, Monday 06:00 UTC):
  Fetch Copernicus SEAS5 5-month outlook → store in seasonal_forecasts
  Run LongTermPotatoEWS for all districts → store in seasonal_assessments
  Notify tier ≥ 2 seasonal warnings

Startup:
  Short-term catch-up fires 10 s after start.
  Long-term catch-up fires 60 s after start (gives short-term time to run first).
"""
import logging
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

if TYPE_CHECKING:
    from copernicus_fetcher import CopernicusFetcher
    from long_term_potato_ews import LongTermPotatoEWS
    from notifier import Notifier
    from risk_engine import RiskEngine
    from short_term_potato_ews import PotatoShortTermEWS
    from storage import StorageLayer

logger = logging.getLogger(__name__)

# All Bangladesh districts — used when iterating stored forecasts in
# standalone mode (no ingestor). Keep in sync with weather-mcp-service.
DISTRICT_LIST = [
    "Dhaka", "Chittagong", "Sylhet", "Rajshahi", "Khulna",
    "Barisal", "Rangpur", "Mymensingh", "Comilla", "Jessore",
    "Bogra", "Dinajpur", "Pabna", "Tangail", "Faridpur",
    "Noakhali", "Brahmanbaria", "Cox's Bazar", "Chandpur", "Narsingdi",
]


async def run_potato_ews_pipeline(
    storage:    "StorageLayer",
    potato_ews: "PotatoShortTermEWS",
) -> dict:
    """
    Run the potato EWS for all districts that have a stored forecast.
    Called after the main pipeline so weather_forecasts is fresh.
    """
    import asyncio

    logger.info("[POTATO_PIPELINE] Potato EWS run started")
    evaluated = 0
    alerted = 0
    errors = 0

    for location in DISTRICT_LIST:
        try:
            assessment = await asyncio.get_running_loop().run_in_executor(
                None, lambda loc=location: potato_ews.evaluate(loc)
            )
            if assessment:
                evaluated += 1
                if potato_ews.should_alert(assessment):
                    await asyncio.get_running_loop().run_in_executor(
                        None, lambda a=assessment: potato_ews.record_alert(a)
                    )
                    alerted += 1
        except Exception as exc:
            logger.error("[POTATO_PIPELINE] Failed for %s: %s", location, exc)
            errors += 1

    result = {"evaluated": evaluated, "alerted": alerted, "errors": errors}
    logger.info("[POTATO_PIPELINE] Done: %s", result)
    return result


async def run_daily_pipeline(
    storage:     "StorageLayer",
    ingestor,                    # DataIngestor | None
    risk_engine: "RiskEngine",
    notifier:    "Notifier",
    potato_ews:  "PotatoShortTermEWS | None" = None,
) -> dict:
    """
    Daily pipeline:
      1. (If ingestor provided) Ingest 7-day forecasts for all districts
      2. Persist to weather_forecasts
      3. Classify each district → RiskAssessment
      4. Persist to risk_assessments
      5. Dispatch notifications for tier ≥ 2
      6. Run potato EWS
    """
    import asyncio
    from models import UnifiedForecast

    logger.info("[PIPELINE] Daily pipeline started (ingestor=%s)", "yes" if ingestor else "standalone")

    forecasts: list[UnifiedForecast] = []

    if ingestor is not None:
        # Full mode: ingest fresh weather data from Open-Meteo / BMD
        try:
            forecasts = await asyncio.get_running_loop().run_in_executor(
                None, lambda: ingestor.ingest_short_term(forecast_days=7)
            )
            fallback_count     = sum(1 for f in forecasts if f.fallback_used)
            sense_check_failed = sum(1 for f in forecasts if f.sense_check_passed is False)
            sense_check_passed = sum(1 for f in forecasts if f.sense_check_passed is True)
            logger.info(
                "[PIPELINE] Ingested %d forecasts — sense_check(pass=%d fail=%d) fallback=%d",
                len(forecasts), sense_check_passed, sense_check_failed, fallback_count,
            )
        except Exception as exc:
            logger.error("[PIPELINE] Ingestion failed: %s", exc)
            return {"status": "error", "stage": "ingestion", "error": str(exc)}
    else:
        # Standalone mode: read stored forecasts from ArangoDB
        logger.info("[PIPELINE] Standalone mode — reading stored forecasts from ArangoDB")
        for location in DISTRICT_LIST:
            fc = await asyncio.get_running_loop().run_in_executor(
                None, lambda loc=location: storage.get_latest_forecast(loc)
            )
            if fc is not None:
                forecasts.append(fc)
        logger.info("[PIPELINE] Loaded %d stored forecasts from ArangoDB", len(forecasts))
        sense_check_passed = sense_check_failed = fallback_count = 0

    errors = 0
    notified = 0

    for fc in forecasts:
        try:
            if ingestor is not None:
                await asyncio.get_running_loop().run_in_executor(
                    None, lambda f=fc: storage.upsert_forecast(f)
                )

            assessment = risk_engine.classify(fc)

            await asyncio.get_running_loop().run_in_executor(
                None, lambda a=assessment: storage.upsert_risk_assessment(a)
            )

            if assessment.tier >= 2:
                await asyncio.get_running_loop().run_in_executor(
                    None, lambda a=assessment: notifier.dispatch(a)
                )
                notified += 1

        except Exception as exc:
            logger.error("[PIPELINE] Failed for %s: %s", fc.location, exc)
            errors += 1

    result = {
        "status":              "ok" if errors == 0 else "partial",
        "districts_processed": len(forecasts),
        "sense_check_passed":  sense_check_passed,
        "sense_check_failed":  sense_check_failed,
        "fallback_used":       fallback_count,
        "errors":              errors,
        "alerts_dispatched":   notified,
    }
    logger.info("[PIPELINE] Daily pipeline complete: %s", result)

    if potato_ews is not None:
        try:
            await run_potato_ews_pipeline(storage, potato_ews)
        except Exception as exc:
            logger.error("[PIPELINE] Potato EWS pipeline failed: %s", exc)

    return result


# ---------------------------------------------------------------------------
# Long-term pipeline  (weekly Copernicus fetch + seasonal EWS)
# ---------------------------------------------------------------------------

async def run_long_term_pipeline(
    storage:       "StorageLayer",
    copernicus:    "CopernicusFetcher",
    long_term_ews: "LongTermPotatoEWS",
    notifier:      "Notifier | None" = None,
) -> dict:
    """
    Weekly pipeline:
      1. Fetch Copernicus SEAS5 5-month outlook for all Bangladesh districts
      2. Store raw monthly climate data in `seasonal_forecasts`
      3. Run LongTermPotatoEWS → store assessments in `seasonal_assessments`
      4. Dispatch seasonal advisory notifications for tier ≥ 2

    This is independent of the short-term daily pipeline.
    """
    import asyncio

    logger.info("[LT_PIPELINE] Long-term pipeline started")

    # Step 1 & 2: Fetch + store Copernicus
    fetch_result = await asyncio.get_running_loop().run_in_executor(
        None, lambda: copernicus.fetch_and_store(storage)
    )
    logger.info("[LT_PIPELINE] Copernicus fetch: %s", fetch_result)

    if fetch_result.get("error") == "cds_not_configured":
        return {"status": "skipped", "reason": "CDS not configured", **fetch_result}

    # Step 3: Run deterministic seasonal EWS
    ews_result = await asyncio.get_running_loop().run_in_executor(
        None, lambda: long_term_ews.evaluate_all()
    )
    logger.info("[LT_PIPELINE] Long-term EWS: %s", ews_result)

    # Step 4: Dispatch seasonal notifications for tier ≥ 2
    notified = 0
    if notifier is not None:
        notified = await _dispatch_seasonal_alerts(storage, notifier)

    result = {
        "status":            "ok" if fetch_result.get("error") is None else "partial",
        "copernicus_stored": fetch_result.get("stored", 0),
        "assessments_stored": ews_result.get("evaluated", 0),
        "alerts_dispatched": notified,
        "errors":            ews_result.get("errors", 0),
    }
    logger.info("[LT_PIPELINE] Long-term pipeline complete: %s", result)
    return result


async def _dispatch_seasonal_alerts(
    storage:  "StorageLayer",
    notifier: "Notifier",
) -> int:
    """
    Send seasonal advisory notifications for all stored seasonal assessments
    with tier ≥ 2.  Uses a simple log-based channel (not FCM push) since
    seasonal outlooks are planning advisories, not emergencies.
    """
    import asyncio

    notified = 0
    try:
        aql = """
            FOR doc IN seasonal_assessments
              FILTER doc.tier >= 2
              SORT doc.target_month ASC
              RETURN doc
        """
        cursor = storage._db.aql.execute(aql)
        for doc in cursor:
            tier  = doc.get("tier", 0)
            label = doc.get("tier_label", "Advisory")
            loc   = doc.get("location", "")
            month = doc.get("target_month", "")
            stages = ", ".join(doc.get("stages", []))
            triggers = "; ".join(doc.get("triggers", [])[:2])
            logger.warning(
                "[SEASONAL_ALERT] Tier %d (%s) — %s %s (stages: %s) — %s",
                tier, label, loc, month, stages, triggers,
            )
            notified += 1
    except Exception as exc:
        logger.error("[LT_PIPELINE] Seasonal alert dispatch failed: %s", exc)
    return notified


# ---------------------------------------------------------------------------
# Scheduler factory
# ---------------------------------------------------------------------------

def create_scheduler(
    storage:       "StorageLayer",
    ingestor,
    risk_engine:   "RiskEngine",
    notifier:      "Notifier",
    potato_ews:    "PotatoShortTermEWS | None" = None,
    copernicus:    "CopernicusFetcher | None"   = None,
    long_term_ews: "LongTermPotatoEWS | None"   = None,
) -> AsyncIOScheduler:
    """
    Build and return a configured APScheduler instance.

    Short-term jobs:
      daily_pipeline          — every day at 05:00 UTC
      startup_pipeline        — once, 10 s after start

    Long-term jobs (only registered when copernicus and long_term_ews provided):
      long_term_pipeline      — every Monday at 06:00 UTC
      startup_long_term       — once, 60 s after start

    Call scheduler.start() after creation (done in main.py).
    """
    from datetime import datetime, timezone, timedelta

    scheduler = AsyncIOScheduler()

    # ── Short-term daily pipeline ─────────────────────────────────────────
    st_args = [storage, ingestor, risk_engine, notifier, potato_ews]

    scheduler.add_job(
        run_daily_pipeline,
        trigger=CronTrigger(hour=5, minute=0, timezone="UTC"),
        args=st_args,
        id="daily_pipeline",
        name="Short-term daily pipeline (05:00 UTC)",
        replace_existing=True,
        misfire_grace_time=86400,
        max_instances=1,
    )

    scheduler.add_job(
        run_daily_pipeline,
        trigger="date",
        run_date=datetime.now(timezone.utc) + timedelta(seconds=10),
        args=st_args,
        id="startup_pipeline",
        name="Startup short-term catch-up (10 s delay)",
        replace_existing=True,
        max_instances=1,
    )

    # ── Long-term weekly pipeline ─────────────────────────────────────────
    if copernicus is not None and long_term_ews is not None:
        lt_args = [storage, copernicus, long_term_ews, notifier]

        scheduler.add_job(
            run_long_term_pipeline,
            trigger=CronTrigger(day_of_week="mon", hour=6, minute=0, timezone="UTC"),
            args=lt_args,
            id="long_term_pipeline",
            name="Long-term weekly Copernicus pipeline (Mon 06:00 UTC)",
            replace_existing=True,
            misfire_grace_time=86400,
            max_instances=1,
        )

        scheduler.add_job(
            run_long_term_pipeline,
            trigger="date",
            run_date=datetime.now(timezone.utc) + timedelta(seconds=60),
            args=lt_args,
            id="startup_long_term",
            name="Startup long-term catch-up (60 s delay)",
            replace_existing=True,
            max_instances=1,
        )

        logger.info(
            "[SCHEDULER] Jobs: daily_pipeline (05:00 UTC) + "
            "long_term_pipeline (Mon 06:00 UTC) + startup catch-ups"
        )
    else:
        logger.info(
            "[SCHEDULER] Jobs: daily_pipeline (05:00 UTC) + startup catch-up. "
            "Long-term pipeline skipped (CDS not configured or disabled)."
        )

    return scheduler
