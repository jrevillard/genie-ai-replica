# src/config.py
#
# Phase-bug-fix 2026-05-01:
#   - BUG-003: removed JWT_SECRET hardcoded default; in production
#     (AMINA_ENV=production) the process refuses to boot without it.
#   - BUG-004: removed ARCADEDB_PASSWORD hardcoded default; same
#     production guard.
#   - BUG-007: OTP_DEV_MODE now defaults to FALSE (was true). Setting
#     it to true in production raises at import time.
#   - BUG-006: CHATQNA_ADMIN_MV_OPEN, CARE_TRUST_BODY_ROLE,
#     DHIS2_DEV_ADMIN_BYPASS now default FALSE; setting any to true
#     in production also raises at import time.
#
# In development (default AMINA_ENV) the helpers fall back to clearly-
# marked dev placeholders + a single warning line per startup, so
# nobody is surprised by a fail-to-boot during local work.


import logging
import os
import secrets as _secrets
import sys


_log = logging.getLogger(__name__)

AMINA_ENV = os.getenv("AMINA_ENV", "development").strip().lower()
_IS_PRODUCTION = AMINA_ENV == "production"


def _required_env(
    name: str,
    *,
    dev_default: str = "",
    sensitive: bool = True,
) -> str:
    """Resolve an env var with environment-aware safety.

    In production: missing/blank -> RuntimeError at import time.
    In development: missing/blank -> dev_default. If `sensitive=True`
    and dev_default is empty, a random hex is generated per process
    start so dev never silently runs on a static, repo-known secret.

    `sensitive=True` (default) suppresses the value from logs; only
    its presence is reported.
    """
    raw = (os.getenv(name) or "").strip()
    if raw:
        return raw
    if _IS_PRODUCTION:
        sys.stderr.write(
            f"[config] FATAL: required env var {name!r} is unset and "
            f"AMINA_ENV=production. Refusing to boot — set it via the "
            f"deployment env or the encrypted-secrets bundle.\n"
        )
        raise RuntimeError(
            f"missing required env var {name!r} in production"
        )
    # dev fallback
    if dev_default:
        _log.warning(
            "[config] %s unset; using DEV DEFAULT (not safe for prod)",
            name,
        )
        return dev_default
    fresh = _secrets.token_hex(32)
    _log.warning(
        "[config] %s unset; generated a per-process random value for "
        "DEV ONLY. Sessions will reset on restart.",
        name,
    )
    return fresh


def _bool_env(
    name: str,
    *,
    prod_must_be_false: bool = False,
    default: bool = False,
) -> bool:
    """Parse a bool env var.

    If `prod_must_be_false` is True, setting the var truthy in
    production raises at import time. This is the production guard
    used by BUG-006 / BUG-007 to refuse boot when a dev-bypass flag
    is left on.
    """
    raw = (os.getenv(name) or "").strip().lower()
    truthy = raw in ("1", "true", "yes", "on")
    if not raw:
        return default
    if prod_must_be_false and _IS_PRODUCTION and truthy:
        sys.stderr.write(
            f"[config] FATAL: {name}=true is forbidden when "
            f"AMINA_ENV=production. This is a development-only bypass; "
            f"refusing to boot.\n"
        )
        raise RuntimeError(
            f"{name}=true is forbidden in production"
        )
    return truthy


