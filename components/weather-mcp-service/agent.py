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

from defaults import DEFAULT_LOCATION as _DEFAULT_DISTRICT
from defaults import EWS_CROPS as _EWS_CROPS
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
from openai import AsyncOpenAI
from pydantic import BaseModel
from risk_engine import RiskEngine

if TYPE_CHECKING:
    from storage import StorageLayer

logger = logging.getLogger(__name__)

_INVALID_LOCATIONS = {
    "n/a",
    "none",
    "null",
    "unknown",
    "",
    "not specified",
    "not mentioned",
}

# Spelling variants the LLM may canonicalise, so "Chattogram" in the query still
# counts as a mention of the canonical "Chittagong".
_DISTRICT_ALIASES: dict[str, str] = {
    "chattogram": "Chittagong",
    "cumilla": "Comilla",
    "barishal": "Barisal",
    "bogra": "Bogura",
    "jessore": "Jashore",
    "coxs bazar": "Cox's Bazar",
}


def _district_in_text(text: str) -> str | None:
    """
    Canonical district named anywhere in ``text`` (English, alias or Bengali),
    longest match first so "Cox's Bazar" wins over shorter fragments. None when
    the text names no district - the caller then uses the deployment default.
    """
    from mcp_weather.tools.weather_forecast import BENGALI_TO_ENGLISH

    q = text.lower()
    candidates: list[tuple[str, str]] = [
        (name.lower(), name) for name in BENGALI_TO_ENGLISH.values()
    ]
    # The deployment default may be an upazila or town outside the 64-district
    # table (e.g. Sapahar); the ingestor stores forecasts for it all the same.
    candidates.append((_DEFAULT_DISTRICT.lower(), _DEFAULT_DISTRICT))
    candidates += list(BENGALI_TO_ENGLISH.items())
    candidates += list(_DISTRICT_ALIASES.items())
    for needle, canon in sorted(candidates, key=lambda kv: -len(kv[0])):
        if needle and needle in q:
            return canon
    return None


# District used when the farmer names no place at all ("will it rain this week?").
# The seasonal, drought and flood branches in main.py already default this way;
# without it the agent path was the only one that refused to answer.
# Shared deployment default: _DEFAULT_DISTRICT (DEFAULT_LOCATION, see defaults.py).

# Crop whose stored assessment grounds the agricultural tip. Only crops with a
# profile in the warning_system_engine produce assessments; the rest return "".
# Crops the weather explanation reports on. Defaults to every crop the engine
# watches (EWS_CROPS); WEATHER_ADVISORY_CROP narrows it to a comma-separated subset.
_ADVISORY_CROPS: list[str] = [
    c.strip() for c in os.getenv("WEATHER_ADVISORY_CROP", "").split(",") if c.strip()
] or list(_EWS_CROPS)


class WeatherIntent(BaseModel):
    location: str
    user_context: Literal["FARMER", "CITIZEN"]
    forecast_days: int  # 1–7


# Language names for the explanation prompt (ISO 639-1 -> name the LLM knows).
_LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "bn": "Bengali (Bangla)",
}

# Programmatic header / note strings per UI language. The LLM never writes
# these, so they are localised here; unknown languages fall back to English.
_BENGALI_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def _localized_district_name(english_name: str, language: str) -> str:
    """District name in the UI language; falls back to the English name."""
    if language == "bn":
        try:
            from mcp_weather.tools.weather_forecast import BENGALI_TO_ENGLISH

            for bn, en in BENGALI_TO_ENGLISH.items():
                if en.lower() == (english_name or "").lower():
                    return bn
        except Exception:  # pragma: no cover - map missing in a stripped build
            pass
    return english_name


