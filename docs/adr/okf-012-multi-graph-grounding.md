# ADR okf-012: Multi-graph grounding via retriever extension (CORE)

- **Status**: Accepted (revised 2026-08-13 — OKF course correction)
- **Date**: 2026-07-16 (revised 2026-08-13)
- **Decision owners**: Jerome Revillard, Genie.ai Dev

## Context
The framework must ground RAG responses in **all available data**: the existing free-form `GRAPH` corpus **and** every authorized OKF repository graph. Today `graph_name` is a single global (`GRAPH`); ChatQnA never forwards one and document-repository never sends one, so a chat query sees only the free-form corpus.

## Decision
**Extend the existing retriever** (`invoke()`) to accept `graph_names: list[str]` (the caller's authorized set) in addition to a single `graph_name`. For each graph it runs the existing hybrid path (dense COSINE + BM25 view + optional traversal), then **RRF-fuses** the per-graph ranked lists (reuse `rrf_fuse`) with `chunk_labels` ACL applied per graph. ChatQnA forwards the authorized graph set (`GRAPH` + the caller's `OKF_*`) so one chat query grounds across all graphs. The OKF serving surface calls the same multi-graph retriever (scoped to OKF repos).

## Alternatives considered
| Alternative | Status |
|---|---|
| New unified-retrieval aggregator service | Rejected — extra service; the retriever is already graph-parameterized. |
| Merge free-form + OKF into one graph | Rejected — mixes edge semantics, ACL, lifecycle, and curation models. |

## Consequences
- **Positive**: unified grounding; reuses the retriever; one engine, two entry points (chat + agent).
- **Negative**: fan-out cost scales with the number of graphs.
- **Mitigations**: query only authorized graphs; parallelize per-graph; BM25 views are lazy/cached; ~~tune RRF weights empirically~~ *(resolved 2026-08-13: 2-level RRF with per-graph size normalization — [ADR-okf-027](okf-027-cross-graph-rrf.md); tuned via the parameter-sweep harness — Story 8.4).*

## Revision (2026-08-13) — OKF course correction

The 2026-08-13 architecture review (gap G6) found this ADR correct in mechanism but **missing two load-bearing qualifiers** that prevent it from scaling past a handful of repos. The original decision is unchanged; the following *elaborate* it:

1. **Selection precedes fan-out.** "Query only authorized graphs" is insufficient — at 50 repos that is unbounded fan-out (~300+ round-trips). An explicit **Graph Router** ([ADR-okf-024](okf-024-graph-selection-router.md)) selects the **relevant** subset of authorized graphs (domain binding + repo-metadata BM25), capped at `MAX_FANOUT_GRAPHS` (default 5), before the retriever fans out. Authorization (ADR-okf-025) and selection are distinct steps.

2. **Transport is boundary-proven, not assumed.** `graph_names` must survive the ChatQnA→retriever mega-service boundary — proven by the deployed boundary probe (Story 1.0b), not assumed. Carrier preference + the OPEA-1.5 gating are recorded in [ADR-okf-023](okf-023-graph-names-transport.md).

3. **Fan-out is parallel, bounded, and partial-failure-tolerant** — see the [ADR-okf-013 revision](okf-013-graph-name-wiring.md).

## References
Production spec §3.2, §8.4; ADR-okf-002 (revised), [okf-013](okf-013-graph-name-wiring.md); *(2026-08-13)* [ADR-okf-023](okf-023-graph-names-transport.md), [ADR-okf-024](okf-024-graph-selection-router.md), [ADR-okf-025](okf-025-authz-resolver.md), [ADR-okf-027](okf-027-cross-graph-rrf.md).
