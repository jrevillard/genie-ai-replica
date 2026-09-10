# ADR okf-002: Multi-tenancy via a shared OKF graph + tenant/bundle ACL filters

- **Status**: Revised 2026-07-16 — superseded by okf-014 (one graph per repository) + okf-012 (multi-graph grounding). The "shared OKF graph" below is retained as historical context; the production design uses **one graph per repository (`OKF_{repo_id}`)** with ACL via `chunk_labels`.
- **Date**: 2026-07-15 (revised 2026-07-16)
- **Decision owners**: Jerome Revillard (architect), Genie.ai Dev

## Context

A Genie deployment may serve multiple agencies/tenants (e.g., ministries) and many bundles. The OKF index must isolate tenants and enforce per-bundle access. dataprep/retriever are parameterized on `graph_name`, so the index could be one shared `OKF` graph or N per-tenant graphs.

### Constraints

- Minimize vendors/infra; reuse the retriever unchanged (it reads `graph_name` from the request).
- Government tenants need reliable isolation; cross-tenant leakage is unacceptable.
- ArangoDB is the only store; no Neo4j.

## Decision

Use a **single shared OKF graph** (`graph_name="OKF"`). Every chunk/entity/edge carries `tenant_id` + `bundle_id` tags. Retrieval and serving are **filtered by the caller's token claims** (tenant + authorized bundle scopes). ACLs are evaluated in the OKF Server (`governance/`) and enforced as AQL/arangosearch filters so unauthorized data is never returned.

## Alternatives considered

| Alternative | Status |
|---|---|
| `graph_name` per tenant (`OKF_<tenant>`) | Rejected — N graphs, duplicate retrieval wiring, heavier ops, more to manage; weaker fit for "minimize vendors/infra". |
| Separate ArangoDB database per tenant | Rejected — ops-heavy; breaks the single-store/minimal-vendor principle. |

## Consequences

- **Positive**: one index, one retrieval path, ArangoDB-native filtering, minimal infra.
- **Negative**: isolation is logical (ACL filters), not physical — a missed filter would leak; must be enforced consistently on every query path.
- **Mitigations**: central ACL filter helper used by all serving/retrieval code; tests for cross-tenant isolation; defense-in-depth (Kong scope checks + OKF Server checks).

## References

- Architecture §5 Data Model, §8 Security; PRD FR-18; decision log ADR-2.
