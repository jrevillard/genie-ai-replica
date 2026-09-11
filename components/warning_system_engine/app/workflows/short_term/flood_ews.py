"""
Flood early warning (short term, 0-10 days).

Two signals per district, combined into the engine's 0-4 tier scale:

  Pluvial (rain on saturated ground)
    Stored 7-day forecast (Open-Meteo / BMD via the ingestor): 24 h maximum and
    72 h rolling rainfall, weighted by the soil-moisture reading of the first day.
    Thresholds follow the Bangladesh Meteorological Department categories
    ("very heavy" >= 89 mm/24 h) and the engine's existing rain tiers.

  Fluvial (river discharge)
    GloFAS (Copernicus Emergency Management Service) daily river discharge, served
    by the Open-Meteo Flood API without a key. Sampled at the district centroid and
    at the key FFWC river stations that affect the district. The 10-day forecast
    peak is compared with the median of the previous 30 days at the same point.
    Return-period thresholds (2/5/20-year) are NOT available from Open-Meteo; when
    a CDS key is configured, `cems-glofas-forecast` can replace the ratio rule.

The result is stored like the potato assessment (`risk_assessments`, crop="flood")
so the weather service, the web banner and the notifier need no new storage.
"""

from __future__ import annotations

import logging
import os
import statistics
from datetime import datetime, timezone

import requests
from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)

_CROP = "flood"
_TIER_LABELS = {0: "Normal", 1: "Advisory", 2: "Warning", 3: "Severe", 4: "Emergency"}

# Rain thresholds (mm). 24 h from BMD categories; 72 h from basin response time.
_RAIN_24 = {1: 60.0, 2: 100.0, 3: 150.0}
_RAIN_72 = {1: 90.0, 2: 150.0, 3: 250.0}
_SOIL_SATURATED = float(os.getenv("FLOOD_SOIL_SATURATED", "0.40"))  # m3/m3, +1 tier
_SOIL_DRY = float(os.getenv("FLOOD_SOIL_DRY", "0.15"))  # m3/m3, -1 tier (advisory only)

# River discharge: forecast peak / median of the last 30 days at the same point.
_RIVER_RATIO = {1: 1.5, 2: 2.5, 3: 4.0}
_RIVER_MIN_Q_STATION = float(os.getenv("FLOOD_RIVER_MIN_Q_STATION", "300"))  # m3/s
_RIVER_MIN_Q_CENTROID = float(
    os.getenv("FLOOD_RIVER_MIN_Q_CENTROID", "150")
)  # m3/s (small channels ignored)
_FLOOD_API = os.getenv(
    "OPEN_METEO_FLOOD_URL", "https://flood-api.open-meteo.com/v1/flood"
)
_FORECAST_DAYS = 10
_PAST_DAYS = 30

DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka": (23.8103, 90.4125),
    "Gazipur": (23.9999, 90.4272),
    "Narayanganj": (23.6238, 90.5000),
    "Tangail": (24.2513, 89.9167),
    "Kishoreganj": (24.4449, 90.7766),
    "Mymensingh": (24.7471, 90.4203),
    "Netrokona": (24.8703, 90.7271),
    "Jamalpur": (24.9375, 89.9375),
    "Sherpur": (25.0204, 90.0190),
    "Manikganj": (23.8613, 89.9917),
    "Munshiganj": (23.5420, 90.5313),
    "Narsingdi": (23.9310, 90.7152),
    "Faridpur": (23.6070, 89.8429),
    "Madaripur": (23.1640, 90.2007),
    "Gopalganj": (23.0050, 89.8268),
    "Rajbari": (23.7574, 89.6437),
    "Shariatpur": (23.2427, 90.4352),
    "Chittagong": (22.3569, 91.7832),
    "Cox's Bazar": (21.4272, 92.0058),
    "Comilla": (23.4607, 91.1809),
    "Brahmanbaria": (23.9608, 91.1116),
    "Chandpur": (23.2333, 90.6699),
    "Feni": (23.0233, 91.3979),
    "Lakshmipur": (22.9449, 90.8412),
    "Noakhali": (22.8696, 91.0993),
    "Khagrachhari": (23.1193, 91.9847),
    "Rangamati": (22.7324, 92.2985),
    "Bandarban": (22.1953, 92.2184),
    "Rajshahi": (24.3636, 88.6241),
    "Chapainawabganj": (24.5953, 88.2760),
    "Naogaon": (24.8033, 88.9347),
    "Natore": (24.4203, 89.0000),
    "Pabna": (24.0064, 89.2372),
    "Sirajganj": (24.4535, 89.7001),
    "Bogura": (24.8510, 89.3697),
    "Joypurhat": (25.1031, 89.0225),
    "Khulna": (22.8456, 89.5403),
    "Bagerhat": (22.6602, 89.7895),
    "Satkhira": (22.7185, 89.0705),
    "Jashore": (23.1664, 89.2082),
    "Narail": (23.1724, 89.5118),
    "Magura": (23.4878, 89.4193),
    "Jhenaidah": (23.5448, 89.1527),
    "Kushtia": (23.9013, 89.1190),
    "Chuadanga": (23.6401, 88.8418),
    "Meherpur": (23.7625, 88.6318),
    "Barisal": (22.7010, 90.3535),
    "Bhola": (22.1780, 90.7174),
    "Patuakhali": (22.3596, 90.3296),
    "Barguna": (22.0904, 90.1120),
    "Pirojpur": (22.5793, 89.9740),
    "Jhalokathi": (22.6402, 90.1878),
    "Sylhet": (24.8949, 91.8687),
    "Moulvibazar": (24.4829, 91.7774),
    "Habiganj": (24.3745, 91.4152),
    "Sunamganj": (25.0667, 91.3990),
    "Rangpur": (25.7439, 89.2752),
    "Dinajpur": (25.6279, 88.6337),
    "Thakurgaon": (26.0336, 88.4616),
    "Panchagarh": (26.3411, 88.5548),
    "Nilphamari": (25.9308, 88.8563),
    "Lalmonirhat": (25.9217, 89.2849),
    "Kurigram": (25.8057, 89.6367),
    "Gaibandha": (25.3283, 89.5288),
}

