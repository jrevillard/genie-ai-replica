---
title: PRD — GENIE.AI OKF Server
status: draft
created: 2026-07-15
updated: 2026-07-15
prd_key: okf-server
initiative: okf-server
branch: feat/okf-server
decision_log: ../../briefs/brief-okf-server-2026-07-15/.decision-log.md
builds_on:
  - ../../briefs/brief-okf-server-2026-07-15/brief.md
  - ../../briefs/brief-okf-server-2026-07-15/addendum.md
depends_on:
  - server-side-tools (SST) initiative — consumes Registry / ToolExecutor / Stream-Ingestor / mcpo (gates the MCP surface only)
  - Sprint 24 #603 (LangGraph + MCP)
  - dataprep / retriever (exist on main — reused unchanged)
authors: Genie.ai Dev
---

# PRD: GENIE.AI OKF Server

## 0. Document Purpose

This PRD defines the **OKF Server** initiative for an audience of product management, Genie platform stakeholders, and downstream BMAD workflow owners (architecture, epics/stories, QA). It is built on — and does not duplicate — the [Product Brief](../../briefs/brief-okf-server-2026-07-15/brief.md) (vision/scope) and the [Research Addendum](../../briefs/brief-okf-server-2026-07-15/addendum.md) (verified integration map, reuse matrix, competitive/MCP/Keycloak/NFR research). All locked decisions live in the [decision log](../../briefs/brief-okf-server-2026-07-15/.decision-log.md). The PRD is Glossary-anchored; features are grouped with globally-numbered FRs; assumptions are tagged inline (`[ASSUMPTION: …]`) and indexed in §13.

## 1. Vision

Google's Open Knowledge Format (OKF v0.1, June 2026) made organizational knowledge portable for AI agents — but deliberately stopped at the *format*, leaving storage, serving, security, curation, and query to the ecosystem. Every existing OKF consumer is either a local stdio tool or locked to Google Cloud, and every open-source GraphRAG/agent-memory engine ships without multi-tenancy, RBAC, audit, privacy controls, or data residency. Government and public-service deployments — Genie's core mission — have no sovereign way to host curated knowledge bundles and serve them to agents with the trust model they require.

The **GENIE.AI OKF Server** is the open-source, enterprise- and government-grade service that fills this gap. It hosts multiple OKF knowledge bundles from Git and S3, indexes them through Genie's **existing dataprep/RAG pipeline** into ArangoDB, and serves them to AI agents over a read-only REST API today (MCP-ready for Sprint 24's agentic workflows). It is **complementary** to dataprep/RAG and the planned Server-Side Tools foundation — it consumes them, never competes with them — and is engineered from the first commit for **sovereignty, privacy, security, data curation, and accountability**. It becomes the canonical open-source reference implementation of a governed OKF consumer/serving layer.

## 2. Target User

### 2.1 Jobs To Be Done

- **(Agent)** "Find and cite the right authoritative knowledge for this task — without dumping the whole corpus into context, and with a version I can pin to my answer."
- **(Platform/data engineer)** "Add a knowledge bundle from our Git repo or S3 bucket and have it validated, indexed, and queryable — without writing new pipeline code or standing up new infrastructure."
- **(Knowledge steward / DPO)** "Control precisely who can see which bundle, prove compliance on demand (FOI/GDPR), and manage the knowledge lifecycle — review, version, retire — like code."
- **(Public-sector program owner)** "Run a sovereign, air-gappable knowledge service for our ministry's AI agents, with no data leaving our boundary."

### 2.2 Non-Users (v1)

