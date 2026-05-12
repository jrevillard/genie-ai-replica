"""
Production-ready SPI / SPEI calculator.

Methodology
-----------
* SPI (Standardised Precipitation Index) – McKee et al. 1993
  1. Accumulate rainfall over rolling windows (30, 90, 180 days).
  2. Per district + day-of-year bin, fit a Gamma distribution to the
     historical accumulated totals.
  3. Transform via the fitted CDF → inverse-normal → z-score = SPI.

* SPEI (Standardised Precipitation-Evapotranspiration Index) – Vicente-Serrano 2010
  Identical workflow but on water-balance (P − |ET|) instead of P alone.
  A log-logistic distribution is standard; we use Gamma on shifted values
  (robust and simpler – widely accepted for operational use).

Drought classification (WMO standard):
  SPI/SPEI ≥  2.0  → Extremely Wet
         1.5–2.0   → Very Wet
         1.0–1.5   → Moderately Wet
        -1.0–1.0   → Near Normal
        -1.5–-1.0  → Moderately Dry
        -2.0–-1.5  → Severely Dry
        ≤ -2.0     → Extremely Dry

Data contract (inputs)
----------------------
Historical daily rainfall  : district_id, district_name, date, rainfall_mm
Historical daily ERA5      : district_id, district_name, date, temperature_c, evaporation_mm
                             (ERA5 evaporation is *negative* by convention; we take abs())

Climatology (optional, used for QC only):
  CHIRPS climatology : district_id, day_of_year, mean_mm, std_mm, …
  ERA5 climatology   : district_id, day_of_year, temperature_c_mean, evaporation_mm_mean, …

Data contract (outputs)
-----------------------
SPI CSV  : district_id, district_name, date, spi_1, spi_3, spi_6,
           drought_class_1, drought_class_3, drought_class_6, quality_flag,
           source, extraction_date, ingested_at_utc
SPEI CSV : same but spei_1 … spei_6
"""

from __future__ import annotations

import logging
import warnings
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

try:
    from scipy.stats import gamma as gamma_dist
    from scipy.stats import norm as norm_dist
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

WINDOWS = {"1": 30, "3": 90, "6": 180}  # label → rolling days

DROUGHT_CLASSES: List[Tuple[float, float, str]] = [
    (2.0,   np.inf,  "Extremely Wet"),
    (1.5,   2.0,     "Very Wet"),
    (1.0,   1.5,     "Moderately Wet"),
    (-1.0,  1.0,     "Near Normal"),
    (-1.5, -1.0,     "Moderately Dry"),
    (-2.0, -1.5,     "Severely Dry"),
    (-np.inf, -2.0,  "Extremely Dry"),
]

# DOY bin width for gamma fitting – 15-day bins give ~24 bins/year
# (enough historical samples per bin while staying seasonally coherent)
DOY_BIN_WIDTH = 15

# Minimum number of valid years required in a DOY bin to attempt gamma fit
MIN_YEARS_FOR_FIT = 3

# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def classify_drought(value: float) -> str:
    """Map an SPI/SPEI value to WMO drought class."""
    if pd.isna(value):
        return "Insufficient Data"
    for lo, hi, label in DROUGHT_CLASSES:
        if lo <= value < hi:
            return label
    return "Near Normal"


def _doy_bin(doy: int, width: int = DOY_BIN_WIDTH) -> int:
    """Assign day-of-year to a bin index (0-based)."""
    return (doy - 1) // width


def _rolling_sum(series: pd.Series, window: int) -> pd.Series:
    """Rolling sum with min_periods = window (strict – no partial windows)."""
    return series.rolling(window=window, min_periods=window).sum()


