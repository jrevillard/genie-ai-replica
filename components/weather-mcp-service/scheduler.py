"""
Scheduler — APScheduler async jobs for the daily and weekly pipelines.

Jobs:
  daily_short_term   — every day at 06:00 UTC
                       ingest Open-Meteo → classify → notify (tier ≥ 2)
  weekly_long_term   — every Monday at 00:00 UTC
                       ingest Copernicus / WeatherNext → classify → notify

The scheduler is started inside the FastAPI lifespan context (main.py) so it
shares the asyncio event loop.  Both jobs are also callable directly via
POST /internal/run-daily-pipeline (short-term) for ops / testing.
"""
import logging
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

if TYPE_CHECKING:
    from data_ingestor import DataIngestor
    from notifier import Notifier
    from risk_engine import RiskEngine
    from storage import StorageLayer

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pipeline functions
# ---------------------------------------------------------------------------

async def run_daily_pipeline(
    storage:    "StorageLayer",
    ingestor:   "DataIngestor",
    risk_engine:"RiskEngine",
    notifier:   "Notifier",
) -> dict:
    """
    Daily short-term pipeline:
      1. Ingest 7-day forecasts for all districts (Open-Meteo primary, BMD fallback)
      2. Persist to weather_forecasts
      3. Classify each district → RiskAssessment
      4. Persist to risk_assessments
      5. Dispatch notifications for tier ≥ 2
    """
    import asyncio

    logger.info("[PIPELINE] Daily short-term pipeline started")

    # Step 1 – ingestion (blocking I/O; run in thread pool to avoid blocking loop)
    try:
        forecasts = await asyncio.get_event_loop().run_in_executor(
            None, lambda: ingestor.ingest_short_term(forecast_days=7)
        )
        logger.info("[PIPELINE] Ingested %d district forecasts", len(forecasts))
    except Exception as exc:
        logger.error("[PIPELINE] Ingestion failed: %s", exc)
        return {"status": "error", "stage": "ingestion", "error": str(exc)}

    # Steps 2–5 – persist, classify, notify
    errors = 0
    notified = 0

    for fc in forecasts:
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda f=fc: storage.upsert_forecast(f)
            )

            assessment = risk_engine.classify(fc)

            await asyncio.get_event_loop().run_in_executor(
                None, lambda a=assessment: storage.upsert_risk_assessment(a)
            )

            if assessment.tier >= 2:
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda a=assessment: notifier.dispatch(a)
                )
                notified += 1

        except Exception as exc:
            logger.error("[PIPELINE] Failed for %s: %s", fc.location, exc)
            errors += 1

    result = {
        "status":              "ok" if errors == 0 else "partial",
        "districts_processed": len(forecasts),
        "errors":              errors,
        "alerts_dispatched":   notified,
    }
    logger.info("[PIPELINE] Daily pipeline complete: %s", result)
    return result


async def run_longterm_pipeline(
    storage:    "StorageLayer",
    ingestor:   "DataIngestor",
    risk_engine:"RiskEngine",
    notifier:   "Notifier",
) -> dict:
    """
    Weekly long-term pipeline (8–30 day outlooks).
    Skipped gracefully if no long-term source is configured.
    """
    import asyncio

    logger.info("[PIPELINE] Long-term pipeline started")

    try:
        forecasts = await asyncio.get_event_loop().run_in_executor(
            None, ingestor.ingest_long_term
        )
    except Exception as exc:
        logger.error("[PIPELINE] Long-term ingestion failed: %s", exc)
        return {"status": "error", "error": str(exc)}

    if not forecasts:
        return {"status": "skipped", "reason": "no long-term source configured"}

    notified = 0
    for fc in forecasts:
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda f=fc: storage.upsert_forecast(f)
            )
            assessment = risk_engine.classify(fc)
            await asyncio.get_event_loop().run_in_executor(
                None, lambda a=assessment: storage.upsert_risk_assessment(a)
            )
            if assessment.tier >= 2:
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda a=assessment: notifier.dispatch(a)
                )
                notified += 1
        except Exception as exc:
            logger.error("[PIPELINE] Long-term failed for %s: %s", fc.location, exc)

    result = {
        "status": "ok",
        "districts_processed": len(forecasts),
        "alerts_dispatched":   notified,
    }
    logger.info("[PIPELINE] Long-term pipeline complete: %s", result)
    return result


# ---------------------------------------------------------------------------
# Scheduler factory
# ---------------------------------------------------------------------------

def create_scheduler(
    storage:    "StorageLayer",
    ingestor:   "DataIngestor",
    risk_engine:"RiskEngine",
    notifier:   "Notifier",
) -> AsyncIOScheduler:
    """
    Build and return a configured APScheduler instance.
    Call scheduler.start() after creation (done in main.py lifespan).
    """
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        run_daily_pipeline,
        trigger=CronTrigger(hour=6, minute=0, timezone="UTC"),
        args=[storage, ingestor, risk_engine, notifier],
        id="daily_short_term",
        name="Daily short-term weather pipeline",
        replace_existing=True,
        misfire_grace_time=3600,  # run up to 1 h late if the process was down
    )

    scheduler.add_job(
        run_longterm_pipeline,
        trigger=CronTrigger(day_of_week="mon", hour=0, minute=0, timezone="UTC"),
        args=[storage, ingestor, risk_engine, notifier],
        id="weekly_long_term",
        name="Weekly long-term weather pipeline",
        replace_existing=True,
    )

    logger.info(
        "[SCHEDULER] Jobs registered: daily@06:00UTC, long-term@Mon-00:00UTC"
    )
    return scheduler
