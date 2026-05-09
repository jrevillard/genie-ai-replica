"""
Warning System Engine — standalone container entrypoint.

Short-term (daily 05:00 UTC):
  Reads weather_forecasts from ArangoDB (written by weather-mcp-service ingestor)
  → RiskEngine tier classification → PotatoShortTermEWS → alerts

Long-term (weekly Mon 06:00 UTC):
  Fetches Copernicus SEAS5 5-month outlook for all Bangladesh districts
  → LongTermPotatoEWS compares against example_crop_profile.json thresholds
  → stores seasonal_assessments → logs seasonal advisory alerts

Long-term requires CDSAPI_URL + CDSAPI_KEY env vars (or ~/.cdsapirc).
If not configured the long-term pipeline is silently skipped; short-term
continues unaffected.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("warning_system_engine")


async def run() -> None:
    from storage import StorageLayer
    from risk_engine import RiskEngine
    from notifier import Notifier
    from short_term_potato_ews import PotatoShortTermEWS
    from crop_profile_loader import CropProfileLoader
    from scheduler import create_scheduler

    logger.info("[MAIN] Warning System Engine starting up")

    storage     = StorageLayer()
    risk_engine = RiskEngine()
    notifier    = Notifier(storage)
    potato_ews  = PotatoShortTermEWS(storage)

    # ── Drought monitoring (optional — requires DROUGHT_MONITORING_URL) ──
    drought_ews            = None
    drought_monitoring_url = os.getenv("DROUGHT_MONITORING_URL", "")

    if drought_monitoring_url:
        try:
            from drought_ews import DroughtEWS
            drought_ews = DroughtEWS(storage)
            logger.info("[MAIN] DroughtEWS ready — url=%s", drought_monitoring_url)
        except ImportError as exc:
            logger.warning("[MAIN] DroughtEWS import failed (%s) — drought pipeline disabled", exc)
    else:
        logger.info("[MAIN] DROUGHT_MONITORING_URL not set — drought pipeline disabled")

    # ── Long-term components (optional — requires CDS credentials) ────────
    copernicus    = None
    long_term_ews = None

    try:
        from copernicus_fetcher import CopernicusFetcher
        from long_term_potato_ews import LongTermPotatoEWS

        profile_loader = CropProfileLoader()
        copernicus     = CopernicusFetcher()
        long_term_ews  = LongTermPotatoEWS(storage, profile_loader)
        logger.info("[MAIN] Long-term EWS ready — Copernicus pipeline enabled")
    except ImportError as exc:
        logger.warning(
            "[MAIN] Long-term dependencies missing (%s) — "
            "install cdsapi xarray netCDF4 to enable Copernicus pipeline", exc
        )

    scheduler = create_scheduler(
        storage=storage,
        ingestor=None,            # ingestor lives in weather-mcp-service
        risk_engine=risk_engine,
        notifier=notifier,
        potato_ews=potato_ews,
        copernicus=copernicus,
        long_term_ews=long_term_ews,
        drought_ews=drought_ews,
        drought_monitoring_url=drought_monitoring_url,
    )
    scheduler.start()
    logger.info(
        "[MAIN] Scheduler started — short-term: daily 05:00 UTC | "
        "long-term: Mon 06:00 UTC (Copernicus=%s) | "
        "drought: daily 07:00 UTC (DroughtEWS=%s)",
        copernicus is not None,
        drought_ews is not None,
    )

    stop_event = asyncio.Event()

    def _handle_signal(*_):
        logger.info("[MAIN] Shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    await stop_event.wait()
    scheduler.shutdown(wait=False)
    logger.info("[MAIN] Warning System Engine shut down cleanly")


if __name__ == "__main__":
    asyncio.run(run())
