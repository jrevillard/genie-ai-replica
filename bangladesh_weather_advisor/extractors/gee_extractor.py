"""Google Earth Engine extractor module (production-ready).

Implements real extraction for:
- CHIRPS daily rainfall
- SMAP soil moisture
- ERA5-Land temperature
- MODIS NDVI/EVI
- Historical climatology baselines

Design goals:
- Real Earth Engine API calls only (no synthetic fallback rows)
- Works in Colab (interactive auth) and production (service account/default creds)
- Exponential-backoff retries for network/API operations
- Data validation and quality flagging
- Optional parquet export
"""

from __future__ import annotations

import logging
import math
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import pandas as pd

from production_pipeline.config import (
    CURRENT_DATE,
    CURRENT_UTC,
    GEE_CREDENTIALS_PATH,
    GEE_SERVICE_ACCOUNT,
    LOG_LEVEL,
    MAX_RETRIES,
    RETRY_BACKOFF_SEC,
)

try:  # optional dependency
    import geopandas as gpd
except Exception:  # pragma: no cover - env dependent
    gpd = Any  # type: ignore

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


def _safe_import_ee() -> Any:
    try:
        import ee  # type: ignore

        return ee
    except Exception as exc:  # pragma: no cover
        raise ImportError(
            "earthengine-api is required. Install with: pip install earthengine-api geemap"
        ) from exc


def _run_with_retry(fn: Callable[[], Any], op_name: str, retries: Optional[int] = None) -> Any:
    retries = retries or MAX_RETRIES
    last_exc: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except Exception as exc:  # pragma: no cover - network/API dependent
            last_exc = exc
            sleep_sec = RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
            logger.warning(
                "%s failed (attempt %d/%d): %s. Retrying in %.2fs",
                op_name,
                attempt,
                retries,
                exc,
                sleep_sec,
            )
            time.sleep(sleep_sec)
    raise RuntimeError(f"{op_name} failed after {retries} attempts: {last_exc}")


def _get_current_gee_project() -> Optional[str]:
    """Get GEE project at runtime (not module import time)."""
    project = os.getenv("GEE_PROJECT", None)

    if project and project != "ee-your-project":
        return project

    ee = _safe_import_ee()
    try:
        # If already initialized elsewhere (e.g., notebook setup cell), no project is required.
        ee.data.getAssetRoots()
        return None
    except Exception:
        raise ValueError(
            "GEE_PROJECT not set! Please set before calling extractors:\n"
            "  os.environ['GEE_PROJECT'] = 'your-project-name'"
        )


def _init_gee(allow_interactive_auth: bool = True) -> Any:
    """Initialize Earth Engine for production or Colab.

    Priority:
    1) Service account from env
    2) Existing local/ADC auth
    3) Interactive ee.Authenticate() in Colab-like sessions (if enabled)
    """
    ee = _safe_import_ee()
    project = _get_current_gee_project()

    def _initialize() -> None:
        if GEE_SERVICE_ACCOUNT and GEE_CREDENTIALS_PATH:
            logger.info("Initializing GEE with service account %s", GEE_SERVICE_ACCOUNT)
            credentials = ee.ServiceAccountCredentials(GEE_SERVICE_ACCOUNT, GEE_CREDENTIALS_PATH)
            if project:
                ee.Initialize(credentials=credentials, project=project)
            else:
                ee.Initialize(credentials=credentials)
        else:
            logger.info("Initializing GEE with default credentials (project=%s)", project or "default")
            if project:
                ee.Initialize(project=project)
            else:
                ee.Initialize()

    try:
        _run_with_retry(_initialize, "GEE initialize")
        return ee
    except Exception as init_exc:
        if not allow_interactive_auth:
            raise
        try:  # pragma: no cover - interactive path
            import google.colab  # noqa: F401

            logger.info("Falling back to interactive ee.Authenticate() for Colab")
            ee.Authenticate()
            _run_with_retry(_initialize, "GEE initialize after Authenticate")
            return ee
        except Exception:
            raise RuntimeError(f"Unable to initialize GEE: {init_exc}") from init_exc


def _require_columns(df: pd.DataFrame, required: Iterable[str], obj_name: str) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"{obj_name} missing required columns: {missing}")


def _get_district_columns(df: pd.DataFrame) -> Tuple[Optional[str], Optional[str]]:
    """Auto-detect district ID/name columns from heterogeneous source schemas."""

    id_candidates = [
        "district_id_canonical",
        "district_id",
        "hdx_id",
        "adm2_pcode",
        "district_code",
        "districtid",
        "id",
    ]
    name_candidates = [
        "district_name_canonical",
        "district_name",
        "district",
        "name",
        "adm2_en",
        "admin2name",
        "shapename",
    ]

    normalized = {str(col).strip().lower(): col for col in df.columns}

    id_col = next((normalized[c] for c in id_candidates if c in normalized), None)
    name_col = next((normalized[c] for c in name_candidates if c in normalized), None)

    return id_col, name_col


