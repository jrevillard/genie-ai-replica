# Agentic Enablement — Three-Pillar Plan

**(OPEA 1.5 overlay bump · SST-as-tools · OKF)**
**Date:** August 2026 · **Audience:** Engineering team · **Branch:** `feat/agentic-enablement` (was `feat/okf-server`)
**Decision:** **(A)** retain the overlay build and bump it to **OPEA 1.5** (cheap); **(B)** build the agentic layer as **custom LangGraph on the OPEA `MicroService` harness** (not OPEA `comps/agent`, not `mcpo`); **(C)** SST survives as **the agent's tools + governance**; **(D)** OKF as the knowledge layer.
**File-by-file implementation plan:** `C:\Users\David Forden\Documents\OPEA-1.5-upgrade-analysis.md` (the decision doc — Part A bump + Part B agentic layer).

---

## TL;DR

The medium-term goal — **agentic workflows inside the GENIE RAG system** (roadmap Sprint 24, #603) — is served by **three pillars**:

1. **OPEA 1.5 overlay bump** — the cheap RAG-base refresh.
2. **Custom agentic layer** (LangGraph on the OPEA microservice harness) **+ SST-as-tools**.
3. **OKF** — the knowledge/grounding layer.

**Two grounded findings drive it:**
- **The bump is cheap (~3–5 engineer-days).** The verified v1.3↔v1.5 `comps` source diff shows **every API GENIE depends on is byte-identical or additive** — `ServiceOrchestrator.schedule/align_*` (the chatqna monkeypatch survives), `OpeaComponent` lifecycle, `register_microservice`/`opea_microservices`, `opea_telemetry` (byte-identical), `api_protocol` models. GENIE's RAG logic needs **~zero code changes**. The one hard blocker is `core/constants.py` (`MCPFuncType`); the one real risk is dataprep dependency re-validation (docling/pyspark/sentence-transformers).
- **We build the agentic layer ourselves** — LangGraph-direct + the MCP SDK, hosted on **OPEA's `MicroService` harness** (reuses lifecycle/health/OTel/FastAPI/Kong/build — no separate bootstrap), **not** OPEA's `comps/agent` (it's a LangChain/LangGraph wrapper on a declining, Intel-concentrated project; may not fit our gov-workflow patterns). **SST's value survives** as the agent's tools (web search, stream ingest) + governance.

**Sequence:** bump overlay to 1.5 (Part A, ~3–5 days) → build the agentic layer + SST tools + OKF Phase 1 (Part B, parallel tracks) → #604 → #603 on the custom LangGraph agent.

---

## The three pillars at a glance

| Pillar | Role | Status today | Plan |
|---|---|---|---|
| **1. OPEA 1.5 bump + agentic layer** | RAG-base refresh + the agentic build | Pinned at `v1.3` via the overlay; no LangGraph code yet | **Bump is cheap** (APIs unchanged; ~3–5 days). Build the agentic layer as a new `workflows/` microservice: **comps `MicroService` shell + LangGraph inside**. Not `comps/agent`, not `mcpo`. |
| **2. SST-as-tools** | The agent's tools + governance | Specced (GitLab #696–#725), stale since May, unassigned | **Reduced.** Registry/executor/MCP-plumbing subsumed by LangGraph tools + the MCP SDK. Survivors delivered as tools: **web search (SearXNG)**, **stream ingestor**, **governance** (PII/circuit-breaker/rate-limit/audit). |
| **3. OKF** | Knowledge / grounding layer | Specced (PRD + 16 ADRs on this branch), not built | **Unchanged.** Extends GENIE's existing ArangoDB retriever/dataprep (multi-graph + `graph_name` — greenfield). MCP exposure custom (Node), consumed by the workflows service's MCP client. |

---

## Pillar 1 — OPEA 1.5 overlay bump + custom agentic layer

### Part A — bump the overlay to OPEA 1.5 (~3–5 engineer-days; RAG logic untouched)

The diff proved GENIE's RAG logic needs **~zero code changes**. The actual work (file-by-file in the decision doc §2):

- **One hard blocker — `core/constants.py`:** add `MCPFuncType` (1.5 imports it → ImportError otherwise), adopt the new `ServiceType` members, and **renumber GENIE's `TRANSLATOR` off value 24** (collides with upstream `LANGUAGE_DETECTION=24`). Plus add a GENIE-private `ServiceType.WORKFLOW=101` for Part B. (~0.5 day.)
- **The real risk — dataprep dependency re-validation:** `docling 2.30→2.45`, `pyspark 3.5→4.0`, `sentence-transformers 4.1→5.1`; **do-not-revert `langchain-huggingface 0.1.2→0.3.1`** (1.5's base class needs it). Retire the `#834` lock machinery; requirements path `requirements.txt → requirements-cpu.txt`. Re-run the ingest path against representative docs. (~1.5–2 days.)
- **Verify-only (no edits):** chatqna ~2,560 lines untouched (monkeypatch + `schedule` + 21 `MicroService` all survive), reranker `opea_telemetry` byte-identical, docarray rename hack still applies, retriever `langchain-arangodb` pin re-confirm.
- **Audit + close the blind-spot:** scan for zero/negative `top_n`/`k`/`max_tokens` payloads (1.5's `PositiveInt` tightening will 422 them); pin floating compose tags; **add `smoke:retriever`/`smoke:reranker`/`smoke:chatqna`** CI jobs (the mocked test suite is structurally blind to 1.5 breaks).

> Note: this **supersedes the earlier "scary rebase / 6 coupling surfaces / CRITICAL blast radius" framing.** The diff corrected it — the APIs are stable, the monkeypatch survives, the lift is small. **F2 (flatten-to-fork) is dropped** — not worth ~14–20 days vs ~3–5 for the bump.

### Part B — the agentic layer: custom LangGraph on the OPEA microservice harness

A new `genie-ai-overlay/workflows/` microservice: **comps `MicroService` shell outside, LangGraph-direct inside.** Reuses the lifecycle/`/health`/OTel/FastAPI/Kong/Docker-build pattern GENIE already operates — **no separate microservice bootstrap harness** — while keeping the orchestration logic fully GENIE-owned.

- **Not** OPEA `comps/agent`. **Not** `mcpo`. MCP via the **`mcp` SDK + `langchain-mcp-adapters`** (`workflows/tools/mcp_tools.py`) → GovStack Building-Block MCP servers as LangGraph tools.
- **RAG tool** = HTTP to the existing ChatQnA (`workflows/tools/rag_tool.py`) — the agent grounds in GENIE's RAG moat without in-process coupling.
- **Pause/resume** via a LangGraph `BaseCheckpointSaver` backed by **ArangoDB** (`workflows/checkpoint_arango.py`).
- **OpenAI-compatible** `/v1/chat/completions` + a workflow-status WebSocket, exposed through the comps `MicroService` + Kong.
- `ServiceType.WORKFLOW=101` (GENIE-private, from Part A) registers the new service.

File-by-file structure (full detail in the decision doc §3): `workflows/genieai_workflows_microservice.py` (shell), `state.py`, `nodes.py`, `orchestrator.py`, `tools/{rag_tool,mcp_tools,governance,web_search}.py`, `graphs/`, `mcp_servers/` (mock BB servers), `Dockerfile-workflows_genie-ai`, plus Kong route, BFF WebSocket relay, and a Vue `WorkflowStatusComponent`.

---

## Pillar 2 — SST-as-tools (the agent's tools + governance)

SST's original scope (GitLab #696–#725) overlaps LangGraph tooling + the MCP SDK. After the reframe, the **registry/executor/MCP-plumbing are subsumed**; SST's real surviving value is delivered as **LangGraph tools inside the workflows service**:

| SST survivor | Delivered as | What it does |
|---|---|---|
| **Web search** (Epic 2) | `workflows/tools/web_search.py` — a LangGraph tool | **SearXNG-backed** web search; **rule-based trigger** (confidence threshold + time-sensitive query patterns — the agent decides when RAG alone isn't enough); **result fusion** + context-window budgeting; **source citations** (shared Vue/Flutter JSON schema: `url`, `title`, `source_type`, `retrieved_at`, `confidence`); **graceful degradation** (no hallucinated answers when search fails/returns nothing). Consumed by the agent for external/time-sensitive queries. |
| **Stream ingestor** (Epic 3) | a background ingest service | RSS/Atom feeds, JSON API polling, webhook push → existing **TEI embeddings** → shared ArangoDB `chunks` collection; configurable retention/TTL. The agent's live-data feed (no OPEA equivalent). |
| **Governance** (Decisions 16) | `workflows/tools/governance.py` — wraps every tool call | **PII redaction** (Presidio, BLOCK-on-failure), **circuit breaker**, **per-tool rate limiting**, **audit logging**. This is SST's hardest-to-replace value — OPEA/LangGraph have no governance pipeline. |
| **Admin/UI** (Epic 4) | Vue admin tab (tool + feed management) | Genie-specific admin surface. |

These wire into the workflows service (Pillar 1 Part B). **Re-baseline SST GitLab #696–#725** to this reduced scope (web search + stream ingestor + governance + admin). The hard gate still holds in spirit: governance + web-search integration must precede #603.

---

## Pillar 3 — OKF (knowledge/grounding layer)

Unchanged in intent and scope:

- **Built on GENIE's existing ArangoDB retriever/dataprep** — extended for **multi-graph fan-out + `graph_name` threading** (both **greenfield** — no existing code; the per-graph BM25-view cache exists, so the isolation infra is there). Lands after the 1.5 bump (it extends the same modules the bump touches).
- **MCP exposure (Phase 5) is custom** (Node MCP SDK / Kong AI MCP proxy) — consumed by the workflows service's MCP client (`mcp_tools.py`) like any external MCP server. REST + logic independent of the agent layer.
- OKF's 6-phase build, components impacted, test data, and curation decision are unchanged — see the sections below.

---

## Revised agentic roadmap (#603 / #604)

| Roadmap item | Original plan | Under this decision |
|---|---|---|
| **#603 Agentic Phase 1** | Build LangGraph orchestrator + `mcpo` + 3 mock MCP servers + frontend viz + pause/resume | **Custom LangGraph on the OPEA `MicroService` harness** + **MCP SDK client** (drop `mcpo`) + **SST tools** (web search, governance) + mock GovStack BB MCP servers + Vue workflow viz + **ArangoDB checkpointer** for pause/resume. Materially reduced (no `mcpo`, no custom runtime, no OPEA-agent ramp-up). |
| **#604 ChatQnA refactor** | Break the ~2,560-line monolith (5 near-duplicate `flow_to` variants) into modular files | **Less urgent** — the diff proved the `ServiceOrchestrator.align_*` monkeypatch survives 1.5, so the coupling pressure eased. Still worthwhile (consolidate the 5 duplicate `flow_to` variants) — do **after** the bump, when the megaservice is settled. |

---

## Where it fits in Sprints 20–25

```
Sprint 20–22 (security, SSE, auth, tests): largely complete
Sprint 23: observability DONE; K8s (#600) NOT done (lagging)
        │
        ▼  ← TODAY; Sprint 24 underway
PART A: bump overlay to OPEA 1.5  (~3–5 engineer-days; RAG logic untouched)
        │   constants.py MCPFuncType blocker → dataprep dep re-validation → smoke jobs
        ├───────────────────────────────┐
        ▼                               ▼
PART B: agentic layer              PILLAR 3: OKF
  (workflows/ microservice:          Phase 1 grounding (multi-graph +
   comps MicroService shell +         graph_name — greenfield, on the
   LangGraph inside)                  bumped retriever/dataprep)
  + SST tools (web search,            → server skeleton → admin UI →
     stream ingestor, governance)      authoring → serving → hardening
  + mock GovStack BB MCP servers
        │                               │
        ▼                               ▼
Sprint 24: #604 ChatQnA refactor (consolidate flow_to)  →  #603 on the custom LangGraph agent
        │
        ▼
Sprint 25: #606 GovStack BB integrations (real MCP servers) + #607 multi-channel
```

**Critical-path note:** Part A (the bump), OKF Phase 1, and #604 all touch `genieai_chatqna.py` / retriever / dataprep. Order: **bump → OKF Phase 1 + SST tools → #604 refactor → #603.** Align with jrevillard — these are his modules.

---

## Components impacted by OKF (exact impacts)

Floor-to-ceiling — every layer OKF touches (per OKF architecture §8/§12 + ADRs). *(OKF-specific; the OPEA 1.5 bump's change set is in the decision doc §2.)*

| Component | Exact impact | Layer / owner | New vs. extend |
|---|---|---|---|
| **`components/okf-server/`** | Full new Node/Express (CommonJS, `createApp()`) service: repository CRUD, concept CRUD + authoring, source-sync (Git/S3), curation/governance lifecycle, REST serving (MCP-ready), `jose` authz, Dockerfile | Node — **david** | **New** |
| **gov-chat-frontend** (Vue 3) | New **"OKF Repositories" admin tab** on `AdminDashboard.vue` + **4 dialogs** (`OkfRepositoryDialog`, `OkfConceptEditor`, `OkfRepositoryDetails`, `OkfIngestionProgress`) + `services/okfRepositoryService.js` + Vuex `okf` module + i18n (all locales). Web-only; Flutter has no admin UI. | Frontend — **david** | Extend |
| **document-repository** (Node) | New **`/api/files/ingest-bundle`** route (bypasses upload allowlist / magic-byte / langdetect); `_ingestFileById` / `_retractFileById` thread `graph_name` + `repo_id`; retract by `repo_id` / `bundle_version`; bundle content store + versioning consolidated here | Node — **david** | Extend |
| **dataprep** (Python) | Accept `graph_name` from request (not just env) on ingest + retract; additive chunk metadata (`concept_id`, `bundle_version`, `source_type`, `repo_id`); OKF-aware Markdown loader; repo/bundle-level retract; **bug fix** — retract default mismatch (`genie_graph` vs `GRAPH`) | Python — **jrevillard** | Extend (additive) + bug fix |
| **retriever** (Python) | `invoke()` accepts `graph_names: list[str]`; per-graph hybrid path then **RRF-fuse** across graphs; `fetch_neighborhoods` scoped to repo graph; **ACL filter unchanged** (reuses `chunk_labels`) | Python — **jrevillard** | Extend |
| **ChatQnA** (Python) | Forward the caller's **authorized graph set** through `ChatCompletionRequest` / `GenieaiRetrieverParms` → retriever | Python — **jrevillard** | Wiring |
| **ArangoDB** | Per-repo graphs auto-created (`OKF_{repo_id}`); **4 new meta-collections**: `okf_repositories`, `okf_concepts_meta`, `okf_audit`, `okf_sources` | Data — shared | Schema add |
| **Keycloak** | New scopes `okf:{tenant}:{repo}:{read|admin}` + **`tools-admin` role** + audience mapper | Identity — shared | Config add |
| **Kong / NGINX** | New `okf-server` service + `/api/okf` route; (future) Kong AI MCP Proxy + OAuth2 plugins | Gateway — shared | Config add |
| **Docker Compose + Ansible** | New `okf-server` service + image build + deploy vars | Infra — shared | Config add |
| **GitLab CI** | New build/scan/promote pipeline for the `okf-server` image (ADR-0001), CycloneDX SBOM, signed images, non-root | CI — shared | Config add |

> **Deliberately NOT changed:** the **BFF (`gov-chat-backend`)** — folding OKF logic into the BFF was explicitly rejected (ADR-001/003). OKF only *mirrors* its `jose` auth pattern. **Two latent dataprep bugs** (retract default + stale `RETRIEVER_ARANGO_GRAPH_NAME`) are pre-existing but fixed as part of OKF Phase 1 (ADR-013).

---

## Test data — what OKF needs, and sourcing from el-salvador

OKF's surface is exercised by realistic **OKF concept bundles** (Markdown + YAML frontmatter, OKF v0.1) organized into domain **repositories** — not API feeds. Required:

| Test need | Why | Shape |
|---|---|---|
| Corpus of OKF concept bundles | ingest / parse / index / serving | Markdown + frontmatter; many concepts/repo; structural links with anchor text |
| ≥ 2–3 domain repositories | multi-graph grounding (fan-out + RRF across `GRAPH` + `OKF_*`) | distinct `OKF_{repo_id}` graphs |
| A Git/S3 source | external source management (sync, deletion detection, fallback) | GitLab repo or S3 bucket |
| Bundle version variants | citation pinning, version diff, retract-by-version | ≥ 2 versions of ≥ 1 bundle |
| ACL-labeled content (`t:`/`r:`/`d:`) | per-tenant / per-repo RBAC, 403-vs-404 | mixed public + internal |
| PII-bearing content | Presidio redaction (blocking-on-failure) | extension-worker notes w/ farmer PII |
| Scale | NFR p95 ≤ 300 ms, freshness ≤ 15 min | hundreds of concepts |

**Sourcing from el-salvador (AgroGenio, `release/el-salvador` deployment):**
- **Domain taxonomy in git** — `components/gov-chat-backend/scripts/new-schema-scripts/exports/serviceCategoriesAndServices_export_*.json` feeds OKF's **"domain = service-category"** mapping (ADR-014). Agriculture/extension is the natural first OKF repository.
- **Knowledge corpus already ingested** — el-salvador's agricultural extension content (FAO / CENTA / WFP / MAFSN crop guides, pest & pesticide protocols, market/weather advisories) is runtime data in document-repository + ArangoDB `GRAPH`/`{GRAPH}_SOURCE`. **Convert to OKF bundles** as the seed corpus.
- **The FAO *API* block does not apply** — OKF bundles are static Markdown, not live feeds (see `docs/agricultural-data/FAO-data-request.md`). Unblocked today.
- **Spanish (`es`)** locale → real multilingual coverage. **Seasonal updates** → free version variants. **Public vs extension-worker-only** content → ACL/403-vs-404 tests. **Field notes** → Presidio PII tests.

**Acquisition steps:** pick agriculture/extension domain (reuse service-category export) → re-author a slice as OKF bundles → host on GitLab (source-sync) → stand up 2–3 repos (`agro-extension`, `market-advisory`, `weather`) → add version variants + a PII bundle + public/internal ACL split.

---

## Decision: OKF data curation source — dedicated Git content repo (ADR-grounded)

**Question.** With no S3 bucket, where do we curate OKF source data — separate GitLab repo or not?

**The ADRs on this branch already settle most of this:**
- **ADR-016 (Accepted):** OKF repositories sync from *"external, user-owned Git repositories or S3-compatible buckets … **not** the Genie framework code repo."* → **Git is a first-class origin; S3 optional.**
- **ADR-008 (Accepted):** document-repository = runtime source-of-truth (versioned); origin may disappear without breaking serving.
- **ADR-014 (Accepted):** one repository = one bundle = one domain = one graph.

**Decisions:** (1) **Use Git** (no S3 needed). (2) **Dedicated GitLab content repo — *not* a dir in `un/itu/genie-ai`** (ADR-016 requires external origin). (3) **`release/el-salvador` is the raw-content source to convert, not the OKF origin.**

**Flow:** `GitLab content repo (origin, sync-only) → document-repository (runtime SoT, versioned) → ArangoDB OKF_{repo_id} (indexed view)`.

**Recommended:** one content repo per deployment (e.g. `genie-ai-okf-el-salvador`), structured one-directory-per-domain; MR-based curation + frontmatter-lint CI + Git-pull sync; in-app authoring (ADR-015) complements (confirm write-back to Git). **Open:** per-deployment vs. shared repo; one-origin-per-domain vs. subdirs; formalize as **ADR-okf-017**.

---

## Risks / open decisions

- **Bump (Part A):** `constants.py` `MCPFuncType` is the one build blocker — do it first; dataprep dependency re-validation (docling/pyspark/sentence-transformers) is the one runtime risk — the existing tests catch it.
- **SST re-baseline:** confirm **web search (SearXNG) + stream ingestor + governance** as the SST survivors; re-scope GitLab #696–#725 accordingly.
- **`tools-admin` Keycloak role** — steward/admin actions need it; confirm it exists or provision it.
- **Align with jrevillard** — Part A touches his dataprep/retriever/reranker; the `TRANSLATOR` renumber is in his chatqna (symbol-based, so safe — but confirm). Part B adds a new service.
- **Clone-at-build persists** — air-gap *build* still needs GitHub/mirror; acceptable now, vendor/mirror later if it becomes a constraint.
- **K8s (#600) still lagging** — not a build blocker (all deploy on Swarm); a Sprint 25 GovStack/SCS deploy-target question.
- **OKF GitLab issues** — none yet; cut them before OKF enters a sprint.

---

## Bottom line

The agentic goal is a **three-pillar** effort: **bump the overlay to OPEA 1.5** (cheap — ~3–5 days; the diff proved the RAG APIs are stable and GENIE's logic is untouched), **build the agentic layer ourselves** as custom LangGraph on the OPEA `MicroService` harness (not `comps/agent`, not `mcpo` — reusing the harness, owning the logic), and deliver **SST's real value** (web search, stream ingest, governance) as the agent's tools. OKF builds on the bumped ArangoDB retriever. **Sequence: bump → agentic layer + SST tools + OKF Phase 1 → #604 → #603 on the custom LangGraph agent.** This preserves the RAG differentiator, keeps the agentic logic sovereign, and removes the false "rebase onto a declining upstream" cost from the roadmap.
