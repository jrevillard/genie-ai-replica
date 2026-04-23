# Story 2.10: OPEA Continuity — Keycloak-Agnostic Downstream

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a backend developer,
I want OPEA microservices to remain completely unaware of Keycloak,
so that the existing service-to-service authentication and payload structure are unchanged.

## Acceptance Criteria

1. **Given** a request passes through backend auth middleware
   **When** the request is forwarded to OPEA microservices
   **Then** the existing service-to-service authentication mechanism is used unchanged (FR37)

2. **Given** an authenticated user sends a query
   **When** the backend forwards the request to OPEA
   **Then** the authenticated user's identity is passed via the existing payload structure including `user_id` field (FR38)

3. **Given** the OPEA chatqna service receives a request with `user_id`
   **When** OPEA calls back to the backend for user profile enrichment
   **Then** the callback URL targets a valid endpoint with a URL-safe user identifier
   **And** the user profile is correctly returned for the authenticated user

4. **Given** OPEA microservices process a request
   **When** the request is examined for Keycloak artifacts
   **Then** OPEA microservices do not receive, process, or validate Keycloak tokens
   **And** no Keycloak-specific claims (`realm_access`, `azp`, JWT `iss`) appear in OPEA code

5. **Given** OPEA services are running
   **When** Kong is either deployed or not deployed
   **Then** OPEA services continue to work identically (Kong independence)

6. **Given** OPEA chatqna receives a `user_id` in the payload
   **When** it calls back to `GET /api/users/{user_id}/context` for user profile enrichment
   **Then** the endpoint exists and returns the user profile data
   **And** the `user_id` is URL-safe and does not break the callback URL construction

## Tasks / Subtasks