- Producers authoring OKF bundles from scratch (use Google's enrichment agent or community producers — OKF Server is a *consumer/host*, not an authoring tool).
- Agents that need to *write* or *propose edits* to bundles (v1 is read-only; curation write-loop is out of scope).
- Users needing a formal typed ontology / semantic reasoning engine (v1 is spec-pure + optional taxonomy).

### 2.3 Key User Journeys

- **UJ-1. Amara adds a ministry policy bundle and it's live for agents without code.**
  - **Persona + context:** Amara, platform engineer at a national digital-services agency, maintains curated policy/concept knowledge in a private Git repo.
  - **Entry state:** authenticated admin on the Genie deployment.
  - **Path:** (1) declares the Git source in OKF Server config (URL, branch, credentials); (2) triggers sync; (3) OKF Server pulls the bundle, runs §9 conformance validation + ClamAV + PII redaction, hands concepts to dataprep which indexes them into the `OKF` ArangoDB graph; (4) the bundle appears `published` and queryable.
  - **Climax:** an agent searches and returns a result sourced from the new bundle, with a citation and version pin — no pipeline code written.
  - **Resolution:** bundle is registered, versioned, access-controlled; Amara sees ingest health + conformance metrics.

- **UJ-2. A Genie agent grounds an answer with a citable, access-checked concept.**
  - **Persona + context:** a Genie LangGraph agent (Sprint 24) or external MCP client answering a user question.
  - **Entry state:** presents a valid Keycloak bearer token scoped to its tenant/bundles.
  - **Path:** (1) calls `okf_search` (or the future MCP tool) with the query; (2) receives ranked concept hits (IDs + snippets, token-capped); (3) calls `okf_get_doc` for the most relevant concept; (4) the server enforces per-bundle RBAC and returns the concept (or 403).
  - **Climax:** the agent cites the concept with its bundle, version, and concept ID — and can fetch neighbors via the structural link graph.
  - **Resolution:** answer is grounded, citable, access-respecting; the call is traced end-to-end (OTel) and audited.

- **UJ-3. Sofia restricts a sensitive bundle and exports an audit for an FOI request.**
  - **Persona + context:** Sofia, data-protection officer, must respond to a freedom-of-information request.
  - **Entry state:** authenticated steward/admin.
  - **Path:** (1) sets a bundle to restricted (per-bundle/per-tenant RBAC); (2) confirms only authorized roles retain access; (3) exports the FOI-compliant audit trail (who queried what, when, from where) for a date range.
  - **Climax:** she delivers a complete, tamper-evident access log and proves the restricted bundle is now inaccessible to unauthorized callers.
  - **Resolution:** compliance demonstrated; retention/TTL policy applied.

## 3. Glossary

- **OKF** — Open Knowledge Format v0.1 (Google, June 2026); a directory of Markdown files with YAML frontmatter.
- **Bundle** — a self-contained OKF knowledge corpus (directory tree); the unit of hosting/distribution in OKF Server. Sourced from Git or S3.
- **Concept** — one `.md` document in a bundle. **Concept ID** = file path with `.md` removed.
- **Frontmatter** — YAML metadata block at the top of a concept; only `type` is required by OKF.
- **Index file / Log file** — OKF reserved files (`index.md`, `log.md`) for progressive disclosure and change history.
- **OKF Server** — the new Genie service this PRD specifies: an independent component at `components/okf-server/` (Node.js/Express, CommonJS, imports `components/shared/lib/`), behind Kong, that calls the Python dataprep/retriever for indexing/retrieval; manages bundles, curation, governance, and serving. (Location/stack per ADR-1.)
- **OKF graph** — the ArangoDB graph/collections holding OKF-indexed knowledge under `graph_name="OKF"` (`OKF_SOURCE`, `OKF_ENTITY`, `OKF_HAS_SOURCE`, `OKF_LINKS_TO`).
- **Structural link graph** — concept-to-concept edges derived from Markdown cross-links (distinct from dataprep's LLM-extracted entity graph), stored in `OKF_LINKS_TO`.
- **dataprep / retriever** — existing Genie OPEA services that chunk/embed/store and hybrid-retrieve knowledge; reused unchanged.
- **Tenant** — an isolated administrative/agency scope (e.g., a ministry) on a shared deployment.
- **Bundle lifecycle** — register → validate → review → approve → publish → version → deprecate → retire (see §4.3).
- **SST** — the Server-Side Tools initiative (planned, unimplemented); the foundation OKF Server consumes (Registry, ToolExecutor, Stream-Ingestor, mcpo).

## 4. Features

### 4.1 Bundle Source Management

**Description:** Operators declare OKF bundle sources in configuration — Git repositories or S3-compatible buckets — and the OKF Server syncs, version-tracks, and change-detects them, feeding the ingestion pipeline. Realizes UJ-1. Sources carry credentials (from the deployment secret store), provenance, and health status. No new storage vendor is introduced: raw bundle content is persisted via the document-repository; the source of truth remains the Git/S3 origin.

**Functional Requirements:**

#### FR-1: Register a bundle source
An authenticated steward can register a Git or S3 bundle source via configuration (type, endpoint, ref/path, credentials ref, sync schedule, tenant, display name) and have it validated as reachable. Realizes UJ-1.
**Consequences (testable):**
- Registering an unreachable/inaccessible source yields a structured error with the failing check; nothing is indexed.
- Credentials are never persisted in plaintext in config or logs (referenced from the secret store).

#### FR-2: Sync and change-detect
The system syncs registered sources on schedule or webhook and detects changes (Git: commit-diff `OLD..NEW --name-only`; S3: ETag/LastModified; content SHA-256 idempotency key) without full re-ingest of unchanged concepts. Realizes UJ-1.
**Consequences:**
- A source updated with one new concept re-indexes only that concept within the freshness target (NFR-S4).
- Re-syncing an unchanged source performs no re-embedding (SHA-256 match).
- A failed sync is retried with backoff and surfaced as degraded health, not a silent failure.

#### FR-3: Version tracking & provenance
Each indexed bundle version records its source ref (commit SHA / S3 version), fetch timestamp, curator, and a stable bundle-version identifier. Realizes UJ-2, UJ-3.
**Consequences:**
- A concept served to an agent carries its bundle + version + concept ID for citation.
- An operator can list versions of a bundle and pin/diff them.

**Feature-specific NFRs:** no outbound calls beyond the declared source endpoint (sovereignty); CPU-only, no GPU (NFR-S6).

**Notes:** `[ASSUMPTION: source sync runs as an async worker on Redis Streams (SST Decision 2 pattern) with a DLQ, not inline.]` `[ASSUMPTION: webhooks are optional in MVP; scheduled poll is the baseline.]`

### 4.2 Bundle Ingestion & Indexing

**Description:** Ingested bundles are validated against OKF §9 conformance, virus-scanned (ClamAV), PII-redacted, parsed into concepts (frontmatter → metadata; Markdown-header chunking; structural link edges), and handed to **dataprep**, which embeds (TEI) and stores them in the ArangoDB `OKF` graph — reusing the existing pipeline unchanged. Retraction cascades on removal. This is the dataprep-complementary core: OKF Server adds the OKF-aware loader; dataprep/embed/store/retrieve are reused. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-4: Conformance validation (OKF §9)
On ingest, every bundle is checked for OKF §9 conformance (parseable frontmatter; non-empty `type`; reserved-file structure). Non-conformance is a **quality gate**, not a hard rejection — the bundle is ingested best-effort and issues are surfaced to stewards. Realizes UJ-1.
**Consequences:**
- A bundle with a missing-`type` concept is still ingested; the concept is flagged in the conformance report.
- Conformance results are queryable per bundle/version (feature §4.3).

#### FR-5: Safe ingest (scan + PII redaction)
Bundle content is virus-scanned (ClamAV) and PII-redacted on ingest; **PII-redaction failure is blocking** (the concept/bundle is not published). Realizes UJ-3; enforces NFR-P1, NFR-P2.
**Consequences:**
- A bundle containing malware is rejected/quarantined and logged; nothing is indexed.
- A concept whose body fails PII policy is withheld from `published` state and flagged for steward review.

#### FR-6: OKF-aware parsing & indexing
Concepts are parsed (frontmatter → metadata; `MarkdownHeaderTextSplitter` chunking preserving header context) and indexed into the `OKF` ArangoDB graph via dataprep, reusing TEI embeddings and the `{graph}_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO` schema. Realizes UJ-1, UJ-2.
**Consequences:**
- Frontmatter fields (`type`, `title`, `description`, `resource`, `tags`, `timestamp`) become queryable/filterable metadata.
- Concepts are retrievable through the existing `POST /v1/retrieval` with `{"graph_name":"OKF"}` — no new storage/search code required.

#### FR-7: Structural link graph
Markdown cross-links (absolute `/path.md` recommended, relative supported) are resolved to concept IDs and stored as directed edges in `OKF_LINKS_TO` (alongside dataprep's LLM entity graph); broken links are tolerated (OKF §5), not errors. Realizes UJ-2.
**Consequences:**
- An agent can traverse a concept's neighbors and backlinks via AQL graph traversal.
- A link to a not-yet-existing concept does not fail ingest.

#### FR-8: Incremental re-index & retraction
Changed/removed concepts are incrementally updated or cascaded-deleted (reusing dataprep `retract_file`) with orphan cleanup. Realizes UJ-1.
**Consequences:**
- Deleting a bundle version removes its chunks/edges and orphans no entities.
- A concurrent query during re-index sees the last-good index until the new one is consistent.

**Feature-specific NFRs:** idempotent, content-hash keyed (NFR-S4); additive schema only (NFR-S7).

### 4.3 Bundle Registry & Curation

**Description:** The OKF Server owns the **bundle lifecycle and curation** — the managed, governed knowledge layer that raw feed-ingestion cannot provide. Bundles move through states; provenance/lineage, retention/TTL, and quality metrics are captured; stewards review and approve before publication. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-9: Bundle lifecycle states
A bundle/has a lifecycle state: `register → validate → review → approve → publish → version → deprecate → retire`. Only `published` bundles are served to agents. Realizes UJ-1, UJ-3.
**Consequences:**
- A `review`/`draft` bundle is invisible to non-steward agent queries.
- State transitions are auditable (who/when) and restricted by role.

#### FR-10: Review & approval gate
A steward can review conformance + PII + quality reports and approve a bundle for publication (or reject with reason). Realizes UJ-1, UJ-3.
**Consequences:**
- Approval requires a `tools-admin`/steward role; the approver and timestamp are recorded.
- Rejection records the reason and returns the bundle to `review`.

#### FR-11: Versioning & provenance
Bundle versions are first-class: each publish creates an immutable version; lineage (source ref → concept → served answer) is capturable. Realizes UJ-2, UJ-3.
**Consequences:**
- An agent citation can pin a specific version.
- Stewards can diff versions and see what changed.

#### FR-12: Retention / TTL
Each bundle/tenant has a retention policy; expired content is retracted on schedule with the cascade (FR-8), and the action is logged. Realizes UJ-3.
**Consequences:**
- A bundle past its retention TTL is retracted and the deletion is auditable.
- Retention is configurable per tenant with safe defaults.

#### FR-13: Quality & conformance metrics
The server surfaces per-bundle metrics: conformance issues, PII hits, concept counts, broken links, staleness. Realizes UJ-1.
**Consequences:**
- A steward dashboard/API shows bundle health at a glance.
- Stale/low-quality bundles are flagged.

### 4.4 Agent Serving (Read-only REST; MCP-ready)

**Description:** The agent-facing surface: agents search, fetch, list, and outline bundles/concepts with **progressive disclosure** and **token budgeting** (à la Context7/Notion). MVP is a read-only **REST API**; the same core handlers will back an **MCP** surface (Resources + Tools: `okf_search`, `okf_get_doc`, `okf_list_bundles`, `okf_outline`) when Sprint 24's `mcpo`/MCP infrastructure lands. Realizes UJ-2.

**Functional Requirements:**

#### FR-14: Search concepts
An authenticated agent can search the OKF corpus (hybrid vector + BM25 via the existing retriever) scoped to its authorized bundles, returning ranked concept hits (ID + snippet), token-capped, cursor-paginated. Realizes UJ-2.
**Consequences:**
- Search results are scoped by per-bundle/per-tenant RBAC (unauthorized bundles excluded silently).
- Results carry a token/byte cap and a `nextCursor` for pagination.

#### FR-15: Get concept document
An agent can fetch a concept (full or sliced) by bundle + concept ID (+ optional version/lang), with token caps and a "fetch more" handle. Realizes UJ-2.
**Consequences:**
- A request for an unauthorized concept returns 403 (not 404 leakage) `[ASSUMPTION: 403-vs-404 trade-off pending security review]`.
- Responses are version-pinned when a version is requested.

#### FR-16: List bundles & outline
An agent can list its accessible bundles and fetch a bundle's outline/`index.md` (progressive disclosure landing) before drilling in. Realizes UJ-2.
**Consequences:**
- Listing reflects only authorized bundles.
- The outline is cheap (index/manifest), enabling one-level-at-a-time navigation.

#### FR-17: MCP-ready surface
The serving handlers are implemented so the same search/get/list/outline capabilities are exposed as MCP Resources (index/manifest) + Tools (search/get) over Streamable HTTP when the MCP infrastructure is available. Realizes UJ-2.
**Consequences:**
- Adding the MCP transport does not require re-implementing search/get logic.
- `[ASSUMPTION: MCP transport lands post-MVP, gated on SST + Sprint 24 #603.]`

**Feature-specific NFRs:** performance budgets (NFR-PR1/PR2); result capping/pagination.

### 4.5 Access Control, Governance & Traceability

**Description:** Every request is authenticated (Keycloak OIDC, terminated at Kong) and authorized per-tenant and per-bundle; every access is audited and traced end-to-end. This is the enterprise/government trust core. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-18: Authentication & per-bundle/per-tenant authorization
Requests authenticate via Keycloak-issued bearer tokens (validated with `jose`/JWKS via OIDC discovery); authorization enforces per-tenant and per-bundle scopes (e.g., `okf:{tenant}:{bundle}:read`). Realizes UJ-2, UJ-3.
**Consequences:**
- A token lacking a bundle's scope cannot read that bundle's concepts.
- Token audience is bound to the OKF server (RFC 8707); token passthrough is forbidden.

#### FR-19: Audit (FOI-exportable)
Every serving/ingestion/admin action is recorded in an audit log exportable for FOI/GDPR (actor, action, bundle, concept, version, timestamp, source). Realizes UJ-3.
**Consequences:**
- An operator can export a date-ranged audit trail for a bundle/tenant.
- Audit records are retained per policy and are tamper-evident `[ASSUMPTION: append-only/signed log specifics deferred to architecture]`.

#### FR-20: End-to-end tracing
Every agent query emits OTel spans with W3C `traceparent` propagated across OKF → retriever → LLM; PII is filtered from span attributes. Realizes UJ-2.
**Consequences:**
- A served answer's full path is traceable in VictoriaTraces.
- No raw tokens/passwords/PII appear in spans.

### 4.6 Observability & Operations

**Description:** Standard Genie service operability — health/readiness, metrics, structured logging — integrated with the existing MELT stack. Realizes UJ-1.

**Functional Requirements:**

#### FR-21: Health, readiness & metrics
The service exposes `/health` and `/ready` endpoints and Prometheus metrics (ingest throughput, query latency, error rate, bundle health); runs as a non-root container. Realizes UJ-1.
**Consequences:**
- Orchestrator health checks pass/fail correctly.
- Metrics appear in the existing Grafana dashboards.

## 5. Non-Goals (Explicit)

- **Not an authoring/producer tool.** Producing OKF bundles from data sources is out of scope (use Google's enrichment agent or community producers).
- **Not a write/propose curation loop in v1.** Agents cannot edit or propose bundle updates in MVP.
- **Not a formal ontology/semantic-reasoning engine.** v1 is spec-pure + optional taxonomy; typed relationships/OWL/SHACL are deferred.
- **Not a replacement for dataprep/RAG or the retriever.** OKF Server extends them; it does not duplicate storage/retrieval.
- **Not introducing new infrastructure vendors.** No Neo4j (any edition), no separate vector DB, no Elasticsearch/Solr, no external SaaS.
- **Not MCP-served in v1.** MCP transport is post-MVP (gated on SST + #603); v1 is REST-only.
- **Not multi-modal (images/audio) in v1.** Text/Markdown OKF concepts only.

## 6. MVP Scope

### 6.1 In Scope
- Config-driven Git + S3 bundle sources, sync, version/provenance, change-detect, incremental re-index (FR-1,2,3,8).
- OKF-aware ingestion: §9 conformance validation, ClamAV, PII redaction, frontmatter/markdown parsing, structural link graph into the `OKF` ArangoDB graph via dataprep (FR-4,5,6,7).
- Bundle registry & curation: lifecycle, review/approve, versioning, retention/TTL, quality metrics (FR-9–13).
- Read-only REST serving: search, get-document, list-bundles, outline; progressive disclosure, token caps, cursor pagination (FR-14,15,16). MCP-ready handlers (FR-17).
- Access control, governance, traceability: Keycloak OIDC + per-bundle/per-tenant RBAC, FOI-exportable audit, OTel tracing (FR-18,19,20).
- Observability & operations: health/ready, metrics, non-root (FR-21).
- Open-source packaging: permissive license, ITU copyright headers, CI build/scan/promote per ADR-0001.

### 6.2 Out of Scope for MVP
- MCP transport/serving (post-MVP, gated on SST + Sprint 24 #603).
- Agent write/propose-review curation loop (v2).
- Formal typed ontology / semantic relationships (post-MVP).
- gRPC public surface; A2A agent discovery; non-OKF source formats.
- `[NOTE FOR PM: a minimal built-in admin/steward UI is desirable but may be deferred to SST Epic 4's admin surfaces — confirm whether OKF ships its own thin UI or reuses SST's.]`

## 7. Success Metrics

**Primary**
- **SM-1**: Bundle-to-agent latency — a newly registered Git/S3 bundle is validated, indexed, and queryable by agents within the freshness target (default ≤15 min; configurable). Validates FR-2,6,9.
- **SM-2**: Reuse integrity — `POST /v1/retrieval {"graph_name":"OKF"}` returns OKF concepts with **zero** changes to dataprep/retriever code. Validates FR-6.
- **SM-3**: Agent grounding — agents can resolve a query to a citable, version-pinned concept (bundle + version + concept ID) with ≥X% precision on a reference bundle set. Validates FR-14,15,11.

**Secondary**
- **SM-4**: Governance completeness — 100% of served responses pass per-bundle RBAC and produce an audit record; FOI export succeeds for any date range. Validates FR-18,19.
- **SM-5**: Sovereignty — zero outbound calls to non-declared endpoints; air-gapped deployment passes validation. Validates NFR-S1.
- **SM-6**: Curation velocity — median bundle review→publish time; conformance/PII issue detection rate. Validates FR-10,13.

**Counter-metrics (do not optimize)**
- **SM-C1**: Raw concept-count ingested — optimizing volume can degrade precision/quality; do not game SM-3 by indexing low-quality content.
- **SM-C2**: Tokens returned per query — do not inflate responses; token caps exist to protect agent context (optimizing against SM-C2 would defeat progressive disclosure).

## 8. Cross-Cutting Non-Functional Requirements

**Privacy (NFR-P)**
- **NFR-P1**: Mandatory PII redaction on ingest (Presidio, library mode); failure is **blocking** — affected concepts are withheld from `published`. (FR-5)
- **NFR-P2**: Data minimization — only declared metadata + concept text are indexed; no unnecessary PII persisted.
- **NFR-P3**: Right-to-erasure (GDPR/FOI) — bundle/tenant deletion cascades across chunks, edges, embeddings, and audit PII per policy.

**Security (NFR-S)**
- **NFR-S1**: Sovereignty — no outbound calls except declared source endpoints; air-gappable; data residency preserved.
- **NFR-S2**: Per-tenant + per-bundle RBAC enforced on every serving call; token audience-bound (RFC 8707); no token passthrough.
- **NFR-S3**: Encryption in transit (TLS, terminated at NGINX/Kong) and at rest (ArangoDB/object-store encryption).
- **NFR-S4**: Idempotent, content-hash-keyed (SHA-256) incremental re-index; failures retry with backoff, never silently drop.
- **NFR-S5**: Supply-chain integrity — CycloneDX SBOM (retain 1 yr), signed images, container scanning as a **blocking** MR gate (ADR-0001).
- **NFR-S6**: CPU-only, non-root containers on `genieai=true` nodes; **no new GPU infrastructure**.
- **NFR-S7**: No breaking ArangoDB chunk-schema changes — additive optional fields + retraction-extension only; reuse TEI embedding.

**Reliability / Availability / Scalability (NFR-R)**
- **NFR-R1**: Stateless serving tier, horizontally scalable; no in-memory session state.
- **NFR-R2**: Ingest resilience via Redis Streams + per-purpose DLQ (SST Decision 2 pattern).
- **NFR-R3**: Graceful degradation — serve last-good index if a re-index fails; degraded health surfaced.
- **NFR-R4**: Availability targets inherit the Genie deployment's SLA; stateless design enables replica-based HA on Swarm/K8s.

**Traceability / Observability (NFR-T)**
- **NFR-T1**: OTel spans + W3C `traceparent` across OKF → retriever → LLM; PII filtered from spans.
- **NFR-T2**: FOI-exportable audit log of every serving/ingestion/admin action.
- **NFR-T3**: Metrics + structured logging into the existing VictoriaMetrics/VictoriaLogs/Grafana stack.

**Performance budgets (NFR-PR)**
- **NFR-PR1**: p95 search latency ≤ [ASSUMPTION: 300 ms] for a reference bundle size on CPU nodes.
- **NFR-PR2**: Default per-response token cap (e.g., 4–8k tokens) configurable; `okf_get_doc` slices on request.

## 9. Constraints and Guardrails

- **Licensing**: Permissive only (MIT/Apache-2.0/BSD) — mandated by Genie NFR26 and a condition of open-sourcing. GPL/AGPL tolerated solely for unmodified upstream consumed via API. (Decision log.)
- **Vendors**: Single data store = ArangoDB; **no Neo4j (any edition)**, no separate vector DB, no Elasticsearch/Solr. Reuse Redis, Keycloak, Kong/Postgres, OTel/Victoria*, Docker Swarm, Ansible, GitLab CI. New deps are permissive libraries (python-frontmatter, markdown-it-py, LangChain `MarkdownHeaderTextSplitter`, FastMCP, Presidio, `jose`). (Decision log.)
- **Stack**: independent Node.js/Express component at `components/okf-server/` (CommonJS, imports `components/shared/lib/`), behind Kong; calls the Python dataprep/retriever for indexing/retrieval (dataprep complement). OKF markdown/frontmatter loader location (Node-side parsing vs dataprep `_load_and_chunk` extension) → sub-ADR in Architecture. Auth mirrors gov-chat-backend (`jose`, JWKS via OIDC discovery). (ADR-1.)
- **API conventions**: `/v1/...` or `/api/okf/...` prefix; camelCase request / snake_case response; ISO-8601 timestamps. (Project context.)

## 10. Integration and Dependencies

- **dataprep + retriever (exist, reused)** — OKF index via `graph_name="OKF"`; no code changes to the pipeline (extension only in `_load_and_chunk`).
- **document-repository (extended)** — new bundle-aware ingest route (storage + ClamAV + dataprep handoff); bypasses text-extraction/langdetect/single-base64 contract.
- **gov-chat-backend (optional)** — OKF routes may mount via `ROUTE_CONFIGS` reusing `keycloak-auth-middleware` (`jose`), OR OKF service mirrors the two auth files (Option A vs B — architecture decision).
- **api-gateway (Kong + NGINX)** — register `okf-server` service + `/api/okf` route (mirror document-repository); Kong AI MCP plugins for the future MCP surface.
- **Keycloak** — OIDC AS; per-tenant/per-bundle scopes; audience mapper; token-exchange for service-to-service.
- **SST (planned, unimplemented)** — gates MCP surface only (Sprint 24 `mcpo`/Registry); REST MVP proceeds independently.
- **Soft/hard gates** (SST precedent): REST MVP has **no hard** dependency on SST; MCP surface is hard-gated on SST Epic 1 + #603.

## 11. Data Governance

- **Residency/Sovereignty**: all content, metadata, audit, and traces stay inside the deployment boundary; air-gap deployable; no third-party egress.
- **Classification**: bundles/concepts carry sensitivity (from frontmatter/tags/steward-set); drives access policy.
- **Retention**: per-tenant retention/TTL with audited retraction (FR-12).
- **Lineage/Provenance**: source ref → concept → served answer is capturable for citation and audit (FR-3,11,19).
- **Audit**: FOI-exportable access log (FR-19, NFR-T2).

## 12. Why Now

- OKF v0.1 published June 2026; Google explicitly invited the ecosystem to build consumers/serving layers — the white space is open and uncontested by any OSS project.
- Genie's dataprep/RAG + ArangoDB + Keycloak/Kong/OTel stack already provides ~80% of the foundation; the OKF index is near-zero-code (`graph_name` parameterization).
- Sprint 24's LangGraph+MCP agentic workflows will need a governed knowledge-serving surface — OKF Server is the natural first knowledge-serving tool in the planned Tool Registry.
- Sovereign/public-sector demand for governed agent knowledge is immediate and unmet.

## 13. Open Questions

1. OKF service **shape**: extend dataprep in-place (add OKF loader to `GenieArangoDataprep`) vs sibling `genie-ai-overlay/okf/` service that calls dataprep? (→ ADR)
2. **Multi-tenancy model**: shared `OKF` graph with tenant-tagged chunks + ACL filters vs `graph_name`-per-tenant? (→ ADR)
3. **Auth placement**: OKF routes in the Node BFF (Option A) vs standalone service mirroring the two auth files (Option B)? (→ ADR)
4. **PII strategy** for Markdown bodies: Presidio at ingest (non-blocking for conformance, blocking for PII policy) — confirm field-level vs document-level redaction. (→ ADR)
5. **Versioning semantics**: bundle-level `okf_version` vs per-concept versioning for citation pinning.
6. **403-vs-404** on unauthorized concept access (security trade-off).
7. **Admin/steward UI**: OKF ships its own thin UI or reuses SST Epic 4 admin surfaces? (§6.2)
8. **Bundle content store**: confirm document-repository reuse (recommended) vs OKF-managed content store (alternative). (Decision log; → ADR)
9. **Performance targets** (NFR-PR1 p95 latency, freshness target SM-1) — confirm values.

## 14. Assumptions Index

- `[ASSUMPTION: source sync runs async on Redis Streams + DLQ, not inline]` (§4.1)
- `[ASSUMPTION: webhooks optional in MVP; scheduled poll is baseline]` (§4.1)
- `[ASSUMPTION: 403-vs-404 trade-off pending security review]` (FR-15)
- `[ASSUMPTION: MCP transport lands post-MVP, gated on SST + Sprint 24 #603]` (FR-17)
- `[ASSUMPTION: append-only/signed audit log specifics deferred to architecture]` (FR-19)
- `[ASSUMPTION: p95 search latency ≤ 300 ms on CPU nodes]` (NFR-PR1)