def _normalize_windows(
    windows: Optional[Union[List[int], Dict[Union[int, str], Union[int, str]]]],
    metric_prefix: str,
) -> Dict[str, int]:
    """Normalize windows into internal {label: days} format.

    Accepted user inputs:
      - None -> defaults to 30/90/180-day windows
      - list[int] -> e.g. [30, 90, 180]
      - dict[str, int] -> e.g. {"1": 30, "3": 90}
      - dict[int, str] -> e.g. {30: "spi_1", 90: "spi_3"}
    """
    default_days = [30, 90, 180]
    day_to_label = {30: "1", 90: "3", 180: "6", 365: "12"}

    if windows is None:
        days_list = default_days
        return {day_to_label.get(d, f"{d}d"): d for d in days_list}

    # list[int] format -> convert to internal labels
    if isinstance(windows, list):
        return {day_to_label.get(int(d), f"{int(d)}d"): int(d) for d in windows}

    if not isinstance(windows, dict):
        raise TypeError(
            "windows must be None, a list of day windows, or a dict mapping "
            "either label->days or days->metric_name"
        )

    normalized: Dict[str, int] = {}
    for k, v in windows.items():
        # label -> days (existing internal format)
        if isinstance(v, (int, np.integer)):
            normalized[str(k)] = int(v)
            continue

        # days -> metric name (requested external format)
        if isinstance(k, (int, np.integer)):
            days = int(k)
            # Prefer extracting suffix from explicit metric name when available.
            if isinstance(v, str) and v.startswith(f"{metric_prefix}_"):
                label = v.split(f"{metric_prefix}_", 1)[1]
            else:
                label = day_to_label.get(days, f"{days}d")
            normalized[str(label)] = days
            continue

        raise TypeError(
            "Unsupported windows dict entry. Use label->days (e.g. {'3': 90}) "
            f"or days->{metric_prefix}_label (e.g. {{90: '{metric_prefix}_3'}})."
        )

    return normalized


# ---------------------------------------------------------------------------
#  Gamma-CDF → normal z-score transform  (core SPI maths)
# ---------------------------------------------------------------------------

def _gamma_zscore(
    accumulated: np.ndarray,
    historical_accum: np.ndarray,
) -> np.ndarray:
    """
    Fit Gamma to *historical_accum*, then transform *accumulated* to z-scores.

    If scipy is unavailable or the fit fails, falls back to simple z-score.
    """
    # Remove NaN / non-positive for fitting
    valid = historical_accum[np.isfinite(historical_accum) & (historical_accum > 0)]

    if len(valid) < MIN_YEARS_FOR_FIT:
        return np.full_like(accumulated, np.nan, dtype=float)

    # --- Gamma fit ---
    if HAS_SCIPY:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                # MLE fit; floc=0 forces location parameter to 0 (standard for SPI)
                alpha, loc, beta = gamma_dist.fit(valid, floc=0)
                if alpha <= 0 or beta <= 0:
                    raise ValueError("Non-positive shape/scale")

            # Proportion of zeros in historical record
            q_zero = np.sum(historical_accum == 0) / len(historical_accum)

            result = np.full_like(accumulated, np.nan, dtype=float)
            for i, val in enumerate(accumulated):
                if np.isnan(val):
                    continue
                if val <= 0:
                    # Probability assigned to zero class
                    prob = q_zero
                else:
                    prob = q_zero + (1 - q_zero) * gamma_dist.cdf(val, alpha, loc=0, scale=beta)
                # Clamp to avoid ±inf from norm.ppf
                prob = np.clip(prob, 1e-6, 1 - 1e-6)
                result[i] = norm_dist.ppf(prob)
            return result

        except Exception:
            pass  # fall through to simple z-score

    # --- Fallback: simple z-score ---
    mean = np.nanmean(valid)
    std = np.nanstd(valid, ddof=1)
    if std == 0 or np.isnan(std):
        return np.full_like(accumulated, np.nan, dtype=float)
    return (accumulated - mean) / std


# ---------------------------------------------------------------------------
#  Core computation engines
# ---------------------------------------------------------------------------

