---
title: PRD — GENIE.AI OKF Server
status: draft
created: 2026-07-15
updated: 2026-07-16
prd_key: okf-server
initiative: okf-server
branch: feat/okf-server
decision_log: ../../briefs/brief-okf-server-2026-07-15/.decision-log.md
builds_on:
  - ../../briefs/brief-okf-server-2026-07-15/brief.md
  - ../../briefs/brief-okf-server-2026-07-15/addendum.md
architecture: ./architecture.md
depends_on:
  - server-side-tools (SST) initiative — consumes Registry / ToolExecutor / Stream-Ingestor / mcpo (gates the MCP transport only)
  - Sprint 24 #603 (LangGraph + MCP) — gates the MCP transport only
  - dataprep / retriever (exist on main — reused, extended additively for multi-graph grounding)
authors: Genie.ai Dev
---

# PRD: GENIE.AI OKF Server

> **Authoritative production PRD.** This is a **production framework**, not an MVP — a flexible platform for delivering *any* RAG use case, *any* domain, and *across* domains. There is no "post-MVP / deferred" tier here: every capability below is in production scope, phased only by build *sequencing* (see [Architecture](./architecture.md) §12). This PRD supersedes any earlier "MVP"-framed draft of the OKF Server.

## 0. Document Purpose

This PRD defines the **OKF Server** initiative for product management, Genie platform stakeholders, and downstream BMAD workflow owners ([Architecture](./architecture.md), epics/stories, QA). It is built on — and does not duplicate — the [Product Brief](../../briefs/brief-okf-server-2026-07-15/brief.md) (vision/scope) and the [Research Addendum](../../briefs/brief-okf-server-2026-07-15/addendum.md) (verified integration map, reuse matrix, competitive/MCP/Keycloak/NFR research). All locked decisions live in the [decision log](../../briefs/brief-okf-server-2026-07-15/.decision-log.md) and the ADRs [`okf-001..015`](../../../../docs/adr/). The PRD is capability-level; implementation detail lives in [Architecture](./architecture.md). Features are grouped with globally-numbered stable FR IDs; assumptions are tagged inline (`[ASSUMPTION: …]`) and indexed in §14.

## 1. Vision

Google's Open Knowledge Format (OKF v0.1, June 2026) made organizational knowledge portable for AI agents — but deliberately stopped at the *format*, leaving storage, serving, security, curation, and query to the ecosystem. Every existing OKF consumer is either a local stdio tool or locked to Google Cloud, and every open-source GraphRAG/agent-memory engine ships without multi-tenancy, RBAC, audit, privacy controls, or data residency. Government and public-service deployments — Genie's core mission — have no sovereign way to host curated knowledge and serve it to agents with the trust model they require.

The **GENIE.AI OKF Server** is the open-source, enterprise- and government-grade service that fills this gap. It is a **flexible production framework for any RAG use case** — organizations break large corpora **by domain into multiple OKF repositories**; each repository is hosted, curated, versioned, and access-controlled; and **RAG responses are grounded in all available data** — the existing free-form corpus *and* every authorized OKF repository — through a unified multi-graph retrieval layer. It is **complementary** to Genie's dataprep/RAG pipeline and the planned Server-Side Tools (SST) foundation — it consumes and extends them, never competes — and is engineered from the first commit for **sovereignty, privacy, security, data curation, and accountability**. It becomes the canonical open-source reference implementation of a governed OKF consumer/serving layer.

## 2. Target User

### 2.1 Jobs To Be Done

- **(Agent)** "Find and cite the right authoritative knowledge for this task — across all available domains — without dumping the whole corpus into context, with a version I can pin to my answer."
- **(Knowledge author / curator)** "Create and curate OKF repositories and their Markdown concept files in-app — with live conformance validation — and manage them like code (review, version, retire)."
- **(Platform/data engineer)** "Register a domain repository from Git or S3 and have it validated, indexed into its own graph, and queryable — without writing new pipeline code or new infrastructure."
- **(Knowledge steward / DPO)** "Control precisely who can see which repository/concept, prove compliance on demand (FOI/GDPR), and manage the lifecycle — review, version, retain, retire."
- **(Public-sector program owner)** "Run a sovereign, air-gappable knowledge service for our ministry's AI agents, with no data leaving our boundary."

### 2.2 Key User Journeys

