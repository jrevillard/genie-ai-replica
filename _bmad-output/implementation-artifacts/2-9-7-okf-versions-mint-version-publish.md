---
baseline_commit: 225875b8d
---
# Story 2.9.7: `okf_versions` + `mintVersion()` (G26)

Status: review

Story key: `2-9-7-okf-versions-mint-version-publish` | GitLab: #962
Epic: 2.9 (Write-side Orchestration) | Branch: `feat/okf-server`
FRs: **FR-11** (versioning & provenance), FR-29 (citation pinning backing) | Gap: **G26** | ADRs: **okf-031** (versioning strategy), okf-005, okf-030 (publish side-effect), okf-021
Directives: [design addendum D-V1/D-V4](../planning-artifacts/prds/prd-okf-server-2026-07-15/design-addendum-versioning-integrity-clone-2026-08-16.md) — `okf:v{N}` version tag; **re-crawl ⇒ version N+1 of the SAME repository** (never a new registry entry)

> **The G26 gap:** `bundle_version` is threaded through meta rows (2.9.1 4b — live) but **never minted** — no `okf_versions` collection, no `mintVersion()`. Without a minted version, citation pinning (FR-11/FR-29) has no backing and list/diff (FR-11, Story 4.5) is impossible. This story ships the mint: repo-level monotonic integer + immutable manifest + the version tag + version threading onto the physical chunk docs.

## Story

As a **steward**,
I want **each publish/crawl of a repository to mint an immutable, diffable version with a manifest snapshot**,
so that **agent citations can pin a version, changes are auditable, and re-crawls version the same repository instead of duplicating it**.

## Acceptance Criteria

1. **`services/version-service.js` (okf-server, NEW)** — `mintVersion(repo_id, { trigger, source_ref, curator })`:
   - Resolves the repo (404 unknown; refuse when soft-deleted). Trigger ∈ `manual | publish | crawl` (validated; `publish`/`crawl` are the wired callers — 4.3 lifecycle and Epic 7 producer call the service/API when they land; `manual` is the steward action today).
   - Mints the NEXT version: reads the repo's `version` (null ⇒ 1), writes `version = N+1` on `okf_repositories`, and snapshots the manifest into **`okf_versions`** (NEW collection, `db/collections.js` + indexes: `[repo_id]`, `[repo_id, bundle_version] unique` — the unique index is the concurrent-mint race guard; on unique-violation, re-read and retry once).
   - **Manifest (INSERT-only, immutable)** — `_key = repo_id + '_' + N` (deterministic, tamper-evident): `{ repo_id, bundle_version, okf_tag: 'okf:v'+N, trigger, source_ref, curator, minted_at, concept_count, concepts: [{ concept_id, title, content_hash, index_status }] }` — the concept list + hashes read from `okf_concepts_meta` (the D-V3 integrity ledger; content_hash is the CANONICAL trimmed-body sha256 — never re-hash differently). The service NEVER updates or deletes manifest docs (retention sweep = 4.6/2.9.9).
   - **Version tag (D-V1)**: `okf:v{N}` recorded on the manifest and on the repo doc (`okf_tag`); the orchestrator appends the repo's CURRENT `okf_tag` to the enqueue labels on every ingest (below) so the tag is in-band on files docs/chunks.
   - MELT: `okf.versions.mint` span + `okf_version_operations_total` counter + audit row (`repo.version_mint`, actor, repo_id); optimistic-concurrency documented (repo.version is NOT in `UPDATABLE_FIELDS` — users can never PATCH it; mint is the sole writer).
2. **Version API (repos-routes.js, after ingest)** — `requireRepoScope('repo_id','admin')` + getById pre-gate (mirrors ingest):
   - `POST /api/okf/repos/:repo_id/versions` body `{ trigger?, source_ref? }` (default `manual`) → **201** `{ repo_id, bundle_version, okf_tag, concept_count, manifest_key }`.
   - `GET /api/okf/repos/:repo_id/versions` → list (DESC by version) for 4.5's UI; `GET …/versions/:n` → the full manifest (read scope suffices for GETs).
