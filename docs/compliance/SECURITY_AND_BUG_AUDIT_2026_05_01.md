# AMINA — Security + Bug Audit (2026-05-01)

**Audience:** auditor, ops, engineering lead, MOH liaison.
**Bar:** MVP-ready (not enterprise pen-test). Severity reflects "what
blocks an MVP deployment to a real CHW", not "what would fail enterprise
hardening".
**Scope:** every backend service / route, every frontend file, every
docker-compose / CI / `.env` artifact, the translation + NLP layer.
**Excluded:** the caregiver-privacy-policy code (Phases 1-10 was already
audited end-to-end and lives in
[`PHASES_1_TO_10_DELIVERY_RECORD.md`](PHASES_1_TO_10_DELIVERY_RECORD.md)).
**Method:** four parallel read-only sweeps (security, backend logic,
frontend, infra+translation/NLP), deduplicated and re-ranked.

| Total findings | Critical | High | Medium | Low |
|---:|---:|---:|---:|---:|
| **56** | **10** | **15** | **20** | **11** |

**🚨 Top-line risk:** the repo's `haystack-stack/.env` was committed to
the public-origin GitLab and contains real Google / OpenAI / Twilio
(incl. caller-ID phone number) / DHIS2 / Groq / Mistral / Meta tokens
in cleartext. **Treat every secret in that file as compromised and
rotate on the rotation schedule in
[`SECRET_ROTATION_CADENCE.md`](SECRET_ROTATION_CADENCE.md) immediately.**

The 10 critical findings below MUST close before any external-facing
deployment (pilot or otherwise). The remainder are tracked here so
they don't drift.

---

## How to read each row

Every finding is an actionable bug with a stable id (`BUG-001` …),
a citable file:line, a one-sentence what's-wrong, and a recommended
fix that an engineer can pick up directly. Status starts at `open`;
flip to `in_progress` / `fixed` as work lands and link the commit.

