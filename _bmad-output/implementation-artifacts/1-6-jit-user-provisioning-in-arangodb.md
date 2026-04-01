# Story 1.6: JIT User Provisioning in ArangoDB

Status: review

## Story

As a backend system,
I want to automatically create a user record in ArangoDB on first successful Keycloak authentication,
so that every authenticated user has a local profile without manual provisioning.

## Acceptance Criteria

1. **Automatic User Creation on First Login (FR18)**
   - Given a user has successfully authenticated via Keycloak and the backend middleware validates the token
   - When no user record exists in ArangoDB for the composite key `{iss}#{sub}`
   - Then a new user document is created with `iss_sub` as the unique key and `email` from the token (FR18)
   - And the user document contains: `iss_sub`, `iss`, `sub`, `email`, `name`, `roles`, `active: true`, `deleted: false`, `createdAt`, `updatedAt`

2. **Atomic UPSERT — No Duplicates (D1)**
   - Given a user record already exists for `{iss}#{sub}`
   - When the same user authenticates again
   - Then the existing record is updated (profile fields refreshed from JWT claims) — no duplicate created
   - And `updatedAt` is set to the current timestamp
   - And subsequent logins for the same user never create duplicate records

3. **ArangoDB Indexes (D1)**
   - Given the `users` collection exists
   - When the provisioning service initializes
   - Then a unique persistent index on `iss_sub` exists
   - And a persistent (non-unique) index on `email` exists

4. **Profile Field Updates on Re-login**
   - Given a user exists in ArangoDB
   - When the user logs in again with updated profile fields in their JWT (e.g. email change in Keycloak)
   - Then `email`, `name`, and `roles` are updated from the JWT claims
   - And `createdAt` remains unchanged (immutable)
   - And `updatedAt` is set to the current timestamp

5. **Soft-Deleted Users Excluded (D1)**
   - Given a user record exists with `deleted: true`
   - When the middleware processes a token for that `{iss}#{sub}`
   - Then the user is NOT treated as newly provisioned
   - And the middleware returns 403 (deleted users are blocked — full handling in Story 3.6)

6. **Error Handling — Provisioning Failure (NFR19)**
   - Given a valid token is presented but ArangoDB is unreachable
   - When the middleware attempts to provision or upsert the user
   - Then the middleware returns HTTP 500 with `{ error: "PROVISIONING_FAILED", message: "...", details: {} }`
   - And the error does not expose internal implementation details

## Tasks / Subtasks

