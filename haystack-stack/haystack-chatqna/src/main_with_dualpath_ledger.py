"""
AMINA Care — Dual-Path Ledger Entry Point
==========================================
Strict superset of main_with_supply_ledger. Adds:

  - /api/v1/care/dualpath_ledger/{sid}                       (GET)
  - /api/v1/care/dualpath_ledger/{sid}/{type}                (GET)
  - /api/v1/care/dualpath_ledger/{sid}/{type}/add            (POST)
  - /api/v1/care/dualpath_ledger/{sid}/{type}/{index}        (PATCH, DELETE)

Types: traditional | modern | interaction | progress. Each has its own
10-entry cap (configurable via DUALPATH_LEDGER_CAP env, clamped [1,50]).

Chain order:
  Dual-path ledger  <-  Supply ledger  <-  DHIS2 history  <-  Gap-closers
                    <-  Resilience     <-  Inbox          <-  Literacy
                    <-  main

Uvicorn target: src.main_with_dualpath_ledger:app
"""

from __future__ import annotations

import logging

# Inherit the whole stack (supply-ledger → dhis2-history → ... → main).
from src.main_with_supply_ledger import app  # noqa: E402,F401

for name in (
    "src.api.dualpath_ledger_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_dualpath_ledger")

from src.api.dualpath_ledger_routes import router as _dualpath_router  # noqa: E402
app.include_router(_dualpath_router, prefix="/api/v1")
_log.info("✅ Dual-path-ledger router mounted at /api/v1/care/dualpath_ledger "
          "(traditional, modern, interaction, progress — 10-entry cap per type)")


__all__ = ["app"]
