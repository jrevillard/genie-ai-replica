---
baseline_commit: af37c47988ffd60c53d1de4b62cccb65b7098fa2
---

# Story 4.1: Two Keycloak roles + `requireRole()`

Status: review

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

- [x] Task 1 — Add `requireRole(...allowedRoles)` to `keycloakAuthMiddleware` (AC: 1, 4)
  - [x] Place it next to `requireAdmin` in the same object literal; module.exports unchanged shape (still `{ keycloakAuthMiddleware, PUBLIC_PATHS, isPublicRoute }`)
  - [x] Variadic factory returning `(req, res, next) =>`; 403 body `{ error: 'FORBIDDEN', message: '<roles> access required', details: {} }`; `logger.warn` denied attempts (mirror requireAdmin's log line)
- [x] Task 2 — Split guards in `routes/tools-routes.js` (AC: 2)
  - [x] Keep `router.use(keycloakAuthMiddleware.authenticate)` (line 18) — requireRole depends on `req.claims`
  - [x] Replace line 19 blanket `requireAdmin` with per-route guards: reads → `requireRole('tools-admin', 'tools-reader', 'admin')`; writes → `requireRole('tools-admin', 'admin')`
- [x] Task 3 — Tests (AC: 1, 2, 4)
  - [x] Extend `__tests__/keycloak-auth-middleware.test.js` — new `describe('requireRole')` block beside the existing `requireAdmin` one (line 585): allows each listed role; rejects unlisted role with 403; fail-closed when `req.claims` undefined; multiple allowed roles work
  - [x] New `__tests__/routes/tools-routes.test.js` — follow the established mock pattern (`jest.mock` the middleware module with `authenticate`/`requireAdmin`/`requireRole` as `jest.fn()` pass-throughs, e.g. `__tests__/routes/weather-routes.test.js:77`): GET /feeds reachable by tools-reader; POST /feeds 403 for tools-reader mock (assert requireRole invoked with write roles); all routes behind authenticate
  - [x] Run backend suite + repo lint/format checks
- [x] Task 4 — Update trackers: `sprint-status.yaml` (4-1 → review), plan.md session log

### Review Findings

_Code review 2026-08-31 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor)._

- [x] [Review][Patch] **admin-routes intercepts `/api/admin/tools/*` before tools-routes mounts → new RBAC inert in production** [index.js:481-498 + admin-routes.js:45] — `admin-routes` is mounted at `/api/admin` BEFORE `tools-routes` at `/api/admin/tools` in `ROUTE_CONFIGS`; admin-router's pathless `router.use(requireAdmin)` runs first on every tools request, so `tools-reader` AND `tools-admin` holders get 403 `Admin access required` and the new guards are dead code in the composed app. Verified by composing the real routers in index.js order. Route tests passed only because they mount the tools router standalone. Fix: move the `tools-routes` entry above `admin-routes` in `ROUTE_CONFIGS`; add a composed-app test (createApp, REAL middleware, token mocked at `keycloakAuthService.verifyToken`) proving tools-reader reads and tools-admin writes work end-to-end. **FIXED 2026-08-31: tools-routes moved above admin-routes (with explanatory comment); `tools-routes.integration.test.js` added — 5 composed-app tests green.**
- [x] [Review][Patch] **No default-deny on the tools router — a future unguarded route is authenticated-only** [tools-routes.js:19-24] — removing the blanket `requireAdmin` switched the router from secure-by-default to enumerate-or-fail-open. Fix: trailing catch-all deny (`router.use` after all routes → 403) so unmatched/unguarded paths fail closed. **FIXED 2026-08-31: trailing default-deny added; integration test asserts unmatched path → 403.**
- [x] [Review][Patch] **Tests never exercise the real authenticate→requireRole claims seam; mock defaults to the most privileged role** [tools-routes.test.js:13,200] — both new test files mock or hand-set `req.claims`; nothing pins real `authenticate` output shape to what `requireRole` reads, and the route-test helper's `|| 'admin'` default silently tests the most privileged path when a header is forgotten. Fix: composed-app integration test from the mount-order patch covers the seam; change helper default to `''` (no roles → loud 403). **FIXED 2026-08-31: integration test exercises real authenticate→requireRole→router chain; helper defaults to `''` + trim.**
- [x] [Review][Patch] **Route-test coverage and isolation gaps** [tools-routes.test.js] — PUT/DELETE happy paths untested (a swapped-guard typo would pass); no route-level denial test for a plain `user` on GET; `clearMocks` not configured (jest default false) so `not.toHaveBeenCalled()` assertions are order-dependent; `x-test-roles` parsing doesn't trim (`'a, b'` → `' b'`). Fix: two happy-path tests, one denial test, `beforeEach(jest.clearAllMocks)`, `.map(s => s.trim())`. **FIXED 2026-08-31: all four applied; wiring test re-instantiates the router (clearAllMocks wipes module-load calls).**
- [x] [Review][Defer] Double authenticate per tools request (pre-existing) [tools-routes.js:19 + index.js:930] — deferred, pre-existing; recorded in deferred-work.md
- [x] [Review][Defer] admin-routes logs full headers incl. bearer token at info level (pre-existing) [admin-routes.js:34-40] — deferred, pre-existing; recorded in deferred-work.md

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

