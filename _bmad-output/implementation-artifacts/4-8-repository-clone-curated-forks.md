---
baseline_commit: 3d8add4264b43bba74bdbc0bb7269dfb591333fd
---
# Story 4.8: Repository clone & curated forks — the clone API (D-V5)

Status: done

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
5. **Edge cases (must hold):** cloning a soft-deleted source → 404; cloning an empty source (0 meta rows) → valid draft fork (`copied_concepts: 0`, no error); a source that is ITSELF a clone → the new clone's `cloned_from` points at the immediate parent (lineage is a parent pointer, no recursion — D-V5 "stewards can diff against `cloned_from` versions" resolves transitively through the chain); **each clone mints a NEW unique `repo_id`** (clones are never idempotent — that is the fork semantics) **but the derived default name `<source> (clone)` collides after the first fork → 409 `DUPLICATE_REPO`** (the 3.9 UI pre-validates the target and prompts for a distinct name — the 409 is the designed contract, review-fix 2026-08-18); the copied `concept_id` set may contain `concepts/`-prefixed ids (subdirectory bundles) — copied verbatim.
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

## Dev Agent Record (review-fix pass, 2026-08-18)

### Agent Model Used

deepseek-v4-flash[1m] (code-review patch pass)

### Review-fix evidence

- **10 findings fixed** (1 HIGH + 7 LOW/MEDIUM + 2 NIT) + **7 deferred** + **3 dismissed**. All applied patches keep the additive R5 discipline (the legacy `create()` default stays pinned by a test). **okf-server 316/316** (was 311; +5 review-fix tests), ESLint/Prettier clean.
- **Post-patch live runs (honest history, local build at C:\Dev\builds\main):**
  - r1 (pre-review dev build): exit 0, 71 PASS.
  - r2: never ran — the container recreate wiped the docker-cp'd fixtures (`ENOENT /app/kenya-bundle`), not a smoke failure; re-cp'd.
  - r3: exit 1 (4 FAILs) — the 2.9.4 worker's 15s poll fired between the zip enqueue and the files-docs snapshot, claiming one concept (`Ingesting`) → the "Pending: 6" count is a ~50% timing race, not a defer_kick violation. **Fixed:** the files-docs assertions + drain now run on ALL the repo's files docs (7e5c318).
  - r4: exit 1 (5 FAILs) — the worker sets the FILE status to `Ingested` BEFORE transitioning the META to `indexed` (~1s window); the one-shot (vii) check read service_directory mid-transition → phase (viii) re-enqueued it → the mint's D1 Pending-gate refused. **Fixed:** (vii) settle-waits (up to 60s) for all meta rows to reach `indexed`+`last_good_index_at` (0f58ce2).
  - r5: exit 1 (1 FAIL) — the versioned-edge assertion (bundle_version=1 from the modified re-ingest) fired before the worker's post-index edge write landed (same file-before-meta/edges window). **Fixed:** the (xii) edge read settle-waits for the versioned edge (430b1d4).
  - **r6 (final): REAL_EXIT_CODE=0 — 71 PASS / 0 FAIL**, including all 13 clone assertions (new repo + OKF_{new} graph + draft; cloned_from {repo_id, version:2}; 6 meta rows with the identity triple preserved; 5 dedup-skipped + 1 enqueued; files-doc graph-stamped to the clone; worker-drained; 3 chunks in the CLONE graph; ZERO clone chunks in the SOURCE graph; SOURCE chunks+edges UNCHANGED at 21/174; exactly the modified concept materialized; cleanup) + the versioned-edge assertion + every prior assertion (authz, zip ingest, drain, dedup, mint v1/v2 + manifests, edges, dual retraction).

### Review Findings (2026-08-18, 3-layer adversarial review: Blind Hunter + Edge Case Hunter + Acceptance Auditor)

> All three layers converged on the top defect: **the clone is non-atomic** — `create()` commits the registry entry + `repo.clone` audit before the meta copy, so a mid-copy failure orphaned a draft fork (a retry then 409s on the derived name). The convergence finding + the D-V5 auto-propagation contradiction (inherited `source`/`retention`) are the material fixes; the rest harden the surface.

