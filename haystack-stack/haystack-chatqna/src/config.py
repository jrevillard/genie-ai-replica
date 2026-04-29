# src/config.py


import os
 
 
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
    ARCADEDB_PASSWORD = os.getenv("ARCADEDB_PASSWORD", "genieRoot123")
 
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
    JWT_SECRET = os.getenv("JWT_SECRET", "amina-mvp-secret-change-in-prod-2026")
    JWT_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", 168))  # 7 days

    # SMS OTP (Twilio)
    TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")  # e.g. +1234567890
    OTP_DEV_MODE = os.getenv("OTP_DEV_MODE", "true").lower() == "true"  # Returns OTP in response for testing

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


settings = Config()
