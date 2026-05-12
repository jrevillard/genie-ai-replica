"""
FastAPI entrypoint for the drought_monitoring microservice.

Endpoints:
  GET  /health        — liveness check
  POST /run/all       — run drought pipeline for all Bangladesh districts
  POST /run/district  — run for a single district (body: {location, lat, lon, days})

Called by warning_system_engine on its cron schedule.
This service does NOT run its own scheduler.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("drought_monitoring")

app = FastAPI(title="Drought Monitoring Service")

_REPORTS_DIR = os.getenv("DROUGHT_REPORTS_DIR", "/app/reports")


# ---------------------------------------------------------------------------
# Shared storage (lazy-initialised on first request)
# ---------------------------------------------------------------------------

_storage = None


def _get_storage():
    global _storage
    if _storage is None:
        from storage import DroughtStorage
        _storage = DroughtStorage()
    return _storage


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class DistrictRunRequest(BaseModel):
    location: str
    lat: float
    lon: float
    days: int = 7


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    from runner import gee_configured
    return {
        "status":         "healthy",
        "gee_configured": gee_configured(),
        "reports_dir":    _REPORTS_DIR,
    }


@app.post("/run/all")
def run_all():
    """
    Run drought assessment for all Bangladesh districts.
    Blocking — may take several minutes (GEE rate limits).
    Called by warning_system_engine scheduler.
    """
    from runner import run_all_districts
    try:
        storage = _get_storage()
    except Exception as exc:
        logger.error("[API] ArangoDB unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=f"ArangoDB unavailable: {exc}")

    result = run_all_districts(storage, reports_dir=_REPORTS_DIR)
    status_code = 200 if result.get("error") is None else 206
    return JSONResponse(content=result, status_code=status_code)


@app.post("/run/district")
def run_district(req: DistrictRunRequest):
    """
    Run drought assessment for a single district.
    Useful for on-demand queries or testing.
    """
    from runner import _run_one_district, gee_configured, DISTRICT_COORDS
    import ee  # type: ignore

    if not gee_configured():
        raise HTTPException(
            status_code=503,
            detail="GEE credentials not configured. Mount a service account JSON at /app/secrets/credentials.json.",
        )

    try:
        storage = _get_storage()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"ArangoDB unavailable: {exc}")

    try:
        from utils.gee_auth import initialize_gee
        initialize_gee()
        assessment = _run_one_district(
            storage, req.location, req.lat, req.lon, req.days, _REPORTS_DIR
        )
        return assessment or {"location": req.location, "error": "no_data"}
    except Exception as exc:
        logger.error("[API] District run failed for %s: %s", req.location, exc)
        raise HTTPException(status_code=500, detail=str(exc))
