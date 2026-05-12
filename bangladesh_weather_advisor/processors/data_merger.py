"""Merge dynamic indicators with static context layers."""

from __future__ import annotations

import logging
from typing import Iterable, List

import pandas as pd

from production_pipeline.config import CURRENT_DATE, CURRENT_UTC, LOG_LEVEL

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


def merge_static_dynamic(
    dynamic_df: pd.DataFrame,
    static_frames: Iterable[pd.DataFrame],
    key_col: str = "district_id",
) -> pd.DataFrame:
    """Merge dynamic indicators with one or more static DataFrames.

    Args:
        dynamic_df: Time-varying metrics (rainfall, NDVI, SPI, etc.).
        static_frames: Static datasets (boundaries, MAPSPAM, SoilGrids).
        key_col: Join key (canonical district identifier).

    Returns:
        Single merged DataFrame with metadata stamps.
    """
    if key_col not in dynamic_df.columns:
        raise ValueError(f"dynamic_df missing key column '{key_col}'")

    merged = dynamic_df.copy()
    for idx, sdf in enumerate(static_frames, start=1):
        if key_col not in sdf.columns:
            logger.warning("Skipping static frame #%d without key_col '%s'", idx, key_col)
            continue

        static_cols = [c for c in sdf.columns if c not in {"source", "extraction_date", "ingested_at_utc"}]
        logger.info("Merging static frame #%d with %d columns", idx, len(static_cols))
        merged = merged.merge(sdf[static_cols].drop_duplicates(subset=[key_col]), on=key_col, how="left")

    merged["source"] = "processor_data_merger"
    merged["extraction_date"] = CURRENT_DATE.date().isoformat()
    merged["ingested_at_utc"] = CURRENT_UTC.isoformat()

    if "record_date" in merged.columns:
        dupes = merged.duplicated(subset=[key_col, "record_date"]).sum()
        if dupes:
            logger.warning("Detected %d duplicate rows on (%s, record_date)", dupes, key_col)
            merged = merged.drop_duplicates(subset=[key_col, "record_date"], keep="last")

    return merged