def compute_spi(
    daily_rain: pd.DataFrame,
    windows: Optional[Union[List[int], Dict[Union[int, str], Union[int, str]]]] = None,
    return_latest_only: bool = False,
) -> pd.DataFrame:
    """
    Compute SPI for multiple windows from historical daily rainfall.

    Parameters
    ----------
    daily_rain : DataFrame
        Columns: district_id, district_name, date, rainfall_mm
        Must contain the full historical record (≥ 2 years recommended).
    windows : list or dict, optional
        Supported formats:
        - list[int]: [30, 90, 180]
        - dict[label, days]: {"1": 30, "3": 90, "6": 180}
        - dict[days, metric_name]: {30: "spi_1", 90: "spi_3", 180: "spi_6"}
        Defaults to 30/90/180-day windows.
    return_latest_only : bool, optional
        If True, return only the latest date per district.
        If False (default), return full time series.

    Returns
    -------
    DataFrame with columns:
        district_id, district_name, date,
        spi_1, spi_3, spi_6,
        drought_class_1, drought_class_3, drought_class_6,
        quality_flag, source, extraction_date, ingested_at_utc.
        Returns full time series by default, or latest-per-district rows when
        ``return_latest_only=True``.
    """
    windows = _normalize_windows(windows, metric_prefix="spi")
    df = daily_rain.copy()

    # ---- Validate ----
    required = {"district_id", "district_name", "date", "rainfall_mm"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns in daily rainfall: {sorted(missing)}")

    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["district_id", "date"]).reset_index(drop=True)

    # Ensure no negative rainfall
    df["rainfall_mm"] = df["rainfall_mm"].clip(lower=0)

    mode = "latest-only" if return_latest_only else "full-time-series"
    logger.info(
        "Computing SPI in %s mode: %d rows, %d districts, windows=%s",
        mode, len(df), df["district_id"].nunique(), list(windows.keys()),
    )

    # ---- Rolling sums per district ----
    for label, days in windows.items():
        col = f"accum_{label}"
        df[col] = df.groupby("district_id")["rainfall_mm"].transform(
            lambda s: _rolling_sum(s, days)
        )

    # ---- Add DOY bin ----
    df["doy"] = df["date"].dt.dayofyear
    df["doy_bin"] = df["doy"].apply(_doy_bin)

    # ---- Gamma fit per district × DOY-bin ----
    for label, days in windows.items():
        accum_col = f"accum_{label}"
        spi_col = f"spi_{label}"
        df[spi_col] = np.nan

        for (did, dbin), grp in df.groupby(["district_id", "doy_bin"]):
            hist_vals = grp[accum_col].values
            z = _gamma_zscore(hist_vals, hist_vals)
            df.loc[grp.index, spi_col] = z

    # ---- Drought classification ----
    for label in windows:
        df[f"drought_class_{label}"] = df[f"spi_{label}"].apply(classify_drought)

    # ---- Quality flag ----
    spi_cols = [f"spi_{label}" for label in windows]
    df["quality_flag"] = np.where(
        df[spi_cols].isna().all(axis=1), "INSUFFICIENT_DATA",
        np.where(df[spi_cols].isna().any(axis=1), "PARTIAL", "OK")
    )

    # ---- Clean up working columns ----
    drop_cols = [f"accum_{l}" for l in windows] + ["doy", "doy_bin"]
    df = df.drop(columns=drop_cols, errors="ignore")

    # ---- Metadata ----
    df["source"] = "processor_spi_gamma"
    df["extraction_date"] = _today_iso()
    df["ingested_at_utc"] = _now_utc()

    logger.info(
        "SPI computation complete before output filtering: %d rows, quality distribution:\n%s",
        len(df),
        df["quality_flag"].value_counts().to_string(),
    )

    if return_latest_only:
        latest_date = df["date"].max()
        df = (
            df.sort_values(["district_id", "date"])
            .groupby("district_id", as_index=False)
            .tail(1)
            .reset_index(drop=True)
        )
        logger.info(
            "SPI filtered to latest date per district (global max date=%s): %d rows (%d districts)",
            latest_date,
            len(df),
            df["district_id"].nunique(),
        )
    else:
        logger.info("SPI returning full time series: %d rows", len(df))

    return df


