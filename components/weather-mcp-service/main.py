"""
FastAPI entry-point for the weather-mcp-service.

Routes
  GET  /health                           — liveness check
  POST /query                            — on-demand natural-language weather query
  GET  /risk/latest?location=&horizon=   — latest stored risk assessment (written by Warning_system_engine)
  GET  /potato/risk/latest?location=     — latest stored potato risk (written by Warning_system_engine)
  GET  /geocode?location=                — resolve district name to lat/lon

  POST /mcp/tools/list                   — MCP tool registry (called by gov-chat-backend)
  POST /mcp/tools/call                   — execute named MCP tool

Note: EWS scheduling, classification pipeline, and alert dispatch are owned by
the Warning_system_engine container. This service reads risk data from the shared
ArangoDB instance but does not write it.
"""
import asyncio
import logging
import os
import pathlib
import re
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from mcp_client import MCPClientManager
from agent import WeatherAgent
from mcp_weather.tools.weather_forecast import fetch_forecast_logic

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
mcp_manager:   Optional[MCPClientManager] = None
weather_agent: Optional[WeatherAgent]     = None
storage_layer  = None   # read-only: ArangoDB written by Warning_system_engine


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
                    logger.warning("[INGESTOR] Failed to store %s: %s", fc.location, exc)
            logger.info("[INGESTOR] Refresh complete — %d/%d districts stored", stored, len(forecasts))
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
        logger.warning("[STARTUP] MCP sessions failed: %s — continuing without MCP", exc)
        mcp_manager = None

    # ── ArangoDB read client (risk data written by Warning_system_engine) ─────
    try:
        from storage import StorageLayer
        storage_layer = StorageLayer()
        logger.info("[STARTUP] ArangoDB storage connected (read-only for risk queries)")
    except Exception as exc:
        logger.warning("[STARTUP] ArangoDB unavailable: %s — /risk endpoints disabled", exc)

    # ── WeatherAgent ──────────────────────────────────────────────────────────
    if mcp_manager:
        weather_agent = WeatherAgent(mcp_manager, storage=storage_layer)
        logger.info("[STARTUP] WeatherAgent ready (storage=%s)", storage_layer is not None)
    else:
        logger.warning("[STARTUP] WeatherAgent not started — MCP unavailable")

    # ── Forecast ingestor (runs immediately then every hour) ──────────────────
    _ingestor_task = None
    if storage_layer is not None:
        try:
            from data_ingestor import DataIngestor
            _ingestor = DataIngestor()
            _ingestor_task = asyncio.create_task(_ingestor_loop(_ingestor, storage_layer))
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


# ---------------------------------------------------------------------------
# Agent routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    if weather_agent is None:
        return JSONResponse(
            status_code=503,
            content={
                "status":  "unhealthy",
                "reason":  "agent not initialized",
                "storage": storage_layer is not None,
            },
        )
    return {
        "status":  "healthy",
        "storage": storage_layer is not None,
    }


import urllib.parse

_DATA_DIR = pathlib.Path(__file__).parent / "data"
_MAPBOX_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN", "")
_BULLETIN_PATH = _DATA_DIR / "bulletin.md"
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_BULLETIN_KEYWORDS = re.compile(
    r"\b(bulletin|advisory bulletin|agro.?met|agromet|agrometeorological|agri.*advisory|national bulletin)\b",
    re.IGNORECASE,
)
_PUBLIC_IMAGE_BASE = os.getenv("PUBLIC_API_BASE", "/api/weather/bulletin-image")

_DROUGHT_MONITORING_URL = os.getenv("DROUGHT_MONITORING_URL", "")
_DROUGHT_KEYWORDS = re.compile(
    r"\b(drought|soil[\s\-]?moisture|dry[\s\-]?season|water[\s\-]?stress|"
    r"drought[\s\-]?risk|drought[\s\-]?forecast|drought[\s\-]?outlook|seasonal[\s\-]?risk)\b",
    re.IGNORECASE,
)
_SEASONAL_KEYWORDS = re.compile(
    r"(?:\b[2-6]\s*months?\b|"
    r"\bnext\s+(?:few|couple\s+of?|coming)\s+months?\b|"
    r"\bcoming\s+months?\b|"
    r"\bseasonal\s+(?:forecast|outlook|weather|climate)\b|"
    r"\blong.?term\s+(?:forecast|outlook|weather)\b|"
    r"\bclimate\s+(?:outlook|forecast)\b|"
    r"\bmonsoon\s+(?:season|forecast|outlook)\b)",
    re.IGNORECASE,
)

