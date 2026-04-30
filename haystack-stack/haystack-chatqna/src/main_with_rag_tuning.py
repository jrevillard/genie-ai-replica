"""
AMINA Care — RAG Tuning Layer
==============================
Strict superset of main_with_stt_fix.

Imports rag_tuner which auto-applies four pipeline patches at startup:
  1. Grounded prompts  — forces LLM to cite retrieved context
  2. Score threshold    — filters low-relevance docs (cosine < 0.25)
  3. Weighted RRF      — vector 0.6 / keyword 0.4 merge
  4. Top-k boost       — retriever 15, ranker 5

All values are env-overridable (RAG_VECTOR_TOP_K, RAG_SCORE_THRESHOLD, etc.).

Uvicorn target: src.main_with_rag_tuning:app
"""
from __future__ import annotations

import logging

from src.main_with_stt_fix import app  # noqa: F401

_log = logging.getLogger("src.main_with_rag_tuning")

try:
    from src.services import rag_tuner  # noqa: F401
    _log.info("RAG tuning layer loaded")
except Exception as e:
    _log.warning("RAG tuning failed to load (non-fatal): %s", e)

try:
    from src.api.clinical_outcome_routes import router as _outcome_router
    app.include_router(_outcome_router, prefix="/api/v1")
    _log.info("Clinical outcome dashboard routes registered")
except Exception as e:
    _log.warning("Clinical outcome routes failed to load (non-fatal): %s", e)

try:
    from src.services.reranker_feedback import get_feedback_router
    app.include_router(get_feedback_router(), prefix="/api/v1")
    _log.info("Re-ranker feedback routes registered")
except Exception as e:
    _log.warning("Re-ranker feedback routes failed to load (non-fatal): %s", e)

try:
    from src.services import safety_consensus_patch  # noqa: F401
    _log.info("Safety consensus context patch installed")
except Exception as e:
    _log.warning("Safety consensus patch failed to load (non-fatal): %s", e)

try:
    from src.services import negation_patch  # noqa: F401
    _log.info("Negation-aware NLP patch installed")
except Exception as e:
    _log.warning("Negation patch failed to load (non-fatal): %s", e)

try:
    from src.services import topic_anchor_patch  # noqa: F401
    _log.info("Topic anchor patch installed")
except Exception as e:
    _log.warning("Topic anchor patch failed to load (non-fatal): %s", e)

try:
    from src.api.streaming_routes import router as _stream_router
    app.include_router(_stream_router, prefix="/api/v1")
    _log.info("SSE streaming chat route registered")
except Exception as e:
    _log.warning("Streaming routes failed to load (non-fatal): %s", e)

try:
    from src.api.scout_directory_routes import router as _scout_dir_router
    app.include_router(_scout_dir_router, prefix="/api/v1")
    _log.info("Scout directory routes registered")
except Exception as e:
    _log.warning("Scout directory routes failed to load (non-fatal): %s", e)

try:
    from src.services import translation_v3_integration
    # The module-level _install_patch() call inside translation_v3_integration
    # patches `agent_routes.router.routes`, but FastAPI's
    # `app.include_router(...)` clones APIRoute objects, so the live
    # `app.router.routes` list holds a different copy that needs its own
    # patch. install_on_app(app) walks the app routes and replaces the
    # endpoint there. Without this call the v3 wrapper never runs on
    # incoming requests, even though startup logs claim "patched".
    translation_v3_integration.install_on_app(app)
    _log.info("Translation v3 integration patch installed")
except Exception as e:
    _log.warning("Translation v3 integration failed to load (non-fatal): %s", e)

try:
    from src.services import diet_plan_fix  # noqa: F401
    _log.info("Diet plan fix patch installed")
except Exception as e:
    _log.warning("Diet plan fix failed to load (non-fatal): %s", e)

# Phase 5 — caregiver privacy WARN-ONLY middleware. Surfaces stale or
# missing caregiver consent as `X-Caregiver-Privacy-Stale: true|false`
# response header + a structured warning log; never blocks. Independent
# of AMINA_CAREGIVER_PRIVACY_REQUIRED enforcement (which stays default
# off). Toggle via AMINA_CAREGIVER_PRIVACY_WARN_ONLY=true|false.
try:
    from src.services import caregiver_privacy_warn as _cpw
    _cpw.install(app)
except Exception as e:
    _log.warning("Caregiver privacy warn-only middleware failed to install (non-fatal): %s", e)

