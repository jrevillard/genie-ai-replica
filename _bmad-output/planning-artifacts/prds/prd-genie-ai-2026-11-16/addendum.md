# Addendum — Agentic Foundations (OPEA-free)

Depth that belongs downstream (architecture, evaluation design) or earned a
place outside the PRD narrative. Audit trail lives in `.memlog.md`.

## A. Rejected and superseded alternatives

| Option | Disposition | Rationale |
|---|---|---|
| Interim implementation delegating to existing OPEA services (ChatQnA / OPEA retriever) | **Superseded** (operator, 2026-11-16) | Was the 2026-11-10 framing option; rescoped — the first implementation of the document capability contract must itself be OPEA-free (FR-6). Legacy path keeps serving existing traffic; nothing is migrated. |
| Workflow engine / orchestrator groundwork inside iteration 1 | **Excluded** | Vision is broad (agentic government workflows, potential AI orchestration) but iteration 1 is foundations + SC-01. Non-closing constraint instead: contracts decoupled, runtime selected with evolution in mind (D03), no orchestrator primitives delivered. |
| Per-user/tenant activation granularity in iteration 1 | **Deferred** | Deployment-level flag (FR-15) is rollback-friendly (V08) and sufficient without a pilot cohort; granularity is an evolution, contract-stable. |
| Enriched agent citation rendering (per-search-step passages) | **Deferred** | Reusing existing RAG citation components (FR-13) keeps iteration 1 frontend-free and preserves R06 compatibility by construction. |
| Dedicated admin UI for agent executions | **Deferred** | Existing observability stack (OTel → VL/VictoriaTraces/Grafana) covers iteration-1 needs (FR-18); R08 satisfied by structured logs. |
| Generic multi-engine platform / second engine to claim future flexibility | **Rejected** (framing §8) | No evidence the flexibility is needed as product; replacement costs documented instead (NFR-7). Transparent migration of workflows/checkpoints/sessions between engines is not an established capability of any candidate. |
| Fully agentic chatbot / LangGraph+MCP Phase 1 (legacy issues #211, #603) | **Absorbed as context** | Older deferred ambitions; this PRD supersedes them as the active agentic initiative. Their disposition (close as superseded vs re-scope) is an operator/triage decision, not a PRD one. |

## B. "OPEA component" — boundary rationale

See PRD §5 for the definition. Rationale: the excluded components (vLLM,
TEI, ArangoDB, Redis, GENIE's Node.js services) are defined independently of
the OPEA wrappers in compose (source finding F05) — but direct use and
behavioral equivalence remain to be tested (V02/V03), which is why
R12/FR-22 restricts the "OPEA-free" label to validated scope.

## C. Evidence categories used by the framing

The framing document (issue #1729) distinguishes four categories: team-provided information,
source-verified finding (F01–F10), proposal, and verification required
(V02–V09). PRD sections inherit those categories: FRs derived from
"proposal" items remain open to challenge at architecture review; F-findings
cited in the PRD carry their source-revision limits.

## D. Runtime candidate matrix

Filled from the S1 research digest (`research-extract.md`) — maintained here
so the PRD's D03 section stays a pointer, not a copy. See section "Runtime
candidates" in the extract; the ranked recommendation and per-candidate
maturity/license signals live there. **Post-review (2026-11-16): the
research's "Amendments" section (AM-1..AM-6) supersedes the affected extract
statements — DSH embeddability corrected (SDK subprocess mode exists; rank-5
provisional, operational assessment outstanding), custom-loop pick
provisional (unimplemented), LangGraph time controls and vLLM tool-choice
prerequisites scoped by version/mode. No ranking is settled evidence until
the AM-1 assessment and a GENIE implementation exist. The screen's G4
(per-operation authorization) and G5 (existing-SSE-contract compatibility)
verdicts were **mechanism-level** (tool registration, streaming
availability) and need re-evaluation at application level — carried by
V04/V05 and the V06 integration test.**

**D03 candidate state (authoritative detail behind PRD §10's D03 row):**

| Candidate | State | Required before D03 can accept it |
|---|---|---|
| Custom minimal tool-calling loop | Research screening pick (57.5) — **provisional, unimplemented** (AM-2) | A GENIE implementation meeting FR-10..FR-12; G4/G5 re-evaluated at application level |
| pydantic-ai | Runner-up (52.0) — fallback **hypothesis** (NFR-7), same-Python placement assumed | Placement decision (OQ-6); scoped swap-in spike if kept as fallback |
| DeepSeek Harness | Ranked last **provisionally** — original embeddability premise voided (AM-1: TS+Python SDKs drive the runtime as a JSON-RPC stdio subprocess, bundled runtime) | Operational assessment of the subprocess mode (lifecycle granularity, isolation, cost, published-version availability); developer preview + no security audit + zero evidenced adoption still stand |
| OpenAI Agents SDK / LangGraph | Screened, not preferred | Not active candidates unless D03 reopens |

DSH revisit trigger (AM-1-corrected): stable non-preview release + security
audit + completed subprocess-mode operational assessment.

Selection drivers for D03 (from framing + operator): plugin architecture
(evaluating DSH specifically for this), license compatibility (V07),
isolation/cancellation/telemetry with GENIE's model endpoint (V06), and
evolution capability toward orchestrated workflows (non-closing constraint).

## E. Deferred OPEA-exit initiative — carry-over list

Not this initiative's scope, recorded so it is not lost: full OPEA dependency
inventory; data-transition and ingestion-writer strategy; backend-comparison
evaluation (formerly E03); Intel archival scope/timing monitoring (formerly
V01); progressive replacement sequencing across the legacy stack. Entry
condition: the agentic foundations exist (S4 done).

## F. Retrieval-strategy guard (framing NOTE, preserved verbatim in intent)

**Removing embeddings or vector indexes is not an accepted decision.** Such a
removal requires evidence on answer quality, retrieval coverage, citations,
latency, resource consumption and operational complexity — six dimensions,
not one (a firewall against single-metric arguments — for example, the
Medium-article thesis that published retrieval results transfer). A
subsequent controlled experiment **may** compare lexical, vector, structural
and hybrid retrieval strategies using the same GENIE corpus, authorization
rules and evaluation protocol — an option for iteration 2+, recorded here so
it survives PRD scope boundaries.
