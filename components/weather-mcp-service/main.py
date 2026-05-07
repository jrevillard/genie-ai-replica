"""
FastAPI entry-point for the weather-mcp-service.

Routes
  GET  /health                           — liveness check
  POST /query                            — on-demand natural-language weather query
  GET  /risk/latest?location=&horizon=   — latest stored risk assessment for a location
  POST /internal/run-pipeline            — manual trigger for the hourly ingestion pipeline

  POST /mcp/tools/list                   — MCP tool registry (called by gov-chat-backend)
  POST /mcp/tools/call                   — execute named MCP tool
"""
import asyncio
import logging
import os
import pathlib
import re
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
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
mcp_manager:    Optional[MCPClientManager] = None
weather_agent:  Optional[WeatherAgent]     = None
storage_layer   = None
data_ingestor   = None
risk_engine     = None
notifier        = None
scheduler       = None
potato_ews      = None


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global mcp_manager, weather_agent
    global storage_layer, data_ingestor, risk_engine, notifier, scheduler, potato_ews

    # ── MCP stdio sessions (Mapbox + BMD) ────────────────────────────────────
    try:
        mcp_manager = MCPClientManager()
        await mcp_manager.start()
        logger.info("[STARTUP] MCP sessions initialised")
    except Exception as exc:
        logger.warning("[STARTUP] MCP sessions failed: %s — continuing without MCP", exc)
        mcp_manager = None

    # ── Early warning infrastructure ─────────────────────────────────────────
    try:
        from storage import StorageLayer
        from data_ingestor import DataIngestor
        from risk_engine import RiskEngine
        from notifier import Notifier

        from short_term_potato_ews import PotatoShortTermEWS

        storage_layer = StorageLayer()
        data_ingestor = DataIngestor()
        risk_engine   = RiskEngine()
        notifier      = Notifier(storage_layer)
        potato_ews    = PotatoShortTermEWS(storage_layer)
        logger.info("[STARTUP] Early warning infrastructure ready (potato EWS loaded)")
    except Exception as exc:
        logger.warning(
            "[STARTUP] Early warning infrastructure unavailable: %s — "
            "storage/pipeline features disabled", exc
        )

    # ── WeatherAgent (depends on MCP + optionally storage) ───────────────────
    if mcp_manager:
        weather_agent = WeatherAgent(mcp_manager, storage=storage_layer)
        logger.info("[STARTUP] WeatherAgent ready (storage=%s)", storage_layer is not None)
    else:
        logger.warning("[STARTUP] WeatherAgent not started — MCP unavailable")

    # ── APScheduler ──────────────────────────────────────────────────────────
    if storage_layer and data_ingestor:
        try:
            from scheduler import create_scheduler
            scheduler = create_scheduler(storage_layer, data_ingestor, risk_engine, notifier, potato_ews)
            scheduler.start()
            logger.info("[STARTUP] Scheduler started")
        except Exception as exc:
            logger.warning("[STARTUP] Scheduler failed to start: %s", exc)

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[SHUTDOWN] Scheduler stopped")
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
                "status": "unhealthy",
                "reason": "agent not initialized",
                "storage": storage_layer is not None,
                "scheduler": scheduler is not None and scheduler.running,
            },
        )
    return {
        "status":    "healthy",
        "storage":   storage_layer is not None,
        "scheduler": scheduler is not None and (scheduler.running if scheduler else False),
    }


_DATA_DIR = pathlib.Path(__file__).parent / "data"
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


@app.post("/internal/run-potato-pipeline")
async def trigger_potato_pipeline(background_tasks: BackgroundTasks):
    """
    Manually trigger potato EWS evaluation for all districts.
    Runs in background — returns immediately.
    """
    if storage_layer is None or potato_ews is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Potato EWS not initialised"},
        )

    from scheduler import run_potato_ews_pipeline

    background_tasks.add_task(run_potato_ews_pipeline, storage_layer, potato_ews, notifier)
    return {"status": "potato_pipeline_started"}


@app.post("/internal/run-pipeline")
async def trigger_pipeline(background_tasks: BackgroundTasks):
    """
    Manually trigger the hourly ingestion + classification pipeline.
    Runs in a FastAPI background task — returns immediately.
    Used by ops tooling and integration tests.
    """
    if storage_layer is None or data_ingestor is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Pipeline not initialised — storage or ingestor unavailable"},
        )

    from scheduler import run_hourly_pipeline

    background_tasks.add_task(
        run_hourly_pipeline,
        storage_layer,
        data_ingestor,
        risk_engine,
        notifier,
        potato_ews,
    )
    return {"status": "pipeline_started", "message": "Hourly pipeline running in background"}


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
