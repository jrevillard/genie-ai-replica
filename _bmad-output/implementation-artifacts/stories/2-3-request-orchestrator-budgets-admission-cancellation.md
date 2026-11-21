---
title: 'Story 2.3 — Request orchestrator: budgets, admission, cancellation'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '88215907e5709ddbac1c4f8a97696f7732fce644'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1960 acceptance criteria, operator-authored">

## Intent

**Problem:** Epic 2's per-request governance layer does not exist: nothing owns the agent-phase sub-budget (AD-6), nothing admits runs through the fleet lane, and no component carries the shared resource counters the BFF's translation leg must budget against.

**Approach:** Implement the per-request orchestrator in `components/agent-service/agent/` — it owns the agent-phase budget enforcement (all dimensions, everything counted), the flock admission lane with the one-replica contract, and cancellation; expose the run surface that serves the seam stream with a defined 429 admission behavior; deliver the BFF-side residual-budget contract translation will budget against; document the BFF-timeout/deadline pair for V08.

**Acceptance criteria (issue #1960, the contract):**
- Given a request with its communicated agent-phase deadline, when the orchestrator runs, then step cap, wall-clock, token budget, call count and evidence volume are enforced with everything counted (retries, tool calls, auxiliary calls incl. judge/classification/preparation-translation).
- And admission uses the flock slot pool with the one-replica deployment contract — saturation yields a defined 429/admission behavior, and the no-agent mode passes through the same lane.
- And the BFF's upstream timeout on the agent leg is configured ≥ the agent-phase deadline plus margin (pair documented for V08).
- And the run's resource counters (tokens, calls) are shared state between agent and BFF: translation checks the remaining token/call allowance before starting, bounds each request to the remaining allowance, and falls back conservatively (skip translation with the recorded status, never exceed) when usage is unavailable — the deadline/cancellation ownership unchanged.
- And cancellation from the BFF aborts the run and releases slots; a run that hits a budget ends with an honest terminal state, never a fabricated answer.

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- Two-level budget ownership (AD-6): the BFF owns the end-to-end request deadline; the orchestrator owns the agent-phase sub-budget, whose wall clock is the deadline the request communicates, capped by the deployment's configured ceiling — never wider than configured.
- Every budget dimension is check-then-count: a check precedes the dispatch it bounds, a refused dispatch increments nothing, and the refusal ends the run honestly (`run_error`, `budget_exhausted` outcome, no fabricated answer text).
- The deployment's budget numbers are REQUIRED configuration, read fail-closed at the run surface: a missing knob refuses the run with the knob named — no numeric default anywhere in the enforcement path.
- The token bound rides each model request (`max_tokens` set to the remaining allowance, the deployed only-when-configured rule); usage accounting uses what the endpoint served, never a local estimate.
- The run surface serves the SEAM stream (the envelope `{run_id, call_id, seq, kind, payload}` over SSE, plus its own terminal usage record) — never a client frame name.
- Cancellation is the loop's existing contract: no terminal event, `CancelledError` propagates untouched, the lane slot releases on every exit path.
- The no-agent pipeline keeps its lane acquire verbatim (config B behavior frozen); the shared pool is the flock on the same slot files — instance identity is irrelevant, kernel locks are the pool.

**Never:**
- No BFF frame names in anything the run surface emits; the BFF frame writer/disconnect detection is story 2.4 — no BFF agent-leg HTTP client lands in this story.
- No wiring of the residual-budget gating into the legacy translation path (the agentic-path wiring is story 2.10; legacy behavior is frozen by the V05 contract).
- No numeric budget defaults, no client-supplied budget values (the request carries only its deadline; budgets are server configuration).
- No new runtime dependency in `requirements.txt`; no `comps` import (FR-20; the 1.4 gate enforces it).
- No pydantic-ai/DSH spike, no second runtime, no production-loop obligation (D03 is story 2.2's decision).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admitted run (happy) | POST run, lane slot free, deadline in request | Seam events stream; terminal `run_finished`/`run_error` then the usage record; slot released | N/A |
| Saturated lane | All slots held at admission | `429` JSON naming saturation, BEFORE any stream byte or stage runs | `Retry-After` header set |
| Budget hit mid-run | Token/call/step/evidence/wall-clock bound crossed | Next dispatch refused; run ends honestly with `budget_exhausted`; usage record still reports partials | Honest terminal, no answer text |
| Client disconnect mid-run | BFF aborts the stream | Handler task cancelled → in-flight call cancelled → slot released; NO terminal event | CancelledError propagates untouched |
| Deadline communicated | `deadline_ms` < configured ceiling | Effective wall clock = the communicated value | `deadline_ms` required; 422 when absent/non-positive |
| Ceiling narrower | `deadline_ms` > configured ceiling | Effective wall clock = the configured ceiling | N/A |
| Unconfigured knobs | A required budget env unset/empty at the run surface | `503` naming every missing knob — no run starts unbounded | Fail-closed at the run surface |
| Translation on residual (BFF contract) | usage `{tokens, calls}` available, allowance remaining | Decision `translate` with `max_tokens` = remaining allowance | Never exceeds the allowance |
| Usage unavailable (BFF contract) | run usage missing/null | Decision `skip` with the recorded status; English answer stays | Conservative — never guesses usage |
| Aux model call | A judge/classification/preparation-translation call claims the monitor | Consumes the model-call budget, tallied separately as aux | Same honest refusal when spent |

## Code Map

- `components/agent-service/agent/budget.py` -- `RunBudget` (REQUIRED thresholds: steps, model_calls, tool_calls, wall_clock) + `RunBudgetMonitor` (check-then-count) + `BudgetExhausted(dimension)`; extends with tokens + evidence volume + aux tally.
- `components/agent-service/agent/loop.py` -- `AgentLoop`, `LoopModelClient` protocol (`complete(messages, tool_definitions)`), `RunResult` (outcome vocabulary, usage as served); takes the token bound + monitor-owned usage/evidence.
- `components/agent-service/agent/cancellation.py` -- `CancellationToken` + `run_cancellable` (in-flight guard); consumed as-is.
- `components/agent-service/agent/probe.py` -- `ProbeConfig`/`ProbeModelClient`/`build_port`/`document_toolset`; the run surface reuses these (one model client, one port assembly); `PROBE_RUN_BUDGET` smoke values gain the new fields.
- `components/agent-service/noagent/lane.py` -- `AdmissionLane` (flock slot pool, `LaneBusyError`); consumed as-is; the pool is the slot FILES, so separate instances over one config share one pool.
- `components/agent-service/noagent/pipeline.py:355` -- the no-agent lane acquire (every stage inside it); frozen — the same-lane AC is satisfied by the shared slot files.
- `components/agent-service/noagent/config.py` -- `NoAgentConfig` (lane knobs `AGENT_LANE_*`; the model-leg knob loader `ProbeConfig` reuses).
- `components/agent-service/app.py` -- infra-only today (`/health`, `/ready`); gains the run surface.
- `components/agent-service/capabilities/executor.py` -- `AuthorizedExecutor` constructed per request (context + bearer + adapters); the run surface builds the stateless adapters once, the executor per request.
- `components/agent-service/capabilities/contract.py:450` -- `OperationBudget` (timeout_ms, max_results, max_result_bytes — all required, gt 0); the per-tool bound.
- `components/agent-service/tests/conftest.py` -- `ScriptedLoopModel`/`HangingLoopModel`/`AgentFakePort` doubles (the one-home rule; they take the new `complete` signature).
- `components/gov-chat-backend/services/translation/gpu-translate-backend.js` -- the deployed translation client: string-only answer, 30 s hardcoded timeout, `_capMaxTokens` window budget, usage DISCARDED (AD-6: wrapped with an estimate, never trusted).
- `components/gov-chat-backend/__tests__/routes/query-routes.test.js` -- the Jest mocking pattern the new backend suite follows (module mocks, no live server).
- `.gitlab-ci.yml` `lint:agent-service` -- ruff over `app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/` (new modules inside `agent/` are covered).
- `docker-compose.yaml:1434` -- the agent-service block: `AGENT_ENABLED` gate, replicas 0/1 (the one-replica contract), env pass-through list.
- `env` -- the committed template; the new knobs documented near `AGENT_ENABLED` (line 1416) with empty defaults.

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/agent/budget.py` -- add `max_total_tokens` + `max_evidence_bytes` REQUIRED dims; monitor gains `record_usage` (prompt+completion as served), `record_evidence`, `take_aux_model_call` (consumes the model-call budget, aux tally separate), `remaining_output_tokens`, per-dimension checks (`tokens`, `evidence_volume`) -- every dimension enforced before dispatch
- [x] `components/agent-service/agent/loop.py` -- model calls pass `max_output_tokens` = remaining allowance; usage + evidence accumulate on the monitor; `RunResult` carries aux calls + evidence bytes -- everything counted
- [x] `components/agent-service/agent/orchestrator.py` -- `OrchestratorConfig` (fail-closed REQUIRED knob reader naming every missing knob), `AgentRunRequest` (question, `deadline_ms`, trusted caller context), `RequestOrchestrator` (lane acquire → monitor/token/emitter → loop → release on every exit; `LaneBusyError` → typed `AdmissionRefused`; `CancelledError` → partial record logged, re-raised; terminal usage record = the shared counters) -- the per-request owner
- [x] `components/agent-service/app.py` -- POST `/v1/runs`: SSE seam stream + terminal usage record; `429` (typed refusal, `Retry-After`) before any stream byte; `503` naming missing knobs; disconnect cancellation; lazy assembly (stateless adapters once, executor per request, probe's port/model-client wiring) -- the defined admission/cancellation behavior
- [x] `components/agent-service/agent/probe.py` -- smoke values for the two new budget fields; docstrings updated (the model client is now shared with the run surface) -- the probe stays green on the same seam
- [x] `components/agent-service/tests/` -- budget-dimension suites, orchestrator suite (admission/saturation/deadline/cancel/aux/evidence), run-surface suite (429, SSE envelope, honest terminal, disconnect, 503), lane cross-instance saturation pin -- the ACs as executable checks
- [x] `components/gov-chat-backend/services/agent-residual-budget.js` -- pure residual-budget contract: `computeResidual` (deadline + usage + allowances → remaining tokens/calls/time), translation plan (`translate` with `max_tokens` = remaining allowance / `skip` with recorded status when usage unavailable or spent), `estimateTextTokens` (chars/4, the deployed estimate constant) -- the shared-counter consumer
- [x] `components/gov-chat-backend/__tests__/services/agent-residual-budget.test.js` -- residual math, bound-never-exceed, skip statuses, estimate -- the contract executable
- [x] `docs/agent-budget-deadline-pairs.md` -- two-level ownership; knob table (agent-side deadline fields/ceiling, BFF `AGENT_UPSTREAM_TIMEOUT_MS` spec for 2.4); derivation `timeout ≥ deadline + translation + finalization margin`; V08 (Epic 3 story 3.3) consumption pointer; one-replica + 429 semantics -- the V08 pair
- [x] `docker-compose.yaml` + `env` -- pass-through entries for the new required knobs (empty default, documented) -- operators can size the deployment

**Acceptance Criteria:**
- Given a run past a budget dimension, when the next dispatch check executes, then the run ends with `budget_exhausted` and no fabricated answer, and the usage record reports the honest partials.
- Given every lane slot held, when a run arrives at the run surface, then it is refused with HTTP 429 before any stage runs, and the no-agent pipeline's pool refuses identically (same slot files).
- Given a client disconnect mid-run, when the BFF aborts, then the in-flight model call is cancelled and the slot is released (the next run admits).
- Given a request carrying `deadline_ms`, when the orchestrator builds its budget, then the effective wall clock is the communicated value capped by the configured ceiling.
- Given usage unavailable on the BFF side, when translation asks the residual contract, then it plans `skip` with the recorded status and never starts a call that could exceed the allowance.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **Knob names chosen (spec pinned only the ceiling).** The REQUIRED budget knobs follow the `AGENT_*` convention: `AGENT_RUN_MAX_STEPS`, `AGENT_RUN_MAX_MODEL_CALLS`, `AGENT_RUN_MAX_TOOL_CALLS`, `AGENT_RUN_MAX_TOTAL_TOKENS`, `AGENT_RUN_MAX_EVIDENCE_BYTES`, `AGENT_RUN_MAX_WALL_CLOCK_SECONDS` (the ceiling named in the design notes), plus the per-tool `OperationBudget` trio `AGENT_TOOL_TIMEOUT_MS` / `AGENT_TOOL_MAX_RESULTS` / `AGENT_TOOL_MAX_RESULT_BYTES`, and the optional `AGENT_RUN_SYSTEM_PROMPT` two-tier override. All nine required knobs are read fail-closed in one pass; an unusable value (empty, non-numeric, non-positive) names the knob exactly like an absent one — it can never back a bounded dispatch.
- **The `LoopModelClient` protocol grew the bound.** `complete(messages, tool_definitions, *, max_output_tokens: int | None)` — keyword-only, no default, so every implementer must carry it. `None` = the field is omitted from the request (the deployed only-when-configured rule in `noagent.generation`); the probe client and the conftest doubles take the new signature. `ScriptedLoopModel` records the bound per request, so the ride-the-request AC is asserted on what the loop actually fed the model.
- **Usage-gap semantics made precise.** `record_usage` accumulates the served counts and flags a gap the first time a record arrives incomplete (one log line per run — an endpoint property, not a per-call event). After a gap: `check_tokens` passes (a lower bound can never prove the budget spent) and `remaining_output_tokens()` returns `None` (a lower bound cannot say what remains — never guessed). Before any served usage, the full allowance rides the first call. The usage record still reports the known partials.
- **The orchestrator is transport-free.** It holds config + lane + model client + a `port_factory(context, bearer)`; the run surface provides the closure that binds the per-request `AuthorizedExecutor` to the shared stateless adapters. `admit()` is a separate async context manager so the HTTP handler enters the claim BEFORE the `StreamingResponse` exists — that is what puts the 429 before any stream byte. The claim releases in the stream generator's `finally` (return, error, cancellation alike).
- **Stream shape.** Each seam event is `data: <envelope json>\n\n`; the terminal usage record is one last frame `data: {"usage_record": {...}}\n\n` (a distinct top-level key — the envelope carries `seq`, the record does not, so consumers cannot confuse them). A cancelled run: no terminal event, no usage record on the stream — the partial counts ride the orchestrator's WARNING log line; `CancelledError` propagates out of the generator untouched.
- **Evidence bytes measured as fed.** `record_evidence(len(json.dumps(result_payload).encode()))` — the size of the JSON the loop actually hands the model, including the port's truncate-and-flag artifacts and error envelopes; the check refuses the next tool dispatch at the boundary.
- **`Retry-After: 1`** is a module constant (`RETRY_AFTER_SECONDS`) in `app.py`, not a knob — the honest signal is "busy now", and a knob for it would invite sizing theater. Revisit if V08 evidence says callers need a different hint.
- **test-app pin updated, not deleted.** Story 1.3's `test_the_service_exposes_no_capability_surface` pin became `test_the_route_surface_is_pinned` (three routes) — the pin keeps working; the docstring records the transition.
- **Probe refactor is extraction only.** `build_stateless_adapters` + `StatelessAdapters` carry the adapter assembly (and the docrepo/okf URL presence checks, which moved with the code they guard); `build_port` keeps the graphs validation and the probe caller context, and calls the shared assembly. Probe evidence record unchanged (aux is 0 and evidence is not a compared field for the runtime decision — the decision compares outcome/counts/wall clock/usage as served).
- **Environment surprises:** `uv venv` ships no `pip` in this checkout — install with `uv pip install --python .venv/bin/python -r ...`. The config-validator's #1716 behavioral probe needs `tests/e2e` deps (`npm ci` there) or one suite fails with a checkout error unrelated to the change.
- **Verification evidence (all from the worktree, 2026-11-21):** agent-service `.venv/bin/python -m pytest tests/ -q` → 669 passed (609 baseline + 60 new/extended); `ruff check` + `ruff format --check` over the CI's full path list → clean; backend `npx jest __tests__/services/agent-residual-budget.test.js` → 13 passed; ESLint + Prettier clean on both new backend files; `tests/config-validator` `npx jest` → 667 passed, 34 skipped, 0 failed (compose parse validated separately: 10 new agent-service env entries present).

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

| Round | Finding | Verdict | Evidence / disposition |
|---|---|---|---|
| G1 | per-call token bound = cumulative remaining allowance, no window anchor: AGENT_RUN_MAX_TOTAL_TOKENS > endpoint window → vLLM 400 on every first call (probe smoke 524288 vs 65536 window proves it) | high | verified real: `remaining_output_tokens()` is cross-call cumulative; vLLM rejects prompt+max_tokens > max_model_len; fix: client-side per-call cap min(allowance, window − prompt estimate − safety), omit when no room |
| G1 | non-MissingKnobs assembly failures → raw 500; compose cannot supply port-assembly knobs (no AGENT_DOCREPO_URL/OKF/GRAPHS pass-throughs) | high | verified real: `runs()` catches only MissingKnobsError; build_stateless_adapters raises ValueError on missing docrepo/okf URLs; compose block carries only AGENT_ENABLED/LOG_LEVEL/10 budget knobs; fix: 503 run_surface_unconfigured + assembly-knob pass-throughs (full wiring = 2.5) |
| G1 | `_required_positive_float` accepts nan/inf: nan ceiling silently disables the wall-clock dimension (min(nan, x)=nan; `elapsed >= nan` always False) | low | verified real: no math.isfinite check; fix: isfinite alongside positivity |
| G1 | pre-loop failures (port_factory/document_toolset before the try) → 200 stream sent then truncated: no terminal event, no usage record | low | verified real: registry build sits outside the loop's try; fix: build inside try, map to run_error + usage record |
| G1 | conftest doubles define `max_output_tokens=None` default against the protocol's deliberate no-default | low | verified real; fix: drop the defaults in the doubles |
| G1 | docs usage-record example omits the `error` field RunUsageRecord carries | low | verified real; fix: add `"error": null` to the example |
| G1 | test helper `_orchestrator(lane_dir=None)` builds `AdmissionLane(slots, "None")` in CWD | low | verified real: any future admit() test without lane_dir writes stray lock files; fix: make lane_dir required |

## Design Notes

- **Wall clock is the communicated deadline, capped.** `deadline_ms` is a REMAINING duration (clock-skew-free), required on every run request; the deployment ceiling (`AGENT_RUN_MAX_WALL_CLOCK_SECONDS`) bounds it: effective = min(ceiling, request). The BFF computes it from its end-to-end deadline minus translation/finalization reserves — the derivation the V08 doc records.
- **Token enforcement is bounded-dispatch, not clairvoyance.** Before each model call the monitor refuses when accumulated usage has spent the token budget; the call itself carries `max_tokens` = remaining allowance, so one refused-late call can overshoot only by its own bounded completion — the same check-then-count honesty as steps/calls. An endpoint that discards usage degrades token enforcement (logged once, never guessed); vLLM reports usage.
- **Evidence volume** aggregates executed tool-result bytes (the per-call `OperationBudget.max_result_bytes` already truncates each result); the run-level check refuses the NEXT dispatch when the run's evidence has spent its volume.
- **The shared pool is the slot files.** `AdmissionLane` instances are stateless shells over flock'd files; the run surface's lane and the no-agent pipeline's lane derive from the same `NoAgentConfig`, so the pool is global under the one-replica contract. A cross-instance saturation test pins this.
- **The run surface reuses the probe's assembly** (`build_port`, the model client, `document_toolset`): D03 is not closed (2.2), so this is the same pre-decision infrastructure serving governed runs; 2.5 upgrades the assembly, not the contracts. The system prompt carries the deployed two-tier override (`AGENT_RUN_SYSTEM_PROMPT`, default = the probe's governed text).
- **The usage record is the shared state.** The run surface's terminal record (and the evidence log line for a cancelled run) carries `{run_id, outcome, steps, model_calls, aux_model_calls, tool_calls, evidence_bytes, prompt_tokens, completion_tokens, wall_clock_seconds, error?}` — the fields the BFF's residual contract consumes; 2.10 wires the consumption, 2.4 the stream.
- **Aux calls consume the same model-call budget** (one fleet budget, AD-6) and are tallied separately so the evidence shows plumbing vs. work. The judge (2.6), classification and agent-path preparation (2.5) claim the monitor through `take_aux_model_call`/`record_usage`; the counting surface ships here, the wiring follows in those stories.

## Verification

**Commands:**
- `cd components/agent-service && python -m pytest tests/ -q` -- expected: all suites green, including the new budget/orchestrator/run-surface suites
- `cd components/agent-service && ruff check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/ && ruff format --check app.py agent/` -- expected: clean
- `cd components/gov-chat-backend && npx jest __tests__/services/agent-residual-budget.test.js` -- expected: green
- `cd tests/config-validator && npm test` -- expected: green (OPEA-free gate over the new modules, CI-shell gate over the compose/.gitlab-ci.yml edits)
- **Review round 1 (coordinator findings, all addressed with the smallest change):**
  (1) the per-call token bound is now window-anchored in `ProbeModelClient.complete` — the component that knows the endpoint caps `max_tokens` to `min(bound, room)` with room = window − prompt estimate − 128 safety, using the deployed arithmetic matched with `AnswerTranslator` (4 chars/token + 20 offset; window via the deployed three tiers: `AGENT_WINDOW_OVERRIDE_TOKENS` → probed `max_model_len` captured from the same discovery as the model id, cached per client → `MAX_MODEL_LEN_TEXTGEN` fallback carried on `ProbeConfig`); room <= 0 omits the field (an oversized prompt fails honestly on its own). The monitor and loop semantics untouched.
  (2) `runs()` answers the assembly `ValueError`s (docrepo/okf URLs, TEI endpoints) with the same 503 under `run_surface_unconfigured`; compose + env gain the five port-assembly pass-throughs (`AGENT_DOCREPO_URL`, `AGENT_OKF_URL`, `AGENT_AUTHORIZED_GRAPHS`, `AGENT_AUTHORIZED_REPOS`, `AGENT_PROBE_BEARER`) with the deliberate-scope comment (the TEI/Arango/vLLM endpoints ride the integration story's assembly wiring).
  (3) `_required_positive_float` now rejects nan/inf (`math.isfinite`) — a nan ceiling silently disabled the wall-clock dimension.
  (4) the orchestrator builds the registry/loop inside its try; a pre-loop build failure emits `RUN_ERROR` `{"code": "error"}` and returns the "error" usage record, so a started stream always carries a defined terminal + record.
  (5) the conftest doubles carry the protocol's keyword-only no-default `max_output_tokens`.
  (6) the V08 doc's usage-record example carries `"error": null` plus the field's meaning.
  (7) the orchestrator test helper's `lane_dir` is a required positional — no stray lock files in the CWD.
  Verification of the round: agent-service full pytest 675 passed; ruff check/format clean; config-validator `config-validation` + `agent-service` suites 357 passed (compose/env coverage).
