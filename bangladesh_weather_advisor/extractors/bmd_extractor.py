"""Bangladesh Meteorological Department (BMD) extractor.

Production behavior:
- Tries multiple BMD pages/selectors because portal structure changes over time.
- Uses resilient table extraction (pandas + BeautifulSoup fallback + PDF fallback).
- Never crashes caller on structure drift; returns empty frames with canonical schemas.

Colab setup:
    !pip install requests beautifulsoup4 pandas lxml pdfplumber
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from io import BytesIO, StringIO
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

import pandas as pd
import requests
from bs4 import BeautifulSoup

try:
    import pdfplumber
except Exception:  # pragma: no cover - optional dependency in some runtimes
    pdfplumber = None

from production_pipeline.config import (
    BMD_API_KEY,
    BMD_BASE_URL,
    CURRENT_DATE,
    CURRENT_UTC,
    LOG_LEVEL,
    MAX_RETRIES,
    REQUEST_TIMEOUT_SEC,
    RETRY_BACKOFF_SEC,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
}

SPI_SCHEMA = ["District", "SPI-1", "SPI-3", "SPI-6", "Drought_Class", "Date_Scraped", "source"]
RAIN_SCHEMA = ["District", "Date", "Rainfall_mm", "source"]


def _fetch_with_retry(url: str, session: Optional[requests.Session] = None) -> str:
    last_exc: Optional[Exception] = None
    sess = session or requests.Session()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("[BMD] Fetching URL (attempt %s/%s): %s", attempt, MAX_RETRIES, url)
            response = sess.get(url, headers=DEFAULT_HEADERS, timeout=REQUEST_TIMEOUT_SEC)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last_exc = exc
            sleep_for = RETRY_BACKOFF_SEC * attempt
            logger.warning("[BMD] Fetch failed for %s: %s; sleeping %.1fs", url, exc, sleep_for)
            time.sleep(sleep_for)

    raise RuntimeError(f"Failed to fetch {url}: {last_exc}")


def _fetch_bytes_with_retry(url: str, session: Optional[requests.Session] = None) -> bytes:
    last_exc: Optional[Exception] = None
    sess = session or requests.Session()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("[BMD] Fetching bytes (attempt %s/%s): %s", attempt, MAX_RETRIES, url)
            response = sess.get(url, headers=DEFAULT_HEADERS, timeout=max(REQUEST_TIMEOUT_SEC, 45))
            response.raise_for_status()
            return response.content
        except Exception as exc:
            last_exc = exc
            sleep_for = RETRY_BACKOFF_SEC * attempt
            logger.warning("[BMD] Byte fetch failed for %s: %s; sleeping %.1fs", url, exc, sleep_for)
            time.sleep(sleep_for)

    raise RuntimeError(f"Failed to fetch bytes from {url}: {last_exc}")


def _norm_col(name: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def _empty_with_schema(columns: List[str]) -> pd.DataFrame:
    return pd.DataFrame(columns=columns)


def _diagnose_page(url: str, soup: BeautifulSoup) -> None:
    """Log what's on the page to help debug."""
    logger.info("[BMD][Diagnose] URL: %s", url)
    logger.info("[BMD][Diagnose] Page title: %s", soup.title.string.strip() if soup.title and soup.title.string else "N/A")
    tables = soup.find_all("table")
    logger.info("[BMD][Diagnose] Tables found: %d", len(tables))
    for i, table in enumerate(tables[:5]):
        headers = [th.get_text(strip=True) for th in table.find_all("th")[:10]]
        logger.info("[BMD][Diagnose] Table %d headers: %s", i, headers)


def _extract_tables_with_fallback(html: str, source_url: str) -> List[pd.DataFrame]:
    """Extract HTML tables with multiple parser strategies."""
    tables: List[pd.DataFrame] = []

    # Strategy 1: pandas with lxml/html5lib auto fallback
    try:
        parsed = pd.read_html(StringIO(html))
        for i, df in enumerate(parsed):
            c = df.copy()
            c["__table_index__"] = i
            c["__source_url__"] = source_url
            tables.append(c)
        logger.info("[BMD] Strategy[pandas-read_html] found %d table(s) from %s", len(parsed), source_url)
    except Exception as exc:
        logger.info("[BMD] Strategy[pandas-read_html] found no table for %s: %s", source_url, exc)

    # Strategy 2: BeautifulSoup manual table parsing
    if not tables:
        soup = BeautifulSoup(html, "html.parser")
        html_tables = soup.select("table")
        logger.info("[BMD] Strategy[bs4-manual] found %d raw <table> node(s) from %s", len(html_tables), source_url)

        for i, table in enumerate(html_tables):
            rows: List[List[str]] = []
            for tr in table.select("tr"):
                cells = [c.get_text(" ", strip=True) for c in tr.select("th, td")]
                if any(cells):
                    rows.append(cells)

            if not rows:
                continue

            header = rows[0]
            body = rows[1:] if len(rows) > 1 else []

            if body:
                width = max(len(header), max(len(r) for r in body))
                header = header + [f"col_{k}" for k in range(len(header), width)]
                body = [r + [""] * (width - len(r)) for r in body]
                df = pd.DataFrame(body, columns=header)
            else:
                df = pd.DataFrame(rows)

            df["__table_index__"] = i
            df["__source_url__"] = source_url
            tables.append(df)

    return tables


