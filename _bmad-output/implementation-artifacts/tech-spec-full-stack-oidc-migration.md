---
title: 'Full Stack OIDC Migration — Eliminate JWT_SECRET and SERVICE_AUTH_TOKEN'
slug: 'full-stack-oidc-migration'
created: '2026-04-15'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - Node.js 22 (document-repository, backend) — CommonJS only
  - Python 3.10 (ChatQnA, Dataprep) — aiohttp for HTTP
  - jose (Node.js JWKS validation) — already used in backend
  - python-jose[cryptography] (Python JWKS validation) — NEW for ChatQnA and Dataprep
  - Keycloak 26 (OIDC provider, service accounts via client_credentials grant)
  - Jest (test framework for document-repository)
files_to_modify:
  # Document Repository — OIDC migration
  - components/document-repository/src/middlewares/keycloak-auth-middleware.js (NEW)
  - components/document-repository/src/middlewares/authMiddleware.js (DELETE)
  - components/document-repository/src/services/securityService.js (MODIFY: remove verifyToken, getUserById, require jsonwebtoken)
  - components/document-repository/src/server.js (replace JWT_SECRET with KEYCLOAK_URL, KC_REALM)
  - components/document-repository/src/config/appConfig.js (replace security.jwtSecret with keycloak config)
  - components/document-repository/src/app.js (remove express.static('/uploads') — dead code + security hole)
  - components/document-repository/package.json (add jose, remove jsonwebtoken)
  # Backend — token propagation + cleanup
  - components/gov-chat-backend/services/query-service.js (forward Authorization header to worker)
  - components/gov-chat-backend/routes/query-routes.js (verify opeaHeaders includes authorization)
  - components/gov-chat-backend/services/opea-worker.js (forward Authorization header in axios call, update misleading comment)
  - components/gov-chat-backend/services/service-token-service.js (DELETE — X-Service-Token validation, no longer needed)
  - components/gov-chat-backend/routes/user-routes.js (remove X-Service-Token, secure context endpoint with Keycloak JWT)
  - components/gov-chat-backend/middleware/keycloak-auth-middleware.js (remove context endpoint public route bypass)
  # ChatQnA — JWKS validation + token propagation
  - genie-ai-overlay/chatqna/genieai_chatqna.py (replace SERVICE_AUTH_TOKEN with propagated token)
  - genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai (add python-jose[cryptography])
  # Dataprep — service account
  - genie-ai-overlay/dataprep/keycloak_service_account.py (NEW — token acquisition, cache, auto-renewal)
  - genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py (replace SERVICE_AUTH_TOKEN with service account token)
  - genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai (add python-jose[cryptography])
  # Keycloak realm config
  - configs/keycloak/genie-realm.yaml (new dataprep-service-client)
  - configs/keycloak/config-and-sleep.sh (add KC_DATAPREP_CLIENT_SECRET validation)
  # Infrastructure
  - docker-compose.yaml (remove SERVICE_AUTH_TOKEN/JWT_SECRET, add Keycloak vars)
  - env (remove SERVICE_AUTH_TOKEN, JWT_SECRET; add KC_DATAPREP_CLIENT_ID/SECRET)
  - deploy/ansible/deploy.yml (update vault vars)
  - deploy/ansible/templates/env.j2 (update template)
  # Tests
  - components/document-repository/src/__tests__/unit/middlewares/keycloak-auth-middleware.test.js (NEW — unit tests for OIDC middleware)
  - components/document-repository/src/__tests__/unit/services/securityService.test.js (remove JWT test cases)
  - components/gov-chat-backend/__tests__/opea-continuity.test.js (remove X-Service-Token tests, fix isPublicRoute)
  # Documentation
  - CLAUDE.md (remove JWT_SECRET from secrets list, update auth architecture)
  - README.md (remove JWT_SECRET from secrets examples)
  - components/README.md (remove JWT_SECRET from secrets references)
  - components/gov-chat-backend/README.md (replace X-Service-Token docs with OIDC token propagation)
  - components/gov-chat-backend/routes/README.md (replace X-Service-Token docs with OIDC)
  - components/document-repository/README.md (update auth section if present)
  - deploy/ansible/README.md (remove JWT_SECRET from vault verification list)
  - docs/docker-compose-setup.md (remove JWT_SECRET template)
  - docs/docker-swarm-setup.md (remove JWT_SECRET references)
  - GENIE.AI-Installation-Configuration-Guide.md (remove JWT_SECRET from installation steps)
  - docs/e2e-tests/README.md (update prerequisites, remove SERVICE_AUTH_TOKEN)
  - docs/e2e-tests/00-clean-start.md (remove JWT_SECRET and SERVICE_AUTH_TOKEN from env setup)
  - docs/e2e-tests/epic2-secure-api-access.md (rewrite Phase J tests: replace X-Service-Token with Keycloak JWT)
code_patterns:
  - 'Backend OIDC reference: keycloak-auth-middleware.js uses jose createRemoteJWKSet with TTL cache'
  - 'No graceful degradation: if Keycloak is unreachable and JWKS cache is cold, requests fail (503). If JWKS cache is warm, existing tokens validate until cache expires.'
  - 'Roles from token claims: claims.realm_access.roles — no DB roundtrip needed'
  - 'Public route bypass: isPublicRoute() checks against PUBLIC_PATHS array (backend also had OPEA context endpoint bypass — removed in Task 16)'
  - 'Per-route middleware: routeConfigs array with keycloakAuth boolean flag'
  - 'Error format: { error, message, details } with specific error codes (TOKEN_INVALID, TOKEN_EXPIRED)'
  - 'securityService.js dual responsibility: ClamAV scanning + JWT verification — remove JWT methods, keep file name'
  - 'fileService.js:235 imports securityService for scanBuffer() — no change needed (file name stays)'
  - 'fileRoutes.js:9 uses router.use(authenticateToken) — global auth on all routes'
test_patterns:
  - 'Jest config: jest.config.js with __tests__/unit/ pattern, 10s timeout, shared-lib mocked globally'
  - 'Existing tests: 7 unit test files (labelService, fileUpload, fileController, fileUtils, metadataService, securityService, mimeTypeValidator)'
  - 'securityService.test.js tests both ClamAV AND JWT — remove 4 JWT tests, keep file name'
  - 'No auth middleware tests exist — must create keycloak-auth-middleware.test.js'
  - 'Backend test reference: keycloak-auth-middleware.test.js with isPublicRoute, token verification, role extraction tests'
  - 'Backend role pattern: req.user.roles (array) with .includes("admin") — different from doc-repo authorizeRole which uses scalar req.user.role'
  - 'Context endpoint: /api/users/:userId/context was public (bypassed Keycloak JWT) + X-Service-Token — both mechanisms removed in this migration'
