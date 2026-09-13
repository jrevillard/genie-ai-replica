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
    from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)

# Bangladesh districts with centroid lat/lon
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka": (23.8103, 90.4125),
    "Chittagong": (22.3569, 91.7832),
    "Sylhet": (24.8949, 91.8687),
    "Rajshahi": (24.3745, 88.6042),
    "Khulna": (22.8456, 89.5403),
    "Barisal": (22.7010, 90.3535),
    "Rangpur": (25.7439, 89.2752),
    "Mymensingh": (24.7471, 90.4203),
    "Comilla": (23.4607, 91.1809),
    "Jessore": (23.1667, 89.2167),
    "Bogra": (24.8465, 89.3773),
    "Dinajpur": (25.6279, 88.6338),
    "Pabna": (24.0064, 89.2372),
    "Tangail": (24.2513, 89.9167),
    "Faridpur": (23.6070, 89.8429),
    "Noakhali": (22.8696, 91.0995),
    "Brahmanbaria": (23.9608, 91.1115),
    "Cox's Bazar": (21.4272, 92.0058),
    "Chandpur": (23.2333, 90.6500),
    "Narsingdi": (23.9174, 90.7150),
}

# Bangladesh bounding box [N, W, S, E] for CDS area filter
_BBOX = [26.5, 88.0, 20.5, 92.7]

# SEAS5 CDS dataset
_DATASET = "seasonal-monthly-single-levels"
# SEAS5.1. System "5" is no longer produced for current months — CDS answers
# every recent issue month with MarsNoDataError, while "51" returns data for the
# same months (verified against 2026-07/08/09). Override only if ECMWF retires 51.
_SYSTEM = os.getenv("COPERNICUS_SYSTEM", "51")

