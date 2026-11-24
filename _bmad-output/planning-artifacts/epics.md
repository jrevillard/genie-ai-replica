---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories']
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
NFR-7 (Reversibility): No second authorization/knowledge-governance layer; no generic multi-engine platform; documented dependency boundaries and replacement scope, WITH measured or estimated swap cost, for every candidate (runtime seam, AD-5; a second-runtime implementation stays optional — documenting cost does not require building it).

### Additional Requirements

From the architecture spine (binding ADs → implementation work):

- AR-1 (AD-1/AD-2): New service `components/agent-service` — Python 3.11, FastAPI, non-overlay (pattern pii-service), internal-only port, compose-standard block (cap_drop, no-new-privileges, fluentd anchor, healthcheck), image `genie-ai-agent-server` with CI triplet (build/scan/promote) + ansible `genieai_images` entry + lint/test jobs.
- AR-2 (AD-1): FR-20 CI gate as a new `tests/config-validator/` tree-walking test (exemplars: e2e-stream-route, e2e-handle-locators, ci-shell-gates) covering agent-path packages; BFF leg enforced by a routing-helper test asserting the agentic branch never targets the chatqna/OPEA URL.
- AR-3 (AD-3/AD-4): Document capability module inside agent-service — operations `search_knowledge` / `read_source` (working names), structured trusted-caller context (never the `search_start` compression), enforcement by construction over the per-request authorized graph set, fail-closed on authz resolution failure, `read_source` re-validates resolved targets against the request's authorized set (legacy GRAPH mapping defined), graph/repo identifier charset guard, okf-server remains the authority (servingReads unchanged).
- AR-4 (AD-10): V02 recording story (liminal) — record deployed query-path semantics INCLUDING the query/history preparation pipeline (language detection among ALL supported locales, translate ANY source language → English pre-embedding — the embedding space is English-only; history/input bounds, query_translation_status), dense cosine brute-force default, BM25 view, RRF k, analyzer, label-filter strategy, file_id enrichment, CAP-1 join tolerance, query-instruction prefix. Input-preparation ownership: the LOOP (application layer) prepares every query — including refined mid-loop queries — before calling `search_knowledge` (auxiliary budgeted vLLM call); the port's input contract requires prepared English queries and never calls vLLM itself; answer translation (English → the user's locale, any of the 14) stays BFF-owned (AR-14).
- AR-5 (AD-10): Clean-slate port of the query path (~500–800 lines reference: retriever `invoke`/`_extract_for_graph`): modern patterns encouraged, behavior frozen to V02 semantics; equivalence suite per behavior; no shared library/wrapping/dual-mode with the overlay.
- AR-6 (AD-5): Runtime seam — server-registered toolset (registry is the authorization surface), internal envelope `{run_id, call_id, seq, kind, payload}` owned by `agent/`, AG-UI-shaped event vocabulary owned by the seam (runtimes adapt, never rename); D03 decision at S4 entry (V06+V07a, 2026-12-01 freshness gate); pydantic-ai = runner-up HYPOTHESIS (swap-in spike optional, one-day = hypothesis to measure, never a prescribed test).
- AR-7 (AD-6): Two-level budgets — BFF owns the end-to-end deadline (agent + translation + finalization); orchestrator owns the agent-phase sub-budget (steps, wall-clock, tokens, calls, evidence volume; everything counts incl. judge/classification); translation on the residual (no start beyond deadline, disconnect cancels downstream, usage returned-or-estimated — gpu-translate-backend must be extended/wrapped); cancellation chain (BFF stream-disconnect detection → abort → model-call cancel; replaces dead `req.on('close')`); admission via flock slot pool with the ITERATION-1 DEPLOYMENT CONTRACT of exactly one agent replica (the pool is then the global bound; multi-replica deferred pending shared coordination); document-tool calls dispatch serially (one in flight; auxiliary calls may overlap, invisible to the activity line).
- AR-8 (AD-7): Citation pipeline — inline mechanical reference-validity check (always on, no LLM, stable source ids against actually-retrieved set), grounding judge at finalize (one budgeted call), release policy enum with iteration-1 `verdict-marked`; verdict TRI-STATE `grounded|ungrounded|unverified` with `grounding_status` wire field + legacy `is_grounded` projection (true iff grounded); verdict scope = the source-language text evaluated (translated answers marked, never inheriting the claim).
- AR-9 (AD-8): SSE integration — BFF parses the seam stream and writes every client frame (chunk relay, translation injection, metadata + version-record persistence, done/error); five existing types + terminal order preserved; new additive versioned events `agent_activity` (tool-call lifecycle; interleaves with chunks) and `agent_verdict` (after last chunk, before metadata); `metadata.source_documents` shape preserved (legacy `document_id`=file_id; OKF variant with `source:'okf-concept'`); e2e envelope extension in `tests/e2e/helpers/stream-route.js` + spec pinned to local run set. Run-start handover (an activity frame at run start so the legacy "Thinking…" gap disappears) stays a RECOMMENDATION, not a requirement — if implemented, it must define a run-level state distinct from the tool-call lifecycle and from the AD-11 audit handshake; an agent that never invokes a document tool must emit no spurious tool-lifecycle event.
- AR-10 (AD-9): Activation flag (OKF_ENABLED pattern) — compose replicas + one shared BFF routing helper used by BOTH `initStreamQuery` and `createQuery` with a test asserting the paths cannot disagree; agentic path mints the `queries` doc (same shape); k3s chart adoption is operator-owned with same flag semantics.
- AR-11 (AD-11): Observability — port overlay `tracing.py` pattern minus comps hooks (must pass the AR-2 gate), fluentd anchor, `OTEL_SERVICE_NAME` pair, W3C traceparent; run-start version handshake (agent emits run-start seam event with versions, BFF persists into the `queries` doc AT START; final metadata completes the record — cancelled/crashed runs keep attribution).
- AR-12 (AD-12): Persistence unchanged — `queries` per turn, chat-history collections on save; no new store; agent session state in-request; rollback continuity without data changes.
- AR-13 (AD-13): Tainted-data discipline — tool results cross the port as structured data only (typed fields, stable ids, bounded sizes); no instruction channel; injection scenarios in the eval set.
- AR-14 (AD-14): Translation on the agentic path — BFF-executed, vLLM GPU backend only (gpu-translate-backend pattern); OPEA translation image never invoked; tokens/wall-clock counted into the per-request budget via the execution record.
- AR-15 (AD-6/UX): Auxiliary model calls (judge, classification, translation) emit no `agent_activity` event.

### UX Design Requirements

From the UX design contract (DESIGN.md + EXPERIENCE.md):