---

# Tech-Spec: Full Stack OIDC Migration — Eliminate JWT_SECRET and SERVICE_AUTH_TOKEN

**Created:** 2026-04-15

## Overview

### Problem Statement

The GENIE.AI stack currently uses **three different authentication mechanisms**:

1. **Keycloak OIDC (jose + JWKS)** — Backend and Frontend (already migrated)
2. **JWT_SECRET (HS256 local)** — Document Repository (dead code, JWT_SECRET removed from infrastructure)
3. **SERVICE_AUTH_TOKEN (shared secret)** — OPEA services (Dataprep, ChatQnA) for service-to-service calls

This creates security and maintenance issues:
- Document Repository cannot authenticate users (JWT_SECRET no longer exists in the infrastructure)
- SERVICE_AUTH_TOKEN is a "network isolation" pattern that becomes obsolete with Kubernetes + service mesh (Istio mTLS)
- Three auth systems = three attack surfaces, three failure modes
- Routes without authentication in document-repository (security vulnerability)

### Solution

**Unify all authentication on OIDC/JWKS.** Every service in the stack validates tokens via Keycloak JWKS:

```
User → Kong/Ingress → Backend → ChatQnA → Document Repository
       JWT Bearer      JWT       JWT        JWT (validated JWKS)

Dataprep → Document Repository
  JWT Bearer (service account via client_credentials grant)
```

- Document Repository: Replace JWT_SECRET with Keycloak OIDC (jose + JWKS)
- Backend: Propagate user's Bearer token to ChatQnA via Authorization header
- ChatQnA: Replace SERVICE_AUTH_TOKEN with JWKS validation (python-jose)
- Dataprep: Replace SERVICE_AUTH_TOKEN with Keycloak service account (client_credentials grant + auto-renewal)
- Remove all SERVICE_AUTH_TOKEN references from the stack
- Remove all JWT_SECRET references from document-repository

### Scope

**In Scope:**
- Document Repository OIDC migration (middleware, routes, config)
- Backend token propagation to ChatQnA (Authorization header forwarding)
- Backend context endpoint security (remove X-Service-Token, protect with Keycloak JWT)
- Backend service-token-service.js deletion and test updates
- ChatQnA JWKS validation (python-jose, replace X-Service-Token, validate propagated token)
- Dataprep Keycloak service account (client_credentials, token lifecycle)
- Keycloak realm config (new service account client)
- Docker Compose environment variables update
- env template update
- Ansible deployment update (vault vars, env.j2)
- E2E test updates
- Fix routes without authentication in document-repository

**Out of Scope:**
- Kubernetes migration itself
- Istio/service mesh configuration
- Database schema changes
- API route refactoring
- Frontend changes (already migrated)
- Mobile app changes

## Context for Development

### Codebase Patterns

**Existing Keycloak OIDC pattern (backend — reference implementation):**
- `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` — JWKS validation with jose (note: `middleware/` singular, not `middlewares/`)
- Uses `createRemoteJWKSet()` with local cache (TTL-based)
- Reads `iss`, `sub`, `realm_access.roles` from token claims
- Per-route middleware application (never global)

**Current OPEA auth pattern:**
- `X-Service-Token: <SERVICE_AUTH_TOKEN>` header for all service-to-service calls
- `_service_headers()` method returns `{"X-Service-Token": self._service_token}`
- Used by both Dataprep and ChatQnA

**Current Document Repository auth pattern:**
- `authenticateToken` middleware expects `Authorization: Bearer <JWT>`
- Validates via `securityService.verifyToken()` using `jwt.verify(token, JWT_SECRET)`
- Fetches user from ArangoDB to get role (DB roundtrip for every request)
- `authorizeRole(['Admin'])` checks `req.user.role`

**Key improvement:** With OIDC, roles come from `realm_access.roles` in the token claim — no DB roundtrip needed for auth.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Reference OIDC middleware pattern (note: `middleware/` singular) |
| `components/gov-chat-backend/services/keycloak-auth-service.js` | JWKS cache implementation |
| `components/document-repository/src/middlewares/authMiddleware.js` | Current auth middleware (to delete) |
| `components/document-repository/src/services/securityService.js` | Current JWT verification (remove JWT methods) |
| `components/document-repository/src/routes/fileRoutes.js` | Route definitions with global auth |
| `components/document-repository/src/routes/labelRoutes.js` | Label routes with auth |
| `components/document-repository/src/server.js` | Required env vars (JWT_SECRET) |
| `components/document-repository/src/config/appConfig.js` | Config with JWT_SECRET |
| `components/document-repository/src/app.js` | Route registration (app-level) |
| `components/gov-chat-backend/services/query-service.js` | Backend → ChatQnA call (token propagation) |
| `components/gov-chat-backend/services/opea-worker.js` | OPEA worker (currently no auth forwarding) |
| `components/gov-chat-backend/services/service-token-service.js` | X-Service-Token validation (to delete) |
| `components/gov-chat-backend/routes/user-routes.js` | OPEA endpoint with X-Service-Token docs |
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | ChatQnA main (SERVICE_AUTH_TOKEN usage) |
| `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` | Dataprep main (SERVICE_AUTH_TOKEN usage) |
| `configs/keycloak/genie-realm.yaml` | Keycloak realm config |
| `api-gateway-solution/new-config/kong_config.json` | Kong routing (document-repository routes) |
| `docker-compose.yaml` | Service environment variables |
| `env` | Environment template |
| `docs/e2e-tests/epic2-secure-api-access.md` | E2E Phase J tests (SERVICE_AUTH_TOKEN usage) |
| `docs/e2e-tests/00-clean-start.md` | E2E Phase 0 setup (JWT_SECRET, SERVICE_AUTH_TOKEN) |

### Technical Decisions

1. **Single auth model (OIDC/JWKS)** — Eliminates JWT_SECRET and SERVICE_AUTH_TOKEN entirely
2. **Token propagation** — Backend forwards user's Bearer token to ChatQnA via HTTP Authorization header (standard microservices pattern)
3. **Service account for Dataprep** — Keycloak `client_credentials` grant with auto-renewal
4. **No `/internal/*` routes** — All routes use the same auth mechanism; no Kong-level filtering needed
5. **Roles from token claims** — Read `realm_access.roles` from JWT instead of DB lookup (faster, no DB dependency for auth)
6. **SERVICE_AUTH_TOKEN completely removed** — No shared secrets in the stack
7. **Keep `securityService.js` file name** — Remove only JWT methods (`verifyToken`, `getUserById`), keep ClamAV code. No rename needed since `fileService.js` import path stays valid.
8. **No graceful degradation** — If Keycloak is unreachable and JWKS cache is cold, authentication fails. No retry, no fallback. OIDC tokens are validated locally via cached JWKS keys; Keycloak is only needed for login and key rotation.
9. **Defense in depth** — Each service validates tokens independently via JWKS. ChatQnA validates even though backend already validated — this prevents tokens from being blindly forwarded if ChatQnA receives requests from non-backend sources (Docker internal network, monitoring, etc.).

