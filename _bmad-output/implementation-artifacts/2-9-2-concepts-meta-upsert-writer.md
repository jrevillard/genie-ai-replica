---
baseline_commit: pending
---
# Story 2.9.2: `okf_concepts_meta` UPSERT writer + first-class fields

Status: ready-for-dev
Story key: `2-9-2-concepts-meta-upsert-writer` | GitLab: #918 (`prd::okf-server`, `okf-server::epic-2.9`)
Epic: 2.9 (Write-side Orchestration) | Branch: `feat/okf-server`
FRs: **FR-4** (conformance), **FR-13** (quality metrics), **FR-34** (async ingest) | Gap: **G9** (P1) | ADR-okf-021 (write-path step 4b)

> **The G9 gap:** `conformance-service.persistConformanceIssues` uses a **filter-and-UPDATE** — `FOR d IN okf_concepts_meta FILTER d.repo_id == … AND d.concept_id == … UPDATE d WITH …`. When NO `okf_concepts_meta` doc exists (which is always — nothing creates them), the UPDATE writes **zero rows**, silently. Conformance issues, `pii_state`, trust, and the metrics that read the collection were all **silently lost** (test-masked). This story ships the **canonical UPSERT writer** that creates + updates `okf_concepts_meta` with first-class, indexable fields.

## Story

As a **platform engineer**,
I want **a canonical `okf_concepts_meta` UPSERT writer that creates/updates each concept's metadata row with first-class, indexable fields**,
so that **conformance metrics, PII state, trust/provenance, and the Graph Router's selection signals are actually written and queryable — not silently dropped.**

## Acceptance Criteria

1. **Canonical UPSERT writer.** New `services/concept-meta-service.js` with `upsertConceptMeta(repo_id, input, opts)` that **UPSERTs** a `okf_concepts_meta` doc on the `(repo_id, concept_id)` key: creates when absent, updates when present, **idempotent** (a re-ingest of the same concept updates, never duplicates). Uses the shared db-connection-service + the resilient `let _db = null; async getDb()` pattern. **A no-prior-doc assertion test** proves the UPSERT *created* the doc (not the old filter-and-UPDATE silent no-op).
2. **Race-guarded UPSERT** (unique-index-safe). The `(repo_id, concept_id)` unique index is the race guard (already ensured in `collections.js:25-27`): a concurrent-create unique-violation retries as an update. Mirrors the pattern proven in `pii-service.upsertPiiState` (Story 2.8).
3. **First-class fields written** (per Architecture collection model + ADR-okf-021 step 4b):
   - Identity + linkage: `repo_id`, `concept_id`, `path`, `graph_name`, `bundle_version`
   - Indexable content: `title` (frontmatter.title || basename), `type`, `tags[]`, `labels[]`, `summary` (frontmatter.description || '')
   - Integrity: `content_hash` (sha256 of the concept body — the 2.9.5/2.9.1 dedup key), `frontmatter` (full, v0.2 families preserved)
   - Lifecycle/indexing: `lifecycle_status` (`draft|stable|deprecated`, from parsed status), `index_status` (`parsed` default; `indexed|failed` transitions owned by 2.9.1/2.9.4)
   - Trust/PII: `trust_tier` (from parsed), `stale_after` (parsed), `verified` (parsed), `sources` (parsed), `pii_state` (default `'unknown'` — superseded on scan by 2.8), `last_good_index_at` (null default)
