"""
AMINA Care — Guarded + Training-Consent + Literacy Entry Point
================================================================
The combined uvicorn entry shipped via docker-compose.override.yml.
This is a superset of main_with_training.py — everything it does, plus
the literacy verification + mode system.

Import order:
  1. overflow_guard_patch      (wraps AminaAgent clients)
  2. src.main                  (real FastAPI app)
  3. training_routes           (mounted + training consent schema hook)
  4. literacy_routes           (mounted + literacy schema hook)

Uvicorn target: src.main_with_literacy:app
"""

from __future__ import annotations

import logging

logging.basicConfig(level=logging.INFO)
for name in (
    "src.services.overflow_guard",
    "src.services.overflow_guard_patch",
    "src.services.training_consent",
    "src.services.training_export",
    "src.services.literacy_service",
    "src.services.certificate_storage",
    "src.api.training_routes",
    "src.api.literacy_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_literacy")

# STEP 1 — overflow guard (monkeypatches AminaAgent + caregiver service)
from src.services import overflow_guard_patch  # noqa: F401,E402

# STEP 2 — real FastAPI app
from src.main import app  # noqa: E402

# STEP 3 — mount training router + schema hook
from src.api.training_routes import router as _training_router  # noqa: E402
app.include_router(_training_router, prefix="/api/v1")
_log.info("✅ training router mounted at /api/v1/training")

from src.services.training_consent import ensure_training_consent_schema  # noqa: E402


@app.on_event("startup")
async def _ensure_training_consent_schema_on_startup():
    try:
        ensure_training_consent_schema()
        _log.info("✅ TrainingConsent schema ready")
    except Exception as e:
        _log.warning(f"TrainingConsent schema init warning: {e}")


# STEP 4 — mount literacy router + schema hook
from src.api.literacy_routes import router as _literacy_router  # noqa: E402
app.include_router(_literacy_router, prefix="/api/v1")
_log.info("✅ literacy router mounted at /api/v1/literacy")

# STEP 5 — mount admin + gov materialized-view routes
try:
    from src.api.admin_mv_routes import router as _admin_mv_router  # noqa: E402
    app.include_router(_admin_mv_router, prefix="/api/v1")
    _log.info("✅ admin + gov MV routes mounted at /api/v1/{admin,gov}/mv/*")
except Exception as _e:
    _log.warning(f"admin_mv_routes mount skipped: {_e}")

from src.services.literacy_service import ensure_literacy_schema  # noqa: E402
from src.services.certificate_storage import ensure_cert_dir  # noqa: E402


@app.on_event("startup")
async def _ensure_literacy_schema_on_startup():
    try:
        ensure_literacy_schema()
        ensure_cert_dir()
        _log.info("✅ Literacy schema ready + certificate storage dir ensured")
    except Exception as e:
        _log.warning(f"Literacy schema init warning: {e}")


__all__ = ["app"]
