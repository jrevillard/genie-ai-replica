# ADR agentic-002: The first agent runtime (D03) — the custom minimal loop on the seam

- **Status**: Proposed
- **Date**: 2026-11-21
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: D03 (first agent runtime), spine AD-5 (runtime seam), NFR-7
  (reversibility / replacement costs), NFR-2 (defaults-gated sovereignty),
  FR-19 (V07a pre-adoption tier)
- **Stories**: [#1959](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1959)
  — story 2.2 (V06 runtime verification and D03 closure); builds on story
  2.1's seam and probe (PRD `agentic-foundations`)

## FR-29 traceability

```
use case (the governed document-QA agent needs a loop that drives the model,
  the registered tools and the budgets — and the choice must not couple the
  port, the SSE dialect or the swap cost to any one framework)
  -> requirement (D03: the first agent runtime, decided at S4 entry from V06 + V07a;
     never on research evidence older than the 2026-12-01 re-check)
    -> decision (this record: the custom minimal tool-calling loop is the iteration-1
       runtime, behind the agent/ seam; production implementation owned by story 2.5)
      -> investigation (S1 research screen + amendments; story 2.1's GENIE implementation;
         V06 live verification; V07a gate)
        -> merge request (the story 2.2 MR)
          -> validation evidence (V06 record: runtime-level cancellation demonstrated live;
             the compatibility matrix and its REC-6 finding; the V07a gate exit 0)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

The S1 research (2026-11-16) screened five candidates and named the custom
minimal tool-calling loop the provisional pick (57.5), pydantic-ai the
runner-up (52.0) and DeepSeek Harness (DSH) last provisionally — with the
explicit caveat (AM-2) that no ranking was settled evidence until a GENIE
implementation existed and the live verification ran. Story 2.1 delivered
that implementation: the runtime seam (envelope `{run_id, call_id, seq,
kind, payload}`, registry, budgets, cancellation), the provisional loop and
the bounded probe. Story 2.2 ran V06 against the deployed combination and
the V07a gate over the shipped pins.

The V06 evidence (`docs/baselines/v06-runtime-verification-2026-11-21.md`):

- **Live runtime-level cancellation passes.** A streaming completion
  cancelled mid-flight raised CancelledError and was observed aborting —
  the stream's own teardown flag, not the cancellation signal — with no
  completion delivered; a loop-level run cancelled during a live,
  dispatch-proven model POST propagated CancelledError, cancelled the
  in-flight call and emitted NO terminal event — the seam's honesty
  contract holds against the real endpoint.
- **The deployed server has NO tool-calling enabled.** All 12 matrix cells
  (tool-choice mode × schema strictness × streaming) failed with the
  server's own 400: `--enable-auto-tool-choice` and `--tool-call-parser`
  are not set on the serving config. The REC-6 prerequisites for
  granite-4.1-8b on vLLM 0.29.0 are pinned in the V06 record
  (`--tool-call-parser granite4` per the vLLM v0.29.0 tool-calling docs),
  the operations-side remediation is tracked as issue
  [#2052](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2052), and
  the harness is the acceptance re-run after that pin.
- **The probe fails at the model leg on the same rejection** — honest
  evidence, same root cause, not a loop defect.
- **V07a passes**: 47 exact pins verified with defaults verdicts; exit 0.

### Constraints

- Client compatibility non-negotiable (AD-8): the runtime never writes a
  client frame and never renames the seam vocabulary.
- Bounded execution is owned by the request orchestrator (AD-6); the runtime
  must stay replaceable behind the seam's hooks (AD-5).
- No dependency adoption without V07a (FR-19); developer-preview status
  requires explicit operational-risk acceptance (NFR-2).
- The D03 decision must not close on research evidence older than its
  2026-12-01 re-check (PRD §13-7, §10 D03 row).

## Decision

**The custom minimal tool-calling loop is the iteration-1 runtime for SC-01,
behind the `agent/` seam. Its production implementation is owned by story
2.5's integration slice**, which assembles the governed answer path on this
seam through 2.3/2.4 — the loop 2.1 delivered is the skeleton that slice
completes, not throwaway probe code and not yet the production loop.

Four findings close D03 on live evidence rather than research alone:

1. **The GENIE implementation exists and behaves.** AM-2's "provisional,
   unimplemented" caveat is discharged: the seam, the loop, the registry,
   the budgets and the cancellation primitives are suite-green and the
   cancellation behavior is demonstrated against the live endpoint (V06) —
   the property no research substitute measures.
2. **The tool-calling gap is a server prerequisite, not a runtime
   differentiator — yet.** Every candidate (custom loop, pydantic-ai, a DSH
   subprocess) drives the same endpoint and needs the same serving flags;
   the 400s say nothing that discriminates between them. The matrix's
   real subject — how the deployed parser handles each tool-choice mode,
   schema strictness and tool-delta streaming — is UNOBSERVED until the
   flags are pinned. This is the decision's named residual risk: the
   custom loop is accepted now on the strength of the seam's replaceability,
   and **the matrix re-run after the parser pin (issue
   [#2052](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2052)) is a
   binding acceptance step of story 2.5**, before the agentic path serves a
   real request. A re-run that shows the parser mishandling the loop's
   payloads reopens this ADR, not just a ticket.
3. **V07a is satisfied for the exact shipped versions** — the selected
   runtime adopts nothing beyond the audited 47-pin tree; no new dependency
   gates behind this decision, and the NFR-2 defaults audit holds
   (`telemetry: none`, `cloud_export: none` on every shipped package).
4. **The reversibility hedge is structural, not aspirational.** The seam
   owns the vocabulary, the registry is the authorization surface, the
   budgets and cancellation are loop-external hooks — the documented
   replacement scope below is engineering, not re-architecture.

### The 2026-12-01 freshness gate

The research's compat/version-class claims (pydantic-ai 2.68.0's surface,
vLLM parser/strict behavior, the DSH pi-ai adapter mechanism) carry a
re-check date of **2026-12-01**. This decision does not exempt itself: any
use of the fallback path below, any reopened candidate comparison, and any
reliance on the research's version-specific claims past that date requires
the refresh first (`bmad-deep-recon` on the research folder re-checks
exactly those claims). The decision as recorded stands on the live V06
evidence and the shipped implementation, which do not expire — but the
fallback's ≤1-day estimate is a research-era hypothesis and must be
re-validated against the then-current pydantic-ai before it is relied on.

### Replacement scope and estimated swap cost (NFR-7)

| Candidate | Dependency boundary | Replacement scope if selected later | Estimated swap cost |
|---|---|---|---|
| pydantic-ai 2.68.0 (designated fallback) | Python-only; same host service; typed tools; `UsageLimits`; plain OTel | Replace `AgentLoop` + `LoopModelClient` with pydantic-ai's agent/runner; adapt its native events to the seam envelope and kind vocabulary (the seam never renames); map `UsageLimits` onto `RunBudget`'s dimensions; keep the registry as the toolset it drives; the port, the BFF and every downstream consumer unchanged | **≤1 day — a hypothesis to measure, never a prescribed target** (the research's exit test: one swap-in spike on the probe). Re-validate against the then-current pydantic-ai after 2026-12-01 before relying on it |
| DeepSeek Harness (revisit trigger recorded) | TS workstation + Python SDK driving a JSON-RPC stdio subprocess | A subprocess lifecycle owner (spawn/health/teardown), the JSON-RPC bridge, event adaptation to the seam envelope, and the developer-preview operational-risk acceptance | Multi-day to weeks (subprocess isolation + bridge + event mapping), PLUS the unpriced risk of a developer-preview runtime with no security audit; revisit only when: stable non-preview release + security audit + completed subprocess-mode operational assessment |
| OpenAI Agents SDK / LangGraph | Not active candidates | — | Not estimated; a reopened comparison starts from a fresh screen (their posture and compat claims are the ones the 2026-12-01 gate names) |

## Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| Adopt pydantic-ai now as the runtime | **Rejected for iteration 1** | It wins nothing the loop does not already deliver for SC-01 (one governed loop over one port), and adopting it now adds a framework dependency ahead of a demonstrated need — against NFR-7's "no adoption for flexibility's sake". It stays the DESIGNATED FALLBACK with the swap scope above; the "typed framework or durable multi-step workflows" trigger (research §6) reopens it with evidence |
| Adopt DSH (operator's original investigation candidate) | **Rejected** | Developer preview, no security audit, zero evidenced customer-facing adoption; the AM-1 subprocess mechanism resolves the embeddability question but not the maturity one. Pattern value (ToolDefinition split) already borrowed into the registry design |
| Defer D03 until the parser flags are pinned and the matrix is green | **Rejected** | The matrix's discriminating power concerns the SERVER surface every candidate shares; the decision's own acceptance path (story 2.5's binding re-run) covers the residual risk without leaving Epic 2's integration stories blocked on an operations change |
| Build the production loop directly in 2.2 (skip 2.5 ownership) | **Rejected** | The frozen AC assigns the production implementation to 2.5's integration slice; 2.2 owns the decision and its evidence, and the phases (2.3 budgets/admission, 2.4 BFF frames) precede it |

## Consequences

- **Positive**: the runtime decision closes inside the epic's opening
  stories on live evidence, as the epic requires; the integration stories
  (2.3-2.5) build on a named runtime with a measured seam; the swap cost of
  the fallback is documented and structurally cheap; no new dependency or
  telemetry surface ships.
- **Negative**: the loop remains hand-maintained surface (budget hooks,
  event vocabulary) that a framework would have supplied; the tool-calling
  matrix evidence is INCOMPLETE until the serving flags are pinned — the
  decision accepts this with 2.5's binding re-run, and the agentic path must
  not serve real traffic before that re-run passes.
- **Reconsideration triggers**: the 2.5 matrix re-run fails on the deployed
  parser (candidate comparison reopens); the fallback is invoked and its
  ≤1-day hypothesis measures false; DSH meets its revisit trigger; a
  durable multi-step workflow requirement lands (the pydantic-ai trigger);
  the 2026-12-01 refresh contradicts a claim this record relies on.

## References

- V06 evidence: `docs/baselines/v06-runtime-verification-2026-11-21.md`
  (matrix, cancellation, probe, REC-6 prerequisite pin, latency slots).
- V07a evidence: `docs/dependencies/agent-service-dependency-evidence.json`
  (47 exact-version rows, defaults verdicts, risk acceptances); gate:
  `scripts/dependencies/verify-dependency-licenses.py`.
- S1 research + amendments: `_bmad-output/planning-artifacts/research/
  technical-opea-free-agentic-document-qa-architectu-2026-11-16/research.md`
  (candidate screen, REC-1/2/6/8, staleness map, 2026-12-01 gate).
- PRD addendum §D (the authoritative D03 candidate state); PRD §10 D03 row.
- The seam: `components/agent-service/agent/` (loop, cancellation, events,
  registry, budget); the probe: `components/agent-service/agent/probe.py`;
  the harness: `components/agent-service/agent/verification.py`.
- ADR agentic-001 (format precedent); spine AD-5 (the seam this decision
  keeps).