def _extract_polygon(geometry: Any) -> Optional[Any]:
    """Return a clean Polygon geometry.

    - Handles Polygon directly.
    - For MultiPolygon, selects the largest polygon by area.
    - Accepts WKT strings when present.
    """
    if geometry is None:
        return None

    geom_obj = geometry
    if isinstance(geom_obj, str):
        try:
            from shapely import wkt as shapely_wkt  # type: ignore

            geom_obj = shapely_wkt.loads(geom_obj)
        except Exception:
            logger.warning("Could not parse WKT geometry; skipping feature")
            return None

    if getattr(geom_obj, "is_empty", False):
        return None

    geom_type = str(getattr(geom_obj, "geom_type", "")).lower()
    if geom_type == "polygon":
        return geom_obj

    if geom_type == "multipolygon":
        parts = [g for g in getattr(geom_obj, "geoms", []) if str(getattr(g, "geom_type", "")).lower() == "polygon"]
        if not parts:
            return None
        return max(parts, key=lambda g: float(getattr(g, "area", 0.0)))

    if geom_type == "geometrycollection":
        parts = [g for g in getattr(geom_obj, "geoms", []) if str(getattr(g, "geom_type", "")).lower() == "polygon"]
        if parts:
            return max(parts, key=lambda g: float(getattr(g, "area", 0.0)))

    logger.warning("Unsupported geometry type '%s'; skipping feature", geom_type or "unknown")
    return None


def _coerce_district_gdf(districts_gdf: "gpd.GeoDataFrame") -> "gpd.GeoDataFrame":
    # ── robust emptiness check ─────────────────────────────────────────
    if districts_gdf is None:
        raise ValueError("districts_gdf is None – you must supply a GeoDataFrame")

    # Use the .empty property (pandas-idiomatic) and guard against edge
    # cases where len() or bool() might behave unexpectedly on DataFrames.
    try:
        n_rows = len(districts_gdf)
        is_empty = getattr(districts_gdf, "empty", n_rows == 0)
    except Exception:
        n_rows = 0
        is_empty = True

    if is_empty or n_rows == 0:
        raise ValueError(
            f"districts_gdf is empty (type={type(districts_gdf).__name__}, "
            f"shape={getattr(districts_gdf, 'shape', '?')}, "
            f"columns={list(getattr(districts_gdf, 'columns', []))})"
        )

    logger.info(
        "_coerce_district_gdf: received %d rows, type=%s, columns=%s",
        n_rows, type(districts_gdf).__name__, list(districts_gdf.columns),
    )

    # ── locate or create a geometry column ─────────────────────────────
    has_geom_col = "geometry" in districts_gdf.columns
    has_wkt_col = "geometry_wkt" in districts_gdf.columns

    if not has_geom_col and not has_wkt_col:
        raise ValueError(
            f"districts_gdf must contain a 'geometry' or 'geometry_wkt' column. "
            f"Found columns: {list(districts_gdf.columns)}"
        )

    work = districts_gdf.copy()

    # If geometry_wkt exists but geometry does not, parse WKT into geometry.
    if not has_geom_col and has_wkt_col:
        try:
            from shapely import wkt as _wkt
            work["geometry"] = work["geometry_wkt"].apply(_wkt.loads)
            logger.info("Parsed %d geometries from geometry_wkt column", len(work))
        except Exception as exc:
            raise ValueError(f"Failed to parse geometry_wkt column: {exc}") from exc

    # ── detect id / name columns ───────────────────────────────────────
    id_col, name_col = _get_district_columns(work)
    logger.info("Detected district columns: id=%s name=%s", id_col or "<index>", name_col or "<district_id>")

    if id_col:
        work["district_id"] = work[id_col].astype(str).str.strip()
    else:
        work["district_id"] = work.index.astype(str)

    if name_col:
        work["district_name"] = work[name_col].astype(str).str.strip()
    else:
        work["district_name"] = work["district_id"].astype(str)

    # ── normalise geometry (WKT strings, MultiPolygon → Polygon) ──────
    work["geometry"] = work["geometry"].apply(_extract_polygon)
    work = work[work["geometry"].notna()].copy()

    if work.empty:
        raise ValueError(
            f"No valid Polygon geometries found after geometry normalization "
            f"(started with {n_rows} rows). Check that the geometry column "
            f"contains valid Shapely geometries or WKT strings."
        )

    work = work[["district_id", "district_name", "geometry"]].copy()

    if hasattr(work, "crs") and work.crs is not None and str(work.crs) != "EPSG:4326":
        work = work.to_crs(epsg=4326)

    return work


