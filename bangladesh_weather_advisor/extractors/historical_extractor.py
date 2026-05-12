"""Historical baseline extraction module for CHIRPS and ERA5-Land.

Downloads multi-decade daily data from Google Earth Engine, computes
day-of-year climatology statistics (mean, std, percentiles), and
supports checkpointing so long downloads can be resumed after failures.

Design goals
------------
- Real GEE downloads only – no synthetic/dummy data
- Year-by-year batch processing to avoid GEE memory limits
- CSV checkpoint files so a crash doesn't lose already-downloaded years
- Automatic latest-date detection (accounts for CHIRPS ~35-day lag)
- Exponential-backoff retry on every GEE call
- Progress tracking with ETA estimates
- Bundled climatology export for reuse without re-downloading

Typical usage (standalone)::

    python -m production_pipeline.extractors.historical_extractor \\
        --variable chirps --start-year 1981 --end-year 2023

Or from Python::

    from production_pipeline.extractors.historical_extractor import (
        extract_chirps_historical,
        compute_chirps_climatology,
    )
    raw = extract_chirps_historical(districts_gdf)
    clim = compute_chirps_climatology(raw)
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from production_pipeline.config import (
    CURRENT_DATE,
    CURRENT_UTC,
    LOG_LEVEL,
    MAX_RETRIES,
    RETRY_BACKOFF_SEC,
)

try:
    import geopandas as gpd
except Exception:
    gpd = Any  # type: ignore

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CHIRPS_COLLECTION = "UCSB-CHG/CHIRPS/DAILY"
ERA5_COLLECTION = "ECMWF/ERA5_LAND/DAILY_AGGR"
CHIRPS_LAG_DAYS = 45  # conservative estimate of publication lag
ERA5_LAG_DAYS = 7

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "historical"
RAW_SUBDIR = "raw"

# Rate-limit delay between year-batches (seconds) to respect GEE quotas
BATCH_DELAY_SEC = float(os.getenv("HIST_BATCH_DELAY_SEC", "2.0"))


# ---------------------------------------------------------------------------
# GEE helpers (thin wrappers – reuse patterns from gee_extractor)
# ---------------------------------------------------------------------------
def _safe_import_ee() -> Any:
    try:
        import ee
        return ee
    except Exception as exc:
        raise ImportError(
            "earthengine-api is required. Install with: pip install earthengine-api geemap"
        ) from exc


def _run_with_retry(fn, op_name: str, retries: int | None = None) -> Any:
    retries = retries or MAX_RETRIES
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            sleep_sec = RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
            logger.warning(
                "%s attempt %d/%d failed: %s – retrying in %.1fs",
                op_name, attempt, retries, exc, sleep_sec,
            )
            time.sleep(sleep_sec)
    raise RuntimeError(f"{op_name} failed after {retries} attempts: {last_exc}")


def _init_gee() -> Any:
    """Initialize GEE (delegates to gee_extractor for consistency)."""
    from production_pipeline.extractors.gee_extractor import _init_gee as _gee_init
    return _gee_init()


def _coerce_district_gdf(districts_gdf: "gpd.GeoDataFrame") -> "gpd.GeoDataFrame":
    from production_pipeline.extractors.gee_extractor import _coerce_district_gdf as _coerce
    return _coerce(districts_gdf)


def _geopandas_to_ee_fc(ee: Any, gdf: "gpd.GeoDataFrame") -> Any:
    from production_pipeline.extractors.gee_extractor import _geopandas_to_ee_fc as _to_fc
    return _to_fc(ee, gdf)


def _collect_rows(fc: Any) -> List[Dict[str, Any]]:
    from production_pipeline.extractors.gee_extractor import _collect_feature_collection_rows
    return _collect_feature_collection_rows(fc)


def _add_meta(df: pd.DataFrame, source: str) -> pd.DataFrame:
    out = df.copy()
    out["source"] = source
    out["extraction_date"] = CURRENT_DATE.date().isoformat()
    out["ingested_at_utc"] = CURRENT_UTC.isoformat()
    return out


# ---------------------------------------------------------------------------
# Date detection
# ---------------------------------------------------------------------------
def get_latest_chirps_date() -> str:
    """Query GEE for the latest available CHIRPS image date.

    Returns
    -------
    str
        Date in ``YYYY-MM-DD`` format.
    """
    ee = _init_gee()
    chirps = ee.ImageCollection(CHIRPS_COLLECTION)
    latest = chirps.sort("system:time_start", False).first()
    latest_date = _run_with_retry(
        lambda: ee.Date(latest.get("system:time_start")).format("YYYY-MM-dd").getInfo(),
        "CHIRPS latest date query",
    )
    logger.info("Latest available CHIRPS date: %s", latest_date)
    return latest_date


def get_latest_era5_date() -> str:
    """Query GEE for the latest available ERA5-Land daily image date."""
    ee = _init_gee()
    era5 = ee.ImageCollection(ERA5_COLLECTION)
    latest = era5.sort("system:time_start", False).first()
    latest_date = _run_with_retry(
        lambda: ee.Date(latest.get("system:time_start")).format("YYYY-MM-dd").getInfo(),
        "ERA5 latest date query",
    )
    logger.info("Latest available ERA5 date: %s", latest_date)
    return latest_date


def _resolve_end_date(end_date: str, lag_days: int) -> str:
    """Resolve 'auto' end dates to actual latest date with lag buffer."""
    if end_date.lower() == "auto":
        safe_end = datetime.now(timezone.utc) - timedelta(days=lag_days)
        return safe_end.strftime("%Y-%m-%d")
    return end_date


# ---------------------------------------------------------------------------
# Single-year batch extraction helpers
# ---------------------------------------------------------------------------
def _extract_chirps_single_year(
    ee: Any,
    districts_ee: Any,
    year: int,
) -> pd.DataFrame:
    """Download CHIRPS daily rainfall for a single year, all districts."""
    start = f"{year}-01-01"
    end = f"{year + 1}-01-01"

    collection = (
        ee.ImageCollection(CHIRPS_COLLECTION)
        .filterDate(start, end)
        .select(["precipitation"])
    )

    reducer = ee.Reducer.mean()

    def aggregate_daily(image):
        date = image.date().format("YYYY-MM-dd")
        stats = image.reduceRegions(
            collection=districts_ee, reducer=reducer, scale=5566
        )
        return stats.map(lambda f: f.set("date", date))

    features = ee.FeatureCollection(collection.map(aggregate_daily).flatten())
    rows = _collect_rows(features)

    if not rows:
        return pd.DataFrame(columns=["date", "district_id", "district_name", "rainfall_mm", "source"])

    df = pd.DataFrame(rows)
    rename_map = {"mean": "rainfall_mm", "precipitation": "rainfall_mm"}
    for old, new in rename_map.items():
        if old in df.columns:
            df = df.rename(columns={old: new})

    # If rainfall_mm still not present, pick first non-id/date numeric column
    if "rainfall_mm" not in df.columns:
        candidates = [c for c in df.columns if c not in {"district_id", "district_name", "date"}]
        if candidates:
            df = df.rename(columns={candidates[0]: "rainfall_mm"})

    df["rainfall_mm"] = pd.to_numeric(df.get("rainfall_mm"), errors="coerce")
    df["source"] = "gee_chirps"

    keep = ["date", "district_id", "district_name", "rainfall_mm", "source"]
    for c in keep:
        if c not in df.columns:
            df[c] = np.nan
    return df[keep].copy()


def _extract_era5_single_year(
    ee: Any,
    districts_ee: Any,
    year: int,
    variables: list | None = None,
) -> pd.DataFrame:
    """Download ERA5-Land daily data for a single year, all districts."""
    variables = variables or ["temperature_2m"]
    start = f"{year}-01-01"
    end = f"{year + 1}-01-01"

    def _to_celsius(image):
        bands = []
        for v in ["temperature_2m", "temperature_2m_min", "temperature_2m_max"]:
            try:
                bands.append(image.select(v).subtract(273.15))
            except Exception:
                pass
        if not bands:
            return image
        combined = bands[0]
        for b in bands[1:]:
            combined = combined.addBands(b)
        return combined.copyProperties(image, ["system:time_start"])

    # Select available bands
    all_era5_bands = ["temperature_2m", "temperature_2m_min", "temperature_2m_max",
                      "total_evaporation_sum", "total_precipitation_sum"]
    select_bands = [v for v in all_era5_bands if any(kw in v for kw in variables)] or ["temperature_2m"]

    collection = (
        ee.ImageCollection(ERA5_COLLECTION)
        .filterDate(start, end)
    )

    # Apply celsius conversion if temperature is requested
    if any("temperature" in v for v in variables):
        collection = collection.map(_to_celsius)
    else:
        collection = collection.select(select_bands)

    reducer = ee.Reducer.mean()

    def aggregate_daily(image):
        date = image.date().format("YYYY-MM-dd")
        stats = image.reduceRegions(
            collection=districts_ee, reducer=reducer, scale=11132
        )
        return stats.map(lambda f: f.set("date", date))

    features = ee.FeatureCollection(collection.map(aggregate_daily).flatten())
    rows = _collect_rows(features)

    if not rows:
        return pd.DataFrame(columns=["date", "district_id", "district_name", "source"])

    df = pd.DataFrame(rows)

    # Rename standard columns
    rename_map = {
        "temperature_2m": "temp_mean_c",
        "temperature_2m_min": "temp_min_c",
        "temperature_2m_max": "temp_max_c",
        "total_evaporation_sum": "evapotranspiration_mm",
        "total_precipitation_sum": "precip_era5_mm",
        "mean": "temp_mean_c",
    }
    for old, new in rename_map.items():
        if old in df.columns:
            df = df.rename(columns={old: new})

    for c in df.columns:
        if c not in {"district_id", "district_name", "date", "source"}:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    df["source"] = "gee_era5"
    return df


# ---------------------------------------------------------------------------
# Batched historical extraction with checkpointing
# ---------------------------------------------------------------------------
def extract_chirps_historical(
    districts_gdf: "gpd.GeoDataFrame",
    start_date: str = "1981-01-01",
    end_date: str = "auto",
    output_dir: str | None = None,
    resume: bool = True,
    batch_size: str = "year",
) -> pd.DataFrame:
    """Download CHIRPS historical rainfall data from GEE.

    Processes year-by-year with CSV checkpoint files so the download
    can be resumed after failures.

    Parameters
    ----------
    districts_gdf : GeoDataFrame
        Bangladesh district polygons with ``geometry`` column.
    start_date : str
        Start of extraction window (default ``'1981-01-01'``).
    end_date : str
        End date or ``'auto'`` to detect latest available minus lag.
    output_dir : str, optional
        Directory for checkpoint CSVs. Defaults to ``data/historical/raw/chirps/``.
    resume : bool
        If True, skip years whose checkpoint files already exist.
    batch_size : str
        Currently only ``'year'`` is supported.

    Returns
    -------
    pd.DataFrame
        Daily rainfall per district.
        Columns: ``[date, district_id, district_name, rainfall_mm, source]``
    """
    end_date = _resolve_end_date(end_date, CHIRPS_LAG_DAYS)
    start_year = int(start_date[:4])
    end_year = int(end_date[:4])

    out_dir = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR / RAW_SUBDIR / "chirps"
    out_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "CHIRPS historical extraction: years %d–%d (%d years), output=%s",
        start_year, end_year, end_year - start_year + 1, out_dir,
    )

    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)
    districts_ee = _geopandas_to_ee_fc(ee, districts)

    all_data: list[pd.DataFrame] = []
    total_years = end_year - start_year + 1
    t0 = time.time()

    for idx, year in enumerate(range(start_year, end_year + 1)):
        ckpt = out_dir / f"chirps_{year}.csv"

        # Resume from checkpoint
        if resume and ckpt.exists():
            try:
                cached = pd.read_csv(ckpt)
                if len(cached) > 0:
                    logger.info("⏭️  %d: loaded %d rows from cache", year, len(cached))
                    all_data.append(cached)
                    continue
            except Exception as exc:
                logger.warning("Cache file corrupt for %d, re-downloading: %s", year, exc)

        logger.info("📥 %d: downloading from GEE (%d/%d)…", year, idx + 1, total_years)
        try:
            year_df = _run_with_retry(
                lambda y=year: _extract_chirps_single_year(ee, districts_ee, y),
                f"CHIRPS year {year}",
                retries=max(3, MAX_RETRIES),
            )
        except Exception as exc:
            logger.error("❌ %d: extraction failed – %s. Continuing…", year, exc)
            continue

        if year_df.empty:
            logger.warning("⚠️  %d: no data returned", year)
            continue

        # Save checkpoint
        year_df.to_csv(ckpt, index=False)
        logger.info("   ✅ %d: saved %d rows", year, len(year_df))
        all_data.append(year_df)

        # Progress & ETA
        elapsed = time.time() - t0
        done = idx + 1
        if done > 0 and done < total_years:
            eta_sec = (elapsed / done) * (total_years - done)
            logger.info(
                "   ⏱️  Progress: %d/%d years (%.0f%%) – ETA: %.0f min",
                done, total_years, 100 * done / total_years, eta_sec / 60,
            )

        # Rate-limit delay
        if BATCH_DELAY_SEC > 0:
            time.sleep(BATCH_DELAY_SEC)

    if not all_data:
        raise RuntimeError("CHIRPS historical extraction returned 0 rows for all years")

    combined = pd.concat(all_data, ignore_index=True)
    logger.info(
        "✅ CHIRPS historical complete: %d rows across %d years",
        len(combined), total_years,
    )
    return combined


def extract_era5_historical(
    districts_gdf: "gpd.GeoDataFrame",
    start_date: str = "1981-01-01",
    end_date: str = "auto",
    variables: list | None = None,
    output_dir: str | None = None,
    resume: bool = True,
) -> pd.DataFrame:
    """Download ERA5-Land historical data from GEE.

    Year-by-year with checkpointing, similar to CHIRPS extraction.

    Parameters
    ----------
    districts_gdf : GeoDataFrame
        District polygons.
    start_date : str
        Start date (default ``'1981-01-01'``).
    end_date : str
        End date or ``'auto'``.
    variables : list, optional
        ERA5 variable keywords (default ``['temperature_2m']``).
    output_dir : str, optional
        Checkpoint directory.
    resume : bool
        Resume from existing checkpoints.

    Returns
    -------
    pd.DataFrame
        Daily temperature/ET per district.
    """
    variables = variables or ["temperature_2m"]
    end_date = _resolve_end_date(end_date, ERA5_LAG_DAYS)
    start_year = int(start_date[:4])
    end_year = int(end_date[:4])

    out_dir = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR / RAW_SUBDIR / "era5"
    out_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "ERA5 historical extraction: years %d–%d, variables=%s",
        start_year, end_year, variables,
    )

    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)
    districts_ee = _geopandas_to_ee_fc(ee, districts)

    all_data: list[pd.DataFrame] = []
    total_years = end_year - start_year + 1
    t0 = time.time()

    for idx, year in enumerate(range(start_year, end_year + 1)):
        var_tag = "_".join(v[:8] for v in variables)
        ckpt = out_dir / f"era5_{var_tag}_{year}.csv"

        if resume and ckpt.exists():
            try:
                cached = pd.read_csv(ckpt)
                if len(cached) > 0:
                    logger.info("⏭️  %d: loaded %d rows from cache", year, len(cached))
                    all_data.append(cached)
                    continue
            except Exception as exc:
                logger.warning("Cache file corrupt for %d, re-downloading: %s", year, exc)

        logger.info("📥 %d: downloading ERA5 from GEE (%d/%d)…", year, idx + 1, total_years)
        try:
            year_df = _run_with_retry(
                lambda y=year: _extract_era5_single_year(ee, districts_ee, y, variables),
                f"ERA5 year {year}",
                retries=max(3, MAX_RETRIES),
            )
        except Exception as exc:
            logger.error("❌ %d: ERA5 extraction failed – %s. Continuing…", year, exc)
            continue

        if year_df.empty:
            logger.warning("⚠️  %d: no ERA5 data returned", year)
            continue

        year_df.to_csv(ckpt, index=False)
        logger.info("   ✅ %d: saved %d rows", year, len(year_df))
        all_data.append(year_df)

        elapsed = time.time() - t0
        done = idx + 1
        if done > 0 and done < total_years:
            eta_sec = (elapsed / done) * (total_years - done)
            logger.info(
                "   ⏱️  Progress: %d/%d years (%.0f%%) – ETA: %.0f min",
                done, total_years, 100 * done / total_years, eta_sec / 60,
            )

        if BATCH_DELAY_SEC > 0:
            time.sleep(BATCH_DELAY_SEC)

    if not all_data:
        raise RuntimeError("ERA5 historical extraction returned 0 rows for all years")

    combined = pd.concat(all_data, ignore_index=True)
    logger.info("✅ ERA5 historical complete: %d rows", len(combined))
    return combined


# ---------------------------------------------------------------------------
# Drive Export API helpers (NO 10MB getInfo limit)
# ---------------------------------------------------------------------------
DRIVE_EXPORT_DEFAULT_FOLDER = "bangladesh_drought_historical"


def build_districts_ee_feature_collection(districts_gdf: "gpd.GeoDataFrame") -> Any:
    """Convert district GeoDataFrame to an EE FeatureCollection.

    This is a convenience wrapper used by Drive-export workflows.
    """
    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)
    return _geopandas_to_ee_fc(ee, districts)


def export_chirps_year_to_drive(
    year: int,
    districts_fc: Any,
    folder: str = DRIVE_EXPORT_DEFAULT_FOLDER,
    description_prefix: str = "chirps",
    scale: int = 5566,
) -> Any:
    """Start one CHIRPS yearly CSV export task to Google Drive.

    This uses ``ee.batch.Export.table.toDrive`` so data is processed/exported
    server-side in Earth Engine and bypasses the 10MB client response limit.
    """
    ee = _init_gee()

    chirps = (
        ee.ImageCollection(CHIRPS_COLLECTION)
        .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
        .select(["precipitation"])
    )

    def reduce_image(img):
        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        reduced = img.reduceRegions(
            collection=districts_fc,
            reducer=ee.Reducer.mean(),
            scale=scale,
        )
        return reduced.map(
            lambda feat: feat.set(
                {
                    "date": date,
                    "rainfall_mm": feat.get("mean"),
                    "dataset": "CHIRPS",
                    "year": year,
                }
            )
        )

    export_fc = ee.FeatureCollection(chirps.map(reduce_image).flatten())
    export_name = f"{description_prefix}_{year}"

    task = ee.batch.Export.table.toDrive(
        collection=export_fc,
        description=export_name,
        folder=folder,
        fileNamePrefix=export_name,
        fileFormat="CSV",
    )
    task.start()
    logger.info("Started Drive export task: %s", export_name)
    return task


def export_era5_year_to_drive(
    year: int,
    districts_fc: Any,
    folder: str = DRIVE_EXPORT_DEFAULT_FOLDER,
    description_prefix: str = "era5",
    scale: int = 11132,
) -> Any:
    """Start one ERA5-Land yearly CSV export task to Google Drive.

    Exports district-level daily means for temperature and hydrology variables.
    Runs entirely on Earth Engine servers via Drive export (no 10MB response cap).
    """
    ee = _init_gee()

    era5 = ee.ImageCollection(ERA5_COLLECTION).filterDate(
        f"{year}-01-01", f"{year + 1}-01-01"
    )

    def prepare_image(img):
        temp_mean_c = img.select("temperature_2m").subtract(273.15).rename("temp_mean_c")
        temp_min_c = img.select("temperature_2m_min").subtract(273.15).rename("temp_min_c")
        temp_max_c = img.select("temperature_2m_max").subtract(273.15).rename("temp_max_c")
        precip_mm = img.select("total_precipitation_sum").multiply(1000).rename("precip_era5_mm")
        evap_mm = img.select("total_evaporation_sum").multiply(1000).rename("evap_era5_mm")
        out = ee.Image.cat([temp_mean_c, temp_min_c, temp_max_c, precip_mm, evap_mm])
        return out.copyProperties(img, ["system:time_start"])

    prepared = era5.map(prepare_image)

    def reduce_image(img):
        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        reduced = img.reduceRegions(
            collection=districts_fc,
            reducer=ee.Reducer.mean(),
            scale=scale,
        )
        return reduced.map(
            lambda feat: feat.set(
                {
                    "date": date,
                    "dataset": "ERA5_LAND",
                    "year": year,
                }
            )
        )

    export_fc = ee.FeatureCollection(prepared.map(reduce_image).flatten())
    export_name = f"{description_prefix}_{year}"

    task = ee.batch.Export.table.toDrive(
        collection=export_fc,
        description=export_name,
        folder=folder,
        fileNamePrefix=export_name,
        fileFormat="CSV",
    )
    task.start()
    logger.info("Started Drive export task: %s", export_name)
    return task


def export_era5_one_district(
    district_row: dict | pd.Series,
    start_year: int,
    end_year: int,
    drive_folder: str = DRIVE_EXPORT_DEFAULT_FOLDER,
) -> tuple:
    """Export ERA5-Land daily data for ONE district to Google Drive.

    Same bulletproof single-district approach used for CHIRPS.
    Variables exported: temperature_2m (°C), total_evaporation_sum (mm).

    Parameters
    ----------
    district_row : dict or pd.Series
        Must contain ``district_id_canonical``, ``district_name_canonical``,
        and a geometry (``geometry`` or ``geometry_wkt``).
    start_year, end_year : int
        Year range (inclusive).
    drive_folder : str
        Google Drive folder name.

    Returns
    -------
    tuple(task, task_description)
    """
    ee = _init_gee()
    from shapely import wkt as shapely_wkt
    from shapely.geometry import MultiPolygon

    district_id = district_row["district_id_canonical"]
    district_name = district_row["district_name_canonical"]

    # Parse geometry
    geom_shapely = None
    if hasattr(district_row, "geometry") and district_row.get("geometry") is not None:
        geom_shapely = district_row["geometry"]
        if isinstance(geom_shapely, str):
            geom_shapely = shapely_wkt.loads(geom_shapely)
    elif "geometry_wkt" in (district_row.index if hasattr(district_row, "index") else district_row):
        val = district_row["geometry_wkt"]
        if val and str(val) != "nan":
            geom_shapely = shapely_wkt.loads(val)

    if geom_shapely is None:
        raise ValueError(f"No geometry found for district {district_id}")

    # For MultiPolygon, use the largest polygon
    if isinstance(geom_shapely, MultiPolygon):
        geom_shapely = max(geom_shapely.geoms, key=lambda g: g.area)

    # Simplify to reduce payload
    geom_shapely = geom_shapely.simplify(tolerance=0.005, preserve_topology=True)
    coords = list(geom_shapely.exterior.coords)
    ee_geom = ee.Geometry.Polygon(coords)

    # ERA5-Land collection
    date_start = f"{start_year}-01-01"
    date_end = f"{end_year + 1}-01-01"

    era5 = (
        ee.ImageCollection(ERA5_COLLECTION)
        .filterDate(date_start, date_end)
        .filterBounds(ee_geom)
        .select(["temperature_2m", "total_evaporation_sum"])
    )

    def reduce_image(img):
        date_str = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        stats = img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=ee_geom,
            scale=11132,
            maxPixels=1e9,
            bestEffort=True,
        )
        temp_c = ee.Number(stats.get("temperature_2m")).subtract(273.15)
        evap_mm = ee.Number(stats.get("total_evaporation_sum")).multiply(1000)
        return ee.Feature(None, {
            "district_id": district_id,
            "district_name": district_name,
            "date": date_str,
            "temperature_c": temp_c,
            "evaporation_mm": evap_mm,
        })

    results = era5.map(reduce_image)

    safe_name = district_id.replace(" ", "_").replace("-", "_")
    task_desc = f"era5_{safe_name}_{start_year}_{end_year}"

    task = ee.batch.Export.table.toDrive(
        collection=results,
        description=task_desc,
        folder=drive_folder,
        fileNamePrefix=f"era5_{safe_name}",
        fileFormat="CSV",
        selectors=["district_id", "district_name", "date", "temperature_c", "evaporation_mm"],
    )
    task.start()
    logger.info("Started ERA5 Drive export task: %s", task_desc)
    return task, task_desc


def start_historical_drive_exports(
    districts_fc: Any,
    start_year: int = 1981,
    end_year: int = 2023,
    folder: str = DRIVE_EXPORT_DEFAULT_FOLDER,
    dataset: str = "both",
) -> Dict[str, List[Tuple[int, Any]]]:
    """Start year-by-year Drive exports for CHIRPS and/or ERA5.

    Parameters
    ----------
    districts_fc : ee.FeatureCollection
        District polygons with district_id and district_name properties.
    start_year, end_year : int
        Year range to export (inclusive).
    folder : str
        Google Drive folder name for exported CSV files.
    dataset : str
        ``chirps``, ``era5``, or ``both``.
    """
    dataset = dataset.lower().strip()
    if dataset not in {"chirps", "era5", "both"}:
        raise ValueError("dataset must be one of: chirps, era5, both")

    started: Dict[str, List[Tuple[int, Any]]] = {"chirps": [], "era5": []}

    if dataset in {"chirps", "both"}:
        for year in range(start_year, end_year + 1):
            task = export_chirps_year_to_drive(year=year, districts_fc=districts_fc, folder=folder)
            started["chirps"].append((year, task))

    if dataset in {"era5", "both"}:
        for year in range(start_year, end_year + 1):
            task = export_era5_year_to_drive(year=year, districts_fc=districts_fc, folder=folder)
            started["era5"].append((year, task))

    return started


def list_drive_export_tasks(description_contains: str | None = None) -> pd.DataFrame:
    """Return Earth Engine export tasks as a DataFrame.

    Useful for monitoring Drive export progress from notebooks.
    """
    ee = _safe_import_ee()
    rows: list[dict[str, Any]] = []

    for task in ee.batch.Task.list():
        status = task.status() or {}
        desc = status.get("description", "")
        if description_contains and description_contains not in desc:
            continue

        rows.append(
            {
                "id": status.get("id"),
                "description": desc,
                "state": status.get("state"),
                "task_type": status.get("task_type"),
                "creation_timestamp_ms": status.get("creation_timestamp_ms"),
                "update_timestamp_ms": status.get("update_timestamp_ms"),
                "error_message": status.get("error_message", ""),
            }
        )

    if not rows:
        return pd.DataFrame(
            columns=[
                "id",
                "description",
                "state",
                "task_type",
                "creation_timestamp_ms",
                "update_timestamp_ms",
                "error_message",
            ]
        )

    return pd.DataFrame(rows).sort_values(
        by=["creation_timestamp_ms", "description"], ascending=[False, True]
    )


def summarize_export_progress(
    description_prefix: str,
    expected_task_count: int,
) -> Dict[str, Any]:
    """Summarize completion progress for tasks by description prefix."""
    tasks_df = list_drive_export_tasks(description_contains=description_prefix)
    if tasks_df.empty:
        return {
            "description_prefix": description_prefix,
            "expected_task_count": expected_task_count,
            "matched_task_count": 0,
            "completed": 0,
            "failed": 0,
            "running": 0,
            "ready": 0,
            "cancelled": 0,
            "is_complete": False,
        }

    counts = tasks_df["state"].value_counts().to_dict()
    completed = int(counts.get("COMPLETED", 0))
    failed = int(counts.get("FAILED", 0))
    running = int(counts.get("RUNNING", 0))
    ready = int(counts.get("READY", 0))
    cancelled = int(counts.get("CANCELLED", 0))

    return {
        "description_prefix": description_prefix,
        "expected_task_count": expected_task_count,
        "matched_task_count": int(len(tasks_df)),
        "completed": completed,
        "failed": failed,
        "running": running,
        "ready": ready,
        "cancelled": cancelled,
        "is_complete": completed >= expected_task_count and failed == 0,
    }


def combine_export_csvs(csv_dir: str | Path, pattern: str) -> pd.DataFrame:
    """Load and combine downloaded Drive-export CSV files from local disk."""
    csv_path = Path(csv_dir)
    files = sorted(csv_path.glob(pattern))
    if not files:
        raise FileNotFoundError(f"No files found in {csv_path} matching pattern: {pattern}")

    frames: list[pd.DataFrame] = []
    for file in files:
        df = pd.read_csv(file)
        df["_source_file"] = file.name
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def process_downloaded_chirps_exports(
    csv_dir: str | Path,
    output_csv_path: str | Path,
    pattern: str = "chirps_*.csv",
) -> pd.DataFrame:
    """Build CHIRPS climatology from downloaded Drive export CSVs and save it."""
    combined = combine_export_csvs(csv_dir, pattern)

    if "rainfall_mm" not in combined.columns and "mean" in combined.columns:
        combined = combined.rename(columns={"mean": "rainfall_mm"})

    required = {"date", "district_id", "rainfall_mm"}
    missing = sorted(required - set(combined.columns))
    if missing:
        raise ValueError(f"CHIRPS exports missing required columns: {missing}")

    climatology = compute_chirps_climatology(combined)
    out = Path(output_csv_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    climatology.to_csv(out, index=False)
    logger.info("Saved CHIRPS climatology from downloaded exports: %s", out)
    return climatology


def process_downloaded_era5_exports(
    csv_dir: str | Path,
    output_csv_path: str | Path,
    pattern: str = "era5_*.csv",
) -> pd.DataFrame:
    """Build ERA5 climatology from downloaded Drive export CSVs and save it."""
    combined = combine_export_csvs(csv_dir, pattern)

    required = {"date", "district_id"}
    missing = sorted(required - set(combined.columns))
    if missing:
        raise ValueError(f"ERA5 exports missing required columns: {missing}")

    climatology = compute_era5_climatology(combined)
    out = Path(output_csv_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    climatology.to_csv(out, index=False)
    logger.info("Saved ERA5 climatology from downloaded exports: %s", out)
    return climatology


# ---------------------------------------------------------------------------
# Climatology computation
# ---------------------------------------------------------------------------
def compute_chirps_climatology(
    historical_df: pd.DataFrame,
) -> pd.DataFrame:
    """Compute CHIRPS day-of-year climatology from daily historical data.

    For each district and day-of-year (1–366), computes:
    - Mean rainfall
    - Standard deviation
    - 10th, 25th, 50th, 75th, 90th percentiles

    Parameters
    ----------
    historical_df : pd.DataFrame
        Must contain columns ``[date, district_id, rainfall_mm]``.

    Returns
    -------
    pd.DataFrame
        Columns: ``[district_id, day_of_year, mean_mm, std_mm, p10, p25, p50, p75, p90, source]``
    """
    df = historical_df.copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["rainfall_mm"] = pd.to_numeric(df["rainfall_mm"], errors="coerce")
    df = df.dropna(subset=["date", "rainfall_mm"])
    df["day_of_year"] = df["date"].dt.dayofyear

    logger.info(
        "Computing CHIRPS climatology from %d records, %d districts",
        len(df), df["district_id"].nunique(),
    )

    grouped = df.groupby(["district_id", "day_of_year"])["rainfall_mm"]

    stats = grouped.agg(
        mean_mm="mean",
        std_mm="std",
    ).reset_index()

    quantiles = (
        grouped.quantile([0.10, 0.25, 0.50, 0.75, 0.90])
        .unstack(level=-1)
        .rename(columns={0.10: "p10", 0.25: "p25", 0.50: "p50", 0.75: "p75", 0.90: "p90"})
        .reset_index()
    )

    out = stats.merge(quantiles, on=["district_id", "day_of_year"], how="left")

    # Fill NaN std for days with single observation
    out["std_mm"] = out["std_mm"].fillna(0.0)

    out = _add_meta(out, "gee_chirps_climatology")
    logger.info("✅ CHIRPS climatology: %d rows", len(out))
    return out


def compute_era5_climatology(
    historical_df: pd.DataFrame,
) -> pd.DataFrame:
    """Compute ERA5 day-of-year climatology from daily historical data.

    For each district and day-of-year, computes mean, std, and percentiles
    for all available numeric columns (temp_mean_c, temp_min_c, etc.).

    Parameters
    ----------
    historical_df : pd.DataFrame
        Must contain ``[date, district_id]`` and at least one numeric variable column.

    Returns
    -------
    pd.DataFrame
        Climatology statistics per district and day-of-year.
    """
    df = historical_df.copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"])
    df["day_of_year"] = df["date"].dt.dayofyear

    # Identify numeric value columns
    skip_cols = {"district_id", "district_name", "date", "day_of_year", "source",
                 "extraction_date", "ingested_at_utc"}
    value_cols = [c for c in df.columns if c not in skip_cols and pd.api.types.is_numeric_dtype(df[c])]

    if not value_cols:
        raise ValueError("No numeric value columns found in historical ERA5 data")

    logger.info(
        "Computing ERA5 climatology for columns %s from %d records",
        value_cols, len(df),
    )

    results = []
    for col in value_cols:
        grouped = df.groupby(["district_id", "day_of_year"])[col]
        stats = grouped.agg(mean="mean", std="std").reset_index()
        stats["std"] = stats["std"].fillna(0.0)

        quantiles = (
            grouped.quantile([0.10, 0.25, 0.50, 0.75, 0.90])
            .unstack(level=-1)
            .rename(columns={0.10: "p10", 0.25: "p25", 0.50: "p50", 0.75: "p75", 0.90: "p90"})
            .reset_index()
        )

        merged = stats.merge(quantiles, on=["district_id", "day_of_year"], how="left")
        # Prefix columns with variable name
        for c in ["mean", "std", "p10", "p25", "p50", "p75", "p90"]:
            merged = merged.rename(columns={c: f"{col}_{c}"})
        results.append(merged)

    # Merge all variable climatologies
    out = results[0]
    for r in results[1:]:
        out = out.merge(r, on=["district_id", "day_of_year"], how="outer")

    out = _add_meta(out, "gee_era5_climatology")
    logger.info("✅ ERA5 climatology: %d rows", len(out))
    return out


# ---------------------------------------------------------------------------
# Bundled climatology save/load
# ---------------------------------------------------------------------------
def save_climatology_bundle(
    chirps_clim: pd.DataFrame | None = None,
    era5_clim: pd.DataFrame | None = None,
    output_dir: str | None = None,
) -> Path:
    """Save computed climatology as bundled CSV files for future reuse.

    Parameters
    ----------
    chirps_clim : pd.DataFrame, optional
        CHIRPS climatology DataFrame.
    era5_clim : pd.DataFrame, optional
        ERA5 climatology DataFrame.
    output_dir : str, optional
        Output directory (default: ``data/historical/``).

    Returns
    -------
    Path
        Directory where files were saved.
    """
    out_dir = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    if chirps_clim is not None and not chirps_clim.empty:
        path = out_dir / "chirps_climatology_1981_2023.csv"
        chirps_clim.to_csv(path, index=False)
        logger.info("💾 Saved CHIRPS climatology: %s (%d rows)", path, len(chirps_clim))

    if era5_clim is not None and not era5_clim.empty:
        path = out_dir / "era5_climatology_1981_2023.csv"
        era5_clim.to_csv(path, index=False)
        logger.info("💾 Saved ERA5 climatology: %s (%d rows)", path, len(era5_clim))

    return out_dir


def load_climatology_bundle(
    variable: str = "chirps",
    data_dir: str | None = None,
) -> pd.DataFrame | None:
    """Load pre-computed climatology from bundled CSV files.

    Parameters
    ----------
    variable : str
        ``'chirps'`` or ``'era5'``.
    data_dir : str, optional
        Directory to search (default: ``data/historical/``).

    Returns
    -------
    pd.DataFrame or None
        Loaded climatology, or None if file not found.
    """
    search_dir = Path(data_dir) if data_dir else DEFAULT_OUTPUT_DIR
    pattern = f"{variable.lower()}_climatology_*.csv"
    matches = sorted(search_dir.glob(pattern))

    if not matches:
        logger.info("No bundled %s climatology found in %s", variable, search_dir)
        return None

    path = matches[-1]  # latest file
    df = pd.read_csv(path)
    logger.info("📂 Loaded bundled %s climatology: %s (%d rows)", variable, path, len(df))
    return df


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def _cli():
    """Command-line interface for historical extraction."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Download historical climate data from GEE and compute climatology"
    )
    parser.add_argument(
        "--variable", choices=["chirps", "era5", "both"], default="both",
        help="Which dataset to download",
    )
    parser.add_argument("--start-year", type=int, default=1981)
    parser.add_argument("--end-year", type=int, default=2023)
    parser.add_argument("--output-dir", type=str, default=None)
    parser.add_argument("--no-resume", action="store_true", help="Force re-download all years")
    parser.add_argument(
        "--districts-csv", type=str, default=None,
        help="Path to HDX boundaries CSV (auto-detected if omitted)",
    )

    args = parser.parse_args()

    # Load districts
    from production_pipeline.extractors.static_extractor import load_hdx_boundaries
    if args.districts_csv:
        import geopandas as _gpd
        from shapely import wkt as _wkt
        df = pd.read_csv(args.districts_csv)
        if "geometry_wkt" in df.columns:
            df["geometry"] = df["geometry_wkt"].apply(_wkt.loads)
            districts_gdf = _gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")
        else:
            districts_gdf = _gpd.GeoDataFrame(df)
    else:
        districts_gdf = load_hdx_boundaries()

    start_date = f"{args.start_year}-01-01"
    end_date = f"{args.end_year}-12-31"
    resume = not args.no_resume

    chirps_clim = None
    era5_clim = None

    if args.variable in ("chirps", "both"):
        print(f"\n{'='*60}")
        print(f"CHIRPS Historical Extraction ({args.start_year}–{args.end_year})")
        print(f"{'='*60}")
        raw = extract_chirps_historical(
            districts_gdf, start_date=start_date, end_date=end_date,
            output_dir=args.output_dir, resume=resume,
        )
        print(f"\n📊 Computing CHIRPS climatology from {len(raw):,} daily records…")
        chirps_clim = compute_chirps_climatology(raw)

    if args.variable in ("era5", "both"):
        print(f"\n{'='*60}")
        print(f"ERA5-Land Historical Extraction ({args.start_year}–{args.end_year})")
        print(f"{'='*60}")
        raw = extract_era5_historical(
            districts_gdf, start_date=start_date, end_date=end_date,
            output_dir=args.output_dir, resume=resume,
        )
        print(f"\n📊 Computing ERA5 climatology from {len(raw):,} daily records…")
        era5_clim = compute_era5_climatology(raw)

    # Save bundled output
    out_path = save_climatology_bundle(chirps_clim, era5_clim, args.output_dir)
    print(f"\n✅ Climatology files saved to: {out_path}")


if __name__ == "__main__":
    _cli()
