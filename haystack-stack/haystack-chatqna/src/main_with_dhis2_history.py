"""
AMINA Care — DHIS2 History + Discovery Entry Point
=====================================================
Strict superset of main_with_gap_closers. Adds:

  - /api/v1/dhis2/sync/history            (aggregate audit log)
  - /api/v1/dhis2/sync/history/tracker    (patient-level tracker audit log)
  - /api/v1/dhis2/discover                (live DHIS2 discovery)
  - /api/v1/dhis2/discover/dataset/{id}
  - /api/v1/dhis2/discover/orgunit/{id}/children
  - /api/v1/dhis2/mapping/current

Chain order:
  DHIS2-history <- Gap-closers <- Resilience <- Inbox <- Literacy <- ...

Uvicorn target: src.main_with_dhis2_history:app
"""

from __future__ import annotations

import logging

# Inherit the whole stack (gap-closers → ... → main).
from src.main_with_gap_closers import app  # noqa: E402,F401

# Patch the DHIS2 push path with ?force=true so future-dated periods on the
# DHIS2 sandbox import cleanly. Controlled by env DHIS2_FORCE_PUSH (default on).
from src.services import dhis2_force_push  # noqa: E402,F401

for name in (
    "src.services.dhis2_history",
    "src.api.dhis2_history_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_dhis2_history")

from src.api.dhis2_history_routes import router as _history_router  # noqa: E402
app.include_router(_history_router, prefix="/api/v1")
_log.info("✅ DHIS2 history + discovery router mounted at /api/v1/dhis2 "
          "(history, discover, mapping/current)")


__all__ = ["app"]
