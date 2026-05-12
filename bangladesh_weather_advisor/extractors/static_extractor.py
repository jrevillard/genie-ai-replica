"""Static and semi-static data extractors — BUNDLED DATA version.

Loads HDX boundaries, MAPSPAM crop distribution, and SoilGrids soil
properties from pre-bundled CSV files shipped with the repository.

**NO dynamic downloads. NO API calls. Pure local file reads.**

The bundled data lives in:
    production_pipeline/data/static/
        hdx_boundaries.csv
        mapspam_crops.csv
        soilgrids_properties.csv
        district_mapping.csv

District ID harmonisation
-------------------------
HDX boundaries use ADM2_PCODE format (e.g. BD1004 for Barguna).
MAPSPAM / SoilGrids use a shorter format (e.g. BD10 for Barguna).
The district_mapping.csv provides the canonical mapping between them.
All loader functions add a ``district_id_canonical`` column (= HDX ID)
so downstream pipeline code can join on a single key.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

import pandas as pd

from production_pipeline.config import BWDB_BASE_URL, CURRENT_DATE, CURRENT_UTC, LOG_LEVEL

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))

# ── Path to bundled static data ──────────────────────────────────────────
STATIC_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "static"

# ── Name-alias table for harmonisation ───────────────────────────────────
_NAME_ALIASES = {
    "jessore":          "jashore",
    "comilla":          "cumilla",
    "chapainawabganj":  "chapainababganj",
    "netrokona":        "netrakona",
    "nawabganj":        "chapainababganj",
}


def _norm_name(s: str) -> str:
    """Lower-case, strip, remove punctuation, apply alias."""
    n = s.strip().lower().replace("'", "").replace("\u2019", "").replace("-", " ")
    return _NAME_ALIASES.get(n, n)


# ═════════════════════════════════════════════════════════════════════════
# Metadata helper
# ═════════════════════════════════════════════════════════════════════════

def _stamp(df: pd.DataFrame, source: str) -> pd.DataFrame:
    """Add pipeline metadata columns (idempotent)."""
    out = df.copy()
    out["source"] = source
    out["extraction_date"] = CURRENT_DATE.date().isoformat()
    out["ingested_at_utc"] = CURRENT_UTC.isoformat()
    return out


# ═════════════════════════════════════════════════════════════════════════
# District mapping / harmonisation
# ═════════════════════════════════════════════════════════════════════════

_MAPPING_CACHE: Optional[pd.DataFrame] = None


def load_district_mapping() -> pd.DataFrame:
    """Load the canonical district mapping table.

    Columns:
        district_id_canonical  – HDX-format ID (e.g. BD1004)
        hdx_id                 – same as canonical
        mapspam_id             – short-format ID (e.g. BD10), may be empty
        district_name          – canonical English name
        district_name_alt      – alternative spelling if any
    """
    global _MAPPING_CACHE
    if _MAPPING_CACHE is not None:
        return _MAPPING_CACHE

    mapping_path = STATIC_DATA_DIR / "district_mapping.csv"
    if not mapping_path.exists():
        raise FileNotFoundError(
            f"District mapping not found: {mapping_path}\n"
            "Run install_static_data.py to set up bundled data."
        )
    _MAPPING_CACHE = pd.read_csv(mapping_path, dtype=str).fillna("")
    logger.info("✅ Loaded district mapping: %d rows from %s",
                len(_MAPPING_CACHE), mapping_path)
    return _MAPPING_CACHE


def _harmonize_district_ids(df: pd.DataFrame) -> pd.DataFrame:
    """Add ``district_id_canonical`` column to any DataFrame.

    Works by matching on:
    1. ``district_id`` column (tries both HDX and MAPSPAM ID formats)
    2. ``district_name`` column (fuzzy via _norm_name)

    Returns the original DataFrame with ``district_id_canonical`` and
    ``district_name_canonical`` added (or updated).
    """
    try:
        mapping = load_district_mapping()
    except FileNotFoundError:
        logger.warning("No district mapping available — skipping harmonisation")
        return df

    out = df.copy()

    # Build lookup dicts
    hdx_lookup = {}       # hdx_id   → (canonical_id, canonical_name)
    mapspam_lookup = {}   # mapspam_id → (canonical_id, canonical_name)
    name_lookup = {}      # normalised name → (canonical_id, canonical_name)

    for _, row in mapping.iterrows():
        cid = row["district_id_canonical"]
        cname = row["district_name"]
        hdx_lookup[row["hdx_id"]] = (cid, cname)
        if row["mapspam_id"]:
            mapspam_lookup[row["mapspam_id"]] = (cid, cname)
        name_lookup[_norm_name(cname)] = (cid, cname)
        if row.get("district_name_alt"):
            name_lookup[_norm_name(row["district_name_alt"])] = (cid, cname)

    canonical_ids = []
    canonical_names = []

    for _, row in out.iterrows():
        did = str(row.get("district_id", "")).strip()
        dname = str(row.get("district_name", "")).strip()

        # Try ID match first
        match = hdx_lookup.get(did) or mapspam_lookup.get(did)
        if not match and dname:
            match = name_lookup.get(_norm_name(dname))
        if match:
            canonical_ids.append(match[0])
            canonical_names.append(match[1])
        else:
            canonical_ids.append(did)
            canonical_names.append(dname)

    out["district_id_canonical"] = canonical_ids
    out["district_name_canonical"] = canonical_names
    return out


# ═════════════════════════════════════════════════════════════════════════
# 1. HDX Bangladesh Admin Boundaries (bundled)
# ═════════════════════════════════════════════════════════════════════════

def load_hdx_boundaries() -> pd.DataFrame:
    """Load Bangladesh district boundaries from bundled CSV.

    NO API calls, NO downloads — reads from data/static/hdx_boundaries.csv.

    Returns
    -------
    pd.DataFrame or gpd.GeoDataFrame
        64 districts with district_id, district_name, geometry_wkt,
        and district_id_canonical columns.  If geopandas is available
        and geometry_wkt is present, returns a GeoDataFrame.
    """
    csv_path = STATIC_DATA_DIR / "hdx_boundaries.csv"
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Bundled HDX boundaries not found: {csv_path}\n"
            "Run install_static_data.py to set up bundled data."
        )

    df = pd.read_csv(csv_path, dtype={"district_id": str})
    logger.info("✅ Loaded %d districts from bundled %s", len(df), csv_path.name)

    # Convert WKT to geometry if geopandas is available
    if "geometry_wkt" in df.columns:
        try:
            import geopandas as gpd
            from shapely import wkt
            df["geometry"] = df["geometry_wkt"].apply(
                lambda g: wkt.loads(g) if pd.notna(g) and g else None
            )
            df = gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")
        except ImportError:
            logger.info("geopandas not installed — returning plain DataFrame")
        except Exception as exc:
            logger.warning("Could not parse WKT geometry: %s", exc)

    df = _harmonize_district_ids(df)
    return _stamp(df, "HDX_bundled")


# ═════════════════════════════════════════════════════════════════════════
# 2. MAPSPAM Crop Distribution (bundled)
# ═════════════════════════════════════════════════════════════════════════

def load_mapspam_crops() -> pd.DataFrame:
    """Load MAPSPAM crop distribution from bundled CSV.

    NO API calls, NO downloads — reads from data/static/mapspam_crops.csv.

    Returns
    -------
    pd.DataFrame
        768 rows (64 districts × 12 crops) with district_id, district_name,
        crop, area_ha, yield_t_ha, season, and district_id_canonical columns.
    """
    csv_path = STATIC_DATA_DIR / "mapspam_crops.csv"
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Bundled MAPSPAM data not found: {csv_path}\n"
            "Run install_static_data.py to set up bundled data."
        )

    df = pd.read_csv(csv_path, dtype={"district_id": str})
    logger.info("✅ Loaded %d crop rows from bundled %s", len(df), csv_path.name)

    df = _harmonize_district_ids(df)
    return _stamp(df, "MAPSPAM_bundled")


# ═════════════════════════════════════════════════════════════════════════
# 3. SoilGrids Soil Properties (bundled)
# ═════════════════════════════════════════════════════════════════════════

def load_soilgrids_properties() -> pd.DataFrame:
    """Load SoilGrids soil properties from bundled CSV.

    NO API calls, NO downloads — reads from data/static/soilgrids_properties.csv.

    Returns
    -------
    pd.DataFrame
        64 rows with district_id, district_name, soil_region, ph,
        clay_pct, sand_pct, silt_pct, soc_g_kg, cec_cmol_kg,
        nitrogen_g_kg, and district_id_canonical columns.
    """
    csv_path = STATIC_DATA_DIR / "soilgrids_properties.csv"
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Bundled SoilGrids data not found: {csv_path}\n"
            "Run install_static_data.py to set up bundled data."
        )

    df = pd.read_csv(csv_path, dtype={"district_id": str})
    logger.info("✅ Loaded %d soil rows from bundled %s", len(df), csv_path.name)

    df = _harmonize_district_ids(df)
    return _stamp(df, "SoilGrids_bundled")


# ═════════════════════════════════════════════════════════════════════════
# 4. BWDB Water Levels (unchanged — this IS a live scraper)
# ═════════════════════════════════════════════════════════════════════════

def scrape_bwdb_water_levels(url_suffix: str = "") -> pd.DataFrame:
    """Optional helper for BWDB/FFWC river water-level scraping."""
    import requests
    url = BWDB_BASE_URL.rstrip("/") + "/" + url_suffix.lstrip("/")
    try:
        tables = pd.read_html(url)
        if not tables:
            return _stamp(
                pd.DataFrame(columns=["station", "water_level_m", "record_date"]),
                "bwdb_scraping",
            )
        df = tables[0].copy()
        return _stamp(df, "bwdb_scraping")
    except Exception as exc:
        logger.exception("BWDB scraping failed: %s", exc)
        return _stamp(
            pd.DataFrame(columns=["station", "water_level_m", "record_date"]),
            "bwdb_scraping",
        )
