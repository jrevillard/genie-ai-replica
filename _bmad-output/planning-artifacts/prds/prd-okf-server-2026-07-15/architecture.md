---
title: Architecture — GENIE.AI OKF Server
status: draft
created: 2026-07-15
updated: 2026-08-10
initiative: okf-server
branch: feat/okf-server
prd: ./prd.md
builds_on:
  - ../../briefs/brief-okf-server-2026-07-15/brief.md
  - ./prd.md
adrs:
  - ../../../../docs/adr/okf-001-okf-server-component-and-stack.md
  - ../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md
  - ../../../../docs/adr/okf-003-standalone-service-behind-kong.md
  - ../../../../docs/adr/okf-004-pii-redaction-strategy.md
  - ../../../../docs/adr/okf-005-versioning-semantics.md
  - ../../../../docs/adr/okf-006-403-vs-404-unauthorized.md
  - ../../../../docs/adr/okf-007-admin-steward-ui.md
  - ../../../../docs/adr/okf-008-bundle-content-store.md
  - ../../../../docs/adr/okf-009-performance-and-supply-chain.md
  - ../../../../docs/adr/okf-010-okf-markdown-loader-location.md
  - ../../../../docs/adr/okf-011-no-raw-aql-to-agents.md
  - ../../../../docs/adr/okf-012-multi-graph-grounding.md
  - ../../../../docs/adr/okf-013-graph-name-wiring.md
  - ../../../../docs/adr/okf-014-repository-model.md
  - ../../../../docs/adr/okf-015-in-app-authoring-curation.md
  - ../../../../docs/adr/okf-016-external-source-management.md
  - ../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md
authors: Genie.ai Dev
---

# Architecture: GENIE.AI OKF Server

> Production solution architecture for the OKF Server. Implements the capabilities in the [PRD](./prd.md); all decisions are recorded in the [ADRs](../../../../docs/adr/) and the brief [decision log](../../briefs/brief-okf-server-2026-07-15/.decision-log.md). This document is implementation-level (component, data, deployment views); the PRD is capability-level.

## 1. System architecture

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
   │ scopes)  │         │  plugins)    │                    │ • concept CRUD + authoring│
   └──────────┘         └──────┬───────┘                    │ • source-sync (Git/S3)    │
            ┌──────────────────┼───────────────────┐        │ • curation/governance     │
            │                  │                   │        │ • serving (REST, MCP-ready)│
            ▼                  ▼                   │        │ • authz (jose)            │
   ┌────────────────┐ ┌──────────────────┐        │        └──┬──────────────┬─────────┘
   │ Vue 3 admin    │ │ components/       │ bundle │           │              │
   │ AdminDashboard │ │ document-         │ bytes  │ ingest    │ read/write   │
   │ (OKF tab +     │ │ repository        │+ClamAV │(graph_name)│ OKF graphs  │
   │  4 dialogs)    │ │ (NEW bundle route)│+graph_ │           ▼              ▼
   └────────────────┘ └────────┬─────────┘ name    │  ┌────────────────┐ ┌──────────────────┐
                               │ =OKF_{repo_id}    │  │ genie-ai-overlay│ │    ArangoDB      │
                               ▼                   │  │  dataprep       │ │ GRAPH_* (free-   │
                      ┌──────────────────┐ embed   │  │ (graph_name=    │ │  form, existing) │
                      │ genie-ai-overlay │◄───────►│  │  OKF_{repo_id}) │ │ OKF_{repo}_*     │
                      │  retriever        │  TEI   │  │ +retriever EXT  │ │  (per repo)      │
                      │ (MULTI-GRAPH:     │        │  │ (fan-out+RRF)   │ │ okf_repositories │
                      │  GRAPH + OKF_*)   │◄───────┤  │ ChatQnA forwards│ │ okf_concepts_meta│
                      └──────────────────┘  query │  │  graph set      │ │ okf_audit/sources│
                               │                  │  └────────────────┘ └──────────────────┘
                               ▼                  │           ▲ OTel
                      ┌──────────────────┐        │     ┌─────┴──────┐
                      │ Redis Streams+DLQ│        │     │ OTel Coll. │
                      └──────────────────┘        │     │ →Victoria* │
                                                  │     └────────────┘
