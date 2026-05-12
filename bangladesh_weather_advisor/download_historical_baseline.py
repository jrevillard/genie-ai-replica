#!/usr/bin/env python3
"""Standalone script to download all historical baseline data and compute climatology.

This script can be run independently of the main pipeline or notebook.
It downloads CHIRPS (1981–2023) and ERA5-Land historical data from GEE,
computes day-of-year climatology statistics, and saves the results as
bundled CSV files for reuse.

Usage::

    # Full download (CHIRPS 1981-2023 + ERA5 1981-2023)
    python download_historical_baseline.py

    # CHIRPS only, recent years
    python download_historical_baseline.py --variable chirps --start-year 2015

    # Resume after interruption (default behaviour)
    python download_historical_baseline.py

    # Force re-download everything
    python download_historical_baseline.py --no-resume

    # Custom districts file
    python download_historical_baseline.py --districts-csv /path/to/hdx_boundaries.csv

Output Structure::

    production_pipeline/data/historical/
    ├── chirps_climatology_1981_2023.csv   # Bundled climatology
    ├── era5_climatology_1981_2023.csv     # Bundled climatology
    ├── README.md                          # Documentation
    └── raw/
        ├── chirps/
        │   ├── chirps_1981.csv            # Year checkpoints
        │   ├── chirps_1982.csv
        │   └── ...
        └── era5/
            ├── era5_temperat_1981.csv
            └── ...

Estimated runtime:
  - CHIRPS full (1981-2023, 64 districts): ~2-4 hours
  - ERA5 full (1981-2023, 64 districts): ~2-4 hours
  - CHIRPS recent (2020-2023): ~15-20 minutes
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Ensure production_pipeline is on path
_repo_root = Path(__file__).resolve().parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from production_pipeline.extractors.historical_extractor import (
    extract_chirps_historical,
    extract_era5_historical,
    compute_chirps_climatology,
    compute_era5_climatology,
    save_climatology_bundle,
    load_climatology_bundle,
    get_latest_chirps_date,
    get_latest_era5_date,
)


def _load_districts(csv_path: str | None = None):
    """Load district GeoDataFrame from bundled static data or custom CSV."""
    import pandas as pd

    try:
        import geopandas as _gpd
        from shapely import wkt as _wkt
    except ImportError:
        print("❌ geopandas and shapely are required. Install with:")
        print("   pip install geopandas shapely")
        sys.exit(1)

    if csv_path:
        print(f"📂 Loading districts from: {csv_path}")
        df = pd.read_csv(csv_path)
    else:
        # Try bundled static data
        bundled = Path(__file__).resolve().parent / "data" / "static" / "hdx_boundaries.csv"
        if bundled.exists():
            print(f"📂 Loading districts from bundled data: {bundled}")
            df = pd.read_csv(bundled)
        else:
            print("📂 Loading districts via static_extractor…")
            from production_pipeline.extractors.static_extractor import load_hdx_boundaries
            return load_hdx_boundaries()

    if "geometry_wkt" in df.columns:
        df["geometry"] = df["geometry_wkt"].apply(_wkt.loads)
        return _gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")
    elif "geometry" in df.columns:
        df["geometry"] = df["geometry"].apply(_wkt.loads)
        return _gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")
    else:
        return _gpd.GeoDataFrame(df)


def _print_banner(title: str):
    width = 70
    print()
    print("=" * width)
    print(f"  {title}")
    print("=" * width)


def main():
    parser = argparse.ArgumentParser(
        description="Download historical baseline data from GEE and compute climatology",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--variable",
        choices=["chirps", "era5", "both"],
        default="both",
        help="Which dataset(s) to download (default: both)",
    )
    parser.add_argument(
        "--start-year", type=int, default=1981,
        help="Start year for historical extraction (default: 1981)",
    )
    parser.add_argument(
        "--end-year", type=int, default=2023,
        help="End year for historical extraction (default: 2023)",
    )
    parser.add_argument(
        "--output-dir", type=str, default=None,
        help="Output directory (default: production_pipeline/data/historical/)",
    )
    parser.add_argument(
        "--no-resume", action="store_true",
        help="Force re-download all years (ignore checkpoints)",
    )
    parser.add_argument(
        "--districts-csv", type=str, default=None,
        help="Path to HDX boundaries CSV with geometry_wkt column",
    )
    parser.add_argument(
        "--check-dates", action="store_true",
        help="Only check latest available dates in GEE, then exit",
    )
    parser.add_argument(
        "--skip-climatology", action="store_true",
        help="Download raw data only, skip climatology computation",
    )

    args = parser.parse_args()

    _print_banner("Historical Baseline Download Tool")
    print(f"  Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Variable:   {args.variable}")
    print(f"  Years:      {args.start_year}–{args.end_year}")
    print(f"  Resume:     {not args.no_resume}")

    # Check dates only
    if args.check_dates:
        _print_banner("Checking Latest Available Dates")
        try:
            print(f"  CHIRPS latest: {get_latest_chirps_date()}")
        except Exception as e:
            print(f"  CHIRPS: Error – {e}")
        try:
            print(f"  ERA5 latest:   {get_latest_era5_date()}")
        except Exception as e:
            print(f"  ERA5: Error – {e}")
        return

    # Load districts
    _print_banner("Loading District Boundaries")
    districts_gdf = _load_districts(args.districts_csv)
    print(f"  ✅ {len(districts_gdf)} districts loaded")

    start_date = f"{args.start_year}-01-01"
    end_date = f"{args.end_year}-12-31"
    resume = not args.no_resume
    overall_t0 = time.time()

    chirps_clim = None
    era5_clim = None

    # ---- CHIRPS ----
    if args.variable in ("chirps", "both"):
        _print_banner(f"CHIRPS Daily Rainfall ({args.start_year}–{args.end_year})")
        t0 = time.time()

        chirps_raw = extract_chirps_historical(
            districts_gdf,
            start_date=start_date,
            end_date=end_date,
            output_dir=args.output_dir,
            resume=resume,
        )
        elapsed = time.time() - t0
        print(f"\n  📊 CHIRPS download complete: {len(chirps_raw):,} rows in {elapsed/60:.1f} min")

        if not args.skip_climatology:
            _print_banner("Computing CHIRPS Climatology")
            chirps_clim = compute_chirps_climatology(chirps_raw)
            print(f"  ✅ Climatology: {len(chirps_clim):,} rows "
                  f"({chirps_clim['district_id'].nunique()} districts × "
                  f"{chirps_clim['day_of_year'].nunique()} days)")

    # ---- ERA5 ----
    if args.variable in ("era5", "both"):
        _print_banner(f"ERA5-Land Temperature ({args.start_year}–{args.end_year})")
        t0 = time.time()

        era5_raw = extract_era5_historical(
            districts_gdf,
            start_date=start_date,
            end_date=end_date,
            variables=["temperature_2m"],
            output_dir=args.output_dir,
            resume=resume,
        )
        elapsed = time.time() - t0
        print(f"\n  📊 ERA5 download complete: {len(era5_raw):,} rows in {elapsed/60:.1f} min")

        if not args.skip_climatology:
            _print_banner("Computing ERA5 Climatology")
            era5_clim = compute_era5_climatology(era5_raw)
            print(f"  ✅ Climatology: {len(era5_clim):,} rows")

    # ---- Save Bundle ----
    if not args.skip_climatology and (chirps_clim is not None or era5_clim is not None):
        _print_banner("Saving Bundled Climatology")
        out_dir = save_climatology_bundle(chirps_clim, era5_clim, args.output_dir)
        print(f"  💾 Saved to: {out_dir}")
        for f in sorted(out_dir.glob("*.csv")):
            import pandas as pd
            nrows = len(pd.read_csv(f))
            size_kb = f.stat().st_size / 1024
            print(f"     {f.name}: {nrows:,} rows ({size_kb:.1f} KB)")

    # ---- Summary ----
    total_elapsed = time.time() - overall_t0
    _print_banner("Download Complete")
    print(f"  Total time: {total_elapsed/60:.1f} minutes")
    print(f"  Finished at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()


if __name__ == "__main__":
    main()
