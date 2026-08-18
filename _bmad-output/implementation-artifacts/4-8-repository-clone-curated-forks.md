---
baseline_commit: 3d8add4264b43bba74bdbc0bb7269dfb591333fd
---
# Story 4.8: Repository clone & curated forks — the clone API (D-V5)

Status: review

Story key: `4-8-repository-clone-curated-forks` | GitLab: #971
Epic: 4 (In-App Concept Authoring & Curation) | Branch: `feat/okf-server`
FRs: **FR-25** (in-app curation), FR-11 (versioning lineage) | Gap: clone backend (design addendum **D-V5**) | ADRs: okf-005 (versioning), okf-021 (write path), okf-030 (lifecycle — 4.3), okf-031 (versioning strategy)
Directives: [design addendum D-V5 §"Backend semantics"](../planning-artifacts/prds/prd-okf-server-2026-07-15/design-addendum-versioning-integrity-clone-2026-08-16.md) + [epics Story 4.8](epics.md)

> **The gap:** a steward can create, ingest, index, mint, and retract OKF repositories — but there is **no way to fork one**. D-V5 mandates an application-level clone: a NEW repository (new `repo_id`, new `OKF_{repo_id}` graph, unique registry entry, `lifecycle_state='draft'`) that copies the source's concepts + meta (the `(title, bundle_version, content_hash)` identity triple preserved) and records lineage `cloned_from: { repo_id, version }` — ready for in-app curation via Epic 4 without ever touching the original. This story ships the backend `POST /api/okf/repos/:source_id/clone` + the meta-copy service and the D-V5 §8.4 smoke obligation. The Admin-Dashboard authoring UI is Story 3.9 (consumes this API) — **NOT here**.

## Story

As a **steward**,
I want **to clone an OKF repository into a new, draft, independently-authorable repository that keeps the source's concepts + meta and its origin lineage**,
so that **I can adapt a published knowledge base to my context and curate my copy through the existing write path — without ever touching the original**.

## Acceptance Criteria

1. **`services/repository-service.js` — `cloneRepository(source_id, input, actor)` (NEW method)**, the clone contract (D-V5 backend semantics):
   - Resolves the source (404 `REPO_NOT_FOUND` when missing **or soft-deleted** — same `getById` semantics; the controller runs the authz-aware pre-gate first, mirroring ingest).
   - **Target identity**: `name = input.name ?? \`${source.name} (clone)\``; `domain = input.domain ?? source.domain`; `acl = input.acl ?? source.acl ?? {}` (a fork inherits the source's access policy by default — the 3.9 flow pre-fills `<source> (clone)` + the same domain). Uniqueness on `(name, domain, deleted_at)` is DB-ENFORCED; the app-layer dup-check returns **409 `DUPLICATE_REPO`** (the exact `create()` fast-path + index backstop — no new uniqueness machinery).
   - **New registry entry** reusing the `create()` doc shape (new `repo_id` = new `_key`, `graph_name = OKF_{repo_id}` minted at creation, `okf_version` from the source, `version: null`, `curator` = actor) **with two additive deltas**: `lifecycle_state: 'draft'` and `cloned_from: { repo_id: source_id, version: source.version ?? null }`. **Additive (R5)**: `create(input, actor, opts)` gains optional `opts = { lifecycle_state?, cloned_from?, audit_action? }` defaulting to today's `INITIAL_STATE`/'register' / no `cloned_from` / `'repo.create'` — existing callers are byte-identical. `draft` is ADDED to `LIFECYCLE_STATES` (additive enum value; nothing validates the enum strictly — verified: only repository-service + tests reference it; Story 4.3 owns the state machine and must include a `draft` entry in its `TRANSITIONS` map — noted in scope boundary).
   - **Copy the source's concepts + meta** — the D-V5 identity triple **preserved verbatim**: for every `okf_concepts_meta` row of the source, INSERT into the clone with `repo_id = new_id`, `graph_name = OKF_{new_id}`, **`concept_id` verbatim (NEVER re-derived — the 2.9.3 `concepts/`-prefix lesson: subdirectory bundles store `concepts/index`; a re-derivation would orphan the clone's editor tree)**, `title` / `bundle_version` / `content_hash` / `index_status` / `pii_state` / `conformance_issues` / `lifecycle_status` / `trust_tier` / `labels` / `links` / `frontmatter` / `sources` / `created_at` **all copied unchanged**, `updated_at` = clone time. The `(repo_id, concept_id)` unique index guards the copy (a re-run clone into the same target would be caught by the registry dup-check first).
   - **The copy is metadata-only (D-V5 v1 semantics, documented):** chunks/edges are NOT copied — the clone's graph materializes lazily on re-ingest via the EXISTING write path (2.9.1 orchestrator → 2.9.4 worker → dataprep `_ensure_graph_collections` on first ingest of the clone's `OKF_{new_id}` graph). Because `index_status` is preserved, an unchanged+indexed concept **dedup-skips** on re-ingest (the 4e rule — it already "belongs" to its version); a **modified** concept re-ingests into the **clone's OWN graph**. The source graph is never written by the clone path (isolation).
   - MELT + audit: `withSpan('okf.repo.clone')` + `okf_repo_operations_total` operation=`clone` + `auditService.writeAudit({ action: 'repo.clone', actor, repo_id: new_id, source_ip })` (best-effort). Return `{ ...toResponse(newRepo), cloned_from, copied_concepts: N }`.