```

## 2. Repository → graph model ([ADR-okf-002](../../../../docs/adr/okf-002-shared-graph-multi-tenancy.md), [ADR-okf-014](../../../../docs/adr/okf-014-repository-model.md))

- A **repository** (`okf_repositories` doc): `repo_id`, `name`, `domain` (service-category key), `source` (Git/S3 ref), `graph_name = OKF_{repo_id}`, `okf_version` (defaults to `"0.2"`; v0.1 bundles consumed via fallback — [ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md)), lifecycle state, `version`, `curator`, ACL (`required_scopes`, `sensitivity`), retention, timestamps.
- On first ingest, `langchain-arangodb ArangoGraph.add_graph_documents(graph_name=OKF_{repo_id})` auto-creates the graph + four collections; the retriever lazily creates `OKF_{repo_id}_BM25_VIEW` on first query (existing behavior).
- ACL is encoded as **chunk labels** on every chunk/edge: `t:<tenant>`, `r:<repo_id>`, `d:<domain>` — reusing the retriever's existing `chunk_labels` filter (zero retriever change for the filter itself).

## 3. Multi-graph grounding (CORE — [ADR-okf-012](../../../../docs/adr/okf-012-multi-graph-grounding.md), [ADR-okf-013](../../../../docs/adr/okf-013-graph-name-wiring.md))

Today `graph_name` is a single global (`GRAPH`); ChatQnA never forwards one and doc-repo never sends one. To ground in **all** data (PRD FR-24):

- **Retriever extension**: `invoke()` accepts a list `graph_names` (in addition to single). For each authorized graph it runs the existing hybrid path (dense COSINE + BM25 view + optional traversal), then **RRF-fuses** the per-graph ranked lists (reuse the existing `rrf_fuse`). ACL labels applied per-graph. Additive change to one method family.
- **ChatQnA wiring**: `ChatCompletionRequest`/`GenieaiRetrieverParms` carry the **authorized graph set** (`GRAPH` + all `OKF_{repo_id}` the caller's token grants). ChatQnA forwards it to the retriever so one chat query grounds across all graphs.
- **OKF serving surface** (`/api/okf/search|get|neighbors`): the OKF Server calls the same multi-graph retriever scoped to the caller's OKF repos — one retrieval engine, two entry points (chat + agent). Responses include v0.2 **trust tier + staleness + source provenance** per concept (PRD FR-29, [ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md)).

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
| `okf_concepts_meta` | doc | `concept_id`, `repo_id`, `frontmatter` (full, v0.2 families preserved), `path`, `conformance_issues`, `pii_state`, `bundle_version`, **`generated`, `verified`, `trust_tier` (derived), `status`, `stale_after`, `sources`** ([ADR-okf-017](../../../../docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md)) |
| `okf_audit` | doc (append-only) | `actor`, `action`, `repo_id`, `concept_id`, `version`, `ts`, `source_ip`, `trace_id` |
| `okf_sources` | doc | source state per repo (last commit SHA / S3 version, last sync, health) |

Free-form corpus stays in `GRAPH_*` (unchanged).

## 5. CRUD services & API surface

All via the OKF Server REST API (`/api/okf/*`, Kong-terminated OIDC, role `tools-admin` for mutating). Every operation is audited and OTel-traced. (PRD FR-23/25/9–13.)

- **Repository CRUD** (`/api/okf/repos`): create `{name, domain, source, ACL, retention}` → mints `repo_id`, `graph_name=OKF_{repo_id}`, registers in `okf_repositories`, optionally triggers first sync; list (filtered by authorized domains/repos); read one (status/health/version/concept counts/conformance/PII summary); update (metadata/ACL/retention/source; not `graph_name`); delete (retract entire graph by `repo_id` + remove metadata; cascade audited; irreversible after grace).
- **Concept CRUD** (`/api/okf/repos/{repo}/concepts`): create/read/update/delete concept `.md`; on save → re-parse → incremental re-index → update `okf_concepts_meta` + structural `OKF_{repo}_LINKS_TO` edges (+ `label`).
- **Bundle operations**: validate (§11), publish (immutable version), version list/diff, deprecate, retire (retract). Reserved files `index.md`/`log.md` editable, validated.
- **Source management** (`/api/okf/repos/{repo}/source`): register/update Git or S3; sync now; webhooks + scheduled poll; change detection; health in `okf_sources`.

## 6. Ingestion pipeline (floor to ceiling — PRD FR-4..8, FR-22)

> **Source-of-truth boundaries ([ADR-okf-016](../../../../docs/adr/okf-016-external-source-management.md)):** the external Git/S3 origin is a **sync source only** (consulted at sync, never at query/serve time); the **document-repository** retains the versioned copy and is the **single source of truth** for all internal components after upload; ArangoDB is the derived indexed view. Origins are **checked periodically**; deletion/inaccessibility is **detected and handled gracefully** (continue serving from the retained copy + alert the steward). "View source" links resolve to document-repository references, never the external origin URL.

1. **Trigger** — operator action (admin UI "Sync"/"Ingest"), webhook, or schedule → OKF Server `source-sync` enqueues changed concepts (Redis Streams + DLQ).
2. **Fetch + parse** — OKF Server pulls from Git/S3; `okf-parser` (gray-matter + markdown-it AST) extracts frontmatter (incl. v0.2 `generated.at` / `sources`, with legacy `timestamp` / `# Citations` fallback), body, structural links (anchor text → `label`).
3. **Validate** — OKF §11 conformance (non-blocking quality gate) → `okf_concepts_meta`.
4. **Store + scan** — bundle bytes routed through the **document-repository new bundle route** (`POST /api/files/ingest-bundle`): storage + ClamAV (`securityService.scanBuffer`) + the `graph_name` (`OKF_{repo_id}`). Malware → reject + audit.
5. **PII redact** — OKF Server `governance` runs Presidio (document-level default) on concept bodies; failure → withhold from `published` + flag (blocking) ([ADR-okf-004](../../../../docs/adr/okf-004-pii-redaction-strategy.md)).
6. **Index** — document-repository hands concepts to **dataprep** with `graph_name=OKF_{repo_id}` (NEW wiring) → TEI embed → store in `OKF_{repo}_SOURCE` (+concept_id/version/source_type + chunk_labels ACL). Structural edges written to `OKF_{repo}_LINKS_TO`.
7. **Publish** — steward review/approve → `published` (immutable version) → available to grounding + serving.

**Incremental / retraction**: changed concepts re-indexed by content hash; removed concepts cascade-deleted (dataprep `retract_file` extended to bundle/repo-level by `repo_id`/`bundle_version`); `OKF_{repo}_LINKS_TO` edges carry `file_id`/`repo_id` so the existing cascade cleans them.

## 7. Vue 3 admin UI changes (floor to ceiling — PRD FR-26)

Web-only (Flutter has no ingestion/admin UI — confirmed). Extends `AdminDashboard.vue` (Options API, Vuex, vue-i18n, `httpService` → `/api` → Kong). Uses DS primitives per the frontend design system.

- **New tab** "OKF Repositories" on `AdminDashboard.vue` (table: name, domain, source, lifecycle, version, health, last sync, concept count; filters by domain, search, pagination).
- **New components** (`src/components/`): `OkfRepositoryDialog.vue` (create/edit; domain picker via `serviceTreeService.getAdminCategories()`), `OkfConceptEditor.vue` (frontmatter form + Markdown body + link picker + live §11 validation + PII pre-check — the FR-25 authoring surface), `OkfRepositoryDetails.vue` (tabs: Concepts tree, Conformance/PII, Versions, Source/Sync, Audit; actions Sync/Validate/Publish/Retire/Delete), `OkfIngestionProgress.vue` (live ingest/sync polling, `{ silent: true }` pattern).
- **New service + store**: `src/services/okfRepositoryService.js` (httpService-based: listRepos, getRepo, createRepo, updateRepo, deleteRepo, syncRepo, listConcepts, getConcept, saveConcept, deleteConcept, validateBundle, publishBundle, retireRepo, getRepoAudit, getIngestStatus → `/api/okf/*`); Vuex module `okf` (state + actions, `mapGetters`/`mapActions`).
- **i18n** (`src/i18n/locales/*.js`): new `okf.*` tree across all locales (English source of truth); fix opportunistically the undefined `link.*`/`common.close` fallbacks.
- **Auth**: Keycloak bearer via the existing `httpService` request interceptor (401 silent refresh); admin/mutating actions require `tools-admin`/admin role, enforced at Kong + OKF Server.

## 8. Backend changes (floor to ceiling)

### 8.1 New OKF Server — `components/okf-server/` (Node/Express, CommonJS, `createApp()`, imports `components/shared/lib/`) ([ADR-okf-001](../../../../docs/adr/okf-001-okf-server-component-and-stack.md))
Modules: `source-sync/` (git/s3), `okf-parser/` (frontmatter+markdown-it+links), `repository-manager/` (repo/bundle/concept CRUD + lifecycle + versioning + retention), `curation/` (review/approve, conformance, quality), `governance/` (RBAC, PII/Presidio, audit), `serving/` (REST + MCP-ready handlers), `auth/` (jose, mirror gov-chat-backend), `observability/` (OTel). Routes mount at `/api/okf/*`.

### 8.2 document-repository (extend — [ADR-okf-008](../../../../docs/adr/okf-008-bundle-content-store.md))
- **New route** `POST /api/files/ingest-bundle` (`fileRoutes.js` + `fileController.js`): accepts bundle/concept content, reuses `securityService.scanBuffer` (ClamAV), **bypasses** the upload allowlist/magic-byte/langdetect, writes bytes, hands to dataprep **with `graph_name`** (NEW: thread `graph_name` from request → `_ingestFileById` payload → dataprep `/v1/dataprep/ingest_file`). `authorizeRole(['Admin'])`.
- Extend `_ingestFileById`/`_retractFileById` to pass `graph_name` (+ `repo_id`) to dataprep; retract by `repo_id`/`bundle_version`.

### 8.3 dataprep (extend — additive — [ADR-okf-010](../../../../docs/adr/okf-010-okf-markdown-loader-location.md))
- `genieai_dataprep_microservice.py`: read `graph_name` from the **request** (not just env) on ingest + retract; **fix the retract default mismatch** (`genie_graph`→`GRAPH`/request).
- `ArangoDBDataprepRequestFromDocRepo` (`core/genieai_api_protocol.py`): add **`concept_id`, `bundle_version`, `source_type`, `repo_id`** (additive) → propagate to chunk-doc metadata.
- `_load_and_chunk`: accept OKF concept bodies (frontmatter already stripped by the OKF Server parser); header-aware chunking fast-follow.
- `retract_file`: add a **repo/bundle-level retract** path (by `repo_id`+`bundle_version`).

### 8.4 retriever (extend — multi-graph grounding, [ADR-okf-012](../../../../docs/adr/okf-012-multi-graph-grounding.md))
- `invoke()` (`genieai_retriever_arangodb.py`): accept `graph_names: list[str]` (authorized set) in addition to single `graph_name`; loop the existing hybrid path per graph; **RRF-fuse** across graphs (reuse `rrf_fuse`); apply `chunk_labels` ACL per graph; return a unified ranked list with per-hit `graph_name`/`repo_id`/`concept_id` for citation. BM25 views already lazy per graph.
- `fetch_neighborhoods`: support traversal scoped to a repo graph (structural `OKF_{repo}_LINKS_TO`).
- No raw AQL exposed to agents ([ADR-okf-011](../../../../docs/adr/okf-011-no-raw-aql-to-agents.md)); only parameterized `neighbors?depth=`.

### 8.5 ChatQnA (wiring)
- Carry the **authorized graph set** (`GRAPH` + caller's `OKF_*`) through `ChatCompletionRequest`/`GenieaiRetrieverParms` → `align_inputs` → retriever `invoke(graph_names=…)`.

### 8.6 Kong + compose + Ansible + CI
- `api-gateway-solution/new-config/kong_config.json`: `okf-server` service + `/api/okf` route (mirror document-repository); Kong AI MCP plugins for the MCP endpoint.
- `docker-compose.yaml`: `okf-server` service (`genieai_network`, `genieai=true`, CPU-only, non-root, `/health`+`/ready`, fluentd).
- `deploy/ansible`: image + vars for `okf-server`; `--tags` support.
- `.gitlab-ci.yml`: build/scan/promote `okf-server` image (ADR-0001).

### 8.7 Latent bug fixes (do alongside — [ADR-okf-013](../../../../docs/adr/okf-013-graph-name-wiring.md))
- dataprep retract default mismatch (`genie_graph` vs `GRAPH`) → read from request/env consistently.
- stale `RETRIEVER_ARANGO_GRAPH_NAME` env hint → correct to `ARANGO_GRAPH_NAME`.

## 9. OPEA-overlay extension requirements (code-grounded, verified @ `0b6189b0b`)

**Retriever (`genieai_retriever_arangodb.py`) — essentially NO change required:**
- `invoke()` reads `graph_name` per-request → OKF queries pass `graph_name="OKF_{repo_id}"`.
- BM25 ArangoSearch view ensured lazily per `graph_name` (`_ensure_bm25_view`, cached) → `OKF_{repo_id}_BM25_VIEW` auto-created on first query.
- Hybrid dense + BM25 + RRF + graph traversal (`fetch_neighborhoods`) all `graph_name`-parameterized.
- ACL reuses the existing `chunk_labels` filter (`_chunk_passes_label_filter`, AND/OR) — encode OKF tenant/repo/domain as labels → **zero retriever filter change**.

**dataprep (`genieai_dataprep_arangodb.py`) — small additive extensions:**
- `_load_and_chunk` generic → OKF-aware loader from the OKF Server (ADR-okf-010); header-aware chunking fast-follow.
- Additive metadata fields (`concept_id`, `bundle_version`, `source_type`); tenant/repo/domain ride on `file_labels` → `chunk_labels`.
- `retract_file` extended to repo/bundle level.
- OKF link edges carry `file_id`/`repo_id` + `label` for the cascade.

**Net:** retriever ~unchanged; dataprep = OKF loader + additive metadata + repo-level retract — all additive (PRD NFR-S7). Dependencies reused unchanged: TEI, `langchain-arangodb`, OPEA `comps`.

## 10. Authoring & curation tooling (four lanes — [ADR-okf-007](../../../../docs/adr/okf-007-admin-steward-ui.md), [ADR-okf-015](../../../../docs/adr/okf-015-in-app-authoring-curation.md))

| Lane | Role | Tooling |
|---|---|---|
| **Author** (create) | Write/curate concepts | In-app Markdown concept editor (FR-25) **or** hand-author in Git / generate via a producer (Google enrichment agent, OKFy, catalog exporter). Local conformance validator/linter (reuse `okf-conformance`/`okflint`, MIT) before committing. |
| **Operator** (ingest) | Register + sync sources | Declare Git/S3 sources in the admin UI; the server syncs → validates → ClamAV (document-repository) → PII redact → index → stage `review`. |
| **Steward** (curate) | Review/approve/publish/version/govern | Steward REST admin API (`/api/okf/admin/*`, `tools-admin`) + admin UI — review conformance/PII/quality, approve/reject, publish, set ACL/retention, export FOI audit. |
| **Agent** (consume) | Search/get/traverse | REST (now); MCP (post-SST). |

Tooling layer = in-app editor + steward REST API + admin UI + optional local validator CLI. No standalone separate OKF UI; curation is integrated into the existing admin dashboard.

## 11. Security, privacy, governance, observability

- **Authn**: Keycloak OIDC at Kong (audience-bound, no passthrough); OKF Server defense-in-depth `jose`.
- **Authz**: per-tenant + per-repo + per-domain scopes `okf:{tenant}:{repo}:{read|admin}`; enforced on every call; `tools/admin` role for mutation; dynamic list/search filtering by principal.
- **Privacy**: Presidio PII redaction at ingest (blocking on failure); data minimization; right-to-erasure cascade.
- **Sovereignty**: air-gappable; no egress except declared sources; data residency.
- **Supply chain**: ADR-0001 build→scan→promote; CycloneDX SBOM (1 yr); signed images; non-root CPU containers ([ADR-okf-009](../../../../docs/adr/okf-009-performance-and-supply-chain.md)).
- **Traceability**: OTel spans + W3C `traceparent` across OKF→retriever→LLM; `okf_audit` FOI-exportable; metrics into Victoria*/Grafana.
- **Reliability/scalability**: stateless OKF Server (horizontal); Redis Streams + DLQ; idempotent incremental re-index; last-good index on re-index failure.

