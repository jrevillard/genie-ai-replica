---
title: OKF Server — Production Specification
status: draft
created: 2026-07-16
updated: 2026-07-16
initiative: okf-server
branch: feat/okf-server
supersedes_mvp_framing_in: ../prds/prd-okf-server-2026-07-15/prd.md, architecture.md
builds_on:
  - ../briefs/brief-okf-server-2026-07-15/brief.md
  - ../prds/prd-okf-server-2026-07-15/prd.md
  - architecture.md
  - ../../../../docs/adr/okf-001..011
authors: Genie.ai Dev
---

# OKF Server — Production Specification

> **Status of this document.** This is the authoritative production specification for the OKF Server. It **supersedes the MVP/deferral framing** in the earlier PRD and architecture (those remain as foundational context; where they say "MVP / post-MVP / deferred", read "in-scope production capability, phased only by sequencing"). The OKF Server is a **flexible production framework for delivering any RAG use case — any domain, and across domains** — not a minimal slice.

## 1. Purpose & scope

A sovereign, open-source, enterprise/government-grade service that:
- **Hosts multiple OKF knowledge repositories** (one per domain), each an OKF bundle mapped to its own ArangoDB graph.
- Provides **CRUD services** for repositories, bundles, and concept files, plus **in-app authoring/curation tooling** (Markdown concept editor + live OKF §9 validation).
- **Ingests** repositories from Git/S3 through the **existing document-repository** (storage + ClamAV + PII redaction) into **dataprep** (per-repository graph).
- **Grounds RAG responses in ALL available data** — the existing free-form corpus (`GRAPH`) **and** every authorized OKF repository graph — via a **multi-graph retrieval** extension to the existing retriever.
- **Serves** agents over REST now (MCP via the TS SDK, integrated with the planned Server-Side Tools foundation).
- Is sovereign, air-gappable, multi-tenant, privacy-protecting, fully auditable; permissive licenses only; no Neo4j; minimal vendors.

## 2. Locked decisions (production)

| # | Decision |
|---|---|
| D1 | **Production framework**, not an MVP — any RAG use case, any domain, across domains. No deferrals. |
| D2 | **One graph per repository**: `OKF_{repo_id}` (collections `OKF_{repo_id}_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO` + `OKF_{repo_id}_BM25_VIEW`). |
| D3 | **Repository = one OKF bundle = one domain.** Domains reuse the existing **service-category hierarchy** (`/api/service-categories`). |
| D4 | **Unified multi-graph grounding** by **extending the existing retriever** (fan-out + RRF across `GRAPH` + authorized `OKF_*` graphs). ChatQnA wiring carries the authorized graph set. |
| D5 | **In-app authoring/curation**: Vue admin Markdown concept editor (frontmatter form + body + link picker + live §9 validation) + repository/bundle management; external Git/S3 ingest remains a parallel path. |
| D6 | OKF Server = independent `components/okf-server/` (Node/Express), **not OPEA**; consumes the OPEA overlay (dataprep/retriever). (okf-001) |
| D7 | Standalone behind Kong; Keycloak OIDC terminated at Kong; per-repo/per-domain ACL. (okf-003) |
| D8 | Bundle content via **document-repository** (storage + ClamAV + dataprep handoff) through a new bundle-aware route. (okf-008) |
| D9 | **No raw AQL to agents** — parameterized traversal only. (okf-011) |
| D10 | No Neo4j; ArangoDB only; permissive libs only. |

## 3. System architecture

