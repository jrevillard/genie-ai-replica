---
baseline_commit: 5ee575577
---
# Story 2.2: ArangoDB OKF meta collections + repository CRUD API

Status: review
Story key: `2-2-arangodb-meta-collections-repo-crud` | GitLab: OKF epic-2 story (`prd::okf-server`, `okf-server::epic-2`)
Epic: 2 (OKF Server — Repository Ingestion & Management) | Branch: `feat/okf-server`
FRs: **FR-23** (primary), **FR-3** | References: Architecture §2, §4, §5, §8.1; ADR-okf-014; ADR-okf-018; ADR-okf-017

## Story

As a **steward** (`tools-admin` role),
I want **to create, list, read, update, and delete OKF repositories — each bound to one domain and reserving its own graph (`OKF_{repo_id}`)**,
so that **knowledge domains are isolated and managed independently as the control-plane foundation for all later OKF ingestion/serving**.

This is the **first real functionality** on the 2.1 skeleton. It is **ungated** (Node-only; not blocked by the OPEA 1.5 bump).

## Acceptance Criteria

1. **Control-plane collections provisioned** — On boot (or first CRUD), the OKF Server ensures four document collections exist in the **same ArangoDB database** as the graphs (`okf_repositories`, `okf_concepts_meta`, `okf_audit`, `okf_sources`), with the app-layer indexes listed in Dev Notes. Per ADR-okf-018: same DB, name-prefix isolation, **app-layer integrity** (Arango enforces nothing).
2. **Create** — `POST /api/okf/repos` (role `tools-admin`) accepts `{name, domain, source, acl, retention}`, **mints `repo_id`**, **reserves `graph_name = "OKF_" + repo_id`** (the graph itself is NOT created here — materialized on first ingest by Story 2.6), defaults `okf_version: "0.2"` + `lifecycle_state: "register"`, stamps `curator` from the token + ISO-8601 timestamps, writes an `okf_audit` row, returns **201** with the snake_case repo doc.
3. **List / Read** — `GET /api/okf/repos` (authenticated) returns repos **filtered to the caller's authorized domains** (basic domain filter from token claims; full scope system is Story 6.1), cursor-paginated (`{items, next_cursor}`). `GET /api/okf/repos/{repo_id}` returns the repo doc only. (Architecture §5 also lists `concept_counts`/`conformance`/`pii_summary`/`health` — these are intentionally OMITTED in 2.2; populated by Stories 2.4/2.8/4.1/2.7. Do not add empty placeholders.) Both **200**.
4. **Update** — `PATCH /api/okf/repos/{repo_id}` (role `tools-admin`) changes `name`/`source`/`acl`/`retention` only. **`graph_name`, `repo_id`, `domain` are immutable** — attempting to change them returns **409 `GRAPH_NAME_IMMUTABLE`** (or `FIELD_IMMUTABLE`). Writes an audit row. Returns **200**.
5. **Delete (cascade, audited, grace window)** — `DELETE /api/okf/repos/{repo_id}` (role `tools-admin`) soft-deletes: stamps `deleted_at` + grace-window expiry, retracts all `okf_*` metadata for the repo, writes an audit row, returns **202**. Hard delete becomes irreversible after the grace window. **Graph retract** (the `OKF_{repo_id}_*` content collections) is invoked via `graph-retract-service.retractRepoGraph(repo_id)` — a **no-op stub until Story 2.6** creates graphs; must not throw if absent. **No scheduled hard-delete sweep in 2.2** — only `deleted_at`/`delete_after` are stamped; the sweep is deferred to Story 4.6 (Retention/TTL), do NOT build a cron job.
6. **Errors** — Service throws `{status, code, message}`; the existing `error-handler.js` renders `{error, message}`. Codes: `REPO_NOT_FOUND` (404), `GRAPH_NAME_IMMUTABLE`/`FIELD_IMMUTABLE` (409), `DUPLICATE_REPO` (409), `FORBIDDEN_ROLE` (403), `VALIDATION_ERROR` (400). Token errors flow from the 2.1 auth middleware (`TOKEN_INVALID`/`TOKEN_EXPIRED` 401).
7. **Standards** — CommonJS, `createApp()` unchanged, controller→service split, **arangojs direct AQL (NO ORM/repository pattern)**, `joi` validation at the route boundary, snake_case responses + ISO-8601 (luxon), per-route auth, `withSpan('okf.repo.*')` on every handler, shared logger, ITU copyright headers, ESLint+Prettier clean.
8. **Tests** — Jest `createApp()`+supertest, mocking `keycloak-auth-service` at the top of every test file (jose is ESM-only) AND mocking the db module (no real ArangoDB). Cover: CRUD happy paths; validation failures; immutability (409); not-found (404); role check (403); audit row written; list domain-filtering. All green.

