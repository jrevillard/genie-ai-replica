---
title: Architecture — GENIE.AI OKF Server
status: draft
created: 2026-07-15
updated: 2026-07-15
initiative: okf-server
branch: feat/okf-server
prd: ../prds/prd-okf-server-2026-07-15/prd.md
brief: ../briefs/brief-okf-server-2026-07-15/brief.md
decision_log: ../briefs/brief-okf-server-2026-07-15/.decision-log.md
authors: Genie.ai Dev
---

# Architecture: GENIE.AI OKF Server

> **Framing (non-negotiable).** The OKF Server is a **GENIE application component** (`components/okf-server/`, Node.js/Express). It is **not part of OPEA**. Genie's backend is an *overlay built on OPEA* (`genie-ai-overlay/` = ChatQnA, retriever, dataprep, reranker). The OKF Server **consumes** those OPEA-overlay services (dataprep for indexing, retriever for search) as dependencies over HTTP. (ADR-okf-001.)

## 1. Overview

The OKF Server hosts multiple OKF knowledge bundles (from Git/S3), indexes them through the existing dataprep pipeline into a dedicated ArangoDB graph (`graph_name="OKF"`), and serves them to AI agents over a read-only REST API (MCP-ready). It is **complementary** to dataprep/RAG and consumes the planned Server-Side Tools (SST) foundation for the future MCP surface. It is engineered for enterprise/government use: sovereign, air-gappable, multi-tenant, privacy-protecting, fully auditable.

## 2. Context & Component Diagram

```
                         ┌───────────────────────────┐
                         │        AI Agents           │
                         │ (Genie LangGraph / MCP /   │
                         │  external clients)         │
                         └─────────────┬─────────────┘
                                       │ REST (MVP) / MCP (post-Sprint 24)
                                       ▼
   ┌──────────────┐   HTTPS   ┌──────────────────┐        ┌────────────────────┐
   │   Keycloak    │◄─────────│   NGINX → Kong    │───────►│  components/        │
   │ (OIDC AS,     │  JWKS    │  (terminates OIDC,│        │  okf-server         │
   │  per-bundle   │          │   rate-limit, MCP  │        │  (Node.js/Express,  │
   │  scopes)      │          │   plugins)         │        │   CommonJS)         │
   └──────────────┘          └────────┬───────────┘        │                     │
                                       │ /api/okf           │  • source-sync      │
                                       ▼                     │  • bundle-manager   │
                              routes to OKF Server          │  • curation/gov     │
                                                             │  • serving (REST,   │
                                                             │     MCP-ready)      │
                                                             │  • authz (jose)     │
                                                             └───┬─────────────┬───┘
                                                  ingest(handoff) │             │ read/write OKF graph
                                       ┌──────────────────────────┘             ▼
                                       ▼                                        ┌──────────────────┐
                          ┌────────────────────────┐                             │    ArangoDB      │
                          │ components/document-    │  stores bundle bytes +      │  (single store)  │
                          │ repository (extended)   │  ClamAV scan + dataprep     │  OKF_SOURCE      │
                          │  NEW /ingest-bundle     │  handoff                    │  OKF_ENTITY      │
                          └─────────────┬──────────┘                             │  OKF_HAS_SOURCE  │
                                        │ base64/HTTP                              │  OKF_LINKS_TO    │
                                        ▼                                          │  (+ACL tags)     │
                          ┌────────────────────────┐    embed (TEI)   ┌────────┐ │  okf_bundles     │
                          │ genie-ai-overlay/       │◄───────────────►│  TEI   │ │  okf_concepts    │
                          │  dataprep (Python,      │                  └────────┘ │  okf_audit       │
                          │  OPEA overlay)          │                             └──────────────────┘
                          │  + retriever (hybrid    │◄──── search (graph_name=OKF)      ▲
                          │  vector+BM25+RRF+graph) │                                    │ OTel spans
                          └─────────────────────────┘             ┌───────────────────┘
                                                                 │
                          ┌────────────────────────┐             │
                          │  Redis Streams + DLQ    │◄────────────┘  OTel Collector → Victoria* → Grafana
                          │  (ingest resilience)    │             (metrics/logs/traces, FOI audit)
                          └─────────────────────────┘
```

**Key relationships:** OKF Server → document-repository (bundle bytes + scan + dataprep handoff); OKF Server → dataprep (index concept bodies, `graph_name=OKF`); OKF Server → retriever (search, `graph_name=OKF`) OR direct ArangoDB AQL for graph traversal/get; OKF Server → ArangoDB (OKF graph + bundle/concept metadata + ACL + audit); Kong → Keycloak (OIDC); all → OTel collector.