# Key FFWC river stations -> districts they affect. Used as extra sampling points
# because a district centroid rarely sits on the main channel.
RIVER_STATIONS: list[tuple[str, str, float, float, list[str]]] = [
    (
        "Bahadurabad",
        "Jamuna",
        25.18,
        89.67,
        ["Jamalpur", "Gaibandha", "Kurigram", "Sirajganj", "Bogura"],
    ),
    ("Sirajganj", "Jamuna", 24.45, 89.72, ["Sirajganj", "Pabna", "Tangail"]),
    ("Aricha", "Jamuna/Padma", 23.83, 89.75, ["Manikganj", "Dhaka", "Munshiganj"]),
    (
        "Hardinge Bridge",
        "Ganges",
        24.07,
        89.03,
        ["Pabna", "Kushtia", "Natore", "Rajshahi"],
    ),
    ("Goalundo", "Padma", 23.75, 89.75, ["Rajbari", "Faridpur", "Madaripur"]),
    (
        "Bhairab Bazar",
        "Meghna",
        24.05,
        90.98,
        ["Kishoreganj", "Brahmanbaria", "Narsingdi"],
    ),
    ("Chandpur", "Meghna", 23.23, 90.65, ["Chandpur", "Lakshmipur", "Shariatpur"]),
    ("Sylhet", "Surma", 24.89, 91.87, ["Sylhet"]),
    ("Sunamganj", "Surma", 25.07, 91.40, ["Sunamganj"]),
    ("Kanaighat", "Surma", 25.00, 92.25, ["Sylhet"]),
    ("Habiganj", "Khowai", 24.38, 91.41, ["Habiganj"]),
    ("Moulvibazar", "Manu", 24.48, 91.77, ["Moulvibazar"]),
    ("Netrokona", "Kangsha", 24.88, 90.73, ["Netrokona"]),
    ("Sherpur", "Bhugai", 25.02, 90.02, ["Sherpur"]),
    ("Mymensingh", "Old Brahmaputra", 24.75, 90.40, ["Mymensingh"]),
    ("Jamalpur", "Old Brahmaputra", 24.92, 89.94, ["Jamalpur"]),
    ("Kurigram", "Dharla", 25.81, 89.65, ["Kurigram"]),
    ("Chilmari", "Brahmaputra", 25.56, 89.67, ["Kurigram", "Gaibandha"]),
    ("Dalia", "Teesta", 26.15, 89.05, ["Nilphamari", "Lalmonirhat", "Rangpur"]),
    ("Dinajpur", "Punarbhaba", 25.63, 88.64, ["Dinajpur"]),
    ("Naogaon", "Atrai", 24.80, 88.93, ["Naogaon"]),
    ("Bogura", "Bangali", 24.85, 89.37, ["Bogura"]),
    ("Tangail", "Dhaleswari", 24.25, 89.92, ["Tangail"]),
    ("Comilla", "Gumti", 23.46, 91.18, ["Comilla"]),
    ("Feni", "Muhuri", 23.02, 91.40, ["Feni"]),
    ("Chittagong", "Karnaphuli", 22.35, 91.83, ["Chittagong"]),
    ("Bandarban", "Sangu", 22.19, 92.22, ["Bandarban"]),
    ("Khulna", "Rupsa", 22.82, 89.57, ["Khulna", "Bagerhat"]),
    ("Barisal", "Kirtankhola", 22.70, 90.37, ["Barisal"]),
    ("Patuakhali", "Lohalia", 22.36, 90.33, ["Patuakhali"]),
    ("Bhola", "Tentulia", 22.69, 90.65, ["Bhola"]),
]