def _classify_drought(spi3: object) -> str:
    try:
        v = float(spi3)
    except Exception:
        return "Unknown"

    if v <= -2.0:
        return "Extreme Drought"
    if v <= -1.5:
        return "Severe Drought"
    if v <= -1.0:
        return "Moderate Drought"
    if v < 1.0:
        return "Near Normal"
    return "Wet"


def _score_spi_table(df: pd.DataFrame) -> int:
    cols = [_norm_col(c) for c in df.columns]
    score = 0

    if any("district" in c or "station" in c for c in cols):
        score += 3
    if any("spi_1" in c or "spi1" in c for c in cols):
        score += 3
    if any("spi_3" in c or "spi3" in c for c in cols):
        score += 4
    if any("spi_6" in c or "spi6" in c for c in cols):
        score += 3
    if any("drought" in c or "class" in c or "index" in c for c in cols):
        score += 2

    # Keyword fallback based on content
    text_blob = " ".join(df.astype(str).fillna("").head(40).stack().tolist()).lower()
    for kw in ("spi", "drought", "index", "district"):
        if kw in text_blob:
            score += 1

    # prefer tables containing more numeric content
    numeric_share = pd.to_numeric(df.astype(str).stack().str.replace(",", "", regex=False), errors="coerce").notna().mean()
    if pd.notna(numeric_share):
        score += int(numeric_share * 4)

    return score


def _score_rain_table(df: pd.DataFrame) -> int:
    cols = [_norm_col(c) for c in df.columns]
    score = 0
    if any("district" in c or "station" in c or "location" in c for c in cols):
        score += 3
    if any("rain" in c or "precip" in c for c in cols):
        score += 4
    if any("mm" in c or "total" in c or "7" in c for c in cols):
        score += 2

    text_blob = " ".join(df.astype(str).fillna("").head(40).stack().tolist()).lower()
    for kw in ("rain", "rainfall", "precipitation", "mm"):
        if kw in text_blob:
            score += 1

    return score


def _map_spi_columns(df: pd.DataFrame) -> pd.DataFrame:
    cols = {_norm_col(c): c for c in df.columns}

    district_col = next((orig for norm, orig in cols.items() if "district" in norm or "station" in norm), None)
    spi1_col = next((orig for norm, orig in cols.items() if norm in {"spi_1", "spi1"} or ("spi" in norm and "1" in norm)), None)
    spi3_col = next((orig for norm, orig in cols.items() if norm in {"spi_3", "spi3"} or ("spi" in norm and "3" in norm)), None)
    spi6_col = next((orig for norm, orig in cols.items() if norm in {"spi_6", "spi6"} or ("spi" in norm and "6" in norm)), None)
    drought_col = next((orig for norm, orig in cols.items() if "drought" in norm or ("class" in norm and "__" not in norm)), None)

    out = pd.DataFrame(
        {
            "District": df[district_col].astype(str).str.strip() if district_col else pd.Series(dtype="object"),
            "SPI-1": pd.to_numeric(df[spi1_col], errors="coerce") if spi1_col else pd.Series(dtype="float64"),
            "SPI-3": pd.to_numeric(df[spi3_col], errors="coerce") if spi3_col else pd.Series(dtype="float64"),
            "SPI-6": pd.to_numeric(df[spi6_col], errors="coerce") if spi6_col else pd.Series(dtype="float64"),
            "Drought_Class": df[drought_col].astype(str).str.strip() if drought_col else pd.Series(dtype="object"),
        }
    )

    # Remove obvious non-data rows
    if "District" in out.columns:
        out = out[out["District"].astype(str).str.len() > 0]
        out = out[~out["District"].str.lower().isin({"nan", "none", "district", "station", "name of station"})]

    if out.empty:
        return _empty_with_schema(["District", "SPI-1", "SPI-3", "SPI-6", "Drought_Class"])

    if out["Drought_Class"].isna().all() or (out["Drought_Class"].astype(str).str.strip() == "").all():
        out["Drought_Class"] = out["SPI-3"].map(_classify_drought)

    return out


def _extract_pdf_links(soup: BeautifulSoup, page_url: str) -> List[str]:
    links: List[str] = []

    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if ".pdf" in href.lower():
            links.append(urljoin(page_url, href))

    for img in soup.find_all("img", src=True):
        src = (img.get("src") or "").strip()
        if ".pdf" in src.lower():
            links.append(urljoin(page_url, src))

    # preserve order while removing duplicates
    out: List[str] = []
    seen: set[str] = set()
    for lnk in links:
        if lnk not in seen:
            seen.add(lnk)
            out.append(lnk)
    return out


def _extract_period_end_date(text: str) -> str:
    m = re.search(r"period\s*:\s*([0-9./-]+)\s*(?:to|-|–)\s*([0-9./-]+)", text, flags=re.I)
    if not m:
        return CURRENT_DATE.date().isoformat()

    end_raw = m.group(2)
    candidates = ["%d.%m.%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"]
    for fmt in candidates:
        try:
            return datetime.strptime(end_raw, fmt).date().isoformat()
        except Exception:
            continue
    return CURRENT_DATE.date().isoformat()


