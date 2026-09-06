# ADR 0004: Feed relevance baseline procedure (OQ-SST-4)

- **Status:** Proposed — pending user confirmation
- **Date:** 2026-09-06
- **Scope:** Server-Side Tools initiative (OQ-SST-4 / plan.md; story 3-11)
- **Related:** ADR 0002 (Server-Side Tools architecture, Decision: feed ingestion), `tests/rag-benchmarks/FEED_BASELINE.md` (the procedure this ADR ratifies)

## Context

Story 3-11's second half asks: how do we prove that mixing feed-sourced chunks
into the vector store never degrades retrieval relevance for the curated
corpus? The open question (OQ-SST-4) was *which* baseline the comparison runs
against — a new gold set, a snapshot dump, or something already in the repo.

The repo already contains a deterministic, reproducible retrieval eval: the
**anchor eval** (`tests/rag-benchmarks/eval/run_eval.py anchor`). It drives the
gold dataset through the deployed chatqna, harvests retrieved/selected chunk
keys from VictoriaTraces, and scores recall/precision — no LLM judge, so runs
are comparable across time. Chunk identity is content-hash-based and survives
re-ingestion. It needs a deployed stack, so it is an on-demand integration
procedure, not CI-runnable.

## Decision

**The curated-only anchor eval is the baseline.** Specifically:

1. **Baseline** — with feeds disabled (no feed-sourced chunks in the corpus),
   run `run_eval.py anchor gold.json baseline.json` on the deployed stack.
   This number IS "curated-only relevance" for the deployment's gold set.
2. **Mixed-corpus check** — enable feeds, let ingestion land, re-run the
   anchor eval. Acceptance: **no recall regression on any gold query**
   (precision may move within noise as feed chunks join the candidate sets;
   a recall drop means a feed chunk displaced a gold chunk past the selection
   cut — investigate, do not ship).
3. **Retraction check** — after a retraction pass removes expired feed chunks,
   re-run the anchor eval. Acceptance: **file-chunk recall unchanged** vs the
   baseline — proving retraction is isolated to feed-sourced content. (The
   unit-level invariant — the retraction AQL filters on `source_type == 'feed'`
   — is pinned CI-side in `genie-ai-overlay/tests/test_stream_ingestor.py`
   `TestRetractionIsolation`.)

Step-by-step commands, including the feeds-disable mechanics and how to
interpret partial regressions, live in
`tests/rag-benchmarks/FEED_BASELINE.md` (no harness code changes — the eval
already exists).

## Consequences

- No new eval infrastructure; the initiative adds only procedure + a pinned
  unit invariant.
- The full procedure requires a deployed stack (chatqna + VictoriaTraces +
  ArangoDB) — it runs at integration time, not in CI. The story record flags
  this as an on-demand gate, not a merge blocker for the ingestor code itself.
- A chunking-parameter change invalidates the gold set (content-hash identity)
  → re-baseline per the existing benchmark conventions.
- The 3-11 story completes in CI terms (tests + docs); the baseline/mixed/
  retraction anchor runs remain an operator task recorded here.

## Sign-off

- **Decision owner:** Adem Mcharek (pending — this ADR is a proposal until
  confirmed, matching ADR 0003's sign-off pattern)

## References

- OQ-SST-4: `_bmad-output/planning-artifacts/prds/prd-server-side-tools.md`
- Story 3-11: `_bmad-output/implementation-artifacts/3-11-regression-guard.md`
- Anchor eval methodology: `tests/rag-benchmarks/CLAUDE.md`
- Procedure: `tests/rag-benchmarks/FEED_BASELINE.md`
