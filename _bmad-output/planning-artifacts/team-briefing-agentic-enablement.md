# Agentic Enablement — Three-Pillar Development Pipeline

**(OPEA 1.5 Upgrade · Server-Side Tools · OKF)**
**Date:** July 2026 · **Audience:** Engineering team · **Branch:** `feat/agentic-enablement` (was `feat/okf-server`)
**Decision requested:** Adopt a **three-pillar** plan for the agentic-workflows goal, led by an **OPEA 1.3 → 1.5 upgrade** that absorbs much of the planned custom agentic build.

---

## TL;DR

The medium-term goal — **agentic workflows inside the GENIE RAG system** (roadmap Sprint 24, #603) — is served by **three pillars**, not one:

1. **OPEA 1.3 → 1.5 upgrade** (the enabler — **do this first**)
2. **SST (Server-Side Tools)** — the *tools/actions* layer (now **reduced in scope**)
3. **OKF (Open Knowledge Framework)** — the *knowledge/grounding* layer

**The headline finding:** OPEA 1.5 (released 2025-12-22) doesn't merely "have agentic features" — it ships a **LangGraph-based agent microservice, bidirectional MCP, a YAML tool registry, and a multi-agent supervisor pattern**, all first-class on **ArangoDB**. Because **GENIE has written zero LangGraph code to date**, adopting 1.5's native agent stack is greenfield (no migration cost on the agentic side). This means **OPEA 1.5 directly absorbs large parts of #603 (LangGraph + mcpo) and of SST**, and reshapes the agentic roadmap from "build it ourselves" to "adopt OPEA's packaging and build only what's Genie-specific on top."

**Recommended order:** **OPEA 1.5 first** → SST (reduced) and OKF in parallel → GovStack integrations. The 1.5 upgrade unblocks and simplifies both downstream pillars.

---

## The three pillars at a glance

| Pillar | Role | Status today | After reframe |
|---|---|---|---|
| **1. OPEA 1.3 → 1.5** | Foundation / enabler — native agent + MCP + tool registry | Pinned at `v1.3` via a build-time overlay; no LangGraph code yet | **First.** Rebase overlay; adopt native agent/MCP. Low agentic-side cost; real cost = overlay rebase + dependency bumps. |
| **2. SST** | Tools / actions layer | Specced (GitLab #696–#725), stale since May, unassigned | **Reduced.** Tool registry/executor/MCP largely subsumed by OPEA 1.5 → SST shrinks to **governance + Genie tool authoring + stream-ingestor**. |
| **3. OKF** | Knowledge / grounding layer | Specced (PRD + 16 ADRs on this branch), not built | **After 1.5.** Built on 1.5's ArangoDB retriever/dataprep; MCP exposure via OPEA's "component-as-MCP-server." |

---

## Pillar 1 — OPEA 1.3 → 1.5 upgrade (the enabler)

### Why now

- **v1.3 (current, tag 2025-05-14) → v1.5 (latest stable, 2025-12-22).** OPEA ships quarterly; v1.6 is due Q1 2026.
- **Primary motivation: 1.5's agentic capabilities** — which collapse much of the custom build the Sprint 24 roadmap assumed.
- **GENIE has no LangGraph code yet** → the single biggest migration risk (LangGraph 0.3 → 1.0) is a **non-issue**. We build *on* 1.5's agent, not beside it.

### What OPEA 1.5 gives us — feature → roadmap mapping

| OPEA 1.5 native capability (confirmed) | Replaces / reduces in our plan | Source |
|---|---|---|
| **Agent microservice** built on LangChain/LangGraph (`comps/agent/`) with strategies `react_langgraph`, `react_llama`, `rag_agent`, `plan_execute`, `sql_agent` | **#603 Phase 1A "LangGraph core"** — no custom orchestrator to build | `comps/agent/src/README.md` |
| **Hierarchical multi-agent supervisor** (AgentQnA: supervisor + RAG/SQL workers) | **#603 architecture** ("orchestrator → tools") — this *is* the reference pattern | AgentQnA README |
| **MCP client** `OpeaMCPToolsManager` (SSE + stdio, dynamic tool registration) | **`mcpo` proxy (#603 Phase 1B)** — **no longer needed** | `comps/cores/mcp/` (v1.4+ #1678/#1810) |
| **Components-as-MCP-servers** (opt-in `enable_mcp` on `MicroService`) | **Only ChatHistory / PromptRegistry / FeedbackManagement** adopted it — **NOT** retriever/dataprep/reranker/chatqna (verified, 0 MCP refs). The agent calls RAG components as **LangGraph tools**, not MCP servers. **OKF MCP = custom** (Node), not this flag. | v1.5 #1849/#1855 |
| **YAML tool registry** (HTTP endpoint / Python fn / LangChain tool) + tool-calling | **SST Tool Registry + Executor** (Epic 1) — largely subsumed | agent README |
| **OpenAI-compatible** `/v1/chat/completions` + **Assistants API** (`/v1/assistants`, `/v1/threads`, Redis-backed memory, multi-turn via `thread_id`) | Agent serving surface + pause/resume (#603 1E) | release notes |
| **ArangoDB first-class** retriever + dataprep variants | **OKF + existing RAG** — our DB is now upstream-supported, not custom | v1.5 docs |
| **OPEAStore decoupling** (chathistory/feedback/prompt-registry → DB-agnostic) | Aligns with our ArangoDB-first stance | v1.4 release notes |

**Dependency bumps that come with 1.5:** langchain 0.3.23 → 0.3.27, **langgraph 0.3.31 → 1.0.1**, mcp → 1.25.0 (new), vLLM 0.8.3 → 0.10.x, TEI 1.6 → 1.7, Docker 28.5.1. **Python stays 3.10.** (langgraph 0.3→1.0 is the headline break — irrelevant to us since we have no LangGraph code.)

### What changes in our build — the overlay rebase

GENIE does **not** pip-install OPEA — it **clones at build time and overlays** (`git clone --branch v1.3` in 4 Dockerfiles; single pin `OPEA_VERSION="v1.3"`). The overlay overrides OPEA 1.3 via **four vectors**:

1. **File overwrite** — `core/constants.py` → `comps/cores/mega/constants.py` (a hand-fork of OPEA's `ServiceType`/`MegaServiceEndpoint` enums); `core/genieai_api_protocol.py` → `comps/cores/proto/`; `genieai_chatqna.py` as entrypoint; `entrypoint.sh`; `tracing.py`; `core/model_cache.py`; `core/label_contract.py`.
2. **Inject `genieai_*` subclasses** into the comps `integrations/` namespace (`GenieArangoDataprep`, `GenieaiArangoRetriever`, `GenieTEIReranking`, …).
3. **Monkeypatch OPEA internals** — chatqna rebinds `ServiceOrchestrator.align_inputs/outputs/align_generator` ([genieai_chatqna.py:1240](genie-ai-overlay/chatqna/genieai_chatqna.py#L1240)) and builds 17 `MicroService(...)` nodes.
4. **Build-time `sed`/`mv` patches** — the `docarray.py` → `opea_docarray.py` rename hack + `build-patches/fix_dependencies.sh`.

**Upgrade = rebase these overrides onto the 1.3→1.5 diff.** The retriever/reranker/dataprep internals are GENIE's own (heavy investment — preserved); only their **adapter contracts** to comps must track 1.5.

### Upgrade blast radius (ranked)

| Rank | Module | What breaks if 1.5 churns it |
|---|---|---|
| **1 CRITICAL** | **chatqna** | `ServiceOrchestrator.align_*` monkeypatch + 17× `MicroService(...)` + depends on `GenAIExamples` ChatQnA@v1.3 |
| **2 CRITICAL** | **dataprep** | 3 OPEA base-class subclasses + `import opea_dataprep_microservice as base` + literal key `opea_service@dataprep` + **requirements path moved in v1.4** (deferred-work.md L395-411) |
| **3 HIGH** | **retriever** | `OpeaComponent` subclass + 11-symbol `comps` import + literal key `opea_service@retrievers` |
| **4 HIGH** | **reranker** | `OpeaTEIReranking` subclass + sole consumer of `comps.cores.telemetry.opea_telemetry` (**renamed in v1.4**) |
| **5 MEDIUM** | **core** | `from api_protocol import *` re-export + hand-forked `constants.py` (drift hazard) |
| **6 LOW** | build-patches / Dockerfile `sed` blocks | silent no-op risk if upstream paths change |
| **7 LOW** | embedding/textgen (`:latest` wrappers) | tag drift — **pin to v1.5 in lockstep** |
| **8 LOW** | tests | **mock comps fully → will NOT catch 1.5 breaks**; only `smoke:dataprep-arango` CI catches real ones (dataprep-only) → **add smoke tests for all 4 modules** |

**Six coupling surfaces to verify against 1.5** (if stable → mechanical bump; if changed → runtime breaks the mocked tests won't catch): `ServiceOrchestrator.align_*` · `OpeaComponent`/`OpeaComponentLoader` lifecycle · `@register_microservice` + `opea_microservices["opea_service@*"]` keys · `api_protocol.py` Pydantic fields · `comps.cores.proto.docarray.py` (rename hack) · `comps.cores.telemetry.opea_telemetry`.

**Already-documented upgrade debt:** `deferred-work.md` L395-411 (issue #834) has a v1.3→v1.4+ retirement checklist — the dataprep `requirements.txt` path moved in v1.4 (→ `requirements-cpu.txt`); v1.5 pins `docling-core==2.44.2` (our `2.82.0` pin becomes redundant); `fix_dependencies.sh` is shared by reranker+retriever (don't delete in a dataprep-only bump).

### Sequencing & pre-rebase cleanup

**First — with a landing order and a prep step** (verified by full code review):

```
0. Land jrevillard's !232 (multi-turn blend) first — CI-green, default-off, adds ZERO
   comps coupling (touches only the EMBEDDING elif of align_*). Gives the rebase a stable baseline.
1. Pre-rebase cleanup (shrinks the rebase surface — do BEFORE the bump):
     • Consolidate the 5 near-duplicate flow_to megaservice variants (3 byte-identical) → one site.
     • Replace dataprep's _parent_mod.ARANGO_DB_NAME module monkeypatch (dataprep:39 — the most
       fragile coupling) with a proper subclass override.
     • Verify whether 1.5 passes `context` through the megaservice hop → if so, core/label_contract.py's
       search_start::labels: workaround becomes redundant.
     • Add import-only smoke tests for retriever/reranker/chatqna (only dataprep has one today;
       the mocked test suite is structurally blind to 1.5 breaks).
2. OPEA 1.3 → 1.5 overlay rebase — bump OPEA_VERSION, re-graft overrides, verify the 6 coupling
   surfaces, re-validate fix_dependencies.sh + the docarray rename hack + deferred-work.md's
   v1.3→v1.4 retirement checklist.
3. (After 1.5) OKF Phase 1 → #604 → #603.
```

Lands at the **Sprint 23 → 24 boundary** (now). No agentic-side migration cost (no LangGraph code exists); real cost = pre-rebase cleanup + overlay rebase + dependency bumps + 6-surface verification.

### Code-review findings (verified, file:line)

- **chatqna is ~2,560 lines** (not 1,599), with **21 `MicroService(...)` constructions** and **runtime graph mutation** (`runtime_graph.add_edge`/`delete_node_if_exists`, chatqna:1041-1044). The `ServiceOrchestrator` monkeypatch (chatqna:1240-1242) + `schedule()` 8-kwargs contract (chatqna:2389-2398) is the #1 fragility point — a single signature change breaks the orchestrator silently.
- **dataprep `_parent_mod.ARANGO_DB_NAME = …` monkeypatch** (dataprep:39) — module mutation, not subclassing — *the most fragile coupling pattern*. Replace before rebase.
- **reranker** is the heaviest `opea_docarray` + `opea_telemetry` consumer (the only `@opea_telemetry` site) — highest churn risk from v1.4 telemetry renames.
- **Two OKF Phase 1 items are GREENFIELD** (confirmed — no existing code): **multi-graph fan-out** (every request today reads a single `graph_name`; retriever:766, dataprep:1287 — though the per-graph BM25-view cache *does* exist, so isolation infra is there) and **`graph_name` threading from chatqna** (`align_inputs` RETRIEVER never sets it; `GenieaiRetrieverParms` has no such field; falls back to `ARANGO_GRAPH_NAME` env).
- **Collision with jrevillard: LOW.** His dataprep/retriever/reranker work already merged to main; only `genieai_chatqna.py` moves (!232), and !232's EMBEDDING-branch edits are **disjoint** from OKF Phase 1's RETRIEVER-branch edits (only shared touchpoint: `handle_request`).

---

## Pillar 2 — SST (reduced scope)

SST's original scope (Tool Registry + Executor + Stream Ingestor, GitLab #696–#725) **overlaps OPEA 1.5 heavily**. After the reframe:

| SST original scope | Disposition under OPEA 1.5 |
|---|---|
| Epic 1 — Tool Registry (YAML defs) + Executor | **Largely subsumed** by OPEA's YAML tool registry + agent tool-calling. Keep only Genie-specific tool authoring. |
| MCP transport (was deferred) | **Replaced** by `OpeaMCPToolsManager` — drop `mcpo`. |
| Epic 2 — Web Search (SearXNG) + result fusion + citations | **Keep** — Genie-specific; wire as OPEA agent tools. |
| Epic 3 — Stream Ingestor (RSS/API/webhook → TEI → chunks) | **Keep** — no OPEA equivalent. |
| **Governance** (PII redaction, circuit breaker, rate limit, audit — SST Decisions 16) | **Keep — this is SST's real remaining value.** OPEA has no governance pipeline. |
| Epic 4 — Admin/UI | **Keep** (Genie Vue admin). |

**Net:** SST shrinks from "build the tool ecosystem" to **"governance + Genie tool/feed authoring + web-search + stream-ingestor,"** wired as tools into the OPEA agent. Confirms the SST hard gates still hold in spirit: governance + web-search + ChatQnA integration must precede #603/#604.

---

## Pillar 3 — OKF (knowledge/grounding layer)

Unchanged in intent; reshaped in execution by 1.5:

- **Built on 1.5's ArangoDB retriever/dataprep** → OPEA 1.5 must land before OKF Phase 1 (graph_name wiring, multi-graph retriever, ChatQnA forwarding — exactly the modules the upgrade touches). **This is why 1.5 goes first.**
- **MCP exposure (Phase 5) is custom, not OPEA's `enable_mcp` pattern** — verified: that pattern covers only ChatHistory/PromptRegistry/FeedbackManagement (registry microservices), NOT RAG components, and it requires a comps `MicroService` (OKF is Node). OKF exposes via the **MCP Node SDK / Kong AI MCP proxy**, consumed by the OPEA agent's `OpeaMCPToolsManager` like any external MCP server. REST + logic remain independent of the agent layer.
- OKF's 6-phase build, components impacted, test data, and curation decision are unchanged — see the sections below.

---

## Revised agentic roadmap (#603 / #604)

| Roadmap item | Original plan | Under OPEA 1.5 |
|---|---|---|
| **#603 Agentic Phase 1** | Build LangGraph orchestrator + `mcpo` + 3 mock MCP servers + frontend viz + pause/resume | **Adopt OPEA 1.5 native agent + `OpeaMCPToolsManager`.** Build only: GovStack mock MCP servers (Auth/Payments/Scheduler), Genie-specific LangGraph strategies/workflows on top, Vue workflow viz. `mcpo` dropped. |
| **#604 ChatQnA refactor** | Break the ~2,560-line monolith (5 near-duplicate `flow_to` variants) into modular files | **Still needed**, but now the target aligns with 1.5's megaservice/agent model. The `ServiceOrchestrator.align_*` monkeypatch may be replaceable by 1.5's cleaner orchestrator API (verify surface #1). **Lands after the 1.5 rebase, not before.** |

---

## Where it fits in Sprints 20–25

```
Sprint 20–22 (security, SSE, auth, tests): largely complete
Sprint 23: observability DONE; K8s (#600) NOT done (lagging)
        │
        ▼  ← TODAY (2026-07-24); Sprint 24 starts Aug 1
PILLAR 1: OPEA 1.3 → 1.5 upgrade   (Sprint 23 tail / Sprint 24 opening)
        │   rebase overlay + adopt native agent/MCP + 3 smoke tests
        ├──────────────────────────┐
        ▼                          ▼
PILLAR 2: SST (reduced)        PILLAR 3: OKF
  governance + web-search        Phase 1 grounding (on 1.5 ArangoDB)
  + stream-ingestor              → server skeleton → admin UI → authoring
  wired as OPEA agent tools      → agent serving (MCP via component-as-server)
        │                          │
        ▼                          ▼
Sprint 24: #604 ChatQnA refactor (on 1.5)  →  #603 agentic on OPEA native agent
        │
        ▼
Sprint 25: #606 GovStack BB integrations (real MCP servers) + #607 multi-channel
```

**Critical-path note:** the #604 refactor knot tightens — OPEA 1.5 rebase, OKF Phase 1, and SST's ChatQnA integration **all** touch `genieai_chatqna.py`. Order: **1.5 rebase → OKF Phase 1 + SST governance/web-search → #604 refactor → #603 on native agent.**

---

## Components impacted by OKF (exact impacts)

Floor-to-ceiling — every layer OKF touches (per OKF architecture §8/§12 + ADRs). *(OKF-specific; the OPEA 1.5 upgrade's separate blast radius is in Pillar 1.)*

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

- **OPEA 1.5 overlay rebase is the real work** — verify the 6 coupling surfaces; add smoke tests for retriever/reranker/chatqna (only dataprep has one today).
- **SST scope reduction needs team sign-off** — confirm SST shrinks to governance + authoring + web-search + stream-ingestor (registry/executor/MCP subsumed by OPEA 1.5). Re-baseline SST epics #696–#725 accordingly.
- **`tools-admin` Keycloak role** — steward/admin actions need it; confirm it exists or provision it.
- **K8s (#600) still lagging** — not a build blocker for any pillar (all deploy on Swarm); a Sprint 25 GovStack/SCS deploy-target question.
- **OKF GitLab issues** — none yet; cut them mirroring SST's structure before OKF enters a sprint.
- **Who owns the 1.5 rebase** — it spans jrevillard's Python surface (dataprep/retriever/reranker/chatqna); coordinate so the rebase and his RAG-quality work don't collide in `genieai_chatqna.py`.

---

## Bottom line

The agentic goal is now a **three-pillar** effort led by the **OPEA 1.3 → 1.5 upgrade**, which — because GENIE has no LangGraph code yet — lets us **adopt OPEA's native agent + MCP + tool-registry instead of building them**, while **preserving our heavy RAG investment** (retriever/reranker/dataprep stay Genie-owned; only their comps adapter contracts track 1.5). SST shrinks to governance + Genie tooling; OKF builds on 1.5's ArangoDB. **Sequence: 1.5 first → SST + OKF in parallel → #604 → #603 on the native agent.** That single ordering both protects the agentic goal and removes the largest chunk of custom build from the roadmap.
