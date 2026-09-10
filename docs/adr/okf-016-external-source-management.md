# ADR okf-016: External source management & source-of-truth boundaries

- **Status**: Accepted
- **Date**: 2026-07-16
- **Decision owners**: Genie.ai Dev

## Context

OKF repositories are synced from **external, user-owned** Git repositories or S3-compatible buckets (any host/provider) — these are **not** the Genie framework code repo. Genie has **little or no control** over these origins: the owner can delete, move, rename, or make them inaccessible at any time.

At the same time:
- Significant application features (chat citations, admin UI, agent responses) depend on **stable links** to let users view source documents in the browser.
- Internal components must **not break** if an external origin disappears.
- Sovereignty requires **no runtime egress** to external origins.

## Decision — three-tier source-of-truth model

1. **External origin (Git/S3) = sync source only.** Consulted only at sync (PRD FR-2); never at query/serve time. User-owned; per-source credentials + ref (branch/tag/commit). Distinct from the framework code repo.
2. **Document-repository = single source of truth after upload/ingest.** Retains the ingested bundle **(versioned)**; all internal Genie components (dataprep, retriever, OKF Server, frontend) reference it at runtime — they do **not** reach back to the origin.
3. **ArangoDB = indexed view** (chunks/embeddings/edges + metadata), derived from the document-repository copy, tied to a version.

**External-origin management:**
- Periodic **reachability/reference checks**; detect deletion/inaccessibility.
- On origin disappearance: **alert the steward**; **continue serving from the retained document-repository copy**; mark origin health degraded. No silent breakage; no query-time dependency on the origin.
- **Versioning is consolidated on the document-repository** (each publish = a versioned snapshot); OKF metadata references the doc-repo version, so versions **survive origin deletion**.
- **Stable document-repository references** (IDs/URLs) back all "view source" links (UI/chat/agents) — never the external origin URL.

## Alternatives considered

| Alternative | Status |
|---|---|
| Internal components read from the external origin at runtime | **Rejected** — origin not controlled; breaks on deletion; violates sovereignty (egress). |
| Re-pull from origin on every serve | **Rejected** — latency, availability, sovereignty; origin may be gone. |
| Trust the origin as source of truth, no retained copy | **Rejected** — user can delete it; citations/links would break. |
| Three-tier model: origin=sync, doc-repo=runtime source of truth, ArangoDB=indexed view (chosen) | **Selected** — origin-independent, retained copy, stable internal links, sovereign. |

## Consequences

- **Positive**: origin can disappear without breaking serving; stable internal "view source" links; sovereignty preserved (no runtime egress); versions survive origin deletion.
- **Negative**: storage cost for retained versioned copies in the document-repository (managed via retention/TTL — PRD FR-12); potential drift between origin and retained copy between syncs.
- **Mitigations**: stewards choose sync cadence per repository; health checks surface drift/deletion; retention/TTL bounds storage growth.

## References

- PRD FR-2 (sync + origin checks), FR-22 (bundle via document-repository), FR-27 (doc-repo as source of truth), FR-28 (stable references/view-source); [ADR-okf-008](okf-008-bundle-content-store.md); Architecture §6.