- UX-DR1: Web activity-line component — new row as FIRST child of `.answer-card` (sibling of `.message-bubble`; convert its `v-else` to explicit `v-if`), spinner (DsSpinner sm, `--accent`) + label in `--muted` `--text-sm`, gap `--space-sm`, one line, no own margin/fill; handles `data-testid="agent-activity-line"` + per-op `agent-activity-op-<operation>`.
- UX-DR2: Web state rendering — running (spinner + present-progressive label), completed (static dot + past tense), failed (warning-family chip `--warning-bg`/`--warning-ink`, never `--danger`; failed label WRAPS rather than truncates — state word survives at every locale length, font scale and viewport width; narrow-viewport/enlarged-text cases are acceptance criteria), collapsed (not rendered); replaces the typing indicator from the first `agent_activity` frame; collapses at first `chunk`, never re-opens; post-chunk activity frames accepted-but-unrendered (iteration 1); serial dispatch invariant guarantees no overlapping same-name ambiguity.
- UX-DR3: Mobile activity line — same states/words; trailing in-flight row slot; use mobile `DsSpinner` (supersedes raw `CircularProgressIndicator`); failed state = `tokens.warning` label + marker (no fill, mobile has no warning-bg pair); `ValueKey('agent-activity-line')` / `('agent-activity-op-<operation>')`.
- UX-DR4: i18n — namespace `chatbot.agentActivity.*` (11 keys: working, stepCompleted, stepFailed, verificationUnavailable, verificationScopeSource, per-operation running/completed/failed for search_knowledge and read_source) delivered in ALL 14 web locale files (hard gate `localeConsistency.test.js`) and ALL 14 mobile dart locale files (review-enforced); templates localized client-side keyed by the server's operation name; raw operation ids never shown; server never sends localized strings.
- UX-DR5: Accessibility — line container `role="status"` + `aria-live="polite"` (web) / `Semantics(liveRegion: true)` (mobile); marker decorative (`aria-hidden` / `ExcludeSemantics`); state carried by the word, never colour-only; `prefers-reduced-motion: reduce` stops the spinner (static ring idiom, scoped to the line — DsSpinner not modified globally); no focus, no pointer events, not interactive.
- UX-DR6: `agent_verdict` truth table — `grounded`: no warning; `ungrounded`: the existing ungrounded-answer warning (`.answer-warning`); `unverified`: a distinct neutral note (`chatbot.agentActivity.verificationUnavailable`) that never reuses the ungrounded warning's claim. **Translated answers:** when a translation was delivered, the grounded case shows a quiet scope caption (key `chatbot.agentActivity.verificationScopeSource`, e.g. "Verification applies to the original response.") near the sources — the answer is NOT presented as unverified (its source text WAS verified), and the caption is absent when no translation occurred; persisted/restored conversations reproduce the same state in both streaming modes. The line itself renders none of these (answer-surface concerns); answer errors keep the existing `.answer-error` + Retry surface; persisted and restored conversations carry the tri-state.
- UX-DR7: Cancellation/error UX — the line collapses immediately on abort/error frames; interrupted turns show the existing error surface with Retry (no frozen line).
- UX-DR8: No activity persistence — nothing about the line enters the transcript or replays on conversation restore.

### Verification & Gate Requirements

Ordering and blocking rules carried from the PRD — the epic/story map must schedule their production and approval at the right stage:

- **V02** (record OPEA query-path semantics incl. preparation pipeline) — before S3 design; feeds AR-4/AR-5.
- **V03** (record deployed versions, image digests, models, configurations, topology; reconcile with source baseline) — before the representative baseline measurement (E01 reference); **no code dependency — runs as an early parallel track from Epic 1**.
- **V04** (map effective authorization, provenance and ownership across existing services) — before contract acceptance; a divergence reopens AD-3/AD-4.
- **V05** (inventory actual API/SSE/error contracts and regression coverage) — before the S3 compatibility gate; a discrepancy reopens AD-8.
- **V06 + V07a** (runtime integration test; pre-adoption license verification per exact package version) — before D03 adoption at S4 entry; D03 must not close on compat research past its 2026-12-01 re-check without a refresh.
- **V07b** (full license/redistribution assessment incl. transitive/optional deps, notices, disclosures) — before pilot/release using the artifacts.
- **V08** (routing rollback rehearsals, incl. the BFF-timeout/orchestrator-deadline pair) — before each stage rollout.
- **V09** (executable CI/integration coverage and runner availability; identify checks needing a separate environment) — before release-gate acceptance.
- **Threshold rule:** numerical thresholds (budgets, M-1..M-5 dimensions) are agreed AFTER reference measurement and BEFORE candidate assessment; absence of agreed thresholds BLOCKS promotion to the corresponding release stage — never hidden behind defaults.
- **Counter-metrics (traceable evaluation inputs):** CM-1 cost/latency per agentic request vs reference; CM-2 excessive-abstention rate; CM-3 rate of executions hitting limits or cancellation.
- **Stage exit gates:** S3 exit = contract, authorization and compatibility checks pass (V02/V04/V05 evidence recorded); S4 exit = E01 no-unacceptable-regression on every measured dimension + E02 agentic gains within accepted limits + bounded execution and rollback demonstrated (V06/V08).

### FR Coverage Map