```
              ┌──────────────────────────┐
              │   AI Agents / Chat users  │
              └────────────┬─────────────┘
                           │ REST / MCP / Chat (ChatQnA)
                           ▼
   ┌──────────┐  HTTPS  ┌──────────────┐                    ┌──────────────────────────┐
   │ Keycloak │◄────────│ NGINX → Kong │───────────────────►│ components/okf-server     │
   │ (OIDC;   │  JWKS   │ (terminates  │  /api/okf/*        │ (Node/Express, CommonJS)  │
   │ per-repo │         │  OIDC; AI MCP│                    │ • repository CRUD         │
   │ scopes)  │         │  plugins)    │                    │ • bundle/concept CRUD     │
   └──────────┘         └──────┬───────┘                    │ • authoring (MD editor)   │
                               │ routes by path             │ • source-sync (Git/S3)    │
            ┌──────────────────┼───────────────────────────┤ • curation/governance     │
            │                  │                           │ • serving (REST, MCP-ready)│
            ▼                  ▼                           │ • authz (jose)            │
   ┌────────────────┐ ┌──────────────────┐                 └──┬──────────────┬─────────┘
   │ Vue 3 admin    │ │ components/       │  bundle bytes     │              │
   │ AdminDashboard │ │ document-         │  + ClamAV +       │ ingest       │ read/write
   │ (new OKF tab + │ │ repository        │  graph_name       │ (graph_name) │ OKF graphs
   │ dialogs)       │ │ (NEW bundle route)│  =OKF_{repo_id}   ▼              ▼
   └────────────────┘ └────────┬─────────┘         ┌────────────────┐  ┌──────────────────┐
                               │ base64/HTTP       │ genie-ai-overlay│  │     ArangoDB      │
                               ▼                   │  dataprep       │  │  GRAPH_* (free-   │
                      ┌──────────────────┐ embed   │ (graph_name=    │  │   form, existing) │
                      │ genie-ai-overlay │◄───────►│  OKF_{repo_id}) │  │  OKF_{repo}_*     │
                      │  retriever        │  TEI   │ +retriever EXT  │  │   (per repo)      │
                      │ (MULTI-GRAPH:     │        │ (fan-out+RRF)   │  │  okf_repositories │
                      │  GRAPH + OKF_*)   │◄───────┤ ChatQnA forwards│  │  okf_concepts_meta│
                      └──────────────────┘  query  │  authorized     │  │  okf_audit        │
                               │                  │  graph set      │  └──────────────────┘
                               ▼                  └────────────────┘          ▲ OTel
                      ┌──────────────────┐                                  ┌─────┴──────┐
                      │ Redis Streams+DLQ│                                  │ OTel Coll. │
                      └──────────────────┘                                  │ →Victoria* │
                                                                            └────────────┘
```

### 3.1 Repository → graph model (D2/D3)
- A **repository** (`okf_repositories` doc): `repo_id`, `name`, `domain` (service-category key), `source` (Git/S3 ref), `graph_name = OKF_{repo_id}`, `okf_version`, lifecycle state, `version`, `curator`, ACL (`required_scopes`, `sensitivity`), retention, timestamps.
- On first ingest, `langchain-arangodb ArangoGraph.add_graph_documents(graph_name=OKF_{repo_id})` auto-creates the graph + four collections; the retriever lazily creates `OKF_{repo_id}_BM25_VIEW` on first query (existing behavior).
- ACL is encoded as **chunk labels** on every chunk/edge: `t:<tenant>`, `r:<repo_id>`, `d:<domain>` — reusing the retriever's existing `chunk_labels` filter (zero retriever change for the filter itself).

