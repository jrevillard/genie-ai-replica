---
baseline_commit: 194f6bd
---
# Story 2.9.3: `_LINKS_TO` edge writer (within-repo validated) (G7, G22)

Status: ready-for-dev

Story key: `2-9-3-links-to-edge-writer-within-repo` | GitLab: #964
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

- [ ] T1 `services/edge-service.js` (AC 1) + unit tests
- [ ] T2 4b links persistence (AC 2) + buildMetaDoc test
- [ ] T3 Worker post-Ingested hook (AC 3) + unit test
- [ ] T4 Smoke edge assertions (AC 5); live run to exit 0
- [ ] T5 Suites (okf-server/doc-repo/overlay) + lint/format; close-out (sprint/#964/push)

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
