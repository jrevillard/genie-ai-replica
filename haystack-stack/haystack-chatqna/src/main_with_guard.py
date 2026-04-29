"""
AMINA Care — Guarded Entry Point
=================================
Drop-in replacement for `src.main` that installs the overflow guard BEFORE
the FastAPI app is imported. Uvicorn should target this module:

    uvicorn src.main_with_guard:app --host 0.0.0.0 --port 8000

The only thing this file does is import order:
    1. overflow_guard_patch  (monkeypatches AminaAgent + caregiver service)
    2. src.main              (the real FastAPI app, unchanged)

By the time any route handler calls `get_agent()`, AminaAgent.__init__ has
already been patched, so every client the agent creates comes pre-wrapped
with pre-trim + overflow-retry protection.

This file contains NO route definitions, NO config, NO business logic — it
is purely a startup shim. It never touches existing code.
"""

from __future__ import annotations

import logging

# Configure a minimal logger for the guard's own messages so they show up in
# container logs even if the app's logging config hasn't been initialised yet.
logging.basicConfig(level=logging.INFO)
logging.getLogger("src.services.overflow_guard").setLevel(logging.INFO)
logging.getLogger("src.services.overflow_guard_patch").setLevel(logging.INFO)

# STEP 1 — install the overflow guard. Must happen before src.main imports
# amina_agent (which happens transitively via src.api.agent_routes).
from src.services import overflow_guard_patch  # noqa: F401,E402

# STEP 2 — import the real FastAPI app and re-export it so uvicorn can find
# `src.main_with_guard:app`. All routers, middleware, and config live on the
# real `app` object — we don't shadow or wrap it.
from src.main import app  # noqa: F401,E402

# Expose at module level for uvicorn: `src.main_with_guard:app`
__all__ = ["app"]