def _geopandas_to_ee_fc(ee: Any, districts_gdf: "gpd.GeoDataFrame") -> Any:
    """Convert district GeoDataFrame to EE FeatureCollection with robust geometry handling."""

    work = districts_gdf.copy()
    work["geometry"] = work["geometry"].apply(_extract_polygon)
    work = work[work["geometry"].notna()].copy()

    if work.empty:
        raise ValueError("No valid district geometries available for EE conversion")

    try:
        import geemap  # type: ignore

        return geemap.geopandas_to_ee(work)
    except Exception as exc:
        logger.warning("geemap conversion unavailable (%s). Falling back to manual conversion.", exc)

    features = []
    skipped = 0
    for _, row in work.iterrows():
        geom = _extract_polygon(row.geometry)
        if geom is None:
            skipped += 1
            continue

        geom_json = geom.__geo_interface__
        props = {
            "district_id": str(row["district_id"]),
            "district_name": str(row["district_name"]),
        }
        features.append(ee.Feature(ee.Geometry(geom_json), props))

    if not features:
        raise RuntimeError("Could not build EE FeatureCollection: all district geometries were invalid")

    if skipped:
        logger.warning("Skipped %d invalid district geometries during EE conversion", skipped)

    return ee.FeatureCollection(features)


def _collect_feature_collection_rows(fc: Any) -> List[Dict[str, Any]]:
    payload = _run_with_retry(lambda: fc.getInfo(), "GEE FeatureCollection getInfo", retries=max(2, MAX_RETRIES))
    features = payload.get("features", []) if isinstance(payload, dict) else []
    rows: List[Dict[str, Any]] = []
    for feat in features:
        props = feat.get("properties", {})
        rows.append(props)
    return rows


def _add_meta(df: pd.DataFrame, source: str) -> pd.DataFrame:
    out = df.copy()
    out["source"] = source
    out["extraction_date"] = CURRENT_DATE.date().isoformat()
    out["ingested_at_utc"] = CURRENT_UTC.isoformat()
    return out


def _save_parquet(df: pd.DataFrame, output_path: Optional[str]) -> None:
    if not output_path:
        return
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(target, index=False)
    logger.info("Saved %d rows to %s", len(df), target)


def _validate_range(series: pd.Series, low: float, high: float) -> pd.Series:
    return series.notna() & (series >= low) & (series <= high)


