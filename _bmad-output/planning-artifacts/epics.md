---
stepsCompleted: []
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-genie-ai-2026-11-16/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-genie-ai-2026-11-17/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-genie-ai-2026-11-17/EXPERIENCE.md
---

# GENIE.AI — Agentic Foundations (OPEA-free), iteration 1 — Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the agentic-foundations initiative (iteration 1), decomposing the requirements from the PRD (status: final), the architecture spine (14 ADs, status: final) and the UX design contract (activity line, status: final) into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: The document capability contract defines input, result, provenance, and error semantics for every agent-facing operation.
FR-2: The contract accepts a trusted caller context and requested search restrictions; model-generated arguments never widen access.
FR-3: Results carry stable source identifiers and sufficient provenance for authorized citation resolution.
FR-4: The contract defines cancellation, timeout and result-size limits for every operation.
FR-5: The contract states compatibility and versioning rules for its operations.
FR-6: The first implementation of the contract is OPEA-free (direct ArangoDB/TEI/vLLM or new code; never ChatQnA/OPEA retriever calls).
FR-7: Agent-facing document contracts expose no OPEA-specific representations.
FR-8: Query-path behavior of the OPEA retriever/embedding pipeline is recorded (V02) before the contract is accepted, so the OPEA-free path preserves it deliberately.
FR-9: The agent may search knowledge, inspect evidence and refine its search within configured server-side limits — one agent, approved document operations only.
FR-10: The agent returns a source-grounded answer with traceable citations OR an explicit insufficient-evidence response; reference validity is mechanically checkable; grounding is enforced by mechanism (prompt-only citation instructions rejected); a release policy governs what is streamed before verification completes.
FR-11: Agent execution is bounded server-side on every dimension (step cap, wall-clock, per-run token budget, model/tool-call count, evidence volume); retries, parallel calls and auxiliary calls all count; cancellation propagates client-disconnect → loop → model call.
FR-12: Authorization follows the per-request intersection model (user ∩ task over registered toolset; user is the actor; enforcement in the tool executor; no permissive fallback; degraded retrieval reports insufficiency, never a confident answer).
FR-13: Evidence surfaced to the user resolves to authorized, stable citations rendered through the existing RAG citation components.
FR-14: The agentic path is compatible with the existing client API (SSE, translation, errors); internal agent events adopt the AG-UI taxonomy as a pattern, mapped onto the existing SSE contract; approved changes are explicitly versioned.
FR-15: Activation is independently controllable per deployment (configuration flag), alongside the unchanged legacy RAG path; per-user/tenant granularity is a non-goal of iteration 1.
FR-16: Rollback (agentic ↔ legacy routing) is demonstrated for every delivered stage, with in-flight treatment, persisted-conversation compatibility, a rollout record naming rollback triggers and a responsible operator, and rehearsal evidence.
FR-17: Every agent execution records implementation, model, prompt and configuration versions sufficient to investigate that execution, without credentials or unnecessary sensitive content.
FR-18: Agent executions are observable through the existing stack (OTel traces, VictoriaLogs/VictoriaTraces, Grafana); no dedicated admin UI in iteration 1.
FR-19: Licensing evidence in two tiers — V07a pre-adoption license verification per exact package version (NOASSERTION counts as unverified); V07b pre-release full license/redistribution assessment.
FR-20: The agentic request path contains no comps imports, no OPEA service calls, no OPEA build-time downloads — enforced from the first delivered stage by build/CI checks where feasible.
FR-21: The agentic path adds no new OPEA coupling that makes the deferred OPEA exit harder (same CI audit + stage-gate review check).
FR-22: A capability is described as "OPEA-free" only for its explicitly validated scope.
FR-23: The evaluation protocol runs E01 (A/B: legacy fixed RAG vs fixed pipeline over new capabilities) and E02 (B/C: fixed vs agent over the same new capabilities), with corpus/cases/conditions held fixed per pair and intentional differences recorded.
FR-24: Every evaluation run versions its corpus, cases, configurations, models, prompts and evaluator instructions; tuning cases stay separate from the assessment set; the set composition is fixed (answerable/unanswerable, citation checks, representative languages, restricted/public access, failure and cancellation cases).
FR-25: Authorization and prompt-injection scenarios are part of the evaluation set (hostile instructions embedded in retrieved documents and tool outputs); no unauthorized disclosure accepted; a document attempting to steer the agent counts as a finding.
FR-26: Known defects in the reference are recorded and never silently become requirements to reproduce.
FR-27: The evaluation reports retrieval quality, answer grounding, abstention, latency and resource consumption separately, and identifies uncontrolled differences.
FR-28: Authorization acceptance covers retained data (evidence across turns, session state, audit/tracing records) with defined ownership and access rules; cross-user/cross-session and between-turns permission-change attempts tested; historical visibility after revocation is an explicit recorded product-policy decision.
FR-29: Structural decisions are recorded as decision records (ADRs) with full traceability chain, status discipline, and one canonical home per record.
FR-30: The user sees a minimal activity line while the agent works — tool-call lifecycle events (started/completed/failed, operation name, never raw model reasoning) as new, explicitly versioned SSE event types that degrade gracefully; frontend rendering is a status line, no expandable tool detail.

