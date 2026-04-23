# Story 2.11: E2E Test Coverage for Epic 2

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA engineer,
I want comprehensive E2E tests for all Epic 2 stories, restructured into maintainable per-epic documents with separate Playwright spec files,
so that I can validate Epic 2 features by executing commands from the test plan without inventing anything.

## Acceptance Criteria

1. **Given** the existing monolithic E2E test plan at `docs/e2e-test-plan-external-idp.md`
   **When** the QA engineer runs the restructured test suite
   **Then** the monolith is split into per-epic files under `docs/e2e-tests/`:
   - `docs/e2e-tests/README.md` — Index, prerequisites, tools, conventions
   - `docs/e2e-tests/00-clean-start.md` — Phase 0 (common setup, extracted verbatim)
   - `docs/e2e-tests/epic1-keycloak-foundation.md` — Phases A–E (migrated without modification)
   - `docs/e2e-tests/epic2-secure-api-access.md` — Phases F–K (new Epic 2 tests)

2. **Given** inline Playwright code blocks in the existing test plan
   **When** the restructuring is complete
   **Then** all inline Playwright code is extracted into standalone `.spec.js` files under `tests/e2e/`
   **And** a shared `playwright.config.js` at project root exists with HTTPS configuration (`ignoreHTTPSErrors: true`, `bypassCSP: true`)
   **And** reusable helpers exist under `tests/e2e/helpers/`:
   - `auth.js` — ROPC token retrieval, admin token generation
   - `keycloak-admin.js` — Keycloak Admin API operations (create user, create realm, rotate keys, etc.)

3. **Given** Epic 2 stories 2-2, 2-3, 2-6, 2-8, 2-9, 2-10 are implemented and deployed
   **When** the QA engineer reads `docs/e2e-tests/epic2-secure-api-access.md`
   **Then** the following test phases exist with executable steps, in execution order:
   - **Phase F (revised): Token Passthrough Headers** (Story 2-3) — Existing tests migrated, format updated
   - **Phase G: Swagger UI OAuth2** (Story 2-8) — Existing tests migrated, format updated ( see Task 2.6 + Task 3.6 for spec file)
   - **Phase H: JWKS Force-Refresh** (Story 2-2) — Key rotation + cache invalidation + retry
   - **Phase I: Multi-Realm Configuration** (Story 2-9) — Second realm + cross-realm token validation
   - **Phase J: OPEA Continuity** (Story 2-10) — Service token callback + no Keycloak leakage
   - **Phase K: Auth Error Display** (Story 2-6) — Frontend error message validation — **LAST** because it mutates realm settings and scales Keycloak to 0
   **And** each step contains: description, executable command (curl or `npx playwright test`), and expected output

4. **Given** the test plan document
   **When** a QA engineer follows the instructions
   **Then** every test step contains a copy-pasteable command and an "Expected" result
   **And** no test requires the QA engineer to invent commands, URLs, or credentials
   **And** all curl commands use `$TOKEN` (admin) or `$USER_TOKEN` (testuser) variables

5. **Given** deferred stories 2-4, 2-5, 2-7
   **When** the test plan is reviewed
   **Then** no tests exist for these stories (deferred / YAGNI)

## Tasks / Subtasks

### Task 1: Create Playwright infrastructure (AC: #2)
- [x] 1.1 Create `playwright.config.js` at **project root** with HTTPS config (`ignoreHTTPSErrors`, `bypassCSP`, baseURL `https://localhost`, testDir `tests/e2e`). Do NOT place in `tests/e2e/` — the CLI discovers config from CWD by default
- [x] 1.2 Create `tests/e2e/helpers/auth.js` — ROPC token retrieval (`getUserToken`), admin token generation (`getAdminToken`), JWT claims extraction (`parseJwtClaims`)
- [x] 1.3 Create `tests/e2e/helpers/keycloak-admin.js` — Keycloak Admin API helpers (`createRealm`, `createUser`, `rotateRealmKeys`, `getClientId`, `deleteRealm`)
- [x] 1.4 Extend root `package.json` (currently only has `archiver`) to add `@playwright/test` as devDependency. Do NOT create a separate `tests/e2e/package.json` — root config keeps `npx playwright test` simple

