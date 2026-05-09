"""
CopernicusFetcher — downloads SEAS5 seasonal-monthly forecasts from the
Copernicus Climate Data Store (CDS) and persists them to ArangoDB.

Fetches up to 5 months ahead for a configurable set of Bangladesh districts.
Writes one document per district to the `seasonal_forecasts` collection.

Required env vars (or ~/.cdsapirc):
  CDSAPI_URL   https://cds.climate.copernicus.eu/api
  CDSAPI_KEY   <uid>:<api-key>  (or just <api-key> for new-format keys)

Optional:
  COPERNICUS_MONTHS_AHEAD   Number of months to fetch (default 5, max 6)
"""
from __future__ import annotations

import logging
import math
import os
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from storage import StorageLayer

logger = logging.getLogger(__name__)

# Bangladesh districts with centroid lat/lon
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka":        (23.8103,  90.4125),
    "Chittagong":   (22.3569,  91.7832),
    "Sylhet":       (24.8949,  91.8687),
    "Rajshahi":     (24.3745,  88.6042),
    "Khulna":       (22.8456,  89.5403),
    "Barisal":      (22.7010,  90.3535),
    "Rangpur":      (25.7439,  89.2752),
    "Mymensingh":   (24.7471,  90.4203),
    "Comilla":      (23.4607,  91.1809),
    "Jessore":      (23.1667,  89.2167),
    "Bogra":        (24.8465,  89.3773),
    "Dinajpur":     (25.6279,  88.6338),
    "Pabna":        (24.0064,  89.2372),
    "Tangail":      (24.2513,  89.9167),
    "Faridpur":     (23.6070,  89.8429),
    "Noakhali":     (22.8696,  91.0995),
    "Brahmanbaria": (23.9608,  91.1115),
    "Cox's Bazar":  (21.4272,  92.0058),
    "Chandpur":     (23.2333,  90.6500),
    "Narsingdi":    (23.9174,  90.7150),
}

# Bangladesh bounding box [N, W, S, E] for CDS area filter
_BBOX = [26.5, 88.0, 20.5, 92.7]

# SEAS5 CDS dataset
_DATASET = "seasonal-monthly-single-levels"
_SYSTEM  = "5"  # SEAS5; use "51" for SEAS5.1 if available on your account

# Variables we request — only those available in SEAS5 monthly means
_VARIABLES = [
    "2m_temperature",
    "total_precipitation",
    "10m_u_component_of_wind",
    "10m_v_component_of_wind",
    "2m_dewpoint_temperature",   # for RH estimation; silently skipped if absent
]


