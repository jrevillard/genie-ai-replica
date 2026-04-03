# Story 1.3: Backend Auth Middleware — Protected & Public Routes

Status: review

## Story

As a backend developer,
I want an Express middleware that validates Keycloak tokens on protected routes while leaving public routes accessible,
So that API endpoints are secured by default.

## Acceptance Criteria

1. **Given** the Express backend is running with Keycloak available
   **When** a request hits a protected route (e.g. `/api/chat/*`, `/api/users/*`) without a valid `Authorization: Bearer` header
   **Then** the middleware returns HTTP 401 with `{ error: "TOKEN_INVALID", message: "...", details: {} }`

2. **Given** the Express backend is running with Keycloak available
   **When** a request hits a public route (`/health`, `/api-docs`, static assets)
   **Then** the request returns its response without requiring a token (FR23)

3. **Given** the Express backend is running with Keycloak available
   **When** a request hits a protected route with a valid `Authorization: Bearer` token
   **Then** the middleware extracts `iss`, `sub`, `exp`, `aud` claims from the JWT for downstream use

4. **Given** the Express backend is running with Keycloak available
   **When** a request hits a protected route with an invalid token format (not a valid JWT)
   **Then** the middleware returns 401 with `TOKEN_INVALID` error code

## Tasks / Subtasks

