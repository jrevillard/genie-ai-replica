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

## Epic List

> **Cross-Pillar Dependencies (confirmed with the team).** OKF is one of four agentic-enablement pillars; these are the dependencies that shape build order:
>
> | Dependency | Impact on OKF | Gate |
> |---|---|---|
> | **OPEA 1.5 bump** (!277, `feat/opea-1.5-upgrade/prd`) | **All OKF Python work lands on the bumped base** — Epic 1 (retriever fan-out + ChatQnA) **and** Epic 2 Story 2.6 (dataprep graph_name wiring + metadata + repo-level retract). | **Hard gate** — both wait for !277 to merge to `main`. |
> | **Agentic workflows** (!280, `feat/agentic-workflows`) | Agentic **grounds in OKF via REST now** (depends on OKF Epic 5 serving for grounding data). OKF's **MCP transport** (Story 5.6) is gated on the agentic service's MCP client landing. | REST: none (agentic consumes when ready). MCP (5.6): gated on agentic MCP client. |
> | **SST** (!279, `feat/sst`) | **Pattern only — no code dependency.** OKF follows the SST Redis Streams + DLQ pattern for ingest resilience (NFR-R2); it imports no SST code and owns its own PII (Presidio) + audit. | **None.** |
>
> **Build order:** Epic 2's **Node-side** stories (2.1–2.5, 2.7, 2.8) + Epic 3 (UI) + Node-side Epic 4 stories are **ungated and start first**. The **Python** stories (Epic 1, Epic 2.6) wait for the bump. Epic 5 REST builds once Epic 2 indexing is unblocked (post-bump); Epic 5.6 (MCP) waits for the agentic MCP client. Epics are numbered by Architecture §13 phase order, **not** by build order.

### Epic 1: Unified Multi-Graph Grounding  *(GATED by OPEA 1.5 bump !277)*
One retrieval grounds answers across the free-form corpus **and** all authorized OKF repositories (fan-out + RRF), so a chat response can cite concepts from any source.
**FRs covered:** FR-24. **Builds after:** bump merges.

### Epic 2: OKF Server — Repository Ingestion & Management  *(Mostly ungated — build first; Story 2.6 gated by bump)*
An operator can register/create an OKF repository, sync it from Git/S3, have it validated, virus-scanned, PII-redacted, parsed, and indexed into its own graph — and manage it via CRUD. The foundational greenfield service.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-13, FR-21, FR-22, FR-23, FR-27, FR-28 (+ ingest-side NFRs).

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
**And** each result hit carries `graph_name`/`repo_id`/`concept_id` for citation, `chunk_labels` ACL is applied per graph (unauthorized repos contribute nothing), and a single-graph call still works unchanged. *(FR-24; NFR-S7 additive; Architecture §8.4, §9)*

### Story 1.2: ChatQnA forwards the authorized graph set
As a **chat user**,
I want **my chat query to ground across all graphs I'm authorized for**,
So that **the answer cites concepts from the free-form corpus and OKF repositories together**.

**Acceptance Criteria:**
**Given** a caller's token grants a set of OKF repositories,
**When** ChatQnA handles a `ChatCompletionRequest`,
**Then** it carries the authorized graph set (`GRAPH` + `OKF_*`) through `GenieaiRetrieverParms` → `align_inputs` → retriever `invoke(graph_names=…)`,
**And** an unauthorized repository never appears in the forwarded set, and the end-to-end path is covered by an OTel trace. *(FR-24; Architecture §8.5; also fix stale `RETRIEVER_ARANGO_GRAPH_NAME`→`ARANGO_GRAPH_NAME` env hint, §8.7)*

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
**And** broken links are tolerated (not a failure), and parsed concepts are handed to dataprep's ingest path. *(FR-6, FR-7; Architecture §6 step 2; ADR-okf-010, ADR-okf-017)*

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
**And** malware is rejected + logged with nothing indexed. *(FR-5, FR-22; Architecture §8.2; ADR-okf-008, ADR-okf-016)*

### Story 2.6: dataprep graph_name wiring + additive metadata + repo-level retract  *(GATED by OPEA 1.5 bump !277)*
As a **platform engineer**,
I want **dataprep to index OKF concepts into the right per-repo graph with OKF metadata and support repo-level retraction**,
So that **each repository is isolated and cleanly removable**.