GLM-5.2 (Claude Code harness)

### Debug Log References

- RED phase: 10 tests failed exactly as expected (5× `requireRole is not a function` in middleware tests, 5× wrong-status in route tests) before implementation
- GREEN phase: 56/56 pass across the two touched suites; full backend regression 64 suites / 1662 tests pass
- ESLint clean on all four touched files; Prettier auto-formatted the new route test once, then clean
- Known env gap (not this story): root `npm run lint` aborts at `components/document-repository` — its `node_modules` is not installed locally. Frontend + backend lint green; CI installs deps per component. Story touched neither component.

### Completion Notes List

- `requireRole(...allowedRoles)` added as a sibling of `requireAdmin` — purely additive diff, `requireAdmin` byte-identical (its 6 message-assertion tests untouched and green)
- Guards split in `tools-routes.js`: `readGuard = requireRole('tools-admin', 'tools-reader', 'admin')` on GET /feeds; `writeGuard = requireRole('tools-admin', 'admin')` on POST/PUT/DELETE /feeds* and POST /test-search; `authenticate` still runs router-wide first
- Fail-closed verified: missing `req.claims` → 403 (no bypass by mounting requireRole without authenticate)
- No realm-yaml change needed — `tools-admin`/`tools-reader` already exist (`genie-realm.yaml:46-48`)
- Route tests assert guard wiring directly (`requireRole` called with exact role sets, `requireAdmin` never called)

### File List

- components/gov-chat-backend/middleware/keycloak-auth-middleware.js (modified — added requireRole)
- components/gov-chat-backend/routes/tools-routes.js (modified — per-route guards + trailing default-deny)
- components/gov-chat-backend/index.js (modified — tools-routes mounted before admin-routes)
- components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js (modified — requireRole describe block)
- components/gov-chat-backend/__tests__/routes/tools-routes.test.js (new)
- components/gov-chat-backend/__tests__/routes/tools-routes.integration.test.js (new — composed-app RBAC, real middleware)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status updates)
- _bmad-output/implementation-artifacts/deferred-work.md (2 deferred review findings)
- _bmad-output/implementation-artifacts/4-1-two-keycloak-roles-and-require-role.md (this record)

### Change Log

- 2026-08-31: Implemented requireRole + per-route RBAC on /api/admin/tools/*, tests added, all suites green → status review
- 2026-08-31: Code review (3 adversarial layers) — 4 patches applied: ROUTE_CONFIGS mount order (tools before admin — RBAC was inert in composed app), trailing default-deny on tools router, real-seam integration test + mock-default hardening, test isolation/coverage fixes. Backend 65 suites / 1670 tests green, lint + format clean. Stays at `review` per D2 (moves to `done` when MR !279 merges).
