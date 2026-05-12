"""
DataIngestor — weather data ingestion with BAMIS sense_check validation.

Pipeline per district:
  1. Fetch Open-Meteo hourly-aggregated 7-day forecast (primary)
  2. Fetch BAMIS WRF table in one bulk request (all districts, once per run)
  3. sense_check: compare OM day-0 values against BAMIS period bounds (±20% tolerance)
     - Pass  → use Open-Meteo data (sense_check_passed=True)
     - Fail  → discard OM, fetch full BMD per-district and use as replacement
               (fallback_used=True, sense_check_passed=False)
     - N/A   → BAMIS reference unavailable for this district; use OM as-is

Sources:
  1. Open-Meteo  — free, no API key, 1 km grid, daily aggregated (primary)
  2. BMD BAMIS   — official Bangladesh scraper (sense_check reference + fallback)
"""
import json
import logging
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

from models import (
    DayForecast,
    ExtremeFlags,
    PrecipitationData,
    TemperatureData,
    UnifiedForecast,
    WindData,
)
from mcp_weather.tools.weather_forecast import (
    fetch_forecast_logic,
    BAMIS_URL,
    BENGALI_TO_ENGLISH,
)

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

# Open-Meteo hourly variables (soil moisture is hourly-only in the API)
_OM_HOURLY_VARS = "soil_moisture_0_to_1cm"

_OM_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&daily={vars}"
    "&hourly={hourly_vars}"
    "&timezone=Asia%2FDhaka"
    "&forecast_days={days}"
)


