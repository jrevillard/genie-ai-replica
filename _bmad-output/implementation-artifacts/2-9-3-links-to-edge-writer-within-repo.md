---
baseline_commit: 194f6bd
---
# Story 2.9.3: `_LINKS_TO` edge writer (within-repo validated) (G7, G22)

Status: done

Story key: `2-9-3-links-to-edge-writer-within-repo` | GitLab: #963
Epic: 2.9 (Write-side Orchestration) | Branch: `feat/okf-server`
FRs: **FR-7** (structural concept→concept links), FR-11 (citation pinning) | Gaps: **G7, G22** | ADRs: okf-021 (write path), okf-022 (D4), okf-028 (edges)

> **The G7/G22 gap:** the parser already extracts structural `links: [{ to_concept_id, label }]` per concept (parser-service `extractLinks`) — but nothing PERSISTS or WRITES them. The per-repo `OKF_{repo_id}_LINKS_TO` edge collection exists (created by `_ensure_graph_collections`, ENTITY→ENTITY per the graph definition) but is empty — no traversal, no knowledge-graph. This story ships the writer: persist links at 4b (additive), validate within-repo, and write/replace the concept's outgoing edges POST-INDEX (the 2.9.4 worker's hook), carrying label + file_id + repo_id + bundle_version (the 2.9.7 threading note).

## Story

As a **steward**,
I want **structural concept→concept edges written into the per-repo graph once a concept is indexed**,
so that **traversal works and cross-repo links are never materialized** (G22).

## Acceptance Criteria

1. **`services/edge-service.js` (okf-server, NEW)** — `writeRepoConceptEdges(repo_id, concept_id, { file_id, bundle_version })`:
   - Reads the concept's meta doc (its PERSISTED `links` — AC 2) → the outgoing edge set.
   - **Within-repo validation (G22)**: loads the repo's concept-id set (`okf_concepts_meta` for the repo); a link target NOT in the set is **dropped + logged** (never materialized — matches the intended parse-time CROSS_REPO_LINK semantics; no cross-repo edge can exist).
   - **Concept ENTITY node**: ensures `OKF_{repo_id}_ENTITY/<concept_id>` exists (idempotent upsert: `{ concept_id, repo_id, title, labels, bundle_version, _key }`) — the graph's `_LINKS_TO` is ENTITY→ENTITY, and OKF concepts currently have no ENTITY vertices, so the edge would otherwise dangle.
   - **Replace semantics**: deletes the concept's existing outgoing edges (`_from == OKF_{repo}_ENTITY/<concept_id>`), then inserts each validated link as `{ _from, _to: OKF_{repo}_ENTITY/<target>, label, file_id, repo_id, bundle_version, created_at }` with a deterministic `_key` (`hash(source->target)`) — re-indexing a changed concept replaces its edges, unchanged concepts keep theirs (4e dedup skips them).
   - MELT: `okf.edges.write` span + `okf_edges_written_total` counter + audit row (`repo.edges_written`, actor okf-worker). Never throws into the ingest path (isolated, logged).
2. **4b additive: persist `links` on the meta doc** — `buildMetaDoc` gains `links` (from `parsed.links`, default `[]`). Additive; no consumer breaks (meta docs grow a field; the 2.9.7 manifest already `KEEP`s only specific fields).
3. **Worker hook (post-index)**: in `ingestWorker._processOneJob`, after the `Ingested` → `index_status:'indexed'` transition, call `edgeService.writeRepoConceptEdges(repo_id, conceptId, { file_id: job.file_id, bundle_version: job.bundle_version })` — fire-and-forget isolated (a failure logs + records the counter, never fails the drain). Skipped when `conceptId` is null (unshaped file — same guard as the transition).
4. **Tests** — edge-service units: within-repo edges written (source + target ENTITY nodes ensured, edges carry label/file_id/repo_id/bundle_version); cross-repo/missing target DROPPED + logged; replace-on-reingest (old edges deleted, new written); idempotent ENTITY upsert; no-links concept writes nothing; validation failure isolated. Worker unit: post-Ingested hook invoked with the right args. 4b: buildMetaDoc persists links. ESLint/Prettier clean.
5. **Smoke (live gate)**: after the worker-indexed drain + version phases — assert `OKF_{repo_id}_LINKS_TO` edges exist for the bundle's internal links (kenya index.md → service_directory etc.), carrying `label` + `file_id` + `repo_id` + `bundle_version`; assert ZERO cross-repo edges (the bundle has none — the assertion is structural, count matches the parsed links); assert the ENTITY nodes for the concepts exist. The graph is now traversable — print the count as the proof.

## Tasks

