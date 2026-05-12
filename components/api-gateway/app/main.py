"""AMINA API Gateway — Phase 0+1 (FastAPI).

Layer coverage shipped today:
  L5 (perimeter content)  - schema validation + prompt-injection
                            pattern detection on every public endpoint
  L7 (audit)              - ApiAuditLog vertex with hash-chain

Deferred to backlog (see components/api-gateway/README.md):
  L1 SVM input classifier, L2 full clinical constitution,
  L3 FAISS+SBERT semantic similarity, L4 output classifier,
  L6 multi-turn escalation tracker, mTLS, JWT, Cloudflare,
  adaptive rate limiting, full PHI redaction.

The gateway runs in PARALLEL to the existing AMINA stack:
  * frontend (port 5174) keeps talking directly to backend (port 8000)
  * gateway (port 8443) is an additional surface UNICC testers can
    hit to see the security layer in action
  * if the gateway fails to start, the existing demo flow is unaffected
"""
from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import audit, config, jailbreak_detector, jwt_auth, phi_redactor, proxy
from . import rate_limit as rate_limit_module
from . import schema_validator
from . import scopes as scopes_module

# ── Bootstrap & logging ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("amina-gateway")

if not config.GATEWAY_ENABLED:
    logger.warning(
        "AMINA_GATEWAY_ENABLED is false. Gateway will start but every "
        "public endpoint will return 503. Flip the env var to enable."
    )


app = FastAPI(
    title="AMINA API Gateway",
    version="0.1.0",
    description=(
        "Zero-trust perimeter for AMINA. Phase 0+1: schema validation, "
        "prompt-injection detection, ArcadeDB audit log."
    ),
)


# ── L2 rate limit middleware (Phase 4) ───────────────────────────────
# Runs as FIRST middleware so it covers every endpoint (admin, public,
# status). /health is exempted because monitoring agents poll it
# constantly and a 429 there triggers false-positive ops alerts.
# The decision is stashed on request.state so downstream handlers
# (which write the audit log) can record it.
@app.middleware("http")
async def _rate_limit_middleware(request: Request, call_next):
    request.state.rate_limit_outcome = None
    if request.url.path == "/health":
        return await call_next(request)

    fwd = request.headers.get("X-Forwarded-For")
    ip = (fwd.split(",")[0].strip() if fwd
          else (request.client.host if request.client else ""))

    rl = rate_limit_module.check(path=request.url.path, ip=ip, caller=None)
    request.state.rate_limit_outcome = rl
    if not rl.allowed:
        return JSONResponse(
            {
                "error":   "rate_limited",
                "reason":  rl.reason,
                "tier":    rl.tier,
                "limit":   rl.limit,
                "message": (
                    f"Rate limit exceeded ({rl.reason}). Quota resets in "
                    f"{rl.reset_seconds} s."
                ),
            },
            status_code=429,
            headers={
                "Retry-After":          str(rl.reset_seconds),
                "X-RateLimit-Tier":     rl.tier,
                "X-RateLimit-Backend":  rl.backend,
            },
        )
    return await call_next(request)

# CORS — gateway is the public-facing perimeter. Allow:
#   * dev origins (localhost:5173-5175)
#   * production frontend on amina-design.com (apex + www)
#   * Cloudflare Pages preview URLs *.amina-design.pages.dev
#
# allow_credentials=True is required because the SPA stores its session
# in a cookie (the JWT bearer is also sent from JS) and the browser
# refuses to attach it cross-origin without the explicit flag.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5175", "http://127.0.0.1:5175",
        "https://amina-design.com",
        "https://www.amina-design.com",
    ],
    allow_origin_regex=r"https://[a-z0-9-]+\.amina-design\.pages\.dev",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


