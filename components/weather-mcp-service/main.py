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

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
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

TOOL_DEFINITION = {
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


@app.post("/mcp/tools/list")
async def mcp_tools_list():
    return {"tools": [TOOL_DEFINITION]}


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

    return {"error": {"code": "unknown_tool", "message": f"Tool '{name}' not found"}}