def _parse_spi_from_pdf(pdf_url: str, session: requests.Session) -> pd.DataFrame:
    if pdfplumber is None:
        logger.warning("[BMD][SPI] pdfplumber not installed. Cannot parse SPI PDF: %s", pdf_url)
        return _empty_with_schema(["District", "SPI-1", "SPI-3", "SPI-6", "Drought_Class"])

    try:
        payload = _fetch_bytes_with_retry(pdf_url, session=session)
    except Exception as exc:
        logger.warning("[BMD][SPI] Failed to fetch SPI PDF %s: %s", pdf_url, exc)
        return _empty_with_schema(["District", "SPI-1", "SPI-3", "SPI-6", "Drought_Class"])

    # First try table extraction from PDF pages.
    rows: List[Dict[str, object]] = []
    try:
        with pdfplumber.open(BytesIO(payload)) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables() or []:
                    if not table or len(table) < 2:
                        continue
                    header = [str(c or "").strip() for c in table[0]]
                    body = table[1:]
                    df = pd.DataFrame(body, columns=header)
                    mapped = _map_spi_columns(df)
                    if not mapped.empty and mapped[["SPI-1", "SPI-3", "SPI-6"]].notna().any(axis=None):
                        rows.extend(mapped.to_dict(orient="records"))
    except Exception as exc:
        logger.warning("[BMD][SPI] SPI PDF table parsing failed for %s: %s", pdf_url, exc)

    if not rows:
        logger.info("[BMD][SPI] SPI PDF has no parseable district numeric table: %s", pdf_url)
        return _empty_with_schema(["District", "SPI-1", "SPI-3", "SPI-6", "Drought_Class"])

    out = pd.DataFrame(rows)
    return out[["District", "SPI-1", "SPI-3", "SPI-6", "Drought_Class"]].drop_duplicates().reset_index(drop=True)


def _map_rainfall_columns(df: pd.DataFrame, source_url: str, fallback_date: str) -> pd.DataFrame:
    norm_to_orig = {_norm_col(c): c for c in df.columns}

    district_col = next(
        (
            o
            for n, o in norm_to_orig.items()
            if any(k in n for k in ["district", "station", "location", "name_of_the_stations", "name_of_stations"])
        ),
        None,
    )

    rain_col = next(
        (
            o
            for n, o in norm_to_orig.items()
            if ("rain" in n or "precip" in n) and any(k in n for k in ["mm", "total", "7", "fall", "accum"])
        ),
        None,
    )
    if rain_col is None:
        # broad fallback: first column that includes rain keyword
        rain_col = next((o for n, o in norm_to_orig.items() if "rain" in n or "precip" in n), None)

    date_col = next((o for n, o in norm_to_orig.items() if "date" in n or "period" in n), None)

    if not (district_col and rain_col):
        return _empty_with_schema(RAIN_SCHEMA)

    out = pd.DataFrame(
        {
            "District": df[district_col].astype(str).str.strip(),
            "Date": df[date_col].astype(str).str.strip() if date_col else fallback_date,
            "Rainfall_mm": pd.to_numeric(
                df[rain_col].astype(str).str.replace("*", "", regex=False).str.replace(",", "", regex=False),
                errors="coerce",
            ),
            "source": source_url,
        }
    )

    out = out.dropna(subset=["Rainfall_mm"])
    out = out[out["District"].astype(str).str.len() > 0]
    out = out[~out["District"].str.lower().isin({"nan", "none", "district", "station", "name of the stations"})]
    return out[RAIN_SCHEMA].reset_index(drop=True)


def _parse_rainfall_from_pdf(pdf_url: str, session: requests.Session) -> pd.DataFrame:
    if pdfplumber is None:
        logger.warning("[BMD][Rainfall] pdfplumber not installed. Cannot parse rainfall PDF: %s", pdf_url)
        return _empty_with_schema(RAIN_SCHEMA)

    try:
        payload = _fetch_bytes_with_retry(pdf_url, session=session)
    except Exception as exc:
        logger.warning("[BMD][Rainfall] Failed to fetch rainfall PDF %s: %s", pdf_url, exc)
        return _empty_with_schema(RAIN_SCHEMA)

    all_rows: List[pd.DataFrame] = []
    period_end = CURRENT_DATE.date().isoformat()

    try:
        with pdfplumber.open(BytesIO(payload)) as pdf:
            all_text = []
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                all_text.append(page_text)

                for table in page.extract_tables() or []:
                    if not table or len(table) < 2:
                        continue
                    header = [str(c or "").replace("\n", " ").strip() for c in table[0]]
                    body = table[1:]
                    df = pd.DataFrame(body, columns=header)
                    mapped = _map_rainfall_columns(df, source_url=pdf_url, fallback_date=period_end)
                    if not mapped.empty:
                        all_rows.append(mapped)

            period_end = _extract_period_end_date("\n".join(all_text))
            if all_rows:
                merged = pd.concat(all_rows, ignore_index=True)
                merged["Date"] = period_end
                return merged.drop_duplicates().reset_index(drop=True)
    except Exception as exc:
        logger.warning("[BMD][Rainfall] Rainfall PDF parsing failed for %s: %s", pdf_url, exc)

    logger.info("[BMD][Rainfall] No parseable rainfall table found in PDF: %s", pdf_url)
    return _empty_with_schema(RAIN_SCHEMA)


