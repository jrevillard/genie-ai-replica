"""
Shared Pydantic schemas for the early warning system.

All weather data — regardless of source (BMD, Open-Meteo, Copernicus) — is
normalised into UnifiedForecast before classification or storage.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Weather data primitives
# ---------------------------------------------------------------------------

class TemperatureData(BaseModel):
    min: float
    max: float
    unit: str = "Celsius"


class PrecipitationData(BaseModel):
    value: float        # mm / day
    probability: float  # 0.0 – 1.0
    unit: str = "mm"


class WindData(BaseModel):
    speed: float                     # km/h (daily max)
    direction: Optional[float] = None  # degrees (0–360), optional


class ExtremeFlags(BaseModel):
    heatwave: bool = False
    heavy_rain: bool = False
    cyclone_risk: bool = False
    drought_risk: bool = False


class DayForecast(BaseModel):
    date: str                                              # ISO 8601 "YYYY-MM-DD"
    temperature: TemperatureData
    precipitation: PrecipitationData
    wind: WindData
    humidity: float                                        # %
    extreme_flags: ExtremeFlags = Field(default_factory=ExtremeFlags)


# ---------------------------------------------------------------------------
# Unified forecast (one document per location × source × horizon)
# ---------------------------------------------------------------------------

class UnifiedForecast(BaseModel):
    location: str                    # Canonical English district name
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    source: str                      # "bmd" | "open_meteo"
    horizon: str                     # "short" (0–7 d) | "long" (8–30 d)
    ingested_at: str                 # ISO 8601 UTC
    forecast: list[DayForecast]
    fallback_used: bool = False           # True when BMD replaced OM after failed sense_check
    sense_check_passed: Optional[bool] = None  # None = check not performed


# ---------------------------------------------------------------------------
# Risk assessment output
# ---------------------------------------------------------------------------

class RiskAssessment(BaseModel):
    location: str
    assessed_at: str                 # ISO 8601 UTC
    horizon: str
    tier: int                        # 0–4
    tier_label: str                  # "Normal" … "Emergency"
    triggers: list[str]              # human-readable trigger descriptions
    reasoning: str
    forecast_source: str
    raw_forecast: dict               # worst DayForecast.model_dump()


# ---------------------------------------------------------------------------
# Tier metadata
# ---------------------------------------------------------------------------

TIER_LABELS: dict[int, str] = {
    0: "Normal",
    1: "Advisory",
    2: "Warning",
    3: "Severe",
    4: "Emergency",
}

TIER_COLOURS: dict[int, str] = {
    0: "green",
    1: "yellow",
    2: "orange",
    3: "red",
    4: "purple",
}