## 3. Architecture Principles

1. **Complement, don't compete** — extend dataprep/RAG; reuse the retriever; never duplicate storage/embed/retrieval. (PRD §5.)
2. **Single store, minimal vendors** — ArangoDB only (document+graph+vector+BM25). No Neo4j, no separate vector DB, no Elasticsearch. (ADR-okf-001 constraints.)
3. **Sovereign by design** — air-gappable, no third-party egress, data residency, FOI-exportable audit.
4. **Layered, additive** — OKF logic in `components/okf-server/`; dataprep extended only additively (no breaking chunk-schema changes).
5. **Progressive disclosure** — agents navigate one level at a time (OKF `index.md` philosophy); token-budgeted serving.

## 4. Component Design — `components/okf-server/`

Node.js/Express, CommonJS, `createApp({services})` factory pattern (mirrors gov-chat-backend). Imports `components/shared/lib/` (logger). Internal modules:

| Module | Responsibility |
|---|---|
| `source-sync/` | Git (native `git` diff) + S3 (`rclone`/`boto3`) pollers/webhooks; change detection; provenance (commit SHA / S3 version); writes to an ingest queue (Redis Streams). |
| `bundle-manager/` | Bundle registry, lifecycle state machine (register→validate→review→approve→publish→version→deprecate→retire), versioning, retention/TTL scheduling. |
| `okf-parser/` | Frontmatter (`gray-matter`) + Markdown structure (`markdown-it`) + **structural link extraction** (markdown links → concept-id edges). Produces structured concept docs. (ADR-okf-010.) |
| `curation/` | Review/approve workflow, conformance (§9) + PII + quality reports, steward actions. |
| `governance/` | Per-tenant/per-bundle RBAC evaluation, audit emission, PII redaction orchestration (Presidio). |
| `serving/` | REST API (search/get/list/outline) + MCP-ready handlers; progressive disclosure, token caps, cursor pagination. |
| `auth/` | Mirrors gov-chat-backend: `jose` JWKS validation via OIDC discovery; per-bundle scope enforcement (defense-in-depth behind Kong). |
| `observability/` | OTel spans (`tracing.withSpan`-equivalent in Node), Prometheus metrics, structured logging. |

**Routes** mount behind Kong at `/api/okf/*`; steward/admin routes require `tools-admin`/steward role.

## 5. Data Model (ArangoDB)

All under a single deployment; OKF knowledge indexed at `graph_name="OKF"` (dataprep convention). Multi-tenancy via ACL tags (ADR-okf-002).

| Collection | Type | Key fields |
|---|---|---|
| `OKF_SOURCE` | document (chunk) | `text`, `embedding`, `file_id`, `chunk_labels`, **+`tenant_id`**, **+`bundle_id`**, **+`concept_id`**, **+`bundle_version`**, `source_type:"okf"` |
| `OKF_ENTITY` | document (LLM entity) | (dataprep-managed) + `tenant_id`, `bundle_id` |
| `OKF_HAS_SOURCE` | edge | entity → chunk (dataprep) |
| `OKF_LINKS_TO` | edge | **concept → concept** (structural, from markdown links) + `tenant_id`, `bundle_id` |
| `okf_bundles` | document | `bundle_id`, `tenant_id`, `source_ref` (git URL+SHA / s3 uri+version), `version`, `lifecycle_state`, `okf_version`, `curator`, `timestamps`, `retention` |
| `okf_concepts` | document | `concept_id`, `bundle_id`, `tenant_id`, `frontmatter` (type/title/description/resource/tags/timestamp), `path`, `conformance_issues`, `pii_state` |
| `okf_acl` | document | `bundle_id`, `tenant_id`, `required_scopes`, `sensitivity` |
| `okf_audit` | document (append-only) | `actor`, `action`, `bundle_id`, `concept_id`, `version`, `ts`, `source_ip`, `trace_id` |

**Vector + search:** reuse the retriever's hybrid path (dense COSINE + ArangoSearch BM25 + RRF) over `OKF_SOURCE`; add an ArangoSearch BM25 view over OKF chunk text if not already present for the OKF graph. Graph traversal via AQL over `OKF_LINKS_TO` for neighbor/backlink fetches.

## 6. Key Sequence Flows

