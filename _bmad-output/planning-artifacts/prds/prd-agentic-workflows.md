---
title: PRD — GENIE.AI Agentic Workflows Layer
status: draft (starter — elaborate via bmad-prd)
created: 2026-08-07
updated: 2026-08-07
prd_key: agentic-workflows
initiative: agentic-enablement
branch: feat/agentic-workflows
parent_prd: ../prd-agentic-enablement.md
builds_on:
  - ../OPEA-1.5-upgrade-analysis.md   # Part B = the agentic layer detail
  - ../team-briefing-agentic-enablement.md
  - ./prd-server-side-tools.md         # SST tools this layer consumes
  - ./prd-okf-server-2026-07-15/prd.md # OKF knowledge this layer grounds in
authors: Genie.ai Dev
---

# PRD: GENIE.AI Agentic Workflows Layer

> **Pillar spec of the [agentic-enablement initiative](../prd-agentic-enablement.md).** This is the **Agentic layer** — the orchestrator that turns GENIE from a RAG chat system into a workflow-execution engine (roadmap Sprint 24, #603). **Starter draft:** the architecture/file-map is decided (decision doc [Part B](../OPEA-1.5-upgrade-analysis.md)); the detailed FRs/NFRs below are to be elaborated via the BMAD `bmad-prd` workflow.

## 0. Purpose
Define the Agentic pillar: a new `genie-ai-overlay/workflows/` microservice that orchestrates multi-step government workflows via tools (RAG, GovStack Building Blocks through MCP), grounded in governed knowledge, with human-in-the-loop, pause/resume, and full sovereignty/observability.

## 1. Vision & Goal
AI agents orchestrate multi-step government workflows — "apply for a business license", "book an appointment", "check eligibility" — calling tools, grounded in GENIE's RAG + OKF knowledge, with HITL review gates, pause/resume, and auditability.

## 2. Scope (decided — decision doc Part B)
**The agentic layer = custom LangChain Deep Agents (on LangGraph), hosted on the OPEA `MicroService` harness.**
- ✅ **In scope:** a new `genie-ai-overlay/workflows/` microservice — comps `MicroService` shell (reuses lifecycle/`/health`/OTel/FastAPI/Kong/build — **no bespoke bootstrap**) + LangChain Deep Agents on LangGraph inside; the `mcp` SDK client (`mcp_tools.py`); an ArangoDB `BaseCheckpointSaver` (`checkpoint_arango.py`); tool registration (consuming SST tools + OKF over HTTP/MCP); OpenAI-compatible `/v1/chat/completions` + a workflow-status WebSocket; a Vue `WorkflowStatusComponent`; mock GovStack BB MCP servers (Sprint 24).
- ❌ **Out of scope / rejected:** OPEA `comps/agent` (it's a LangChain/LangGraph wrapper on a declining, Intel-concentrated project; lags current vLLM tool-calling; `react_llama`-only memory; AgentQnA validated only on Intel/AMD; does not use Deep Agents). **Not** `mcpo`. **Not** OPEA's `OpeaMCPToolsManager`.

## 3. Why custom (not OPEA `comps/agent`) — the 4 considerations
(All 4 from `considerations_for_discussion_opea_1_5_for_agentic_enablement.md` — addressed by this design; full mapping in the decision doc §7.)
1. OPEA agent lags vLLM → we use **vLLM's native tool-calling** (`--enable-auto-tool-choice --tool-call-parser`).
2. AgentQnA Intel/AMD-only → we run on GENIE's existing **NVIDIA** vLLM.
3. `react_llama`-only memory → **LangGraph multi-turn memory** (checkpointer + state) for all agent types.
4. No Deep Agents → we **build on LangChain Deep Agents on LangGraph** (context-engineering middleware for long gov workflows).

## 4. Architecture / file map (from decision doc Part B)
```
genie-ai-overlay/workflows/
  genieai_workflows_microservice.py   # comps MicroService shell (the harness reuse)
  state.py                            # Pydantic WorkflowState
  nodes.py                            # llm/rag/tool/router/human_input/translation/guardrail nodes
  orchestrator.py                     # LangGraph StateGraph builder (Deep Agents)
  checkpoint_arango.py                # ArangoDB BaseCheckpointSaver (pause/resume)
  tools/
    rag_tool.py                       # HTTP tool → existing ChatQnA
    mcp_tools.py                      # mcp SDK client → GovStack BB MCP servers
    governance.py                     # ← from SST: PII/circuit-breaker/rate-limit/audit
    web_search.py                     # ← from SST: SearXNG
  graphs/                             # workflow definitions (business_license, appointment, …)
  mcp_servers/                        # mock GovStack BB MCP servers (Sprint 24)
  Dockerfile-workflows_genie-ai       # comps @1.5 harness + pip install langgraph mcp …
  requirements.txt                    # langgraph, langchain-core, mcp, langchain-mcp-adapters, httpx
```
Plus: `ServiceType.WORKFLOW=101` (GENIE-private, in `core/constants.py` — added by the bump); a Kong route; a BFF WebSocket relay; the Vue `WorkflowStatusComponent`.

## 5. Dependencies
- **OPEA 1.5 overlay bump** (`feat/opea-1.5-bump`) — foundational (the harness + bumped base). Lands on `main` first.
- **SST tools** ([`feat/sst`](./prd-server-side-tools.md)) — `web_search.py`, `governance.py`, the stream ingestor: consumed as LangGraph tools (file boundary: SST owns `workflows/tools/*.py` + ingestor; this branch owns the rest of `workflows/`).
- **OKF** ([`feat/okf-server`](./prd-okf-server-2026-07-15/prd.md)) — knowledge grounding, consumed over HTTP/MCP.
- **Libraries:** LangChain Deep Agents, LangGraph 1.x, `mcp` SDK + `langchain-mcp-adapters`, httpx (GENIE owns the LangGraph upgrade cadence directly).

## 6. Sequencing
After the bump lands on `main`: build 1A (LangGraph core + harness shell) → 1B (MCP client + mock BB servers) → 1C (reference `business_license` workflow with HITL) → 1D (Vue viz + WebSocket) → 1E (ArangoDB pause/resume). Governance + web-search integrated as the SST tools land on `feat/sst`.

## 7. Open / to elaborate (via `bmad-prd`)
- Detailed **FRs** (per workflow node, HITL semantics, MCP tool registration, pause/resume contract).
- **NFRs** (sovereignty/air-gap — no OPEA-agent in the loop; observability — OTel across agent→tool→RAG; performance — p95 per workflow step; vLLM tool-calling config).
- **Agent-framework spike:** validate LangChain Deep Agents maturity against one real gov workflow before full commitment.
- Cut GitLab issues for this pillar.