- **UJ-1. Amara creates a domain repository, curates concepts in-app, and it's live for agents.**
  - **Persona + context:** Amara, platform engineer at a national digital-services agency, curates policy/concept knowledge.
  - **Path:** (1) creates an OKF **repository** for a domain (e.g. "Social Policy") in the Vue admin dashboard — the system mints `graph_name = OKF_{repo_id}`; (2) either registers a Git/S3 source **or** authors concepts in the in-app Markdown editor (frontmatter form + body + link picker + live §9 validation); (3) on save, concepts are validated, ClamAV-scanned and PII-redacted via the document-repository, then handed to dataprep which indexes them into the repository's own graph; (4) the repository moves through review → publish.
  - **Climax:** an agent search returns a result from the new repository, with a citation and version pin — no pipeline code written.
  - **Resolution:** repository registered, versioned, access-controlled; Amara sees ingest health + conformance metrics.

- **UJ-2. A Genie agent grounds an answer across all domains with citable, access-checked concepts.**
  - **Persona + context:** a Genie LangGraph agent (Sprint 24) or external MCP client answering a user question.
  - **Path:** (1) ChatQnA forwards the caller's **authorized graph set** (free-form `GRAPH` + all `OKF_{repo_id}` the token grants) to the retriever; (2) the retriever fans out across those graphs, fuses results (RRF), applies per-repo/per-domain ACL, and returns ranked concept hits; (3) the agent fetches the top concept and its structural neighbors.
  - **Climax:** the agent cites the concept with repository, version, and concept ID — grounded in *all* available data, not one corpus.
  - **Resolution:** answer grounded, citable, access-respecting; the call is traced end-to-end (OTel) and audited.

- **UJ-3. Sofia restricts a sensitive repository and exports an audit for an FOI request.**
  - **Persona + context:** Sofia, data-protection officer, responding to a freedom-of-information request.
  - **Path:** (1) sets a repository to restricted (per-tenant/per-repo/per-domain RBAC); (2) confirms only authorized roles retain access; (3) exports the FOI-compliant audit trail (who queried what, when, from where) for a date range; (4) applies retention/TTL.
  - **Climax:** she delivers a complete, tamper-evident access log and proves the restricted repository is inaccessible to unauthorized callers.
  - **Resolution:** compliance demonstrated; retention policy applied.

## 3. Glossary

