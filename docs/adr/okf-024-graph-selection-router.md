# ADR okf-024: Graph selection — the Graph Router (intelligent selection, not dumb fan-out)

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G6 (P0): the current design (Story 1.1) treats **authorized** as **relevant** — it fans out to *every* graph the caller's token grants. At 50 repos that is ~300+ ArangoDB round-trips per query and an unbounded latency blow-out (NFR-PR1 ≤300ms p95 is unreachable). Worse, it conflates two distinct label roles (ACL enforcement vs. selection signal). The user explicitly directed: *"We may need some smarts to determine which graphs to traverse based on the query and the data labels… WE ARE INNOVATING"* and *"a fan out should likely be done with 1 AQL query across multiple graphs if possible"* (confirmed feasible on both ArangoDB and ArcadeDB — single-query multi-graph fan-out IS portable).

The substrate: Genie's service-category classifier already exists; `okf_concepts_meta` will carry first-class `title/type/tags/summary` (Story 2.9.2); the retriever already parameterizes per-`graph_name`; BM25 views are lazy per graph.

Basis: [okf-course-correction-2026-08-13 §2.4, §2.5, §3 D8/D9/D10/D14](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md).

## Decision

**Insert an explicit Graph Router between authz and retrieval that selects the relevant subset of authorized graphs via domain binding + repo-metadata BM25, bounded by `MAX_FANOUT_GRAPHS` (default 5, configurable) with a ≤20ms selection-latency gate.** (D8 = (a); D9 = 5 configurable; D10 = ≤20ms gate; D14 = (a) ChatQnA.)

1. **Algorithm (v1) = domain binding + repo-metadata BM25** (D8). (a) **Domain binding**: detect the query domain (service-category classifier or exact match against `okf_repositories.domain`) — a near-free exact-match cut (a health query → health repos only). (b) **Repo-metadata BM25**: one AQL over `okf_concepts_meta` (query vs repo `title/type/tags/summary`) → rank candidate repos by metadata relevance. (c) *[Optional v2]* repo-centroid similarity. (d) **Selection**: top-K candidates ∩ authorized set, capped at `MAX_FANOUT_GRAPHS`.

2. **`MAX_FANOUT_GRAPHS` = 5 (configurable)** (D9). Balances coverage vs. latency. The env var (`OKF_MAX_FANOUT_GRAPHS`, default 5) is deployment-tunable; a pre-implementation latency benchmark (p95 vs graph count) is a **launch gate**, not a "tune later" item.

3. **Selection latency budget ≤20ms** (D10). This is a **gate**, enforced in CI against the seed fixtures (Story 8.1) — selection that exceeds it fails the build, not "noted for later."

4. **Graph Router lives in ChatQnA** (D14 = (a)). It is on the hot path and already calls the retriever. The **Authz Resolver stays in okf-server** governance (ADR-okf-025) — ChatQnA receives the already-resolved authorized set, then selects.

5. **Labels serve two distinct roles, never conflated** (G8/G12). (1) **ACL enforcement** (`t:`/`r:`/`d:`) = per-graph `chunk_labels` filter *inside* each selected graph at retrieval (per-graph parameterized, never a global union). (2) **Selection signal** = the repo's `domain` + concept `tags`/`type` feed the router's domain-binding and metadata-BM25 steps. This is what makes selection *intelligent*.

6. **Observability** (G35). The router emits span attributes: `graphs_authorized`, `graphs_selected`, `selection_reason`, `selection_latency_ms` (Story 1.6).

7. **Single-query fan-out.** Where the selected graphs share a schema (they do — `OKF_{repo_id}_SOURCE`), prefer a **single AQL** with a dynamic `UNION`/graph list over N round-trips (confirmed feasible on ArangoDB now and portable to the future ArcadeDB persistence tier). This realizes the user's "1 AQL query across multiple graphs" directive and is the primary latency mechanism alongside the selection cap.

## Alternatives considered

| Alternative | Status |
|---|---|
| Repo-centroid similarity (D8-b) | Deferred (v2) — needs centroid infrastructure (`ARANGO_NUM_CENTROIDS` at repo granularity); metadata BM25 is near-free and uses data that already exists. |
| Lightweight classifier (D8-c) | Deferred — adds a model dependency; domain binding + BM25 covers the order-of-magnitude cut for v1. |
| Graph Router in okf-server governance (D14-b) | Rejected for v1 — adds a hop on the hot path; ChatQnA already calls the retriever. The authz resolver stays in okf-server regardless. |
| Fan out to all authorized graphs (status quo) | Rejected — G6; does not scale past a handful of repos; violates NFR-PR1. |

## Consequences

- **Positive**: scales to 50+ repos (selection cap 50→≤5 + bounded concurrency + per-graph timeout); selection is *intelligent* (label/domain-driven); latency is gated, not aspirational; single-query fan-out minimizes round-trips.
- **Negative**: a new component (ChatQnA-side router); selection adds latency (budgeted <20ms); the domain-binding step depends on clean repo metadata (Story 2.9.2 first-class fields).
- **Mitigations**: the ≤20ms CI gate; the seed-fixture benchmark (Story 8.1); v2 centroid path is open if BM25 under-selects.

## References

PRD §4.4 (FR-24, FR-35), NFR-PR1; [okf-course-correction-2026-08-13 §2.4, §2.5, §3 D8–D10/D14](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [Sprint Change Proposal 2026-08-13 §5.2](../../_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-13.md); [ADR-okf-012](okf-012-multi-graph-grounding.md); [ADR-okf-013](okf-013-graph-name-wiring.md); [ADR-okf-025](okf-025-authz-resolver.md); [ADR-okf-027](okf-027-cross-graph-rrf.md).
