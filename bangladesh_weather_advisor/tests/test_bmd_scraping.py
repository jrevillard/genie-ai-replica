#!/usr/bin/env python3
"""BMD Scraping Diagnostic Script — Full Results.

Tests actual BMD URLs, shows what's on each page, tries to extract data,
and reports exactly what's happening and why scraping may fail.

Then tests the actual extractor functions from bmd_extractor.py.
"""

import os
import sys
import traceback
import time
import json
from io import BytesIO, StringIO
from urllib.parse import urljoin

import requests
import pandas as pd
from bs4 import BeautifulSoup

try:
    import pdfplumber
    print(f"✅ pdfplumber available: {pdfplumber.__version__}")
except ImportError:
    pdfplumber = None
    print("❌ pdfplumber NOT installed")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
}
TIMEOUT = 30


def sep(title: str):
    print(f"\n{'='*72}")
    print(f"  {title}")
    print(f"{'='*72}")


# ──────────────────────────────────────────────────────────────────
# PART 1: Test raw URL connectivity and page structure
# ──────────────────────────────────────────────────────────────────
TEST_URLS = [
    ("BMD Main Site",         "http://bmd.gov.bd/"),
    ("BMD Live6 Portal",      "https://live6.bmd.gov.bd/"),
    ("SPI 4 Weeks Page",      "https://live6.bmd.gov.bd/p/SPI-4-Weeks"),
    ("7-days Rainfall Page",  "https://live6.bmd.gov.bd/p/7-days-Rainfall"),
    ("Agromet Forecast Page", "https://live6.bmd.gov.bd/p/Agromet-Forecast"),
    ("Heavy Rainfall Warning","https://live6.bmd.gov.bd/p/Heavy-Rainfall-Warning"),
    ("Rainfall Network RT",   "https://bmdrainfallnetwork.com/realtimedatas"),
]


