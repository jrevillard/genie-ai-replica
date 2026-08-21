---
title: 'Reranker bounds safety + KneeLocator edge cases'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
created: '2026-08-13'
baseline_revision: '7a1b20e3c1785e0678039d5dcf340170132f1930'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/genie-ai-overlay/CLAUDE.md'
warnings: []
deferred:
  - summary: 'DW-8/DW-13 (CI import smoke for reranker) deferred to story 2.4 re-graft-the-reranker'
    evidence: 'Story 2.4 backlog, spec not yet written. CI job belongs to that story scope.'
    location: '.gitlab-ci.yml'
    severity: low
---

<intent-contract>

## Intent

**Problem:** `genieai_tei_reranker.py` has no bounds check on `retrieved_docs[index]` lookups — a buggy TEI response with an out-of-range index crashes with `IndexError`. KneeLocator edge cases (single doc, flat scores) are untested.

**Approach:** Add a bounds check before every `retrieved_docs[index]` access — skip the result and log an error if index is out of range. Add KneeLocator edge case tests for single-doc and flat-score scenarios.

## Boundaries & Constraints

**Always:** Bounds check must log an error and skip (not raise) to preserve partial results. Tests must use the existing `test_reranker.py` patterns (mocked types via `patch_reranker_types` fixture).

**Block If:** None.

**Never:** Do not modify the TEI response validation logic (lines 257-281 already validate structure). Do not change the KneeLocator call signature. Do not add new dependencies. Do not add CI jobs (deferred to story 2.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bounds check — valid index | TEI returns `{"index": 0, "score": 0.9}` for 3 docs | `retrieved_docs[0]` accessed normally | No error |
| Bounds check — index out of range | TEI returns `{"index": 5, "score": 0.8}` for 3 docs | Result skipped, error logged | `logger.error("TEI index 5 out of range for 3 docs")` |
| KneeLocator — single doc | 1 doc with score 0.9 | `knee` is None, cutoff = 1, all docs returned | No crash |
| KneeLocator — flat scores | 3 docs all with score 0.5 | `knee` is None or low, cutoff computed, docs returned | No crash |

</intent-contract>

## Code Map

- `genie-ai-overlay/reranker/genieai_tei_reranker.py:296,306,324,336,375,410,419` -- all `retrieved_docs[index]` accesses needing bounds check (DW-131)
- `genie-ai-overlay/reranker/genieai_tei_reranker.py:316` -- KneeLocator call (DW-132)
- `genie-ai-overlay/tests/test_reranker.py` -- existing reranker test suite (1113 lines), uses `patch_reranker_types` fixture, `TestKneeThresholdStrategy` class at line 407

## Tasks & Acceptance

**Execution:**
- `genie-ai-overlay/reranker/genieai_tei_reranker.py` -- Add bounds check before every `retrieved_docs[index]` access (7 sites: lines 296, 306, 324, 336, 375, 410, 419). For each: if `index < 0 or index >= len(input.retrieved_docs)`, log error with TEI index and doc count, skip that result. Do not raise. -- DW-131 prevents IndexError crash from buggy TEI response
- `genie-ai-overlay/tests/test_reranker.py` -- Add edge case tests for KneeLocator: single-doc scenario (1 doc, KneeLocator.knee=None), flat-score scenario (3 docs all same score). Verify no crash, `cutoff` computed correctly, docs returned. Add bounds check tests: TEI response with out-of-range index → result skipped, error logged; valid index → normal access. -- DW-131/DW-132 test coverage

**Acceptance Criteria:**
- Given a TEI response with `{"index": 5, "score": 0.8}` for 3 retrieved docs, when the reranker processes it (any strategy), then the out-of-range result is skipped, an error is logged, and no IndexError is raised
- Given a single-doc input to `knee_threshold` strategy, when KneeLocator is called, then `knee` is None, cutoff = 1, the doc is returned, and no exception is raised
- Given flat-score input (all scores identical) to `knee_threshold` strategy, when KneeLocator is called, then cutoff is computed (knee=None or low), docs are returned, and no exception is raised

## Spec Change Log

## Review Triage Log

### 2026-08-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

## Auto Run Result

**Summary:** Added bounds check to all 7 `retrieved_docs[index]` accesses in `genieai_tei_reranker.py` to prevent IndexError from buggy TEI responses. Added 9 tests covering bounds check edge cases and KneeLocator single-doc/flat-score scenarios.

**Files changed:**
- `genie-ai-overlay/reranker/genieai_tei_reranker.py` — Added `_safe_get_doc()` helper, applied at 7 access sites, adaptive strategy converted to loop with skip logic, `ranked_tei_indices` tracking for correct `original_index` annotation
- `genie-ai-overlay/tests/test_reranker.py` — Added `TestBoundsCheck` (5 tests) and `TestKneeLocatorEdgeCases` (4 tests)

**Review findings:** Manual triage — no issues found. Implementation matches spec intent exactly.

**Verification:**
- `pytest tests/test_reranker.py` → 64 passed (55 existing + 9 new)
- `ruff check` → no issues
- `ruff format --check` → clean

**Residual risks:** DW-8/DW-13 (CI import smoke for reranker) deferred to story 2.4 as agreed.

## Design Notes

The bounds check skips rather than raises because the existing TEI response validation (lines 257-281) already catches structural errors (non-list, HTTP non-200). An out-of-range index is a data alignment issue (TEI returned fewer scores than docs, or indices are malformed) — skipping preserves partial results and lets the caller decide whether to retry or fail upstream. The alternative (raising) would abort the entire rerank request for one bad index, which is worse than degrading gracefully.

## Verification

**Commands:**
- `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_reranker.py -v` -- expected: all existing tests pass + new edge case tests pass
- `cd genie-ai-overlay && source .venv/bin/activate && ruff check reranker/ tests/test_reranker.py` -- expected: no lint errors
- `cd genie-ai-overlay && source .venv/bin/activate && ruff format --check reranker/ tests/test_reranker.py` -- expected: formatting clean
