# ADR okf-013: Thread `graph_name` end-to-end + fix latent bugs

- **Status**: Accepted
- **Date**: 2026-07-16
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
- **Mitigations**: integration tests covering per-repo ingest/retract + multi-graph retrieval.

## References
Production spec §8.2–8.5; ADR-okf-012, okf-014.
