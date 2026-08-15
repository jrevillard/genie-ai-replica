---
baseline_commit: 2fa4d5f5d
---
# Story 6.1: Authentication & per-tenant/repo/domain authorization (default-deny)

Status: review

Story key: `6-1-authn-authz-rbac` | GitLab: #905 (`prd::okf-server`, `okf-server::epic-6`)
Epic: 6 (Hardening — Security, Observability, Sovereignty) | Branch: `feat/okf-server`
FRs: **FR-18** (authn + per-tenant/repo/domain scopes), **FR-15** (403 semantics), NFR-S2 | Gaps: **G3 (P0)**, **G15 (P1)** | ADRs: okf-025 (§4 default-deny), okf-006 (403-vs-404), okf-003 (audience binding)

> **The G3/G15 gap (verified in code):** `repository-controller.js:26-36` `callerDomain(req)` reads an optional `okf_domain` token claim that **no Keycloak mapper ever sets** — absent ⇒ `undefined` ⇒ the service's domain filter is skipped ⇒ **any authenticated caller lists and reads ALL repos across ALL tenants** (G3). Mutation is gated only by the global `tools-admin` realm role (`repos-routes.js:17-19,22`), and `repoService.update/remove` take **no authorization parameter at all** — a steward can mutate any tenant's repo (G15). `verifyToken` also validates neither `aud` nor `azp` (shared `keycloak-auth-service.js:278-287`) — any client's token in the realm is accepted. This story ships default-deny read scoping, per-repo mutation scopes, audience binding (opt-in), and the Keycloak provisioning to make scopes real.

## Story

As a **security officer**,
I want **every OKF call authenticated with an audience-bound token and authorized at repo granularity via `okf:{tenant}:{repo}:{read|admin}` scopes, default-deny**,
so that **a caller without a repository's scope cannot even see that repository exists — cross-tenant listing, reading, and mutation are closed.**

## Acceptance Criteria

1. **Scope resolution in `auth.js`** (course-correction §4-d). After `verifyToken`, `authenticate` derives and attaches to `req`:
   - `req.okfScopes` — array parsed from the payload: `okf_scopes` claim (array OR space-separated string) first, then `scope` claim (space-separated), filtered to entries matching `/^okf:/`. Duplicates removed, order preserved.
   - `req.okfIsSuperAdmin` — `true` iff `realm_access.roles` includes `tools-admin` (bootstrap super-role; see Dev Notes §Decisions D4).
2. **`requireScope('okf:read')` middleware** (new `middleware/require-scope.js`). Mounted router-wide in `okf-routes.js` **after** `authenticate`. Passes iff the caller has ANY `okf:{tenant}:{repo}:{read|admin}` scope, OR `okf:*:*:{read|admin}` wildcard, OR `req.okfIsSuperAdmin`. Otherwise **403** `{ error: 'FORBIDDEN_SCOPE', message: '…requires an okf read scope…' }` + best-effort `writeAudit({ action: 'authz.denied.scope' })`.
3. **`requireRepoScope(repo_id, 'admin')` middleware** (same file, factory reading `req.params.repo_id` unless an explicit repo_id is passed). Passes iff `req.okfIsSuperAdmin` OR the token carries `okf:{any}:{repo_id}:admin` OR `okf:*:*:admin`. Applied to **PATCH `/:repo_id`**, **DELETE `/:repo_id`**, **POST `/:repo_id/pii-scan`** — **replacing** `requireRole('tools-admin')` on those routes (`repos-routes.js:18,19,22`). Failure = **403** `FORBIDDEN_SCOPE` + denial audit. **POST `/` (create) keeps `requireRole('tools-admin')`** — repo creation is a platform-level act with no repo_id to scope (Dev Notes D4).
4. **Default-deny read scoping (the G3 fix).** New controller helper `callerAuthz(req)` → `{ isSuperAdmin, authorizedRepoIds: Set<string> }` derived from `req.okfScopes` (`okf:{tenant}:{repo}:*` → repo entries; wildcards + super-admin ⇒ `isSuperAdmin`). **Replaces** `callerDomain` (delete the `okf_domain` seam — superseded by scopes; ADR-025 rejected custom-claim encoding). Wiring:
   - `listRepos`: super-admin ⇒ all repos (existing behavior); otherwise the service filters to `repo_id IN authorizedRepoIds` — an empty set returns `{ items: [], next_cursor: null }`, **never the full catalog**.
   - `getRepo` + `piiScan` repo gate: `repoService.getById(repo_id, { authz })` — a repo outside the caller's scopes throws `REPO_NOT_FOUND` ⇒ **404, identical to a missing repo** (preserve the anti-enumeration property pinned by `repository-service.test.js:88-94`).
   - `repository-service.js` signatures change additively: `list({ domain, authz, cursor, limit })` and `getById(repo_id, { domain, authz })` where `authz = null` (or absent) ⇒ unrestricted (super-admin / internal callers), `authz = Set` ⇒ filter. The `domain` parameter stays (unused by the controller after this story; removable with 6.1b).