4. **`persistConformanceIssues` rewired to the writer (G9 fix).** `conformance-service.persistConformanceIssues(repo_id, concept_id, issues)` now calls `conceptMetaService.upsertConceptMeta` (which creates the doc if absent + sets `conformance_issues`) instead of the filter-and-UPDATE that wrote zero rows. The conformance issues are written to `okf_concepts_meta.conformance_issues`. **The existing conformance-service tests that exercised the silent-no-op path must be updated to assert the doc is CREATED.**
5. **`getRepoMetrics` reads the written rows.** `conformance-service.getRepoMetrics` already queries `okf_concepts_meta` (concept_count, conformance_issue_count, stale_concept_count, has_reserved_index, broken_link_count, pii_hit_count). After this story, a repo that has had concepts parsed+validated yields **non-zero** metrics (previously zero because no docs existed). Add an integration test: parse+validate+upsert 2 concepts → `getRepoMetrics` returns concept_count=2.
6. **`pii_state` default + 2.8 compatibility.** `upsertConceptMeta` writes `pii_state:'unknown'` by default; `pii-service.scanConcept` (2.8) later supersedes it via its own upsert (kept as-is — no rework of 2.8). Optionally refactor `upsertPiiState` to delegate to the canonical writer (additive; see Dev Notes).
7. **MELT.** `withSpan('okf.meta.upsert')` + shared logger + `okf_concepts_meta_operations_total` counter (operation: create|update, status). All exceptions handled + logged. Direct AQL (no ORM).
8. **Standards.** ESLint/Prettier clean; Jest tests (UPSERT create + update + idempotent + race-guard + no-prior-doc assertion + conformance rewire + metrics non-zero); ITU copyright headers; red-green verified (the new tests FAIL against the current filter-and-UPDATE, PASS after). No Co-Authored-By.

## Tasks / Subtasks