class Config:
    # API 
    API_HOST = os.getenv("API_HOST", "0.0.0.0")
    API_PORT = int(os.getenv("API_PORT", 8000))
    
    # OpenAI LLM (primary)
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

    # AMINA v2 Fine-Tuned Model (served via vLLM on A40)
    #
    # Served by Tailscale Funnel — the hostname is stable across restarts
    # and reboots (unlike a Cloudflare quick tunnel which rotated hostnames
    # on every restart). Deployment files: deploy/a40/.
    #
    # Override per-environment via .env or docker-compose if you ever rename
    # the A40 host or move it to a different tailnet:
    #   AMINA_MODEL_URL=https://<host>.<tailnet>.ts.net/v1
    #   USE_FINETUNED_MODEL=true
    AMINA_MODEL_URL = os.getenv("AMINA_MODEL_URL", "https://amina-a40.tail0da632.ts.net/v1")
    AMINA_MODEL_NAME = os.getenv("AMINA_MODEL_NAME", "models/amina-v2-final")
    USE_FINETUNED_MODEL = os.getenv("USE_FINETUNED_MODEL", "false").lower() == "true"
    
    # Google Gemini — OpenAI-compatible endpoint
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", os.getenv("LLM_MODEL_NAME", "gemini-1.5-flash"))
    GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
    LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "gemini-1.5-flash")

    # Groq — OpenAI-compatible, free tier, fast Llama 3.3 70B
    GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    GROQ_BASE_URL = "https://api.groq.com/openai/v1"

    # Mistral AI — OpenAI-compatible, free credits, open-mistral-7b free tier
    MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
    MISTRAL_MODEL = os.getenv("MISTRAL_MODEL", "open-mistral-7b")
    MISTRAL_BASE_URL = "https://api.mistral.ai/v1"
 
    # ArcadeDB 
    ARCADEDB_URL = os.getenv("ARCADEDB_URL", "http://arcadedb:2480")
    ARCADEDB_DB = os.getenv("ARCADEDB_DB", "genie")
    ARCADEDB_USER = os.getenv("ARCADEDB_USER", "root")
    # BUG-004: env-only in production; dev keeps the historical default
    # so the bundled docker-compose dev container still works without
    # extra setup.
    ARCADEDB_PASSWORD = _required_env(
        "ARCADEDB_PASSWORD",
        dev_default="genieRoot123",
    )
 
    # Whisper STT
    WHISPER_URL = os.getenv("WHISPER_URL", "http://voice-stt:8080")
 
    # Piper TTS
    TTS_URL = os.getenv("TTS_URL", "http://voice-tts:5500")

    # Redis (working memory)
    REDIS_HOST = os.getenv("REDIS_HOST", "redis")
    REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))

    # Embedding model (shared with Haystack pipeline)
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

    # Auth
    # BUG-003: env-only in production; in dev a random per-process
    # secret is generated (sessions reset across restarts, but no
    # static, repo-known string remains in source).
    JWT_SECRET = _required_env("JWT_SECRET")
    JWT_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", 168))  # 7 days

    # SMS OTP (Twilio)
    TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")  # e.g. +1234567890
    # BUG-007: defaults FALSE (was true). When true the OTP comes back
    # in the response body — fine for dev, catastrophic in prod.
    # Setting OTP_DEV_MODE=true with AMINA_ENV=production now refuses
    # to boot.
    OTP_DEV_MODE = _bool_env(
        "OTP_DEV_MODE",
        prod_must_be_false=True,
        default=False,
    )

    # Africa's Talking SMS (Gambia +220 — primary for West Africa deployment)
    AT_USERNAME  = os.getenv("AT_USERNAME", "")   # Africa's Talking username
    AT_API_KEY   = os.getenv("AT_API_KEY", "")    # Africa's Talking API key
    AT_SENDER_ID = os.getenv("AT_SENDER_ID", "")  # Optional alphanumeric sender ID

    # India DLT registration (required by TRAI for transactional SMS via Twilio)
    # Register at: https://www.vilpower.in or your telecom operator's DLT portal
    # Set sender ID to "AMINAC" (6 chars, alphanumeric) after DLT approval
    INDIA_DLT_ENTITY_ID   = os.getenv("INDIA_DLT_ENTITY_ID", "")    # Your DLT Entity ID
    INDIA_DLT_TEMPLATE_ID = os.getenv("INDIA_DLT_TEMPLATE_ID", "")  # Per-template ID
    TWILIO_INDIA_SENDER   = os.getenv("TWILIO_INDIA_SENDER", "")     # Approved sender ID

    # Telegram Bot (caregiver → patient push alerts)
    TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

    # SMTP (transactional email — password reset, caregiver notifications)
    # Use any SMTP provider: Gmail, SendGrid, Mailgun, AWS SES, etc.
    # Gmail example: SMTP_HOST=smtp.gmail.com SMTP_PORT=587
    #                SMTP_USER=you@gmail.com  SMTP_PASS=<app-password>
    # When not configured, reset emails are printed to the server log (dev mode).
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")
    SMTP_FROM = os.getenv("SMTP_FROM", "AMINA Care <noreply@aminacare.health>")

    # Frontend base URL — used to build password-reset deep links in emails
    APP_URL = os.getenv("APP_URL", "http://localhost:3000")

    # OAuth (configure in .env for production)
    GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    FACEBOOK_APP_ID = os.getenv("FACEBOOK_APP_ID", "")
    FACEBOOK_APP_SECRET = os.getenv("FACEBOOK_APP_SECRET", "")
    DHIS2_BASE_URL = os.getenv("DHIS2_BASE_URL", "https://play.dhis2.org/40.4.0")
    DHIS2_CLIENT_ID = os.getenv("DHIS2_CLIENT_ID", "")

    # DHIS2 aggregate sync — server-to-server push (Basic auth or API token)
    DHIS2_USERNAME = os.getenv("DHIS2_USERNAME", "")
    DHIS2_PASSWORD = os.getenv("DHIS2_PASSWORD", "")
    DHIS2_API_TOKEN = os.getenv("DHIS2_API_TOKEN", "")
    DHIS2_DATASET_ID = os.getenv("DHIS2_DATASET_ID", "")
    # JSON string: {"banjul":"abc123","kanifing":"def456",...}
    DHIS2_ORG_UNIT_MAP = os.getenv("DHIS2_ORG_UNIT_MAP", "")
    # JSON string: {"AMINA_CONS_TOTAL":"de-uid-1","AMINA_CONS_EMERGENCY":"de-uid-2",...}
    DHIS2_DATA_ELEMENT_MAP = os.getenv("DHIS2_DATA_ELEMENT_MAP", "")
    # Slack-compatible webhook — fires on 3+ consecutive sync failures
    DHIS2_ALERT_WEBHOOK_URL = os.getenv("DHIS2_ALERT_WEBHOOK_URL", "")
    # DHIS2 Tracker API (Phase 2.3) — opt-in patient-level push
    DHIS2_TRACKER_ENABLED = os.getenv("DHIS2_TRACKER_ENABLED", "false").lower() == "true"
    DHIS2_TRACKER_PROGRAM_ID = os.getenv("DHIS2_TRACKER_PROGRAM_ID", "")
    DHIS2_TRACKER_PROGRAM_STAGE_ID = os.getenv("DHIS2_TRACKER_PROGRAM_STAGE_ID", "")
    DHIS2_TRACKER_TEI_TYPE_ID = os.getenv("DHIS2_TRACKER_TEI_TYPE_ID", "")
    # JSON: {"first_name":"abc123","last_name":"def456","phone":"ghi789"}
    DHIS2_TRACKER_ATTRIBUTE_MAP = os.getenv("DHIS2_TRACKER_ATTRIBUTE_MAP", "")
    # JSON: {"triage_level":"xyz789","chief_complaint":"uvw456"}
    DHIS2_TRACKER_DATA_ELEMENT_MAP = os.getenv("DHIS2_TRACKER_DATA_ELEMENT_MAP", "")
    # DHIS2 bi-directional pull (Phase 2.6)
    DHIS2_PULL_ENABLED = os.getenv("DHIS2_PULL_ENABLED", "false").lower() == "true"

    # Dialogue State Tracker (Transformation 1)
    # Adds a persistent DialogueState object updated each turn by a small LLM call.
    # When false (default), the agent pipeline is byte-identical to before.
    USE_DIALOGUE_STATE_TRACKER = os.getenv("USE_DIALOGUE_STATE_TRACKER", "false").lower() == "true"

    # LLM Tool Router (Transformation 2)
    # Replaces keyword-only tool routing with an LLM-based router for
    # ambiguous messages. Keyword fast-path still handles obvious cases.
    # When false (default), tool routing is pure keyword-match as before.
    USE_LLM_TOOL_ROUTER = os.getenv("USE_LLM_TOOL_ROUTER", "false").lower() == "true"

    # Response Shape Decision (Transformation 3)
    # Lets the model choose response shape (greeting, empathy, advice, etc.)
    # instead of always forcing a deterministic greeting + 80-word cap.
    # When false (default), greeting/stripping/length behavior is unchanged.
    USE_RESPONSE_SHAPE_DECISION = os.getenv("USE_RESPONSE_SHAPE_DECISION", "false").lower() == "true"

    # Structured Intent Extraction (Gap 1)
    # Replaces keyword-only intent classification with an LLM-powered
    # structured extraction: primary/secondary intents, entities,
    # emotional undertone, who-is-the-patient, urgency.
    # When false (default), intent classification is keyword-based.
    USE_LLM_INTENT_EXTRACTION = os.getenv("USE_LLM_INTENT_EXTRACTION", "false").lower() == "true"

    # Safety Contract (Gap 5)
    # Replaces the LLM safety-review call with deterministic validation.
    # Fail-closed: invalid responses are regenerated, not passed through.
    # When false (default), the existing _safety_review LLM call is used.
    USE_SAFETY_CONTRACT = os.getenv("USE_SAFETY_CONTRACT", "false").lower() == "true"

    # Structured Compaction (Gap 6)
    # Replaces summary-based compaction with extract-and-update.
    # Extracts structured clinical facts into a PatientClinicalState,
    # then discards raw messages. Lossless for facts, lossy for chitchat.
    # When false (default), compaction produces text summaries as before.
    USE_STRUCTURED_COMPACTION = os.getenv("USE_STRUCTURED_COMPACTION", "false").lower() == "true"

    # Density Compression (Gap 7)
    # Post-generation density pass: strips filler, compresses if over
    # density budget. No hard word cap — substance earns its space.
    # When false (default), word limits are advisory via prompt only.
    USE_DENSITY_COMPRESSION = os.getenv("USE_DENSITY_COMPRESSION", "false").lower() == "true"

    # Conversational Pacer (Pipeline Redesign)
    # Forces short, turn-based conversation: one topic per turn, max 3
    # sentences, always ends with one engagement point (question or
    # suggestion). Replaces the "dump everything" pattern with paced
    # multi-turn dialogue. Topics queue across turns so nothing is lost.
    # When false (default), response generation is unchanged.
    USE_CONVERSATIONAL_PACER = os.getenv("USE_CONVERSATIONAL_PACER", "false").lower() == "true"

    # Intent Router (replaces brittle keyword classification with
    # ack-prefix stripping + 9-intent taxonomy + prompt-guided limits).
    # Requires USE_CONVERSATIONAL_PACER=true — the pacer delegates to the router.
    USE_INTENT_ROUTER = os.getenv("USE_INTENT_ROUTER", "false").lower() == "true"

    # BUG-006 dev-bypass production guards. Each flag is a development
    # escape hatch that must NEVER be on in production:
    #
    #   CHATQNA_ADMIN_MV_OPEN — opens admin materialised-view endpoints
    #       to unauthenticated callers (admin_mv_routes.py).
    #   CARE_TRUST_BODY_ROLE — lets the request body's `role` field
    #       override the JWT's role claim (care_routes.py). With this on
    #       a patient can self-promote to admin.
    #   DHIS2_DEV_ADMIN_BYPASS — bypasses the admin gate on DHIS2 push
    #       routes (dhis2_routes.py + dhis2_history_routes.py).
    #
    # Reading these here (even though the actual call sites also read
    # os.getenv) means production boot is REFUSED if any are truthy —
    # the call site never gets to evaluate its own check.
    DEV_FLAG_CHATQNA_ADMIN_MV_OPEN = _bool_env(
        "CHATQNA_ADMIN_MV_OPEN", prod_must_be_false=True, default=False,
    )
    DEV_FLAG_CARE_TRUST_BODY_ROLE = _bool_env(
        "CARE_TRUST_BODY_ROLE", prod_must_be_false=True, default=False,
    )
    DEV_FLAG_DHIS2_DEV_ADMIN_BYPASS = _bool_env(
        "DHIS2_DEV_ADMIN_BYPASS", prod_must_be_false=True, default=False,
    )


settings = Config()