5. **Audience binding, opt-in (RFC 8707) — additive shared-service change.** `components/shared/lib/keycloak-auth-service.js` `verifyToken(token, opts)` gains an optional second parameter `{ audience }`: when provided, `audience` is passed to `jose.jwtVerify` (rejects tokens whose `aud` lacks the value — the aud error branch at `:309-361` becomes reachable). **When omitted (backend, doc-repo, all existing callers): behavior byte-identical** — pinned by a default-path test. `middleware/auth.js` passes `{ audience: process.env.OKF_AUDIENCE || undefined }` — env-gated so deployments without the audience mapper keep working; `OKF_AUDIENCE=okf-server` activates binding. (Justified per the additive-first policy; mirrors the `KEYCLOAK_PUBLIC_URL` pattern from commit `3663cc807`.)
6. **Keycloak provisioning (`configs/keycloak/genie-realm.yaml`, additive).** New realm **client scope `okf`** containing: (a) an **audience mapper** adding client `okf-server` to `aud`; (b) a **user-attribute mapper** `okf_scopes` (user attribute `okf_scopes`, multivalued, claim `okf_scopes`). New **confidential client `okf-server`** (service accounts; direct grants off) with the `okf` client scope as default. The `okf` client scope is also attached as **optional scope on the `$(env:KC_CLIENT_ID)` (genie-app) client** so steward browser tokens carry `okf_scopes` + `aud`. The **genie-admin user** gets attribute `okf_scopes: ["okf:*:*:admin"]` (wildcard — the existing operator flow works with or without `tools-admin`). **Preserve `$(env:...)` substitution syntax exactly** (project-context rule). `tools-admin` realm role stays (bootstrap super-role).
7. **Denial auditing.** Every 403/404 authorization denial from the new middleware and the getById gate writes a best-effort `okf_audit` row: `{ action: 'authz.denied.scope' | 'authz.denied.repo', actor: actorFrom(req), repo_id?, source_ip: req.ip }` — same best-effort semantics as `audit-service.js:47-51` (never fails the request). These are the first middleware-level audit callers — keep `writeAudit` unchanged.
8. **Isolation tests (red-green; LG-2 API-level precursor).** New/extended tests prove: (a) caller scoped `okf:t1:repoA:read` — GET repoA ⇒ 200, GET repoB ⇒ **404** (body identical to missing repo), LIST ⇒ contains repoA only; (b) scopeless non-admin caller — LIST ⇒ `[]`, all repo routes ⇒ 403; (c) `okf:t1:repoA:read` caller — PATCH/DELETE/pii-scan repoA ⇒ 403 (read ≠ admin); (d) `okf:t1:repoA:admin` caller — PATCH repoA passes, PATCH repoB ⇒ 403; (e) `tools-admin` (no scopes) — sees/mutates all (regression: the live operator flow); (f) `okf:*:*:admin` wildcard — same as super. **Red-green:** (a)/(b) FAIL against current code (list returns all repos), PASS after.
9. **Standards.** ESLint/Prettier clean; Jest for okf-server (middleware units following `auth.test.js` pattern, route integration via `authUser()` helper extended with scope claims, service tests for `authz` filtering); shared-service audience tests in `components/gov-chat-backend/__tests__/services/keycloak-auth-service.split-url.test.js` style (or sibling file); ITU headers; `cd components/okf-server && npm test` + backend suite green; no Co-Authored-By.

## Tasks / Subtasks