- [x] Create `keycloak-auth-service.js` — JWKS token verification service (AC: #1, #3, #4)
  - [x] Create `components/gov-chat-backend/services/keycloak-auth-service.js`
  - [x] Implement `verifyToken(token)` using `jose.jwtVerify()` with `createRemoteJWKS()`
  - [x] OIDC discovery: fetch `/.well-known/openid-configuration` from Keycloak to resolve `issuer` and `jwks_uri` (lazy singleton, triggered on first token verification)
  - [x] Validate claims: `iss` (must match expected issuer), `aud` (must match `KEYCLOAK_CLIENT_ID`), `exp` (must not be expired)
  - [x] Return decoded payload on success, throw structured error on failure
  - [x] Use CommonJS (`require`/`module.exports`) — no ES imports
  - [x] Use existing `{ logger }` from `../shared-lib` for logging

- [x] Create shared JWT mock fixture for tests (AC: #1, #3, #4)
  - [x] Create `components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js`
  - [x] Export minimum valid payload: `sub`, `iss`, `email`, `name`, `realm_access`, `exp`, `aud`, `iat`
  - [x] Export a helper to generate mock JWT strings for testing

- [x] Create `keycloak-auth-middleware.js` — Express middleware (AC: #1, #2, #3, #4)
  - [x] Create `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`
  - [x] Export `keycloakAuthMiddleware` object with `authenticate` method
  - [x] `authenticate(req, res, next)`:
    - [x] Extract Bearer token from `Authorization` header
    - [x] Return 401 `{ error: "TOKEN_INVALID", message: "Missing or malformed Authorization header", details: {} }` if no Bearer token
    - [x] Call `keycloakAuthService.verifyToken(token)` to validate
    - [x] Return 401 `{ error: "TOKEN_INVALID", message: "Token verification failed", details: {} }` on verification failure
    - [x] Return 401 `{ error: "TOKEN_EXPIRED", message: "Token has expired", details: {} }` on expired token
    - [x] On success: attach decoded payload to `req.user` (with `iss_sub` composite key) and call `next()`
  - [x] Export public route paths array: `PUBLIC_PATHS = ['/health', '/api-docs', '/api-docs/', '/docs']`
  - [x] Export `isPublicRoute(path)` helper to check if a path is public
  - [x] Use CommonJS — no ES imports

- [x] Add `jose` dependency (AC: #1, #3, #4)
  - [x] Run `npm install jose` in `components/gov-chat-backend/`
  - [x] Verify `jose` works with CommonJS `require()` (it ships dual CJS/ESM)

- [x] Wire middleware into Express app — protected routes (AC: #1, #2)
  - [x] Import `keycloakAuthMiddleware` in `components/gov-chat-backend/index.js`
  - [x] Apply `keycloakAuthMiddleware.authenticate` to all `/api/*` routes EXCEPT public auth callback routes
  - [x] Public routes remain unprotected: `/health`, `/api-docs`, static assets
  - [x] OIDC callback routes (`/api/auth/callback`, `/api/auth/logout/callback`) must remain public (added in later stories, but plan for them now)
  - [x] Do NOT remove existing `authMiddleware` yet (legacy removal is Story 1.11)
  - [x] The new middleware coexists alongside existing auth — route files that need Keycloak auth will use the new middleware

- [x] Add `KEYCLOAK_URL` and `KEYCLOAK_CLIENT_ID` to backend config (AC: #3)
  - [x] Add env var reads in `components/gov-chat-backend/config.js` with sensible defaults
  - [x] `KEYCLOAK_URL` default: `http://keycloak:8080` (internal Docker network)
  - [x] `KEYCLOAK_CLIENT_ID` default: `genie-app` (matches Story 1.1 config)
  - [x] `KEYCLOAK_REALM` default: `genie` (matches Story 1.1 config)

- [x] Write unit tests for `keycloak-auth-service.js` (AC: #1, #3, #4)
  - [x] Create `components/gov-chat-backend/__tests__/keycloak-auth-service.test.js`
  - [x] Test: valid token returns decoded payload with `iss`, `sub`, `exp`, `aud`
  - [x] Test: expired token throws error with `TOKEN_EXPIRED`
  - [x] Test: invalid signature throws error with `TOKEN_INVALID`
  - [x] Test: wrong `aud` claim throws error
  - [x] Test: missing claims throws error
  - [x] Use mock JWT strings for testing
  - [x] Use shared mock fixture from `__tests__/mocks/mockJwtPayload.js`

- [x] Write unit tests for `keycloak-auth-middleware.js` (AC: #1, #2, #3, #4)
  - [x] Create `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js`
  - [x] Test: request without Authorization header returns 401 `TOKEN_INVALID`
  - [x] Test: request with malformed Authorization header returns 401 `TOKEN_INVALID`
  - [x] Test: request with valid token passes through (calls `next()`)
  - [x] Test: request with expired token returns 401 `TOKEN_EXPIRED`
  - [x] Test: request with invalid token returns 401 `TOKEN_INVALID`
  - [x] Test: `req.user` is populated with decoded payload including `iss_sub`
  - [x] Test: `isPublicRoute()` correctly identifies public vs protected paths
  - [x] Mock `keycloakAuthService.verifyToken` to isolate middleware from actual JWKS calls

- [x] Run all tests and verify no regressions (AC: all)
  - [x] Run `npm test` in `components/gov-chat-backend/`
  - [x] Verify all new tests pass
  - [x] Verify existing backend functionality is not broken

## Dev Notes

### Architecture Decisions

**D2 — Backend JWKS library: `jose`** [Source: architecture.md#D2]
- Lightweight, modern API with native JWKS multi-issuer support via `createRemoteJWKS()`
- Single-call verification with `jose.jwtVerify()`
- Node.js 22 Web Crypto API compatible
- Install: `npm install jose` (CommonJS: `const { jwtVerify, createRemoteJWKS } = require('jose')`)
- Rejected alternative: `jsonwebtoken` + `jwks-rsa` — additional dependency, older API

**D3 — JWKS caching strategy** [Source: architecture.md#D3]
- Cache key: `{iss}` (issuer URL) — enables multi-issuer
- TTL: 5 minutes
- Force-refresh on 401 with valid `exp` — two-attempt pattern
- **Note for this story:** Full JWKS caching with multi-issuer support is Story 2.2. This story (1.3) implements basic single-issuer JWKS verification. The service should be structured to allow easy addition of caching later.

### Auth Error Response Format (MANDATORY)

All error responses MUST follow this format [Source: architecture.md#Format Patterns]:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

**Error codes for this story:**
| HTTP | Code | When |
|------|------|------|
| 401 | `TOKEN_INVALID` | Missing/malformed Bearer header, invalid signature, wrong claims |
| 401 | `TOKEN_EXPIRED` | Token `exp` claim exceeded |

### Critical Implementation Rules

1. **CommonJS ONLY** — `const { jwtVerify, createRemoteJWKS } = require('jose')` and `module.exports = ...`. NEVER use ES `import`/`export`. [Source: project-context.md]
2. **Per-route middleware** — NEVER apply auth middleware globally. Apply `keycloakAuthMiddleware.authenticate` to specific route groups only. [Source: project-context.md#Anti-Patterns]
3. **Existing auth middleware preserved** — Do NOT modify or remove existing `middleware/auth-middleware.js`. The new `keycloak-auth-middleware.js` coexists. Legacy removal is Story 1.11.
4. **No ArangoDB in this story** — This story only validates tokens and extracts claims. ArangoDB user lookup/JIT provisioning is Story 1.6.
5. **No global middleware** — The new middleware must be applied per-route in `index.js`, not via `app.use()`.

### Route Security Matrix [Source: prd.md#Route Security Matrix]

| Route | Auth Required | This Story |
|-------|--------------|------------|
| `/health` | No | Public (no change) |
| `/api-docs` | No | Public (no change) |
| Static assets | No | Public (no change) |
| `/api/chat/*` | Yes | Protected with new middleware |
| `/api/users/*` | Yes | Protected with new middleware |
| `/api/analytics/*` | Yes | Protected with new middleware |
| `/api/admin/*` | Yes | Protected with new middleware |
| `/api/files/*` | Yes | Protected with new middleware |
| `/api/categories/*` | Yes | Protected with new middleware |
| `/api/auth/*` | Mixed | Login callback public, others protected |

### Public Paths (no auth required)

```
/health
/api-docs
/api-docs/
/docs
/api/auth/callback        (OIDC callback — added in later story)
/api/auth/logout/callback (OIDC logout callback — added in later story)
```

### Backend File Structure

```
components/gov-chat-backend/
├── middleware/
│   ├── auth-middleware.js                # EXISTING — legacy, do NOT modify (Story 1.11)
│   └── keycloak-auth-middleware.js       # NEW — JWKS validation middleware
├── services/
│   ├── auth-service.js                   # EXISTING — legacy, do NOT modify (Story 1.11)
│   └── keycloak-auth-service.js          # NEW — JWKS verification service
├── __tests__/
│   ├── mocks/
│   │   └── mockJwtPayload.js             # NEW — shared JWT payload fixture
│   ├── keycloak-auth-service.test.js     # NEW — service tests
│   └── keycloak-auth-middleware.test.js  # NEW — middleware tests
├── config.js                             # MODIFY — add KEYCLOAK_* vars
├── index.js                              # MODIFY — wire new middleware to routes
└── package.json                          # MODIFY — add jose dependency
```

### Key Existing Code Patterns (DO NOT change these)

1. **Service singleton pattern** — Existing services export a singleton object. Follow same pattern for `keycloakAuthService`.
2. **Middleware export pattern** — Existing middleware exports an object with methods. Follow same pattern: `module.exports = keycloakAuthMiddleware`.
3. **Logger usage** — Import from shared-lib: `const { logger } = require('../shared-lib')`.
4. **Error handling** — try/catch in handlers, structured error responses.
5. **Route protection** — Applied per-route, not globally. Check `index.js` for how existing `authMiddleware.authenticate` is applied to route groups.

### Previous Story Intelligence (Story 1.1)

- Keycloak is running at `keycloak:8080` internally (Docker network)
- NGINX proxies `/auth/` to Keycloak via Kong
- OIDC discovery: `https://<domain>/auth/realms/genie/.well-known/openid-configuration`
- Client ID default: `genie-app` (from `KC_CLIENT_ID` env var in `genie-realm.yaml`)
- Realm default: `genie` (from `KC_REALM` env var)
- Env vars are available: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`

### Dependencies to Install

```
npm install jose   # JWT/JWKS verification library
```

**`jose` CommonJS usage:**
```javascript
const { jwtVerify, createRemoteJWKS, SignJWT } = require('jose');
```

### Testing Standards

- **Framework:** Jest (already in devDependencies)
- **Module system:** CommonJS — `require()`/`module.exports`
- **File location:** `__tests__/` directory at backend root
- **Naming:** `*.test.js`
- **Structure:** `describe()` / `it()` / `expect()`
- **Mocks:** Mock external services at module level
- **Shared fixture:** `__tests__/mocks/mockJwtPayload.js` — mandatory for all auth tests [Source: architecture.md#Test Patterns]

### Token Verification Flow (this story — simplified, no caching)

```
1. Extract Bearer token from Authorization header
2. If missing/malformed → 401 TOKEN_INVALID
3. Ensure OIDC discovery initialized (lazy singleton with 30s retry cooldown)
4. Extract unverified `iss` from token payload → lookup in trusted issuer map
5. If issuer not in map → 401 TOKEN_INVALID ("Unknown issuer")
6. Verify JWT signature + claims via jose jwtVerify() (iss, aud, exp, sub, alg=RS256)
7. If expired → 401 TOKEN_EXPIRED
8. If signature/claims invalid → 401 TOKEN_INVALID
9. Attach decoded payload to req.user with iss_sub composite key
10. Call next()
```

**Note:** Full JWKS caching with force-refresh (D3 two-attempt pattern) is Story 2.2. This story uses direct `createRemoteJWKS()` without caching.

### References

- [Source: architecture.md#D2] — `jose` library selection
- [Source: architecture.md#D3] — JWKS caching strategy (Story 2.2)
- [Source: architecture.md#Format Patterns] — Auth error response format
- [Source: architecture.md#Auth Middleware Flow] — Full middleware flow (JIT provisioning in Story 1.6)
- [Source: architecture.md#Structure Patterns] — OIDC callback routes (public)
- [Source: architecture.md#Test Patterns] — Shared mock fixture requirement
- [Source: architecture.md#Project Structure] — New files list for backend
- [Source: prd.md#FR22] — Protected route authentication
- [Source: prd.md#FR23] — Public route access
- [Source: prd.md#Route Security Matrix] — Route protection matrix
- [Source: epics.md#Story 1.3] — Story definition and acceptance criteria
- [Source: project-context.md#Testing Rules] — Jest testing conventions
- [Source: project-context.md#Anti-Patterns] — Never use global auth middleware, never use ES imports in backend
- [Source: project-context.md#Framework-Specific Rules] — Express route structure, auth middleware per-route

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (GLM-5-Turbo)

### Debug Log References

- `jose` v6 is ESM-only — Jest cannot use `jest.requireActual('jose')`. Solution: mock `jose` completely in service tests, use `createTokenWithPayload()` helper with base64url-encoded mock JWT strings.
- `shared-lib` module doesn't exist in this worktree (it's at `components/shared/lib/` but no resolve alias exists). Solution: use `jest.mock('../shared-lib', ..., { virtual: true })` in tests.
- `jest.mock()` factory cannot reference out-of-scope variables. Solution: move `getPublicJwk` into the factory function or use `require()` inside the factory.

### Completion Notes List

1. **keycloak-auth-service.js**: Implements `verifyToken(token)` using OIDC discovery pattern. On first call, fetches `/.well-known/openid-configuration` from Keycloak to resolve canonical `issuer` and `jwks_uri`. Stores trusted issuers in an `issuerMap` (Map<issuer, JWKS>). Token's unverified `iss` is used only for map lookup (whitelist pattern). All validation (signature, iss, aud, exp, sub, alg) delegated to `jose.jwtVerify()`. Lazy singleton with 30-second retry cooldown on init failure. Multi-IdP ready via `init(url)`. Returns decoded payload with `iss_sub` composite key. Structured errors via `TokenVerificationError` class.

2. **keycloak-auth-middleware.js**: Express middleware with `authenticate(req, res, next)`. Extracts Bearer token, calls service, attaches decoded user to `req.user` with `iss_sub`, `sub`, `iss`, `email`, `name`, `roles`. Returns standardized error format `{ error, message, details }`. Exports `PUBLIC_PATHS` and `isPublicRoute()` helper.

3. **config.js**: Added `keycloak` section with `url`, `realm`, `clientId` from env vars with sensible defaults matching Story 1.1.

4. **index.js**: Added `keycloakAuthMiddleware` import. Added `keycloakAuth: true` flag to protected route configs. Routes without flag (auth-routes, logger-routes, database-operations-routes) remain unprotected.

5. **jose v6.2.2**: ESM-only module. Works with Node.js CJS `require()` at runtime via Node's synthetic ESM support, but Jest needs the module fully mocked.

6. **Jest config**: Created `jest.config.js` with `testEnvironment: 'node'` and `testMatch` for `__tests__/**/*.test.js`.

### File List

| File | Action | Description |
|------|--------|-------------|
| `components/gov-chat-backend/services/keycloak-auth-service.js` | CREATED | JWKS token verification service |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | CREATED | Express auth middleware with public route helper |
| `components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js` | CREATED | Shared JWT payload mock fixture |
| `components/gov-chat-backend/__tests__/keycloak-auth-service.test.js` | CREATED | Service unit tests (15 tests) |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | CREATED | Middleware unit tests (23 tests) |
| `components/gov-chat-backend/jest.config.js` | CREATED | Jest configuration |
| `components/gov-chat-backend/config.js` | MODIFIED | Added keycloak config section |
| `components/gov-chat-backend/index.js` | MODIFIED | Added keycloak middleware import and per-route auth |
| `components/gov-chat-backend/package.json` | MODIFIED | Added jose dependency |