# ── Security response headers ────────────────────────────────────────
#
# These are added on every response so downstream clients (browsers,
# native apps, audit tools) get a consistent posture. They're
# defense-in-depth: Cloudflare also enforces TLS, but headers must
# also come from the origin to be honored when bypass paths exist
# (e.g., direct curl to api.amina-design.com).
#
#   Strict-Transport-Security : pin HTTPS for 1 year, include subdomains.
#                                 The "preload" claim signals intent to be
#                                 added to the HSTS preload list.
#   X-Content-Type-Options    : block MIME-sniffing attacks.
#   X-Frame-Options           : prevent clickjacking via <iframe>.
#   Referrer-Policy           : leak only origin to cross-site links.
#   Permissions-Policy        : drop privileges we don't use.
#   Cross-Origin-Resource-Policy : allow cross-origin fetch from
#                                 amina-design.com (not "*"; we use the
#                                 CORS middleware to whitelist origins).
#
# We deliberately DO NOT set Content-Security-Policy here because the
# frontend is on a different origin (amina-design.com); a CSP on API
# responses would only affect responses rendered as HTML, which we
# never do.
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options",        "DENY")
    response.headers.setdefault("Referrer-Policy",        "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "geolocation=(self), microphone=(self), camera=(), payment=()",
    )
    response.headers.setdefault("Cross-Origin-Resource-Policy", "cross-origin")
    return response


# ── Helpers ──────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    # Behind a real proxy (Cloudflare etc.) we'd trust X-Forwarded-For;
    # for now the gateway is the perimeter so we use the direct addr.
    fwd = request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def _security_flags_for(detection: jailbreak_detector.DetectionResult) -> str:
    flags = []
    if detection.pattern:
        flags.append({
            "type":     "jailbreak_pattern",
            "name":     detection.pattern,
            "severity": detection.severity,
            "snippet":  detection.snippet,
        })
    return json.dumps(flags)


def _make_audit(request: Request, *, body_bytes: int = 0) -> audit.AuditEntry:
    e = audit.AuditEntry()
    e.endpoint     = request.url.path
    e.method       = request.method
    e.ip_hash      = audit.hash_ip(_client_ip(request))
    e.request_size = body_bytes
    # caller_id remains "anonymous" until JWT layer (Phase 2) lands.
    return e


# ── Public endpoints ─────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Plain health probe — does NOT count toward audit log."""
    return {"status": "ok", "service": "amina-gateway", "phase": "0+1"}


# ── Admin endpoints (Phase 2a) ────────────────────────────────────────

