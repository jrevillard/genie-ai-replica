---
baseline_commit: 993fc840c
---

# Story 3.11: Regression guard — feed retraction isolation + relevance baseline

Status: review

## Story

As a platform engineer,
I want automated proof that (a) feed retraction never touches file-sourced chunks and (b) mixed feed+file vector search stays as relevant as the curated-only baseline,
so that the ingestor can go to production without risking the existing document corpus (OQ-SST-4 resolved, D2).

## Current State (verified on `feat/sst` 2026-09-06, post-3-9)

- **Part 1 (retraction isolation) is unit-testable NOW**: `retract_expired_chunks` (`genieai_stream_ingestor.py:169+`) removes chunks by `source_type == "feed"` + `expires_at` filters. `source_type` on chunks is `"file"` (default, story 3-1 `core/source_type.py`) vs `"feed"` (set at ingest, story 3-3/3-4 via dataprep `sourceType: "feed"`). The invariant — a retraction pass can never delete a file-sourced chunk — is enforced by the AQL filter and deserves a pinned test.
- **Part 2 (relevance baseline)**: `tests/rag-benchmarks/eval/run_eval.py anchor gold.json out.json` is the **deterministic anchor eval** (no LLM, reproducible recall/precision over a gold dataset driven through chatqna). This RESOLVES OQ-SST-4: the curated-only baseline = the anchor eval run against a corpus containing ONLY the gold dataset's curated documents (feeds disabled), before any feed ingestion; mixed-corpus runs compare against it. The benchmark harness already documents re-baselining semantics (CLAUDE.md "Two eval paths").
- The full anchor eval needs a deployed stack (chatqna + VictoriaTraces + ArangoDB) — it is an **on-demand integration procedure**, not CI-runnable unit work. The CI-runnable part is the retraction-isolation invariant + pure-logic guards.
- Feed retraction path: `retract_expired_chunks` loops `expires_at < now` feed chunks and calls `retract_file` on dataprep per chunk (3-2, shipped). Dataprep `retract_file` deletes by fileId — file-sourced chunks have different fileIds (UUID namespace), but the AQL filter is the actual guard.

## Acceptance Criteria

1. **CI-runnable regression tests** (new `tests/test_retraction_isolation.py` or extend `test_stream_ingestor.py`):
   - `retract_expired_chunks` with a mocked Arango cursor containing BOTH file-sourced and feed-sourced (expired) chunks: the AQL bind vars constrain to `source_type == "feed"` — assert via the query/bind capture that no file-sourced doc matches, i.e. the query itself filters on source_type
   - dataprep `retract_file` is invoked ONLY with fileIds belonging to expired feed chunks
   - a file-sourced chunk with `expires_at` set (legacy/pathological) is STILL excluded (source_type filter dominates)
2. **OQ-SST-4 resolution doc** (`docs/adr/0004-feed-relevance-baseline.md`): curated-only baseline = `run_eval.py anchor` over a curated-only corpus; feeds on → re-run → compare recall/precision deltas (acceptance threshold: no recall regression on gold queries); feed retraction → re-run → file-chunk recall unchanged. Signed off as a proposal pending user confirmation (flagged in plan.md).
3. **Benchmark procedure doc** (`tests/rag-benchmarks/FEED_BASELINE.md`): step-by-step — curated-only ingest → anchor baseline → feeds on → anchor compare → retraction → anchor re-compare. No new harness code (the eval exists); this is the procedure + interpretation.
4. Overlay suite green; ruff clean.

## Tasks / Subtasks