# Matches runner.py DISTRICT_COORDS
_DROUGHT_DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Dhaka":        (23.8103,  90.4125),
    "Chittagong":   (22.3569,  91.7832),
    "Sylhet":       (24.8949,  91.8687),
    "Rajshahi":     (24.3745,  88.6042),
    "Khulna":       (22.8456,  89.5403),
    "Barisal":      (22.7010,  90.3535),
    "Rangpur":      (25.7439,  89.2752),
    "Mymensingh":   (24.7471,  90.4203),
    "Comilla":      (23.4607,  91.1809),
    "Jessore":      (23.1667,  89.2167),
    "Bogra":        (24.8465,  89.3773),
    "Dinajpur":     (25.6279,  88.6338),
    "Pabna":        (24.0064,  89.2372),
    "Tangail":      (24.2513,  89.9167),
    "Faridpur":     (23.6070,  89.8429),
    "Noakhali":     (22.8696,  91.0995),
    "Brahmanbaria": (23.9608,  91.1115),
    "Cox's Bazar":  (21.4272,  92.0058),
    "Chandpur":     (23.2333,  90.6500),
    "Narsingdi":    (23.9174,  90.7150),
}


def _find_drought_district(query: str) -> tuple[str, float, float] | None:
    """Return (canonical_name, lat, lon) for first district found in query, or None."""
    q = query.lower()
    for name, (lat, lon) in _DROUGHT_DISTRICT_COORDS.items():
        if name.lower() in q:
            return name, lat, lon
    return None


def _parse_horizon_days(query: str) -> int:
    """Parse 'next week/2 weeks/3 weeks/month' from query. Default: 30 (seasonal)."""
    q = query.lower()
    if re.search(r"\b(month|30\s*days?)\b", q):
        return 30
    if re.search(r"\b(three\s*weeks?|3\s*weeks?|21\s*days?)\b", q):
        return 21
    if re.search(r"\b(two\s*weeks?|2\s*weeks?|fortnight|14\s*days?)\b", q):
        return 14
    if re.search(r"\b(week|7\s*days?)\b", q):
        return 7
    return 30


