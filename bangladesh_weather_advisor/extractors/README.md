# Extractors

Data extraction modules for the Bangladesh Weather Advisor pipeline.
Each module targets a specific data source and returns standardised
Pandas DataFrames.

## Modules

| Module | Source | Key Functions |
|--------|--------|---------------|
| `gee_extractor.py` | Google Earth Engine | `extract_chirps_daily()`, `extract_smap_soil_moisture()`, `extract_era5_temperature()`, `extract_modis_ndvi()`, `extract_climatology_baseline()` |
| `bmd_extractor.py` | Bangladesh Met. Dept. | `scrape_bmd_spi_table()`, `scrape_bmd_rainfall_7day()`, `scrape_bmd_agromet()` |
| `bamis_extractor.py` | BAMIS Agro-Met Service | `scrape_crop_calendars()`, `scrape_bamis_bulletins()`, `download_weekly_bulletins()` |
| `static_extractor.py` | Bundled CSV Data | `load_hdx_boundaries()`, `load_mapspam_crops()`, `load_soilgrids_properties()` |
| `climate_drivers.py` | NOAA Climate Indices | `scrape_enso_indices()` |
| `historical_extractor.py` | GEE Historical Data | `extract_chirps_historical()`, `extract_era5_historical()` |

## Design Principles

- **No synthetic fallback data** — extractors return real data or empty DataFrames with correct schemas
- **Retry with exponential backoff** — all network operations are resilient to transient failures
- **Consistent schemas** — each extractor defines and validates output column schemas
- **Logging over print** — all modules use Python's `logging` module for diagnostics