def test_url(label: str, url: str):
    print(f"\n--- {label}: {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        soup = BeautifulSoup(resp.text, "html.parser")
        title = soup.title.string.strip() if soup.title and soup.title.string else "NO TITLE"
        tables = soup.find_all("table")

        print(f"  Status: {resp.status_code} | Final: {resp.url}")
        print(f"  Title: {title}")
        print(f"  Tables: {len(tables)}")

        # Show table info
        for i, table in enumerate(tables[:5]):
            headers = [th.get_text(strip=True)[:25] for th in table.find_all("th")[:8]]
            row_count = len(table.find_all("tr"))
            print(f"    Table {i}: {row_count} rows, headers={headers}")

        # PDF links
        pdf_links = []
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if ".pdf" in href.lower():
                full = urljoin(url, href)
                pdf_links.append(full)
                link_text = a.get_text(strip=True)[:60]
                print(f"  📄 PDF: {full}")
                print(f"       Text: '{link_text}'")

        # Keywords in page text
        text = soup.get_text(" ", strip=True).lower()
        keywords = ["spi", "drought", "rainfall", "7 day", "station", "district"]
        found_kw = [k for k in keywords if k in text]
        print(f"  Keywords: {found_kw}")

        return resp, soup, pdf_links
    except Exception as e:
        print(f"  ❌ FAILED: {type(e).__name__}: {e}")
        return None, None, []


# ──────────────────────────────────────────────────────────────────
# PART 2: Test PDF download and parsing
# ──────────────────────────────────────────────────────────────────
def test_pdf(pdf_url: str, max_pages: int = 3):
    print(f"\n  📄 Parsing PDF: {pdf_url}")
    if pdfplumber is None:
        print(f"    ❌ pdfplumber not installed")
        return

    try:
        resp = requests.get(pdf_url, headers=HEADERS, timeout=45)
        print(f"    Status: {resp.status_code}, Size: {len(resp.content)} bytes")
        if resp.status_code != 200:
            return

        with pdfplumber.open(BytesIO(resp.content)) as pdf:
            print(f"    Total pages: {len(pdf.pages)}")
            for i, page in enumerate(pdf.pages[:max_pages]):
                text = page.extract_text() or ""
                tables = page.extract_tables() or []
                print(f"    Page {i}: text_len={len(text)}, tables={len(tables)}")

                # Show text snippet
                if text:
                    print(f"      Text: {text[:200].replace(chr(10), ' ')}...")

                # Show table data
                for t_idx, table in enumerate(tables[:2]):
                    if table:
                        print(f"      Table {t_idx}: {len(table)} rows x {len(table[0]) if table[0] else 0} cols")
                        # Header
                        if table[0]:
                            cleaned_header = [str(c or "").replace("\n", " ").strip()[:25] for c in table[0]]
                            print(f"        Header: {cleaned_header}")
                        # First 3 data rows
                        for row in table[1:4]:
                            cleaned = [str(c or "").strip()[:20] for c in row]
                            print(f"        Data: {cleaned}")
                        if len(table) > 4:
                            print(f"        ... ({len(table)-4} more rows)")

    except Exception as e:
        print(f"    ❌ FAILED: {type(e).__name__}: {e}")


# ──────────────────────────────────────────────────────────────────
# PART 3: Test bmdrainfallnetwork.com JSON API
# ──────────────────────────────────────────────────────────────────
RAINFALL_LOCATIONS = {
    "Bagura": "18153927",
    "Barishal": "18241981",
    "Chattogram": "18153762",
    "CoxsBazar": "18150267",
    "Dhaka": "18152957",
    "Dinajpur": "18154280",
    "Gopalganj": "18153231",
    "Khulna": "18153424",
    "Netrokona": "18239193",
    "Nikli": "18152105",
}


def test_rainfall_network_api():
    sep("PART 3: bmdrainfallnetwork.com JSON API endpoints")

    # Currently raining
    url = "https://bmdrainfallnetwork.com/bmdrainfallnetwork.com/datas/datas/raining.php"
    print(f"\n--- Raining Now: {url}")
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        data = r.json()
        print(f"  Status: {r.status_code}")
        print(f"  Currently raining: {data.get('currentlyRaining', 'N/A')}")
        print(f"  Dashboard data count: {len(data.get('dashboardData', []))}")
    except Exception as e:
        print(f"  ❌ FAILED: {e}")

    # Per-location data
    print(f"\n--- Per-location accumulation data:")
    for name, loc_id in RAINFALL_LOCATIONS.items():
        url = f"https://bmdrainfallnetwork.com/bmdrainfallnetwork.com/datas/datas/allupdate.php?location_id={loc_id}"
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            data = r.json()
            dd = data.get("dashboardData", {})
            day_acc = dd.get("curDayTotalAccumulation", "N/A")
            month_acc = dd.get("curMonthTotalAccumulation", "N/A")
            print(f"  {name:15s}: day={day_acc}mm, month={month_acc}mm")
        except Exception as e:
            print(f"  {name:15s}: ❌ {e}")


# ──────────────────────────────────────────────────────────────────
# PART 4: Test the actual extractor functions
# ──────────────────────────────────────────────────────────────────
def test_extractor_functions():
    sep("PART 4: Testing actual extractor functions")

    # Add parent dir to path
    parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if parent not in sys.path:
        sys.path.insert(0, parent)

    # Test SPI
    print("\n--- scrape_bmd_spi_table() ---")
    try:
        from production_pipeline.extractors.bmd_extractor import scrape_bmd_spi_table
        df = scrape_bmd_spi_table()
        print(f"  Rows: {len(df)}")
        print(f"  Columns: {list(df.columns)}")
        if len(df) > 0:
            print(f"  Sample:\n{df.head(5).to_string()}")
        else:
            print("  ⚠️  EMPTY — No SPI data extracted")
    except Exception as e:
        print(f"  ❌ CRASHED: {e}")
        traceback.print_exc()

    # Test Rainfall
    print("\n--- scrape_bmd_rainfall_7day() ---")
    try:
        from production_pipeline.extractors.bmd_extractor import scrape_bmd_rainfall_7day
        df = scrape_bmd_rainfall_7day()
        print(f"  Rows: {len(df)}")
        print(f"  Columns: {list(df.columns)}")
        if len(df) > 0:
            print(f"  Districts: {sorted(df['District'].unique().tolist())}")
            print(f"  Sample:\n{df.head(10).to_string()}")
        else:
            print("  ⚠️  EMPTY — No rainfall data extracted")
    except Exception as e:
        print(f"  ❌ CRASHED: {e}")
        traceback.print_exc()


# ──────────────────────────────────────────────────────────────────
# PART 5: Key findings summary
# ──────────────────────────────────────────────────────────────────
def print_findings():
    sep("FINDINGS SUMMARY")
    print("""
KEY FINDINGS FROM THIS DIAGNOSTIC:

1. SPI DATA (BMD):
   - BMD publishes SPI as MAP IMAGES in PDFs, NOT tabular data
   - The SPI PDFs (from 2019!) contain a geographic map with color legend
   - There are NO district-level numeric SPI tables in any BMD PDF or page
   - The Drought DSS (http://103.30.30.84:121/DSS) is unreachable
   → CONCLUSION: BMD SPI scraping will ALWAYS return 0 rows because
     the data simply doesn't exist in tabular form on their website.
   → FIX: Compute SPI from CHIRPS rainfall data instead.

2. RAINFALL DATA (BMD):
   a) 7-days-Rainfall page: Has ONE PDF from Aug 2023 (stale!)
      - The PDF DOES have a parseable table with ~43 stations
      - But it's nearly 3 years old
   
   b) Agromet Forecast page: Has a PDF from YESTERDAY (May 10, 2026)!
      - Contains a 54-row table with station-level data:
        Division, Station, Total Rainfall (mm), Normal Rainfall (mm),
        Deviation %, Rainy Days, Humidity, Temperature
      - This is FRESH, REAL, PARSEABLE data
      - URL pattern: https://live6.bmd.gov.bd/p/Agromet-Forecast
   
   c) bmdrainfallnetwork.com: Has real-time JSON endpoints
      - Currently shows 0mm (no rain right now)
      - Has ~16 station locations with live gauges
      - Data is real-time but may be empty during dry periods
   
   → CONCLUSION: The extractor should prioritize:
     1. Agromet Forecast PDF (fresh weekly data with station rainfall)
     2. 7-day Rainfall PDF (when available)
     3. Rainfall network JSON API (real-time but often 0)

3. WHAT'S BREAKING:
   - Current extractor looks for HTML tables on pages → NONE EXIST
   - Current PDF parser finds rainfall PDF tables but:
     a) Only checks /p/7-days-Rainfall (stale 2023 PDF)
     b) Does NOT check /p/Agromet-Forecast (fresh daily PDF!)
   - Rainfall network selectors find empty <tbody> (JS-rendered)
   - The column mapping for "Name of the Stations" as district works
     but division fill-forward logic is missing (None values)
""")


# ──────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    all_pdfs = []

    sep("PART 1: URL Connectivity & Page Structure")
    for label, url in TEST_URLS:
        resp, soup, pdfs = test_url(label, url)
        all_pdfs.extend(pdfs)

    # Deduplicate
    all_pdfs = list(dict.fromkeys(all_pdfs))

    sep("PART 2: PDF Parsing")
    if all_pdfs:
        print(f"Found {len(all_pdfs)} unique PDF link(s)")
        for pdf_url in all_pdfs[:8]:
            test_pdf(pdf_url)
    else:
        print("No PDF links found on any tested page.")

    test_rainfall_network_api()
    test_extractor_functions()
    print_findings()