**6.1 Bundle ingest + index**
1. Steward registers Git/S3 source → `source-sync` validates reachability, records provenance.
2. On schedule/webhook, `source-sync` pulls + diffs → changed concepts enqueued (Redis Streams).
3. `okf-parser` extracts frontmatter + body + link edges per concept; `governance` runs §9 conformance + ClamAV (via document-repository) + PII redaction (Presidio). PII failure → withhold + flag.
4. Concept bodies handed to **dataprep** (`graph_name=OKF`) → TEI embed → store in `OKF_SOURCE` (+tenant/bundle/concept/version tags).
5. `bundle-manager` writes `okf_bundles`/`okf_concepts`; `OKF_LINKS_TO` edges written; lifecycle → `review`.
6. Steward reviews → approves → `published`.

**6.2 Agent query (search → get)**
1. Agent → Kong (validates Keycloak token, audience=okf-server) → OKF Server `/api/okf/search?q=…`.
2. `auth` confirms tenant/bundle scopes; `serving` calls retriever (`graph_name=OKF`, filtered by authorized `bundle_id`s) → ranked hits (token-capped, cursor-paginated).
3. Agent → `/api/okf/concepts/{bundle}/{concept}?version=…` → `serving` checks ACL → returns concept (or 403, ADR-okf-006) + optional neighbors via `OKF_LINKS_TO`.
4. OTel span emitted; audit record written.

**6.3 Curation lifecycle** — state transitions gated by role; each transition audited; only `published` served.

**6.4 Retraction** — bundle/version retire → OKF Server calls dataprep `retract_file` (cascade chunks→edges→orphans) + removes `okf_concepts`/`okf_bundles`; retention/TTL automates this; action audited.

## 7. API Surface (REST MVP; MCP-ready)

**REST** (prefix `/api/okf`, camelCase req / snake_case resp, ISO-8601, cursor pagination, token caps):
- `GET /bundles` — list accessible bundles (RBAC-filtered).
- `GET /bundles/{id}/outline` — progressive-disclosure landing (index/manifest).
- `GET /search?q=&bundle=&top_k=&tokens=&cursor=` — hybrid search → ranked concept hits.
- `GET /concepts/{bundle}/{concept}?version=&lang=` — concept doc (full/sliced, token-capped, `hasMore`).
- `GET /concepts/{bundle}/{concept}/neighbors?depth=` — structural link graph traversal.

**MCP-ready** (post-Sprint 24, TS SDK `@modelcontextprotocol/typescript-sdk`, MIT/Apache):
- **Resource Template** `okf://{bundle}/{concept}{?version,lang}` (stable addressability).
- **Tools**: `okf_search`, `okf_get_doc`, `okf_list_bundles`, `okf_outline` (same handlers as REST — one core, two transports).
- Transport: Streamable HTTP (single `/mcp`), fronted by Kong AI MCP Proxy + OAuth2 plugins.
- Progressive disclosure: 1 static resource (index/manifest) + search-then-fetch (à la Context7).

## 8. Security & Authorization

- **Authn**: Keycloak OIDC; Kong terminates (validates bearer, JWKS, audience bound to okf-server via RFC 8707; no token passthrough). OKF Server `auth/` does defense-in-depth `jose` validation + claim extraction.
- **Authz**: per-tenant + per-bundle scopes `okf:{tenant}:{bundle}:{read|admin}`; enforced on every serving call; `tools/list` (MCP) and `/bundles` (REST) dynamically filtered by principal. (ADR-okf-002.)
- **Privacy**: PII redaction on ingest (Presidio, document-level default; blocking on policy failure); data minimization; right-to-erasure cascade. (ADR-okf-004.)
- **Confidentiality**: TLS (NGINX/Kong) + at-rest encryption (ArangoDB/object-store).
- **Supply chain**: build→scan→promote per ADR-0001; CycloneDX SBOM (1 yr); signed images (phase 2); container scanning blocking MR gate; non-root CPU containers. (ADR-okf-009 constraints.)

## 9. Observability

- **Tracing**: OTel spans + W3C `traceparent` propagated OKF Server → retriever → LLM; PII filtered from span attributes (`tracing-pii` pattern).
- **Audit**: `okf_audit` append-only collection; FOI/GDPR export by date range/tenant/bundle.
- **Metrics/Logs**: Prometheus + VictoriaLogs + Grafana (existing stack); ingest throughput, query latency, error rate, bundle health, conformance/PII hit rates.

## 10. Deployment