def _reduce_daily_collection(
    ee: Any,
    collection: Any,
    districts_ee: Any,
    scale: int,
    reducer: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """Reduce an image collection per district per image.

    NOTE: For sub-daily collections (e.g. SMAP 3-hourly), use
    _reduce_daily_collection_safe() instead to avoid payload limits.
    """
    reducer = reducer or ee.Reducer.mean().combine(ee.Reducer.stdDev(), "", True).combine(ee.Reducer.count(), "", True)

    def aggregate_daily(image: Any) -> Any:
        date = image.date().format("YYYY-MM-dd")
        stats = image.reduceRegions(collection=districts_ee, reducer=reducer, scale=scale)
        return stats.map(lambda f: f.set("date", date))

    features = ee.FeatureCollection(collection.map(aggregate_daily).flatten())
    return _collect_feature_collection_rows(features)


def _reduce_daily_collection_safe(
    ee: Any,
    collection: Any,
    districts_ee: Any,
    scale: int,
    start_date: str,
    end_date: str,
    reducer: Optional[Any] = None,
    dataset_name: str = "dataset",
) -> List[Dict[str, Any]]:
    """Reduce collection one day at a time to avoid GEE payload limits.

    This is critical for sub-daily collections like SMAP (3-hourly) where
    mapping over all images at once causes 'Response size exceeds limit'.
    Each day is composited (mean) then reduced, and fetched separately.
    """
    reducer = reducer or ee.Reducer.mean().combine(ee.Reducer.count(), "", True)

    start_dt = pd.to_datetime(start_date)
    end_dt = pd.to_datetime(end_date)
    n_days = max(1, int((end_dt - start_dt).days))

    all_rows: List[Dict[str, Any]] = []
    for day_offset in range(n_days):
        day = start_dt + pd.Timedelta(days=day_offset)
        day_str = day.strftime("%Y-%m-%d")
        next_day_str = (day + pd.Timedelta(days=1)).strftime("%Y-%m-%d")

        try:
            daily_composite = collection.filterDate(day_str, next_day_str).mean()
            # Set a time property so we can tag it
            stats = daily_composite.reduceRegions(
                collection=districts_ee, reducer=reducer, scale=scale
            )
            stats = stats.map(lambda f: f.set("date", ee.String(day_str)))
            day_rows = _collect_feature_collection_rows(stats)
            all_rows.extend(day_rows)
        except Exception as exc:
            logger.warning("%s day %s failed: %s", dataset_name, day_str, exc)
            continue

    return all_rows


def _reduce_daily_collection_batched(
    ee: Any,
    collection: Any,
    districts_gdf: "gpd.GeoDataFrame",
    scale: int,
    reducer: Optional[Any] = None,
    batch_size: int = 8,
    dataset_name: str = "dataset",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    use_safe_daily: bool = False,
) -> List[Dict[str, Any]]:
    """Process districts in batches to avoid GEE payload limits.

    Args:
        use_safe_daily: If True, uses _reduce_daily_collection_safe() which
            composites sub-daily data per day and fetches day-by-day.
            Required for SMAP (3-hourly) to avoid 'Response size exceeds limit'.
        start_date/end_date: Required when use_safe_daily=True.
    """
    if batch_size <= 0:
        raise ValueError("batch_size must be > 0")

    total = len(districts_gdf)
    if total == 0:
        return []

    total_batches = math.ceil(total / batch_size)
    msg = (
        f"[{dataset_name}] Starting batched extraction: "
        f"{total} districts, batch_size={batch_size}, total_batches={total_batches}"
    )
    logger.info(msg)
    logger.info(msg)

    all_rows: List[Dict[str, Any]] = []
    failed_batches: List[int] = []

    for offset in range(0, total, batch_size):
        batch_idx = (offset // batch_size) + 1
        batch_gdf = districts_gdf.iloc[offset : offset + batch_size]

        try:
            batch_fc = _geopandas_to_ee_fc(ee, batch_gdf)

            if use_safe_daily and start_date and end_date:
                # Day-by-day compositing to avoid payload explosion
                # (critical for sub-daily collections like SMAP)
                batch_rows = _reduce_daily_collection_safe(
                    ee=ee,
                    collection=collection,
                    districts_ee=batch_fc,
                    scale=scale,
                    start_date=start_date,
                    end_date=end_date,
                    reducer=reducer,
                    dataset_name=dataset_name,
                )
            else:
                batch_rows = _reduce_daily_collection(
                    ee=ee,
                    collection=collection,
                    districts_ee=batch_fc,
                    scale=scale,
                    reducer=reducer,
                )

            all_rows.extend(batch_rows)
            msg = (
                f"[{dataset_name}] Batch {batch_idx}/{total_batches} complete: "
                f"{len(batch_gdf)} districts, {len(batch_rows)} rows"
            )
            logger.info(msg)
            logger.info(msg)

        except Exception as batch_exc:
            failed_batches.append(batch_idx)
            msg = (
                f"[{dataset_name}] Batch {batch_idx}/{total_batches} FAILED "
                f"({len(batch_gdf)} districts): {batch_exc}. Continuing..."
            )
            logger.info(msg)
            logger.error(msg)
            continue

    if failed_batches:
        msg = (
            f"[{dataset_name}] Completed with failures. "
            f"failed_batches={failed_batches} succeeded={total_batches - len(failed_batches)}/{total_batches}"
        )
        logger.info(msg)
        logger.warning(msg)
    else:
        msg = f"[{dataset_name}] All {total_batches} batches complete: {len(all_rows)} total rows"
        logger.info(msg)
        logger.info(msg)

    return all_rows


def _get_collection_latest_date(ee: Any, collection_id: str, band_name: Optional[str] = None) -> Optional[pd.Timestamp]:
    """Query GEE for latest available image timestamp in a collection."""
    collection = ee.ImageCollection(collection_id)
    if band_name:
        collection = collection.select([band_name])

    latest_millis = _run_with_retry(
        lambda: collection.sort("system:time_start", False).first().get("system:time_start").getInfo(),
        f"{collection_id} latest date check",
    )

    if latest_millis in (None, "", 0):
        return None

    try:
        return pd.to_datetime(int(latest_millis), unit="ms", utc=True)
    except Exception:
        logger.warning("Could not parse latest timestamp for %s: %s", collection_id, latest_millis)
        return None


def _resolve_live_window(
    ee: Any,
    collection_id: str,
    requested_start_date: Optional[str],
    requested_end_date: Optional[str],
    default_recent_days: int = 14,
    latest_band_name: Optional[str] = None,
) -> Tuple[str, str, Optional[pd.Timestamp]]:
    """Return a safe and recent [start, end) window for live extraction.

    Behavior:
    - Auto-detects latest collection date from GEE.
    - If caller omits dates, uses latest available date with ``default_recent_days`` window.
    - Clips requested end date to latest available date (+1 day because filterDate end is exclusive).
    - Auto-shifts stale windows to a recent one.
    """
    latest_ts = _get_collection_latest_date(ee, collection_id, band_name=latest_band_name)
    today_utc = pd.Timestamp(CURRENT_DATE.date().isoformat(), tz="UTC")

    if latest_ts is None:
        if not requested_start_date or not requested_end_date:
            fallback_end = (today_utc + pd.Timedelta(days=1)).date().isoformat()
            fallback_start = (today_utc - pd.Timedelta(days=default_recent_days)).date().isoformat()
            logger.warning(
                "%s latest available date is unknown; using fallback window %s..%s",
                collection_id,
                fallback_start,
                fallback_end,
            )
            return fallback_start, fallback_end, None
        logger.warning(
            "%s latest available date is unknown; using requested window %s..%s",
            collection_id,
            requested_start_date,
            requested_end_date,
        )
        return requested_start_date, requested_end_date, None

    latest_exclusive_end = (latest_ts + pd.Timedelta(days=1)).normalize()
    max_reasonable_end = min(today_utc + pd.Timedelta(days=1), latest_exclusive_end)

    if not requested_end_date:
        req_end = max_reasonable_end
    else:
        req_end = pd.to_datetime(requested_end_date, utc=True, errors="coerce")

    if not requested_start_date:
        req_start = req_end - pd.Timedelta(days=default_recent_days)
    else:
        req_start = pd.to_datetime(requested_start_date, utc=True, errors="coerce")

    if pd.isna(req_start) or pd.isna(req_end):
        raise ValueError(f"Invalid date inputs for {collection_id}: {requested_start_date}, {requested_end_date}")

    lag_days = int((today_utc.normalize() - latest_ts.normalize()).days)
    if lag_days > 21:
        logger.warning(
            "%s appears stale: latest image date=%s (%d days behind current date=%s)",
            collection_id,
            latest_ts.date().isoformat(),
            lag_days,
            CURRENT_DATE.date().isoformat(),
        )

    if req_end <= req_start:
        req_start = req_end - pd.Timedelta(days=max(7, default_recent_days))

    # If requested window is clearly stale, auto-shift to recent period.
    if (today_utc - req_end.normalize()).days > 45:
        auto_end = max_reasonable_end
        auto_start = auto_end - pd.Timedelta(days=default_recent_days)
        logger.warning(
            "%s requested window %s..%s is old; auto-adjusting to recent window %s..%s",
            collection_id,
            requested_start_date,
            requested_end_date,
            auto_start.date().isoformat(),
            auto_end.date().isoformat(),
        )
        return auto_start.date().isoformat(), auto_end.date().isoformat(), latest_ts

    clipped_end = min(req_end, max_reasonable_end)
    if clipped_end <= req_start:
        clipped_start = clipped_end - pd.Timedelta(days=min(default_recent_days, 7))
        logger.warning(
            "%s requested window has no overlap with latest data; using %s..%s",
            collection_id,
            clipped_start.date().isoformat(),
            clipped_end.date().isoformat(),
        )
        return clipped_start.date().isoformat(), clipped_end.date().isoformat(), latest_ts

    if clipped_end < req_end:
        logger.info(
            "%s clipping end_date from %s to %s based on latest dataset availability",
            collection_id,
            req_end.date().isoformat(),
            clipped_end.date().isoformat(),
        )

    return req_start.date().isoformat(), clipped_end.date().isoformat(), latest_ts


def extract_chirps_daily(
    start_date: str,
    end_date: str,
    districts_gdf: "gpd.GeoDataFrame",
    output_path: Optional[str] = None,
) -> pd.DataFrame:
    """Extract CHIRPS daily precipitation aggregated to Bangladesh districts.

    Returns columns:
    [district_id, district_name, date, rainfall_mm, data_quality, source, extraction_date, ingested_at_utc]
    """
    logger.info("Starting CHIRPS extraction window=%s..%s", start_date, end_date)
    project = _get_current_gee_project()
    logger.info("Using GEE project: %s", project or "default")
    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)
    districts_ee = _geopandas_to_ee_fc(ee, districts)

    collection = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filterDate(start_date, end_date).select(["precipitation"])
    rows = _reduce_daily_collection(ee, collection, districts_ee, scale=5000)

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError("CHIRPS extraction returned 0 rows")

    rename = {
        "mean": "rainfall_mm",
        "stdDev": "rainfall_std_mm",
        "count": "pixel_count",
    }
    df = df.rename(columns=rename)
    _require_columns(df, ["district_id", "district_name", "date", "rainfall_mm"], "CHIRPS output")

    df["rainfall_mm"] = pd.to_numeric(df["rainfall_mm"], errors="coerce")
    valid = _validate_range(df["rainfall_mm"], 0.0, 2000.0)
    df["data_quality"] = "good"
    df.loc[df["rainfall_mm"].isna(), "data_quality"] = "missing"
    df.loc[~valid & df["rainfall_mm"].notna(), "data_quality"] = "out_of_range"

    out = df[["district_id", "district_name", "date", "rainfall_mm", "data_quality"]].copy()
    out = _add_meta(out, "gee_chirps")
    _save_parquet(out, output_path)
    return out


def extract_smap_soil_moisture(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    districts_gdf: "gpd.GeoDataFrame" = None,
    output_path: Optional[str] = None,
) -> pd.DataFrame:
    """Extract SMAP Level-4 soil moisture (surface and rootzone) by district.

    Returns columns:
    [district_id, district_name, date, sm_surface, sm_rootzone, quality_flag,
     source, extraction_date, ingested_at_utc]
    """
    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)

    collection_id = "NASA/SMAP/SPL4SMGP/008"

    # --- Simple date handling: use provided dates or auto-detect latest ---
    if not start_date or not end_date:
        latest = ee.ImageCollection(collection_id).select(["sm_surface"]) \
            .sort("system:time_start", False).first() \
            .get("system:time_start").getInfo()
        latest_date = pd.to_datetime(latest, unit="ms")
        end_date = (latest_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        start_date = (latest_date - pd.Timedelta(days=7)).strftime("%Y-%m-%d")
        logger.info(f"[SMAP] Auto-detected latest date: {latest_date.date()}")

    logger.info(f"[SMAP] Extracting {collection_id}  window={start_date}..{end_date}")

    collection = (
        ee.ImageCollection(collection_id)
        .filterDate(start_date, end_date)
        .select(["sm_surface", "sm_rootzone"])
    )

    # SMAP is 3-hourly (~8 images/day) → use safe daily compositing
    rows = _reduce_daily_collection_batched(
        ee=ee,
        collection=collection,
        districts_gdf=districts,
        scale=10000,
        reducer=ee.Reducer.mean().combine(ee.Reducer.count(), "", True),
        batch_size=8,
        dataset_name="SMAP",
        start_date=start_date,
        end_date=end_date,
        use_safe_daily=True,
    )

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError(f"SMAP extraction returned 0 rows for {start_date}..{end_date}")

    logger.info(f"[SMAP] Got {len(df)} rows, columns: {list(df.columns)}")

    # Rename reducer columns
    if "sm_surface_mean" in df.columns:
        df = df.rename(columns={
            "sm_surface_mean": "sm_surface",
            "sm_rootzone_mean": "sm_rootzone",
        })
        # Drop count columns if present
        df = df.drop(columns=["sm_surface_count", "sm_rootzone_count"], errors="ignore")

    df["sm_surface"] = pd.to_numeric(df["sm_surface"], errors="coerce")
    df["sm_rootzone"] = pd.to_numeric(df["sm_rootzone"], errors="coerce")

    df["quality_flag"] = "good"
    df.loc[df["sm_surface"].isna() | df["sm_rootzone"].isna(), "quality_flag"] = "missing"

    out = df[["district_id", "district_name", "date", "sm_surface", "sm_rootzone", "quality_flag"]].copy()
    out = _add_meta(out, "gee_smap")
    _save_parquet(out, output_path)
    logger.info(f"[SMAP] ✅ Done: {len(out)} rows")
    return out


def extract_era5_temperature(
    start_date: str,
    end_date: str,
    districts_gdf: "gpd.GeoDataFrame",
    output_path: Optional[str] = None,
) -> pd.DataFrame:
    """Extract ERA5-Land 2m temperature (daily min/max/mean) in Celsius by district."""
    logger.info("Starting ERA5 extraction window=%s..%s", start_date, end_date)
    project = _get_current_gee_project()
    logger.info("Using GEE project: %s", project or "default")
    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)
    districts_ee = _geopandas_to_ee_fc(ee, districts)

    def _to_celsius(image: Any) -> Any:
        return (
            image.select(["temperature_2m_min", "temperature_2m_max", "temperature_2m"])
            .subtract(273.15)
            .copyProperties(image, ["system:time_start"])
        )

    collection = ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR").filterDate(start_date, end_date).map(_to_celsius)

    rows = _reduce_daily_collection(
        ee,
        collection,
        districts_ee,
        scale=11132,
        reducer=ee.Reducer.mean(),
    )

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError("ERA5 extraction returned 0 rows")

    _require_columns(
        df,
        ["district_id", "district_name", "date", "temperature_2m_min", "temperature_2m_max", "temperature_2m"],
        "ERA5 output",
    )

    df = df.rename(
        columns={
            "temperature_2m_min": "temp_min_c",
            "temperature_2m_max": "temp_max_c",
            "temperature_2m": "temp_mean_c",
        }
    )

    for c in ["temp_min_c", "temp_max_c", "temp_mean_c"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    valid = (
        _validate_range(df["temp_min_c"], -60, 60)
        & _validate_range(df["temp_max_c"], -60, 60)
        & _validate_range(df["temp_mean_c"], -60, 60)
    )
    df["quality_flag"] = "good"
    df.loc[df[["temp_min_c", "temp_max_c", "temp_mean_c"]].isna().any(axis=1), "quality_flag"] = "missing"
    df.loc[~valid & df["quality_flag"].ne("missing"), "quality_flag"] = "out_of_range"

    out = df[
        [
            "district_id",
            "district_name",
            "date",
            "temp_min_c",
            "temp_max_c",
            "temp_mean_c",
            "quality_flag",
        ]
    ].copy()
    out = _add_meta(out, "gee_era5")
    _save_parquet(out, output_path)
    return out


def extract_modis_ndvi(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    districts_gdf: "gpd.GeoDataFrame" = None,
    output_path: Optional[str] = None,
) -> pd.DataFrame:
    """Extract MODIS Terra NDVI (MOD13A1) by district.

    - Applies scale factor 0.0001 to NDVI/EVI
    - Masks poor-quality pixels using SummaryQA <= 1
    """
    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)

    collection_id = "MODIS/061/MOD13A1"

    # --- Simple date handling: use provided dates or auto-detect latest ---
    if not start_date or not end_date:
        latest = ee.ImageCollection(collection_id).select(["NDVI"]) \
            .sort("system:time_start", False).first() \
            .get("system:time_start").getInfo()
        latest_date = pd.to_datetime(latest, unit="ms")
        end_date = (latest_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        start_date = (latest_date - pd.Timedelta(days=16)).strftime("%Y-%m-%d")
        logger.info(f"[MODIS] Auto-detected latest date: {latest_date.date()}")

    logger.info(f"[MODIS] Extracting {collection_id}  window={start_date}..{end_date}")

    def _prep_modis(image: Any) -> Any:
        qa = image.select("SummaryQA")
        good_mask = qa.lte(1)
        ndvi = image.select("NDVI").multiply(0.0001)
        evi = image.select("EVI").multiply(0.0001)
        return (
            ndvi.addBands(evi)
            .addBands(qa.rename("SummaryQA"))
            .updateMask(good_mask)
            .copyProperties(image, ["system:time_start"])
        )

    collection = (
        ee.ImageCollection(collection_id)
        .filterDate(start_date, end_date)
        .map(_prep_modis)
    )

    # MODIS is 16-day composite (few images) → standard batching works fine
    rows = _reduce_daily_collection_batched(
        ee=ee,
        collection=collection,
        districts_gdf=districts,
        scale=500,
        reducer=ee.Reducer.mean().combine(ee.Reducer.count(), "", True),
        batch_size=8,
        dataset_name="MODIS",
    )

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError(f"MODIS extraction returned 0 rows for {start_date}..{end_date}")

    logger.info(f"[MODIS] Got {len(df)} rows, columns: {list(df.columns)}")

    # --- Rename reducer columns (mean/count suffixed) to canonical names ---
    if 'NDVI_mean' in df.columns:
        df = df.rename(columns={
            'NDVI_mean': 'ndvi',
            'EVI_mean': 'evi',
            'SummaryQA_mean': 'summary_qa',
        })
        # Drop count columns produced by the combined reducer
        df = df.drop(columns=['NDVI_count', 'EVI_count', 'SummaryQA_count'], errors='ignore')
    else:
        # Fallback: columns without _mean suffix (single reducer case)
        df = df.rename(columns={"NDVI": "ndvi", "EVI": "evi", "SummaryQA": "summary_qa"})

    # Scale NDVI/EVI values (stored as int16 * 10000 when not pre-scaled)
    for c in ["ndvi", "evi"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    df["quality_flag"] = "good"
    df.loc[df["ndvi"].isna(), "quality_flag"] = "missing"

    out = df[["district_id", "district_name", "date", "ndvi", "evi", "quality_flag"]].copy()
    out = _add_meta(out, "gee_modis_ndvi")
    _save_parquet(out, output_path)
    logger.info(f"[MODIS] ✅ Done: {len(out)} rows")
    return out


def _historical_collection(ee: Any, variable: str, start_year: int, end_year: int) -> Tuple[Any, int, str]:
    var = variable.lower().strip()
    if var == "chirps":
        collection = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").select(["precipitation"])  # mm/day
        return collection, 5000, "rainfall_mm"

    if var == "era5":
        def _era5_to_c(img: Any) -> Any:
            return img.select("temperature_2m").subtract(273.15).rename("temperature_2m").copyProperties(
                img, ["system:time_start"]
            )

        collection = ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR").map(_era5_to_c).select(["temperature_2m"])
        return collection, 11132, "temperature_c"

    if var == "smap":
        # SMAP availability starts in 2015; enforce minimum start.
        start_year = max(start_year, 2015)
        collection = ee.ImageCollection("NASA/SMAP/SPL4SMGP/008").select(["sm_surface"])  # ~3-hourly
        return collection, 10000, "sm_surface"

    raise ValueError("variable must be one of: chirps, era5, smap")


def extract_historical_climatology(
    variable: str,
    districts_gdf: "gpd.GeoDataFrame",
    start_year: int = 1981,
    end_year: int = 2023,
    output_path: Optional[str] = None,
) -> pd.DataFrame:
    """Compute multi-year district-level day-of-year climatology.

    Returns columns:
    [district_id, district_name, day_of_year, var_mean, var_std, var_p10, var_p25, var_p75, var_p90, source, ...]
    """
    if end_year < start_year:
        raise ValueError("end_year must be >= start_year")

    logger.info(
        "Starting historical climatology extraction variable=%s years=%d..%d",
        variable,
        start_year,
        end_year,
    )

    project = _get_current_gee_project()
    logger.info("Using GEE project: %s", project or "default")
    ee = _init_gee()
    districts = _coerce_district_gdf(districts_gdf)
    districts_ee = _geopandas_to_ee_fc(ee, districts)

    collection, scale, _ = _historical_collection(ee, variable, start_year, end_year)
    start_date = f"{start_year}-01-01"
    end_date = f"{end_year + 1}-01-01"
    collection = collection.filterDate(start_date, end_date)

    yearly_frames: List[pd.DataFrame] = []
    for year in range(start_year, end_year + 1):
        y_start = f"{year}-01-01"
        y_end = f"{year + 1}-01-01"
        year_coll = collection.filterDate(y_start, y_end)
        rows = _reduce_daily_collection(
            ee,
            year_coll,
            districts_ee,
            scale=scale,
            reducer=ee.Reducer.mean(),
        )
        if not rows:
            logger.warning("No records for year %s variable=%s", year, variable)
            continue

        frame = pd.DataFrame(rows)
        if frame.empty:
            continue

        # pick first non-id/date column as the value column
        value_candidates = [c for c in frame.columns if c not in {"district_id", "district_name", "date"}]
        if not value_candidates:
            continue
        value_col = value_candidates[0]

        frame["value"] = pd.to_numeric(frame[value_col], errors="coerce")
        frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
        frame["day_of_year"] = frame["date"].dt.dayofyear
        yearly_frames.append(frame[["district_id", "district_name", "day_of_year", "value"]])

    if not yearly_frames:
        raise RuntimeError(f"No climatology records returned for variable={variable}")

    all_df = pd.concat(yearly_frames, ignore_index=True)

    grouped = all_df.groupby(["district_id", "district_name", "day_of_year"], dropna=False)["value"]
    out = grouped.agg(var_mean="mean", var_std="std").reset_index()

    quantiles = (
        grouped.quantile([0.10, 0.25, 0.75, 0.90])
        .unstack(level=-1)
        .rename(columns={0.10: "var_p10", 0.25: "var_p25", 0.75: "var_p75", 0.90: "var_p90"})
        .reset_index()
    )
    out = out.merge(quantiles, on=["district_id", "district_name", "day_of_year"], how="left")

    for c in ["var_mean", "var_std", "var_p10", "var_p25", "var_p75", "var_p90"]:
        out[c] = pd.to_numeric(out[c], errors="coerce")

    out["day_of_year"] = out["day_of_year"].astype("Int64")
    out = _add_meta(out, f"gee_{variable.lower()}_climatology")
    _save_parquet(out, output_path)
    return out


def extract_historical_baselines(
    metric: str,
    lookback_years: int = 10,
    districts_gdf: Optional["gpd.GeoDataFrame"] = None,
    output_path: Optional[str] = None,
) -> pd.DataFrame:
    """Backward-compatible wrapper mapped to extract_historical_climatology.

    metric accepted: rainfall_mm, soil_moisture_m3_m3, ndvi, temperature_c
    """
    metric_map = {
        "rainfall_mm": "chirps",
        "soil_moisture_m3_m3": "smap",
        "temperature_c": "era5",
        "ndvi": "chirps",  # NDVI baseline not requested in MVP; mapped conservatively to keep compatibility.
    }
    variable = metric_map.get(metric, metric)

    if districts_gdf is None:
        raise ValueError("districts_gdf is required for historical baseline extraction")

    end_year = datetime.utcnow().year - 1
    start_year = max(1981, end_year - lookback_years + 1)
    return extract_historical_climatology(
        variable=variable,
        start_year=start_year,
        end_year=end_year,
        districts_gdf=districts_gdf,
        output_path=output_path,
    )
