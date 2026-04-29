# app/main.py

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.services.gateway_client import GatewayClient
from app.services.session_store import SessionStore

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s | %(levelname)-7s | %(name)-18s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("multichannel")

# Shared singletons (imported by channel modules)
gateway  = GatewayClient()
sessions = SessionStore()


# ── Nudge scheduler ───────────────────────────────────────────────────────────

async def _send_nudge_to_user(chat_id: int, patient_id: str):
    """Fetch today's nudge and push it to a single Telegram user."""
    from app.channels.telegram import _send_text

    nudge = await gateway.get_nudge(patient_id=patient_id)
    if not nudge:
        return
    tip   = nudge.get("tip") or nudge.get("nudge") or str(nudge)
    title = nudge.get("title", "Today's Health Tip")
    await _send_text(chat_id, f"🌅 *{title}*\n\n{tip}\n\n_Your daily AMINA nudge — /nudge to get another_")
    log.info("nudge_sent chat_id=%d patient=%s", chat_id, patient_id)


async def _nudge_scheduler():
    """
    Runs forever. Every hour checks if it's nudge-hour (default: 09:00 local server time).
    Sends today's lifestyle tip to every logged-in Telegram user.
    """
    from app.services.tg_auth import TgAuthStore
    NUDGE_HOUR = 9   # 09:00 server time

    log.info("nudge_scheduler_started target_hour=%d", NUDGE_HOUR)

    # Track which day we last sent so we don't double-fire
    last_nudge_day: int = -1

    while True:
        try:
            await asyncio.sleep(3600)          # check every hour
            now = datetime.now()
            if now.hour == NUDGE_HOUR and now.day != last_nudge_day:
                last_nudge_day = now.day
                auth_store = TgAuthStore(sessions._redis)
                linked = await auth_store.get_all_logged_in()
                log.info("nudge_batch users=%d", len(linked))
                for chat_id, patient_id in linked:
                    try:
                        await _send_nudge_to_user(chat_id, patient_id)
                        await asyncio.sleep(0.3)   # gentle rate limit
                    except Exception as e:
                        log.warning("nudge_fail chat_id=%d: %s", chat_id, str(e))
        except asyncio.CancelledError:
            log.info("nudge_scheduler_stopped")
            return
        except Exception as e:
            log.error("nudge_scheduler_error: %s", str(e))


# ── App lifespan ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting multichannel-access...")
    await gateway.start()
    await sessions.start()

    gw_ok    = await gateway.health_check()
    redis_ok = await sessions.ping()
    log.info("Services: haystack=%s redis=%s", "OK" if gw_ok else "DOWN", "OK" if redis_ok else "DOWN")
    log.info("Channels: telegram=%s", "ON" if settings.TELEGRAM_BOT_TOKEN else "OFF")

    # Start nudge scheduler as a background task
    nudge_task = asyncio.create_task(_nudge_scheduler())
    log.info("nudge_scheduler_task_created")

    yield

    log.info("Shutting down...")
    nudge_task.cancel()
    try:
        await nudge_task
    except asyncio.CancelledError:
        pass
    await gateway.stop()
    await sessions.stop()


app = FastAPI(
    title="Amina Multichannel Access",
    description="Telegram, WhatsApp, Messenger → Amina AI health assistant",
    version="3.0.0",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

from app.channels.telegram import router as tg_router
app.include_router(tg_router)


@app.get("/health")
async def health():
    gw_ok    = await gateway.health_check()
    redis_ok = await sessions.ping()
    return {
        "status":   "ok" if (gw_ok and redis_ok) else "degraded",
        "service":  "multichannel-access",
        "haystack": "connected" if gw_ok else "unreachable",
        "redis":    "connected" if redis_ok else "unreachable",
        "telegram": bool(settings.TELEGRAM_BOT_TOKEN),
    }
