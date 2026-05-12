"""
PotatoThresholds — loads crop-specific thresholds from the crop profile JSON.

Reads potato_dhaka profile. Disease rules requiring variables not available
in current weather feeds (fog, cloud_cover, soil_temperature) are excluded.
"""
import json
import os
from dataclasses import dataclass

_DEFAULT_PROFILE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "example_crop_profile.json")
)


@dataclass(frozen=True)
class PotatoThresholds:
    temp_min: float
    temp_max: float
    humidity_min: float
    humidity_max: float
    rain_medium: float    # mm/day — "medium" severity
    rain_critical: float  # mm/day — "critical" severity
    wind_max: float


def load_potato_thresholds(path: str = _DEFAULT_PROFILE_PATH) -> PotatoThresholds:
    with open(path) as f:
        raw = json.load(f)["potato_dhaka"]["crop_rules"]

    rain_rules = raw["rainfall_daily"]
    rain_medium   = next(r["min"] for r in rain_rules if r["severity"] == "medium")
    rain_critical = next(r["min"] for r in rain_rules if r["severity"] == "critical")

    return PotatoThresholds(
        temp_min=float(raw["temperature_min"]["min"]),
        temp_max=float(raw["temperature_max"]["max"]),
        humidity_min=float(raw["humidity"]["min"]),
        humidity_max=float(raw["humidity"]["max"]),
        rain_medium=float(rain_medium),
        rain_critical=float(rain_critical),
        wind_max=float(raw["wind_speed_kmh"]["max"]),
    )