class DataIngestor:
    """
    Fetches weather data from external sources and normalises to UnifiedForecast.
    """

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

        Flow per district:
          1. Fetch Open-Meteo (primary)
          2. Run sense_check vs pre-fetched BAMIS bulk data
             - Pass  → use OM forecast
             - Fail  → fetch full BMD per-district and use it (fallback_used=True)
          3. If OM failed entirely → fall back to BMD directly

        Returns one UnifiedForecast per district.
        Districts that fail both sources are skipped and logged.
        """
        targets = districts if districts is not None else list(DISTRICT_COORDS.keys())
        results: list[UnifiedForecast] = []

        # --- Step 0: fetch BAMIS bounds for ALL districts in one HTTP request ---
        bmd_daily = self._fetch_bmd_sense_data()
        sense_check_failed = 0

        for district in targets:
            coords = DISTRICT_COORDS.get(district)
            om_forecast: UnifiedForecast | None = None

            # --- Step 1: try Open-Meteo ---
            if coords:
                try:
                    om_forecast = self._from_open_meteo(district, coords, forecast_days)
                except Exception as exc:
                    logger.warning(
                        "[INGESTOR] Open-Meteo failed for %s: %s", district, exc,
                    )

            # --- Step 2: sense_check if OM succeeded ---
            if om_forecast is not None:
                bmd_bounds = bmd_daily.get(district)

                if bmd_bounds and om_forecast.forecast:
                    reliable, metrics = self._sense_check(om_forecast.forecast[0], bmd_bounds)
                    om_forecast.sense_check_passed = reliable

                    if not reliable:
                        sense_check_failed += 1
                        logger.warning(
                            "[INGESTOR] sense_check FAILED for %s "
                            "(violations=%d/%d rate=%.2f) — switching to BMD",
                            district,
                            metrics["violations"],
                            metrics["total_checked"],
                            metrics["violation_rate"],
                        )
                        try:
                            bmd_fc = self._from_bmd(district, forecast_days)
                            bmd_fc.fallback_used = True
                            bmd_fc.sense_check_passed = False
                            results.append(bmd_fc)
                            continue
                        except Exception as exc:
                            logger.error(
                                "[INGESTOR] BMD fallback failed for %s after failed sense_check: %s"
                                " — keeping OM data",
                                district, exc,
                            )
                    else:
                        logger.debug(
                            "[INGESTOR] sense_check OK for %s (violations=%d/%d rate=%.2f)",
                            district,
                            metrics["violations"],
                            metrics["total_checked"],
                            metrics["violation_rate"],
                        )
                results.append(om_forecast)
                continue

            # --- Step 3: OM failed entirely — fall back to BMD directly ---
            try:
                bmd_fc = self._from_bmd(district, forecast_days)
                bmd_fc.fallback_used = True
                results.append(bmd_fc)
            except Exception as exc:
                logger.error("[INGESTOR] Both sources failed for %s: %s", district, exc)

        logger.info(
            "[INGESTOR] Short-term ingestion complete: %d / %d districts (sense_check_failed=%d)",
            len(results), len(targets), sense_check_failed,
        )
        return results

    # ------------------------------------------------------------------
    # sense_check
    # ------------------------------------------------------------------

    # BAMIS uses its own English transliterations which differ from our canonical names.
    # This table maps BAMIS page names → DISTRICT_COORDS keys so sense_check lookups work.
    _BAMIS_NAME_MAP: dict[str, str] = {
        "Chattogram":      "Chittagong",       # official new spelling vs colonial name
        "Cumilla":         "Comilla",           # Bengali romanisation vs old spelling
        "Khagrachari":     "Khagrachhari",      # missing 'h'
        "Chapai Nawabganj":"Chapainawabganj",   # space + different romanisation
        "Barishal":        "Barisal",           # official new spelling vs old spelling
        "Jhalokati":       "Jhalokathi",        # missing 'h'
    }

    def _fetch_bmd_sense_data(self) -> dict[str, dict]:
        """
        Fetch the BAMIS WRF table ONCE and return temperature/rain/humidity
        bounds for all districts.

        Returns: {district_name: {"t_min", "t_max", "rain", "humidity"}}
        Keys are normalised to match DISTRICT_COORDS via _BAMIS_NAME_MAP.
        Empty dict on network failure (sense_check will be skipped gracefully).
        """
        try:
            url = BAMIS_URL.format(days=1)
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            }
            resp = requests.get(url, headers=headers, timeout=15)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")

            def _sf(cells: list, idx: int) -> float:
                try:
                    return float(cells[idx].get_text(strip=True))
                except (IndexError, ValueError):
                    return 0.0

            result: dict[str, dict] = {}
            for row in soup.select("table tbody tr"):
                cells = row.find_all("td")
                if not cells:
                    continue
                raw_name = cells[0].get_text(strip=True)
                # BENGALI_TO_ENGLISH handles Bengali text; for pages that already use
                # English, get() falls through and raw_name is used as-is.
                bamis_name = BENGALI_TO_ENGLISH.get(raw_name, raw_name)
                # Normalise to our canonical DISTRICT_COORDS key
                canonical = self._BAMIS_NAME_MAP.get(bamis_name, bamis_name)
                result[canonical] = {
                    "t_min":    _sf(cells, 1),
                    "t_max":    _sf(cells, 3),
                    "humidity": _sf(cells, 5),
                    "rain":     _sf(cells, 10),  # total mm for the period (days=1 → daily)
                }

            logger.info("[INGESTOR] BAMIS sense_check reference loaded: %d districts", len(result))
            return result

        except Exception as exc:
            logger.warning(
                "[INGESTOR] BAMIS sense_check fetch failed: %s — sense_check will be skipped", exc,
            )
            return {}

    @staticmethod
    def _sense_check(
        om_day: "DayForecast",
        bmd_bounds: dict,
        tolerance: float = 0.2,
    ) -> tuple[bool, dict]:
        """
        Check whether Open-Meteo day-0 values are plausible against BAMIS bounds.

        Checks three variables (temperature max, precipitation, humidity).
        Returns (reliable, metrics) where reliable=False triggers BMD fallback.
        A violation occurs when the OM value lies outside the BAMIS ± tolerance range.
        sense_check fails when violation_rate ≥ 0.5 (majority of checked variables fail).
        """
        violations = 0
        total_checked = 0
        details: dict = {}

        # Temperature: OM daily max vs BAMIS period min/max bounds
        bmd_t_max = bmd_bounds.get("t_max", 0.0)
        bmd_t_min = bmd_bounds.get("t_min", 0.0)
        if bmd_t_max > 0:
            upper = bmd_t_max * (1 + tolerance)
            lower = bmd_t_min * (1 - tolerance)
            om_val = om_day.temperature.max
            violated = om_val > upper or om_val < lower
            total_checked += 1
            if violated:
                violations += 1
            details["temperature"] = {
                "om_max": om_val, "bmd_bounds": [round(lower, 1), round(upper, 1)],
                "violation": violated,
            }

        # Precipitation: OM daily total vs BAMIS daily total (upper-bound check only)
        # Lower bound is 0 — OM reporting less rain than BMD is acceptable.
        bmd_rain = bmd_bounds.get("rain", 0.0)
        om_rain = om_day.precipitation.value
        # Give at least a 10 mm absolute buffer for small rain values
        upper_rain = max(bmd_rain * (1 + tolerance), bmd_rain + 10.0)
        violated = om_rain > upper_rain
        total_checked += 1
        if violated:
            violations += 1
        details["precipitation"] = {
            "om_value": om_rain, "bmd_upper": round(upper_rain, 1), "violation": violated,
        }

        # Humidity: OM max vs BAMIS single value ± tolerance
        bmd_hum = bmd_bounds.get("humidity", 0.0)
        if bmd_hum > 0:
            upper_hum = min(bmd_hum * (1 + tolerance), 100.0)
            lower_hum = max(bmd_hum * (1 - tolerance), 0.0)
            om_hum = om_day.humidity
            violated = om_hum > upper_hum or om_hum < lower_hum
            total_checked += 1
            if violated:
                violations += 1
            details["humidity"] = {
                "om_value": om_hum, "bmd_bounds": [round(lower_hum, 1), round(upper_hum, 1)],
                "violation": violated,
            }

        if total_checked == 0:
            return True, {"total_checked": 0, "violations": 0, "violation_rate": 0.0}

        violation_rate = violations / total_checked
        return violation_rate < 0.5, {
            "total_checked": total_checked,
            "violations": violations,
            "violation_rate": round(violation_rate, 3),
            "details": details,
        }

    # ------------------------------------------------------------------
    # Sources
    # ------------------------------------------------------------------

    def _from_open_meteo(
        self,
        district: str,
        coords: tuple[float, float],
        forecast_days: int,
    ) -> UnifiedForecast:
        lat, lon = coords
        url = _OM_URL.format(
            lat=lat, lon=lon, vars=_OM_VARS,
            hourly_vars=_OM_HOURLY_VARS, days=forecast_days,
        )

        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        daily  = data["daily"]
        hourly = data.get("hourly", {})

        # Pre-compute daily average soil moisture from 24 hourly values per day
        sm_hourly = hourly.get("soil_moisture_0_to_1cm", [])

        def _daily_soil_moisture(day_index: int) -> float | None:
            start = day_index * 24
            vals = [v for v in sm_hourly[start:start + 24] if v is not None]
            return round(sum(vals) / len(vals), 4) if vals else None

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
            soil_m  = _daily_soil_moisture(i)

            days_list.append(DayForecast(
                date=date,
                temperature=TemperatureData(min=min_t, max=max_t),
                precipitation=PrecipitationData(value=rain, probability=rain_p),
                wind=WindData(speed=wind, direction=wdir),
                humidity=humidity,
                soil_moisture=soil_m,
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