def _parse_seasonal_months(query: str) -> int:
    """Extract requested number of months from a seasonal query. Default: 3."""
    m = re.search(r"\b([2-6])\s*months?\b", query, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return 3


def _build_seasonal_answer(district: str, doc: dict, requested_months: int) -> str:
    """
    Format a Copernicus SEAS5 seasonal forecast document into a chatbot-ready
    markdown summary. Always attributes to Copernicus — never BAMIS/Open-Meteo.
    """
    from calendar import month_name as _month_name

    outlook: list[dict] = doc.get("outlook", [])
    issue_month: str    = doc.get("issue_month", "")
    fetched_at: str     = doc.get("fetched_at", "")[:10]

    # Limit to what the user asked for (and what we have)
    months_to_show = min(requested_months, len(outlook))
    rows = outlook[:months_to_show]

    if not rows:
        return (
            f"## Seasonal Outlook — {district}\n\n"
            "Copernicus SEAS5 seasonal data has been fetched but contains no monthly records. "
            "This is unexpected — please check the warning_system_engine logs."
        )

    # Format issue label
    issue_label = ""
    if issue_month:
        try:
            y, mo = issue_month.split("-")
            issue_label = f"{_month_name[int(mo)]} {y}"
        except Exception:
            issue_label = issue_month

    # Build the month-by-month table
    table_rows = []
    for rec in rows:
        vm = rec.get("valid_month", "")
        try:
            y, mo = vm.split("-")
            month_label = f"{_month_name[int(mo)]} {y}"
        except Exception:
            month_label = vm

        temp  = f"{rec['mean_temp_c']:.1f}°C" if rec.get("mean_temp_c") is not None else "—"
        rain  = f"{rec['total_precip_mm']:.0f} mm" if rec.get("total_precip_mm") is not None else "—"
        wind  = f"{rec['mean_wind_kmh']:.0f} km/h" if rec.get("mean_wind_kmh") is not None else "—"
        humid = f"{rec['estimated_rh_pct']:.0f}%" if rec.get("estimated_rh_pct") is not None else "—"
        table_rows.append(f"| {month_label} | {temp} | {rain} | {wind} | {humid} |")

    table = "\n".join([
        "| Month | Avg Temp | Monthly Rain | Wind | Humidity |",
        "|-------|----------|--------------|------|----------|",
        *table_rows,
    ])

    # Derive a brief narrative from the data
    temps  = [r["mean_temp_c"]   for r in rows if r.get("mean_temp_c")    is not None]
    rains  = [r["total_precip_mm"] for r in rows if r.get("total_precip_mm") is not None]
    humids = [r["estimated_rh_pct"] for r in rows if r.get("estimated_rh_pct") is not None]

    narrative_parts = []
    if temps:
        t_min, t_max = round(min(temps), 1), round(max(temps), 1)
        narrative_parts.append(
            f"Temperatures will range between **{t_min}°C and {t_max}°C**."
        )
    if rains:
        r_max_idx = rains.index(max(rains))
        wettest_month = rows[r_max_idx].get("valid_month", "")
        try:
            y, mo = wettest_month.split("-")
            wettest_label = _month_name[int(mo)]
        except Exception:
            wettest_label = wettest_month
        narrative_parts.append(
            f"The wettest month is expected to be **{wettest_label}** "
            f"({max(rains):.0f} mm)."
        )
    if humids:
        avg_h = sum(humids) / len(humids)
        if avg_h >= 80:
            narrative_parts.append(
                f"Humidity will be consistently high (~{avg_h:.0f}%) — "
                "elevated disease pressure on susceptible crops should be expected."
            )

    narrative = " ".join(narrative_parts)

    # Agricultural notes based on rainfall levels
    agri_notes = []
    if rains:
        heavy_months = [
            rows[i].get("valid_month", "") for i, r in enumerate(rains) if r >= 200
        ]
        if heavy_months:
            labels = []
            for vm in heavy_months:
                try:
                    y, mo = vm.split("-")
                    labels.append(_month_name[int(mo)])
                except Exception:
                    labels.append(vm)
            agri_notes.append(
                f"- Ensure good field drainage during the heavy-rainfall months "
                f"({', '.join(labels)}) to prevent waterlogging."
            )
        if max(rains) < 50:
            agri_notes.append(
                "- Low rainfall forecast — plan supplemental irrigation well in advance."
            )
    if humids and sum(humids) / len(humids) >= 80:
        agri_notes.append(
            "- High humidity throughout — monitor crops for fungal disease and late blight."
        )

    agri_section = (
        "\n**Agricultural Advisory**\n" + "\n".join(agri_notes)
        if agri_notes else ""
    )

    source_line = (
        f"*Source: Copernicus SEAS5 seasonal forecast (ECMWF)"
        + (f" — issued {issue_label}" if issue_label else "")
        + (f", retrieved {fetched_at}" if fetched_at else "")
        + "*"
    )

    return (
        f"## Seasonal Weather Outlook — {district} (next {months_to_show} month{'s' if months_to_show > 1 else ''})\n\n"
        f"{source_line}\n\n"
        f"{table}\n\n"
        f"{narrative}"
        f"{agri_section}"
    )


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
            "tier": 0, "tier_label": "Unknown", "triggers": [], "report_filename": "",
        }

    try:
        resp = _req.post(
            f"{_DROUGHT_MONITORING_URL}/run/district",
            json={"location": district_name, "lat": lat, "lon": lon, "days": horizon_days},
            timeout=180,
        )
        if not resp.ok:
            return {
                "error": f"Drought service error {resp.status_code}",
                "tier": 0, "tier_label": "Unknown", "triggers": [], "report_filename": "",
            }
        data = resp.json()
    except Exception as exc:
        logger.error("[DROUGHT_FORECAST] /run/district failed for %s: %s", district_name, exc)
        return {
            "error": str(exc),
            "tier": 0, "tier_label": "Unknown", "triggers": [], "report_filename": "",
        }

    tier            = data.get("tier", 0)
    tier_label      = data.get("tier_label", "Normal")
    drought_level   = data.get("drought_level", "NORMAL")
    message         = data.get("message", "")
    trend           = data.get("trend", "STABLE")
    trend_run_days  = data.get("trend_run_days", 0)
    triggers        = data.get("triggers", [])
    report_filename = data.get("report_filename", "")

    if horizon_days <= 7:
        horizon_label = "next week"
    elif horizon_days <= 14:
        horizon_label = "next 2 weeks"
    elif horizon_days <= 21:
        horizon_label = "next 3 weeks"
    else:
        horizon_label = "next month"

    level_icon = {"NORMAL": "🟢", "WATCH": "🟡", "MODERATE": "🟠", "SEVERE": "🔴"}.get(drought_level, "⚪")
    trend_icon = {"WORSENING": "📈", "IMPROVING": "📉", "STABLE": "➡️"}.get(trend, "➡️")
    trend_str  = trend + (f" for {trend_run_days} consecutive days" if trend_run_days >= 2 else "")

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
        lines += ["", "No drought stress detected — soil moisture and vegetation within safe ranges."]
    elif tier == 1:
        lines += ["", "⚠️ Early watch — conditions are slightly stressed. Continue monitoring."]
    elif tier == 2:
        lines += ["", "⚠️ **Warning level** — consider water conservation and crop protection."]
    elif tier >= 3:
        lines += ["", "🚨 **Severe drought** — act immediately. Prioritise irrigation and crop protection."]

    if report_filename:
        report_url = f"/api/weather/drought-report/{report_filename}"
        lines += ["", f"📄 [View Full Drought Report]({report_url})"]

    return {
        "answer":          "\n".join(lines),
        "tier":            tier,
        "tier_label":      tier_label,
        "drought_level":   drought_level,
        "triggers":        triggers,
        "trend":           trend,
        "report_filename": report_filename,
        "message":         message,
    }


