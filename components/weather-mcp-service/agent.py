"""
WeatherAgent — orchestrates the full query pipeline:
  1. Intent extraction  (Gemini flash-lite)
  2. Geocoding          (Mapbox MCP, with BMD district fallback)
  3. Buffer creation    (weather MCP — buffer_point tool)
  4. Forecast fetch     (stored forecast if fresh; live BMD scrape via MCP otherwise)
  5. Risk classification (RiskEngine — stateless Tier 0–4)
  6. Explanation        (Gemini flash — tier-aware prompt)
"""
import json
import os
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal, Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

from mcp_client import MCPClientManager
from models import (
    DayForecast,
    ExtremeFlags,
    PrecipitationData,
    RiskAssessment,
    TemperatureData,
    UnifiedForecast,
    WindData,
)
from risk_engine import RiskEngine

if TYPE_CHECKING:
    from storage import StorageLayer


class WeatherIntent(BaseModel):
    location: str
    user_context: Literal["FARMER", "CITIZEN"]
    forecast_days: int  # 1–7


class WeatherAgent:
    def __init__(
        self,
        mcp_manager: MCPClientManager,
        storage: Optional["StorageLayer"] = None,
    ) -> None:
        self.mcp         = mcp_manager
        self.storage     = storage
        self.risk_engine = RiskEngine()

        api_key = os.getenv("GOOGLE_API_KEY")
        self.client           = genai.Client(api_key=api_key)
        self.flash_lite_model = "gemini-2.5-flash-lite"
        self.flash_model      = "gemini-2.5-flash"

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def run(self, query: str) -> dict:
        """
        Execute the full pipeline for a natural-language weather query.

        Returns a dict with keys:
          answer, risk_tier, risk_label, advisory, triggers,
          buffer, location, forecast
        """
        # Step 1: Extract intent
        intent = await self._extract_intent(query)

        # Step 2: Geocode — fall back to direct district lookup if Mapbox fails
        buffer_geojson = None
        try:
            geo = await self.mcp.geocode_location(intent.location)

            # Step 3: Geodesic buffer (only when we have real coordinates)
            radius_km = 15.0 if intent.user_context == "FARMER" else 20.0
            buffer_json_str = await self.mcp.call_weather_tool("buffer_point", {
                "latitude":  geo["latitude"],
                "longitude": geo["longitude"],
                "radius_km": radius_km,
            })
            buffer_geojson = json.loads(buffer_json_str)

        except Exception:
            from mcp_weather.tools.weather_forecast import _find_district
            district = _find_district(intent.location) or intent.location
            geo = {
                "longitude":    0.0,
                "latitude":     0.0,
                "district":     district,
                "display_name": intent.location,
            }

        # Step 4: Forecast — prefer fresh stored data; fall back to live BMD scrape
        forecast_data, unified_forecast = await self._get_forecast(
            geo["district"], intent.forecast_days
        )

        # Step 5: Risk classification
        risk_assessment = self._classify(unified_forecast, forecast_data, geo["district"])

        # Step 6: Generate explanation (tier-aware)
        answer = await self._generate_explanation(query, intent, geo, forecast_data, risk_assessment)

        return {
            "answer":     answer,
            "risk_tier":  risk_assessment.tier,
            "risk_label": risk_assessment.tier_label,
            "advisory":   risk_assessment.reasoning,
            "triggers":   risk_assessment.triggers,
            "buffer": (
                {"type": "Feature", "geometry": buffer_geojson, "properties": {}}
                if buffer_geojson else None
            ),
            "location": geo.get("display_name", intent.location),
            "forecast": forecast_data,
        }

    # ------------------------------------------------------------------
    # Forecast retrieval
    # ------------------------------------------------------------------

    async def _get_forecast(
        self, district: str, forecast_days: int
    ) -> tuple[dict, UnifiedForecast | None]:
        """
        Return (legacy_bmd_dict, unified_forecast_or_None).

        Tries stored forecast first (≤6 h old).  If absent or stale, fetches
        live from the BMD BAMIS MCP tool and converts both ways.
        """
        # Try stored forecast
        if self.storage:
            try:
                stored = self.storage.get_latest_forecast(
                    district, horizon="short", max_age_hours=6
                )
                if stored:
                    return self._unified_to_legacy(stored), stored
            except Exception as exc:
                # Storage failure is non-fatal — fall through to live fetch
                pass

        # Live BMD scrape via MCP stdio
        forecast_str = await self.mcp.call_weather_tool("retrieve_weather_forecast", {
            "district_name": district,
            "forecast_days": forecast_days,
            "parameters":    ["temperature", "precipitation", "humidity"],
        })
        forecast_data = json.loads(forecast_str)

        # Convert to UnifiedForecast for the risk engine
        unified = self._bmd_to_unified(forecast_data, district)
        return forecast_data, unified

    # ------------------------------------------------------------------
    # Classification
    # ------------------------------------------------------------------

    def _classify(
        self,
        unified: UnifiedForecast | None,
        forecast_data: dict,
        district: str,
    ) -> RiskAssessment:
        """
        Run the RiskEngine.  If unified is None (e.g. BMD error), build a
        minimal UnifiedForecast from the legacy dict and classify that.
        """
        if unified is None:
            unified = self._bmd_to_unified(forecast_data, district)
        return self.risk_engine.classify(unified)

    # ------------------------------------------------------------------
    # Explanation
    # ------------------------------------------------------------------

    async def _generate_explanation(
        self,
        query: str,
        intent: WeatherIntent,
        geo: dict,
        forecast_data: dict,
        risk_assessment: RiskAssessment,
    ) -> str:
        forecast_json = json.dumps(forecast_data, indent=2)
        ctx = "a farmer planning agricultural activities" if intent.user_context == "FARMER" else "a citizen"

        risk_context = ""
        if risk_assessment.tier >= 1:
            risk_context = (
                f"\n\nRisk classification: Tier {risk_assessment.tier} "
                f"({risk_assessment.tier_label}). "
                f"Key triggers: {'; '.join(risk_assessment.triggers)}.\n"
                "Include a clear advisory based on the risk tier in your response."
            )

        prompt = (
            f"The user asked: \"{query}\"\n"
            f"They are {ctx} in {geo.get('display_name', intent.location)}.\n"
            f"Here is the official Bangladesh Meteorological Department forecast:\n{forecast_json}"
            f"{risk_context}\n\n"
            "Write a clear, concise, helpful weather explanation in English. "
            "Include temperature range, rain outlook, and any practical advice relevant to the user context."
        )
        try:
            response = self.client.models.generate_content(
                model=self.flash_model,
                contents=prompt,
            )
            return response.text
        except Exception as exc:
            # Template fallback — never fail silently
            try:
                day = forecast_data["forecast"][0]["parameters"]
                t_min = day["temperature"]["min"]
                t_max = day["temperature"]["max"]
                rain  = day["precipitation"]["value"]
                loc   = forecast_data.get("location", {}).get("area_name", intent.location)
                tier_note = (
                    f" [Risk: {risk_assessment.tier_label}]"
                    if risk_assessment.tier >= 1 else ""
                )
                return (
                    f"Weather forecast for {loc}{tier_note}: temperatures between "
                    f"{t_min}°C and {t_max}°C, "
                    f"with approximately {rain:.1f} mm of precipitation expected."
                )
            except Exception:
                return f"Weather forecast retrieved for {intent.location}. (AI explanation unavailable: {exc})"

    # ------------------------------------------------------------------
    # Intent extraction
    # ------------------------------------------------------------------

    async def _extract_intent(self, query: str) -> WeatherIntent:
        prompt = (
            "Extract the weather query intent from the user message. "
            "Return JSON with keys: location (string), user_context (FARMER or CITIZEN), "
            f"forecast_days (integer 1-7).\n\nUser message: {query}"
        )
        try:
            response = self.client.models.generate_content(
                model=self.flash_lite_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=WeatherIntent,
                ),
            )
            return WeatherIntent.model_validate_json(response.text)
        except Exception:
            return WeatherIntent(location=query, user_context="CITIZEN", forecast_days=3)

    # ------------------------------------------------------------------
    # Format converters
    # ------------------------------------------------------------------

    @staticmethod
    def _unified_to_legacy(stored: UnifiedForecast) -> dict:
        """Convert UnifiedForecast → legacy BMD dict (used by Gemini prompt)."""
        return {
            "location": {"area_name": stored.location},
            "forecast": [
                {
                    "date": day.date,
                    "parameters": {
                        "temperature":  {
                            "min":  day.temperature.min,
                            "max":  day.temperature.max,
                            "unit": "Celsius",
                        },
                        "precipitation": {
                            "value":       day.precipitation.value,
                            "unit":        "mm",
                            "probability": day.precipitation.probability,
                        },
                        "humidity": {"value": day.humidity, "unit": "percent"},
                    },
                }
                for day in stored.forecast
            ],
        }

    @staticmethod
    def _bmd_to_unified(forecast_data: dict, district: str) -> UnifiedForecast:
        """Convert legacy BMD dict → UnifiedForecast for the risk engine."""
        days: list[DayForecast] = []
        for day in forecast_data.get("forecast", []):
            p    = day["parameters"]
            temp = p["temperature"]
            rain = p["precipitation"]
            hum  = p["humidity"]["value"]
            days.append(DayForecast(
                date=day["date"],
                temperature=TemperatureData(min=temp["min"], max=temp["max"]),
                precipitation=PrecipitationData(
                    value=rain["value"], probability=rain["probability"]
                ),
                wind=WindData(speed=0.0),
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
            ingested_at=datetime.now(timezone.utc).isoformat(),
            forecast=days,
        )
