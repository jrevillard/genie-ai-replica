import pandas as pd

from utils.utils import THRESHOLDS, BandResult


def classify_band(band: str, value: float | None) -> BandResult:
    thresh = THRESHOLDS.get(band)

    if value is None or pd.isna(value):
        return BandResult(
            band=band, value=None, flag=0, status="NO DATA", pct_of_threshold=None
        )

    flag = int(value < thresh.alert_thresh)
    pct = round((value / thresh.alert_thresh) * 100, 1)
    return BandResult(
        band=band,
        value=value,
        flag=flag,
        status="BELOW THRESHOLD" if flag else "✓ NORMAL",
        pct_of_threshold=pct,
    )


def classify_drought(score: int) -> str:
    if score >= 4:
        return "SEVERE"
    elif score >= 3:
        return "MODERATE"
    elif score >= 2:
        return "WATCH"
    else:
        return "NORMAL"