def scrape_bmd_spi_table() -> pd.DataFrame:
    """Scrape SPI drought indices from BMD sources.

    Returns:
        DataFrame with columns: [District, SPI-1, SPI-3, SPI-6,
                                 Drought_Class, Date_Scraped, source]
    """
    candidate_urls = [
        BMD_BASE_URL.rstrip("/") + "/p/SPI-4-Weeks",
        BMD_BASE_URL.rstrip("/") + "/p/One-Month",
        BMD_BASE_URL.rstrip("/") + "/p/Three-Month",
        BMD_BASE_URL.rstrip("/") + "/p/SPI-Seasonal",
        BMD_BASE_URL.rstrip("/") + "/p/SPI-Forecast",
        BMD_BASE_URL.rstrip("/") + "/",
    ]

    session = requests.Session()
    best_df: Optional[pd.DataFrame] = None
    best_score = -1
    seen_summary: List[str] = []
    parsed_pdf_rows: List[pd.DataFrame] = []

    for url in candidate_urls:
        try:
            html = _fetch_with_retry(url, session=session)
            soup = BeautifulSoup(html, "html.parser")
            _diagnose_page(url, soup)

            tables = _extract_tables_with_fallback(html, source_url=url)
            seen_summary.append(f"{url} -> {len(tables)} table(s)")

            # Strategy A: direct table detection by scoring
            for i, tdf in enumerate(tables):
                score = _score_spi_table(tdf)
                logger.info("[BMD][SPI] Table score url=%s idx=%s score=%s", url, i, score)
                if score > best_score:
                    best_score = score
                    best_df = tdf.copy()

            # Strategy B: keyword and selectors diagnostics
            page_text = soup.get_text(" ", strip=True).lower()
            has_spi_kw = any(k in page_text for k in ["spi", "drought", "index"])
            logger.info("[BMD][SPI] keyword(spi/drought/index)=%s on %s", has_spi_kw, url)

            css_hits = len(soup.select("table, .table, .content table, #container_2 table"))
            logger.info("[BMD][SPI] CSS selector table-like hits=%s on %s", css_hits, url)

            # Strategy C: parse candidate PDFs if linked/embedded on page
            pdf_links = _extract_pdf_links(soup, page_url=url)
            if pdf_links:
                logger.info("[BMD][SPI] Found %d SPI PDF candidate link(s) on %s", len(pdf_links), url)
                for pdf_url in pdf_links[:6]:
                    parsed_pdf = _parse_spi_from_pdf(pdf_url, session=session)
                    if not parsed_pdf.empty:
                        parsed_pdf["__source_url__"] = pdf_url
                        parsed_pdf_rows.append(parsed_pdf)
                        logger.info("[BMD][SPI] Parsed %d row(s) from SPI PDF %s", len(parsed_pdf), pdf_url)
                    else:
                        logger.info("[BMD][SPI] No usable district SPI rows in PDF: %s", pdf_url)
            else:
                logger.info("[BMD][SPI] No PDF links found on page: %s", url)
        except Exception as exc:
            logger.warning("[BMD][SPI] Failed candidate %s: %s", url, exc)

    logger.info("[BMD][SPI] Scan summary: %s", " | ".join(seen_summary) if seen_summary else "no pages read")

    # Prefer tabular HTML data if available
    if best_df is not None:
        mapped = _map_spi_columns(best_df)
        if not mapped.empty and mapped[["SPI-1", "SPI-3", "SPI-6"]].notna().any(axis=None):
            mapped["Date_Scraped"] = CURRENT_DATE.date().isoformat()
            mapped["source"] = str(best_df.get("__source_url__", BMD_BASE_URL)).split("\n")[0]
            return mapped[SPI_SCHEMA].drop_duplicates().reset_index(drop=True)

    # Fallback to SPI parsed from PDF tables if present
    if parsed_pdf_rows:
        pdf_df = pd.concat(parsed_pdf_rows, ignore_index=True)
        if not pdf_df.empty:
            pdf_df["Date_Scraped"] = CURRENT_DATE.date().isoformat()
            pdf_df["source"] = "bmd_pdf"
            return pdf_df[SPI_SCHEMA].drop_duplicates().reset_index(drop=True)

    logger.warning(
        "[BMD][SPI] No usable district-level SPI numeric table found on current BMD pages/PDFs. "
        "Site appears to publish SPI mainly as maps/images or non-tabular bulletins. Returning empty frame."
    )
    return _empty_with_schema(SPI_SCHEMA)


AGROMET_SCHEMA = ["station", "district", "date", "rainfall_mm", "temp", "humidity", "source"]

