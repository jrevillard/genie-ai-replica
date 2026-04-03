# Story 1.11: Remove Legacy Authentication Service

Status: done

## Story

As a developer,
I want the old local authentication system to be completely removed from the codebase,
so that no dead code, unused dependencies, or legacy auth endpoints remain that could cause confusion or security issues.

## Acceptance Criteria

1. **Reusable Utilities Extracted (Epic 1 AC from epics)**
   - Given the legacy `auth-service.js` (935 lines) and related files are reviewed for reusable utilities
   - When reusable utility functions are identified
   - Then they are extracted and migrated to appropriate modules before deletion

2. **Legacy Auth Service Deleted**
   - Given the new Keycloak-based authentication is fully implemented (Stories 1.3, 1.4)
   - Then the legacy `auth-service.js` file is deleted from the codebase

3. **No Broken Imports Remain**
   - Given all imports referencing the deleted files
   - Then all such imports are removed or updated — no broken imports remain
   - And the application builds and starts without errors after removal

4. **No Legacy Auth API Endpoints Remain Accessible**
   - Given the legacy auth routes (`/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, etc.)
   - Then no legacy auth API endpoints remain accessible in the backend routes
   - And only Keycloak-compatible endpoints remain (`/api/auth/callback`, `/api/auth/me`, `/api/auth/logout`)

5. **Existing Test Suite Passes**
   - Given the existing test suite
   - Then all tests pass with legacy auth tests removed or updated
   - And no test references the deleted files

## Tasks / Subtasks

- [x] Task 1: Audit `auth-service.js` for reusable utilities (AC: #1)
  - [x] Read `services/auth-service.js` (935 lines) completely
  - [x] Identified all external references: authController (15 calls), auth-middleware (4 calls), auth-routes (2 calls), user-profile-service (1 call), index.js (1 init call)
  - [x] Analyzed all functions: password hashing (bcrypt), JWT HS256 signing/verification, email verification, password reset — all tightly coupled to legacy local auth
  - [x] No reusable utilities found — Keycloak handles passwords, `jose` handles tokens, `email-service.js` exists independently
  - [x] Documented: zero extraction needed, safe to delete entire file

- [x] Task 2: Migrate all route files from `authMiddleware` to `keycloakAuthMiddleware` (AC: #3, #4)
  - [x] Added `requireAdmin` function to `keycloak-auth-middleware.js` — checks `req.user.roles.includes('admin')`
  - [x] Removed legacy public paths `/api/auth/login` and `/api/auth/register` from PUBLIC_PATHS
  - [x] Migrated all 12 route files: replaced import, authenticate, and isAdmin references
  - [x] Fixed `req.user.userId` → `req.user.iss_sub` in user-routes.js (3 locations) and chat-history-routes.js (1 location)
  - [x] Fixed `req.user.role === 'Admin'` → `req.user.roles.includes('admin')` in user-routes.js (3 locations)
  - [x] Fixed `authMiddleware.isAdmin` → `keycloakAuthMiddleware.requireAdmin` in logger-routes.js and admin-routes.js
  - [x] Verified: zero `authMiddleware` references remain in route .js files (only auth-routes.js — Task 3)

- [x] Task 3: Rewrite `routes/auth-routes.js` — remove all legacy endpoints (AC: #4)
  - [x] Removed 10 legacy endpoints: /register, /login, /refresh-token, /verify-email/:token, /verify-email-success, /resend-verification, /reset-password, /validate-token, /reset-password/confirm, /change-password, /cleanup-tokens
  - [x] Kept /me and /logout with keycloakAuthMiddleware.authenticate
  - [x] Removed factory function pattern — now exports plain router
  - [x] Removed `require('jsonwebtoken')`, `require('../middleware/auth-middleware')`, `require('path')`
  - [x] Kept Swagger docs for /me and /logout only

- [x] Task 4: Rewrite `controllers/authController.js` — remove all legacy handlers (AC: #2, #4)
  - [x] Removed all 10 legacy handler methods
  - [x] Kept getCurrentUser — Keycloak-only path (req.user.iss_sub), removed legacy userId fallback
  - [x] Kept logout — simplified to return success (Keycloak handles session invalidation)
  - [x] Removed getFrontendUrl() and getBackendUrl() utility functions
  - [x] Removed class constructor — now exports plain object with two handler functions
  - [x] Changed import in auth-routes.js from `new authController(authService)` to direct function calls

- [x] Task 5: Delete legacy files (AC: #2)
  - [x] Deleted `services/auth-service.js` (935 lines)
  - [x] Deleted `middleware/auth-middleware.js` (286 lines)

- [x] Task 6: Update `index.js` — remove legacy auth service initialization (AC: #2, #3)
  - [x] Removed `authService` variable declaration, importService call, serviceMap entry, and preInit setup
  - [x] Updated auth-routes config: `service: null` instead of `service: services.authService`
  - [x] Added auth-routes special case in route instantiation (exports plain router, no factory)
  - [x] Removed `JWT_SECRET` and `SESSION_SECRET` from requiredSecrets (only used by legacy auth)
  - [x] Verified: zero `authService`, `JWT_SECRET`, `SESSION_SECRET` references remain in index.js

- [x] Task 7: Fix `user-profile-service.js` — remove `auth-service` dependency (AC: #3)
  - [x] Removed `require('./auth-service')` import
  - [x] Removed `verifyPassword()` method (34 lines) — Keycloak handles passwords
  - [x] Password change deferred to Keycloak account console (documented)

- [x] Task 8: Clean up frontend legacy auth components and services (AC: #2, #3)
  - [x] Deleted 12 legacy files (LoginScreen, RegisterScreen, 3 PasswordReset/Email screens, LoginView, RegisterView, passwordService, authService, 3 test files)
  - [x] Updated router/index.js — removed login/reset-password routes, updated navigation guard
  - [x] Updated SettingsComponent.vue — removed PasswordResetInitiateScreen import, registration, template, and related methods
  - [x] Updated UserEditDialog.vue — removed "Send Password Reset" button and resetPassword() method
  - [x] Updated userService.js — removed initiatePasswordReset() method
  - [x] Fixed RightSideBarComponent.vue — migrated authService import to userService
  - [x] Fixed RegistrationSuccessScreen.vue — migrated authService import to userService
  - [x] keycloakAuthService.js and oidcConfig.js preserved intact

- [x] Task 9: Clean up environment configuration (AC: #2)
  - [x] Removed `JWT_SECRET` and `SESSION_SECRET` from `env` template (lines 36-44)
  - [x] Updated comment at line 401 that referenced these vars
  - [x] Verified: only used by legacy auth-service (already deleted)

- [x] Task 10: Consider dependency cleanup in `package.json` (AC: #2)
  - [x] `bcrypt` — zero dependents outside deleted auth-service. Removed via `npm uninstall bcrypt`.
  - [x] `jsonwebtoken` — zero dependents outside deleted legacy code. Removed via `npm uninstall jsonwebtoken`.
  - [x] `jose` kept — used by keycloak-auth-service.js for JWKS validation.

- [x] Task 11: Delete old schema scripts (AC: #2)
  - [x] Deleted `scripts/old-schema-scripts/debug-auth-service.js`
  - [x] Deleted `scripts/old-schema-scripts/update-passwords.js`
  - [x] Deleted `scripts/old-schema-scripts/reset-all-user-passwords.js`
  - [x] Reviewed and deleted `scripts/old-schema-scripts/update-schema.js` (100% legacy auth schema migration)

- [x] Task 12: Run full test suite to verify no regressions (AC: #5)
  - [x] Backend: 70/70 tests passed (3 suites: keycloak-auth-service, keycloak-auth-middleware, user-provisioning-service)
  - [x] Frontend: 87/87 tests passed (5 suites: oidcConfig, keycloakAuthService, router, auth store, httpService-401-retry)
  - [x] Updated 2 test cases in keycloak-auth-middleware.test.js: /api/auth/login and /api/auth/register are no longer public (legacy endpoints removed)
  - [x] Zero regressions

## Dev Notes

### Architecture Compliance

**Key Architectural Principle — Keycloak as Sole Identity Boundary:**
> "Keycloak is the sole auth authority. Frontend never handles credentials. Backend never issues tokens."

This story completes the transition from the legacy local auth system to Keycloak-only authentication. After this story, GENIE.AI has exactly one authentication path: Keycloak OIDC.

**What changes and why:**
- The legacy auth system (local JWT with HS256, bcrypt passwords, email verification tokens) is completely replaced by Keycloak
- All route files must use `keycloakAuthMiddleware.authenticate` instead of the old `authMiddleware.authenticate`
- The old auth service factory pattern in `index.js` is removed
- Legacy frontend auth components are removed (Keycloak login page replaces them)

### Critical Complexity: `authMiddleware` Migration (Task 2)

**This is the highest-risk task.** The old `authMiddleware.authenticate` is used in **12 route files**:

| Route File | Lines Using `authMiddleware` | Notes |
|------------|------------------------------|-------|
| `service-routes.js` | 15 | `router.use(authMiddleware.authenticate)` — global for entire router |
| `user-routes.js` | 192, 503, 540, 741, 786, 900, 1021, 1177, 1281, 1381 | Also uses `authMiddleware.isAdmin` |
| `logger-routes.js` | 97, 183 | Also uses `authMiddleware.isAdmin` |
| `database-operations-routes.js` | 8 | `router.use(authMiddleware.authenticate)` — global |
| `translation-routes.js` | 21 | `router.use(authMiddleware.authenticate)` — global |
| `chat-history-routes.js` | 55 | `router.use(authMiddleware.authenticate)` — global |
| `query-routes.js` | 8 | `router.use(authMiddleware.authenticate)` — global |
| `weather-routes.js` | 8 | `router.use(authMiddleware.authenticate)` — global |
| `session-routes.js` | 62 | `router.use(authMiddleware.authenticate)` — global |
| `service-category-routes.js` | 13 | `router.use(authMiddleware.authenticate)` — global |
| `admin-routes.js` | 41, 42 | Both `authenticate` and `isAdmin` |
| `analytics-routes.js` | 19 | `router.use(authMiddleware.authenticate)` — global |
| `auth-routes.js` | 3, 473, 500 | Import + 2 remaining usages |

**Migration approach:**
1. Replace `require('../middleware/auth-middleware')` with `require('../middleware/keycloak-auth-middleware')` in each file
2. Replace `authMiddleware.authenticate` with `keycloakAuthMiddleware.authenticate`
3. For `authMiddleware.isAdmin`: check if `keycloakAuthMiddleware` has an equivalent. If not, add a role-checking middleware that verifies `req.user.roles` includes 'admin'. The old `isAdmin` checked `req.user.role === 'admin'` — the Keycloak middleware sets `req.user.roles` as an array from `realm_access.roles`.

**IMPORTANT — `req.user` shape mismatch**: The old middleware sets `req.user` with shape `{ userId, loginName, email, role }`. The new middleware sets `req.user` with shape `{ iss_sub, sub, iss, email, name, roles }`. The following downstream code reads old shape fields and **WILL BREAK** if not updated:

| File | Line | Old Reference | New Equivalent |
|------|------|---------------|----------------|
| `user-routes.js` | 247 | `req.user.userId` | `req.user.iss_sub` |
| `user-routes.js` | 808, 815 | `req.user.userId` | `req.user.iss_sub` |
| `user-routes.js` | 906 | `req.user.userId` | `req.user.iss_sub` |
| `user-routes.js` | 1036 | `req.user.role === 'Admin'` | `req.user.roles.includes('admin')` |
| `user-routes.js` | 1190 | `req.user.role === 'Admin'` | `req.user.roles.includes('admin')` |
| `user-routes.js` | 1292 | `req.user.role === 'Admin'` | `req.user.roles.includes('admin')` |
| `chat-history-routes.js` | 13-14 | `req.user.userId` | `req.user.iss_sub` |

**IMPORTANT — `isAdmin` not on `keycloakAuthMiddleware`:** The old `authMiddleware.isAdmin` checks `req.user.role === 'Admin'`. The new `keycloakAuthMiddleware` does NOT export an `isAdmin` function. You must add one, or replace `authMiddleware.isAdmin` calls with an inline check: `(req, res, next) => { if (!req.user.roles.includes('admin')) return res.status(403)...; next(); }`

### Critical Complexity: `authController.js` Factory Pattern (Tasks 3, 4, 6)

The current `authController.js` is a **class** that takes `authService` in its constructor. The current `auth-routes.js` is a **factory function** `module.exports = (authService) => { ... }` that creates the controller with the service.

**After this story:**
- `auth-routes.js` should export a plain `router` (not a factory function)
- `authController.js` should export handler functions (or a class without `authService` dependency)
- `index.js` should register auth-routes without passing `authService`

**The `getCurrentUser` handler has a Keycloak fast path** (added in Story 1-9) that checks `req.user.iss_sub` first. After removing the legacy fallback, only this path remains. The `logout` handler calls `authService.logout(userId)` — this needs to be simplified since Keycloak handles session invalidation server-side.

### `user-profile-service.js` Dependency (Task 7)

`user-profile-service.js` (line 7) imports `auth-service.js` and uses `authService.verifyPassword()` (line 64). This is used to verify the current password before allowing profile changes. Since Keycloak manages passwords, this legacy verification must be removed. The password change flow should be deferred to Keycloak's account console.

### `index.js` Integration (Task 6)

The `index.js` file has deep integration with the legacy auth system:
- Line 658: `requiredSecrets` includes `JWT_SECRET` and `SESSION_SECRET`
- Line 729: `authService = await importService('AuthService', './services/auth-service')`
- Line 745: `authService: { instance: authService, name: 'AuthService' }` in services object
- Line 795: Pre-init: `services.authService.setSessionService(services.sessionService)`
- Line 980: `{ file: 'auth-routes', paths: ['/api/auth'], service: services.authService }` — passes authService to auth-routes factory

All of these must be carefully removed. The `SESSION_SECRET` check requires investigation — it may be used by express-session or other middleware.

### Frontend Cleanup Scope (Task 8)

**Files to DELETE (10 files):**
| File | Reason |
|------|--------|
| `src/components/LoginScreen.vue` | Replaced by Keycloak redirect |
| `src/components/RegisterScreen.vue` | Replaced by Keycloak redirect |
| `src/components/PasswordResetInitiateScreen.vue` | Keycloak handles passwords |
| `src/components/PasswordResetConfirmScreen.vue` | Keycloak handles passwords |
| `src/components/EmailVerificationScreen.vue` | Keycloak handles email verification |
| `src/views/LoginView.vue` | Replaced by Keycloak redirect |
| `src/views/RegisterView.vue` | Replaced by Keycloak redirect |
| `src/services/passwordService.js` | Keycloak handles passwords |
| `src/services/authService.js` | Replaced by `keycloakAuthService.js` |
| `src/services/tests/authServiceTest.js` | Tests for deleted service |
| `src/services/tests/testPassword.js` | Tests for deleted service |
| `src/services/tests/testPasswordService.js` | Tests for deleted service |

**Files to MODIFY (3 files):**
| File | Change |
|------|--------|
| `src/router/index.js` | Remove LoginScreen and PasswordResetConfirmScreen imports/routes |
| `src/components/SettingsComponent.vue` | Remove PasswordResetInitiateScreen import, component registration, and template usage |
| `src/components/UserEditDialog.vue` | Remove `initiatePasswordReset` call (or keep if it calls Keycloak admin API — verify) |

**CRITICAL**: `src/services/userService.js` has an `initiatePasswordReset` method (line 226). Check if this is still referenced by `UserEditDialog.vue` or `SettingsComponent.vue`. If yes, remove those references too.

### Backend Dependency Cleanup (Task 10)

After removing `auth-service.js`:
- `bcrypt` — only used in `auth-service.js` (lines 3, 863, 865, 873) and `scripts/old-schema-scripts/`. Safe to remove from `package.json` after Task 5 and Task 11.
- `jsonwebtoken` — used in `auth-service.js` (line 4), `auth-routes.js` (line 8). After Task 3 removes the import from auth-routes, check if any other file uses it. If not, safe to remove.
- `jose` — KEEP. Used by `keycloak-auth-service.js` for JWKS validation.

### Old Schema Scripts (Task 11)

These scripts in `scripts/old-schema-scripts/` are all related to the legacy auth system:
- `debug-auth-service.js` — Debugging tool for legacy password hashing
- `update-passwords.js` — Bulk password update utility
- `reset-all-user-passwords.js` — Reset all user passwords
- `update-schema.js` — May contain legacy schema initialization

All should be deleted as part of this cleanup.

### Previous Story Intelligence (Story 1-9)

**Key patterns from Story 1-9:**
- Story 1-9 fixed `auth-routes.js` to use `keycloakAuthMiddleware.authenticate` for `/me` and `/logout` (was using old `authMiddleware.authenticate`)
- Story 1-9 added a Keycloak fast path to `authController.js` `getCurrentUser()` that checks `req.user.iss_sub` before legacy userId lookup
- Story 1-9 migrated from jose v5 to v6 (`createRemoteJWKS` → `createRemoteJWKSet`)
- Story 1-9 made `KEYCLOAK_URL` a required env var (was hardcoded to Docker internal URL)
- The `authController.js` and `auth-routes.js` files already have a mix of legacy and Keycloak code — this story completes the cleanup

**Lessons from all previous stories (1-1 through 1-9):**
- Backend auth middleware (`keycloak-auth-middleware.js`) validates Keycloak tokens via JWKS — this is the ONLY auth middleware that should remain
- Frontend OIDC service (`keycloakAuthService.js`) handles all auth flows — the old `authService.js` should be deleted
- The old `authMiddleware.authenticate` (HS256 via `jwt.verify(token, JWT_SECRET)`) is completely superseded by `keycloakAuthMiddleware.authenticate` (RS256 via OIDC discovery/JWKS)
- All 70 backend tests and 87 frontend tests currently pass — after this story, the test counts may change (legacy tests removed)
- The standardized error response format (Story 1-8) and auth service unavailability handling (Story 1-9) are in the new Keycloak middleware

### Testing Strategy

**This story involves significant code deletion — testing focuses on:**

1. **Existing Keycloak auth tests pass unchanged:**
   - `cd components/gov-chat-backend && npx jest --verbose` — keycloak-auth-service.test.js and keycloak-auth-middleware.test.js must pass
   - `cd components/gov-chat-frontend && npx jest` — keycloakAuthService.test.js and oidcConfig.test.js must pass

2. **No broken imports:**
   - The backend must start without errors (`node index.js`)
   - The frontend must build without errors (`npm run build` or `npm run serve`)
   - Grep for any remaining references to deleted files: `grep -rn 'auth-service\|auth-middleware\|authMiddleware\|authService' components/`

3. **No legacy endpoints accessible:**
   - Verify `POST /api/auth/login` returns 404 (not 200 or 500)
   - Verify `POST /api/auth/register` returns 404
   - Verify `GET /api/auth/me` still works (with valid Keycloak token)

4. **Migration safety:**
   - All 12 route files that used `authMiddleware.authenticate` now use `keycloakAuthMiddleware.authenticate`
   - No code reads `req.user.userId`, `req.user.loginName`, or `req.user.role` (old shape) — must use `req.user.iss_sub`, `req.user.sub`, `req.user.roles` (new shape)

### Backend Conventions (from project-context.md)

- **CommonJS only**: `const x = require('x')` and `module.exports = { ... }`
- Never use `import`/`export` syntax
- `const` by default, `let` for reassignments, never `var`
- 2-space indentation, single quotes, semicolons
- Documentation: English only (per CLAUDE.md language policy)
- Auth middleware: per-route, not global

### Project Structure Notes

**Files to DELETE:**

Backend (5 files):
| File | Lines | Purpose |
|------|-------|---------|
| `components/gov-chat-backend/services/auth-service.js` | 935 | Legacy auth service (bcrypt, JWT HS256, email verification) |
| `components/gov-chat-backend/middleware/auth-middleware.js` | 286 | Legacy auth middleware (JWT_SECRET-based) |
| `components/gov-chat-backend/scripts/old-schema-scripts/debug-auth-service.js` | ~200 | Legacy debug script |
| `components/gov-chat-backend/scripts/old-schema-scripts/update-passwords.js` | ~130 | Legacy password utility |
| `components/gov-chat-backend/scripts/old-schema-scripts/reset-all-user-passwords.js` | ~90 | Legacy bulk password reset |

Frontend (13 files):
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/LoginScreen.vue` | ~230 | Legacy login form |
| `src/components/RegisterScreen.vue` | ~170 | Legacy registration form |
| `src/components/PasswordResetInitiateScreen.vue` | ~280 | Legacy password reset initiation |
| `src/components/PasswordResetConfirmScreen.vue` | ~510 | Legacy password reset confirmation |
| `src/components/EmailVerificationScreen.vue` | ~100 | Legacy email verification |
| `src/views/LoginView.vue` | ~30 | Legacy login view wrapper |
| `src/views/RegisterView.vue` | ~35 | Legacy registration view wrapper |
| `src/services/authService.js` | 386 | Legacy frontend auth service |
| `src/services/passwordService.js` | 243 | Legacy password service |
| `src/services/tests/authServiceTest.js` | ~270 | Legacy auth tests |
| `src/services/tests/testPassword.js` | ~250 | Legacy password tests |
| `src/services/tests/testPasswordService.js` | ~280 | Legacy password service tests |

**Files to MODIFY:**

Backend (16+ files):
| File | Change |
|------|--------|
| `components/gov-chat-backend/index.js` | Remove authService init, remove JWT_SECRET/SESSION_SECRET from requiredSecrets |
| `components/gov-chat-backend/routes/auth-routes.js` | Rewrite: remove factory pattern, delete 10 legacy endpoints, keep /me and /logout |
| `components/gov-chat-backend/controllers/authController.js` | Rewrite: remove legacy handlers, keep getCurrentUser (Keycloak only) and logout (simplified) |
| `components/gov-chat-backend/routes/service-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/user-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/logger-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/database-operations-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/translation-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/chat-history-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/query-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/weather-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/session-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/service-category-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/admin-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/analytics-routes.js` | Replace authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/services/user-profile-service.js` | Remove auth-service import and verifyPassword call |

Frontend (4 files):
| File | Change |
|------|--------|
| `src/router/index.js` | Remove LoginScreen and PasswordResetConfirmScreen imports/routes |
| `src/components/SettingsComponent.vue` | Remove PasswordResetInitiateScreen import and usage |
| `src/components/UserEditDialog.vue` | Remove initiatePasswordReset call if present |
| `src/services/userService.js` | Remove initiatePasswordReset method if no longer needed |

Config (1 file):
| File | Change |
|------|--------|
| `env` | Remove JWT_SECRET, check SESSION_SECRET |

Dependencies (1 file):
| File | Change |
|------|--------|
| `components/gov-chat-backend/package.json` | Remove bcrypt, jsonwebtoken if unused |

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.11] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Removed files (local auth)] — Lists files to be removed
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries] — Detailed file-by-file changes for both backend and frontend
- [Source: _bmad-output/planning-artifacts/architecture.md#Gap Analysis] — "auth-service.js (935 lines) must be audited before deletion — reusable utility functions may exist"
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Handoff] — "Audit auth-service.js for reusable functions before removal"
- [Source: _bmad-output/project-context.md] — Backend conventions (CommonJS, Jest, naming)
- [Source: _bmad-output/implementation-artifacts/1-9-external-idp-connection-via-keycloak-only.md] — Previous story — auth-routes.js and authController.js already partially migrated
- [Source: components/gov-chat-backend/index.js#L658] — JWT_SECRET and SESSION_SECRET in requiredSecrets
- [Source: components/gov-chat-backend/index.js#L729-980] — authService initialization and auth-routes registration

## Dev Agent Record

### Agent Model Used

GLM-5-Turbo (Claude Code CLI)

### Debug Log References

N/A

### Completion Notes List

1. All 12 tasks completed. Legacy auth system fully removed — Keycloak is now the sole authentication path.
2. Task 1: Audited auth-service.js (935 lines) — zero reusable utilities found. All functions tightly coupled to legacy local auth (HS256 JWT, bcrypt, email verification).
3. Task 2: Migrated 12 route files from authMiddleware to keycloakAuthMiddleware. Added `requireAdmin` function to keycloak-auth-middleware.js. Fixed `req.user` shape references (userId→iss_sub, role→roles) in user-routes.js and chat-history-routes.js.
4. Tasks 3-4: Rewrote auth-routes.js (511→49 lines) and authController.js (365→50 lines). Only `/me` and `/logout` endpoints remain.
5. Task 5: Deleted auth-service.js (935 lines) and auth-middleware.js (286 lines).
6. Task 6: Cleaned index.js — removed authService import, serviceMap entry, preInit setup, requiredSecrets (JWT_SECRET, SESSION_SECRET). Updated auth-routes registration for plain router export.
7. Task 7: Removed auth-service dependency from user-profile-service.js (import + verifyPassword method).
8. Task 8: Deleted 12 frontend files, updated 6 files (router, SettingsComponent, UserEditDialog, userService, RightSideBarComponent, RegistrationSuccessScreen).
9. Task 9: Removed JWT_SECRET and SESSION_SECRET from env template.
10. Task 10: Uninstalled bcrypt and jsonwebtoken from package.json (45 packages removed).
11. Task 11: Deleted 4 legacy schema scripts.
12. Task 12: 70/70 backend + 87/87 frontend tests pass. Updated 2 test cases for removed public paths.

### File List

**Files DELETED (backend):**
| File | Lines |
|------|-------|
| `components/gov-chat-backend/services/auth-service.js` | 935 |
| `components/gov-chat-backend/middleware/auth-middleware.js` | 286 |
| `components/gov-chat-backend/scripts/old-schema-scripts/debug-auth-service.js` | ~200 |
| `components/gov-chat-backend/scripts/old-schema-scripts/update-passwords.js` | ~130 |
| `components/gov-chat-backend/scripts/old-schema-scripts/reset-all-user-passwords.js` | ~90 |
| `components/gov-chat-backend/scripts/old-schema-scripts/update-schema.js` | ~210 |

**Files DELETED (frontend):**
| File | Lines |
|------|-------|
| `components/gov-chat-frontend/src/components/LoginScreen.vue` | ~230 |
| `components/gov-chat-frontend/src/components/RegisterScreen.vue` | ~170 |
| `components/gov-chat-frontend/src/components/PasswordResetInitiateScreen.vue` | ~280 |
| `components/gov-chat-frontend/src/components/PasswordResetConfirmScreen.vue` | ~510 |
| `components/gov-chat-frontend/src/components/EmailVerificationScreen.vue` | ~100 |
| `components/gov-chat-frontend/src/views/LoginView.vue` | ~30 |
| `components/gov-chat-frontend/src/views/RegisterView.vue` | ~35 |
| `components/gov-chat-frontend/src/services/passwordService.js` | 243 |
| `components/gov-chat-frontend/src/services/authService.js` | 386 |
| `components/gov-chat-frontend/src/services/tests/authServiceTest.js` | ~270 |
| `components/gov-chat-frontend/src/services/tests/testPassword.js` | ~250 |
| `components/gov-chat-frontend/src/services/tests/testPasswordService.js` | ~280 |

**Files MODIFIED (backend):**
| File | Change |
|------|--------|
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Added `requireAdmin()`, removed `/api/auth/login` and `/api/auth/register` from PUBLIC_PATHS |
| `components/gov-chat-backend/routes/auth-routes.js` | Rewritten: removed factory pattern, 10 legacy endpoints deleted, only `/me` and `/logout` remain |
| `components/gov-chat-backend/controllers/authController.js` | Rewritten: removed class + 10 legacy handlers, only `getCurrentUser` and `logout` remain |
| `components/gov-chat-backend/routes/*.js` (12 files) | Migrated authMiddleware → keycloakAuthMiddleware |
| `components/gov-chat-backend/routes/user-routes.js` | Fixed req.user shape (userId→iss_sub, role→roles) |
| `components/gov-chat-backend/routes/chat-history-routes.js` | Fixed req.user.userId → req.user.iss_sub |
| `components/gov-chat-backend/index.js` | Removed authService init, serviceMap, preInit, requiredSecrets |
| `components/gov-chat-backend/services/user-profile-service.js` | Removed auth-service import + verifyPassword method |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | Updated 2 tests for removed public paths |
| `components/gov-chat-backend/package.json` | Removed bcrypt, jsonwebtoken dependencies |

**Files MODIFIED (frontend):**
| File | Change |
|------|--------|
| `components/gov-chat-frontend/src/router/index.js` | Removed login/reset-password routes |
| `components/gov-chat-frontend/src/components/SettingsComponent.vue` | Removed PasswordResetInitiateScreen |
| `components/gov-chat-frontend/src/components/UserEditDialog.vue` | Removed password reset button |
| `components/gov-chat-frontend/src/services/userService.js` | Removed initiatePasswordReset method |
| `components/gov-chat-frontend/src/components/RightSideBarComponent.vue` | Migrated authService → userService |
| `components/gov-chat-frontend/src/components/RegistrationSuccessScreen.vue` | Migrated authService → userService |

**Files MODIFIED (config):**
| File | Change |
|------|--------|
| `env` | Removed JWT_SECRET and SESSION_SECRET entries |