class CopernicusFetcher:
    """
    Downloads SEAS5 monthly-mean seasonal forecasts and stores per-district
    climate outlooks in ArangoDB `seasonal_forecasts`.
    """

    def __init__(self, months_ahead: int | None = None) -> None:
        self._months_ahead = min(int(os.getenv("COPERNICUS_MONTHS_AHEAD", 5)), 6)
        if months_ahead is not None:
            self._months_ahead = min(months_ahead, 6)

    # ------------------------------------------------------------------
    # Public entry point (called by scheduler)
    # ------------------------------------------------------------------

    def fetch_and_store(self, storage: "StorageLayer") -> dict:
        """
        Fetch SEAS5 for the current month → store in ArangoDB.
        Returns a summary dict {stored, skipped, error}.
        """
        if not self._cds_configured():
            logger.warning(
                "[COPERNICUS] CDSAPI_KEY not set — long-term pipeline skipped. "
                "Set CDSAPI_URL and CDSAPI_KEY or create ~/.cdsapirc."
            )
            return {"stored": 0, "skipped": len(DISTRICT_COORDS), "error": "cds_not_configured"}

        today = date.today()
        issue_month = f"{today.year}-{today.month:02d}"
        leadtime_months = [str(m) for m in range(1, self._months_ahead + 1)]

        logger.info(
            "[COPERNICUS] Fetching SEAS5 — issue=%s leadtime=%s months ahead",
            issue_month, self._months_ahead,
        )

        with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            self._download(today.year, today.month, leadtime_months, tmp_path)
            district_outlooks = self._parse_netcdf(tmp_path, today, leadtime_months)
        except Exception as exc:
            logger.error("[COPERNICUS] Fetch/parse failed: %s", exc)
            return {"stored": 0, "skipped": len(DISTRICT_COORDS), "error": str(exc)}
        finally:
            Path(tmp_path).unlink(missing_ok=True)

        stored = 0
        for location, outlook in district_outlooks.items():
            try:
                storage.upsert_seasonal_forecast({
                    "location":    location,
                    "source":      "copernicus_seas5",
                    "horizon":     "long",
                    "fetched_at":  datetime.now(timezone.utc).isoformat(),
                    "issue_month": issue_month,
                    "months_ahead": self._months_ahead,
                    "outlook":     outlook,
                })
                stored += 1
            except Exception as exc:
                logger.error("[COPERNICUS] ArangoDB store failed for %s: %s", location, exc)

        logger.info("[COPERNICUS] Stored %d/%d district outlooks", stored, len(DISTRICT_COORDS))
        return {"stored": stored, "skipped": len(DISTRICT_COORDS) - stored, "error": None}

    # ------------------------------------------------------------------
    # CDS download
    # ------------------------------------------------------------------

    def _download(
        self,
        year: int,
        month: int,
        leadtime_months: list[str],
        out_path: str,
    ) -> None:
        import cdsapi  # type: ignore

        client = cdsapi.Client(
            url=os.getenv("CDSAPI_URL", "https://cds.climate.copernicus.eu/api"),
            key=os.getenv("CDSAPI_KEY", ""),
            quiet=True,
        )

        request = {
            "originating_centre": "ecmwf",
            "system":             _SYSTEM,
            "variable":           _VARIABLES,
            "product_type":       "monthly_mean",
            "year":               str(year),
            "month":              f"{month:02d}",
            "leadtime_month":     leadtime_months,
            "area":               _BBOX,
            "format":             "netcdf",
        }

        logger.info("[COPERNICUS] Submitting CDS request (may take several minutes)…")
        client.retrieve(_DATASET, request, out_path)
        logger.info("[COPERNICUS] Download complete → %s", out_path)

    # ------------------------------------------------------------------
    # NetCDF parsing
    # ------------------------------------------------------------------

    def _parse_netcdf(
        self,
        path: str,
        issue_date: date,
        leadtime_months: list[str],
    ) -> dict[str, list[dict]]:
        """
        Open the downloaded NetCDF and extract per-district, per-month values.
        Returns { district_name: [monthly_record, …] }
        """
        import xarray as xr
        import numpy as np

        ds = xr.open_dataset(path, engine="netcdf4")
        logger.debug("[COPERNICUS] Dataset variables: %s", list(ds.data_vars))

        # ── Locate variables (SEAS5 uses short names internally) ─────────
        temp_k    = self._get_var(ds, ["t2m", "2m_temperature", "var167"])
        precip_m  = self._get_var(ds, ["tp", "total_precipitation", "var228"])
        u_wind    = self._get_var(ds, ["u10", "10m_u_component_of_wind", "var165"])
        v_wind    = self._get_var(ds, ["v10", "10m_v_component_of_wind", "var166"])
        dewp_k    = self._get_var(ds, ["d2m", "2m_dewpoint_temperature", "var168"])

        # ── Ensemble mean ─────────────────────────────────────────────────
        ens_dim = "number" if "number" in ds.dims else None
        for arr in (temp_k, precip_m, u_wind, v_wind, dewp_k):
            if arr is not None and ens_dim and ens_dim in arr.dims:
                arr = arr.mean(dim=ens_dim)

        # Re-assign after averaging (need to redo for each variable)
        def ens_mean(var):
            if var is None:
                return None
            return var.mean(dim=ens_dim) if (ens_dim and ens_dim in var.dims) else var

        temp_k   = ens_mean(self._get_var(ds, ["t2m", "2m_temperature", "var167"]))
        precip_m = ens_mean(self._get_var(ds, ["tp", "total_precipitation", "var228"]))
        u_wind   = ens_mean(self._get_var(ds, ["u10", "10m_u_component_of_wind", "var165"]))
        v_wind   = ens_mean(self._get_var(ds, ["v10", "10m_v_component_of_wind", "var166"]))
        dewp_k   = ens_mean(self._get_var(ds, ["d2m", "2m_dewpoint_temperature", "var168"]))

        # ── Resolve time steps → valid months ────────────────────────────
        if "time" in ds.coords:
            times = ds.coords["time"].values
        else:
            times = ds.coords[list(ds.coords)[0]].values

        import pandas as pd
        time_index = pd.DatetimeIndex(times)

        result: dict[str, list[dict]] = {}

        for location, (lat, lon) in DISTRICT_COORDS.items():
            monthly_records: list[dict] = []

            for i, ts in enumerate(time_index):
                valid_month = f"{ts.year}-{ts.month:02d}"

                record: dict = {"valid_month": valid_month}

                # Temperature °C
                if temp_k is not None:
                    t_val = float(temp_k.isel(time=i).sel(
                        latitude=lat, longitude=lon, method="nearest"
                    ).values)
                    record["mean_temp_c"] = round(t_val - 273.15, 2)

                # Precipitation mm/month
                # SEAS5 monthly_mean tp is m/day rate; multiply by days in month
                if precip_m is not None:
                    p_val = float(precip_m.isel(time=i).sel(
                        latitude=lat, longitude=lon, method="nearest"
                    ).values)
                    days = self._days_in_month(ts.year, ts.month)
                    record["total_precip_mm"] = round(p_val * 1000 * days, 1)

                # Wind km/h
                if u_wind is not None and v_wind is not None:
                    u = float(u_wind.isel(time=i).sel(
                        latitude=lat, longitude=lon, method="nearest"
                    ).values)
                    v = float(v_wind.isel(time=i).sel(
                        latitude=lat, longitude=lon, method="nearest"
                    ).values)
                    record["mean_wind_kmh"] = round(math.sqrt(u**2 + v**2) * 3.6, 1)

                # Relative humidity estimate from dewpoint (Magnus approximation)
                if dewp_k is not None and temp_k is not None:
                    t_c  = record.get("mean_temp_c", 0.0)
                    d_val = float(dewp_k.isel(time=i).sel(
                        latitude=lat, longitude=lon, method="nearest"
                    ).values)
                    td_c = d_val - 273.15
                    rh = 100 * math.exp(17.625 * td_c / (243.04 + td_c)) / \
                             math.exp(17.625 * t_c  / (243.04 + t_c))
                    record["estimated_rh_pct"] = round(min(max(rh, 0), 100), 1)

                monthly_records.append(record)

            result[location] = monthly_records
            logger.debug("[COPERNICUS] %s: %d monthly records parsed", location, len(monthly_records))

        ds.close()
        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_var(ds, candidates: list[str]):
        for name in candidates:
            if name in ds:
                return ds[name]
        return None

    @staticmethod
    def _days_in_month(year: int, month: int) -> int:
        import calendar
        return calendar.monthrange(year, month)[1]

    @staticmethod
    def _cds_configured() -> bool:
        if os.getenv("CDSAPI_KEY"):
            return True
        rc = Path.home() / ".cdsapirc"
        return rc.exists()