# Station-to-district mapping for BMD Agromet stations
_STATION_DISTRICT_MAP = {
    "dhaka": "Dhaka", "mymensingh": "Mymensingh", "faridpur": "Faridpur",
    "madaripur": "Madaripur", "tangail": "Tangail", "gopalganj": "Gopalganj",
    "nikli": "Nikli", "chittagong": "Chattogram", "chattogram": "Chattogram",
    "comilla": "Cumilla", "cumilla": "Cumilla", "chandpur": "Chandpur",
    "sitakunda": "Sitakunda", "rangamati": "Rangamati", "cox's bazar": "Cox's Bazar",
    "coxs bazar": "Cox's Bazar", "cox'sbazar": "Cox's Bazar",
    "teknaf": "Cox's Bazar", "feni": "Feni", "hatiya": "Noakhali",
    "sandwip": "Chattogram", "kutubdia": "Cox's Bazar", "khepupara": "Patuakhali",
    "sylhet": "Sylhet", "srimangal": "Moulvibazar", "moulvibazar": "Moulvibazar",
    "rajshahi": "Rajshahi", "bogra": "Bogra", "bogura": "Bogra",
    "rangpur": "Rangpur", "dinajpur": "Dinajpur", "sayedpur": "Nilphamari",
    "ishurdi": "Pabna", "pabna": "Pabna", "tarash": "Sirajganj",
    "khulna": "Khulna", "jessore": "Jessore", "jashore": "Jessore",
    "satkhira": "Satkhira", "chuadanga": "Chuadanga", "kushtia": "Kushtia",
    "mongla": "Bagerhat", "barisal": "Barishal", "barishal": "Barishal",
    "bhola": "Bhola", "patuakhali": "Patuakhali", "maijdee court": "Noakhali",
    "noakhali": "Noakhali", "ambagan": "Chattogram", "rajarhat": "Kurigram",
    "tetulia": "Panchagarh", "dimla": "Nilphamari", "badalgachhi": "Naogaon",
    "tarash": "Sirajganj", "gopalganj": "Gopalganj", "tungipara": "Gopalganj",
    "shariatpur": "Shariatpur", "netrokona": "Netrokona", "habiganj": "Habiganj",
    "sunamganj": "Sunamganj",
}


def _map_station_to_district(station_name: str) -> str:
    """Map a BMD station name to its district. Falls back to station name itself."""
    key = station_name.strip().lower()
    return _STATION_DISTRICT_MAP.get(key, station_name.strip().title())


def _parse_agromet_pdf(pdf_bytes: bytes, pdf_url: str) -> pd.DataFrame:
    """Parse the Agromet Forecast PDF table into a DataFrame.

    Expected columns in the PDF table:
      Division | Station | Total Rainfall (mm) | Normal Rainfall (mm) |
      Deviation % | Rainy Days | Humidity | Temperature
    """
    if pdfplumber is None:
        logger.warning("[BMD][Agromet] pdfplumber not installed")
        return _empty_with_schema(AGROMET_SCHEMA)

    all_rows: List[Dict[str, Any]] = []
    period_date = CURRENT_DATE.date().isoformat()

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            full_text_parts: List[str] = []

            for page in pdf.pages:
                page_text = page.extract_text() or ""
                full_text_parts.append(page_text)

                for table in page.extract_tables() or []:
                    if not table or len(table) < 2:
                        continue
                    header_raw = [str(c or "").replace("\n", " ").strip() for c in table[0]]
                    header_norm = [_norm_col(h) for h in header_raw]

                    # Identify key columns by normalized names
                    # Division column (merged cells — first station in each division)
                    division_idx = next(
                        (i for i, h in enumerate(header_norm) if "division" in h),
                        None,
                    )
                    # Station column — prefer explicit "station" match over generic "name"
                    station_idx = next(
                        (i for i, h in enumerate(header_norm) if "station" in h),
                        None,
                    )
                    if station_idx is None:
                        # Fallback: "name" column that is NOT the division column
                        station_idx = next(
                            (i for i, h in enumerate(header_norm)
                             if "name" in h and i != division_idx),
                            None,
                        )
                    rain_idx = next(
                        (i for i, h in enumerate(header_norm)
                         if "total" in h and ("rain" in h or "mm" in h)),
                        None,
                    )
                    if rain_idx is None:
                        rain_idx = next(
                            (i for i, h in enumerate(header_norm) if "rain" in h),
                            None,
                        )
                    temp_idx = next(
                        (i for i, h in enumerate(header_norm)
                         if "max_temp" in h or ("temp" in h and "normal" not in h)),
                        None,
                    )
                    humidity_idx = next(
                        (i for i, h in enumerate(header_norm)
                         if ("max" in h and "humid" in h) or "rh" in h),
                        None,
                    )
                    if humidity_idx is None:
                        humidity_idx = next(
                            (i for i, h in enumerate(header_norm) if "humid" in h),
                            None,
                        )

                    if station_idx is None and rain_idx is None:
                        continue  # not the table we want

                    current_division = ""
                    for row in table[1:]:
                        cells = [str(c or "").strip() for c in row]

                        # Track division (often merged cells - filled only on first station)
                        if division_idx is not None and cells[division_idx]:
                            current_division = cells[division_idx]

                        station_name = cells[station_idx] if station_idx is not None and station_idx < len(cells) else ""
                        if not station_name or station_name.lower() in {"", "nan", "none", "station", "name of station"}:
                            continue

                        rain_val = None
                        if rain_idx is not None and rain_idx < len(cells):
                            rain_val = pd.to_numeric(
                                cells[rain_idx].replace("*", "").replace(",", "").replace("T", "0").replace("Trace", "0"),
                                errors="coerce",
                            )

                        temp_val = None
                        if temp_idx is not None and temp_idx < len(cells):
                            temp_val = pd.to_numeric(cells[temp_idx].replace(",", ""), errors="coerce")

                        humidity_val = None
                        if humidity_idx is not None and humidity_idx < len(cells):
                            humidity_val = pd.to_numeric(cells[humidity_idx].replace(",", "").replace("%", ""), errors="coerce")

                        all_rows.append({
                            "station": station_name,
                            "district": _map_station_to_district(station_name),
                            "date": period_date,
                            "rainfall_mm": float(rain_val) if pd.notna(rain_val) else None,
                            "temp": float(temp_val) if pd.notna(temp_val) else None,
                            "humidity": float(humidity_val) if pd.notna(humidity_val) else None,
                            "source": pdf_url,
                        })

            # Try to extract the period date from the full text
            full_text = "\n".join(full_text_parts)
            period_date_extracted = _extract_period_end_date(full_text)
            if period_date_extracted:
                for r in all_rows:
                    r["date"] = period_date_extracted

    except Exception as exc:
        logger.warning("[BMD][Agromet] PDF parsing failed for %s: %s", pdf_url, exc)
        return _empty_with_schema(AGROMET_SCHEMA)

    if not all_rows:
        logger.info("[BMD][Agromet] No parseable rows in Agromet PDF: %s", pdf_url)
        return _empty_with_schema(AGROMET_SCHEMA)

    df = pd.DataFrame(all_rows)
    # Drop rows where rainfall is missing (not useful)
    df = df.dropna(subset=["rainfall_mm"], how="all")
    logger.info("[BMD][Agromet] Parsed %d station rows from Agromet PDF: %s", len(df), pdf_url)
    return df[AGROMET_SCHEMA].reset_index(drop=True)