## 12. Floor-to-ceiling change manifest (nothing missed)

| Layer | Add / change | Files |
|---|---|---|
| Vue 3 | new OKF tab + 4 dialogs + service + Vuex module + i18n (all locales) | `AdminDashboard.vue`; new `OkfRepositoryDialog/OkfConceptEditor/OkfRepositoryDetails/OkfIngestionProgress.vue`; `services/okfRepositoryService.js`; store `okf`; `i18n/locales/*.js` |
| OKF Server (new) | full Node/Express service | `components/okf-server/` (index createApp, routes, services, middleware, config, Dockerfile) |
| document-repository | bundle route + graph_name threading + repo-level retract | `routes/fileRoutes.js`, `controllers/fileController.js`, `config/appConfig.js` |
| dataprep | request graph_name + additive fields + repo-level retract + bug fix | `genieai_dataprep_microservice.py`, `genieai_dataprep_arangodb.py`, `core/genieai_api_protocol.py` |
| retriever | multi-graph fan-out + RRF + ACL + scoped traversal | `genieai_retriever_arangodb.py` (`invoke`, `fetch_neighborhoods`) |
| ChatQnA | forward authorized graph set | `genieai_chatqna.py`, `core/genieai_api_protocol.py` |
| ArangoDB | per-repo graphs (auto) + `okf_repositories`/`okf_concepts_meta`/`okf_audit`/`okf_sources` | (auto + OKF Server creates meta collections) |
| Kong | okf-server service + /api/okf route + MCP plugins | `api-gateway-solution/new-config/kong_config.json` |
| Compose/Ansible | okf-server service + image + vars | `docker-compose.yaml`, `deploy/ansible/...` |
| CI | build/scan/promote okf-server image | `.gitlab-ci.yml` (ADR-0001) |
| Keycloak | `okf:{tenant}:{repo}:{read|admin}` scopes + `tools-admin` role | realm config |

