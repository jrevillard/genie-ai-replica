---
title: 'Story 2.2 — V06 runtime verification and D03 closure'
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

<frozen-after-approval reason="human-owned intent — the issue #1959 acceptance criteria, operator-authored">

## Intent

**Problem:** Epic 2's runtime decision (D03) must close on live evidence, not stale research: the provisional custom minimal loop (story 2.1) has suite-green code and a bounded probe, but nothing has yet verified the deployed model endpoint's tool-calling behavior (REC-6), runtime-level cancellation, or the pre-adoption license posture (V07a).

**Approach:** Run V06 against the deployed combination — a version × model × parser × tool-choice-mode × schema-strictness × streaming compatibility matrix, runtime-level cancellation and client-disconnect propagation to the in-flight model call, and the live probe run story 2.1 deferred — then pass the V07a gate for the exact shipped versions, audit default telemetry posture, and record the D03 decision as an ADR citing that evidence.

**Acceptance criteria (issue #1959, the contract):**
- Given the deployed vLLM version (V03 baseline) and the 2.1 probe evidence, when V06 runs, then the version × model × parser × tool-choice-mode × schema-strictness × streaming compatibility matrix is validated against the deployed combination (REC-6 prerequisites pinned).
- Cancellation and client-disconnect propagation to the model call are demonstrated at runtime level (full request-path integration is gated separately in 2.3/2.4 — the phases are explicit).
- V07a license verification passes for the exact package versions of every adopted dependency; developer-preview status (if applicable) carries an explicit operational-risk acceptance; default telemetry/cloud-export posture is audited (NFR-2).
- The D03 decision is recorded as an ADR citing V06+V07a evidence; it does not close on compat research past its 2026-12-01 re-check without a refresh; every candidate carries documented replacement scope and estimated swap cost (NFR-7).
- The SELECTED runtime's production implementation is owned by story 2.5's integration slice (assembling the loop implementation on this seam through 2.3/2.4) — Epic 2's "D03 closes at epic entry" means closure happens inside this epic's opening stories (2.1 probe → 2.2 decision), not before the epic starts.

## Boundaries & Constraints

**Always:**
- The matrix validates the DEPLOYED combination: version and model are read from the live endpoint itself and recorded verbatim with venue and date; the parser is recorded behaviorally (what the deployed server does), not assumed.
- Matrix cells are judged on observable response validity: tool-call arguments parse as JSON matching the registered schema, the call id is present, no malformed tool-call markup leaks into content, and streamed tool-call deltas reassemble into a complete call.
- Cancellation demos run against the live endpoint: an in-flight streaming completion cancelled mid-flight, and a loop-level run cancelled during a model call (the full request path stays 2.3/2.4).
- No new runtime dependency: the harness uses httpx, pydantic and the standard library only — the V07a gate audits exactly the tree that ships.
- Every failing cell, latency observation, or posture gap is recorded honestly in the V06 record — a failure is evidence, never a silent pass.
- The ADR carries the 2026-12-01 freshness gate and per-candidate replacement scope with estimated swap cost (NFR-7).

**Never:**
- No production loop changes, no BFF frame names, no HTTP surface for the agent loop (2.3/2.4/2.5 own those).
- No pydantic-ai or DSH installation or spike — they are decision candidates, not adopted code.
- No new numeric budget defaults; no dependency adoption in requirements.txt.
- No mutation of the shared venue: read-only model calls in modest volume, serial; no chart/compose/deployment change; no corpus data change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Matrix cell | one completion per tool-choice mode (auto / named / required) × schema strictness (strict / permissive) × streaming (on / off) against the deployed endpoint | cell verdict valid/invalid with the observed evidence + first-call latency per schema (FSM-compile observation) | transport/HTTP failure = the cell is recorded failed with its error, never skipped |
| Streaming call cancelled mid-flight | streaming completion, cancellation fires after the first delta | the task raises CancelledError, the connection is aborted, no completion is delivered | the demo records the observation |
| Loop-level cancellation | AgentLoop with the live model client and registered fake tools, cancellation fires during a model call | CancelledError propagates, no terminal event is emitted, the harness records `cancelled` | recorded as evidence |
| Live probe | `python -m agent.probe` against the venue (corpus services reachable) | one ProbeEvidence record, `outcome=answered` | a transient failure ends with its evidence record like any other bound |
| License gate | `verify-dependency-licenses.py --verify` over the shipped pins | exit 0, defaults verdicts present for every row | a NOASSERTION licence or stale row fails the gate |

</frozen-after-approval>

## Code Map

- `components/agent-service/agent/probe.py` -- `ProbeEvidence`, `run_probe`, `document_toolset`, `build_port`, `ProbeModelClient`, the live `python -m agent.probe` entry: the 2.1 evidence producer this story finally runs live
- `components/agent-service/agent/loop.py` -- `AgentLoop`, `LoopModelClient`, `ModelTurn`: the cancellation demo drives this against the live endpoint
- `components/agent-service/agent/cancellation.py` -- `CancellationToken`, `run_cancellable`: the runtime-level cancellation primitive under demonstration
- `components/agent-service/noagent/generation.py:55` -- `RECORDED_SAMPLING_PARAMS`, `chat_choice`, `chat_choice_content`: the payload/response conventions the harness clients reuse
- `components/agent-service/preparation/translation.py:252` -- `HttpxTransport` (`get_json`/`post_json`): the injected transport; the streaming read is new harness-local code (the protocol gains no method)
- `components/agent-service/capabilities/adapters/env_config.py` -- `ArangoConfig`: the live-port wiring knobs
- `components/agent-service/requirements.txt` -- the pinned tree the V07a gate audits; unchanged by this story
- `scripts/dependencies/verify-dependency-licenses.py` -- the V07a gate (`--verify REQ --evidence EVIDENCE`)
- `docs/dependencies/agent-service-dependency-evidence.json` -- the audit evidence the gate verifies against (defaults verdicts live here)
- `docs/baselines/v03-deployed-baseline-2026-11-19.md` -- the V03 deployed combination (GPU node `ai.assembly.govstack.global`, granite-4.1-8b) this verification pins against
- `docs/baselines/` -- the V06 record doc lands here (`v06-runtime-verification-2026-11-21.md`), beside V02–V05
- `docs/adr/agentic-001-retained-answer-visibility.md` -- the ADR format; the D03 ADR lands beside it as `agentic-002`
- `.gitlab-ci.yml` (`test:agent-service`, `lint:agent-service`) -- the new suite rides the existing lanes
- `tests/config-validator` -- the dependency-evidence pin and the OPEA-free gate stay green

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/agent/verification.py` -- NEW: the V06 evidence producer — compatibility matrix over the deployed endpoint (tool-choice mode × schema strictness × streaming, judged per cell, first-call latency per schema), streaming tool-delta client (harness-local httpx SSE read), runtime-level cancellation demos, `python -m agent.verification` entry printing one JSON evidence record -- the matrix and cancellation ACs as a re-runnable producer
- [x] `components/agent-service/tests/test_agent_verification.py` -- NEW: cell judgment, streaming reassembly, and cancellation-demo paths on fakes (deterministic; no live endpoint in CI) -- the harness's own contract
- [x] `docs/baselines/v06-runtime-verification-2026-11-21.md` -- NEW: the V06 record — deployed combination verbatim, matrix table with per-cell verdicts, latency observations, cancellation evidence, the live probe evidence record, telemetry posture summary, REC-6 prerequisites pinned -- the evidence the ADR cites
- [x] `docs/adr/agentic-002-first-agent-runtime-d03.md` -- NEW: the D03 decision ADR citing V06 + V07a evidence, the 2026-12-01 freshness gate, and per-candidate replacement scope with estimated swap cost -- the decision record
- [x] live runs against the venue -- matrix harness, cancellation demos, `python -m agent.probe`, the license gate -- the evidence, gathered and recorded
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `2-2-v06-runtime-verification-and-d03-closure` row → `review` at completion -- the tracking contract

**Acceptance Criteria:**
- Given the deployed endpoint, when the harness runs, then every matrix cell carries an honest verdict with its observation, and the record pins the REC-6 prerequisites for the deployed combination.
- Given a streaming completion cancelled mid-flight, when the token fires, then CancelledError propagates and the connection is aborted with no completion delivered.
- Given a loop-level run cancelled during a live model call, when the token fires, then dispatching stops and the in-flight call is cancelled with no terminal event.
- Given the shipped pins, when the license gate runs, then it passes for every exact version with defaults verdicts present.
- Given the gathered evidence, when the ADR is read, then D03 cites V06+V07a, carries the 2026-12-01 re-check gate, and states replacement scope and estimated swap cost for every candidate.
- Given the ADR, when read, then the SELECTED runtime's production implementation is stated as owned by story 2.5's integration slice.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

### 2026-11-21 — implementation record

- **The headline evidence is a NEGATIVE finding, recorded honestly**: the
  deployed vLLM 0.29.0 serving config carries NO tool-calling flags — every
  one of the 12 matrix cells 400s with the server's own message
  (`--enable-auto-tool-choice` / `--tool-call-parser` unset). Per the frozen
  boundary (no venue mutation) the gap is recorded, the REC-6 prerequisite
  pinned (`--tool-call-parser granite4` per vLLM + IBM Granite docs), and
  the harness designated as the acceptance re-run. Candidate
  DIFFERENTIATION on tool-call handling is the decision's named residual
  risk; the ADR makes the post-pin matrix re-run a BINDING acceptance step
  of story 2.5.
- **Both cancellation ACs demonstrated live and pass**: streaming
  cancelled-mid-flight (1 delta, CancelledError, connection aborted, no
  completion delivered) and loop-level cancel during a live model call
  (CancelledError propagates, in-flight call cancelled, no terminal event).
  Demo design notes: the streaming demo sends a PLAIN completion (isolates
  the cancellation variable from the tool-calling matrix — a venue that
  rejects tool calls still demonstrates the abort) and parks the consumer
  after the first delta so the cancellation point is the harness's, not a
  race against the model's typing speed (first live run: the model counted
  to twenty before the poll-based cancel landed, and the honest record said
  "completion delivered" — about the harness's lateness, not the venue).
- **The probe record is `outcome=error`** on the same REC-6 root cause
  (discovery served 200; the first tool-calling call 400'd). Corpus legs
  were wired (doc-repo + ArangoDB via port-forward, `ARANGO_DB=_system`/
  `GRAPH` as deployed, TEI on the GPU node) but unreached — the model leg
  dies first. A first attempt transiently 401'd at discovery; the rerun was
  clean; both are recorded.
- **Venue posture observations** (read-only, for 2.3/2.5): embed endpoint
  requires the API key (the TEI adapter sends no bearer by recorded V02
  design — compose-internal correct, keyed-gateway blocked); okf-server is
  not deployed on this venue (`OKF_ENABLED=0`) — the probe exercised the
  legacy-graph path only.
- **V07a**: gate exit 0, 47 pins, defaults verdicts present, beta lines
  carry the story-1.3 risk acceptance. The selected runtime adopts nothing
  beyond the audited tree; `requirements.txt` untouched (frozen boundary).
- Harness stayed on the shipped pins (httpx/pydantic/stdlib); the streaming
  reader got one constructor seam (an injectable httpx transport) so the
  live read is unit-tested over `httpx.MockTransport`; venue latency
  observations are rejection round-trips — the FSM-compile slot stays empty
  until the parser pin.
- Suites: `agent-service` 609→659 tests green (50 new); `tests/
  config-validator` 667 green (the dependency-evidence pin gate); ruff
  check + format clean on the new files. One pre-existing flake noted:
  `test_noagent_lane.py::test_slot_releases_on_cancellation` failed once
  under full-suite load, passed solo and on the final full run.

### 2026-11-21 — review round (harness hardening, same files)

- `connection_aborted` now records OBSERVED teardown: `HttpxSseStream`
  carries a `connection_closed` flag set when its response/client blocks
  unwind, an `aclose()`, and a content-type guard (a 200 JSON body raises
  the typed transient, never reads as an eventless stream); the demo
  cancels, calls `aclose()`, and records abort = cancelled AND teardown.
- The loop demo proves dispatch: `LoopCancelObservation.model_post_dispatched`
  (recording transport wrapper), the model id pre-resolved from the run's
  identity as the client override so the cancel lands on the POST, not the
  discovery leg.
- Exit-0 semantics extracted into a pure `acceptance_verdict` (identity +
  every cell valid + streaming cancelled/aborted/not-delivered + loop
  propagated/in-flight/dispatched/no-terminal-events); `_main` prints the
  acceptance block and, on a failed run, a JSON error record — never a
  traceback.
- Streaming judge gates on TOOL-CALL-bearing deltas (a blob amid content
  deltas fails); first-call latency slots only fill from error-free cells
  and the record names the feeding cell (`first_call_cell`); a plain
  (no-tools) control completion joins the record; discovery uses the
  probe's `probe_bearer` rule; `max_model_len` refuses bool; non-dict SSE
  events never count as deltas; parser-flag 400s summarize into a
  machine-readable `rec6_serving_flags` note.
- Suite: 70 tests in `tests/test_agent_verification.py` (50 → 70), ruff
  clean. Live evidence re-gathered by the coordinator after this round.
- Correction within this round (live-run finding): the first teardown patch
  never closed the stream (the demo read the flag but no code called
  `aclose()`), so the live run reported `connection_aborted: false`, the
  generator leaked to loop-shutdown GC, and that finalization crashed with
  `RuntimeError: generator didn't stop after athrow()` — the classic
  awaiting-inside-GeneratorExit trap. `HttpxSseStream` was restructured to
  own its client/response as attributes (no asynccontextmanager): the
  generator's unwind is await-free, `aclose()` closes generator → response
  → client as ordinary awaited calls, the demo and the streaming cell close
  what they consume. Suite: 70 passed under `-W error::ResourceWarning`,
  no traceback noise; live re-run 15:30 UTC: `connection_aborted: true`
  (observed teardown), `model_post_dispatched: true`, 679 tests green.
  The V06 record cites this run as the final one.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

| Round | Finding | Verdict | Evidence / disposition |
|---|---|---|---|
| L1 (v-gap) | `connection_aborted` measures the consumer's CancelledError, not connection teardown — the flag cannot fail when the abort stops happening | high (real) | patch: the stream reports its own teardown (flag in the unwind path + explicit aclose after cancel); MockTransport cancel-mid-read test pins it |
| L1 (v-gap) | `in_flight_model_call_cancelled` reachable before the POST is dispatched (token fires pre-await; live wall clock 0.0042 s consistent) | high (real) | patch: the recorder transport fires the token at post dispatch and records `model_post_dispatched`; demo pre-resolves the model id so the cancel lands on the POST; ordering asserted in test |
| L1 (v-gap) | `_main` exits 0 on an all-invalid-but-executed matrix | medium (real) | patch: exit 0 only on full acceptance semantics (every cell valid, demos proven); pure verdict function, tested |
| L1 (blind) | streaming judge counts ALL deltas (`delta_count < 2`); a blob tool call + content deltas passes the no-blob contract | medium (real) | patch: judge on tool-call-bearing deltas; blob call + content deltas test added |
| L1 (blind) | `first_call_latency` records the first cell per schema even when it errored (a 400 poisons the FSM slot) | medium (real) | patch: record the first error-free cell per schema and name its cell |
| L1 (blind) | plain non-streaming control claimed in the record prose but produced by nothing | medium (real) | patch: harness adds one plain non-streaming control call to the evidence; record cites it |
| L1 (edge) | `_main` lets a discovery failure crash — traceback instead of a JSON evidence record | medium (real) | patch: catch the typed transient, print a JSON error record, exit 1 |
| L1 (blind) | ops-side parser pin (the binding 2.5 dependency) tracked nowhere | medium (real) | tracker action: issue filed (`status::backlog`), linked from record + ADR |
| L1 (edge) | discovery bearer rule differs from the probe client's (`_auth_headers` vs `probe_bearer`) while the docstring claims the same discovery | low (real) | patch: align the discovery credential rule with the probe client's |
| L1 (edge) | `max_model_len` bool passes `isinstance(int)` — identity can carry a bogus window | low (real) | patch: bool-excluding type check (mirrors `_json_type_matches`) |
| L1 (edge) | `_consume_stream_events` counts a non-dict SSE payload as a delta | low (real) | patch: isinstance check precedes the increment |
| L1 (blind) | SSE reader has no content-type check — a 200 JSON error body reads as "no tool call issued" | low (real) | patch: raise the typed protocol error on a non-event-stream content type; multi-line `data:` documented unsupported (no venue emits it) |
| L1 (blind) | `judge_cell` docstring ("at least one well-formed call") contradicts code (every call's issues count) | low (real) | patch: docstring aligned to the code's contract |
| L1 (blind) | `_discover_model` truncates at `[:200]` vs the module's 300-char constant | low (real) | patch: constant used |
| L1 (blind) | story Verification section still expects probe `outcome=answered`; the recorded run is `error` | low (real) | patch: annotation naming the current venue expectation + the REC-6 root cause (frozen row stays — it is the healthy-venue expectation) |
| L1 (blind) | Appendix heading says "verbatim" while repeated error strings are collapsed | low (real) | patch: heading reworded (rewrite lands with the re-gathered machine record) |
| L1 (blind) | no test asserts the streaming cell payload carries `stream: true` | low (real) | patch: assertion added |
| L1 (blind) | no machine-readable tool-calling posture in the evidence (parser axis prose-only) | low (real) | patch: a note is appended to the record when cell errors carry the parser-flag messages |
| L1 (blind) | evidence carries no producer revision (SHA) | low — rejected | the record and the producer land in the same commit; a SHA inside the record is self-referential; the 2.5 re-run ties via the repo state both carry |
| L1 (edge) | streamed tool-call `index` could be a non-int string, splitting slots | low — rejected | no venue emits non-int indices; the judge still yields an honest invalid-with-reasons verdict; a coercion guard is complexity for a hypothetical shape |
| L1 (blind) | ADR swap-cost table: OpenAI SDK / LangGraph rows carry "Not estimated" vs the AC's "every candidate" | false | those rows are not candidates — addendum §D: "Not active candidates unless D03 reopens"; the AC binds candidates, and the three candidates (custom loop, pydantic-ai, DSH) all carry scope + estimate |
| L1 (blind+edge) | client-disconnect propagation "never demonstrated" (both demos cancel via token) | false | a disconnect's runtime-level manifestation IS the abort of the in-flight model stream — what the streaming demo demonstrates (parked consumer = stopped-draining shape); disconnect DETECTION on the client socket is story 2.4's explicit gate, which the AC itself defers ("full request-path integration is gated separately in 2.3/2.4"); the record states the phase split |
| G2 | acceptance gate's `connection_aborted` component is vacuous on the live path (the demo's own unconditional aclose always flips the flag); docstring overclaims "it aborted the connection, not an already-dead one"; a server-side close during the park is undetectable | low (real) | patch: the gate component and docstring say what is observable — the demo PERFORMED the teardown (client-side abort is what the runtime-level AC names; mid-stream-ness is unobservable client-side); wording aligned in gate + docstring |
| G2 | `_discover_model` crashes untyped (KeyError/TypeError) on a malformed discovery body — the try/except wraps only `get_json` | low (real) | patch: isinstance guard on the data entry; the typed transient names the malformed shape |
| G2 | a streamed tool-call delta with no `index` defaults to slot 0 — parallel calls merge on a spec-violating venue and the recorded reason misattributes | low (real) | patch: an absent index is its own recorded issue instead of a silent slot-0 merge |
| G2 | `HttpxSseStream.events()` overwrites `_agen` on a second call — the first generator's client leaks until GC | low (real) | patch: a second live `events()` call raises instead of silently leaking |

## Design Notes

- The harness is verification tooling beside `probe.py`, not production loop code: it shares the seam's primitives (loop, cancellation, registry fakes) and the recorded payload conventions, and owns only the pieces V06 needs that nothing else has — the streaming read and the per-cell judgment.
- The parser axis is server-side configuration the client cannot set; the matrix validates the deployed server AS FOUND (version + model read from the endpoint, parser behavior observed) and the record names the prerequisite a deployment must pin for each mode.
- FSM-compile latency is observed as first-call-per-schema latency, recorded per cell — it informs the orchestrator's budget sizing (2.3), it decides nothing here.

## Verification

**Commands:**
- `cd components/agent-service && python -m pytest tests/ -q` -- expected: all suites green including the new verification suite
- `cd components/agent-service && ruff check agent/ tests/test_agent_*.py && ruff format --check agent/` -- expected: clean
- `python scripts/dependencies/verify-dependency-licenses.py --verify components/agent-service/requirements.txt components/agent-service/requirements-test.txt --evidence docs/dependencies/agent-service-dependency-evidence.json` -- expected: exit 0
- `python -m agent.verification` (live, venue env) -- expected: one JSON evidence record with per-cell verdicts
- `python -m agent.probe` (live, venue env) -- expected: `outcome: answered` evidence record
  -- venue note (2026-11-21): on the CURRENT venue both live commands end at the model leg
  (`outcome: error` / the parser-flag 400s) until the ops-side tool-parser pin (issue #2052)
  lands; the `answered` expectation above is the healthy-venue reading of the frozen matrix row.