def compute_spei(
    daily_rain: pd.DataFrame,
    daily_era5: pd.DataFrame,
    windows: Optional[Union[List[int], Dict[Union[int, str], Union[int, str]]]] = None,
    return_latest_only: bool = False,
) -> pd.DataFrame:
    """
    Compute SPEI for multiple windows from rainfall + evapotranspiration.

    Parameters
    ----------
    daily_rain : DataFrame
        Columns: district_id, district_name, date, rainfall_mm
    daily_era5 : DataFrame
        Columns: district_id, district_name, date, temperature_c, evaporation_mm
        NOTE: ERA5 evaporation is negative by convention; we take abs().
    windows : list or dict, optional
        Supported formats:
        - list[int]: [30, 90, 180]
        - dict[label, days]: {"1": 30, "3": 90, "6": 180}
        - dict[days, metric_name]: {30: "spei_1", 90: "spei_3", 180: "spei_6"}
    return_latest_only : bool, optional
        If True, return only the latest date per district.
        If False (default), return full time series.

    Returns
    -------
    DataFrame with spei_1, spei_3, spei_6, drought classes, quality flag.
    Returns full time series by default, or latest-per-district rows when
    ``return_latest_only=True``.
    """
    windows = _normalize_windows(windows, metric_prefix="spei")

    # ---- Validate ----
    rain_req = {"district_id", "date", "rainfall_mm"}
    era5_req = {"district_id", "date", "evaporation_mm"}
    if rain_req - set(daily_rain.columns):
        raise ValueError(f"Rain missing: {rain_req - set(daily_rain.columns)}")
    if era5_req - set(daily_era5.columns):
        raise ValueError(f"ERA5 missing: {era5_req - set(daily_era5.columns)}")

    rain = daily_rain[["district_id", "district_name", "date", "rainfall_mm"]].copy()
    era5 = daily_era5[["district_id", "date", "evaporation_mm"]].copy()

    rain["date"] = pd.to_datetime(rain["date"])
    era5["date"] = pd.to_datetime(era5["date"])

    # Merge on district_id + date
    df = rain.merge(era5, on=["district_id", "date"], how="inner")
    mode = "latest-only" if return_latest_only else "full-time-series"
    logger.info(
        "SPEI merge in %s mode: rain=%d, era5=%d → merged=%d",
        mode,
        len(rain),
        len(era5),
        len(df),
    )

    if df.empty:
        raise ValueError("No matching district_id + date rows between rain and ERA5")

    # ---- Water balance: P - |ET| ----
    df["rainfall_mm"] = df["rainfall_mm"].clip(lower=0)
    df["et_mm"] = df["evaporation_mm"].abs()  # ERA5 convention: negative = evaporation
    df["water_balance"] = df["rainfall_mm"] - df["et_mm"]

    df = df.sort_values(["district_id", "date"]).reset_index(drop=True)

    # ---- Rolling sums ----
    for label, days in windows.items():
        col = f"wb_accum_{label}"
        df[col] = df.groupby("district_id")["water_balance"].transform(
            lambda s: _rolling_sum(s, days)
        )

    # ---- DOY bin ----
    df["doy"] = df["date"].dt.dayofyear
    df["doy_bin"] = df["doy"].apply(_doy_bin)

    # ---- Gamma fit on shifted water balance (shift to make all positive) ----
    for label, days in windows.items():
        accum_col = f"wb_accum_{label}"
        spei_col = f"spei_{label}"
        df[spei_col] = np.nan

        for (did, dbin), grp in df.groupby(["district_id", "doy_bin"]):
            hist_vals = grp[accum_col].values
            # Shift to positive domain for Gamma fitting
            shift = 0.0
            finite = hist_vals[np.isfinite(hist_vals)]
            if len(finite) > 0 and finite.min() <= 0:
                shift = abs(finite.min()) + 1.0
            shifted_hist = hist_vals + shift
            shifted_current = hist_vals + shift
            z = _gamma_zscore(shifted_current, shifted_hist)
            df.loc[grp.index, spei_col] = z

    # ---- Drought classification ----
    for label in windows:
        df[f"drought_class_{label}"] = df[f"spei_{label}"].apply(classify_drought)

    # ---- Quality flag ----
    spei_cols = [f"spei_{label}" for label in windows]
    df["quality_flag"] = np.where(
        df[spei_cols].isna().all(axis=1), "INSUFFICIENT_DATA",
        np.where(df[spei_cols].isna().any(axis=1), "PARTIAL", "OK")
    )

    # ---- Clean up ----
    drop_cols = (
        [f"wb_accum_{l}" for l in windows]
        + ["doy", "doy_bin", "et_mm", "water_balance", "evaporation_mm"]
    )
    df = df.drop(columns=drop_cols, errors="ignore")

    df["source"] = "processor_spei_gamma"
    df["extraction_date"] = _today_iso()
    df["ingested_at_utc"] = _now_utc()

    logger.info("SPEI computation complete before output filtering: %d rows", len(df))

    if return_latest_only:
        latest_date = df["date"].max()
        df = (
            df.sort_values(["district_id", "date"])
            .groupby("district_id", as_index=False)
            .tail(1)
            .reset_index(drop=True)
        )
        logger.info(
            "SPEI filtered to latest date per district (global max date=%s): %d rows (%d districts)",
            latest_date,
            len(df),
            df["district_id"].nunique(),
        )
    else:
        logger.info("SPEI returning full time series: %d rows", len(df))

    return df