try:
    from src.services import conversation_inbox_link  # noqa: F401
    _log.info("Conversation-to-inbox linker installed")
except Exception as e:
    _log.warning("Conversation inbox link failed to load (non-fatal): %s", e)

try:
    from src.services import summary_backfill  # noqa: F401
    _log.info("Summary backfill + fallback patch installed")
except Exception as e:
    _log.warning("Summary backfill failed to load (non-fatal): %s", e)

try:
    from src.services import download_intent_patch  # noqa: F401
    _log.info("NLP download intent patch installed")
except Exception as e:
    _log.warning("Download intent patch failed to load (non-fatal): %s", e)

try:
    from src.services import nlp_pipeline_integration  # noqa: F401
    _log.info("Mandinka NLP pipeline integration installed")
except Exception as e:
    _log.warning("NLP pipeline integration failed to load (non-fatal): %s", e)

try:
    from src.api.caregiver_registration_v2_routes import router as _cg_reg_v2_router
    app.include_router(_cg_reg_v2_router, prefix="/api/v1")
    _log.info("Caregiver registration v2 routes registered")
except Exception as e:
    _log.warning("Caregiver registration v2 routes failed to load (non-fatal): %s", e)

try:
    from src.api.observatory_auth import router as _obs_auth_router
    app.include_router(_obs_auth_router, prefix="/api/v1")
    _log.info("Observatory auth routes registered")
except Exception as e:
    _log.warning("Observatory auth routes failed to load (non-fatal): %s", e)

try:
    from src.api.observatory_admin import router as _obs_admin_router
    app.include_router(_obs_admin_router, prefix="/api/v1")
    _log.info("Observatory admin routes registered")
except Exception as e:
    _log.warning("Observatory admin routes failed to load (non-fatal): %s", e)

try:
    from src.api.observatory_phone_auth import router as _obs_phone_router
    app.include_router(_obs_phone_router, prefix="/api/v1")
    _log.info("Observatory phone-auth routes registered (3 super-admins seeded)")
except Exception as e:
    _log.warning("Observatory phone-auth routes failed to load (non-fatal): %s", e)

try:
    from src.services.openapi_recovery import install_openapi_recovery
    install_openapi_recovery(app)
except Exception as e:
    _log.warning("OpenAPI recovery install failed (non-fatal): %s", e)

# ── Observatory synthetic-data governance ──────────────────────────
# - registers /observatory/disclaimer + /consent + /data-mode endpoints
# - installs middleware that adds X-Data-Classification headers to
#   every /api/v1/observatory/* response
# - logs a boot banner so operators see the data mode
try:
    from src.services.stt_upload_guard import install_stt_upload_guard
    install_stt_upload_guard(app)
except Exception as e:
    _log.warning("STT upload guard install failed (non-fatal): %s", e)

# Phase 3: Redis-backed per-IP and global rate limiting on expensive
# endpoints (LLM / TTS / STT / voice-chat). Internal docker-network
# IPs bypass; bridge gateway 172.18.0.1 (real client traffic) is
# rate-limited. Fail-open if Redis is unreachable.
try:
    from src.services.rate_limiter import install_rate_limiter
    install_rate_limiter(app)
except Exception as e:
    _log.warning("Rate limiter install failed (non-fatal): %s", e)

# Phase 4: per-worker concurrency cap on the 6 audio paths. Final
# safety net against thundering herds on whisper-server. Returns
# 429 voice_busy when N requests are already in flight on this
# worker. Default N=3 per worker (4 workers => 12 global ceiling).
try:
    from src.services.voice_concurrency_limiter import install_voice_concurrency_limiter
    install_voice_concurrency_limiter(app)
except Exception as e:
    _log.warning("Voice concurrency limiter install failed (non-fatal): %s", e)

# Phase 6.1: caregiver policy acceptance + suspension schema bootstrap.
# Pure additive -- creates new vertex types and adds optional properties
# to existing InboxItemVertex. Does not touch any existing data.
try:
    from src.services.policy_acceptance_repo import ensure_policy_schema
    ensure_policy_schema()
    _log.info("Policy acceptance schema bootstrapped")
except Exception as e:
    _log.warning("Policy schema bootstrap failed (non-fatal): %s", e)