- [x] **T1 — Shared service: opt-in audience** (AC: 5): `verifyToken(token, opts={})` → `{audience}` into jwtVerify options; aud-failure error mapping; tests (audience-set rejects wrong-aud token; audience-omitted default path unchanged).
- [x] **T2 — `auth.js` scope + super-admin resolution** (AC: 1): parse `okf_scopes`/`scope` claims → `req.okfScopes`; `realm_access.roles.includes('tools-admin')` → `req.okfIsSuperAdmin`; pass `{audience: OKF_AUDIENCE}` to verifyToken. Unit tests for parsing (array, string, both, none).
- [x] **T3 — `require-scope.js`** (AC: 2,3): `requireScope(level)` + `requireRepoScope(repoParamOrRepoId, level)` factories + denial audit. Unit tests incl. wildcard, super-admin, read-vs-admin, 403 shapes.
- [x] **T4 — Controller/service default-deny** (AC: 4): `callerAuthz` replaces `callerDomain` (delete the seam + its debug log); `repository-service.list/getById` gain `authz`; wire `listRepos`/`getRepo`/`piiScan`. Update the domain tests; add `authz` filtering tests.
- [x] **T5 — Route wiring** (AC: 3): `okf-routes.js` router-level `requireScope('okf:read')`; `repos-routes.js` — PATCH/DELETE/pii-scan → `requireRepoScope('admin')`; POST `/` keeps `requireRole('tools-admin')`; GET routes unchanged (scoped in controller). Route integration tests (AC 8 matrix).
- [x] **T6 — Keycloak provisioning** (AC: 6): `genie-realm.yaml` — `okf` client scope (audience + user-attribute mappers), `okf-server` client, optional scope on genie-app, genie-admin wildcard attribute. Local-build verification: recreate keycloak-config, mint a scoped test user (attribute `okf_scopes`), confirm `okf_scopes` + `aud` claims present.
- [x] **T7 — Audit denials + env plumbing** (AC: 7): denial audit calls; `OKF_AUDIENCE` in okf-server compose env (empty default) + `env` template section + `env.j2` conditional.
- [x] **T8 — Verify** (AC: 8,9): full okf-server + backend suites; `npx eslint . && npx prettier --check .`; red-green proof recorded in Dev Agent Record.

## Dev Notes

### Decisions (resolving flagged doc ambiguities — sources in References)

- **D1 — 403 vs 404 reconciled:** foreign/unauthorized REPO ⇒ **404** (anti-enumeration; matches FR-18 default-deny + existing service behavior); authenticated caller lacking okf scopes entirely ⇒ **403** at middleware; in-repo concept-level denial (future stories) ⇒ 403 per ADR-006. Sensitivity-driven 404-collapse (ADR-006 option) is NOT in 6.1.
- **D2 — `requireScope('okf:read')` semantics:** the bare `okf:read` string is undefined in every doc (flagged ambiguity); 6.1 defines it as "caller holds ≥1 okf scope with read-or-admin level (or wildcard/super)". Do NOT mint a literal `okf:read` scope.
- **D3 — Scope grammar v1:** `okf:{tenant}:{repo}:{read|admin}` with `*` wildcards. The `{tenant}` component is **carried but not used for matching in 6.1** — per-repo (`repo_id`) + wildcard + super-admin only. Tenant/domain-axis matching is 6.1b's resolver (ADR-025 output contract `{graph_names, per_graph_labels, domains}` — the canonical naming; ignore the course-correction's `allowed_labels` drift).
- **D4 — `tools-admin` = bootstrap super-role, not removed:** FR-18 says requireRepoScope "replaces" tools-admin; FR-10/23/26 and Story 2.9.1 still name it, the realm role just landed (e1d1a3c03), and the live operator flow depends on it. 6.1 replaces it **as the enforcement mechanism on per-repo mutations** (middleware checks scopes; role only grants the wildcard via `okfIsSuperAdmin`), keeps it for repo **creation**, and documents that deployments should stop granting it broadly once per-repo scopes are assigned. G15's residual risk is operational, not code.
- **D5 — Audience binding is opt-in via `OKF_AUDIENCE`:** shared service unchanged for all existing callers; okf-server activates binding when the env is set. Cloud/local without provisioning keep working (upgrade path, not a flag day).
- **D6 — `okf_domain` claim seam deleted** (AC 4): never provisioned, superseded by scope strings (D16-a rejected custom claims).
- **D7 — Super-admin regression is a REQUIREMENT:** the existing tools-admin operator flow (used by the smoke tests and the admin UI path) must keep working end-to-end — AC 8(e).

### Verified code anchors (read before coding — non-negotiable)

