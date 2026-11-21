---
title: 'Story 2.1 — Runtime seam and bounded decision probe'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '88a9e8add0cd64df59d22b8ea9fd484a285c9208'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1958 acceptance criteria, operator-authored">

## Intent

**Problem:** Epic 2's runtime decision (D03) must close on evidence from a working seam, whichever runtime wins. The seam (registered toolset, internal envelope, event vocabulary, budget/cancellation hooks) and a bounded smoke probe of the provisional candidate (the custom minimal loop) do not exist yet.

**Approach:** Implement the runtime seam (AD-5) in `components/agent-service/agent/` and run a bounded probe of the custom minimal loop on it, producing comparable pre-decision evidence for V06/D03. The probe is explicitly pre-decision evidence: if D03 selects pydantic-ai or DSH, the production implementation follows the SELECTED runtime on the same seam — no obligation to ship a production custom loop or a second engine.

**Acceptance criteria (issue #1958, the contract):**
- Given the capability contract (story 1.5), when the seam is implemented, then tools are registered server-side only (the registry is the authorization surface — nothing unregistered is callable), the internal envelope is `{run_id, call_id, seq, kind, payload}` owned by `agent/`, and the event vocabulary is AG-UI-shaped and owned by the seam — the loop never emits BFF frame names.
- A bounded probe (smoke, not production implementation) exercises the provisional candidate on the seam — small toolset, one multi-hop question — producing comparable evidence for V06/D03.
- Budget and cancellation hooks are honored: a cancelled run stops dispatching and cancels the in-flight model call.

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- The registry is the authorization surface (AD-4/AD-5): a tool the registry does not carry is dispatched by nobody, and dispatch refuses an unregistered name before any resolution.
- The envelope `{run_id, call_id, seq, kind, payload}` and the event kinds are owned by `agent/` — a runtime adapts its native events TO the seam vocabulary, never renames it.
- Event kinds are AG-UI-shaped (run lifecycle, text-message lifecycle, tool-call lifecycle) as a pattern — no AG-UI dependency, no protocol import.
- The loop consumes the story 1.5 port (`DocumentCapabilityPort`) through the registry's tool executors; the probe's toolset is small (search + read).
- Budget checks precede every dispatch (model and tool); a cancelled run stops dispatching and the in-flight model call is cancelled (CancelledError propagates untouched).
- Model access through an injected OpenAI-compatible transport seam (httpx), the component's existing pattern — no new runtime dependency, no `openai` package.

**Never:**
- No BFF frame names (`chunk`, `done`, `error`, `metadata`, `agent_activity`, `agent_verdict`) anywhere in the seam vocabulary — the BFF frame writer is story 2.4.
- No HTTP surface for the agent loop (request orchestrator/admission is 2.3; the BFF stream contract is 2.4) — the probe runs in-process.
- No production-loop obligation, no second engine, no pydantic-ai/DSH spike (optional evidence, not in scope).
- No new runtime dependency in `requirements.txt`; no `comps` import (OPEA-free, FR-7; the 1.4 gate enforces it).
- No numeric budget defaults treated as final — probe budget values are smoke bounds, thresholds stay post-baseline (PRD §8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Multi-hop probe (happy) | Scripted model: search → read_source → answer | Tool-call lifecycle events, then text-message events, run finishes; evidence record `outcome=answered` | N/A |
| Unregistered tool call | Model names a tool absent from the registry | Dispatch refused before any resolution; the refusal is fed back to the loop, run ends honestly | `run_error` terminal event, evidence `outcome=error` |
| Budget exhausted | Model/tool call count or steps exceed the budget | Dispatch refused at the next check — no partial fabricated answer | `run_error` terminal event, evidence `outcome=budget_exhausted` |
| Cancelled mid-run | Cancellation token fires during an in-flight model call | Dispatching stops at the next check; the in-flight call raises CancelledError and propagates | No terminal event; evidence records `outcome=cancelled` |
| Insufficient evidence | search returns `insufficient_evidence`, model abstains | The answer-type result flows as tool result; run finishes honestly | evidence `outcome` per the model's final turn |

## Code Map

- `components/agent-service/capabilities/contract.py` — story 1.5 port: `DocumentCapabilityPort`, `CallerContext`, `PreparedQuery`, `OperationBudget`, outcome codes; the tools wrap THIS, they do not re-declare it.
- `components/agent-service/capabilities/executor.py` — `AuthorizedExecutor`: the enforcement point the probe may bind its tool executors to (tests use fakes).
- `components/agent-service/preparation/translation.py:252` — `HttpxTransport`: the injected async transport seam the model client reuses.
- `components/agent-service/noagent/generation.py` — the OpenAI-compatible payload/response conventions (`/v1/models` discovery, fixed params) the loop's model client mirrors.
- `components/agent-service/noagent/lane.py` — the flock admission lane: NOT in this story (2.3 owns admission); do not touch.
- `components/agent-service/tests/conftest.py` — `PreparationFakeTransport` pattern: the fakes here follow it (canned answers, recorded calls).
- `components/agent-service/pyproject.toml` — ruff py311 line-length 120; `pythonpath=["."]` so tests import `agent` top-level.
- `.gitlab-ci.yml:2347` — `test:agent-service`: pytest over the component; the new suites ride it.

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/agent/__init__.py` + `agent/events.py` — envelope (`run_id`, `call_id`, `seq`, `kind`, payload) + AG-UI-shaped kind vocabulary, seam-owned; emitter assigns monotonic `seq` -- the seam's data contract
- [x] `components/agent-service/agent/registry.py` — server-side tool registry: register, model-facing definitions, dispatch that refuses unregistered names -- the authorization surface
- [x] `components/agent-service/agent/budget.py` — run budget (steps, wall-clock, model/tool call counts) + check hooks, `BudgetExhausted` -- bounded execution before dispatch
- [x] `components/agent-service/agent/cancellation.py` — cancellation hook: token checked before each dispatch, in-flight model call cancellable -- the cancellation chain's agent-side end
- [x] `components/agent-service/agent/loop.py` — the provisional candidate (custom minimal loop) behind the seam: model call → tool dispatch through the registry → events on the vocabulary -- the runtime that plugs in
- [x] `components/agent-service/agent/probe.py` — bounded smoke probe: small toolset over the port, one multi-hop question, V06-comparable evidence record; optional `__main__` entry against `VLLM_ENDPOINT` -- the pre-decision evidence producer
- [x] `components/agent-service/tests/test_agent_*.py` — suites for envelope/vocabulary ownership, registry refusal, budget/cancellation honoring, multi-hop probe end-to-end on fakes -- the ACs as executable checks

**Acceptance Criteria:**
- Given a tool absent from the registry, when dispatch is attempted, then it is refused before any resolution and nothing unregistered is callable.
- Given the seam, when the loop emits, then every event carries the envelope `{run_id, call_id, seq, kind, payload}` with a monotonic `seq`, and no kind value is a BFF frame name.
- Given the probe, when it runs end-to-end on scripted fakes, then one multi-hop question completes through search → read_source → answer with a comparable evidence record.
- Given a cancellation during an in-flight model call, when it fires, then dispatching stops and the in-flight call is cancelled (CancelledError propagates).
- Given a budget exhaustion, when the next dispatch check runs, then the run ends honestly with no fabricated answer.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- 2026-11-21 — implemented on `feat/agentic-foundations/2-1-runtime-seam-and-bounded-decision-probe`.
  New `agent/` package: `events.py` (envelope + `EventKind` vocabulary + import-time BFF-name
  guard + `EventEmitter`), `registry.py` (`ToolRegistry`, `UnregisteredToolError`, OpenAI
  function-tool definitions), `budget.py` (`RunBudget` with REQUIRED thresholds — no numeric
  defaults anywhere — plus `RunBudgetMonitor` check-then-count), `cancellation.py`
  (`CancellationToken`, `run_cancellable` race), `loop.py` (`AgentLoop` + `RunResult` + outcome
  vocabulary), `probe.py` (`ProbeEvidence`, `run_probe`, `document_toolset`, probe-local
  `ProbeModelClient`, live `build_port` + `python -m agent.probe`). Six test suites under
  `tests/test_agent_*.py`; agent doubles (`AgentFakePort`, `ScriptedLoopModel`) added to
  `tests/conftest.py` (the one-home rule). Two files outside the task list, both required by
  the component's existing contracts: the Dockerfile now copies `agent/` beside
  `capabilities/ preparation/ noagent/`, and `lint:agent-service` in `.gitlab-ci.yml` now
  lints `agent/` (the lint job names its directories explicitly — a new package is invisible
  to it otherwise). No dependency added; `requirements.txt` untouched.
- Design decisions the spec left open, recorded here for review:
  - `call_id` semantics: the wire tool-call id on tool-call events; `None` on run-level and
    text-message events (they belong to the run, not to one call).
  - The unregistered-tool refusal ENDS the run (`run_error`, evidence `outcome=error`) —
    reading the matrix's error-handling column, and AD-4: the model can call nothing
    unregistered, so a call for an unregistered name is an authorization violation, not a
    retryable tool error.
  - The step counter counts GRANTED iterations: a step whose model call was budget-refused
    still counts as a step (the evidence shows steps=2, model_calls=1 — an opened iteration
    that made no call is visible, which is the honest record).
  - A cancelled run emits NO terminal event; the probe records `outcome=cancelled` at the
    harness boundary with the monitor's partial counts (the loop's `RunResult` never exists
    on that path — which is why the probe, not the loop, owns the monitor reference).
  - `run_cancellable` closes a never-started coroutine on the pre-cancelled refusal path
    (no "coroutine was never awaited" warning left behind).
  - Argument-strictness: the contract's `extra="forbid"` is enforced where the contract
    types are built (a smuggled field inside `target` is refused); extra top-level argument
    keys are ignored by design — AD-4 puts the narrowing in the context, so a smuggled
    argument field cannot widen anything, and the test asserts exactly that.
- Probe smoke bounds (NOT thresholds, PRD §8): run budget 8 steps / 8 model calls / 8 tool
  calls / 600 s wall clock; per-tool `OperationBudget` 120 s timeout, 8 results, 64 KiB.
  Live-entry env knobs: `AGENT_DOCREPO_URL`, `AGENT_OKF_URL`, `AGENT_AUTHORIZED_GRAPHS`
  (comma-separated), optional `AGENT_AUTHORIZED_REPOS` (`repo_id:graph_name` pairs) and
  `AGENT_PROBE_BEARER` (forwarded to the services that validate their own callers).
- Verification (worktree `components/agent-service/.venv`, python 3.11): `pytest tests/ -q`
  → 605 passed (579 pre-existing + 26 new), 2 pre-existing warnings;
  `ruff check` + `ruff format --check` over the CI job's exact file list → clean (ruff
  0.16.3, the CI pin); `tests/config-validator` suite (includes the AD-1 OPEA-free gate over
  the new package, the CI-shell gate over the edited `.gitlab-ci.yml`, and the
  dependency-evidence pin) → 667 passed. The live `python -m agent.probe` entry was NOT run:
  it needs a live vLLM endpoint + corpus services (V06 venue), which is story 2.2's run.
- 2026-11-21 — review rounds recorded. Global review 1: 1 important (the live probe's
  generation bearer 401s on the canonical venue — OPENAI_API_KEY-only read; fixed with the
  VLLM_API_KEY fallback) + 6 nits (2 filed as issues #2045/#2046, 1 refuted — the compose
  profile premise is inverted: modern compose honors deploy.replicas; the okf COMPOSE-ONLY
  note exists because Swarm ignores profiles —, 1 recorded fidelity — the dense-leg swallow
  is the V02 record, 3 fixed in-scope). Global review 2: 0 important, 6 nits — planning-artifact
  references stripped from the new files' comments (external-consumption rule; the pre-2.1
  modules' sweep filed as #2049), tool-dispatch checks moved before the tool_call_started
  event (a refused dispatch never announces a call that will not run), the smoke-bound
  comment no longer promises a retry, capability budget-semantics nits filed as #2047,
  licence-audit CI enforcement filed as #2048. FIX review of the corrections: clean. Quality
  round (simplify 4 angles + test audit): config/knob reads re-homed through
  NoAgentConfig + the shared chat-shape readers and recorded sampling params; dead surface
  removed (4 unconsumed accessors, 1 speculative parameter); cancellation + canned-result
  doubles consolidated in the test conftest; 1 junk test deleted. Scoped FIX review of the
  quality round: clean (payload bytes verified identical). Final: 609 tests passed, ruff
  clean. MR: !1001 (draft until the review sequence ends).

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

| Round | Finding | Verdict | Evidence / disposition |
|---|---|---|---|
| G1 | probe generation bearer OPENAI_API_KEY-only 401s the canonical venue | high (real) | fixed: VLLM_API_KEY fallback, both directions pinned |
| G1 | agent-service parks solely via deploy.replicas (compose profile question) | nit / refuted | premise inverted — modern compose honors deploy.replicas; okf note is Swarm-profile asymmetry; verify-before-activation recorded as issue #2045 |
| G1 | MODEL_*_TIMEOUT_SECONDS bare float() crashes on set-to-empty | nit (real) | fixed: routed through the tolerant recorded read |
| G1 | missing tool-call id coerced to shared empty id | nit (real) | fixed: refused as a response-shape defect |
| G1 | AuthorizedExecutor drops the insufficiency reason (no abstention_sink) | nit (real, pre-2.1) | issue #2046 (executor is story 1.7 code; matters from 2.3/2.5) |
| G1 | AgentFakePort docstring contradicts code | nit (real) | fixed: docstring corrected |
| G1 | dense-leg swallow without degradation flag | nit / already handled | the V02 record documents the swallow as recorded behavior — deliberate fidelity, no action |
| G2 | planning-artifact references in shipped comments | nit (real, rule) | fixed for the new files; component-wide sweep filed as #2049 |
| G2 | tool_call_started emitted before refusal checks | nit (real) | fixed: checks precede the started event; boundary pin updated |
| G2 | dead truncate arm in executor search | nit (real, pre-2.1) | verified real; filed with the budget-semantics issue #2047 |
| G2 | max_results doubles as the legacy chunk cap | nit (real, pre-2.1) | filed with #2047 |
| G2 | smoke-bound comment promises a retry none exists | nit (real) | fixed: comment reworded |
| G2 | licence/defaults audit has no CI enforcement | nit (real, pre-2.1) | issue #2048 |
| Q (simplify) | 13 accepted findings (reuse/simplification/efficiency/altitude) | applied | behavior verified preserved by the scoped FIX review; 1 skip: EventSink Protocol kept (carries the docstring) |
| Q (test audit) | probe-question endswith("?") test | junk pattern | deleted; nothing it covered was otherwise uncovered |

## Design Notes

- The runtime seam is a **module boundary, not an HTTP contract** at this stage: `agent/` owns the envelope + vocabulary + registry + hooks; `loop.py` is one implementation of "whatever drives the loop" (AD-5). Story 2.2 points V06 at the same probe shape with a different runtime; 2.4's BFF later maps the vocabulary onto the client SSE frames.
- The probe's tool executors adapt model-generated JSON args into the contract's input types (`PreparedQuery` with `passthrough_english` — the probe question is English by construction) and carry a fixed `CallerContext`; the port stays the only corpus access.
- The model client mirrors `noagent.generation` conventions (non-streaming, fixed params, `/v1/models` model discovery with `VLLM_LLM_MODEL_ID` override) but stays probe-local: the production client belongs to the selected runtime's story.
- Comparable evidence: one record per probe run — runtime id, toolset, question id, outcome, step/model/tool call counts, wall clock, token usage as served — the fields V06 compares across candidates.

## Verification

**Commands:**
- `cd components/agent-service && python -m pytest tests/ -q` -- expected: all suites green, including the new `test_agent_*` suites
- `cd components/agent-service && ruff check agent/ tests/test_agent_*.py && ruff format --check agent/` -- expected: clean