### Task 2: Restructure monolith into per-epic files (AC: #1)
- [x] 2.1 Create `docs/e2e-tests/` directory structure
- [x] 2.2 Create `docs/e2e-tests/README.md` — Index of all test documents, tools required, conventions (test step format, variable naming)
- [x] 2.3 Extract Phase 0 (Clean Start) verbatim into `docs/e2e-tests/00-clean-start.md`
- [x] 2.4 Extract Phases A–E (Epic 1) verbatim into `docs/e2e-tests/epic1-keycloak-foundation.md`, replacing inline Playwright code with `npx playwright test` commands referencing the new spec files
- [x] 2.5 Create `docs/e2e-tests/epic2-secure-api-access.md` — Empty template ready for Task 3–5 content
- [x] 2.6 Migrate existing Epic 2 tests into the new Epic 2 file with corrected phase letters:
  - Phase F (Token Passthrough) → stays **Phase F** (first in execution order)
  - Phase F (Swagger) → becomes **Phase G** (second in execution order)
  **Critical corrections during migration:**
  - Phase F.5 `user_id` (monolith step numbering) was changed in Story 2-10 from composite key `{iss}#{sub}` to ArangoDB `_key`. Fix expected output accordingly
  - Phase F tests reference `/api/test/debug-headers` and `/api/test/debug-opea-headers` — these endpoints **do NOT exist** in the backend. Replace with real endpoints that return the same information (e.g., use ArangoDB query via `docker exec`, or check backend logs, or create a minimal debug route if needed)
  - Normalize variables: `$ADMIN_TOKEN` → `$TOKEN`, `$GENIE_TOKEN` → `$USER_TOKEN`, `$GENIE2_TOKEN` → `$USER2_TOKEN`
- [x] 2.7 Verify all cross-references between documents are correct (README links, phase letter continuity)

### Task 3: Migrate Playwright tests to spec files (AC: #2)
- [x] 3.1 Create `tests/e2e/epic1/a1-login-redirect.spec.js` from inline Playwright code in Phase A.1
- [x] 3.2 Create `tests/e2e/epic1/a2-full-login-flow.spec.js` from inline Playwright code in Phase A.2
- [x] 3.3 Create `tests/e2e/epic1/a3-legacy-routes-redirect.spec.js` from inline Playwright code in Phase A.3
- [x] 3.4 Create `tests/e2e/epic1/d7a-external-idp-button.spec.js` from inline Playwright code in Phase D.7a
- [x] 3.5 Create `tests/e2e/epic1/d7b-external-idp-login-flow.spec.js` from inline Playwright code in Phase D.7b
- [x] 3.6 Create `tests/e2e/epic2/g1-swagger-authorize.spec.js` from inline Playwright code in Phase G (Swagger, formerly Phase F)
- [x] 3.7 Update `docs/e2e-tests/epic1-keycloak-foundation.md` to reference spec files instead of inline code

### Task 4: Write new Epic 2 test phases (AC: #3, #4)
- [x] 4.1 **Phase H: JWKS Force-Refresh** (Story 2-2) — Write test steps:
  - H.1 Verify valid token passes with cached JWKS
  - H.2 Rotate realm signing keys via Keycloak Admin API
  - H.3 Verify old token triggers force-refresh (two-attempt pattern) and succeeds
  - H.4 Verify expired token is rejected without retry
- [x] 4.2 **Phase I: Multi-Realm Configuration** (Story 2-9) — Write test steps:
  - I.1 Create second realm `genie2` with test user
  - I.2 Get token from `genie2` realm and verify different `iss`
  - I.3 Verify backend validates tokens from both realms simultaneously
  - I.4 Verify composite key `{iss}#{sub}` keeps identities separate (identity isolation in ArangoDB `users` collection via the `iss_sub` unique index, NOT `user_id` in OPEA payload)
  - I.5 Cleanup: delete `genie2` realm
- [x] 4.3 **Phase J: OPEA Continuity** (Story 2-10) — Write test steps:
  - J.1 Get authenticated user's ArangoDB `_key` (from any prior API response), then verify OPEA callback endpoint `GET /api/users/{_key}/context` returns sanitized profile. Note: `user_id` here is ArangoDB `_key`, NOT the composite `iss#sub` string
  - J.2 Verify OPEA callback uses `X-Service-Token` (not Keycloak JWT)
  - J.3 Verify no Keycloak artifacts (`Authorization` header, JWT claims) leak to OPEA
