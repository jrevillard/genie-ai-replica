# GENIE.AI — OPEA Strategy & Implementation Plan

**Date:** 2026-08-06 (final — supersedes all prior A1/A2/A3/F2 drafts)
**Decision:** **(A)** Retain the overlay build and bump it to **OPEA 1.5**; **(B)** build the agentic layer as **custom LangChain Deep Agents (on LangGraph) workflows on the OPEA microservice harness** (not OPEA `comps/agent`, not a bespoke standalone service).

---

## 1. The decision, and why

Two independent choices, both now settled by grounded evidence (the v1.3↔v1.5 `comps` source diff + the OPEA-trajectory research):

- **RAG base — bump the overlay to OPEA 1.5 (retain clone-at-build + overrides).** The diff proved GENIE's RAG logic needs **~zero code changes**: every `comps` API GENIE depends on (`ServiceOrchestrator.schedule/align_*`, `add/flow_to`, the `runtime_graph` DAG, `MicroService.__init__`, `OpeaComponent`/`OpeaComponentRegistry`/`OpeaComponentLoader`, `register_microservice`/`opea_microservices`, `opea_telemetry`, `api_protocol` models) is **byte-identical or purely additive** v1.3→v1.5. The chatqna monkeypatch survives unchanged. Realistic effort **~3–5 engineer-days**, not the 11-day padded estimate. Flatten-to-fork (F2) is **dropped** — not worth ~14–20 days for a decoupling the cheap bump makes unnecessary.
- **Agentic layer — custom, hosted on the OPEA `MicroService` harness, built on LangChain Deep Agents (on LangGraph).** OPEA's `comps/agent` is **rejected** (see §7 for the point-by-point evaluation of the team's considerations doc): it's a wrapper over LangChain/LangGraph on a declining, Intel-concentrated project; it lags current vLLM tool-calling (vLLM 0.8.3+ made tool/function calling stable — OPEA's strategies predate that); its memory/multi-turn support is `react_llama`-only (GENIE is inherently multi-turn); AgentQnA is validated only on Intel/AMD HW (GENIE is NVIDIA); and it doesn't use LangChain Deep Agents. GENIE instead authors its own multi-step/HITL/cross-BB workflows on **LangChain Deep Agents on LangGraph** (SOTA context-engineering middleware — history compression, tool-result offloading, subagent isolation, planning — exactly what long gov workflows need) + the MCP SDK, using **vLLM's native tool-calling** (`--enable-auto-tool-choice --tool-call-parser`), with **LangGraph's first-class multi-turn memory** (checkpointer + state, for all agent types). It **reuses the comps `MicroService` shell** (lifecycle, `/health`, statistics, OTel, FastAPI, Kong, Docker/build/CI) — **no separate microservice bootstrap harness.**

**Net architecture:** OPEA 1.5 = the RAG + microservice **plumbing** GENIE keeps; LangGraph + MCP = the agentic **logic** GENIE owns.

---

## 2. PART A — Bump the overlay to OPEA 1.5 (file-by-file)

The RAG logic is untouched. The work is: one hard blocker (`constants.py`), the build/requirements rework, dependency re-validation, and closing the test blind-spot.

### A1. `genie-ai-overlay/core/constants.py` — **THE hard blocker (~0.5 day)**
GENIE's `constants.py` is COPY-overwritten onto vendored `comps/cores/mega/constants.py` (chatqna Dockerfile L92), so it must be the single source OPEA 1.5 expects.
- **Add `from enum import Enum, auto`** (1.5 switched to `auto()`).
- **Add the `MCPFuncType` enum** (`TOOL`/`RESOURCE`/`PROMPT`) — **required**: 1.5 `micro_service.py:12` does `from .constants import MCPFuncType, ServiceRoleType, ServiceType`; GENIE's current file lacks it → `ImportError` on **every** service at startup.
- **Adopt 1.5's new `ServiceType` members** after `STRUCT2GRAPH(23)`: `LANGUAGE_DETECTION(24)`, `PROMPT_TEMPLATE(25)`, `PROMPT_REGISTRY(26)`, `TEXT2QUERY(27)`, `ARB_POST_HEARING_ASSISTANT(28)`.
- **Resolve the value-24 collision:** GENIE's `TRANSLATOR = 24` collides with upstream `LANGUAGE_DETECTION = 24`. The members GENIE depends on (`RETRIEVER=2`, `RERANKER=3`, `DATAPREP=9`, `EMBEDDING`, `LLM`) are unchanged. **Fix:** renumber GENIE's `TRANSLATOR` to a non-colliding GENIE-private value (e.g. `100`) — GENIE uses it only by symbolic name in chatqna's dispatch ladder, never by numeric value. (Verify chatqna's `service_type == ServiceType.TRANSLATOR` checks are all by symbol — they are, per the code review.)
- **Add a GENIE-private `WORKFLOW` member** (e.g. `101`) for the new agentic microservice (Part B).