- [x] Task 1: Create ArangoDB schema migration script (AC: #3)
  - [x] Create `scripts/new-schema-scripts/keycloak-user-migration.js`
  - [x] Script ensures `users` collection exists (create if missing)
  - [x] Ensure unique persistent index on `iss_sub`
  - [x] Ensure persistent index on `email` (non-unique — Keycloak doesn't guarantee email uniqueness across realms)
  - [x] Handle existing `loginName` unique index gracefully (drop it or leave it — it won't conflict with new fields)
  - [x] Script should be idempotent (safe to run multiple times)
  - [x] Use `dbService.getConnection('default')` from shared-lib for ArangoDB connection
  - [x] Use `arangojs` `collection.ensureIndex()` for index creation

- [x] Task 2: Create user provisioning service (AC: #1, #2, #4, #5)
  - [x] Create `components/gov-chat-backend/services/user-provisioning-service.js`
  - [x] Export `provisionUser(decodedToken)` function that takes verified JWT payload
  - [x] Extract fields from token: `iss_sub`, `iss`, `sub`, `email`, `name`/`preferred_username`, `roles` from `realm_access.roles`
  - [x] Use ArangoDB UPSERT: `UPSERT { iss_sub: @iss_sub } INSERT @newDoc REPLACE @updateDoc IN users`
  - [x] INSERT document: `{ iss_sub, iss, sub, email, name, roles, active: true, deleted: false, createdAt: NOW_ISO, updatedAt: NOW_ISO }`
  - [x] REPLACE document: `{ email, name, roles, updatedAt: NOW_ISO }` (only mutable fields)
  - [x] Use `aql` template tag from `arangojs` for query construction
  - [x] Return the user document (either newly created or updated)
  - [x] If user has `deleted: true`, return null (caller handles 403)
  - [x] Use `dbService.getConnection('default')` for ArangoDB access
  - [x] Log provisioning events: `user_provisioned` for new users, profile updates for existing

- [x] Task 3: Integrate provisioning into keycloak-auth-middleware (AC: #1, #5, #6)
  - [x] In `keycloak-auth-middleware.js`, after token verification succeeds:
    1. Call `userProvisioningService.provisionUser(decoded)` with the verified payload
    2. If provisioning returns null (soft-deleted user) → return 403
    3. If provisioning throws → return 500 `PROVISIONING_FAILED`
    4. If provisioning succeeds → attach user to `req.user` and call `next()`
  - [x] Currently `req.user` is attached directly from decoded token — change to attach from ArangoDB result
  - [x] Keep `req.user` shape: `{ iss_sub, sub, iss, email, name, roles, active, deleted, createdAt, updatedAt }`

- [x] Task 4: Write unit tests for user-provisioning-service (AC: #1-5)
  - [x] Mock `dbService.getConnection()` to return mock ArangoDB database
  - [x] Mock `db.query()` to return cursor with user documents
  - [x] Test: new user → UPSERT creates document with all fields, `active: true`, `deleted: false`
  - [x] Test: existing user → UPSERT updates mutable fields, preserves `createdAt`
  - [x] Test: email change in JWT → updated in ArangoDB on re-login
  - [x] Test: soft-deleted user (`deleted: true`) → returns null
  - [x] Test: ArangoDB unreachable → throws error (middleware handles 500)
  - [x] Test: roles update from JWT `realm_access.roles`
  - [x] Use shared mock fixture `__tests__/mocks/mockJwtPayload.js` for test payloads

- [x] Task 5: Write unit tests for middleware integration (AC: #5, #6)
  - [x] Mock `keycloakAuthService.verifyToken()` to return valid decoded payload
  - [x] Mock `userProvisioningService.provisionUser()` to test different scenarios
  - [x] Test: successful provisioning → `req.user` populated from ArangoDB, `next()` called
  - [x] Test: provisioning returns null (soft-deleted) → 403 response
  - [x] Test: provisioning throws error → 500 `PROVISIONING_FAILED` response
  - [x] Test: `req.user` contains ArangoDB fields (`_key`, `createdAt`, `updatedAt`), not just JWT fields

- [x] Task 6: Run full test suite and verify
  - [x] Run `cd components/gov-chat-backend && npx jest --verbose`
  - [x] Verify all existing tests still pass (no regressions from middleware changes)
  - [x] Verify all new tests pass
  - [x] Run frontend tests to confirm no cross-component breakage: `cd components/gov-chat-frontend && npx jest`

## Dev Notes

### Architecture Decisions (from architecture.md)

**D1 — ArangoDB `users` collection schema:**

| Field | Type | Source | Mutable | Notes |
|---|---|---|---|---|
| `_key` | string | Auto ArangoDB | No | Primary key |
| `iss_sub` | string | JWT `{iss}#{sub}` | No | **Unique index** — composite identity key |
| `iss` | string | JWT `iss` | No | Issuer (Keycloak realm URL) |
| `sub` | string | JWT `sub` | No | Subject (Keycloak user ID) |
| `email` | string | JWT `email` | Yes | Upserted on each login |
| `name` | string | JWT `name` / `preferred_username` | Yes | Upserted on each login |
| `roles` | array | JWT `realm_access.roles` | Yes | Updated on each login |
| `active` | boolean | Default `true` | Yes | Soft delete support |
| `deleted` | boolean | Default `false` | Yes | Soft delete + PII anonymization |
| `createdAt` | string (ISO 8601) | First login | No | Immutable — record creation timestamp |
| `updatedAt` | string (ISO 8601) | Each login | Yes | Last profile update timestamp |

**Indexes:**
- Unique persistent index on `iss_sub` — primary lookup for JIT provisioning
- Persistent index on `email` — admin lookup (NOT unique — Keycloak doesn't guarantee email uniqueness across realms)

**JIT provisioning logic:** Upsert (insert if new, update if exists) on each successful authentication. Profile fields (`email`, `name`, `roles`) refreshed from JWT claims on every login.

**Auth Middleware Flow (architecture.md):**
```
1. Extract Bearer token from Authorization header
2. Verify JWT signature via JWKS (with force-refresh logic)
3. Validate claims: iss, aud, exp
4. Lookup user in ArangoDB by iss_sub         ← THIS STORY
5. If user not found → JIT provision (atomic upsert)  ← THIS STORY
6. If JIT provisioning fails → 500 PROVISIONING_FAILED  ← THIS STORY
7. If user deleted == true → 403               ← THIS STORY (simplified)
8. Inject user identity into request object
9. Set downstream headers: X-User-Id, X-User-Roles, X-Issuer
10. Call next()
```

### Key Technical Details

**Current `keycloak-auth-middleware.js` state (to be modified):**
- Lines 80-97: After `verifyToken()` succeeds, attaches `req.user` directly from decoded JWT
- No ArangoDB interaction — this is what story 1-6 adds
- `req.user` shape: `{ iss_sub, sub, iss, aud, email, name, preferred_username, roles, exp, iat }`
- After this story, `req.user` will come from ArangoDB (includes `_key`, `createdAt`, `updatedAt`, `active`, `deleted`)

**ArangoDB UPSERT pattern (from architecture.md):**
```javascript
// AQL UPSERT — atomic, no race conditions
const query = aql`
  UPSERT { iss_sub: @iss_sub }
  INSERT @newDoc
  REPLACE @updateDoc IN users
  RETURN NEW
`;
```

**Where `newDoc` and `updateDoc` are:**
```javascript
const now = new Date().toISOString();
const issSub = `${decoded.iss}#${decoded.sub}`;

const newDoc = {
  iss_sub: issSub,
  iss: decoded.iss,
  sub: decoded.sub,
  email: decoded.email || null,
  name: decoded.name || decoded.preferred_username || null,
  roles: decoded.realm_access?.roles || [],
  active: true,
  deleted: false,
  createdAt: now,
  updatedAt: now
};

const updateDoc = {
  email: decoded.email || null,
  name: decoded.name || decoded.preferred_username || null,
  roles: decoded.realm_access?.roles || [],
  updatedAt: now
};
```

**ArangoDB connection pattern (from existing services):**
- `const { aql } = require('arangojs');`
- `const { logger, dbService } = require('../shared-lib');`
- `const db = await dbService.getConnection('default');`
- `const collection = db.collection('users');`
- `const cursor = await db.query(aql\`...\`, bindVars);`
- `const result = await cursor.next();` or `await cursor.all();`

**shared-lib location:** `components/shared/lib/` — imported as `../shared-lib` from backend services. Exports `{ logger, dbService, securityHeaders, SecurityMiddleware }`.

**Important: `email` index is NOT unique.** The legacy `auth-service.js` creates `email` with `unique: true` (line 96), but Keycloak doesn't guarantee email uniqueness across realms. The migration script must either:
- Drop the existing unique email index and recreate as non-unique, OR
- Let the migration fail gracefully if the unique index already exists (and document that manual intervention is needed)

**Recommendation:** Drop the unique email index in the migration script. The legacy auth system is being replaced — no code depends on email uniqueness.

### What This Story Does NOT Cover (deferred to later stories)

- **Story 1.7:** Transparent re-authentication on session expiry (silent refresh)
- **Story 1.8:** Standardized error response format (this story uses the format but doesn't formalize all error codes)
- **Story 2.2:** JWKS caching with force-refresh (current implementation uses direct `createRemoteJWKS`)
- **Story 3.1:** User logout and session termination
- **Story 3.5:** JIT provisioning user profile updates on re-login (this story already does upsert, but 3.5 adds more sophisticated update logic)
- **Story 3.6:** Right to erasure / GDPR user deletion (soft delete + PII anonymization)
- **Story 1.11:** Remove legacy auth-service.js and related code

### Files to Create

| File | Purpose |
|------|---------|
| `components/gov-chat-backend/services/user-provisioning-service.js` | ArangoDB UPSERT for JIT user provisioning |
| `scripts/new-schema-scripts/keycloak-user-migration.js` | Idempotent schema migration (collection + indexes) |
| `components/gov-chat-backend/__tests__/user-provisioning-service.test.js` | Unit tests for provisioning service |

### Files to Modify

| File | Change |
|------|--------|
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Add provisioning call after token verification; attach ArangoDB user to `req.user` |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | Add tests for provisioning integration (soft-deleted → 403, provisioning failure → 500) |

### Files NOT Modified (intentionally)

| File | Reason |
|------|--------|
| `components/gov-chat-backend/services/auth-service.js` | Legacy — removed in Story 1.11; its `users` collection indexes are superseded by migration script |
| `components/gov-chat-backend/services/keycloak-auth-service.js` | Token verification only — no user provisioning responsibility |
| `components/gov-chat-backend/config.js` | No new config needed — ArangoDB connection via existing `dbService` |
| `components/gov-chat-frontend/*` | No frontend changes — provisioning is backend-only |

### Previous Story Intelligence (Story 1-5)

**Key patterns established:**
- Story 1-5 was frontend-only (router guard, CallbackView, NavBarComponent logout)
- No backend changes in 1-5 — the backend state is exactly as left by Story 1-3
- Story 1-3 created `keycloak-auth-middleware.js` and `keycloak-auth-service.js` — both are stable

**From Story 1-3 (backend auth middleware):**
- `keycloak-auth-middleware.js` currently verifies tokens only — NO ArangoDB interaction
- `keycloak-auth-service.js` builds `iss_sub` composite key: `${verifiedPayload.iss}#${verifiedPayload.sub}`
- `TokenVerificationError` class with `code`, `message`, `details` — use same pattern for provisioning errors
- `PUBLIC_PATHS` includes legacy routes (`/api/auth/login`, `/api/auth/register`) — still needed until Story 1.11
- Tests mock `../shared-lib` with `{ virtual: true }` to avoid resolution issues
- Tests mock `../services/keycloak-auth-service` to isolate middleware logic
- `jest.mock('jose', ...)` used in service tests — jose is ESM, must be fully mocked

**Lessons from code reviews (all stories):**
- Backend must use CommonJS only (`require`/`module.exports`)
- `__esModule: true` required in jest.mock for ES default imports (frontend only)
- `{ virtual: true }` in jest.mock for modules that don't resolve in test environment (shared-lib)
- ArangoDB queries use `aql` template tag from `arangojs` — never string concatenation for queries
- Index creation via `collection.ensureIndex()` — idempotent by default in ArangoDB

**Current `req.user` shape (from keycloak-auth-middleware.js lines 84-95):**
```javascript
req.user = {
  iss_sub: decoded.iss_sub,
  sub: decoded.sub,
  iss: decoded.iss,
  aud: decoded.aud,
  email: decoded.email,
  name: decoded.name || decoded.preferred_username,
  preferred_username: decoded.preferred_username,
  roles: decoded.realm_access?.roles || [],
  exp: decoded.exp,
  iat: decoded.iat
};
```

After this story, `req.user` will be the ArangoDB document:
```javascript
req.user = {
  _key: '...',
  iss_sub: '...',
  iss: '...',
  sub: '...',
  email: '...',
  name: '...',
  roles: [...],
  active: true,
  deleted: false,
  createdAt: '...',
  updatedAt: '...'
};
```

### Backend Conventions (from project-context.md)

- **CommonJS only**: `require()`/`module.exports`, never ES imports
- **2-space indentation, single quotes, semicolons**
- **Controller → Service pattern**: Controllers handle HTTP, Services contain business logic
- **Direct AQL queries**: No ORM, no repository pattern — use `arangojs` `aql` template tag
- **Error handling**: try/catch in route handlers, structured error responses
- **Logging**: `winston` via shared-lib logger — `logger.info()`, `logger.error()`, `logger.debug()`
- **ArangoDB access**: `dbService.getConnection('default')` → returns arangojs Database instance

### Testing Strategy

**user-provisioning-service tests:**
- Mock `dbService.getConnection()` to return mock DB with `query()` method
- Mock `db.query()` to return cursor with `.next()` / `.all()` methods
- Test the AQL UPSERT query is called with correct bind variables
- Verify new user document has all required fields with correct defaults
- Verify update document only contains mutable fields
- Verify `createdAt` is set on insert but not modified on update
- Verify soft-deleted user returns null
- Use `mockJwtPayload` from shared fixture

**Middleware integration tests:**
- Extend existing `keycloak-auth-middleware.test.js` with new describe blocks
- Mock `userProvisioningService.provisionUser()` alongside existing `keycloakAuthService.verifyToken()` mock
- Test 403 response for soft-deleted users
- Test 500 `PROVISIONING_FAILED` response for ArangoDB errors
- Verify `req.user` comes from provisioning result, not directly from JWT

**Migration script tests:**
- Not unit-tested (migration scripts are typically run manually or in CI)
- Can be integration-tested against a real ArangoDB instance if available

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D1] — ArangoDB users collection schema
- [Source: _bmad-output/planning-artifacts/architecture.md#Auth Middleware Flow] — Full middleware flow with provisioning steps
- [Source: _bmad-output/planning-artifacts/architecture.md#ArangoDB User Query Patterns] — UPSERT pattern, filter for soft-deleted
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns] — Error codes, naming conventions
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] — File locations for new backend files
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#FR18] — JIT provisioning requirement
- [Source: _bmad-output/planning-artifacts/prd.md#NFR19] — 500ms token validation + provisioning target
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — Current middleware to extend
- [Source: components/gov-chat-backend/services/keycloak-auth-service.js] — Token verification (iss_sub key)
- [Source: components/gov-chat-backend/services/auth-service.js#initialize] — Legacy index creation pattern
- [Source: components/gov-chat-backend/shared-lib/lib/db-connection-service.js] — dbService.getConnection()
- [Source: components/gov-chat-backend/shared-lib/lib/index.js] — shared-lib exports
- [Source: components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js] — Shared JWT payload fixture

## Dev Agent Record

### Agent Model Used

GLM-5-Turbo

### Debug Log References

### Completion Notes List

- Created idempotent migration script that handles legacy unique email index by detecting and dropping it
- Implemented atomic UPSERT pattern using arangojs aql template tag — no race conditions possible
- Provisioning service returns null for soft-deleted users, allowing middleware to return 403
- Middleware now attaches ArangoDB user document (with `_key`, `createdAt`, `updatedAt`) to `req.user` instead of raw JWT payload
- All 50 backend tests pass (10 new provisioning tests + 2 new middleware tests + 38 existing)
- All 59 frontend tests pass (no cross-component breakage)

### Change Log

- 2026-04-01: Implemented JIT user provisioning — migration script, provisioning service, middleware integration, and full test coverage
- 2026-04-01: Code review fixes — soft-deleted user check moved before UPSERT (prevents profile refresh on deleted users), added iss_sub guard clause, fixed misleading log message, renamed ambiguous test

### File List

- `components/gov-chat-backend/scripts/new-schema-scripts/keycloak-user-migration.js` (created)
- `components/gov-chat-backend/services/user-provisioning-service.js` (created)
- `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` (modified)
- `components/gov-chat-backend/__tests__/user-provisioning-service.test.js` (created)
- `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` (modified)