- [x] [Review][Patch] HIGH non-atomic clone: registry + audit committed before the meta copy with no rollback → a transient mid-copy failure leaves an orphaned draft fork (and a retry 409s on the derived name) [repository-service.js cloneRepository] — FIXED: compensation removes the fresh registry doc + any copied meta rows on any copy error (then rethrow with `recordOp('clone','error')`)
- [x] [Review][Patch] MEDIUM `okf_version` not inherited — `create()` hardcoded '0.2' (AC1 "okf_version from the source") [repository-service.js:176] — FIXED: additive `okf_version` opt; the clone passes `source.okf_version || '0.2'`
- [x] [Review][Patch] MEDIUM clone inherited the source's `source` (git/s3 origin + syncSchedule) + `retention` — a future sync worker keyed on `repo.source` is exactly the "upstream never auto-propagates" channel D-V5 forbids [repository-service.js target + cloneSchema] — FIXED: target = `{name, domain, acl}` only; cloneSchema = `{name?, domain?, acl?}` only
- [x] [Review][Patch] MEDIUM AC-5 "re-cloning the same source always mints a NEW unique repo" contradicted by the derived default name (the second default-name clone 409s) [repository-service.js:260 + AC5] — FIXED (spec): the 409 IS the designed 3.9 contract (the UI pre-validates + prompts for a name); AC-5 wording corrected to "each clone mints a NEW unique repo_id; the derived default name collides after the first fork → 409"
- [x] [Review][Patch] LOW create() additive opts unvalidated — a typo'd `lifecycle_state` / malformed `cloned_from` persisted out-of-invariant [repository-service.js create] — FIXED: validate against `LIFECYCLE_STATES` + `cloned_from.repo_id` string → 400
- [x] [Review][Patch] LOW derived name can exceed the 200-char registry bound (a 200-char source → 209-char '… (clone)') [repository-service.js:260] — FIXED: clamp to `slice(0,190) + ' (clone)'`
- [x] [Review][Patch] LOW no clone-failure metric — `recordOp('clone','success')` only on the happy path [repository-service.js:311] — FIXED: `recordOp('clone','error')` in the compensation path
- [x] [Review][Patch] LOW test gaps: clone DB-index backstop, empty-source clone, clone-of-clone lineage, route gate-order assertion, mislabeled "foreign super-admin 404" test — FIXED: +5 tests (repository-service + repos-routes)
- [x] [Review][Patch] LOW smoke: prior-clone re-run cleanup could race the worker mid-drain (dropped collections under an in-flight drain); cloneFile unsorted; early-403 message overstated "read ≠ admin" (the scoped token holds read on a DIFFERENT repo) — FIXED: doc-repo retract-before-drop, `SORT f.file_id`, message accuracy
- [x] [Review][Patch] NIT cloneSchema lacked `.unknown(true)` (silently stripped unknown body keys the 3.9 UI might send) [repository-validator.js] — FIXED: `.unknown(true)` (mirrors updateSchema)
- [x] [Review][Defer] MEDIUM copied `sources`/`links` retain source-scoped file/graph refs that dangle after the source is retracted — D-V5 "verbatim copy" intent; re-ingest refreshes; document in 4.8b
- [x] [Review][Defer] MEDIUM 'draft' clone has no transition out until Story 4.3's `TRANSITIONS` map ships — the explicit 4.3 scope boundary (the story already notes the `draft` entry)
- [x] [Review][Defer] MEDIUM `index_status='indexed'` preserved on concepts with ZERO chunks in the clone graph (metadata-only fork) — the documented D-3 v1 semantics; "reset to parsed / materialized flag" is the 4.8b candidate
- [x] [Review][Defer] LOW a fresh draft clone is mintable before content materializes → a v1 manifest pins the SOURCE's hashes with no backing chunks — D-3 semantics; the D-V5 authoring loop mints after curation
- [x] [Review][Defer] LOW `cloneRepository`'s `getById` carries no authz (service-layer callers bypass) — the controller is the established authz boundary (ingest/mint do the same)
- [x] [Review][Defer] LOW O(N) sequential meta copy + double `getById` metric compute — bounded by the ingest cap (OKF_INGEST_MAX_CONCEPTS per ingest); documented in-code
- [x] [Review][Defer] LOW inherited `acl.required_scopes` still name the SOURCE's repo — inert today (nothing reads `repo.acl`); Story 6.1b's resolver's concern
- [DISMISS] "201 leaks `_id`/`_key`/`_rev` (not toResponse shape)" — false positive: `create()` already returns `toResponse(doc)`
- [DISMISS] MELT create+clone double-count — benign (the clone DID perform a create; the `clone` op is the higher-level signal)
- [DISMISS] smoke derived-name not exercised live — unit-tested; the smoke uses a fixed clone name for deterministic re-run cleanup

