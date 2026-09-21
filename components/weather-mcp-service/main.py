"""
FastAPI entry-point for the weather-mcp-service.

Routes
  GET  /health                           — liveness check
  POST /query                            — on-demand natural-language weather query
  GET  /risk/latest?location=&horizon=   — latest stored risk assessment (written by Warning_system_engine)
  GET  /potato/risk/latest?location=     — latest stored crop risks, one per EWS_CROPS entry
                                           (legacy path name; written by Warning_system_engine)
  GET  /context?location=&days=&crop=    — curated plain-text context for the chat LLM
  GET  /geocode?location=                — resolve district name to lat/lon

  POST /mcp/tools/list                   — MCP tool registry (called by gov-chat-backend)
  POST /mcp/tools/call                   — execute named MCP tool

Note: EWS scheduling, classification pipeline, and alert dispatch are owned by
the Warning_system_engine container. This service reads risk data from the shared
ArangoDB instance but does not write it.
"""

import asyncio
import json
import logging
import os
import pathlib
import re
from contextlib import asynccontextmanager
from functools import lru_cache

from agent import WeatherAgent

# Shared deployment fallback (DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON).
# Same values as drought-monitoring,
# warning_system_engine, geo-inference-worker and the backend.
from defaults import (
    DEFAULT_COORDS as _DEFAULT_COORDS,
)
from defaults import (
    DEFAULT_LOCATION as _DEFAULT_DISTRICT,
)
from defaults import (
    EWS_CROPS,
)
from defaults import (
    ensure_default_district as _ensure_default_district,
)
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from mcp_client import MCPClientManager
from mcp_weather.tools.weather_forecast import fetch_forecast_logic
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging — configure before any module-level loggers are used.
# LOG_LEVEL env var controls verbosity (default INFO).
# Set LOG_LEVEL=DEBUG in docker-compose to see full agent trace logs.
# ---------------------------------------------------------------------------
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=_LOG_LEVEL,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    force=True,  # override any handler uvicorn already set
)

# Suppress noisy third-party loggers — always at WARNING regardless of LOG_LEVEL
for _noisy in (
    "httpcore",
    "httpcore.connection",
    "httpcore.http11",
    "httpx",
    "urllib3",
    "urllib3.connectionpool",
    "google_genai",
    "google_genai.models",
    "google.auth",
    "google.auth.transport",
):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# Keep uvicorn error log visible; filter /health out of access log
logging.getLogger("uvicorn.error").setLevel(logging.INFO)


