# Epic 2 Context: Governed document-QA agent with visible work (S4a)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users receive source-grounded agentic answers or an explicit insufficiency — never confident invention. The epic builds the governed agent loop on the replaceable runtime seam, closes the runtime decision (D03) from live evidence early in the epic, enforces bounded execution with working cancellation, mechanically verifies citations with an honest tri-state verdict, and surfaces the agent's work through a visible activity line (web + mobile) with full version attribution — all while preserving the existing client API/SSE/translation contracts exactly.

## Stories

- Story 2.1: Runtime seam and bounded decision probe
- Story 2.2: V06 runtime verification and D03 closure
- Story 2.3: Request orchestrator — budgets, admission, cancellation
- Story 2.4: BFF frame writer and disconnect detection
- Story 2.4b: Non-streaming integration (JSON path)
- Story 2.5: The governed answer path (integration slice)
- Story 2.6: Citation verification pipeline and tri-state verdict
- Story 2.7: Activity line — web
- Story 2.8: Activity line — mobile
- Story 2.9: SSE contract regression coverage
- Story 2.10: Answer translation on the agentic path
- Story 2.11: Execution attribution and observability

## Requirements & Constraints

- **Grounded or insufficient, by mechanism.** Every answer carries traceable citations rendered through the existing RAG citation components, or an explicit insufficient-evidence response. Prompt-only citation instructions are rejected (research showed they worsen invention); enforcement is mechanical reference validity plus a judged grounding check. Degraded retrieval (partial availability, fallback) must report insufficiency — never a confident answer. Insufficiency is a successful answer type, not an HTTP error; genuine failures keep the existing error contract. The two are separate acceptance cases.
- **Bounded execution on every dimension.** Step cap, wall-clock, token budget, call count, evidence volume — with everything counted: retries, tool calls, and auxiliary model calls (grounding judge, classification, preparation translation). Cancellation propagates client disconnect → BFF abort → agent-service → in-flight model call. A run that hits a budget ends honestly, never with a fabricated answer.
- **Client compatibility is non-negotiable.** The five existing SSE event types and terminal order are preserved verbatim; exactly two new additive, versioned event types (`agent_activity`, `agent_verdict`) are allowed, and clients ignoring them behave exactly as today. Both streaming and non-streaming request paths carry full compatibility. Answer translation behaves as today in both modes.
- **Every execution attributable.** Implementation, model, prompt and configuration versions are recorded at run start and completed at end — including cancelled, timed-out and crashed runs. Observability flows through the existing OTel/VictoriaLogs/Grafana stack; no dedicated admin UI; no credentials or unnecessary sensitive content in records.
- **Licensing gate before runtime adoption.** Pre-adoption license verification for the exact package versions of every adopted dependency gates the D03 decision; an unread/NOASSERTION license counts as unverified, never as an incompatibility. Default telemetry/cloud-export posture audited; developer-preview status needs explicit operational-risk acceptance.
- **Tainted-data discipline.** Retrieved content is data, never instructions; hostile instructions embedded in documents or tool outputs are not followed, and an injection attempt is a recorded finding.

## Technical Decisions

