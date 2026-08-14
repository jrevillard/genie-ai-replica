---
title: PRD — GENIE.AI OKF Server
status: draft
created: 2026-07-15
updated: 2026-08-13
prd_key: okf-server
initiative: agentic-enablement
branch: feat/agentic-enablement
parent_prd: ../prd-agentic-enablement.md
decision_log: ../../briefs/brief-okf-server-2026-07-15/.decision-log.md
builds_on:
  - ../../briefs/brief-okf-server-2026-07-15/brief.md
  - ../../briefs/brief-okf-server-2026-07-15/addendum.md
architecture: ./architecture.md
depends_on:
  - OPEA 1.3 → 1.5 overlay bump (cheap; ~3–5 engineer-days) — the Genie-owned RAG components OKF extends are rebased onto `comps` 1.5; the verified v1.3↔v1.5 diff proved the APIs are byte-identical/additive, so RAG logic is untouched and stays Genie-owned/forked. OKF Phase 1 lands AFTER the bump.
  - dataprep / retriever (exist on main — Genie-owned/forked; reused, extended additively for multi-graph grounding — which is GREENFIELD: multi-graph fan-out + `graph_name` threading do not exist today)
  - GENIE workflows service (Sprint 24 #603 — custom LangChain Deep Agents on the OPEA `MicroService` harness) — its MCP client (`mcp` SDK) consumes OKF's MCP surface; gates the MCP transport only
  - SST (reduced to tools: web search via SearXNG + stream ingestor + governance) — the original Registry/Executor/mcpo are SUBSUMED by the workflows service; no longer a dependency for MCP transport
authors: Genie.ai Dev
---

# PRD: GENIE.AI OKF Server

> **Pillar spec of the [agentic-enablement initiative](../prd-agentic-enablement.md)** — this is the OKF Server component PRD, ONE of four pillars (OPEA 1.5 bump · agentic layer · SST · OKF). See the umbrella PRD for initiative-level framing; this document specifies OKF only.

> **Authoritative production PRD.** This is a **production framework**, not an MVP — a flexible platform for delivering *any* RAG use case, *any* domain, and *across* domains. There is no "post-MVP / deferred" tier here: every capability below is in production scope, phased only by build *sequencing* (see [Architecture](./architecture.md) §12). This PRD supersedes any earlier "MVP"-framed draft of the OKF Server.

## 0. Document Purpose

This PRD defines the **OKF Server** initiative for product management, Genie platform stakeholders, and downstream BMAD workflow owners ([Architecture](./architecture.md), epics/stories, QA). It is built on — and does not duplicate — the [Product Brief](../../briefs/brief-okf-server-2026-07-15/brief.md) (vision/scope) and the [Research Addendum](../../briefs/brief-okf-server-2026-07-15/addendum.md) (verified integration map, reuse matrix, competitive/MCP/Keycloak/NFR research). All locked decisions live in the [decision log](../../briefs/brief-okf-server-2026-07-15/.decision-log.md) and the ADRs [`okf-001..017`](../../../../docs/adr/). The PRD is capability-level; implementation detail lives in [Architecture](./architecture.md). Features are grouped with globally-numbered stable FR IDs; assumptions are tagged inline (`[ASSUMPTION: …]`) and indexed in §14.

## 1. Vision

Google's Open Knowledge Format (OKF v0.2, August 2026) made organizational knowledge portable for AI agents — and, as of v0.2, made **provenance, trust, lifecycle, and attestation** first-class — but deliberately stopped at the *format*, leaving storage, serving, security, curation, and query to the ecosystem. Every existing OKF consumer is either a local stdio tool or locked to Google Cloud, and every open-source GraphRAG/agent-memory engine ships without multi-tenancy, RBAC, audit, privacy controls, or data residency. Government and public-service deployments — Genie's core mission — have no sovereign way to host curated knowledge and serve it to agents with the trust model they require.

The **GENIE.AI OKF Server** is the open-source, enterprise- and government-grade service that fills this gap. It is a **flexible production framework for any RAG use case** — organizations break large corpora **by domain into multiple OKF repositories**; each repository is hosted, curated, versioned, and access-controlled; and **RAG responses are grounded in all available data** — the existing free-form corpus *and* every authorized OKF repository — through a unified multi-graph retrieval layer. It is **complementary** to Genie's dataprep/RAG pipeline and the planned agentic layer (custom LangChain Deep Agents + SST-as-tools) — it consumes and extends them, never competes — and is engineered from the first commit for **sovereignty, privacy, security, data curation, and accountability**. It becomes the canonical open-source reference implementation of a governed OKF consumer/serving layer.

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
  - **Path:** (1) creates an OKF **repository** for a domain (e.g. "Social Policy") in the Vue admin dashboard — the system mints `graph_name = OKF_{repo_id}`; (2) either registers a Git/S3 source **or** authors concepts in the in-app Markdown editor (frontmatter form + body + link picker + live §11 validation); (3) on save, concepts are validated, ClamAV-scanned and PII-redacted via the document-repository, then handed to dataprep which indexes them into the repository's own graph; (4) the repository moves through review → publish.
  - **Climax:** an agent search returns a result from the new repository, with a citation and version pin — no pipeline code written.
  - **Resolution:** repository registered, versioned, access-controlled; Amara sees ingest health + conformance metrics.

- **UJ-2. A Genie agent grounds an answer across all domains with citable, access-checked concepts.**
  - **Persona + context:** a Genie **LangChain Deep Agents (on LangGraph)** agent (Sprint 24) or external MCP client answering a user question.
  - **Path:** (1) ChatQnA forwards the caller's **authorized graph set** (free-form `GRAPH` + all `OKF_{repo_id}` the token grants) to the retriever; (2) the retriever fans out across those graphs, fuses results (RRF), applies per-repo/per-domain ACL, and returns ranked concept hits; (3) the agent fetches the top concept and its structural neighbors.
  - **Climax:** the agent cites the concept with repository, version, and concept ID — grounded in *all* available data, not one corpus.
  - **Resolution:** answer grounded, citable, access-respecting; the call is traced end-to-end (OTel) and audited.

- **UJ-3. Sofia restricts a sensitive repository and exports an audit for an FOI request.**
  - **Persona + context:** Sofia, data-protection officer, responding to a freedom-of-information request.
  - **Path:** (1) sets a repository to restricted (per-tenant/per-repo/per-domain RBAC); (2) confirms only authorized roles retain access; (3) exports the FOI-compliant audit trail (who queried what, when, from where) for a date range; (4) applies retention/TTL.
  - **Climax:** she delivers a complete, tamper-evident access log and proves the restricted repository is inaccessible to unauthorized callers.
  - **Resolution:** compliance demonstrated; retention policy applied.

## 3. Glossary

- **OKF** — Open Knowledge Format v0.2 (Google, August 2026); a directory of Markdown files with YAML frontmatter. v0.2 makes provenance (`sources`), trust (`generated`/`verified` → trust tier), and lifecycle (`status`/`stale_after`) first-class. ([ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md))
- **Repository** — the top-level managed unit in OKF Server: one OKF bundle scoped to **one domain**, mapped to its own ArangoDB graph `OKF_{repo_id}`. A deployment hosts **multiple repositories** (one per domain). ([ADR-okf-014](../../../../docs/adr/okf-014-repository-model.md))
- **Domain** — an organizational knowledge scope (e.g. a ministry policy area); reuses Genie's existing **service-category hierarchy** (`/api/service-categories`). One repository = one domain. ([ADR-okf-014](../../../../docs/adr/okf-014-repository-model.md))
- **Concept** — one `.md` document in a repository. **Concept ID** = file path with `.md` removed.
- **Frontmatter** — YAML metadata block at the top of a concept; only `type` is required by OKF.
- **Trust tier** — a level derived from a concept's `verified` field (OKF v0.2 §5.3): unverified / machine-confirmed / human-reviewed. Surfaced to agents as an advisory signal, **not** access control. ([ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md))
- **`stale_after`** — OKF v0.2 absolute date (`YYYY-MM-DD`); a concept is stale when `today ≥ stale_after`. Drives automatic staleness detection for time-bound government knowledge.
- **`sources` (provenance)** — OKF v0.2 frontmatter field recording a concept's source materials with per-source credibility signals (`author`, `usage_count`, `last_modified`).
- **Index file / Log file** — OKF reserved files (`index.md`, `log.md`) for progressive disclosure and change history.
- **OKF Server** — the new Genie service this PRD specifies: an independent component at `components/okf-server/` (Node.js/Express, CommonJS, imports `components/shared/lib/`), behind Kong, that calls the Python dataprep/retriever for indexing/retrieval and manages repositories, curation, governance, and serving. ([ADR-okf-001](../../../../docs/adr/okf-001-okf-server-component-and-stack.md))
- **OKF graph** — the per-repository ArangoDB graph/collections `OKF_{repo_id}_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO` + `OKF_{repo_id}_BM25_VIEW`. ([ADR-okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md))
- **Multi-graph grounding** — unifying retrieval across the free-form `GRAPH` corpus *and* all authorized `OKF_*` repository graphs via retriever fan-out + RRF. ([ADR-okf-012](../../../../docs/adr/okf-012-multi-graph-grounding.md))
- **Structural link graph** — concept-to-concept edges derived from Markdown cross-links (distinct from dataprep's LLM-extracted entity graph), stored in `OKF_{repo_id}_LINKS_TO` with the link's anchor text as `label`.
- **dataprep / retriever** — existing Genie OPEA services; reused and **extended additively** (graph_name wiring, multi-graph fan-out, repo-level retract).
- **Tenant** — an isolated administrative/agency scope on a shared deployment.
- **SST** — the Server-Side Tools initiative (planned, **reduced**): web search (SearXNG) + stream ingestor + governance (PII/circuit-breaker/rate-limit/audit), delivered as LangGraph tools in the GENIE workflows service. The original Registry/Executor/mcpo are subsumed by the workflows service (LangChain Deep Agents + the `mcp` SDK); OKF does NOT depend on them. Full spec: [SST PRD](../prd-server-side-tools.md).
- **Source origin** — the **external, user-owned** Git repository or S3-compatible bucket a repository is synced from (any host/provider; distinct from the Genie framework code repo). Not under Genie's control; consulted **only at sync time**.
- **Source of truth (content)** — after upload + ingestion, the **document-repository** is the single source of truth for all internal Genie components; the external origin is a sync source, not a runtime dependency.
- **Document reference** — a stable identifier/URL into the document-repository that lets the UI, chat citations, and agents link a user to view the original source document in the browser.
- **Producer** — the Genie-native AI component (Epic 7, [ADR-okf-019](../../../../docs/adr/okf-019-ai-driven-okf-producer.md)) that lifts a crawled flat-Markdown dump into governed OKF concept drafts (lifecycle `review`, never auto-published). The generator dual of the OKF parser.
- **Model tier (configurable inference)** — the deployment-configurable LLM backend ([ADR-okf-020](../../../../docs/adr/okf-020-configurable-inference-model-tier.md)): internal granite-4.1-8b via vLLM (default, sovereign) **or** a frontier model via API key (Anthropic, xA­I/Grok, Gemini, OpenAI); external providers are an explicit sovereignty opt-in.
- **Producer job** — the async lifecycle (mirroring `crawl_job`) that tracks crawl→draft progress, logs, and kill.
- **Write-side Orchestrator** (`ingestService`) — the okf-server component that owns the ingest sequence: fetch bundle → unzip → per-concept parse → UPSERT meta → conformance → PII → content-hash dedup → enqueue; returns 202 (never blocks on dataprep). The **only** component that injects ACL labels (it owns repo→tenant/domain). ([ADR-okf-021](../../../../docs/adr/okf-021-write-side-orchestration.md))
- **Ingestion Worker** (`ingestionWorker`) — the okf-server worker that drains `Pending` concept-index jobs (Redis Streams, concurrency 1 / configurable), calls doc-repo → dataprep → graph creation, reconciles orphan chunks via a sweeper. ([ADR-okf-021](../../../../docs/adr/okf-021-write-side-orchestration.md))
- **Graph Router** — the ChatQnA component that selects the **relevant** subset of authorized graphs (domain binding + repo-metadata BM25), capped at `MAX_FANOUT_GRAPHS`, before the retriever fans out. Intelligent selection, not dumb fan-out. ([ADR-okf-024](../../../../docs/adr/okf-024-graph-selection-router.md))
- **Authz Resolver** (`authz-resolver.js`) — the okf-server governance component that resolves a token to `{ graph_names, per_graph_labels, domains }`; per-session cached; default-deny. ([ADR-okf-025](../../../../docs/adr/okf-025-authz-resolver.md))
- **`bundle_version`** — a repo-level monotonic integer minted on each publish transition, threaded onto every chunk/edge/meta doc, and recorded in an immutable `okf_versions` manifest. The unit of citation pinning and version diff. ([ADR-okf-031](../../../../docs/adr/okf-031-versioning-strategy.md))
- **`MAX_FANOUT_GRAPHS`** — the configurable cap (default 5) on how many graphs a single retrieval fans out across; bounded by selection + `Semaphore` concurrency + per-graph timeout. ([ADR-okf-024](../../../../docs/adr/okf-024-graph-selection-router.md))
- **ACL labels (dual role)** — the `t:`/`r:`/`d:`-prefixed labels serve two distinct purposes, never conflated: (1) **ACL enforcement** — a per-graph `chunk_labels` filter applied inside each selected graph at retrieval (per-graph parameterized, never a global union); (2) **selection signal** — the repo's `domain` + concept `tags`/`type` feed the Graph Router's domain-binding and metadata-BM25 steps. ([ADR-okf-024](../../../../docs/adr/okf-024-graph-selection-router.md), [ADR-okf-025](../../../../docs/adr/okf-025-authz-resolver.md))
- **`index_status`** — the per-concept field on `okf_concepts_meta` (`parsed|indexed|failed`) that is the source of truth for ingest progress; the sweeper reconciles orphans against it. ([ADR-okf-021](../../../../docs/adr/okf-021-write-side-orchestration.md))
- **Knowledge Hierarchy** — the curated, bounded, steward-gated service-category taxonomy that the labeler resolves concept labels against (`_fetch_all_labels` → `GET /api/service-categories/categories`). It grows deliberately via **Label Onboarding** (FR-36), never automatically. `service-categories` is the canonical store; the document-repository `labels` collection is one-way-synced from it ([ADR-okf-034](../../../../docs/adr/okf-034-knowledge-hierarchy-canonical-store.md)).

## 4. Features

### 4.1 Repository & Source Management

**Description:** Operators create and manage **multiple OKF repositories** (one per domain) and their Git/S3 sources. Each repository mints its own graph; sources are synced, version-tracked, and change-detected. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Register a repository source **[DEFERRED 2026-08-14]**
**Deferred (2026-08-14):** v1 input surface is browser-first — file selection from any user-accessible location via the browser file picker (FR-37: local disk, mapped shares, synced cloud folders), the crawler (FR-30/33), and manual authoring (FR-25). Server-side Git/S3 source-sync serves a docs-as-code persona that does not exist in the target deployments; it is deferred and can land additively later via the existing `source` field seam (no schema change). Original scope: register a Git or S3 source, validated reachable; credentials referenced from the secret store.
**Consequences:**
- Registering an unreachable/inaccessible source yields a structured error with the failing check; nothing is indexed.
- Credentials never appear in config or logs.
- Sources are **external, user-owned** repos/buckets (any Git host/provider or S3-compatible store), distinct from the Genie framework code repo; each source carries its own credentials and ref.

#### FR-2: Sync and change-detect **[DEFERRED 2026-08-14 — with FR-1]**
**Deferred with FR-1.** The retained-copy semantics that matter (serving continues from the document-repository copy; no query-time origin dependency) are enforced by FR-27 for every shipped input. Original scope: sync on schedule/webhook; change-detect (commit-diff / ETag; SHA-256 idempotency) without full re-ingest.
**Consequences:**
- A source updated with one new concept re-indexes only that concept within the freshness target (NFR-S4).
- Re-syncing an unchanged source performs no re-embedding (SHA-256 match).
- A failed sync is retried with backoff and surfaced as degraded health.
- The system **periodically checks origin reachability** and detects deletion/inaccessibility; if the external origin disappears, the steward is alerted and serving continues from the **retained document-repository copy** (the runtime source of truth) — no silent breakage, and **no query-time dependency on the origin**.

#### FR-3: Version tracking & provenance
Each indexed repository version records its source ref (commit SHA / S3 version), fetch timestamp, curator, and a stable version identifier. Realizes UJ-2, UJ-3.
**Consequences:**
- A concept served to an agent carries its repository + version + concept ID for citation.
- An operator can list versions of a repository and pin/diff them.
- Versioning is consolidated on the **document-repository** (each publish = a versioned snapshot stored there); OKF metadata references the document-repo version, so versions survive even if the external origin is deleted.

#### FR-23: Repository lifecycle & CRUD
An authenticated steward (`tools-admin`) can **create, read/list, update, and delete** repositories. Creating a repository mints `repo_id` and reserves `graph_name = OKF_{repo_id}` (graph created on first ingest); the repository is bound to a domain (service-category key). Deleting a repository cascades — retracts its entire graph + metadata, audited, with a confirmation + retention grace. Realizes UJ-1, UJ-3. ([ADR-okf-014](../../../../docs/adr/okf-014-repository-model.md), [ADR-okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md))
**Consequences:**
- A new domain repository is isolated in its own graph from every other repository.
- List/read is scoped to the caller's authorized domains/repos; delete is irreversible after the grace window and fully audited.

**Feature-specific NFRs:** no outbound calls beyond the declared source endpoint (sovereignty, NFR-S1); CPU-only, no GPU (NFR-S6).

### 4.2 Ingestion & Indexing

**Description:** Ingested repositories are validated against OKF §11, virus-scanned (ClamAV), PII-redacted, parsed into concepts (frontmatter → metadata; Markdown-header chunking; structural link edges with anchor text), and routed through the **document-repository** into **dataprep**, which embeds (TEI) and stores them in the repository's own ArangoDB graph `OKF_{repo_id}` — reusing the existing pipeline additively. Retraction cascades on removal. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-4: Conformance validation (OKF §11)
On ingest, every repository is checked for OKF §11 conformance (parseable frontmatter; non-empty `type`; reserved-file structure). Non-conformance is a **quality gate**, not a hard rejection — issues are surfaced to stewards. Realizes UJ-1.
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

#### FR-22: Bundle content via the document-repository (required)
Bundle/repository content is stored, scanned, and handed to dataprep **through the existing `components/document-repository`** via a new bundle-aware ingest route — reusing the existing component, **not introducing a new storage vendor**. The document-repository **retains the ingested bundle (versioned)** and is the **single source of truth** for all internal Genie components after upload (see FR-27). Realizes UJ-1; [ADR-okf-008](../../../../docs/adr/okf-008-bundle-content-store.md), [ADR-okf-016](../../../../docs/adr/okf-016-external-source-management.md).
**Consequences:**
- Archives/bundle directories are accepted on the new route (the standard upload path's extension allowlist / magic-byte validator / langdetect are bypassed for bundles).
- No new object store or scanning infrastructure is introduced; the document-repository remains the single document/knowledge store.

#### FR-34: Async ingestion pipeline (write-side orchestration)
The OKF Server owns an **async, per-concept, idempotent** ingest pipeline: `POST /api/okf/repos/:repo_id/ingest` → the write-side orchestrator resolves the repo, derives `graph_name`/ACL labels/`bundle_version`, unzips the bundle (zip of `.md`), and per concept parses → UPSERTs `okf_concepts_meta` → runs conformance → PII → content-hash dedup → enqueues an index job → returns **202** (the HTTP call never blocks on dataprep). An ingestion worker (Redis Streams, concurrency 1 / configurable, DLQ) drains `Pending` jobs through doc-repo → dataprep → per-repo graph creation, writes `_LINKS_TO` edges, and transitions `index_status`; a sweeper reconciles orphan chunks. There is **no distributed transaction** — compensation is via the sweeper + per-concept `index_status`. Realizes the store→pending→worker→graph model; [ADR-okf-021](../../../../docs/adr/okf-021-write-side-orchestration.md), [ADR-okf-022](../../../../docs/adr/okf-022-node-python-dataprep-handoff.md).
**Consequences:**
- A steward trigger returns immediately (202); indexing completes asynchronously within the freshness target (SM-1).
- Re-ingesting an unchanged concept performs no re-embedding (content-hash match + `index_status='indexed'`).
- A failed concept is isolated (status `Failed`, DLQ) — it never blocks the rest of the repo, and the sweeper reconciles orphans.
- The orchestrator is the sole ACL-label injector (it owns repo→tenant/domain), so labels are preserved end-to-end (FR-18).

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
Users can **create and curate OKF repositories and their Markdown concept files in-app**: a Markdown concept editor (frontmatter form with `type` required + `title`/`description`/`resource`/`tags` plus the optional **v0.2 families** (`generated`, `verified`, `status`, `stale_after`, `sources` — see [ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md)); Markdown body editor; a **link picker** that inserts `[…](/path/to/concept.md)` from the repository's concept tree; and **live OKF §11 validation** + PII pre-check). Concept CRUD (create/read/update/delete) within a repository; on save → re-parse → incremental re-index → update metadata + structural edges. Reserved files (`index.md`, `log.md`) are generated/synced and editable. Realizes UJ-1. ([ADR-okf-015](../../../../docs/adr/okf-015-in-app-authoring-curation.md))
**Consequences:**
- An author can build a domain repository entirely in-app without external Git tooling (external Git/S3 ingest remains a parallel path via FR-1).
- A non-conformant save is blocked at the editor with a specific §11 error; no invalid concept reaches `published`.

#### FR-36: Pre-ingest Label Onboarding (bounded curation)
Before a repository is indexed, a **pre-ingest dry-run** surfaces the **minimal label gap** — the labels this repo's concepts need that are not yet in the Knowledge Hierarchy — and a **steward wizard** (Analyze → Cluster → Review → Apply) curates them with smart defaults and a live before/after coverage preview. It is **bounded by construction**: gap-only input (only under-labeled concepts), lexical + embedding variant auto-merge (no duplicates / no synonym bloat), frequency + confidence floors, a learned per-domain denylist, a FAIL-not-truncate hard cap, and the FR-32 steward gate (no auto-create). The hierarchy grows deliberately with exactly the labels a repo needs — never "every imaginable word." Realizes the bounded-hierarchy principle; [ADR-okf-033](../../../../docs/adr/okf-033-label-onboarding.md), [ADR-okf-034](../../../../docs/adr/okf-034-knowledge-hierarchy-canonical-store.md).
**Consequences:**
- A new domain repository can be indexed with accurate labels the first time (no re-embed), because the hierarchy is enriched before the first embed.
- The Knowledge Hierarchy stays curated and bounded — additions are steward-approved, deduplicated, and capped per ingest.
- The producer's hierarchy/label proposals (FR-32) feed into the **same** wizard + proposal store — one steward gate for AI-drafted and pre-ingest-gap labels alike.

#### FR-38: Unified "Create & Curate OKF Repository" wizard (3 workflows + curation + validation + auto-correct)
A single wizard delivers **three creation workflows**: **(1) crawler** (multi-URL, FR-30/FR-33), **(2) documents** (select+upload docx/pdf/xlsx/txt/md, FR-37), **(3) manual** (blank/template authoring, FR-25). **Every** workflow funnels into a shared curation stage where a steward can **manually curate** concepts (the in-app editor), run **validation** (OKF §11 conformance, FR-4), and apply **auto-correct facilities** — the wizard proposes/applies fixes: conformance issue auto-remediation (e.g. missing `type`, malformed dates), label auto-mapping (to existing taxonomy via the Label Onboarding engine, FR-36), and broken-link auto-resolution/rescope — each shown as a reviewable, steward-approvable diff (never silently mutating). After curation+validation, the repository moves through review → publish (FR-9/10). The wizard composes Epic 7 (producer: crawler + documents), Epic 9 (label onboarding), Story 2.4 (conformance), and the FR-25 editor into one slick flow. Realizes UJ-1.
**Consequences:**
- A steward has one entry point to build an OKF repository from any source (crawl, documents, or scratch), with consistent curation + validation regardless of input.
- Auto-correct reduces manual toil (conformance/label/link fixes) while keeping a human approver on every change (FR-32) — fixes are proposed, not imposed.
- All three workflows converge on the same steward-gated review/publish lifecycle — no path bypasses curation or validation.

### 4.4 Unified Grounding & Agent Serving

**Description:** RAG responses are grounded in **all available data**. A **unified multi-graph retrieval** extension to the existing retriever fans out across the free-form `GRAPH` corpus *and* every authorized `OKF_{repo_id}` graph, fuses results, and enforces ACL — so chat answers and agent queries see the whole authorized knowledge base. Agents search, fetch, list, and outline with progressive disclosure and token budgeting over **REST now** (the same handlers back an **MCP** surface when the MCP transport lands). Realizes UJ-2.

**Functional Requirements:**

#### FR-24: Unified multi-graph grounding (CORE)
The existing retriever is **extended** so a single retrieval can target a **set of authorized graphs** (`GRAPH` + the caller's `OKF_{repo_id}` set): it runs the existing hybrid path (dense COSINE + BM25 view + optional traversal) per graph, then **RRF-fuses** the per-graph ranked lists, applying `chunk_labels` ACL per graph, and returns a unified ranked list with per-hit `graph_name`/`repo_id`/`concept_id` for citation. ChatQnA forwards the caller's authorized graph set so chat answers ground across all data. Realizes UJ-2. ([ADR-okf-012](../../../../docs/adr/okf-012-multi-graph-grounding.md), [ADR-okf-013](../../../../docs/adr/okf-013-graph-name-wiring.md))
**Consequences:**
- A chat answer can cite concepts from the free-form corpus *and* multiple OKF repositories in one response.
- Adding a new repository immediately participates in grounding for authorized callers — no per-repo wiring per query.
- ACL is enforced per graph (per-graph parameterized labels, never a global union); an unauthorized repository contributes **zero hits** in the fused result.

#### FR-35: Query-aware graph selection (Graph Router)
A **Graph Router** selects the **relevant** subset of the caller's authorized graphs before retrieval: it detects the query domain (domain binding) and ranks candidate repos by metadata relevance (repo-metadata BM25 over `okf_concepts_meta` `title`/`type`/`tags`/`summary`), intersects the result with the authorized set, and caps it at `MAX_FANOUT_GRAPHS` (default 5, configurable). Selection is **distinct from authorization** (the Authz Resolver, FR-18, produces the authorized set; the router selects within it). The selection-latency budget (≤20ms) is a **gate, enforced in CI** against seed fixtures, not an aspiration. The retriever then fans out across the selected set in a single query where the schema allows, with 2-level RRF fusion (FR-24). Realizes the multi-repo scaling requirement; [ADR-okf-024](../../../../docs/adr/okf-024-graph-selection-router.md).
**Consequences:**
- A deployment with 50 repos grounds a query in ≤5 relevant+authorized graphs — bounded fan-out, predictable latency.
- A query tagged "health" binds to health-domain repos before any chunk is read.
- Selection is observable (`graphs_authorized`, `graphs_selected`, `selection_latency_ms`) so precision/latency degradation is diagnosable.

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
- The MCP surface is sequenced after REST, gated on the GENIE workflows service's MCP client (Sprint 24 #603, custom LangChain Deep Agents — transport only; the handlers ship with REST).

#### FR-29: Trust, lifecycle & provenance surfacing (OKF v0.2)
The OKF Server consumes the v0.2 frontmatter families and surfaces them to agents alongside concept content: a derived **trust tier** (unverified / machine-confirmed / human-reviewed, from `verified`), a **staleness signal** (from `stale_after` — stale when `today ≥ stale_after`), and **source provenance** (from `sources`, with per-source credibility signals). Agents can therefore weight and disclose *how much to trust* a concept, *whether it is still current*, and *where it came from*. The families are optional; a concept without them is served as a plain concept (never rejected). Realizes UJ-2. ([ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md))
**Consequences:**
- A served concept carries a trust tier, staleness flag, and source list — enabling agents to cite provenance and gate/refuse stale content.
- A steward's publish sign-off is written as a portable `verified: { by: human:<steward>, at: … }` trust signal.
- Concepts authored without the families are still served — the families are advisory signals, not access control.

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
- **Default-deny**: a token with an undefined/foreign domain receives an **empty** authorized set and a **404** on foreign repos (not the full catalog) — closing the cross-tenant list/read leak.
- Per-repo mutation requires `requireRepoScope(repo_id, 'admin')`, **replacing** the global `tools-admin` role for repository mutations — a steward in tenant A cannot mutate tenant B's repo. ([ADR-okf-025](../../../../docs/adr/okf-025-authz-resolver.md))
- An **Authz Resolver** (`authz-resolver.js`) owns the token→`{graph_names, per_graph_labels, domains}` translation (per-session cached); the Graph Router (FR-35) consumes its output. ([ADR-okf-025](../../../../docs/adr/okf-025-authz-resolver.md))

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

### 4.8 Source of Truth & Document References

**Description:** After upload + ingestion, the **document-repository is the single source of truth** for OKF content inside Genie — internal components never depend on the external origin at runtime. The external origin (Git/S3) is *retained-but-not-controlled*: the system checks it periodically and degrades gracefully if it disappears. Stable document-repository references let the UI, chat citations, and agents link users to the original source documents. Realizes UJ-1, UJ-2, UJ-3.

**Functional Requirements:**

#### FR-27: Document-repository as single source of truth (post-ingest)
Once a repository is uploaded, the document-repository holds the retained, versioned copy and is the authoritative content source for all internal Genie components (dataprep, retriever, OKF Server, frontend). Internal components do **not** reach back to the external Git/S3 origin at query/serve time; the origin is consulted only at sync (FR-2). Realizes UJ-1, UJ-2. ([ADR-okf-008](../../../../docs/adr/okf-008-bundle-content-store.md), [ADR-okf-016](../../../../docs/adr/okf-016-external-source-management.md))
**Consequences:**
- Removing/deleting the external origin does not break serving — the retained document-repository copy is used and the steward is alerted to the origin's absence.
- Re-index/re-serve uses the document-repository copy, never the origin.

#### FR-28: Stable document references & "view source" links
The document-repository exposes **stable document references** (IDs/URLs) for every ingested concept/bundle; the OKF Server, admin UI (FR-26), chat citations, and agent responses (FR-15) use them to link users to **view the original source document in the browser**. Realizes UJ-2.
**Consequences:**
- A served concept/chunk carries a resolvable link to its source document in the document-repository.
- Links remain stable across re-indexes (tied to the document-repo document ID, not a transient path or the external origin).

### 4.9 AI-Driven OKF Production (Crawl → Draft)

**Description:** A Genie-native AI producer lifts the web crawler's flat Markdown output into governed OKF concept drafts, as the **rapid means of creating OKF repositories** (testing/bootstrapping) and of automating knowledge-hierarchy + label assignment. Drafts enter lifecycle `review`; a steward approves before publish. The model tier is configurable (internal granite or frontier API). Crawls are **tightly integrated** with OKF repository creation in the Vue admin UI — a crawl can directly create/seed an OKF repository. Realizes UJ-1.

**Functional Requirements:**

#### FR-30: AI-driven production from crawl results
An authenticated steward (`tools-admin`) can trigger production of OKF concept drafts from a completed crawl (or declare OKF intent at crawl creation), and the producer segments the flat dump, derives concept title/summary/frontmatter, and writes drafts to `okf_concepts_meta` at `review` — **never auto-published**, with `generated.by=agent:okf-producer` and a server-enforced `unverified` trust tier. Realizes UJ-1. ([ADR-okf-019](../../../../docs/adr/okf-019-ai-driven-okf-producer.md))
**Consequences:**
- A crawl can be used directly to create/seed an OKF repository (a first-class target in the existing crawl UI — `AddFromLinkDialog` and `FileDetailsDialog`).
- Drafts are **assembled from the crawl, then AI-adjusted and cross-linked** (structural link graph, FR-7) to form the most structured repository/bundle; cross-link targets are constrained to a closed concept-ID namespace to resist fabrication.
- No AI-produced concept reaches `published` without steward sign-off (FR-10); drafts route through Presidio PII redaction (blocking) and ClamAV before staging.

#### FR-31: Configurable inference model tier
The producer's model is deployment-configurable: internal granite-4.1-8b (vLLM, OpenAI-compatible, default) **or** a frontier model via API key — Anthropic, xA­I/Grok, Gemini, OpenAI. External providers require an explicit sovereignty opt-in (`LLM_EXTERNAL_EGRESS_ENABLED`, fail-closed); the default remains sovereign/air-gap-safe. Realizes UJ-1. ([ADR-okf-020](../../../../docs/adr/okf-020-configurable-inference-model-tier.md))
**Consequences:**
- A sovereign/air-gapped deployment runs internal-only; an opt-in deployment may use a frontier model for higher draft quality.
- Provider API keys live only in `.env`/vault (never in code or the committed `env` template); new provider deps pass the blocking container scan + CycloneDX SBOM (ADR-0001).

#### FR-32: Automated knowledge-hierarchy + label assignment
The producer proposes knowledge-hierarchy additions (categories/services) and assigns per-concept labels that flow into both **ingest** (embeddings via `chunk_labels`) and **query** (the retriever label filter), reusing the existing service-category CRUD + label mechanism; proposals are steward-approved (staged `pending`). Realizes UJ-1.
**Consequences:**
- Producer-assigned labels steer retrieval (full effect after Story 2.6 ACL-preserve + Epic 1 multi-graph fan-out land — both gated).
- **All producer-proposed knowledge-hierarchy/label edits are staged `pending` and require explicit human (steward) approval before any write** — the producer never mutates the service-category taxonomy directly (no auto-create).

#### FR-33: Multi-source crawl seeding
The web crawler accepts **multiple seed URLs** per crawl job (not only one), so a repository draft can be assembled from several authoritative sources/sites about a domain. Realizes UJ-1.
**Consequences:**
- `crawl_job` carries a seed-URL list; the existing `Crawler.crawl(pool,…)` (already array-capable) is fed the list.
- The crawl UI (`AddFromLinkDialog`) collects multiple seeds for an OKF-target crawl.

#### FR-37: Produce OKF repository from selected uploaded documents
A steward can select **multiple documents already uploaded to the document-repository** (in the existing supported formats — docx, pdf, xlsx, txt, md, etc.) and produce an OKF repository draft from them. The producer reads each selected document's extracted text (reusing the document-repository's existing text-extraction), segments it into concepts, drafts/derives frontmatter, AI-adjusts and cross-links (FR-30/FR-7), and stages the drafts at `review` through the **same** steward-gated pipeline + Label Onboarding wizard (FR-36) as the crawl path. This is the third curation input source — the producer's core (segment → draft → adjust → cross-link → label-onboard → steward gate) is **source-agnostic**; only the input adapter differs. Realizes UJ-1. ([ADR-okf-019](../../../../docs/adr/okf-019-ai-driven-okf-producer.md), [ADR-okf-033](../../../../docs/adr/okf-033-label-onboarding.md))
**Consequences:**
- A steward can assemble an OKF repository from documents the organization already holds (policy PDFs, docx reports, spreadsheets, existing markdown) — no crawl required.
- Reuses the document-repository's text-extraction + ClamAV (already run at upload); no new ingestion format.
- Drafts route through Presidio (blocking) + the Label Onboarding wizard + steward approval — never auto-published.

> **Three curation paths (explicit).** An OKF repository can be created/curated via three paths, all converging on the same steward-gated review/publish lifecycle (FR-9/10) + Label Onboarding (FR-36): **(1) Manual** — in-app Markdown authoring (FR-25); **(2) Crawler** — multi-URL web crawl → producer drafts (FR-30/FR-33, Epic 7); **(3) Documents** — selected uploaded documents → producer drafts (FR-37, Epic 7).

**Feature-specific NFRs:** steward-gated, never auto-publish (FR-9/10); sovereignty opt-in for external models (NFR-S1); supply-chain scan for new deps (NFR-S5); CPU-only OKF Server — inference is a remote call (NFR-S6).

---

## 5. Non-Goals (Explicit — product boundaries, not temporal deferrals)

- **Not a producer-replacement for external catalogs.** Exporting from Dataplex/Collibra/Unity is done by external producers; OKF Server *hosts and serves*, and offers in-app authoring for human curators.
  - **Amendment (2026-08-12, [ADR-okf-019](../../../../docs/adr/okf-019-ai-driven-okf-producer.md)):** a **bounded Genie-native, steward-gated AI producer** (Epic 7) is permitted — it lifts the web crawler's output into OKF concept *drafts* (lifecycle `review`, never auto-published, trust-capped `unverified`) to rapidly create repositories and automate hierarchy/labels. This is distinct from the excluded catalog-export replacement; it is the in-boundary sovereign path for internal web content and for bootstrapping/testing.
- **Not a formal ontology / OWL / SHACL reasoning engine.** OKF is spec-pure; relationships are conveyed by links + prose. (Optional taxonomy via frontmatter/tags only.)
- **Not a replacement for dataprep/RAG or the retriever.** OKF Server extends them; it does not duplicate storage/retrieval.
- **Not introducing new infrastructure vendors.** No Neo4j (any edition), no separate vector DB, no Elasticsearch/Solr, no external SaaS.
- **Not multimodal (images/audio).** Text/Markdown OKF concepts only.
- **Not raw-AQL-to-agents.** Agents get parameterized traversal only — never arbitrary AQL. ([ADR-okf-011](../../../../docs/adr/okf-011-no-raw-aql-to-agents.md))
- **Not a distributed-transaction system.** Cross-service ingest (okf-server → doc-repo → dataprep) is **not atomic**; consistency is achieved by compensation — a sweeper reconciles orphan chunks against per-concept `index_status`. ([ADR-okf-021](../../../../docs/adr/okf-021-write-side-orchestration.md))
- **No cross-repo structural links in v1.** Concept cross-links are **within-repo only**; a link to a concept in another repository is rejected at parse (with a conformance warning). Cross-domain retrieval happens via search (FR-14), not structural traversal. ([ADR-okf-028](../../../../docs/adr/okf-028-cross-repo-structural-links.md))
- **Not a replacement for the existing single-document flow.** The existing document upload → ClamAV → text-extract → ingest path (into the free-form corpus) remains unchanged and fully supported. The OKF creation/curation flows (FR-36/FR-37/FR-38) are **additive**; the shared enhancements (the Label Onboarding engine, conformance validation, auto-correct) improve **both** the existing single-document path and the OKF paths where applicable — no regressions.

## 6. Production Scope

**In Scope (production — sequenced in [Architecture](./architecture.md) §12):**
- Multiple OKF repositories (one per domain), repository CRUD, each in its own graph `OKF_{repo_id}` (FR-1, 2, 3, 23).
- OKF-aware ingestion via the document-repository: §11 conformance, ClamAV, PII redaction, parsing, structural link graph, per-repo indexing, repo-level retract (FR-4, 5, 6, 7, 8).
- **Async write-side orchestration** — the ingest pipeline that sequences the above end-to-end: orchestrator + Redis-Streams worker + idempotent content-hash re-ingest + orphan sweeper (FR-34); **Epic 2.9**.
- **Query-aware graph selection** — the Graph Router that bounds multi-graph fan-out to relevant+authorized graphs (FR-35); **Epic 1 Story 1.3** (gated by the OPEA bump).
- Curation & in-app authoring: lifecycle, review/approve, versioning, retention, metrics, in-app Markdown concept editor with live §11 validation (FR-9, 10, 11, 12, 13, 25).
- **AI-driven production (Crawl → Draft)** — Epic 7: steward-gated producer from crawled content; configurable model tier; automated hierarchy/labels (FR-30, 31, 32).
- Unified multi-graph grounding + agent serving: retriever fan-out+RRF across `GRAPH` + authorized `OKF_*`; search/get/list/outline; MCP-ready handlers; **trust/lifecycle/provenance surfacing** (FR-24, 14, 15, 16, 17, 29).
- Vue 3 admin ingestion & curation UI (FR-26).
- Access control, governance, traceability; observability & operations (FR-18, 19, 20, 21).
- Source of truth & document references: document-repository as single source of truth post-ingest; stable doc-repo references + "view source" links; external-origin health checks + deletion detection + graceful fallback (FR-27, 28; FR-2).
- **Test infrastructure & evaluation** — a deterministic fixture suite (static crawl site + seed repos + golden queries) + multi-graph integration tests + retrieval-quality + RRF-sweep eval harnesses; **Epic 8** (the highest-leverage testing investment — makes "verify the strategy is solid" measurable).
- **Pre-ingest Label Onboarding** — a bounded, curator-driven wizard that adds exactly the new labels a repo needs (gap-only + variant merge + denylist + a FAIL-not-truncate cap + the FR-32 steward gate); **Epic 9**. Keeps the Knowledge Hierarchy curated, never "every word".
- Open-source packaging (permissive license, ITU copyright headers, CI build/scan/promote per ADR-0001).

**MCP transport** is the only capability sequenced after the REST surface (gated on the GENIE workflows service's MCP client — Sprint 24 #603, custom LangChain Deep Agents — transport only; the handlers ship with REST). OKF's own MCP surface is **custom** (Node MCP SDK / Kong AI MCP proxy), consumed by the workflows service — NOT OPEA's `OpeaMCPToolsManager`/`mcpo`.

## 7. Success Metrics

**Primary**
- **SM-1**: Repository-to-agent latency — a newly registered/created repository is validated, indexed into its own graph, and queryable within the freshness target (default ≤15 min; configurable). Validates FR-2, 6, 23.
- **SM-2**: Reuse integrity — retrieval against `OKF_{repo_id}` graphs works with **only additive** changes to dataprep/retriever (no breaking schema changes). Validates FR-6, 24.
- **SM-3**: Unified grounding — agents resolve a query to citable, version-pinned concepts across the free-form corpus *and* OKF repositories with ≥X% precision on a reference set. Validates FR-24, 14, 15, 11.

**Secondary**
- **SM-4**: Governance completeness — 100% of served responses pass per-repo RBAC and produce an audit record; FOI export succeeds for any date range. Validates FR-18, 19.
- **SM-5**: Sovereignty — zero outbound calls to non-declared endpoints; air-gapped deployment passes validation. Validates NFR-S1.
- **SM-6**: Curation velocity — median repository review→publish time; conformance/PII issue detection rate; in-app authoring adoption. Validates FR-10, 13, 25.
- **SM-7**: Bootstrap velocity — a crawled source becomes a review-ready OKF repository (drafts staged) within a target time; **guardrail: steward rejection rate** (too low ⇒ rubber-stamping; too high ⇒ poor drafts). Validates FR-30, 31, 32. Reaffirms SM-C1 (quality over volume).

**Counter-metrics (do not optimize)**
- **SM-C1**: Raw concept-count ingested — optimizing volume can degrade precision; do not game SM-3 by indexing low-quality content.
- **SM-C2**: Tokens returned per query — do not inflate responses; token caps protect agent context (optimizing against SM-C2 defeats progressive disclosure).

**Launch gates (must pass before any pilot — from the 2026-08-13 course correction)**
- **LG-1**: p95 search latency vs graph-count benchmark inside NFR-PR1 at `MAX_FANOUT_GRAPHS` — proves the multi-repo scaling claim (G6).
- **LG-2**: Isolation test — a caller scoped to repo A cannot retrieve repo-B chunks in a fused result (G3/G8/G15).
- **LG-3**: ACL-preserve regression green — `t:`/`r:`/`d:` labels survive ingest into `chunk_labels` (G4).
- **LG-4**: Audit write-before-respond verified for a governance action under ArangoDB failure — SM-4 holds when it matters (G16).
- **LG-5**: Boundary probe — `graph_names` survives the ChatQnA→retriever mega-service boundary **deployed**, not just in-process (G2).

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

- **dataprep + retriever (exist — reused, extended additively)** — per-repo indexing via `graph_name = OKF_{repo_id}`; retriever multi-graph fan-out + RRF (FR-24); repo-level retract; graph_name wiring (doc-repo → dataprep; ChatQnA → retriever). ([ADR-okf-013](../../../../docs/adr/okf-013-graph-name-wiring.md)) These extensions are **greenfield** (multi-graph fan-out and `graph_name` threading do not exist today) and land on the bumped (1.5) base — see the OPEA 1.5 bullet below.
- **document-repository (extended)** — new bundle-aware ingest route (storage + ClamAV + dataprep handoff, carrying `graph_name`). (FR-5, [ADR-okf-008](../../../../docs/adr/okf-008-bundle-content-store.md))
- **gov-chat-frontend (extended)** — new OKF admin tab + dialogs + service + Vuex module + i18n. (FR-26)
- **api-gateway (Kong + NGINX)** — register `okf-server` service + `/api/okf` route; Kong AI MCP plugins for the MCP surface.
- **Keycloak** — OIDC AS; per-tenant/repo/domain scopes; audience mapper; token-exchange for service-to-service.
- **[SST](../prd-server-side-tools.md) (draft, reduced)** — web search + stream ingestor + governance only (registry/executor/mcpo subsumed by the workflows service); gates the **MCP transport** indirectly; REST + handlers proceed independently.
- **OPEA 1.3 → 1.5 overlay bump (cheap, ~3–5 engineer-days; foundational)** — the Genie-owned `dataprep`/`retriever`/`reranker`/`chatqna` that OKF extends are rebased onto `comps` 1.5. The verified v1.3↔v1.5 `comps` source diff showed every API OKF's base depends on (`OpeaComponent`, `register_microservice`, `opea_telemetry`, `api_protocol`) is byte-identical or additive, so the RAG logic is **untouched** and remains Genie-owned/forked — we do **not** adopt OPEA's components wholesale, and we do **not** use OPEA's `comps/agent` (the agentic layer is custom LangChain Deep Agents on the OPEA `MicroService` harness). OKF Phase 1 (multi-graph fan-out + `graph_name` threading — both **greenfield**) lands on the bumped base. File-by-file detail: the OPEA Strategy & Implementation Plan (`_bmad-output/planning-artifacts/OPEA-1.5-upgrade-analysis.md`). **Timing decision (D24, 2026-08-13):** the team **waits for !277 to merge to `main` — no slip date, and no fallback shim is built now.** All bump-gated work (Epic 1 multi-graph grounding; Epic 2 Story 2.6 / 2.9.6 graph-wiring + retract) stays frozen until the merge. A serial-fan-out fallback shim *design* is documented as a **contingency only** ([ADR-okf-023](../../../../docs/adr/okf-023-graph-names-transport.md), Story 8.5) — it is built **only if** the team later decides to ungate Epic 1 before the bump merges.

- **AI-driven producer (Epic 7, [ADR-okf-019](../../../../docs/adr/okf-019-ai-driven-okf-producer.md))** — depends on Story 2.2 (repo CRUD, done), **2.3 (parser — defines the frontmatter contract the producer emits)**, 2.5 (bundle ingest route), Epic 3 (admin UI drives it); co-develops with 4.2/4.3/4.4 (editor + lifecycle + review gate). Producer-assigned labels fully steer retrieval after Story 2.6 (ACL-preserve) + Epic 1 (multi-graph fan-out) — both gated by the OPEA 1.5 bump.

## 11. Data Governance

- **Residency/Sovereignty**: all content, metadata, audit, and traces stay inside the deployment boundary; air-gap deployable; no third-party egress.
- **Classification**: repositories/concepts carry sensitivity (frontmatter/tags/steward-set); drives access policy.
- **Retention**: per-tenant/per-domain retention/TTL with audited retraction (FR-12).
- **Lineage/Provenance**: source ref → concept → served answer is capturable for citation and audit (FR-3, 11, 19).
- **Audit**: FOI-exportable access log (FR-19, NFR-T2).

## 12. Why Now

- OKF v0.2 published August 2026 (v0.1 June 2026); v0.2's first-class provenance/trust/lifecycle families are a strong fit for sovereign government knowledge. Google explicitly invited the ecosystem to build consumers/serving layers — the white space is open and uncontested by any OSS project.
- Genie's dataprep/RAG + ArangoDB + Keycloak/Kong/OTel stack already provides ~80% of the foundation; multi-repo + multi-graph grounding are additive extensions.
- Sprint 24's **custom LangChain Deep Agents (on LangGraph)** agentic workflows — built on the OPEA `MicroService` harness, not OPEA's `comps/agent` — need a governed knowledge-serving surface that grounds in all data.
- Sovereign/public-sector demand for governed, multi-domain agent knowledge is immediate and unmet.
- The producer is the **rapid repo-creation enabler** that unblocks testing of curation (Epic 4) and serving (Epic 5), and fills the sovereign internal-content gap external cloud producers cannot reach (they require egress, NFR-S1).

## 13. Open Questions

1. **PII strategy** granularity (document-level vs field-level redaction) — confirm default. (→ [ADR-okf-004](../../../../docs/adr/okf-004-pii-redaction-strategy.md))
2. ~~**Versioning semantics** — repository-level `okf_version` vs per-concept versioning for citation pinning.~~ **RESOLVED (2026-08-13):** repo-level `bundle_version` integer minted on publish, threaded onto chunks/edges/meta, with an immutable `okf_versions` manifest. (→ [ADR-okf-031](../../../../docs/adr/okf-031-versioning-strategy.md))
3. **403-vs-404** on unauthorized concept access (security trade-off). (→ [ADR-okf-006](../../../../docs/adr/okf-006-403-vs-404-unauthorized.md))
4. **`repo_id` format** + maximum repositories per deployment (ops sizing).
5. **Domain mapping** — domain = service-category *top-level* category vs any node in the hierarchy.
6. **Retention defaults** per domain (regulatory variation).
7. ~~**RRF weights** for cross-graph fusion (tune empirically).~~ **RESOLVED (2026-08-13):** 2-level cross-graph RRF (within-graph dense⊕BM25 → cross-graph, weighted by per-graph size/confidence). Weights tuned against seed fixtures via the parameter-sweep harness (Story 8.4), not intuition. (→ [ADR-okf-027](../../../../docs/adr/okf-027-cross-graph-rrf.md))
8. **Performance targets** (NFR-PR1 p95 latency, freshness target SM-1) — confirm values.
9. Whether the free-form `GRAPH` corpus should also become domain-partitioned later (not required now; stays single).
10. **Attested Computation** (OKF v0.2 §10) — deferred to a future phase; its runtime protocol is itself spec-deferred. Decide whether/when government metrics/reporting justify building it. (→ [ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md))
11. **Producer default model tier** for the bootstrap landing — internal granite (sovereignty-safe) vs frontier (egress)? (→ [ADR-okf-020](../../../../docs/adr/okf-020-configurable-inference-model-tier.md))
12. **Concept segmentation policy** — one concept per crawled page (default, cheap) vs cluster-into-concepts (better, more LLM cost)?
13. **Producer-trigger authorization** — who can trigger crawl→OKF (`tools-admin` vs operator vs agent), and what per-tenant/per-crawl quotas bound GPU/provider cost? (→ [ADR-okf-019](../../../../docs/adr/okf-019-ai-driven-okf-producer.md))
14. **Concept-quality evaluation harness** — ownership + the SM-3 reference set that makes the steward-rejection-rate guardrail (SM-7) measurable.
15. **Output-bundle licensing** — a `license`/provenance discipline for AI-produced concepts (derivative-work/ND/Crown-copyright) for cross-pilot reuse and FOI cleanliness.

> Resolved questions (service shape → [okf-001](../../../../docs/adr/okf-001-okf-server-component-and-stack.md); multi-tenancy/graph model → [okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md); auth placement → [okf-003](../../../../docs/adr/okf-003-standalone-service-behind-kong.md); admin UI → [okf-007](../../../../docs/adr/okf-007-admin-steward-ui.md)/[okf-015](../../../../docs/adr/okf-015-in-app-authoring-curation.md); bundle store → [okf-008](../../../../docs/adr/okf-008-bundle-content-store.md)) are decided — see the ADRs.

## 14. Assumptions Index

- `[ASSUMPTION: source sync runs async on Redis Streams + DLQ, not inline]` (§4.1)
- `[ASSUMPTION: webhooks supported; scheduled poll is the baseline fallback]` (§4.1)
- `[ASSUMPTION: p95 search latency ≤ 300 ms on CPU nodes]` (NFR-PR1)
- `[ASSUMPTION: RRF fusion reuses the retriever's existing rrf_fuse]` (FR-24)
- `[ASSUMPTION: append-only/signed audit log specifics in Architecture]` (FR-19)