## 13. Sequencing (production order — not deferral)

0. **OPEA 1.3 → 1.5 overlay bump** (cheap; ~3–5 engineer-days) — rebase the Genie-owned RAG components onto `comps` 1.5. APIs are byte-identical/additive (verified); RAG logic untouched. **Prerequisite for step 1**, which extends these components.
1. graph_name wiring + bug fixes (dataprep/doc-repo) + retriever multi-graph + ChatQnA forwarding → **unified grounding** usable by all RAG. (**Greenfield** — multi-graph fan-out + `graph_name` threading don't exist today; the per-graph BM25-view cache does, so isolation infra is present.)
2. OKF Server skeleton + repository CRUD + document-repository bundle route → **ingest a repository** into its own graph.
3. Vue admin OKF tab + repository dialogs + source sync → **operator ingestion**.
4. Concept editor + curation lifecycle + ACL/audit → **authoring/curation**.
5. Search/get/neighbors serving + MCP-ready handlers → **agent surface**.
6. Hardening: PII, supply chain, observability, air-gap validation → **production ready**.

## 14. Open items

- `repo_id` format + max repositories per deployment (ops sizing).
- domain = service-category top-level category vs any node in the hierarchy.
- retention defaults per domain (regulatory variation).
- RRF weights for cross-graph fusion (tune empirically).
- whether the free-form `GRAPH` corpus should also become domain-partitioned later (not required now).
