"""
Scheduler — APScheduler async job for the hourly pipeline.

Jobs:
  hourly_pipeline — every 1 hour
                    ingest Open-Meteo (BMD fallback) → classify → notify (tier ≥ 2)

The scheduler is started inside the FastAPI lifespan context (main.py) so it
shares the asyncio event loop.  The pipeline is also callable directly via
POST /internal/run-pipeline for ops / testing.
"""
import logging
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

if TYPE_CHECKING:
    from data_ingestor import DataIngestor
    from notifier import Notifier
    from risk_engine import RiskEngine
    from storage import StorageLayer

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pipeline function
# ---------------------------------------------------------------------------

async def run_hourly_pipeline(
    storage:    "StorageLayer",
    ingestor:   "DataIngestor",
    risk_engine:"RiskEngine",
    notifier:   "Notifier",
) -> dict:
    """
    Hourly pipeline:
      1. Ingest 7-day forecasts for all districts (Open-Meteo primary, BMD fallback)
      2. Persist to weather_forecasts
      3. Classify each district → RiskAssessment
      4. Persist to risk_assessments
      5. Dispatch notifications for tier ≥ 2
    """
    import asyncio

    logger.info("[PIPELINE] Hourly pipeline started")

    # Step 1 – ingestion (blocking I/O; run in thread pool to avoid blocking loop)
    try:
        forecasts = await asyncio.get_running_loop().run_in_executor(
            None, lambda: ingestor.ingest_short_term(forecast_days=7)
        )
        fallback_count     = sum(1 for f in forecasts if f.fallback_used)
        sense_check_failed = sum(1 for f in forecasts if f.sense_check_passed is False)
        sense_check_passed = sum(1 for f in forecasts if f.sense_check_passed is True)
        logger.info(
            "[PIPELINE] Ingested %d district forecasts — "
            "sense_check(pass=%d fail=%d) fallback=%d",
            len(forecasts), sense_check_passed, sense_check_failed, fallback_count,
        )
    except Exception as exc:
        logger.error("[PIPELINE] Ingestion failed: %s", exc)
        return {"status": "error", "stage": "ingestion", "error": str(exc)}

    # Steps 2–5 – persist, classify, notify
    errors = 0
    notified = 0

    for fc in forecasts:
        try:
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
        "status":               "ok" if errors == 0 else "partial",
        "districts_processed":  len(forecasts),
        "sense_check_passed":  sense_check_passed,
        "sense_check_failed":  sense_check_failed,
        "fallback_used":       fallback_count,
        "errors":               errors,
        "alerts_dispatched":    notified,
    }
    logger.info("[PIPELINE] Hourly pipeline complete: %s", result)
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
        run_hourly_pipeline,
        trigger=IntervalTrigger(hours=1),
        args=[storage, ingestor, risk_engine, notifier],
        id="hourly_pipeline",
        name="Hourly weather pipeline",
        replace_existing=True,
        misfire_grace_time=3600,  # run up to 1 h late if the process was down
        max_instances=1,          # prevent overlap if a run is slow
    )

    logger.info("[SCHEDULER] Job registered: hourly_pipeline (interval=1h)")
    return scheduler