3. **Version threading to the physical chunks (ADR-031 §3 "threaded everywhere")** — the legs that don't exist yet:
   - **okf-server 4f**: the enqueue payload gains `bundle_version: bundleVersion` (the repo.version resolved at ingest — already computed in `_ingestWithCap`).
   - **doc-repo**: bundle-route Joi accepts optional `bundle_version` (number|null) and `metadataService` stamps it on the files doc (same pattern as `graph_name`); `_ingestFileById` forwards `bundleVersion` to dataprep (same line as `graphName`, [fileController.js:994](../../../components/document-repository/src/controllers/fileController.js)).
   - **dataprep**: `DocRepoIngestPayload` gains `bundleVersion: int | None = None`; the loader stamps `metadata["bundle_version"]` on every chunk doc ([genieai_dataprep_arangodb.py:1379-1384](../../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py) — the metadata dict, additive `if getattr(input, "bundle_version", None) is not None`). Absent/null ⇒ unchanged legacy behavior (additive, R5).
   - Edges get the stamp when 2.9.3 writes them (note added to 2.9.3's scope — do NOT build edges here).
4. **D-V4 semantics (documented + asserted)**: mint is callable repeatedly — every call = N+1 (a re-crawl mints a new version of the SAME repo; the registry never gains an entry). The manifest's `source_ref` is the crawl origin when `trigger='crawl'` (Epic 7 passes it; today's steward/API path allows any string ≤500).
5. **Idempotency edge**: minting does NOT re-ingest or re-index; it only snapshots. Re-ingest AFTER a mint threads the NEW `bundle_version` onto re-written meta/chunks (4b + AC-3 legs) — unchanged+indexed concepts are dedup-skipped and KEEP their previous version stamp (correct: their content belongs to the version that indexed it).
6. **Tests** — version-service units (mint N→N+1, first mint null→1, manifest fields + canonical hashes from meta, unique-index race retry, 404/deleted refusal, INSERT-only shape); route tests (201/200/404/403-read-vs-admin matrix, list DESC, manifest read); doc-repo bundle `bundle_version` Joi + stamp; okf-server 4f payload assertion; dataprep pytest (payload accepts bundleVersion, chunk metadata stamp, null no-op). ESLint/Prettier/ruff clean.
7. **Smoke (live gate)**: after the worker-indexed drain + dedup phase — **mint v1** (API, admin token… TTL: mint EARLY is not possible — mint must follow indexing; use the in-container service call like the dedup re-ingest) → assert manifest (6 concepts, hashes == meta content_hash, okf_tag `okf:v1`), repo.version=1; **modified re-ingest** (one concept's body changed, service call) → worker drains the changed concept → assert its NEW chunk docs carry `bundle_version: 1` and the files doc carries the tag+version → **mint v2** → manifest v2 present, list endpoint returns [2,1] DESC. All prior assertions stay (they never shrink).

## Tasks

- [x] T1 `okf_versions` collection + indexes (`db/collections.js`) — boot-ensure additive
- [x] T2 `services/version-service.js` (AC 1) + units
- [x] T3 Routes + controller (AC 2) + route-matrix tests
- [x] T4 Version threading: okf-server 4f payload, doc-repo Joi+stamp+forward, dataprep payload+chunk stamp (AC 3) + tests all three suites
- [x] T5 Smoke extension (AC 7); live run to exit 0
- [x] T6 Suites (okf-server/doc-repo/overlay) + lint/format; 2.9.3 note (edges stamp bundle_version); close-out

## Dev Notes

### ADR-031 decisions (verified against the ADR, 2026-08-13)

- **D20-a repo-level**: ONE `bundle_version` per mint (not per concept) — matches bundle-as-publish-unit. Monotonic integer starting at 1.
- **Publish side-effect, NOT a lifecycle state** (ADR-030): `mintVersion` is called BY the publish transition (4.3) / crawl association (Epic 7) — this story ships the mint + the explicit API; the lifecycle wiring is 4.3's.
- **Immutable manifest**: INSERT-only, `[repo_id, bundle_version]` unique; superseded versions retained until retention (ADR-032 — NOT this story).
- **Citation pinning**: `(repo_id, bundle_version, concept_id)` resolvable via manifest + chunk docs carrying `bundle_version` (AC 3 makes the chunk leg real).

### Verified code anchors (read before coding — file:line checked 2026-08-16)

- `db/collections.js:14` COLLECTIONS list + `INDEXES` map — add `okf_versions` (ensureCollection is generic; boot path already additive).
- `services/repository-service.js:159` — repo doc inits `version: null`; `:33` UPDATABLE_FIELDS deliberately EXCLUDES version (keep it that way; mint bypasses `update()` with a direct collection update).
- `services/concept-meta-service.js:67-73` — `contentHash` is the CANONICAL (trimmed-body) sha256 (2026-08-16 fix); manifest hashes MUST come from the stored `content_hash` field (single source of truth — never recompute in the mint).
- `services/ingest-service.js` (`_ingestWithCap`) — `bundleVersion = repo.version ?? null` already resolved (used by 4b); AC-3 adds it to the 4f payload body + appends `repo.okf_tag` to labels when set.
- `routes/repos-routes.js:18-27` route table (slot versions after ingest); route tests matrix style in `__tests__/repos-routes.test.js` (authScoped + authzAwareServiceMock + ingest-service mock pattern — remember to add the new service to the ingest/versions mock factory).
- doc-repo: `fileRoutes.js` bundle Joi (add `bundle_version: Joi.number().integer().min(1).allow(null).optional()`), `fileService.uploadBundle` stamps, `metadataService.js:33-40` stamp pattern, `fileController.js:994` the dataprep forward (`bundleVersion: file.bundle_version ?? null`).
- dataprep: `genieai_dataprep_microservice.py` `DocRepoIngestPayload` (+`bundleVersion`), `:199` pass-through (`bundle_version=payload.bundleVersion`), `genieai_dataprep_arangodb.py:1379-1384` chunk metadata stamp. Mirror the `graphName` pattern exactly (proven 2026-08-16).
- Audit pattern: `auditService.writeAudit({ actor, action, repo_id, source_ip })` best-effort.

### Previous-story intelligence (2.9.1/2.9.4 — all live-proven this initiative)

- **Worker-exclusive states**: the ingest worker owns `indexed|failed`; mint MUST NOT touch `index_status` (it only reads it into the manifest).
- **Bare concept ids**: concept_id = entry name minus `.md` (the real parser strips only the suffix — never prefix). Manifest concepts key on the stored `concept_id`.
- **Token TTL mechanics**: user tokens are 5-min; the smoke's post-drain phases (mint, modified re-ingest, list) use IN-CONTAINER service calls (module require) — the HTTP surface is asserted early (403 scoped + 201 admin immediately after ingest while tokens are fresh) or by route unit tests.
- **AQL**: hyphenated `OKF_{uuid}` collection names need backticks; capture docker exec exit without pipes; service token re-mints <3 min, never hoisted.
- **429 discipline**: any new doc-repo kick path must treat 429 as transient (the worker pattern).
- **Idempotency rule (NFR-S4 shape)**: operations that create documents need deterministic keys or explicit race guards — the manifest uses BOTH (`_key` deterministic + unique index).

### Scope boundary (do NOT build)

Lifecycle transitions/publish wiring (4.3 — it CALLS mintVersion) · crawl association + producer (Epic 7 — it calls mint with `trigger:'crawl'` + origin) · version diff UI (4.5 consumes the list/manifest endpoints) · retention/TTL of old versions (4.6/2.9.9) · `_LINKS_TO` edges + their version stamp (2.9.3 — noted) · retract changes (done) · chunk-level version pinning in retrieval (Epic 1).

### References

ADR-okf-031 (full), ADR-okf-005/030/032; PRD FR-11 (§4.3), §13 Q2 resolved; epics 2.9.7 + 4.5/4.8; design addendum D-V1/D-V3/D-V4; live smoke run 12 (the baseline the next run must preserve and extend).

## Dev Agent Record

### Implementation (2026-08-17)

- **T1-T4** as specified: `okf_versions` collection (+unique `[repo_id, bundle_version]` race-guard index), `services/version-service.js` (mint/list/get, INSERT-only manifests with the STORED canonical hashes, sole-writer repo.version bump, okf:v{N} tag), version API (POST admin / GET read-scope, getById pre-gate), and the full threading leg: okf-server 4f payload + tag label (caller `okf:v*` tags stripped — sole injector), doc-repo Joi+stamp+`bundleVersion` forward, dataprep payload + chunk-doc metadata stamp (Genie-owned `core/genieai_api_protocol.py` model extended additively — the vendored copy picks it up at build; verified in-container).
- **Suites:** okf-server **278/278**, doc-repo **429/429**, overlay pytest **672/672**; ESLint/Prettier/ruff clean.

### Live evidence (runs 13–15, honest history)

- **Run 13 (exit 1):** drain-wait cap (20 min) expired ~1 min before the 6th file indexed → downstream phases cascaded; ALSO exposed `await aqlAll(...)[0]` precedence bug in the chunk-stamp assert (awaited `promise[0]` = undefined — the chunks were fine). An isolated live probe (versioned bundle, immediate kick, bundle_version=7) proved the ENTIRE threading chain: chunk doc carried `bundle_version: 7`.
- **Run 14 (exit 1):** the 2.9.4 orphan sweeper fired mid-run (hourly) and reaped in-flight state — victims unlogged (console formatter strips metadata fields). Fixed: **1h grace window** on the sweep (never reap fresh docs) + victims logged IN THE MESSAGE STRING.
- **Run 15 (exit 0): 52 PASS / 0 FAIL** — mint v1 (publish trigger, manifest with 6 concepts + stored canonical hashes + okf:v1, repo.version stamped); modified re-ingest → 5 dedup-skipped + 1 enqueued with bundle_version=1 + the okf:v1 label; worker drained it; **all 3 new chunk docs carry bundle_version=1 (citation pinning real)**; mint v2 (crawl trigger — D-V4) → list [v2, v1], manifest v1 INTACT (INSERT-only); every prior assertion still green (worker drain, dedup, isolation, both retraction levels — retract now also tears down manifests).

### File List

- components/okf-server/services/version-service.js — NEW
- components/okf-server/db/collections.js — okf_versions + indexes
- components/okf-server/controllers/repository-controller.js — mintRepoVersion/listRepoVersions/getRepoVersion
- components/okf-server/routes/repos-routes.js — version routes
- components/okf-server/services/ingest-service.js — 4f bundle_version payload + okf:v tag label (+ caller-tag strip)
- components/okf-server/services/graph-retract-service.js — repo teardown removes version manifests
- components/okf-server/workers/ingestWorker.js — sweep grace window + victim logging
- components/okf-server/__tests__/version-service.test.js (NEW), repos-routes/ingest-service/graph-retract tests extended
- components/document-repository/src/controllers/fileController.js — Joi bundle_version + datapretreat forward
- components/document-repository/src/services/fileService.js + metadataService.js — files-doc stamp
- components/document-repository/src/__tests__/routes/bundleIngest.test.js + integration/fileRoutes.test.js — bundle_version tests
- genie-ai-overlay/core/genieai_api_protocol.py — model field (additive)
- genie-ai-overlay/dataprep/genieai_dataprep_microservice.py + genieai_dataprep_arangodb.py — payload + chunk stamp
- genie-ai-overlay/tests/test_dataprep_graph_name.py — bundleVersion threading tests
- data/okf/smoke-test/run-smoke.js — mint/threading/immutability phases + fixes (precedence, drain cap, version cleanup)

### Review Findings (2026-08-17, 3-layer adversarial review: Blind Hunter + Edge Case Hunter + Acceptance Auditor)

> The CRITICAL finding explains run 14 conclusively: the sweeper's orphan predicate reads `f.originalFileName` — a field NEVER persisted to files docs (doc-repo folds it into `file_name`) — so after the grace window every healthy OKF file is a false orphan and gets retracted (chunks physically deleted) + removed, 10/hour. The grace window only delayed it. All findings below are fix-before-done.

- [ ] [Review][Decision] Mint racing a Pending drain breaks version-pinned citation integrity: a modified concept enqueued at v1 (values frozen on the files doc) drains AFTER a v2 mint whose manifest records the NEW hash → chunks stamped v1, manifest v2 holds their hash — a (repo,v1,concept) citation returns content v1's ledger cannot validate [ingest-service.js:226-229 vs version-service snapshot; no gate makes mint wait for the queue]
- [ ] [Review][Patch] CRITICAL sweep predicate: `SUBSTRING(f.originalFileName,…)` — originalFileName is never persisted (metadataService builds file_name) → EVERY healthy OKF file becomes a false orphan after grace → retract deletes live chunks + files docs, 10/hour (run-14's killer, mechanism-confirmed); ALSO add defensive `uploaded_date` null guard (AQL null<number fails open) and the `concepts/`-prefix derivation variance [ingestWorker.js _sweepOnce AQL]
- [ ] [Review][Patch] HIGH mint retry exhaustion: designed MINT_RACE 409 is unreachable — a second unique-collision throws the RAW Arango error → error handler renders 500 {error:409}; the unit test bakes in an impossible ordering [version-service.js:133-141,179]
- [ ] [Review][Patch] HIGH non-atomic insert→counter-bump: a crash (or failed bump) between manifest save and repo update permanently wedges every future mint for that repo (same-N+1 collision forever); fix = reconcile on collision (repair the counter from the existing manifest / max bundle_version — self-healing; also neutralizes orphaned-manifest wedges from swallowed retract failures) [version-service.js:131-149]
- [ ] [Review][Patch] HIGH isNotFound message-regex (`/not found|no match/i`) re-introduces exactly what arango-errors.js removed — infra outages (missing collection, gateway blips) masked as clean 404s; import isArangoNotFound [version-service.js:52-57 vs arango-errors.js:3-11]
- [ ] [Review][Patch] MAJOR missing AC6 test categories: dataprep chunk-metadata-stamp pytest (drive the real metadata construction, not the patched-out request), doc-repo files-doc stamp unit (extractMetadata), and fix the test docstring overclaim ("→ chunk docs" while asserting only the request) [genie-ai-overlay tests + doc-repo tests]
- [ ] [Review][Patch] MINOR `:bundle_version` route param via parseInt: `1.9` silently returns manifest 1 (wrong resource); `abc` → 404 "Version NaN" — strict `/^\d+$/` → 400 [repository-controller.js getRepoVersion]
- [ ] [Review][Patch] MINOR mint audit row omits the minted version (writeAudit supports `entry.version`) — add version + trigger so audit can attribute a specific manifest [version-service.js:160-169]
- [ ] [Review][Patch] MINOR okf:v label handling: strip `/^okf:v/i` is over-broad (a legitimate `okf:Vision` label is dropped) and the repo.okf_tag guard `startsWith('okf:v')` is under-broad ('okf:virus' passes) — use `/^okf:v\d+/` (strip) and `/^okf:v\d+$/` (guard) [ingest-service.js:233-246]
- [ ] [Review][Patch] MINOR smoke: the versioned-file failure path dereferences `versionedFile.file_id` (TypeError crash instead of clean tally); also add the post-mint meta-row assertion (the changed concept's okf_concepts_meta row carries bundle_version=1 after the modified re-ingest — the 4b leg) and fix the misleading pass text [run-smoke.js]
- [ ] [Review][Patch] MINOR `OKF_INGEST_WORKER_SWEEP_GRACE_MS=0` silently falls back to 1h (safeInt requires >0) — accept ≥0 for the grace var (0 = test/off) [ingestWorker.js safeInt usage]
- [x] [Review][Defer] MAJOR publish-triggered mint has no PII/index-status gate (snapshots unscanned/failed/PII-hit concepts as "published") — publish preconditions are Story 4.3's contract (assertPiiClean integration); manifest already records index_status visibly
- [x] [Review][Defer] MAJOR bundle_version is caller-forgeable at the doc-repo layer (Joi accepts any int; no derivation possible there; route is Admin+okf-service) — defense-in-depth needs a cross-service design (doc-repo cannot verify without registry access)
- [x] [Review][Defer] MINOR empty-concept mint burns a version number (phantom empty release) — publish semantics owner is 4.3
- [x] [Review][Defer] MINOR sweep removes the files doc on retract-500 (and "already retracted" also maps to 500) — needs doc-repo error-shape work to distinguish; pre-existing pattern