2. **`POST /api/okf/repos/:source_id/clone` (repos-routes.js, after the versions routes)** — gate `requireRepoScope('source_id', 'admin')` (admin on the SOURCE repo; wildcard/tools-admin pass — the clone reads the source wholesale, so it is a source-admin mutation, mirroring ingest's admin gate). Controller pre-gate: `repoService.getById(source_id, { authz: authzForService(req) })` — foreign/missing ⇒ **404** (anti-enumeration, exactly the ingest pattern at [repository-controller.js:159](components/okf-server/controllers/repository-controller.js)). Body (Joi, all optional): `{ name?, domain?, acl? }` — empty body is VALID (defaults derived); a `name`/`domain` that collides with a live repo returns **409 `DUPLICATE_REPO`**. Resolves **201** with the AC-1 response. (Synchronous — the clone only copies registry+meta rows; it never enqueues. The D-V5 §"Confirm + progress → 202" language is the frontend UX narrative; the API is a synchronous 201, consistent with `POST /repos` create. Decision D-2.)
3. **The ORIGINAL is never touched** (isolation, D-V5 §8.4): the clone path reads the source's registry + meta rows only — no writes to the source's graph, meta, files docs, or versions. Asserted live by the smoke (chunk + edge counts unchanged around the clone's re-ingest).
4. **Versioning + lifecycle interplay (unchanged contracts):**
   - `cloned_from.version` = the source's CURRENT `version` at clone time, or `null` when the source was never minted. The clone's OWN `version` starts `null` — it mints its own via `mintVersion` (2.9.7, D-V4) when it publishes/crawls. The copied meta rows KEEP the source's `bundle_version` (the identity triple is preserved); the clone's re-ingest threads the CLONE's version (`null` until the clone mints) — this is correct D-V4 semantics (a fork's content belongs to the fork's versions, cited by the fork's manifests).
   - The D1 Pending-gate applies **unchanged** to the clone: minting the CLONE refuses while the CLONE has Pending files docs. Cloning does NOT enqueue, so a clone is immediately mintable — but a steward who re-ingests then mints must wait for the worker (existing 2.9.7 contract, nothing new).
5. **Edge cases (must hold):** cloning a soft-deleted source → 404; cloning an empty source (0 meta rows) → valid draft fork (`copied_concepts: 0`, no error); a source that is ITSELF a clone → the new clone's `cloned_from` points at the immediate parent (lineage is a parent pointer, no recursion — D-V5 "stewards can diff against `cloned_from` versions" resolves transitively through the chain); re-cloning the same source always mints a NEW unique repo (clones are never idempotent — that is the fork semantics); the copied `concept_id` set may contain `concepts/`-prefixed ids (subdirectory bundles) — copied verbatim.
6. **Tests** — repository-service units (clone 404 unknown/deleted; 409 duplicate target via the app dup-check AND the DB-index backstop; new repo_id + `OKF_{new}` graph minted; `lifecycle_state='draft'`; `cloned_from` version null + version=N; meta rows copied with the triple + `concept_id` verbatim incl. a `concepts/`-prefixed fixture; source meta rows + graph NOT mutated; `create()` additive opts default = legacy 'register' + no `cloned_from` — pins the R5 default); route tests (repos-routes matrix style: 201 admin, 403 scoped-read, 404 foreign super-admin via getById, 409 duplicate, empty body valid → 201, gate order getById-before-clone); ESLint/Prettier clean. **No doc-repo / dataprep changes** — the clone reuses the entire existing write path.
7. **Smoke (live gate, R1 — extend `run-smoke.js`)**, D-V5 §8.4:
   - **Early (fresh ADMIN token, in the ingest phase):** `POST /api/okf/repos/{INGEST_REPO}/clone` with the SCOPED token → **403 FORBIDDEN_SCOPE** (read ≠ admin — the live HTTP authz gate).
   - **Late clone phase** (after the edges phase, before the retraction phases — the source must be fully drained + minted): snapshot the SOURCE graph's chunk + edge counts (`OKF_{INGEST_REPO}_SOURCE` / `_LINKS_TO`); clone via the **service module in-container** (established pattern for late phases — user tokens are expired; the HTTP 201/404/409 matrix is unit-tested) → assert new repo_id ≠ source, `graph_name === OKF_{clone}`, `lifecycle_state === 'draft'`, `cloned_from === { repo_id: INGEST_REPO, version: 2 }`, name derived; assert **6 copied meta rows** — `concept_id` set identical to the source's (incl. `bad_concept`), `title`/`bundle_version`/`content_hash` equal the source's meta for the same concept_id, `graph_name === OKF_{clone}`; then **modify ONE concept** (service_directory) → re-ingest the clone via `ingestService` → assert **skipped_dedup=5, enqueued=1** (the preserved `index_status='indexed'` makes the other 5 dedup-skip) → the worker drains it → assert the modified concept's chunks exist in `OKF_{clone}_SOURCE` and **ZERO chunks for the clone's file_ids in `OKF_{INGEST_REPO}_SOURCE`**, and the **source's chunk + edge counts are UNCHANGED** (isolation — the original is never touched); assert the clone's other 5 concepts have ZERO chunks in the clone graph (metadata-only until curated). **Re-run safety**: cleanup at clone-phase start (find + remove prior smoke clones by the fixed clone name + purge meta/files/versions + registry tombstone); registry hygiene at phase end (remove the clone + drop its graph via the real `remove()` → `retractRepoGraph`).
   - Success criteria (smoke-test-integrity): all of the above assert REAL state (Arango counts, physical chunk placement, meta field equality), exit non-zero on any failure.

## Tasks / Subtasks

- [x] T1 `LIFECYCLE_STATES` += `'draft'` (additive enum value) + `create()` additive `opts` (`lifecycle_state`/`cloned_from`/`audit_action`, defaults = legacy) — with a test pinning the legacy default (AC 1)
- [x] T2 `repository-service.cloneRepository` (AC 1, 3, 4, 5) + unit tests
- [x] T3 Route `POST /:source_id/clone` + controller `cloneRepo` (AC 2) + route-matrix tests
- [x] T4 Smoke extension (AC 7): early 403 + late clone/assertions/isolation/cleanup; live run to exit 0
- [x] T5 Suites (okf-server + doc-repo + overlay — regression) + lint/format; story close-out (sprint status, #971 evidence, push)

## Dev Notes

### Decisions (ambiguities resolved — verify against code before coding)

- **D-1 `lifecycle_state='draft'` is implemented literally** (the epics 4.8 AC + D-V5 both say it). `draft` is ADDED to the repo `LIFECYCLE_STATES` enum ([repository-service.js:29](components/okf-server/services/repository-service.js)) — additive; verified nothing validates the enum strictly (only repository-service + its tests reference it). Story 4.3 (lifecycle state machine) must include `draft` in its `TRANSITIONS` map — noted in scope boundary. A manually-created repo stays `'register'`; a clone enters `'draft'` — two distinct entry states, both documented.
- **D-2 the clone is synchronous → 201** (not the D-V5 §"202" narrative): it copies registry + meta rows only, never enqueues, so it completes in-request. The 3.9 UI treats it as "confirm → the new repo appears at draft". The `202` in D-V5's §8.1 is UX prose for "the action was accepted".
- **D-3 clone copies meta only, preserves `index_status` verbatim** — the D-V5 "copies the source's concepts + meta" reading. Consequence (asserted in the smoke): unchanged+indexed concepts dedup-skip on the clone's re-ingest (the 4e rule), so only MODIFIED concepts materialize chunks into the clone graph. A steward who wants a fully-materialized fork re-ingests after curation (the AC's "re-run the full ingest pipeline"). This is the intended v1 semantics; the alternative (reset to `parsed` → whole-fork re-index) is documented in deferred-work as the 4.8b candidate.
- **D-4 the clone inherits the source's `acl` by default** (a fork keeps the source's access policy; an explicit `acl` in the body overrides). The `(name, domain)` registry uniqueness is the ONLY target constraint.
- **D-5 the "new graph" is the `graph_name` mint on the registry doc + lazy `_ensure_graph_collections` on first ingest** (exactly how `create()` + 2.9.6 behave today — verified: dataprep `_ensure_graph_collections` creates the 4 `OKF_{graph}_*` collections on first ingest, [genieai_dataprep_arangodb.py:1286-1307](../../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py), and no named-graph definition is created for per-repo graphs). The clone does NOT eagerly create collections — consistent with `create()`; the smoke asserts physical chunk placement after the clone's re-ingest as the "graph exists" proof.

