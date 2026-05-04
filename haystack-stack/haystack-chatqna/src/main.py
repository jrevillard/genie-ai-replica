import logging
import uuid

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from src.api.routes import router
from src.api.agent_routes import router as agent_router
from src.api.patient_routes import router as patient_router
from src.api.community_routes import router as community_router
from src.api.care_routes import router as care_router
from src.api.auth_routes import router as auth_router
from src.api.admin_routes import router as admin_router
from src.api.protocol_routes import router as protocol_router
from src.api.fhir_routes import router as fhir_router
from src.api.caregiver_routes import router as caregiver_router
from src.api.patient_alert_routes import router as patient_alert_router
from src.api.direct_chat_routes import router as direct_chat_router
from src.api.caregiver_application_routes import router as cg_application_router
from src.api.dhis2_routes import router as dhis2_router
from src.api.consent_routes import router as consent_router
from src.api.meta_routes import router as meta_router
from src.config import settings

_main_logger = logging.getLogger("amina.main")

app = FastAPI(title="Genie AI - Haystack Service")


# BUG-027 fix: any UNCAUGHT exception that escapes a route handler
# used to surface as a Starlette 500 with the raw exception text in
# the body, leaking stack-frame paths / SQL / module internals to
# the caller. This handler logs the full trace server-side under a
# request_id and returns only the id + a generic error string.
# Explicit `raise HTTPException(500, detail=...)` raises in route
# code are NOT touched by this handler -- those are the developer's
# choice and are intentionally informative; they are sanitised at
# their own call sites.
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    request_id = uuid.uuid4().hex[:12]
    _main_logger.error(
        "[unhandled] request_id=%s method=%s path=%s exc=%s: %s",
        request_id, request.method, request.url.path,
        type(exc).__name__, exc,
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "request_id": request_id},
        headers={"X-Request-Id": request_id},
    )


# Preserve normal HTTPException semantics so 401/403/404 still flow
# through with their intended detail body.
@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers or None,
    )


# CORS middleware - allows frontend to call backend
# NOTE: allow_credentials=True REQUIRES explicit origins (cannot use "*").
# The cookie-based session persistence depends on this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5175", "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the routes
app.include_router(router, prefix="/api/v1")
app.include_router(agent_router, prefix="/api/v1")
app.include_router(patient_router, prefix="/api/v1")
app.include_router(community_router, prefix="/api/v1")
app.include_router(care_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(protocol_router, prefix="/api/v1")
app.include_router(fhir_router, prefix="/api/v1")
app.include_router(caregiver_router, prefix="/api/v1")
app.include_router(patient_alert_router, prefix="/api/v1")
app.include_router(direct_chat_router,       prefix="/api/v1")
app.include_router(cg_application_router,   prefix="/api/v1")
app.include_router(dhis2_router,             prefix="/api/v1")
app.include_router(consent_router,           prefix="/api/v1")
app.include_router(meta_router,               prefix="/api/v1")

# Phase-2 caregiver privacy consent: POST /caregiver/privacy/consent,
# GET /caregiver/privacy/status, GET /caregiver/privacy/version. The
# accompanying gate dependency (require_caregiver_privacy_consent) is
# also imported from this module by other route files; the dependency
# is a no-op pass-through unless AMINA_CAREGIVER_PRIVACY_REQUIRED=true.
from src.api.caregiver_privacy_routes import router as caregiver_privacy_router  # noqa: E402
app.include_router(caregiver_privacy_router, prefix="/api/v1")

# Phase E: abuse-defense admin endpoints. All gated by admin JWT
# (role=admin). Read endpoints (status/flagged/recent/user/stats) and
# one mutation (POST /user/{key}/release) which writes an audit row.
from src.api.abuse_admin_routes import router as abuse_admin_router  # noqa: E402
app.include_router(abuse_admin_router, prefix="/api/v1")

# Health check is vital for Docker
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "haystack-chatqna"}


