# ADR okf-027: Cross-graph RRF — 2-level hierarchy with per-graph size normalization

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G21 (P2): the existing `rrf_fuse` fuses per-graph ranked lists, but naive cross-graph fusion treats a small repo's 3 hits identically to a large repo's 50 — small repos get drowned out or over-weighted depending on `k`, and there is no testbed to tune it ("tune empirically" with no fixtures). The PRD §13 open question 7 ("RRF weights for cross-graph fusion") is unresolved. The user wants fusion that is fair across repos of unequal size.

Basis: [okf-course-correction-2026-08-13 §2.4[5], §2.5, §3 D15](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md).

## Decision

**Cross-graph fusion is a 2-level RRF hierarchy: within-graph RRF (dense ⊕ BM25) per graph → per-graph top-K, then cross-graph RRF across the per-graph top-K, weighted by per-graph size/confidence.** (D15 = (a).)

1. **Level 1 — within-graph.** Per selected graph, fuse dense COSINE + BM25 via the existing `rrf_fuse` → per-graph ranked top-K. (Reuse, not rebuild.)

2. **Level 2 — cross-graph.** RRF across the per-graph top-K lists, with a **size/confidence weight** that normalizes small vs. large repos (e.g. down-weight a repo contributing very few hits; up-weight a repo with strong per-hit scores). This is the small-repo normalization G21 demands.

3. **Tuning = the testbed, not intuition.** `k` and the per-graph weights are tuned against the seed fixtures via the **RRF parameter-sweep harness** (Story 8.4), which varies `k` + weights and reports recall@k/precision@k/MRR. This closes PRD open question 7 with evidence.

4. **Provenance preserved.** Each fused hit retains `graph_name`/`repo_id`/`concept_id` (Story 1.0) so the agent can attribute the citation to the winning repo.

## Alternatives considered

| Alternative | Status |
|---|---|
| Flat 2N-channel RRF (D15-b) | Rejected — mis-weights small repos (the G21 defect); a flat channel per graph has no notion of per-graph confidence. |
| Learned ranker | Out of scope — a 2-level RRF with tuned weights is interpretable, cheap, and sufficient for v1. |

## Consequences

- **Positive**: fair cross-repo fusion (G21); the testbed makes tuning measurable (Story 8.4); PRD Q7 resolved with data.
- **Negative**: a second fusion stage; weight-tuning is now a required activity (Story 8.4) before pilot.
- **Mitigations**: reuse `rrf_fuse` at level 1; the sweep harness bounds the tuning effort; defaults are sane until the sweep runs.

## References

PRD §4.4 (FR-24), §13 Q7; [okf-course-correction-2026-08-13 §2.4[5], §3 D15](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-012](okf-012-multi-graph-grounding.md); [ADR-okf-024](okf-024-graph-selection-router.md).
