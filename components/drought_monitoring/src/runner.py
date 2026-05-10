"""
runner.py — district-level drought assessment loop.

Called by api.py on POST /run/all.
Iterates all Bangladesh districts, fetches GEE data, classifies drought,
generates a PDF report, and writes the assessment to ArangoDB.
"""
from __future__ import annotations

import logging
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# Bangladesh district centroids — mirrors copernicus_fetcher.py
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka":        (23.8103,  90.4125),
    "Chittagong":   (22.3569,  91.7832),
    "Sylhet":       (24.8949,  91.8687),
    "Rajshahi":     (24.3745,  88.6042),
    "Khulna":       (22.8456,  89.5403),
    "Barisal":      (22.7010,  90.3535),
    "Rangpur":      (25.7439,  89.2752),
    "Mymensingh":   (24.7471,  90.4203),
    "Comilla":      (23.4607,  91.1809),
    "Jessore":      (23.1667,  89.2167),
    "Bogra":        (24.8465,  89.3773),
    "Dinajpur":     (25.6279,  88.6338),
    "Pabna":        (24.0064,  89.2372),
    "Tangail":      (24.2513,  89.9167),
    "Faridpur":     (23.6070,  89.8429),
    "Noakhali":     (22.8696,  91.0995),
    "Brahmanbaria": (23.9608,  91.1115),
    "Cox's Bazar":  (21.4272,  92.0058),
    "Chandpur":     (23.2333,  90.6500),
    "Narsingdi":    (23.9174,  90.7150),
}

DROUGHT_LEVEL_TO_TIER: dict[str, int] = {
    "NORMAL": 0,
    "WATCH":  1,
    "MODERATE": 2,
    "SEVERE": 3,
}

DROUGHT_TIER_LABELS: dict[int, str] = {
    0: "Normal",
    1: "Watch",
    2: "Warning",
    3: "Severe",
}

# Short labels for trigger messages (without newlines)
_BAND_SHORT: dict[str, str] = {
    "sm_surface":                    "Soil moisture",
    "land_evapotranspiration_flux":  "Evapotranspiration",
    "overland_runoff_flux":          "Surface runoff",
    "NDVI":                          "Crop greenness (NDVI)",
}

_LEVEL_PLAIN = {
    "NORMAL":   "Normal conditions",
    "WATCH":    "Drought watch",
    "MODERATE": "Moderate drought",
    "SEVERE":   "Severe drought",
}


def gee_configured() -> bool:
    creds = Path.home() / ".config" / "earthengine" / "credentials"
    return creds.exists() or bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))


def _bbox_area_km2(bbox: list[float]) -> float:
    W, S, E, N = bbox
    mean_lat = math.radians((S + N) / 2)
    return abs(E - W) * 111.32 * math.cos(mean_lat) * abs(N - S) * 111.32


def _build_geo_info(location: str, lat: float, lon: float, buf: float = 0.3) -> dict:
    bbox = [lon - buf, lat - buf, lon + buf, lat + buf]
    return {
        "district": location,
        "division": "Bangladesh",
        "country": "Bangladesh",
        "bbox": bbox,
        "area_km2": _bbox_area_km2(bbox),
    }


def _build_message(drought_level: str, score: int, trend_info: dict) -> str:
    plain = _LEVEL_PLAIN.get(drought_level, drought_level)
    trend = trend_info.get("trend", "STABLE")
    run   = trend_info.get("run", 0)

    msg = f"{plain} — {score} of 4 sensors stressed."
    if trend == "WORSENING" and run >= 2:
        msg += f" Conditions worsening for {run} consecutive days."
    elif trend == "IMPROVING":
        msg += " Conditions are slowly improving."
    return msg


