"""
DataIngestor — multi-source weather data ingestion.

Sources
  short-term (0–7 days, updated daily):
    1. Open-Meteo     — free, no API key, 1 km grid, hourly → daily aggregated
    2. BMD BAMIS      — official Bangladesh scraper (existing MCP tool, fallback)

  long-term (8–30 days, updated weekly):
    3. Copernicus C3S — ECMWF seasonal ensemble (requires COPERNICUS_API_KEY + cdsapi)
    4. WeatherNext    — 15-day commercial REST API (requires WEATHERNEXT_API_KEY)

All sources normalise to UnifiedForecast before returning.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import requests

from models import (
    DayForecast,
    ExtremeFlags,
    PrecipitationData,
    TemperatureData,
    UnifiedForecast,
    WindData,
)
from mcp_weather.tools.weather_forecast import fetch_forecast_logic

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# District coordinates  (lat/lon centroid for Open-Meteo grid queries)
# All 64 Bangladesh districts
# ---------------------------------------------------------------------------
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    # Dhaka Division
    "Dhaka":        (23.8103,  90.4125),
    "Gazipur":      (23.9999,  90.4272),
    "Narayanganj":  (23.6238,  90.5000),
    "Tangail":      (24.2513,  89.9167),
    "Kishoreganj":  (24.4449,  90.7766),
    "Mymensingh":   (24.7471,  90.4203),
    "Netrokona":    (24.8703,  90.7271),
    "Jamalpur":     (24.9375,  89.9375),
    "Sherpur":      (25.0204,  90.0190),
    "Manikganj":    (23.8613,  89.9917),
    "Munshiganj":   (23.5420,  90.5313),
    "Narsingdi":    (23.9310,  90.7152),
    "Faridpur":     (23.6070,  89.8429),
    "Madaripur":    (23.1640,  90.2007),
    "Gopalganj":    (23.0050,  89.8268),
    "Rajbari":      (23.7574,  89.6437),
    "Shariatpur":   (23.2427,  90.4352),
    # Chittagong Division
    "Chittagong":   (22.3569,  91.7832),
    "Cox's Bazar":  (21.4272,  92.0058),
    "Comilla":      (23.4607,  91.1809),
    "Brahmanbaria": (23.9608,  91.1116),
    "Chandpur":     (23.2333,  90.6699),
    "Feni":         (23.0233,  91.3979),
    "Lakshmipur":   (22.9449,  90.8412),
    "Noakhali":     (22.8696,  91.0993),
    "Khagrachhari": (23.1193,  91.9847),
    "Rangamati":    (22.7324,  92.2985),
    "Bandarban":    (22.1953,  92.2184),
    # Rajshahi Division
    "Rajshahi":     (24.3636,  88.6241),
    "Chapainawabganj": (24.5953, 88.2760),
    "Naogaon":      (24.8033,  88.9347),
    "Natore":       (24.4203,  89.0000),
    "Pabna":        (24.0064,  89.2372),
    "Sirajganj":    (24.4535,  89.7001),
    "Bogura":       (24.8510,  89.3697),
    "Joypurhat":    (25.1031,  89.0225),
    # Khulna Division
    "Khulna":       (22.8456,  89.5403),
    "Bagerhat":     (22.6602,  89.7895),
    "Satkhira":     (22.7185,  89.0705),
    "Jashore":      (23.1664,  89.2082),
    "Narail":       (23.1724,  89.5118),
    "Magura":       (23.4878,  89.4193),
    "Jhenaidah":    (23.5448,  89.1527),
    "Kushtia":      (23.9013,  89.1190),
    "Chuadanga":    (23.6401,  88.8418),
    "Meherpur":     (23.7625,  88.6318),
    # Barishal Division
    "Barisal":      (22.7010,  90.3535),
    "Bhola":        (22.1780,  90.7174),
    "Patuakhali":   (22.3596,  90.3296),
    "Barguna":      (22.0904,  90.1120),
    "Pirojpur":     (22.5793,  89.9740),
    "Jhalokathi":   (22.6402,  90.1878),
    # Sylhet Division
    "Sylhet":       (24.8949,  91.8687),
    "Moulvibazar":  (24.4829,  91.7774),
    "Habiganj":     (24.3745,  91.4152),
    "Sunamganj":    (25.0667,  91.3990),
    # Rangpur Division
    "Rangpur":      (25.7439,  89.2752),
    "Dinajpur":     (25.6279,  88.6337),
    "Thakurgaon":   (26.0336,  88.4616),
    "Panchagarh":   (26.3411,  88.5548),
    "Nilphamari":   (25.9308,  88.8563),
    "Lalmonirhat":  (25.9217,  89.2849),
    "Kurigram":     (25.8057,  89.6367),
    "Gaibandha":    (25.3283,  89.5288),
    # Mymensingh Division
    # (Mymensingh, Jamalpur, Netrokona, Sherpur already listed above)
}

# Open-Meteo daily variables we request
_OM_VARS = (
    "temperature_2m_max,"
    "temperature_2m_min,"
    "precipitation_sum,"
    "precipitation_probability_max,"
    "windspeed_10m_max,"
    "winddirection_10m_dominant,"
    "relative_humidity_2m_max"
)

_OM_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&daily={vars}"
    "&timezone=Asia%2FDhaka"
    "&forecast_days={days}"
)


class DataIngestor:
    """
    Fetches weather data from external sources and normalises to UnifiedForecast.
    """

    def __init__(self) -> None:
        self._copernicus_key  = os.getenv("COPERNICUS_API_KEY",  "")
        self._weathernext_key = os.getenv("WEATHERNEXT_API_KEY", "")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def ingest_short_term(
        self,
        districts: list[str] | None = None,
        forecast_days: int = 7,
    ) -> list[UnifiedForecast]:
        """
        Fetch 0–forecast_days day forecasts for all (or specified) districts.

        Primary source:   Open-Meteo  (free, no API key)
        Fallback source:  BMD BAMIS   (existing scraper via fetch_forecast_logic)

        Returns one UnifiedForecast per district.
        Districts that fail both sources are skipped and logged.
        """
        targets = districts if districts is not None else list(DISTRICT_COORDS.keys())
        results: list[UnifiedForecast] = []

        for district in targets:
            coords = DISTRICT_COORDS.get(district)
            if coords:
                try:
                    uf = self._from_open_meteo(district, coords, forecast_days)
                    results.append(uf)
                    continue
                except Exception as exc:
                    logger.warning(
                        "[INGESTOR] Open-Meteo failed for %s: %s — falling back to BMD",
                        district, exc,
                    )

            # BMD fallback (also handles districts without registered coordinates)
            try:
                uf = self._from_bmd(district, forecast_days)
                results.append(uf)
            except Exception as exc:
                logger.error("[INGESTOR] BMD fallback also failed for %s: %s", district, exc)

        logger.info(
            "[INGESTOR] Short-term ingestion complete: %d / %d districts",
            len(results), len(targets),
        )
        return results

    def ingest_long_term(
        self,
        districts: list[str] | None = None,
    ) -> list[UnifiedForecast]:
        """
        Fetch 8–30 day seasonal outlooks.

        Primary:  Copernicus C3S (cdsapi) — requires COPERNICUS_API_KEY
        Fallback: WeatherNext REST API    — requires WEATHERNEXT_API_KEY

        Returns empty list if neither key is configured.
        """
        if self._copernicus_key:
            return self._from_copernicus(districts or list(DISTRICT_COORDS.keys()))
        elif self._weathernext_key:
            return self._from_weathernext(districts or list(DISTRICT_COORDS.keys()))
        else:
            logger.info(
                "[INGESTOR] No long-term source configured "
                "(set COPERNICUS_API_KEY or WEATHERNEXT_API_KEY)"
            )
            return []

    # ------------------------------------------------------------------
    # Short-term sources
    # ------------------------------------------------------------------

    def _from_open_meteo(
        self,
        district: str,
        coords: tuple[float, float],
        forecast_days: int,
    ) -> UnifiedForecast:
        lat, lon = coords
        url = _OM_URL.format(lat=lat, lon=lon, vars=_OM_VARS, days=forecast_days)

        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        daily = data["daily"]

        now_utc = datetime.now(timezone.utc).isoformat()
        days_list: list[DayForecast] = []

        for i, date in enumerate(daily["time"]):
            max_t   = _safe(daily, "temperature_2m_max",           i, 30.0)
            min_t   = _safe(daily, "temperature_2m_min",           i, 22.0)
            rain    = _safe(daily, "precipitation_sum",            i, 0.0)
            rain_p  = _safe(daily, "precipitation_probability_max",i, 0.0) / 100.0
            wind    = _safe(daily, "windspeed_10m_max",            i, 0.0)
            wdir    = _safe(daily, "winddirection_10m_dominant",   i, None)
            humidity= _safe(daily, "relative_humidity_2m_max",     i, 70.0)

            days_list.append(DayForecast(
                date=date,
                temperature=TemperatureData(min=min_t, max=max_t),
                precipitation=PrecipitationData(value=rain, probability=rain_p),
                wind=WindData(speed=wind, direction=wdir),
                humidity=humidity,
                extreme_flags=ExtremeFlags(
                    heavy_rain=rain  >= 50.0,
                    heatwave=max_t   >= 40.0,
                    cyclone_risk=wind >= 88.0,
                ),
            ))

        return UnifiedForecast(
            location=district,
            latitude=lat,
            longitude=lon,
            source="open_meteo",
            horizon="short",
            ingested_at=now_utc,
            forecast=days_list,
        )

    def _from_bmd(self, district: str, forecast_days: int) -> UnifiedForecast:
        """
        Wrap the existing BMD BAMIS scraper and convert its output to UnifiedForecast.
        The scraper returns a single row of values distributed evenly across forecast_days.
        """
        raw_json = fetch_forecast_logic(district, forecast_days, [])
        raw = json.loads(raw_json)

        if "error" in raw:
            raise ValueError(raw["error"])

        now_utc = datetime.now(timezone.utc).isoformat()
        days_list: list[DayForecast] = []

        for day in raw.get("forecast", []):
            p = day["parameters"]
            temp = p["temperature"]
            rain = p["precipitation"]
            hum  = p["humidity"]["value"]

            days_list.append(DayForecast(
                date=day["date"],
                temperature=TemperatureData(min=temp["min"], max=temp["max"]),
                precipitation=PrecipitationData(
                    value=rain["value"], probability=rain["probability"]
                ),
                wind=WindData(speed=0.0),   # BMD table does not include wind speed
                humidity=hum,
                extreme_flags=ExtremeFlags(
                    heavy_rain=rain["value"] >= 50.0,
                    heatwave=temp["max"]     >= 40.0,
                ),
            ))

        return UnifiedForecast(
            location=district,
            source="bmd",
            horizon="short",
            ingested_at=now_utc,
            forecast=days_list,
        )

    # ------------------------------------------------------------------
    # Long-term sources
    # ------------------------------------------------------------------

    def _from_copernicus(self, districts: list[str]) -> list[UnifiedForecast]:
        """
        Downloads ECMWF ERA5 / Copernicus C3S seasonal forecast covering Bangladesh
        (bounding box 20–27°N, 88–93°E) and samples nearest grid point for each
        district centroid.

        Requires: cdsapi, xarray, scipy  (optional dependencies)
        Copernicus requests are asynchronous (2–10 min); this is called only from
        the weekly background job, not from the request path.
        """
        try:
            import cdsapi          # type: ignore
            import xarray as xr    # type: ignore
            import numpy as np     # type: ignore
        except ImportError:
            logger.warning(
                "[INGESTOR] cdsapi / xarray / numpy not installed — "
                "Copernicus long-term ingestion unavailable"
            )
            return []

        now = datetime.now(timezone.utc)
        tmp_file = "/tmp/copernicus_seasonal.nc"

        try:
            c = cdsapi.Client(key=self._copernicus_key, quiet=True)
            c.retrieve(
                "seasonal-original-single-levels",
                {
                    "originating_centre": "ecmwf",
                    "system":             "51",
                    "variable":           ["2m_temperature", "total_precipitation"],
                    "year":               str(now.year),
                    "month":              f"{now.month:02d}",
                    "day":                [f"{d:02d}" for d in range(1, 32)],
                    "leadtime_hour":      [str(h) for h in range(24, 24 * 31, 24)],
                    "area":               [27, 88, 20, 93],  # N W S E — Bangladesh bbox
                    "format":             "netcdf",
                },
                tmp_file,
            )
        except Exception as exc:
            logger.error("[INGESTOR] Copernicus download failed: %s", exc)
            return []

        try:
            ds = xr.open_dataset(tmp_file)
            results: list[UnifiedForecast] = []
            ingested_at = now.isoformat()

            for district in districts:
                coords = DISTRICT_COORDS.get(district)
                if not coords:
                    continue
                lat, lon = coords

                # Select nearest grid point (xarray nearest-neighbour)
                point = ds.sel(latitude=lat, longitude=lon, method="nearest")

                # t2m is in Kelvin, tp is in metres; convert to °C and mm
                t2m = point["t2m"].values - 273.15   # shape: (n_days,)
                tp  = point["tp"].values  * 1000.0   # m → mm

                base_date = now.date()
                days_list = []
                for i in range(min(len(t2m), 30)):
                    d_str = (base_date + timedelta(days=i + 8)).isoformat()
                    rain  = float(max(tp[i], 0.0))
                    temp  = float(t2m[i])
                    days_list.append(DayForecast(
                        date=d_str,
                        temperature=TemperatureData(min=temp - 4, max=temp + 4),
                        precipitation=PrecipitationData(value=rain, probability=min(rain / 20.0, 1.0)),
                        wind=WindData(speed=0.0),
                        humidity=75.0,  # Copernicus single-level does not include humidity
                        extreme_flags=ExtremeFlags(
                            heavy_rain=rain >= 50.0,
                            heatwave=(temp + 4) >= 40.0,
                        ),
                    ))

                if days_list:
                    results.append(UnifiedForecast(
                        location=district,
                        latitude=lat,
                        longitude=lon,
                        source="copernicus",
                        horizon="long",
                        ingested_at=ingested_at,
                        forecast=days_list,
                    ))

            ds.close()
            logger.info("[INGESTOR] Copernicus: %d districts processed", len(results))
            return results

        except Exception as exc:
            logger.error("[INGESTOR] Copernicus post-processing failed: %s", exc)
            return []

    def _from_weathernext(self, districts: list[str]) -> list[UnifiedForecast]:
        """
        WeatherNext 15-day extended forecast REST API.
        Adapt endpoint / field names to the actual WeatherNext contract.
        """
        results: list[UnifiedForecast] = []
        now_utc = datetime.now(timezone.utc).isoformat()

        for district in districts:
            coords = DISTRICT_COORDS.get(district)
            if not coords:
                continue
            lat, lon = coords

            try:
                resp = requests.get(
                    "https://api.weathernext.io/v2/forecast",
                    params={"lat": lat, "lon": lon, "days": 15, "key": self._weathernext_key},
                    timeout=20,
                )
                resp.raise_for_status()
                data = resp.json()

                days_list: list[DayForecast] = []
                for day in data.get("daily", []):
                    rain = day.get("precip_mm", 0.0)
                    max_t = day.get("temp_max_c", 30.0)
                    wind  = day.get("wind_max_kmh", 0.0)
                    days_list.append(DayForecast(
                        date=day["date"],
                        temperature=TemperatureData(
                            min=day.get("temp_min_c", max_t - 7),
                            max=max_t,
                        ),
                        precipitation=PrecipitationData(
                            value=rain,
                            probability=day.get("precip_prob", min(rain / 20.0, 1.0)),
                        ),
                        wind=WindData(speed=wind),
                        humidity=day.get("humidity_pct", 70.0),
                        extreme_flags=ExtremeFlags(
                            heavy_rain=rain  >= 50.0,
                            heatwave=max_t   >= 40.0,
                            cyclone_risk=wind >= 88.0,
                        ),
                    ))

                if days_list:
                    results.append(UnifiedForecast(
                        location=district,
                        latitude=lat,
                        longitude=lon,
                        source="weathernext",
                        horizon="long",
                        ingested_at=now_utc,
                        forecast=days_list,
                    ))

            except Exception as exc:
                logger.warning("[INGESTOR] WeatherNext failed for %s: %s", district, exc)

        logger.info("[INGESTOR] WeatherNext: %d districts processed", len(results))
        return results

    # ------------------------------------------------------------------
    # Post-processing helpers
    # ------------------------------------------------------------------

    @staticmethod
    def enrich_drought_flags(days: list[DayForecast]) -> list[DayForecast]:
        """
        Set drought_risk=True on any day that is part of a 14+ day dry run
        (< 1 mm/day). Modifies in-place and returns the list.
        """
        dry_run_len = 0
        drought_indices: list[int] = []

        for i, day in enumerate(days):
            if day.precipitation.value < 1.0:
                dry_run_len += 1
                if dry_run_len >= 14:
                    drought_indices.append(i)
            else:
                dry_run_len = 0

        for idx in drought_indices:
            days[idx].extreme_flags.drought_risk = True

        return days


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _safe(
    daily: dict,
    key: str,
    i: int,
    default,
):
    """Safe indexed access into Open-Meteo daily arrays; returns default on None/missing."""
    arr = daily.get(key)
    if arr is None or i >= len(arr):
        return default
    val = arr[i]
    return default if val is None else val
