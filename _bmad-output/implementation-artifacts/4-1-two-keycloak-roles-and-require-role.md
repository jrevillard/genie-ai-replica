# Story 4.1: Two Keycloak roles + `requireRole()`

Status: ready-for-dev

## Story

As a platform administrator,
I want `tools-admin` and `tools-reader` realm roles enforced at the route level on `/api/admin/tools/*`,
so that tool/feed configuration is mutable only by authorized admins while FOI auditors (`tools-reader`) retain read access (NFR8, NFR10).

## Current State (verified on `feat/sst` 2026-08-31 — this story is a FINISH, not a greenfield)

- ✅ **Realm roles already exist**: `configs/keycloak/genie-realm.yaml:46-48` defines `tools-admin` and `tools-reader` (alongside `admin`, `dataprep-service`). No yaml change needed.
- ❌ **No `requireRole(...)` exists**: `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` has only `requireAdmin` (lines 178–194), hardcoded to the single role `admin`.
- ❌ **Routes use the wrong guard**: `components/gov-chat-backend/routes/tools-routes.js:19` applies `router.use(keycloakAuthMiddleware.requireAdmin)` to **all** tools routes. Consequences today:
  - a `tools-admin` holder **cannot write** (only legacy `admin` passes) — epic AC fails;
  - a `tools-reader` holder gets 403 on **reads too** — breaks the NFR8 FOI read path.

## Acceptance Criteria

1. `requireRole(...allowedRoles)` middleware factory exists in `keycloak-auth-middleware.js`, reading fresh JWT claims (`req.claims.realm_access.roles` — same source as `requireAdmin`), NOT ArangoDB user roles, NOT document-repository's `mapRole`.
2. On `/api/admin/tools/*`:
   - Read routes (`GET /feeds`) allow `tools-admin`, `tools-reader`, `admin`.
   - Write routes (`POST /feeds`, `PUT /feeds/:id`, `DELETE /feeds/:id`, `POST /test-search`) allow `tools-admin`, `admin` — a `tools-reader` write gets 403 `{ error: 'FORBIDDEN', message, details: {} }`.
3. Existing `admin` behaviour unchanged: `requireAdmin` and its three callers (`routes/admin-routes.js:45`, `routes/logger-routes.js:97,198`) behave exactly as before — **do not refactor `requireAdmin`** (its tests assert the exact message `'Admin access required'`).
4. Fail-closed: `requireRole` used without a preceding `authenticate` (no `req.claims`) → 403, never a crash.
5. `cd components/gov-chat-backend && npm test` green, including new tests (below); `npm run lint` and `npm run format:check` (repo root) green.

## Tasks / Subtasks

- [ ] Task 1 — Add `requireRole(...allowedRoles)` to `keycloakAuthMiddleware` (AC: 1, 4)
  - [ ] Place it next to `requireAdmin` in the same object literal; module.exports unchanged shape (still `{ keycloakAuthMiddleware, PUBLIC_PATHS, isPublicRoute }`)
  - [ ] Variadic factory returning `(req, res, next) =>`; 403 body `{ error: 'FORBIDDEN', message: '<roles> access required', details: {} }`; `logger.warn` denied attempts (mirror requireAdmin's log line)
- [ ] Task 2 — Split guards in `routes/tools-routes.js` (AC: 2)
  - [ ] Keep `router.use(keycloakAuthMiddleware.authenticate)` (line 18) — requireRole depends on `req.claims`
  - [ ] Replace line 19 blanket `requireAdmin` with per-route guards: reads → `requireRole('tools-admin', 'tools-reader', 'admin')`; writes → `requireRole('tools-admin', 'admin')`
- [ ] Task 3 — Tests (AC: 1, 2, 4)
  - [ ] Extend `__tests__/keycloak-auth-middleware.test.js` — new `describe('requireRole')` block beside the existing `requireAdmin` one (line 585): allows each listed role; rejects unlisted role with 403; fail-closed when `req.claims` undefined; multiple allowed roles work
  - [ ] New `__tests__/routes/tools-routes.test.js` — follow the established mock pattern (`jest.mock` the middleware module with `authenticate`/`requireAdmin`/`requireRole` as `jest.fn()` pass-throughs, e.g. `__tests__/routes/weather-routes.test.js:77`): GET /feeds reachable by tools-reader; POST /feeds 403 for tools-reader mock (assert requireRole invoked with write roles); all routes behind authenticate
  - [ ] Run backend suite + repo lint/format checks
- [ ] Task 4 — Update trackers: `sprint-status.yaml` (4-1 → review), plan.md session log

## Dev Notes

### Implementation guardrails

- **CommonJS only** (`require`/`module.exports`), single quotes, semicolons, 2-space indent. Backend files live at service root (no `src/`).
- **Read `req.claims`, not `req.user.roles`** — JWT claims are fresh per request; ArangoDB roles can be stale (rationale already documented at `keycloak-auth-middleware.js:179-181`).
- **Do NOT copy document-repository's `mapRole`/`authorizeRole`** (`components/document-repository/src/middlewares/keycloak-auth-middleware.js:53-64,168-180`) despite the epic suggesting it as a mirror: `mapRole` title-cases (`tools-admin` → `'Tools-admin'`), which would silently break exact-match role checks. Match on raw realm roles like `requireAdmin` does.
- **Do not touch `requireAdmin`** — its message `'Admin access required'` is asserted by 6 existing tests (`__tests__/keycloak-auth-middleware.test.js:585-758`) and it has three live callers. A standalone `requireRole` sibling is a smaller, zero-regression diff.
- Roles are realm roles in the standard `realm_access.roles` JWT claim — no token mapper changes needed. Grants take effect on the next token (next login), per PRD Decision 9.
- Error format: `{ error: 'FORBIDDEN', message, details: {} }` — project auth-error convention.

### Scope boundaries

- **Out of scope**: Kong allowlist / `env.j2` sync for `/api/admin/tools` (story 4-2, currently unverified); granting roles in the UI (story 4.8); the frontend tab behavior (story 4.3). This story is backend middleware + routes + tests only.
- Realm yaml already correct — do not edit `genie-realm.yaml` (and never convert its `$(env:VAR)` substitution syntax).

### Testing standards

- Jest, `describe/it/expect`, mocks at module level. Route tests mock the middleware module, not Keycloak.
- Existing suite must stay green — run the full backend suite, not just new files.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.1] — story definition, AC, `mapRole` warning
- [Source: _bmad-output/planning-artifacts/prds/prd-server-side-tools.md] — FR11, NFR8 (FOI read path), NFR10 (`tools-admin` for mutation), Decision 4 (two-role model), §RBAC "A `tools-reader` attempting a write is rejected with an authorization error"
- [Source: _bmad-output/planning-artifacts/architecture.md:64,70,85] — D4 file impact list
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js:178-194] — `requireAdmin` pattern to mirror (claims source, log line, 403 shape)
- [Source: components/gov-chat-backend/routes/tools-routes.js:18-19] — the blanket guard to split
- [Source: configs/keycloak/genie-realm.yaml:46-48] — roles already defined
- [Source: _bmad-output/project-context.md] — CommonJS rule, auth test conventions, anti-patterns

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