# Auto-create ArcadeDB schema on startup 
@app.on_event("startup")
async def startup_event():
    """Ensure ArcadeDB schema exists every time the service starts."""
    from src.utils.arcade_client import command_sql

    try:
        command_sql("CREATE DOCUMENT TYPE Chunk IF NOT EXISTS")
        command_sql("CREATE PROPERTY Chunk.chunk_id IF NOT EXISTS STRING")
        command_sql("CREATE PROPERTY Chunk.text IF NOT EXISTS STRING")
        command_sql("CREATE PROPERTY Chunk.embedding IF NOT EXISTS LIST")
        command_sql("CREATE PROPERTY Chunk.source IF NOT EXISTS STRING")
        command_sql("CREATE PROPERTY Chunk.title IF NOT EXISTS STRING")
        print("✅ ArcadeDB Chunk schema initialized")
    except Exception as e:
        print(f"⚠️ Chunk schema init warning (may already exist): {e}")

    # Initialize Patient and Consultation schemas
    try:
        from src.repositories.patient_repo import PatientRepository
        from src.repositories.consultation_repo import ConsultationRepository
        await PatientRepository().ensure_schema()
        await ConsultationRepository().ensure_schema()
        print("✅ ArcadeDB Patient/Consultation schema initialized")
    except Exception as e:
        print(f"⚠️ Patient/Consultation schema init warning: {e}")

    # Initialize 3-tier memory schema (PatientVertex, ConsultationRecord, MemoryVertex + vector index)
    try:
        from src.db.setup_schema import setup_memory_schema
        setup_memory_schema()
        print("✅ ArcadeDB Memory schema initialized")
    except Exception as e:
        print(f"⚠️ Memory schema init warning: {e}")

    # Phase-2 caregiver privacy consent schema. Idempotent: safe to call
    # every startup. Lazy bootstrap also runs on first record_consent /
    # find_current_consent call, so this eager call is purely a
    # defence-in-depth.
    try:
        from src.services.caregiver_privacy_consent import (
            ensure_caregiver_privacy_schema,
        )
        ensure_caregiver_privacy_schema()
        print("✅ ArcadeDB CaregiverConsentRecord schema initialized")
    except Exception as e:
        print(f"⚠️ CaregiverConsentRecord schema init warning: {e}")

    # Initialize CommunityData + AuditLog schema
    try:
        from src.db.community_store import ensure_community_schema
        await ensure_community_schema()
        print("✅ ArcadeDB Community schema initialized")
    except Exception as e:
        print(f"⚠️ Community schema init warning: {e}")

    # Initialize self-learning schema (InteractionEvent, ClinicalInsight)
    try:
        from src.services.learning import setup_learning_schema
        setup_learning_schema()
        print("✅ ArcadeDB Learning schema initialized")
    except Exception as e:
        print(f"⚠️ Learning schema init warning: {e}")

    # Initialize Protocol schema (CHW Protocol Builder)
    try:
        from src.repositories.protocol_repo import ProtocolRepository
        await ProtocolRepository().ensure_schema()
        print("✅ ArcadeDB Protocol schema initialized")
    except Exception as e:
        print(f"⚠️ Protocol schema init warning: {e}")

    # Initialize Caregiver schema
    try:
        from src.repositories.caregiver_repo import CaregiverRepository
        CaregiverRepository().ensure_schema()
        print("✅ ArcadeDB Caregiver schema initialized")
    except Exception as e:
        print(f"⚠️ Caregiver schema init warning: {e}")

    # Initialize DHIS2 sync scheduler + audit schema
    try:
        from src.services.dhis2_sync import start_scheduler, _ensure_audit_schema
        _ensure_audit_schema()
        start_scheduler()
        print("✅ DHIS2 sync scheduler started (daily 02:00 UTC)")
    except Exception as e:
        print(f"⚠️ DHIS2 scheduler init warning: {e}")

    # Initialize Phase 2 schemas — consent + tracker audit + pull referrals
    try:
        from src.services.consent_service import ensure_consent_schema
        from src.services.dhis2_tracker import _ensure_tracker_audit_schema
        ensure_consent_schema()
        _ensure_tracker_audit_schema()
        print("✅ Consent + Tracker audit schema initialized")
    except Exception as e:
        print(f"⚠️ Consent/Tracker schema init warning: {e}")

    # Start DHIS2 bi-directional pull scheduler (Phase 2.6)
    try:
        from src.services.dhis2_pull import start_pull_scheduler, ensure_referral_schema
        ensure_referral_schema()
        start_pull_scheduler()
        print("✅ DHIS2 referral pull scheduler started (every 15 min)")
    except Exception as e:
        print(f"⚠️ DHIS2 pull init warning: {e}")

    # Phase F: pre-translate abuse-defense response copy into Mandinka
    # via translator_v4 and cache in memory. Failure here is non-fatal —
    # Mandinka users fall back to English copy if the cache is empty.
    try:
        from src.abuse_defense import responses_mn as _abuse_mn
        stats = await _abuse_mn.bootstrap_async()
        print(f"✅ Abuse-defense Mandinka cache: {stats}")
    except Exception as e:
        print(f"⚠️ Abuse-defense MN bootstrap warning: {e}")

    # Phase G.1: pre-warm the semantic abuse classifier so the first
    # chat request doesn't pay the model-load cost. Failure is
    # non-fatal — semantic falls back to regex-only if model load fails.
    try:
        from src.abuse_defense import semantic as _abuse_semantic
        sem_stats = await _abuse_semantic.warm_up_async()
        print(f"✅ Abuse-defense semantic classifier: {sem_stats}")
    except Exception as e:
        print(f"⚠️ Abuse-defense semantic warm-up warning: {e}")


if __name__ == "__main__":
    uvicorn.run("src.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)