---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories]
inputDocuments:
  - ./prd.md
  - ./architecture.md
  - ../../project-context.md
  - ../../../../docs/adr/okf-001-okf-server-component-and-stack.md
  - ../../../../docs/adr/okf-010-okf-markdown-loader-location.md
  - ../../../../docs/adr/okf-011-no-raw-aql-to-agents.md
  - ../../../../docs/adr/okf-012-multi-graph-grounding.md
  - ../../../../docs/adr/okf-013-graph-name-wiring.md
  - ../../../../docs/adr/okf-014-repository-model.md
  - ../../../../docs/adr/okf-015-in-app-authoring-curation.md
  - ../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md
  - ../../../../docs/adr/okf-018-okf-control-plane-storage.md
prd_key: okf-server
initiative: agentic-enablement
branch: feat/okf-server
---

# GENIE.AI OKF Server — Epic Breakdown

## Overview

This document decomposes the OKF Server PRD (FR-1..FR-29), Architecture (§13 six-phase sequencing), and project conventions into implementable epics and stories. It is the source for sprint planning and GitLab issue sync. Detailed per-story specs are produced later by `bmad-create-story` (one story at a time); this document holds the story *list* with core acceptance criteria.

> **Greenfield component.** The OKF Server is a new Node.js/Express service at `components/okf-server/` (CommonJS, `createApp()`, imports `components/shared/lib/`), behind Kong. Architecture §8 is the floor-to-ceiling change manifest.

## Requirements Inventory

### Functional Requirements

- **FR-1**: Register a repository source (Git/S3; validated reachable; credentials from secret store, never plaintext).
- **FR-2**: Sync + change-detect (Git commit-diff; S3 ETag/LastModified; SHA-256 idempotency; periodic origin-health check + graceful fallback to retained copy).
- **FR-3**: Version tracking & provenance (source ref, fetch timestamp, curator, stable version id; consolidated on document-repository).
- **FR-4**: Conformance validation (OKF §11; non-blocking quality gate).
- **FR-5**: Safe ingest via document-repository (ClamAV + PII redaction; PII failure blocking).
- **FR-6**: OKF-aware parsing & indexing (frontmatter→metadata; header-aware chunking; per-repo graph `OKF_{repo_id}`; additive `concept_id`/`bundle_version`/`source_type:"okf"`).
- **FR-7**: Structural link graph (Markdown cross-links → directed edges with anchor text; broken links tolerated).
- **FR-8**: Incremental re-index & retraction (concept/bundle/repo level; orphan cleanup).
- **FR-9**: Repository/concept lifecycle states (`register→validate→review→approve→publish→version→deprecate→retire`; only `published` served).
- **FR-10**: Review & approval gate (`tools-admin`/steward; approver+timestamp; reject with reason).
- **FR-11**: Versioning & provenance (immutable version per publish; lineage source→concept→answer; version diff/list).
- **FR-12**: Retention / TTL (per-tenant/domain; audited retraction).
- **FR-13**: Quality & conformance metrics (per-repo dashboard; conformance issues, PII hits, broken links, staleness).
- **FR-14**: Search concepts (unified; ranked; token-capped; cursor-paginated; RBAC-scoped).
- **FR-15**: Get concept document (full/sliced; version-pinned; 403-not-404 on unauthorized).
- **FR-16**: List repositories & outline (`index.md` progressive disclosure).
- **FR-17**: MCP-ready surface (search/get/list/outline + parameterized `neighbors`; REST now, MCP transport gated on workflows service MCP client).
- **FR-18**: Authentication & per-tenant/repo/domain authorization (Keycloak OIDC at Kong; `okf:{tenant}:{repo}:{read|admin}` scopes as `chunk_labels`; audience-bound RFC 8707; no passthrough).
- **FR-19**: Audit (FOI-exportable; append-only; tamper-evident).
- **FR-20**: End-to-end tracing (OTel spans + W3C `traceparent` across OKF→retriever→LLM; PII filtered).
- **FR-21**: Health, readiness & metrics (Prometheus; non-root container).
- **FR-22**: Bundle content via document-repository (new bundle route; no new storage vendor).
- **FR-23**: Repository lifecycle & CRUD (mint `graph_name=OKF_{repo_id}`; cascade delete; audited; grace window).
- **FR-24**: Unified multi-graph grounding (retriever fan-out + RRF across `GRAPH` + authorized `OKF_*`; `chunk_labels` ACL per graph; per-hit `graph_name`/`repo_id`/`concept_id`).
- **FR-25**: In-app concept authoring & curation (Markdown editor; v0.2 families `generated`/`verified`/`status`/`stale_after`/`sources`; link picker; live §11 validation + PII pre-check).
- **FR-26**: Vue 3 admin OKF ingestion & curation UI (tab + dialogs + service + Vuex `okf` module + `okf.*` i18n).
- **FR-27**: Document-repository as single source of truth (post-ingest; no query-time origin dependency).
- **FR-28**: Stable document references & "view source" links.
- **FR-29**: Trust, lifecycle & provenance surfacing (derived trust tier from `verified`; staleness from `stale_after`; source provenance from `sources`).

### Non-Functional Requirements

- **NFR-P1**: Mandatory PII redaction on ingest (Presidio, library mode); failure blocking. **NFR-P2**: Data minimization. **NFR-P3**: Right-to-erasure cascade.
- **NFR-S1**: Sovereignty (no egress except declared sources; air-gappable). **NFR-S2**: Per-tenant+repo+domain RBAC; audience-bound; no passthrough. **NFR-S3**: TLS in transit + at rest. **NFR-S4**: Idempotent content-hash incremental re-index; backoff retry. **NFR-S5**: Supply-chain (CycloneDX SBOM, signed images, blocking container scan). **NFR-S6**: CPU-only, non-root containers. **NFR-S7**: No breaking chunk-schema changes; additive only; reuse TEI.
- **NFR-R1**: Stateless serving tier, horizontally scalable. **NFR-R2**: Ingest resilience (Redis Streams + DLQ). **NFR-R3**: Graceful degradation (last-good index). **NFR-R4**: HA inherits deployment SLA.
- **NFR-T1**: OTel + `traceparent`; PII filtered. **NFR-T2**: FOI-exportable audit. **NFR-T3**: Metrics + structured logging into Victoria*/Grafana.
- **NFR-PR1**: p95 search ≤ 300 ms (assumption, CPU nodes). **NFR-PR2**: Per-response token cap configurable.

### Additional Requirements (from Architecture)

- **Greenfield Node component** at `components/okf-server/` — CommonJS, `createApp()` pattern, imports `components/shared/lib/`. Impacts Epic 2 Story 2.1. (Architecture §8.1)
- **OPEA 1.5 bump dependency (!277)** gates the Python query-side surface (retriever fan-out, ChatQnA). The Epic 2 dataprep changes are additive and **not** gated. (Architecture §13 step 0)
- **Kong + compose + Ansible + CI** wiring for `okf-server` (service + `/api/okf` route + MCP plugins; image build/scan/promote per ADR-0001). (Architecture §8.6)
- **Keycloak** `okf:{tenant}:{repo}:{read|admin}` scopes + `tools-admin` role + audience mapper. (FR-18)
- **Latent bug fixes alongside**: dataprep retract default mismatch (`genie_graph`→`GRAPH`/request); stale `RETRIEVER_ARANGO_GRAPH_NAME` env hint → `ARANGO_GRAPH_NAME`. (Architecture §8.7)
- **Single ArangoDB database** for free-form + OKF graphs + control-plane collections; isolation by name-prefix + `chunk_labels`. (ADR-okf-018)

### UX Design Requirements (derived from Architecture §7 — no standalone UX spec)

- **UX-DR1**: New "OKF Repositories" tab on `AdminDashboard.vue` (Options API, Vuex, `httpService`→`/api`).
- **UX-DR2**: `OkfRepositoryDialog.vue` — create/edit repository; domain picker via `serviceTreeService.getAdminCategories()`.
- **UX-DR3**: `OkfConceptEditor.vue` — frontmatter form incl. v0.2 families; Markdown body (`marked`/`DOMPurify`); link picker from concept tree; live §11 validation + PII pre-check.
- **UX-DR4**: `OkfRepositoryDetails.vue` — tabs: Concepts tree, Conformance/PII, Versions, Source/Sync, Audit; actions Sync/Validate/Publish/Retire/Delete.
- **UX-DR5**: `OkfIngestionProgress.vue` — live ingest/sync polling (`{ silent: true }` pattern).
- **UX-DR6**: `okf.*` i18n tree across all locales (English source of truth).
- **UX-DR7**: DS primitives per frontend design system; `tools-admin`/admin role enforced on mutating actions at Kong + OKF Server.

### FR Coverage Map

