"""BAMIS extractor: crop calendars, bulletins, and PDF text extraction.

Production behavior:
- Uses multiple selector strategies and URL patterns.
- Survives structure drift by returning empty schema frames (never hard-crash).
- Prefers public pages/links and parses PDF text where possible.
"""

from __future__ import annotations

import io
import logging
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Set
from urllib.parse import urljoin

import pandas as pd
import pdfplumber
import requests
from bs4 import BeautifulSoup

from production_pipeline.config import (
    BAMIS_BASE_URL,
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

CALENDAR_SCHEMA = ["Crop", "District", "Operation", "Month", "Week", "source"]

MONTH_PATTERN = re.compile(
    r"\b(january|february|march|april|may|june|july|august|september|october|november|december|"
    r"jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b",
    flags=re.IGNORECASE,
)
WEEK_PATTERN = re.compile(r"\b(week|wk|std\.week)[^\d]{0,4}(\d{1,2})\b", flags=re.IGNORECASE)

OPERATION_KEYWORDS = [
    "sowing",
    "seedling",
    "transplant",
    "planting",
    "weeding",
    "irrigation",
    "fertilizer",
    "fertiliser",
    "pest",
    "disease",
    "flower",
    "fruit",
    "harvest",
    "post-harvest",
    "land preparation",
    "nursery",
    "thinning",
    "pruning",
    "mulching",
]


def _fetch_html(url: str, session: Optional[requests.Session] = None) -> str:
    last_exc: Optional[Exception] = None
    sess = session or requests.Session()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = sess.get(url, headers=DEFAULT_HEADERS, timeout=REQUEST_TIMEOUT_SEC)
            resp.raise_for_status()
            return resp.text
        except Exception as exc:
            last_exc = exc
            delay = RETRY_BACKOFF_SEC * attempt
            logger.warning("[BAMIS] Attempt %d failed for %s: %s", attempt, url, exc)
            time.sleep(delay)

    raise RuntimeError(f"Unable to fetch {url}: {last_exc}")


def _fetch_bytes(url: str, session: Optional[requests.Session] = None) -> bytes:
    last_exc: Optional[Exception] = None
    sess = session or requests.Session()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = sess.get(url, headers=DEFAULT_HEADERS, timeout=REQUEST_TIMEOUT_SEC, allow_redirects=True)
            resp.raise_for_status()
            return resp.content
        except Exception as exc:
            last_exc = exc
            delay = RETRY_BACKOFF_SEC * attempt
            logger.warning("[BAMIS] Attempt %d failed downloading %s: %s", attempt, url, exc)
            time.sleep(delay)

    raise RuntimeError(f"Unable to download {url}: {last_exc}")


def _standardize(df: pd.DataFrame, source: str) -> pd.DataFrame:
    df = df.copy()
    df["source"] = source
    df["extraction_date"] = CURRENT_DATE.date().isoformat()
    df["ingested_at_utc"] = CURRENT_UTC.isoformat()
    return df


def _empty_calendar_df() -> pd.DataFrame:
    return pd.DataFrame(columns=CALENDAR_SCHEMA)


def _month_norm(token: str) -> str:
    m = token.strip().lower()[:3]
    lookup = {
        "jan": "January",
        "feb": "February",
        "mar": "March",
        "apr": "April",
        "may": "May",
        "jun": "June",
        "jul": "July",
        "aug": "August",
        "sep": "September",
        "oct": "October",
        "nov": "November",
        "dec": "December",
    }
    return lookup.get(m, token.title())


def _extract_crop_district_from_title(page_title: str) -> Dict[str, str]:
    # Common pattern: "Barishal - Banana - Crop weather calendar"
    parts = [p.strip() for p in page_title.split("-") if p.strip()]
    if len(parts) >= 2:
        return {"district": parts[0], "crop": parts[1]}
    if len(parts) == 1:
        return {"district": "Unknown", "crop": parts[0]}
    return {"district": "Unknown", "crop": "Unknown"}


def _extract_calendar_rows_from_text(crop: str, district: str, text: str, source_url: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    if not text.strip():
        return rows

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    for line in lines:
        low = line.lower()
        matched_ops = [op for op in OPERATION_KEYWORDS if op in low]
        if not matched_ops:
            continue

        months = sorted({_month_norm(m.group(0)) for m in MONTH_PATTERN.finditer(line)})
        week_match = WEEK_PATTERN.search(line)
        week = week_match.group(2) if week_match else ""

        for op in matched_ops:
            if months:
                for month in months:
                    rows.append(
                        {
                            "Crop": crop,
                            "District": district,
                            "Operation": op.title(),
                            "Month": month,
                            "Week": week,
                            "source": source_url,
                        }
                    )
            else:
                rows.append(
                    {
                        "Crop": crop,
                        "District": district,
                        "Operation": op.title(),
                        "Month": "",
                        "Week": week,
                        "source": source_url,
                    }
                )

    return rows


def _parse_calendar_pdf(pdf_url: str, crop: str, district: str, session: requests.Session) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []

    try:
        pdf_bytes = _fetch_bytes(pdf_url, session=session)
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            full_text_parts: List[str] = []
            for page in pdf.pages[:2]:
                full_text_parts.append(page.extract_text() or "")
            full_text = "\n".join(full_text_parts)

        rows = _extract_calendar_rows_from_text(crop=crop, district=district, text=full_text, source_url=pdf_url)

        # If operation extraction is sparse, emit a fallback row with detected months.
        if not rows:
            months = sorted({_month_norm(m.group(0)) for m in MONTH_PATTERN.finditer(full_text)})
            if months:
                for month in months:
                    rows.append(
                        {
                            "Crop": crop,
                            "District": district,
                            "Operation": "General Calendar",
                            "Month": month,
                            "Week": "",
                            "source": pdf_url,
                        }
                    )
            else:
                rows.append(
                    {
                        "Crop": crop,
                        "District": district,
                        "Operation": "General Calendar",
                        "Month": "",
                        "Week": "",
                        "source": pdf_url,
                    }
                )
    except Exception as exc:
        logger.warning("[BAMIS][Calendar] PDF parse failed (%s): %s", pdf_url, exc)

    return rows


def scrape_crop_calendars() -> pd.DataFrame:
    """Scrape crop calendars from BAMIS.

    URL: https://www.bamis.gov.bd/

    Returns:
        DataFrame with columns: [Crop, District, Operation,
                                 Month, Week, source]
    """
    calendar_url = urljoin(BAMIS_BASE_URL, "/en/calendar/")
    session = requests.Session()

    try:
        html = _fetch_html(calendar_url, session=session)
        soup = BeautifulSoup(html, "html.parser")
    except Exception as exc:
        logger.warning("[BAMIS][Calendar] Failed to fetch root calendar page: %s", exc)
        return _empty_calendar_df()

    crop_links: List[Dict[str, str]] = []

    # Strategy A: direct crop links pattern /calendar/<lang_or_id>/<crop_id>
    for a in soup.select("a[href]"):
        href = urljoin(calendar_url, a.get("href", ""))
        text = " ".join(a.get_text(" ", strip=True).split())
        if re.search(r"/calendar/\d+/\d+/?$", href):
            crop_links.append({"crop_name": text or "Unknown", "crop_url": href})

    # Strategy B: broader selector fallback for current page content blocks
    if not crop_links:
        for a in soup.select(".entry-content a[href], .layout_details a[href], .menu_block a[href]"):
            href = urljoin(calendar_url, a.get("href", ""))
            text = " ".join(a.get_text(" ", strip=True).split())
            if "/calendar/" in href:
                crop_links.append({"crop_name": text or "Unknown", "crop_url": href})

    # De-dup by URL
    dedup: Dict[str, Dict[str, str]] = {}
    for item in crop_links:
        dedup[item["crop_url"]] = item
    crop_links = list(dedup.values())

    logger.info("[BAMIS][Calendar] crop links found: %d", len(crop_links))

    if not crop_links:
        logger.warning("[BAMIS][Calendar] No crop links found. Page structure likely changed.")
        return _empty_calendar_df()

    rows: List[Dict[str, str]] = []
    # Keep runtime practical for CI/Colab while still scraping real data.
    max_crop_pages = 3

    for item in crop_links[:max_crop_pages]:
        crop_url = item["crop_url"]
        crop_name = item.get("crop_name", "Unknown")

        try:
            crop_html = _fetch_html(crop_url, session=session)
            crop_soup = BeautifulSoup(crop_html, "html.parser")
        except Exception as exc:
            logger.warning("[BAMIS][Calendar] Failed crop page %s: %s", crop_url, exc)
            continue

        # Strategy A: district-specific links like /calendar/1/69/5/
        district_urls: Set[str] = set()
        for a in crop_soup.select("a[href]"):
            href = urljoin(crop_url, a.get("href", ""))
            if re.search(r"/calendar/\d+/\d+/\d+/?$", href):
                district_urls.add(href)

        # If none found, process crop page itself (some crop pages may already be district-level)
        if not district_urls:
            district_urls.add(crop_url)

        for d_url in sorted(district_urls)[:2]:
            try:
                d_html = _fetch_html(d_url, session=session)
                d_soup = BeautifulSoup(d_html, "html.parser")
                title = d_soup.title.get_text(" ", strip=True) if d_soup.title else ""
                title_data = _extract_crop_district_from_title(title)

                district = title_data.get("district", "Unknown")
                crop = title_data.get("crop", crop_name if crop_name else "Unknown")

                # Strategy 1: parse calendar PDF link(s)
                pdf_links: List[str] = []
                for a in d_soup.select("a[href]"):
                    href = urljoin(d_url, a.get("href", ""))
                    if "/res/public/calendars/" in href.lower() and href.lower().endswith(".pdf"):
                        pdf_links.append(href)

                pdf_links = sorted(set(pdf_links))
                if pdf_links:
                    for pdf_url in pdf_links[:1]:
                        rows.extend(_parse_calendar_pdf(pdf_url=pdf_url, crop=crop, district=district, session=session))
                else:
                    # Strategy 2: fallback parse visible page text (if any)
                    page_text = d_soup.get_text("\n", strip=True)
                    parsed_rows = _extract_calendar_rows_from_text(
                        crop=crop,
                        district=district,
                        text=page_text,
                        source_url=d_url,
                    )
                    rows.extend(parsed_rows)

            except Exception as exc:
                logger.warning("[BAMIS][Calendar] Failed district page %s: %s", d_url, exc)

    if not rows:
        logger.warning(
            "[BAMIS][Calendar] No operation/month rows could be parsed. "
            "Returning empty schema frame; website structure/content likely changed."
        )
        return _empty_calendar_df()

    out = pd.DataFrame(rows)
    out = out.drop_duplicates().reset_index(drop=True)

    # Ensure exact schema order
    for c in CALENDAR_SCHEMA:
        if c not in out.columns:
            out[c] = ""

    return out[CALENDAR_SCHEMA]


def scrape_bamis_bulletins(max_pages: int = 25) -> pd.DataFrame:
    """Scrape latest weekly bulletins.

    Returns:
        DataFrame with bulletin metadata.
    """
    seed_urls = [
        urljoin(BAMIS_BASE_URL, "/bulletin/special/current/"),
        urljoin(BAMIS_BASE_URL, "/page/project-publication/"),
        urljoin(BAMIS_BASE_URL, "/page/others-publication/"),
        BAMIS_BASE_URL,
    ]

    session = requests.Session()
    queue = list(dict.fromkeys(seed_urls))
    visited: Set[str] = set()
    records: List[Dict[str, str]] = []

    while queue and len(visited) < max_pages:
        page_url = queue.pop(0)
        if page_url in visited:
            continue
        visited.add(page_url)

        try:
            html = _fetch_html(page_url, session=session)
            soup = BeautifulSoup(html, "html.parser")
        except Exception as exc:
            logger.warning("[BAMIS][Bulletins] Failed page %s: %s", page_url, exc)
            continue

        # Strategy 1: detect PDF links as bulletin candidates
        for a in soup.select("a[href]"):
            href = urljoin(page_url, a.get("href", ""))
            text = " ".join(a.get_text(" ", strip=True).split())
            low = (href + " " + text).lower()

            page_hint = any(k in page_url.lower() for k in ["bulletin", "publication", "advisory", "forecast"])
            if href.lower().endswith(".pdf") and (
                page_hint
                or any(k in low for k in ["bulletin", "advisory", "special", "forecast", "weather", "drought"])
                or text.strip() == ""
            ):
                published_date = ""
                m = re.search(r"/(20\d{2})/(\d{2})/(\d{2})/", href)
                if m:
                    published_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

                records.append(
                    {
                        "title": text,
                        "bulletin_url": href,
                        "published_date": published_date,
                        "source_page": page_url,
                        "source": "https://www.bamis.gov.bd/",
                    }
                )

        # Strategy 2: follow likely bulletin/publication pages
        for a in soup.select("a[href]"):
            href = urljoin(page_url, a.get("href", ""))
            if not href.startswith(BAMIS_BASE_URL):
                continue
            low = href.lower()
            if any(k in low for k in ["bulletin", "publication", "advisory", "forecast", "page/", "category/"]):
                if href not in visited and href not in queue:
                    queue.append(href)

    if not records:
        logger.warning("[BAMIS][Bulletins] No bulletin PDFs found. Site structure may have changed.")
        return pd.DataFrame(columns=["title", "bulletin_url", "published_date", "source_page", "source"])

    df = pd.DataFrame(records).drop_duplicates(subset=["bulletin_url"]).reset_index(drop=True)
    return df


def download_weekly_bulletins(
    index_url_suffix: str = "", out_dir: str = "bamis_bulletins", max_files: int = 5
) -> pd.DataFrame:
    """Download weekly bulletin PDFs from BAMIS index page.

    Backward-compatible helper built on top of scrape_bamis_bulletins().
    """
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    meta = scrape_bamis_bulletins(max_pages=20)
    if meta.empty:
        return _standardize(pd.DataFrame(columns=["file_path", "url", "title", "published_date"]), "bamis_pdf_extraction")

    downloaded: List[Dict[str, str]] = []
    session = requests.Session()

    for _, row in meta.head(max_files).iterrows():
        pdf_url = row.get("bulletin_url", "")
        if not pdf_url:
            continue

        try:
            content = _fetch_bytes(pdf_url, session=session)
            filename = pdf_url.split("/")[-1] or f"bulletin_{len(downloaded)+1}.pdf"
            file_path = out_path / filename
            file_path.write_bytes(content)

            downloaded.append(
                {
                    "file_path": str(file_path),
                    "url": pdf_url,
                    "title": row.get("title", ""),
                    "published_date": row.get("published_date", ""),
                }
            )
        except Exception as exc:
            logger.warning("[BAMIS][Bulletins] Download failed for %s: %s", pdf_url, exc)

    if not downloaded:
        return _standardize(pd.DataFrame(columns=["file_path", "url", "title", "published_date"]), "bamis_pdf_extraction")

    return _standardize(pd.DataFrame(downloaded), "bamis_pdf_extraction")


def extract_pdf_text(pdf_path: str, max_pages: Optional[int] = None) -> pd.DataFrame:
    """Extract text from BAMIS bulletin PDF into structured rows.

    Returns one row per page for traceability.
    """
    rows: List[Dict[str, object]] = []

    try:
        with pdfplumber.open(pdf_path) as pdf:
            total_pages = len(pdf.pages)
            limit = min(total_pages, max_pages) if max_pages else total_pages

            for idx in range(limit):
                page_num = idx + 1
                text = pdf.pages[idx].extract_text() or ""
                rows.append(
                    {
                        "pdf_path": pdf_path,
                        "page": page_num,
                        "text": text.strip(),
                        "char_count": len(text),
                    }
                )

        return _standardize(pd.DataFrame(rows), "bamis_pdf_extraction")
    except Exception as exc:
        logger.exception("PDF extraction failed for %s: %s", pdf_path, exc)
        return _standardize(pd.DataFrame(columns=["pdf_path", "page", "text", "char_count"]), "bamis_pdf_extraction")