FR-1: Epic 1 — contract semantics (input/result/provenance/error per operation)
FR-2: Epic 1 — trusted caller context; model args never widen access
FR-3: Epic 1 — stable source ids + provenance for citation resolution
FR-4: Epic 1 — per-operation cancellation/timeout/result-size limits
FR-5: Epic 1 — contract compatibility & versioning rules
FR-6: Epic 1 — first implementation OPEA-free
FR-7: Epic 1 — no OPEA-specific representations in agent-facing contracts
FR-8: Epic 1 — V02 recorded before contract acceptance
FR-9: Epic 2 — governed agent loop, approved operations only
FR-10: Epic 2 — grounded answer or explicit insufficiency; mechanical enforcement + release policy
FR-11: Epic 2 — bounded execution, everything counts, cancellation chain
FR-12: Epic 1 (executor enforcement) + Epic 2 (degraded-mode honesty at answer level)
FR-13: Epic 2 — citations through existing RAG components
FR-14: Epic 2 — client API/SSE/translation compatibility; versioned extensions
FR-15: Epic 1 (flag mechanism) + Epic 3 (operational activation capability) — deployment-level activation flag
FR-16: Epic 3 — rollback demonstrated per stage; rollout records with named operator
FR-17: Epic 2 — version trail for every execution (run-start handshake)
FR-18: Epic 2 — observability through existing stack
FR-19: Epic 2 (V07a gates D03) + Epic 4 (V07b pre-release)
FR-20: Epic 1 — OPEA-free enforced by CI from first delivered stage
FR-21: Epic 1 — no new OPEA coupling (same audit + stage-gate check)
FR-22: Epic 1 — "OPEA-free" claims scoped to validated surface
FR-23: Epic 4 — E01 (A/B) + E02 (B/C) protocol
FR-24: Epic 4 — eval-set versioning, composition, tuning/assessment separation
FR-25: Epic 4 — authorization + prompt-injection scenarios in the eval set
FR-26: Epic 4 — reference defects recorded, never silently required
FR-27: Epic 4 — separate reporting of M-1..M-5 + uncontrolled differences
FR-28: Epic 1 — retained-data ownership/access rules; between-turns tests
FR-29: Epic 1 (starts story 1, continues) — ADR discipline
FR-30: Epic 2 — activity line (started/completed/failed, versioned events, graceful degradation)
NFR-1: Epic 1 (no raw AQL, trusted-service authz) + Epic 2 (end-to-end provenance)
NFR-2: Epic 1 (service dependency defaults audit) + Epic 2 (runtime dependency audit, D03)
NFR-3: Epic 2 (admission, budgets) + Epic 3 (coexistence under flag) + Epic 4 (E02 resource measurement)
NFR-4: Epic 3 — rollback rehearsed, deployment-level activation
NFR-5: Epic 1 (V05 inventory) + Epic 2 (SSE regression coverage)
NFR-6: Epic 4 — V09 coverage incl. new CI surface
NFR-7: Epic 2 — runtime seam, replacement scope + swap cost per candidate

## Epic List