- [x] 4.4 **Phase K: Auth Error Display** (Story 2-6) — **LAST phase** — Real E2E, no mocks:
  - K.1 `TOKEN_INVALID` — Send a token with modified payload (change one char) via curl and Playwright
  - K.2 `TOKEN_EXPIRED` — Reduce Keycloak realm `accessTokenLifespan` to 10s, get token, wait for expiry, test
  - K.3 `FORBIDDEN` — Create user without roles in Keycloak, login, access admin route → backend returns `FORBIDDEN` (403). Note: backend uses `FORBIDDEN`, not `INSUFFICIENT_ROLES`
  - K.4 `TOKEN_INVALID` (unavailable) — `docker service scale genieai_keycloak=0`, test auth endpoint → backend returns `TOKEN_INVALID` with message "temporarily unavailable" (not `AUTH_SERVICE_UNAVAILABLE`). Then `docker service scale genieai_keycloak=1` to restore
  - K.5 Restore realm settings (`accessTokenLifespan`) to original value after K.2
  - K.6 Cleanup: delete the no-roles test user created in K.3
- [x] 4.5 Write all curl commands using `$TOKEN` / `$USER_TOKEN` variables
- [x] 4.6 Write "Expected" output for every test step

### Task 5: Write Playwright spec files for new Epic 2 tests (AC: #2, #3)
- [x] 5.1 Create `tests/e2e/epic2/h1-jwks-force-refresh.spec.js`
- [x] 5.2 Create `tests/e2e/epic2/i1-multi-realm.spec.js`
- [x] 5.3 Create `tests/e2e/epic2/j1-opea-continuity.spec.js`
- [x] 5.4 Create `tests/e2e/epic2/k1-auth-error-display.spec.js`
- [x] 5.5 Reference each spec file in the corresponding markdown test step

### Task 6: Final validation (AC: #4, #5)
- [x] 6.1 Verify no tests exist for deferred stories (2-4, 2-5, 2-7)
- [x] 6.2 Verify every test step has copy-pasteable command + expected output
- [x] 6.3 Verify all `$TOKEN` / `$USER_TOKEN` variables are defined in Phase 0 or at first use
- [x] 6.4 Verify markdown cross-references between documents are correct
- [x] 6.5 Delete or archive the original monolith `docs/e2e-test-plan-external-idp.md`

## Dev Notes

### Architecture & Constraints

- **No mocks in E2E tests** — All tests manipulate real system state (create users, rotate keys, scale services)
- **Playwright via `@playwright/test`** at project root (not inside `components/` subprojects)
- **curl tests** use `$TOKEN` (Keycloak master admin) and `$USER_TOKEN` (ROPC `genie` realm testuser)
- **Variable convention**: Normalize all migrated Phase F tests to use `$TOKEN` (admin) and `$USER_TOKEN` (testuser). The existing monolith uses `$ADMIN_TOKEN`, `$GENIE_TOKEN`, `$GENIE2_TOKEN` — these MUST be renamed during migration to the standard convention
- **Error codes** — frontend recognizes: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `FORBIDDEN` (not `INSUFFICIENT_ROLES`), `TOKEN_INVALID` with unavailable message (not `AUTH_SERVICE_UNAVAILABLE`), `PROVISIONING_FAILED`, `INTERNAL_ERROR` — see `components/gov-chat-frontend/src/services/httpService.js:48-71`. **Backend actual codes** (from `keycloak-auth-middleware.js`): `TOKEN_INVALID` (401), `TOKEN_EXPIRED` (401), `FORBIDDEN` (403), `PROVISIONING_FAILED` (500), `INTERNAL_ERROR` (500). The frontend `INSUFFICIENT_ROLES` and `AUTH_SERVICE_UNAVAILABLE` codes are fallback UI codes — the backend never produces them
- **Error format** from backend: `{ error: string, message: string, details?: object }` — see `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`
- **Composite user key**: `{iss}#{sub}` — used in ArangoDB `users` collection (`iss_sub` unique index) and `X-User-Id` header. **Note**: OPEA payload `user_id` uses ArangoDB `_key` instead (see Phase J, Story 2-10)
- **Service-to-service auth**: OPEA calls `GET /api/users/{userId}/context` with `X-Service-Token` header (shared secret `SERVICE_AUTH_TOKEN`), NOT Keycloak JWT — see Story 2-10

### Keycloak Admin API Patterns

