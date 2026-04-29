"""
AMINA Care — v2 Translation Pipeline Entry Point
================================================
Strict superset of `main.py`. Mounts the v2 translation router under
`/api/v2/agent/*` without touching `main.py` or `api/agent_routes.py`.

Activation
----------
Override the uvicorn target (no edit to checked-in compose files):

    command: uvicorn src.main_with_translation_v2:app \\
             --host 0.0.0.0 --port 8000 --workers 4

Env vars (all optional — the v2 endpoint returns 503 until at least
`USE_V2_TRANSLATION_PIPELINE=true` or a per-request
`X-Translation-Pipeline: v2` header arrives):

    USE_V2_TRANSLATION_PIPELINE=true        enable v2 endpoint globally
    V2_PRIMARY_PROVIDER=openai              openai | gemma | nllb
    V2_FALLBACK_PROVIDER=nllb               openai | gemma | nllb | (none)

    USE_V2_TM_CACHE=true                    layer v2 TM in front of providers
    USE_V2_PII_LOCAL_ROUTING=true           PII → NLLB force-route (no cloud)
    V2_SHADOW_PERCENT=10                    0..100, shadow-compare sample rate

Provider-specific vars are the same as the legacy translator's:
    OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL
    GEMMA_BASE_URL, GEMMA_MODEL, GEMMA_API_KEY
    NLLB_BASE_URL                          (default http://nllb-mnk:5600)

Verification after boot
-----------------------
    curl http://localhost:8000/api/v2/agent/translate/health
        → current flags, available providers, primary/fallback/local names.

    curl -X POST http://localhost:8000/api/v2/agent/translate \\
         -H 'Content-Type: application/json' \\
         -H 'X-Translation-Pipeline: v2' \\
         -d '{"text":"How are you feeling today?","source":"en","target":"ma"}'
        → runs the v2 pipeline even if the global flag is OFF.

Rollback
--------
Revert the uvicorn command to `src.main:app` (or any of the other
`main_with_*.py` entry points). v2 stops being mounted; legacy path
is unaffected.
"""
from __future__ import annotations

import logging

# Inherit the full app (routes, startup hooks, CORS, etc.).
from src.main import app  # noqa: E402,F401

from translation_v2.api.routes import router as _v2_router  # noqa: E402
from translation_v2.api.rag_routes import router as _v2_rag_router  # noqa: E402
from translation_v2.api.v1_compat import V1ToV2CompatMiddleware  # noqa: E402
from translation_v2 import legacy_shim as _legacy_shim  # noqa: E402

app.include_router(_v2_router, prefix="/api/v2")
app.include_router(_v2_rag_router, prefix="/api/v2")

# v1 shim — frontend-transparent routing of /api/v1/agent/translate{,batch}
# to the v2 Router. Off by default (flag+header gated) so mounting it here
# does not change legacy behaviour.
app.add_middleware(V1ToV2CompatMiddleware)

# Legacy-translator monkey-patch. Catches internal callers of
# translator.translate() (chat response translation, prescription
# analysis, anywhere else legacy reaches for the singleton). Flag-gated
# on USE_V2_FOR_LEGACY_TRANSLATOR; no-op when off. Falls back to legacy
# on v2 error so chat never breaks from a v2 regression.
_legacy_shim.install()

logging.getLogger(__name__).info(
    "v2 translation + RAG routers mounted at /api/v2/agent/*; "
    "v1 compat middleware installed; legacy translator shim installed "
    "(both flag-gated)"
)
