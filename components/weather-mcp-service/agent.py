"""
WeatherAgent — orchestrates the full query pipeline:
  1. Intent extraction  (Gemma-3-4b-it via vllm-translation-guardrail)
  2. District resolution (_find_district — local lookup, no Mapbox)
  3. Forecast fetch     (ArangoDB cache only — scheduler pre-fills all 64 districts hourly)
  4. Risk classification (RiskEngine — stateless Tier 0–4)
  5. Explanation        (Gemma-3-4b-it via vllm-translation-guardrail)
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal, Optional

from openai import AsyncOpenAI
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

_INVALID_LOCATIONS = {"n/a", "none", "null", "unknown", "", "not specified", "not mentioned"}


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

        vllm_base = os.getenv("VLLM_TRANSLATION_ENDPOINT", "http://vllm-translation-guardrail:9031")
        self.llm   = AsyncOpenAI(base_url=f"{vllm_base}/v1", api_key="EMPTY")
        self.model = os.getenv("VLLM_TRANSLATION_MODEL_ID", "google/gemma-3-4b-it")

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
        try:
            intent = await self._extract_intent(query)
        except ValueError as exc:
            logger.warning("[AGENT] Intent rejected: %s", exc)
            return {
                "answer":     str(exc),
                "risk_tier":  0,
                "risk_label": "No Risk",
                "advisory":   "",
                "triggers":   [],
                "buffer":     None,
                "location":   "",
                "forecast":   {},
            }

        logger.info(
            "[AGENT] Intent extracted — location=%r  context=%s  forecast_days=%d",
            intent.location, intent.user_context, intent.forecast_days,
        )

        # Step 2: Resolve district from location string (local lookup, no Mapbox)
        from mcp_weather.tools.weather_forecast import _find_district
        district = _find_district(intent.location)
        if not district:
            logger.warning("[AGENT] _find_district returned None for %r", intent.location)
            answer = (
                f"I couldn't find a matching Bangladesh district for \"{intent.location}\". "
                "Please specify a district name (e.g. Dhaka, Sylhet, Barisal, Chittagong)."
            )
            return {
                "answer":     answer,
                "risk_tier":  0,
                "risk_label": "No Risk",
                "advisory":   "",
                "triggers":   [],
                "buffer":     None,
                "location":   intent.location,
                "forecast":   {},
            }

        logger.info("[AGENT] District resolved: %r → %r", intent.location, district)
        geo = {"district": district, "display_name": intent.location}

        # Step 3: Forecast from ArangoDB cache (scheduler fills all 64 districts hourly)
        logger.info("[AGENT] Fetching cached forecast for district=%r …", district)
        forecast_data, unified_forecast = await self._get_forecast(district, intent.forecast_days)
        if forecast_data is None:
            answer = (
                f"Forecast data for {district} is not yet available — "
                "the data pipeline refreshes hourly. Please try again shortly."
            )
            return {
                "answer":     answer,
                "risk_tier":  0,
                "risk_label": "No Risk",
                "advisory":   "",
                "triggers":   [],
                "buffer":     None,
                "location":   district,
                "forecast":   {},
            }

        # Step 4: Risk classification
        logger.debug("[AGENT] Running risk classification …")
        risk_assessment = self._classify(unified_forecast, forecast_data, district)
        logger.info(
            "[AGENT] Risk result — tier=%d (%s)  triggers=%d  source=%s",
            risk_assessment.tier, risk_assessment.tier_label,
            len(risk_assessment.triggers), risk_assessment.forecast_source,
        )
        if risk_assessment.triggers:
            for t in risk_assessment.triggers:
                logger.info("[AGENT]   trigger: %s", t)

        # Step 5: Generate explanation
        logger.debug("[AGENT] Generating explanation …")
        answer = await self._generate_explanation(query, intent, geo, forecast_data, risk_assessment)
        logger.info("[AGENT] Explanation generated — length=%d chars", len(answer))

        result = {
            "answer":     answer,
            "risk_tier":  risk_assessment.tier,
            "risk_label": risk_assessment.tier_label,
            "advisory":   risk_assessment.reasoning,
            "triggers":   risk_assessment.triggers,
            "buffer":     None,
            "location":   district,
            "forecast":   forecast_data,
        }

        logger.info(
            "[AGENT] ── Response ready — location=%r  tier=%d (%s) ──",
            result["location"], result["risk_tier"], result["risk_label"],
        )
        return result

    # ------------------------------------------------------------------
    # Forecast retrieval — cache only
    # ------------------------------------------------------------------

    async def _get_forecast(
        self, district: str, forecast_days: int
    ) -> tuple[dict | None, UnifiedForecast | None]:
        """
        Return (legacy_dict, unified_forecast) from ArangoDB cache only.
        Returns (None, None) if no fresh data is available (triggers a clean user message).
        The scheduler pre-populates all 64 districts every hour; live scraping is not needed.
        """
        if self.storage:
            logger.debug("[AGENT] Checking ArangoDB cache for %r (max_age=6h) …", district)
            try:
                stored = self.storage.get_latest_forecast(
                    district, horizon="short", max_age_hours=6
                )
                if stored:
                    # Slice to the requested horizon so the LLM gets the exact window
                    stored.forecast = stored.forecast[:forecast_days]
                    logger.info(
                        "[AGENT] Cache HIT — source=%s  ingested_at=%s  days_available=%d  days_served=%d",
                        stored.source, stored.ingested_at,
                        len(stored.forecast), len(stored.forecast),
                    )
                    return self._unified_to_legacy(stored), stored
                else:
                    logger.warning("[AGENT] Cache MISS — no fresh forecast for %r", district)
                    return None, None
            except Exception as exc:
                logger.error(
                    "[AGENT] ArangoDB lookup failed for %r (%s: %s)",
                    district, type(exc).__name__, exc,
                )
                return None, None
        else:
            logger.warning("[AGENT] Storage not available — cannot serve forecast")
            return None, None

    # ------------------------------------------------------------------
    # Classification
    # ------------------------------------------------------------------

    def _classify(
        self,
        unified: UnifiedForecast | None,
        forecast_data: dict,
        district: str,
    ) -> RiskAssessment:
        if unified is None:
            logger.warning(
                "[AGENT] unified_forecast is None for %r — rebuilding from legacy dict", district
            )
            unified = self._bmd_to_unified(forecast_data, district)
        return self.risk_engine.classify(unified)

    # ------------------------------------------------------------------
    # Explanation — Gemma-3-4b-it
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Weather emoji / visual strip helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _weather_condition(params: dict) -> tuple[str, str]:
        """Return (emoji, label) for the overall sky condition of a single day."""
        pr       = params.get("precipitation", {}) or {}
        rain_mm  = float(pr.get("value", 0) or 0)
        rain_p   = float(pr.get("probability", 0) or 0)
        humidity = float((params.get("humidity", {}) or {}).get("value", 0) or 0)

        if rain_mm >= 25 or (rain_mm >= 10 and rain_p >= 0.7):
            return "⛈", "Thunderstorm"
        if rain_mm >= 10 or rain_p >= 0.6:
            return "🌧", "Rain"
        if rain_mm >= 2 or rain_p >= 0.35:
            return "🌦", "Showers"
        if humidity >= 80 or rain_p >= 0.2:
            return "⛅", "Partly Cloudy"
        if humidity >= 60 or rain_p >= 0.1:
            return "🌤", "Mostly Clear"
        return "☀️", "Clear"

    @staticmethod
    def _wind_emoji(speed_kmh: float) -> str:
        if speed_kmh >= 62:   return "🌪️"   # storm / cyclone
        if speed_kmh >= 30:   return "💨"    # strong / windy
        if speed_kmh >= 15:   return "🌬️"   # breezy
        return "😌"                           # calm

    @staticmethod
    def _soil_emoji(sm: float) -> str:
        """sm is volumetric water content in m³/m³."""
        if sm >= 0.40:  return "🌊"   # saturated
        if sm >= 0.25:  return "💧"   # wet / field capacity
        if sm >= 0.10:  return "🌱"   # moist — good for crops
        return "🌵"                    # dry / drought risk

    @staticmethod
    def _build_forecast_strip(days: list) -> str:
        """Build a compact per-day visual strip in markdown list format."""
        from datetime import datetime as _dt
        lines = []
        for d in days:
            date_str = d.get("date", "")
            try:
                date_label = _dt.strptime(date_str, "%Y-%m-%d").strftime("%a %d %b")
            except ValueError:
                date_label = date_str

            p     = d.get("parameters", {})
            sky_emoji, _ = WeatherAgent._weather_condition(p)

            t    = p.get("temperature", {}) or {}
            pr   = p.get("precipitation", {}) or {}
            wind = p.get("wind", {}) or {}
            sm   = p.get("soil_moisture", {}) or {}

            t_min     = t.get("min", "?")
            t_max     = t.get("max", "?")
            rain      = float(pr.get("value", 0) or 0)
            prob      = int(float(pr.get("probability", 0) or 0) * 100)
            wind_spd  = float(wind.get("speed", 0) or 0)
            soil_val  = sm.get("value")

            wind_part = f" · {WeatherAgent._wind_emoji(wind_spd)} {wind_spd:.0f} km/h" if wind_spd else ""
            soil_part = (
                f" · {WeatherAgent._soil_emoji(soil_val)} {soil_val:.2f} m³/m³"
                if soil_val is not None else ""
            )

            lines.append(
                f"- {sky_emoji} **{date_label}** — {t_min}–{t_max}°C"
                f" · 💧 {rain:.0f}mm ({prob}%){wind_part}{soil_part}"
            )
        return "---\n\n**Daily outlook:**\n" + "\n".join(lines)

    async def _generate_explanation(
        self,
        query: str,
        intent: WeatherIntent,
        geo: dict,
        forecast_data: dict,
        risk_assessment: RiskAssessment,
    ) -> str:
        days = forecast_data.get("forecast", [])
        n_days = len(days)
        ctx = "a farmer planning agricultural activities" if intent.user_context == "FARMER" else "a citizen"
        location_name = geo.get("display_name", intent.location)

        # Build a compact, structured per-day summary the LLM can annotate.
        # We never let the LLM write the duration framing — we inject it ourselves.
        day_lines = []
        for d in days:
            date = d.get("date", "")
            p    = d.get("parameters", {})
            t    = p.get("temperature", {})
            pr   = p.get("precipitation", {})
            hum  = p.get("humidity", {})
            day_lines.append(
                f"  {date}: {t.get('min')}–{t.get('max')}°C, "
                f"rain {pr.get('value', 0):.1f}mm ({int(pr.get('probability', 0)*100)}%), "
                f"humidity {hum.get('value', '?')}%"
            )
        day_summary = "\n".join(day_lines)

        risk_context = ""
        if risk_assessment.tier >= 1:
            risk_context = (
                f"\nRisk level: Tier {risk_assessment.tier} ({risk_assessment.tier_label}). "
                f"Triggers: {'; '.join(risk_assessment.triggers)}. "
                "Add a short advisory.\n"
            )

        prompt = (
            f"You are a weather assistant. Describe the weather conditions below for {ctx}.\n"
            f"Location: {location_name}\n"
            f"Data covers {n_days} days:\n"
            f"{day_summary}\n"
            f"{risk_context}\n"
            "Write 2–4 sentences summarising temperatures, rain, and one practical tip. "
            "Do NOT mention any number of days or time period — just describe the conditions and advice."
        )

        # Header and availability note are set programmatically — never by the LLM
        requested = intent.forecast_days
        if requested > n_days:
            availability_note = (
                f"**Note:** You requested {requested} days but forecast data is only available "
                f"for the next {n_days} days. For extended outlooks beyond {n_days} days please "
                "check the Bangladesh Meteorological Department directly.\n\n"
            )
        else:
            availability_note = ""

        header = f"**{location_name} — {n_days}-day forecast**\n\n"

        # Build the visual strip once — deterministic, no LLM needed
        strip = self._build_forecast_strip(days) if days else ""

        logger.debug(
            "[AGENT] Explanation prompt — model=%s  tier=%d  n_days=%d  requested=%d",
            self.model, risk_assessment.tier, n_days, requested,
        )

        try:
            response = await self.llm.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.2,
            )
            body = (response.choices[0].message.content or "").strip()
            logger.debug("[AGENT] Explanation call succeeded")
            return header + availability_note + body + ("\n\n" + strip if strip else "")

        except Exception as exc:
            logger.error(
                "[AGENT] Explanation generation failed (%s: %s) — using template fallback",
                type(exc).__name__, exc,
            )
            try:
                first = days[0]["parameters"]
                t_min = first["temperature"]["min"]
                t_max = first["temperature"]["max"]
                rain  = first["precipitation"]["value"]
                tier_note = (
                    f" Risk: {risk_assessment.tier_label}."
                    if risk_assessment.tier >= 1 else ""
                )
                body = (
                    f"Temperatures between {t_min}°C and {t_max}°C, "
                    f"approximately {rain:.1f} mm of rain expected.{tier_note}"
                )
                return header + availability_note + body + ("\n\n" + strip if strip else "")
            except Exception as inner_exc:
                logger.error("[AGENT] Template fallback also failed: %s", inner_exc)
                return header + availability_note + "Forecast data retrieved. (Explanation unavailable.)"

    # ------------------------------------------------------------------
    # Intent extraction — Gemma-3-4b-it
    # ------------------------------------------------------------------

    async def _extract_intent(self, query: str) -> WeatherIntent:
        """
        Extract location, user_context, and forecast_days from the query.
        Raises ValueError if no valid location is found (prevents pipeline from
        proceeding with 'N/A' or 'None' as the district).
        """
        logger.debug("[AGENT] Extracting intent via %s …", self.model)
        system = (
            "Extract the weather query intent. "
            "Return valid JSON with exactly these keys: "
            "location (string — a Bangladesh district name, or null if none mentioned), "
            "user_context (FARMER or CITIZEN), "
            "forecast_days (integer 1-7). "
            "Return only JSON, no markdown."
        )
        user = f"User message: {query}"

        try:
            response = await self.llm.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
                max_tokens=80,
                temperature=0,
            )
            raw = (response.choices[0].message.content or "").strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            raw = raw.strip()
            logger.debug("[AGENT] Intent raw response: %s", raw[:120])
            data = json.loads(raw)
            location = (data.get("location") or "").strip()
            if not location or location.lower() in _INVALID_LOCATIONS:
                raise ValueError(
                    "Your question doesn't mention a specific location. "
                    "Please include a Bangladesh district name — for example: "
                    "\"What is the weather in Dhaka tomorrow?\""
                )
            return WeatherIntent(
                location=location,
                user_context=data.get("user_context", "CITIZEN"),
                forecast_days=max(1, min(14, int(data.get("forecast_days", 3)))),
            )
        except ValueError:
            raise
        except Exception as exc:
            logger.warning(
                "[AGENT] Intent extraction failed (%s: %s) — falling back to raw query as location",
                type(exc).__name__, exc,
            )
            # Fallback: treat entire query as location attempt; _find_district will gate it
            return WeatherIntent(location=query[:100], user_context="CITIZEN", forecast_days=3)

    # ------------------------------------------------------------------
    # Format converters
    # ------------------------------------------------------------------

    @staticmethod
    def _unified_to_legacy(stored: UnifiedForecast) -> dict:
        """Convert UnifiedForecast → legacy BMD dict."""
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
                        "humidity":      {"value": day.humidity, "unit": "percent"},
                        "wind":          {"speed": day.wind.speed, "unit": "km/h"},
                        "soil_moisture": {"value": day.soil_moisture, "unit": "m3/m3"},
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