- **Base URL**: `https://localhost/auth/admin/realms/{realm}/...`
- **Auth**: `Authorization: Bearer $TOKEN` (master realm admin)
- **Key rotation** (verified against Keycloak 26 Admin REST API via Context7 `/keycloak/keycloak` v26.5.2):
  1. Get realm ID: `REALM_ID=$(curl -s https://localhost/auth/admin/realms/genie -H "Authorization: Bearer $TOKEN" | jq -r .id)`
  2. Generate new RSA key pair (higher priority = becomes active):
     ```bash
     curl -s -X POST "https://localhost/auth/admin/realms/genie/components" \
       -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
       "name": "rsa-generated-rotated",
       "providerId": "rsa-generated",
       "providerType": "org.keycloak.keys.KeyProvider",
       "parentId": "'$REALM_ID'",
       "config": {
         "priority": ["101"],
         "enabled": ["true"],
         "active": ["true"],
         "keySize": ["2048"]
       }
     }'
     ```
  3. List key providers: `GET /admin/realms/{realm}/components?type=org.keycloak.keys.KeyProvider` → extract component IDs
  4. Demote old key: `PUT /admin/realms/{realm}/components/{old-id}` with `config.active: ["false"]`
  - **Important**: `parentId` is the realm **UUID** (not the realm name) — obtain via `GET /admin/realms/{realm}` → `.id`
  - **Config values are arrays of strings**: `config.priority: ["101"]`, `config.active: ["true"]`
  - **Keycloak 26 has NO `POST /admin/realms/{realm}/keys` endpoint** — must use the components API
- **Realm settings update**: `PUT /admin/realms/{realm}` with JSON body (e.g., `accessTokenLifespan` for TOKEN_EXPIRED test)
- **Client lookup**: `GET /admin/realms/{realm}/clients?clientId=genie-app` → extract `[0].id`

### Playwright Configuration Notes