| FR | Epic | Notes |
|---|---|---|
| FR-1 | Epic 2 | Register source |
| FR-2 | Epic 2 | Sync + change-detect |
| FR-3 | Epic 2 | Version tracking at ingest |
| FR-4 | Epic 2 | Conformance §11 |
| FR-5 | Epic 2 | Safe ingest (ClamAV + PII) |
| FR-6 | Epic 2 | Parse + index per-repo graph |
| FR-7 | Epic 2 / Epic 5 | Link graph (store) / neighbors traversal |
| FR-8 | Epic 2 | Incremental + retract |
| FR-9 | Epic 4 | Lifecycle states |
| FR-10 | Epic 4 | Review/approve gate |
| FR-11 | Epic 4 | Versioning + provenance |
| FR-12 | Epic 4 | Retention/TTL |
| FR-13 | Epic 2 / Epic 4 | Quality metrics |
| FR-14 | Epic 5 | Search |
| FR-15 | Epic 5 | Get concept |
| FR-16 | Epic 5 | List + outline |
| FR-17 | Epic 5 | MCP-ready |
| FR-18 | Epic 6 | Authn/authz |
| FR-19 | Epic 6 / Epic 4 | Audit / FOI export |
| FR-20 | Epic 6 | Tracing |
| FR-21 | Epic 2 / Epic 6 | Health (skeleton) / metrics |
| FR-22 | Epic 2 | Bundle via doc-repo |
| FR-23 | Epic 2 | Repo CRUD |
| FR-24 | Epic 1 | Multi-graph grounding |
| FR-25 | Epic 4 | In-app authoring |
| FR-26 | Epic 3 | Vue admin UI |
| FR-27 | Epic 2 | Doc-repo source of truth |
| FR-28 | Epic 2 | Document references |
| FR-29 | Epic 5 | Trust/provenance surfacing |
| FR-30 | Epic 7 | AI-driven production (crawl→draft) |
| FR-31 | Epic 7 | Configurable model tier |
| FR-32 | Epic 7 | Automated knowledge-hierarchy + labels (steward-vetted) |
| FR-33 | Epic 7 | Multi-source crawl seeding |
| FR-34 | Epic 2.9 | Async ingestion pipeline (write-side orchestration) — *added 2026-08-13* |
| FR-35 | Epic 1 (Story 1.3) | Query-aware graph selection (Graph Router) — *added 2026-08-13; gated by bump* |
| FR-36 | Epic 9 | Pre-ingest Label Onboarding (bounded curation wizard) — *added 2026-08-13* |
| FR-37 | Epic 7 | Produce OKF from selected/uploaded documents (3rd curation path) — *added 2026-08-13* |

## Epic List

> **Cross-Pillar Dependencies (confirmed with the team).** OKF is one of four agentic-enablement pillars; these are the dependencies that shape build order:
>
> | Dependency | Impact on OKF | Gate |
> |---|---|---|
> | **OPEA 1.5 bump** (!277, `feat/opea-1.5-upgrade/prd`) | **All OKF Python work lands on the bumped base** — Epic 1 (retriever fan-out + ChatQnA) **and** Epic 2 Story 2.6 (dataprep graph_name wiring + metadata + repo-level retract). | **Hard gate** — both wait for !277 to merge to `main`. |
> | **Agentic workflows** (!280, `feat/agentic-workflows`) | Agentic **grounds in OKF via REST now** (depends on OKF Epic 5 serving for grounding data). OKF's **MCP transport** (Story 5.6) is gated on the agentic service's MCP client landing. | REST: none (agentic consumes when ready). MCP (5.6): gated on agentic MCP client. |
> | **SST** (!279, `feat/sst`) | **Pattern only — no code dependency.** OKF follows the SST Redis Streams + DLQ pattern for ingest resilience (NFR-R2); it imports no SST code and owns its own PII (Presidio) + audit. | **None.** |
>
> **Build order:** Epic 2's **Node-side** stories (2.1–2.5, 2.7, 2.8) + Epic 3 (UI) + Node-side Epic 4 stories are **ungated and start first**. The **Python** stories (Epic 1, Epic 2.6) wait for the bump. Epic 5 REST builds once Epic 2 indexing is unblocked (post-bump); Epic 5.6 (MCP) waits for the agentic MCP client. Epics are numbered by Architecture §13 phase order, **not** by build order. **Epic 7 (AI-driven producer) builds AFTER Epic 3** — it is the rapid repo-creation enabler for testing/bootstrapping; ungated, except that producer-assigned labels fully steer retrieval only after Story 2.6 (ACL-preserve) + Epic 1 (multi-graph fan-out) land (both gated by the bump).

### Epic 1: Unified Multi-Graph Grounding  *(GATED by OPEA 1.5 bump !277)*
One retrieval grounds answers across the free-form corpus **and** all authorized OKF repositories (fan-out + RRF), so a chat response can cite concepts from any source.
**FRs covered:** FR-24. **Builds after:** bump merges.

### Epic 2: OKF Server — Repository Ingestion & Management  *(Mostly ungated — build first; Story 2.6 gated by bump)*
An operator can register/create an OKF repository, sync it from Git/S3, have it validated, virus-scanned, PII-redacted, parsed, and indexed into its own graph — and manage it via CRUD. The foundational greenfield service.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-13, FR-21, FR-22, FR-23, FR-27, FR-28 (+ ingest-side NFRs).

### Epic 2.9: Write-side Orchestration  *(NEW 2026-08-13; mostly ungated Node trunk; Story 2.9.6 graph-wiring leg gated by bump)*
The connective tissue that sequences ingest end-to-end: the write-side orchestrator (`ingestService`), the async ingestion worker (Redis Streams), the `okf_concepts_meta` UPSERT writer, the bundle zip contract, the `_LINKS_TO` edge writer, version minting, the source-sync backing store, and the retention sweep. Plus the extracted **ungated** ACL-preserve fix (Story 2.6a — highest P0 priority). The trunk every OKF consumer hangs on.
**FRs covered:** FR-34 (+ FR-4, FR-5, FR-6, FR-7, FR-8, FR-11, FR-12 mechanisms). **ADRs:** okf-021, okf-022, okf-028, okf-030, okf-031, okf-032.

### Epic 3: Vue 3 Admin — Repository Management UI
Operators manage OKF repositories from the existing admin dashboard (the established ingestion surface).
**FRs covered:** FR-26 (repository management portion). **UX-DRs:** 1, 2, 4, 5, 6, 7.

### Epic 4: In-App Concept Authoring & Curation
Authors create/curate OKF concept files in-app; stewards review, approve, publish, version, and govern through the lifecycle.
**FRs covered:** FR-9, FR-10, FR-11, FR-12, FR-13, FR-25. **UX-DRs:** 3.

### Epic 5: Agent Serving & MCP-Ready Surface
Agents search, get, list, outline, and traverse OKF concepts with progressive disclosure and trust/provenance surfacing; handlers are MCP-ready.
**FRs covered:** FR-14, FR-15, FR-16, FR-17, FR-29 (+ FR-7 traversal, FR-24 cross-graph from Epic 1).

### Epic 6: Hardening — Security, Observability, Sovereignty
Production-ready: hardened authz, FOI audit, end-to-end tracing, metrics, supply chain, air-gap.
**FRs covered:** FR-18, FR-19, FR-20, FR-21 (+ cross-cutting NFRs).

### Epic 7: AI-Driven OKF Producer (Crawl → Draft)  *(UNGATED; builds AFTER Epic 3)*
A steward uses a web crawl to rapidly create an OKF repository: the AI producer **assembles** concept drafts from crawled content, **AI-adjusts** and **cross-links** them into the most structured bundle, and **suggests** knowledge-hierarchy labels (steward-vetted). Configurable model tier; drafts stage in `review` — never auto-publish.
**FRs covered:** FR-30, FR-31, FR-32, FR-33 (+ FR-5, FR-7, FR-9, FR-10, FR-29 reuse). **ADRs:** okf-019, okf-020.

### Epic 8: Test Infrastructure & Evaluation  *(NEW 2026-08-13; cross-cutting; unblocks the "verify the strategy is solid" goal)*
The deterministic fixture trinity (static crawl site + seed repos + golden queries), multi-graph retrieval integration tests, retrieval-quality + RRF-sweep eval harnesses, and the OPEA-1.5 fallback-shim contingency. The highest-leverage testing investment — makes the multi-repo scaling claim and the launch gates measurable.
**Closes gaps:** G19, G20, G30, G31, G35.

### Epic 9: Label Onboarding (Pre-Ingest Curation)  *(NEW 2026-08-13; ungated analyze/apply; gated ingest leg)*
A slick, curator-driven way to add **exactly** the new labels a repo needs — bounded, never exhaustive. A pre-ingest dry-run surfaces the minimal label gap (only under-labeled concepts); a wizard walks the steward through Analyze → Cluster → Review → Apply with smart defaults + a live before/after preview. Bounded by construction (gap-only + variant merge + denylist + a FAIL-not-truncate cap + the FR-32 steward gate). Unifies the producer's label proposals (Story 7.3) into one steward gate. **ADRs:** okf-033, okf-034.
**FRs covered:** FR-36 (+ FR-32 steward gate, FR-34/FR-35 reuse). **Depends on:** Story 2.9.1 (orchestrator), Epic 3 (UI), Story 8.1 (fixtures, for 9.5).

---

## Epic 1: Unified Multi-Graph Grounding
*(GATED — depends on OPEA 1.5 bump !277 merging to main first. Query-side only.)*

### Story 1.1: Retriever multi-graph fan-out + RRF fusion
As a **chat user**,
I want **a single retrieval to search the free-form corpus and all my authorized OKF repositories at once**,
So that **my answer is grounded in every available knowledge source, not one corpus**.

