---
title: PRD — GENIE.AI Agentic Enablement
status: draft
created: 2026-08-07
updated: 2026-08-07
prd_key: agentic-enablement
initiative: agentic-enablement
branch: feat/agentic-enablement
builds_on:
  - ../team-briefing-agentic-enablement.md
  - ../OPEA-1.5-upgrade-analysis.md
child_prs:
  - OKF Server → ./prd-okf-server-2026-07-15/prd.md
  - SST (draft, reduced) → ./prd-server-side-tools.md
authors: Genie.ai Dev
---

# PRD: GENIE.AI Agentic Enablement

> **Umbrella initiative PRD.** Frames the four work-streams that together enable agentic workflows in GENIE.AI. Each pillar has its own spec (linked in §6). This document orchestrates the pillars; it does not duplicate their detail.

## 0. Purpose

Define the **agentic-enablement initiative** at the initiative level: the goal, the four pillars, why this shape, the sequencing, and where each pillar's detail lives. Audience: product management, architects, and the engineering team. This is the parent PRD for the pillar specs (OKF, SST, …) on the `feat/agentic-enablement` branch.

## 1. Vision & Goal

GENIE.AI must move from a RAG chat system to one where **AI agents orchestrate multi-step government workflows** — "apply for a business license", "book an appointment", "check eligibility" — calling tools (RAG, GovStack Building Blocks via MCP), grounded in governed knowledge, with human-in-the-loop review gates, pause/resume, and full sovereignty, air-gap capability, and observability. This is the team's medium-term goal and roadmap Sprint 24 (#603).

The initiative delivers this through **four pillars** — the RAG base, the agentic layer, the tools layer, and the knowledge layer — each owned and specified in its own artifact.

## 2. The four pillars

| Pillar | Role | Detail lives in |
|---|---|---|
| **1. OPEA 1.5 overlay bump** | Foundation — refresh the `comps` base cheaply (~3–5 engineer-days); the RAG components stay **Genie-owned/forked** | decision doc [Part A](../OPEA-1.5-upgrade-analysis.md) |
| **2. Agentic layer** | **Custom LangChain Deep Agents (on LangGraph)** on the OPEA `MicroService` harness — the orchestrator (not OPEA `comps/agent`) | decision doc [Part B](../OPEA-1.5-upgrade-analysis.md) |
| **3. SST (tools)** | Web search (SearXNG) + stream ingestor + governance — the agent's tools (registry/executor/mcpo subsumed) | [SST PRD](./prd-server-side-tools.md) |
| **4. OKF (knowledge)** | Governed, versioned, multi-graph knowledge for agents to ground in and cite | [OKF PRD](./prd-okf-server-2026-07-15/prd.md) |

## 3. Why this shape (strategic context)

Grounded in the v1.3↔v1.5 `comps` source diff and the OPEA-trajectory research (full detail in the [decision doc](../OPEA-1.5-upgrade-analysis.md) and [team briefing](../team-briefing-agentic-enablement.md)):

- **The bump is cheap** — every `comps` API GENIE depends on is byte-identical/additive; GENIE's RAG logic needs ~zero changes → retain the overlay, bump it. Do **not** adopt OPEA's components wholesale.
- **OPEA's `comps/agent` is rejected** — it is a wrapper over LangChain/LangGraph on a declining, Intel-concentrated project; it lags current vLLM tool-calling; memory/multi-turn is `react_llama`-only; AgentQnA is validated only on Intel/AMD; and it does not use LangChain Deep Agents. → build the agentic layer ourselves on **LangChain Deep Agents (on LangGraph)**, hosted on the OPEA `MicroService` harness (reuses lifecycle/health/OTel/FastAPI/Kong/build — no bespoke bootstrap).
- **SST reduces** to its real value — the registry/executor/mcpo are subsumed by LangGraph tools + the `mcp` SDK → SST keeps **web search + stream ingestor + governance**.
- **OKF** is the knowledge layer, independent of the agentic-framework choice.

## 4. Initiative-level requirements (summary)

Detailed FRs/NFRs live in each pillar spec. At the initiative level:

- **Agentic:** agents plan/execute multi-step gov workflows with tool-calling (**vLLM native**), HITL review gates, and pause/resume (ArangoDB checkpointer).
- **Grounded:** agents ground in GENIE's RAG **and** OKF knowledge, with citations + version pins.
- **Tooled:** RAG (HTTP to ChatQnA), GovStack Building Blocks (MCP via the `mcp` SDK client), web search (SearXNG) — all wrapped by governance (PII/circuit-breaker/rate-limit/audit).
- **Sovereign:** air-gappable; no OPEA-agent / foreign-runtime dependency in the agent loop; GENIE owns the MCP client (not OPEA's `OpeaMCPToolsManager`, not `mcpo`).
- **Observable:** OTel spans + W3C `traceparent` across agent → tool → RAG; reuse the existing Victoria*/Grafana stack.

## 5. Sequencing & dependencies

```
0. OPEA 1.5 overlay bump (~3–5 days; foundational, gates the Python surface)
   ├─ 1. Agentic layer — Deep Agents on the OPEA MicroService harness   ┐ parallel
   ├─ 2. SST tools — web search + stream ingestor + governance          ┘
   └─ 3. OKF Phase 1 — multi-graph fan-out + graph_name (GREENFIELD, post-bump)
        → OKF server skeleton → admin UI → authoring → serving → hardening
→ #604 ChatQnA refactor (consolidate flow_to variants)
→ #603 agentic on the custom LangChain Deep Agents layer
→ Sprint 25: #606 GovStack BB integrations (real MCP servers) + #607 multi-channel
```

Critical-path note: the OPEA 1.5 bump, OKF Phase 1, and #604 all touch `genieai_chatqna.py` / retriever / dataprep — sequence them in that order, and align with jrevillard (his modules).

## 6. Pillar artifacts

- **OKF** → [`./prd-okf-server-2026-07-15/prd.md`](./prd-okf-server-2026-07-15/prd.md) + architecture + ADRs `okf-001..016` ([`../../../docs/adr/`](../../../docs/adr/))
- **SST** → [`./prd-server-side-tools.md`](./prd-server-side-tools.md) *(reduced scope; references the original on `feat/server-side-tools/prd`, GitLab #696–#725)*
- **Agentic layer (Deep Agents on the OPEA harness)** → decision doc [Part B](../OPEA-1.5-upgrade-analysis.md)
- **OPEA 1.5 bump (file-by-file)** → decision doc [Part A](../OPEA-1.5-upgrade-analysis.md)
- **Strategy / team briefing** → [`../team-briefing-agentic-enablement.md`](../team-briefing-agentic-enablement.md)
- **Team considerations (evaluated)** → [`../considerations_for_discussion_opea_1_5_for_agentic_enablement.md`](../considerations_for_discussion_opea_1_5_for_agentic_enablement.md) (all 4 addressed — decision doc §7)

## 7. Open decisions

- **~~SST PRD~~** ✅ RESOLVED → [`prd-server-side-tools.md`](./prd-server-side-tools.md) (fresh reduced-scope; original retained on `feat/server-side-tools/prd`).
- **OPEA 1.5 bump ownership:** coordinate with jrevillard (his dataprep/retriever/reranker/chatqna surface).
- **Agent-framework spike:** validate LangChain Deep Agents maturity against one real gov workflow (HITL + cross-BB) before committing.
- **GitLab issues:** cut/refresh issues per pillar (OKF has none; SST #696–#725 to re-baseline to reduced scope).
