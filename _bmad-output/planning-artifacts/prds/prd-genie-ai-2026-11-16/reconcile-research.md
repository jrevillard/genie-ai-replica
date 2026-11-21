# Reconcile — S1 research vs PRD + addendum + extract (2026-11-16)

Source: `research/technical-opea-free-agentic-document-qa-architectu-2026-11-16/research.md`
(read in full, amendments AM-1..AM-6 treated as superseding the affected body
statements). Targets: `prd.md`, `addendum.md`, `research-extract.md` in this
folder. Product-level lens only: code-level flags, API names and benchmark
internals belong to the architecture doc and are out of scope here.

## 1. Verdict

**Substantially covered.** All eight research recommendations, the §5
sovereignty finding, the cancellation gap, the vLLM prerequisites and the
claim-ledger caveat are carried by PRD + addendum + extract, most of them
strengthened rather than merely transcribed (FR-10's reference-validity vs
grounding split, FR-11's counting semantics, NFR-2's defaults-not-capabilities
gate, NFR-7's demotion of the ≤1-day swap estimate to a hypothesis). Three
targeted gaps remain; none overturns a decision, but gap 1 is an internal
contradiction (the extract repeats a statement AM-1 explicitly supersedes) and
gap 2 removes the measurability of an already-declared success dimension.

Intentional postures confirmed as such, not gaps: D03 stays open with the
ranking provisional (AM-1/AM-2); numeric thresholds post-baseline (§8);
research REC-1's "in a new OPEA-free service" is deliberately re-opened as
placement decision D01 (reuse existing authorities, no second
authorization/governance layer — framing-driven, consistent with NFR-7);
wildcards (Agno, ADK, Mastra, Strands) correctly stay research-register
material, not PRD candidates.

## 2. Gaps

1. **DSH revisit trigger is stale in the extract and absent from the PRD.**
   Research AM-1 explicitly corrects the revisit trigger "embeddable server
   mode" (DSH *is* embeddable, as an SDK-driven JSON-RPC subprocess). Yet
   `research-extract.md` §5 still records, un-flagged: "Record DSH's revisit
   trigger: stable non-preview release + embeddable server mode + security
   audit" — the superseded trigger, contradicting the extract's own header rule
   and its §1 item 5. The PRD carries no revisit trigger at all (D03 requires
   the AM-1 operational assessment *before* settling the ranking, but records
   no condition for *revisiting* DSH afterwards; NFR-2 covers only the
   developer-preview risk acceptance).
   **Lands:** fix `research-extract.md` §5 (flag or rewrite the trigger per
   AM-1); record the corrected revisit condition — stable non-preview release
   + security audit + completed SDK-subprocess operational assessment — in
   `prd.md` D03 row (or `addendum.md` §D).

2. **Eval sets must contain unanswerable questions — dropped from FG-5.**
   REC-5's tail ("eval sets must contain unanswerable questions", research §3,
   [9]) and §5 PRD-ready conclusion both carry it; the research believed it was
   "already in the framing's E01/E02 protocol", but the PRD's own evaluation
   infrastructure (FR-23..FR-27) never states set composition for
   unanswerable cases. Without them the declared measured dimension "abstention
   correctness" (§8, FR-27) is unmeasurable, and the grounding/refusal path of
   FR-10 is never exercised by the protocol that must prove it.
   **Lands:** `prd.md` FR-25 (or FR-23) — one clause: the evaluation set
   includes unanswerable questions, and they are versioned like any other case
   (FR-24).

3. **AM-2's G4/G5 clause dropped — only the custom-loop clause reached the PRD.**
   AM-2 has two sentences: (a) D03 acceptance of the custom loop requires a
   GENIE implementation against FR-10..FR-12/NFR-7 — carried almost verbatim
   into the D03 row; (b) the candidate screen evaluated G4 (per-operation
   authorization) mainly as tool registration and G5 (SSE-contract
   compatibility) mainly as streaming availability, so **both gates need
   re-evaluation at application level, not mechanism level** — carried nowhere
   (addendum §D's AM summary omits it; extract §1 item 1 carries only the
   maturity half). This qualifies the evidence grade of the *entire* screen,
   all five candidates: a D03 decision could otherwise lean on mechanism-level
   gate passes. V04/V05/V06 exist as the vehicles, but nothing tells D03 that
   the screen's G4/G5 cells are not yet decision-grade.
   **Lands:** `prd.md` D03 row or `addendum.md` §D — one sentence; the
   application-level re-evaluation rides V04 (authz), V05 (contracts) and V06
   (integration).