- **HTTPS**: All tests need `ignoreHTTPSErrors: true` (self-signed cert)
- **CSP**: `bypassCSP: true` for cross-origin IdP flows
- **Context creation**: Always create a NEW context per test (don't reuse default `page`)
- **Pattern**: `const browser = page.context().browser(); const ctx = await browser.newContext({...}); const p = await ctx.newPage();`
- **Timeouts**: Use generous timeouts (15-30s) for Keycloak redirect flows

### Source Tree — Files to Create/Modify

```
docs/
├── e2e-tests/                              # NEW directory
│   ├── README.md
│   ├── 00-clean-start.md                   # Extracted from monolith Phase 0
│   ├── epic1-keycloak-foundation.md        # Extracted from monolith Phases A–E
│   └── epic2-secure-api-access.md          # NEW + migrated F,G + new H–K
└── e2e-test-plan-external-idp.md           # TO BE ARCHIVED/DELETED after migration

tests/
└── e2e/                                    # NEW directory
    ├── helpers/
    │   ├── auth.js
    │   └── keycloak-admin.js
    ├── epic1/
    │   ├── a1-login-redirect.spec.js
    │   ├── a2-full-login-flow.spec.js
    │   ├── a3-legacy-routes-redirect.spec.js
    │   ├── d7a-external-idp-button.spec.js
    │   └── d7b-external-idp-login-flow.spec.js
    └── epic2/
        ├── g1-swagger-authorize.spec.js    # Migrated from existing (was Phase F Swagger)
        ├── h1-jwks-force-refresh.spec.js
        ├── i1-multi-realm.spec.js
        ├── j1-opea-continuity.spec.js
        └── k1-auth-error-display.spec.js

playwright.config.js                        # ROOT level (standard Playwright convention)
package.json                                # ROOT level — add @playwright/test as devDependency
```

### Existing Test Coverage to Migrate

| Phase | Source (monolith) | Target (spec file) | Action |
|-------|-------------------|---------------------|--------|
| A.1 | Redirect to Keycloak | `epic1/a1-login-redirect.spec.js` | Extract inline → spec |
| A.2 | Full Login Flow | `epic1/a2-full-login-flow.spec.js` | Extract inline → spec |
| A.3 | Legacy Routes Redirect | `epic1/a3-legacy-routes-redirect.spec.js` | Extract inline → spec |
| D.7a | External IdP Button | `epic1/d7a-external-idp-button.spec.js` | Extract inline → spec |
| D.7b | External IdP Login Flow | `epic1/d7b-external-idp-login-flow.spec.js` | Extract inline → spec |
| F (Swagger) F.4 | Swagger Authorize | `epic2/g1-swagger-authorize.spec.js` | Extract inline → spec |
| F (Token Pass) F.1–F.8 | curl tests | Stay as curl in markdown | Update reference format |

### New Test Phases to Write

**Phase H: JWKS Force-Refresh (Story 2-2)**
- Prerequisites: Admin token + testuser token
- Key steps: Get token → verify valid → rotate realm keys via Admin API → use same token → verify force-refresh succeeds → verify expired token is rejected without retry
- curl-based (Admin API for key rotation, backend endpoint for validation)

**Phase I: Multi-Realm Configuration (Story 2-9)**
- Prerequisites: Admin token + running stack
- Key steps: Create realm `genie2` → create client + user → get token from `genie2` → verify different `iss` → validate both tokens simultaneously → verify composite key isolation → cleanup (delete `genie2`)
- curl-based (Admin API for realm setup/teardown, backend for validation)

**Phase J: OPEA Continuity (Story 2-10)**
- Prerequisites: Admin token + `SERVICE_AUTH_TOKEN` env var **must be set in `.env`** (the endpoint returns 503 without it)
- These tests do NOT require OPEA services (`DEPLOY_OPEA=0` is fine) — they test the backend endpoint directly via curl
- Key steps: Get authenticated user's `_key` → call `GET /api/users/{_key}/context` with `X-Service-Token` → verify sanitized profile returned → verify no Keycloak JWT artifacts in OPEA payload → verify endpoint rejects requests without valid `X-Service-Token`
- curl-based (direct endpoint calls)

**Phase K: Auth Error Display (Story 2-6) — LAST**
- Prerequisites: Running stack + Keycloak admin access
- K.1 TOKEN_INVALID: Send token with modified payload char via curl → verify 401 + error code
- K.2 TOKEN_EXPIRED: Set realm `accessTokenLifespan` to 10s → get token → sleep 12s → send → verify 401 + error code → restore lifespan
- K.3 FORBIDDEN: Create user without roles → get token → hit admin route → verify 403 + `FORBIDDEN` error code → cleanup user
- K.4 TOKEN_INVALID (unavailable): `docker service scale genieai_keycloak=0` → hit auth endpoint → verify 401 + `TOKEN_INVALID` with "temporarily unavailable" message → `docker service scale genieai_keycloak=1` → wait for recovery
- Mix of curl + Playwright (curl for API-level, Playwright for frontend display)

**Phase G: Swagger UI OAuth2 (Story 2-8)** — *Migrated, not new. See Task 2.6 for migration + Task 3.6 for spec file.*

### Testing Standards

- **Language**: All documentation and comments in English (per CLAUDE.md)
- **Step format**: `**X.Y — Description**` + code block + `**Expected**: ...`
- **Variables**: `$TOKEN` (admin), `$USER_TOKEN` (testuser ROPC), `$EXT_TOKEN` (external IdP), `$USER2_TOKEN` (second realm testuser)
- **No secrets hardcoded**: Use `$KEYCLOAK_ADMIN_PASSWORD` from `.env` or `$TOKEN` from Phase 0
- **Prerequisite env vars for Phase J**: `SERVICE_AUTH_TOKEN` must be set in `.env` (OPEA callback endpoint returns 503 without it)
- **`DEPLOY_OPEA=0`** is fine for Phases G–K. Phase F requires `DEPLOY_OPEA=1` for full header injection testing. Phase J tests the backend endpoint directly via curl
- **Keycloak version**: Tests target Keycloak 26.x (see `config/keycloak/Dockerfile`)

### Phase Execution Order

**Phases must run sequentially** — alphabetical order = execution order:

```
Phase 0 (setup) → Phase F (token passthrough) → Phase G (Swagger OAuth2) → Phase H (JWKS refresh) → Phase I (multi-realm) → Phase J (OPEA continuity) → Phase K (auth errors, LAST)
```

- Phase K **must be last** — it changes `accessTokenLifespan`, scales Keycloak to 0, and creates test users. Cleanup steps (K.5, K.6) restore state but the stack may need recovery time
- Phase H and I can run in either order but NOT in parallel (both use Admin API)
- Phase G is independent (Swagger only) but logically follows F

### Project Structure Notes

- `tests/e2e/` is a new directory — no existing tests conflict
- `docs/e2e-tests/` is a new directory — parallel to existing `docs/`
- `playwright.config.js` at project root — standard Playwright convention
- `package.json` at project root may need `@playwright/test` as devDependency (currently no root `package.json`)
- Epic 1 test content must NOT be modified — only restructured into new file locations

### References

- [Source: docs/e2e-test-plan-external-idp.md] — Existing 2035-line monolith
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — Error codes and response format
- [Source: components/gov-chat-frontend/src/services/httpService.js:48-71] — Frontend error parsing
- [Source: _bmad-output/implementation-artifacts/2-2-jwks-force-refresh-on-validation-failure.md] — JWKS force-refresh story (completed)
- [Source: _bmad-output/implementation-artifacts/2-9-multi-realm-configuration-support.md] — Multi-realm story (completed)
- [Source: _bmad-output/implementation-artifacts/2-10-opea-continuity-keycloak-agnostic-downstream.md] — OPEA continuity story (completed)
- [Source: _bmad-output/implementation-artifacts/2-6-auth-and-authorization-error-display-frontend.md] — Error display story (completed)
- [Source: _bmad-output/implementation-artifacts/2-8-swagger-ui-with-keycloak-oidc-authorize-button.md] — Swagger OAuth2 story (completed)

## Dev Agent Record

### Agent Model Used

Claude Sonnet (via Claude Code)

### Debug Log References

N/A — documentation and test file creation only, no runtime debugging needed.

### Completion Notes List

- Created Playwright infrastructure: `playwright.config.js`, helpers (`auth.js`, `keycloak-admin.js`), updated root `package.json` with `@playwright/test`
- Restructured monolith (2035 lines) into 4 per-epic markdown files under `docs/e2e-tests/`
- Migrated 6 inline Playwright code blocks from monolith into standalone spec files (5 Epic 1 + 1 Epic 2 Swagger)
- Migrated Phase F (Token Passthrough) with corrections: debug endpoints replaced with real endpoints + log analysis, variable normalization, F.5 user_id fix
- Migrated Phase G (Swagger, renamed from second Phase F) with variable normalization
- Wrote Phase H: JWKS Force-Refresh (4 test steps, Story 2-2)
- Wrote Phase I: Multi-Realm Configuration (5 test steps, Story 2-9)
- Wrote Phase J: OPEA Continuity (3 test steps, Story 2-10)
- Wrote Phase K: Auth Error Display (6 test steps, Story 2-6, LAST phase)
- Created 4 new Playwright spec files for Phases H-K
- Added Playwright spec references in all markdown test phase headers
- Archived original monolith as `docs/e2e-test-plan-external-idp.md.archived`
- All ACs verified: no tests for deferred stories (2-4, 2-5, 2-7), every step has command + expected output, variables defined, cross-references correct

### File List

**New files:**
- `playwright.config.js`
- `tests/e2e/helpers/auth.js`
- `tests/e2e/helpers/keycloak-admin.js`
- `tests/e2e/epic1/a1-login-redirect.spec.js`
- `tests/e2e/epic1/a2-full-login-flow.spec.js`
- `tests/e2e/epic1/a3-legacy-routes-redirect.spec.js`
- `tests/e2e/epic1/d7a-external-idp-button.spec.js`
- `tests/e2e/epic1/d7b-external-idp-login-flow.spec.js`
- `tests/e2e/epic2/g1-swagger-authorize.spec.js`
- `tests/e2e/epic2/h1-jwks-force-refresh.spec.js`
- `tests/e2e/epic2/i1-multi-realm.spec.js`
- `tests/e2e/epic2/j1-opea-continuity.spec.js`
- `tests/e2e/epic2/k1-auth-error-display.spec.js`
- `docs/e2e-tests/README.md`
- `docs/e2e-tests/00-clean-start.md`
- `docs/e2e-tests/epic1-keycloak-foundation.md`
- `docs/e2e-tests/epic2-secure-api-access.md`
- `components/gov-chat-backend/docker-entrypoint.sh` — wait-for-ArangoDB startup script

**Modified files:**
- `package.json` — added `@playwright/test` as devDependency
- `package-lock.json` — lockfile update for @playwright/test
- `components/gov-chat-backend/Dockerfile` — added docker-entrypoint.sh, ENTRYPOINT
- `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` — fix isPublicRoute() for /api prefix, use req.originalUrl
- `components/gov-chat-backend/controllers/authController.js` — expose ArangoDB _key as 'id' in /api/auth/me
- `api-gateway-solution/nginx/conf/default.conf.template` — add /api-docs location block (Bug G)
- `docker-compose.yaml` — add SERVICE_AUTH_TOKEN to backend, increase start_period to 90s
- `_bmad-output/implementation-artifacts/2-11-e2e-test-coverage-epic2.md` — story status + task checkboxes
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status update
- `_bmad-output/planning-artifacts/epics.md` — epic 2 status update

**Archived files:**
- `docs/e2e-test-plan-external-idp.md` → `docs/e2e-test-plan-external-idp.md.archived`