### NonFunctional Requirements

NFR-1 (Security): Trusted-service authorization on every operation; no raw AQL to agents (ADR okf-011); provenance preserved end-to-end.
NFR-2 (Sovereignty/licensing): Apache-2.0-compatible selections only; sovereignty gated on DEFAULTS (default telemetry, default cloud export, license posture audited per exact version, V07a); developer-preview status requires explicit operational-risk acceptance.
NFR-3 (Coexistence): Legacy OPEA RAG path serves existing traffic unchanged; agentic path additive; legacy non-regression criterion under concurrent agentic load is part of the S4 gate; expected saturation/admission behavior defined; E02 measures resource consumption.
NFR-4 (Operability): Rollback rehearsed per stage (V08); deployment-level activation; observability through the existing stack.
NFR-5 (Compatibility): Existing client API/SSE/error contracts inventoried and regression-covered before the S3 compatibility gate (V05).
NFR-6 (CI): Executable CI/integration coverage and runner availability confirmed (V09); checks needing a separate environment identified; repo E2E is local-run baseline (ADR 0001).
NFR-7 (Reversibility): No second authorization/knowledge-governance layer; no generic multi-engine platform; documented dependency boundaries and replacement scope for every candidate (runtime seam, AD-5).

### Additional Requirements

From the architecture spine (binding ADs → implementation work):

- AR-1 (AD-1/AD-2): New service `components/agent-service` — Python 3.11, FastAPI, non-overlay (pattern pii-service), internal-only port, compose-standard block (cap_drop, no-new-privileges, fluentd anchor, healthcheck), image `genie-ai-agent-server` with CI triplet (build/scan/promote) + ansible `genieai_images` entry + lint/test jobs.
- AR-2 (AD-1): FR-20 CI gate as a new `tests/config-validator/` tree-walking test (exemplars: e2e-stream-route, e2e-handle-locators, ci-shell-gates) covering agent-path packages; BFF leg enforced by a routing-helper test asserting the agentic branch never targets the chatqna/OPEA URL.
- AR-3 (AD-3/AD-4): Document capability module inside agent-service — operations `search_knowledge` / `read_source` (working names), structured trusted-caller context (never the `search_start` compression), enforcement by construction over the per-request authorized graph set, fail-closed on authz resolution failure, `read_source` re-validates resolved targets against the request's authorized set (legacy GRAPH mapping defined), graph/repo identifier charset guard, okf-server remains the authority (servingReads unchanged).
- AR-4 (AD-10): V02 recording story (liminal) — record deployed query-path semantics (dense cosine brute-force default, BM25 view, RRF k, analyzer, label-filter strategy, file_id enrichment, CAP-1 join tolerance, query-instruction prefix) as the port's behavioral contract.
- AR-5 (AD-10): Clean-slate port of the query path (~500–800 lines reference: retriever `invoke`/`_extract_for_graph`): modern patterns encouraged, behavior frozen to V02 semantics; equivalence suite per behavior; no shared library/wrapping/dual-mode with the overlay.
- AR-6 (AD-5): Runtime seam — server-registered toolset (registry is the authorization surface), internal envelope `{run_id, call_id, seq, kind, payload}` owned by `agent/`, AG-UI-shaped event vocabulary owned by the seam (runtimes adapt, never rename); D03 decision at S4 entry (V06+V07a, 2026-12-01 freshness gate); pydantic-ai ≤1-day swap-in exit test.
- AR-7 (AD-6): Request orchestrator — budgets (steps, wall-clock end-to-end, tokens, calls, evidence volume; everything counts incl. judge/translation/classification), cancellation chain (BFF stream-disconnect detection → abort → model-call cancel; replaces dead `req.on('close')`), BFF upstream timeout ≥ orchestrator deadline (V08-validated), fleet-wide admission via cross-process flock slot pool (dataprep idiom) covering all modes incl. no-agent evaluation mode.
- AR-8 (AD-7): Citation pipeline — inline mechanical reference-validity check (always on, no LLM, stable source ids against actually-retrieved set), grounding judge at finalize (one budgeted call, fallback `unverified`), release policy enum with iteration-1 `verdict-marked`; `metadata.is_grounded` derived from the verdict (single source of truth — client cannot overwrite).
- AR-9 (AD-8): SSE integration — BFF parses the seam stream and writes every client frame (chunk relay, translation injection, metadata + version-record persistence, done/error); five existing types + terminal order preserved; new additive versioned events `agent_activity` (interleaves with chunks) and `agent_verdict` (after last chunk, before metadata); `metadata.source_documents` shape preserved (legacy `document_id`=file_id; OKF variant with `source:'okf-concept'`); e2e envelope extension in `tests/e2e/helpers/stream-route.js` + spec pinned to local run set; agent emits an activity frame immediately at run start (handover, no "Thinking…" gap).
- AR-10 (AD-9): Activation flag (OKF_ENABLED pattern) — compose replicas + one shared BFF routing helper used by BOTH `initStreamQuery` and `createQuery` with a test asserting the paths cannot disagree; agentic path mints the `queries` doc (same shape); k3s chart adoption is operator-owned with same flag semantics.
- AR-11 (AD-11): Observability — port overlay `tracing.py` pattern minus comps hooks (must pass the AR-2 gate), fluentd anchor, `OTEL_SERVICE_NAME` pair, W3C traceparent; version record emitted by the agent in the final metadata frame, persisted verbatim by the BFF into the `queries` doc.
- AR-12 (AD-12): Persistence unchanged — `queries` per turn, chat-history collections on save; no new store; agent session state in-request; rollback continuity without data changes.
- AR-13 (AD-13): Tainted-data discipline — tool results cross the port as structured data only (typed fields, stable ids, bounded sizes); no instruction channel; injection scenarios in the eval set.
- AR-14 (AD-14): Translation on the agentic path — BFF-executed, vLLM GPU backend only (gpu-translate-backend pattern); OPEA translation image never invoked; tokens/wall-clock counted into the per-request budget via the execution record.
- AR-15 (AD-6/UX): Auxiliary model calls (judge, classification, translation) emit no `agent_activity` event.

