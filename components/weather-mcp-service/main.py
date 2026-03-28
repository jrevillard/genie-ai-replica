"""
FastAPI entry-point for the weather-mcp-service.

Routes
  GET  /health                           — liveness check
  POST /query                            — on-demand natural-language weather query
  GET  /risk/latest?location=&horizon=   — latest stored risk assessment for a location
  POST /internal/run-daily-pipeline      — manual trigger for the daily ingestion pipeline

  POST /mcp/tools/list                   — MCP tool registry (called by gov-chat-backend)
  POST /mcp/tools/call                   — execute named MCP tool
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from mcp_client import MCPClientManager
from agent import WeatherAgent
from mcp_weather.tools.weather_forecast import fetch_forecast_logic

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


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global mcp_manager, weather_agent
    global storage_layer, data_ingestor, risk_engine, notifier, scheduler

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

        storage_layer = StorageLayer()
        data_ingestor = DataIngestor()
        risk_engine   = RiskEngine()
        notifier      = Notifier(storage_layer)
        logger.info("[STARTUP] Early warning infrastructure ready")
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
            scheduler = create_scheduler(storage_layer, data_ingestor, risk_engine, notifier)
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


@app.post("/internal/run-daily-pipeline")
async def trigger_daily_pipeline(background_tasks: BackgroundTasks):
    """
    Manually trigger the daily short-term ingestion + classification pipeline.
    Runs in a FastAPI background task — returns immediately.
    Used by ops tooling, cron hooks, and integration tests.
    """
    if storage_layer is None or data_ingestor is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Pipeline not initialised — storage or ingestor unavailable"},
        )

    from scheduler import run_daily_pipeline

    background_tasks.add_task(
        run_daily_pipeline,
        storage_layer,
        data_ingestor,
        risk_engine,
        notifier,
    )
    return {"status": "pipeline_started", "message": "Daily pipeline running in background"}


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