### A2. `genie-ai-overlay/core/genieai_api_protocol.py` — **audit, likely no edit (~0.25 day)**
- `from api_protocol import *` still resolves cleanly. GENIE **redefines** `ChatCompletionRequest` as its own model, so the heaviest-changed upstream model doesn't touch GENIE.
- **Action — audit for zero/negative payloads:** 1.5 type-tightened many fields to `PositiveInt`/`NonNegativeFloat` (`top_n`, `k`, `fetch_k`, `max_tokens`, `temperature`, `score_threshold`). Any GENIE path that sends `0` (e.g. `top_n=0` to mean "use fallback") will now **422 at parse** before GENIE's reranker fallback runs. Find and fix those callers (default to a positive value, not 0).

### A3. The 4 Dockerfiles — **`OPEA_VERSION` bump (minutes)**
- `genie-ai-overlay/{chatqna,dataprep,retriever,reranker}/Dockerfile-*_genie-ai`: `ARG OPEA_VERSION="v1.3"` → `"v1.5"`. Chatqna declares it **4×** (L4, L17, L23, L48) and bumps **both** repos (`GenAIExamples` + `GenAIComps`).
- **docarray rename hack — re-verify, don't rewrite.** The `mv docarray.py opea_docarray.py` + 3× `sed` (on `comps/__init__.py`, `cores/mega/orchestrator.py`, `cores/mega/micro_service.py`) is **GENIE's own** hack (the "renamed in v1.4" claim is **false** — `opea_docarray.py` never existed upstream). It still applies at 1.5: `docarray.py` still exists at the same path and the two `mega/*` import sites GENIE patches are unchanged. **Eyeball:** 1.5 switched `SearchedDoc.retrieved_docs`/`RerankedDoc.reranked_docs` from `DocList[...]` → `List[...]` and dropped `DocList` from the import — confirm GENIE's read-only iteration in reranker/chatqna still behaves (likely fine; `List` iterates identically).
- **Optional backport:** 1.5's `ChatQnA` `align_generator` now skips null/empty-content chunks and swallows `JSONDecodeError`. GENIE overrides `align_generator` (chatqna:1345) — consider porting the null-skip to avoid UI display artifacts. Optional, not a breakage.

### A4. `genie-ai-overlay/dataprep/` — **the genuine risk (~1.5–2 days)**
- `Dockerfile-dataprep_genie-ai`: `ARG REQ_PATH=/app/comps/dataprep/src/requirements.txt` → **`requirements-cpu.txt`** (path moved in v1.4; already documented in `deferred-work.md`).
- **Retire the `#834` lock machinery** (per `deferred-work.md` L399-411): delete `requirements.in`, `requirements.lock`, `scripts/generate-requirements-in.sh`, the `--no-deps --require-hashes` Dockerfile block, the `docling-core==2.82.0` pin (1.5 pins `2.44.2`, below the `2.83` `legacy_doc` removal — redundant), `Makefile` `lock-dataprep`/`requirements-in-dataprep`, and the `verify:dataprep-lock` CI job. **Keep** `smoke:dataprep-arango` and the `opencv-python-headless` decision (re-confirm).
- **Re-validate major dependency bumps** (the real work): `docling 2.30→2.45`, `pyspark 3.5→4.0`, `sentence-transformers 4.1→5.1`, `langchain 0.3.23→0.3.27`, `langchain-openai 0.3.14→0.3.23`, `fastapi 0.115→0.116`, `openai 1.75→1.81`, `pydantic→2.11.7`, `unstructured 0.17→0.18`, `huggingface-hub 0.30→0.34`.
  - **Critical — do NOT revert `langchain-huggingface` 0.1.2→0.3.1**: 1.5's `OpeaArangoDataprep._initialize_embeddings` requires it; reverting breaks the base class GENIE subclasses.