### UX Design Requirements

From the UX design contract (DESIGN.md + EXPERIENCE.md):

- UX-DR1: Web activity-line component — new row as FIRST child of `.answer-card` (sibling of `.message-bubble`; convert its `v-else` to explicit `v-if`), spinner (DsSpinner sm, `--accent`) + label in `--muted` `--text-sm`, gap `--space-sm`, one line, no own margin/fill; handles `data-testid="agent-activity-line"` + per-op `agent-activity-op-<operation>`.
- UX-DR2: Web state rendering — running (spinner + present-progressive label), completed (static dot + past tense), failed (warning-family chip `--warning-bg`/`--warning-ink`, never `--danger`; label never truncates in failed state), collapsed (not rendered); replaces the typing indicator from the first `agent_activity` frame; collapses at first `chunk`, never re-opens; post-chunk activity frames accepted-but-unrendered (iteration 1).
- UX-DR3: Mobile activity line — same states/words; trailing in-flight row slot; use mobile `DsSpinner` (supersedes raw `CircularProgressIndicator`); failed state = `tokens.warning` label + marker (no fill, mobile has no warning-bg pair); `ValueKey('agent-activity-line')` / `('agent-activity-op-<operation>')`.
- UX-DR4: i18n — namespace `chatbot.agentActivity.*` (9 keys: working, stepCompleted, stepFailed, per-operation running/completed/failed for search_knowledge and read_source) delivered in ALL 14 web locale files (hard gate `localeConsistency.test.js`) and ALL 14 mobile dart locale files (review-enforced); templates localized client-side keyed by the server's operation name; raw operation ids never shown; server never sends localized strings.
- UX-DR5: Accessibility — line container `role="status"` + `aria-live="polite"` (web) / `Semantics(liveRegion: true)` (mobile); marker decorative (`aria-hidden` / `ExcludeSemantics`); state carried by the word, never colour-only; `prefers-reduced-motion: reduce` stops the spinner (static ring idiom, scoped to the line — DsSpinner not modified globally); no focus, no pointer events, not interactive.
- UX-DR6: `agent_verdict` is never rendered by the line — it maps onto the existing ungrounded-answer warning pattern (`.answer-warning`); answer errors keep the existing `.answer-error` + Retry surface.
- UX-DR7: Cancellation/error UX — the line collapses immediately on abort/error frames; interrupted turns show the existing error surface with Retry (no frozen line).
- UX-DR8: No activity persistence — nothing about the line enters the transcript or replays on conversation restore.

### FR Coverage Map

{{requirements_coverage_map}}

## Epic List

{{epics_list}}
