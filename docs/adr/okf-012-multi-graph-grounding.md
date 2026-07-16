# ADR okf-012: Multi-graph grounding via retriever extension (CORE)

- **Status**: Accepted
- **Date**: 2026-07-16
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
- **Mitigations**: query only authorized graphs; parallelize per-graph; BM25 views are lazy/cached; tune RRF weights empirically.

## References
Production spec §3.2, §8.4; ADR-okf-002 (revised), okf-013.