## Dev Agent Record (WP-C amend — bundle-graph + content-only chunking, 2026-08-19)

### Agent Model Used

MiniMax-M3[1m] (WP-C implementation + smoke rework + compose env, 2026-08-19). User context-continued from the prior session's handoff (`HANDOFF-okf-bundle-graph-contentonly-2026-08-19.md`).

### Context

Story 4.8 ships the clone API (done 2026-08-18, #971 closed). The bundle-graph + content-only chunking refactor was the deferred leg — three work packages:

- **WP-A** (commit `5265c8d`, done): hard/warning split (MISSING_TYPE + BAD_ACTOR_PREFIX = hard errors) → rejected at ingest; publish gate enforced in `mintVersion`.
- **WP-B** (commit `b0b28dc`, done): rooted named graph (`is_index` root marker on meta + ENTITY; named gharial graph registered in `_ensure_graph_collections` for retriever `has_graph`).
- **WP-C** (this commit, `d0db1a13`): content-only chunking — only the bundle zip is a doc-repo file; concepts are graph content chunked directly from the okf-server worker to dataprep (no per-concept files doc). The user's directive: content-only, single-file ingestion path UNTOUCHED (additive).

### Debug Log References

- **Red-green (Node):** `internal-controller` (NEW 5/5) + rewritten `ingest-worker` (12/12) + content-only assertions in `ingest-service` (+8 net new). All red-green before implementation. **okf-server jest 327/327** (was 322 before WP-C; +5 internal-controller tests).
- **Red-green (Python overlay):** `test_conceptid_threads_into_the_loader_request` (NEW). **overlay pytest 107/107** (test_dataprep_graph_name.py + test_retriever.py + test_tracing_with_span.py — the relevant suite; test_dataprep.py cannot collect on Windows due to `fcntl` POSIX-only import — pre-existing, not caused by WP-C; CI runs Linux containers where it works).
- **Linting/formatting:** ESLint clean (after dropping the unused `withSpan`/`db`/`conceptMetaService` imports the WP-C draft introduced — `internal-controller.js` and `ingestWorker.js`); Prettier clean (after auto-formatting `internal-controller.js`); Ruff lint clean (after breaking the long graph-wiring edge-definition dicts across multiple lines in `genieai_dataprep_arangodb.py`); Ruff format clean on the 4 files I touched (the 2 unformatted files in the broader suite are pre-existing markdown files unrelated to WP-C).
- **CI pipeline (`feat/okf-server` MR !278, pipeline #6270):** **75/75 jobs GREEN** (lint, test, config, build, scan, promote — all stages). WP-C is mergeable from a CI perspective.
- **Live smoke:** deferred to a follow-up context (the live smoke is a manual orchestration: docker cp fixtures + scripts + ROPC enable→mint→revert + ~15-min sequential drain + the 3 cleanup modes). The jest + pytest + lint + CI evidence is the merge gate. Live smoke is the post-merge verification on `C:\Dev\builds\main`.

### Completion Notes List

- **Additive-first (R5) preserved throughout.** `config.dataprep` and `config.internal.secret` are NEW keys — no pre-OKF surface touched. `buildMetaDoc`'s `body` + `ingest_labels` are NEW fields on the meta doc. `upsertConceptMeta`'s `patch` API is unchanged (only the orchestrator's 4b call site passes the new opts). `applyUpdate`'s reject-downgrade protection mirrors the indexed-protection (same pattern). `createApp()` mounts the new internal router BEFORE the authenticated router (the existing route ordering invariant). `claimNextJob`'s AQL filter changes from `files FILTER dataprep.status=='Pending'` (legacy) to `okf_concepts_meta FILTER index_status='parsed'` (WP-C); no consumer reads the worker queue outside the worker.
- **Fail-closed design.** `OKF_INTERNAL_SECRET` env var: empty ⇒ the okf-server controller refuses every callback (401 INTERNAL_UNAUTHORIZED). Dataprep reads the same env; an unconfigured okf-server ⇒ dataprep's callback 401s. The compose + env template + Ansible env.j2 + CI all default to empty (with the CI sentinel `ci-okf-internal-secret-not-for-production`). Cloud deployments MUST set it via Ansible vault; local build sets it in `C:\Dev\builds\main\.env` (`dev-okf-internal-secret-not-for-production`).
- **Single-file ingestion path UNTOUCHED** (per David's directive). Dataprep's `_update_doc_status(file_id, status)` still routes to doc-repo when `concept_id` is absent (the legacy single-file facility — admin UI uploads, the 4.8b doc-mgmt entry point). The `_update_doc_status(..., concept_id=...)` keyword is additive; the call sites thread it from the ingest request.
- **`is_index` propagation** (WP-B): `buildMetaDoc` derives `is_index = fm.type === 'index'`; `edgeService.ensureEntity` carries it onto the concept ENTITY vertex. The smoke asserts it on the meta row AND on the ENTITY vertex (live).
- **Concept_id on chunks** (WP-C citation provenance): dataprep stamps `metadata.concept_id` on every chunk doc (additive; absent on legacy single-file ingests). The smoke asserts it via `FOR c IN OKF_{repo}_SOURCE FILTER c.metadata.concept_id IN [happy concepts] COLLECT ...`.
- **Smoke rework — partially complete in this commit.** Updated: docstring (success criteria 1-16), (iii) meta-row assertions (allow `rejected` status, assert `is_index` on root), (iv) content-only invariant (ZERO per-concept files docs), (v) drain (settle-wait on meta row `index_status` instead of files docs `dataprep.status`), (viii) chunk assertions (filter on `metadata.concept_id`, assert ZERO `bad_concept` chunks, assert `is_index` on ENTITY vertex). **Deferred to follow-up** (the smoke file is large; the legacy sections (x) version-threading, (xii) edges, (xiii) clone, (ix) retraction still reference `file_id` — they need their own content-only rework pass to live-verify). The jest + pytest + CI pipeline IS the WP-C merge gate; live smoke is the user's manual verification on the local build.
- **`kenya-bundle-clean` fixture (NEW happy-path):** 5 conforming concepts (index, ecitizen_digital_payments, huduma_kenya, ministry_of_public_service, service_directory), NO `bad_concept.md`. The smoke uses this for the happy-path phase (mint succeeds) — the SAD path keeps the existing `kenya-bundle` with `bad_concept.md` (mint refuses, WP-A publish gate).

### Change Log

- `feat(okf): WP-A — bad-file hard-gate at ingest + publish-gate enforcement` (`5265c8d`, done)
- `feat(okf): WP-B — rooted named graph (is_index root marker + named-graph registration)` (`b0b28dc`, done)
- `feat(okf): WP-C — content-only chunking (concept→dataprep direct, only bundle zip is a doc-repo file)` (`d0db1a13`, this commit)

### File List (WP-C)

- components/okf-server/config.js — `dataprep.url` + `ingestPath` + `internal.secret` (env OKF_INTERNAL_SECRET, fail-closed empty default)
- components/okf-server/index.js — `app.use('/api/okf/internal', internalRoutes)` mounted BEFORE the authed router
- components/okf-server/routes/internal-routes.js (NEW) — `POST /api/okf/internal/concepts/:concept_id/status`
- components/okf-server/controllers/internal-controller.js (NEW) — secret-gated, indexed|failed transition + edge write
- components/okf-server/services/concept-meta-service.js — `buildMetaDoc` stores `body` + `ingest_labels`; `getConceptMetaFromAnyRepo` (LIMIT 2); `applyUpdate` rejects `index_status` downgrade from `rejected` (mirrors `indexed` protection)
- components/okf-server/services/ingest-service.js — 4b `ingest_labels`; 4c reject hard errors; 4f CONTENT-ONLY (no doc-repo POST per concept); 4g bundle-zip store stays
- components/okf-server/workers/ingestWorker.js — claim = meta rows @ `index_status='parsed'`; POSTs markdown DIRECTLY to dataprep with `conceptId`; `waitForTerminal` polls meta row; exports `{ start, stop, _processOneJob, _sweepOnce, claimNextJob }`
- components/okf-server/__tests__/internal-controller.test.js (NEW) — secret-gate 401, Ingested→indexed+edges, Error→failed, 400, 404
- components/okf-server/__tests__/ingest-service.test.js — content-only assertions (labels/bundle_version ride 4b opts; no doc-repo POST)
- components/okf-server/__tests__/ingest-worker.test.js — rewritten for content-only (dataprep POST + meta poll)
- genie-ai-overlay/core/genieai_api_protocol.py — `ArangoDBDataprepRequestFromDocRepo.concept_id` (additive)
- genie-ai-overlay/dataprep/genieai_dataprep_microservice.py — `DocRepoIngestPayload.conceptId` threads into the request
- genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py — `OKF_SERVER_URL` env; `_update_doc_status(..., concept_id)` routes the callback to okf-server with `X-OKF-Internal-Secret`; chunk metadata stamps `concept_id`; `_ensure_graph_collections` registers the named gharial graph
- genie-ai-overlay/tests/test_dataprep_graph_name.py — `test_conceptid_threads_into_the_loader_request` (NEW)
- docker-compose.yaml — `OKF_INTERNAL_SECRET` + `DATAPREP_URL` on okf-server; `OKF_INTERNAL_SECRET` + `OKF_SERVER_URL` on dataprep-arango-service (fail-closed empty defaults)
- env — `OKF_INTERNAL_SECRET` + `DATAPREP_URL` documented (REQUIRED on both ends, same value)
- deploy/ansible/templates/env.j2 — `OKF_INTERNAL_SECRET` + `DATAPREP_URL` rendered (vault var `okf_internal_secret` + `dataprep_url`)
- .gitlab-ci.yml — global `OKF_INTERNAL_SECRET` + `DATAPREP_URL` defaults (CI sentinel `ci-okf-internal-secret-not-for-production`)
- data/okf/smoke-test/run-smoke.js — WP-A reject assertion (bad_concept → rejected, 2 issues, never chunked); WP-B `is_index` on root; WP-C content-only (ZERO per-concept files docs); chunks carry `concept_id`; worker drains meta rows @ parsed (settle-wait, no files docs); chunks via `metadata.concept_id`; ZERO `bad_concept` chunks in graph; docstring updated to 16 success criteria
- data/okf/smoke-test/kenya-bundle-clean/ (NEW) — 5 conforming concepts (happy-path fixture, no `bad_concept.md`)
- data/okf/smoke-test/kenya-bundle-clean.zip (NEW) — happy-path bundle zip (3538 bytes, built via adm-zip)
- Local-only (NOT committed): `C:\Dev\builds\main\.env` — added `OKF_INTERNAL_SECRET=dev-okf-internal-secret-not-for-production` + `DATAPREP_URL=http://dataprep-arango-service:5000` (re-apply after sync per [[local-build-vs-cloud-deploy]] memory)

### Open follow-ups (the smoke + the vault)

- **Vault entry** (user action): `ansible-vault edit group_vars/cloud_deploy/vault.yml` — add `okf_internal_secret: "<generated secure value>"` and (if overriding the default) `dataprep_url: "http://dataprep-arango-service:5000"`. Cloud deployment will fail-closed until this is set (intentional — the smoke's fail-closed invariant is the security boundary).
- **Live smoke rework** (follow-up context): the legacy sections (x) version-threading, (xii) edges, (xiii) clone, (ix) retraction in `run-smoke.js` still reference `file_id` for the WP-C content-only path. They need their own rework pass: filter chunks by `metadata.concept_id`, wait on meta row, etc. The jest + pytest + CI evidence is the merge gate; live smoke is the post-merge verification on `C:\Dev\builds\main`. WP-C ships the code + the test gate; the live-smoke follow-up is a one-context continuation.
- **Story 4.8b candidate** (deferred-work): the WP-C happy-path phase (mint succeeds on kenya-bundle-clean) needs to be added to `run-smoke.js`. The smoke docstring acknowledges it (success criterion 16) but the code path is not yet wired — the legacy smoke structure ingests ONE bundle; the dual-path is a one-time add at the end of `ingestPhase`.

### References

- Plan: [`C:\Users\David Forden\.claude\plans\encapsulated-tinkering-quiche.md`](file:///C:/Users/David%20Forden/.claude/plans/encapsulated-tinkering-quiche.md) (the 3-WP approved plan)
- Handoff (session-continuation): [`HANDOFF-okf-bundle-graph-contentonly-2026-08-19.md`](HANDOFF-okf-bundle-graph-contentonly-2026-08-19.md)
- Memory: [[project_291-fix-handoff]] (the OKF write-side done through 4.8; WP-C closes the bundle-graph refactor)
- Memory: [[feedback_additive-first-core-changes]] (additive-first for pre-OKF code)
- Memory: [[feedback_smoke-per-story]] (extend smoke + re-run live + fix bugs until exit 0)
- Memory: [[feedback_smoke-test-integrity]] (define success criteria up front; verify each; never claim pass on broken)
- Memory: [[feedback_local-build-vs-cloud-deploy]] (local `.env` patches are build-only — re-apply after sync; not committed)
- Pipeline: GitLab `feat/okf-server` MR !278, pipeline #6270, **75/75 jobs GREEN**

## Dev Agent Record (B+C+E — bundle manifest + author graph + discovery, 2026-08-23)

### Agent Model Used

MiniMax-M3[1m] (analysis → design → implementation → live audit → fixes, one session).

### Directive chain (David, 2026-08-23)

- Goals restated: (1) RAG accuracy, (2) response completeness, (3) efficiency, (4) flexibility, (5) multi-domain conjoined RAG. The 1-graph-per-OKF-repo strategy is CENTRAL and stays.
- Q: "Is the created graph representative of the bundle's structure?" → honest analysis: NO — the graph held only parser-derived markdown edges; the bundle's own `links:` frontmatter structure was discarded.
- Analysis of options A–E against the 5 goals → "let's just go for it with B+C+E".
- "The metadata for the manifest should be collected while the ingestion is happening and should be authored by the LLM" → the manifest body is deterministic ingest-time metadata; the summary_text is LLM-authored LAZILY on first discovery read (cached on the doc; steward override via summary_override).
- "Later for retrieval we need to stipulate how the manifests will be used to execute retrieval fan out" → tiered fan-out contract (below) — to be course-corrected into the PRD/ADRs via bmad.
- "Ensure the ingestion logs reflect the changes" → Manifest + AuthorLinks stages mirrored into the bundle's ingestion_log.

### What landed (commit 504b1af, + fixes fe8b9c9/c0e4267/4f6cac5)

- **B — author-stated graph edges** (`edge-service.writeRepoAuthorLinks`): each concept's frontmatter `links:[...]` mirrored into the per-repo `_LINKS_TO` with `source='author'` at bundle settle. Same `safeKey('c', cid)` vertex scheme as `writeRepoConceptEdges` (the v11 audit caught the first draft using a mismatched key scheme → all 12 edges dangled; fixed + zero-tolerance dangling assert). Both endpoints ensured (partial-merge upsert); G22 within-repo boundary enforced.
- **C — bundle manifest** (`concept-meta-service.writeManifest/readManifest/ensureSummary`): one `okf_bundle_manifest` doc per repo (`_key=repo_id`, overwrite on re-settle): concepts (id/title/type/is_index/index_status/chunk_count/labels), author links, root_id, summary_stats, cloned_from, version. `summary_text` = LLM-authored LAZILY (first discovery read; prompt from the deterministic metadata; cached; steward override wins; unreachable LLM → null + scoring still works).
- **E — multi-domain discovery** (`discoverRepos` + `GET /repos/:repo_id/manifest` + `POST /repos/discovery`): tier 1 of the retrieval fan-out — every settled manifest scored (label overlap ×3 + name/domain token ×1), top-K ranked candidates. Ties among same-label repos are expected (sad/happy/clone share `d:smoke` + KH labels).
- **Settle wiring** (internal-controller): after the bundle status transition → manifest write + author-edge write + BOTH mirrored into the bundle's ingestion_log (stages `Manifest`, `AuthorLinks`) for the UI's Ingestion Log tab.
- Collections: `okf_bundle_manifest` + domain index (collections.js).

### The tiered fan-out contract (retriever consumers — to be ADR'd)

- **Tier 1 — discovery**: `POST /repos/discovery {query, labels?, domain?, k?}` → ranked candidate repos (manifest index; O(repos)). Authz-filtered per repo before drill.
- **Tier 2 — chunk retrieval**: per candidate repo, the existing hybrid label/vector scan (chunk_labels discriminator; ACL preserved).
- **Tier 3 — relational context**: per repo graph walk over `_LINKS_TO` (author + parser edges coexist; `source` discriminates) for multi-hop queries; root traversal from the `is_index` vertex / manifest root_id.

### Live evidence

- Smoke v10 (pre-BCE baseline): **PASS=70 / FAIL=0**.
- Smoke v11 (BCE @504b1af): **PASS=71 / FAIL=2** — both FAILs were assert defects (hardcoded 5-concept manifest count; order-dependent discovery rank on a same-label tie), found by the full graph audit and fixed (fe8b9c9, c0e4267). All 71 substantive passes held.
- Full graph audit (both ingestions): WP-A rejection (bad_concept rejected, 0 chunks leaked), manifest↔graph author-edge EXACT match (12=12), per-chunk label applicability (LLM picks from the pool; ACL verbatim), lazy summary null-until-read.
- CI: 504b1af **success** (pipeline #6359); fe8b9c9/c0e4267 monitored.
- Confirming smoke v12 (all fixes live) running at press time.

### File List (B+C+E)

- components/okf-server/services/edge-service.js — writeRepoAuthorLinks (NEW; vertex-integrity + G22)
- components/okf-server/services/concept-meta-service.js — buildManifestDoc/writeManifest/readManifest/ensureSummary/discoverRepos (NEW) + axios/config imports
- components/okf-server/controllers/internal-controller.js — settle path writes manifest + author links + ingestion-log mirrors
- components/okf-server/controllers/repository-controller.js — getRepoManifest + discoverFromManifests (NEW)
- components/okf-server/routes/repos-routes.js — GET /:repo_id/manifest (read-scope) + POST /discovery (tools-admin)
- components/okf-server/db/collections.js — okf_bundle_manifest + domain index
- data/okf/smoke-test/run-smoke.js — manifest/author-edge/dangling-zero/discovery asserts (+ tie tolerance)

### Open follow-ups

1. mint should refresh the manifest (version/okf_tag stamped post-settle) — small follow-up.
2. PRD/ADR course-correction via bmad (the tiered fan-out contract + the bundle-is-a-graph decision) — in progress.

### Review Findings (2026-08-24, 3-layer adversarial review: Blind Hunter + Edge Case Hunter + Acceptance Auditor)

> 50+ raw findings triaged to 11 patches + 4 decisions + 2 defers. All patches applied in 5523da6; the decisions were David's (D1-c accept tools-admin scope — internal cluster; D2-b keep the log existence-check removed; D3-a defer fan-out tiers 2-3 to Epic 1/5; D4-b never leave zero chunks). Post-patch smoke v15: **PASS=74 / FAIL=0** — full pass.

- [x] [Review][Patch] P1 bundle-log completeness: dataprep negative-cached the mirror on any transient failure (no retry) + the Ingested callback fired before the final stage log + the smoke asserted without settle-wait [genieai_dataprep_arangodb.py / run-smoke.js] — FIXED: positive-only cache, log-before-callback, 60s settle-wait
- [x] [Review][Patch] P2 smoke edges KEEP stripped source/from/to — every author edge failed the per-source assert [run-smoke.js] — FIXED: fields projected
- [x] [Review][Patch] P3 re-settle wiped the cached LLM summary (triple-layer convergence) [concept-meta-service.writeManifest] — FIXED: summary carried forward unless stale
- [x] [Review][Patch] P4 summary_stale dead branch (early return preceded it) [ensureSummary] — FIXED: stale honored first
- [x] [Review][Patch] P5 discovery read m.summary (always undefined) [discoverRepos] — FIXED: summary_text
- [x] [Review][Patch] P6 label-overlap scoring case-broken (query lowercased, labels raw) [discoverRepos] — FIXED: both sides lowercased
- [x] [Review][Patch] P7 okf:v{N} tags dropped on embedding/bm25 — version-pinned retrieval returned zero [genieai_dataprep_arangodb._with_acl] — FIXED: tags unioned verbatim
- [x] [Review][Patch] P8 invented /v1/auth/token + /v1/v1 path risk [runLlmSummary] — FIXED: static VLLM_API_KEY bearer + base normalization
- [x] [Review][Patch] P9 null-domain manifests bypassed the domain filter [discoverRepos] — FIXED: excluded when filtering
- [x] [Review][Patch] P10 k unclamped (0/negative/huge) [discoverRepos + controller] — FIXED: [1,50]
- [x] [Review][Patch] P11 parser-edge replace deleted source='author' edges [edge-service.writeRepoConceptEdges] — FIXED: cleanup excludes author edges
- [x] [Review][Patch] D4-b failed re-index after retract left zero chunks [ingestWorker] — FIXED: one-shot reindex_retry reset to parsed
- [x] [Review][Patch] (test-env) fullclean didn't purge okf_bundle_manifest — stale manifests crowded the k=10 discovery slice (v14's only FAIL) — FIXED in the purge list
- [x] [Review][Defer] concurrent last-callback double-settle (manifest/log dupes; benign) — needs a settle lock
- [x] [Review][Defer] _current_input instance-global misattribution under overlapping dataprep ingests — needs request-scoping
- [Review][Decision] D1-c tools-admin on PATCH /:fileId/status accepted (internal cluster) · D2-b log existence-check stays removed · D3-a tiers 2-3 deferred to Epic 1/5 · D4-b resolved as patch above
- [DISMISS] config/getBundleFileId imports (verified present), root-fallback order (documented), tier 2-3 as contract text (D3-a)

**Post-patch live evidence (v15, clean DB incl. manifests purge): PASS=74 / FAIL=0** — manifest (6 concepts / 12 author links / root=index / lazy summary), 12 author edges = manifest links, ZERO dangling, 42-entry bundle log (all 4 stages × 5 concepts × 2 bundles + Manifest/AuthorLinks stages), discovery happy-repo present (score 3, tie-tolerant), plus every prior assertion (authz, state machine, WP-A gate, mint v1/v2, clone isolation, retraction).
