"""
AMINA Care — Mandinka-TTS Robustness Entry Point
================================================
Strict superset of main.py. Adds nothing the other overlays touch, so it
can be layered on top of any existing chain.

What it does
------------
1. Monkey-patches src.services.tts.synthesize / synthesize_ogg so the
   existing POST /api/v1/tts route uses the strict Mandinka pipeline
   (explicit translator errors + MMS cold-start retry) without touching
   the original file.
2. Mounts the diagnostic router:
     GET  /api/v1/tts/diag
     POST /api/v1/tts/diag/translate
     POST /api/v1/tts/v2

How to activate
---------------
Override the uvicorn target in your docker-compose (no edit to the
checked-in compose file — add a compose override or command override):

    command: uvicorn src.main_with_tts_mandinka_fix:app \
             --host 0.0.0.0 --port 8000 --workers 4 \
             --limit-concurrency 200

Or locally:

    uvicorn src.main_with_tts_mandinka_fix:app --host 0.0.0.0 --port 8000

Env vars (all optional; defaults match the comments in tts_mandinka_fix.py):
    MMS_TTS_TIMEOUT_SECONDS   (default 90)
    MMS_TTS_MAX_RETRIES       (default 2)
    MMS_TTS_RETRY_BACKOFF     (default 3.0)
    MMS_TTS_STRICT_TRANSLATION  (default true — set "false" to allow
                                 synthesising English through the MA
                                 voice model when the translator is down)

Verification after boot
-----------------------
    curl http://localhost:8000/api/v1/tts/diag
        → confirms translator backend + MMS container reachability.

    curl -X POST http://localhost:8000/api/v1/tts/diag/translate \
         -H 'Content-Type: application/json' \
         -d '{"text":"How are you feeling today?"}'
        → proves EN→MA translation works. If "unchanged": true, the
          translator LLM call isn't running — check OPENAI_API_KEY /
          GEMMA_BASE_URL before blaming MMS.
"""

from __future__ import annotations

import logging

# Inherit the full app (routes, startup hooks, CORS, etc.).
from src.main import app  # noqa: E402,F401


# ── 1. Monkey-patch the existing dispatcher ──────────────────────────
# The /api/v1/tts route does `from src.services.tts import synthesize`
# at request time, so rebinding the attribute on the module object is
# enough — no need to re-register the route.
from src.services import tts as _tts_module  # noqa: E402
from src.services import tts_mandinka_fix as _fix  # noqa: E402

_tts_module.synthesize     = _fix.synthesize_wav      # type: ignore[attr-defined]
_tts_module.synthesize_ogg = _fix.synthesize_ogg      # type: ignore[attr-defined]


# ── 2. Mount the diagnostic + v2 routes ──────────────────────────────
from src.api.tts_mandinka_routes import router as _tts_diag_router  # noqa: E402
app.include_router(_tts_diag_router, prefix="/api/v1")


# ── 3. Raise output-token caps so multi-point care plans don't truncate
#       mid-list (e.g. "1. … 2. … 3." with no text after the 3).
from src.services import agent_tokens_fix as _tokens_fix  # noqa: E402
_tokens_fix.apply()


_log = logging.getLogger("src.main_with_tts_mandinka_fix")
_log.info("✅ Mandinka TTS fix active — "
          "/api/v1/tts now uses strict translation + MMS retry; "
          "diag available at /api/v1/tts/diag")
_log.info("✅ Token-cap fix active — plan replies now get up to "
          "AMINA_MAX_TOKENS_PLAN (default 1000) output tokens; "
          "LoRA path bumped to AMINA_LORA_MAX_TOKENS_PLAN (default 1500); "
          "translator floor bumped to AMINA_TRANSLATOR_MAX_TOKENS_FLOOR "
          "(default 2000)")


__all__ = ["app"]
