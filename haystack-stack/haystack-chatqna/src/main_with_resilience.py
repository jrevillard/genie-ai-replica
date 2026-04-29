"""
AMINA Care — Resilience Entry Point
======================================
Strict superset of main_with_inbox. Adds:
  - /api/v1/agent/chat-resilient  (automatic model fallback)
  - /api/v1/models/status
  - /api/v1/models/{model}/reset

Nothing else changes. Chain order:
  Inbox <- Literacy <- Training <- Guard <- Main

Uvicorn target: src.main_with_resilience:app
"""

from __future__ import annotations

import logging

# Bring up the full inbox-level app. Side-effect imports its startup hooks.
from src.main_with_inbox import app  # noqa: E402,F401

for name in (
    "src.services.model_health",
    "src.services.model_fallback",
    "src.api.resilience_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_resilience")

from src.api.resilience_routes import router as _resilience_router  # noqa: E402

app.include_router(_resilience_router, prefix="/api/v1")
_log.info("✅ resilience router mounted at /api/v1 "
          "(/agent/chat-resilient + /models/status + /models/{model}/reset)")


__all__ = ["app"]