def scrape_bmd_agromet() -> pd.DataFrame:
    """Scrape the BMD Agromet Forecast page for fresh station-level weather data.

    Fetches http://live6.bmd.gov.bd/p/Agromet-Forecast, finds the latest PDF,
    downloads it, and extracts the station-level table.

    Returns:
        DataFrame with columns: [station, district, date, rainfall_mm, temp, humidity, source]
    """
    # BMD has multiple domains; the Agromet page may live on a different one
    agromet_candidates = [
        "https://bmd.gov.bd/p/Agromet-Forecast",
        "https://server6.bmd.gov.bd/p/Agromet-Forecast",
        BMD_BASE_URL.rstrip("/") + "/p/Agromet-Forecast",
    ]
    # deduplicate while preserving order
    seen_urls: set[str] = set()
    agromet_urls: List[str] = []
    for u in agromet_candidates:
        if u not in seen_urls:
            seen_urls.add(u)
            agromet_urls.append(u)

    session = requests.Session()

    logger.info("[BMD][Agromet] ━━━ Scraping Agromet Forecast (trying %d URL variants) ━━━", len(agromet_urls))

    for agromet_url in agromet_urls:
        try:
            html = _fetch_with_retry(agromet_url, session=session)
            soup = BeautifulSoup(html, "html.parser")
            page_title = (soup.title.string.strip() if soup.title and soup.title.string else "").lower()

            # Skip soft-404 pages (BMD returns HTTP 200 with "404" in title)
            if "404" in page_title:
                logger.info("[BMD][Agromet] Soft-404 on %s — skipping", agromet_url)
                continue

            _diagnose_page(agromet_url, soup)

            # Find PDF links on the page
            pdf_links = _extract_pdf_links(soup, page_url=agromet_url)
            logger.info("[BMD][Agromet] Found %d PDF link(s) on %s", len(pdf_links), agromet_url)

            if not pdf_links:
                logger.info("[BMD][Agromet] No PDF links on %s — trying next URL", agromet_url)
                continue

            # Try each PDF (usually just one, but be safe)
            for pdf_url in pdf_links[:3]:
                logger.info("[BMD][Agromet] Downloading PDF: %s", pdf_url)
                try:
                    pdf_bytes = _fetch_bytes_with_retry(pdf_url, session=session)
                    logger.info("[BMD][Agromet] PDF downloaded: %d bytes", len(pdf_bytes))

                    df = _parse_agromet_pdf(pdf_bytes, pdf_url)
                    if not df.empty:
                        logger.info(
                            "[BMD][Agromet] ✅ SUCCESS: %d rows extracted from Agromet PDF "
                            "(stations: %d, date: %s, url: %s)",
                            len(df),
                            df["station"].nunique(),
                            df["date"].iloc[0] if len(df) > 0 else "N/A",
                            agromet_url,
                        )
                        return df
                except Exception as exc:
                    logger.warning("[BMD][Agromet] Failed to parse PDF %s: %s", pdf_url, exc)
                    continue

        except Exception as exc:
            logger.warning("[BMD][Agromet] Failed to fetch %s: %s", agromet_url, exc)
            continue

    logger.warning("[BMD][Agromet] No usable data from any Agromet Forecast URL variant")
    return _empty_with_schema(AGROMET_SCHEMA)


def _agromet_to_rain_schema(agromet_df: pd.DataFrame) -> pd.DataFrame:
    """Convert Agromet DataFrame to the standard RAIN_SCHEMA for backward compatibility."""
    if agromet_df.empty:
        return _empty_with_schema(RAIN_SCHEMA)

    return pd.DataFrame({
        "District": agromet_df["district"],
        "Date": agromet_df["date"],
        "Rainfall_mm": agromet_df["rainfall_mm"],
        "source": agromet_df["source"].astype(str) + " (agromet)",
    })[RAIN_SCHEMA].reset_index(drop=True)


