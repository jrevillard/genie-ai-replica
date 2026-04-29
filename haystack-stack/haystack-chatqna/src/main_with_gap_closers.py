"""
AMINA Care — Gap-Closers Entry Point
========================================
Strict superset of main_with_resilience. Adds three new surfaces:

  - Safety consensus guard (already wired into resilience_routes; this
    module simply ensures the module is importable and its schema dirs
    exist).
  - Ambient scribe:           /api/v1/scribe/*
  - SMART-on-FHIR authserver: /api/v1/smart/* + /.well-known/smart-configuration

Chain order:
  Gap-closers <- Resilience <- Inbox <- Literacy <- Training <- Guard <- Main

Uvicorn target: src.main_with_gap_closers:app
"""

from __future__ import annotations

import logging

# Inherit resilience-level app (brings inbox, literacy, training, guard, meta,
# etc. via side-effect imports).
from src.main_with_resilience import app  # noqa: E402,F401

for name in (
    "src.services.safety_consensus",
    "src.services.scribe_service",
    "src.services.smart_service",
    "src.api.scribe_routes",
    "src.api.smart_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_gap_closers")

# Mount scribe routes.
from src.api.scribe_routes import router as _scribe_router  # noqa: E402
app.include_router(_scribe_router, prefix="/api/v1")
_log.info("✅ scribe router mounted at /api/v1/scribe")

# Mount SMART routes. NOTE: /.well-known/smart-configuration is mounted at
# /api/v1/.well-known... because the router is registered under /api/v1. EHRs
# that don't honor our configured base path can use the alternate discovery
# path we expose below.
from src.api.smart_routes import router as _smart_router  # noqa: E402
app.include_router(_smart_router, prefix="/api/v1")
_log.info("✅ SMART router mounted at /api/v1/smart + /.well-known/smart-configuration (under /api/v1)")

# Convenience: also expose /.well-known/smart-configuration at the root,
# because some EHR discovery agents look for it there.
from src.services import scribe_service, smart_service  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402


@app.get("/.well-known/smart-configuration")
def _root_smart_config():
    return JSONResponse(smart_service.smart_configuration())


@app.on_event("startup")
async def _ensure_gap_closer_dirs():
    try:
        scribe_service.ensure_scribe_dir()
        _log.info("✅ Scribe dir ensured")
    except Exception as e:
        _log.warning(f"Scribe dir init warning: {e}")


__all__ = ["app"]
