---
baseline_commit: 5b83c2663
---

# Story 4.8: List-and-grant user capabilities

Status: review

## Story

As an administrator,
I want to see a user's current tool roles live from Keycloak and grant/revoke them in-app,
so that capability management round-trips to the authoritative source (Keycloak) without ever persisting roles to ArangoDB (Decision 9, NFR10).

## Current State (verified on `feat/sst` 2026-09-01)

The **grant half is fully wired end-to-end** (unverified claim resolved — it exists):

- FE: `toggleUserRole` → `adminDashboardService.assignUserRole/removeUserRole` (`src/services/adminDashboardService.js:288-302`) → `POST admin/users/:key/roles {roleName}` / `DELETE admin/users/:key/roles/:role`
- BE routes: `admin-routes.js:609` (POST) / `:648` (DELETE) — under the router-level `requireAdmin` (4-1 pinned)
- BE service: `admin-dashboard-service.js:1051-1060` → pure passthrough to the proxy
- Proxy: `keycloak-proxy-service.js:244-294` — `_resolveKeycloakUserId(userKey)` (AQL `sub` lookup, :34-47) → `GET /roles/{name}` (404 → typed error) → `POST/DELETE /users/{uuid}/role-mappings/realm` with `[{id, name}]` payloads — correct Keycloak Admin API shape

The **list half is broken**:

- The role modal's `hasRole()` reads `user.roles` from the user-search payload; `searchUsers` AQL reads `u.roles` from ArangoDB (`admin-dashboard-service.js:1128`) — but `roles` is **JIT-protected** (`constants/jit-fields.js:25`: never written to ArangoDB). For any JIT-era user the field is empty → both toggles always render "off" even when the user holds `tools-admin`; remove only works via optimistic in-session state.
- **No `GET` roles route exists** — nothing can read a user's live realm-role set.

**Zero tests** anywhere in the chain (routes, services, proxy, frontend modal — grep-verified).

## Acceptance Criteria

1. New endpoint `GET /api/admin/users/:userKey/roles` returns the user's live realm roles from Keycloak (via the proxy), filtered the same way the search AQL filters (`offline_access`, `uma_authorization`, `default-roles-*` excluded); 404 when the user has no Keycloak `sub`.
2. The role modal fetches live roles when opened and renders current assignment state from them; toggles still call assign/remove optimistically and re-sync on failure.
3. Grant/revoke round-trip pinned by tests: route → service → proxy payload shapes (incl. `[{id, name}]` body, uuid resolution, role-404 typed error, remove-with-missing-role no-op).
4. ArangoDB `users.roles` stays untouched by every path in this story (JIT rule) — test-pinned at the service layer.
5. Full backend + frontend suites green; ESLint/Prettier clean.

## Tasks / Subtasks

- [x] Task 1 — Proxy: `getUserRealmRoles(userKey)` (AC: 1)
  - [x] `keycloak-proxy-service.js`: resolve uuid → `_adminApiCall('GET', '/users/{uuid}/role-mappings/realm')` → filter `offline_access`/`uma_authorization`/`default-roles-*` → return `[{id, name}]`
- [x] Task 2 — Service + route (AC: 1)
  - [x] `admin-dashboard-service.js`: `getUserRoles(userKey)` passthrough (mirror assign/remove at :1051)
  - [x] `admin-routes.js`: `router.get('/users/:userKey/roles', ...)` next to the POST/DELETE pair, swagger JSDoc consistent with them (:600-647 style)
- [x] Task 3 — Frontend: live roles in the modal (AC: 2)
  - [x] `adminDashboardService.js`: `getUserRoles(userKey)` GET
  - [x] `AdminDashboard.vue`: on `openAssignRoleDialog` fetch live roles into `roleDialog.liveRoles`; `hasRole` prefers `liveRoles` over stale `user.roles`; on toggle failure, re-fetch (drop the optimistic mutation drift)