- **Action:** re-run the full ingest path against representative docs (table-heavy, multilingual, the el-salvador agriculture corpus); fix any chunking/table-extraction regressions from `docling`/`pyspark`.

### A5. `genie-ai-overlay/retriever/` — **re-confirm pin (~0.25 day)**
- No code change (`OpeaComponent` lifecycle byte-identical/additive). 
- **Re-confirm the `langchain-arangodb>=1.2.0` over-pin** (Dockerfile L57, for the `filter_clause` fix) against 1.5's `0.0.6` transitive — GENIE over-pins to 1.2.0; verify the graph store still queries correctly, then decide whether to align to the upstream pin or keep the override.

### A6. `genie-ai-overlay/reranker/` — **verify (~0.25 day)**
- No code change. `opea_telemetry` is **byte-identical (2381 B)** at 1.5 — the "renamed in v1.4" claim is **false**; discard it. `OpeaTEIReranking` HF_TOKEN-first read is beneficial (GENIE already sets `HF_TOKEN` from `VLLM_API_KEY`); `GenieTEIReranking` overrides `invoke()` entirely.
- Eyeball the `DocList→List` container switch on `SearchedDoc`/`RerankedDoc` construction.

### A7. `genie-ai-overlay/chatqna/genieai_chatqna.py` — **no edit, just re-validate (~0.25 day)**
- ~2,560 lines **untouched**: the `ServiceOrchestrator.align_*` monkeypatch, `schedule()` 8-kwargs + 2-tuple unpack, 21 `MicroService(...)` constructions, `add_route`, `runtime_graph` mutation — **all survive** (verified unchanged/additive). Re-validate by running the e2e RAG path.

### A8. `genie-ai-overlay/build-patches/fix_dependencies.sh` — **re-validate (~0.25 day)**
- `sed` removes `pathway==0.3.3`, `graspologic==3.4.1`, swaps `psycopg2→psycopg2-binary`. Re-confirm these still appear in 1.5's `requirements-cpu.txt` (likely already removed upstream → the seds become no-ops, harmless). **Shared by retriever + reranker** — do not delete in a dataprep-only change.

### A9. `docker-compose.yaml` — **pin floating tags (~0.25 day)**
- `opea/translation:1.3` → decide: bump to `1.5` or pin `1.3`. `opea/guardrails:1.5`, `opea/chatqna-ui:1.5`, `opea/nginx:1.5` already 1.5 (two are disabled per CLAUDE.md). Pin everything to fixed tags to kill drift.

### A10. Tests / CI — **close the blind-spot (~0.5 day)**
- `tests/conftest.py` mocks the entire `comps` surface → structurally blind to 1.5 breaks. **Add smoke jobs** mirroring `smoke:dataprep-arango` (the only real integration check today): **`smoke:retriever`**, **`smoke:reranker`**, **`smoke:chatqna`** — import + boot the real vendored `comps` inside each built image.
- `.gitlab-ci.yml`: retire `verify:dataprep-lock` (UV_VERSION 0.10.6) per A4; keep `smoke:dataprep-arango`.

### A11. Validation gate
Rebuild all 4 images → run `pytest` suite + `tests/rag-benchmarks/` + the 4 smoke jobs → deploy and verify e2e (ingest a doc → query → rerank → answer, with translation). The dataprep dep bumps are the one place a surprise can hide — the existing tests catch it.

**Part A total: ~3–5 engineer-days** (constants.py 0.5 + build/deps 1 + dataprep re-validation 1.5–2 + audits/verifies 1 + smoke 0.5). The RAG crown-jewel logic is not modified.

---

## 3. PART B — Custom agentic layer on the OPEA microservice harness (file-by-file)

Greenfield (no LangGraph code exists). New `genie-ai-overlay/workflows/` microservice: **comps `MicroService` shell outside, LangGraph-direct inside.** Reuses the lifecycle/health/OTel/FastAPI/Kong/build patterns GENIE already operates — no new bootstrap harness — while keeping the orchestration logic fully GENIE-owned (not `comps/agent`).

