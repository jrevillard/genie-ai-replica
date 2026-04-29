"""
AMINA Care — Supply Ledger Entry Point
=======================================
Strict superset of main_with_dhis2_history. Adds:

  - /api/v1/care/supply_ledger/{sid}                      (GET)
  - /api/v1/care/supply_ledger/{sid}/add                  (POST)
  - /api/v1/care/supply_ledger/{sid}/medications/{index}  (PATCH, DELETE)

These complement the existing PUT /api/v1/care/supply (name-upsert) by
giving the UI a real multi-entry ledger with a 10-entry cap + per-row
edit + delete. The cap is configurable via SUPPLY_LEDGER_CAP env (default
10, clamped to [1, 50]).

Chain order:
  Supply-ledger  <-  DHIS2-history  <-  Gap-closers  <-  Resilience
                 <-  Inbox          <-  Literacy     <-  main

Uvicorn target: src.main_with_supply_ledger:app
"""

from __future__ import annotations

import logging

# Inherit the whole stack (dhis2-history → ... → main).
from src.main_with_dhis2_history import app  # noqa: E402,F401

for name in (
    "src.api.supply_ledger_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_supply_ledger")

from src.api.supply_ledger_routes import router as _ledger_router  # noqa: E402
app.include_router(_ledger_router, prefix="/api/v1")
_log.info("✅ Supply-ledger router mounted at /api/v1/care/supply_ledger "
          "(list, add, patch, delete — 10-entry cap)")


__all__ = ["app"]
