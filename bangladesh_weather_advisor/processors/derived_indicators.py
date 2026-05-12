"""Derived indicators: VCI, TCI, and VHI.

Definitions used:
- VCI = 100 * (NDVI - NDVI_min) / (NDVI_max - NDVI_min)
- TCI = 100 * (LST_max - LST) / (LST_max - LST_min)
- VHI = alpha * VCI + (1-alpha) * TCI
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from production_pipeline.config import CURRENT_DATE, CURRENT_UTC, LOG_LEVEL

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


def _safe_scale(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return np.where(denominator.abs() > 1e-9, (numerator / denominator) * 100.0, np.nan)


def _clip_0_100(series: pd.Series) -> pd.Series:
    return pd.Series(series).clip(lower=0, upper=100)


def add_vci(
    df: pd.DataFrame,
    ndvi_col: str = "ndvi",
    ndvi_min_col: str = "ndvi_min",
    ndvi_max_col: str = "ndvi_max",
) -> pd.DataFrame:
    logger.info("Computing VCI")
    out = df.copy()
    out["vci"] = _safe_scale(out[ndvi_col] - out[ndvi_min_col], out[ndvi_max_col] - out[ndvi_min_col])
    out["vci"] = _clip_0_100(out["vci"])
    return out


def add_tci(
    df: pd.DataFrame,
    temp_col: str = "temperature_c",
    temp_min_col: str = "temperature_min_c",
    temp_max_col: str = "temperature_max_c",
) -> pd.DataFrame:
    logger.info("Computing TCI")
    out = df.copy()
    out["tci"] = _safe_scale(out[temp_max_col] - out[temp_col], out[temp_max_col] - out[temp_min_col])
    out["tci"] = _clip_0_100(out["tci"])
    return out


def add_vhi(df: pd.DataFrame, alpha: float = 0.5) -> pd.DataFrame:
    logger.info("Computing VHI with alpha=%.2f", alpha)
    out = df.copy()
    if "vci" not in out.columns or "tci" not in out.columns:
        raise ValueError("Columns 'vci' and 'tci' are required before VHI computation.")
    out["vhi"] = alpha * out["vci"] + (1.0 - alpha) * out["tci"]
    out["vhi"] = _clip_0_100(out["vhi"])
    out["source"] = "processor_derived_indicators"
    out["extraction_date"] = CURRENT_DATE.date().isoformat()
    out["ingested_at_utc"] = CURRENT_UTC.isoformat()
    out["indicator_quality"] = np.where(out[["vci", "tci"]].isna().any(axis=1), "PARTIAL", "OK")
    return out


def compute_all(df: pd.DataFrame, alpha: float = 0.5) -> pd.DataFrame:
    """Convenience wrapper for VCI -> TCI -> VHI."""
    return add_vhi(add_tci(add_vci(df)), alpha=alpha)