- **Runtime seam (replaceable loop).** Whatever drives the loop plugs onto: server-registered tool definitions (the registry is the authorization surface — nothing unregistered is callable), an internal event stream shaped on the AG-UI taxonomy (pattern, not dependency), and budget/cancellation hooks. Internal envelope: `{run_id, call_id, seq, kind, payload}`, owned by the `agent/` module — runtimes never emit BFF frame names; a runtime swap adapts its events to the seam vocabulary, never renames it. pydantic-ai is the runner-up hypothesis (a swap-in spike is optional evidence).
- **Two-level budget ownership.** The BFF owns the true end-to-end request deadline; the agent orchestrator owns the agent-phase sub-budget (communicated in the request). Translation runs on the residual: no call starts beyond the remaining deadline; usage is returned or estimated (the existing translation backend's string-only response and private timeout do not survive unchanged). The BFF's upstream timeout on the agent leg must be ≥ the agent-phase deadline plus margin — the pair is documented for the V08 rehearsal.
- **Admission control.** Flock slot-pool idiom under the iteration-1 deployment contract: agent-service runs at exactly one replica (0 or 1), making the pool the global bound; multi-replica is deferred until a shared coordination mechanism exists. Every request mode passes through the same lane (including the no-agent mode). Document-tool calls dispatch serially (one in flight); auxiliary calls may overlap.
- **Citation pipeline.** Two checks: inline mechanical reference validity (no LLM, always on, cannot be disabled by policy) and a budgeted grounding judge at finalize (absence/timeout yields `unverified`, never `grounded`). Verdict is tri-state `grounded|ungrounded|unverified`; metadata carries `grounding_status` plus derived legacy `is_grounded` (true iff grounded). Iteration-1 release policy is `verdict-marked`: stream normally, correction event + persisted marking on failure — no policy value hides a failed verification. The verdict certifies the source-language text; a translated answer never silently inherits the claim.
- **BFF owns the SSE contract.** The BFF parses the seam stream and writes every client frame (chunk relay, translation injection, metadata + version-record persistence, done/error); agent-service never writes a client frame. Pinned positions: `agent_activity` interleaves with chunks; `agent_verdict` after the last chunk, before `metadata`; `done` always last. `metadata.source_documents` keeps its existing shape (including the `okf-concept` variant). Auxiliary model calls emit no `agent_activity` event.
- **Translation on the agentic path is BFF-executed against the vLLM GPU backend only** — the OPEA translation image is never invoked (enforced by backend selection keyed on routing, plus config check + e2e spec).
- **Version handshake.** Agent-service emits a run-start seam event with the execution-version record; the BFF persists it into the `queries` doc at start; the final metadata frame completes the record — so cancelled/crashed runs keep attribution.
- **Persistence unchanged.** The agentic path mints the `queries` doc per turn with the same shape as the legacy path (queryId continuity); no new stores; agent session state stays in-request.
- **UX contract (web + mobile).** Activity line per DESIGN.md/EXPERIENCE.md: states running/completed/failed (failed uses the warning family, never danger); collapses at first chunk, never re-opens; verdict truth table (grounded → no warning; ungrounded → existing warning; unverified → distinct neutral note; translated grounded → scope caption). All `chatbot.agentActivity.*` keys ship in all 14 web locale files (hard gate) and all 14 mobile dart locale files (review-enforced). Handles: `data-testid="agent-activity-line"` / `ValueKey('agent-activity-line')` plus per-op keys. A11y: `role="status"` + `aria-live="polite"` / `Semantics(liveRegion: true)`, reduced-motion respected, non-interactive, nothing persisted.

## Cross-Story Dependencies

- **Epic 1 inputs:** story 1.5's capability contract is the given for the 2.1 seam; story 1.8's preparation module is consumed by the answer path (2.5); story 1.3 stood up the agent-service; Epic 1's V05 inventory feeds 2.4/2.9 compatibility work; Epic 1 built the flag mechanism and routing seam that 2.4's guarded helper extends.
- **D03 closes inside the epic:** 2.1's probe produces the evidence; 2.2 records the decision as an ADR (V06 + V07a, with the 2026-12-01 freshness gate). The selected runtime's production implementation is owned by 2.5's integration slice — no obligation to keep the probe's candidate.
- **2.5 assembles, does not reimplement:** it consumes 2.6 (verification) and 2.10 (translation) plus 2.1/2.3 deliverables — those precede it (numbering is identity, not execution order); 2.5 owns the end-to-end acceptance evidence.
- **2.4 and Epic 3 story 3.1 share the routing helper:** the BFF integration and the guarded seam land together in 2.4; 3.1 proves both paths cannot disagree and owns the operational choreography (flag on/off, rollback).
- **2.9 pins the envelope for 2.7/2.8:** the single-sourced e2e envelope extends with the new event types; the web/mobile activity lines assert rendered behavior through declared handles only.
- **2.3 documents the BFF-timeout/deadline pair** consumed by Epic 3's V08 rollback rehearsal.
- **Epic 4 (evaluation)** runs E02 (fixed vs agent) against this epic's completed path; budget thresholds are agreed after baseline measurement, never defaulted.