# Every station district must be a canonical name from DISTRICT_COORDS; a typo
# here would silently drop the station, so complain at import time.
_UNKNOWN = sorted(
    {d for *_, ds in RIVER_STATIONS for d in ds if d not in DISTRICT_COORDS}
)
if _UNKNOWN:
    logger.warning("[FLOOD] RIVER_STATIONS reference unknown districts: %s", _UNKNOWN)


def _label(tier: int) -> str:
    return _TIER_LABELS.get(max(0, min(4, tier)), "Normal")


def _tier_from(value: float | None, table: dict[int, float]) -> int:
    if value is None:
        return 0
    tier = 0
    for t in (1, 2, 3):
        if value >= table[t]:
            tier = t
    return tier


class FloodEWS:
    """Per-district flood assessment from stored rain forecasts + GloFAS discharge."""

    def __init__(
        self, storage: StorageLayer, session: requests.Session | None = None
    ) -> None:
        self._storage = storage
        self._session = session or requests.Session()
        self._river_cache: dict[tuple[float, float], dict] = {}

    # ------------------------------------------------------------------ river
    def prefetch_river(self) -> int:
        """Fetch discharge for every centroid and station in batches (one run per pipeline)."""
        points = list({(lat, lon) for lat, lon in DISTRICT_COORDS.values()})
        points += [(s[2], s[3]) for s in RIVER_STATIONS]
        points = list(dict.fromkeys(points))
        fetched = 0
        for i in range(0, len(points), 20):
            batch = points[i : i + 20]
            try:
                resp = self._session.get(
                    _FLOOD_API,
                    params={
                        "latitude": ",".join(str(p[0]) for p in batch),
                        "longitude": ",".join(str(p[1]) for p in batch),
                        "daily": "river_discharge,river_discharge_max",
                        "forecast_days": _FORECAST_DAYS,
                        "past_days": _PAST_DAYS,
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                docs = data if isinstance(data, list) else [data]
                for pt, doc in zip(batch, docs):
                    daily = doc.get("daily") or {}
                    self._river_cache[pt] = {
                        "time": daily.get("time") or [],
                        "q": daily.get("river_discharge") or [],
                        "qmax": daily.get("river_discharge_max") or [],
                    }
                    fetched += 1
            except Exception as exc:
                logger.warning("[FLOOD] GloFAS batch %d failed: %s", i // 20, exc)
        logger.info(
            "[FLOOD] GloFAS discharge fetched for %d/%d points", fetched, len(points)
        )
        return fetched

    def _river_signal(self, lat: float, lon: float, min_q: float) -> dict | None:
        doc = self._river_cache.get((lat, lon))
        if not doc or not doc["q"]:
            return None
        times, q, qmax = doc["time"], doc["q"], doc["qmax"] or doc["q"]
        split = len(q) - _FORECAST_DAYS
        past = [v for v in q[:split] if v is not None]
        future = [
            (times[i], v)
            for i, v in enumerate(qmax[split:], start=split)
            if v is not None
        ]
        if len(past) < 7 or not future:
            return None
        baseline = statistics.median(past)
        peak_date, peak = max(future, key=lambda kv: kv[1])
        ratio = peak / baseline if baseline > 0 else 0.0
        tier = _tier_from(ratio, _RIVER_RATIO) if peak >= min_q else 0
        return {
            "baseline_m3s": round(baseline, 1),
            "peak_m3s": round(peak, 1),
            "peak_date": peak_date,
            "ratio": round(ratio, 2),
            "tier": tier,
        }

    # ------------------------------------------------------------------- rain
    def _rain_signal(self, location: str) -> dict | None:
        om_doc, bmd_doc = self._storage.get_latest_forecast_pair(location)
        doc = om_doc or bmd_doc
        if not doc:
            return None
        days = doc.get("forecast") or []
        rain = [
            float(((d.get("precipitation") or {}).get("value")) or 0.0) for d in days
        ]
        if not rain:
            return None
        rain_24 = max(rain)
        rain_72 = (
            max(sum(rain[i : i + 3]) for i in range(len(rain)))
            if len(rain) >= 1
            else rain_24
        )
        soil = days[0].get("soil_moisture")
        tier = max(_tier_from(rain_24, _RAIN_24), _tier_from(rain_72, _RAIN_72))
        soil_note = None
        if tier and soil is not None:
            if soil >= _SOIL_SATURATED:
                tier = min(3, tier + 1)
                soil_note = "saturated"
            elif soil <= _SOIL_DRY and tier == 1:
                tier = 0
                soil_note = "dry"
        peak_idx = max(range(len(rain)), key=lambda i: rain[i])
        return {
            "rain_24_mm": round(rain_24, 1),
            "rain_72_mm": round(rain_72, 1),
            "soil_moisture": soil,
            "soil_note": soil_note,
            "peak_date": days[peak_idx].get("date"),
            "source": doc.get("source"),
            "forecast_date": days[0].get("date"),
            "tier": tier,
        }

    # ---------------------------------------------------------------- combine
    def evaluate(self, location: str) -> dict:
        rain = self._rain_signal(location)
        centroid = DISTRICT_COORDS.get(location)
        river_points: list[tuple[str, dict]] = []
        if centroid:
            sig = self._river_signal(centroid[0], centroid[1], _RIVER_MIN_Q_CENTROID)
            if sig:
                river_points.append((f"{location} (local rivers)", sig))
        for name, river, lat, lon, districts in RIVER_STATIONS:
            if location in districts:
                sig = self._river_signal(lat, lon, _RIVER_MIN_Q_STATION)
                if sig:
                    river_points.append((f"{river} at {name}", sig))
        river = (
            max(river_points, key=lambda kv: (kv[1]["tier"], kv[1]["ratio"]))
            if river_points
            else None
        )

        rain_tier = rain["tier"] if rain else 0
        river_tier = river[1]["tier"] if river else 0
        tier = max(rain_tier, river_tier)
        if rain_tier >= 2 and river_tier >= 2:
            tier = min(4, tier + 1)

        triggers: list[str] = []
        if rain and rain_tier:
            triggers.append(
                f"Forecast rainfall {rain['rain_24_mm']:.0f} mm/24 h, {rain['rain_72_mm']:.0f} mm/72 h (peak {rain['peak_date']})"
            )
            if rain.get("soil_note") == "saturated":
                triggers.append(
                    f"Soil already saturated ({rain['soil_moisture']:.2f} m³/m³)"
                )
        if river and river_tier:
            name, sig = river
            triggers.append(
                f"{name}: discharge forecast {sig['peak_m3s']:.0f} m³/s on {sig['peak_date']}, "
                f"{sig['ratio']:.1f}× the 30-day median"
            )
        if not triggers and rain is None and river is None:
            return {}

        label = _label(tier)
        peak_date = (
            river[1]["peak_date"]
            if river and river_tier >= rain_tier
            else (rain or {}).get("peak_date")
        ) or ""
        assessment = {
            "location": location,
            "crop": _CROP,
            "horizon": "short",
            "forecast_date": (rain or {}).get("forecast_date")
            or datetime.now(timezone.utc).date().isoformat(),
            "assessed_at": datetime.now(timezone.utc).isoformat(),
            "tier": tier,
            "tier_label": label,
            "triggers": triggers,
            "peak_date": peak_date,
            "components": {
                "rain": rain,
                "river": {"point": river[0], **river[1]} if river else None,
            },
            "message": self._message(location, tier, label, triggers, peak_date),
        }
        self._storage.upsert_crop_assessment(assessment, _CROP)
        return assessment

    @staticmethod
    def _message(
        location: str, tier: int, label: str, triggers: list[str], peak_date: str
    ) -> str:
        if tier == 0:
            return f"No flood risk expected for {location} in the next 10 days."
        when = f" around {peak_date}" if peak_date else ""
        action = {
            1: "Keep drainage channels clear and monitor updates.",
            2: "Prepare drainage, move stored produce and inputs above flood level.",
            3: "Harvest what can be harvested, protect seed stores and livestock, follow local instructions.",
            4: "Emergency: follow evacuation guidance from local authorities.",
        }[max(1, min(4, tier))]
        return (
            f"Flood {label.lower()} for {location}{when}: "
            + "; ".join(triggers[:2])
            + f". {action}"
        )

    def should_alert(self, assessment: dict) -> bool:
        if not assessment or assessment.get("tier", 0) < 2:
            return False
        return not self._storage.was_crop_alert_sent(
            assessment["location"], _CROP, assessment["tier"], within_hours=12
        )

    def record_alert(self, assessment: dict) -> None:
        self._storage.record_crop_alert_sent(
            assessment["location"],
            _CROP,
            assessment["tier"],
            "frontend_poll",
            assessment.get("forecast_date", ""),
        )