Minor observation, below gap grade: the PRD §11 risk row ("vLLM tool-calling
is the operational minefield — parser family per model, …") keeps a pre-AM-4
flavor; under AM-4 the parser prerequisite scopes to *automatic* tool calling
(named/required work by default via structured outputs). The corrected scoping
lives in extract §4 and the row's own mitigation defers mechanism to the
architecture doc, so no PRD edit is required — but do not quote the risk row
as if parser pinning were unconditionally required.

## 3. Verified covered

| Research item | Where it landed | Note |
|---|---|---|
| REC-1 custom loop behind the contract | PRD D03 (screening pick, provisional per AM-2; acceptance requires GENIE implementation vs FR-10..FR-12); extract §1.1; addendum §D | "New OPEA-free service" re-opened as D01 — intentional framing-driven refinement, not a drop |
| REC-2 pydantic-ai runner-up + exit test | NFR-7 (runner-up and swap duration are hypotheses until placement evidence; ≤1-day estimate flagged as assuming same-Python placement, OQ-6); extract §1.2 | Strengthened: research stated the estimate, PRD demotes it |
| REC-3 bounded execution | FR-11 — step cap, wall-clock, per-run token budget, model/tool-call count, evidence volume, cancellation from client disconnect, tested; counting semantics defined (retries, parallel calls, auxiliary calls count) | Strengthened beyond research |
| REC-4 authz intersection model | FR-12 (+FR-2, FR-28 retained-data authorization, NFR-1); extract §2 | Full model incl. impersonation semantics and no-permissive-fallback |
| REC-5 citations | FR-10 — reference validity vs grounding split, mechanical verification over structured tool results, refusal path, release policy; "citation instructions made invention worse" carried verbatim; extract §2, §5 | Only the eval-set tail is a gap (gap 2) |
| REC-6 vLLM prerequisites | PRD §11 risk row (constraint-level, mechanism deferred to architecture doc) + §13 Q7 (2026-12-01 re-check binds D03) + V03/V06; AM-4 correction (version/mode scoping, compatibility matrix, validate in V06) in extract §4 | See minor observation above on risk-row wording |
| REC-7 AG-UI taxonomy | FR-14 — pattern, not dependency, mapped onto existing SSE | OQ-4 (adoption unread) respected by the pattern-level posture |
| REC-8 DSH disposition | D03 (rank-5 provisional, AM-1 subprocess-mode assessment required) + NFR-2 developer-preview risk acceptance + §11 row 1; ToolDefinition-split substance carried by FR-2 (model args never widen access); named pattern left to architecture — correct altitude | Revisit trigger is gap 1 |
| §5.2 sovereignty attacked by defaults | NFR-2 verbatim — defaults audited as gates (telemetry, cloud export, licence posture), with the Agents SDK tracing example | Fully carried, including "PRD-level requirement, not a one-off flag" |
| Cancellation gap (OQ-7; no framework documents disconnect→loop→model) | FR-11 (propagation required and tested) + V06; extract §2, §4 | Covered |
| vLLM operational prerequisites (§4) | §11 risk row + V03 baseline + V06 validation + §13 Q7 freshness | Covered at constraint altitude |
| Claim-ledger caveat (AM-6: 2 verified / 22 unverified / 1 overturned) | Addendum §D ("No ranking is settled evidence until the AM-1 assessment and a GENIE implementation exist") + D03 provisional marks + extract §4 (tally stated) | Covered; the 24→25 count correction is refresh-process detail, correctly left in research.md |
| Churn / regret signals, reversibility | NFR-7 + addendum §A (no multi-engine platform) | Covered |
| Agentic cost/latency reality, loops in production | §8 counter-metrics (cost/latency delta visible, limit-hit rate as quality signal) | Covered |
| Query-class scoping (single-shot stays correct for single-document lookup; bounds as hypotheses) | PRD §4.1 query-class note; extract §5 | Numeric production bounds deliberately post-baseline — intentional |
| Node-vs-Python placement (no evidence) | §13 Q6 + NFR-7 dependency | Correctly routed to architecture doc |
| AM-3 LangGraph time controls, AM-5 licence-unverified ≠ incompatible | Extract §1.4, §3 + PRD FR-19/V07a ("NOASSERTION/unread = unverified, never incompatibility") | Carried with the corrections applied |