# Variables we request — only those available in SEAS5 monthly means
_VARIABLES = [
    "2m_temperature",
    "total_precipitation",
    "10m_u_component_of_wind",
    "10m_v_component_of_wind",
    "2m_dewpoint_temperature",  # for RH estimation; silently skipped if absent
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

    def fetch_and_store(self, storage: StorageLayer) -> dict:
        """
        Fetch SEAS5 for the current month → store in ArangoDB.
        Returns a summary dict {stored, skipped, error}.
        """
        if not self._cds_configured():
            logger.warning(
                "[COPERNICUS] CDSAPI_KEY not set — long-term pipeline skipped. "
                "Set CDSAPI_URL and CDSAPI_KEY or create ~/.cdsapirc."
            )
            return {
                "stored": 0,
                "skipped": len(DISTRICT_COORDS),
                "error": "cds_not_configured",
            }

        today = date.today()
        issue_month = f"{today.year}-{today.month:02d}"
        leadtime_months = [str(m) for m in range(1, self._months_ahead + 1)]

        logger.info(
            "[COPERNICUS] Fetching SEAS5 — issue=%s leadtime=%s months ahead",
            issue_month,
            self._months_ahead,
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
                storage.upsert_seasonal_forecast(
                    {
                        "location": location,
                        "source": "copernicus_seas5",
                        "horizon": "long",
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                        "issue_month": issue_month,
                        "months_ahead": self._months_ahead,
                        "outlook": outlook,
                    }
                )
                stored += 1
            except Exception as exc:
                logger.error(
                    "[COPERNICUS] ArangoDB store failed for %s: %s", location, exc
                )

        logger.info(
            "[COPERNICUS] Stored %d/%d district outlooks", stored, len(DISTRICT_COORDS)
        )
        return {
            "stored": stored,
            "skipped": len(DISTRICT_COORDS) - stored,
            "error": None,
        }

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
            "system": _SYSTEM,
            "variable": _VARIABLES,
            "product_type": "monthly_mean",
            "year": str(year),
            "month": f"{month:02d}",
            "leadtime_month": leadtime_months,
            "area": _BBOX,
            "data_format": "netcdf",
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

        ds = xr.open_dataset(path, engine="netcdf4")
        logger.debug("[COPERNICUS] Dataset variables: %s", list(ds.data_vars))

        # ── Locate variables, averaged over the 51 ensemble members ───────
        # "tprate" is the name the monthly_mean product actually uses; "tp" only
        # appears in the daily/accumulated products.
        def ens_mean(candidates: list[str]):
            var = self._get_var(ds, candidates)
            if var is None:
                return None
            return var.mean(dim="number") if "number" in var.dims else var

        temp_k = ens_mean(["t2m", "2m_temperature", "var167"])
        precip_rate = ens_mean(["tprate", "tp", "total_precipitation", "var228"])
        u_wind = ens_mean(["u10", "10m_u_component_of_wind", "var165"])
        v_wind = ens_mean(["v10", "10m_v_component_of_wind", "var166"])
        dewp_k = ens_mean(["d2m", "2m_dewpoint_temperature", "var168"])

        # ── Resolve lead times → valid months ────────────────────────────
        # The file is indexed by forecast_reference_time (the issue date) and
        # forecastMonth, NOT by a "time" coordinate. forecastMonth=1 is the issue
        # month itself, so valid_month = issue_month + (forecastMonth - 1).
        if "forecastMonth" in ds.coords:
            lead_numbers = [int(v) for v in ds.coords["forecastMonth"].values]
        else:
            lead_numbers = [int(m) for m in leadtime_months]

        def at(var, idx: int, lat: float, lon: float) -> float | None:
            """Value for one lead-time step at the grid point nearest lat/lon."""
            if var is None:
                return None
            sel = var
            if "forecastMonth" in sel.dims:
                sel = sel.isel(forecastMonth=idx)
            if "forecast_reference_time" in sel.dims:
                sel = sel.isel(forecast_reference_time=0)
            return float(sel.sel(latitude=lat, longitude=lon, method="nearest").values)

        result: dict[str, list[dict]] = {}

        for location, (lat, lon) in DISTRICT_COORDS.items():
            monthly_records: list[dict] = []

            for i, lead in enumerate(lead_numbers):
                year, month = self._add_months(
                    issue_date.year, issue_date.month, lead - 1
                )
                record: dict = {"valid_month": f"{year}-{month:02d}"}

                t_val = at(temp_k, i, lat, lon)
                if t_val is not None:
                    record["mean_temp_c"] = round(t_val - 273.15, 2)

                # "tprate" is a mean rate in m s-1 → mm for the whole month.
                p_val = at(precip_rate, i, lat, lon)
                if p_val is not None:
                    days = self._days_in_month(year, month)
                    record["total_precip_mm"] = round(p_val * 1000 * 86400 * days, 1)

                u = at(u_wind, i, lat, lon)
                v = at(v_wind, i, lat, lon)
                if u is not None and v is not None:
                    record["mean_wind_kmh"] = round(math.sqrt(u**2 + v**2) * 3.6, 1)

                # Relative humidity estimate from dewpoint (Magnus approximation)
                d_val = at(dewp_k, i, lat, lon)
                if d_val is not None and t_val is not None:
                    t_c = t_val - 273.15
                    td_c = d_val - 273.15
                    rh = (
                        100
                        * math.exp(17.625 * td_c / (243.04 + td_c))
                        / math.exp(17.625 * t_c / (243.04 + t_c))
                    )
                    record["estimated_rh_pct"] = round(min(max(rh, 0), 100), 1)

                monthly_records.append(record)

            result[location] = monthly_records
            logger.debug(
                "[COPERNICUS] %s: %d monthly records parsed",
                location,
                len(monthly_records),
            )

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
    def _add_months(year: int, month: int, offset: int) -> tuple[int, int]:
        """Advance (year, month) by *offset* months, rolling the year over."""
        index = (year * 12 + (month - 1)) + offset
        return index // 12, index % 12 + 1

    @staticmethod
    def _cds_configured() -> bool:
        if os.getenv("CDSAPI_KEY"):
            return True
        rc = Path.home() / ".cdsapirc"
        return rc.exists()