- [x] Task 4 — Tests (AC: 3, 4)
  - [x] Backend route tests in `__tests__/routes/admin.test.js` (extend its service-mock block with `getUserRoles`): GET happy path, GET 404-no-sub, POST/DELETE passthrough + error propagation
  - [x] Proxy unit test (new `__tests__/services/keycloak-proxy-roles.test.js` or extend the existing keycloak-proxy test): payload shapes, uuid resolution AQL, role-404 typed error on assign, silent no-op on remove, role filtering on list
  - [x] Service test: assign/remove/get call ONLY the proxy (no `this.db` touch) — pins the JIT rule (AC: 4)
  - [x] Frontend: modal test asserting live-roles fetch on open + toggle calls the right service method (mock `adminDashboardService`)
- [x] Task 5 — Suites + linters + trackers (sprint-status 4-8 → review, plan.md session log)

## Dev Notes

### Implementation guardrails

- Backend CommonJS; routes keep the existing try/catch → `next(error)` style; response shapes mirror the sibling routes (`{ success, userKey, ... }`).
- The proxy is a plain object (`module.exports = {...}` style — note the comma-separated methods at :294); follow its existing `_adminApiCall` error convention (`error.status` for HTTP codes).
- Do NOT add roles to any ArangoDB read/write beyond the existing `sub` lookup — the JIT rule (`jit-fields.js:19-36`) is the story's second AC.
- Frontend: Options API; `adminDashboardService` via the established service module (no direct axios); the modal's notification pattern (`showNotification`) stays.
- Grants take effect on the granted user's NEXT LOGIN (fresh token `realm_access`) — D9 assumption; document in the route's swagger description, do not attempt hot-invalidation.
- The search table's roles column stays as-is (legacy display for pre-JIT docs); the modal is the live source of truth — do not rebuild the search AQL.

### Testing standards

- `__tests__/routes/admin.test.js` mocks `admin-dashboard-service` at module level (lines 29-43) — extend that mock factory with `getUserRoles`.
- Proxy tests mock `dbService` (for the `sub` AQL) and `_adminApiCall` (spy on the object method).
- Frontend modal test: follow the ChatBotComponent captured-callbacks pattern for service mocks.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.8] — story text, D9/E2 refs, AC ("grant round-trips to Keycloak and appears after re-login; ArangoDB roles untouched")
- [Source: components/gov-chat-backend/services/keycloak-proxy-service.js:34-47, 244-294] — uuid resolution, assign/remove impl to mirror
- [Source: components/gov-chat-backend/routes/admin-routes.js:600-660] — sibling routes + swagger style
- [Source: components/gov-chat-backend/constants/jit-fields.js:19-36] — the JIT rule this story must not break
- [Source: components/gov-chat-frontend/src/components/AdminDashboard.vue:2524-2570] — the modal, hasRole, toggleUserRole
- [Source: commit 9435c0ef9] — the original role-modal commit (context)
- Previous-story intelligence (4-1): compose-level tests catch wiring unit tests miss — the route tests must go through the real router (not just the service in isolation)


### Review Findings

_Code review 2026-09-01 — all 3 adversarial layers completed. Cross-layer verification: the Blind Hunter's "filter untested" claim was disproven (the proxy test file pins it — it was simply missing from the constructed review diff because `git diff` excludes untracked files; lesson recorded); Edge Hunter independently bounded the hasRole concern to dialog-only callers._

