# Epic 4 Context: Evaluation and evidence

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Engineering can prove — with versioned corpora, cases and configurations — that the OPEA-free path preserves required behavior (E01: A vs B) and that the agent earns its cost within accepted limits (E02: B vs C). Counter-metrics are first-class: the proof includes showing the agent did not game it (cost/latency delta, excessive abstention, limit/cancellation hit rate). Numerical thresholds are agreed only after the reference is measured and before candidate assessment; an absent threshold blocks promotion rather than defaulting.

## Stories

- Story 4.1: Evaluation harness (one runway)
- Story 4.2: Authorization and injection scenario suite
- Story 4.3: E01 — behavior preservation (A vs B)
- Story 4.4: Thresholds and counter-metrics
- Story 4.5: E02 — the agent's case (B vs C)
- Story 4.6: Release-readiness evidence (V09 + V07b)

## Requirements & Constraints

- Three configurations: **A** = legacy fixed RAG; **B** = fixed non-agentic pipeline over the new OPEA-free capabilities; **C** = the agent over the same capabilities. E01 compares A/B (the retrieval backend is the variable under test — A and B deliberately differ there). E02 compares B/C (B and C share the retrieval backend, so the delta is attributable to the agent, not the retrieval migration).
- Within each pair, hold fixed: corpus, evaluation set, execution conditions, and model services where each configuration can use them. Intentional prompt/orchestration differences are recorded.
- Every run versions corpus, cases, configurations, models, prompts and evaluator instructions. Cases used to tune the implementation stay separate from the assessment set.
- Evaluation set composition is fixed and explicit: answerable and unanswerable questions, citation checks, representative languages (including non-Latin scripts), restricted/public access scenarios, failure and cancellation cases.
- Authorization scenarios are part of the set. No unauthorized disclosure is accepted (restricted repos, cross-user ids, narrowed task scopes, between-turns permission changes). Passing is evidence for tested conditions, never proof of impossibility.
- Prompt-injection scenarios: hostile instructions embedded in retrieved documents and tool outputs. The agent must not follow them; every steering attempt counts as a finding regardless of outcome. Findings feed the report — no silent pass.
- Known defects in the reference are recorded and never silently become requirements to reproduce.
- Report retrieval quality, answer grounding, abstention correctness, latency and resource consumption separately (M-1..M-5), and identify uncontrolled differences (prompts, cache state, concurrency).
- Thresholds: measured dimensions get an agreed threshold or an explicitly recorded absence — absence blocks promotion. The E01/E02 gate sign-off owner is recorded.
- Counter-metrics are first-class results: CM-1 cost/latency per agentic request vs reference (delta visible, not averaged away); CM-2 excessive-abstention rate on questions the reference answers correctly; CM-3 rate of executions hitting limits or cancellation.
- E02 includes a legacy non-regression test under concurrent agent load (legacy-only vs legacy-with-agent-load against agreed latency/error/availability limits, with the defined saturation/admission response). A resource report that hides slowed or failing legacy responses fails.
- Verdict honesty: agentic benefits remain hypotheses until measured on GENIE's own corpora and query mix; a negative result is recorded, not massaged.
- V09: executable CI/integration coverage and runner availability confirmed; checks needing a separate environment identified — including the new CI surface (agent pytest suite, OPEA-free gate, e2e pins). Repo E2E execution in CI is suspended per ADR 0001; the local E2E run is the baseline.
- V07b: complete license and redistribution assessment (transitive/optional dependencies, images, binaries, models; notices preserved; disclosures updated) before any pilot/release use of the artifacts.
- Gaps between release gates and available evidence surface as blockers, never absorbed silently.

## Technical Decisions

- **One evaluation runway, no second stack.** The harness reuses Epic 1's equivalence suite as its config-B driver. Config B is the service-side no-agent mode of agent-service — the harness is its caller, not its implementer.
- **B and C share the admission path exactly.** Every request mode passes through the same orchestrator admission lane and budgets, including the no-agent evaluation mode, so admission policy never becomes a hidden variable in E02. B/C also use identical query preparation, so the E02 delta attributes to the agent.
- **Harness home is `tests/rag-benchmarks`** (ratified home). Existing capture machinery there is reused where suitable, with suitability and version checks — never blind reuse of an old baseline artifact. The harness protocol itself (set composition, versioning, defect recording, reporting) is designed at story level; the architecture spine governs only the A/B/C configurations and the injection scenarios.
- **Measurement is a partial order**: measure A alone first → freeze thresholds → then run the gated B/C candidate assessments. A-only metrics must exist before thresholds are signed and before the first gated B/C run.
- Prompt-injection defense is a deviation-by-construction claim (system-prompt grounding plus the structured tool contract make instruction-following from corpus content a deviation); the evaluation set exists to test that claim, not assume it.
- Open, operator-owned questions carried into this epic: where agreed thresholds live once measured, the E01/E02 sign-off owner, and the first end-to-end validation venue.

## Cross-Story Dependencies

- **On Epic 1**: story 1.9's no-agent mode (config B), story 1.1's V02-recorded behavioral contract (the equivalence fixtures E01 proves against), and story 1.2's V03 deployed baseline (E01's reference input — versions, digests, models, topology of what actually serves traffic).
- **On Epic 2**: the agent (config C) exists before E02 can run; attribution/observability (story 2.11) supplies the execution records the harness correlates.
- **Within the epic**: 4.1's harness precedes 4.2/4.3/4.5 (all run on it). 4.4's thresholds require 4.3's A-only baseline and gate the first B/C run. 4.6 needs the delivered artifacts of all epics (its V09/V07b evidence is the release gate's input).
- 4.5 assembles the S4 exit evidence bundle (E01 + E02 + bounded execution + rollback demo + coexistence criterion) from this epic's and Epics 2–3's artifacts.