_UI_STRINGS: dict[str, dict] = {
    "en": {
        "header": "**{location} — {n_days}-day forecast**\n\n",
        "daily_outlook": "Daily outlook",
        "weekdays": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        "months": [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ],
        "soil": {
            "saturated": "saturated",
            "wet": "wet",
            "moist": "moist",
            "dry": "dry",
        },
        "speed_unit": "km/h",
        "digits": None,
        "availability_note": (
            "**Note:** You requested {requested} days but forecast data is only available "
            "for the next {n_days} days. For extended outlooks beyond {n_days} days please "
            "check the Bangladesh Meteorological Department directly.\n\n"
        ),
    },
    "bn": {
        "header": "**{location} — {n_days} দিনের পূর্বাভাস**\n\n",
        "daily_outlook": "দৈনিক পূর্বাভাস",
        "weekdays": ["সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি", "রবি"],
        "months": [
            "জানুয়ারি",
            "ফেব্রুয়ারি",
            "মার্চ",
            "এপ্রিল",
            "মে",
            "জুন",
            "জুলাই",
            "আগস্ট",
            "সেপ্টেম্বর",
            "অক্টোবর",
            "নভেম্বর",
            "ডিসেম্বর",
        ],
        "soil": {"saturated": "সম্পৃক্ত", "wet": "ভেজা", "moist": "আর্দ্র", "dry": "শুষ্ক"},
        "speed_unit": "কিমি/ঘণ্টা",
        "digits": _BENGALI_DIGITS,
        "availability_note": (
            "**দ্রষ্টব্য:** আপনি {requested} দিনের পূর্বাভাস চেয়েছেন, কিন্তু পরবর্তী {n_days} দিনের "
            "তথ্যই পাওয়া যাচ্ছে। {n_days} দিনের বেশি সময়ের পূর্বাভাসের জন্য সরাসরি বাংলাদেশ "
            "আবহাওয়া অধিদপ্তরের সাথে যোগাযোগ করুন।\n\n"
        ),
    },
}