### Verified code anchors (read before coding — file:line checked 2026-08-18)

- `services/repository-service.js` — `create()` mint pattern (:127-195): `repo_id = uuidv4()`, `graph_name = OKF_{repo_id}`, `_key = repo_id`, `INITIAL_STATE='register'`, `version: null`, `curator`, `acl`, dup-check + unique-index backstop (:137-182); `IMMUTABLE_FIELDS` (:32) — the clone's `graph_name`/`repo_id`/`domain` stay immutable (no PATCH path touches them); `getById` (:282) — the controller pre-gate; `LIFECYCLE_STATES`/`INITIAL_STATE` (:29-31) — the `draft` addition + `create()` opts live here.
- `services/concept-meta-service.js` — `buildMetaDoc` (:92-130) writes the first-class fields the clone copies; `contentHash` (:74-78) is the CANONICAL trimmed-body sha256 — the copy must preserve the STORED `content_hash` field, never recompute; `upsertConceptMeta` (:182) the `(repo_id, concept_id)` unique guard.
- `controllers/repository-controller.js` — `ingestRepo` (:124-169) is the EXACT gate template (Joi-less manual body handling + `getById(repo_id, { authz })` pre-gate → 404 anti-enumeration → service → status); `mintRepoVersion` (:177-187) the 201 route pattern; `authzForService` (:56-59).
- `routes/repos-routes.js` (:18-38) — slot `POST /:source_id/clone` after the versions routes; `requireRepoScope('source_id', 'admin')` (:13-15 in middleware/require-scope.js — param name MUST be `source_id` so `req.params.source_id` resolves).
- `services/version-service.js` — `mintVersion` (:85-220): the D1 Pending-gate + self-healing the clone's OWN mint will reuse (unchanged); `source.version ?? null` is the `cloned_from.version` source.
- `services/ingest-service.js` — `_ingestWithCap` (:223-442): the clone's re-ingest path — `getById` → `deriveAclLabels` → `bundleVersion = repo.version ?? null` → 4b/4c/4d/4e/4f. The clone's re-ingest needs ZERO changes (graph_name + repo_id + bundle_version all derived from the clone's registry doc).
- `services/graph-retract-service.js` — `retractRepoGraph` (:41-161): the clone's cleanup path on `remove()` (drops the clone's graph + meta + files + versions). `remove()` in repository-service (:401-442) is the smoke's clone-cleanup.
- **Test conventions**: `__tests__/repos-routes.test.js` — `authzAwareServiceMock` (:162-175) + the ingest/versions route-matrix describe blocks (:312-580) are the clone-route test template (add the clone mock to the factory); `__tests__/repository-service.test.js` — the create/dup/lifecycle test shapes; `mocks/arango-mock.js` the shared service test mock.
- **Smoke**: `data/okf/smoke-test/run-smoke.js` — the ingest phase's early scoped-403 assert + the service-module late-phase pattern (mint :800-834, re-ingest :769-779, edges :961-1013); the re-run-safety cleanup + bundle-retract blocks (:423-458, :1147-1195) are the clone-phase cleanup template. `mint-tokens.mjs` — token mechanics (unchanged; the clone late phase uses the in-container service module, no new token).

