# ADR okf-007: Steward surface via REST; defer rich admin UI to SST Epic 4

- **Status**: Proposed
- **Date**: 2026-07-15
- **Decision owners**: Genie.ai Dev (architect)

## Context

Curation (review/approve, lifecycle, ACL, retention, conformance/PII reports) needs a steward surface. The SST initiative's Epic 4 plans a Vue 3 admin (Document Management tab) with list-and-grant RBAC. Building a separate OKF admin UI duplicates effort.

### Constraints

- Minimize scope/vendors; reuse planned SST admin surfaces where possible.
- Steward actions must be available in the MVP.

## Decision

Ship a **thin steward surface via the REST API** in the MVP (`/api/okf/admin/*`, `tools-admin` role): register/validate/approve/retire bundles, set ACLs/retention, view conformance/PII/quality metrics, export audit. **Defer a rich UI** — when SST Epic 4's admin lands, OKF registers its steward views there (a tab/section), consuming the OKF admin REST. No standalone OKF UI is built in v1.

## Alternatives considered

| Alternative | Status |
|---|---|
| Build a standalone OKF Vue admin now | Rejected — duplicates SST Epic 4; scope/vendor creep. |
| No steward surface (config-only) | Rejected — curation lifecycle (review/approve) needs interactive ops. |

## Consequences

- **Positive**: MVP curation works via REST; no duplicate UI; aligns with SST roadmap.
- **Negative**: stewards use API/CLI until SST Epic 4 UI lands.
- **Mitigations**: ship a minimal CLI/OpenAPI-driven interaction; document steward workflows.

## References

- PRD §6.2, Open Question 7; SST Epic 4 (planned); Architecture §16 (authoring & curation tooling lanes — incl. the author-side local conformance validator/linter CLI).