### 3.2 Multi-graph grounding (D4) — CORE
Today `graph_name` is a single global (`GRAPH`); ChatQnA never forwards one and doc-repo never sends one. To ground in all data:
- **Retriever extension**: `invoke()` accepts a list `graph_names` (in addition to single). For each authorized graph it runs the existing hybrid path (dense COSINE + BM25 view + optional traversal), then **RRF-fuses** the per-graph ranked lists (reuse the existing `rrf_fuse`). ACL labels are applied per-graph. This is an additive change to one method family.
- **ChatQnA wiring**: `ChatCompletionRequest`/`GenieaiRetrieverParms` carry the **authorized graph set** (the free-form `GRAPH` + all `OKF_{repo_id}` the caller's token grants). ChatQnA forwards it to the retriever so one chat query grounds across all graphs.
- **OKF serving surface** (`/api/okf/search|get|neighbors`): the OKF Server calls the same multi-graph retriever (scoped to the caller's OKF repos) — one retrieval engine, two entry points (chat + agent).

## 4. Data model (ArangoDB)

**Per-repository (auto-created, graph_name = `OKF_{repo_id}`):**
| Collection | Type | Key fields (additive over dataprep defaults) |
|---|---|---|
| `OKF_{repo}_SOURCE` | chunk doc | `text`, `embedding`, `file_id`, `chunk_labels` (incl. `t:`/`r:`/`d:`), **`concept_id`, `bundle_version`, `source_type:"okf"`** |
| `OKF_{repo}_ENTITY` | LLM entity | (dataprep) + chunk_labels |
| `OKF_{repo}_HAS_SOURCE` | edge | entity→chunk |
| `OKF_{repo}_LINKS_TO` | edge | concept→concept, + `label` (anchor text), `file_id`, `bundle_version`, chunk_labels |
| `OKF_{repo}_BM25_VIEW` | ArangoSearch | lazy, over `_SOURCE.text` + `chunk_labels` |

**Cross-repository (OKF Server owned):**
| Collection | Type | Key fields |
|---|---|---|
| `okf_repositories` | doc | `repo_id`, `name`, `domain`, `source`, `graph_name`, `okf_version`, `lifecycle_state`, `version`, `curator`, ACL, retention, timestamps |
| `okf_concepts_meta` | doc | `concept_id`, `repo_id`, `frontmatter`, `path`, `conformance_issues`, `pii_state`, `bundle_version` |
| `okf_audit` | doc (append-only) | `actor`, `action`, `repo_id`, `concept_id`, `version`, `ts`, `source_ip`, `trace_id` |
| `okf_sources` | doc | source state per repo (last commit SHA / S3 version, last sync, health) |

Free-form corpus stays in `GRAPH_*` (unchanged).

## 5. CRUD services (floor to ceiling)

All via the OKF Server REST API (`/api/okf/*`, Kong-terminated OIDC, role `tools-admin` for mutating). Every operation is audited and OTel-traced.

### 5.1 Repository CRUD
- **Create** `{name, domain(service-category key), source{type:git|s3, endpoint, ref, credentials_ref, schedule}, ACL, retention}` → mints `repo_id`, `graph_name=OKF_{repo_id}`, registers in `okf_repositories`, (optionally) triggers first sync. Graph created on first ingest.
- **Read/List** (filtered by caller's authorized domains/repos), **Read one** (status, health, version, concept counts, conformance/PII summary).
- **Update** (metadata, ACL, retention, source config; not graph_name).
- **Delete** → retract the entire graph (`retract_file`-style cascade across `OKF_{repo}_*` by repo_id) + remove `okf_repositories`/`okf_concepts_meta`; cascade audited. **Irreversible** = confirmation + retention grace.

### 5.2 Bundle/concept CRUD (in-app curation — D5)
- **Concept editor** (Vue admin): create/edit a concept = frontmatter form (`type` required; `title`, `description`, `resource`, `tags`, `timestamp`) + Markdown body editor + **link picker** (insert `[…](/path/to/concept.md)` from the repo's concept tree) + **live OKF §9 validation** (parseable frontmatter, non-empty `type`, reserved-file structure) + PII pre-check.
- **Concept CRUD**: create/read/update/delete concept `.md` within a repository; on save → re-parse → re-index that concept (incremental, content-hash keyed) → update `okf_concepts_meta` + structural `OKF_{repo}_LINKS_TO` edges (+ `label`).
- **Bundle operations**: validate (§9), publish (immutable version), version list/diff, deprecate, retire (retract).
- **Reserved files**: `index.md` (auto-generated/synced directory listing for progressive disclosure), `log.md` (change history) — editable, validated.

### 5.3 Source management
- Register/update Git or S3 source per repository; **sync now**; webhooks (Git provider / S3 events) + scheduled poll; change detection (git diff `OLD..NEW --name-only`; S3 ETag/LastModified; content SHA-256 idempotency); source health + last-sync state in `okf_sources`.

## 6. Ingestion (floor to ceiling)

**Flow (single concept or whole bundle):**
1. **Trigger** — operator action (admin UI "Sync"/"Ingest"), webhook, or schedule → OKF Server `source-sync` enqueues changed concepts (Redis Streams + DLQ).
2. **Fetch + parse** — OKF Server pulls from Git/S3; `okf-parser` (gray-matter + markdown-it AST) extracts frontmatter, body, structural links (anchor text → `label`).
3. **Validate** — OKF §9 conformance (non-blocking quality gate) → record in `okf_concepts_meta`.
4. **Store + scan** — bundle bytes routed through the **document-repository new bundle route** (`/api/files/ingest-bundle`): storage on disk + ClamAV (`securityService.scanBuffer`) + the **graph_name** (`OKF_{repo_id}`). Malware → reject + audit.
5. **PII redact** — OKF Server `governance` runs Presidio (document-level default) on concept bodies; failure → withhold from `published` + flag (blocking) (okf-004).
6. **Index** — document-repository hands concepts to **dataprep** with `graph_name=OKF_{repo_id}` (NEW wiring; today none is sent) → TEI embed → store in `OKF_{repo}_SOURCE` (+concept_id/version/source_type + chunk_labels ACL). Structural edges written to `OKF_{repo}_LINKS_TO`.
7. **Publish** — steward review/approve → `published` (immutable version) → available to grounding + serving.

**Incremental / retraction**: changed concepts re-indexed by content hash; removed concepts cascade-deleted (dataprep `retract_file` extended to bundle/repo-level by `repo_id`/`bundle_version`); `OKF_{repo}_LINKS_TO` edges carry `file_id`/`repo_id` so the existing cascade cleans them.

## 7. Vue 3 admin dashboard — OKF ingestion UI (floor to ceiling)

Web-only (Flutter has no ingestion/admin UI — confirmed). Extends the existing `AdminDashboard.vue` (Options API, Vuex, vue-i18n, `httpService` → `/api` → Kong).

### 7.1 New admin tab
- Add an **"OKF Repositories"** tab to `AdminDashboard.vue` (alongside *Knowledge Hierarchy* and *Document Management*): a repository table (name, domain, source, lifecycle, version, health, last sync, concept count) with filters by domain (service-category), search, pagination. Mirrors the existing documents tab's patterns (`loadDocuments`, selection, batch actions).

### 7.2 New components (under `components/gov-chat-frontend/src/components/`)
- `OkfRepositoryDialog.vue` — create/edit repository (name, domain = service-category picker via `serviceTreeService.getAdminCategories()`, source config Git/S3 + credentials ref + schedule, ACL, retention). Mirrors `AddFromLinkDialog` form patterns.
- `OkfConceptEditor.vue` — the **Markdown concept editor**: frontmatter form + Markdown body (reuse the existing `marked`/`DOMPurify` render stack) + **link picker** (concept tree of the repo) + live §9 validation panel + PII pre-check + save/publish. The floor-to-ceiling curation surface (D5).
- `OkfRepositoryDetails.vue` — per-repo detail (tabs: Concepts tree, Conformance/PII report, Versions, Source/Sync, Audit) + actions (Sync now, Validate, Publish, Retire, Delete). Mirrors `FileDetailsDialog` (tabs + kill/ingest/retract actions).
- `OkfIngestionProgress.vue` — live ingest/sync status (reuse the crawl-dashboard pattern: `getCrawlJob`/`getCrawlMetrics` style polling via `{ silent: true }`).

### 7.3 New service + store
- `src/services/okfRepositoryService.js` (httpService-based): `listRepos`, `getRepo`, `createRepo`, `updateRepo`, `deleteRepo`, `syncRepo`, `listConcepts`, `getConcept`, `saveConcept`, `deleteConcept`, `validateBundle`, `publishBundle`, `retireRepo`, `getRepoAudit`, `getIngestStatus` → `/api/okf/*` (Kong → okf-server).
- Vuex module `okf` (state: repos, currentRepo, concepts, ingestStatus; actions mirroring the service) — registered in the store, consumed via `mapGetters`/`mapActions` (existing convention).

### 7.4 i18n (all 14 locales)
- New `okf.*` tree in `src/i18n/locales/*.js` (en = source of truth, then ar/bn/de/es/fr/id/man/pt/ru/st/sw/th/zh): `okf.tab`, `okf.repo.{create,edit,domain,source,...}`, `okf.concept.{editor,frontmatter,body,validate,...}`, `okf.lifecycle.*`, `okf.ingest.*`, etc. (English-first; es/fr fully translated precedent; others follow existing completeness). Also fix the existing undefined `link.*`/`common.close` fallbacks opportunistically.

### 7.5 Auth
- Requests carry the Keycloak bearer via the existing `httpService` request interceptor (401 silent refresh). Admin/mutating actions require the `tools-admin`/admin role — enforced at Kong + OKF Server.

## 8. Backend changes (floor to ceiling)

### 8.1 New OKF Server — `components/okf-server/` (Node/Express, CommonJS, `createApp()` factory, imports `components/shared/lib/`)
Internal modules: `source-sync/` (git/s3), `okf-parser/` (frontmatter+markdown-it+links), `repository-manager/` (repo/bundle/concept CRUD + lifecycle + versioning + retention), `curation/` (review/approve, conformance, quality), `governance/` (RBAC, PII/Presidio, audit), `serving/` (REST + MCP-ready handlers), `auth/` (jose, mirror gov-chat-backend), `observability/` (OTel). Routes mount at `/api/okf/*`. Endpoints: repository CRUD, concept CRUD, source sync, validate/publish/retire, search/get/list/outline/neighbors, audit export, admin.

### 8.2 document-repository (extend)
- **New route** `POST /api/files/ingest-bundle` (`fileRoutes.js` + `fileController.js`): accepts bundle/concept content (archives or pre-parsed concepts), reuses `securityService.scanBuffer` (ClamAV), **bypasses** the upload allowlist/magic-byte/langdetect, writes bytes, and hands to dataprep **with `graph_name`** (NEW: thread `graph_name` from request → `_ingestFileById` payload → dataprep `/v1/dataprep/ingest_file`). `authorizeRole(['Admin'])`.
- Extend `_ingestFileById`/`_retractFileById` to pass `graph_name` (and repo_id) to dataprep so per-repo graphs are targeted. Retract by repo_id/bundle_version.
- Labels: OKF repos use service-category domain as the label (consistent with existing `labels` = service-name strings).

### 8.3 dataprep (extend — additive)
- `genieai_dataprep_microservice.py`: read `graph_name` from the **request** (not just env) on both ingest (`:161`) and retract (`:292`) — **fix the retract default mismatch** (`genie_graph`→`GRAPH`/request). Pass through to `ingest_file_with_guardrail`/`retract_file`.
- `ArangoDBDataprepRequestFromDocRepo` (`core/genieai_api_protocol.py`): add **`concept_id`, `bundle_version`, `source_type`, `repo_id`** (additive) → propagate to chunk-doc metadata.
- `_load_and_chunk`: accept OKF concept bodies (frontmatter already stripped by the OKF Server parser); header-aware chunking as a fast-follow (okf-010).
- `retract_file`: add a **repo/bundle-level retract** path (by `repo_id`+`bundle_version`, not just `file_id`).
- `OKF_{repo}_LINKS_TO` edges written by the OKF Server carry `file_id`/`repo_id`/`label` for the cascade.

### 8.4 retriever (extend — multi-graph grounding, D4)
- `invoke()` (`genieai_retriever_arangodb.py`): accept `graph_names: list[str]` (authorized set) in addition to single `graph_name`; loop the existing hybrid path per graph; **RRF-fuse** across graphs (reuse `rrf_fuse`); apply `chunk_labels` ACL per graph; return a unified ranked list with per-hit `graph_name`/`repo_id`/`concept_id` for citation. BM25 views already lazy per graph.
- `fetch_neighborhoods`: support traversal scoped to a repo graph (structural `OKF_{repo}_LINKS_TO`).
- No raw AQL exposed to agents (okf-011); only parameterized `neighbors?depth=`.

### 8.5 ChatQnA (wiring)
- Carry the **authorized graph set** (`GRAPH` + caller's `OKF_*`) through `ChatCompletionRequest`/`GenieaiRetrieverParms` → `align_inputs` → retriever `invoke(graph_names=…)`. Enables chat answers grounded in all data. (additive field + forwarding; the retriever does the fan-out.)

### 8.6 Kong + compose + Ansible
- `api-gateway-solution/new-config/kong_config.json`: add `okf-server` service + `/api/okf` route (mirror document-repository). Kong AI MCP plugins for the future MCP endpoint.
- `docker-compose.yaml`: add `okf-server` service (`genieai_network`, `genieai=true`, CPU-only, non-root, `/health`+`/ready`, fluentd).
- `deploy/ansible`: image + vars for `okf-server`; `--tags` support.

### 8.7 Latent bug fixes (do alongside)
- dataprep retract default mismatch (`genie_graph` vs `GRAPH`) → read from request/env consistently.
- stale `RETRIEVER_ARANGO_GRAPH_NAME` env hint (`env:164`) → correct to `ARANGO_GRAPH_NAME`.
- (Flagged, separate) auth gaps: admin-gate `/api/database/backup|optimize` and `/api/service-categories` mutations — out of OKF scope but recommended.

## 9. Security, privacy, governance, observability (production)

- **Authn**: Keycloak OIDC at Kong (audience-bound, no passthrough); OKF Server defense-in-depth `jose`.
- **Authz**: per-tenant + per-repo + per-domain scopes `okf:{tenant}:{repo}:{read|admin}`; enforced on every call; `tools/admin` role for mutation; dynamic list/search filtering by principal.
- **Privacy**: Presidio PII redaction at ingest (blocking on failure); data minimization; right-to-erasure cascade (repo/concept delete across graphs + audit PII).
- **Sovereignty**: air-gappable; no egress except declared sources; data residency.
- **Supply chain**: ADR-0001 build→scan→promote; CycloneDX SBOM (1 yr); signed images (phase 2); non-root CPU containers.
- **Traceability**: OTel spans + W3C `traceparent` across OKF→retriever→LLM; `okf_audit` FOI-exportable; metrics into Victoria*/Grafana.
- **Reliability/scalability**: stateless OKF Server (horizontal); Redis Streams + DLQ; idempotent incremental re-index; last-good index on re-index failure.

## 10. Floor-to-ceiling change manifest (nothing missed)

| Layer | Add / change | Files |
|---|---|---|
| Vue 3 | new OKF tab + 4 dialogs + service + Vuex module + i18n (14 locales) | `AdminDashboard.vue`; new `OkfRepositoryDialog/OkfConceptEditor/OkfRepositoryDetails/OkfIngestionProgress.vue`; `services/okfRepositoryService.js`; store `okf`; `i18n/locales/*.js` |
| OKF Server (new) | full Node/Express service | `components/okf-server/` (index createApp, routes, services, middleware, config, Dockerfile) |
| document-repository | bundle route + graph_name threading + repo-level retract | `routes/fileRoutes.js`, `controllers/fileController.js` (`_ingestFileById`/`_retractFileById`), `config/appConfig.js` |
| dataprep | request graph_name + additive fields + repo-level retract + bug fix | `genieai_dataprep_microservice.py`, `genieai_dataprep_arangodb.py`, `core/genieai_api_protocol.py` |
| retriever | multi-graph fan-out + RRF + ACL + scoped traversal | `genieai_retriever_arangodb.py` (`invoke`, `fetch_neighborhoods`) |
| ChatQnA | forward authorized graph set | `genieai_chatqna.py`, `core/genieai_api_protocol.py` (`ChatCompletionRequest`/Parms) |
| ArangoDB | per-repo graphs (auto) + `okf_repositories`/`okf_concepts_meta`/`okf_audit`/`okf_sources` | (auto + OKF Server creates meta collections) |
| Kong | okf-server service + /api/okf route + MCP plugins | `api-gateway-solution/new-config/kong_config.json` |
| Compose/Ansible | okf-server service + image + vars | `docker-compose.yaml`, `deploy/ansible/...` |
| CI | build/scan/promote okf-server image | `.gitlab-ci.yml` (ADR-0001) |
| Keycloak | `okf:{tenant}:{repo}:{read|admin}` scopes + `tools-admin` role | realm config |
| i18n | `okf.*` tree (14 locales) + fix `link.*`/`common.close` | `i18n/locales/*.js` |

## 11. ADRs affected

- **Revise okf-002**: per-repository graphs (`OKF_{repo_id}`) + ACL via chunk_labels (replaces "shared OKF graph").
- **New okf-012**: multi-graph grounding via retriever extension (fan-out + RRF; ChatQnA forwards authorized graph set) — CORE.
- **New okf-013**: `graph_name` wiring (doc-repo→dataprep; ChatQnA→retriever) + latent bug fixes.
- **New okf-014**: repository model (repository = OKF bundle = one domain; domains = service-category hierarchy).
- **New okf-015**: in-app authoring/curation (Markdown concept editor + live §9 validation + repo/bundle CRUD).
- okf-008 reinforced (document-repository bundle route carries graph_name). okf-010 reaffirmed (Node-side parsing). okf-011 reaffirmed (no AQL).

## 12. Sequencing (not deferral — production order)

1. graph_name wiring + bug fixes (dataprep/doc-repo) + retriever multi-graph + ChatQnA forwarding → **unified grounding** usable by all RAG.
2. OKF Server skeleton + repository CRUD + document-repository bundle route → **ingest a repository** into its own graph.
3. Vue admin OKF tab + repository dialogs + source sync → **operator ingestion**.
4. Concept editor + curation lifecycle + ACL/audit → **authoring/curation**.
5. Search/get/neighbors serving + MCP-ready handlers → **agent surface**.
6. Hardening: PII, supply chain, observability, air-gap validation → **production ready**.

## 13. Open items (explicit, not deferred)
- Confirm `repo_id` format + max repositories per deployment (ops sizing).
- Confirm domain = service-category **top-level** category vs any node in the hierarchy.
- Confirm retention defaults per domain (regulatory variation).
- RRF weights for cross-graph fusion (tune empirically).
- Whether the free-form `GRAPH` corpus should also become domain-partitioned later (not required now; it stays single).