### Epic 1: OPEA-free document capability layer (S3)
Engineering and evaluation can search and read the knowledge base through a GENIE-owned, OPEA-free capability contract whose query-path behavior deliberately matches the current pipeline (V02-recorded), with authorization enforced by construction and every execution attributable. Includes the **activation-flag mechanism** (compose + routing seam, so the service is born switchable) and the **V03 baseline measurement as an early parallel track** (no code dependency — starts day one, feeds E4's reference).
**FRs covered:** FR-1..FR-8, FR-12 (executor), FR-20, FR-21, FR-22, FR-28, FR-29 · FR-15 (mechanism) · AR-1..AR-5, AR-2 gate, AR-11 skeleton · Gates: V02 (before design), V04 (contract acceptance), V05 (compatibility).

### Epic 2: Governed document-QA agent with visible work (S4a)
Users receive source-grounded agentic answers or explicit insufficiency — with a visible activity line (started/completed/failed per operation), honest tri-state verdicts, bounded execution, working cancellation, and full version attribution; the runtime (D03) closes at epic entry from V06+V07a.
**FRs covered:** FR-9..FR-14, FR-17, FR-18, FR-30, FR-12 (degraded honesty) · AR-6..AR-9, AR-15 · UX-DR1..UX-DR8 · Gate: D03 closure (V06+V07a, 2026-12-01 freshness).

### Epic 3: Safe activation and rollback (S4b)
Operators can enable the agentic path per deployment with one flag, see agentic conversations continue safely on the legacy path after rollback, and hold a rollout record naming the rollback trigger's responsible operator with rehearsal evidence. The flag MECHANISM is born in Epic 1 (service switchable from day one); this epic owns the operational choreography — shared routing helper coverage of both request paths, rollback scenario and rehearsals, rollout records.
**FRs covered:** FR-15 (operational capability), FR-16 · AR-10 · Gates: V08 rehearsals (incl. BFF-timeout/deadline pair), rollout records per stage.

### Epic 4: Evaluation and evidence
Engineering can prove — with versioned corpora, cases and configurations — that the OPEA-free path preserves required behavior (E01: A/B) and that the agent earns its cost within accepted limits (E02: B/C), with thresholds agreed post-baseline and counter-metrics visible. **Counter-metrics are first-class:** CM-1 (cost/latency delta), CM-2 (excessive-abstention rate), CM-3 (limit/cancellation hit rate) get a dedicated reporting story — the proof includes showing the agent did not game it. The E01 harness REUSES Epic 1's equivalence suite as its config-B driver (one evaluation runway, no second stack). V03 baseline measured in Epic 1's parallel track is this epic's reference input.
**FRs covered:** FR-23..FR-27, FR-19 (V07b), CM-1..CM-3 · Gates: threshold agreement rule, S3/S4 exit evidence, V09.

## Epic 1: OPEA-free document capability layer (S3)

Engineering and evaluation can search and read the knowledge base through a GENIE-owned, OPEA-free capability contract whose query-path behavior deliberately matches the current pipeline (V02-recorded), with authorization enforced by construction and every execution attributable. Includes the activation-flag mechanism and the V03 baseline as an early parallel track.

### Story 1.1: Record the OPEA query-path behavioral contract (V02)

As a GENIE engineer,
I want the current OPEA retriever/embedding query-path behavior recorded as a verifiable reference,
So that the OPEA-free implementation preserves it deliberately and E01 can prove equivalence against something.

**Acceptance Criteria:**

**Given** the deployed configuration (values from story 1.2 where available)
**When** the query path is exercised across the behavior catalog — dense retrieval (brute-force cosine default), BM25 (analyzer, deployed k values), RRF fusion, label-filter strategy, defense-in-depth post-filter, file_id enrichment, CAP-1 identity join (including tolerated absence), the **TEI reranking + evidence-selection stage** (rerank invocation, `RERANKING_STRATEGY` slice/threshold/knee/adaptive, `RERANKER_TOP_N`, thresholds, selected-passage order, reranker-down behavior), the query-instruction prefix as a **model-specific contract** (`get_query_instruction` per embedding model — including models with an intentionally absent prefix, e.g. bge-m3, and deployer overrides), and the preparation pipeline (language detection among all supported locales, any-source-language→English translation before embedding, history/input bounds, `query_translation_status`)
**Then** each behavior is documented with inputs, deployed parameter values, and expected outputs, as fixtures consumable by tests
**And** the preparation pipeline's failure classes are recorded **as deployed, separately**: translator unavailable, oversized input (the deployed `TranslationInputTooLongError` → explicit 422 `translation_input_too_long` with `abstained:true` — NOT an untranslated fallback), and translation-returning-blank — each with its distinct expected outcome
**And** at least three locales are covered including one non-Latin script, recording the detected language, the exact English string sent to the embedder, and the status field
**And** the record is linked as an ADR-evidenced artifact (FR-29 discipline starts here)

### Story 1.2: Baseline the deployed stack (V03)

As an evaluator,
I want the deployed versions, image digests, models, configurations and topology recorded and reconciled with the source baseline,
So that E01's reference is the system that actually serves traffic, not an assumption.

**Acceptance Criteria:**

**Given** the target deployment
**When** the baseline is recorded
**Then** image digests, model ids (embedding, reranker, LLM, translation), retrieval configuration values, and topology are captured
**And** discrepancies vs the source baseline are listed with dispositions
**And** the record is dated and re-runnable (no code dependency — starts day one, in parallel with all other stories)

### Story 1.3: Stand up `components/agent-service`, deployable and switchable

As a GENIE engineer,
I want the agent-service skeleton (FastAPI, internal-only) deployable through the standard compose shape with health, logs, traces, and replicas gated by the activation flag,
So that the capability layer has a home that ships dark and is born switchable.

**Acceptance Criteria:**

**Given** the repo's service conventions (pii-service precedent, compose standard block)
**When** the service is added
**Then** compose block carries cap_drop/no-new-privileges, the fluentd anchor, a healthcheck, no host port, and `replicas: ${AGENT_ENABLED:-0}`
**And** the CI triplet (build/scan/promote) plus lint/test jobs exist; the ansible `genieai_images` entry exists; config-validator coverage passes (env template documented, wired)
**And** every introduced dependency (FastAPI and its tree) passes the pre-adoption checklist BEFORE acceptance: V07a exact-version license verification + NFR-2 defaults audit (default telemetry, default cloud export) — NOASSERTION counts as unverified and blocks; the checklist is reusable by every later dependency-introducing story
**And** OTel traces are emitted when observability is enabled — the ported tracing module contains no `comps` imports (passes the repo's grep)
**And** with `AGENT_ENABLED=0` nothing about the agentic path is reachable

### Story 1.4: Enforce OPEA-free with a CI gate

As a GENIE engineer,
I want a CI gate that fails when agent-path packages import `comps` or reference OPEA build-time downloads,
So that FR-20 holds from the first delivered stage by machine, not memory.

**Acceptance Criteria:**

**Given** the config:validate suite's tree-walking gate precedents
**When** the OPEA-free gate runs
**Then** agent-path packages (agent-service now; the list is extensible) are scanned for `comps` imports and OPEA build-time downloads, and a violation fails the pipeline
**And** a deliberate violation on a scratch branch turns the gate red (verified once, documented)
**And** the gate's scope note records what it cannot see (the BFF's runtime call graph — covered by the E3 routing-helper test, not by grep)

### Story 1.5: Define the document capability contract (with V04 acceptance)

As the agent-runtime author,
I want a typed, versioned contract for `search_knowledge` and `read_source` — inputs, results, provenance, errors, per-operation limits and cancellation,
So that the loop and the port are built against one stable interface with acceptance evidence.

**Acceptance Criteria:**

**Given** FR-1..FR-5 and the spine's port conventions
**When** the contract module is defined
**Then** every operation declares typed input/result/provenance/error semantics; per-operation timeout, result-size and cancellation semantics; and the contract's compatibility/versioning rules (FR-5)
**And** the error taxonomy distinguishes authorization failure, insufficient evidence, degraded availability, and transient errors — none confusable with each other
**And** provenance uses the stable-id conventions (legacy `file_id`; OKF `concept_id`+`repo_id`+`bundle_version` with `source:'okf-concept'`)
**And** the V04 authorization/provenance/ownership map is reviewed at acceptance; any divergence from the AD-3 premise is recorded and reopens the AD — acceptance is explicit, not silent

### Story 1.6: Implement `search_knowledge` — OPEA-free, behavior frozen

As a GENIE engineer,
I want the search operation implemented in agent-service as a clean-slate port of the recorded query path,
So that retrieval works without OPEA and matches the V02-recorded behavior.

**Acceptance Criteria:**

**Given** the V02 record (story 1.1) and the contract (story 1.5)
**When** `search_knowledge` executes
**Then** dense retrieval, BM25, RRF fusion, label filtering and post-filtering, file_id enrichment, CAP-1 identity join AND the reranking/evidence-selection stage behave per the recorded semantics — selected evidence and order match the recorded reference for fixed candidates, including cutoff/empty-result and reranker-down cases, with the same env-exposed knobs
**And** the embedding request honors the recorded **model-specific instruction contract** (`get_query_instruction`), including the no-prefix models (bge-m3, MiniLM) and deployer overrides — asserted against the model contract, not a universal degradation claim
**And** the input contract requires prepared English queries; non-prepared input is rejected by contract
**And** per-behavior equivalence tests pass against the V02 fixtures for every catalog behavior
**And** no `comps`/OPEA import or download exists in the package (gate 1.4 green) and structure follows modern patterns (clean-slate per AD-10 — behavior frozen, structure free)

### Story 1.7: Implement `read_source` and the authorization executor

As a GENIE engineer,
I want read operations that resolve citations and enforce the per-request intersection model by construction,
So that nothing the model asks for can exceed what the user may see.

**Acceptance Criteria:**

**Given** a request carrying the trusted caller context (user id + authorized graph set) and the contract (story 1.5)
**When** `read_source` resolves a target
**Then** legacy `file_id` resolves via doc-repo and OKF concepts via the exact `okf_concepts_meta` join, and every resolved target is re-validated against the request's authorized set — legacy corpus mapping per AD-4
**And** authorization-resolution failure produces an error or insufficiency outcome — never a wider corpus (fail-closed; the legacy fail-open path is not replicated)
**And** caller-supplied graph/repo identifiers pass the charset guard or resolve server-side (repo_id→graph_name)
**And** cross-user and cross-session identifier attempts are rejected with tests; permission changes between turns invalidate retained evidence reuse (FR-28); the negative authorization matrix covers **search** results (restricted-graph content is not searchable), not only read targets
**And** degraded downstream availability reports insufficiency/degradation — never confident data
**And** the retained-data product decision (historical visibility of earlier answers after a source is revoked) is recorded with its save/revoke/restore acceptance scenario, using existing stores and authorities — no new governance layer

### Story 1.8: Implement the input-preparation module

As a GENIE engineer,
I want the query/history preparation pipeline (language detection, any-supported-locale→English translation, bounds, status) as a reusable module on the loop side,
So that retrieval always operates on the English the embedding space expects, identically for initial and refined queries.

**Acceptance Criteria:**

**Given** a conversation in any supported locale (tests include a non-Latin script)
**When** preparation runs
**Then** the language is detected, the query/history is translated to English via the vLLM translation endpoint as a budgeted auxiliary call with cancellation propagation, bounds are applied, and `query_translation_status` is recorded
**And** preparation failure classes behave per the V02 record's per-class outcomes — translator unavailable, oversized input (explicit 422 `translation_input_too_long` with abstention, as deployed — not an untranslated fallback), blank translation — each mutually consistent with the capability contract's error taxonomy; no single fallback is hardcoded across error classes
**And** the module serves refined mid-loop queries identically to the initial request, and configs B/C use it unchanged

### Story 1.9: Behavioral equivalence suite (E01 runway) and V05 inventory

As an evaluator,
I want the per-behavior equivalence suite plus the service-side no-agent mode (config B's full answer pipeline) and the inventory of the live client contracts,
So that equivalence is proven continuously and config B generates complete answers without agent involvement.

**Acceptance Criteria:**

**Given** the V02 fixtures (story 1.1) and the implemented port (stories 1.6–1.8)
**When** the equivalence suite runs
**Then** every catalog behavior is asserted against the recorded expectations
**And** the no-agent mode is implemented service-side: a single-pass call through preparation → retrieval → reranking → selection → **context/prompt construction → one fixed generation stage → checking/verdict/result assembly** (and controlled answer translation when the experiment includes it) — the complete fixed pipeline E01's config B needs, through the shared admission-lane primitive (implemented in this epic's foundation work; 2.3 later hardens it with agent budgets) — component fixtures alone do not produce a complete answer
**And** the V05 inventory documents the actual API/SSE/error contract surface with current regression coverage, listing gaps as pre-S3-exit work items
**And** the S3 exit checklist (contract + authorization + compatibility checks; V02/V04/V05 evidence recorded) is completable from this epic's artifacts

### Story 1.10: Attest the chart identity of the deployed baseline

As an evaluator,
I want the baseline capture to attest which chart the deployed release was rendered from — the chart version, the rendered chart content, and the commit of this repository that carries it,
So that the V03 record reconciles against the chart the deployment actually runs, not against a moving source ref.

**Acceptance Criteria:**

**Given** a deployed release whose chart this repository carries
**When** the baseline capture runs
**Then** the record states the attested chart version, the source it was rendered from, the commit locator of this repository that carries it, and whether the local chart tree is identical to the attested chart
**And** a local chart source that differs from the attested chart yields a per-difference list, every difference a row with a disposition — an undispositioned difference never passes
**And** a comparison that cannot be established (a source that is not a GitRepository, an attested chart with no template, or a commit this checkout does not know) is UNRESOLVED and fails the capture, never a silent pass
**And** the non-retrieval tiers the chart deploys (PII sidecar, OKF server, RAGAS judge) have their operator environment compared against the chart source like the retrieval tier's

## Epic 2: Governed document-QA agent with visible work (S4a)

Users receive source-grounded agentic answers or explicit insufficiency — with a visible activity line (started/completed/failed per operation), honest tri-state verdicts, bounded execution, working cancellation, and full version attribution; the runtime (D03) closes at epic entry from V06+V07a.

### Story 2.1: Runtime seam and bounded decision probe

As the runtime decision owner,
I want the agent seam (registered toolset, internal envelope, event vocabulary, budget/cancellation hooks) plus a bounded smoke probe of the provisional candidate,
So that D03 closes on evidence from a working seam, whichever runtime wins — and the plan stays coherent if it is not the custom loop.

**Acceptance Criteria:**

**Given** the capability contract (story 1.5)
**When** the seam is implemented
**Then** tools are registered server-side only (the registry is the authorization surface — nothing unregistered is callable), the internal envelope is `{run_id, call_id, seq, kind, payload}` owned by `agent/`, and the event vocabulary is AG-UI-shaped and owned by the seam — the loop never emits BFF frame names
**And** a bounded probe (smoke, not production implementation) exercises the provisional candidate on the seam — small toolset, one multi-hop question — producing comparable evidence for V06/D03
**And** the probe is explicitly pre-decision evidence: if D03 selects pydantic-ai or DSH, the production implementation follows the SELECTED runtime on the same seam — no obligation to ship a production custom loop or a second engine
**And** budget and cancellation hooks are honored: a cancelled run stops dispatching and cancels the in-flight model call

### Story 2.2: V06 runtime verification and D03 closure

As the runtime decision owner,
I want the selected runtime verified against GENIE's model endpoint (tool-calling matrix, isolation, default-telemetry posture, cancellation, telemetry) with pre-adoption license checks,
So that D03 closes on current evidence, not stale research.

**Acceptance Criteria:**

**Given** the deployed vLLM version (V03 baseline) and the 2.1 probe evidence
**When** V06 runs
**Then** the version × model × parser × tool-choice-mode × schema-strictness × streaming compatibility matrix is validated against the deployed combination (REC-6 prerequisites pinned)
**And** cancellation and client-disconnect propagation to the model call are demonstrated at runtime level (full request-path integration is gated separately in 2.3/2.4 — the phases are explicit)
**And** V07a license verification passes for the exact package versions of every adopted dependency; developer-preview status (if applicable) carries an explicit operational-risk acceptance; default telemetry/cloud-export posture is audited (NFR-2)
**And** the D03 decision is recorded as an ADR citing V06+V07a evidence; it does not close on compat research past its 2026-12-01 re-check without a refresh; every candidate carries documented replacement scope and estimated swap cost (NFR-7)
**And** the SELECTED runtime's production implementation is owned by story 2.5's integration slice (assembling the loop implementation on this seam through 2.3/2.4) — Epic 2's "D03 closes at epic entry" means closure happens inside this epic's opening stories (2.1 probe → 2.2 decision), not before the epic starts

### Story 2.3: Request orchestrator — budgets, admission, cancellation

As a GENIE engineer,
I want the per-request orchestrator owning the agent-phase sub-budget and the fleet admission lane,
So that no run escapes its bounds and shared model services are protected.

**Acceptance Criteria:**

**Given** a request with its communicated agent-phase deadline
**When** the orchestrator runs
**Then** step cap, wall-clock, token budget, call count and evidence volume are enforced with everything counted (retries, tool calls, auxiliary calls incl. judge/classification/preparation-translation)
**And** admission uses the flock slot pool with the one-replica deployment contract — saturation yields a defined 429/admission behavior, and the no-agent mode passes through the same lane
**And** the BFF's upstream timeout on the agent leg is configured ≥ the agent-phase deadline plus margin (pair documented for V08)
**And** the run's resource counters (tokens, calls) are shared state between agent and BFF: translation checks the remaining token/call allowance before starting, bounds each request to the remaining allowance, and falls back conservatively (skip translation with the recorded status, never exceed) when usage is unavailable — the deadline/cancellation ownership unchanged
**And** cancellation from the BFF aborts the run and releases slots; a run that hits a budget ends with an honest terminal state, never a fabricated answer

### Story 2.4: BFF frame writer and disconnect detection

As a GENIE engineer,
I want the BFF parsing the agent's seam stream and writing every client frame, with real client-disconnect detection,
So that the client contract is owned in one place and cancellation actually propagates.

**Acceptance Criteria:**

**Given** the agent-service seam stream
**When** the BFF proxies an agentic request
**Then** it writes every client frame itself — chunk relay, `agent_activity`, `agent_verdict`, metadata (+ version-record persistence), translation injection, `done`/`error` — with the five existing types and terminal order preserved verbatim
**And** client disconnect is detected on the stream (replacing the dead `req.on('close')` path), aborting the upstream call and cancelling in-flight work
**And** the shared routing helper (guarded in E3's 3.1) is the only way either agentic endpoint is exposed — the BFF integration and the guarded seam land together
**And** the `queries` doc is minted per turn with the same shape as the legacy path (queryId continuity for persistence, analytics, saved conversations)

### Story 2.4b: Non-streaming integration (JSON path)

As an end user or integrator,
I want the non-streaming `POST /api/queries` path to return the versioned-compatible JSON result when routed to the agent,
So that both request modes carry full compatibility, not just SSE.

**Acceptance Criteria:**

**Given** an agentic-routed non-streaming request
**When** the BFF consumes the agent's result
**Then** the JSON response carries the existing field shapes: response text, metadata (`source_documents` incl. the `okf-concept` variant, `grounding_status` + legacy `is_grounded`), queryId — with citations, translation (per mode) and persistence behaving as the streaming path
**And** insufficient-evidence cases return the **success contract with an insufficiency outcome** (never an HTTP error — insufficiency is a successful answer type; V05-derived shape), while genuine failures (upstream errors, authorization failures, timeouts) return the existing JSON error contract — the two are separate acceptance cases, never merged
**And** end-to-end tests cover success, insufficiency and error cases through the real endpoint

### Story 2.5: The governed answer path (integration slice)

As an end user,
I want the agent to answer from evidence or say it cannot,
So that I never receive confident invention.

**Integration slice — assembles the deliverables of 2.1/2.3/2.6/2.10 and the capability layer into the complete user flow; it owns the end-to-end acceptance evidence, not a second implementation of the loop or verifier. It CONSUMES 2.6 and 2.10 — they precede it (numbering is identity, not execution order).**

**Acceptance Criteria:**

**Given** a question and the registered toolset
**When** the full flow runs
**Then** it returns either a source-grounded answer with traceable citations (rendered through the existing RAG citation components, FR-13) or an explicit insufficient-evidence response
**And** retrieved content is data, never instructions — hostile instructions embedded in documents or tool outputs are not followed (AD-13), and an injection attempt is a recorded finding
**And** degraded retrieval (partial availability, fallback strategy) reports insufficiency, never a confident answer (FR-12)
**And** multilingual behavior carries over: preparation (story 1.8) for retrieval, BFF answer translation for display — asserted end-to-end in this story

### Story 2.6: Citation verification pipeline and tri-state verdict

As an end user,
I want every citation mechanically checked and the answer's grounding honestly judged,
So that what I read is verified, and when verification fails I am told.

**Acceptance Criteria:**

**Given** a drafted answer with citations
**When** verification runs
**Then** reference validity is checked inline per citation against the actually-retrieved stable source ids (mechanical, no LLM, always on — no policy disables it)
**And** the grounding judge runs at finalize within the budget; its absence/timeout yields `unverified`, never `grounded`
**And** the verdict is tri-state `grounded|ungrounded|unverified`: `agent_verdict` is emitted after the last chunk and before metadata; the metadata frame carries `grounding_status` and the derived legacy `is_grounded` (true iff grounded); verdict scope is the source-language text, with the translation mode recorded so a translated answer never inherits the claim
**And** under `verdict-marked` (iteration-1 policy), a failed verdict produces the correction event and persisted marking — never silence
**And** auxiliary calls (judge, classification, translation) emit no `agent_activity` event

### Story 2.7: Activity line — web

As an end user on the web chat,
I want a quiet status line showing what the agent is doing while it works,
So that the wait is legible and failures are visible.

**Acceptance Criteria:**

**Given** the UX design contract (DESIGN.md + EXPERIENCE.md)
**When** `agent_activity` frames arrive before the first chunk
**Then** the line renders as the first child of `.answer-card` (with `.message-bubble`'s `v-else` converted to an explicit `v-if`), replacing the typing indicator, with states running/completed/failed per the spec — failed uses the warning family (never `--danger`) and the failed label wraps rather than truncates
**And** the line collapses at the first `chunk` and never re-opens; post-chunk activity frames are accepted but unrendered
**And** `agent_verdict` renders per the truth table: `grounded` → no warning (with the translation-scope caption when a translation was delivered); `ungrounded` → the existing ungrounded warning; `unverified` → the distinct neutral note (`chatbot.agentActivity.verificationUnavailable`)
**And** all 11 `chatbot.agentActivity.*` keys ship in all 14 locale files (the `localeConsistency` gate enforces it)
**And** accessibility holds: `role="status"` + `aria-live="polite"`, decorative marker, state carried by the word, reduced-motion respected (scoped to the line)
**And** handles follow the spec (`data-testid="agent-activity-line"`, per-op rows); the line is non-interactive and persists nothing

### Story 2.8: Activity line — mobile

As an end user on the mobile app,
I want the same status line with the same words and states,
So that the experience is identical across surfaces.

**Acceptance Criteria:**

**Given** the same event stream and UX contract
**When** `agent_activity` frames arrive
**Then** the mobile line renders in the trailing in-flight slot with the same states, labels and truth-table behavior as web, using the mobile design-system tokens (`DsSpinner` — superseding the raw `CircularProgressIndicator` — and the warning family)
**And** all 11 keys ship in all 14 dart locale files (review-enforced; missing keys would fall back to English silently — the delivery checklist asserts the full set)
**And** `ValueKey('agent-activity-line')` and per-op keys mirror the web handles; `Semantics(liveRegion: true)` and `MediaQuery.disableAnimationsOf` honor the a11y floor
**And** the verdict truth table and translated-grounded caption render identically to web, including on restored conversations

### Story 2.9: SSE contract regression coverage

As a GENIE engineer,
I want the extended SSE envelope covered by the local e2e run,
So that the five existing event types and the two new ones stay pinned.

**Acceptance Criteria:**

**Given** the single-sourced envelope (`tests/e2e/helpers/stream-route.js`)
**When** the new event types are added
**Then** `agent_activity` and `agent_verdict` extend the envelope; specs assert rendered behavior (line appears/disappears, warning paths) through declared handles only
**And** the specs are pinned into the local run set (execution-set pin), and the legacy five-type behavior stays green
**And** clients ignoring the new types behave exactly as today (graceful-degradation spec)

### Story 2.10: Answer translation on the agentic path

As an end user,
I want answers in my language with the same compatibility as today,
So that enabling the agent changes nothing about multilingual behavior.

**Acceptance Criteria:**

**Given** the agentic path with a non-English UI locale
**When** answer translation runs
**Then** it executes in the BFF against the vLLM GPU backend — the OPEA translation image is never invoked (config check + e2e spec enforce it), selected by the routing decision
**And** translation runs on the residual budget under the BFF's end-to-end deadline: no call starts beyond the remaining deadline; disconnect cancels the downstream call; usage is returned or estimated (the backend is extended/wrapped — its string-only response and private timeout do not survive unchanged) and lands in the execution record
**And** both modes keep their semantics: translated units as `chunk` frames when streaming translation is on; `done.translationFailed` preserved; the translated answer never inherits the source-text verdict silently (scope caption per story 2.7)

### Story 2.11: Execution attribution and observability

As an operator,
I want every agentic execution attributable and observable through the existing stack,
So that I can investigate any run, including the failed ones.

**Acceptance Criteria:**

**Given** any admitted run
**When** it starts
**Then** the run-start version handshake persists implementation/model/prompt/configuration versions into the `queries` doc at start; the terminal outcome updates it at end
**And** a cancelled, timed-out or crashed run keeps its versions and an honest terminal/interrupted state (cancel-before-first-token, timeout-during-judge and kill-before-final-metadata are tested)
**And** pipeline stages emit OTel spans with W3C traceparent propagation through BFF → agent-service → model services; logs reach VictoriaLogs via the fluentd anchor; the existing dashboards show the agentic path without a dedicated admin UI (FR-18)
**And** records carry no credentials or unnecessary sensitive content

## Epic 3: Safe activation and rollback (S4b)

Operators can enable the agentic path per deployment with one flag, see agentic conversations continue safely on the legacy path after rollback, and hold a rollout record naming the rollback trigger's responsible operator with rehearsal evidence. The flag mechanism is born in Epic 1; this epic owns the operational choreography.

### Story 3.1: One flag, both paths, provably

As an operator,
I want a single activation flag that routes both request paths through one shared helper,
So that a deployment can never be half-agentic.

**Acceptance Criteria:**

**Given** the routing seam (`initStreamQuery` for `/stream`, `createQuery` for the non-stream path — genuinely separate code)
**When** the flag switches
**Then** both paths branch through one shared routing helper, with a test asserting the two entries cannot disagree
**And** the agentic branch never targets the chatqna/OPEA URL (the AD-1 BFF-leg test — grep cannot see this)
**And** with the flag off, every request behaves exactly as today (legacy path untouched, D02)

### Story 3.2: Rollback continuity

As an end user,
I want a conversation started on the agentic path to continue correctly after the operator rolls back,
So that rollbacks don't eat my history.

**Acceptance Criteria:**

**Given** an agentic conversation (queries docs, saved messages, citations) created while the flag was on
**When** the flag is turned off and the conversation continues on the legacy path
**Then** history renders, citations re-resolve (stable-id conventions incl. the `okf-concept` variant), and new turns answer via the legacy pipeline without data loss or corruption
**And** in-flight treatment is defined and tested: requests mid-stream at switch time complete or interrupt per the documented policy; partial responses already streamed are handled honestly
**And** no agent-specific state is required by the legacy path (session state was in-request, AD-12)

### Story 3.3: Rehearsed rollback and rollout record (V08)

As the responsible operator,
I want every stage rollout recorded and its rollback rehearsed,
So that "rollback is possible" is accountability, not hope.

**Acceptance Criteria:**

**Given** a delivered stage
**When** it rolls out
**Then** the rollout record names: selected consumers and capabilities, artifact/config versions, activation and rollback procedures, in-flight treatment, **rollback triggers with a named responsible operator**, and rehearsal evidence
**And** the V08 rehearsal covers routing rollback agentic↔legacy including the BFF-upstream-timeout/agent-deadline pair validation
**And** each stage-gate review explicitly checks FR-21: no new OPEA coupling was added that makes the deferred exit harder
**And** the rehearsal is re-run per stage; the record lives in the repo (canonical home, one record per stage)

## Epic 4: Evaluation and evidence

Engineering can prove — with versioned corpora, cases and configurations — that the OPEA-free path preserves required behavior (E01: A/B) and that the agent earns its cost within accepted limits (E02: B/C), with thresholds agreed post-baseline and counter-metrics visible.

### Story 4.1: Evaluation harness (one runway)

As an evaluator,
I want a versioned evaluation harness reusing Epic 1's equivalence runway,
So that A/B/C run on the same machinery with controlled inputs.

**Acceptance Criteria:**

**Given** the E1 equivalence suite as config-B driver
**When** the harness is built
**Then** every run versions its corpus, cases, configurations, models, prompts and evaluator instructions; tuning cases are kept separate from the assessment set (FR-24)
**And** the set composition is fixed and explicit: answerable and unanswerable questions, citation checks, representative languages (incl. non-Latin), restricted/public access scenarios, failure and cancellation cases
**And** configs A (legacy fixed RAG), B (the service-side no-agent mode from story 1.9 — the harness is its caller, not its implementer) and C (agent) are invokable with per-pair held-fixed conditions and recorded intentional differences (FR-23)
**And** reference measurement is A-only first: measure A alone, freeze thresholds, THEN run the gated B/C candidate assessments (partial order: A-only metrics exist before thresholds are signed and before the first gated B/C run); the existing `tests/rag-benchmarks` capture machinery is reused where suitable, with suitability/version checks — never blind reuse of an old baseline artifact

### Story 4.2: Authorization and injection scenario suite

As a security reviewer,
I want the evaluation set to attack the agent's permissions and its inputs,
So that trust is tested, not presumed.

**Acceptance Criteria:**

**Given** the eval harness
**When** authorization and injection scenarios run
**Then** no scenario discloses unauthorized content (restricted repos, cross-user ids, narrowed task scopes, between-turns permission changes) — passing is evidence for tested conditions, not proof of impossibility (FR-25)
**And** hostile instructions embedded in retrieved documents and tool outputs are exercised: the agent must not follow them, and each steering attempt counts as a finding regardless of outcome
**And** findings feed the report, not a silent pass

### Story 4.3: E01 — behavior preservation (A vs B)

As the evaluator,
I want the OPEA-free fixed path compared to the legacy reference,
So that required behavior is demonstrably preserved.

**Acceptance Criteria:**

**Given** configs A and B on the V03-baselined deployment
**When** E01 runs
**Then** retrieval quality, answer grounding, abstention correctness, latency and resource consumption are reported separately (M-1..M-5), with uncontrolled differences identified (prompts, cache state, concurrency) (FR-27)
**And** known reference defects are recorded and never silently become requirements to reproduce (FR-26)
**And** the report is versioned and reproducible from the harness

### Story 4.4: Thresholds and counter-metrics

As the gate owner,
I want post-baseline thresholds agreed and the counter-metrics reported,
So that promotion decisions are explicit and gaming is visible.

**Acceptance Criteria:**

**Given** the baseline measurements
**When** thresholds are agreed (before candidate assessment)
**Then** every measured dimension has an agreed threshold or an explicitly recorded absence — and absence blocks promotion rather than defaulting (PRD §8 rule)
**And** CM-1 (cost/latency per agentic request vs reference — the delta visible, not averaged away), CM-2 (excessive-abstention rate on questions the reference answers correctly) and CM-3 (rate of executions hitting limits/cancellation) are reported as first-class results
**And** the E01/E02 gate sign-off owner is recorded (PRD OQ-5)

### Story 4.5: E02 — the agent's case (B vs C)

As the evaluator,
I want the agent compared to the fixed pipeline on identical capabilities,
So that the agentic delta is attributable to the agent.

**Acceptance Criteria:**

**Given** configs B and C sharing retrieval backend, preparation and admission policy
**When** E02 runs
**Then** gains (multi-hop and ambiguous queries) and costs are reported per dimension with thresholds applied; resource consumption under concurrent load is measured (NFR-3)
**And** **legacy non-regression under agent load is a tested criterion, not a report line**: a controlled legacy-only vs legacy-with-agent-load comparison runs with the agreed legacy latency/error/availability limits and the defined saturation/admission response — a resource report that hides slowed/failing legacy responses fails this acceptance
**And** the verdict is honest: agentic benefits remain hypotheses until measured on GENIE's corpora and query mix (PRD §4.1 note); a negative result is recorded, not massaged
**And** the S4 exit evidence bundle (E01 + E02 + bounded execution + rollback demo + coexistence criterion) is assemblable from this epic's artifacts

### Story 4.6: Release-readiness evidence (V09 + V07b)

As the release gate owner,
I want executable CI/integration coverage confirmed and the full license assessment done,
So that release gates rest on available evidence.

**Acceptance Criteria:**

**Given** the delivered artifacts
**When** V09 runs
**Then** executable coverage and runner availability are confirmed, with checks needing a separate environment identified — including the new CI surface (agent pytest suite, OPEA-free gate, e2e pins) (NFR-6)
**And** V07b completes the full license and redistribution assessment (transitive/optional dependencies, images, binaries, models; notices preserved; disclosures updated) before any pilot/release use (FR-19)
**And** gaps between gates and available evidence are surfaced as blockers, never absorbed silently

### Covers / Depends on / Evidence summary

(Traceability strip — FR-29. Dependencies are upstream-only within each epic.)

| Story | Covers (key reqs) | Depends on | Evidence class |
|---|---|---|---|
| 1.1 V02 record | FR-8, AR-4 | — | reference fixtures |
| 1.2 V03 baseline | V03 | — (parallel track) | ops inventory |
| 1.3 service skeleton | AR-1, FR-15 mech | — | deployable service + V07a checklist |
| 1.4 OPEA-free gate | FR-20..22 | 1.3 (scan target) | CI gate red-test |
| 1.5 contract | FR-1..5, 7 | 1.1, V04 review | typed API + V04 acceptance |
| 1.6 search port | FR-6, AR-5 | 1.1, 1.5 | equivalence fixtures |
| 1.7 read + authz | FR-2, 12, 28 | 1.5, 1.6 | negative matrix + policy record |
| 1.8 preparation | AR-4 (EP-01) | 1.1, 1.5 | per-class failure outcomes |
| 1.9 equivalence + no-agent B | FR-23 (B), AR-10 lane | 1.6..1.8 | suite + full-answer mode |
| 2.1 seam + probe | FR-9, AR-6 | Epic 1 | probe evidence (pre-D03) |
| 2.2 V06 + D03 | FR-19a, NFR-2, D03 | 2.1, V03 | matrix + ADR |
| 2.3 orchestrator | FR-11, AR-7 | 2.2 | budget/admission tests |
| 2.4 BFF frame writer | AR-9, FR-14 | 2.2, 3.1 helper | frame tests |
| 2.4b non-streaming | FR-14 (JSON) | 2.4 | e2e JSON contract |
| 2.5 answer path (slice) | FR-9..13, AD-13 | 2.1..2.4b, **2.6, 2.10**, Epic 1 | end-to-end acceptance |
| 2.6 citations tri-state | FR-10, AR-8 | 2.1 seam + drafted-answer contract, 1.5 | verdict tests (built against the seam contract, before the slice) |
| 2.7 web line | FR-30, UX-DR1/2/4..7 | 2.4, 2.6 | rendered behavior specs |
| 2.8 mobile line | FR-30, UX-DR3..7 | 2.4, 2.6 | widget tests |
| 2.9 SSE regression | FR-14/30, NFR-5 | 2.4, 2.7 | pinned e2e set |
| 2.10 translation | FR-14, AR-14 | 2.3 counters, 2.4 | residual-budget tests |
| 2.11 attribution | FR-17, 18, AR-11 | 2.3 | handshake + crash tests |
| (admission-lane primitive) | AR-10 lane | — implemented in E1 foundation work (with 1.9's no-agent mode); 2.3 hardens it with agent budgets | shared primitive, no cross-epic cycle |
| 3.1 one flag both paths | FR-15, AR-10 | 1.3 | routing-disagreement test |
| 3.2 rollback continuity | FR-16 | 3.1, Epic 2 | continuation scenario |
| 3.3 V08 rehearsals | FR-16, NFR-4 | 3.2 | rollout records |
| 4.1 harness | FR-23/24 | 1.9 | versioned runs |
| 4.2 authz+injection | FR-25 | 4.1 | scenario findings |
| 4.3 E01 A/B | FR-26/27, M-1..5 | 1.2, 4.1, V05, **4.4 threshold approval (gated assessment)** | comparison report |
| 4.4 thresholds+CM | §8 rule, CM-1..3 | **4.1's A-only reference measurements** (artifact-level input — 4.3 is NOT a prerequisite) | signed thresholds |
| 4.5 E02 B/C + coexistence | FR-23, NFR-3 | 4.4, Epic 2 | gated report |
| 4.6 V09+V07b | FR-19b, NFR-6 | prior epics | evidence bundle |
