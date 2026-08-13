# ADR okf-013: Thread `graph_name` end-to-end + fix latent bugs

- **Status**: Accepted (revised 2026-08-13 — OKF course correction)
- **Date**: 2026-07-16 (revised 2026-08-13)
- **Decision owners**: Jerome Revillard, Genie.ai Dev

## Context
The `graph_name` plumbing exists per-request (`ArangoDBDataprepRequestFromDocRepo.graph_name`, `RetrievalRequestArangoDB.graph_name`, retriever `input_dict.get("graph_name", …)`), but **nothing populates it**: document-repository sends no `graph_name` to dataprep (`fileController._ingestFileById` payload is `{fileId,fileName,fileType,fileLabels,storagePath,fileBase64}`); ChatQnA sends none to the retriever. Two latent bugs: dataprep **retract** default mismatch (`"genie_graph"` vs `"GRAPH"`, `genieai_dataprep_microservice.py:292`) and the stale env hint `RETRIEVER_ARANGO_GRAPH_NAME` (`env:164`) that no code reads.

## Decision
Thread `graph_name` end-to-end for OKF:
- The document-repository **ingest-bundle route** passes `graph_name=OKF_{repo_id}` (on both ingest and retract).
- **dataprep** reads `graph_name` from the **request** (not only the env) on both ingest and retract.
- **ChatQnA** forwards the authorized graph set to the retriever (okf-012).
- **Fix** the retract default to resolve from request/env consistently; **correct** the stale env hint to `ARANGO_GRAPH_NAME`.

## Alternatives considered
| Alternative | Status |
|---|---|
| Keep per-deployment single graph | Rejected — cannot support multiple repositories/domains. |

## Consequences
- **Positive**: per-repository isolation enabled; two latent bugs fixed.
- **Negative**: pervasive small wiring change across document-repository / dataprep / ChatQnA.
- **Mitigations**: integration tests covering per-repo ingest/retract + multi-graph retrieval *(2026-08-13: the deterministic fixture suite — Story 8.1/8.2).*

## Revision (2026-08-13) — OKF course correction

The 2026-08-13 architecture review (gaps G2, G5, G12, G14) found the wiring decision correct but **underspecified on three points** that determine whether multi-graph fan-out works *in production*. The original decision is unchanged; the following *elaborate* it:

1. **Parallel fan-out concurrency is bounded** (G14). Fan-out uses `asyncio.gather` + `Semaphore(MAX_FANOUT_GRAPHS)` (default 5, configurable) so simultaneous ArangoDB load is bounded regardless of selection size — see Story 1.4.

2. **Per-graph timeout + skip** (G14). Each graph gets a timeout; a cold/small/sick repo is **skipped** (logged, contributes zero hits, fuses survivors) — it cannot stall the query. Partial failure is the expected behavior, not an error.

3. **Error policy: an errored repo contributes zero hits, NOT a 500** (G14). One repo's failure never fails the whole query. Unauthorized repos also contribute zero hits (G3/G15 — closed by [ADR-okf-025](okf-025-authz-resolver.md)).

4. **ACL filter on ALL `search_start` modes** (G12). The `chunk_labels` ACL filter must apply on `search_start ∈ {chunk, node, edge}` — today it is bypassed for entity/edge paths, a latent cross-tenant leak amplified by fan-out.

5. **`graph_name` retract must target the correct graph** (G5). Retract reads `graph_name` from the request (resolved `OKF_{repo_id}`) and drops the 4 `OKF_{repo_id}_*` collections — it must NOT fall back to the free-form `GRAPH` (the wrong-graph retract defect). See Story 2.9.6.

## References
Production spec §8.2–8.5; [ADR-okf-012](okf-012-multi-graph-grounding.md), [okf-014](okf-014-repository-model.md); *(2026-08-13)* [ADR-okf-021](okf-021-write-side-orchestration.md), [ADR-okf-023](okf-023-graph-names-transport.md), [ADR-okf-025](okf-025-authz-resolver.md).