def _build_drought_answer_from_stored(district: str, stored: dict, requested_horizon: int) -> str:
    """Format a stored ArangoDB drought assessment into a chatbot-ready markdown answer."""
    tier            = stored.get("tier", 0)
    tier_label      = stored.get("tier_label", "Normal")
    drought_level   = stored.get("drought_level", "NORMAL")
    message         = stored.get("message", "")
    trend           = stored.get("trend", "STABLE")
    trend_run_days  = stored.get("trend_run_days", 0)
    triggers        = stored.get("triggers", [])
    report_filename = stored.get("report_filename", "")
    window_days     = stored.get("window_days", 7)

    if requested_horizon <= 7:
        horizon_label = "next week"
    elif requested_horizon <= 14:
        horizon_label = "next 2 weeks"
    elif requested_horizon <= 21:
        horizon_label = "next 3 weeks"
    else:
        horizon_label = "next month"

    level_icon = {"NORMAL": "🟢", "WATCH": "🟡", "MODERATE": "🟠", "SEVERE": "🔴"}.get(drought_level, "⚪")
    trend_icon = {"WORSENING": "📈", "IMPROVING": "📉", "STABLE": "➡️"}.get(trend, "➡️")
    trend_str  = trend + (f" for {trend_run_days} consecutive days" if trend_run_days >= 2 else "")

    lines = [
        f"## Drought Outlook — {district} ({horizon_label})",
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
        lines += ["", "No drought stress detected — soil moisture and vegetation within safe ranges."]
    elif tier == 1:
        lines += ["", "⚠️ Early watch — conditions are slightly stressed. Continue monitoring."]
    elif tier == 2:
        lines += ["", "⚠️ **Warning level** — consider water conservation and crop protection."]
    elif tier >= 3:
        lines += ["", "🚨 **Severe drought** — act immediately. Prioritise irrigation and crop protection."]

    if report_filename:
        lines += ["", f"📄 [View Full Drought Report](/api/weather/drought-report/{report_filename})"]

    lines += ["", f"*Based on {window_days}-day satellite assessment. Updated daily.*"]
    return "\n".join(lines)


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
async def geocode_location(location: str = Query(..., description="Free-text location")):
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
        raise HTTPException(status_code=503, detail="Geocoding unavailable — MAPBOX_ACCESS_TOKEN not configured")

    import requests as _requests
    try:
        encoded = urllib.parse.quote(location)
        resp = _requests.get(
            f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json",
            params={"access_token": _MAPBOX_TOKEN, "limit": 1},
            timeout=5,
        )
        resp.raise_for_status()
        features = resp.json().get("features", [])
        if not features:
            raise HTTPException(status_code=404, detail=f"Location '{location}' not found")
        feat = features[0]
        lon, lat = feat["center"]
        return {"lat": lat, "lon": lon, "name": feat.get("place_name", location), "zoom": 12}
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
    if _SEASONAL_KEYWORDS.search(request.query) and storage_layer:
        district_info = _find_drought_district(request.query)
        district = district_info[0] if district_info else "Dhaka"
        requested_months = _parse_seasonal_months(request.query)
        doc = storage_layer.get_seasonal_forecast(district)
        if doc:
            logger.info("[QUERY] Serving Copernicus seasonal outlook for %s (%d months)", district, requested_months)
            return {
                "answer":     _build_seasonal_answer(district, doc, requested_months),
                "risk_tier":  0,
                "risk_label": "Normal",
                "advisory":   "",
                "triggers":   [],
                "buffer":     None,
                "location":   district,
                "forecast":   {},
            }
        logger.info("[QUERY] Seasonal data not yet available for %s — returning unavailable notice", district)
        return {
            "answer": (
                f"## Seasonal Weather Outlook — {district}\n\n"
                "The long-term seasonal forecast for this district is not yet available. "
                "It is generated once per week from the **Copernicus SEAS5** model (ECMWF) "
                "and will be ready after the first scheduled weekly run.\n\n"
                "For short-term weather (next 1–7 days), please ask something like: "
                f"*\"What is the weather forecast for {district} this week?\"*"
            ),
            "risk_tier":  0,
            "risk_label": "Normal",
            "advisory":   "",
            "triggers":   [],
            "buffer":     None,
            "location":   district,
            "forecast":   {},
        }

    if _BULLETIN_KEYWORDS.search(request.query):
        return {
            "answer":     _build_bulletin_answer(),
            "risk_tier":  0,
            "risk_label": "Normal",
            "advisory":   "",
            "triggers":   [],
            "buffer":     None,
            "location":   "Bangladesh",
            "forecast":   {},
        }

    if _DROUGHT_KEYWORDS.search(request.query) and (storage_layer or _DROUGHT_MONITORING_URL):
        district_info = _find_drought_district(request.query)
        district, lat, lon = district_info if district_info else ("Dhaka", 23.8103, 90.4125)
        horizon_days = _parse_horizon_days(request.query)

        # Path 1: try on-demand GEE assessment (custom horizon, fresh data)
        gee_result = None
        if _DROUGHT_MONITORING_URL:
            import asyncio as _asyncio
            gee_result = await _asyncio.get_event_loop().run_in_executor(
                None, lambda: _assess_drought_forecast_logic(district, lat, lon, horizon_days)
            )
            if "error" in gee_result:
                logger.warning("[QUERY] On-demand GEE failed (%s) — trying stored assessment", gee_result["error"])
                gee_result = None

        if gee_result is not None:
            return {
                "answer":     gee_result["answer"],
                "risk_tier":  gee_result["tier"],
                "risk_label": gee_result["tier_label"],
                "advisory":   gee_result.get("message", ""),
                "triggers":   gee_result.get("triggers", []),
                "buffer":     None,
                "location":   district,
                "forecast":   {},
            }

        # Path 2: fall back to stored assessment in ArangoDB (populated by daily scheduler)
        if storage_layer:
            stored = storage_layer.get_drought_assessment(district)
            if stored:
                logger.info("[QUERY] Using stored drought assessment for %s", district)
                return {
                    "answer":     _build_drought_answer_from_stored(district, stored, horizon_days),
                    "risk_tier":  stored.get("tier", 0),
                    "risk_label": stored.get("tier_label", "Normal"),
                    "advisory":   stored.get("message", ""),
                    "triggers":   stored.get("triggers", []),
                    "buffer":     None,
                    "location":   district,
                    "forecast":   {},
                }

        # Path 3: nothing available — return a clear message, not a weather fallback
        return {
            "answer": (
                f"## Drought Outlook — {district}\n\n"
                "Drought assessment data is not yet available for this district.\n\n"
                "The drought monitoring pipeline runs daily at 07:00 UTC and requires "
                "Google Earth Engine satellite credentials. Once configured, assessments "
                "are stored and available instantly.\n\n"
                "For an immediate test assessment, an administrator can run:\n"
                "```\n"
                f"python3 scripts/test_drought_alert_flow.py --scenario moderate --district {district}\n"
                "```"
            ),
            "risk_tier":  0,
            "risk_label": "Normal",
            "advisory":   "",
            "triggers":   [],
            "buffer":     None,
            "location":   district,
            "forecast":   {},
        }

    if weather_agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    result = await weather_agent.run(request.query)
    return result


@app.get("/risk/latest")
async def get_latest_risk(
    location: str = Query(..., description="Bangladesh district name (e.g. 'Dhaka', 'Sylhet')"),
    horizon:  str = Query("short", description="'short' (0–7 d) or 'long' (8–30 d)"),
):
    """
    Return the most recent stored risk assessment for a district.

    Falls back to classifying a live BMD forecast if no stored assessment exists.
    Returns 404 if neither source is available.
    """
    if storage_layer is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Storage not available — early warning infrastructure offline"},
        )

    assessment = storage_layer.get_latest_risk(location, horizon)
    if assessment:
        return assessment.model_dump()

    # No stored assessment — run a live on-demand query and classify inline
    if weather_agent:
        try:
            result = await weather_agent.run(f"What is the weather in {location}?")
            return {
                "location":    location,
                "assessed_at": None,
                "horizon":     horizon,
                "tier":        result.get("risk_tier", 0),
                "tier_label":  result.get("risk_label", "Normal"),
                "triggers":    result.get("triggers", []),
                "reasoning":   result.get("advisory", ""),
                "source":      "live_query",
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    raise HTTPException(
        status_code=404,
        detail=f"No risk data for '{location}' and live fallback unavailable",
    )


@app.get("/potato/risk/latest")
async def get_potato_risk(
    location: str = Query(..., description="Bangladesh district name (e.g. 'Dhaka')"),
):
    """
    Return the most recent stored potato risk assessment for a district.
    Returns tier=0 (Normal) if no assessment has been stored yet.
    """
    if storage_layer is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Storage unavailable"},
        )

    assessment = storage_layer.get_latest_crop_risk(location, "potato")
    if assessment is None:
        return {"location": location, "crop": "potato", "tier": 0, "tier_label": "Normal", "triggers": [], "message": ""}

    # Strip internal ArangoDB fields before returning
    for field in ("_key", "_id", "_rev"):
        assessment.pop(field, None)
    return assessment


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
            "location":     location,
            "drought_level": "NORMAL",
            "tier":          0,
            "tier_label":    "Normal",
            "triggers":      [],
            "message":       "",
        }

    for field in ("_key", "_id", "_rev"):
        assessment.pop(field, None)
    return assessment