def scrape_bmd_rainfall_7day() -> pd.DataFrame:
    """Scrape 7-day rainfall totals from BMD sources.

    Priority order:
      1. Agromet Forecast PDF (fresh weekly data, ~54 stations)
      2. BMD rainfall network real-time tables
      3. BMD 7-days-Rainfall HTML/PDF page (often stale)
      4. Rainfall network JSON API fallback

    Returns:
        DataFrame with columns: [District, Date, Rainfall_mm, source]
    """
    session = requests.Session()
    rows_frames: List[pd.DataFrame] = []

    # ── Strategy 0 (PRIMARY): Agromet Forecast PDF ──────────────────
    logger.info("[BMD][Rainfall] ━━━ Trying Agromet Forecast (primary source) ━━━")
    try:
        agromet_df = scrape_bmd_agromet()
        if not agromet_df.empty:
            converted = _agromet_to_rain_schema(agromet_df)
            rows_frames.append(converted)
            logger.info(
                "[BMD][Rainfall] ✅ Agromet source: %d rows from %d stations (date: %s)",
                len(converted),
                agromet_df["station"].nunique(),
                agromet_df["date"].iloc[0] if len(agromet_df) > 0 else "N/A",
            )
        else:
            logger.warning("[BMD][Rainfall] Agromet returned empty — falling back to other sources")
    except Exception as exc:
        logger.warning("[BMD][Rainfall] Agromet source failed: %s — falling back", exc)

    # ── Strategy 1: BMD rainfall network real-time tables ───────────
    rt_urls = [
        "https://bmdrainfallnetwork.com/realtimedatas",
        "https://bmdrainfallnetwork.com/realtimedatas/location/18080938",
        "https://bmdrainfallnetwork.com/realtimedatas/location/18152957",
    ]

    for rt_url in rt_urls:
        try:
            html = _fetch_with_retry(rt_url, session=session)
            soup = BeautifulSoup(html, "html.parser")
            _diagnose_page(rt_url, soup)

            table_selectors = ["table#rtTable", "#rtTable", "table.table.table-hover", "table"]
            found_rows = 0
            for sel in table_selectors:
                for tr in soup.select(f"{sel} tbody tr"):
                    tds = [td.get_text(" ", strip=True) for td in tr.select("td")]
                    if len(tds) < 6:
                        continue
                    # Known columns: ref, timestamp, code, rate, accumulation, total_accum
                    rain_val = pd.to_numeric(str(tds[4]).replace(",", ""), errors="coerce")
                    if pd.isna(rain_val):
                        continue
                    date_part = str(tds[1]).split(" ")[0] if tds[1] else CURRENT_DATE.date().isoformat()
                    district_hint = soup.select_one(".card-title")
                    district_text = district_hint.get_text(" ", strip=True) if district_hint else "Unknown"
                    frame = pd.DataFrame(
                        [{
                            "District": district_text,
                            "Date": date_part,
                            "Rainfall_mm": float(rain_val),
                            "source": rt_url,
                        }]
                    )
                    rows_frames.append(frame)
                    found_rows += 1
            logger.info("[BMD][Rainfall] Strategy[realtimedatas] url=%s rows=%d", rt_url, found_rows)
        except Exception as exc:
            logger.warning("[BMD][Rainfall] Strategy[realtimedatas] failed for %s: %s", rt_url, exc)

    # Strategy 2: BMD 7-days rainfall HTML table fallback
    seven_day_url = BMD_BASE_URL.rstrip("/") + "/p/7-days-Rainfall"
    try:
        html = _fetch_with_retry(seven_day_url, session=session)
        soup = BeautifulSoup(html, "html.parser")
        _diagnose_page(seven_day_url, soup)

        tables = _extract_tables_with_fallback(html, source_url=seven_day_url)
        logger.info("[BMD][Rainfall] Strategy[7-days HTML page] tables=%d", len(tables))

        for i, df in enumerate(tables):
            score = _score_rain_table(df)
            logger.info("[BMD][Rainfall] HTML table score idx=%d score=%d", i, score)
            if score < 3:
                continue
            mapped = _map_rainfall_columns(df, source_url=seven_day_url, fallback_date=CURRENT_DATE.date().isoformat())
            if not mapped.empty:
                rows_frames.append(mapped)
                logger.info("[BMD][Rainfall] Added %d rows from HTML 7-days table idx=%d", len(mapped), i)

        # Strategy 3: PDF links/embedded docs on 7-days page
        pdf_links = _extract_pdf_links(soup, page_url=seven_day_url)
        logger.info("[BMD][Rainfall] 7-days page PDF candidates=%d", len(pdf_links))
        for pdf_url in pdf_links[:6]:
            pdf_df = _parse_rainfall_from_pdf(pdf_url, session=session)
            if not pdf_df.empty:
                rows_frames.append(pdf_df)
                logger.info("[BMD][Rainfall] Added %d rows from rainfall PDF %s", len(pdf_df), pdf_url)
            else:
                logger.info("[BMD][Rainfall] No usable rows in rainfall PDF %s", pdf_url)
    except Exception as exc:
        logger.warning("[BMD][Rainfall] Strategy[7-days page + PDF] failed: %s", exc)

    # Strategy 4: rainfall network JSON summary endpoint (graceful fallback)
    if not rows_frames:
        try:
            fallback_ids = ["18080938", "18152957", "18153762"]
            for loc in fallback_ids:
                url = f"https://bmdrainfallnetwork.com/bmdrainfallnetwork.com/datas/datas/allupdate.php?location_id={loc}"
                response_text = _fetch_with_retry(url, session=session)
                payload = pd.Series([response_text]).apply(lambda x: x)
                if payload.empty:
                    continue
                # We do not force this into 7-day output unless numeric field is available.
                logger.info("[BMD][Rainfall] Fallback summary endpoint reachable for location_id=%s", loc)
        except Exception as exc:
            logger.warning("[BMD][Rainfall] Strategy[fallback summary endpoint] failed: %s", exc)

    if not rows_frames:
        logger.warning(
            "[BMD][Rainfall] No usable rainfall rows found from any BMD source "
            "(Agromet/HTML/PDF/realtime). Returning empty schema frame."
        )
        return _empty_with_schema(RAIN_SCHEMA)

    out = pd.concat(rows_frames, ignore_index=True)
    out["Rainfall_mm"] = pd.to_numeric(out["Rainfall_mm"], errors="coerce")
    out = out.dropna(subset=["Rainfall_mm"])
    out["District"] = out["District"].astype(str).str.strip()
    out = out[out["District"].str.len() > 0]
    out = out[~out["District"].str.lower().isin({"nan", "none", "district", "station"})]

    out = out.drop_duplicates(subset=["District", "Date", "Rainfall_mm", "source"]).reset_index(drop=True)

    # ── Source summary logging ──────────────────────────────────────
    source_counts = out["source"].apply(
        lambda s: "agromet" if "agromet" in str(s).lower() else
                  "7day_pdf" if ".pdf" in str(s).lower() and "agromet" not in str(s).lower() else
                  "realtime" if "realtime" in str(s).lower() else
                  "html"
    ).value_counts().to_dict()
    logger.info(
        "[BMD][Rainfall] ━━━ FINAL: %d total rows | Sources: %s ━━━",
        len(out), source_counts,
    )

    # stale-data signal (the site can keep old PDFs for long periods)
    try:
        parsed_dates = pd.to_datetime(out["Date"], errors="coerce")
        if parsed_dates.notna().any():
            latest = parsed_dates.max().date().isoformat()
            logger.info("[BMD][Rainfall] Latest extracted period date: %s", latest)
    except Exception:
        pass

    return out[RAIN_SCHEMA]


