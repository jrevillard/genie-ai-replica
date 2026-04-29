"""
AMINA Care — Intent Review Entry Point
=======================================
Strict superset of main_with_emergency. Adds:

  /api/v1/intent-review/suspected-misses
  /api/v1/intent-review/correct
  /api/v1/intent-review/correct-from-miss
  /api/v1/intent-review/kill
  /api/v1/intent-review/kill-intent
  /api/v1/intent-review/corrections
  /api/v1/intent-review/audit
  /api/v1/intent-review/stats
  /api/v1/intent-review/weekly-report
  /api/v1/intent-review/re-evaluate
  /api/v1/intent-review/retire-stale

CHW / admin-facing API for reviewing intent misclassifications and
submitting corrections that teach the intent router.

Also runs the 90-day correction TTL retirement as a daily background task.

Uvicorn target: src.main_with_intent_review:app
"""
from __future__ import annotations

import asyncio
import logging
import os

from src.main_with_emergency import app  # noqa: E402,F401

_log = logging.getLogger("src.main_with_intent_review")

_ENABLED = os.getenv("USE_INTENT_LEARNER", "false").lower() == "true"

# ── Patient AMINA ID routes (always on) ──────────────────────────
try:
    from src.api.patient_id_routes import router as _pid_router
    app.include_router(_pid_router, prefix="/api/v1")
    _log.info("✅ Patient AMINA ID routes mounted at /api/v1")
except Exception as _pid_err:
    _log.warning(f"patient_id_routes mount failed: {_pid_err}")

if _ENABLED:
    from src.api.intent_review_routes import router as _review_router  # noqa: E402
    app.include_router(_review_router, prefix="/api/v1")
    _log.info("✅ Intent review router mounted at /api/v1/intent-review")

    # ── daily correction retirement ──────────────────────────────
    _retire_task = None
    RETIRE_EVERY_SECONDS = 86400  # once per day

    async def _retire_loop():
        while True:
            try:
                await asyncio.sleep(RETIRE_EVERY_SECONDS)
                from src.services.intent_learner import retire_stale_corrections
                retired = await retire_stale_corrections()
                if retired:
                    _log.info(f"intent_learner: daily retirement: {retired} stale corrections retired")
            except asyncio.CancelledError:
                break
            except Exception as exc:
                _log.warning(f"intent_learner: retire loop failed: {exc}")

    @app.on_event("startup")
    async def _start_retire_worker():
        global _retire_task
        if _retire_task is None or _retire_task.done():
            _retire_task = asyncio.create_task(_retire_loop())
            _log.info("✅ Intent correction retirement worker started (daily)")

        # Ensure ArcadeDB schema exists
        try:
            from src.services.intent_learner import ensure_schema
            ensure_schema()
        except Exception as e:
            _log.warning(f"intent_learner: schema init failed (non-fatal): {e}")

        # Load intent pattern graph into Redis (four-layer router Layer 3)
        if os.getenv("USE_INTENT_PATTERN_GRAPH", "false").lower() == "true":
            try:
                from src.services.intent_pattern_graph import load_graph
                _graph_count = load_graph()
                _log.info(f"✅ Intent pattern graph loaded ({_graph_count} nodes)")
            except Exception as e:
                _log.warning(f"intent_pattern_graph: load failed (non-fatal): {e}")

    @app.on_event("shutdown")
    async def _stop_retire_worker():
        global _retire_task
        if _retire_task and not _retire_task.done():
            _retire_task.cancel()

else:
    _log.info("Intent learner disabled (USE_INTENT_LEARNER != true)")


__all__ = ["app"]