## Implementation Plan

### Tasks

#### Phase 1: Foundation — Keycloak Service Account Client

- [ ] Task 1: Add `dataprep-service-client` to Keycloak realm config
  - File: `configs/keycloak/genie-realm.yaml`
  - Action: Add new client entry under `clients:` section:
    ```yaml
    - clientId: dataprep-service-client
      enabled: true
      publicClient: false
      standardFlowEnabled: false
      directAccessGrantsEnabled: false
      implicitFlowEnabled: false
      serviceAccountsEnabled: true
      secret: $(env:KC_DATAPREP_CLIENT_SECRET)
    ```
  - Notes: Uses `$(env:KC_DATAPREP_CLIENT_SECRET)` for variable substitution. Dataprep uses this client to obtain service account tokens via `client_credentials` grant. Also add `KC_DATAPREP_CLIENT_SECRET` validation to `configs/keycloak/config-and-sleep.sh` — if this env var is missing, keycloak-config-cli will create a client with an empty secret, causing runtime authentication errors in Dataprep.

- [ ] Task 2: Add `dataprep-service` realm role for service account authorization
  - File: `configs/keycloak/genie-realm.yaml`
  - Action: Add role to the existing `roles.realm` section:
    ```yaml
    - name: dataprep-service
      description: Service account role for Dataprep ingestion pipeline
    ```
  - Notes: This role will be assigned to the dataprep-service-client service account via the `users` section, allowing document-repository to identify service-to-service calls by role.

- [ ] Task 3: Assign realm role to dataprep service account user
  - File: `configs/keycloak/genie-realm.yaml`
  - Action: Add service account user entry under `users:` section:
    ```yaml
    - username: service-account-dataprep-service-client
      enabled: true
      serviceAccountClientId: dataprep-service-client
      realmRoles:
        - dataprep-service
    ```
  - Notes: Follows the existing pattern used for `service-account-genie-proxy-client`.

#### Phase 2: Document Repository OIDC Migration

- [ ] Task 4: Create Keycloak OIDC auth middleware for document-repository
  - File: `components/document-repository/src/middlewares/keycloak-auth-middleware.js` (NEW)
  - Action: Create new middleware adapted from `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`:
    - Use `jose` library for JWKS validation (`jwtVerify`, `createRemoteJWKSet`)
    - JWKS cache with TTL (5 minutes) via `createRemoteJWKSet` — no explicit retry or fallback
    - Extract user info from token claims: `sub` (userId), `realm_access.roles` (roles), `iss` (issuer)
    - Public routes bypass: `/health`, `/api-docs`, `/api`, `/api-docs.json` — matches all unauthenticated routes in `app.js` (lines 112, 123, 31, 36). **No bypass for `/uploads/*`** — the `express.static('/uploads')` route at `app.js:148` must NOT be in the bypass list. This route currently serves uploaded files without authentication — a security vulnerability. File viewing is handled by the authenticated API route `/api/files/:id/viewbrowser`. The `express.static('/uploads')` route is effectively dead code behind NGINX/Kong (NGINX serves `/Uploads/` from local filesystem, not via document-repository), but it remains reachable via direct container access (Docker internal network). **Action**: Remove the `express.static('/uploads')` route from `app.js` entirely (lines 148-158) — it's redundant and a security hole.
    - **Critical: role mapping** — `realm_access.roles` is an array (e.g., `["admin", "user"]`). The existing `authorizeRole()` expects `req.user.role` as a **scalar string** (case-insensitive comparison at `authMiddleware.js:97`). The new middleware MUST map the array to a scalar using this deterministic algorithm:
      1. If `"admin"` is in the array → `role = "Admin"` (capitalized, matching existing convention)
      2. Else if `"dataprep-service"` is in the array → `role = "dataprep-service"` (for service account identification)
      3. Else if array is non-empty → `role = array[0]` (first role, capitalized first letter)
      4. Else → `role = "User"` (safe default)
      This ensures backward compatibility with all existing `authorizeRole(['Admin'])` calls in `fileRoutes.js` and `labelRoutes.js`.
    - **Critical: service account role support** — `authorizeRole` must also accept `dataprep-service` as an allowed role. Dataprep's service account token will have `dataprep-service` in `realm_access.roles`. The `PATCH /:fileId/status` route (used by Dataprep) currently has `authorizeRole(['Admin'])` — this must be updated to `authorizeRole(['Admin', 'dataprep-service'])` so Dataprep can update file status without Admin privileges.
    - Attach to `req.user` as `{ userId: claims.sub, role: <mapped scalar>, iss: claims.iss, sub: claims.sub, roles: claims.realm_access.roles }` — include both `role` (scalar, for backward compat) and `roles` (array, for future use)
    - Structured error responses: `{ error, message, details }`
    - No DB roundtrip for roles — read from token claims directly
    - **No graceful degradation**: if JWKS fetch fails and cache is cold → request fails (503)
  - Notes: This REPLACES `authMiddleware.js`. Export same function names (`authenticateToken`, `authorizeRole`) so `fileRoutes.js` and `labelRoutes.js` imports work without change. Add comment `// Adapted from gov-chat-backend/middleware/keycloak-auth-middleware.js` to trace origin.

- [ ] Task 5: Remove dead JWT code from securityService.js
  - File: `components/document-repository/src/services/securityService.js`
  - Action:
    - Remove `const jwt = require('jsonwebtoken');` (line 1)
    - Remove `verifyToken(token)` method (lines 115-128)
    - Remove `getUserById(userId)` method (lines 130-148)
    - Keep all ClamAV-related code (constructor, initialize, scanBuffer, etc.)
  - Notes: File name stays `securityService.js`. No import changes needed in `fileService.js`.

- [ ] Task 6: Replace auth middleware import in fileRoutes.js
  - File: `components/document-repository/src/routes/fileRoutes.js`
  - Action: Change import from:
    ```javascript
    const { authenticateToken, authorizeRole } = require('../middlewares/authMiddleware');
    ```
    to:
    ```javascript
    const { authenticateToken, authorizeRole } = require('../middlewares/keycloak-auth-middleware');
    ```
  - Notes: The exported function names are the same, so all route-level usage of `authorizeRole(['Admin'])` works unchanged.

