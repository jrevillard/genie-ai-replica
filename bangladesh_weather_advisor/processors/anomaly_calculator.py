"""Anomaly calculators for rainfall, soil moisture, and NDVI."""

from __future__ import annotations

import logging
from typing import List

import numpy as np
import pandas as pd

from production_pipeline.config import CURRENT_DATE, CURRENT_UTC, LOG_LEVEL

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


def _meta(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["extraction_date"] = CURRENT_DATE.date().isoformat()
    out["ingested_at_utc"] = CURRENT_UTC.isoformat()
    return out


def compute_anomaly(
    current_df: pd.DataFrame,
    baseline_df: pd.DataFrame,
    key_cols: List[str],
    metric_col: str,
    baseline_mean_col: str = "baseline_mean",
    baseline_std_col: str = "baseline_std",
    output_prefix: str = "",
) -> pd.DataFrame:
    """Compute absolute, percent, and standardized anomalies."""
    req_current = set(key_cols + [metric_col])
    req_base = set(key_cols + [baseline_mean_col, baseline_std_col])
    m1 = req_current - set(current_df.columns)
    m2 = req_base - set(baseline_df.columns)
    if m1 or m2:
        raise ValueError(f"Missing columns current={sorted(m1)} baseline={sorted(m2)}")

    logger.info("Computing anomaly for metric=%s", metric_col)
    merged = current_df.merge(baseline_df[key_cols + [baseline_mean_col, baseline_std_col]], on=key_cols, how="left")

    pre = f"{output_prefix}_" if output_prefix else ""
    merged[f"{pre}anomaly_abs"] = merged[metric_col] - merged[baseline_mean_col]
    merged[f"{pre}anomaly_pct"] = np.where(
        merged[baseline_mean_col].abs() > 1e-9,
        (merged[f"{pre}anomaly_abs"] / merged[baseline_mean_col]) * 100.0,
        np.nan,
    )
    merged[f"{pre}anomaly_z"] = np.where(
        merged[baseline_std_col].abs() > 1e-9,
        merged[f"{pre}anomaly_abs"] / merged[baseline_std_col],
        np.nan,
    )
    merged[f"{pre}quality_flag"] = np.where(merged[baseline_mean_col].isna(), "MISSING_BASELINE", "OK")

    return _meta(merged)


def compute_rainfall_anomaly(current_df: pd.DataFrame, baseline_df: pd.DataFrame) -> pd.DataFrame:
    return compute_anomaly(
        current_df=current_df,
        baseline_df=baseline_df,
        key_cols=["district_id"],
        metric_col="rainfall_mm",
        output_prefix="rainfall",
    )


def compute_soil_moisture_anomaly(current_df: pd.DataFrame, baseline_df: pd.DataFrame) -> pd.DataFrame:
    return compute_anomaly(
        current_df=current_df,
        baseline_df=baseline_df,
        key_cols=["district_id"],
        metric_col="soil_moisture_m3_m3",
        output_prefix="soil_moisture",
    )


def compute_ndvi_anomaly(current_df: pd.DataFrame, baseline_df: pd.DataFrame) -> pd.DataFrame:
    return compute_anomaly(
        current_df=current_df,
        baseline_df=baseline_df,
        key_cols=["district_id"],
        metric_col="ndvi",
        output_prefix="ndvi",
    )
