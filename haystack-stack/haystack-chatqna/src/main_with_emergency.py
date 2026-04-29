"""
AMINA Care — Emergency Escalation Entry Point
===============================================
Strict superset of main_with_caregiver_notify. Adds:

  /api/v1/emergency/alert
  /api/v1/emergency/for-me
  /api/v1/emergency/active
  /api/v1/emergency/{id}
  /api/v1/emergency/{id}/ack
  /api/v1/emergency/{id}/notify-authorities
  /api/v1/emergency/{id}/resolve
  /api/v1/emergency/hospitals
  /api/v1/emergency/tick

Also starts a background asyncio task that ticks the escalation state
machine every 30 seconds — advances alerts from:
  pending → hotline_prompted (after EMERGENCY_HOTLINE_PROMPT_MIN)
  anything → admin_escalated   (after EMERGENCY_ADMIN_ESCALATE_MIN)

Uvicorn target: src.main_with_emergency:app
"""
from __future__ import annotations

import asyncio
import logging

from src.main_with_caregiver_notify import app  # noqa: E402,F401

for name in (
    "src.services.emergency_escalation",
    "src.api.emergency_routes",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_emergency")

from src.api.emergency_routes import router as _er  # noqa: E402
app.include_router(_er, prefix="/api/v1")
_log.info("✅ Emergency escalation router mounted at /api/v1/emergency "
          "(alert/ack/notify-authorities/resolve + admin list + hospitals)")


# ── background escalation ticker ──────────────────────────────────

TICK_EVERY_SECONDS = 30
_tick_task = None


async def _escalation_tick_loop():
    """Periodically run the escalation service's tick() method so that
    alerts advance from pending → hotline_prompted → admin_escalated
    without a human clicking anything. Resilient: any error during a
    tick is swallowed so the loop keeps running."""
    from src.services.emergency_escalation import EmergencyEscalationService
    # The service needs the Redis client.  Pull it lazily from the agent.
    while True:
        try:
            from src.agent.amina_agent import get_agent
            redis = get_agent().memory_manager.redis
            svc = EmergencyEscalationService(redis)
            summary = svc.tick()
            if summary.get("prompted") or summary.get("escalated"):
                _log.info(f"emergency tick: {summary}")
        except Exception as exc:
            _log.warning(f"emergency tick failed: {exc}")
        try:
            await asyncio.sleep(TICK_EVERY_SECONDS)
        except asyncio.CancelledError:
            break


@app.on_event("startup")
async def _start_escalation_worker():
    global _tick_task
    if _tick_task is None or _tick_task.done():
        _tick_task = asyncio.create_task(_escalation_tick_loop())
        _log.info(f"✅ Emergency escalation worker running (tick every "
                  f"{TICK_EVERY_SECONDS}s)")


@app.on_event("shutdown")
async def _stop_escalation_worker():
    global _tick_task
    if _tick_task and not _tick_task.done():
        _tick_task.cancel()


__all__ = ["app"]