class WeatherAgent:
    def __init__(
        self,
        mcp_manager: MCPClientManager,
        storage: Optional["StorageLayer"] = None,
    ) -> None:
        self.mcp = mcp_manager
        self.storage = storage
        self.risk_engine = RiskEngine()

        vllm_base = os.getenv(
            "VLLM_TRANSLATION_ENDPOINT", "http://vllm-translation-guardrail:9031"
        )
        self.llm = AsyncOpenAI(base_url=f"{vllm_base}/v1", api_key="EMPTY")
        self.model = os.getenv("VLLM_TRANSLATION_MODEL_ID", "google/gemma-3-4b-it")

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def run(self, query: str, language: str = "en") -> dict:
        """
        Execute the full pipeline for a natural-language weather query.

        ``language`` is the UI language code ("en", "bn", ...). The explanation
        is written in that language when the LLM call succeeds; ``language`` in
        the returned dict reports the language the answer is actually in.

        Returns a dict with keys:
          answer, risk_tier, risk_label, advisory, triggers,
          buffer, location, forecast, language
        """
        language = (language or "en").lower()
        logger.info("[AGENT] ── New query ──────────────────────────────────")
        logger.info("[AGENT] Raw query: %r  (language=%s)", query, language)

        # Step 1: Extract intent
        try:
            intent = await self._extract_intent(query)
        except ValueError as exc:
            logger.warning("[AGENT] Intent rejected: %s", exc)
            return {
                "answer": str(exc),
                "risk_tier": 0,
                "risk_label": "No Risk",
                "advisory": "",
                "triggers": [],
                "buffer": None,
                "location": "",
                "forecast": {},
            }

        logger.info(
            "[AGENT] Intent extracted — location=%r  context=%s  forecast_days=%d",
            intent.location,
            intent.user_context,
            intent.forecast_days,
        )

        # Step 2: Resolve district from location string (local lookup, no Mapbox)
        from mcp_weather.tools.weather_forecast import _find_district

        district = _find_district(intent.location)
        if (
            not district
            and intent.location.strip().lower() == _DEFAULT_DISTRICT.lower()
        ):
            # Configured default outside the district table: forecasts are
            # ingested for it (data_ingestor registers DEFAULT_LOCATION).
            district = _DEFAULT_DISTRICT
        if not district:
            logger.warning(
                "[AGENT] _find_district returned None for %r", intent.location
            )
            answer = (
                f'I couldn\'t find a matching Bangladesh district for "{intent.location}". '
                "Please specify a district name (e.g. Dhaka, Sylhet, Barisal, Chittagong)."
            )
            return {
                "answer": answer,
                "risk_tier": 0,
                "risk_label": "No Risk",
                "advisory": "",
                "triggers": [],
                "buffer": None,
                "location": intent.location,
                "forecast": {},
            }

        logger.info("[AGENT] District resolved: %r → %r", intent.location, district)
        geo = {"district": district, "display_name": intent.location}

        # Step 3: Forecast from ArangoDB cache (scheduler fills all 64 districts hourly)
        logger.info("[AGENT] Fetching cached forecast for district=%r …", district)
        forecast_data, unified_forecast = await self._get_forecast(
            district, intent.forecast_days
        )
        if forecast_data is None:
            answer = (
                f"Forecast data for {district} is not yet available — "
                "the data pipeline refreshes hourly. Please try again shortly."
            )
            return {
                "answer": answer,
                "risk_tier": 0,
                "risk_label": "No Risk",
                "advisory": "",
                "triggers": [],
                "buffer": None,
                "location": district,
                "forecast": {},
            }

        # Step 4: Risk classification
        logger.debug("[AGENT] Running risk classification …")
        risk_assessment = self._classify(unified_forecast, forecast_data, district)
        logger.info(
            "[AGENT] Risk result — tier=%d (%s)  triggers=%d  source=%s",
            risk_assessment.tier,
            risk_assessment.tier_label,
            len(risk_assessment.triggers),
            risk_assessment.forecast_source,
        )
        if risk_assessment.triggers:
            for t in risk_assessment.triggers:
                logger.info("[AGENT]   trigger: %s", t)

        # Step 5: Generate explanation
        logger.debug("[AGENT] Generating explanation …")
        answer, answer_language = await self._generate_explanation(
            query, intent, geo, forecast_data, risk_assessment, language=language
        )
        logger.info(
            "[AGENT] Explanation generated — length=%d chars  language=%s",
            len(answer),
            answer_language,
        )

        result = {
            "answer": answer,
            "risk_tier": risk_assessment.tier,
            "risk_label": risk_assessment.tier_label,
            "advisory": risk_assessment.reasoning,
            "triggers": risk_assessment.triggers,
            "buffer": None,
            "location": district,
            "forecast": forecast_data,
            "language": answer_language,
        }

        logger.info(
            "[AGENT] ── Response ready — location=%r  tier=%d (%s) ──",
            result["location"],
            result["risk_tier"],
            result["risk_label"],
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
            logger.debug(
                "[AGENT] Checking ArangoDB cache for %r (max_age=6h) …", district
            )
            try:
                stored = self.storage.get_latest_forecast(
                    district, horizon="short", max_age_hours=6
                )
                if stored:
                    # Slice to the requested horizon so the LLM gets the exact window
                    stored.forecast = stored.forecast[:forecast_days]
                    logger.info(
                        "[AGENT] Cache HIT — source=%s  ingested_at=%s  days_available=%d  days_served=%d",
                        stored.source,
                        stored.ingested_at,
                        len(stored.forecast),
                        len(stored.forecast),
                    )
                    return self._unified_to_legacy(stored), stored
                else:
                    logger.warning(
                        "[AGENT] Cache MISS — no fresh forecast for %r", district
                    )
                    return None, None
            except Exception as exc:
                logger.error(
                    "[AGENT] ArangoDB lookup failed for %r (%s: %s)",
                    district,
                    type(exc).__name__,
                    exc,
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
                "[AGENT] unified_forecast is None for %r — rebuilding from legacy dict",
                district,
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
        pr = params.get("precipitation", {}) or {}
        rain_mm = float(pr.get("value", 0) or 0)
        rain_p = float(pr.get("probability", 0) or 0)
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
        if speed_kmh >= 62:
            return "💨"  # storm / cyclone
        if speed_kmh >= 30:
            return "💨"  # strong / windy
        if speed_kmh >= 15:
            return "💨"  # breezy
        return "💨"  # calm

    @staticmethod
    def _soil_emoji(sm: float, language: str = "en") -> str:
        """sm is volumetric water content in m³/m³."""
        words = _UI_STRINGS.get(language, _UI_STRINGS["en"])["soil"]
        if sm >= 0.40:
            return f"{words['saturated']} 🌊"  # saturated
        if sm >= 0.25:
            return f"{words['wet']} 💧"  # wet / field capacity
        if sm >= 0.10:
            return f"{words['moist']} 🌱"  # moist — good for crops
        return f"{words['dry']} 🌵"  # dry / drought risk

    @staticmethod
    def _build_forecast_strip(days: list, language: str = "en") -> str:
        """Build a compact per-day visual strip in markdown list format.

        Weekday/month names, the soil words, the speed unit and (for scripts
        that use their own numerals, e.g. Bengali) the digits follow ``language``.
        """
        from datetime import datetime as _dt

        ui = _UI_STRINGS.get(language, _UI_STRINGS["en"])
        lines = []
        for d in days:
            date_str = d.get("date", "")
            try:
                dt = _dt.strptime(date_str, "%Y-%m-%d")
                date_label = f"{ui['weekdays'][dt.weekday()]} {dt.day} {ui['months'][dt.month - 1]}"
            except ValueError:
                date_label = date_str

            p = d.get("parameters", {})
            sky_emoji, _ = WeatherAgent._weather_condition(p)

            t = p.get("temperature", {}) or {}
            pr = p.get("precipitation", {}) or {}
            wind = p.get("wind", {}) or {}
            sm = p.get("soil_moisture", {}) or {}

            t_min = t.get("min", "?")
            t_max = t.get("max", "?")
            rain = float(pr.get("value", 0) or 0)
            prob = int(float(pr.get("probability", 0) or 0) * 100)
            wind_spd = float(wind.get("speed", 0) or 0)
            soil_val = sm.get("value")

            wind_part = (
                f" · {WeatherAgent._wind_emoji(wind_spd)} {wind_spd:.0f} {ui['speed_unit']}"
                if wind_spd
                else ""
            )
            soil_part = (
                f" · {WeatherAgent._soil_emoji(soil_val, language)} {soil_val:.2f} m³/m³"
                if soil_val is not None
                else ""
            )

            line = (
                f"- {sky_emoji} **{date_label}** — {t_min}–{t_max}°C"
                f" · 💧{prob}%{wind_part}{soil_part}"
            )
            lines.append(line.translate(ui["digits"]) if ui.get("digits") else line)
        return f"---\n\n**{ui['daily_outlook']}:**\n" + "\n".join(lines)

    def _crop_context(self, district: str) -> str:
        """
        The stored crop risk for this district, one line per watched crop, as
        prompt context.

        Reuses the assessments the warning_system_engine writes daily (crop
        thresholds vs the same forecast); returns "" when none is stored, so the
        prompt is unchanged for districts without a crop profile.
        """
        if not self.storage:
            return ""
        parts: list[str] = []
        for crop in _ADVISORY_CROPS:
            label = crop.replace("_", " ").title()
            try:
                stored = self.storage.get_latest_crop_risk(district, crop)
            except Exception as exc:
                logger.warning(
                    "[AGENT] Crop risk lookup failed for %s/%s: %s", district, crop, exc
                )
                continue
            if not stored:
                continue
            triggers = stored.get("triggers") or []
            if not triggers and int(stored.get("tier", 0) or 0) == 0:
                parts.append(
                    f"Crop assessment ({label}): conditions are within the "
                    f"{label} tolerance range."
                )
                continue
            lines = "; ".join(str(t) for t in triggers)
            parts.append(
                f"Crop assessment ({label}): {stored.get('tier_label', 'Normal')}."
                + (f" Exceeded thresholds: {lines}." if lines else "")
            )
        return ("\n" + "\n".join(parts) + "\n") if parts else ""

    async def _generate_explanation(
        self,
        query: str,
        intent: WeatherIntent,
        geo: dict,
        forecast_data: dict,
        risk_assessment: RiskAssessment,
        language: str = "en",
    ) -> tuple[str, str]:
        """Return (answer_markdown, answer_language)."""
        language = (language or "en").lower()
        ui = _UI_STRINGS.get(language, _UI_STRINGS["en"])
        days = forecast_data.get("forecast", [])
        n_days = len(days)
        ctx = (
            "a farmer planning agricultural activities"
            if intent.user_context == "FARMER"
            else "a citizen"
        )
        # Canonical district name (e.g. "Dhaka"), not the user's spelling ("dhaka").
        location_name = geo.get("district") or geo.get("display_name", intent.location)
        if language != "en":
            location_name = _localized_district_name(
                geo.get("district") or location_name, language
            )

        # Build a compact, structured per-day summary the LLM can annotate.
        # We never let the LLM write the duration framing — we inject it ourselves.
        day_lines = []
        for d in days:
            date = d.get("date", "")
            p = d.get("parameters", {})
            t = p.get("temperature", {})
            pr = p.get("precipitation", {})
            hum = p.get("humidity", {})
            if hum.get("min") is not None and hum.get("max") is not None:
                hum_text = f"humidity {hum['min']:.0f}–{hum['max']:.0f}%"
            else:
                hum_text = f"peak humidity {hum.get('value', '?')}%"
            day_lines.append(
                f"  {date}: {t.get('min')}–{t.get('max')}°C, "
                f"rain {pr.get('value', 0):.1f}mm ({int(pr.get('probability', 0) * 100)}%), "
                f"{hum_text}"
            )
        day_summary = "\n".join(day_lines)

        risk_context = ""
        if risk_assessment.tier >= 1:
            risk_context = (
                f"\nRisk level: Tier {risk_assessment.tier} ({risk_assessment.tier_label}). "
                f"Triggers: {'; '.join(risk_assessment.triggers)}. "
                "Add a short advisory.\n"
            )

        # Ground the agricultural advice in the stored crop assessment rather
        # than the model's own knowledge. The warning_system_engine already
        # compared this district's forecast against the crop thresholds.
        crop_context = self._crop_context(geo.get("district") or location_name)

        prompt = (
            f"You are a weather assistant. Describe the weather conditions below for {ctx}.\n"
            f"Location: {location_name}\n"
            f"Data covers {n_days} days:\n"
            f"{day_summary}\n"
            f"{risk_context}"
            f"{crop_context}\n"
            "Write 2–4 sentences summarising temperatures, rain, and one practical agriculture tip. "
            + (
                "Base the agricultural tip ONLY on the crop assessment above; do not invent "
                "thresholds or crop advice that is not stated there. "
                if crop_context
                else ""
            )
            + "Do NOT mention where the data comes from, do NOT greet the reader, and "
            "do NOT mention any number of days or time period — just describe the conditions and advice."
        )
        lang_name = _LANGUAGE_NAMES.get(language)
        if language != "en" and lang_name:
            prompt += (
                f"\nWrite the entire answer in {lang_name} only, in that language's own script "
                f"and numerals, with no English words or phrases."
            )

        # Header and availability note are set programmatically — never by the LLM
        requested = intent.forecast_days
        if requested > n_days:
            availability_note = ui["availability_note"].format(
                requested=requested, n_days=n_days
            )
        else:
            availability_note = ""

        header = ui["header"].format(location=location_name, n_days=n_days)
        if ui.get("digits"):
            header = header.translate(ui["digits"])
            availability_note = availability_note.translate(ui["digits"])

        # Build the visual strip once — deterministic, no LLM needed
        strip = self._build_forecast_strip(days, language) if days else ""

        logger.debug(
            "[AGENT] Explanation prompt — model=%s  tier=%d  n_days=%d  requested=%d",
            self.model,
            risk_assessment.tier,
            n_days,
            requested,
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
            return header + availability_note + body + (
                "\n\n" + strip if strip else ""
            ), language

        except Exception as exc:
            logger.error(
                "[AGENT] Explanation generation failed (%s: %s) — using template fallback",
                type(exc).__name__,
                exc,
            )
            try:
                first = days[0]["parameters"]
                t_min = first["temperature"]["min"]
                t_max = first["temperature"]["max"]
                rain = first["precipitation"]["value"]
                tier_note = (
                    f" Risk: {risk_assessment.tier_label}."
                    if risk_assessment.tier >= 1
                    else ""
                )
                body = (
                    f"Temperatures between {t_min}°C and {t_max}°C, "
                    f"approximately {rain:.1f} mm of rain expected.{tier_note}"
                )
                return header + availability_note + body + (
                    "\n\n" + strip if strip else ""
                ), "en"
            except Exception as inner_exc:
                logger.error("[AGENT] Template fallback also failed: %s", inner_exc)
                return (
                    header
                    + availability_note
                    + "Forecast data retrieved. (Explanation unavailable.)",
                    "en",
                )

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
                    {"role": "user", "content": user},
                ],
                max_tokens=80,
                temperature=0,
            )
            raw = (response.choices[0].message.content or "").strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                raw = raw.removeprefix("json")
            raw = raw.strip()
            logger.debug("[AGENT] Intent raw response: %s", raw[:120])
            data = json.loads(raw)
            location = (data.get("location") or "").strip()
            # The query text is the source of truth for the place. The LLM is
            # only trusted for a location it copied from the message (a typo it
            # echoed still errors later in _find_district); "my area" style
            # questions used to come back as a guessed capital instead of the
            # deployment default.
            mentioned = _district_in_text(query)
            if mentioned:
                location = mentioned
            elif (
                not location
                or location.lower() in _INVALID_LOCATIONS
                or location.lower() not in query.lower()
            ):
                logger.info(
                    "[AGENT] No district in query (LLM said %r) — defaulting to %s",
                    location,
                    _DEFAULT_DISTRICT,
                )
                location = _DEFAULT_DISTRICT
            return WeatherIntent(
                location=location,
                user_context=data.get("user_context", "CITIZEN"),
                forecast_days=max(1, min(14, int(data.get("forecast_days", 3)))),
            )
        except ValueError:
            raise
        except Exception as exc:
            location = _district_in_text(query) or _DEFAULT_DISTRICT
            logger.warning(
                "[AGENT] Intent extraction failed (%s: %s) — using district %r",
                type(exc).__name__,
                exc,
                location,
            )
            return WeatherIntent(
                location=location, user_context="CITIZEN", forecast_days=3
            )

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
                        "temperature": {
                            "min": day.temperature.min,
                            "max": day.temperature.max,
                            "unit": "Celsius",
                        },
                        "precipitation": {
                            "value": day.precipitation.value,
                            "unit": "mm",
                            "probability": day.precipitation.probability,
                        },
                        # "value" stays the daily maximum for existing readers;
                        # min/mean are what a "what is the humidity" answer needs.
                        "humidity": {
                            "value": day.humidity,
                            "max": day.humidity,
                            "mean": day.humidity_mean,
                            "min": day.humidity_min,
                            "unit": "percent",
                        },
                        "wind": {"speed": day.wind.speed, "unit": "km/h"},
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
            p = day["parameters"]
            temp = p["temperature"]
            rain = p["precipitation"]
            hum = p["humidity"]["value"]
            days.append(
                DayForecast(
                    date=day["date"],
                    temperature=TemperatureData(min=temp["min"], max=temp["max"]),
                    precipitation=PrecipitationData(
                        value=rain["value"], probability=rain["probability"]
                    ),
                    wind=WindData(speed=0.0),
                    humidity=hum,
                    extreme_flags=ExtremeFlags(
                        heavy_rain=rain["value"] >= 50.0,
                        heatwave=temp["max"] >= 40.0,
                    ),
                )
            )
        return UnifiedForecast(
            location=district,
            source="bmd",
            horizon="short",
            ingested_at=datetime.now(timezone.utc).isoformat(),
            forecast=days,
        )
