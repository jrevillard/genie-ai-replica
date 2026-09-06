from datetime import datetime, timedelta

import ee
import pandas as pd

from drought_classify.classify_drought import classify_band, classify_drought
from utils.helper_functions import (
    make_geometry,
    features_to_df,
    reduce_ndvi,
    reduce_smap,
)
from utils.utils import SMAP_BANDS, ALL_BANDS


def build_scored_daily(df_daily: pd.DataFrame) -> pd.DataFrame:
    """
    Adds per-day drought score + classification.
    """
    rows = []

    for _, row in df_daily.iterrows():
        band_results = {b: classify_band(b, row.get(b)) for b in ALL_BANDS}
        score = sum(r.flag for r in band_results.values())

        rows.append(
            {
                "date": row["date"],
                "drought_score": score,
                "drought_level": classify_drought(score),
                **{b: row.get(b) for b in ALL_BANDS},
            }
        )

    return pd.DataFrame(rows)


def fetch_recent_data(
    bbox: list,
    days: int = 7,
    return_daily: bool = True,
):
    """
    Fetch SMAP + NDVI, compute daily means, classify drought.

    NDVI is assumed already properly scaled and should NOT be modified.
    """

    end_dt = datetime.utcnow()
    start_dt = end_dt - timedelta(days=days)

    start = start_dt.strftime("%Y-%m-%d")
    end = end_dt.strftime("%Y-%m-%d")

    geom = make_geometry(bbox)

    print(f"Fetching SMAP  {start} → {end}")
    smap_features = (
        ee.ImageCollection("NASA/SMAP/SPL4SMGP/008")
        .filterDate(start, end)
        .filterBounds(geom)
        .map(lambda img: reduce_smap(img, geom))
        .getInfo()["features"]
    )
    df_smap = features_to_df(smap_features)

    print(f"Fetching NDVI  {start} → {end}")
    ndvi_features = (
        ee.ImageCollection("NOAA/CDR/VIIRS/NDVI/V1")
        .filterDate(start, end)
        .filterBounds(geom)
        .map(lambda img: reduce_ndvi(img, geom))
        .getInfo()["features"]
    )
    df_ndvi = features_to_df(ndvi_features)

    averages = {}
    daily_df = pd.DataFrame()

    # =========================
    # SMAP PROCESSING (FIXED)
    # =========================
    if not df_smap.empty:

        df_smap[list(SMAP_BANDS)] = df_smap[list(SMAP_BANDS)].apply(
            pd.to_numeric, errors="coerce"
        )

        # ✔ correct daily aggregation (NO extra mean!)
        daily_smap = df_smap.groupby("date")[list(SMAP_BANDS)].mean().reset_index()

        daily_smap_scaled = daily_smap.copy()

        # flux conversion ONLY
        FLUX_BANDS = [
            "land_evapotranspiration_flux",
            "overland_runoff_flux",
        ]

        for b in FLUX_BANDS:
            if b in daily_smap_scaled.columns:
                daily_smap_scaled[b] = daily_smap_scaled[b] * 86400

        # averages
        for b in SMAP_BANDS:
            averages[b] = daily_smap_scaled[b].dropna().mean()

    else:
        daily_smap = pd.DataFrame(columns=list(SMAP_BANDS))
        daily_smap_scaled = daily_smap.copy()
        for b in SMAP_BANDS:
            averages[b] = None

    # =========================
    # NDVI PROCESSING (UNCHANGED)
    # =========================
    if not df_ndvi.empty:

        df_ndvi["NDVI"] = pd.to_numeric(df_ndvi["NDVI"], errors="coerce")
        daily_ndvi = df_ndvi.set_index("date")["NDVI"]

        averages["NDVI"] = daily_ndvi.dropna().mean()

    else:
        daily_ndvi = pd.Series(name="NDVI", dtype="float64")
        averages["NDVI"] = None

    # =========================
    # MERGE DAILY DATA
    # =========================
    if not daily_smap.empty or not daily_ndvi.empty:

        daily_ndvi.index = pd.to_datetime(daily_ndvi.index)

        daily_df = (
            daily_smap_scaled.set_index("date")
            .join(daily_ndvi, how="outer")
            .reset_index()
            .sort_values("date")
            .reset_index(drop=True)
        )

        # initialize scoring columns
        daily_df["drought_score"] = 0
        daily_df["drought_level"] = ""

        # per-band classification
        for band in ALL_BANDS:
            flag_col = f"{band}_flag"
            status_col = f"{band}_status"
            pct_col = f"{band}_pct_of_threshold"

            daily_df[flag_col] = 0
            daily_df[status_col] = ""
            daily_df[pct_col] = None

            for idx, value in daily_df[band].items():
                result = classify_band(band, value)
                daily_df.at[idx, flag_col] = result.flag
                daily_df.at[idx, status_col] = result.status
                daily_df.at[idx, pct_col] = result.pct_of_threshold

        flag_columns = [f"{b}_flag" for b in ALL_BANDS]

        daily_df["drought_score"] = daily_df[flag_columns].sum(axis=1).astype(int)
        daily_df["drought_level"] = daily_df["drought_score"].apply(classify_drought)

    if return_daily:
        return averages, daily_df, start, end

    return averages, start, end