# Phase 6.3: caregiver policy review API (notify + accept + status + compliance).
# Routes use existing observatory super_admin JWT for notify/compliance and
# existing caregiver JWT for accept/status. No edits to existing inbox routes.
try:
    from src.api.policy_review_routes import router as _policy_router
    app.include_router(_policy_router, prefix="/api/v1")
    _log.info("Policy review routes registered (notify, accept, status, compliance)")
except Exception as e:
    _log.warning("Policy review routes failed to load (non-fatal): %s", e)

# Caregiver registration: relax the family invite-code requirement.
# Shadows /api/v1/caregiver-v2/register with a route that accepts family
# caregivers WITHOUT an invite code; admins approve them via the existing
# /caregiver-v2/admin/review/{reg_id} endpoint surfaced in People.jsx.
try:
    from src.services.caregiver_registration_optional_invite import install_optional_invite
    install_optional_invite(app)
except Exception as e:
    _log.warning("Optional-invite patch failed to load (non-fatal): %s", e)

# Guest chat: monkey-patch AminaAgent.process_message so unauthenticated
# sessions (session_id="guest_*") bypass the CHW pipeline and call
# Groq/Gemini with a guest-safe system prompt instead. Authenticated
# callers fall through to the original implementation untouched.
try:
    from src.services import guest_chat_patch  # noqa: F401
    _log.info("Guest chat patch installed (CHW pipeline bypassed for guests)")
except Exception as e:
    _log.warning("Guest chat patch failed to load (non-fatal): %s", e)

# LLM provider policy: outer wrapper on process_message that adds
# graceful/warn/strict fallback modes, cascade fallback for
# authenticated callers, per-request provider tracking via a contextvar,
# and structured logging. Composes with guest_chat_patch (this is the
# OUTER wrapper; guest_chat_patch is the inner one).
try:
    from src.services import llm_provider_policy  # noqa: F401
    _log.info("LLM provider policy installed (mode=%s)", llm_provider_policy.MODE)
except Exception as e:
    _log.warning("LLM provider policy failed to load (non-fatal): %s", e)

# Response-header middleware that projects per-request provider metadata
# onto X-LLM-* headers for /api/v1/agent/chat* responses, plus a
# diagnostic GET /api/v1/llm/policy endpoint for the admin badge.
try:
    from src.services.llm_provider_middleware import install_provider_middleware
    install_provider_middleware(app)
except Exception as e:
    _log.warning("LLM provider middleware failed to load (non-fatal): %s", e)

# Basic/Beginner UX intent router. Outermost wrapper on
# AminaAgent.process_message (installs LAST). When the request carries
# X-AMINA-Mode: basic|beginner the patch consults a small deterministic
# router for greeting/goodbye/thanks/ack/guest-record-request and
# short-circuits the response. For everything else (emergency, medical,
# authed-record-request, unknown) it falls through to the existing
# advanced pipeline (llm_provider_policy -> guest_chat_patch -> agent).
# The advanced intent_router/four_layer_router/stance_classifier files
# are NOT touched.
try:
    from src.services import basic_beginner_chat_patch  # noqa: F401
    basic_beginner_chat_patch.install_middleware(app)
    _log.info("Basic/Beginner intent router installed (X-AMINA-Mode aware)")
except Exception as e:
    _log.warning("Basic/Beginner intent router failed to load (non-fatal): %s", e)

# Prescription upload — expand the MIME whitelist so the route at
# /api/v1/agent/prescription accepts every common image format (gif,
# bmp, tiff, avif, jp2) plus the empty / octet-stream cases that
# mobile browsers emit. Original whitelist was jpeg/png/webp/heic only.
try:
    from src.services import prescription_upload_patch  # noqa: F401
    _log.info("Prescription upload MIME whitelist broadened")
except Exception as e:
    _log.warning("Prescription upload patch failed to load (non-fatal): %s", e)

# Agent Platform v1 — bounded shadow/assist agentic runtime.
# DEFAULT MODE = OFF (zero behaviour change). Operator turns on shadow
# first, observes traces, then promotes to assist on Advanced mode only.
# See docs/AGENT_PLATFORM_V1.md for the staged rollout.
try:
    import os
    from src.services.agentic_runtime_patch import install_agentic_patch
    install_agentic_patch()
    _log.info(
        "Agent Platform v1 patch installed (mode=%s, fail_open=%s)",
        os.getenv("AMINA_AGENTIC_MODE", "off"),
        os.getenv("AMINA_AGENTIC_FAIL_OPEN", "true"),
    )
except Exception as e:
    _log.warning(
        "Agent Platform v1 failed to load (non-fatal, mode stays off): %s", e,
    )

