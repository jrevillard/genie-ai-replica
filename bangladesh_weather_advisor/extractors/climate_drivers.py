"""Climate driver extractors (ENSO indices).

Scrapes and harmonizes:
- ONI (NOAA CPC)
- SOI (NOAA CPC)
- MEI.v2 (NOAA PSL)
"""

from __future__ import annotations

import logging
import re
import time
from typing import Dict, List, Optional

import pandas as pd
import requests

from production_pipeline.config import (
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

ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
SOI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/soi"
MEI_V2_URL = "https://psl.noaa.gov/enso/mei/data/meiv2.data"

_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
_SEASON_END_MONTH = {
    "DJF": 2,
    "JFM": 3,
    "FMA": 4,
    "MAM": 5,
    "AMJ": 6,
    "MJJ": 7,
    "JJA": 8,
    "JAS": 9,
    "ASO": 10,
    "SON": 11,
    "OND": 12,
    "NDJ": 1,
}


def _fetch_text(url: str) -> str:
    last_exc: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("Fetching climate index URL (attempt %d/%d): %s", attempt, MAX_RETRIES, url)
            r = requests.get(url, headers=DEFAULT_HEADERS, timeout=REQUEST_TIMEOUT_SEC)
            r.raise_for_status()
            return r.text
        except Exception as exc:
            last_exc = exc
            delay = RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
            logger.warning("Request failed for %s: %s. Sleeping %.1fs", url, exc, delay)
            time.sleep(delay)

    raise RuntimeError(f"Unable to fetch {url}: {last_exc}")


def _parse_oni() -> pd.DataFrame:
    text = _fetch_text(ONI_URL)
    rows: List[Dict[str, object]] = []

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("SEAS"):
            continue

        parts = re.split(r"\s+", line)
        if len(parts) < 4:
            continue

        season = parts[0].upper()
        if season not in _SEASON_END_MONTH:
            continue

        try:
            year = int(parts[1])
            oni_val = float(parts[3])
        except ValueError:
            continue

        end_month = _SEASON_END_MONTH[season]
        date_year = year + 1 if season == "NDJ" else year
        rows.append(
            {
                "date": pd.Timestamp(year=date_year, month=end_month, day=1),
                "oni_value": oni_val,
            }
        )

    if not rows:
        raise RuntimeError("ONI parser produced no rows")

    df = pd.DataFrame(rows).drop_duplicates(subset=["date"]).sort_values("date").reset_index(drop=True)
    return df


def _parse_soi() -> pd.DataFrame:
    text = _fetch_text(SOI_URL)
    rows: List[Dict[str, object]] = []

    for line in text.splitlines():
        line = line.strip()
        if not line or not re.match(r"^\d{4}\s+", line):
            continue

        parts = re.split(r"\s+", line)
        if len(parts) < 13:
            continue

        year = int(parts[0])
        monthly = parts[1:13]
        for i, val in enumerate(monthly, start=1):
            try:
                soi_val = float(val)
            except ValueError:
                continue

            rows.append(
                {
                    "date": pd.Timestamp(year=year, month=i, day=1),
                    "soi_value": soi_val,
                }
            )

    if not rows:
        raise RuntimeError("SOI parser produced no rows")

    return pd.DataFrame(rows).drop_duplicates(subset=["date"]).sort_values("date").reset_index(drop=True)


def _parse_mei_v2() -> pd.DataFrame:
    text = _fetch_text(MEI_V2_URL)
    rows: List[Dict[str, object]] = []

    for line in text.splitlines():
        line = line.strip()
        if not line or not re.match(r"^\d{4}\s+", line):
            continue

        parts = re.split(r"\s+", line)
        if len(parts) < 13:
            continue

        year = int(parts[0])
        monthly = parts[1:13]
        for month_idx, val in enumerate(monthly, start=1):
            try:
                mei_val = float(val)
            except ValueError:
                continue

            rows.append(
                {
                    "date": pd.Timestamp(year=year, month=month_idx, day=1),
                    "mei_value": mei_val,
                }
            )

    if not rows:
        raise RuntimeError("MEI.v2 parser produced no rows")

    return pd.DataFrame(rows).drop_duplicates(subset=["date"]).sort_values("date").reset_index(drop=True)


def _classify_oni_phase(v: float) -> str:
    if pd.isna(v):
        return "Unknown"
    if v >= 0.5:
        return "El Nino"
    if v <= -0.5:
        return "La Nina"
    return "Neutral"


def scrape_enso_indices() -> pd.DataFrame:
    """Scrape current ENSO indices from NOAA CPC/PSL.

    Returns recent 12 months with columns:
    [date, oni_value, oni_phase, mei_value, soi_value, source, extraction_date, ingested_at_utc]
    """
    logger.info("Scraping ENSO indices from NOAA sources")

    df_oni = _parse_oni()
    df_soi = _parse_soi()
    df_mei = _parse_mei_v2()

    df = df_oni.merge(df_mei, on="date", how="outer").merge(df_soi, on="date", how="outer")
    df = df.sort_values("date").reset_index(drop=True)

    # Sentinel cleanup used in some NOAA files.
    for c in ["oni_value", "mei_value", "soi_value"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
        df.loc[df[c] <= -99, c] = pd.NA

    # recent 12 months relative to runtime date (exclude future months)
    month_start = pd.Timestamp(CURRENT_DATE.date().replace(day=1))
    cutoff = month_start - pd.DateOffset(months=11)
    df = df[(df["date"] >= cutoff) & (df["date"] <= month_start)].copy()

    if df.empty:
        raise RuntimeError("ENSO merge produced no rows for recent 12 months")

    df["oni_phase"] = df["oni_value"].apply(_classify_oni_phase)
    df["source"] = "noaa_cpc_psl"
    df["extraction_date"] = CURRENT_DATE.date().isoformat()
    df["ingested_at_utc"] = CURRENT_UTC.isoformat()

    out = df[["date", "oni_value", "oni_phase", "mei_value", "soi_value", "source", "extraction_date", "ingested_at_utc"]].copy()
    return out