@app.post("/api/v1/admin/issue-token")
async def admin_issue_token(request: Request):
    """Issue a short-lived RS256 JWT.

    Auth: ``X-Admin-Secret`` header must match config.ADMIN_SECRET.

    Body:
      {
        "subject":     "genie-ai-opea",         # caller identity
        "scopes":      ["amina:chat",           # subset of ALL_SCOPES
                        "amina:translate"],
        "ttl_seconds": 3600                     # optional, capped at MAX_TOKEN_TTL_S
      }

    Returns:
      {
        "token":      "<jwt>",
        "jti":        "<uuid>",
        "subject":    "genie-ai-opea",
        "scopes":     [...],
        "expires_at": <unix>,
        "kid":        "<8-char-key-id>"
      }

    NOTE: the token is bound to the IP that POSTed this request.
    If GENIE-AI's IP changes (NAT, mobile network), they'll need to
    re-issue. For now this is a deliberate trade-off — IP binding
    closes a stolen-token-replay vector at the cost of mobility.
    """
    # Auth gate
    presented = request.headers.get("X-Admin-Secret", "").strip()
    if not presented or presented != config.ADMIN_SECRET:
        return JSONResponse(
            {"error": "admin_secret_invalid"},
            status_code=401,
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid_json"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "body_must_be_object"}, status_code=400)

    subject = (body.get("subject") or "").strip()
    if not subject or len(subject) > 128:
        return JSONResponse(
            {"error": "subject_required",
             "message": "Provide a non-empty 'subject' (max 128 chars) identifying the caller."},
            status_code=400,
        )

    requested_scopes = body.get("scopes")
    if not isinstance(requested_scopes, list) or not requested_scopes:
        return JSONResponse(
            {"error": "scopes_required",
             "message": f"Provide a non-empty 'scopes' list. Allowed: "
                        f"{sorted(scopes_module.ALL_SCOPES)}"},
            status_code=400,
        )

    granted = scopes_module.validate_scopes(requested_scopes)
    if not granted:
        return JSONResponse(
            {"error": "no_valid_scopes",
             "requested": requested_scopes,
             "allowed":   sorted(scopes_module.ALL_SCOPES)},
            status_code=400,
        )

    ttl = body.get("ttl_seconds", config.DEFAULT_TOKEN_TTL_S)
    try:
        ttl = int(ttl)
    except (TypeError, ValueError):
        return JSONResponse({"error": "ttl_seconds_must_be_int"}, status_code=400)
    if ttl <= 0:
        ttl = config.DEFAULT_TOKEN_TTL_S
    if ttl > config.MAX_TOKEN_TTL_S:
        ttl = config.MAX_TOKEN_TTL_S

    issued = jwt_auth.issue_token(
        subject          = subject,
        requested_scopes = granted,
        requester_ip     = _client_ip(request),
        ttl_seconds      = ttl,
    )

    logger.info(
        "[ADMIN_ISSUE_TOKEN] subject=%s scopes=%s ttl=%ds jti=%s kid=%s",
        subject, granted, ttl, issued.jti, issued.kid,
    )

    return {
        "token":      issued.token,
        "jti":        issued.jti,
        "subject":    issued.subject,
        "scopes":     issued.scopes,
        "expires_at": issued.expires_at,
        "kid":        issued.kid,
        "_note":      (
            "Token is single-use (jti tracked for replay) and bound to "
            "the IP that issued it. Re-issue if the caller's IP changes."
        ),
    }


@app.get("/api/v1/admin/jwt-public-key")
async def admin_jwt_public_key():
    """Public — anyone can fetch the verification key.

    Lets external services verify gateway-issued tokens without ever
    seeing the private key. Asymmetric on purpose.
    """
    return {
        "kid":        jwt_auth.kid(),
        "algorithm":  "RS256",
        "public_key_pem": jwt_auth.public_key_pem(),
        "issuer":     jwt_auth.ISSUER,
        "audience":   jwt_auth.AUDIENCE,
    }


@app.get("/api/v1/public/security/status")
async def security_status():
    """Public-safe view of the gateway's active security layers.

    Does NOT reveal the regex source code (that would help attackers
    craft bypasses). Returns layer presence + recent block stats.
    """
    block_60m  = await audit.recent_block_count(60)
    total_60m  = await audit.recent_total_count(60)
    block_24h  = await audit.recent_block_count(24 * 60)
    total_24h  = await audit.recent_total_count(24 * 60)
    phi_stats  = phi_redactor.get_redactor().get_stats()

    rl_stats = rate_limit_module.get_stats()
    return {
        "service":    "amina-gateway",
        "phase":      "0+1+2a+3+4",
        "config":     config.snapshot(),
        "layers": {
            "L2_adaptive_rate_limit":       config.RATE_LIMIT_ENABLED,
            "L4_jwt_scope_enforcement":     config.JWT_ENABLED,
            "L5_schema_validation":         True,
            "L5_jailbreak_pattern_match":   config.JAILBREAK_DETECTION_ENABLED,
            "L6_phi_redaction_outbound":    True,
            "L6_phi_inbound_rejection":     True,
            "L7_audit_log":                 config.AUDIT_LOG_ENABLED,
            # Backlog — show the diagram so testers see the roadmap
            "L1_input_classifier":          False,
            "L2_clinical_constitution":     False,
            "L3_mtls_client_cert":          False,
            "L3_faiss_sbert_similarity":    False,
            "L6_multi_turn_escalation":     False,
        },
        "jailbreak_pattern_count": jailbreak_detector.pattern_count(),
        "patterns_summary":        jailbreak_detector.pattern_summary(),
        "phi_redactor": {
            "outbound_calls":         phi_stats["outbound_calls"],
            "outbound_redactions":    phi_stats["outbound_redactions"],
            "outbound_critical_alerts": phi_stats["outbound_alerts"],
            "outbound_flagged":       phi_stats["outbound_flagged"],
            "outbound_skipped_long":  phi_stats["outbound_skipped_long"],
            "outbound_skipped_deep":  phi_stats["outbound_skipped_deep"],
            "inbound_checks":         phi_stats["inbound_checks"],
            "inbound_rejections":     phi_stats["inbound_rejections"],
            "pattern_count":          6,
        },
        "rate_limit": {
            "enabled":           config.RATE_LIMIT_ENABLED,
            "checks":            rl_stats["checks"],
            "throttled":         rl_stats["throttled"],
            "throttled_burst":   rl_stats["throttled_burst"],
            "throttled_ip":      rl_stats["throttled_ip"],
            "throttled_caller":  rl_stats["throttled_caller"],
            "redis_hits":        rl_stats["redis_hits"],
            "inmem_hits":        rl_stats["inmem_hits"],
            "skipped_disabled":  rl_stats["skipped_disabled"],
            "tiers": {
                name: {"per_ip_min": t.per_ip, "per_caller_min": t.per_caller, "burst_10s": t.burst}
                for name, t in (
                    ("default",     rate_limit_module.DEFAULT_TIER),
                    ("chat",        rate_limit_module.tier_for("/api/v1/public/chat")),
                    ("translate",   rate_limit_module.tier_for("/api/v1/public/translate")),
                    ("status",      rate_limit_module.tier_for("/api/v1/public/security/status")),
                    ("admin_token", rate_limit_module.tier_for("/api/v1/admin/issue-token")),
                )
            },
        },
        "stats": {
            "last_60_min": {"total": total_60m, "blocked": block_60m},
            "last_24_h":   {"total": total_24h, "blocked": block_24h},
        },
        "_disclaimer": (
            "Phase 0+1+2a+3 implementation. Pattern-based input filtering, "
            "JWT auth, PHI redaction, audit log. Multi-turn escalation, "
            "ML-based detection, and mTLS are sprint backlog."
        ),
    }


@app.post("/api/v1/public/chat")
async def public_chat(request: Request):
    """Validated proxy to AMINA's chat endpoint.

    Pipeline:
      1. body size cap (L5)
      2. JSON parse
      3. schema validation (L5)
      4. jailbreak pattern check on the message field (L5)
      5. proxy to /api/v1/agent/chat (with translated payload shape)
      6. audit log (L7)
    """
    return await _handle_public_endpoint(
        request,
        backend_path="/api/v1/agent/chat",
        validator=schema_validator.validate_chat,
        jailbreak_field="message",
        body_translator=_translate_chat_body,
    )


@app.post("/api/v1/public/translate")
async def public_translate(request: Request):
    """Validated proxy to AMINA's translation pipeline.

    Phase 0+1: backend doesn't yet expose a public translate endpoint,
    so this returns 501 until the backend route is added in a future
    phase. Schema validation + jailbreak detection still run, so
    abuse attempts are caught before they reach a real implementation.
    """
    # We still run validation so audit logs / blocks happen consistently.
    return await _handle_public_endpoint(
        request,
        backend_path="/api/v1/__not_yet_wired__/translate",
        validator=schema_validator.validate_translate,
        jailbreak_field="text",
        body_translator=lambda b: b,
        forced_status=(501, {"error": "translate_endpoint_not_yet_exposed"}),
    )


# ── Pipeline ─────────────────────────────────────────────────────────

def _translate_chat_body(public_body: Dict[str, Any]) -> Dict[str, Any]:
    """Map public /chat shape -> backend /agent/chat shape.

    Public  : { message, session_id?, language? }
    Backend : { message, session_id, channel, language? }

    The backend requires session_id; we synthesize a stable one prefixed
    with 'gw-' so audit + AMINA's own session memory can co-exist.
    """
    sid = public_body.get("session_id") or f"gw-{audit.AuditEntry().log_id}"
    out: Dict[str, Any] = {
        "message":    public_body["message"],
        "session_id": sid,
        "channel":    "web",
    }
    if public_body.get("language"):
        out["language"] = "ma" if public_body["language"] == "mandinka" else "en"
    return out


async def _handle_public_endpoint(
    request:          Request,
    *,
    backend_path:     str,
    validator,
    jailbreak_field:  str,
    body_translator,
    forced_status     = None,
):
    t0 = time.perf_counter()
    entry = _make_audit(request)

    # 0. Master flag
    if not config.GATEWAY_ENABLED:
        entry.status_code = 503
        await audit.write(entry)
        return JSONResponse({"error": "gateway_disabled"}, status_code=503)

    # 0.25. L2 rate limit (Phase 4). The middleware ran already and
    # blocked (with 429) if necessary; here we just read the outcome
    # to record it on the audit entry.
    rl = getattr(request.state, "rate_limit_outcome", None)
    if rl is not None:
        entry.rate_limit_outcome   = "allowed"  # blocked never reaches here
        entry.rate_limit_tier      = rl.tier
        entry.rate_limit_remaining = rl.remaining

    # 0.5. JWT auth (Phase 2a). Runs FIRST so an unauthenticated caller
    # never gets to consume body-parsing or pattern-matching CPU.
    # /security/status + /health stay public (no scope mapping).
    auth_outcome = "n/a"
    claims: Dict[str, Any] = {}
    if config.JWT_ENABLED:
        required_scope = scopes_module.required_scope_for(request.url.path)
        if required_scope is not None:
            raw_token = jwt_auth.parse_authorization_header(
                request.headers.get("Authorization"),
            )
            try:
                claims = jwt_auth.verify_token(
                    raw_token,
                    required_scope = required_scope,
                    requester_ip   = _client_ip(request),
                )
                auth_outcome      = "ok"
                entry.caller_id   = claims.get("sub", "anonymous")
                entry.jwt_jti     = claims.get("jti", "")
                entry.jwt_scopes  = json.dumps(claims.get("scopes") or [])
                entry.auth_outcome = auth_outcome
            except jwt_auth.JWTError as e:
                auth_outcome      = e.code
                entry.auth_outcome = auth_outcome
                entry.security_flags = json.dumps([{
                    "type":   "jwt_rejected",
                    "code":   e.code,
                    "detail": str(e),
                }])
                entry.status_code = e.status_code
                entry.latency_ms  = (time.perf_counter() - t0) * 1000
                await audit.write(entry)
                return JSONResponse(
                    {"error": e.code, "message": str(e)},
                    status_code = e.status_code,
                    headers     = {"WWW-Authenticate": "Bearer"},
                )

    # 1. Body-size cap
    raw = await request.body()
    body_bytes = len(raw)
    entry.request_size = body_bytes
    cap = schema_validator.max_body_bytes_for(request.url.path)
    if body_bytes > cap:
        entry.status_code = 413
        entry.security_flags = json.dumps([{"type": "body_too_large", "limit": cap}])
        entry.latency_ms = (time.perf_counter() - t0) * 1000
        await audit.write(entry)
        return JSONResponse(
            {"error": "request_too_large", "limit_bytes": cap},
            status_code=413,
        )

    # 2. JSON parse
    try:
        body = json.loads(raw or b"{}")
    except Exception as e:
        entry.status_code = 400
        entry.security_flags = json.dumps([{"type": "invalid_json", "detail": str(e)[:120]}])
        entry.latency_ms = (time.perf_counter() - t0) * 1000
        await audit.write(entry)
        return JSONResponse({"error": "invalid_json"}, status_code=400)

    # 3. Schema validation
    err = validator(body)
    if err is not None:
        entry.status_code = 400
        entry.security_flags = json.dumps([{
            "type":   "schema_violation",
            "field":  err.field,
            "reason": err.reason,
        }])
        entry.latency_ms = (time.perf_counter() - t0) * 1000
        await audit.write(entry)
        return JSONResponse(
            {"error": "schema_violation", "field": err.field, "message": err.reason},
            status_code=400,
        )

    # 3.5. L6 inbound PHI rejection (Phase 3). Content fields
    # (message/text/query) are exempt -- a patient may include their
    # own PII. Metadata fields with HIGH/CRITICAL PHI are rejected.
    redactor = phi_redactor.get_redactor()
    inbound_ok, inbound_reject = redactor.check_inbound(body)
    if not inbound_ok:
        entry.status_code = 400
        entry.security_flags = json.dumps([{
            "type":     "phi_in_metadata",
            "reason":   inbound_reject.reason,
            "field":    inbound_reject.field,
            "pattern":  inbound_reject.pattern,
        }])
        entry.latency_ms = (time.perf_counter() - t0) * 1000
        await audit.write(entry)
        return JSONResponse(
            {
                "error":   "phi_in_metadata",
                "field":   inbound_reject.field,
                "pattern": inbound_reject.pattern,
                "message": (
                    "PHI pattern detected in a metadata field. Sensitive "
                    "identifiers (phone, patient_id, email) must not appear "
                    "in fields like session_id. Move them to the message "
                    "body if they are part of patient input."
                ),
            },
            status_code=400,
        )

    # 4. Jailbreak pattern check
    detection = jailbreak_detector.DetectionResult(False, None, None, None, None)
    if config.JAILBREAK_DETECTION_ENABLED and jailbreak_field in body:
        detection = jailbreak_detector.detect(str(body[jailbreak_field]))
        if detection.blocked:
            entry.status_code         = 400
            entry.blocked             = True
            entry.jailbreak_pattern   = detection.pattern or ""
            entry.jailbreak_severity  = detection.severity or ""
            entry.security_flags      = _security_flags_for(detection)
            entry.latency_ms          = (time.perf_counter() - t0) * 1000
            await audit.write(entry)
            return JSONResponse(
                {
                    "error":       "prompt_injection_detected",
                    "pattern":     detection.pattern,
                    "severity":    detection.severity,
                    "description": detection.description,
                    "message": (
                        "Your request matches a known jailbreak / prompt-injection "
                        "pattern and was blocked. Please rephrase the question."
                    ),
                },
                status_code=400,
            )

    # 5. Forced-status branch (used by /translate until backend wires it).
    if forced_status is not None:
        status, body_out = forced_status
        entry.status_code = status
        entry.security_flags = _security_flags_for(detection) if detection.pattern else "[]"
        entry.latency_ms = (time.perf_counter() - t0) * 1000
        await audit.write(entry)
        return JSONResponse(body_out, status_code=status)

    # 6. Proxy
    backend_body = body_translator(body)
    headers = {k: v for k, v in request.headers.items()}
    t_proxy = time.perf_counter()
    status, resp_body, resp_bytes = await proxy.post_json(
        backend_path, backend_body, headers=headers,
    )
    # Feed the rate limiter's adaptive-throttle observer with our own
    # measured backend latency. The observer keeps a 30s p95 sketch;
    # if backend gets slow, chat tier auto-halves until it recovers.
    rate_limit_module.record_backend_latency((time.perf_counter() - t_proxy) * 1000.0)

    # 6.5. L6 outbound PHI redaction (Phase 3). Recursive scan of
    # every string field in the response. Content fields use a soft
    # natural-language replacement; metadata fields use [REDACTED-X].
    # Bounded by depth=10 + per-string 50KB cap so it can't be
    # weaponised with adversarial nesting/length.
    phi_report = phi_redactor.RedactionReport()
    if isinstance(resp_body, (dict, list)):
        resp_body, phi_report = redactor.redact_outbound(resp_body)
    if phi_report.alerts:
        # Critical alerts: backend leaked something it shouldn't have.
        # Log loudly so ops sees the breach in the gateway log stream.
        for a in phi_report.alerts:
            logger.warning(
                "[PHI_CRITICAL] backend_leak audit_id=%s field=%s pattern=%s endpoint=%s",
                entry.log_id, a.get("field"), a.get("pattern"), entry.endpoint,
            )

    # 7. Audit
    entry.status_code        = status
    entry.response_size      = resp_bytes
    entry.security_flags     = _security_flags_for(detection) if detection.pattern else "[]"
    entry.jailbreak_pattern  = detection.pattern or ""
    entry.jailbreak_severity = detection.severity or ""
    entry.phi_redactions_count   = phi_report.redactions_count
    entry.phi_redaction_summary  = json.dumps(phi_report.summary_for_audit()) \
                                    if phi_report.redactions else "[]"
    entry.latency_ms         = (time.perf_counter() - t0) * 1000
    await audit.write(entry)

    # Add a non-secret response header so testers can see the layer ran.
    response = JSONResponse(resp_body, status_code=status)
    response.headers["X-Amina-Gateway"]              = "v0.1.0"
    response.headers["X-Amina-Gateway-Audit-Id"]     = entry.log_id
    layers_active = ["L5", "L7"]
    if config.JWT_ENABLED:        layers_active.insert(0, "L4")
    if config.RATE_LIMIT_ENABLED: layers_active.insert(0, "L2")
    layers_active.insert(-1, "L6")   # L6 always before L7
    response.headers["X-Amina-Gateway-Layers-Active"] = ",".join(layers_active)
    if phi_report.redactions_count > 0:
        response.headers["X-Amina-Gateway-Phi-Redactions"] = str(phi_report.redactions_count)
    if rl.tier:
        response.headers["X-RateLimit-Tier"]      = rl.tier
        response.headers["X-RateLimit-Remaining"] = str(rl.remaining)
        response.headers["X-RateLimit-Backend"]   = rl.backend
    return response


# ── Lifecycle ────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    logger.info("=" * 60)
    logger.info("AMINA API Gateway starting")
    logger.info("  enabled              = %s", config.GATEWAY_ENABLED)
    logger.info("  backend              = %s", config.BACKEND_URL)
    logger.info("  audit log            = %s", config.AUDIT_LOG_ENABLED)
    logger.info("  jailbreak detection  = %s (%d patterns)",
                config.JAILBREAK_DETECTION_ENABLED,
                jailbreak_detector.pattern_count())
    logger.info("=" * 60)
    # Best-effort eager schema bootstrap (lazy fallback on first write).
    try:
        await audit.bootstrap_schema()
    except Exception as e:
        logger.warning("startup: schema bootstrap deferred to first write (%s)", e)


# ── Catch-all transparent proxy (Step 6) ─────────────────────────────
#
# After all specific routes (security/status, public/chat, public/translate,
# admin/*) have been registered, mount a wildcard reverse proxy that
# forwards any other request straight to haystack-chatqna. This means a
# single tunnel target (api.amina-design.com -> amina-gateway:8443) is
# enough: the gateway owns the perimeter for jailbreak-protected paths,
# and transparently forwards everything else (auth, caregiver, agent,
# inbox, alerts, voice).
#
# Order matters: this MUST be the last route registered. FastAPI matches
# in declaration order so specific paths still win first.
@app.api_route(
    "/{full_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
async def transparent_proxy(full_path: str, request: Request):
    return await proxy.transparent_forward(request, full_path)


@app.on_event("shutdown")
async def shutdown():
    await proxy.close()
    logger.info("amina-gateway shutting down")


if __name__ == "__main__":
    # Convenience for local debugging — production uses uvicorn directly
    # via the Dockerfile CMD.
    import uvicorn
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="info")