- `middleware/auth.js:12-34` — current authenticate (case-insensitive Bearer, 401 flatten); extend, don't rewrite.
- `middleware/require-role.js:18-31` — the middleware factory pattern to mirror (incl. the 403 body shape convention).
- `routes/repos-routes.js:12-22`, `routes/okf-routes.js:9-12` — mount chain; router-level `authenticate` lives in okf-routes.
- `controllers/repository-controller.js:21-36` — `actorFrom` (keep) and `callerDomain` (DELETE); call sites `:58` list, `:70` get, `:111` pii-scan; `:47/:80/:89` create/update/delete have no scoping.
- `services/repository-service.js` — `list({domain,cursor,limit})` :204-247 (domain filter AQL at :219 — the pattern for the `authz` IN-filter; note AQL `IN` with an array bind param), `getById(repo_id,{domain})` :255-288 (the 404 gate at :266-268 — preserve EXACTLY), `update` :297-360 / `remove` :368-409 (no authz param — existence check only; the middleware gates these, service stays unaware of authz for mutations).
- `services/audit-service.js:26-53` — `writeAudit` best-effort contract; reuse as-is.
- `components/shared/lib/keycloak-auth-service.js:243-362` — verifyToken; opts go at `:278-282` jwtVerify call; the aud error-mapping branch already exists. **Keep the whitelist-lookup-then-verify order** (`:259-274` unverified iss → issuerMap select → jwtVerify) — never verify against an unselected JWKS.
- `configs/keycloak/genie-realm.yaml` — clients at `:108-198` (okf-server client goes after `dataprep-service-client`); NO existing `protocolMappers`/`clientScopes` anywhere — yours are the first; `$(env:...)` syntax is sacred.

### Shared-service change justification (user policy: additive-first)

`verifyToken` gains an optional `opts` param. Default call sites (backend `auth-routes` users, doc-repo via its own middleware, okf-server today) pass nothing ⇒ identical behavior, pinned by tests. The change is required because RFC 8707 audience binding cannot be done outside the verifier (the `aud` check must ride the same `jwtVerify` call as signature validation). Risk: minimal — additive param, default path tested in both the backend split-url suite (pattern exists) and okf-server's `auth.test.js`.

### Test conventions to follow (okf-server)

- Middleware units: `__tests__/auth.test.js` — `jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }))`, hand-rolled `mockRes()`. **jose is ESM-only — every file that transitively loads the shared service must mock it** (see `repos-routes.test.js:4-5` comment) or Jest breaks.
- Route integration: `repos-routes.test.js` `authUser(roles)` helper (:18-24) — extend to `authUser({ roles, okfScopes })` building `scope`/`okf_scopes` claims on the mock payload.
- Controller units: `pii-scan-route.test.js` — `req(body, params, user)` + status/body-capturing `res()`; the domain-gate test (:47-57) is the template for authz-gate tests.
- Service: `mocks/arango-mock.js` `createMockDb()`, `db._stores` assertions; the 404-no-leakage test (:88-94) MUST keep passing unchanged.
- moduleNameMapper `shared-lib$`/`shared-lib/(.*)$` (package.json :25-31) — require shared code as `../shared-lib/...`; there is no physical shared-lib dir in the repo.

### Scope boundary (do NOT build here)

