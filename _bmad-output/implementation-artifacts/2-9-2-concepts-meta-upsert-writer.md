---
baseline_commit: 6d1d433
---
# Story 2.9.2: `okf_concepts_meta` UPSERT writer + first-class fields

Status: done
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

- [x] **T1 — `concept-meta-service.js`** (AC: 1,2,3,7): the `upsertConceptMeta` function + `content_hash` (crypto sha256 of body) + the race-guarded save/update + MELT. `module.exports`.
- [x] **T2 — Rewire `persistConformanceIssues`** (AC: 4): `conformance-service.js` — replace the filter-and-UPDATE AQL with a call to `conceptMetaService.upsertConceptMeta` (set `conformance_issues`); update the module comment. **The bug fix itself.**
- [x] **T3 — `getRepoMetrics` non-zero proof** (AC: 5): verify the existing AQL works once rows exist; add the integration test.
- [x] **T4 — `pii_state` default + optional 2.8 delegation** (AC: 6): default `'unknown'`; optionally make `pii-service.upsertPiiState` delegate to the canonical writer (additive, guarded — do NOT break 2.8's tests).
- [x] **T5 — Tests** (AC: 1,4,5,8): `__tests__/concept-meta-service.test.js` — UPSERT create (no-prior-doc assertion), update (re-ingest), idempotent (no duplicate), race-guard (unique-violation → retry-update), all first-class fields written; `__tests__/conformance-service.test.js` — persistConformanceIssues now CREATES the doc (update the silent-no-op test); metrics non-zero test. **Red-green**: confirm the new tests FAIL against the current filter-and-UPDATE, PASS after T1+T2.
- [x] **T6 — Lint/format/verify** (AC: 8): `cd components/okf-server && npx eslint . && npx prettier --check . && npm test` (full suite green).

### Review Findings (2026-08-15, 3-layer adversarial review)

**Critical**

- [x] [Review][Patch] `persistConformanceIssues` update path clobbers every first-class field — conformance calls the writer with a 2-field stub; the update patch is a full `buildMetaDoc(stub)` doc (title→concept_id, `content_hash`→sha256(''), `pii_state`→'unknown', trust/sources/frontmatter wiped) merged over the existing doc. Under ADR-021's 4b→4c order, 4c destroys what 4b wrote. Fix: patch-only semantics for minimal input (write ONLY `conformance_issues` when the parsed input is minimal) [conformance-service.js:135-139, concept-meta-service.js:134-142]
- [x] [Review][Patch] All 5 kenya smoke fixtures are paste-escaped (`\---`, `\*`, `\_`, `\[`, CRLF) — zero frontmatter parses (verified with gray-matter: `data keys: []`); every smoke run exercised only the no-frontmatter fallback; actor prefixes (`system:`, `machine:`) also violate the same diff's `VALID_ACTOR_PREFIXES`. Fix: unescape all 5 fixtures + valid actors [data/okf/smoke-test/kenya-bundle/*.md]

**Major**

- [x] [Review][Patch] run-smoke.js never asserts the PII gate, `pii_state`, or conformance outcomes — the gate is structurally always blocked in this harness (no repo scan marker) yet the script prints `SMOKE TEST PASSED`; the rewired `persistConformanceIssues` path is never exercised; `report` array is dead code [data/okf/smoke-test/run-smoke.js]
- [x] [Review][Patch] ESLint FAILS as committed: `'crypto' is already defined as a built-in global` (no-redeclare) in the new service — T6's "ESLint clean" claim is false [concept-meta-service.js:12]
- [x] [Review][Patch] Undefined `concept_id` silently degrades `firstExample` to repo-wide on REAL arangojs (undefined keys JSON-dropped; native wrapper confirmed) → arbitrary-doc overwrite; the unit mock's strict-equality can never catch it; docs missing `concept_id` also escape the unique index (race guard dead). Same gap in pii-service `findPiiDoc`. Fix: reject falsy `repo_id`/`concept_id` at entry [concept-meta-service.js:125+, pii-service.js:64-71]
- [x] [Review][Patch] Update path resets `pii_state` to 'unknown' and `last_good_index_at` to null on EVERY update — a re-ingest (or finding 1's persist) un-blocks a correctly blocked repo without a rescan, defeating the fail-closed gate. Fix: never downgrade `pii_state`/`last_good_index_at` via update patch [concept-meta-service.js:108,135-138]
- [x] [Review][Patch] AC-5 "metrics non-zero" test is a mock-echo tautology (`mockDb.query.mockResolvedValue` asserted back; seeded store never read; dead first mock line); the required integration proof is absent. Fix: real assertion path + `conformance_issue_count` asserted in run-smoke against live Arango [__tests__/concept-meta-service.test.js:166-189]
- [x] [Review][Patch] Weak/vacuous test assertions: "idempotent" test uses a CHANGED body and only asserts `content_hash !== ''` (can never fail); hash-change and `created_at` preservation never asserted. Fix: capture first hash, assert change on new body + equality on same body; assert created_at preserved [__tests__/concept-meta-service.test.js:131-138]

**Minor**

- [x] [Review][Patch] `lifecycle_status` not validated against `draft|stable|deprecated` (spec's Dev Notes say "validate against") [concept-meta-service.js buildMetaDoc]
- [x] [Review][Patch] Exception paths not logged (AC-7 says "handled + logged") — `recordOp('create','error'); throw` with no logger call; transient `findConceptDoc` failures rethrow unlogged [concept-meta-service.js:145-168]
- [x] [Review][Patch] `isNotFound` message regex (`/no match|not found/i`) classifies transients (collection-not-found, gateway route-not-found) as doc-absent → proceeds to create. Fix: match `errorNum === 1204 || code === 404` only [concept-meta-service.js:51, pii-service.js:60]
- [x] [Review][Patch] `isNotFound`/`findConceptDoc` cloned verbatim into pii-service — the two-writers drift G9 was meant to kill; extract a shared helper ("shared, not copied" lesson) [concept-meta-service.js, pii-service.js:53-71]
- [x] [Review][Patch] Three near-identical update blocks (update path, race-retry, and their patch-build) — extract one `applyUpdate` helper; race branch also omits the success log [concept-meta-service.js:134-168]
- [x] [Review][Patch] Return-shape inconsistency: create discards `col.save()` metadata (`doc` has no `_key`), update returns stale `_rev` [concept-meta-service.js:142,151]
- [x] [Review][Patch] `recordOp('update','error')` missing — update failures produce no metric [concept-meta-service.js:138]
- [x] [Review][Patch] `buildMetaDoc` null guard is dead — `parsed.frontmatter` deref runs before the `parsed || {}` guard [concept-meta-service.js:80-81]
- [x] [Review][Patch] Delete TOCTOU: doc deleted between `firstExample` and `update` → 1204 propagates instead of falling through to create [concept-meta-service.js:133-138]
- [x] [Review][Patch] `persistConformanceIssues(repo, id, undefined)` silently writes nothing for issues (key JSON-dropped) then crashes at `issues.length` AFTER the write [conformance-service.js:140]
- [x] [Review][Patch] Red-green evidence not recorded — Dev Agent Record "Debug Log References"/"Completion Notes" empty; record the red-run evidence during the fix pass [story file Dev Agent Record]

**Nit**

- [x] [Review][Patch] Orphaned JSDoc in pii-service (inserted between `@param` block and its function) [pii-service.js]
- [x] [Review][Patch] Race-test hygiene: `col.save` restore happens after the await (leaks on failure); metrics test replaces the whole `_stores` collection object the race test warns about [__tests__/concept-meta-service.test.js]

**Deferred** (pre-existing / out-of-diff — logged to deferred-work.md)

- [x] [Review][Defer] Prettier fails on 8 files outside this diff (`repository-service.js` from e1d1a3c03, five 2.3-era fixtures, two runtime `logs/*.json`) — deferred, pre-existing
- [x] [Review][Defer] Content-hash skip-if-unchanged short-circuit + whether the hash should cover frontmatter — dedup semantics owned by Stories 2.9.1/2.9.5 — deferred to owning stories

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

glm-5.2[1m] (initial dev-story) · glm-5.3[1m] (2026-08-15 code-review fix pass)

### Debug Log References

- **Red-green evidence (review-fix pass, 2026-08-15):** the regression suite added for the review findings FAILED **8 tests / 9 passed** against the pre-fix committed code (clobber regression, pii_state downgrade, last_good_index_at wipe, falsy-id TypeError, TOCTOU propagation, lifecycle enum, dead null guard, undefined-issues crash) — then **134/134 passed** after the fixes. ESLint clean (crypto no-redeclare fixed via node:crypto destructure); Prettier clean on all touched files (the only remaining warn, services/repository-service.js, is the logged pre-existing defer).
- **Live smoke evidence (2026-08-15, local build, okf-server rebuilt at the fix commit):** run-smoke.js → **exit 0**, all criteria asserted: 6/6 concepts parsed WITH frontmatter; 5 conforming files 0 issues; bad_concept.md exactly MISSING_TYPE + BAD_ACTOR_PREFIX; concept_count=6, conformance_issue_count=2 computed from live Arango via the G9 persist path; all 6 pii_state=clean (live Presidio sidecar); repo scan marker set; **publish gate OPEN** ({"blocked":false}) — the first fully-asserted open-gate run.

### Completion Notes List

### File List