## Tasks / Subtasks

- [x] **T1 — ArangoDB connection + collections** (AC: 1)
  - [x] **Uses the SHARED `db-connection-service` (`components/shared/lib`)** for connection management — `getConnection('default')` returns a self-healing arangojs-compatible proxy. **No reinvented connection module** (the earlier `db/arango-connection.js` was removed — reinventing it violated the "import shared libs" standard); no ORM/repository pattern (AC8). Added the `async-retry` dep (required by the shared service).
  - [x] `components/okf-server/db/collections.js` — `ensureCollections()` (create-if-not-exists) for the four `okf_*` collections + the indexes in Dev Notes. Call once on boot (from `index.js` after `createApp`, before `app.listen` — fire-and-forget with error log, must not crash boot if Arango is momentarily down).
- [x] **T2 — Repository service (direct AQL)** (AC: 2,3,4,5,6)
  - [x] `components/okf-server/services/repository-service.js` — `create`, `list`, `getById`, `update`, `delete` (soft). Pure business logic + AQL via `aql` helper. Mint `repo_id` (uuid v4 — `uuid` is already a dep). Reserve `graph_name`. Enforce uniqueness (`repo_id`, `graph_name`) + immutability in the service layer (ADR-okf-018). Throw `{status, code, message}`.
  - [x] Inline the FR-9 state constants (`register → validate → review → approve → publish → version → deprecate → retire`) in `repository-service.js` — 2.2 uses only `register` (initial) + `retire` (on delete). Extract to a `services/lifecycle.js` module in Story 4.3 (don't over-modularize now).
  - [x] `components/okf-server/services/graph-retract-service.js` — `async function retractRepoGraph(repo_id) { /* no-op until Story 2.6 — the OKF_{repo_id}_* graph collections don't exist yet */ return; }`. Called by `delete()`. Story 2.6 (dataprep, Python) replaces the body with an HTTP call to the document-repository bundle-retract route — **this stub is the contract 2.6 wires into.** Must not throw if the graph collections are absent.
- [x] **T3 — Routes + controller + validators** (AC: 2,3,4,5,7)
  - [x] `components/okf-server/routes/repos-routes.js` — `express.Router()`. **Do NOT re-mount `authenticate` here** — the child router inherits it from `okf-routes.js`'s `router.use(authenticate)`; mount only `requireRole('tools-admin')` on POST/PATCH/DELETE. Mount under `/api/okf/repos` by adding `router.use('/repos', require('./repos-routes'))` inside `routes/okf-routes.js` (single mount point in `index.js` stays). Each handler: joi validate → controller → `withSpan('okf.repo.<op>', ...)` → `next(err)` on failure.
  - [x] `components/okf-server/controllers/repository-controller.js` — thin HTTP layer (validate, call service, shape snake_case response, set status code). No business logic.
  - [x] `components/okf-server/validators/repository-validator.js` — joi schemas (create, patch). **POST required**: `name` (non-empty string), `domain` (service-category key), `acl` (object). **POST optional**: `source` (null = in-app authoring), `retention` (loose object). `acl.required_scopes` = array of `okf:{tenant}:{repo}:{read|admin}`-shaped strings (stored, NOT enforced — Story 6.1). **PATCH**: reject `graph_name`/`repo_id`/`domain` (immutable).
  - [x] Update `routes/okf-routes.js` root handler: change `status: 'skeleton'` → reflect real CRUD; update `endpoints` list.
- [x] **T4 — Authorization (tools-admin role + domain filter)** (AC: 2,3,4,5)
  - [x] `components/okf-server/middleware/require-role.js` — `requireRole('tools-admin')` middleware. **Read roles from the verified token**: OKF's `middleware/auth.js` sets `req.user = payload`, so check `Array.isArray(req.user?.realm_access?.roles) && req.user.realm_access.roles.includes('tools-admin')`. (There is **no `authorizeRole` helper in `gov-chat-backend`** to mirror — it reads `req.claims.realm_access.roles` inline at `routes/user-routes.js:111`; OKF uses `req.user`, not `req.claims`.) Apply to POST/PATCH/DELETE.
  - [x] Basic domain filter on list/read: derive caller's domains from token claims; if a domain-claim model doesn't exist yet, return all repos but log a warning (full per-tenant/repo/domain scope RBAC is Story 6.1 — do NOT build `chunk_labels`/RFC 8707 here).
- [x] **T5 — Audit** (AC: 2,4,5)
  - [x] `components/okf-server/services/audit-service.js` — `writeAudit({actor, action, repo_id, concept_id=null, version=null, ts, source_ip, trace_id})` appends to `okf_audit` (append-only; full Architecture §4 schema — `concept_id`/`version` null for repo CRUD, included now so Story 4.1+ doesn't reshape the writer). `source_ip` from `req.ip` (set `app.set('trust proxy', 1)` in `index.js` so Kong's forwarding is visible); `trace_id` from the active OTel span context. Call from create/update/delete. (FOI-export endpoint is Story 4.7/6.2 — not here.)
- [x] **T6 — Tests** (AC: 8)
  - [x] `__tests__/mocks/arango-mock.js` — mock the db module (collections + AQL query results) so no real ArangoDB is hit. Register via the test's module mock (not global).
  - [x] `__tests__/routes/repos-routes.test.js` — CRUD happy paths + error codes (404/409/403/400) + audit written + list domain filter. **Must start with `jest.mock('../shared-lib/keycloak-auth-service', ...)`** and mock the db.
  - [x] `__tests__/services/repository-service.test.js` — service unit tests (uniqueness, immutability, graph_name reservation, lifecycle default).
- [x] **T7 — Env + deploy wiring** (AC: 1)
  - [x] `docker-compose.yaml` okf-server service: add `ARANGO_URL`, `ARANGO_DB`, `ARANGO_USER`, `ARANGO_PASSWORD` env (mirror backend's Arango env block).
  - [x] No new deps (arangojs/joi/luxon/uuid already present). If a dep is genuinely needed, update `package-lock.json` too.
- [x] **T8 — Lint/format/verify** (AC: 7)
  - [x] `cd components/okf-server && npm run lint && npm run format:check && npm test` — all clean. ITU copyright header on every new file.

## Dev Notes

### Primary pattern to mirror: the Story 2.1 skeleton (DO NOT reinvent)
The skeleton is in place and 2.2 plugs into it. **Use the flat layout** (`routes/controllers/services/middleware/` at service root) per `project-context.md` — NOT the architecture §8.1 module directories (`repository-manager/`, etc.); 2.1 established the flat layout, continue it. Verified patterns:
- **`createApp()` + init order unchanged** (`index.js`): `require('./shared-lib/tracing')` → `metrics` → `dotenv` → express. Do not reorder. Mount new routes inside the existing `/api/okf` router.
- **Shared libs are IMPORTED, never copied** — `require('./shared-lib/tracing')`, `'./shared-lib/logger'`, `'./shared-lib/keycloak-auth-service'`. Path depth: `./shared-lib/...` from `index.js`; `../shared-lib/...` from `routes/`/`controllers/`/`services/`/`middleware/`.
- **Per-route auth** (`routes/okf-routes.js`): `router.use(authenticate)` inside each router, NEVER global. 2.2 adds `requireRole('tools-admin')` on mutating sub-routes.
- **`withSpan` per handler** (`routes/okf-routes.js` shows the idiom): `const body = await withSpan('okf.repo.create', async (span) => { span.setAttribute('okf.repo_id', id); span.setAttribute('okf.operation','create'); return ...; });` — no PII in attributes. No-op in tests (NODE_ENV=test).
- **Error flow**: handlers do `try { ... } catch (err) { next(err); }`. Services throw `err.status`/`err.code`; `middleware/error-handler.js` renders `{error, message}` (no 5xx leak, headersSent guarded).
- **Test loading is non-negotiable**: every test file MUST start with `jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));` because loading `index.js` → routes → `auth.js` → keycloak-auth-service → `jose` (ESM-only) crashes Jest. Then mock the db module. Jest config stays inline in `package.json` (the current 2.1 state — `gov-chat-backend` does have a standalone `jest.config.js`, but okf-server uses inline; leave as-is, don't add one).
- **Deps already present**: `arangojs ^8.8.1`, `joi ^17.9.2`, `luxon ^3.6.1`, `uuid ^11.0.0`. No `npm install` needed for these.

### Code-review fixes inherited from 2.1 (DO NOT regress)
SERVICE_NAME from env (don't hardcode) · OTLP exporter fallback · RS256 + audience + discovery-fetch timeout (don't weaken auth) · error-handler headersSent/no-leak · Bearer case-insensitive · CORS via `CORS_ALLOWED_ORIGINS` · MELT via OTLP (no prom scrape route) · luxon not native Date · `package-lock.json` committed · Dockerfile `npm ci --omit=dev`. The shared logger still has Winston file transports (logs volume mounted in compose) — `require('./shared-lib/logger')` as-is, do not edit it.

### Data model — the four control-plane collections (Architecture §4, exact fields)
All in the **same ArangoDB database** as the graphs (ADR-okf-018). Document collections (no edges between control-plane docs — relations are by `repo_id` reference).

| Collection | Key fields |
|---|---|
| `okf_repositories` | `repo_id`, `name`, `domain`, `source`, `graph_name`, `okf_version`, `lifecycle_state`, `version`, `curator`, `acl` (`required_scopes`, `sensitivity`), `retention`, `created_at`, `updated_at`, `deleted_at`, `delete_after` |
| `okf_concepts_meta` | `concept_id`, `repo_id`, `frontmatter`, `path`, `conformance_issues`, `pii_state`, `bundle_version`, `generated`, `verified`, `trust_tier` (derived), `status`, `stale_after`, `sources` |
| `okf_audit` | `actor`, `action`, `repo_id`, `concept_id`, `version`, `ts`, `source_ip`, `trace_id` (append-only) |
| `okf_sources` | per-repo source state (last commit SHA / S3 version, last sync, health) — populated by Story 2.7 |

**2.2 owns**: creates the collections + `okf_repositories` CRUD + `okf_audit` writes. `okf_concepts_meta` and `okf_sources` are **ensured to exist but not populated** by 2.2 (later stories fill them).

**Indexes (derived — docs don't specify; apply these, flagged):**
- `okf_repositories`: **use `repo_id` AS the document `_key`** (natural uniqueness + `DOCUMENT('okf_repositories/' + repo_id)` lookups — so no separate `repo_id` index needed); unique persistent on `graph_name`; persistent on `domain`.
- `okf_concepts_meta`: persistent on `repo_id`; unique persistent on `[repo_id, concept_id]`.
- `okf_audit`: persistent on `ts`; persistent on `repo_id`.
- `okf_sources`: unique persistent on `repo_id`.

### Repository / bundle / domain / graph model (ADR-okf-014)
**Repository = one OKF bundle = one domain binding = one graph `OKF_{repo_id}`.** 1 bundle per repo (the ADR rejected "many bundles per repo"). `domain` = a Genie **service-category key** (`/api/service-categories`). A domain may hold multiple repos. `graph_name = "OKF_" + repo_id` is **reserved here, materialized on first ingest by Story 2.6** (do NOT create graph collections in 2.2). Concept ID = file path with `.md` removed (concept CRUD is Story 4.1).

**Lifecycle (FR-9):** `register → validate → review → approve → publish → version → deprecate → retire`. Only `published` is served to agents. 2.2 uses `register` (on create) and `retire` (on delete); full transitions = Story 4.3.

### API contracts (Architecture §5, exact)
- **Base**: `/api/okf/repos`. **Conventions**: camelCase request / **snake_case response**, ISO-8601 (luxon), cursor pagination (`{items, next_cursor}`).
- **`POST /api/okf/repos`** — body `{name, domain, source?, acl, retention?}` → mints `repo_id`, `graph_name`, sets `okf_version:"0.2"`, `lifecycle_state:"register"`, `curator` (from token), timestamps → **201** snake_case repo doc.
- **`GET /api/okf/repos`** — `?cursor=&limit=` → **200** `{items:[...], next_cursor}` (domain-filtered).
- **`GET /api/okf/repos/{repo_id}`** → **200** repo doc.
- **`PATCH /api/okf/repos/{repo_id}`** — subset (name/source/acl/retention); `graph_name`/`repo_id`/`domain` rejected → **200**.
- **`DELETE /api/okf/repos/{repo_id}`** → soft-delete + audit → **202**; irreversible after grace window.
- **Create body `source`** (FR-1): `{type:"git"|"s3", endpoint, ref, credentialsRef, syncSchedule}` or null (in-app authoring). **Credentials are referenced (`credentialsRef`), NEVER persisted/returned in plaintext.**
- **`acl.required_scopes`** format (FR-18): `okf:{tenant}:{repo}:{read|admin}` — full scope plumbing is Story 6.1; 2.2 stores the field, doesn't enforce the scope matrix.
- **Response `acl` casing**: normalize to lowercase `acl` (Architecture §4 table uses `ACL`, but prd §9 mandates snake_case — use `acl`).
- **Do NOT return `source.credentialsRef` secrets / internal `_key` / `_id` / `_rev`** in responses (strip Arango internals).

### Authorization boundary — 2.2 vs Story 6.1 (IMPORTANT)
2.1 wired the Kong route + OIDC `authenticate` only. **2.2 adds**: (a) `requireRole('tools-admin')` on POST/PATCH/DELETE (read `req.user.realm_access.roles` — see T4; there is **no backend helper to copy**); (b) a **basic** domain filter on list/read. 2.2 does **NOT** build: the `okf:{tenant}:{repo}:{read|admin}` scope matrix, `chunk_labels` ACL encoding, or RFC 8707 audience binding — that full RBAC is **Story 6.1**. If the token has no usable domain claim yet, return all repos + log a warning (don't block).

> ⚠️ **End-to-end caveat (read this):** the `tools-admin` Keycloak realm role is **provisioned by Epic 6 / FR-18** (architecture §12 keycloak-config), **NOT by this story**. Until Epic 6 lands, every mutating call (`POST`/`PATCH`/`DELETE`) will **403 against a real Keycloak token**. Story 2.2 is therefore verifiable **only via unit/integration tests with a mocked `req.user.realm_access.roles = ['tools-admin']`**; live/E2E validation against a deployed Keycloak is deferred to after Epic 6. This is expected, not a bug.

### ArangoDB connection — via the SHARED db-connection-service (corrected)
**Use the shared `components/shared/lib/db-connection-service` singleton for ALL connection management — do NOT reinvent a connection module** (an earlier `db/arango-connection.js` violated the "import shared libs" standard and was removed). Require it directly: `const dbService = require('../shared-lib/db-connection-service')` — NOT the shared-lib `index.js` (which pulls `security-middleware` + backend-only deps and crashes). Pattern (mirror `gov-chat-backend/services/chat-history-service.js`): cache `dbService.getConnection('default')` (a self-healing arangojs-compatible proxy), then `db.collection(name)` / `db.query(aql\`...\`)`. The shared service handles pooling, health checks, and auto-recovery. `async-retry` is a required dep. **No ORM/repository pattern (AC8)** — direct AQL only. There is no `tracing-db.js` in `components/shared/lib/` (only in gov-chat-backend) — do not require it; DB query spans come from OTel auto-instrumentation only. In tests, mock `../shared-lib/db-connection-service` (`{ getConnection: jest.fn(() => Promise.resolve(mockDb)) }`).

### Open questions — derived defaults (confirm with PO/architect if any block)
1. **`repo_id` format** (prd §13 Open Q #4) → **uuid v4** (`uuid` dep present). Simple, collision-free.
2. **Max repos** (Open Q #4) → no limit enforced in 2.2.
3. **Update method** → **PATCH** (partial).
4. **Response envelope** → raw snake_case object (single); `{items, next_cursor}` (list). No `{data, meta}` wrapper (skeleton uses raw `res.json`).
5. **`retention` sub-shape** (Open Q #6) → opaque JSON object, loose joi validation.
6. **Collection creation timing** → ensure on boot (fire-and-forget, non-fatal).
7. **Delete grace window** → soft-delete: stamp `deleted_at` + `delete_after` (configurable, default e.g. 7d via `OKF_DELETE_GRACE_HOURS`); a later sweep does hard delete. Graph retract is a no-op until 2.6.
8. **`okf_sources` on create** → don't create a doc in 2.2 (Story 2.7 owns source state); only ensure the collection exists.
9. **Pagination params** → `cursor`, `limit` (default 50, **max 100** via `Math.min(limit, 100)`); response `next_cursor`.
10. **`DUPLICATE_REPO` trigger** → fire on duplicate `(name, domain)` (the human-meaningful uniqueness); `repo_id`/`graph_name` are uuid-derived so won't naturally collide.

### Project standards (from `_bmad-output/project-context.md` — MUST follow)
CommonJS only (`require`/`module.exports`, never `import`) · `const`/`let`/no-`var` · 2-space/single-quote/semicolon · controller→service split (controllers PascalCase+suffix or kebab — **match `gov-chat-backend`'s actual controller naming**; routes/services/middleware kebab-case) · flat at service root (no `src/`) · `createApp()` · per-route auth NEVER global · direct AQL no ORM · joi at boundary · `{error, message}` shape · `withSpan` never global tracer · shared logger never bypass safeStringify · identity from token (`iss_sub`/`sub`/`iss`), never `_key` · Jest mocks ArangoDB at module level · `createApp()`+supertest · ITU copyright header on every file.

### Out of scope (later stories)
- Concept CRUD (4.1), in-app authoring (4.2), full lifecycle transitions (4.3), review/approval (4.4), versioning/provenance (4.5), retention/TTL enforcement (4.6), FOI/audit export (4.7/6.2).
- Bundle ingest (2.5), dataprep `graph_name` wiring + graph creation + retract (2.6 — gated by OPEA 1.5 bump), source sync (2.7), PII redaction (2.8).
- Source sync/reachability — 2.2 only **stores** the `source` ref (+ `credentialsRef` string, never resolved); reachability/sync is Story 2.7.
- Full per-tenant/repo/domain scope RBAC + `chunk_labels` + RFC 8707 (6.1).
- OKF v0.2 frontmatter families parsing (2.3) — 2.2 only ensures `okf_concepts_meta` exists with the columns; doesn't parse.

## Dev Agent Record

### Agent Model Used
Claude (glm-5.2[1m]) — dev-story execution

### Debug Log References
- Local build (`C:\Dev\builds\main`): `main-okf-server-1` Up (healthy); `/health` → 200; Kong `/api/okf/repos` → 401 (route mounted + auth active).
- Boot log (via the shared `db-connection-service`): `[DB_CONNECTION] ArangoDB login successful for default` + `New connection created and stored: default` + `OKF control-plane collections ensured` → verified all four `okf_*` collections exist in the real `genie-ai` ArangoDB via the Arango HTTP API.
- Tests: **42/42 passing** across 4 suites (health, auth, repos-routes, repository-service). ESLint 0 errors, Prettier clean.

### Completion Notes List
- **DB layer uses the SHARED `db-connection-service`** (`components/shared/lib`) — `getConnection('default')` self-healing proxy; the earlier reinvented `db/arango-connection.js` was removed (it violated the "import shared libs" standard). Added `async-retry` dep. Live-verified via the shared service's boot log.
- Repository CRUD (`POST/GET/PATCH/DELETE /api/okf/repos`) implemented on the 2.1 skeleton, mounted inside the existing `/api/okf` router (inherits `authenticate`).
- Four control-plane collections ensured in the **same ArangoDB database** as the graphs via `ensureCollections()` on boot (fire-and-forget, non-fatal).
- `repo_id` = uuid v4, used **AS the document `_key`**; `graph_name = OKF_{repo_id}` reserved (graph materialized by Story 2.6).
- **MELT in every method**: `withSpan('okf.repo.*')` (non-PII attributes) + shared logger + `okf_repo_operations_total` OTel counter; HTTP metrics via the 2.1 middleware.
- Authz: `requireRole('tools-admin')` on mutations; basic `callerDomain` filter on list/read (full per-tenant/repo/domain RBAC is Story 6.1).
- Audit (`okf_audit`) writes on create/update/delete; **best-effort** (logged, never fatal to the main op). `trace_id` from active OTel span, `source_ip` from `req.ip` (trust proxy).
- **All exceptions handled + logged**: services throw `RepoError {status, code}`; controllers `try/catch → next(err)`; error-handler logs + renders `{error, message, details}`; audit + graph-retract are non-fatal.
- Direct arangojs (no ORM); cursor pagination (`limit` capped at 100); immutability (`graph_name`/`repo_id`/`domain`) → 409 `FIELD_IMMUTABLE`; soft-delete + grace window (`OKF_DELETE_GRACE_HOURS`); graph-retract is a no-op stub (the contract Story 2.6 wires into).
- Per the documented `tools-admin` caveat: live API mutations 403 against real Keycloak until Epic 6 provisions the role; CRUD logic verified via the 42 unit/integration tests + the live data-layer (collections created in real Arango).

### File List
**Created:**
- `components/okf-server/db/collections.js` — `ensureCollections()` for the 4 `okf_*` collections + indexes (via the shared db-connection-service)
- `components/okf-server/services/repository-service.js` — CRUD + direct AQL + MELT (counter/spans/logs) + RepoError
- `components/okf-server/services/audit-service.js` — append-only `okf_audit` writer (best-effort)
- `components/okf-server/services/graph-retract-service.js` — no-op stub (contract for Story 2.6)
- `components/okf-server/controllers/repository-controller.js` — thin HTTP layer (joi validate → service → snake_case response)
- `components/okf-server/validators/repository-validator.js` — joi create/update schemas
- `components/okf-server/routes/repos-routes.js` — repo CRUD routes (tools-admin on mutations)
- `components/okf-server/middleware/require-role.js` — `requireRole('tools-admin')` (reads `req.user.realm_access.roles`)
- `components/okf-server/__tests__/mocks/arango-mock.js` — in-memory ArangoDB mock
- `components/okf-server/__tests__/repository-service.test.js` — service unit tests (CRUD, errors, audit, immutability, pagination)
- `components/okf-server/__tests__/repos-routes.test.js` — route integration tests (auth, role, validation, status codes)

**Modified:**
- `components/okf-server/index.js` — `app.set('trust proxy', 1)` + `ensureCollections()` on boot
- `components/okf-server/routes/okf-routes.js` — mount `/repos` + updated root handler
- `components/okf-server/middleware/error-handler.js` — render `details` for client errors (validation)
- `docker-compose.yaml` — okf-server `ARANGO_*` env + `OKF_DELETE_GRACE_HOURS`
- `components/okf-server/package.json` + `package-lock.json` — added `async-retry` (required by the shared `db-connection-service`)

### Change Log
- 2026-08-12: Story 2.2 implemented — repository CRUD + control-plane collections + MELT + audit + role authz (42 tests green, deployed + verified in local build).