- [x] [Review][Patch] **Stale-fetch race + reactive-proxy identity** — no request token; a late response could overwrite a newer dialog's state. Fixed with `_key`-based currency guards on every await (reference equality fails: state-stored users are reactive Proxies — caught by my own tests turning red, the exact trap the guard introduced).
- [x] [Review][Patch] **Failed roles fetch rendered "Assign everything"** — catch now keeps `liveRoles = null` (unknown ≠ empty) and the buttons disable on null; pinned by the failure-state render test.
- [x] [Review][Patch] **Concurrent toggles of different roles both live** — any in-flight toggle now disables both rows (`isManagingRole !== null`).
- [x] [Review][Patch] **`/api/me/delete` local catch checked only `error.status`** — now honors `statusCode` too, so the NotFoundError migration's 404 reaches this caller (pre-existing shadowing).
- [x] [Review][Patch] **roleName guard accepted non-strings** — tightened to `typeof 'string' && trim()` at the trust boundary (+ route test).
- [x] [Review][Patch] **JSDoc promised "effective" roles; endpoint returns direct mappings** — wording fixed to "DIRECTLY ASSIGNED … not composite/group-derived".
- [x] [Review][Patch] **Nameless roles survived the filter; raw Keycloak objects leaked through** — `role.name &&` guard + `[{id, name}]` projection per Task 1's spec.
- [x] [Review][Patch] **Dialog template had zero render coverage** — added a document-level render test (DsModal teleports to body; also documents the Teleport-cleanup gotcha for test authors).
- [x] [Review][Dismiss] hasRole's dead `user` param "leaks to other callers" — grep-verified: only dialog-scoped callers exist; the currency guards close the residual concern.
- [x] [Review][Dismiss] Proxy filter "untested" — pinned in `keycloak-proxy-roles.test.js` (was missing from the review diff, not from the tree).
- [x] [Review][Dismiss] Mock-reset dependency — both suites run `clearAllMocks` in `beforeEach`.
- [x] [Review][Dismiss] uuid-AQL direct test — dropped after 3 brittle iterations (module-registry interactions); behaviorally pinned via the NotFoundError propagation test; note left in the test file.
- [x] [Review][Flag] **Epic's "replace the Keycloak-console deep link" not done** — the deep link (`AdminDashboard.vue:1452`) coexists with the new in-app dialog. Removing working functionality is a UX call: **surfaced to the user** (kept for now as the escape hatch for non-role user management).
- [x] [Review][Flag] NotFoundError remaps sibling endpoints 500→404 — intended (delete-user path benefits); pinned via route + proxy tests.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Story analysis resolved the sprint-status "grant half unverified" claim: the chain was fully wired; the REAL gaps were (a) no live-roles source (JIT rule makes the search payload stale), (b) **the dialog template never existed** — commit 9435c0ef9 shipped script methods with zero template references, (c) zero tests in the chain
- Dev-phase bonus fix: the POST route's `err.status=400` was dead code (global handler only reads `statusCode` → 500); exposed by the new route test, fixed with `ValidationError`
- Review patches: race guards (reactive-proxy identity trap — guards initially compared object references and my own tests caught it), failure-state disable, trust-boundary validation, JSDoc/projection fixes, render test
- Suites: backend **1688** (66 suites), frontend **1253**, locale gate green, ESLint + Prettier clean

### Completion Notes List

- `GET /api/admin/users/:userKey/roles` (proxy `getUserRealmRoles` → service passthrough → route), filtering implicit roles identically to the search AQL; `_resolveKeycloakUserId` now throws NotFoundError (404 not 500)
- The role dialog actually renders now (DsModal + DsSpinner, DS tokens): fetch-on-open, live-set preference, post-toggle re-sync, failure-safe disable states; 4 `admin.roleDialog.*` keys × 14 locales with template-vs-file parity
- JIT rule pinned: role paths touch only the Keycloak proxy (`svc.db` stays unset — test-asserted)
- Deferred to the user: the epic's "replace the Keycloak-console deep link" — kept as an escape hatch pending a UX call

### File List

- components/gov-chat-backend/services/keycloak-proxy-service.js (getUserRealmRoles, NotFoundError, filter+projection)
- components/gov-chat-backend/services/admin-dashboard-service.js (getUserRoles)
- components/gov-chat-backend/routes/admin-routes.js (GET route, ValidationError, roleName shape guard)
- components/gov-chat-backend/routes/user-routes.js (me/delete catch honors statusCode)
- components/gov-chat-backend/__tests__/routes/admin.test.js (+7 tests)
- components/gov-chat-backend/__tests__/services/keycloak-proxy-roles.test.js (NEW — 8 tests incl. JIT pin)
- components/gov-chat-frontend/src/services/adminDashboardService.js (getUserRoles)
- components/gov-chat-frontend/src/components/AdminDashboard.vue (dialog markup, live-roles logic, race guards, styles)
- components/gov-chat-frontend/src/i18n/locales/*.js (roleDialog keys ×14)
- components/gov-chat-frontend/src/__tests__/components/AdminDashboard.test.js (+4 tests)
- _bmad-output/implementation-artifacts/{4-8 story, sprint-status, plan.md}

### Change Log

- 2026-09-01: Implemented list-and-grant (live roles chain + first-ever dialog markup) + review patches; 1688/1253 tests green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
