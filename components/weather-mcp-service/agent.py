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
import logging
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

logger = logging.getLogger(__name__)


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
        logger.info("[AGENT] ── New query ──────────────────────────────────")
        logger.info("[AGENT] Raw query: %r", query)

        # Step 1: Extract intent
        intent = await self._extract_intent(query)
        logger.info(
            "[AGENT] Intent extracted — location=%r  context=%s  forecast_days=%d",
            intent.location, intent.user_context, intent.forecast_days,
        )

        # Step 2: Geocode — fall back to direct district lookup if Mapbox fails
        buffer_geojson = None
        try:
            logger.debug("[AGENT] Geocoding %r via Mapbox …", intent.location)
            geo = await self.mcp.geocode_location(intent.location)
            logger.info(
                "[AGENT] Geocode OK — district=%r  lat=%.4f  lon=%.4f  display=%r",
                geo.get("district"), geo.get("latitude"), geo.get("longitude"),
                geo.get("display_name"),
            )

            # Step 3: Geodesic buffer
            radius_km = 15.0 if intent.user_context == "FARMER" else 20.0
            logger.debug("[AGENT] Creating buffer (radius=%.1f km) …", radius_km)
            buffer_json_str = await self.mcp.call_weather_tool("buffer_point", {
                "latitude":  geo["latitude"],
                "longitude": geo["longitude"],
                "radius_km": radius_km,
            })
            buffer_geojson = json.loads(buffer_json_str)
            logger.debug("[AGENT] Buffer created — type=%s", buffer_geojson.get("type"))

        except Exception as exc:
            logger.warning(
                "[AGENT] Mapbox geocode failed (%s: %s) — "
                "coordinates unavailable, using district name lookup for forecast routing "
                "(forecast data will still be fetched from cache or BMD normally)",
                type(exc).__name__, exc,
            )
            from mcp_weather.tools.weather_forecast import _find_district
            district = _find_district(intent.location) or intent.location
            geo = {
                "longitude":    0.0,
                "latitude":     0.0,
                "district":     district,
                "display_name": intent.location,
            }
            logger.info(
                "[AGENT] District resolved to %r (no coordinates — buffer polygon skipped)",
                district,
            )

        # Step 4: Forecast — prefer fresh stored data; fall back to live BMD scrape
        logger.info("[AGENT] Fetching forecast for district=%r …", geo["district"])
        forecast_data, unified_forecast = await self._get_forecast(
            geo["district"], intent.forecast_days
        )

        # Step 5: Risk classification
        logger.debug("[AGENT] Running risk classification …")
        risk_assessment = self._classify(unified_forecast, forecast_data, geo["district"])
        logger.info(
            "[AGENT] Risk result — tier=%d (%s)  triggers=%d  source=%s",
            risk_assessment.tier, risk_assessment.tier_label,
            len(risk_assessment.triggers), risk_assessment.forecast_source,
        )
        if risk_assessment.triggers:
            for t in risk_assessment.triggers:
                logger.info("[AGENT]   trigger: %s", t)

        # Step 6: Generate explanation (tier-aware)
        logger.debug("[AGENT] Generating Gemini explanation …")
        answer = await self._generate_explanation(query, intent, geo, forecast_data, risk_assessment)
        logger.info("[AGENT] Explanation generated — length=%d chars", len(answer))
        logger.debug("[AGENT] Answer preview: %s", answer[:200].replace("\n", " "))

        result = {
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

        logger.info(
            "[AGENT] ── Response ready — location=%r  tier=%d (%s) ──",
            result["location"], result["risk_tier"], result["risk_label"],
        )
        return result

    # ------------------------------------------------------------------
    # Forecast retrieval
    # ------------------------------------------------------------------

    async def _get_forecast(
        self, district: str, forecast_days: int
    ) -> tuple[dict, UnifiedForecast | None]:
        """
        Return (legacy_bmd_dict, unified_forecast_or_None).

        Tries stored forecast first (<=6 h old).  If absent or stale, fetches
        live from the BMD BAMIS MCP tool and converts both ways.
        """
        # Try stored forecast
        if self.storage:
            logger.debug("[AGENT] Checking ArangoDB cache for %r (max_age=6h) …", district)
            try:
                stored = self.storage.get_latest_forecast(
                    district, horizon="short", max_age_hours=6
                )
                if stored:
                    age_note = f"source={stored.source}  ingested_at={stored.ingested_at}"
                    logger.info(
                        "[AGENT] Cache HIT — using stored forecast for %r (%s  days=%d)",
                        district, age_note, len(stored.forecast),
                    )
                    return self._unified_to_legacy(stored), stored
                else:
                    logger.info(
                        "[AGENT] Cache MISS — no fresh forecast in ArangoDB for %r", district
                    )
            except Exception as exc:
                logger.warning(
                    "[AGENT] ArangoDB lookup failed for %r (%s: %s) — falling back to live BMD",
                    district, type(exc).__name__, exc,
                )
        else:
            logger.info("[AGENT] Storage not available — skipping cache, going direct to BMD")

        # Live BMD scrape via MCP stdio
        logger.info("[AGENT] Fetching live BMD forecast for %r (days=%d) …", district, forecast_days)
        try:
            forecast_str = await self.mcp.call_weather_tool("retrieve_weather_forecast", {
                "district_name": district,
                "forecast_days": forecast_days,
                "parameters":    ["temperature", "precipitation", "humidity"],
            })
            forecast_data = json.loads(forecast_str)

            if "error" in forecast_data:
                logger.error(
                    "[AGENT] BMD scraper returned an error for %r: %s",
                    district, forecast_data["error"],
                )
            else:
                day_count = len(forecast_data.get("forecast", []))
                logger.info(
                    "[AGENT] BMD fetch OK — %r  days=%d",
                    district, day_count,
                )
                if day_count > 0:
                    first = forecast_data["forecast"][0]["parameters"]
                    logger.debug(
                        "[AGENT] BMD day[0] — temp=%.1f–%.1f°C  rain=%.1fmm",
                        first["temperature"]["min"],
                        first["temperature"]["max"],
                        first["precipitation"]["value"],
                    )

            unified = self._bmd_to_unified(forecast_data, district)
            return forecast_data, unified

        except Exception as exc:
            logger.error(
                "[AGENT] BMD live fetch failed for %r (%s: %s)",
                district, type(exc).__name__, exc,
            )
            raise

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
            logger.warning(
                "[AGENT] unified_forecast is None for %r — rebuilding from legacy dict", district
            )
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

        logger.debug(
            "[AGENT] Gemini prompt — model=%s  tier=%d  prompt_chars=%d",
            self.flash_model, risk_assessment.tier, len(prompt),
        )

        try:
            response = self.client.models.generate_content(
                model=self.flash_model,
                contents=prompt,
            )
            logger.debug("[AGENT] Gemini call succeeded")
            return response.text

        except Exception as exc:
            logger.error(
                "[AGENT] Gemini explanation failed (%s: %s) — using template fallback",
                type(exc).__name__, exc,
            )
            # Template fallback — never fail silently
            try:
                day   = forecast_data["forecast"][0]["parameters"]
                t_min = day["temperature"]["min"]
                t_max = day["temperature"]["max"]
                rain  = day["precipitation"]["value"]
                loc   = forecast_data.get("location", {}).get("area_name", intent.location)
                tier_note = (
                    f" [Risk: {risk_assessment.tier_label}]"
                    if risk_assessment.tier >= 1 else ""
                )
                fallback = (
                    f"Weather forecast for {loc}{tier_note}: temperatures between "
                    f"{t_min}°C and {t_max}°C, "
                    f"with approximately {rain:.1f} mm of precipitation expected."
                )
                logger.info("[AGENT] Template fallback used: %s", fallback)
                return fallback
            except Exception as inner_exc:
                logger.error("[AGENT] Template fallback also failed: %s", inner_exc)
                return f"Weather forecast retrieved for {intent.location}. (AI explanation unavailable: {exc})"

    # ------------------------------------------------------------------
    # Intent extraction
    # ------------------------------------------------------------------

    async def _extract_intent(self, query: str) -> WeatherIntent:
        logger.debug("[AGENT] Extracting intent via Gemini (%s) …", self.flash_lite_model)
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
            intent = WeatherIntent.model_validate_json(response.text)
            logger.debug(
                "[AGENT] Intent parse OK — raw response: %s", response.text[:120]
            )
            return intent
        except Exception as exc:
            logger.warning(
                "[AGENT] Intent extraction failed (%s: %s) — using raw query as location",
                type(exc).__name__, exc,
            )
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
