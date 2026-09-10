# ADR okf-001: OKF Server is a Genie application component (components/okf-server/), not an OPEA service

- **Status**: Accepted
- **Date**: 2026-07-15
- **Decision owners**: Jerome Revillard (architect), Genie.ai Dev

## Context

The OKF Server needs a home in the repo and a technology choice. Genie's repository has two service tiers: `components/` (application-layer services — `gov-chat-backend`, `gov-chat-frontend`, `document-repository`, all Node.js/Express/CommonJS, importing `components/shared/lib/`) and `genie-ai-overlay/` (Genie's **overlay built on OPEA** — Python/FastAPI AI services: ChatQnA, retriever, dataprep, reranker). The OKF Server must ingest bundles (call dataprep), serve agents, and integrate with Kong/Keycloak/ArangoDB. An earlier framing proposed a Python/FastAPI service in `genie-ai-overlay/okf/`; the user corrected this.

### Constraints

- OKF is **not part of the OPEA project**; Genie's backend is an overlay *on* OPEA. The OKF Server must remain a Genie application component.
- Must reuse `components/shared/lib/` and mirror the `createApp({services})` + per-route auth pattern of `gov-chat-backend`.
- Must call the OPEA-overlay services (dataprep, retriever) over HTTP as dependencies.
- DPG permissive licensing; minimize vendors; CPU-only.

## Decision

The OKF Server is an **independent top-level Node.js/Express component at `components/okf-server/`** (CommonJS, imports `components/shared/lib/`), at the same level as `gov-chat-backend` and `document-repository`. It **consumes** the OPEA-overlay services (dataprep for indexing, retriever for search) as HTTP dependencies. It is **not** an OPEA/overlay service and does not live in `genie-ai-overlay/`.

## Alternatives considered

| Alternative | Status |
|---|---|
| Python/FastAPI service in `genie-ai-overlay/okf/` (OPEA-tier) | **Rejected** — would make OKF part of the OPEA overlay; user explicitly requires OKF to be a separate Genie application component. |
| Extend `gov-chat-backend` with OKF routes | Rejected — couples knowledge-serving to the chat BFF; OKF deserves its own lifecycle/scale/auth surface. |
| Standalone repo / external package | Rejected — adds a vendor boundary and release coupling; keep it in-repo at `components/okf-server/`. |

## Consequences

- **Positive**: clean separation; OKF owns its lifecycle, scale, and authz; reuses Genie Node conventions + `shared/lib`; dataprep/retriever stay reusable OPEA-overlay dependencies.
- **Negative**: cross-language boundary (Node OKF Server ↔ Python dataprep/retriever) over HTTP — adds a network hop on ingest/search.
- **Mitigations**: internal services on `genieai_network` (low-latency); retriever already HTTP-callable; the hop is consistent with how `document-repository` already calls dataprep.

## References

- PRD §9 Constraints, §10 Integration; decision log ADR-1.