**Acceptance Criteria:**
**Given** dataprep (`genieai_dataprep_microservice.py`, `genieai_dataprep_arangodb.py`, `core/genieai_api_protocol.py`),
**When** an OKF ingest request arrives,
**Then** dataprep reads `graph_name` from the **request** (not just env) on ingest + retract; `ArangoDBDataprepRequestFromDocRepo` carries additive `concept_id`/`bundle_version`/`source_type`/`repo_id` propagated to chunk-doc metadata; TEI embedding is reused; `retract_file` gains a repo/bundle-level retract path (by `repo_id`+`bundle_version`),
**And** the latent retract-default mismatch (`genie_graph`→`GRAPH`/request) is fixed (Architecture §8.7), with additive-only schema changes (NFR-S7). *(FR-6, FR-8; Architecture §8.3, §9; ADR-okf-010, ADR-okf-013)*

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
**And** every concept carries a stable document-repository reference so the UI, chat citations, and agents can link to view the original source (never the external origin URL). *(FR-3, FR-5, FR-28; NFR-P1, NFR-P2; Architecture §6 steps 4–5; ADR-okf-004)*

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
**And** mutating actions enforce `tools-admin`/admin role (Kong + OKF Server), DS primitives are used, and components are Jest-tested. *(FR-26; UX-DR2, UX-DR4, UX-DR7)*

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
**And** a concurrent query during re-index sees the last-good index. *(FR-8, FR-25 CRUD; NFR-S4; Architecture §5)*

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
**Then** only `published` content is served to agents (`review`/`draft` invisible to non-steward queries); transitions are role-restricted and auditable (who/when). *(FR-9)*

### Story 4.4: Review & approval gate
As a **steward**,
I want **to review conformance/PII/quality reports and approve or reject content for publication**,
So that **a human sign-off gates what agents see**.

**Acceptance Criteria:**
**Given** a repository/concept in `review`,
**When** a steward acts,
**Then** approval requires a `tools-admin`/steward role and records approver + timestamp; rejection records the reason and returns content to `review`,
**And** approval can write a portable `verified: { by: human:<steward>, at: … }` trust signal (FR-29/ADR-okf-017). *(FR-10)*

### Story 4.5: Versioning & provenance
As a **steward**,
I want **each publish to create an immutable, diffable version with capturable lineage**,
So that **agent citations can pin a version and changes are auditable**.

**Acceptance Criteria:**
**Given** a steward publish action,
**When** it completes,
**Then** an immutable version is created (monotonic, tied to source ref); stewards can list/diff versions; lineage (source ref → concept → served answer) is capturable for citation and audit,
**And** superseded versions are retained until retention/TTL then retracted. *(FR-11; ADR-okf-005)*

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
**Then** it receives ranked concept hits (ID + snippet) across its authorized graphs (FR-24 fan-out when available), scoped by per-tenant/repo/domain RBAC (unauthorized repos excluded silently), token/byte-capped with a `nextCursor`. *(FR-14; NFR-PR1, NFR-PR2)*

### Story 5.2: Get concept document
As an **agent**,
I want **to fetch a concept (full or sliced) by repository + concept ID**,
So that **I can read exactly what I need with a version I can pin**.

**Acceptance Criteria:**
**Given** a concept request (repo + concept ID, optional version/lang),
**When** the agent calls `/api/okf/get`,
**Then** it returns the concept (full or sliced) with token caps and a "fetch more" handle, version-pinned when a version is requested,
**And** an unauthorized request returns **403** (not 404 leakage). *(FR-15; ADR-okf-006)*

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
**And** no raw AQL is ever exposed to agents. *(FR-7 traversal, FR-17; ADR-okf-011)*

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
**And** a token lacking a repo's scope cannot read that repo's concepts. *(FR-18; NFR-S2; ADR-okf-003, ADR-okf-002)*

### Story 6.2: Audit (FOI-exportable, append-only)
As a **data-protection officer**,
I want **every serving/ingestion/admin action recorded in a tamper-evident audit log**,
So that **compliance is demonstrable on demand**.

**Acceptance Criteria:**
**Given** the `okf_audit` append-only collection,
**When** any serving/ingestion/admin action occurs,
**Then** it records actor, action, repo, concept, version, timestamp, source IP, trace ID; a date-ranged FOI/GDPR export succeeds for any repository/tenant; records are retained per policy. *(FR-19; NFR-T2)*

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