### Previous-story intelligence (2.9.1/2.9.3/2.9.4/2.9.7 — all live-proven this initiative)

- **`concept_id` is NOT canonical** (2.9.3 live-caught): subdirectory bundles store `concepts/`-prefixed ids — the clone copies `concept_id` VERBATIM, never re-derives.
- **`originalFileName` is NEVER persisted** (2.9.7): the clone copy reads `okf_concepts_meta` only — no doc-repo `files` reads.
- **MELT + audit + isolation**: every new method traced/countered; audit actor = sub STRING; the smoke asserts physical state (Arango counts), never a 200 alone.
- **Token TTL mechanics**: user tokens are 5-min; late phases use in-container service-module calls; the service token (client_credentials) is re-mintable but NOT an OKF admin (doc-repo-role only) — so the late clone cannot go through the HTTP surface (that is why the HTTP matrix is unit-tested + the early 403 is the live HTTP proof).
- **AQL**: hyphenated `OKF_{uuid}` collection names need backticks; capture `docker exec` exit WITHOUT pipes.
- **R5 additive-first**: the `create()` opts are the ONLY pre-OKF surface touched — default = legacy behavior, pinned by a test.

### Scope boundary (do NOT build)

Admin-Dashboard clone UI (Story 3.9 — consumes this API; details-dialog lineage surfacing is 3.2's amendment) · OKF Studio clone source card (3.4/3.5) · eager whole-fork re-index ("clone is fully materialized") — the `parsed`-reset alternative is deferred (see D-3) · `draft → register/validate` transition wiring (Story 4.3's `TRANSITIONS` map must include the new `draft` entry) · diffing the clone against `cloned_from` (4.5 consumes the manifest list endpoints) · upstream auto-sync / cherry-pick (D-V5 explicitly says never auto-propagate) · ANY change to the source's data (isolation is the contract) · chunks/edges copy.