### B1. New package: `genie-ai-overlay/workflows/`
| File | Purpose |
|---|---|
| `__init__.py` | package marker |
| `genieai_workflows_microservice.py` | **comps `MicroService` shell** — mirrors `genieai_chatqna.py`'s self-host pattern: `MicroService(name, service_role=ServiceRoleType.MEGASERVICE, host/port/endpoint, input_datatype=AgentChatRequest)` + `add_route("/v1/chat/completions", handle_request)` + `/health` + `/v1/workflows/{id}/status` (WebSocket). Registers via `@register_microservice(name="opea_service@workflows", service_type=ServiceType.WORKFLOW, endpoint="/v1/chat/completions")`. Initializes OTel via the existing `tracing.py`. **This is the "same microservice infrastructure as OPEA" — no bespoke FastAPI/lifecycle harness.** |
| `state.py` | Pydantic `WorkflowState` (typed LangGraph state: `messages`, `retrieved_context`, `tool_results`, `pending_human_input`, `workflow_id`, `language`). |
| `nodes.py` | Node functions: `llm_node`, `rag_node`, `tool_node`, `conditional_router`, `human_input_node` (HITL gate), `translation_node`, `guardrail_node`. |
| `orchestrator.py` | **LangGraph `StateGraph` builder** — compiles workflow definitions into executable graphs; binds tools; wires the checkpointer. Pure LangGraph (not `comps/agent`). |
| `checkpoint_arango.py` | **LangGraph `BaseCheckpointSaver` backed by ArangoDB** — pause/resume interrupted gov workflows from last checkpoint (roadmap #603 Phase 1E). New collection `workflow_checkpoints`. |
| `config.py` | env-driven config (`LANGGRAPH_CHECKPOINT_COLLECTION`, `WORKFLOWS_ENABLED`, MCP server endpoints, GovStack BB URLs). |

### B2. Tools — `genie-ai-overlay/workflows/tools/`
| File | Purpose |
|---|---|
| `rag_tool.py` | Wraps GENIE's existing **ChatQnA/retriever HTTP endpoint** as a LangGraph tool (`@tool`) — the agent grounds in GENIE's RAG moat over HTTP. No in-process coupling to chatqna. |
| `mcp_tools.py` | **MCP client** via the `mcp` Python SDK + `langchain-mcp-adapters` → registers GovStack Building-Block MCP servers as LangGraph tools. **Not** `mcpo`, **not** OPEA's `OpeaMCPToolsManager` — GENIE owns the MCP client. |
| `governance.py` | **The [SST survivor](prds/prd-server-side-tools.md):** PII redaction (Presidio), circuit breaker, per-tool rate limiting, audit logging — wrapped around every tool invocation. This is the real remaining value of SST (registry/executor/MCP are subsumed by LangGraph tools + the MCP client). |
| `govstack_bb/` | Per-BB tool definitions (Auth, Payments, Scheduler, Registration) — Sprint 25 real wiring; stub the interface in Sprint 24. |

### B3. Workflow definitions — `genie-ai-overlay/workflows/graphs/`
| File | Purpose |
|---|---|
| `business_license.py` | Reference multi-step gov workflow (Sprint 24): requirements → form → human review gate → BB calls → approval. Demonstrates HITL + cross-BB + RAG grounding. |
| `birth_certificate.py`, `appointment.py` | Additional Sprint 24-25 workflows. |
| `_registry.py` | Maps workflow name → compiled graph; the orchestrator loads from here. |

### B4. MCP mock servers (roadmap #603 Phase 1C) — `genie-ai-overlay/workflows/mcp_servers/`
| File | Purpose |
|---|---|
| `auth_mock.py`, `payments_mock.py`, `scheduler_mock.py` | Standalone MCP-server processes (MCP SDK, stdio/SSE) for Auth/Payments/Scheduler BBs — consumed by `mcp_tools.py` in Sprint 24; connected to real GovStack BB APIs in Sprint 25. |

### B5. Build + integration
| File | Change |
|---|---|
| `genie-ai-overlay/workflows/Dockerfile-workflows_genie-ai` | Like the other overlay Dockerfiles (clones `comps` @ v1.5 for the `MicroService` harness) + `pip install langgraph>=1.0 langchain-core mcp langchain-mcp-adapters httpx`. Python 3.11. **No GenAIExamples clone** (no upstream example to mirror). |
| `genie-ai-overlay/workflows/requirements.txt` | `langgraph>=1.0`, `langchain-core`, `mcp>=1.x`, `langchain-mcp-adapters`, `httpx`, `presidio-analyzer`, `presidio-anonymizer`. (comps provides FastAPI/OTel/pydantic.) |
| `core/constants.py` | Add `ServiceType.WORKFLOW = 101` (GENIE-private, from A1). |
| `docker-compose.yaml` | New `genie-ai-workflows` service (profile-gated, e.g. `--profile agentic`), behind Kong, env: `CHATQNA_URL`, `MCP_SERVERS`, `ARANGO_URL`, GovStack BB URLs. |
| `api-gateway-solution/` (Kong) | Route `/api/workflows` + the OpenAI-compatible `/v1/chat/completions` agent endpoint → `genie-ai-workflows`; W3C `traceparent` propagation. |
| `components/gov-chat-backend/` (Node BFF) | Proxy routes to the workflows service + a workflow-status **WebSocket relay**; auth via the existing Keycloak middleware. |
| `components/gov-chat-frontend/` (Vue 3) | `WorkflowStatusComponent.vue` (current/pending/completed steps) + WebSocket integration (roadmap #603 Phase 1D). |
| `genie-ai-overlay/tests/test_workflows_*.py` | Graph compilation tests, tool tests (mocked ChatQnA/MCP), HITL checkpoint/resume tests, governance (PII-blocking) tests. |

### B6. Sequencing (roadmap #603, reduced — no mcpo, no custom runtime, no OPEA-agent learning curve)
- **1A — LangGraph core:** `state.py`, `nodes.py`, `orchestrator.py`, `checkpoint_arango.py`, the microservice shell.
- **1B — MCP infrastructure:** `mcp_tools.py` (MCP SDK client) + the 3 mock BB servers.
- **1C — Reference workflow:** `graphs/business_license.py` (HITL + cross-BB + RAG).
- **1D — Frontend viz:** `WorkflowStatusComponent.vue` + WebSocket.
- **1E — Pause/resume:** ArangoDB checkpointer wired end-to-end.
- **Governance:** `tools/governance.py` (the SST survivor) wrapping all tool calls.

---

## 4. What this replaces in the prior plan

- **Drops F2 (flatten-to-fork)** — the bump is cheap; flattening's ~14–20 days isn't justified.
- **Drops A1's "adopt OPEA `comps/agent`"** — agentic is LangGraph-direct on the comps harness, not OPEA's agent.
- **Reduces SST** to `tools/governance.py` (PII/circuit-breaker/rate-limit/audit) — registry/executor/MCP are subsumed by LangGraph tools + the MCP SDK client.
- **`mcpo` is not used** — the MCP SDK client replaces it.
- **OKF** is unaffected by this decision (it extends GENIE's existing ArangoDB retriever/dataprep; its MCP exposure is custom-Node, consumed by `mcp_tools.py` like any external MCP server).

---

## 5. Effort summary

| Work | Effort |
|---|---|
| **Part A — overlay bump to OPEA 1.5** | ~3–5 engineer-days (constants.py blocker + build/deps + dataprep dep re-validation + smoke jobs) |
| **Part B — agentic layer (LangGraph on comps harness)** | Sprint 24 #603 scope (~3-month sprint), materially reduced (no mcpo, no custom runtime, no OPEA-agent ramp-up); reusable harness accelerates 1A/1D |

**Part A is the immediate, cheap, low-RAG-risk lift.** Part B is the Sprint 24 agentic build, now with a clear file map and no OPEA-agent dependency.

---

## 6. Risks / watch-items

- **`constants.py` MCPFuncType** is the one thing that blocks the build until fixed — do it first.
- **dataprep dependency re-validation** (docling/pyspark/sentence-transformers) is the one place a surprise can hide — the existing tests + RAG benchmarks catch it.
- **`PositiveInt`/`NonNegativeFloat` tightening** — audit for zero/negative `top_n`/`k`/`max_tokens` payloads (A2).
- **Clone-at-build persists** (air-gap *build* still needs GitHub/mirror) — acceptable for now; vendor/mirror later only if it becomes a real constraint.
- **Align with jrevillard** — Part A touches his dataprep/retriever/reranker surface; Part B adds a new service he should be aware of.
- **LangGraph 1.x tracking** — GENIE owns the LangGraph upgrade cadence directly (normal library dependency, industry standard; not the unsustainable "novel runtime" case).

---

## 7. Team evaluation — considerations addressed

The team's `considerations_for_discussion_opea_1_5_for_agentic_enablement.md` raised 4 concerns about adopting OPEA's `comps/agent`. **All 4 are valid and well-cited — and all 4 are moot under this decision, because we are NOT adopting OPEA's agent.** They further validate the "own the agentic logic" call, and surface one refinement (build on LangChain Deep Agents).

| # | Consideration (from the file) | How this decision addresses it |
|---|---|---|
| 1 | OPEA agent **lags vLLM** — works around tool-calling limits that vLLM 0.8.3+ (Apr 2025) resolved; strategy files dated Jun 2025 | **Moot** — we don't use OPEA's agent. Our agent uses **vLLM's native tool-calling** (`--enable-auto-tool-choice --tool-call-parser`), leveraging the capability OPEA's workarounds predate. GENIE's vLLM is already 0.10.x. |
| 2 | **AgentQnA validated only on Intel/AMD HW + Intel/Meta models** (GENIE is NVIDIA) | **Moot** — we don't use OPEA's agent. Our agent runs on GENIE's existing **NVIDIA** vLLM (T4/RTX 6000), already production-proven for RAG. |
| 3 | **Only `react_llama` supports memory + multi-turn** (GENIE/ChatQnA is inherently multi-turn) | **Solved by LangGraph** — first-class multi-turn memory (checkpointer + state) for *all* agent types, not one. A core reason we rejected OPEA's agent. |
| 4 | OPEA agent **doesn't use LangChain Deep Agents** (SOTA context-managed ReAct) | **Refinement adopted** — build on **LangChain Deep Agents (on LangGraph)**: context-engineering middleware (history compression, tool-result offloading, subagent isolation, planning) — exactly what long, tool-heavy gov workflows need, and the gap in OPEA's agent. |

**Net:** the considerations are a strong case *against* OPEA's `comps/agent` — which is the decision already made. The one update: standardize the custom layer on **LangChain Deep Agents** (not raw LangGraph), and explicitly configure **vLLM native tool-calling** + rely on **LangGraph multi-turn memory**.

---

## Appendix — grounded diff facts (verified v1.3 vs v1.5, Aug 2026)

- **14 UNCHANGED · 13 MINOR · 2 MAJOR · 1 REMOVED/RENAMED** across orchestrator / lifecycle / proto+telemetry+deps surfaces.
- **Survive unchanged:** `ServiceOrchestrator.schedule/align_inputs/align_outputs/align_generator` (same positional call order → GENIE monkeypatch survives), `add/flow_to`, `runtime_graph` DAG, `MicroService.__init__` (3 new default-off kwargs), `add_route`, `OpeaComponent`/`OpeaComponentRegistry`/`OpeaComponentLoader`, `register_microservice`/`opea_microservices` keys, `opea_telemetry` (**byte-identical, 2381 B** — "renamed in v1.4" is false), `api_protocol` symbol set GENIE uses, `comps/__init__` exports.
- **The one hard blocker:** `constants.py` — 1.5 imports `MCPFuncType` from it + adds new `ServiceType` members (value-24 collision with GENIE's `TRANSLATOR`).
- **Dataprep deps (the real re-validation):** docling 2.30→2.45, pyspark 3.5→4.0, sentence-transformers 4.1→5.1, langchain-huggingface 0.1.2→0.3.1 (load-bearing — do not revert), langchain-arangodb 0.0.4→0.0.6; requirements path `requirements.txt → requirements-cpu.txt`. langgraph/vLLM/TEI/Python are **not** comps deps (no action).
- **docarray rename hack:** GENIE's own (not upstream); still applies at 1.5; `DocList→List` container switch to eyeball.
- **OPEA trajectory:** LF AI & Data, Apache-2.0, quarterly releases — but Intel-concentrated (4 crediting orgs at v1.5) amid 2024–2026 layoffs; cadence shifted to continuous component updates; thin adoption; `comps/agent` is a wrapper over LangChain/LangGraph. → Bet the plumbing, own the agentic logic.
