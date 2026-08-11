# ADR okf-018: OKF control-plane metadata in ArangoDB (same database as the graphs)

- **Status**: Accepted
- **Date**: 2026-08-11
- **Decision owners**: Genie.ai Dev

## Context
Where to store the OKF "bundle definitions" — the control/metadata plane (`okf_repositories`, `okf_concepts_meta`, `okf_audit`, `okf_sources`) — given options: ArangoDB collections, a document in the document-repository, files on S3/PV, a separate ArangoDB database, or Postgres.

## Decision
Store the OKF control-plane metadata in **ArangoDB collections, in the same database** as the free-form `GRAPH` corpus and the per-repo `OKF_{repo_id}` graphs (the collections already defined in Architecture §4). No separate database, no new store.

## Why not the alternatives
- **Separate ArangoDB database / separate store** — rejected. AQL and transactions are scoped to one database; the hybrid multi-graph retrieval (FR-24) fans out across `GRAPH` + all `OKF_*` graphs and RRF-fuses in a single pass, which requires one database. A separate database breaks single-engine fusion for no benefit (a second database in the same deployment still shares the same DB-Servers).
- **Document-repository / files (S3/PV)** — rejected. A blob/file store has no query layer for the registry's transactional CRUD, filtered listing, and append-only audit; PV also breaks the stateless-horizontal K8s design (NFR-R1).
- **Postgres control plane** — a valid relational alternative, but unnecessary here: it adds a second engine and cross-engine fan-out for no gain at GENIE's scale.

## Consequences
- Isolation is by collection/graph-name prefix + `chunk_labels` ACL, as already designed.
- Schema/integrity enforced at the app layer (Arango does not enforce constraints).
- Any future contention (heavy audit/FOI-export vs retrieval) is handled by scaling the cluster on K8s — not by a structural split.

## References
PRD FR-3, FR-11, FR-18, FR-19, FR-23; Architecture §2, §4; ADR-okf-002, ADR-okf-008, ADR-okf-014.