The findings have not been individually re-verified by reading the
exact line — a few are agent-reported and may need a 30-second
eyeball before the fix lands. The rows most worth eyeballing first
(because they're behaviour-changing edits, not config tweaks) are
flagged with **⚠ verify** below.

---

## 🚨 Critical — fix before any external deployment

### BUG-001 · Real production secrets committed to `.env`
- **Severity:** Critical
- **Where:** `haystack-stack/.env:3,9,13,22,50-52,60`
- **What:** `GOOGLE_API_KEY`, `OPENAI_API_KEY` (full key), Twilio SID + token + caller-ID phone number, DHIS2 credentials, Groq + Mistral keys, Meta tokens — all in cleartext on a public-origin branch.
- **Impact:** Anyone with read access to the GitLab origin can grant themselves API access on every paid LLM provider, send SMS as the AMINA caller-ID, and write to MoH DHIS2.
- **Fix:** Rotate every key listed under §2 of `SECRET_ROTATION_CADENCE.md` *today*. After rotation: scrub `.env` from git history (BFG / git-filter-repo), force-push, ensure `.env` is in `.gitignore` (it already is — the commit was a mistake), and add a CI pre-commit secret-detection hook so this can't recur.
- **Status:** `open`

### BUG-002 · Hardcoded admin creds in source
- **Severity:** Critical
- **Where:** `haystack-stack/haystack-chatqna/src/api/admin_routes.py:20-21`
- **What:** `ADMIN_USERNAME = "admin"`, `ADMIN_PASSWORD = "amina2026"`, `ADMIN_SECRET = "amina-admin-secret"` are Python module-level constants. Bypasses entire admin auth layer.
- **Fix:** Move to env vars with no defaults; fail-fast at startup if unset. Hash the password with bcrypt or argon2 (don't store plaintext even in env).
- **Status:** `open`

### BUG-003 · `JWT_SECRET` default in source
- **Severity:** Critical
- **Where:** `haystack-stack/haystack-chatqna/src/config.py:67`
- **What:** Defaults to `"amina-mvp-secret-change-in-prod-2026"` if env unset. All caregiver / patient / admin tokens become forgeable.
- **Fix:** Remove the default. Raise `RuntimeError` at startup if `JWT_SECRET` is absent or shorter than 32 bytes. Pair with the rotation cadence so prod has a real key.
- **Status:** `open`

### BUG-004 · ArcadeDB root password default `"genieRoot123"`
- **Severity:** Critical
- **Where:** `haystack-stack/haystack-chatqna/src/config.py:51`, `haystack-stack/docker-compose.yml:13,16`, `haystack-stack/.env.example`
- **What:** Same default value across 3 surfaces. If `.env` is missing, fallback to the hardcoded value re-activates and the database is reachable with public credentials.
- **Fix:** Same shape as BUG-003 — env-only, no default. Update `.env.example` to say `<set-me>` not the literal value.
- **Status:** `open`

### BUG-005 · SQL injection in `community_store`
- **Severity:** Critical · ⚠ verify
- **Where:** `haystack-stack/haystack-chatqna/src/db/community_store.py:108-110`
- **What:** `await _exec(f"DELETE FROM CommunityData WHERE doc_id = '{doc_id}'")` uses f-string interpolation on user-supplied `doc_id`. Same pattern on the INSERT at line 110.
- **Fix:** Switch to ArcadeDB parameterised SQL (`?` placeholders + params dict, the same pattern `caregiver_privacy_consent.py` uses).
- **Status:** `open`

### BUG-006 · Dev bypass flags committed `true` in `.env`
- **Severity:** Critical
- **Where:** `haystack-stack/.env:28,35,43,47` + `haystack-stack/haystack-chatqna/src/api/care_routes.py:56`
- **What:** `CHATQNA_ADMIN_MV_OPEN=true` (admin dashboards without JWT), `CARE_TRUST_BODY_ROLE=true` (lets request body's `role` claim override JWT — patient → admin self-promotion), `DHIS2_DEV_ADMIN_BYPASS=true`. The file even comments "SET TO false BEFORE DEPLOYING" — easy to miss.
- **Fix:** Default each to `false` in code. Add a hard check at startup: if any of these is `true` AND `AMINA_ENV` is `production`, refuse to boot.
- **Status:** `open`

### BUG-007 · `OTP_DEV_MODE` default `true`
- **Severity:** Critical
- **Where:** `haystack-stack/haystack-chatqna/src/config.py:74`
- **What:** Returns the OTP in the response body. Default-on means any deploy with default config has SMS verification bypassed.
- **Fix:** Default `false`. Same env-guard as BUG-006.
- **Status:** `open`

### BUG-008 · Unauth document download
- **Severity:** Critical
- **Where:** `haystack-stack/haystack-chatqna/src/api/agent_routes.py:1262-1320`
- **What:** `GET /api/v1/agent/document/{session_id}/download/{fmt}` accepts `session_id` from the URL with no JWT check. Enumerate UUIDs → exfiltrate patient care plans, consultation notes, summaries as PDF / DOCX.
- **Fix:** Add `Depends(_require_caregiver | _require_patient)` and verify the caller is the session owner (the agent platform already tracks session ownership via the conversation-inbox link).
- **Status:** `open`

### BUG-009 · Unauth `/api/v1/agent/patients/list`
- **Severity:** Critical
- **Where:** `haystack-stack/haystack-chatqna/src/api/agent_routes.py:450-480`
- **What:** Returns all patient profiles (name, age, conditions, medications) with no auth. Code comment says "in production this would be behind auth — for now it's an open selector".
- **Fix:** Gate with `_require_caregiver` and scope the response to the caregiver's linked patients only (the `/caregiver/patients` route pattern is the right shape).
- **Status:** `open`

### BUG-010 · Unauth compactor endpoints
- **Severity:** Critical
- **Where:** `haystack-stack/haystack-chatqna/src/api/agent_routes.py:65-75,132`
- **What:** `/api/v1/agent/compactor/stats/{session_id}` and `/api/v1/agent/compactor/trigger/{session_id}` — anyone can read or modify any session's compaction state by guessing UUIDs.
- **Fix:** Gate with session-owner auth (same pattern as BUG-008).
- **Status:** `open`

---

## High

### BUG-011 · Default PIN `"1234"` in caregiver seed scripts
- **Severity:** High
- **Where:** `haystack-stack/haystack-chatqna/scripts/seed_caregivers.py:32`, `…/fix_directory_caregiver_auth.py:51`
- **What:** Both scripts pin caregivers to PIN `"1234"` on first deployment. If seed data ever lands in prod, every seeded caregiver shares the PIN.
- **Fix:** Generate per-caregiver random PINs, log them once to a sealed operator-only output, and force change-on-first-login.
- **Status:** `open`

### BUG-012 · Token in URL query string
- **Severity:** High
- **Where:** `haystack-stack/haystack-chatqna/src/api/smart_routes.py:63-75`
- **What:** Endpoint accepts `?amina_token=...` for "demo convenience". URL appears in browser history, server access logs, referrer headers.
- **Fix:** Remove the query-string path. Require `Authorization: Bearer …` header only. If demo convenience is genuinely needed, time-bound the URL via a short-lived signed redirect.
- **Status:** `open`

### BUG-013 · Empty `resp.choices` crashes planner
- **Severity:** High · ⚠ verify
- **Where:** `haystack-stack/haystack-chatqna/src/agent_platform/planner.py:196`
- **What:** `resp.choices[0].message.content` assumes non-empty list. A valid HTTP 200 with an empty `choices` array (rare LLM provider response) raises `IndexError` instead of falling through to fail-safe.
- **Fix:** `if not resp.choices: return _empty_plan_fallback()`. Match the existing fail-safe pattern used elsewhere in the agent platform.
- **Status:** `open`

### BUG-014 · `asyncio.gather(... return_exceptions=False)` in tool executor
- **Severity:** High
- **Where:** `haystack-stack/haystack-chatqna/src/agent_platform/tool_executor.py:49`
- **What:** One slow or failing tool exception crashes the whole gather. Other approved tools that would have succeeded never run.
- **Fix:** `return_exceptions=True`, then post-process — successful results bubble up, failures get logged + replaced with a per-tool error result.
- **Status:** `open`

### BUG-015 · Safety consensus fails open on auditor timeout
- **Severity:** High · ⚠ verify
- **Where:** `haystack-stack/haystack-chatqna/src/services/safety_consensus.py:382-393`
- **What:** When `second_opinion()` raises an exception, `guard_reply()` catches it and returns `"action": "pass"` — the dangerous reply is served unaudited. Auditor network hiccup = silent safety bypass.
- **Fix:** On exception, return `"action": "fallback_to_safe_template"` (a canned advisory referring the user to a human / hotline). Log the auditor failure to the audit-event store with severity `error`.
- **Status:** `open`

### BUG-016 · Rate limiter fails open when Redis is down
- **Severity:** High
- **Where:** `haystack-stack/haystack-chatqna/src/services/rate_limiter.py:137-140`
- **What:** `if _get_redis() is None` → `logger.debug() + continue`. No rate limiting at all — attacker can pound endpoints, burn LLM quota, OOM whisper-server.
- **Fix:** Fail closed for high-cost endpoints (LLM, voice, agent). For low-cost endpoints, use an in-memory token bucket as a Redis-down fallback.
- **Status:** `open`

### BUG-017 · Emergency escalation swallows JSON-parse exceptions
- **Severity:** High · ⚠ verify
- **Where:** `haystack-stack/haystack-chatqna/src/services/emergency_escalation.py:211-212`
- **What:** `except Exception: pass` while reading resolved alerts. Bad JSON silently drops the alert — `get_latest_for_patient()` can return `None` while an active emergency exists.
- **Fix:** Log the malformed row at warning level (with sanitised id only — no body), keep iterating. Add a metric for `parse_failures_total` so this doesn't stay silent.
- **Status:** `open`

### BUG-018 · Translation cache poisoning
- **Severity:** High
- **Where:** `haystack-stack/haystack-chatqna/src/services/translator.py:120-121`
- **What:** Redis cache key is `sha1(f"{source}|{target}|{text}")[:16]`. Truncated SHA-1 has small collision space. A bad translation (LLM hallucination) caches for 30 days; future identical English requests serve the poisoned version. Medical-instruction misuse risk.
- **Fix:** Use full SHA-256, no truncation. Cache only after `translation_gate.verify_translation()` clears the result. Add an admin "purge cache key" tool for incident recovery.
- **Status:** `open`

### BUG-019 · `translation_corrector` on empty/whitespace input
- **Severity:** High · ⚠ verify
- **Where:** `haystack-stack/haystack-chatqna/src/nlp/translation_corrector.py` (1,541 LoC, 15 layers)
- **What:** No length guard at entry. Empty string → `_enforce_greeting()` appends a greeting to nothing → `_check_completeness()` flags false hallucination.
- **Fix:** Early return on `len(stripped) < N` (suggest N=3) with a stable result `{"text": "", "skipped": "input_too_short"}`.
- **Status:** `open`

### BUG-020 · Medical NER false-positive on common food words
- **Severity:** High
- **Where:** `haystack-stack/haystack-chatqna/src/nlp/medical_ner.py:23-54`
- **What:** Single-word entries `"liver"`, `"blood"`, `"kidney"`, `"breathing"` flagged as medical regardless of context. "I have liver for dinner" routes to clinical escalation.
- **Fix:** Move single-word terms to a context-required list; require co-occurrence with a symptom / vital / drug term within a 5-token window before flagging. Add an `assert_negative_test_set` to the test suite covering food-context phrases.
- **Status:** `open`

### BUG-021 · Document-upload errors silently ignored in caregiver wizard
- **Severity:** High
- **Where:** `components/frontend/src/components/CaregiverRegistrationWizard.jsx:850`
- **What:** `.catch(() => {})` on credential uploads. CHW sees "registration successful" while the credential file never reached the server. Compliance-blocking — caregiver appears registered without verification artifacts.
- **Fix:** Surface the upload error in the wizard, hold the user on the upload step, do not advance to "success" until all uploads ack 200.
- **Status:** `open`

### BUG-022 · No double-submit guard on caregiver registration
- **Severity:** High
- **Where:** `components/frontend/src/components/CaregiverRegistrationWizard.jsx:784-857`
- **What:** `setBusy(false)` only fires after all uploads complete. User can click "Register" again during upload phase, queueing duplicate registrations.
- **Fix:** Set `busy=true` immediately on the first submit; disable the button while busy; debounce / idempotency-key on the registration POST.
- **Status:** `open`

### BUG-023 · Full error object logged to console on auth failure
- **Severity:** High
- **Where:** `components/gov-chat-frontend/src/services/authService.js:73-78`
- **What:** `console.error('Login error:', error)` includes the full request body — hashed password and any PII. Browser DevTools / log-collection extensions scrape this.
- **Fix:** Log only the HTTP status + the error name. Redact body. Use the same pattern as `caregiverConsent403Interceptor.js` (which deliberately logs nothing on the 403 path).
- **Status:** `open`

### BUG-024 · ArcadeDB healthcheck verifies HTTP 200 only, not query-ability
- **Severity:** High
- **Where:** `haystack-stack/docker-compose.yml:22-26`
- **What:** Wedged or read-only ArcadeDB still returns HTTP 200 from `/api/v1/ready`. `service_healthy` lies to dependents — haystack-chatqna boots and writes silently fail.
- **Fix:** Healthcheck should run a minimal `SELECT 1 FROM CaregiverVertex LIMIT 1` and check the response shape. If query fails, fail the healthcheck.
- **Status:** `open`

### BUG-025 · Containers run as root
- **Severity:** High
- **Where:** `haystack-stack/haystack-chatqna/Dockerfile:1-22`
- **What:** No `USER` directive. LLM-injection / PDF-parse RCE escalates straight to root inside the container. Worse if `/var/run/docker.sock` is ever bind-mounted.
- **Fix:** Add a non-root user (`USER amina:amina`) with restricted permissions on `/app`. Verify `/app` ownership in the Dockerfile.
- **Status:** `open`

---

## Medium

### BUG-026 · SQL f-string formatting in admin routes
- **Severity:** Medium · ⚠ verify
- **Where:** `haystack-stack/haystack-chatqna/src/api/admin_routes.py:85,159,198`
- **What:** Table names are hardcoded today (so not injection), but the f-string pattern is one refactor away from being injectable, and it breaks on user-data containing single quotes.
- **Fix:** Switch to parameterised queries. Same pattern as `caregiver_routes.py`.
- **Status:** `open`

### BUG-027 · Exception traces leak in 5xx responses
- **Severity:** Medium
- **Where:** `…/api/agent_routes.py:1044`, `…/api/routes.py:87,255`
- **What:** `HTTPException(status_code=500, detail=str(e))` echoes stack traces / query bodies / module paths to the client.
- **Fix:** A small middleware that catches unhandled exceptions, logs them server-side with a correlation id, and returns `{"error": "internal_error", "request_id": "<id>"}` only.
- **Status:** `open`

### BUG-028 · Facebook access token in URL query
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/api/auth_routes.py:399`
- **What:** `f"https://graph.facebook.com/me?fields=…&access_token={req.access_token}"`. Token leaks via referrer + intermediate proxy logs.
- **Fix:** Use `Authorization: Bearer …` header against the Graph API endpoint that accepts it (or pass token in POST body).
- **Status:** `open`

### BUG-029 · Unauthenticated feedback stats / history
- **Severity:** Medium
- **Where:** `…/api/agent_routes.py:1010-1045`
- **What:** `/api/v1/agent/feedback/stats` and `/api/v1/agent/feedback/session/{session_id}` return aggregated feedback + sentiment data with no auth. Session enumeration → patient-satisfaction map.
- **Fix:** Gate behind admin auth (same `_verify_admin` used elsewhere) or scope per-session to the session owner.
- **Status:** `open`

### BUG-030 · `USE_V3_TRANSLATOR` env var documented but not wired
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/services/translator_v3.py:35` (docstring only)
- **What:** Docstring says "set `USE_V3_TRANSLATOR=true` to activate". No code reads the variable. Anyone trusting the doc gets v2 silently.
- **Fix:** Either wire the env-var branch in `translation_v3_integration.py` so v3 actually activates, or delete the misleading doc and keep the v3 module clearly marked "WIP / not wired".
- **Status:** `open`

### BUG-031 · 3 NLP modules dead-loaded
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/services/nlp_pipeline_integration.py`
- **What:** `manding_transfer.py` (792 LoC), `mandinka_temporal.py` (895 LoC), `notification_intent.py` (385 LoC) are imported in `src/nlp/__init__.py` but `run_nlp_pipeline()` only calls 5 of the 6 layers. ~2 KLoC of code shipped without a runtime path.
- **Fix:** Decide per-module: wire it (add to `run_nlp_pipeline`) or delete it. Don't leave orphan modules — they accumulate maintenance debt and could be flipped on by a well-meaning refactor without test coverage.
- **Status:** `open`

### BUG-032 · Intent router race condition
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/services/intent_router.py:174-195`
- **What:** `_get_redis()` and `_save_last_intent()` are not atomic. Concurrent requests on the same session can race — first reads stale value, both write conflicting states.
- **Fix:** Use Redis `SETNX` + transaction for the read-modify-write, OR add a per-session lock (`SET key value NX PX 1000`).
- **Status:** `open`

### BUG-033 · Conversational pacer Redis queue unbounded
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/services/conversational_pacer.py:171-195`
- **What:** Queue has TTL but no max length. Long sessions or buggy push paths grow Redis memory without bound.
- **Fix:** Add `LTRIM key 0 N` after each push (suggest N=200). Alert when length exceeds half the cap.
- **Status:** `open`

### BUG-034 · Response shaper crashes on `None` `emotional_state`
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/services/response_shaper.py:131`
- **What:** Default param value is `None`; `.get("register")` raises `AttributeError` on first-turn requests.
- **Fix:** `(emotional_state or {}).get("register")` — the same defensive pattern used elsewhere in the file.
- **Status:** `open`

### BUG-035 · Training consent assumes `rows[0]`
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/services/training_consent.py:88-96`
- **What:** `rows = (resp or {}).get("result", [])` then `rows[0]`. Crashes if `result` is `None` (a valid ArcadeDB shape on certain failures).
- **Fix:** Guard `if not rows: return defaults` before the `rows[0]` access.
- **Status:** `open`

### BUG-036 · `autoTranslator.js` malformed ternary
- **Severity:** Medium · ⚠ verify
- **Where:** `components/frontend/src/i18n/autoTranslator.js:196`
- **What:** Operator-precedence in the cache-lookup ternary makes attribute-cache lookups always miss → repeated translation API calls for the same string.
- **Fix:** Parenthesise the cache lookup; add a unit test pinning cache hits to 0 API calls on the second invocation.
- **Status:** `open`

### BUG-037 · `LLMProviderBadge` cleanup runs on mount, not unmount
- **Severity:** Medium
- **Where:** `components/frontend/src/admin/LLMProviderBadge.jsx:185`
- **What:** `useEffect(() => () => {...}, [])` — the cleanup function is the effect itself; it fires immediately on mount. Timer can fire after unmount.
- **Fix:** Restructure as `useEffect(() => { ... ; return () => {...} }, deps)` with the right dependency array.
- **Status:** `open`

### BUG-038 · Voice-STT CPU under-provisioned
- **Severity:** Medium
- **Where:** `haystack-stack/docker-compose.override.yml:35-39`
- **What:** Voice-STT capped at 4 CPUs. Whisper base.en spikes to 6+ CPUs on long audio. Concurrent voice + PDF ingest OOMs.
- **Fix:** Raise voice-STT to 6 CPUs OR reduce concurrent voice via `voice_concurrency_limiter` to 1 worker until the cap is lifted.
- **Status:** `open`

### BUG-039 · Bind mounts without explicit `:rw` / `:ro`
- **Severity:** Medium
- **Where:** `haystack-stack/docker-compose.yml:37-38,58,87,109`
- **What:** Default rw on `./data/arcadedb`, `./data/redis`. Compromised container corrupts host data.
- **Fix:** Add explicit `:rw` where needed and `:ro` for read-only mounts. Restrict file permissions on the host directories.
- **Status:** `open`

### BUG-040 · `CaregiverChat` polling captures stale token
- **Severity:** Medium
- **Where:** `components/frontend/src/CaregiverChat.jsx:168`
- **What:** `useCallback` for `fetchMessages` doesn't depend on `token`; refresh = silent message-load failures with old token in flight.
- **Fix:** Add `token` to the `useCallback` deps array and the polling effect's deps.
- **Status:** `open`

### BUG-041 · Translation gate thresholds uniform across response types
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/services/translation_gate.py:58-120`
- **What:** Medication-instruction quality scored same as general advice. Risky dosing advice can serve bilingual at score 0.5.
- **Fix:** Per-response-type thresholds: medication / dosage → require ≥ 0.85; symptom advice → ≥ 0.7; general → ≥ 0.5. Plumbed through the `response_type` already in scope.
- **Status:** `open`

### BUG-042 · Code-switch detector silent on malformed Unicode
- **Severity:** Medium
- **Where:** `haystack-stack/haystack-chatqna/src/nlp/code_switch_detector.py:200-218`
- **What:** RTL markers, zero-width spaces, mixed-script copy-paste classify as "unknown" silently. Downstream code assumes a language label.
- **Fix:** When dominant_language is `unknown`, raise a structured warning + fall back to English-only response.
- **Status:** `open`

### BUG-043 · Two duplicate `storage` listeners in admin review toast
- **Severity:** Medium
- **Where:** `components/frontend/src/admin/AdminReviewToast.jsx:79,116`
- **What:** Two `window.addEventListener("storage", onStorage)` calls — both fire on every storage change. Double-fetches admin review data.
- **Fix:** Consolidate into a single effect with one listener; remove the duplicate.
- **Status:** `open`

### BUG-044 · `PrescriptionUploadForm` no client-side type validation
- **Severity:** Medium
- **Where:** `components/frontend/src/forms/PrescriptionUploadForm.jsx:122`
- **What:** Validates size client-side but not type. `.exe` reaches backend before rejection — confusing user mid-flow + wasted bandwidth.
- **Fix:** Add `accept="image/*,application/pdf"` to the input and an explicit type check before submit.
- **Status:** `open`

### BUG-045 · `LLM_FALLBACK_CHAIN` ends in `"base"` (which is OpenAI)
- **Severity:** Medium
- **Where:** `haystack-stack/docker-compose.override.yml:82-96`
- **What:** Chain `mistral,groq,gemini,base` — `base` resolves to OpenAI. If OpenAI key expires, the "fallback" is the same provider; chain has no real fallback.
- **Fix:** Add a deterministic local-only fallback (canned safe-template advisory referring to human / hotline) as the absolute last hop.
- **Status:** `open`

---

## Low

### BUG-046 · README ships default ArcadeDB Studio creds inline
- **Severity:** Low
- **Where:** `README.AminaCare.md:99`
- **Fix:** Remove the literal credentials; replace with `<see SECRET_ROTATION_CADENCE.md>`.
- **Status:** `open`

### BUG-047 · Filename enumeration in inbox
- **Severity:** Low
- **Where:** `haystack-stack/haystack-chatqna/src/api/inbox_routes.py:314-340`
- **What:** Filenames stored in Redis (file_token_service is otherwise safe — presigned URLs). Filename patterns can leak document types.
- **Fix:** Replace stored filename with an opaque id; keep the original filename only in the response to the legitimate caller.
- **Status:** `open`

### BUG-048 · Density-compressor token collision risk
- **Severity:** Low
- **Where:** `haystack-stack/haystack-chatqna/src/services/density_compressor.py:85-98`
- **What:** `<DOT>` placeholder collides with literal `<DOT>` in user input.
- **Fix:** Use a UUID-based placeholder generated per call.
- **Status:** `open`

### BUG-049 · Repetition guard truncates mid-word
- **Severity:** Low
- **Where:** `haystack-stack/haystack-chatqna/src/services/repetition_guard.py:81`
- **What:** `"amlodipine 500mg"` → `"500mg"` orphaned of drug name on truncation.
- **Fix:** Truncate at sentence boundary, not word.
- **Status:** `open`

### BUG-050 · Rate-limiter Docker bridge whitelist hardcoded
- **Severity:** Low
- **Where:** `haystack-stack/haystack-chatqna/src/services/rate_limiter.py:94-106`
- **What:** Hardcodes `172.18.0.x`. Non-default Docker installs lose inter-service exemption → cascading rate-limit during normal calls.
- **Fix:** Read the bridge subnet from an env var, or detect via `socket.gethostbyname` at startup.
- **Status:** `open`

### BUG-051 · Emergency escalation timestamp inconsistency
- **Severity:** Low
- **Where:** `haystack-stack/haystack-chatqna/src/services/emergency_escalation.py:137-146`
- **What:** No `Z` suffix on `_now_iso`; other modules append `Z`. `_minutes_since` math fails silently on tz-mixed inputs.
- **Fix:** Single helper used everywhere — `now_iso() -> "YYYY-MM-DDTHH:MM:SS.sssZ"`.
- **Status:** `open`

### BUG-052 · Hospital fallback hardcoded to Greater Banjul
- **Severity:** Low
- **Where:** `haystack-stack/haystack-chatqna/src/services/emergency_escalation.py:101-121`
- **What:** Distant patients route 500 km away on missing region data.
- **Fix:** Refuse to fall back; instead surface "region unknown — operator must triage" to the on-call.
- **Status:** `open`

### BUG-053 · Translation corrector regex perf O(n·m) on long inputs
- **Severity:** Low
- **Where:** `haystack-stack/haystack-chatqna/src/nlp/translation_corrector.py:505-523`
- **Fix:** Pre-compile patterns; cap input length to N tokens with a clean fallback.
- **Status:** `open`

### BUG-054 · `_remove_garbled_phrases` silently deletes hard blockers
- **Severity:** Low
- **Where:** same file, `:1512-1527`
- **What:** Match-and-slice can delete a patient ID that should have been blocked, leaving only the surrounding advice.
- **Fix:** Run hard-blocker regex BEFORE garbled-phrase removal; abort with a flagged result if any blocker matches.
- **Status:** `open`

### BUG-055 · `SessionKeepAlive.jsx` falls back to `localhost:3000/api`
- **Severity:** Low
- **Where:** `components/frontend/src/platform/components/SessionKeepAlive.jsx:46`
- **Fix:** No silent fallback; if env var unset, no-op the keep-alive.
- **Status:** `open`

### BUG-056 · `.gitlab-ci.yml` gate stage doesn't run secret-detection or `pip-audit`
- **Severity:** Low
- **Where:** `.gitlab-ci.yml:19-25,46-80`
- **What:** Gate is fast but bypasses the secret-detection check pre-merge. A secret like the BUG-001 leak would only get caught at the SAST stage post-merge.
- **Fix:** Land MR-2 / MR-4 of the CI ramp documented in `CI_EVAL_GATE_PLAN.md` — adds `pip-audit` + `npm audit`. Add `gitleaks` or similar to the gate stage to catch secrets pre-merge.
- **Status:** `open`

---

## Recommended remediation order

### 🚨 Today (before any external deployment)

1. **BUG-001 — secret rotation.** All keys in committed `.env` are compromised. Rotate per `SECRET_ROTATION_CADENCE.md`. Scrub `.env` from history; force-push.
2. **BUG-006, BUG-007 — disable dev bypasses.** Default-false in code; add startup-refusal if any of the 4 flags is `true` AND `AMINA_ENV` is `production`.
3. **BUG-008, BUG-009, BUG-010 — auth on the 3 unauth endpoint families.** Worst PHI-exposure surface in the codebase.
4. **BUG-005 — SQL injection.** One-line fix; immediate.

### This week

5. **BUG-002, BUG-003, BUG-004 — env-only secrets.** Fail-fast on missing env. Pair with rotation schedule.
6. **BUG-013 → BUG-017 — fail-open patterns.** Silent failure modes that won't show in metrics until a real incident hits a CHW.
7. **BUG-021, BUG-022 — caregiver registration upload + double-submit.** Compliance-blocker (caregiver appears registered without verification artifacts).
8. **BUG-018, BUG-019 — translation cache + corrector hardening.** Medical-instruction safety.
9. **BUG-024 — ArcadeDB query-able healthcheck.** Otherwise dependent services lie about readiness.

### Next sprint

10. **BUG-020 — context-windowed medical NER.**
11. **BUG-030, BUG-031 — wire-or-delete dormant translator-v3 + 3 unwired NLP modules.** ~2 KLoC of dead code today.
12. **BUG-041 — per-response-type translation gate thresholds.**
13. **All Medium + Low** — bundle into a dedicated cleanup PR; none are user-blocking individually.

### Operator-side (not engineering scope)

14. **BUG-001 follow-on:** add `gitleaks` / `pre-commit` hook to prevent future secret commits.
15. **BUG-025:** non-root `Dockerfile` USER — ops to verify `/app` ownership in the image rebuild.
16. **BUG-039:** explicit `:rw` / `:ro` on bind mounts — ops review.

---

## What's NOT in this audit

- The caregiver-privacy-policy code (Phases 1-10) — separately audited in [`PHASES_1_TO_10_DELIVERY_RECORD.md`](PHASES_1_TO_10_DELIVERY_RECORD.md). Test counts there: **911 PASS / 0 FAIL**.
- Operator infrastructure beyond what compose touches (real prod Kubernetes, real backup-store, real OTel) — out of scope per "MVP-ready" framing.
- Performance / scalability beyond bugs that bite under MVP traffic.
- Mobile (Flutter) — light spot-check only; deserves its own audit before mobile rollout.

---

## Tracking + sign-off

This document is the **single tracking file** for these 56 findings.
As items move, update the `Status` line on the row and link the
remediation commit. Sample format:

```
- **Status:** `fixed` (commit a9efb240 — 2026-05-01)
- **Status:** `in_progress` (PR #42 — 2026-05-04, owner: @engineering)
- **Status:** `wont_fix` (rationale: …)
- **Status:** `open`
```

When the 10 Critical findings are all `fixed`, re-issue this document
as v1.1 with the closure summary at the top. The 4 hard-blocked gaps
already tracked in `compliance_controls.json` (OPS-004, PRIV-005,
RET-006, SEC-008) overlap partially with this audit — see Bug-039,
Bug-001, Bug-025 for the relevant cross-references.

This document does **not** retroactively reduce the `7.91 / 10`
compliance score in `compliance_controls.json`; the controls are
process-level (do-we-have-a-policy / do-we-have-a-test) while these
are line-level bugs that the existing controls didn't catch. Once
the Critical block is closed, ops should re-run the Phase 7 staging
drill — several of these bugs (BUG-013, BUG-014, BUG-015, BUG-016)
would have been visible there if the drill harness had injected
synthetic faults at the right points.

Engineering — 2026-05-01