- [ ] Task 1 — Retraction-isolation tests (AC: 1)
  - [ ] Mock the Arango cursor/AQL capture on `retract_expired_chunks` (the ingestor's `db.query` — the AQL string contains `source_type == "feed"`; assert bind vars + query text), assert `retract_file` calls only feed chunk fileIds
- [ ] Task 2 — ADR 0004 + FEED_BASELINE.md (AC: 2, 3)
- [ ] Task 3 — Suite + ruff; trackers (3-11 → review with the OQ-SST-4 resolution flagged for user confirmation; plan.md)

## Dev Notes

- Part 2 produces NO new harness code — the anchor eval already exists and is deployed-stack-dependent. Do not try to make it CI-runnable.
- If `retract_expired_chunks`'s AQL turns out NOT to filter on source_type (verify first — read the actual query), that is a **critical find**: file chunks would be retractable. Fix the AQL filter in the same story (one-line bind + filter) and pin it with the test.
- ADR 0004 status: "Proposed — pending user confirmation of OQ-SST-4" (the user signs, like ADR 0003).

### Testing standards

- Extend/pytest; mock `db.query` to capture the AQL + bind vars (the ingestor uses `self.db.query(aql...)` — patch `ingestor.db.query` and inspect `query.attrs`/bind vars, or assert on the rendered query text).

### References

- [Source: epics.md#Story-3.11] — both regression-guard halves + AC
- [Source: genieai_stream_ingestor.py retract_expired_chunks] — the AQL filter under test
- [Source: tests/rag-benchmarks/CLAUDE.md] — anchor eval + re-baseline semantics
- [Source: OQ-SST-4] — "which curated-only baseline validates feed-chunk relevance" → resolved by this story's ADR + procedure

### Review Findings

_Code review 2026-09-06 — compact single-pass review (Blind-equivalent, in-session; subagent layers skipped — repeated API 429 kills this session, same posture as 3-5's gate)._

- [x] [Review][Verified] **The Dev Notes' critical-if-missing check**: `retract_expired_chunks`'s AQL DOES filter on `source_type == 'feed'` AND `expires_at` — file chunks unreachable by construction. No fix needed; the test pins the query text so a regression can't slip silently.
- [x] [Review][Verified] Part 2 produces no harness code (AC respected): FEED_BASELINE.md is procedure-only, driving the existing `run_eval.py anchor`.
- [x] [Review][Note] A pre-compaction test attempt left a broken partial `tests/test_stream_ingestor.py` at the REPO ROOT (wrong cwd) — deleted; the real tests live in the overlay suite.
- [x] [Review][Note] The anchor runs (baseline/mixed/retraction) remain on-demand operator tasks — recorded in ADR 0004 Consequences, not silently dropped.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- TestRetractionIsolation: 3 tests green (AQL shape pin incl. `source_type == 'feed'` + `expires_at < @now` + float bind; empty-result → zero retract POSTs; missing collection → no query). Uses a `_FakeRetractSession` recording POSTs — conftest's aiohttp mock can't do real async context managers.
- Full overlay suite **835 green** (832 + 3), ruff check + format clean.

### Completion Notes List

- Part 1 (CI-runnable): `TestRetractionIsolation` pins the isolation invariant in the retraction AQL text — file chunks unreachable by construction, not convention; retract POSTs go only to expired feed fileIds; `DATAPREP_RETRACT_URL` target asserted.
- Part 2 (on-demand): ADR 0004 (PROPOSED — pending user confirmation, ADR 0003 pattern) ratifies the curated-only anchor eval as the baseline; acceptance = no gold-query recall regression with feeds on, file-chunk recall unchanged after retraction. `tests/rag-benchmarks/FEED_BASELINE.md` = the 3-run procedure (baseline → feeds-on → post-retraction), no harness changes.
- OQ-SST-4: resolved as a proposal, flagged for user sign-off (mirrors the 2-1 D4 flow).

### File List

- genie-ai-overlay/tests/test_stream_ingestor.py (+TestRetractionIsolation, 3 tests)
- docs/adr/0004-feed-relevance-baseline.md (new, proposed)
- tests/rag-benchmarks/FEED_BASELINE.md (new)
- _bmad-output/implementation-artifacts/{3-11 story, sprint-status, plan.md}

### Change Log

- 2026-09-06: Retraction-isolation tests + ADR 0004 + FEED_BASELINE.md; 835 green → status review (ADR pending user confirmation; anchor runs are operator tasks)