- [ ] Task 7: Replace auth middleware import in labelRoutes.js
  - File: `components/document-repository/src/routes/labelRoutes.js`
  - Action: Same import change as Task 6.

- [ ] Task 8: Remove JWT_SECRET from server.js required env vars
  - File: `components/document-repository/src/server.js`
  - Action:
    - Remove `'JWT_SECRET'` from `requiredEnvVars` array (line 13)
    - Remove `'JWT_SECRET'` from `requiredSecrets` array (line 23)
  - Notes: Keycloak OIDC doesn't need a local secret. JWKS uses public key validation.

- [ ] Task 9: Replace JWT config with Keycloak config in appConfig.js
  - File: `components/document-repository/src/config/appConfig.js`
  - Action: Replace `security.jwtSecret` section with:
    ```javascript
    security: {
      keycloakUrl: process.env.KEYCLOAK_URL,
      keycloakRealm: process.env.KC_REALM,
      keycloakClientId: process.env.KC_CLIENT_ID,
    },
    ```
  - Notes: Remove `jwtExpiration` and `bcryptRounds` (no longer used). Keep `rateLimit` section. Also remove `'jwtsecret'` from `sensitiveKeys` array in `getFormattedConfiguration()` (line 120) — no longer applicable.

- [ ] Task 10: Update package.json dependencies
  - File: `components/document-repository/package.json`
  - Action:
    - Add `"jose": "^5.0.0"` to `dependencies`
    - Remove `"jsonwebtoken": "^9.0.2"` from `dependencies`
  - Notes: `jose` is the same library used by the backend.

- [ ] Task 11: Remove old authMiddleware.js
  - File: `components/document-repository/src/middlewares/authMiddleware.js` (DELETE)
  - Action: Delete file after verifying all imports have been updated.
  - Notes: Only safe after Tasks 6 and 7 are complete. Must be done before Tasks 12-13 (tests reference the old middleware pattern).

- [ ] Task 12: Create keycloak-auth-middleware unit tests
  - File: `components/document-repository/src/__tests__/unit/middlewares/keycloak-auth-middleware.test.js` (NEW)
  - Action: Create comprehensive unit tests covering:
    - Valid token → user object attached with correct userId and role from `realm_access.roles`
    - Expired token → 401 with TOKEN_EXPIRED error code
    - Invalid/malformed token → 401 with TOKEN_INVALID error code
    - Missing Authorization header → 401
    - Public routes (`/health`, `/api-docs`, `/api`, `/api-docs.json`) → bypass authentication (no error, next() called)
    - Role extraction from `realm_access.roles` claim → correct role mapping
    - Admin role check via `authorizeRole(['Admin'])` → 403 for non-admin users, 200 for admin
    - JWKS fetch failure (Keycloak unreachable) → 503 when cache is cold
  - Notes: Follow existing test patterns in `jest.config.js` (10s timeout, shared-lib mocked globally). Mock `jose` library for deterministic testing.

- [ ] Task 13: Update securityService.test.js — remove JWT tests
  - File: `components/document-repository/src/__tests__/unit/services/securityService.test.js`
  - Action: Remove the 4 test cases that test JWT functionality (verifyToken with valid/invalid token). Remove the `require('jsonwebtoken')` mock from test setup. Keep all ClamAV test cases (initialize, scanBuffer, etc.).
  - Notes: Direct deletion — no `.skip()`. Dead code is always removed.

#### Phase 3: Backend Token Propagation + Cleanup

- [ ] Task 14: Forward Authorization header to ChatQnA via HTTP headers
  - File: `components/gov-chat-backend/services/query-service.js`
  - Action: In `createQuery()` method, pass the Authorization header to the OPEA worker:
    ```javascript
    const authHeaders = headers ? { authorization: headers.authorization } : {};
    const workerResult = await this.runOPEAWorker(opeaUrl, opeaPayload, authHeaders);
    ```
  - File: `components/gov-chat-backend/routes/query-routes.js`
    - Line 188: Currently passes `req.user?.opeaHeaders` which does NOT contain `authorization` (it only has `X-User-Id`, `X-User-Roles`, `X-Issuer` from `buildUserHeaders()`). Must also pass `req.headers.authorization`:
    ```javascript
    const query = await queryService.createQuery(
      req.body,
      { ...req.user?.opeaHeaders, authorization: req.headers.authorization },
      req.user?._key
    );
    ```
  - Notes: `opeaHeaders` is built by `buildUserHeaders()` in `keycloak-auth-middleware.js:69-76` and does NOT include the raw Authorization header. The fix explicitly merges `req.headers.authorization` into the headers object at the call site. The worker thread's `axiosInstance.post(url, payload, { headers })` sends this as a standard HTTP Authorization header — ChatQnA's FastAPI reads it via `request.headers.get("Authorization")`.

- [ ] Task 15: Verify OPEA worker forwards Authorization header via HTTP
  - File: `components/gov-chat-backend/services/opea-worker.js`
  - Action:
    - The Authorization header is already forwarded via `...(headers || {})` spread (line 33-36). Verify this works by checking that `headers.authorization` is passed correctly. No code change expected — the existing spread operator already forwards all headers as HTTP headers to ChatQnA.
    - **Update misleading comment** (lines 6-14): The comment block states "Authorization header is NEVER forwarded to OPEA (worker cannot access req.headers)". This is now INCORRECT — after Task 14, the Authorization header IS passed to the worker via the `headers` parameter (constructed in `query-routes.js`). Update the comment to reflect the new behavior:
      ```
      // Service-to-Service Authentication:
      // - User identity is passed via X-User-Id, X-User-Roles, X-Issuer headers (injected by middleware)
      // - User's Bearer token (Authorization header) is forwarded for defense-in-depth JWKS validation
      //   by downstream services (ChatQnA, document-repository)
      ```
  - Notes: The worker does `const requestHeaders = { 'Content-Type': 'application/json', ...(headers || {}) };` — if `headers.authorization` is set in Task 14, it will be forwarded as a standard HTTP Authorization header to ChatQnA. ChatQnA reads it via `request.headers.get("Authorization")`.