class _HealthCheckFilter(logging.Filter):
    """Drop GET /health access-log lines — they fire every 30 s and bury real traffic."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "GET /health" not in record.getMessage()


logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())
logging.getLogger("uvicorn.access").setLevel(logging.INFO)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global singletons (set during lifespan startup)
# ---------------------------------------------------------------------------
mcp_manager: MCPClientManager | None = None
weather_agent: WeatherAgent | None = None
storage_layer = None  # read-only: ArangoDB written by Warning_system_engine


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


async def _ingestor_loop(ingestor, storage):
    """Fetch fresh forecasts for all districts on startup, then repeat every hour."""
    while True:
        try:
            forecasts = await asyncio.get_event_loop().run_in_executor(
                None, lambda: ingestor.ingest_short_term(forecast_days=7)
            )
            stored = 0
            for fc in forecasts:
                try:
                    storage.upsert_forecast(fc)
                    stored += 1
                except Exception as exc:
                    logger.warning(
                        "[INGESTOR] Failed to store %s: %s", fc.location, exc
                    )
            logger.info(
                "[INGESTOR] Refresh complete — %d/%d districts stored",
                stored,
                len(forecasts),
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("[INGESTOR] Ingestion run failed: %s", exc)
        await asyncio.sleep(3600)  # 1 hour


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mcp_manager, weather_agent, storage_layer

    # ── MCP stdio sessions (Mapbox + BMD) ────────────────────────────────────
    try:
        mcp_manager = MCPClientManager()
        await mcp_manager.start()
        logger.info("[STARTUP] MCP sessions initialised")
    except Exception as exc:
        logger.warning(
            "[STARTUP] MCP sessions failed: %s — continuing without MCP", exc
        )
        mcp_manager = None

    # ── ArangoDB read client (risk data written by Warning_system_engine) ─────
    try:
        from storage import StorageLayer

        storage_layer = StorageLayer()
        logger.info("[STARTUP] ArangoDB storage connected (read-only for risk queries)")
    except Exception as exc:
        logger.warning(
            "[STARTUP] ArangoDB unavailable: %s — /risk endpoints disabled", exc
        )

    # ── WeatherAgent ──────────────────────────────────────────────────────────
    if mcp_manager:
        weather_agent = WeatherAgent(mcp_manager, storage=storage_layer)
        logger.info(
            "[STARTUP] WeatherAgent ready (storage=%s)", storage_layer is not None
        )
    else:
        logger.warning("[STARTUP] WeatherAgent not started — MCP unavailable")

    # ── Forecast ingestor (runs immediately then every hour) ──────────────────
    _ingestor_task = None
    if storage_layer is not None:
        try:
            from data_ingestor import DataIngestor

            _ingestor = DataIngestor()
            _ingestor_task = asyncio.create_task(
                _ingestor_loop(_ingestor, storage_layer)
            )
            logger.info("[STARTUP] Forecast ingestor started — will refresh every hour")
        except Exception as exc:
            logger.warning("[STARTUP] Forecast ingestor failed to start: %s", exc)

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    if _ingestor_task is not None:
        _ingestor_task.cancel()
    if mcp_manager:
        await mcp_manager.stop()
        logger.info("[SHUTDOWN] MCP sessions closed")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Weather MCP + Early Warning Service", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class QueryRequest(BaseModel):
    query: str
    # UI language code (ISO 639-1, e.g. "en", "bn"). The agent writes its
    # explanation in this language when the LLM supports it.
    language: str = "en"
    # The user's own text when `query` is a translation of it (Bengali input):
    # command keywords and district names are also looked up in it.
    original_query: str | None = None

    def scan_text(self) -> str:
        """Query plus original text, for keyword and district matching."""
        return (
            f"{self.query}\n{self.original_query}"
            if self.original_query
            else self.query
        )


# ---------------------------------------------------------------------------
# Agent routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    if weather_agent is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "reason": "agent not initialized",
                "storage": storage_layer is not None,
            },
        )
    return {
        "status": "healthy",
        "storage": storage_layer is not None,
    }


import urllib.parse

_DATA_DIR = pathlib.Path(__file__).parent / "data"
_MAPBOX_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN", "")
_BULLETIN_PATH = _DATA_DIR / "bulletin.md"
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_BULLETIN_KEYWORDS = re.compile(
    r"\b(bulletin|advisory bulletin|agro.?met|agromet|agrometeorological|agri.*advisory|national bulletin)\b"
    r"|বুলেটিন"  # Bengali
    r"|\b(?:abohawa|krishi)\s+bulletin\b",  # Banglish
    re.IGNORECASE,
)
_PUBLIC_IMAGE_BASE = os.getenv("PUBLIC_API_BASE", "/api/weather/bulletin-image")

_DROUGHT_MONITORING_URL = os.getenv("DROUGHT_MONITORING_URL", "")

# ---------------------------------------------------------------------------
# User-facing fallback texts (never operator instructions). Keyed by UI language;
# unknown languages fall back to English and the caller translates.
# ---------------------------------------------------------------------------
_FALLBACK_TEXT: dict[str, dict[str, str]] = {
    "en": {
        "seasonal_unavailable": (
            "## Seasonal Weather Outlook — {district}\n\n"
            "A long-range outlook for {district} is not available yet. "
            "Here is the short-term forecast instead:\n\n"
        ),
        "seasonal_unavailable_plain": (
            "## Seasonal Weather Outlook — {district}\n\n"
            "A long-range outlook for {district} is not available yet. "
            "Please ask again later, or ask for this week's weather forecast."
        ),
        "drought_unavailable": (
            "## Drought Outlook — {district}\n\n"
            "I could not produce a drought assessment for {district} right now. "
            "Please try again in a little while, or ask for this week's weather forecast."
        ),
        "flood_unavailable": (
            "## Flood Outlook — {district}\n\n"
            "No flood assessment is available for {district} yet. Please ask again later."
        ),
        "flood_no_imagery": (
            "## Satellite Flood Map — {district}\n\n"
            "No cloud-free Sentinel-2 image of {district} is available from the last "
            "{days} days, so the satellite flood map cannot be produced right now. "
            "Heavy monsoon cloud is the usual cause; please try again after a few clear days."
        ),
        "delineation_disabled": (
            "Field boundary mapping is not available right now. Please try again later."
        ),
        "delineation_need_place": (
            "To map field boundaries I need a place I can locate. "
            'Try: *"Delineate field boundaries around Rajshahi"*.'
        ),
    },
    "bn": {
        "seasonal_unavailable": (
            "## মৌসুমি আবহাওয়ার পূর্বাভাস — {district}\n\n"
            "{district}-এর জন্য দীর্ঘমেয়াদি পূর্বাভাস এখনও পাওয়া যাচ্ছে না। "
            "এর পরিবর্তে স্বল্পমেয়াদি পূর্বাভাস দেওয়া হলো:\n\n"
        ),
        "seasonal_unavailable_plain": (
            "## মৌসুমি আবহাওয়ার পূর্বাভাস — {district}\n\n"
            "{district}-এর জন্য দীর্ঘমেয়াদি পূর্বাভাস এখনও পাওয়া যাচ্ছে না। "
            "অনুগ্রহ করে পরে আবার জিজ্ঞাসা করুন, অথবা এই সপ্তাহের আবহাওয়ার পূর্বাভাস জানতে চান।"
        ),
        "drought_unavailable": (
            "## খরার পূর্বাভাস — {district}\n\n"
            "এই মুহূর্তে {district}-এর জন্য খরার মূল্যায়ন তৈরি করা সম্ভব হয়নি। "
            "অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন, অথবা এই সপ্তাহের আবহাওয়ার পূর্বাভাস জানতে চান।"
        ),
        "flood_unavailable": (
            "## বন্যার পূর্বাভাস — {district}\n\n"
            "{district}-এর জন্য এখনও কোনো বন্যা মূল্যায়ন পাওয়া যায়নি। অনুগ্রহ করে পরে আবার জিজ্ঞাসা করুন।"
        ),
        "flood_no_imagery": (
            "## স্যাটেলাইট বন্যা মানচিত্র — {district}\n\n"
            "গত {days} দিনে {district}-এর মেঘমুক্ত কোনো স্যাটেলাইট ছবি পাওয়া যায়নি, তাই এখন বন্যার মানচিত্র তৈরি করা সম্ভব নয়। "
            "বর্ষার মেঘই সাধারণত এর কারণ; অনুগ্রহ করে কয়েকটি পরিষ্কার দিনের পর আবার চেষ্টা করুন।"
        ),
        "delineation_disabled": (
            "জমির সীমানা মানচিত্র সেবা এই মুহূর্তে পাওয়া যাচ্ছে না। অনুগ্রহ করে পরে আবার চেষ্টা করুন।"
        ),
        "delineation_need_place": (
            "জমির সীমানা চিহ্নিত করতে আমার এমন একটি স্থানের নাম দরকার যা আমি খুঁজে পেতে পারি। "
            'যেমন: *"রাজশাহীর আশেপাশে জমির সীমানা চিহ্নিত করুন"*।'
        ),
    },
}


def _fallback(lang: str, key: str, **fmt) -> tuple[str, str]:
    """Return (text, language) for a user-facing fallback message."""
    lang = (lang or "en").lower()
    table = _FALLBACK_TEXT.get(lang) or _FALLBACK_TEXT["en"]
    used = lang if lang in _FALLBACK_TEXT else "en"
    if used == "bn":
        fmt = {
            k: _localized_district_name(v, "bn") if k == "district" else v
            for k, v in fmt.items()
        }
    return table[key].format(**fmt), used


def _localized_district_name(english_name: str, language: str) -> str:
    if language == "bn":
        try:
            from mcp_weather.tools.weather_forecast import BENGALI_TO_ENGLISH

            for bn, en in BENGALI_TO_ENGLISH.items():
                if en.lower() == (english_name or "").lower():
                    return bn
        except Exception:
            pass
    return english_name


_DELINEATION_KEYWORDS = re.compile(
    r"(?:\bdelineat(?:e|ion)\b|"
    r"\bfield\s+boundar(?:y|ies)\b|"
    r"\bfarm\s+boundar(?:y|ies)\b|"
    r"\bplot\s+boundar(?:y|ies)\b|"
    r"\bshow\s+(?:field|farm)\s+boundar(?:y|ies)\b|"
    r"\bmap\s+(?:my\s+|the\s+|our\s+)?(?:field|farm|land|plot)s?\b|"
    r"\b(?:field|farm|plot)s?\s+map\b|"
    r"\bshow\s+(?:me\s+)?(?:my|our)\s+(?:field|farm|plot)s?\b|"
    r"\boutline\s+(?:my\s+|our\s+)?(?:field|farm|plot)s?\b|"
    r"\b(?:plot|land)\s+boundar(?:y|ies)\b|"
    r"\bsegment\s+(?:my\s+)?(?:field|farm|land|agriculture|plot)s?\b|"
    # Bengali: জমির সীমানা / ক্ষেতের সীমানা / খেতের সীমানা / মাঠের সীমানা / প্লট সীমানা,
    # জমির মানচিত্র|ম্যাপ, সীমানা নির্ধারণ, জমি চিহ্নিত
    # noun stems take endings (জমি / জমির / জমিগুলো / জমিগুলোর), hence \S{0,8}
    r"(?:জমি|ক্ষেত|খেত|মাঠ|প্লট)\S{0,8}\s*সীমানা|"
    r"(?:জমি|ক্ষেত|খেত|প্লট)\S{0,8}\s*(?:মানচিত্র|ম্যাপ)|"
    r"(?:ম্যাপ|মানচিত্র)\s*(?:কর|বানা|তৈরি)\S*\s*(?:আমার\s+)?(?:জমি|ক্ষেত|খেত)|"
    r"(?:জমি|ক্ষেত|খেত)\S{0,8}[^।?!]{0,30}মানচিত্রে\s*দেখা|"
    r"সীমানা\s*নির্ধারণ|জমি\s*চিহ্নিত|"
    # Banglish: jomir simana/shimana, kheter simana, plot simana, jomi (gulo) map/manchitro
    r"\b(?:jomir?|khete?r?|plot)\s+(?:s|sh)imana\b|"
    r"\bsimana\s+nirdharon\b|"
    r"\b(?:jomi\w*|khet\w*)\s+(?:gulo\w*\s+)?(?:map|manchitro)\b|"
    r"\bmap\s+(?:koro\s+|korun\s+)?(?:amar\s+)?(?:jomi|khet)\w*)",
    re.IGNORECASE,
)
_FLOOD_DETECTION_KEYWORDS = re.compile(
    r"(?:\bflood\s+(?:detection|mapping|segmentation|map|satellite|extent|zone|area)\b|"
    r"\bdetect\s+flood(?:ing|s)?\b|"
    r"\bmap\s+flood(?:ing|s)?\b|"
    r"\bsatellite\s+flood\b|"
    r"\binundation\s+(?:map|area|extent|detection)\b|"
    r"\bprithvi\b|"
    # Bengali: বন্যার মানচিত্র|ম্যাপ|বিস্তার, বন্যা শনাক্ত, স্যাটেলাইট বন্যা, প্লাবিত এলাকা, জলমগ্ন
    r"বন্যা\S{0,4}\s*(?:মানচিত্র|ম্যাপ|বিস্তার|শনাক্ত|এলাকা)|স্যাটেলাইট\s*বন্যা|প্লাবিত\s*এলাকা|জলমগ্ন|"
    # Banglish: bonnar map/manchitro/bistar, satellite bonna, plabito, jolmogno
    r"\bbonnar?\s+(?:map|manchitro|bistar)\b|\bsatellite\s+bonna\b|\bplabito\b|\bjolo?mogno\b)",
    re.IGNORECASE,
)
# Coordinate extractor for delineation queries — matches "lat 23.5 lon 90.3",
# "latitude 23.5, longitude 90.3", "lat=23.5 lon=90.3", etc.
_LAT_LON_RE = re.compile(
    r"lat(?:itude)?\s*[=:]?\s*(-?\d+(?:\.\d+)?)\s*[,\s]+\s*lon(?:gitude)?\s*[=:]?\s*(-?\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
# Place-name extractor for delineation queries without raw coordinates:
# "delineate around Dhaka", "field boundaries near Rajshahi", "map my farm in Bogra".
_PLACE_RE = re.compile(
    r"\b(?:around|near|at|in|for|of)\s+([A-Za-z][A-Za-z .\'-]{1,60}?)\s*(?:[?.!,]|$)",
    re.IGNORECASE,
)


# "around me", "near here", "in my area": the user's own location, not a place
# name. Sending these to the geocoder mapped "me" to Mexico.
_PLACE_STOPWORDS = {
    # English
    "me",
    "us",
    "here",
    "there",
    "nearby",
    "around",
    "around me",
    "near me",
    "my area",
    "my location",
    "my place",
    "my village",
    "my home",
    "my farm",
    "my field",
    "my fields",
    "my land",
    "my plot",
    "my plots",
    "our area",
    "our village",
    "our farm",
    "our fields",
    "this area",
    "the area",
    # Banglish
    "ekhane",
    "ekhaney",
    "kache",
    "amar kache",
    "ashepashe",
    "amar ashepashe",
    "amar elaka",
    "amar elakay",
    "amar elakar",
    "amar gram",
    "amar grame",
    "amar bari",
    "amar barir",
    "amar jomi",
    "amar jomir",
    "amar khet",
    "amar kheter",
    "amader elaka",
    "amader gram",
    "amader jomi",
    "amader khet",
    "ei elaka",
    "ei elakay",
    # Bengali
    "এখানে",
    "আমার কাছে",
    "আশেপাশে",
    "আমার আশেপাশে",
    "আমার এলাকা",
    "আমার এলাকায়",
    "আমার এলাকার",
    "আমার গ্রাম",
    "আমার গ্রামে",
    "আমার বাড়ি",
    "আমার জমি",
    "আমার জমির",
    "আমার ক্ষেত",
    "আমার খেত",
    "আমাদের এলাকা",
    "আমাদের গ্রাম",
    "আমাদের জমি",
    "এই এলাকা",
}
# Possessive lead-ins mark the user's own place in every language we serve.
_SELF_PREFIXES = ("my ", "our ", "amar ", "amader ", "আমার ", "আমাদের ")


def _extract_place_name(query: str):
    """Best-effort place name from a delineation query; None when absent."""
    m = _PLACE_RE.search(query)
    if not m:
        return None
    place = m.group(1).strip()
    # Drop trailing filler the regex may have swallowed ("Dhaka please").
    place = re.sub(r"\s+(?:please|now|today)$", "", place, flags=re.IGNORECASE).strip()
    low = place.lower()
    if not place or low in _PLACE_STOPWORDS or low.startswith(_SELF_PREFIXES):
        return None
    return place


async def _geocode_place(place: str):
    """Resolve a place via the same logic as GET /geocode; None if not found."""
    try:
        return await geocode_location(place)
    except HTTPException:
        return None
    except (
        OSError,
        ValueError,
        KeyError,
    ) as exc:  # network error or malformed geocoder reply
        logger.warning("[QUERY] place geocoding failed for %r: %s", place, exc)
        return None


_GEO_INFERENCE_URL = os.getenv("GEO_INFERENCE_URL", "").rstrip("/")

# Matches runner.py DISTRICT_COORDS
_DROUGHT_DISTRICT_COORDS: dict[str, tuple[float, float]] = {
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
_ensure_default_district(_DROUGHT_DISTRICT_COORDS)


def _find_district_64(query: str) -> tuple[str, float, float] | None:
    """
    First of the 64 districts mentioned in the query (English canonical name,
    common variants, or Bengali name), with its centroid. Longer names are
    tested first so "Cox's Bazar" wins over shorter fragments.
    """
    try:
        from data_ingestor import DISTRICT_COORDS as _ALL
        from mcp_weather.tools.weather_forecast import BENGALI_TO_ENGLISH as _BN
    except Exception:  # pragma: no cover
        return None
    q = query.lower()
    candidates: list[tuple[str, str]] = [(n.lower(), n) for n in _ALL]
    candidates += [(bn, en) for bn, en in _BN.items() if en in _ALL]
    for alias, canon in (
        ("chattogram", "Chittagong"),
        ("cumilla", "Comilla"),
        ("barishal", "Barisal"),
        ("bogra", "Bogura"),
        ("jessore", "Jashore"),
        ("coxs bazar", "Cox's Bazar"),
    ):
        if canon in _ALL:
            candidates.append((alias, canon))
    for needle, canon in sorted(candidates, key=lambda kv: -len(kv[0])):
        if needle and needle in q:
            lat, lon = _ALL[canon]
            return canon, lat, lon
    return None


def _find_drought_district(query: str) -> tuple[str, float, float] | None:
    """Return (canonical_name, lat, lon) for first district found in query, or None."""
    q = query.lower()
    for name, (lat, lon) in _DROUGHT_DISTRICT_COORDS.items():
        if name.lower() in q:
            return name, lat, lon
    return None


def _assess_drought_forecast_logic(
    district_name: str,
    lat: float,
    lon: float,
    horizon_days: int,
) -> dict:
    """
    Call drought_monitoring /run/district and return structured result dict.
    Keys: answer (markdown), tier, tier_label, drought_level, triggers,
          trend, report_filename, message, error (only on failure).
    """
    import requests as _req

    horizon_days = min(max(horizon_days, 7), 30)

    if not _DROUGHT_MONITORING_URL:
        return {
            "error": "Drought forecasting service not configured.",
            "tier": 0,
            "tier_label": "Unknown",
            "triggers": [],
            "report_filename": "",
        }

    try:
        resp = _req.post(
            f"{_DROUGHT_MONITORING_URL}/run/district",
            json={
                "location": district_name,
                "lat": lat,
                "lon": lon,
                "days": horizon_days,
            },
            timeout=180,
        )
        if not resp.ok:
            return {
                "error": f"Drought service error {resp.status_code}",
                "tier": 0,
                "tier_label": "Unknown",
                "triggers": [],
                "report_filename": "",
            }
        data = resp.json()
    except Exception as exc:
        logger.error(
            "[DROUGHT_FORECAST] /run/district failed for %s: %s", district_name, exc
        )
        return {
            "error": str(exc),
            "tier": 0,
            "tier_label": "Unknown",
            "triggers": [],
            "report_filename": "",
        }

    tier = data.get("tier", 0)
    tier_label = data.get("tier_label", "Normal")
    drought_level = data.get("drought_level", "NORMAL")
    message = data.get("message", "")
    trend = data.get("trend", "STABLE")
    trend_run_days = data.get("trend_run_days", 0)
    triggers = data.get("triggers", [])
    report_filename = data.get("report_filename", "")

    if horizon_days <= 7:
        horizon_label = "next week"
    elif horizon_days <= 14:
        horizon_label = "next 2 weeks"
    elif horizon_days <= 21:
        horizon_label = "next 3 weeks"
    else:
        horizon_label = "next month"

    level_icon = {"NORMAL": "🟢", "WATCH": "🟡", "MODERATE": "🟠", "SEVERE": "🔴"}.get(
        drought_level, "⚪"
    )
    trend_icon = {"WORSENING": "📈", "IMPROVING": "📉", "STABLE": "➡️"}.get(trend, "➡️")
    trend_str = trend + (
        f" for {trend_run_days} consecutive days" if trend_run_days >= 2 else ""
    )

    lines = [
        f"## Drought Outlook — {district_name} ({horizon_label})",
        "",
        f"**Status:** {level_icon} **{drought_level}** ({tier_label})",
        f"**Trend:** {trend_icon} {trend_str}",
        "",
        message,
    ]

    if triggers:
        lines += ["", "**Stressed indicators:**"]
        for t in triggers:
            lines.append(f"- {t}")

    if tier == 0:
        lines += [
            "",
            "No drought stress detected — soil moisture and vegetation within safe ranges.",
        ]
    elif tier == 1:
        lines += [
            "",
            "⚠️ Early watch — conditions are slightly stressed. Continue monitoring.",
        ]
    elif tier == 2:
        lines += [
            "",
            "⚠️ **Warning level** — consider water conservation and crop protection.",
        ]
    elif tier >= 3:
        lines += [
            "",
            "🚨 **Severe drought** — act immediately. Prioritise irrigation and crop protection.",
        ]

    if report_filename:
        report_url = f"/api/weather/drought-report/{report_filename}"
        lines += ["", f"📄 [View Full Drought Report]({report_url})"]

    return {
        "answer": "\n".join(lines),
        "tier": tier,
        "tier_label": tier_label,
        "drought_level": drought_level,
        "triggers": triggers,
        "trend": trend,
        "report_filename": report_filename,
        "message": message,
    }


def _build_bulletin_answer() -> str:
    """Return bulletin.md as markdown with image links appended."""
    text = _BULLETIN_PATH.read_text(encoding="utf-8")

    image_lines: list[str] = []
    for img_path in sorted(_DATA_DIR.iterdir()):
        if img_path.suffix.lower() in _IMAGE_EXTENSIONS:
            label = img_path.stem.replace("_", " ").title()
            url = f"{_PUBLIC_IMAGE_BASE}/{img_path.name}"
            image_lines.append(f"![{label}]({url})")

    if image_lines:
        text += "\n\n---\n\n## Field Visualizations\n\n" + "\n\n".join(image_lines)

    return text


@app.get("/bulletin/image/{filename}")
async def serve_bulletin_image(filename: str):
    """Serve images from the data directory for bulletin display in chat."""
    safe_name = pathlib.Path(filename).name
    img_path = _DATA_DIR / safe_name
    if not img_path.exists() or img_path.suffix.lower() not in _IMAGE_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(str(img_path))


@app.get("/geocode")
async def geocode_location(
    location: str = Query(..., description="Free-text location"),
):
    """
    Resolve a location string to lat/lon.
    Checks Bangladesh DISTRICT_COORDS first; falls back to Mapbox Geocoding API.
    """
    from data_ingestor import DISTRICT_COORDS

    # Case-insensitive match against known Bangladesh districts
    query_lower = location.strip().lower()
    for district, (lat, lon) in DISTRICT_COORDS.items():
        if district.lower() == query_lower or district.lower() in query_lower:
            return {"lat": lat, "lon": lon, "name": district, "zoom": 11}

    # Mapbox Geocoding API fallback
    if not _MAPBOX_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Geocoding unavailable — MAPBOX_ACCESS_TOKEN not configured",
        )

    import requests as _requests

    try:
        encoded = urllib.parse.quote(location)
        resp = _requests.get(
            f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json",
            # This deployment serves Bangladesh: never resolve a free-text place
            # abroad ("me" once geocoded to Mexico).
            params={"access_token": _MAPBOX_TOKEN, "limit": 1, "country": "bd"},
            timeout=5,
        )
        resp.raise_for_status()
        features = resp.json().get("features", [])
        if not features:
            raise HTTPException(
                status_code=404, detail=f"Location '{location}' not found"
            )
        feat = features[0]
        lon, lat = feat["center"]
        return {
            "lat": lat,
            "lon": lon,
            "name": feat.get("place_name", location),
            "zoom": 12,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[GEOCODE] Mapbox API error: %s", exc)
        raise HTTPException(status_code=502, detail="Geocoding service unavailable")


@app.post("/query")
async def query(request: QueryRequest):
    """
    Natural-language weather query.

    Returns:
      answer      — Gemini-composed explanation
      risk_tier   — 0–4
      risk_label  — "Normal" … "Emergency"
      advisory    — risk reasoning paragraph
      triggers    — list of trigger strings
      buffer      — GeoJSON Feature (polygon) or null
      location    — display name
      forecast    — raw BMD / stored forecast data
    """
    # ── Field boundary delineation (geo-inference-worker) ────────────────────
    scan_text = request.scan_text()
    if _DELINEATION_KEYWORDS.search(scan_text):
        if not _GEO_INFERENCE_URL:
            logger.warning(
                "[QUERY] Delineation requested but GEO_INFERENCE_URL is unset"
            )
            text, used = _fallback(request.language, "delineation_disabled")
            return {
                "answer": text,
                "language": used,
                "risk_tier": 0,
                "risk_label": "Normal",
                "advisory": "",
                "triggers": [],
                "buffer": None,
                "location": "",
                "forecast": {},
            }
        m = _LAT_LON_RE.search(scan_text)
        district_hit = _find_district_64(scan_text)  # English or Bengali district name
        if m is not None:
            lat, lon = float(m.group(1)), float(m.group(2))
        elif district_hit is not None:
            name, lat, lon = district_hit
            logger.info("[QUERY] Field delineation - district %s", name)
        else:
            # No coordinates or district: resolve a free-text place with the same
            # geocoder the chat map command uses; when nothing resolves, map the
            # deployment's default location (DEFAULT_LOCATION) rather than refuse.
            place = _extract_place_name(request.query)
            geo = await _geocode_place(place) if place else None
            if geo is None:
                lat, lon = _DEFAULT_COORDS
                logger.info(
                    "[QUERY] Field delineation - no place found, using default %s",
                    _DEFAULT_DISTRICT,
                )
            else:
                lat, lon = geo["lat"], geo["lon"]
                logger.info(
                    "[QUERY] Field delineation - resolved %r -> %s", place, geo["name"]
                )
        logger.info("[QUERY] Field delineation — lat=%.4f  lon=%.4f", lat, lon)
        import asyncio as _asyncio

        import requests as _req

        # The worker call takes 30-60 s. It runs in the thread pool so this
        # single-worker service keeps answering forecasts and the banner's risk
        # polls meanwhile (a blocking call here stalled every other request).
        def _call_worker():
            r = _req.post(
                f"{_GEO_INFERENCE_URL}/delineate",
                json={"latitude": lat, "longitude": lon},
                timeout=600,
            )
            r.raise_for_status()
            return r.json()

        try:
            result = await _asyncio.get_event_loop().run_in_executor(None, _call_worker)
        except Exception as exc:
            logger.error("[QUERY] Delineation worker error: %s", exc)
            raise HTTPException(
                status_code=502, detail=f"Geo inference worker error: {exc}"
            )
        field_count = result.get("field_count", 0)
        radius_km = result.get("radius_km")
        radius_txt = f"{radius_km:g} km" if isinstance(radius_km, (int, float)) else ""
        image_date = result.get("image_date") or ""
        image_stale = bool(result.get("image_stale"))
        # Fixed sentence, so it is localised here rather than machine-translated
        # (the translator mangled "field" in the Bengali output).
        lang = (request.language or "en").lower()
        if lang == "bn":
            within = f" {radius_txt} এর মধ্যে" if radius_txt else ""
            dated = f" স্যাটেলাইট ছবির তারিখ: {image_date}।" if image_date else ""
            if image_date and image_stale:
                dated = (
                    f" স্যাটেলাইট ছবির তারিখ: {image_date} (সাম্প্রতিক ছবিগুলো মেঘে ঢাকা ছিল)।"
                )
            answer = (
                f"({lat:.4f}°N, {lon:.4f}°E) এর{within} **{field_count}টি কৃষি জমির সীমানা** পাওয়া গেছে। "
                f"জমির বহুভুজগুলো মানচিত্রে দেখানো হয়েছে।{dated}"
            ).translate(str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯"))
        else:
            lang = "en"
            within = f"within {radius_txt} of" if radius_txt else "near"
            dated = f" Satellite image date: {image_date}." if image_date else ""
            if image_date and image_stale:
                dated = (
                    f" Satellite image date: {image_date} (the newest cloud-free image; "
                    "more recent passes were covered by cloud)."
                )
            answer = (
                f"Found **{field_count} agricultural field boundaries** {within} "
                f"({lat:.4f}°N, {lon:.4f}°E). "
                f"The field polygons are shown on the map.{dated}"
            )
        return {
            "answer": answer,
            "language": lang,
            "risk_tier": 0,
            "risk_label": "Normal",
            "advisory": "",
            "triggers": [],
            "buffer": None,
            "location": f"{lat:.4f},{lon:.4f}",
            "forecast": {},
            "field_delineation": {
                "field_count": field_count,
                "fields_geojson": result.get("fields_geojson"),
                "source": result.get("source"),
                "radius_km": radius_km,
                "year": result.get("year"),
                "bbox": result.get("bbox"),
                "image_date": image_date or None,
                "image_dates": result.get("image_dates"),
                "image_stale": image_stale,
                "image_age_days": result.get("image_age_days"),
            },
        }

    # ── Satellite flood detection (geo-inference-worker + Prithvi-EO-2.0) ────
    if _FLOOD_DETECTION_KEYWORDS.search(scan_text):
        if not _GEO_INFERENCE_URL:
            return {
                "answer": (
                    "Satellite flood detection is not currently enabled. "
                    "Start the geo-inference-worker service and set `GEO_INFERENCE_URL` to use this feature."
                ),
                "risk_tier": 0,
                "risk_label": "Normal",
                "advisory": "",
                "triggers": [],
                "buffer": None,
                "location": "",
                "forecast": {},
            }
        district_info = _find_district_64(scan_text) or _find_drought_district(
            scan_text
        )
        if district_info:
            district, lat, lon = district_info
        else:
            m = _LAT_LON_RE.search(scan_text)
            if m is None:
                # No district or coordinates named: the deployment's default location.
                lat, lon = _DEFAULT_COORDS
                district = _DEFAULT_DISTRICT
                logger.info(
                    "[QUERY] Flood detection - no place found, using default %s",
                    district,
                )
            else:
                lat, lon = float(m.group(1)), float(m.group(2))
                district = f"{lat:.4f},{lon:.4f}"
        logger.info(
            "[QUERY] Flood detection — district=%s  lat=%.4f  lon=%.4f",
            district,
            lat,
            lon,
        )
        import asyncio as _asyncio

        import requests as _req

        # The worker call takes 30-60 s. It runs in the thread pool so this
        # single-worker service keeps answering forecasts and the banner's risk
        # polls meanwhile (a blocking call here stalled every other request).
        # The worker answers 404 when no cloud-free Sentinel-2 scene exists in the
        # lookback window (monsoon). Retry once with a longer window, then tell
        # the user plainly instead of failing with a 502.
        _FLOOD_LOOKBACKS = (30, 90)

        def _call_worker(lookback_days: int):
            r = _req.post(
                f"{_GEO_INFERENCE_URL}/flood-segment",
                json={
                    "latitude": lat,
                    "longitude": lon,
                    "lookback_days": lookback_days,
                },
                timeout=600,
            )
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()

        result = None
        try:
            for lookback in _FLOOD_LOOKBACKS:
                result = await _asyncio.get_event_loop().run_in_executor(
                    None, _call_worker, lookback
                )
                if result is not None:
                    break
                logger.info(
                    "[QUERY] Flood detection - no cloud-free scene in %d days for %s",
                    lookback,
                    district,
                )
        except Exception as exc:
            logger.error("[QUERY] Flood worker error: %s", exc)
            raise HTTPException(
                status_code=502, detail=f"Geo inference worker error: {exc}"
            )
        if result is None:
            text, used = _fallback(
                request.language,
                "flood_no_imagery",
                district=_localized_district_name(district, request.language),
                days=_FLOOD_LOOKBACKS[-1],
            )
            return {
                "answer": text,
                "language": used,
                "risk_tier": 0,
                "risk_label": "Normal",
                "advisory": "",
                "triggers": [],
                "buffer": None,
                "location": district,
                "forecast": {},
            }
        fraction = result.get("flood_fraction", 0.0)
        flood_pct = fraction * 100
        if flood_pct >= 20:
            tier, label = 3, "High Risk"
            advisory = "Significant flood extent detected via satellite. Consider evacuation advisories."
        elif flood_pct >= 5:
            tier, label = 2, "Moderate Risk"
            advisory = "Moderate flooding detected. Monitor situation closely."
        elif flood_pct >= 1:
            tier, label = 1, "Low Risk"
            advisory = "Minor flooded areas detected in the satellite image."
        else:
            tier, label = 0, "Normal"
            advisory = "No significant flooding detected in the analyzed area."
        return {
            "answer": (
                f"## Satellite Flood Analysis — {district}\n\n"
                f"**{flood_pct:.1f}%** of the analyzed area is classified as flooded/water "
                f"by the Prithvi-EO-2.0 model (IBM × NASA, Sen1Floods11).\n\n"
                f"{advisory}\n\n"
                f"*Source: Copernicus Sentinel-2 (GEE) + Prithvi-EO-2.0-300M*"
            ),
            "risk_tier": tier,
            "risk_label": label,
            "advisory": advisory,
            "triggers": ["flood_detected"] if fraction >= 0.01 else [],
            "buffer": None,
            "location": district,
            "forecast": {},
            "flood_analysis": {
                "flood_fraction": fraction,
                "flood_pixel_count": result.get("flood_pixel_count"),
                "valid_pixel_count": result.get("valid_pixel_count"),
                "flood_geojson": result.get("flood_geojson"),
            },
        }

    if _BULLETIN_KEYWORDS.search(request.query):
        return {
            "answer": _build_bulletin_answer(),
            "risk_tier": 0,
            "risk_label": "Normal",
            "advisory": "",
            "triggers": [],
            "buffer": None,
            "location": "Bangladesh",
            "forecast": {},
        }

    if weather_agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    result = await weather_agent.run(request.query, language=request.language)
    return result


@app.get("/risk/latest")
async def get_latest_risk(
    location: str = Query(
        ..., description="Bangladesh district name (e.g. 'Dhaka', 'Sylhet')"
    ),
    horizon: str = Query("short", description="'short' (0–7 d) or 'long' (8–30 d)"),
):
    """
    Return the most recent stored risk assessment for a district.

    Falls back to classifying a live BMD forecast if no stored assessment exists.
    Returns 404 if neither source is available.
    """
    if storage_layer is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": "Storage not available — early warning infrastructure offline"
            },
        )

    assessment = storage_layer.get_latest_risk(location, horizon)
    if assessment:
        return assessment.model_dump()

    # No stored assessment — run a live on-demand query and classify inline
    if weather_agent:
        try:
            result = await weather_agent.run(f"What is the weather in {location}?")
            return {
                "location": location,
                "assessed_at": None,
                "horizon": horizon,
                "tier": result.get("risk_tier", 0),
                "tier_label": result.get("risk_label", "Normal"),
                "triggers": result.get("triggers", []),
                "reasoning": result.get("advisory", ""),
                "source": "live_query",
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    raise HTTPException(
        status_code=404,
        detail=f"No risk data for '{location}' and live fallback unavailable",
    )


@app.get("/bmd/alerts/active")
async def get_bmd_alerts(
    location: str | None = Query(
        None, description="District name; omit for all active warnings"
    ),
    limit: int = Query(10, ge=1, le=50),
):
    """Active official BMD warnings (CAP feed) for a district, or nationwide ones."""
    if storage_layer is None:
        return JSONResponse(status_code=503, content={"error": "Storage unavailable"})
    return {
        "location": location,
        "alerts": storage_layer.get_active_bmd_alerts(location, limit),
    }


@app.get("/flood/risk/latest")
async def get_flood_risk(
    location: str = Query(..., description="Bangladesh district name (e.g. 'Sylhet')"),
):
    """Latest flood EWS assessment (rain index + GloFAS river discharge) for a district."""
    if storage_layer is None:
        return JSONResponse(status_code=503, content={"error": "Storage unavailable"})
    assessment = storage_layer.get_latest_crop_risk(location, "flood")
    if assessment is None:
        return {
            "location": location,
            "crop": "flood",
            "tier": 0,
            "tier_label": "Normal",
            "triggers": [],
            "message": "",
        }
    assessment.pop("_id", None)
    assessment.pop("_key", None)
    assessment.pop("_rev", None)
    return assessment


@app.get("/potato/risk/latest")
async def get_potato_risk(
    location: str = Query(..., description="Bangladesh district name (e.g. 'Dhaka')"),
    crop: str = Query(
        "", description="Single crop to report; default = worst of EWS_CROPS"
    ),
):
    """
    Return the most recent stored crop risk assessments for a district.

    The warning_system_engine writes one assessment per crop. `crops` carries
    every one of them, most severe first, so a client can show a card per crop.
    The top-level fields repeat the most severe crop, which keeps older clients
    (and the original single-crop contract of this path) working unchanged.

    Pass `crop` to restrict the answer to one crop. Returns tier=0 (Normal)
    when nothing is stored yet.
    """
    if storage_layer is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Storage unavailable"},
        )

    wanted = [crop] if crop else EWS_CROPS

    stored = []
    for candidate in wanted:
        found = storage_layer.get_latest_crop_risk(location, candidate)
        if found is not None:
            # Strip internal ArangoDB fields before returning
            for field in ("_key", "_id", "_rev"):
                found.pop(field, None)
            stored.append(found)

    # Most severe first; ties go to the most recently assessed
    stored.sort(
        key=lambda a: (int(a.get("tier", 0) or 0), str(a.get("assessed_at", ""))),
        reverse=True,
    )

    if not stored:
        return {
            "location": location,
            "crop": wanted[0] if wanted else "",
            "tier": 0,
            "tier_label": "Normal",
            "triggers": [],
            "message": "",
            "crops": [],
        }

    return {**stored[0], "crops": stored}


# ── Curated context for the chat LLM ──────────────────────────────────────
# Everything this service knows about a district, as one plain-text block:
# today's date, the short-term forecast, the Copernicus seasonal outlook,
# drought and flood assessments and any official BMD warning.
# The backend prepends it to every knowledge-base question so the chat LLM
# reasons over real numbers next to the retrieved documents. Nothing here
# decides what the answer is — that is the model's job.

# _DEFAULT_DISTRICT is imported from defaults (shared DEFAULT_LOCATION).


def _month_label(ym: str) -> str:
    """'2026-10' -> 'October 2026'; anything unparseable is returned as is."""
    from calendar import month_name

    try:
        y, m = ym.split("-")
        return f"{month_name[int(m)]} {y}"
    except Exception:
        return ym


def _crop_label(crop: str) -> str:
    """'rice_aman' -> 'Rice Aman'. Profile keys are snake_case; prose is not."""
    return crop.replace("_", " ").title()


# Crop names in English, Bengali script, and romanised Bengali ("Banglish").
#
# The Bengali forms are load-bearing, not a nicety. The caller passes the
# translated English AND the user's original message (query-service.js
# fetchWeatherContext), because the routing translator is a 4B model that
# mangles the locative "-ে" ending on short questions:
#   "আজ আমে কী রোগ হতে পারে?"   -> "What illness could I have today?"  (আমে read as আমি, "I")
#   "আজ বেগুনে কী রোগ হতে পারে?" -> "...in the skin in shades of purple?" (বেগুনে read as বেগুনি, "purple")
# With no crop name surviving, no profile was attached and the LLM answered
# about whichever crop the live assessments happened to lead with. Matching the
# original text rescues the crop the translator lost. (ধান survives translation
# today, but the same gap applies to it whenever translation drops out.)
#
# আম (mango) needs its negative lookahead: it prefixes the first-person
# pronouns (আমি/আমার/আমরা/আমাদের/আমাকে/আমায়) and আমন (Aman rice), so a bare
# match would read "আমার ধান" ("my rice") as a mango question. বেগুন likewise
# excludes বেগুনি ("purple"). The leading lookbehind keeps each stem from
# matching inside a longer Bengali word.
# Romanised "begun" is deliberately absent: it is also the English participle
# ("the rains have begun").
_CROP_QUERY_PATTERNS = {
    "rice_aman": r"\b(?:rice|paddy|dhan|aman)\b|(?<![ঀ-৿])(?:ধান|আমন)",
    "eggplant": r"\b(?:eggplant|brinjal)s?\b|(?<![ঀ-৿])বেগুন(?!ি)",
    "mango": r"\bmango(?:es)?\b|\baam\b|(?<![ঀ-৿])আম(?!ি|ার|রা|াদের|াকে|ায়|ন)",
}
_CROP_PLANTING_COMPARISON = re.compile(
    r"(?=.*\bcrops?\b)(?=.*\b(?:plant|planting|sow|sowing)\b)"
    r"(?=.*\b(?:which|what|recommend|best)\b)",
    re.IGNORECASE,
)
_CROP_PROFILE_PATH = (
    pathlib.Path(os.getenv("WARNING_SYSTEM_ENGINE_DIR", "/warning_system_engine"))
    / "data"
    / "example_crop_profile.json"
)


def _requested_crops(query: str) -> list[str]:
    """Return named crops, or all configured crops for a planting comparison."""
    normalized = re.sub(r"[_-]+", " ", query.casefold())
    if _CROP_PLANTING_COMPARISON.search(normalized):
        return list(EWS_CROPS)
    return [
        crop
        for crop, pattern in _CROP_QUERY_PATTERNS.items()
        if crop in EWS_CROPS and re.search(pattern, normalized)
    ]


@lru_cache(maxsize=1)
def _crop_profiles() -> dict:
    try:
        with _CROP_PROFILE_PATH.open(encoding="utf-8") as profile_file:
            return json.load(profile_file)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[CONTEXT] Crop profile load failed: %s", exc)
        return {}


def _crop_profile_context(district: str, crops: list[str], today) -> list[str]:
    """Source-backed deterministic profile context for requested crops."""
    profiles = _crop_profiles()
    sections: list[str] = []
    iso_week = today.isocalendar()[1]
    for crop in crops:
        profile = next(
            (item for item in profiles.values() if item.get("crop") == crop), None
        )
        if not profile:
            continue
        label = profile.get("crop_display_name") or _crop_label(crop)
        region = str(profile.get("region") or "unknown").title()
        current_stages = [
            stage.get("stage")
            for stage in profile.get("growth_stages") or []
            if iso_week in stage.get("weeks", [])
        ]
        source_profile = {
            "crop": profile.get("crop"),
            "published_source_region": profile.get("region"),
            "current_calendar_status": {
                "date": today.isoformat(),
                "iso_week": iso_week,
                "status": "in_season" if current_stages else "outside_season",
                "stages": current_stages,
            },
            "season_calendar": {
                "season_span": profile.get("season_span", {}),
                "growth_stages": [
                    {
                        "stage": stage.get("stage"),
                        "weeks": stage.get("weeks", []),
                        "months": stage.get("months", []),
                    }
                    for stage in profile.get("growth_stages") or []
                ],
            },
            "historical_weekly_climate_normals": profile.get("weekly_calendar", []),
            "favorable_conditions_by_stage": profile.get(
                "favorable_conditions_by_stage", []
            ),
            "weather_warnings": profile.get("weather_warnings", []),
            "pest_and_disease_conditions": profile.get("pest_disease_advisories", []),
            "source_coverage": profile.get("source_coverage", {}),
        }
        sections.append(
            f"Official BAMIS {label} crop calendar for {district} "
            f"(published source region: {region}).\n"
            "This official BAMIS profile is authoritative for crop facts. If a "
            "retrieved document is unclear or conflicts with it, use this profile. "
            "For questions about today or the current crop stage, copy "
            "current_calendar_status exactly; do not choose another stage from the "
            "calendar. Call the source the official BAMIS crop calendar and use at "
            "most one suitable crop or stage emoji per crop. "
            "Use favorable_conditions_by_stage only for questions about favorable "
            "or ideal requirements. historical_weekly_climate_normals are calendar "
            "observations, not favorable requirements. Empty or absent values mean "
            "the source does not provide that fact. Before recommending that a crop "
            "be planted or started now, compare today's ISO week above with its "
            "season calendar. Recommend starting only when the current week is in a "
            "seedbed, germination, seedling, or planting stage. A later growth stage "
            "or a date outside the season is not a valid time to start that crop.\n"
            + json.dumps(source_profile, ensure_ascii=False, separators=(",", ":"))
        )
    return sections


def _season_lines(assessments: list[dict], today, crop: str) -> list[str]:
    """
    Crop calendar months with their growth stages, plus where today falls.

    The stages come from the stored seasonal assessments (LongTermCropEWS
    maps each forecast month to the crop profile's stages), so this reflects
    the crop calendar the engine actually uses rather than a fixed date range.
    """
    from datetime import date

    if not assessments:
        return []
    lines = []
    for a in assessments:
        stages = ", ".join(a.get("stages") or []) or "—"
        risk = a.get("tier_label", "Normal")
        triggers = "; ".join(str(t) for t in (a.get("triggers") or []))
        line = f"  {_month_label(a.get('target_month', ''))}: {stages} — seasonal risk {risk}"
        if triggers:
            line += f" ({triggers})"
        lines.append(line)

    months = sorted(
        a.get("target_month", "") for a in assessments if a.get("target_month")
    )
    this_month = f"{today.year}-{today.month:02d}"
    try:
        first = months[0]
        y, m = (int(x) for x in first.split("-"))
        first_day = date(y, m, 1)
    except Exception:
        return lines
    label = _crop_label(crop)
    if this_month in months:
        current = next(a for a in assessments if a.get("target_month") == this_month)
        stages = ", ".join(current.get("stages") or []) or "—"
        lines.append(f"  Today falls inside the {label} season: stage(s) {stages}.")
    elif today < first_day:
        lines.append(
            f"  The {label} season has not started: the first calendar month is "
            f"{_month_label(first)}, in {(first_day - today).days} days."
        )
    else:
        lines.append(
            f"  The {label} season's last calendar month was {_month_label(months[-1])}."
        )
    return lines


def _build_weather_context(
    district: str, days: int = 7, crops: list[str] | None = None
) -> tuple[str, list[str]]:
    """Plain-text weather context with profiles only for requested crops.

    Returns ``(text, sources)``. ``sources`` names the data providers whose
    output actually made it into ``text`` (e.g. ``["BMD", "Open-Meteo"]``), in
    the order they appear, so the chat backend can ask the model to cite them
    at the end of a weather answer without guessing.
    """
    from datetime import datetime, timezone

    if storage_layer is None:
        return "", []
    sources: list[str] = []
    now = datetime.now(timezone.utc)
    today = now.date()
    sections: list[str] = [
        f"Today is {now:%A %d %B %Y} (UTC), ISO week {today.isocalendar()[1]}. District: {district}."
    ]
    sections.extend(_crop_profile_context(district, list(crops or []), today))

    # Short-term forecast
    forecast_horizon = ""
    stored = None
    try:
        stored = storage_layer.get_latest_forecast(
            district, horizon="short", max_age_hours=6
        )
    except Exception as exc:
        logger.warning("[CONTEXT] Forecast lookup failed for %s: %s", district, exc)
    if stored and stored.forecast:
        fc = stored.forecast[:days]
        lines = []
        for d in fc:
            # "today"/"tomorrow"/weekday next to the date: the model does not
            # reliably work out which row "tomorrow" is from the date alone.
            try:
                from datetime import date as _date

                offset = (_date.fromisoformat(d.date) - today).days
                when = {0: "today", 1: "tomorrow"}.get(
                    offset, _date.fromisoformat(d.date).strftime("%A")
                )
                stamp = f"{d.date} ({when})"
            except ValueError:
                stamp = d.date
            # Humidity as a single number reads as "the humidity today" and the
            # stored one is the dawn peak, which is near-saturated all monsoon.
            # Give the day's range so neither the model nor the farmer mistakes
            # the peak for a typical reading.
            if d.humidity_min is not None:
                humidity_text = f"humidity {d.humidity_min:.0f}–{d.humidity:.0f}%" + (
                    f" (average {d.humidity_mean:.0f}%)"
                    if d.humidity_mean is not None
                    else ""
                )
            else:
                humidity_text = f"peak humidity {d.humidity:.0f}%"
            line = (
                f"  {stamp}: {d.temperature.min:.1f}–{d.temperature.max:.1f}°C, "
                f"rain {d.precipitation.value:.1f} mm ({int(d.precipitation.probability * 100)}% chance), "
                f"{humidity_text}, wind {d.wind.speed:.0f} km/h"
            )
            if d.soil_moisture is not None:
                # Same wet/moist/dry banding the forecast strip shows the user;
                # without it the LLM guessed 0.34 m³/m³ (field capacity) was "low".
                band = WeatherAgent._soil_emoji(d.soil_moisture).split()[0]
                line += f", soil moisture {d.soil_moisture:.2f} m³/m³ ({band})"
            lines.append(line)
        total_rain = sum(d.precipitation.value for d in fc)
        wet_days = sum(1 for d in fc if d.precipitation.value >= 1.0)
        lines.append(
            f"  Totals over these {len(fc)} days: rain {total_rain:.1f} mm on {wet_days} day(s) ≥1 mm; "
            f"max {max(d.temperature.max for d in fc):.1f}°C, min {min(d.temperature.min for d in fc):.1f}°C."
        )
        source = (
            "Open-Meteo" if stored.source == "open_meteo" else stored.source.upper()
        )
        sources.append(source)
        check = ""
        if stored.sense_check_passed is not None:
            check = ", cross-checked against BAMIS" + (
                "" if stored.sense_check_passed else " (BAMIS values used)"
            )
        sections.append(
            f"{len(fc)}-day forecast for {district} ({source}{check}; ingested {stored.ingested_at[:16]} UTC):\n"
            + "\n".join(lines)
        )
        forecast_horizon = (
            f"Daily forecasts stop after these {len(fc)} days, on {fc[-1].date}. "
            "There is no day-by-day data beyond that date: for any question reaching "
            "further ahead, use the monthly seasonal outlook instead and say plainly "
            "that the answer comes from a monthly outlook, not a daily forecast. "
            "Never extend a daily total (for example a 7-day rainfall figure) over a "
            "longer period than the days listed above."
        )

    # Seasonal outlook
    try:
        seasonal = storage_layer.get_seasonal_forecast(district)
    except Exception:
        seasonal = None
    if seasonal and seasonal.get("outlook"):
        sources.append("Copernicus SEAS5")
        lines = []
        for rec in seasonal["outlook"]:
            line = f"  {_month_label(rec.get('valid_month', ''))}: mean {rec.get('mean_temp_c', '?')}°C, rain {rec.get('total_precip_mm', '?')} mm"
            if rec.get("estimated_rh_pct") is not None:
                line += f", humidity ~{rec['estimated_rh_pct']:.0f}%"
            lines.append(line)
        sections.append(
            f"Seasonal outlook for {district} (Copernicus SEAS5, issued {_month_label(seasonal.get('issue_month', ''))}, "
            f"retrieved {str(seasonal.get('fetched_at', ''))[:10]}):\n"
            + "\n".join(lines)
        )

    # Drought
    try:
        drought = storage_layer.get_drought_assessment(district)
    except Exception:
        drought = None
    if drought:
        triggers = "; ".join(str(t) for t in (drought.get("triggers") or []))
        line = (
            f"Drought assessment for {district} (satellite soil moisture and vegetation, "
            f"{str(drought.get('assessed_at', ''))[:10]}): {drought.get('tier_label', 'Normal')}, "
            f"trend {drought.get('trend', 'STABLE')}. {drought.get('message', '')}"
        )
        if triggers:
            line += f" Stressed indicators: {triggers}."
        if drought.get("report_filename"):
            line += f" Full report: {_PUBLIC_DROUGHT_REPORT_BASE}/{drought['report_filename']}"
        sections.append(line)

    # Flood
    try:
        flood = storage_layer.get_latest_crop_risk(district, "flood")
    except Exception:
        flood = None
    if flood:
        sections.append(
            f"Flood outlook for {district} (rainfall + GloFAS river discharge, next 10 days): "
            f"{flood.get('tier_label', 'Normal')}. {flood.get('message', '')}"
        )

    # Official warnings
    try:
        alerts = storage_layer.get_active_bmd_alerts(district, 10)
    except Exception:
        alerts = []
    if alerts:
        lines = []
        for a in alerts:
            line = f"  {a.get('event') or a.get('headline') or 'Warning'}"
            if a.get("severity"):
                line += f" — severity {a['severity']}"
            if a.get("expires"):
                line += f", until {str(a['expires'])[:16]}"
            lines.append(line)
        sections.append(
            f"Official BMD warnings in force for {district}:\n" + "\n".join(lines)
        )
        sources.append("BMD")
    else:
        sections.append(f"Official BMD warnings in force for {district}: none.")
        sources.append("BMD")

    limits = (
        "Not available in this system: observed rainfall records for past weeks or months, "
        "and alert subscriptions (the assistant cannot notify anyone later)."
    )
    if forecast_horizon:
        limits += " " + forecast_horizon
    sections.append(limits)
    return "\n\n".join(sections), list(dict.fromkeys(sources))


_PUBLIC_DROUGHT_REPORT_BASE = os.getenv(
    "PUBLIC_DROUGHT_REPORT_BASE", "/api/weather/drought-report"
)


@app.get("/context")
async def get_weather_context(
    location: str = Query(
        "", description="District name, or the user's whole message to scan for one"
    ),
    days: int = Query(7, ge=1, le=7, description="Forecast days to include"),
    crop: str = Query(
        "",
        description="Optional crop name override; otherwise detected from location text",
    ),
):
    """
    Curated plain-text context for the chat LLM (see _build_weather_context).

    ``location`` may be the raw message: it is scanned for a district name the
    same way the query endpoint does, and falls back to the default district.
    Returns {"text": ""} when storage is offline so the caller can skip it.

    Crop profiles are included only when ``crop`` is supplied or a supported
    crop is explicitly named in ``location`` (normally the full user query).
    """
    district_info = _find_district_64(location) or _find_drought_district(location)
    district = district_info[0] if district_info else _DEFAULT_DISTRICT
    wanted = _requested_crops(crop or location)
    text, sources = _build_weather_context(district, days, wanted)
    return {"location": district, "text": text, "sources": sources}


@app.get("/drought/risk/latest")
async def get_drought_risk(
    location: str = Query(..., description="Bangladesh district name (e.g. 'Dhaka')"),
):
    """
    Return the most recent stored drought assessment for a district.
    Written by drought_monitoring, read here for frontend polling.
    Returns tier=0 (Normal) if no assessment has been stored yet.
    """
    if storage_layer is None:
        return JSONResponse(status_code=503, content={"error": "Storage unavailable"})

    assessment = storage_layer.get_drought_assessment(location)
    if assessment is None:
        return {
            "location": location,
            "drought_level": "NORMAL",
            "tier": 0,
            "tier_label": "Normal",
            "triggers": [],
            "message": "",
        }

    for field in ("_key", "_id", "_rev"):
        assessment.pop(field, None)
    return assessment


_DROUGHT_REPORTS_DIR = pathlib.Path(
    os.getenv("DROUGHT_REPORTS_DIR", "/app/drought_reports")
)


@app.get("/drought/report/{filename}")
async def serve_drought_report(filename: str):
    """
    Serve a drought PDF report from the shared volume.
    The drought_monitoring container writes to the same named volume.
    """
    safe_name = pathlib.Path(filename).name
    report_path = _DROUGHT_REPORTS_DIR / safe_name

    if not report_path.exists() or report_path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=404, detail="Report not found")

    return FileResponse(
        str(report_path),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


# ---------------------------------------------------------------------------
# MCP HTTP routes  (called by gov-chat-backend tool registry)
# ---------------------------------------------------------------------------

_WEATHER_FORECAST_TOOL = {
    "type": "function",
    "function": {
        "name": "retrieve_weather_forecast",
        "description": (
            "Fetches official 3-7 day weather forecasts for Bangladesh districts "
            "from the Bangladesh Meteorological Department (BMD). "
            "Use this when the user asks about weather in Bangladesh."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "district_name": {
                    "type": "string",
                    "description": "The Bangladesh district name (e.g. 'Dhaka', 'Pabna')",
                },
                "forecast_days": {
                    "type": "integer",
                    "description": "Number of forecast days (1-7)",
                    "default": 3,
                },
                "parameters": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Weather parameters to include",
                    "default": [],
                },
            },
            "required": ["district_name"],
        },
    },
}

_DROUGHT_FORECAST_TOOL = {
    "type": "function",
    "function": {
        "name": "assess_drought_forecast",
        "description": (
            "Generates an on-demand drought risk assessment for a Bangladesh district "
            "using NASA SMAP satellite data (soil moisture, evapotranspiration, surface runoff) "
            "and NOAA VIIRS NDVI vegetation index. "
            "Use when the user asks about drought risk, seasonal drought outlook, "
            "soil moisture conditions, or crop water stress for the coming week or month. "
            "Returns risk level (NORMAL/WATCH/MODERATE/SEVERE), trend direction, stressed "
            "indicators, and a downloadable PDF report link. Maximum horizon: 30 days."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "district_name": {
                    "type": "string",
                    "description": "Bangladesh district name (e.g. 'Dhaka', 'Rajshahi', 'Khulna')",
                },
                "horizon_days": {
                    "type": "integer",
                    "description": (
                        "Assessment window in days: 7=next week, 14=next two weeks, "
                        "21=next three weeks, 30=next month (seasonal). Maximum 30."
                    ),
                    "default": 30,
                },
            },
            "required": ["district_name"],
        },
    },
}

TOOL_DEFINITIONS = [_WEATHER_FORECAST_TOOL, _DROUGHT_FORECAST_TOOL]


@app.post("/mcp/tools/list")
async def mcp_tools_list():
    return {"tools": TOOL_DEFINITIONS}


@app.post("/mcp/tools/call")
async def mcp_tools_call(request: Request):
    body = await request.json()
    name = body.get("name")
    args = body.get("arguments", {})

    if name == "retrieve_weather_forecast":
        result_str = fetch_forecast_logic(
            district_name=(args.get("district_name") or "").strip()
            or _DEFAULT_DISTRICT,
            forecast_days=args.get("forecast_days", 3),
            parameters=args.get("parameters", []),
        )
        return {"content": [{"type": "text", "text": result_str}]}

    if name == "assess_drought_forecast":
        district_name = (args.get("district_name") or "").strip() or _DEFAULT_DISTRICT
        horizon_days = int(args.get("horizon_days", 30))

        district_info = _find_drought_district(district_name)
        if district_info:
            district, lat, lon = district_info
        else:
            # Fallback: check exact key match
            coords = _DROUGHT_DISTRICT_COORDS.get(district_name)
            if coords:
                district, lat, lon = district_name, coords[0], coords[1]
            else:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"District '{district_name}' not found in supported Bangladesh districts.",
                        }
                    ]
                }

        import asyncio as _asyncio

        result = await _asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _assess_drought_forecast_logic(district, lat, lon, horizon_days),
        )

        if "error" in result:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Drought assessment failed: {result['error']}",
                    }
                ]
            }

        return {"content": [{"type": "text", "text": result["answer"]}]}

    return {"error": {"code": "unknown_tool", "message": f"Tool '{name}' not found"}}
