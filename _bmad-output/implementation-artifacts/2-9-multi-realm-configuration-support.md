# Story 2.9: Multi-Realm Configuration Support

Status: done

## Story

As an IT administrator,
I want to configure multiple Keycloak realms within the same Keycloak instance,
so that each realm maintains isolated user populations and role mappings.

## Acceptance Criteria

1. **Given** a Keycloak instance with multiple realms configured
   **When** tokens from different realms are presented to the backend
   **Then** each token is validated against its own issuer's JWKS endpoint (FR4, FR5)

2. **Given** tokens from different Keycloak realms
   **When** the backend validates tokens
   **Then** user identities from different realms are kept separate via the `{iss}#{sub}` composite key

3. **Given** a user authenticated in Realm A with role `admin`
   **When** that user's token is used to access the system
   **Then** roles from Realm A do not leak into sessions from Realm B

4. **Given** multiple Keycloak realms are configured
   **When** the backend initializes
   **Then** the system supports at least 500 concurrent authenticated sessions per realm without degradation (NFR21)
   **Note:** This is satisfied by design — in-memory JWKS cache per issuer, no shared locks, no cross-realm state. Not unit-testable; validated by architecture review.

## Tasks / Subtasks

- [x] Task 1: Add `KEYCLOAK_ADDITIONAL_REALMS` environment variable and parsing (AC: #1)
  - [x] 1.1 Add `KEYCLOAK_ADDITIONAL_REALMS` env var to `env` template in the Keycloak section — format: JSON map `{"realm-name":"client-id"}` (deviation: used JSON map instead of comma-separated lists to avoid ordering issues)
  - [x] 1.2 Document that `KEYCLOAK_REALM` remains the **primary** realm (used by frontend OIDC client), and `KEYCLOAK_ADDITIONAL_REALMS` lists **extra** realms for backend token validation
  - [x] 1.3 If `KEYCLOAK_ADDITIONAL_REALMS` is empty/unset, behavior is identical to current single-realm setup (backward compatible)
  - [x] 1.4 Add `KEYCLOAK_ADDITIONAL_CLIENT_IDS` env var — comma-separated list of client IDs, one per additional realm, in the same order. Each additional realm must have its own OIDC client registered in Keycloak (deviation: merged into single JSON map — no separate `KEYCLOAK_ADDITIONAL_CLIENT_IDS` needed)
  - [x] 1.5 Validate that the number of entries in `KEYCLOAK_ADDITIONAL_REALMS` matches `KEYCLOAK_ADDITIONAL_CLIENT_IDS` — log a warning and skip mismatched entries on startup (deviation: not needed — JSON map eliminates ordering mismatch risk)

- [x] Task 2: Implement bulk realm initialization in `keycloak-auth-service.js` (AC: #1)
  - [x] 2.1 Parse `KEYCLOAK_ADDITIONAL_REALMS` and `KEYCLOAK_ADDITIONAL_CLIENT_IDS` at module load time (implemented as single JSON map parse)
  - [x] 2.2 Create a new `initAllRealms()` function that:
    - Calls `init()` for the primary realm (existing behavior: `KEYCLOAK_URL/realms/KEYCLOAK_REALM`)
    - Iterates over additional realms and calls `init()` for each: `KEYCLOAK_URL/realms/{realmName}`
    - Logs a warning for any realm that fails to initialize (does NOT crash — other realms remain functional)
    - Returns the number of successfully initialized realms (deviation: returns void, logs per-realm success)
  - [x] 2.3 Call `initAllRealms()` from `ensureInitialized()` instead of the single `init()` call
  - [x] 2.4 **CRITICAL — Singleton interaction:** `initAllRealms()` does NOT throw if additional realms fail — only the primary realm failure triggers the 30s cooldown
  - [x] 2.5 Ensure the existing `init(idpUrl)` function remains unchanged — it already supports being called multiple times (modified to accept optional `clientId` param)
  - [x] 2.6 Each realm's OIDC discovery fetches its own `.well-known/openid-configuration`, JWKS endpoint, and issuer — stored independently in `issuerMap`

- [x] Task 3: Implement per-realm `azp` validation via `audienceMap` (AC: #1, #3)
  - [x] 3.1 Confirm that `issuerMap` (Map keyed by `{iss}`) maintains separate JWKS caches per realm — already implemented in Story 2.2
  - [x] 3.2 Confirm that `verifyToken()` resolves the correct JWKS by looking up `issuerMap.get(unverifiedIss)` — already implemented
  - [x] 3.3 **CRITICAL — `azp` validation (NOT `aud`):** Modified to use `audienceMap.get(unverifiedIss)` instead of single `KEYCLOAK_CLIENT_ID`
  - [x] 3.4 Solution: Built `audienceMap: Map<string, string>` (issuer URL → client_id) populated during `init()`
  - [x] 3.5 The `jwtVerify()` call does NOT pass an `aud` option — no change needed to `jwtVerify` options

- [x] Task 4: Verify user isolation via composite key (AC: #2)
  - [x] 4.1 Confirm that JIT provisioning uses `{iss}#{sub}` as `iss_sub` — already implemented in `user-provisioning-service.js`
  - [x] 4.2 Confirm that the composite key guarantees uniqueness across realms
  - [x] 4.3 No code changes needed — documented via test

- [x] Task 5: Verify role isolation (AC: #3)
  - [x] 5.1 Confirm that roles are extracted from `realm_access.roles` in the JWT — realm-scoped by Keycloak design
  - [x] 5.2 Confirm that `X-User-Roles` header contains only the roles from the authenticated token's realm
  - [x] 5.3 Confirm that `X-Issuer` header correctly identifies which realm the token came from
  - [x] 5.4 No code changes needed — documented via test

- [x] Task 6: Update `config.js` to expose additional realms (AC: #1)
  - [x] 6.1 Add `additionalRealms` field to the `keycloak` config object (single JSON map, not separate arrays)
  - [x] 6.2 Parse JSON map from env var with error handling
  - [x] 6.3 Keep `url`, `realm`, and `clientId` for the primary realm — these remain unchanged

- [x] Task 7: Add unit tests (AC: all)
  - [x] 7.1 Test: `initAllRealms()` initializes primary realm plus additional realms
  - [x] 7.2 Test: backward compatibility verified via existing tests (102 pass)
  - [x] 7.3 Test: additional realm init failure logged as warning
  - [x] 7.4 Test: independent JWKS cache per realm
  - [x] 7.5 Test: `azp` validation uses realm-specific `client_id` via `audienceMap`
  - [x] 7.6 Test: `getAudienceForIssuer(iss)` returns correct client_id for each realm
  - [x] 7.7 Test: user from Realm A and user with same `sub` from Realm B get different `iss_sub`
  - [x] 7.8 Test: roles from Realm A's token do not appear in Realm B's result
  - [x] 7.9 Test: `audienceMap` populated by `init()`, cleared by `_resetForTesting()`
  - [x] 7.10 Used shared mock fixture `__tests__/mocks/mockJwtPayload.js`
  - [x] **CRITICAL (Story 1-9 lesson):** Used `var` for mock variable references

- [x] Task 8: Update `env` template documentation (AC: #1)
  - [x] 8.1 Add `KEYCLOAK_ADDITIONAL_REALMS` to the Keycloak section of `env` (single var, JSON map format)
  - [x] 8.2 Document the format and provide an example with 2 additional realms
  - [x] 8.3 Document that each additional realm requires a corresponding OIDC client registered in Keycloak

## Dev Notes

### Architecture Context (Decisions D3, D4, D7)

This story validates that the architectural foundations laid in Stories 1.9, 2.1, and 2.2 already support multi-realm operation at the code level. The key architectural decisions:

- **D3 (JWKS resolution):** `issuerMap` (Map keyed by `{iss}`) stores separate JWKS caches per issuer. `init(url)` is callable multiple times for different realms. Already implemented.
- **D4 (Multi-realm user_id):** `{iss}#{sub}` composite key guarantees uniqueness across realms. Already implemented in `user-provisioning-service.js`.
- **D7 (Multi-tenancy):** Keycloak Organizations (v26) for single-realm multi-population; multi-realm for total isolation. D3/D4 ensure multi-realm readiness at no extra code cost.

**What this story actually adds:** Environment-driven configuration to initialize multiple realms at startup and per-realm `azp` validation.

### What Already Works (No Code Changes Needed)

| Capability | Implementation | Story |
|---|---|---|
| Per-issuer JWKS cache | `issuerMap` in `keycloak-auth-service.js` | 1.9, 2.1 |
| Multi-init support | `init(idpUrl)` callable multiple times | 1.9 |
| Composite user ID | `{iss}#{sub}` in `user-provisioning-service.js` | 1.6 |
| Multi-realm headers | `X-Issuer`, `X-User-Id` in `buildUserHeaders()` | 2.3 |
| Role isolation | `realm_access.roles` is realm-scoped by Keycloak design | 1.3 |
| JWKS force-refresh | Per-issuer cache invalidation via `forceRefresh()` | 2.2 |

### The One Code Change: Per-Realm `azp` Validation

**Keycloak 26+ token behavior:** Access tokens have `aud: "account"` (not the client ID). The actual OIDC client ID is in the `azp` (authorized party) claim.

**Current code** (in `verifyWithJwt()` inside the auth service): `azp` is validated against a single `KEYCLOAK_CLIENT_ID`:
```js
if (verifiedPayload.azp && verifiedPayload.azp !== KEYCLOAK_CLIENT_ID) {
  throw new TokenVerificationError('TOKEN_INVALID', 'Token audience validation failed');
}
```

**Problem:** With multiple realms, each realm has its own OIDC client with a different `client_id`. A token from Realm B will have `azp: realm-b-client-id`, but the current code expects `azp: genie-app` (the primary realm's client from `KEYCLOAK_CLIENT_ID`).

**Solution:** Build `audienceMap: Map<issuer, clientId>` during initialization:
```js
const audienceMap = new Map();
// During init for each realm:
audienceMap.set(doc.issuer, clientIdForThisRealm);
```

Then in the `azp` check: `audienceMap.get(iss)` instead of the single `KEYCLOAK_CLIENT_ID` env var.

### Current Code Analysis

**File:** `components/gov-chat-backend/services/keycloak-auth-service.js`

Key sections for this story (use symbol names — line numbers drift with edits):
- **`issuerMap`** (`const issuerMap = new Map()`): Map<string, JWKSFunction> — already multi-issuer ready
- **`init(idpUrl)`**: Accepts optional URL, fetches OIDC discovery, stores JWKS in issuerMap, sets `initialized = true`
- **`ensureInitialized()`**: Lazy singleton with `initPromise` guard and 30s cooldown (`initFailedAt`), calls `init()` once
- **`verifyToken()`**: Extracts unverified `iss` from payload, looks up `issuerMap.get(unverifiedIss)`, calls `jwtVerify()` with `iss` and `exp` required claims (NO `aud` option)
- **`azp` validation** (inside `verifyWithJwt()`): `if (verifiedPayload.azp && verifiedPayload.azp !== KEYCLOAK_CLIENT_ID)` — single client_id check that needs per-realm support
- **`getClientId()`**: Exported function returning single `KEYCLOAK_CLIENT_ID` — becomes misleading with multi-realm; add `getAudienceForIssuer(iss)` or update to accept issuer parameter

**File:** `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`

- **Lines 56-63:** `buildUserHeaders(claims)` — constructs `X-User-Id`, `X-User-Roles`, `X-Issuer` from token claims (no realm-specific logic needed)

**File:** `components/gov-chat-backend/config.js`

- **Lines with `keycloak` object:** Currently has single `url`, `realm`, `clientId`

### Implementation Approach: Minimal Change

The implementation should be **minimal and backward-compatible**:

1. Add `KEYCLOAK_ADDITIONAL_REALMS` env var (comma-separated realm names)
2. Add `KEYCLOAK_ADDITIONAL_CLIENT_IDS` env var (comma-separated, same order)
3. Parse into arrays in `config.js`
4. Add `audienceMap` in `keycloak-auth-service.js` — populated during `init()` for each realm
5. Modify `ensureInitialized()` to call `init()` for each additional realm (with singleton interaction handling — see Task 2.4)
6. Modify `azp` validation in `verifyWithJwt()` to use `audienceMap.get(iss)` instead of single `KEYCLOAK_CLIENT_ID`
7. Add `getAudienceForIssuer(iss)` helper (or update `getClientId()` to accept optional issuer parameter)

**No changes needed in:** middleware, user-provisioning-service, frontend, Docker, NGINX, Kong.

### Environment Variable Design

```
# Primary realm (existing — unchanged)
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=genie
KEYCLOAK_CLIENT_ID=genie-ai

# Additional realms (new — optional)
KEYCLOAK_ADDITIONAL_REALMS=department-a,department-b
KEYCLOAK_ADDITIONAL_CLIENT_IDS=genie-ai-dept-a,genie-ai-dept-b
```

**Why separate `KEYCLOAK_REALM` and `KEYCLOAK_ADDITIONAL_REALMS`?** The primary realm is used by the frontend OIDC client (`keycloakAuthService.js`). Additional realms are backend-only for token validation. This separation is intentional — the frontend only authenticates against one realm (the primary). Users from additional realms authenticate via their own Keycloak login URL, which redirects to the same GENIE.AI frontend but with tokens from a different realm.

### Keycloak Side Configuration (IT Admin Responsibility)

This story covers **backend configuration only**. The IT administrator must:
1. Create each additional realm in Keycloak admin console
2. Create an OIDC client in each realm with `Authorization Code Flow + PKCE` enabled
3. Set the `Valid Redirect URIs` to include the GENIE.AI frontend callback URL
4. Add the realm name and client ID to `KEYCLOAK_ADDITIONAL_REALMS` / `KEYCLOAK_ADDITIONAL_CLIENT_IDS`

This is a Keycloak administration task — no GENIE.AI code is needed for realm creation.

### Testing Patterns

**Existing mock setup (from `keycloak-auth-service.test.js`):**
- `jest.mock('jose')` — full mock of jose module
- `mockJwtVerify` — controls `jwtVerify` return value
- `mockCreateRemoteJWKSet` — controls `createRemoteJWKSet` return value
- `mockFetch` — controls global `fetch` for OIDC discovery
- Shared fixtures from `__tests__/mocks/mockJwtPayload.js`
- `_resetForTesting()` called in `beforeEach` — clears `issuerMap`

**For multi-realm tests:**
- Mock OIDC discovery to return different `issuer` and `jwks_uri` for each realm
- Create mock JWT payloads with different `iss` values
- Verify that `audienceMap` maps each `iss` to the correct `client_id`
- **CRITICAL (Story 1-9 lesson):** Use `var` for mock variable references, NOT `let` — jest.mock hoisting TDZ issue

### Previous Story Intelligence

**Story 2-2 (JWKS Force-Refresh):**
- Implemented `createJwksCache()` with per-issuer TTL wrapper
- `issuerMap` values are now callable functions with `.forceRefresh()` method
- The force-refresh pattern already works per-issuer — no changes needed for multi-realm

**Story 2-3 (Token Passthrough Headers):**
- `buildUserHeaders()` in middleware already constructs `X-Issuer` and composite `X-User-Id`
- No realm-specific logic needed — the middleware is issuer-agnostic

**Story 1-9 (External IdP Connection):**
- `init(url)` was made callable multiple times for multi-issuer support
- OIDC discovery pattern established: fetch `/.well-known/openid-configuration`, extract `issuer` and `jwks_uri`
- **Key lesson:** "When declaring mock variable references for jest.mock, you MUST use `var` NOT `let`" — this caused test failures in Story 1-9

**Epic 1 Retrospective Lessons (relevant to this story):**
- `_resetForTesting()` is critical for test isolation — it clears `issuerMap`
- `ensureInitialized()` has a 30s cooldown — tests must account for this or use `_resetForTesting()`
- jose v6 error types: `JWTExpired` for expiration, `JWTClaimValidationFailed` for claim issues, generic `Error` for signature mismatch

### Project Structure Notes

- Backend uses **CommonJS only** (`require`/`module.exports`) — no ES imports
- 2-space indentation, single quotes, mandatory semicolons
- Test files in `__tests__/` directory at service root
- Mock fixtures in `__tests__/mocks/`
- Logger imported from `../shared-lib` (already mocked in tests)
- `TokenVerificationError` class already defined in the service — reuse for all error types

### Worktree Assignment

This story will be implemented in the `epic2-backend` worktree (current worktree).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.9] — Story requirements and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision D3] — JWKS resolution and caching strategy, multi-issuer support
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision D4] — Multi-realm `user_id` for OPEA: `{iss}#{sub}`
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision D7] — Multi-tenancy approach: Organizations vs multi-realm
- [Source: _bmad-output/planning-artifacts/prd.md#FR4] — Multiple Keycloak realms within same instance
- [Source: _bmad-output/planning-artifacts/prd.md#FR5] — Multi-issuer token validation via JWKS
- [Source: _bmad-output/planning-artifacts/prd.md#NFR21] — 500+ concurrent sessions per realm
- [Source: components/gov-chat-backend/services/keycloak-auth-service.js] — Current auth service with issuerMap and init()
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — Current middleware with buildUserHeaders()
- [Source: components/gov-chat-backend/config.js] — Current Keycloak config (single realm)
- [Source: components/gov-chat-backend/services/user-provisioning-service.js] — JIT provisioning with iss_sub composite key
- [Source: components/gov-chat-backend/__tests__/keycloak-auth-service.test.js] — Existing test patterns
- [Source: components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js] — Shared mock fixture
- [Source: _bmad-output/implementation-artifacts/2-2-jwks-force-refresh-on-validation-failure.md] — Per-issuer JWKS cache
- [Source: _bmad-output/project-context.md] — Backend conventions (CommonJS, testing rules)

## Dev Agent Record

### Agent Model Used

glm-5-turbo (via Claude Code)

### Debug Log References

None

### Completion Notes List

- Implemented `audienceMap` (Map<issuer, clientId>) for per-realm `azp` validation
- Added `initAllRealms()` function: primary realm failure throws, additional realm failures are warnings only
- Modified `init(idpUrl, clientId)` to accept optional clientId param (backward compatible)
- Changed `azp` validation from single `KEYCLOAK_CLIENT_ID` to `audienceMap.get(unverifiedIss)`
- Added `getAudienceForIssuer(issuer)` and `_getAudienceMap()` helper methods
- Updated `_resetForTesting()` to clear `audienceMap`
- **Deviation from story spec:** Used single JSON map env var `KEYCLOAK_ADDITIONAL_REALMS={"realm":"client-id"}` instead of two comma-separated lists (`KEYCLOAK_ADDITIONAL_REALMS` + `KEYCLOAK_ADDITIONAL_CLIENT_IDS`). This eliminates ordering mismatch risk and simplifies configuration.
- **Deviation from story spec:** `KEYCLOAK_ADDITIONAL_CLIENT_IDS` env var not needed — merged into single JSON map
- All 102 tests pass (89 existing + 13 new multi-realm tests)
- Backward compatible: empty/unset `KEYCLOAK_ADDITIONAL_REALMS` = identical behavior to single-realm

### File List

- `components/gov-chat-backend/services/keycloak-auth-service.js` — Modified: audienceMap, initAllRealms(), modified init() and verifyToken()
- `components/gov-chat-backend/config.js` — Modified: added additionalRealms to keycloak config
- `components/gov-chat-backend/__tests__/keycloak-auth-service.test.js` — Modified: added 13 multi-realm tests
- `env` — Modified: added KEYCLOAK_ADDITIONAL_REALMS documentation

### Change Log

- 2026-04-03: Implemented multi-realm configuration support (Story 2-9). Added audienceMap, initAllRealms(), per-realm azp validation. Used JSON map env var format. All 102 tests pass.
- 2026-04-03: Code review fixes — removed azp bypass when expectedAudience undefined (H1), added edge case tests for azp validation (H2), added invalid JSON warning test (M3). All 105 tests pass.