- [ ] Task 16: Secure context endpoint and delete service-token-service.js
  - File: `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`
    - Remove the OPEA context endpoint bypass from `isPublicRoute()` (lines 35-42: the segment-matching logic for `/users/:userId/context`). This endpoint must NO LONGER be public — it will be protected by Keycloak JWT like all other routes.
  - File: `components/gov-chat-backend/routes/user-routes.js`
    - In `GET /:userId/context` handler: remove `serviceTokenService.validateServiceToken(req.headers['x-service-token'])` check
    - Remove `const serviceTokenService = require('../services/service-token-service')` import
    - Remove X-Service-Token references in endpoint comments/docs (lines 171, 184)
    - The handler continues to return sanitized user context (`name`, `role`, `emailVerified`) — only the auth mechanism changes from X-Service-Token to Keycloak JWT (handled by middleware automatically)
  - File: `components/gov-chat-backend/services/service-token-service.js` (DELETE)
    - Action: Delete file entirely after verifying no other file imports it.
  - Notes: After this change, ChatQnA must send the user's Bearer token (instead of X-Service-Token) when calling `GET /api/users/:userId/context`. The Keycloak middleware validates the token before the route handler executes.
  - **Sub-task: preserve `buildUserContext()`** — The function `service-token-service.js:45-51` (6 lines, returns `{name, role, emailVerified}`) is used in `user-routes.js:204` and tested in `opea-continuity.test.js:320-356`. Inline it in the route handler (it's trivial) and update the test to import from `user-routes.js` instead of `service-token-service.js`.

- [ ] Task 17: Update backend opea-continuity.test.js
  - File: `components/gov-chat-backend/__tests__/opea-continuity.test.js`
  - Action:
    - Remove `const serviceTokenService = require('../services/service-token-service')` import (line 41)
    - Remove lazy `require('../services/service-token-service')` in test blocks (lines 277, 321)
    - Remove or rewrite the "X-Service-Token validation — real service" describe block (lines 276-310) — 4 test cases that validate X-Service-Token behavior
    - Update `isPublicRoute` tests (line 258): `/users/:userId/context` is NO LONGER a public route — update expectations to `toBe(false)`
    - **Rewrite `buildUserContext` test** (lines 320-356): These tests import `service-token-service.js` directly and test the `buildUserContext()` function. After Task 16 deletes `service-token-service.js`, these tests will crash on import. The function is inlined in `user-routes.js` — rewrite these tests as integration tests using `supertest` that call `GET /api/users/:userId/context` with a valid Keycloak JWT and verify the response contains `{name, role, emailVerified}`. This validates the same behavior but through the HTTP layer where the function now lives.
  - Notes: These tests validate the old X-Service-Token auth pattern. After migration, the context endpoint is protected by Keycloak JWT like all other routes. The `buildUserContext` tests must be rewritten — they cannot simply be deleted because the utility function still exists (inlined in the route handler) and should be tested.

#### Phase 4: ChatQnA JWKS Validation

- [ ] Task 18: Replace SERVICE_AUTH_TOKEN with propagated token + JWKS validation in ChatQnA
  - File: `genie-ai-overlay/chatqna/genieai_chatqna.py`
  - Action:
    - **Add JWKS validation helper**: Create a function/class that validates JWT tokens using `python-jose[cryptography]` with `jwk_client` and JWKS caching (TTL-based). Reuse same pattern as Dataprep's service account module (Task 20) but for user token validation.
    - **`handle_request()` (line 1176)**: Extract `Authorization` header from the incoming FastAPI `Request` object: `authorization = request.headers.get("Authorization")`. Validate the token via JWKS. Pass the validated token to both `GenieUserProfileClient` and through the call chain to `fetch_file_metadata()`.
    - **Token threading**: `handle_request()` (line 1176) does NOT call `fetch_file_metadata()` (line 771) directly. The call chain is: `handle_request()` → retrieval logic (line ~1462, inside the retrieval result processing loop) → `self.fetch_file_metadata(file_id)`. The token must be available to `fetch_file_metadata()` when it constructs the Authorization header for the document-repository call. Options: (a) store the validated token as `self._current_token` on the handler instance, or (b) pass it as a parameter through the retrieval logic. Option (a) is simpler since `fetch_file_metadata()` is an instance method and can access `self._current_token`.
    - **`fetch_file_metadata()` (line 784)**: Replace `service_token = self.user_profile_client._service_token` (private attribute access) with the validated token. Replace `headers = {"X-Service-Token": service_token}` with `headers = {"Authorization": f"Bearer {token}"}`.
    - **`get_user_profile()` (lines 154-198)**: Replace `headers = {"X-Service-Token": self._service_token}` with `headers = {"Authorization": f"Bearer {self._token}"}` using the token passed to the client.
    - Remove `SERVICE_AUTH_TOKEN` env var usage entirely.
  - Notes: ChatQnA receives requests from the backend via `axios.post(url, payload, { headers })`. The Authorization header is a standard HTTP header — FastAPI reads it via `request.headers.get("Authorization")`. ChatQnA validates the token via JWKS before forwarding it to document-repository and backend (defense in depth).

- [ ] Task 19: Add python-jose to ChatQnA Dockerfile
  - File: `genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai`
  - Action: Add `pip install python-jose[cryptography]` to the build steps.
  - Notes: Must be installed before the final image layer.

#### Phase 5: Dataprep Service Account

- [ ] Task 20: Create Keycloak service account module for Dataprep
  - File: `genie-ai-overlay/dataprep/keycloak_service_account.py` (NEW)
  - Action: Create module with:
    - `get_service_account_token()`: POST to Keycloak token endpoint with `grant_type=client_credentials`
    - Token cache with TTL (buffer 60s before expiry)
    - Auto-renewal when token is near expiry
    - Error handling: retry with exponential backoff, graceful degradation
    - Uses env vars: `KEYCLOAK_URL`, `KC_REALM`, `KC_DATAPREP_CLIENT_ID`, `KC_DATAPREP_CLIENT_SECRET`
  - Notes: ~80-100 lines. The token endpoint is `{KEYCLOAK_URL}/realms/{KC_REALM}/protocol/openid-connect/token`. Response: `{ "access_token": "...", "expires_in": 300 }`.

- [ ] Task 21: Replace SERVICE_AUTH_TOKEN with service account token in Dataprep
  - File: `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`
  - Action:
    - Import `keycloak_service_account` module
    - In `__init__`: initialize service account client
    - Replace `_service_headers()` to return `{"Authorization": f"Bearer {token}", "Content-Type": "application/json"}` using cached service account token
    - **Replace inline X-Service-Token in `_fetch_all_labels()` (line 200)**: Change `headers = {"X-Service-Token": self._service_token}` to `headers = self._service_headers()` — use the shared method instead of inline header construction
    - **Update guard in `_fetch_all_labels()` (line 194)**: Change `if not self._service_token:` to `if not self._service_account_token:` (or equivalent check using the service account module) — the old `self._service_token` attribute is removed, so the guard must reference the new service account token
    - Remove `SERVICE_AUTH_TOKEN` env var usage (`SERVICE_AUTH_TOKEN = os.getenv("SERVICE_AUTH_TOKEN", "")` at line 51)
    - Remove `self._service_token = SERVICE_AUTH_TOKEN` assignment (line 99)
  - Notes: `_service_headers()` is called by `_update_doc_status()` and `_write_ingestion_log()`. `_fetch_all_labels()` has its own inline headers — must be updated to use `_service_headers()` too. **Important**: `_fetch_all_labels()` calls the **Backend** (`BACKEND_SERVICE_URL/api/service-categories/categories`), not document-repository. Verify that the Backend's `service-category-routes.js` only uses `authenticate` (no `authorizeRole` check) — if it does, any valid Keycloak token (including Dataprep service account) will pass. If it uses `authorizeRole`, the `dataprep-service` role must be added to the allowed roles list. The service account module handles token caching and auto-renewal transparently.

- [ ] Task 22: Add python-jose to Dataprep Dockerfile
  - File: `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai`
  - Action: Add `pip install python-jose[cryptography]` to the build steps.
  - Notes: Must be installed before the final image layer.

#### Phase 6: Infrastructure Updates

- [ ] Task 23: Update docker-compose.yaml environment variables
  - File: `docker-compose.yaml`
  - Action:
    - **document-repository service**: Add `KEYCLOAK_URL`, `KC_REALM`, `KC_CLIENT_ID`. Add `depends_on: keycloak-config: condition: service_healthy` (currently only depends on `arango-vector-db` — document-repository needs Keycloak configured before it can validate tokens).
    - **backend service**: Remove `SERVICE_AUTH_TOKEN` (line 399: `SERVICE_AUTH_TOKEN=${SERVICE_AUTH_TOKEN}`). Backend does not use SERVICE_AUTH_TOKEN directly — it propagates the user's Bearer token (Task 14).
    - **chatqna-xeon-backend-server service**: Remove `SERVICE_AUTH_TOKEN` (line 980)
    - **dataprep-arango-service service**: Remove `SERVICE_AUTH_TOKEN` (line 848), add `KC_DATAPREP_CLIENT_ID`, `KC_DATAPREP_CLIENT_SECRET`
    - **keycloak-config service**: Add `KC_DATAPREP_CLIENT_SECRET=${KEYCLOAK_PROXY_CLIENT_SECRET}` — this env var is required by `config-and-sleep.sh` (Task 1 validation) and by `genie-realm.yaml` variable substitution for the `dataprep-service-client` secret. Currently only has `KC_PROXY_CLIENT_SECRET` (line 1151).
    - Add `depends_on: keycloak: condition: service_healthy` to dataprep service (consistent with all other services that depend on Keycloak). Note: `depends_on` only affects initial startup order — if Keycloak dies after startup, no dependent service is restarted.
  - Notes: JWT_SECRET has already been removed from `docker-compose.yaml` and `env` template in a prior migration. Only SERVICE_AUTH_TOKEN needs removal here. The backend already has Keycloak vars. Search entire docker-compose.yaml for any remaining `SERVICE_AUTH_TOKEN` references to ensure complete removal.

- [ ] Task 24: Update env template
  - File: `env`
  - Action:
    - Remove `SERVICE_AUTH_TOKEN` entry and all references
    - JWT_SECRET has already been removed — verify no stale references remain
    - Add `KC_DATAPREP_CLIENT_ID` with placeholder
    - Add `KC_DATAPREP_CLIENT_SECRET` with placeholder
  - Notes: Search entire file for any remaining SERVICE_AUTH_TOKEN references in comments or conditional blocks.

- [ ] Task 25: Update Ansible deployment
  - File: `deploy/ansible/templates/env.j2`
  - Action: Remove SERVICE_AUTH_TOKEN and JWT_SECRET template entries. Add KC_DATAPREP_CLIENT_ID/SECRET entries.
  - File: `deploy/ansible/deploy.yml`
  - Action: Update required secrets validation (remove SERVICE_AUTH_TOKEN/JWT_SECRET, add KC_DATAPREP_CLIENT_SECRET).

- [ ] Task 26: Update documentation — remove JWT_SECRET and SERVICE_AUTH_TOKEN references
  - File: `CLAUDE.md`
    - Line 64: Remove JWT_SECRET from secrets example (`"ARANGO_PASSWORD, JWT_SECRET, etc."`)
    - Line 204: Remove `JWT_SECRET - JWT token signing secret` from environment variables table
  - File: `README.md`
    - Line 139: Remove JWT_SECRET from secrets example
  - File: `components/README.md`
    - Line 38: Remove JWT_SECRET from secrets list
    - Line 49: Remove JWT_SECRET from cp env instructions
  - File: `components/gov-chat-backend/README.md`
    - Lines 951-975: Replace X-Service-Token documentation with OIDC token propagation pattern
  - File: `components/gov-chat-backend/routes/README.md`
    - Lines 151, 470: Replace X-Service-Token references with OIDC Authorization header
  - File: `deploy/ansible/README.md`
    - Line 462: Remove JWT_SECRET from vault verification list
  - File: `docs/docker-compose-setup.md`
    - Line 53: Remove `JWT_SECRET=<strong-random-string>` template
  - File: `docs/docker-swarm-setup.md`
    - Lines 295, 596: Remove JWT_SECRET references
  - File: `GENIE.AI-Installation-Configuration-Guide.md`
    - Lines 814, 827, 840: Remove JWT_SECRET from installation steps
  - Action: For each file, remove JWT_SECRET and SERVICE_AUTH_TOKEN references. Update auth architecture descriptions to reflect OIDC-only model. Do NOT add new documentation — only remove/update existing references.
  - Notes: Line numbers are approximate (may shift after prior edits). Verify each file before editing.

- [ ] Task 27: Update E2E tests — environment setup and Phase J
  - File: `docs/e2e-tests/00-clean-start.md`
    - Line 29: Remove `JWT_SECRET=any-random-string` from env setup
    - Line 48: Remove `SERVICE_AUTH_TOKEN=any-random-string` from env setup
    - Add `KC_DATAPREP_CLIENT_ID` and `KC_DATAPREP_CLIENT_SECRET` placeholder values
  - File: `docs/e2e-tests/README.md`
    - Line 22: Remove `Phase J requires SERVICE_AUTH_TOKEN in .env`
    - Line 49: Remove `SERVICE_AUTH_TOKEN | Service-to-service shared secret | .env` from prerequisites table
    - Add `KC_DATAPREP_CLIENT_ID` and `KC_DATAPREP_CLIENT_SECRET` to prerequisites table
  - File: `docs/e2e-tests/epic2-secure-api-access.md`
    - Line 15: Remove `SERVICE_AUTH_TOKEN set in .env` from prerequisites
    - Line 28: Remove `SERVICE_AUTH_TOKEN` from prerequisites table
    - Lines 990, 1005, 1056: Replace `-H "X-Service-Token: $SERVICE_AUTH_TOKEN"` with `-H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN"` and update test descriptions
    - Line 990: Update note about 503 without SERVICE_AUTH_TOKEN → now tests service account token validation
    - Rewrite Phase J test steps to obtain service account token via Keycloak `client_credentials` grant before making API calls
  - Action: Remove all SERVICE_AUTH_TOKEN and JWT_SECRET references from E2E test docs. Phase J tests must use Keycloak service account token instead of X-Service-Token.
  - Notes: Line numbers are approximate. Phase J tests validate that service-to-service calls (ChatQnA/Dataprep → document-repository) work with OIDC tokens.

### Acceptance Criteria

- [ ] AC 1: Given a user with a valid Keycloak token, when they call any document-repository endpoint via Kong, then the request succeeds with 200 and the user's identity is correctly extracted from the token claims (userId, role).
- [ ] AC 2: Given a user with an expired Keycloak token, when they call a document-repository endpoint, then the request fails with 401 and error code TOKEN_EXPIRED.
- [ ] AC 3: Given a user without the Admin role, when they call `POST /api/files/upload`, then the request fails with 403 and error message "Access denied".
- [ ] AC 4: Given the Dataprep service, when it starts up and Keycloak is healthy, then it obtains a service account token successfully and can call document-repository endpoints.
- [ ] AC 5: Given Dataprep calls `PATCH /api/files/{fileId}/status` with a service account token containing `dataprep-service` role, when document-repository validates the token via JWKS and `authorizeRole(['Admin', 'dataprep-service'])` checks, then the request succeeds (status 200).
- [ ] AC 6: Given ChatQnA receives a chat request from the backend, when it calls `GET /api/files/{fileId}` with the propagated user token, then document-repository validates and returns file metadata.
- [ ] AC 7: Given Keycloak is unreachable and the JWKS cache is cold, when document-repository receives a request with an Authorization header, then the request fails with 503. No user data is returned.
- [ ] AC 8: Given no SERVICE_AUTH_TOKEN in any `.env` or docker-compose file, when the stack is deployed, then no service fails to start due to missing SERVICE_AUTH_TOKEN.
- [ ] AC 9: Given no JWT_SECRET in document-repository's environment, when the service starts, then it does not throw a missing environment variable error.
- [ ] AC 10: Given the `npm test` command in document-repository, when all tests run, then existing ClamAV tests pass and new keycloak-auth-middleware tests pass.
- [ ] AC 11: Given a request without any Authorization header to document-repository, when the middleware processes it, then the request is rejected with 401.

## Additional Context

### Dependencies

- `jose` ^5.0.0 — Already used in backend, needs to be added to document-repository `package.json`
- `python-jose[cryptography]` — Needs to be added to ChatQnA and Dataprep Dockerfiles
- Keycloak 26 — Already deployed, `serviceAccountsEnabled: true` already configured on existing clients
- Kong API Gateway — Routes `/api/files/*` and `/api/labels/*` to document-repository (no changes needed)

### Testing Strategy

**Unit Tests (document-repository):**
- Create `keycloak-auth-middleware.test.js` (Task 12) covering:
  - Valid token → user object attached with correct userId and role (array→scalar mapping)
  - Expired token → 401 with TOKEN_EXPIRED
  - Invalid token → 401 with TOKEN_INVALID
  - Missing Authorization header → 401
  - Public routes (/health, /api-docs, /api, /api-docs.json) → bypass authentication
  - Role extraction from `realm_access.roles` claim → correct scalar mapping
  - Admin role check via `authorizeRole(['Admin'])` → 403 for non-admin, 200 for admin
  - Service account role check via `authorizeRole(['Admin', 'dataprep-service'])` → 200 for dataprep-service
  - JWKS fetch failure → 503 when cache is cold
- Update `securityService.test.js` (Task 13): Remove JWT test cases directly (no `.skip()`), verify all ClamAV tests still pass

**Integration Tests:**
- Deploy full stack with `docker compose up -d`
- Verify document-repository starts without JWT_SECRET
- Verify user can upload/download files via frontend (Keycloak auth)
- Verify Dataprep can update file status during ingestion
- Verify ChatQnA can fetch file metadata during RAG query

**Manual Verification:**
- `curl` test with valid Keycloak token to document-repository health + file endpoints
- Verify Dataprep logs show Bearer token (not X-Service-Token)
- Verify no SERVICE_AUTH_TOKEN in any `docker compose config` output

### Notes

**Party Mode decisions (2026-04-15):**

*Session 1 (architectural decision):* The team (Winston/Architect, Amelia/Dev, John/PM) unanimously recommended Option B (full OIDC migration) over Option A (OIDC + SERVICE_AUTH_TOKEN + /internal/* routes). Key factor: Kubernetes migration is confirmed as short-term, making SERVICE_AUTH_TOKEN a dead-end investment.

*Session 2 (spec review):*
- **No graceful degradation** — If Keycloak is unreachable and JWKS cache is cold, auth fails. No retry, no fallback. OIDC tokens validate locally via cached JWKS keys; Keycloak only needed for login and key rotation.
- **Dataprep `depends_on`** — Use `service_healthy`, consistent with all other Keycloak-dependent services.
- **Defense in depth** — ChatQnA validates tokens independently via JWKS even though backend already validated.
- **Dead code always deleted** — No `.skip()` for tests; remove directly.
- **Deployment Order** — Phases 3+4 must deploy together; Phase 6 (cleanup) last.
- **Exhaustive test + doc coverage** — Added Task 12 (new middleware tests), Task 17 (backend opea-continuity tests), detailed Tasks 26-27 (documentation, E2E tests) with specific files and line numbers.

*Adversarial Review corrections (2026-04-15):*
- **F1: authorizeRole array→scalar mapping** — `realm_access.roles` is an array, existing `authorizeRole` expects scalar `req.user.role`. Task 4 now describes explicit mapping logic.
- **F2+F5: Context endpoint security** — `/api/users/:userId/context` was public (bypassed Keycloak JWT) and used X-Service-Token. Task 16 removes the bypass, deletes service-token-service.js, and preserves `buildUserContext()` utility.
- **F3: opea-continuity.test.js** — Task 17 added to update/remove X-Service-Token tests and fix isPublicRoute expectations.
- **F6: opeaHeaders verification** — Task 14 now includes verification of `query-routes.js` caller and explicit Authorization header passing.
- **F7: Dataprep _fetch_all_labels inline headers** — Task 21 now includes updating `_fetch_all_labels()` to use `_service_headers()` instead of inline X-Service-Token.
- **F8+F11: GenieUserProfileClient refactoring** — Task 18 now describes full refactoring: `__init__(token)` parameter, `set_token()` method, token threading from `handle_request()` to `fetch_file_metadata()`.
- **F9: dataprep-service role authorization** — Task 4 adds `dataprep-service` to `authorizeRole` allowed roles for `PATCH /:fileId/status`. AC 5 updated.
- **F13: sensitiveKeys cleanup** — Task 9 now includes removing `jwtsecret` from `sensitiveKeys` array.

*Second Adversarial Review corrections (2026-04-15):*
- **F1: opeaHeaders cascade** — `buildUserHeaders()` returns `{X-User-Id, X-User-Roles, X-Issuer}` — NO `authorization`. Task 14 now explicitly merges `req.headers.authorization` at the call site in `query-routes.js`. Token travels via standard HTTP Authorization header.
- **F2: ChatQnA headers** — Reviewer incorrectly assumed ChatQnA can't read HTTP headers. FastAPI supports `request.headers.get("Authorization")` natively. Token propagation stays via HTTP headers (standard microservices pattern).
- **F3: Dataprep _fetch_all_labels calls Backend** — Task 21 now includes verification that the Backend's service-categories route uses `authenticate` only (no `authorizeRole` check), so any valid Keycloak token passes.
- **F4: config-and-sleep.sh validation** — Task 1 now includes adding `KC_DATAPREP_CLIENT_SECRET` to the validation loop in `config-and-sleep.sh`.
- **F5: document-repository depends_on** — Task 23 now adds `depends_on: keycloak-config: condition: service_healthy` to document-repository.
- **F6: buildUserContext preservation** — Task 16 now has explicit sub-task: inline the 6-line function in `user-routes.js` and update test imports.
- **F7+F11: ChatQnA JWKS validation restored** — Task 19 restored (python-jose). Task 18 now includes JWKS validation helper. Technical Decision 9 restored: defense in depth — each service validates independently.
- **F9: Breaking window Phase 2→5** — Deployment Order now documents the Dataprep ingestion breakage window and recommends deploying Phase 2+5 together or during maintenance.
- **F10: Role mapping algorithm** — Task 4 now defines a deterministic 4-step algorithm for array→scalar mapping.

*Third Adversarial Review corrections (2026-04-15):*
- **F1: Backend SERVICE_AUTH_TOKEN in docker-compose** — Task 23 now includes removing `SERVICE_AUTH_TOKEN` from the backend service (line 399). Previously only listed chatqna and dataprep.
- **F2: keycloak-config missing KC_DATAPREP_CLIENT_SECRET** — Task 23 now includes adding `KC_DATAPREP_CLIENT_SECRET` to the keycloak-config service environment. This env var is required by `config-and-sleep.sh` validation and `genie-realm.yaml` variable substitution.
- **F3: opea-worker.js misleading comment** — Task 15 now includes updating the comment block (lines 6-14) that incorrectly states "Authorization header is NEVER forwarded to OPEA". After Task 14, the Authorization header IS forwarded.
- **F4: buildUserContext test crash after deletion** — Task 17 now specifies rewriting the `buildUserContext` tests (lines 320-356) as integration tests using supertest. The original tests import `service-token-service.js` directly and would crash after Task 16 deletes it.
- **F5: req.user._key in doc-repo** — REJECTED. Grep for `req\.user\._key` in `components/document-repository/src/` returned no matches. This is not a real issue.
- **F6: Incomplete public routes list** — Task 4 now lists all unauthenticated routes from `app.js`: `/health`, `/api-docs`, `/api`, `/api-docs.json`. The `express.static('/uploads')` dead code route (no consumer, reachable via direct container access) is removed from `app.js` entirely — not added to the bypass list.
- **F7: _fetch_all_labels stale guard** — Task 21 now includes updating the guard `if not self._service_token:` to reference the new service account token variable, since `self._service_token` is removed.
- **F8: Vague call path description** — Task 18 now describes the actual call chain (`handle_request()` → retrieval result loop at line ~1462 → `self.fetch_file_metadata()`) and recommends storing the token as `self._current_token` on the handler instance.

**Post-MR !39 considerations:** MR !39 (document-repository-cleanup) has already been merged, which:
- Added `authorizeRole(['Admin'])` to `DELETE /:fileId` and `DELETE /` routes
- Added ESLint/Prettier configuration
- Added unit tests for document-repository
- Cleaned up dead code and unused packages
These changes are already in the base branch and don't conflict with the OIDC migration.

**Estimated effort:** ~35 files modified/created, ~600 lines of new/modified code, +1 Node.js dependency (jose), +1 Python dependency (python-jose).

### Deployment Order

Phases must be deployed in this exact sequence:

1. **Phase 1 (Keycloak)** — Must be deployed first. Adds the `dataprep-service-client` and realm role. No service disruption.
2. **Phase 2 (Doc Repo)** — Can be deployed independently after Phase 1. Removes JWT_SECRET dependency, adds OIDC middleware. **Breaking change**: existing SERVICE_AUTH_TOKEN calls from OPEA services (Dataprep `_update_doc_status`, `_write_ingestion_log`) will fail until Phase 5 deploys. **Operational impact**: Dataprep ingestion will be broken between Phase 2 and Phase 5. Plan deployment during a maintenance window or deploy Phase 2+5 together.
3. **Phase 3 + 4 (Backend + ChatQnA)** — Must be deployed together. Backend starts forwarding Authorization token in OPEA payload, ChatQnA reads token from payload. Deploying Phase 3 without Phase 4 would break ChatQnA → document-repository calls.
4. **Phase 5 (Dataprep)** — Can be deployed independently but should follow Phase 2 promptly (see breaking window above). Replaces SERVICE_AUTH_TOKEN with service account token. Requires `KC_DATAPREP_CLIENT_ID` and `KC_DATAPREP_CLIENT_SECRET` in environment.
5. **Phase 6 (Infrastructure + Tests + Docs)** — Cleanup. Remove JWT_SECRET and SERVICE_AUTH_TOKEN from `env`, docker-compose, Ansible templates. Update documentation and E2E tests. Deploy last to avoid breaking running services.