### References

- Design addendum D-V5 §"Backend semantics" + §"Smoke obligation" ([design-addendum-versioning-integrity-clone-2026-08-16.md](../planning-artifacts/prds/prd-okf-server-2026-07-15/design-addendum-versioning-integrity-clone-2026-08-16.md):57-79)
- Epics Story 4.8 ([epics.md](../planning-artifacts/prds/prd-okf-server-2026-07-15/epics.md):543-552) + Story 3.9 (the UI consumer, :450-464)
- PRD FR-9 (lifecycle), FR-11 (versioning lineage), FR-25 (in-app curation)
- ADR-okf-030 (lifecycle state machine — 4.3), okf-031 (versioning), okf-021 (write path)
- Live baseline: 2.9.1 orchestrator, 2.9.6 graph wiring (lazy `_ensure_graph_collections`), 2.9.7 mint/versioning, 2.9.3 edges — all smoke-asserted on `feat/okf-server`

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash[1m] (dev-story, 2026-08-18)

### Debug Log References

- **Red-green:** the clone route/service tests were written to the story ACs first (cloneRepository + create() opts + route matrix); they cannot pass without the implementation (new feature — the route 404s / the service export is undefined pre-change). Target suites: `repository-service.test.js` + `repos-routes.test.js` **88/88**, full okf-server **311/311** (was ~296 before the +15 clone/opts tests); doc-repo **429/429** (regression — NO doc-repo/dataprep change, per AC 6); ESLint 0 errors, Prettier clean (rtk proxy to avoid the phantom wrapper).
- **Live smoke (local build at C:\Dev\builds\main, okf-server image rebuilt at cfad731):** run 1 = **REAL_EXIT_CODE=0, 71 PASS / 0 FAIL**. (Two prior shell invocations never reached the smoke: an MSYS path-mangling of the token file, then of `/app/run-smoke.js` — fixed with `MSYS2_ARG_CONV_EXCL='*'`; NOT smoke failures.) The **clone phase (D-V5 §8.4) passed end-to-end live**:
  - `clone: scoped READ caller -> 403 FORBIDDEN_SCOPE` (early HTTP admin-gate)
  - `clone: new repo_id + OKF_53a80d79-… graph + lifecycle_state=draft (unique registry entry)`
  - `clone: cloned_from { repo_id: source, version: 2 } lineage recorded`
  - `clone meta: 6 concepts copied` + `title/bundle_version/content_hash/index_status preserved verbatim + graph rewritten to OKF_{clone}`
  - `clone re-ingest: 5 dedup-skipped (unchanged+indexed), 1 enqueued (modified concept)` — the preserved index_status makes the other 5 dedup-skip
  - `clone: the modified concept's files doc is graph-stamped to the CLONE graph`
  - `clone: worker drained the modified concept to Ingested`
  - `clone: modified concept indexed into the CLONE graph (3 chunks in OKF_53a80d79-…_SOURCE)`
  - `clone isolation: ZERO clone chunks in the SOURCE graph` + `SOURCE chunks+edges UNCHANGED (21 chunks / 174 edges — the original is never touched)`
  - `clone: exactly the modified concept materialized in the clone graph (3 chunks; the other 5 metadata-only until curated)`
  - `clone: cleanup — clone removed, its OKF_… graph dropped`
  - Every PRIOR assertion stayed green (authz matrix, zip ingest, worker drain, dedup, mint v1/v2 + manifests, edges, dual retraction) — the assertions never shrink.