- [x] Task 1: Verify backend-to-OPEA authentication unchanged (AC: #1)
  - [x] 1.1 Confirm OPEA worker thread does NOT forward `Authorization` header to OPEA services
  - [x] 1.2 Confirm OPEA-to-backend callback uses `X-Service-Token` header with `SERVICE_AUTH_TOKEN` shared secret (replaces dead http-service JWT pipeline)
  - [x] 1.3 Confirm `AUTH_SERVICE_USERNAME` / `AUTH_SERVICE_PASSWORD` are NOT used between backend and OPEA (they're for http-service only, which is now dead)
  - [x] 1.4 Document the network isolation trust model in code comments if not already present

- [x] Task 2: Fix OPEA user_id callback — three stacked issues (AC: #2, #3, #6)
  - [x] 2.1 **CRITICAL — Missing endpoint (regression from Story 1-11)**: OPEA chatqna calls `GET /api/users/{user_id}/context` but this endpoint was **deleted in commit `a3f9549`** as "unused dead code" — but OPEA (external Python service) was using it. Re-create the endpoint.
    - **Reference implementation:** Roman's original route at commit `529daaa` (2026-02-01) — use `git show 529daaa` for the sanitized user context object structure
    - Adapt to new ArangoDB user schema (JIT-provisioned fields: `iss_sub`, `email`, `name`, `roles`)
  - [x] 2.2 **CRITICAL — Auth middleware mismatch**: OPEA calls this endpoint using a service token (NOT a Keycloak JWT). `keycloakAuthMiddleware.authenticate` will REJECT service tokens because they don't have Keycloak `iss`/JWKS signature. Fix:
    - Add `/api/users/:userId/context` to `PUBLIC_PATHS` in `keycloak-auth-middleware.js` (like `/health` and `/api-docs`) — the middleware skips auth for this path
    - Protect the endpoint with a **service shared secret** via `SERVICE_AUTH_TOKEN` env var
    - Add a lightweight middleware check in the route handler: validate `X-Service-Token` header matches `SERVICE_AUTH_TOKEN`
    - Return 401 if `X-Service-Token` is missing or doesn't match — prevents unauthorized access even on Docker network
    - The endpoint returns ONLY sanitized, non-sensitive data (name, role, emailVerified) — same as Roman's original design
    - **Why shared secret over JWT:** The entire http-service JWT pipeline is dead (JWT_SECRET removed, /api/auth/login removed in Story 1-11). Restoring it would resurrect legacy code. A shared secret is simpler, has less attack surface, and is the industry standard for service-to-service auth on isolated networks (Kubernetes, AWS ECS).
    - **Security model:** Docker internal network isolation + shared secret = defense in depth. Even if an attacker reaches the endpoint, they need the token. Even without the token, they only get sanitized data.
  - [x] 2.3 **CRITICAL — URL-breaking composite key**: OPEA callback URL `f"{BACKEND_SERVICE_URL}/api/users/{user_id}/context"` BREAKS with composite key `http://keycloak:8080/realms/genie#uuid` (URL special chars `#`, `/`, `:`). Fix:
    - Use ArangoDB `_key` (URL-safe) instead of `iss_sub` for the OPEA payload `user_id` field
    - Change `query-routes.js:187` from `req.user?.iss_sub` to `req.user?._key`
    - `X-User-Id` header still uses composite key `{iss}#{sub}` for audit/logging (unchanged)
  - [x] 2.4 Implement all three fixes (endpoint + service token auth + user_id format)
  - [x] 2.5 Add `SERVICE_AUTH_TOKEN` to `env` template (new env var for service-to-service auth)
  - [x] 2.6 Update OPEA Python `genieai_chatqna.py` to send `X-Service-Token` header instead of `Authorization: Bearer` (replace dead http-service token with shared secret)
  - [x] 2.7 Update misleading Python comment at `genieai_chatqna.py:197` (references `/:userId` but URL uses `/context`)
  - [x] 2.8 Test: authenticated user query → OPEA payload with `_key` → OPEA profile callback with `X-Service-Token` → backend validates token → sanitized profile returned → full round-trip

- [x] Task 3: Verify no Keycloak token leakage to OPEA (AC: #4)
  - [x] 3.1 Confirm `opea-worker.js` NEVER receives or forwards `Authorization` header
  - [x] 3.2 Confirm only `X-User-Id`, `X-User-Roles`, `X-Issuer` headers are sent to OPEA
  - [x] 3.3 Confirm OPEA services have ZERO references to Keycloak-specific claims (`realm_access`, `azp`, `iss` in JWT format)

- [x] Task 4: Verify Kong independence (AC: #5)
  - [x] 4.1 Confirm OPEA services only communicate with backend (not Kong)
  - [x] 4.2 Confirm header injection works identically whether request came through Kong or directly to backend
  - [x] 4.3 No code changes needed — architectural guarantee verified by code review

- [x] Task 5: Add/update unit tests (AC: all)
  - [x] 5.1 Test: OPEA worker receives correct headers (X-User-Id, X-User-Roles, X-Issuer) without Authorization
  - [x] 5.2 Test: OPEA payload `user_id` uses ArangoDB `_key` when authenticated (URL-safe)
  - [x] 5.3 Test: OPEA payload falls back to `queryData.userId` when not authenticated (backward compat)
  - [x] 5.4 Test: query-routes passes `req.user?.opeaHeaders` and `req.user?._key` to query service
  - [x] 5.5 Test: `X-User-Id` header still uses composite key `{iss}#{sub}` (unchanged, for audit)
  - [x] 5.6 Test: `/api/users/:userId/context` endpoint validates `X-Service-Token` header — rejects missing/wrong token, accepts valid token
  - [x] 5.7 Test: `/api/users/:userId/context` returns sanitized data only (no password, no salt, no tokens, no iss_sub)
  - [x] 5.8 Use shared mock fixture `__tests__/mocks/mockJwtPayload.js`
  - [x] 5.9 **Note:** AC#5 (Kong independence) has no test task — it's an architectural invariant verified by code review (Task 4). No runtime test needed.

## Dev Notes

### Architecture Context (Decisions D4, Service Boundary)

This story validates that the architectural boundary between the authentication layer and the AI layer is maintained:

- **Decision D4**: Multi-realm `user_id` for OPEA uses `{iss}#{sub}` composite key
- **Service Boundary** (architecture.md): "OPEA receives `X-User-Id` header only — never raw tokens. Kong is optional. Backend is autonomous."
- **FR37**: Backend communicates with OPEA using existing service-to-service auth — unchanged
- **FR38**: Backend passes authenticated user identity via existing payload structure including `user_id`

### What Already Works (From Story 2-3)

| Capability | Implementation | Location |
|---|---|---|
| Header injection | `buildUserHeaders()` constructs X-User-Id, X-User-Roles, X-Issuer | `keycloak-auth-middleware.js:56-63` |
| Claims preservation | `req.claims = decoded` after auth | `keycloak-auth-middleware.js:122` |
| OPEA headers attached | `req.user.opeaHeaders = buildUserHeaders(req.claims)` | `keycloak-auth-middleware.js:125` |
| User ID passthrough | `user_id: authenticatedUserId \|\| queryData.userId` | `query-service.js:407,419` |
| Route passes to service | `queryService.createQuery(req.body, req.user?.opeaHeaders, req.user?.iss_sub)` — **needs fix → use `req.user?._key`** | `query-routes.js:187` |
| Worker thread protocol | Headers forwarded to worker, NO Authorization | `opea-worker.js:33-36` |

### CRITICAL FINDING: Three Stacked Issues With OPEA User Profile Callback

**Issue 1 — Missing Endpoint (regression from Story 1-11):**
OPEA chatqna calls `GET /api/users/{user_id}/context` for user profile enrichment, but this endpoint was **deleted in commit `a3f9549`** (Story 1-11 "Remove Legacy Authentication Service") on 2026-04-03. The Story 1-11 dev agent classified it as "unused, dead code" because no backend route called it — but **OPEA (external Python service) was using it**. This is a silent regression: OPEA logs a warning on 404 and continues without user profile enrichment, so the system doesn't crash but runs with degraded AI context.

**Git forensics:**
- **2026-02-01** — Roman introduced both `GET /:userId/context` in `user-routes.js` (commit `529daaa`) and `get_user_profile()` callback in OPEA chatqna (commit `bd30b62`) on the same day. The callback worked with the legacy `authMiddleware.authenticate`.
- **2026-02-22** — Roman enhanced the OPEA profile enrichment (commit `df73656`). Callback still functional.
- **2026-04-03** — Story 1-11 commit `a3f9549` removed `/:userId/context` as "unused, dead code" during legacy auth cleanup. The dev agent didn't check cross-repo callers (OPEA Python layer).

**The endpoint needs to be re-created** with the new auth model (not the old `authMiddleware`, not Keycloak JWT).

**Issue 2 — Auth Middleware Mismatch (dead http-service JWT pipeline):**
Even if the endpoint existed, OPEA calls it using a token from the dead http-service pipeline (`GET_AUTH_TOKEN_URL = "http://http-service:6666/get-token"`). The new `keycloakAuthMiddleware.authenticate` will reject these tokens because they don't have Keycloak `iss`/JWKS signature. The entire http-service JWT system is dead — `JWT_SECRET` removed from code, `/api/auth/login` removed in Story 1-11, `jsonwebtoken` dependency removed.

**Solution:** Use a service shared secret (`SERVICE_AUTH_TOKEN`) instead of resurrecting the legacy JWT system. Add the endpoint to `PUBLIC_PATHS` but protect it with a lightweight `X-Service-Token` header validation in the route handler.

**Issue 3 — URL-Breaking Composite Key:**
Even if the endpoint existed and auth worked, the composite key `user_id = "http://keycloak:8080/realms/genie#some-uuid-1234"` would break the callback URL:

```python
# genieai_chatqna.py line 198
url = f"{BACKEND_SERVICE_URL}/api/users/{user_id}/context"
# Result: http://backend:3000/api/users/http://keycloak:8080/realms/genie#some-uuid-1234/context
```

This BREAKS because `#` is a URL fragment separator, `/` creates unintended path segments, and `:` creates scheme confusion.

**Recommended Fix: Address All Three Issues**

1. **Fix Issue 3 (URL-safe user_id):** Use ArangoDB `_key` instead of `iss_sub` for the OPEA payload `user_id`:
   ```js
   // query-routes.js — change from:
   queryService.createQuery(req.body, req.user?.opeaHeaders, req.user?.iss_sub)
   // to:
   queryService.createQuery(req.body, req.user?.opeaHeaders, req.user?._key)
   ```
   - `_key` is URL-safe (alphanumeric + hyphens), O(1) lookup
   - `X-User-Id` header still uses composite key for audit/logging (unchanged)

2. **Fix Issue 1 (missing endpoint):** Re-create `GET /api/users/:userId/context` in `user-routes.js`:
   - **Reference implementation:** Original route by Roman (commit `529daaa`, 2026-02-01) — use `git show 529daaa` for the sanitized user context object structure
   - Lookup user by `_key` (which is what OPEA sends via `user_id`)
   - Return sanitized user profile data suitable for OPEA context enrichment
   - **MUST be added to `PUBLIC_PATHS`** (not protected by `keycloakAuthMiddleware.authenticate`) — the middleware skips auth for this path
   - **Protected by service shared secret** instead: validate `X-Service-Token` header against `SERVICE_AUTH_TOKEN` env var
   - OPEA must be updated to send `X-Service-Token: {SERVICE_AUTH_TOKEN}` instead of `Authorization: Bearer {dead-http-service-token}`
   - Adapt the original sanitization logic to the new ArangoDB user schema (JIT-provisioned fields: `iss_sub`, `email`, `name`, `roles`)
   - **Why shared secret over restoring JWT:** The entire http-service JWT pipeline is dead — `JWT_SECRET` removed from code, `/api/auth/login` removed in Story 1-11, `jsonwebtoken` dependency removed. Restoring JWT would resurrect legacy code. A shared secret is simpler, less attack surface, and is the industry standard for service-to-service auth on isolated Docker networks.

3. **Decision D4 override note:** This story changes the OPEA `user_id` field from `{iss}#{sub}` (Decision D4) to `_key` for URL safety. `X-User-Id` header continues using `{iss}#{sub}` for audit. The architecture document's Decision D4 should be amended to reflect: "OPEA payload `user_id` uses `_key`; `X-User-Id` header uses `{iss}#{sub}`."

This ensures the full callback chain works: `user query → backend → OPEA payload with _key → OPEA callback GET /api/users/{_key}/context → profile returned → LLM enriched`.

### OPEA Service-to-Service Auth Flow

```
Backend → OPEA (no auth, network isolation trust model)
  POST http://chatqna:8888/v1/chatqna
  Headers: X-User-Id, X-User-Roles, X-Issuer, Content-Type
  Payload: { messages, user_id, stream: false }

OPEA → Backend (service shared secret)
  GET http://backend:3000/api/users/{user_id}/context
  Headers: X-Service-Token: {SERVICE_AUTH_TOKEN}
  Token source: SERVICE_AUTH_TOKEN env var (shared between backend and OPEA)
```

**Why shared secret:** The original http-service JWT pipeline is dead — `JWT_SECRET` removed from code, `/api/auth/login` removed in Story 1-11, `jsonwebtoken` dependency removed. Rather than resurrect the legacy JWT system, we use a simple shared secret (`SERVICE_AUTH_TOKEN`) for service-to-service authentication. This is the industry standard pattern for internal Docker network service-to-service calls (Kubernetes ServiceAccount tokens, AWS ECS task IAM roles follow the same principle). Defense in depth: Docker network isolation + shared secret + endpoint returns only sanitized data.

### Current Code Analysis

**File: `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`**
- `buildUserHeaders(claims)` (lines 56-63): Constructs X-User-Id (`{iss}#{sub}`), X-User-Roles, X-Issuer
- `authenticate()` (lines 75-151): JWT validation → JIT provisioning → attach user + claims + headers
- Line 125: `req.user.opeaHeaders = buildUserHeaders(req.claims)` — key integration point

**File: `components/gov-chat-backend/routes/query-routes.js`**
- Line 8: `router.use(keycloakAuthMiddleware.authenticate)` — all routes protected
- Line 187: `queryService.createQuery(req.body, req.user?.opeaHeaders, req.user?.iss_sub)` — passes headers and user ID

**File: `components/gov-chat-backend/services/query-service.js`**
- `createQuery(queryData, headers, authenticatedUserId)` (line 218): Main OPEA communication
- Lines 405-422: OPEA payload construction with `user_id: authenticatedUserId || queryData.userId`
- Line 428: `this.runOPEAWorker(opeaUrl, opeaPayload, headers)` — offloaded to worker

**File: `components/gov-chat-backend/services/opea-worker.js`**
- Lines 33-36: Builds headers from `Content-Type` + user identity headers
- Never receives `Authorization` header (worker thread isolation)
- 120s timeout, keep-alive connections

**File: `genie-ai-overlay/chatqna/genieai_chatqna.py`**
- Line 73: `BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000")`
- Line 74: `GET_AUTH_TOKEN_URL = os.getenv("GET_AUTH_TOKEN_URL", "http://http-service:6666/get-token")` — **dead endpoint**, will be replaced by `SERVICE_AUTH_TOKEN` env var
- Lines 1230-1235: Extracts `user_id` from payload and calls `get_user_profile(user_id_header)`
- Line 198: `url = f"{BACKEND_SERVICE_URL}/api/users/{user_id}/context"` — **target endpoint does NOT exist; also BREAKS with composite key**
- Lines 181-249: `get_user_profile()` method — currently uses dead http-service JWT; needs update to use `X-Service-Token` header with `SERVICE_AUTH_TOKEN`

### Testing Patterns

**Existing test setup (from Story 2-3 integration tests):**
- `__tests__/token-passthrough-integration.test.js` — tests header extraction flow
- `__tests__/keycloak-auth-middleware.test.js` — tests middleware including buildUserHeaders
- Shared fixtures from `__tests__/mocks/mockJwtPayload.js`

**For this story, add tests for:**
- OPEA payload `user_id` uses URL-safe identifier (not raw composite key)
- OPEA worker headers never include Authorization
- Query route correctly passes headers and user ID to query service
- **CRITICAL (Story 1-9 lesson):** Use `var` for mock variable references in jest.mock, NOT `let`

### Previous Story Intelligence

**Story 2-9 (Multi-Realm):**
- Added `audienceMap`, `initAllRealms()`, `KEYCLOAK_ADDITIONAL_REALMS` env var
- `iss_sub` composite key format now established and consistent
- All 105 tests passed at completion (102 existing + 13 new) — verify current count before adding tests
- Key pattern: `_resetForTesting()` clears all maps including `audienceMap`

**Story 2-3 (Token Passthrough Headers):**
- Implemented `buildUserHeaders()` — the core of OPEA continuity
- Added `req.claims = decoded` for header construction
- Worker thread protocol extended to pass headers
- Used composite key `{iss}#{sub}` for OPEA `user_id` field

**Story 2-2 (JWKS Force-Refresh):**
- Per-issuer JWKS cache with force-refresh
- `issuerMap` values are callable with `.forceRefresh()` method

**Epic 1 Retrospective Lessons:**
- `_resetForTesting()` is critical for test isolation
- `ensureInitialized()` has 30s cooldown — tests must use `_resetForTesting()`
- jose v6 error types: `JWTExpired`, `JWTClaimValidationFailed`, generic `Error`
- Use `var` for mock variable references in jest.mock (TDZ issue)

### Project Structure Notes

- Backend uses **CommonJS only** (`require`/`module.exports`) — no ES imports
- OPEA services are Python/FastAPI — completely separate ecosystem
- 2-space indentation, single quotes, mandatory semicolons (backend)
- Test files in `__tests__/` directory at service root
- Mock fixtures in `__tests__/mocks/`
- Logger imported from `../shared-lib`
- **This story may require changes in BOTH** backend (Node.js) AND OPEA (Python) if the fix goes beyond backend-only

### Worktree Assignment

This story will be implemented in the `epic2-backend` worktree (current worktree).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.10] — Story requirements and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision D4] — Multi-realm user_id for OPEA: `{iss}#{sub}`
- [Source: _bmad-output/planning-artifacts/architecture.md#Service Boundary] — OPEA never receives raw tokens
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping] — FR37-FR38 → keycloak-auth-middleware.js (downstream headers)
- [Source: _bmad-output/planning-artifacts/prd.md#FR37] — Backend communicates with OPEA using existing auth mechanism
- [Source: _bmad-output/planning-artifacts/prd.md#FR38] — Backend passes user identity via existing payload structure
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — buildUserHeaders() and authenticate()
- [Source: components/gov-chat-backend/routes/query-routes.js] — Query route passing headers and user ID
- [Source: components/gov-chat-backend/services/query-service.js] — OPEA payload construction and worker call
- [Source: components/gov-chat-backend/services/opea-worker.js] — Worker thread with header forwarding
- [Source: genie-ai-overlay/chatqna/genieai_chatqna.py:1230-1235] — OPEA user_id extraction and profile callback
- [Source: genie-ai-overlay/chatqna/genieai_chatqna.py:198] — OPEA callback URL construction (BREAKS with composite key)
- [Source: _bmad-output/implementation-artifacts/2-9-multi-realm-configuration-support.md] — Previous story (multi-realm)
- [Source: _bmad-output/project-context.md] — Backend conventions (CommonJS, testing rules)
- [Source: git:529daaa] — Original `/:userId/context` route implementation (Roman, 2026-02-01) — reference for re-creation
- [Source: git:a3f9549] — Commit that removed the endpoint as "unused dead code" (Story 1-11, 2026-04-03) — root cause of regression

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

- Task 1 (Verification): Confirmed backend-to-OPEA auth unchanged — worker never forwards Authorization, AUTH_SERVICE_USERNAME/PASSWORD not used between backend and OPEA, trust model already documented.
- Task 2 (Three stacked fixes): (1) Re-created `GET /:userId/context` endpoint with sanitized response (name, role, emailVerified). (2) Added targeted `isPublicRoute` pattern for `/users/*/context` — skips Keycloak auth, protected by X-Service-Token shared secret. (3) Changed `query-routes.js` to pass `req.user?._key` (URL-safe) instead of `req.user?.iss_sub` for OPEA payload user_id. Updated OPEA Python to use `X-Service-Token` header and `SERVICE_AUTH_TOKEN` env var. Removed dead `GET_AUTH_TOKEN_URL` from docker-compose and unused `timedelta` import.
- Task 3 (Verification): Confirmed zero Keycloak token leakage to OPEA — no realm_access, azp, or JWT iss references in OPEA code.
- Task 4 (Verification): Confirmed Kong independence — OPEA communicates only with backend, headers built from JWT claims not proxy headers.
- Task 5 (Tests): Added 18 new tests covering all ACs. All 123 tests pass (105 existing + 18 new). Zero regressions.

### Change Log

- 2026-04-03: Story 2-10 implementation complete — OPEA continuity with Keycloak-agnostic downstream auth

### File List

**Modified:**
- `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` — Added `/users/*/context` pattern to isPublicRoute()
- `components/gov-chat-backend/routes/query-routes.js` — Changed `iss_sub` → `_key` for OPEA payload user_id
- `components/gov-chat-backend/routes/user-routes.js` — Re-created `GET /:userId/context` endpoint with X-Service-Token auth; removed redundant auth check on `GET /:userId`
- `components/gov-chat-backend/jest.config.js` — Added `__tests__/mocks/` to testPathIgnorePatterns
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — Replaced dead http-service JWT with SERVICE_AUTH_TOKEN shared secret
- `docker-compose.yaml` — Replaced GET_AUTH_TOKEN_URL with SERVICE_AUTH_TOKEN in chatqna service; restored GET_AUTH_TOKEN_URL for dataprep (out of scope)
- `env` — Added SERVICE_AUTH_TOKEN env var
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Status: ready-for-dev → in-progress → review

**New:**
- `components/gov-chat-backend/__tests__/opea-continuity.test.js` — 16 tests for Story 2-10

### Code Review Fixes (2026-04-03)

- **H1**: Restored `GET_AUTH_TOKEN_URL` for `dataprep-arango-service` in docker-compose.yaml — was incorrectly removed (out of scope, dataprep still uses http-service JWT)
- **M1**: Changed `SERVICE_AUTH_TOKEN` comparison from `!==` to `crypto.timingSafeEqual()` for timing-safe comparison (defense-in-depth)
- **M1 addendum**: Added `Buffer.byteLength` length check before `timingSafeEqual` to prevent RangeError on mismatched lengths
- **M2**: Hardened `isPublicRoute` pattern — replaced `startsWith/endsWith` with segment count check (`segments.length === 3 && segments[0] === 'users' && segments[2] === 'context'`)
- **M3/M4**: Rewrote token validation and sanitization tests to exercise actual handler logic (timingSafeEqual usage verification, field-by-field sanitization check) instead of trivial `===` comparisons and local object construction

### Code Review Fixes — Round 2 (2026-04-03)

- **H1**: Changed SERVICE_AUTH_TOKEN not-configured response from `500 { error: 'Service authentication not configured' }` to `503 { error: 'Service temporarily unavailable' }` — prevents information disclosure about server config state
- **M1/M2**: Reverted jest.config.js testMatch from `**/*.test.js` to `*.test.js` (YAGNI — no nested test dirs exist) and restored leading `/` anchor in testPathIgnorePatterns
- **L1**: Fixed test count in Completion Notes — 123 total (105 existing + 18 new), not 121
- **L2**: Removed redundant `if (!req.headers.authorization)` check on `GET /:userId` — `keycloakAuthMiddleware.authenticate` already handles missing tokens with 401 response. Simplified to direct middleware application.