def run_all_districts(
    storage,
    days: int = 7,
    project: str | None = None,
    reports_dir: str = "/app/reports",
) -> dict:
    """
    Entry point called by the FastAPI /run/all endpoint.
    Iterates all Bangladesh districts, runs drought assessment, stores results.
    Returns a summary dict.
    """
    if not gee_configured():
        logger.warning(
            "[RUNNER] GEE credentials not found — drought pipeline skipped. "
            "Run `earthengine authenticate` or set GOOGLE_APPLICATION_CREDENTIALS."
        )
        return {
            "error": "gee_not_configured",
            "stored": 0,
            "skipped": len(DISTRICT_COORDS),
            "errors": 0,
        }

    gee_project = project or os.getenv("GEE_PROJECT", "mewa-493916")

    try:
        import ee  # type: ignore
        ee.Initialize(project=gee_project)
        logger.info("[RUNNER] GEE initialized — project=%s", gee_project)
    except Exception as exc:
        logger.error("[RUNNER] GEE initialization failed: %s", exc)
        return {"error": str(exc), "stored": 0, "skipped": len(DISTRICT_COORDS), "errors": 1}

    Path(reports_dir).mkdir(parents=True, exist_ok=True)

    stored  = 0
    errors  = 0
    skipped = 0

    for location, (lat, lon) in DISTRICT_COORDS.items():
        try:
            assessment = _run_one_district(storage, location, lat, lon, days, reports_dir)
            if assessment:
                stored += 1
                tier = assessment.get("tier", 0)
                if tier > 0:
                    logger.warning(
                        "[RUNNER] %s — tier=%d (%s) score=%d/%d",
                        location, tier, assessment.get("tier_label"),
                        assessment.get("drought_score", 0), 4,
                    )
                else:
                    logger.debug("[RUNNER] %s — Normal", location)
            else:
                skipped += 1
        except Exception as exc:
            logger.error("[RUNNER] Failed for %s: %s", location, exc)
            errors += 1

        # GEE rate limiting: brief pause between districts
        time.sleep(1)

    result = {"stored": stored, "skipped": skipped, "errors": errors, "error": None}
    logger.info("[RUNNER] All districts done: %s", result)
    return result


def _run_one_district(
    storage,
    location: str,
    lat: float,
    lon: float,
    days: int,
    reports_dir: str,
) -> dict | None:
    from fetch_dataset.fetch_data import fetch_recent_data
    from drought_report.generate_report import generate_pdf_report, analyse_trend
    from drought_classify.classify_drought import classify_band, classify_drought
    from utils.utils import ALL_BANDS

    geo_info = _build_geo_info(location, lat, lon)

    averages, daily_df, start, end = fetch_recent_data(
        geo_info["bbox"], days=days, return_daily=True
    )

    band_results: dict = {}
    score = 0
    triggers: list[str] = []

    for band in ALL_BANDS:
        res = classify_band(band, averages.get(band))
        band_results[band] = {
            "value":            res.value,
            "flag":             res.flag,
            "status":           res.status,
            "pct_of_threshold": res.pct_of_threshold,
        }
        if res.flag:
            score += 1
            label = _BAND_SHORT.get(band, band)
            pct   = res.pct_of_threshold
            triggers.append(
                f"{label} at {pct:.0f}% of safe level" if pct else f"{label} below threshold"
            )

    drought_level = classify_drought(score)
    tier          = DROUGHT_LEVEL_TO_TIER[drought_level]
    trend_info    = analyse_trend(daily_df)

    # PDF report
    date_slug     = end.replace("-", "")
    loc_slug      = location.lower().replace(" ", "_").replace("'", "")
    report_name   = f"drought_{loc_slug}_{date_slug}.pdf"
    report_path   = str(Path(reports_dir) / report_name)

    try:
        generate_pdf_report(
            geo_info, averages, start, end,
            lat=lat, lon=lon,
            output_path=report_path,
            daily_df=daily_df,
        )
    except Exception as exc:
        logger.error("[RUNNER] PDF generation failed for %s: %s", location, exc)
        report_name = ""

    assessment = {
        "location":       location,
        "lat":            lat,
        "lon":            lon,
        "assessed_at":    datetime.now(timezone.utc).isoformat(),
        "window_days":    days,
        "drought_level":  drought_level,
        "drought_score":  score,
        "tier":           tier,
        "tier_label":     DROUGHT_TIER_LABELS[tier],
        "trend":          trend_info.get("trend", "STABLE"),
        "trend_run_days": trend_info.get("run", 0),
        "trend_warning":  trend_info.get("warning", False),
        "triggers":       triggers,
        "message":        _build_message(drought_level, score, trend_info),
        "report_filename": report_name,
        "band_results":   band_results,
    }

    storage.upsert_drought_assessment(assessment)
    return assessment