# ---------------------------------------------------------------------------
#  Convenience: extract only the latest N days of results
# ---------------------------------------------------------------------------

def extract_recent(
    df: pd.DataFrame,
    days: int = 90,
    date_col: str = "date",
) -> pd.DataFrame:
    """Return only the most recent *days* of computed indices."""
    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col])
    cutoff = df[date_col].max() - pd.Timedelta(days=days)
    return df[df[date_col] >= cutoff].reset_index(drop=True)


# ---------------------------------------------------------------------------
#  Backward-compatible wrappers (used by MVP_11_Sources_Test.ipynb)
# ---------------------------------------------------------------------------

def calculate_spi(
    df: pd.DataFrame,
    value_col: str = "rainfall_mm",
    group_cols=None,
    window: int = 3,
    min_periods: int = 6,
) -> pd.DataFrame:
    """Legacy wrapper – simple rolling z-score SPI for quick tests."""
    group_cols = group_cols or ["district_id"]
    work = df.copy()
    work = work.sort_values(group_cols)
    work["rolling_precip"] = work.groupby(group_cols)[value_col].transform(
        lambda s: s.rolling(window=window, min_periods=1).sum()
    )

    def _zscore_group(g):
        g = g.copy()
        if len(g) < min_periods:
            g["spi"] = np.nan
            g["quality_flag"] = "LOW_HISTORY"
            return g
        mean = g["rolling_precip"].mean()
        std = g["rolling_precip"].std(ddof=0)
        if std == 0 or pd.isna(std):
            g["spi"] = np.nan
        else:
            g["spi"] = (g["rolling_precip"] - mean) / std
        g["quality_flag"] = "OK"
        return g

    out = work.groupby(group_cols, group_keys=False).apply(_zscore_group)
    out["source"] = "processor_spi_legacy"
    out["extraction_date"] = _today_iso()
    out["ingested_at_utc"] = _now_utc()
    return out


def calculate_spei(
    df: pd.DataFrame,
    precip_col: str = "rainfall_mm",
    pet_col: str = "evaporation_mm",
    group_cols=None,
    window: int = 3,
) -> pd.DataFrame:
    """Legacy wrapper – simple rolling z-score SPEI for quick tests."""
    group_cols = group_cols or ["district_id"]
    work = df.copy()
    work["water_balance"] = work[precip_col] - work[pet_col].abs()
    work["rolling_wb"] = work.groupby(group_cols)["water_balance"].transform(
        lambda s: s.rolling(window=window, min_periods=1).sum()
    )

    def _zscore_group(g):
        g = g.copy()
        mean = g["rolling_wb"].mean()
        std = g["rolling_wb"].std(ddof=0)
        if std == 0 or pd.isna(std):
            g["spei"] = np.nan
        else:
            g["spei"] = (g["rolling_wb"] - mean) / std
        g["quality_flag"] = "OK"
        return g

    out = work.groupby(group_cols, group_keys=False).apply(_zscore_group)
    out["source"] = "processor_spei_legacy"
    out["extraction_date"] = _today_iso()
    out["ingested_at_utc"] = _now_utc()
    return out