- **Story 6.1b** — the `authz-resolver.js` component (token → `{graph_names, per_graph_labels, domains}`, per-session cache, per-graph label maps) and tenant/domain-axis matching.
- **Kong OIDC termination** (ADR-003's gateway leg) — no Kong plugin in this story.
- **Retriever-side enforcement** ( Stories 1.1/1.2, G12 `search_start` bypass) — 6.1 is the okf-server control plane only.
- **Disabled-user revocation** (`checkUserStatusInKeycloak` :395-432 exists, uncalled) — noted as follow-up, out of scope.
- **`KEYCLOAK_ADDITIONAL_REALMS` trust tightening** — flagged gap, separate decision.
- **Sensitivity-driven 404-collapse** (ADR-006 high-sensitivity mode).

### Inherited lessons from 2.1–2.9.2 reviews

Shared libs IMPORTED not copied · MELT on every new method (span + counter + logger) · direct AQL (no ORM) · red-green verified (isolation tests must FAIL before) · adversarial review WILL probe: the 404-enumeration seam, the super-admin bypass, the default-path of the shared service, wildcard parsing edge cases (`okf:*:*:admin` vs `okf:t1:*:read`) · no Co-Authored-By.

### References

- Gaps/decisions: course-correction `okf-course-correction-2026-08-13.md` §4 Story-6.1 table (:391), G3 (:35), G15 (:47), D16 (:332), D17 (:333), phase order (:467-471).
- ADRs: `docs/adr/okf-025-authz-resolver.md` (§4 = this story's mandate), `okf-006`, `okf-003`, `okf-002` (superseded-by-014 note).
- PRD: FR-18 `prd.md:317-324`, FR-15 `:274-277`, FR-23 `:133-137`, NFR-S2 `:474`, LG-2 `:460`, §10 `:509`.
- Epics: Story 6.1 `epics.md:609-618`, 6.1b `:620-624`.
- Code: every anchor in "Verified code anchors" above; `genie-realm.yaml:33-47` (roles), `:108-198` (clients).
- Precedent commits: `3663cc807` (additive shared-service opt-in pattern), `e1d1a3c03` (tools-admin realm-role provisioning).

## Dev Agent Record

### Agent Model Used

glm-5.3[1m] (dev-story, 2026-08-15)

### Debug Log References

- **Red-green:** require-scope suite failed to LOAD pre-implementation (module absent); auth scope-resolution 8 failures pre-implementation → 13/13; AC-8 route matrix 4 wiring failures pre-wiring → green; repository-service authz 3 failures (empty-set query, foreign 404) → green.
- **Suites:** okf-server 170/170, ESLint clean, Prettier clean on touched files; backend audience suite 8/8 with full-suite regression gate (pre-existing host-locale failures only); shared-service no-opts default path pinned by tests in the backend suite.
- **Live smoke (local build, exit 0):** full control-plane (6/6 concepts, metrics 6/2, gate OPEN) + the Story 6.1 HTTP authz matrix — scoped caller: own repo 200 / foreign EXISTING repo 404 (anti-enumeration) / list scoped / PATCH 403 FORBIDDEN_SCOPE; scopeless caller: 403 default-deny; admin (wildcard attribute): full visibility + mutation. All requests rode aud=okf-server tokens with OKF_AUDIENCE=okf-server active (RFC 8707 verified end-to-end). Denial audits confirmed in okf_audit (authz.denied.scope + authz.denied.repo rows).
- **Keycloak discovery (verified empirically):** KC 26 declarative user profile silently DROPS undeclared attributes — okf_scopes never persisted until the user-profile resource got unmanagedAttributePolicy=ENABLED (PUT /admin/realms/{r}/users/profile); the realm-level attribute knob is NOT honored, and keycloak-config-cli cannot express it → applied post-import in the config-cli entrypoint (best-effort, warn-not-abort). Also: the realm yaml is baked into the config-cli IMAGE — config changes require image rebuild, not just container recreation; and keycloak-config-cli does not update EXISTING users (genie-admin attribute set live once; fresh realms get it from the yaml).
- **AC6 shape deviation (justified):** mappers attached directly to the genie-app and okf-server clients instead of a shared okf client scope — per-client optionalClientScopes REPLACES the standard scope set (would strip standard claims); direct mappers are additive-only.

### Completion Notes List

- All 8 tasks complete; 9 ACs satisfied (AC6 in substance with the documented deviation).
- Commits: ba09347af (T1-T7), unmanaged-attr realm attempt (superseded), 7b827625c (provisioning fix + smoke authz phase).
- Known follow-ups (out of scope): Keycloak OIDC termination at Kong (ADR-003 leg); 6.1b authz resolver (tenant-axis matching, graph set); disabled-user revocation; additional-realms trust tightening.

### File List

- components/shared/lib/keycloak-auth-service.js — opt-in verifyToken(token,{audience})
- components/gov-chat-backend/services/keycloak-auth-service.js — same change (both copies in lockstep)
- components/gov-chat-backend/__tests__/services/keycloak-auth-service.audience.test.js — NEW
- components/okf-server/middleware/auth.js — parseOkfScopes + okfIsSuperAdmin + OKF_AUDIENCE
- components/okf-server/middleware/require-scope.js — NEW (requireScope/requireRepoScope + denial audit)
- components/okf-server/controllers/repository-controller.js — callerAuthz/authzForService replace callerDomain
- components/okf-server/services/repository-service.js — list/getById authz param + empty-set short-circuit
- components/okf-server/routes/okf-routes.js, routes/repos-routes.js — gates wired
- components/okf-server/__tests__/{auth,require-scope,repository-service,repos-routes,health,pii-scan-route}.test.js — extended/updated
- configs/keycloak/genie-realm.yaml — genie-app mappers, okf-server client, genie-admin wildcard + tools-admin role
- configs/keycloak/config-and-sleep.sh — user-profile policy post-import step
- docker-compose.yaml, env, deploy/ansible/templates/env.j2 — OKF_AUDIENCE + KC_OKF_SERVER_CLIENT_SECRET
- data/okf/smoke-test/run-smoke.js — Story 6.1 authz phase

### Debug Log References

### Completion Notes List

### File List