_DROUGHT_REPORTS_DIR = pathlib.Path(os.getenv("DROUGHT_REPORTS_DIR", "/app/drought_reports"))


@app.get("/drought/report/{filename}")
async def serve_drought_report(filename: str):
    """
    Serve a drought PDF report from the shared volume.
    The drought_monitoring container writes to the same named volume.
    """
    safe_name   = pathlib.Path(filename).name
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
            district_name=args.get("district_name", ""),
            forecast_days=args.get("forecast_days", 3),
            parameters=args.get("parameters", []),
        )
        return {"content": [{"type": "text", "text": result_str}]}

    if name == "assess_drought_forecast":
        district_name = args.get("district_name", "Dhaka")
        horizon_days  = int(args.get("horizon_days", 30))

        district_info = _find_drought_district(district_name)
        if district_info:
            district, lat, lon = district_info
        else:
            # Fallback: check exact key match
            coords = _DROUGHT_DISTRICT_COORDS.get(district_name)
            if coords:
                district, lat, lon = district_name, coords[0], coords[1]
            else:
                return {"content": [{"type": "text", "text": f"District '{district_name}' not found in supported Bangladesh districts."}]}

        import asyncio as _asyncio
        result = await _asyncio.get_event_loop().run_in_executor(
            None, lambda: _assess_drought_forecast_logic(district, lat, lon, horizon_days)
        )

        if "error" in result:
            return {"content": [{"type": "text", "text": f"Drought assessment failed: {result['error']}"}]}

        return {"content": [{"type": "text", "text": result["answer"]}]}

    return {"error": {"code": "unknown_tool", "message": f"Tool '{name}' not found"}}
