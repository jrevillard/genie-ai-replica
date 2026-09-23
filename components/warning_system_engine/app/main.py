"""
Warning System Engine — standalone container entrypoint.

Short-term (daily 05:00 UTC):
  Reads weather_forecasts from ArangoDB (written by weather-mcp-service ingestor)
  → RiskEngine tier classification → CropShortTermEWS per crop → alerts

Long-term (weekly Mon 06:00 UTC):
  Fetches Copernicus SEAS5 5-month outlook for all Bangladesh districts
  → LongTermCropEWS compares against example_crop_profile.json thresholds
  → stores seasonal_assessments → logs seasonal advisory alerts

The crops under watch come from EWS_CROPS (default:
eggplant,rice_aman,mango,turmeric). Each
must have a generated module in app/crops/<crop>/ — see
scripts/build_crop_profiles_pipeline.py.

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

# Crops watched by the short-term and seasonal pipelines. Each needs a module
# in app/crops/<crop>/ generated from its BAMIS calendar PDF.
DEFAULT_EWS_CROPS = "eggplant,rice_aman,mango,turmeric"


def _configured_crops() -> list[str]:
    raw = os.getenv("EWS_CROPS", DEFAULT_EWS_CROPS)
    return [crop.strip() for crop in raw.split(",") if crop.strip()]


async def run() -> None:
    from app.core.crop_profile_loader import CropProfileLoader
    from app.core.notifier import Notifier
    from app.core.risk_engine import RiskEngine
    from app.core.scheduler import create_scheduler
    from app.core.storage import StorageLayer
    from app.workflows.short_term.crop_ews import CropShortTermEWS

    logger.info("[MAIN] Warning System Engine starting up")

    storage = StorageLayer()
    risk_engine = RiskEngine()
    notifier = Notifier(storage)

    crops = _configured_crops()
    crop_ews_list: list[CropShortTermEWS] = []
    for crop in crops:
        try:
            crop_ews_list.append(CropShortTermEWS(storage, crop))
            logger.info("[MAIN] Short-term EWS ready for crop '%s'", crop)
        except (ImportError, KeyError, AttributeError) as exc:
            logger.error(
                "[MAIN] Crop '%s' has no generated module (%s) — skipped. "
                "Run scripts/build_crop_profiles_pipeline.py to generate it.",
                crop,
                exc,
            )

    bamis_special_bulletin_ews = None

    if os.getenv("BAMIS_SPECIAL_BULLETIN_ENABLED", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        try:
            from app.integrations.bamis.special_bulletin import BamisSpecialBulletinEWS

            bamis_special_bulletin_ews = BamisSpecialBulletinEWS(storage)
            logger.info("[MAIN] BAMIS special bulletin watcher enabled")
        except ImportError as exc:
            logger.warning(
                "[MAIN] BAMIS special bulletin watcher import failed (%s) — disabled",
                exc,
            )
    else:
        logger.info("[MAIN] BAMIS_SPECIAL_BULLETIN_ENABLED=false — watcher disabled")

    # ── Drought monitoring (optional — requires DROUGHT_MONITORING_URL) ──
    bmd_cap = None
    if os.getenv("BMD_CAP_ENABLED", "true").lower() in ("1", "true", "yes"):
        try:
            from app.integrations.bmd.cap_alerts import BmdCapWatcher

            bmd_cap = BmdCapWatcher(storage)
            logger.info(
                "[MAIN] BMD CAP watcher ready — official warnings via cap.bmd.gov.bd"
            )
        except Exception as exc:
            logger.warning("[MAIN] BMD CAP watcher init failed (%s) — disabled", exc)

    flood_ews = None
    if os.getenv("FLOOD_EWS_ENABLED", "true").lower() in ("1", "true", "yes"):
        try:
            from app.workflows.short_term.flood_ews import FloodEWS

            flood_ews = FloodEWS(storage)
            logger.info(
                "[MAIN] FloodEWS ready — rain index + GloFAS river discharge (Open-Meteo)"
            )
        except Exception as exc:
            logger.warning(
                "[MAIN] FloodEWS init failed (%s) — flood pipeline disabled", exc
            )

    drought_ews = None
    drought_monitoring_url = os.getenv("DROUGHT_MONITORING_URL", "")

    if drought_monitoring_url:
        try:
            from app.workflows.long_term.drought_ews import DroughtEWS

            drought_ews = DroughtEWS(storage)
            logger.info("[MAIN] DroughtEWS ready — url=%s", drought_monitoring_url)
        except ImportError as exc:
            logger.warning(
                "[MAIN] DroughtEWS import failed (%s) — drought pipeline disabled", exc
            )
    else:
        logger.info("[MAIN] DROUGHT_MONITORING_URL not set — drought pipeline disabled")

    # ── Long-term components (optional — requires CDS credentials) ────────
    copernicus = None
    long_term_ews_list = []

    try:
        from app.integrations.copernicus.fetcher import CopernicusFetcher
        from app.workflows.long_term.crop_ews import LongTermCropEWS

        profile_loader = CropProfileLoader()
        copernicus = CopernicusFetcher()
        long_term_ews_list = [
            LongTermCropEWS(storage, ews.crop, profile_loader) for ews in crop_ews_list
        ]
        logger.info(
            "[MAIN] Long-term EWS ready for %s — Copernicus pipeline enabled",
            ", ".join(ews.crop for ews in long_term_ews_list) or "no crops",
        )
    except ImportError as exc:
        logger.warning(
            "[MAIN] Long-term dependencies missing (%s) — "
            "install cdsapi xarray netCDF4 to enable Copernicus pipeline",
            exc,
        )

    scheduler = create_scheduler(
        storage=storage,
        ingestor=None,  # ingestor lives in weather-mcp-service
        risk_engine=risk_engine,
        notifier=notifier,
        crop_ews_list=crop_ews_list,
        copernicus=copernicus,
        long_term_ews_list=long_term_ews_list,
        drought_ews=drought_ews,
        drought_monitoring_url=drought_monitoring_url,
        bamis_special_bulletin_ews=bamis_special_bulletin_ews,
        flood_ews=flood_ews,
        bmd_cap=bmd_cap,
    )
    scheduler.start()
    logger.info(
        "[MAIN] Scheduler started — crops: %s | short-term: daily 05:00 UTC | "
        "long-term: Mon 06:00 UTC (Copernicus=%s) | "
        "drought: daily 07:00 UTC (DroughtEWS=%s) | "
        "BAMIS special bulletin: hourly (enabled=%s)",
        ", ".join(ews.crop for ews in crop_ews_list) or "none",
        copernicus is not None,
        drought_ews is not None,
        bamis_special_bulletin_ews is not None,
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
