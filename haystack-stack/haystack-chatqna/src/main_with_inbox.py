"""
AMINA Care — Guarded + Training + Literacy + Inbox Entry Point
=================================================================
Superset of main_with_literacy.py. Imports the existing app (which already
carries training + literacy routes), then mounts the inbox router and
ensures the inbox schema + file storage dir on startup.

Import order:
  1. src.main_with_literacy    (brings in: overflow guard, main app,
                                training + literacy routers & schemas)
  2. inbox_routes              (mounted + schema hook + storage dir hook)

Uvicorn target: src.main_with_inbox:app

All of this is ADDITIVE — no edits to main.py, main_with_literacy.py, or any
existing router file. Swapping the entrypoint via compose override is the
single point of opt-in.
"""

from __future__ import annotations

import logging

# STEP 1 — bring up the full literacy-level app (guard + training + literacy).
# Importing this module triggers all of its startup handlers as a side
# effect — we inherit every route it mounted.
from src.main_with_literacy import app  # noqa: E402,F401

for name in (
    "src.services.inbox_service",
    "src.services.file_token_service",
    "src.api.inbox_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_inbox")

# STEP 2 — mount the inbox router.
from src.api.inbox_routes import router as _inbox_router  # noqa: E402

app.include_router(_inbox_router, prefix="/api/v1")
_log.info("✅ inbox router mounted at /api/v1/inbox")

# STEP 3 — schema + disk bootstrap on startup.
from src.services.inbox_service import ensure_inbox_schema  # noqa: E402
from src.services.file_token_service import ensure_storage_dir  # noqa: E402


@app.on_event("startup")
async def _ensure_inbox_on_startup():
    try:
        ensure_inbox_schema()
        ensure_storage_dir()
        _log.info("✅ Inbox schema ready + file storage dir ensured")
    except Exception as e:
        _log.warning(f"Inbox init warning: {e}")


__all__ = ["app"]
