"""Test all web scrapers to verify they work.

This script is intentionally tolerant of source website changes:
- It prints warnings for empty results.
- It does not crash the whole test suite if one scraper fails.
"""

from __future__ import annotations

import traceback

from production_pipeline.extractors.bamis_extractor import (
    scrape_bamis_bulletins,
    scrape_crop_calendars,
)
from production_pipeline.extractors.bmd_extractor import (
    scrape_bmd_rainfall_7day,
    scrape_bmd_spi_table,
)


def _print_schema(df, expected_cols):
    got = list(df.columns)
    missing = [c for c in expected_cols if c not in got]
    print(f"   Columns: {got}")
    if missing:
        print(f"   ⚠️ Missing expected columns: {missing}")


def test_bmd_scraping() -> bool:
    """Test BMD scrapers."""
    ok = True

    print("\n=== BMD SPI Test ===")
    try:
        df_spi = scrape_bmd_spi_table()
        expected_spi = ["District", "SPI-1", "SPI-3", "SPI-6", "Drought_Class", "Date_Scraped", "source"]
        _print_schema(df_spi, expected_spi)
        if len(df_spi) > 0:
            print(f"✅ BMD SPI: {len(df_spi)} rows")
            print(df_spi.head(3).to_string(index=False))
        else:
            print("⚠️ BMD SPI returned 0 rows (site may currently expose only bulletin/PDF links).")
    except Exception as e:
        ok = False
        print(f"❌ BMD SPI failed: {e}")
        traceback.print_exc()

    print("\n=== BMD Rainfall 7-day Test ===")
    try:
        df_rain = scrape_bmd_rainfall_7day()
        expected_rain = ["District", "Date", "Rainfall_mm", "source"]
        _print_schema(df_rain, expected_rain)
        if len(df_rain) > 0:
            print(f"✅ BMD Rainfall: {len(df_rain)} rows")
            print(df_rain.head(3).to_string(index=False))
        else:
            print("⚠️ BMD Rainfall returned 0 rows (possible no current real-time station rows or structure change).")
    except Exception as e:
        ok = False
        print(f"❌ BMD Rainfall failed: {e}")
        traceback.print_exc()

    return ok


def test_bamis_scraping() -> bool:
    """Test BAMIS scrapers."""
    ok = True

    print("\n=== BAMIS Crop Calendar Test ===")
    try:
        df_cal = scrape_crop_calendars()
        expected_cal = ["Crop", "District", "Operation", "Month", "Week", "source"]
        _print_schema(df_cal, expected_cal)
        if len(df_cal) > 0:
            print(f"✅ BAMIS Calendars: {len(df_cal)} rows")
            print(df_cal.head(3).to_string(index=False))
        else:
            print("⚠️ BAMIS Calendars returned 0 rows (site structure/content may have changed).")
    except Exception as e:
        ok = False
        print(f"❌ BAMIS Calendars failed: {e}")
        traceback.print_exc()

    print("\n=== BAMIS Bulletin Test ===")
    try:
        df_bul = scrape_bamis_bulletins()
        if len(df_bul) > 0:
            print(f"✅ BAMIS Bulletins: {len(df_bul)} rows")
            print(df_bul.head(3).to_string(index=False))
        else:
            print("⚠️ BAMIS Bulletins returned 0 rows.")
    except Exception as e:
        ok = False
        print(f"❌ BAMIS Bulletins failed: {e}")
        traceback.print_exc()

    return ok


if __name__ == "__main__":
    bmd_ok = test_bmd_scraping()
    bamis_ok = test_bamis_scraping()

    print("\n=== Summary ===")
    print(f"BMD tests:   {'PASS' if bmd_ok else 'FAIL'}")
    print(f"BAMIS tests: {'PASS' if bamis_ok else 'FAIL'}")

    if bmd_ok and bamis_ok:
        print("✅ Scraper tests completed successfully.")
    else:
        print("⚠️ Some scraper tests failed. Check logs above.")
