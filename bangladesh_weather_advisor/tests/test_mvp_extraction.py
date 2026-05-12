"""Integration test for the production-ready MVP extraction stack.

Validates the 11-source MVP with real extraction calls where available.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from production_pipeline.extractors.bamis_extractor import scrape_crop_calendars
from production_pipeline.extractors.bmd_extractor import scrape_spi_tables
from production_pipeline.extractors.climate_drivers import scrape_enso_indices
from production_pipeline.extractors.gee_extractor import (
    extract_chirps_daily,
    extract_era5_temperature,
    extract_modis_ndvi,
    extract_smap_soil_moisture,
)
from production_pipeline.extractors.static_extractor import (
    load_hdx_boundaries,
    load_mapspam_crops,
    load_soilgrids_properties,
)
from production_pipeline.processors.spi_spei_calculator import calculate_spei, calculate_spi


def _build_fallback_districts_gdf():
    import geopandas as gpd
    from shapely.geometry import box

    # Minimal Bangladesh AOI-like sample districts (for quick API test execution ONLY)
    # WARNING: Do NOT use these for historical downloads or production analysis!
    print("⚠️  WARNING: Using SYNTHETIC fallback districts (3 only)!")
    print("⚠️  This is OK for quick API testing but NOT for historical downloads.")
    print("⚠️  For real analysis, ensure hdx_boundaries.csv loads 64 districts.")
    rows = [
        {"district_id": "BD-DHK", "district_name": "Dhaka", "geometry": box(90.25, 23.60, 90.55, 23.95)},
        {"district_id": "BD-RJS", "district_name": "Rajshahi", "geometry": box(88.45, 24.20, 88.85, 24.55)},
        {"district_id": "BD-KHL", "district_name": "Khulna", "geometry": box(89.30, 22.70, 89.75, 23.10)},
    ]
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def _load_test_districts():
    try:
        hdx = load_hdx_boundaries()
        if hasattr(hdx, "empty") and not hdx.empty and "geometry" in hdx.columns:
            return hdx
    except Exception:
        pass
    return _build_fallback_districts_gdf()


def test_all_extractors() -> None:
    """Run extraction for 1 week and verify outputs."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=7)

    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    districts = _load_test_districts()

    out_dir = Path("/tmp/mvp_extraction_outputs")
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Testing GEE Extractors...")

    df_chirps = extract_chirps_daily(start_str, end_str, districts, str(out_dir / "chirps.parquet"))
    assert len(df_chirps) > 0, "CHIRPS returned no data"
    assert "rainfall_mm" in df_chirps.columns
    print(f"✅ CHIRPS: {len(df_chirps)} records")

    df_smap = extract_smap_soil_moisture(start_str, end_str, districts, str(out_dir / "smap.parquet"))
    assert len(df_smap) > 0, "SMAP returned no data"
    assert {"sm_surface", "sm_rootzone"}.issubset(df_smap.columns)
    print(f"✅ SMAP: {len(df_smap)} records")

    df_era5 = extract_era5_temperature(start_str, end_str, districts, str(out_dir / "era5.parquet"))
    assert len(df_era5) > 0, "ERA5 returned no data"
    assert "temp_mean_c" in df_era5.columns
    print(f"✅ ERA5: {len(df_era5)} records")

    df_ndvi = extract_modis_ndvi(start_str, end_str, districts, str(out_dir / "modis_ndvi.parquet"))
    assert len(df_ndvi) > 0, "MODIS returned no data"
    assert "ndvi" in df_ndvi.columns
    print(f"✅ MODIS NDVI: {len(df_ndvi)} records")

    df_enso = scrape_enso_indices()
    assert len(df_enso) > 0, "ENSO returned no data"
    assert {"oni_value", "mei_value", "soi_value"}.issubset(df_enso.columns)
    print(f"✅ ENSO: {len(df_enso)} records")

    # Existing working extractors
    df_bmd = scrape_spi_tables()
    print(f"✅ BMD SPI: {len(df_bmd)} records")

    df_bamis = scrape_crop_calendars()
    print(f"✅ BAMIS crops: {len(df_bamis)} records")

    # Existing static/context sources (may require configured paths in production)
    df_hdx = load_hdx_boundaries()
    print(f"✅ HDX boundaries loader invoked: {len(df_hdx)} records")

    df_mapspam = load_mapspam_crops()
    print(f"✅ MAPSPAM loader invoked: {len(df_mapspam)} records")

    df_soilgrids = load_soilgrids_properties()
    print(f"✅ SoilGrids loader invoked: {len(df_soilgrids)} records")

    # Existing derived/computed pipeline components
    spi_input = df_chirps[["district_id", "date", "rainfall_mm"]].rename(columns={"date": "record_date"})
    spi_input["pet_mm"] = (spi_input["rainfall_mm"].fillna(0) * 0.6).clip(lower=0)

    spi_out = calculate_spi(spi_input, value_col="rainfall_mm", group_cols=["district_id"], window=3)
    spei_out = calculate_spei(spi_input, precip_col="rainfall_mm", pet_col="pet_mm", group_cols=["district_id"], window=3)
    print(f"✅ Computed SPI rows: {len(spi_out)}")
    print(f"✅ Computed SPEI rows: {len(spei_out)}")

    print("\n🎉 MVP extraction test completed.")


if __name__ == "__main__":
    test_all_extractors()