- [ ] **T1 — `concept-meta-service.js`** (AC: 1,2,3,7): the `upsertConceptMeta` function + `content_hash` (crypto sha256 of body) + the race-guarded save/update + MELT. `module.exports`.
- [ ] **T2 — Rewire `persistConformanceIssues`** (AC: 4): `conformance-service.js` — replace the filter-and-UPDATE AQL with a call to `conceptMetaService.upsertConceptMeta` (set `conformance_issues`); update the module comment. **The bug fix itself.**
- [ ] **T3 — `getRepoMetrics` non-zero proof** (AC: 5): verify the existing AQL works once rows exist; add the integration test.
- [ ] **T4 — `pii_state` default + optional 2.8 delegation** (AC: 6): default `'unknown'`; optionally make `pii-service.upsertPiiState` delegate to the canonical writer (additive, guarded — do NOT break 2.8's tests).
- [ ] **T5 — Tests** (AC: 1,4,5,8): `__tests__/concept-meta-service.test.js` — UPSERT create (no-prior-doc assertion), update (re-ingest), idempotent (no duplicate), race-guard (unique-violation → retry-update), all first-class fields written; `__tests__/conformance-service.test.js` — persistConformanceIssues now CREATES the doc (update the silent-no-op test); metrics non-zero test. **Red-green**: confirm the new tests FAIL against the current filter-and-UPDATE, PASS after T1+T2.
- [ ] **T6 — Lint/format/verify** (AC: 8): `cd components/okf-server && npx eslint . && npx prettier --check . && npm test` (full suite green).

## Dev Notes

### The G9 bug (verified)
`conformance-service.js:126-139` `persistConformanceIssues`:
```js
await db.query(aql`
  FOR d IN ${db.collection(COLLECTION)}
    FILTER d.repo_id == ${repo_id} AND d.concept_id == ${concept_id}
    UPDATE d WITH { conformance_issues: ${issues} } IN ${db.collection(COLLECTION)}
`);
```
`UPDATE` only touches EXISTING docs; with no creator, it's a permanent silent no-op. `getRepoMetrics` (line 146) then reads an empty collection → all metrics zero. `pii_state`, trust, provenance — all never persisted.

### The UPSERT pattern to mirror (proven in 2.8)
`pii-service.js:53-75` `upsertPiiState`:
```js
const existing = await col.firstExample({ repo_id, concept_id });
if (existing) { await col.update(existing._key, patch); return 'updated'; }
try { await col.save({ repo_id, concept_id, ...patch }); return 'created'; }
catch (err) {
  // unique-violation race → retry as update
  if (err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409)) {
    const again = await col.firstExample({ repo_id, concept_id });
    if (again) { await col.update(again._key, patch); return 'updated'; }
  }
  throw err;
}
```
`concept-meta-service.upsertConceptMeta` extends this: it is the canonical full-doc writer (the whole first-class field set), with `pii_state` defaulting to `'unknown'`.

### The `(repo_id, concept_id)` unique index already exists
`db/collections.js:24-27` ensures `okf_concepts_meta` with `{ type: 'persistent', fields: ['repo_id', 'concept_id'], unique: true }`. No schema change needed (NFR-S7 additive).

### parseConcept output (the writer's input — Story 2.3, done)
`parser-service.js:182+` returns `{ concept_id, repo_id, path, bundle_version, frontmatter, body, generated, verified, trust_tier, status, stale_after, sources, links }`. The writer maps:
- `title` = `frontmatter.title || path.split('/').pop().replace(/\.md$/,'')`
- `type` = `frontmatter.type`
- `tags` = `frontmatter.tags || []` (array)
- `labels` = `frontmatter.labels || []`
- `summary` = `frontmatter.description || frontmatter.summary || ''`
- `content_hash` = `crypto.createHash('sha256').update(body).digest('hex')`
- `lifecycle_status` = `parsed.status || 'draft'` (validate against `draft|stable|deprecated`)
- `trust_tier`, `stale_after`, `verified`, `sources` = from parsed (v0.2 families)

### Collection model (first-class — Architecture + ADR-021 step 4b)
`okf_concepts_meta` doc: `repo_id, concept_id, title, type, tags[], labels[], summary, frontmatter, content_hash, lifecycle_status, index_status, trust_tier, stale_after, verified, pii_state, bundle_version, last_good_index_at, conformance_issues, graph_name, path, created_at, updated_at`.

### Consumers that benefit (this is why G9 matters)
- `getRepoMetrics` (2.4) — concept_count / conformance_issue_count / stale_concept_count / has_reserved_index / pii_hit_count.
- Graph Router (1.3, gated) — repo-metadata BM25 over `title/type/tags/summary`.
- Or orchestrator (2.9.1) — reads meta for content-hash dedup + lifecycle transition.
- PII gate (2.8 `assertPiiClean`) — reads `pii_state` per concept + the repo scan marker.
- Label Onboarding (Epic 9) — gap analysis reads parsed concepts from `okf_concepts_meta`.

### Scope boundary
- Does NOT write `_LINKS_TO` edges (2.9.3), the `okf_versions` manifest (2.9.7), or own the orchestrator sequence (2.9.1).
- Does NOT transition `index_status` → `indexed|failed` (2.9.1/2.9.4). This story writes `index_status:'parsed'`.
- Does NOT backfill existing data (G9 fix is forward; re-ingest populates).

### Inherited lessons from 2.1-2.8 reviews
Shared libs IMPORTED not copied · MELT on every method · resilient `let _db = null` getDb · direct AQL (no ORM) · race-guarded UPSERT (2.8) · red-green verified (tests must FAIL before the fix) · adversarial review WILL probe the silent-no-op · no Co-Authored-By.

### References
- Code: `conformance-service.js:126-139` (filter-and-UPDATE bug), `:146` (getRepoMetrics) · `pii-service.js:53-75` (upsertPiiState pattern) · `parser-service.js:182+` (parseConcept shape) · `db/collections.js:24-27` (unique index) · `services/repository-service.js` (getById → metrics).
- Docs: Architecture collection model (`okf_concepts_meta` first-class) · ADR-okf-021 write-path step 4b (`UPSERT okf_concepts_meta`) · course-correction G9 · PRD FR-4/13/34 · epics.md Story 2.9.2.

## Dev Agent Record

### Agent Model Used
_(filled during dev-story)_

### Debug Log References

### Completion Notes List

### File List