- **Single root `docker-compose.yaml`** entry for `okf-server` (service `okf-server`, `genieai_network`, `genieai=true` placement, CPU-only, non-root, `/health`+`/ready`, fluentd log driver).
- **Kong**: add `okf-server` service + `/api/okf` route to `kong_config.json` (mirror document-repository); Kong AI MCP plugins for the future MCP endpoint.
- **Swarm/K8s**: stateless, horizontally scalable; replicas on `genieai=true` nodes; no GPU.
- **Ansible** `--tags` deploy; secrets from the deployment secret store (never in images).
- **CI**: GitLab build→scan→promote (ADR-0001); image `genie-ai/okf-server`.
- **Air-gap**: no outbound calls except declared source endpoints; local TEI/models; deployable fully offline.

## 11. NFR Mapping

| NFR | Mechanism |
|---|---|
| Privacy (P1–P3) | Presidio redaction on ingest (blocking); minimization; erasure cascade |
| Security (S1–S7) | Kong OIDC; per-bundle scopes; TLS+at-rest; SHA-256 idempotency; SBOM/sign/scan gate; CPU non-root; additive schema |
| Reliability (R1–R4) | Stateless; Redis Streams+DLQ; last-good index on re-index fail; replica HA |
| Traceability (T1–T3) | OTel+traceparent; FOI audit; existing MELT stack |
| Performance (PR1–PR2) | p95 search ≤300ms (target); 4–8k token cap, slicing (ADR-okf-009) |

## 12. ADR Register

| ADR | Decision | File |
|---|---|---|
| okf-001 | OKF Server = independent `components/okf-server/` (Node/Express), not OPEA; consumes OPEA-overlay | [docs/adr/okf-001-okf-server-component-and-stack.md](../../../docs/adr/okf-001-okf-server-component-and-stack.md) |
| okf-002 | Shared `OKF` graph + tenant/bundle ACL filters | [docs/adr/okf-002-shared-graph-multi-tenancy.md](../../../docs/adr/okf-002-shared-graph-multi-tenancy.md) |
| okf-003 | Standalone service behind Kong (Kong-terminated OIDC) | [docs/adr/okf-003-standalone-service-behind-kong.md](../../../docs/adr/okf-003-standalone-service-behind-kong.md) |
| okf-004 | PII redaction: Presidio at ingest, document-level default, blocking | [docs/adr/okf-004-pii-redaction-strategy.md](../../../docs/adr/okf-004-pii-redaction-strategy.md) |
| okf-005 | Versioning: immutable bundle versions + concept citation pin | [docs/adr/okf-005-versioning-semantics.md](../../../docs/adr/okf-005-versioning-semantics.md) |
| okf-006 | 403 for unauthorized, 404 for absent | [docs/adr/okf-006-403-vs-404-unauthorized.md](../../../docs/adr/okf-006-403-vs-404-unauthorized.md) |
| okf-007 | Thin steward surface via REST; defer rich UI to SST Epic 4 | [docs/adr/okf-007-admin-steward-ui.md](../../../docs/adr/okf-007-admin-steward-ui.md) |
| okf-008 | Bundle content via document-repository (storage+ClamAV+handoff) | [docs/adr/okf-008-bundle-content-store.md](../../../docs/adr/okf-008-bundle-content-store.md) |
| okf-009 | Performance/freshness targets + supply-chain CI | [docs/adr/okf-009-performance-and-supply-chain.md](../../../docs/adr/okf-009-performance-and-supply-chain.md) |
| okf-010 | OKF parsing in Node (`components/okf-server/`); header-aware chunking fast-follow | [docs/adr/okf-010-okf-markdown-loader-location.md](../../../docs/adr/okf-010-okf-markdown-loader-location.md) |

## 13. Phasing & Roadmap Alignment

- **MVP (this initiative)**: read-only REST; bundle Git/S3 sync; OKF parsing+index via dataprep (`graph_name=OKF`); curation lifecycle; per-bundle RBAC; OTel+audit; open-source packaging. No hard dependency on SST.
- **Post-MVP (gated)**: MCP surface (Sprint 24 `mcpo` + SST Registry); agent write/propose loop; typed ontology; gRPC; A2A.
- **Consumes SST**: Registry/ToolExecutor/Stream-Ingestor patterns (Redis Streams, DLQ, tool contract) when available; OKF Server aligns to them but ships REST-first independently.

## 14. Open Risks

- dataprep ingest path may need a small additive endpoint for OKF-tagged concepts (ADR-okf-010) — confirm with the dataprep maintainers.
- ArangoDB native vector index recall drift on incremental OKF growth — mitigate via ArangoSearch-view approx path (used by retriever today) or periodic retrain.
- MCP spec `2026-07-28` RC may shift the post-MVP surface — design MCP handlers against `2025-11-25`, track RC.
- Keycloak audience-mapper + RFC 8414 gaps — requires deploy-time config (document in ops guide).