**Acceptance Criteria:**
**Given** the retriever receives an authorized `graph_names` list (`GRAPH` + caller's `OKF_{repo_id}` set),
**When** it runs a query,
**Then** it executes the existing hybrid path (dense COSINE + BM25 view + optional traversal) per graph and **RRF-fuses** the per-graph ranked lists (reusing `rrf_fuse`),
**And** each result hit carries `graph_name`/`repo_id`/`concept_id` for citation, `chunk_labels` ACL is applied per graph (unauthorized repos contribute **zero hits** in the fused result), and a single-graph call still works unchanged. *(FR-24; NFR-S7 additive; Architecture §8.4, §9; **2026-08-13**: deps on Story 2.6a (ACL preserve) + Story 1.0 (provenance materialization); ACL filter must apply on `search_start ∈ {chunk, node, edge}` — bug fix G12; per-graph contribution counts emitted; boundary probe (Story 1.0b) asserts `graph_names` arrives at `invoke()` deployed.)*

### Story 1.2: ChatQnA forwards the authorized graph set
As a **chat user**,
I want **my chat query to ground across all graphs I'm authorized for**,
So that **the answer cites concepts from the free-form corpus and OKF repositories together**.

**Acceptance Criteria:**
**Given** a caller's token grants a set of OKF repositories,
**When** ChatQnA handles a `ChatCompletionRequest`,
**Then** it carries the authorized graph set (`GRAPH` + `OKF_*`) through `GenieaiRetrieverParms` → `align_inputs` → retriever `invoke(graph_names=…)`,
**And** an unauthorized repository never appears in the forwarded set, and the end-to-end path is covered by an OTel trace. *(FR-24; Architecture §8.5; also fix stale `RETRIEVER_ARANGO_GRAPH_NAME`→`ARANGO_GRAPH_NAME` env hint, §8.7; **2026-08-13**: the authorized set is resolved by the Authz Resolver (Story 6.1b) as a **per-graph label map** (`graph_name → labels`), not a flat list — G8; isolation test: a caller scoped to repo A cannot read repo-B chunks.)*

### Story 1.0: Retriever provenance materialization *(NEW 2026-08-13; gated; pins as 1.1 dependency — G18)*
As an **agent**,
I want **every retrieval hit to carry its `graph_name`/`repo_id`/`concept_id`**,
So that **I can cite and audit which repository a grounded fact came from**.
**Acceptance Criteria:** **Given** a multi-graph retrieval, **When** the retriever returns hits, **Then** each hit materializes `graph_name`, `repo_id`, and `concept_id` (read from the `_SOURCE` chunk doc), **and** these survive fusion (RRF) into the served result. *(FR-24; ADR-okf-013 revision; G18.)*

### Story 1.0b: Boundary probe — `graph_names` across the mega-service *(NEW 2026-08-13; gated; determines the read-side transport shape — G2, LG-5)*
As a **platform engineer**,
I want **to prove `graph_names` survives the ChatQnA→retriever boundary in the deployed stack**,
So that **fan-out code is not built on an unverified assumption**.
**Acceptance Criteria:** **Given** the deployed ChatQnA mega-service, **When** `POST /v1/retrieval` is sent with `graph_names=[G1,G2]`, **Then** `invoke()` receives both (asserted in logs/span, not just in-process); **and** if the boundary drops them, the chosen durable carrier (`label_contract` extension) is documented (ADR-okf-023). *(ADR-okf-023; G2; LG-5 launch gate.)*

### Story 1.3: Graph Router — query-aware graph-set selection *(NEW 2026-08-13; gated; G6, D8–D10/D14)*
As a **chat user**,
I want **my query to ground in the *relevant* authorized graphs, not all of them**,
So that **grounding stays fast and precise as the deployment grows to many repositories**.
**Acceptance Criteria:** **Given** the authorized graph set (from Story 6.1b) + the query, **When** the Graph Router (in ChatQnA) runs, **Then** it (a) binds the query to a domain (service-category classifier or `okf_repositories.domain` exact match), (b) ranks candidate repos by repo-metadata BM25 over `okf_concepts_meta` (`title/type/tags/summary`), (c) intersects with the authorized set and caps at `MAX_FANOUT_GRAPHS` (default 5, configurable), **and** selection latency ≤20ms is **CI-gated** against seed fixtures (Story 8.1); AC: seed 4 repos across 3 domains, assert only the relevant graphs are traversed. *(FR-35; ADR-okf-024; G6.)*

### Story 1.4: Parallel fan-out — bounded concurrency + per-graph timeout + partial-failure *(NEW 2026-08-13; gated; G14)*
As an **SRE**,
I want **fan-out to be parallel, bounded, and resilient to one slow/sick repo**,
So that **one repo cannot stall or fail a query**.
**Acceptance Criteria:** **Given** the selected graph set, **When** the retriever fans out, **Then** it uses `asyncio.gather` + `Semaphore(MAX_FANOUT_GRAPHS)`, each graph has a per-graph timeout (skip-on-timeout: log + continue + fuse survivors), **and** an errored repo contributes **zero hits, NOT a 500**. *(ADR-okf-013 revision; ADR-okf-024; G14.)*

### Story 1.5: 2-level cross-graph RRF + size normalization *(NEW 2026-08-13; gated; G21)*
As a **platform engineer**,
I want **cross-graph fusion to be fair across repos of unequal size**,
So that **small repos are not drowned out or over-weighted**.
**Acceptance Criteria:** **Given** per-graph ranked lists, **When** fusion runs, **Then** Level-1 fuses dense⊕BM25 per graph (reuse `rrf_fuse`) → per-graph top-K, Level-2 cross-graph RRF weights by per-graph size/confidence; `k` + weights tuned via Story 8.4. *(FR-24; ADR-okf-027; G21.)*

### Story 1.6: Fan-out observability spans *(NEW 2026-08-13; gated; G24, G35)*
As an **SRE**,
I want **graph-selection and fan-out to be observable**,
So that **I can diagnose precision/latency degradation**.
**Acceptance Criteria:** **Given** a multi-graph query, **When** it executes, **Then** spans emit `graphs_authorized`, `graphs_selected`, `graphs_traversed`, `per_graph_latency_ms`, `per_graph_hit_count`, `selection_latency_ms`, `selection_reason`; empty/undersized repos emit a structured "0 (undersized)" signal. *(FR-20; ADR-okf-024; G24, G35.)*

---

## Epic 2: OKF Server — Repository Ingestion & Management
*(Mostly ungated — build first. Greenfield Node service. The dataprep indexing leg, Story 2.6, is gated by the OPEA 1.5 bump; all other Epic 2 stories are ungated.)*

### Story 2.1: OKF Server skeleton + deploy wiring
As a **platform engineer**,
I want **a new OKF Server service running behind Kong with health checks and CI**,
So that **there is a foundation to build repository management and ingestion on**.

**Acceptance Criteria:**
**Given** the new `components/okf-server/` Node/Express (CommonJS, `createApp()`, imports `shared/lib/`),
**When** it is deployed,
**Then** routes mount at `/api/okf/*` behind Kong (service + route in `kong_config.json`), `/health` and `/ready` return 200, it runs as a non-root CPU-only container with a `Dockerfile` + `docker-compose.yaml` entry + Ansible vars + a CI build/scan/promote job (ADR-0001),
**And** `jose`-based auth mirrors gov-chat-backend (JWKS via OIDC discovery) and the Jest `createApp()` test pattern is established. *(FR-21 partial; Architecture §8.1, §8.6; ADR-okf-001; NFR-S6)*

### Story 2.2: ArangoDB OKF meta collections + repository CRUD API
As a **steward**,
I want **to create, list, read, update, and delete OKF repositories, each with its own graph**,
So that **domains are isolated and managed independently**.

**Acceptance Criteria:**
**Given** the OKF control-plane collections (`okf_repositories`, `okf_concepts_meta`, `okf_audit`, `okf_sources`) in the **same ArangoDB database** as the graphs,
**When** a `tools-admin` steward calls `/api/okf/repos`,
**Then** create mints `repo_id` + reserves `graph_name=OKF_{repo_id}` (graph auto-created on first ingest), binds it to a domain (service-category key); list/read is scoped to authorized domains/repos; update changes metadata/ACL/retention (not `graph_name`); delete cascades — retracts the entire graph + metadata, audited, irreversible after a grace window,
**And** all schema/integrity is enforced at the app layer (ADR-okf-018). *(FR-23, FR-3; Architecture §2, §4, §5; ADR-okf-014, ADR-okf-018)*

### Story 2.3: OKF parser (frontmatter + v0.2 families + structural links)
As a **platform engineer**,
I want **the OKF Server to parse concept files into metadata, body, and link edges**,
So that **concepts are indexable and traversable**.

**Acceptance Criteria:**
**Given** a concept `.md` file,
**When** the Node `okf-parser` (`gray-matter` + `markdown-it`) processes it,
**Then** it extracts frontmatter (incl. v0.2 `generated.at`/`sources`, with legacy `timestamp`/`# Citations` fallback per ADR-okf-017), the body, and structural links resolved to concept IDs with anchor text as `label`,
**And** broken links are tolerated (not a failure), and parsed concepts are handed to dataprep's ingest path. *(FR-6, FR-7; Architecture §6 step 2; ADR-okf-010, ADR-okf-017; **2026-08-13**: reject cross-repo link targets at parse — validate each target resolves to a `concept_id` within the **same** `repo_id`; emit a `CROSS_REPO_LINK` conformance issue on violation (ADR-okf-028, G22).)*

### Story 2.4: Conformance validation (OKF §11) + quality metrics
As a **steward**,
I want **ingested repositories checked for OKF conformance and surfaced with quality metrics**,
So that **non-conformant content is flagged without blocking good content**.

**Acceptance Criteria:**
**Given** a repository being ingested,
**When** conformance runs (parseable frontmatter; non-empty `type`; reserved-file structure; warns on malformed v0.2 families — non-blocking),
**Then** results are written to `okf_concepts_meta.conformance_issues` and surfaced per-repo (concept counts, PII hits, broken links, staleness) via the repository read API,
**And** a concept missing `type` is still ingested but flagged. *(FR-4, FR-13; ADR-okf-017)*

### Story 2.5: Document-repository bundle ingest route
As a **platform engineer**,
I want **bundle/repository content stored, scanned, and handed to dataprep through the existing document-repository**,
So that **no new storage vendor or scanning infrastructure is introduced**.

**Acceptance Criteria:**
**Given** the new `POST /api/files/ingest-bundle` route in the document-repository (`authorizeRole(['Admin'])`),
**When** bundle/concept content arrives,
**Then** it reuses `securityService.scanBuffer` (ClamAV), **bypasses** the upload allowlist/magic-byte/langdetect, writes bytes, and hands to dataprep **carrying `graph_name`** (threaded request → `_ingestFileById` → dataprep `/v1/dataprep/ingest_file`),
**And** malware is rejected + logged with nothing indexed. *(FR-5, FR-22; Architecture §8.2; ADR-okf-008, ADR-okf-016; **2026-08-13**: the route is the orchestrator's storage+scan leg — it stores the bundle + ClamAV-scans + creates the `files` doc at `dataprep.status='Pending'` (carrying `graph_name` + `repo_id`, persisted via the `extractMetadata` fix) and returns; the **ingestionWorker** (Story 2.9.4) drains `Pending` asynchronously; the route asserts `graph_name === 'OKF_'+repo_id` server-side (4xx on ownership mismatch, not format-only) — G5/G10.)*

### Story 2.6: dataprep graph_name wiring + additive metadata + repo-level retract  *(GATED by OPEA 1.5 bump !277)*
As a **platform engineer**,
I want **dataprep to index OKF concepts into the right per-repo graph with OKF metadata and support repo-level retraction**,
So that **each repository is isolated and cleanly removable**.

**Acceptance Criteria:**
**Given** dataprep (`genieai_dataprep_microservice.py`, `genieai_dataprep_arangodb.py`, `core/genieai_api_protocol.py`),
**When** an OKF ingest request arrives,
**Then** dataprep reads `graph_name` from the **request** (not just env) on ingest + retract; `ArangoDBDataprepRequestFromDocRepo` carries additive `concept_id`/`bundle_version`/`source_type`/`repo_id` propagated to chunk-doc metadata; TEI embedding is reused; `retract_file` gains a repo/bundle-level retract path (by `repo_id`+`bundle_version`),
**And** the latent retract-default mismatch (`genie_graph`→`GRAPH`/request) is fixed (Architecture §8.7), with additive-only schema changes (NFR-S7). *(FR-6, FR-8; Architecture §8.3, §9; ADR-okf-010, ADR-okf-013)*

> **2026-08-13 course correction:** the ACL-preserve fix (`_finalize_chunk_labels` preserving `t:`/`r:`/`d:` prefixes — today silently dropped, G4 P0) is **extracted into ungated Story 2.6a** so it can land immediately, ahead of the bump. Story 2.6 (this story, gated) keeps: dataprep reads `graph_name` from the request body (ingest + retract), additive metadata, repo/bundle-level retract, the retract-default mismatch fix, **and** `retractRepoGraph` dropping the 4 `OKF_{repo_id}_*` collections (retract must target the correct graph — G5, never the free-form `GRAPH`). Unify the fallback constant. *(ADR-okf-013 revision, ADR-okf-021; genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:1051-1104.)*

### Story 2.7: Source sync (Git/S3) + change detection + origin health
As a **platform engineer**,
I want **to register a Git/S3 source and have it synced, change-detected, and health-monitored**,
So that **repositories stay current and survive origin disappearance**.

**Acceptance Criteria:**
**Given** a registered Git or S3 source (credentials from secret store, never plaintext/logged),
**When** sync runs (schedule or webhook),
**Then** Git uses commit-diff `OLD..NEW --name-only`, S3 uses ETag/LastModified, and a content SHA-256 idempotency key prevents re-embedding unchanged concepts; a failed sync retries with backoff and surfaces degraded health in `okf_sources`,
**And** the origin is checked periodically — if deleted/inaccessible, serving continues from the retained document-repository copy (the runtime source of truth) and the steward is alerted. *(FR-1, FR-2, FR-27; NFR-S1, NFR-S4; Architecture §6; ADR-okf-016)*

### Story 2.8: PII redaction at ingest + version/provenance + document references
As a **data-protection officer**,
I want **PII redacted on ingest (blocking on failure) and each publish versioned with stable source links**,
So that **no PII reaches `published` and answers can link to verifiable sources**.

**Acceptance Criteria:**
**Given** concept bodies (and tagged sensitive frontmatter) at ingest,
**When** the OKF Server `governance/` module runs Presidio (library mode, document-level default),
**Then** a PII-policy failure withholds the concept from `published` and flags it for review (blocking); each indexed repository version records source ref + fetch timestamp + curator + stable version id on the document-repository;
**And** every concept carries a stable document-repository reference so the UI, chat citations, and agents can link to view the original source (never the external origin URL). *(FR-3, FR-5, FR-28; NFR-P1, NFR-P2; Architecture §6 steps 4–5; ADR-okf-004; **2026-08-13**: PII redaction is a **publish prerequisite** (lifecycle gate — D22/ADR-okf-030), not a parallel track; the `pii_state` writer on `okf_concepts_meta` is owned here — G28.)*

---

## Epic 2.9: Write-side Orchestration
*(NEW 2026-08-13. Mostly ungated Node trunk; Story 2.9.6 graph-wiring dataprep leg gated by the bump. This is the trunk every OKF consumer hangs on — it makes ingest work end-to-end.)*

### Story 2.6a: ACL-label preserve fix (extracted, UNGATED — highest P0 priority) *(G4)*
As a **platform engineer**,
I want **ACL-prefixed `file_labels` (`t:`/`r:`/`d:`) preserved into `chunk_labels` at ingest**,
So that **per-tenant/repo/domain isolation actually holds at retrieval**.
**Acceptance Criteria:** **Given** dataprep `_finalize_chunk_labels` (today silently drops ACL prefixes — `genieai_dataprep_arangodb.py:1051-1104`), **When** an OKF ingest carries `file_labels:[t:,r:,d:]`, **Then** those prefixes survive into `chunk_labels` on the `_SOURCE` chunk doc (regression test asserts the exact labels post-ingest), **and** the LLM label call is short-circuited when concept frontmatter already carries labels. *(ADR-okf-013 revision; G4; this is the load-bearing wall for OKF isolation — LG-3 launch gate.)*

### Story 2.9.1: `ingestService` + `POST /api/okf/repos/:repo_id/ingest` *(G1)*
As a **steward**,
I want **to trigger an end-to-end ingest that returns immediately and indexes asynchronously**,
So that **the HTTP call never blocks on dataprep and large repos don't time out**.
**Acceptance Criteria:** **Given** the orchestrator (`services/ingest-service.js`), **When** `POST /api/okf/repos/:repo_id/ingest` is called (tools-admin), **Then** it resolves the repo → derives `graph_name="OKF_"+repo_id` + ACL labels `[t:,r:,d:]` + `bundle_version` (publish only) → unzips the bundle (zip of `.md`) → per concept: `parseConcept` → UPSERT `okf_concepts_meta` → `validateConcept` → PII scan → content-hash dedup → enqueue index job (Redis Streams) + `files` doc `dataprep.status='Pending'` → returns **202**; the orchestrator is the **sole** ACL-label injector (owns repo→tenant/domain). *(FR-34; ADR-okf-021, ADR-okf-022.)*

### Story 2.9.2: `okf_concepts_meta` UPSERT writer + first-class fields *(G9)*
As a **platform engineer**,
I want **`okf_concepts_meta` written with first-class, indexable fields**,
So that **conformance/metrics/graph-router queries work and provenance is not lost**.
**Acceptance Criteria:** **Given** the meta collection, **When** a concept is parsed, **Then** the writer UPSERTs on `(repo_id, concept_id)` (unique persistent index) the first-class fields `title/type/tags/summary/content_hash/lifecycle_status/index_status/trust_tier/stale_after/pii_state/bundle_version`; replaces the filter-and-UPDATE that wrote zero rows; **and** a no-prior-doc assertion confirms the UPSERT created the doc. *(ADR-okf-021; G9; closes the silent-no-op that masked the gap.)*

### Story 2.9.3: `_LINKS_TO` edge writer (within-repo validated) *(G7, G22)*
As a **platform engineer**,
I want **structural concept→concept edges written post-index, validated to stay within the repo**,
So that **traversal works and cross-repo links are rejected**.
**Acceptance Criteria:** **Given** the parsed `links[]`, **When** the orchestrator writes `OKF_{repo_id}_LINKS_TO` (post-index), **Then** it only emits edges whose endpoints are concepts in the **same** `repo_id` (cross-repo targets dropped, consistent with the parse-time `CROSS_REPO_LINK` warning), carrying `label` (anchor text) + `file_id` + `repo_id`. *(ADR-okf-022 (D4), ADR-okf-028; G7, G22.)*

### Story 2.9.4: `ingestionWorker` — Redis Streams + DLQ + orphan sweeper *(G10)*
As an **SRE**,
I want **an async worker that drains `Pending` ingest jobs resiliently**,
So that **ingest never blocks the API and failures are recoverable**.
**Acceptance Criteria:** **Given** Redis Streams + a per-purpose DLQ, **When** the worker runs (concurrency 1 default, configurable via `OKF_INGEST_CONCURRENCY`), **Then** it polls `files FILTER dataprep.status=='Pending'`, calls doc-repo `_ingestFileById` (carrying `graph_name`/`file_labels`/`concept_id`/`repo_id`/`bundle_version`) → dataprep → graph creation, transitions `index_status` (`parsed→indexed`, `failed`+DLQ on error), writes audit rows; **and** a scheduled sweeper retracts orphan chunks (concept_id with no `okf_concepts_meta`). *(FR-34; ADR-okf-021 (D5/D6); NFR-R2; G10.)*

### Story 2.9.5: Bundle format (zip) + server unzip + content-hash dedup *(G11)*
As a **platform engineer**,
I want **a defined, atomic bundle contract with idempotent re-ingest**,
So that **re-ingesting an unchanged concept does not duplicate chunks**.
**Acceptance Criteria:** **Given** a bundle, **When** it arrives, **Then** it is a **zip of `.md` concept files** (server unzips, iterates); a content-hash dedup check skips any concept whose hash is unchanged AND `index_status='indexed'`; **and** there is no distributed transaction — compensation via the sweeper + `index_status`. *(FR-34; ADR-okf-021 (D2/D6); NFR-S4; G11.)*

### Story 2.9.6: `graph_name` wiring end-to-end + retract fix  *(GATED by OPEA 1.5 bump — G5)*
As a **platform engineer**,
I want **`graph_name` threaded doc-repo→dataprep and retract targeting the correct graph**,
So that **each repo is isolated and cleanly removable without destroying the wrong graph**.
**Acceptance Criteria:** **Given** the doc-repo payload + dataprep microservice, **When** an OKF ingest/retract runs, **Then** `graph_name` is read from the **request body** at the dataprep boundary (ingest + retract), `retractRepoGraph(repo_id)` drops the 4 `OKF_{repo_id}_*` collections (never the free-form `GRAPH`), **and** the fallback constant is unified. *(ADR-okf-013 revision, ADR-okf-021; G5.)*

### Story 2.9.7: `okf_versions` + `mintVersion()` on publish *(G26)*
As a **steward**,
I want **each publish to mint an immutable, diffable version**,
So that **agent citations can pin a version and changes are auditable**.
**Acceptance Criteria:** **Given** a publish transition, **When** it completes, **Then** `mintVersion(repo_id)` increments the repo's version counter (repo-level `bundle_version`, threaded onto chunks/edges/meta) and snapshots an immutable `okf_versions` manifest (concept list + hashes + source ref + curator + ts; INSERT-only). *(FR-11; ADR-okf-031; G26; resolves PRD §13.2.)*

### Story 2.9.8: `okf_sources` writer (source-sync backing store) *(G32)*
As a **platform engineer**,
I want **the `okf_sources` collection written by source-sync**,
So that **the admin UI's "last sync / health" column has real data**.
**Acceptance Criteria:** **Given** source-sync (Story 2.7), **When** a sync runs, **Then** `okf_sources` is written (`last_commit_sha`, `last_sync_at`, `origin_reachable`, `last_error`); the collection is no longer ensure-on-boot-and-unused. *(FR-2; ADR-okf-018; G32.)*

### Story 2.9.9: Retention/TTL sweep worker + `deletion_reason` *(G27)*
As a **data-protection officer**,
I want **expired content retracted on schedule with a recorded reason**,
So that **retention is enforced and every deletion is explainable for FOI/GDPR**.
**Acceptance Criteria:** **Given** a schema'd `retention`/`delete_after` policy (per-tenant/domain, deployment defaults), **When** the scheduled sweep runs, **Then** it retracts repos/concepts past `delete_after` via the cascade (FR-8/2.9.6), records `deletion_reason` (`ttl_expired|retired|origin_deleted|gdpr_erasure`), **and** writes a write-before-respond audit row. *(FR-12; ADR-okf-029, ADR-okf-032; G27.)*

---

## Epic 3: Vue 3 Admin — Repository Management UI
*(UNGATED. Depends on Epic 2 CRUD API. Web-only — Flutter has no admin UI.)*

### Story 3.1: OKF Repositories tab + service + Vuex module
As an **operator**,
I want **an OKF Repositories tab in the admin dashboard listing all repositories I can see**,
So that **I can manage OKF knowledge from the same surface as document ingestion**.

**Acceptance Criteria:**
**Given** `AdminDashboard.vue` (Options API, Vuex, vue-i18n, `httpService`→`/api`),
**When** the operator opens the new "OKF Repositories" tab,
**Then** a table shows name, domain, source, lifecycle, version, health, last sync, concept count with filters (domain), search, and pagination; a new `okfRepositoryService.js` (httpService-based) + Vuex `okf` module (`mapGetters`/`mapActions`) back it,
**And** all strings use the `translate('okf.…', 'default')` wrapper with an `okf.*` i18n tree across locales (English source of truth). *(FR-26; UX-DR1, UX-DR6; project-context anti-patterns: Options API, `translate()` not `$t()`)*

### Story 3.2: Repository dialog + details view
As an **operator**,
I want **to create/edit a repository and inspect its details (concepts, conformance, versions, source, audit)**,
So that **I can administer a repository end-to-end from the UI**.

**Acceptance Criteria:**
**Given** the new components,
**When** the operator creates/edits a repository,
**Then** `OkfRepositoryDialog.vue` offers a domain picker via `serviceTreeService.getAdminCategories()`; `OkfRepositoryDetails.vue` shows tabs (Concepts tree, Conformance/PII, Versions, Source/Sync, Audit) with actions Sync/Validate/Publish/Retire/Delete,
**And** mutating actions enforce `tools-admin`/admin role (Kong + OKF Server), DS primitives are used, and components are Jest-tested. *(FR-26; UX-DR2, UX-DR4, UX-DR7; **2026-08-13**: the "last sync / health" column reads from `okf_sources` (Story 2.9.8 must land first, or the column is explicitly blank-stubbed) — G32.)*

### Story 3.3: Ingestion progress + i18n completeness
As an **operator**,
I want **live ingest/sync status and fully translated OKF strings**,
So that **I can watch ingestion happen and non-English users see the OKF UI in their language**.

**Acceptance Criteria:**
**Given** ingest/sync is running,
**When** the operator views a repository,
**Then** `OkfIngestionProgress.vue` polls live status (`{ silent: true }` pattern) without error spam,
**And** the `okf.*` i18n tree is complete across all active locales with opportune fixes to undefined `link.*`/`common.close` fallbacks. *(FR-26; UX-DR5, UX-DR6)*

---

## Epic 4: In-App Concept Authoring & Curation
*(UNGATED. Depends on Epic 2 indexing path.)*

### Story 4.1: Concept CRUD API + incremental re-index
As an **author**,
I want **to create, read, update, and delete concept files within a repository**,
So that **my edits flow through to the index and structural edges**.

**Acceptance Criteria:**
**Given** the `/api/okf/repos/{repo}/concepts` endpoints,
**When** an author saves a concept,
**Then** on save → re-parse → incremental re-index (content-hash keyed) → update `okf_concepts_meta` + structural `OKF_{repo}_LINKS_TO` edges (+ `label`); delete cascades the concept's chunks/edges with orphan cleanup,
**And** a concurrent query during re-index sees the last-good index. *(FR-8, FR-25 CRUD; NFR-S4; Architecture §5; **2026-08-13**: optimistic concurrency — expose `_rev`, accept `If-Match`, return **409** on mismatch (G25); first-class `title/type/tags/summary` fields on `okf_concepts_meta` (Story 2.9.2).)*

### Story 4.1b: Concept-label re-materialization on edit *(NEW 2026-08-13; ungated; G29)*
As an **author**,
I want **editing a concept's labels/trust to re-materialize on its chunks**,
So that **stale `chunk_labels`/`trust_tier` do not persist after a label change or cross-repo move**.
**Acceptance Criteria:** **Given** a concept edit that changes labels or `trust_tier`, **When** it saves, **Then** the concept's chunks are re-indexed so `chunk_labels` + denormalized `trust_tier` are fresh (ACL-freshness test asserts old labels are gone), **and** a cross-repo move orphans no chunks (sweeper reconciles). *(ADR-okf-026; G29.)*

### Story 4.2: In-app Markdown concept editor (with v0.2 families)
As a **knowledge author**,
I want **to author OKF concepts in-app with frontmatter fields, a Markdown body, a link picker, and live validation**,
So that **I can build a domain repository without external Git tooling**.

**Acceptance Criteria:**
**Given** `OkfConceptEditor.vue`,
**When** the author edits a concept,
**Then** the frontmatter form offers `type` (required) + `title`/`description`/`resource`/`tags` plus the optional v0.2 families (`generated`/`verified`/`status`/`stale_after`/`sources`); the Markdown body uses `marked` + `DOMPurify`; a link picker inserts `[…](/path/to/concept.md)` from the repository's concept tree; live OKF §11 validation + PII pre-check run,
**And** a non-conformant save is blocked at the editor with a specific §11 error — no invalid concept reaches `published`. *(FR-25; UX-DR3; ADR-okf-015, ADR-okf-017)*

### Story 4.3: Repository/concept lifecycle states
As a **steward**,
I want **repositories and concepts to move through governed lifecycle states**,
So that **only reviewed, published content reaches agents**.

**Acceptance Criteria:**
**Given** the lifecycle `register→validate→review→approve→publish→version→deprecate→retire`,
**When** a state transition occurs,
**Then** only `published` content is served to agents (`review`/`draft` invisible to non-steward queries); transitions are role-restricted and auditable (who/when). *(FR-9; **2026-08-13**: rewrite against the lifecycle **state machine** (ADR-okf-030) — explicit `TRANSITIONS` map, auto vs human gates, transition endpoints returning 409 + allowed-next-states on invalid transitions, `version` demoted to a publish side-effect (not a state); served-status rule: served iff `repo.lifecycle_state='published'` AND `concept.lifecycle_status ∈ {stable, deprecated}` — G17.)*

### Story 4.4: Review & approval gate
As a **steward**,
I want **to review conformance/PII/quality reports and approve or reject content for publication**,
So that **a human sign-off gates what agents see**.

**Acceptance Criteria:**
**Given** a repository/concept in `review`,
**When** a steward acts,
**Then** approval requires a `tools-admin`/steward role and records approver + timestamp; rejection records the reason and returns content to `review`,
**And** approval can write a portable `verified: { by: human:<steward>, at: … }` trust signal (FR-29/ADR-okf-017). *(FR-10; **2026-08-13**: publish is gated on PII redaction (Story 2.8, publish prerequisite — D22) and conformance; the transition writes a write-before-respond audit row — ADR-okf-029/030.)*

### Story 4.5: Versioning & provenance
As a **steward**,
I want **each publish to create an immutable, diffable version with capturable lineage**,
So that **agent citations can pin a version and changes are auditable**.

**Acceptance Criteria:**
**Given** a steward publish action,
**When** it completes,
**Then** an immutable version is created (monotonic, tied to source ref); stewards can list/diff versions; lineage (source ref → concept → served answer) is capturable for citation and audit,
**And** superseded versions are retained until retention/TTL then retracted. *(FR-11; ADR-okf-005; **2026-08-13**: versioning is **repo-level** `bundle_version` minted on publish (ADR-okf-031 / Story 2.9.7), demoted to a publish side-effect; immutable `okf_versions` manifest backs list/diff — G26.)*

### Story 4.6: Retention / TTL
As a **data-protection officer**,
I want **expired content retracted on schedule per policy**,
So that **retention is enforced and auditable**.

**Acceptance Criteria:**
**Given** a per-tenant/per-domain retention policy with safe defaults,
**When** content passes its TTL,
**Then** it is retracted (FR-8 cascade) and the deletion is logged; retention is configurable per tenant/domain. *(FR-12)*

### Story 4.7: Reserved files + FOI audit export
As a **steward**,
I want **`index.md`/`log.md` managed and a FOI-compliant audit export available**,
So that **progressive disclosure works and compliance is demonstrable**.

**Acceptance Criteria:**
**Given** reserved files and the audit log,
**When** they are managed/exported,
**Then** `index.md`/`log.md` are generated/synced and editable (validated); a date-ranged, FOI/GDPR-compliant audit trail (actor, action, repo, concept, version, timestamp, source) is exportable and tamper-evident. *(FR-13, FR-19; NFR-T2; ADR-okf-015)*

---

## Epic 5: Agent Serving & MCP-Ready Surface
*(REST proceeds independently; cross-graph behavior (FR-24) needs Epic 1; MCP transport gated on the workflows service MCP client.)*

### Story 5.1: Search concepts (unified)
As an **agent**,
I want **to search across my authorized graphs for ranked concept hits**,
So that **I can find the right knowledge without dumping the whole corpus into context**.

**Acceptance Criteria:**
**Given** an authenticated agent,
**When** it calls `/api/okf/search`,
**Then** it receives ranked concept hits (ID + snippet) across its authorized graphs (FR-24 fan-out when available), scoped by per-tenant/repo/domain RBAC (unauthorized repos excluded silently), token/byte-capped with a `nextCursor`. *(FR-14; NFR-PR1, NFR-PR2; **2026-08-13**: pre-Epic-1 fallback = single-graph (the legacy free-form corpus only) — documented; multi-graph fan-out activates when Epic 1 lands; cursor = **deterministic re-rank + stable sort key** (not stateful cursors — preserves NFR-R1 stateless), with a documented re-index caveat — G23/D23.)*

### Story 5.2: Get concept document
As an **agent**,
I want **to fetch a concept (full or sliced) by repository + concept ID**,
So that **I can read exactly what I need with a version I can pin**.

**Acceptance Criteria:**
**Given** a concept request (repo + concept ID, optional version/lang),
**When** the agent calls `/api/okf/get`,
**Then** it returns the concept (full or sliced) with token caps and a "fetch more" handle, version-pinned when a version is requested,
**And** an unauthorized request returns **403** (not 404 leakage). *(FR-15; ADR-okf-006; **2026-08-13**: this is a **direct fetch** from `okf_concepts_meta` + the document-repository (the `.md` source), **NOT** retrieval — a concept is N chunks; `get` returns the concept, not a chunk. Two read paths (search=retrieval, get=direct-fetch), explicitly documented — G23.)*

### Story 5.3: List repositories & outline
As an **agent**,
I want **to list my accessible repositories and fetch a repository outline**,
So that **I can navigate one level at a time before drilling in**.

**Acceptance Criteria:**
**Given** an authenticated agent,
**When** it calls `/api/okf/repos` (list) or `/api/okf/outline`,
**Then** listing reflects only authorized repositories and the outline returns the repository's `index.md` progressive-disclosure landing. *(FR-16)*

### Story 5.4: Trust, lifecycle & provenance surfacing
As an **agent**,
I want **each served concept to carry a trust tier, staleness flag, and source provenance**,
So that **I can weight, disclose, and gate on how much to trust it and whether it's current**.

**Acceptance Criteria:**
**Given** a concept with v0.2 frontmatter families,
**When** it is served,
**Then** the response includes a derived **trust tier** (unverified / machine-confirmed / human-reviewed from `verified`), a **staleness signal** (stale when `today ≥ stale_after`), and **source provenance** (from `sources`),
**And** a concept without the families is still served as a plain concept (advisory, not access control). *(FR-29; ADR-okf-017)*

### Story 5.5: Parameterized neighbors traversal (no raw AQL)
As an **agent**,
I want **to traverse a concept's structural neighbors via a parameterized endpoint**,
So that **I can follow relationships without arbitrary AQL access**.

**Acceptance Criteria:**
**Given** a concept in a repo graph,
**When** the agent calls `/api/okf/neighbors?depth=`,
**Then** it returns neighbors/backlinks via parameterized traversal over `OKF_{repo}_LINKS_TO` (retaining anchor-text `label`),
**And** no raw AQL is ever exposed to agents. *(FR-7 traversal, FR-17; ADR-okf-011; **2026-08-13**: traversal is **single-repo-scoped** (`OKF_{repo}_LINKS_TO`) — agents select a repo first (via search or explicit `repo_id`), then traverse; multi-graph traversal fusion is out of scope for v1 (ADR-okf-028) — G22/G23.)*

### Story 5.6: MCP-ready handlers
As a **platform engineer**,
I want **the serving handlers structured so an MCP transport can expose them without re-implementation**,
So that **MCP Resources/Tools arrive when the workflows service MCP client lands**.

**Acceptance Criteria:**
**Given** the search/get/list/outline/neighbors handlers,
**When** the MCP transport is added later,
**Then** the same handlers back MCP Resources (index/manifest) + Tools over Streamable HTTP with no search/get logic re-implemented,
**And** the MCP surface is custom (Node MCP SDK / Kong AI MCP proxy) — **not** OPEA's `OpeaMCPToolsManager`/`mcpo`; the handlers ship with REST now. *(FR-17; Architecture §3, §10; ADR-okf-003)*

---

## Epic 6: Hardening — Security, Observability, Sovereignty
*(Cross-cutting; lands as the server matures.)*

### Story 6.1: Authentication & per-tenant/repo/domain authorization
As a **security officer**,
I want **every OKF call authenticated and authorized at tenant/repo/domain granularity**,
So that **access is least-privilege and verifiable**.

**Acceptance Criteria:**
**Given** Keycloak OIDC terminated at Kong,
**When** a request arrives,
**Then** the bearer token is validated (`jose`/JWKS via OIDC discovery) with audience bound to the OKF server (RFC 8707, no passthrough); authorization enforces `okf:{tenant}:{repo}:{read|admin}` encoded as `chunk_labels` (`t:`/`r:`/`d:`) so the retriever's existing label filter enforces isolation,
**And** a token lacking a repo's scope cannot read that repo's concepts. *(FR-18; NFR-S2; ADR-okf-003, ADR-okf-002; **2026-08-13 (G3/G15 P0 fix)**: **default-deny** — undefined/foreign domain → empty authorized set + **404** on foreign repos (not the full catalog); per-repo mutation requires `requireRepoScope(repo_id, 'admin')` **replacing** the global `tools-admin` role; `requireScope('okf:read')` middleware on every call; scope claims resolved from the token in `auth.js`. ADR-okf-025.)*

### Story 6.1b: Authz Resolver — token → authorized graph set + per-graph labels *(NEW 2026-08-13; ungated Node; G8)*
As a **platform engineer**,
I want **a component that translates a token into the graphs it may read and the per-graph ACL labels**,
So that **the Graph Router and retriever get a correct, per-graph-parameterized authorized set**.
**Acceptance Criteria:** **Given** a verified OIDC token with `okf:{tenant}:{repo}:{read|admin}` scopes, **When** `authz-resolver.js` resolves it, **Then** it returns `{ graph_names:[OKF_repoA,…], per_graph_labels:{ OKF_repoA:[t:t1,r:repoA,d:domA],… }, domains:[domA,…] }` (per-graph map, **not** a flat/global union), cached **per-session** (invalidate on token refresh), **and** default-deny on unknown scopes. *(FR-18; ADR-okf-025; G8; consumed by Story 1.2/1.3.)*

### Story 6.2: Audit (FOI-exportable, append-only)
As a **data-protection officer**,
I want **every serving/ingestion/admin action recorded in a tamper-evident audit log**,
So that **compliance is demonstrable on demand**.

**Acceptance Criteria:**
**Given** the `okf_audit` append-only collection,
**When** any serving/ingestion/admin action occurs,
**Then** it records actor, action, repo, concept, version, timestamp, source IP, trace ID; a date-ranged FOI/GDPR export succeeds for any repository/tenant; records are retained per policy. *(FR-19; NFR-T2; **2026-08-13 (G16, ADR-okf-029)**: two-tier failure mode — **write-before-respond** for governance actions (publish/deprecate/retire/delete/ACL — SM-4 holds; the launch-gate test verifies this under ArangoDB failure, LG-4), best-effort for serving; schema adds `tenant`, `actor_roles[]`, `deletion_reason`, `prev_hash` (hash chain + root publication); indexes on `tenant` + compound `(repo_id, ts)`; INSERT-only DB user (no UPDATE/DELETE) — tamper-evidence; an explicit volume policy enumerates audit-worthy actions.)*

### Story 6.3: End-to-end tracing
As an **SRE**,
I want **distributed traces across OKF → retriever → LLM with PII filtered**,
So that **I can debug the RAG path without exposing sensitive data**.

**Acceptance Criteria:**
**Given** OTel instrumentation,
**When** an agent query flows OKF → retriever → LLM,
**Then** spans are linked by W3C `traceparent` and visible in VictoriaTraces; PII is filtered from span attributes (`tracing-pii.js` pattern),
**And** no raw tokens/passwords/PII appear in spans. *(FR-20; NFR-T1; ADR-okf-003)*

### Story 6.4: Health, readiness & metrics
As an **SRE**,
I want **health endpoints and Prometheus metrics integrated with the existing stack**,
So that **orchestration and dashboards work**.

**Acceptance Criteria:**
**Given** the OKF Server,
**When** it runs,
**Then** `/health` and `/ready` pass/fail correctly for orchestrator checks; Prometheus metrics (ingest throughput, query latency, error rate, repository health) flow into VictoriaMetrics/Grafana; structured logging uses Winston `safeStringify` (no PII bypass). *(FR-21; NFR-T3; NFR-S6)*

### Story 6.5: Supply chain + air-gap validation
As a **security officer**,
I want **SBOM, signed images, blocking scans, and verified air-gap operation**,
So that **the deployment is sovereign and supply-chain-safe**.

**Acceptance Criteria:**
**Given** the CI pipeline (ADR-0001) and deployment,
**When** the image is built/deployed,
**Then** a CycloneDX SBOM is produced (retained 1 yr), images are signed, container scanning is a **blocking** MR gate; an air-gapped deployment passes validation with zero outbound calls except declared source endpoints. *(NFR-S1, NFR-S5; ADR-okf-009)*

---

## Epic 7: AI-Driven OKF Producer (Crawl → Draft)
*(UNGATED. Builds AFTER Epic 3. Depends on Story 2.2 (done), **2.3 (parser — defines the frontmatter contract the producer emits)**, 2.5 (bundle ingest route), Epic 3 (admin UI drives it). Co-develops with 4.2/4.3/4.4 (editor + lifecycle + review gate). Producer-assigned labels fully steer retrieval after Story 2.6 (ACL-preserve) + Epic 1 (multi-graph fan-out) — both gated by the OPEA 1.5 bump.)*

### Story 7.1: Multi-provider model client + sovereignty gate
As a **platform engineer**,
I want **a configurable inference client (internal granite OR a frontier model by API key) for the OKF Server**,
So that **producer draft quality can be tuned per deployment without breaking sovereignty**.

**Acceptance Criteria:**
**Given** the OKF Server (Node, CPU-only) and `OKF_PRODUCER_MODEL_PROVIDER` env,
**When** the server starts,
**Then** `services/model-client/` resolves the provider — `internal` reuses the OpenAI-compatible vLLM client (`VLLM_ENDPOINT`/`VLLM_API_KEY`); `openai`/`xai` point the same client at their `base_url`; `anthropic`/`gemini` use provider SDKs with response normalization + guided-JSON-via-tool-envelope adapters (no native `response_format`),
**And** if a non-`internal` provider is selected while `LLM_EXTERNAL_EGRESS_ENABLED != 1` the service **refuses to start** (fail-closed), all API keys come from `.env`/vault by name (never in code or the browser), new npm deps pass the **blocking** `scan:okf-server` gate + CycloneDX SBOM, and a Jest `createApp()` test covers provider resolution + the gate. *(FR-31; ADR-okf-020; NFR-S1, NFR-S5.)*

### Story 7.2: Crawl→concept draft producer pipeline (assemble → AI-adjust → cross-link)
As a **steward**,
I want **a completed crawl lifted into a structured OKF repository draft — concepts assembled, AI-adjusted, and cross-linked**,
So that **I review a well-structured bundle instead of hand-authoring from a flat dump**.

**Acceptance Criteria:**
**Given** a completed crawl (`{fileId}.md`, `## Source:` blocks) and a target repo,
**When** `POST /api/okf/repos/:repo_id/produce-from-crawl {file_id, model_tier}` is called (tools-admin) **or** the fire-and-forget post-crawl trigger fires (crawlWorker success block reads `crawl_job.config.okf`; a producer failure never breaks crawl success),
**Then** `producer-service.js` segments the dump, drafts concept `.md` files (frontmatter matching `parser-service` input — `generated.by=agent:okf-producer`, `sources` from the `## Source:` URLs), **AI-adjusts** titles/summaries/bodies, and **cross-links** concepts into the structural graph (FR-7) with targets constrained to a **closed concept-ID namespace** (no fabricated links),
**And** drafts pass Presidio PII redaction (blocking) + ClamAV, write to `okf_concepts_meta` at `status=review` with audit rows, a producer-job lifecycle mirrors `crawl_job` (progress/logs/kill), and **publish remains a separate steward action** (server-enforced `unverified` trust tier, never auto-publish). *(FR-30; FR-5, FR-7, FR-9, FR-10; ADR-okf-019; **2026-08-13**: define a versioned dump schema `OKF_CRAWL_DUMP_v1` (header + `## Source:` blocks — documented contract) with a version check, and a round-trip segmentation test — G33/G34.)*

### Story 7.3: Automated knowledge-hierarchy + label assignment (steward-vetted)
As a **steward**,
I want **the producer to suggest knowledge-hierarchy additions and per-concept labels that I approve before anything changes**,
So that **labels flow into ingest and query without unvetted taxonomy drift**.

**Acceptance Criteria:**
**Given** the producer's drafts and the existing service-category taxonomy,
**When** the producer proposes hierarchy/labels,
**Then** it reuses the `LABEL_SELECTOR` prompt semantics + `_finalize_chunk_labels` canonicalization, stamps `t:`/`r:`/`d:` ACL labels into frontmatter/`file_labels`, and stages **all** proposed categories/services/labels as `pending` via the **existing** service-category CRUD + `labelService`,
**And** **every hierarchy/label edit requires explicit human (steward) approval before any taxonomy write** — the producer never mutates the service-category hierarchy directly; assigned labels steer retrieval after Story 2.6 (ACL-preserve) + Epic 1 land. *(FR-32; ADR-okf-019; FR-18.)*

### Story 7.4: Crawl-integrated producer UI (crawl → OKF repository)
As an **operator**,
I want **to create an OKF repository directly from the crawl features I already use**,
So that **a crawl becomes an OKF repository draft without leaving the crawl UI**.

**Acceptance Criteria:**
**Given** `AddFromLinkDialog.vue` (crawl creation) and `FileDetailsDialog.vue` (post-crawl),
**When** the operator chooses an OKF target,
**Then** `AddFromLinkDialog` gains an **OKF-repository target** tightly integrated into the existing crawl flow (domain picker via `serviceTreeService.getAdminCategories` + model-tier selector — **keys server-side only**; reuses SITE_PRESETS + crawl config), `FileDetailsDialog` shows a **"Create OKF repository from this crawl"** action next to Ingest when a crawl succeeds, `okfProducerService.js` + Vuex `okf` module back them, live draft/ingest progress polls with `{silent:true}` (clone FileDetailsDialog's timer pattern), and all strings use `translate('okf.…','default')` across locales (English source of truth). *(FR-30; FR-26; UX-DRs; project-context: Options API, `translate()` not `$t()`, httpService.)*

### Story 7.5: Producer hardening — injection resistance, eval harness, cost controls
As a **security officer / steward**,
I want **the producer hardened against injection, measurable for quality, and bounded in cost**,
So that **AI-produced drafts cannot poison the KB, flood review, or egress uncontrolled**.

**Acceptance Criteria:**
**Given** the producer risk register,
**When** hardening lands,
**Then** producer-emitted frontmatter/link fields are treated as **untrusted** (server-side override of trust; closed concept-ID link namespace) to resist **indirect prompt injection via crawled content**, a concept-quality **eval harness** (reference set + `steward rejection rate` guardrail, policing SM-C1/SM-7) exists, per-tenant/per-crawl quotas + trigger RBAC bound GPU/provider cost (including the future agent-trigger scenario), and robots.txt/ToS honoring + output-bundle `license` provenance are addressed. *(NFR-S1/S5; FR-19; ADR-okf-019; **2026-08-13**: this story polices **draft quality only** — retrieval-quality eval (recall@k/precision@k/MRR/cross-graph citation) is split into Story 8.3 (distinct failure mode — G30); add per-repo cost-tagging so quotas (this story's guardrail) are enforceable — G36.)*

### Story 7.6: Multi-source crawl seeding
As an **operator**,
I want **to seed a crawl with multiple URLs**,
So that **a repository draft can be assembled from several authoritative sources about a domain**.

**Acceptance Criteria:**
**Given** the crawler (`Crawler.crawl(pool,…)` already array-capable) and the single-URL job-creation layer (`scheduleSiteCrawl`, `AddFromLinkDialog`),
**When** the operator creates an OKF-target crawl,
**Then** `scheduleSiteCrawl` + `crawl_job` carry a seed-URL **list** (threaded to `crawler.crawl([...])`), `AddFromLinkDialog` collects multiple seeds for an OKF-target crawl, and per-source provenance is preserved into each draft's `sources`. *(FR-33.)*

### Story 7.7: Produce OKF repository from selected/uploaded documents — document entry points *(NEW 2026-08-13; ungated)*
As a **steward**,
I want **to create an OKF repository from documents we already hold or upload (docx/pdf/xlsx/txt/md) — from the document-management UI or the creation wizard — without a crawl**,
So that **existing policy PDFs, reports, and spreadsheets become a governed, retrievable knowledge base**.
**Acceptance Criteria:** **Given** documents in the document-repository, **When** a steward triggers production from documents via EITHER entry point — (a) the **existing document-management UI**: multi-select documents **not yet ingested** into the free-form corpus + a "Create OKF repository from selected" action; OR (b) the **"Create OKF Repository" wizard** documents step: multi-select existing documents AND/OR upload new ones (docx/pdf/xlsx/txt/md — new uploads run the existing ClamAV scan + text-extraction) — **Then** `POST /api/okf/repos/:repo_id/produce-from-documents {file_ids:[…], model_tier}` (tools-admin) triggers `producer-service.js`, which reads each document's extracted text (reusing the document-repository text-extraction — NO new ingestion format), segments per-document into concepts, drafts frontmatter (`generated.by=agent:okf-producer`, `sources` from each document's file_id/name), AI-adjusts + cross-links (FR-7, closed concept-ID namespace), and routes through the **same** downstream as the crawl path — Presidio (blocking) + the Label Onboarding wizard (FR-36) + `status=review` (never auto-publish, server-enforced `unverified`); per-source provenance is preserved into each draft's `sources`. The producer core is **source-agnostic** (crawl dump and uploaded documents differ only in the input adapter). *(FR-37; FR-5, FR-7, FR-9, FR-10, FR-30, FR-36; ADR-okf-019, ADR-okf-033.)*

> **Entry points into OKF creation/curation (2026-08-13):** the unified wizard (FR-38) composes three workflows, each reachable from its native entry point — **(1) Crawler**: the existing crawl UI (`AddFromLinkDialog`/`FileDetailsDialog`) is extended to declare OKF intent → produce-from-crawl (Story 7.4); **(2) Documents**: the existing document-management UI (multi-select un-ingested docs) + the wizard documents step → produce-from-documents (Story 7.7); **(3) Manual**: the in-app editor (FR-25). All converge on produce → label-onboard (FR-36) → curate + validate + auto-correct (FR-38) → review → publish.

---

## Epic 8: Test Infrastructure & Evaluation
*(NEW 2026-08-13. Cross-cutting. The highest-leverage testing investment — makes the multi-repo scaling claim, the launch gates, and the "verify the strategy is solid" goal measurable. Most stories are ungated; 8.5 is a documented contingency.)*

### Story 8.1: Static fixture site + seed repos + golden queries *(G20)*
As a **platform engineer**,
I want **deterministic test fixtures (a static crawl site, seed OKF repos, and golden queries with known answers)**,
So that **CI can verify selection, retrieval, and ACL without depending on a live site**.
**Acceptance Criteria:** **Given** a committed static HTML fixture site (3–5 pages, served via a fixture container in CI), **When** the seed script runs, **Then** it creates 3 known OKF repos (`OKF_REPO_HEALTH`, `OKF_REPO_AGRI`, `OKF_REPO_LEGAL`) with 5–10 known concepts each, known labels, known ACL prefixes, **and** a golden-query file maps queries → expected concept IDs per repo (ground truth for selection + retrieval eval); a dump-format round-trip test asserts correct producer segmentation. *(G20; unblocks G30/G31.)*

### Story 8.2: Multi-graph retrieval integration test *(G31)*
As an **SRE**,
I want **an integration test that exercises a real cross-graph query end-to-end**,
So that **fan-out, provenance, ACL exclusion, and size-ratio behavior are verified, not just unit-fused**.
**Acceptance Criteria:** **Given** the seed fixtures, **When** a cross-graph query runs, **Then** the test asserts: provenance (`graph_name`/`repo_id`/`concept_id`) on every hit; ACL exclusion (repo-A caller gets zero repo-B chunks); a size-ratio sweep (1 small + 1 large repo) does not drown the small repo; **and** this runs in CI (not only `rrf_fuse` unit tests). *(G31; LG-2.)*

### Story 8.3: Retrieval-quality eval harness *(G30)*
As a **platform engineer**,
I want **a retrieval-quality eval harness distinct from the producer draft-quality eval**,
So that **grounding precision is measured against ground truth, not conflated with draft quality**.
**Acceptance Criteria:** **Given** the golden-query file + seed fixtures, **When** the harness runs, **Then** it reports recall@k, precision@k, MRR, and cross-graph citation correctness; it is distinct from Story 7.5 (draft quality). *(G30; SM-3.)*

### Story 8.4: RRF parameter-sweep harness *(G21)*
As a **platform engineer**,
I want **a harness that sweeps RRF `k` and per-graph weights against the seed fixtures**,
So that **cross-graph fusion weights are tuned with evidence, not intuition**.
**Acceptance Criteria:** **Given** the seed fixtures + the retrieval eval (8.3), **When** the sweep runs, **Then** it varies `k` + per-graph size/confidence weights and reports the best config for recall@k/precision@k/MRR; the chosen weights are checked in as defaults. *(ADR-okf-027; G21; resolves PRD Q7.)*

### Story 8.5: OPEA-1.5 fallback shim *(CONTINGENCY ONLY — not built unless Epic 1 is ungated before the bump merges — G19)*
As a **platform engineer**,
I want **a serial fan-out shim behind the plural `graph_names` interface on the current (pre-bump) base**,
So that **Epic 1 can be tested before the OPEA 1.5 bump merges IF the team decides to ungate it**.
**Acceptance Criteria:** **Given** the standing decision to **wait for the bump merge (D24, no slip date)**, **When** this story is *not* activated, **Then** nothing is built — the shim design is documented in ADR-okf-023 only; **if** the team later ungates Epic 1, this story implements serial fan-out behind `graph_names` on the current base as a temporary bridge until !277 merges. *(ADR-okf-023; G19; D25 reconciliation — contingency, not a commitment.)*

---

## Epic 9: Label Onboarding (Pre-Ingest Curation)
*(NEW 2026-08-13. A slick, curator-driven way to add EXACTLY the new labels a repo needs — bounded, never exhaustive. Design: [label-onboarding-design-2026-08-13](../../label-onboarding-design-2026-08-13.md); ADRs okf-033, okf-034. Analyze/apply legs ungated; the ingest leg is bump-gated where per-repo graphs are involved.)*

### Story 9.1: Gap-mode labeler + shared canonicalize_label + embedding variant merge *(dataprep)*
As a **platform engineer**,
I want **a read-only dataprep gap-mode that surfaces the minimal label gap for a repo's under-labeled concepts**,
So that **a steward can curate the right new labels before the repo is indexed**.
**Acceptance Criteria:** **Given** the dataprep labeler, **When** `POST /v1/dataprep/label_gap` is called with a repo's parsed concepts, **Then** it runs the same taxonomy-only pass as `_label_with_llm` (:467), captures the previously-discarded `new_labels` (:1067/:1083) **with per-chunk provenance** for chunks resolving <2 taxonomy labels (the under-labeled trigger), runs a layer-2 embedding-cosine near-dup merge (cos ≥ 0.92, reusing `_label_with_embedding.embed_documents` :1111), and **short-circuits before `_process_batch`** (:1156) — no embed/index/SOURCE writes; **and** the lexical canonicalization at :1074-1080 is extracted into ONE shared `canonicalize_label()` used by BOTH `_finalize_chunk_labels` and the gap-mode, with a **contract test** asserting gap-resolved == ingest-resolved on the same fixture. *(FR-36; ADR-okf-033.)*

### Story 9.2: Label-onboarding service + proposal API + okf_label_proposals *(okf-server)*
As a **steward**,
I want **an API that analyzes a repo's label gap and persists an immutable, reviewable proposal**,
So that **curation is auditable and resumable**.
**Acceptance Criteria:** **Given** the okf-server, **When** `POST /api/okf/repos/:repo_id/label-gap/analyze` (`requireRole('tools-admin')`) runs, **Then** `label-onboarding-service` fetches the concept corpus + taxonomy via the **labeler's** `/categories` path (genieai_dataprep_arangodb.py:363, NOT `/categories/detailed`), calls the gap-mode, post-processes (dedup + shared canonicalize + per-domain denylist + FAIL-not-truncate hard cap + `suggested_parent` via embedding similarity), and persists an **immutable proposal** (`status=open`) in new `okf_label_proposals` (the diff + per-line decisions + actor + timestamp IS the audit record); endpoints `/analyze`, `/proposals/:id`, `/preview`, `/apply` under `/api/okf/repos/:repo_id/label-gap`; a per-domain learned `okf_label_denylist` store; MELT counter; Jest `createApp()` tests. *(FR-36; ADR-okf-033, ADR-okf-034.)*

### Story 9.3: OkfLabelOnboardingWizard UI (Analyze → Cluster → Review → Apply) *(Epic 3 frontend)*
As a **steward**,
I want **a slick wizard to curate a repo's label gap with smart defaults and a live preview**,
So that **adding the right labels is fast and trustworthy, not a rubber-stamp**.
**Acceptance Criteria:** **Given** `OkfLabelOnboardingWizard.vue` (Options API, `translate()`, `httpService`, DS primitives), launched from `OkfRepositoryDetails`, **When** the steward curates, **Then** ANALYZE shows a coverage donut (ECharts); CLUSTER shows smart-default traffic lights (auto-accept/auto-reject/needs-review) + per-candidate provenance cards + "Never suggest again" → denylist; REVIEW shows a placement picker (`getAdminCategories`) + ghost-node rendering on the live tree + an amber-only "Ask why" popover (function-call-grounded) + a **live before/after preview** (sample chunks + coverage delta, pinned to the shared canonicalize); APPLY shows a diff summary + growth-budget meter + shareable `?proposal=<id>`; all strings i18n; Jest-tested. *(FR-36, FR-26; UX-DRs; depends on Epic 3 OKF dialogs.)*

### Story 9.4: Apply → ingest wiring + two-store one-way-sync + producer unification
As a **steward**,
I want **Apply to write the canonical hierarchy, sync the legacy store, and fire the real ingest**,
So that **labels exist before the first embed and both stores agree**.
**Acceptance Criteria:** **Given** an approved proposal, **When** Apply runs, **Then** each ADD writes via the existing service-category CRUD (`createCategory`/`createService`) and **one-way-syncs** to the document-repository `labels` collection (ADR-okf-034); the **orchestrator** stamps `file_labels` with `t:/r:/d:` ACL prefixes (FR-34/ADR-okf-021 — the wizard never injects ACLs); the proposal flips `status=applied`; the real ingest fires via `POST /api/okf/repos/:repo_id/ingest` so `_fetch_all_labels` sees the enriched taxonomy and `_finalize_chunk_labels` resolves cleanly (empty `new_labels` WARN); **and** producer proposals (Story 7.3) feed the same `okf_label_proposals` collection + wizard (`source='producer'` badge). Idempotent (re-Analyze supersedes; Apply checks live taxonomy). *(FR-36, FR-32, FR-34; ADR-okf-033, ADR-okf-034.)*

### Story 9.5: Boundedness config + denylist management + golden-fixture tuning + launch guardrail *(gated by Story 8.1)*
As a **security officer / steward**,
I want **the boundedness knobs tunable, the denylist manageable, and rubber-stamping guarded**,
So that **the hierarchy cannot grow unbounded and curation quality is measurable**.
**Acceptance Criteria:** **Given** the config + fixtures, **When** the story lands, **Then** env knobs exist (`OKF_LABEL_GAP_MIN_FREQUENCY` default 2, `OKF_LABEL_GAP_MIN_CONFIDENCE` ~0.7, `OKF_LABEL_GAP_MAX_ADDITIONS` 25 FAIL-not-truncate, `OKF_LABEL_DUP_THRESHOLD` 0.92, `OKF_LABEL_GAP_TOP_K` 5); a per-domain denylist-management view (edit/scope/re-allow); an SM-7 steward-rejection-rate launch guardrail ("Accept all auto" never auto-applies producer-sourced/sub-threshold candidates without per-line confirm); defaults calibrated against the Story 8.1 seed repos; an embedding-model-id-match CI assertion (gap merge uses the same TEI model as ingest). *(FR-36; NFR-S5; gated by Story 8.1.)*