### Completion Notes List

- **All 5 tasks / 7 ACs satisfied.** `LIFECYCLE_STATES` += `'draft'` (additive; Story 4.3 must include a `draft` TRANSITIONS entry — noted in scope boundary). `create(input, actor, opts)` gained ADDITIVE opts (`lifecycle_state`/`cloned_from`/`audit_action`) — the legacy default (register / no cloned_from / repo.create) is pinned by a test.
- **`cloneRepository`** mints a NEW repo (new repo_id + `OKF_{new}` graph, lifecycle `'draft'`, `cloned_from { repo_id, version: source.version ?? null }`), copies the source's `okf_concepts_meta` rows VERBATIM (concept_id AS-IS incl. `concepts/` prefixes; title/bundle_version/content_hash/index_status/pii_state/etc. preserved; graph rewritten; created_at kept, updated_at stamped), metadata-only (no chunks/edges — content materializes on re-ingest into the clone's own graph), never touches the source.
- **Route** `POST /api/okf/repos/:source_id/clone` — `requireRepoScope('source_id','admin')` + getById pre-gate (404 foreign, anti-enumeration, mirrors ingest) + all-optional body (defaults derived) → 201 with `{...repo, cloned_concepts}`; 409 DUPLICATE_REPO on target collision. Synchronous 201 (D-2).
- **Smoke** extended: early scoped-READ 403 + the late clone phase (meta triple, dedup-aware re-ingest, clone-graph-only indexing, source isolation, cleanup). Re-run-safe (fixed clone name cleanup + registry tombstone purge).
- Commits: `3b806144` (story + sprint status, create-story), `cfad731c` (implementation + smoke + tests).

### File List

- components/okf-server/services/repository-service.js — LIFECYCLE_STATES += 'draft'; create() additive opts; cloneRepository (NEW)
- components/okf-server/controllers/repository-controller.js — cloneRepo controller (NEW)
- components/okf-server/routes/repos-routes.js — POST /:source_id/clone (NEW)
- components/okf-server/validators/repository-validator.js — cloneSchema (NEW)
- components/okf-server/__tests__/repository-service.test.js — create-opts + cloneRepository tests (+15)
- components/okf-server/__tests__/repos-routes.test.js — clone route matrix (+6)
- data/okf/smoke-test/run-smoke.js — clone phase + early 403 + success criteria (criterion 14)
