---
baseline_commit: 225875b8d
---
# Story 2.9.7: `okf_versions` + `mintVersion()` (G26)

Status: ready-for-dev

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

- [ ] T1 `okf_versions` collection + indexes (`db/collections.js`) — boot-ensure additive
- [ ] T2 `services/version-service.js` (AC 1) + units
- [ ] T3 Routes + controller (AC 2) + route-matrix tests
- [ ] T4 Version threading: okf-server 4f payload, doc-repo Joi+stamp+forward, dataprep payload+chunk stamp (AC 3) + tests all three suites
- [ ] T5 Smoke extension (AC 7); live run to exit 0
- [ ] T6 Suites (okf-server/doc-repo/overlay) + lint/format; 2.9.3 note (edges stamp bundle_version); close-out

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
