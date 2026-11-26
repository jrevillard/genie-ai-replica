# Story — #2191: repos-list summary projection + ETag (5.2 MB → KB)

**Status:** IN PROGRESS (2026-11-26)
**Issue:** #2191 (`perf(okf-server)`, priority::high)
**Branch:** `feat/okf-repos-summary-projection` (off main `c133d66de`)
**Worktree:** `D:\ITU-Gitlab\.claude\worktrees\okf-repos-projection`

## Intent (David, 2026-11-26)

`GET /okf/repos?lifecycle=all` returned **5,238,230 bytes** (200) for 33
repositories — `toResponse` spread the FULL document (`{...doc}`), Kong
logged a temp-file spool per call, and the dashboard `JSON.parse`s 5.2 MB on
the main thread every 5 s poll and after every real change.

## Design (additive-first)

- `toSummary(doc)` — an ALLOWLIST pinned from the fields StudioDashboard.vue
  actually reads (`r.*` in the template, swept 2026-11-26): repo_id, name,
  domain, version, lifecycle_state, created_at, updated_at, ingested_at,
  studio_step, conversion, rag_ingestion, metrics, trust, cloned_from.
- `list({ projection: 'summary' })` — the ROUTE opts in
  (`repository-controller.listRepos`); internal callers without the flag keep
  the full document (additive-first core policy).
- The three enrichments (indexing_pending, concept_count, failed_counts)
  still attach to summaries — the wizard Choose-step's `concept_count`
  clone-patch contract is pinned by test.
- **ETag**: no code — Express's default weak-ETag already 304s stable GETs on
  this stack (the measured concepts-route 304s prove it); the projection
  makes the body small and deterministic enough for the poll to hit 304.
  Verified `app.set('etag', …)` is never disabled.
- Full documents remain behind `GET /:id` (unchanged).

## Acceptance (from the issue)

- List payload for 33 repos ≤ ~100 KB (allowlist ≈ 0.4 KB/repo + enrichment
  counters — verified by field sweep, measured after deploy).
- No Kong temp-file warn (small body never exceeds the proxy buffer).
- Wizard concept_count contract preserved (test-pinned).

## Verification

- TDD RED→GREEN: projection test (card fields present, heavy fields absent,
  enrichments attach) + default-full-doc compat pin. 73/73 in the service
  suite; full okf-server run + coverage ≥ baselines gates the MR.
- ArtifactsView's first-page KNOWN LIMIT unaffected (reads names/ids only).
- Deploy to the local build before merge; live measurement of the payload
  size is the acceptance metric.
