# Sprint Change Proposal — OKF course-correction for the three-pillar decision

**Date:** 2026-08-07 · **Branch:** `feat/agentic-enablement` · **Scope:** Moderate (targeted) · **Status:** Applied
**Workflow:** BMAD `correct-course`

## 1. Issue Summary

The OKF PRD, architecture, and ADR-003 were written **before** the finalized three-pillar decision and referenced SST and Sprint 24 #603 in their pre-decision form:
- SST as a "Registry / ToolExecutor / Stream-Ingestor / **mcpo**" foundation gating OKF's MCP transport.
- #603 as generic "LangGraph + MCP."
- OKF's MCP surface implicitly via OPEA's `OpeaMCPToolsManager` / `mcpo`.

**Trigger:** the decision landing (cheap OPEA 1.5 overlay bump + custom **LangChain Deep Agents** on the OPEA `MicroService` harness + SST reduced to tools) — reinforced by the team's `considerations_for_discussion_opea_1_5_for_agentic_enablement.md`.

## 2. Impact Analysis

- **OKF core design: UNCHANGED** (multi-graph grounding, curation lifecycle, governance, versioning, PII, ACL, repository model). OKF is the knowledge layer — independent of the agentic-framework choice.
- **PRD framing updated:** `depends_on`, §1 Vision, §3 SST glossary, FR-17, §6 sequencing, §10 dependencies (+ new OPEA 1.5 bump bullet), §12 Why Now.
- **Architecture:** §10 agent lane (MCP consumer), §13 sequencing (added **step 0: OPEA 1.5 bump** + greenfield note on step 1).
- **ADRs:** okf-003 (MCP = custom, consumed by the workflows service — not OPEA's `OpeaMCPToolsManager`/`mcpo`). okf-007 (SST Epic 4 admin) still valid — no change.
- **ADRs deliberately unchanged:** 002, 004, 005, 008, 011, 012, 013, 014, 015, 016.
- **Technical impact: none** — spec-framing changes only; no OKF code/design change.

## 3. Recommended Approach

**Direct adjustment** — 12 targeted edits across 3 files; no rollback, no MVP replan. Effort: applied in this session. Risk: **low** (framing/wording; OKF design intact).

## 4. Detailed Change Proposals (applied)

| Artifact | Location | Change |
|---|---|---|
| PRD | `depends_on` | SST/#603 reframed → OPEA 1.5 bump (cheap) + GENIE workflows service (custom Deep Agents) consumes MCP + SST reduced to tools; OKF Phase 1 greenfield, post-bump |
| PRD | §1, UJ-2, §12 | "LangGraph agent" → **LangChain Deep Agents (on LangGraph)**; "LangGraph+MCP workflows" → custom Deep Agents |
| PRD | §3 (SST glossary), §10 | SST = web search + stream ingestor + governance (registry/executor/mcpo subsumed) |
| PRD | FR-17, §6 | MCP gated on the workflows service's MCP client; OKF MCP = custom Node SDK / Kong proxy, NOT `OpeaMCPToolsManager`/`mcpo` |
| PRD | §10 (new bullet) | **OPEA 1.3→1.5 overlay bump** properly described: cheap, APIs byte-identical/additive, RAG stays Genie-owned/forked, OKF Phase 1 greenfield on the bumped base |
| Architecture | §10 agent lane | MCP consumed by the workflows service's MCP client (post 1.5 bump) |
| Architecture | §13 sequencing | Step 0 = OPEA 1.5 bump (prerequisite); step 1 flagged greenfield |
| ADR okf-003 | Decision § | Note: OKF MCP custom, consumed by workflows service, not OPEA MCP manager |

## 5. Implementation Handoff

- **Scope:** Moderate (spec alignment) — **applied**.
- **OKF spec is now consistent** with the three-pillar decision and the team considerations doc.
- **Next steps:** proceed with the **OPEA 1.5 overlay bump** (decision doc Part A, ~3–5 days) → **OKF Phase 1** (multi-graph + `graph_name` — greenfield). Agentic layer (LangChain Deep Agents on the OPEA harness) proceeds on its own track per the decision doc Part B.