# Evidence Layer — admin-toggleable observability + synthetic eval layer.
# DEFAULT STATE = OFF. The runtime wrapper is installed but DORMANT until
# an admin enables the layer via POST /api/v1/admin/evidence/enable.
# See docs/EVIDENCE_LAYER.md for the full lifecycle.
try:
    from src.evidence_layer.routes import router as _evidence_router
    app.include_router(_evidence_router, prefix="/api/v1")
    _log.info("Evidence Layer routes registered (state-toggle, summary, eval)")
except Exception as e:
    _log.warning("Evidence Layer routes failed to load (non-fatal): %s", e)

try:
    from src.evidence_layer.patch import install_evidence_patch
    install_evidence_patch()
    _log.info(
        "Evidence Layer patch installed (default=%s, fail_open=%s)",
        os.getenv("AMINA_EVIDENCE_LAYER_DEFAULT", "off"),
        os.getenv("AMINA_EVIDENCE_FAIL_OPEN", "true"),
    )
except Exception as e:
    _log.warning(
        "Evidence Layer patch failed to load (non-fatal, layer stays off): %s", e,
    )

# Twilio WhatsApp Sandbox MVP adapter — independent of Meta routes.
# Provides a working WhatsApp channel when Meta WhatsApp Cloud API is not
# yet available in the dashboard (e.g. brand-new App without Business
# Portfolio activation, or region without WhatsApp Cloud API yet).
# Twilio handles outbound delivery via TwiML; we only return XML.
# See docs/MVP_MULTICHANNEL_RUNBOOK.md "WhatsApp via Twilio Sandbox".
try:
    from src.api.twilio_whatsapp_routes import router as _twilio_whatsapp_router
    app.include_router(_twilio_whatsapp_router, prefix="/api/v1")
    _twilio_sig_on = os.getenv("TWILIO_VALIDATE_SIGNATURE", "false").lower() in ("1","true","yes","on")
    _log.info(
        "Twilio WhatsApp sandbox route registered (signature_validation=%s)",
        _twilio_sig_on,
    )
except Exception as e:
    _log.warning("Twilio WhatsApp route failed to load (non-fatal): %s", e)

# Meta channels — WhatsApp Business Cloud + Facebook Messenger webhooks.
# Mounts under /api/v1/meta. With empty MESSENGER_APP_SECRET and
# WHATSAPP_APP_SECRET, runs in DEMO MODE (signature verification
# bypassed). Set credentials via docker-compose.meta-channels.yml or
# scripts/setup_meta_channels.py to bring the channels live.
try:
    from src.api.meta_routes import router as _meta_router
    app.include_router(_meta_router, prefix="/api/v1")
    _wa_demo  = "demo"  if not os.getenv("WHATSAPP_APP_SECRET")  else "live"
    _msg_demo = "demo"  if not os.getenv("MESSENGER_APP_SECRET") else "live"
    _log.info(
        "Meta channels routes registered (whatsapp=%s, messenger=%s)",
        _wa_demo, _msg_demo,
    )
except Exception as e:
    _log.warning("Meta channels routes failed to load (non-fatal): %s", e)

# Phase 5: WAV-duration guard. Wraps stt_whisper._normalize_audio so
# the per-request ffmpeg work runs exactly once -- the wrapper just
# inspects the WAV header that normalize already produces, and returns
# None if duration > cap. Defends against compression bombs without
# adding any extra CPU cost.
try:
    from src.services.stt_duration_guard import install_duration_guard
    install_duration_guard()
except Exception as e:
    _log.warning("STT duration guard install failed (non-fatal): %s", e)

try:
    from src.services import observatory_synthetic as _obs_syn
    from src.api.observatory_disclaimer import router as _obs_disc_router
    app.include_router(_obs_disc_router, prefix="/api/v1")

    @app.middleware("http")
    async def _observatory_synthetic_headers(request, call_next):
        response = await call_next(request)
        try:
            path = request.url.path or ""
            if path.startswith("/api/v1/observatory"):
                for k, v in _obs_syn.response_headers().items():
                    response.headers[k] = v
        except Exception:
            pass
        return response

    _obs_syn.log_boot_banner()
    _log.info("Observatory disclaimer routes + synthetic-data headers registered")
except Exception as e:
    _log.warning("Observatory synthetic governance failed to load (non-fatal): %s", e)

__all__ = ["app"]