# -----------------------------------------------------------------------------
# Backward-compatible wrappers (existing notebooks/scripts import these names)
# -----------------------------------------------------------------------------
def scrape_spi_tables(url_suffix: str = "") -> pd.DataFrame:
    """Backward-compatible wrapper for legacy pipeline calls."""
    df = scrape_bmd_spi_table()
    legacy = pd.DataFrame(
        {
            "district": df.get("District", pd.Series(dtype="object")),
            "spi_1": pd.to_numeric(df.get("SPI-1"), errors="coerce"),
            "spi_3": pd.to_numeric(df.get("SPI-3"), errors="coerce"),
            "spi_6": pd.to_numeric(df.get("SPI-6"), errors="coerce"),
            "drought_class": df.get("Drought_Class", pd.Series(dtype="object")),
            "source": df.get("source", pd.Series(dtype="object")),
            "extraction_date": df.get("Date_Scraped", pd.Series(dtype="object")),
            "ingested_at_utc": CURRENT_UTC.isoformat(),
        }
    )
    return legacy


def scrape_rainfall_summaries(url_suffix: str = "") -> pd.DataFrame:
    """Backward-compatible wrapper for legacy rainfall summary output."""
    df = scrape_bmd_rainfall_7day()
    legacy = pd.DataFrame(
        {
            "district": df.get("District", pd.Series(dtype="object")),
            "record_date": df.get("Date", pd.Series(dtype="object")),
            "total_rainfall_mm": pd.to_numeric(df.get("Rainfall_mm"), errors="coerce"),
            "source": df.get("source", pd.Series(dtype="object")),
            "extraction_date": CURRENT_DATE.date().isoformat(),
            "ingested_at_utc": CURRENT_UTC.isoformat(),
        }
    )
    return legacy


def fetch_from_api(endpoint: str, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
    """API-ready method for future BMD access.

    Raises:
        RuntimeError: If API key is missing.
    """
    if not BMD_API_KEY:
        raise RuntimeError("BMD_API_KEY not configured. Continue using scraping until API access is granted.")

    api_url = BMD_BASE_URL.rstrip("/") + "/api/" + endpoint.lstrip("/")
    params = params or {}
    headers = {**DEFAULT_HEADERS, "Authorization": f"Bearer {BMD_API_KEY}"}

    try:
        response = requests.get(api_url, params=params, headers=headers, timeout=REQUEST_TIMEOUT_SEC)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list):
            df = pd.DataFrame(payload)
        else:
            df = pd.DataFrame(payload.get("data", []))

        if df.empty:
            return _empty_with_schema(["source", "extraction_date", "ingested_at_utc"])

        df["source"] = "bmd_api"
        df["extraction_date"] = CURRENT_DATE.date().isoformat()
        df["ingested_at_utc"] = CURRENT_UTC.isoformat()
        return df
    except Exception as exc:
        logger.exception("BMD API fetch failed endpoint=%s: %s", endpoint, exc)
        return _empty_with_schema(["source", "extraction_date", "ingested_at_utc"])