- [x] T1 `services/edge-service.js` (AC 1) + unit tests
- [x] T2 4b links persistence (AC 2) + buildMetaDoc test
- [x] T3 Worker post-Ingested hook (AC 3) + unit test
- [x] T4 Smoke edge assertions (AC 5); live run to exit 0
- [x] T5 Suites (okf-server/doc-repo/overlay) + lint/format; close-out (sprint/#964/push)

## Dev Notes

### Verified anchors (2026-08-17)

- `parser-service.js:106-142` `extractLinks` → `[{ to_concept_id, label }]`; `:63+` `conceptIdFromPath` normalizes a link path to a concept_id (the parser already applied it — the edge target IS the concept_id form).
- `concept-meta-service.js` `buildMetaDoc` (:86-120) — currently NO `links` field; add it (AC 2).
- `db/collections.js` — `_LINKS_TO` is created per-repo by the dataprep `_ensure_graph_collections` (no okf-server collection change needed). Graph definition: `OKF_{repo}_LINKS_TO` ENTITY→ENTITY (verified live).
- `ingestWorker.js` `_processOneJob` — the `Ingested` → `transitionMeta(indexed)` block (:186-200) is the hook site; `job.file_id` + `job.repo_id` are in scope.
- `_ensure_graph_collections` guards: ENTITY is a vertex collection; edges need `edge: true` only at creation (already done by dataprep).

### Previous-story intelligence (2.9.1/2.9.4/2.9.7 — live-proven)

- **Never persist what the parser already normalized**: links' `to_concept_id` is already the bare concept_id form (the parser's `conceptIdFromPath` ran) — the edge service must NOT re-derive.
- **Bare concept ids**: `concept_id` = entry name minus `.md`; `originalFileName` is NEVER persisted — the worker's file name / meta concept_id are the sources of truth.
- **Deterministic keys + replace**: the manifest `_key` pattern (2.9.7) is the precedent — edge `_key = hash(source->target)` + delete-then-insert for replace.
- **MELT + audit + isolation**: every method traced/countered; audit actor okf-worker; a failure must never fail the drain (the 2.9.4 lesson).
- **Smoke order**: post-drain, post-mint phases use in-container service calls (user-token TTL); the edge assertions come after the version phases.

### Scope boundary (do NOT build)

Read-side traversal / neighbors API (Story 5.5) · edge labels in retrieval (Epic 1) · cross-repo link conformance ISSUE (a parse-time warning — out of scope; the writer just never materializes them) · edge version stamping beyond bundle_version (2.9.7 already threads it).

### References

Epic 2.9.3; ADR-okf-021 (write path), ADR-okf-022 (D4 link handling), ADR-okf-028; PRD FR-7/FR-11; the 2.9.7 story (the threading + self-healing + smoke lessons).


## Dev Agent Record — review-fix pass (2026-08-17)

**8/8 patches applied.** Canonical concept_id (normalize concepts/ prefix — subdirectory bundles no longer lose edges), N→0 replace deletes stale edges, TARGET entity vertices ensured (no dangling), AC1 audit row, dedup targets, test+smoke hardening (non-tautological G22 via vertex-_id comparison, file_id assert).

**Red-green:** review-fix tests (P1 canonicalization, P2 N→0, P3+P4 target-entity+audit, P5 dedup, P6 idempotent-upsert) written first → green; okf-server 296/296, doc-repo 429/429; lint/format clean.

**Live gate (run 19): exit 0 — 58 PASS / 0 FAIL** (12 concept edges, well-formed, version-pinned, ZERO dangling per the corrected non-tautological G22 assertion, 6 ENTITY vertices). Honest iteration: run 18 exit 1 was a SMOKE-assertion bug (compared hash-derived keys to concept_id — data was always correct; verified safeKey hash == the _to), not a product defect.
### Review Findings (2026-08-17, 3-layer adversarial review: Blind Hunter + Edge Case Hunter + Acceptance Auditor)

> All three layers converged on a root cause: **`concept_id` is not canonical** — subdirectory bundles (`concepts/index.md`) store `concepts/index` in meta while the worker/links derive bare `index`, so the G22 set-check silently drops every edge and the worker's meta-read no-ops (the flat kenya bundle hides it). Plus three real correctness gaps around vertex/replace semantics.

- [x] [Review][Patch] HIGH concept_id canonicalization: normalize a leading `concepts/` prefix in the edge-service (source id, each link target, the repo set, AND the meta-read must match both forms) — subdirectory bundles currently lose 100% of edges + the worker's meta-read produces a phantom ENTITY [edge-service.js meta read + G22 set; root: parser preserves the directory segment]
- [x] [Review][Patch] HIGH empty-link-set replace leaks stale edges: the `links.length === 0` early-return skips the outgoing-edge cleanup — a concept whose last link is removed keeps its stale edge forever (N→0 transition) [edge-service.js:83-99]
- [x] [Review][Patch] HIGH dangling target vertices: only the SOURCE ENTITY is ensured — a link to a not-yet-drained or failed-ingest concept writes an edge whose `_to` vertex never exists (collections are edge-typed but NOT graph-bound → no referential integrity) [edge-service.js]
- [x] [Review][Patch] MEDIUM AC1 audit row missing: `repo.edges_written` (actor okf-worker) is specified in the MELT contract but never written [edge-service.js — no auditService require]
- [x] [Review][Patch] MINOR duplicate-link-target `written` inflation: deterministic key collapses two links to the same target; `written`/counter overcount, surviving label is last-write-wins [edge-service.js:422-448]
- [x] [Review][Patch] MINOR test gaps: no idempotent-ENTITY-upsert test; no target-entity assertion; no N→0 replace test; the replace test's cleanup is mocked to return the stale key regardless of the `_from` filter (never exercises overwrite/delete) [edge-service.test.js]
- [x] [Review][Patch] MINOR smoke: the "ZERO cross-repo" assertion is tautological (pre-filters to c_ then re-checks the same) and `file_id` is never asserted — tighten both [run-smoke.js edge phase]
- [x] [Review][Patch] MINOR `created_at` churns on re-index (overwrite full-replaces, resetting original creation time) [edge-service.js:151]
- [x] [Review][Defer] parser `conceptIdFromPath` does not strip a `concepts/` prefix (the ROOT of the canonicalization gap) — a parser/ingest-service change, out of 2.9.3's edge-writer scope (R5 additive-first; also touches the 2.9.4 worker transition)
- [x] [Review][Defer] ENTITY `_key` is a sha256 hash (`c_<24hex>`), not the literal concept_id (AC1 letter) — self-consistent + idempotent, justified by ArangoDB `_key` constraints