- **OKF** — Open Knowledge Format v0.1 (Google, June 2026); a directory of Markdown files with YAML frontmatter.
- **Repository** — the top-level managed unit in OKF Server: one OKF bundle scoped to **one domain**, mapped to its own ArangoDB graph `OKF_{repo_id}`. A deployment hosts **multiple repositories** (one per domain). ([ADR-okf-014](../../../../docs/adr/okf-014-repository-model.md))
- **Domain** — an organizational knowledge scope (e.g. a ministry policy area); reuses Genie's existing **service-category hierarchy** (`/api/service-categories`). One repository = one domain. ([ADR-okf-014](../../../../docs/adr/okf-014-repository-model.md))
- **Concept** — one `.md` document in a repository. **Concept ID** = file path with `.md` removed.
- **Frontmatter** — YAML metadata block at the top of a concept; only `type` is required by OKF.
- **Index file / Log file** — OKF reserved files (`index.md`, `log.md`) for progressive disclosure and change history.
- **OKF Server** — the new Genie service this PRD specifies: an independent component at `components/okf-server/` (Node.js/Express, CommonJS, imports `components/shared/lib/`), behind Kong, that calls the Python dataprep/retriever for indexing/retrieval and manages repositories, curation, governance, and serving. ([ADR-okf-001](../../../../docs/adr/okf-001-okf-server-component-and-stack.md))
- **OKF graph** — the per-repository ArangoDB graph/collections `OKF_{repo_id}_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO` + `OKF_{repo_id}_BM25_VIEW`. ([ADR-okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md))
- **Multi-graph grounding** — unifying retrieval across the free-form `GRAPH` corpus *and* all authorized `OKF_*` repository graphs via retriever fan-out + RRF. ([ADR-okf-012](../../../../docs/adr/okf-012-multi-graph-grounding.md))
- **Structural link graph** — concept-to-concept edges derived from Markdown cross-links (distinct from dataprep's LLM-extracted entity graph), stored in `OKF_{repo_id}_LINKS_TO` with the link's anchor text as `label`.
- **dataprep / retriever** — existing Genie OPEA services; reused and **extended additively** (graph_name wiring, multi-graph fan-out, repo-level retract).
- **Tenant** — an isolated administrative/agency scope on a shared deployment.
- **SST** — the Server-Side Tools initiative (planned); the foundation OKF Server consumes for the MCP transport (Registry, ToolExecutor, Stream-Ingestor, mcpo).

## 4. Features

### 4.1 Repository & Source Management

**Description:** Operators create and manage **multiple OKF repositories** (one per domain) and their Git/S3 sources. Each repository mints its own graph; sources are synced, version-tracked, and change-detected. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Register a repository source
An authenticated steward can register a Git or S3 source for a repository (type, endpoint, ref/path, credentials ref, sync schedule, domain, display name) and have it validated as reachable. Credentials are referenced from the secret store, never persisted in plaintext. Realizes UJ-1.
**Consequences:**
- Registering an unreachable/inaccessible source yields a structured error with the failing check; nothing is indexed.
- Credentials never appear in config or logs.

#### FR-2: Sync and change-detect
The system syncs registered sources on schedule or webhook and detects changes (Git: commit-diff `OLD..NEW --name-only`; S3: ETag/LastModified; content SHA-256 idempotency key) without full re-ingest of unchanged concepts. Realizes UJ-1.
**Consequences:**
- A source updated with one new concept re-indexes only that concept within the freshness target (NFR-S4).
- Re-syncing an unchanged source performs no re-embedding (SHA-256 match).
- A failed sync is retried with backoff and surfaced as degraded health.

#### FR-3: Version tracking & provenance
Each indexed repository version records its source ref (commit SHA / S3 version), fetch timestamp, curator, and a stable version identifier. Realizes UJ-2, UJ-3.
**Consequences:**
- A concept served to an agent carries its repository + version + concept ID for citation.
- An operator can list versions of a repository and pin/diff them.

#### FR-23: Repository lifecycle & CRUD
An authenticated steward (`tools-admin`) can **create, read/list, update, and delete** repositories. Creating a repository mints `repo_id` and reserves `graph_name = OKF_{repo_id}` (graph created on first ingest); the repository is bound to a domain (service-category key). Deleting a repository cascades — retracts its entire graph + metadata, audited, with a confirmation + retention grace. Realizes UJ-1, UJ-3. ([ADR-okf-014](../../../../docs/adr/okf-014-repository-model.md), [ADR-okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md))
**Consequences:**
- A new domain repository is isolated in its own graph from every other repository.
- List/read is scoped to the caller's authorized domains/repos; delete is irreversible after the grace window and fully audited.

**Feature-specific NFRs:** no outbound calls beyond the declared source endpoint (sovereignty, NFR-S1); CPU-only, no GPU (NFR-S6).

### 4.2 Ingestion & Indexing

**Description:** Ingested repositories are validated against OKF §9, virus-scanned (ClamAV), PII-redacted, parsed into concepts (frontmatter → metadata; Markdown-header chunking; structural link edges with anchor text), and routed through the **document-repository** into **dataprep**, which embeds (TEI) and stores them in the repository's own ArangoDB graph `OKF_{repo_id}` — reusing the existing pipeline additively. Retraction cascades on removal. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-4: Conformance validation (OKF §9)
On ingest, every repository is checked for OKF §9 conformance (parseable frontmatter; non-empty `type`; reserved-file structure). Non-conformance is a **quality gate**, not a hard rejection — issues are surfaced to stewards. Realizes UJ-1.
**Consequences:**
- A concept missing `type` is still ingested; it is flagged in the conformance report.
- Conformance results are queryable per repository/version (FR-13).

#### FR-5: Safe ingest via the document-repository (scan + PII redaction)
Bundle/repository content is stored, virus-scanned (ClamAV), and handed to dataprep **through the existing `components/document-repository`** via a new bundle-aware ingest route; PII is redacted on ingest and **PII-redaction failure is blocking** (the concept/repository is not published). Realizes UJ-1, UJ-3; enforces NFR-P1, NFR-P2. ([ADR-okf-008](../../../../docs/adr/okf-008-bundle-content-store.md))
**Consequences:**
- A repository containing malware is rejected/quarantined and logged; nothing is indexed.
- A concept whose body fails PII policy is withheld from `published` and flagged for review.

#### FR-6: OKF-aware parsing & indexing (per-repository graph)
Concepts are parsed (frontmatter → metadata; header-aware chunking preserving header context) and indexed into the repository's own graph `OKF_{repo_id}` via dataprep — reusing TEI embeddings and the `{graph}_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO` schema, with additive OKF metadata (`concept_id`, `bundle_version`, `source_type:"okf"`). Realizes UJ-1, UJ-2. ([ADR-okf-010](../../../../docs/adr/okf-010-okf-markdown-loader-location.md), [ADR-okf-013](../../../../docs/adr/okf-013-graph-name-wiring.md))
**Consequences:**
- Frontmatter fields become queryable/filterable metadata.
- Concepts are retrievable through the existing retriever with `graph_name = OKF_{repo_id}`.

#### FR-7: Structural link graph (with anchor text)
Markdown cross-links are resolved to concept IDs and stored as directed edges in `OKF_{repo_id}_LINKS_TO` carrying the link's **anchor text** (`label`) and keying (`file_id`/`repo_id`); broken links are tolerated (OKF §5). Realizes UJ-2.
**Consequences:**
- An agent can traverse a concept's neighbors/backlinks via parameterized graph traversal, retaining *why* concepts link (anchor text).
- A link to a not-yet-existing concept does not fail ingest.

#### FR-8: Incremental re-index & retraction (repository/bundle/concept level)
Changed/removed concepts are incrementally updated or cascaded-deleted. Retraction is supported at concept, bundle, and repository level (by `repo_id`/`bundle_version`, reusing dataprep `retract_file` extended), with orphan cleanup. Realizes UJ-1, UJ-3.
**Consequences:**
- Deleting a repository/version removes its chunks/edges and orphans no entities.
- A concurrent query during re-index sees the last-good index until the new one is consistent.

**Feature-specific NFRs:** idempotent, content-hash keyed (NFR-S4); additive schema only (NFR-S7).

### 4.3 Curation & In-App Authoring

**Description:** The OKF Server owns the repository **lifecycle, curation, and authoring**. Repositories move through governed states; **users can create repositories and curate Markdown concept files in-app** with live validation. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-9: Repository/concept lifecycle states
A repository/concept has a lifecycle state: `register → validate → review → approve → publish → version → deprecate → retire`. Only `published` content is served to agents. Realizes UJ-1, UJ-3.
**Consequences:**
- `review`/`draft` content is invisible to non-steward agent queries.
- State transitions are auditable (who/when) and role-restricted.

#### FR-10: Review & approval gate
A steward reviews conformance + PII + quality reports and approves content for publication (or rejects with reason). Realizes UJ-1, UJ-3.
**Consequences:**
- Approval requires a `tools-admin`/steward role; approver + timestamp recorded.
- Rejection records the reason and returns the content to `review`.

#### FR-11: Versioning & provenance
Repository/concept versions are first-class: each publish creates an immutable version; lineage (source ref → concept → served answer) is capturable. Realizes UJ-2, UJ-3. ([ADR-okf-005](../../../../docs/adr/okf-005-versioning-semantics.md))
**Consequences:**
- An agent citation can pin a specific version.
- Stewards can diff versions and see what changed.

#### FR-12: Retention / TTL
Each repository/tenant has a retention policy; expired content is retracted on schedule (FR-8) and the action is logged. Realizes UJ-3.
**Consequences:**
- Content past retention TTL is retracted and the deletion is auditable.
- Retention is configurable per tenant/domain with safe defaults.

#### FR-13: Quality & conformance metrics
The server surfaces per-repository metrics: conformance issues, PII hits, concept counts, broken links, staleness. Realizes UJ-1.
**Consequences:**
- A steward dashboard/API shows repository health at a glance; stale/low-quality repositories are flagged.

#### FR-25: In-app concept authoring & curation
Users can **create and curate OKF repositories and their Markdown concept files in-app**: a Markdown concept editor (frontmatter form with `type` required + `title`/`description`/`resource`/`tags`/`timestamp`; Markdown body editor; a **link picker** that inserts `[…](/path/to/concept.md)` from the repository's concept tree; and **live OKF §9 validation** + PII pre-check). Concept CRUD (create/read/update/delete) within a repository; on save → re-parse → incremental re-index → update metadata + structural edges. Reserved files (`index.md`, `log.md`) are generated/synced and editable. Realizes UJ-1. ([ADR-okf-015](../../../../docs/adr/okf-015-in-app-authoring-curation.md))
**Consequences:**
- An author can build a domain repository entirely in-app without external Git tooling (external Git/S3 ingest remains a parallel path via FR-1).
- A non-conformant save is blocked at the editor with a specific §9 error; no invalid concept reaches `published`.

### 4.4 Unified Grounding & Agent Serving

**Description:** RAG responses are grounded in **all available data**. A **unified multi-graph retrieval** extension to the existing retriever fans out across the free-form `GRAPH` corpus *and* every authorized `OKF_{repo_id}` graph, fuses results, and enforces ACL — so chat answers and agent queries see the whole authorized knowledge base. Agents search, fetch, list, and outline with progressive disclosure and token budgeting over **REST now** (the same handlers back an **MCP** surface when the MCP transport lands). Realizes UJ-2.

**Functional Requirements:**

#### FR-24: Unified multi-graph grounding (CORE)
The existing retriever is **extended** so a single retrieval can target a **set of authorized graphs** (`GRAPH` + the caller's `OKF_{repo_id}` set): it runs the existing hybrid path (dense COSINE + BM25 view + optional traversal) per graph, then **RRF-fuses** the per-graph ranked lists, applying `chunk_labels` ACL per graph, and returns a unified ranked list with per-hit `graph_name`/`repo_id`/`concept_id` for citation. ChatQnA forwards the caller's authorized graph set so chat answers ground across all data. Realizes UJ-2. ([ADR-okf-012](../../../../docs/adr/okf-012-multi-graph-grounding.md), [ADR-okf-013](../../../../docs/adr/okf-013-graph-name-wiring.md))
**Consequences:**
- A chat answer can cite concepts from the free-form corpus *and* multiple OKF repositories in one response.
- Adding a new repository immediately participates in grounding for authorized callers — no per-repo wiring per query.
- ACL is enforced per graph; an unauthorized repository never contributes results.

#### FR-14: Search concepts (unified)
An authenticated agent can search across its authorized graphs (FR-24), returning ranked concept hits (ID + snippet), token-capped, cursor-paginated. Realizes UJ-2.
**Consequences:**
- Results are scoped by per-tenant/per-repo/per-domain RBAC (unauthorized repositories excluded silently).
- Results carry a token/byte cap and a `nextCursor`.

#### FR-15: Get concept document
An agent can fetch a concept (full or sliced) by repository + concept ID (+ optional version/lang), with token caps and a "fetch more" handle. An unauthorized request returns 403 (not 404 leakage). Realizes UJ-2. ([ADR-okf-006](../../../../docs/adr/okf-006-403-vs-404-unauthorized.md))
**Consequences:**
- Responses are version-pinned when a version is requested.

#### FR-16: List repositories & outline
An agent can list its accessible repositories and fetch a repository's outline/`index.md` (progressive-disclosure landing) before drilling in. Realizes UJ-2.
**Consequences:**
- Listing reflects only authorized repositories; the outline enables one-level-at-a-time navigation.

#### FR-17: MCP-ready surface
The serving handlers are implemented so the same search/get/list/outline + a parameterized `neighbors` traversal are exposed as MCP Resources (index/manifest) + Tools over Streamable HTTP when the MCP transport is available. Realizes UJ-2.
**Consequences:**
- Adding the MCP transport does not require re-implementing search/get logic.
- The MCP surface is sequenced after REST, gated on SST + Sprint 24 #603 (transport only — the handlers ship with REST).

**Feature-specific NFRs:** performance budgets (NFR-PR1/PR2); result capping/pagination.

### 4.5 Vue 3 Admin Ingestion & Curation UI

**Description:** The Vue 3 admin dashboard (the UI that already hosts all ingestion functionality) is **extended** for OKF: a new "OKF Repositories" tab plus dialogs for repository management, the in-app concept editor, repository details, and live ingestion progress. (Flutter has no ingestion/admin UI — confirmed.) Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-26: Vue 3 admin OKF ingestion & curation UI
Extend `AdminDashboard.vue` (Options API, Vuex, vue-i18n, `httpService` → `/api`) with: a new **OKF Repositories** tab (table: name, domain, source, lifecycle, version, health, last sync, concept count; filters/search/pagination); new components — `OkfRepositoryDialog.vue` (create/edit repository; domain picker via `serviceTreeService.getAdminCategories()`), `OkfConceptEditor.vue` (the in-app Markdown authoring surface of FR-25), `OkfRepositoryDetails.vue` (tabs: Concepts tree, Conformance/PII report, Versions, Source/Sync, Audit; actions Sync/Validate/Publish/Retire/Delete), `OkfIngestionProgress.vue` (live ingest/sync status); a new `okfRepositoryService.js` + Vuex `okf` module; and an `okf.*` i18n tree across all locales. All strings i18n; DS primitives used per the frontend design system. Realizes UJ-1, UJ-3.
**Consequences:**
- Operators and authors manage the full repository/concept lifecycle from the admin dashboard — same surface as existing document ingestion.
- All OKF strings are translated (English source of truth); admin/mutating actions enforce the `tools-admin`/admin role at Kong + OKF Server.

### 4.6 Access Control, Governance & Traceability

**Description:** Every request is authenticated (Keycloak OIDC, terminated at Kong) and authorized per-tenant, per-repository, and per-domain; every access is audited and traced end-to-end. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-18: Authentication & per-tenant/repo/domain authorization
Requests authenticate via Keycloak-issued bearer tokens (validated with `jose`/JWKS via OIDC discovery); authorization enforces per-tenant + per-repository + per-domain scopes (e.g. `okf:{tenant}:{repo}:{read|admin}`), encoded as `chunk_labels` (`t:`/`r:`/`d:`) so the retriever's existing label filter enforces isolation. Realizes UJ-2, UJ-3. ([ADR-okf-003](../../../../docs/adr/okf-003-standalone-service-behind-kong.md), [ADR-okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md))
**Consequences:**
- A token lacking a repository's scope cannot read that repository's concepts.
- Token audience is bound to the OKF server (RFC 8707); token passthrough is forbidden.

#### FR-19: Audit (FOI-exportable)
Every serving/ingestion/admin action is recorded in an audit log exportable for FOI/GDPR (actor, action, repository, concept, version, timestamp, source). Realizes UJ-3.
**Consequences:**
- An operator can export a date-ranged audit trail for a repository/tenant; records are retained per policy and tamper-evident.

#### FR-20: End-to-end tracing
Every agent query emits OTel spans with W3C `traceparent` propagated across OKF → retriever → LLM; PII is filtered from span attributes. Realizes UJ-2.
**Consequences:**
- A served answer's full path is traceable in VictoriaTraces; no raw tokens/passwords/PII appear in spans.

### 4.7 Observability & Operations

**Description:** Standard Genie service operability — health/readiness, metrics, structured logging — integrated with the existing MELT stack. Realizes UJ-1.

**Functional Requirements:**

#### FR-21: Health, readiness & metrics
The service exposes `/health` and `/ready` endpoints and Prometheus metrics (ingest throughput, query latency, error rate, repository health); runs as a non-root container. Realizes UJ-1.
**Consequences:**
- Orchestrator health checks pass/fail correctly; metrics appear in existing Grafana dashboards.

## 5. Non-Goals (Explicit — product boundaries, not temporal deferrals)

- **Not a producer-replacement for external catalogs.** Exporting from Dataplex/Collibra/Unity is done by external producers; OKF Server *hosts and serves*, and offers in-app authoring for human curators.
- **Not a formal ontology / OWL / SHACL reasoning engine.** OKF is spec-pure; relationships are conveyed by links + prose. (Optional taxonomy via frontmatter/tags only.)
- **Not a replacement for dataprep/RAG or the retriever.** OKF Server extends them; it does not duplicate storage/retrieval.
- **Not introducing new infrastructure vendors.** No Neo4j (any edition), no separate vector DB, no Elasticsearch/Solr, no external SaaS.
- **Not multimodal (images/audio).** Text/Markdown OKF concepts only.
- **Not raw-AQL-to-agents.** Agents get parameterized traversal only — never arbitrary AQL. ([ADR-okf-011](../../../../docs/adr/okf-011-no-raw-aql-to-agents.md))

## 6. Production Scope

**In Scope (production — sequenced in [Architecture](./architecture.md) §12):**
- Multiple OKF repositories (one per domain), repository CRUD, each in its own graph `OKF_{repo_id}` (FR-1, 2, 3, 23).
- OKF-aware ingestion via the document-repository: §9 conformance, ClamAV, PII redaction, parsing, structural link graph, per-repo indexing, repo-level retract (FR-4, 5, 6, 7, 8).
- Curation & in-app authoring: lifecycle, review/approve, versioning, retention, metrics, in-app Markdown concept editor with live §9 validation (FR-9, 10, 11, 12, 13, 25).
- Unified multi-graph grounding + agent serving: retriever fan-out+RRF across `GRAPH` + authorized `OKF_*`; search/get/list/outline; MCP-ready handlers (FR-24, 14, 15, 16, 17).
- Vue 3 admin ingestion & curation UI (FR-26).
- Access control, governance, traceability; observability & operations (FR-18, 19, 20, 21).
- Open-source packaging (permissive license, ITU copyright headers, CI build/scan/promote per ADR-0001).

**MCP transport** is the only capability sequenced after the REST surface (gated on SST + Sprint 24 #603 — transport only; the handlers ship with REST).

## 7. Success Metrics

**Primary**
- **SM-1**: Repository-to-agent latency — a newly registered/created repository is validated, indexed into its own graph, and queryable within the freshness target (default ≤15 min; configurable). Validates FR-2, 6, 23.
- **SM-2**: Reuse integrity — retrieval against `OKF_{repo_id}` graphs works with **only additive** changes to dataprep/retriever (no breaking schema changes). Validates FR-6, 24.
- **SM-3**: Unified grounding — agents resolve a query to citable, version-pinned concepts across the free-form corpus *and* OKF repositories with ≥X% precision on a reference set. Validates FR-24, 14, 15, 11.

**Secondary**
- **SM-4**: Governance completeness — 100% of served responses pass per-repo RBAC and produce an audit record; FOI export succeeds for any date range. Validates FR-18, 19.
- **SM-5**: Sovereignty — zero outbound calls to non-declared endpoints; air-gapped deployment passes validation. Validates NFR-S1.
- **SM-6**: Curation velocity — median repository review→publish time; conformance/PII issue detection rate; in-app authoring adoption. Validates FR-10, 13, 25.

**Counter-metrics (do not optimize)**
- **SM-C1**: Raw concept-count ingested — optimizing volume can degrade precision; do not game SM-3 by indexing low-quality content.
- **SM-C2**: Tokens returned per query — do not inflate responses; token caps protect agent context (optimizing against SM-C2 defeats progressive disclosure).

## 8. Cross-Cutting Non-Functional Requirements

**Privacy (NFR-P)** — [ADR-okf-004](../../../../docs/adr/okf-004-pii-redaction-strategy.md)
- **NFR-P1**: Mandatory PII redaction on ingest (Presidio, library mode); failure is **blocking**. (FR-5)
- **NFR-P2**: Data minimization — only declared metadata + concept text indexed.
- **NFR-P3**: Right-to-erasure (GDPR/FOI) — repository/tenant deletion cascades across chunks, edges, embeddings, and audit PII.

**Security (NFR-S)**
- **NFR-S1**: Sovereignty — no outbound calls except declared source endpoints; air-gappable; data residency preserved.
- **NFR-S2**: Per-tenant + per-repository + per-domain RBAC on every call; token audience-bound (RFC 8707); no token passthrough.
- **NFR-S3**: Encryption in transit (TLS, terminated at NGINX/Kong) and at rest.
- **NFR-S4**: Idempotent, content-hash-keyed (SHA-256) incremental re-index; failures retry with backoff, never silently drop.
- **NFR-S5**: Supply-chain integrity — CycloneDX SBOM (retain 1 yr), signed images, container scanning as a **blocking** MR gate (ADR-0001). [ADR-okf-009](../../../../docs/adr/okf-009-performance-and-supply-chain.md)
- **NFR-S6**: CPU-only, non-root containers on `genieai=true` nodes; no new GPU infrastructure.
- **NFR-S7**: No breaking ArangoDB chunk-schema changes — additive fields + retraction-extension only; reuse TEI embedding.

**Reliability / Availability / Scalability (NFR-R)**
- **NFR-R1**: Stateless serving tier, horizontally scalable; no in-memory session state.
- **NFR-R2**: Ingest resilience via Redis Streams + per-purpose DLQ (SST pattern).
- **NFR-R3**: Graceful degradation — serve last-good index if a re-index fails; degraded health surfaced.
- **NFR-R4**: Availability inherits the Genie deployment's SLA; stateless design enables replica-based HA on Swarm/K8s.

**Traceability / Observability (NFR-T)**
- **NFR-T1**: OTel spans + W3C `traceparent` across OKF → retriever → LLM; PII filtered from spans.
- **NFR-T2**: FOI-exportable audit log of every serving/ingestion/admin action.
- **NFR-T3**: Metrics + structured logging into the existing VictoriaMetrics/VictoriaLogs/Grafana stack.

**Performance budgets (NFR-PR)** — [ADR-okf-009](../../../../docs/adr/okf-009-performance-and-supply-chain.md)
- **NFR-PR1**: p95 search latency ≤ [ASSUMPTION: 300 ms] for a reference repository size on CPU nodes.
- **NFR-PR2**: Default per-response token cap (e.g. 4–8k tokens) configurable; `get` slices on request.

## 9. Constraints and Guardrails

- **Licensing**: Permissive only (MIT/Apache-2.0/BSD) — mandated by Genie NFR26 and a condition of open-sourcing. GPL/AGPL tolerated solely for unmodified upstream consumed via API. (Decision log.)
- **Vendors**: Single data store = ArangoDB; **no Neo4j (any edition)**, no separate vector DB, no Elasticsearch/Solr. Reuse Redis, Keycloak, Kong/Postgres, OTel/Victoria*, Docker Swarm, Ansible, GitLab CI. New deps are permissive libraries (gray-matter, markdown-it, LangChain `MarkdownHeaderTextSplitter`, FastMCP/TS MCP SDK, Presidio, `jose`, isomorphic-git/native git, rclone/boto3). (Decision log.)
- **Stack**: independent Node.js/Express component at `components/okf-server/` (CommonJS, imports `components/shared/lib/`), behind Kong; calls the Python dataprep/retriever. OKF markdown/frontmatter parsing is Node-side (ADR-okf-010). Auth mirrors gov-chat-backend (`jose`, JWKS via OIDC discovery). ([ADR-okf-001](../../../../docs/adr/okf-001-okf-server-component-and-stack.md))
- **API conventions**: `/api/okf/*` prefix; camelCase request / snake_case response; ISO-8601 timestamps; cursor pagination. (Project context.)

## 10. Integration and Dependencies

- **dataprep + retriever (exist — reused, extended additively)** — per-repo indexing via `graph_name = OKF_{repo_id}`; retriever multi-graph fan-out + RRF (FR-24); repo-level retract; graph_name wiring (doc-repo → dataprep; ChatQnA → retriever). ([ADR-okf-013](../../../../docs/adr/okf-013-graph-name-wiring.md))
- **document-repository (extended)** — new bundle-aware ingest route (storage + ClamAV + dataprep handoff, carrying `graph_name`). (FR-5, [ADR-okf-008](../../../../docs/adr/okf-008-bundle-content-store.md))
- **gov-chat-frontend (extended)** — new OKF admin tab + dialogs + service + Vuex module + i18n. (FR-26)
- **api-gateway (Kong + NGINX)** — register `okf-server` service + `/api/okf` route; Kong AI MCP plugins for the MCP surface.
- **Keycloak** — OIDC AS; per-tenant/repo/domain scopes; audience mapper; token-exchange for service-to-service.
- **SST (planned)** — gates the **MCP transport only**; REST + handlers proceed independently.

## 11. Data Governance

- **Residency/Sovereignty**: all content, metadata, audit, and traces stay inside the deployment boundary; air-gap deployable; no third-party egress.
- **Classification**: repositories/concepts carry sensitivity (frontmatter/tags/steward-set); drives access policy.
- **Retention**: per-tenant/per-domain retention/TTL with audited retraction (FR-12).
- **Lineage/Provenance**: source ref → concept → served answer is capturable for citation and audit (FR-3, 11, 19).
- **Audit**: FOI-exportable access log (FR-19, NFR-T2).

## 12. Why Now

- OKF v0.1 published June 2026; Google explicitly invited the ecosystem to build consumers/serving layers — the white space is open and uncontested by any OSS project.
- Genie's dataprep/RAG + ArangoDB + Keycloak/Kong/OTel stack already provides ~80% of the foundation; multi-repo + multi-graph grounding are additive extensions.
- Sprint 24's LangGraph+MCP agentic workflows need a governed knowledge-serving surface that grounds in all data.
- Sovereign/public-sector demand for governed, multi-domain agent knowledge is immediate and unmet.

## 13. Open Questions

1. **PII strategy** granularity (document-level vs field-level redaction) — confirm default. (→ [ADR-okf-004](../../../../docs/adr/okf-004-pii-redaction-strategy.md))
2. **Versioning semantics** — repository-level `okf_version` vs per-concept versioning for citation pinning. (→ [ADR-okf-005](../../../../docs/adr/okf-005-versioning-semantics.md))
3. **403-vs-404** on unauthorized concept access (security trade-off). (→ [ADR-okf-006](../../../../docs/adr/okf-006-403-vs-404-unauthorized.md))
4. **`repo_id` format** + maximum repositories per deployment (ops sizing).
5. **Domain mapping** — domain = service-category *top-level* category vs any node in the hierarchy.
6. **Retention defaults** per domain (regulatory variation).
7. **RRF weights** for cross-graph fusion (tune empirically).
8. **Performance targets** (NFR-PR1 p95 latency, freshness target SM-1) — confirm values.
9. Whether the free-form `GRAPH` corpus should also become domain-partitioned later (not required now; stays single).

> Resolved questions (service shape → [okf-001](../../../../docs/adr/okf-001-okf-server-component-and-stack.md); multi-tenancy/graph model → [okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md); auth placement → [okf-003](../../../../docs/adr/okf-003-standalone-service-behind-kong.md); admin UI → [okf-007](../../../../docs/adr/okf-007-admin-steward-ui.md)/[okf-015](../../../../docs/adr/okf-015-in-app-authoring-curation.md); bundle store → [okf-008](../../../../docs/adr/okf-008-bundle-content-store.md)) are decided — see the ADRs.

## 14. Assumptions Index

- `[ASSUMPTION: source sync runs async on Redis Streams + DLQ, not inline]` (§4.1)
- `[ASSUMPTION: webhooks supported; scheduled poll is the baseline fallback]` (§4.1)
- `[ASSUMPTION: p95 search latency ≤ 300 ms on CPU nodes]` (NFR-PR1)
- `[ASSUMPTION: RRF fusion reuses the retriever's existing rrf_fuse]` (FR-24)
- `[ASSUMPTION: append-only/signed audit log specifics in Architecture]` (FR-19)
