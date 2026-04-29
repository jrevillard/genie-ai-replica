"""
AMINA Care — Guarded + Training-Consent Entry Point
=====================================================
Chains the overflow guard AND the training-consent extensions, then imports
the real FastAPI app and mounts the training router. This is the uvicorn
target shipped via docker-compose.override.yml:

    uvicorn src.main_with_training:app

Import order (critical):
  1. overflow_guard_patch     (wraps AminaAgent OpenAI clients — must run
                               BEFORE src.main because agent_routes imports
                               amina_agent which instantiates AminaAgent)
  2. src.main                 (real FastAPI app — routers, middleware, etc.)
  3. training_routes          (mounted onto the real app via include_router)
  4. register startup hook    (ensures TrainingConsent schema exists)

This file contains NO route definitions, NO config, NO business logic — it
is purely a startup shim. It never touches existing code.
"""

from __future__ import annotations

import logging

logging.basicConfig(level=logging.INFO)
logging.getLogger("src.services.overflow_guard").setLevel(logging.INFO)
logging.getLogger("src.services.overflow_guard_patch").setLevel(logging.INFO)
logging.getLogger("src.services.training_consent").setLevel(logging.INFO)
logging.getLogger("src.services.training_export").setLevel(logging.INFO)
logging.getLogger("src.api.training_routes").setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_training")

# STEP 1 — overflow guard monkeypatches AminaAgent + caregiver service.
from src.services import overflow_guard_patch  # noqa: F401,E402

# STEP 2 — import the real FastAPI app (its @on_event("startup") hooks
# won't fire yet; uvicorn runs them after the ASGI lifespan begins).
from src.main import app  # noqa: E402

# STEP 3 — mount the training router on the real app.
from src.api.training_routes import router as _training_router  # noqa: E402
app.include_router(_training_router, prefix="/api/v1")
_log.info("✅ training router mounted at /api/v1/training")

# STEP 4 — ensure training consent schema exists at startup (idempotent).
from src.services.training_consent import ensure_training_consent_schema  # noqa: E402


@app.on_event("startup")
async def _ensure_training_consent_schema_on_startup():
    try:
        ensure_training_consent_schema()
        _log.info("✅ TrainingConsent schema ready")
    except Exception as e:
        _log.warning(f"TrainingConsent schema init warning: {e}")


# Expose at module level for uvicorn: `src.main_with_training:app`
__all__ = ["app"]
