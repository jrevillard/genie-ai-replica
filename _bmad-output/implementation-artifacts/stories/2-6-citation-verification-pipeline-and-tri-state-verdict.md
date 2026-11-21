---
title: 'Story 2.6 — Citation verification pipeline and tri-state verdict'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '83e00771fe61f843a1da97b507197dc2962c177b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1964 acceptance criteria, operator-authored">

## Intent

**Problem:** The governed loop answers but verifies nothing: no mechanical check ties the answer's citations to what the run actually retrieved, no judged grounding check exists, and no honest tri-state verdict reaches the client — the stream cannot tell a grounded answer from an unsupported one, or a failed verification from both.

**Approach:** Implement the verification pipeline in `components/agent-service/agent/` — a run-scoped retrieval ledger fed by tool results, the inline mechanical reference-validity check (no LLM, always on), the budgeted grounding judge at finalize, and the `verdict` seam event carrying the tri-state projection the BFF maps onto `agent_verdict` and `metadata` — emitted after the last text event and before the terminal, under the `verdict-marked` iteration-1 policy.

**Acceptance criteria (issue #1964, the contract):**
- Given a drafted answer with citations, when verification runs, then reference validity is checked inline per citation against the actually-retrieved stable source ids (mechanical, no LLM, always on — no policy disables it).
- And the grounding judge runs at finalize within the budget; its absence/timeout yields `unverified`, never `grounded`.
- And the verdict is tri-state `grounded|ungrounded|unverified`: `agent_verdict` is emitted after the last chunk and before metadata; the metadata frame carries `grounding_status` and the derived legacy `is_grounded` (true iff grounded); verdict scope is the source-language text, with the translation mode recorded so a translated answer never inherits the claim.
- And under `verdict-marked` (iteration-1 policy), a failed verdict produces the correction event and persisted marking — never silence.
- And auxiliary calls (judge, classification, translation) emit no `agent_activity` event.

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- An **emitted citation** is one provenance entry in the run's evidence ledger — a source whose structured identity and passage text were served to the model through a successful tool result in THIS run (`search_knowledge` hits, `read_source` results). The ledger is the only source of citations; nothing invented, nothing from an error envelope.
- Reference validity is mechanical and per-citation: (1) the citation's provenance is in this run's ledger, (2) when it carries `repo_id`, that repo is in the caller's authorized repos. A failing citation is dropped from the delivered set and recorded — and the verdict can then not be `grounded`.
- Mechanical outcome decides before the judge: no successful retrieval at all → `unverified` (an insufficiency answer claims nothing; judge skipped); retrieval succeeded but the delivered citation set is empty or carried invalid entries → `ungrounded` (claims without support, FR-10); otherwise the judge decides.
- The judge is ONE auxiliary model call at finalize, budgeted through the monitor (`check_wall_clock`, `take_aux_model_call`, `max_output_tokens` = remaining allowance) and hard-bounded by a required timeout knob; timeout, budget exhaustion, absence and malformed output all yield `unverified`, never `grounded`.
- The `verdict` seam event fires only on the answered path, after `text_message_finished` and before `run_finished`; its payload is the single projection contract (`grounding_status`, derived `is_grounded` true iff grounded, `translation_mode` recorded at finalize as `"none"` — the BFF overwrites it when a translation is delivered —, the delivered citation set for `source_documents`, judge outcome, marking).
- `marking.required` is true iff policy is `verdict-marked` AND status is `ungrounded`; the payload carries it for the BFF's queries-doc persistence. `unverified` and `grounded` mark nothing; the metadata tri-state still surfaces them (never silence).
- The policy knob is deployment-level, default `verdict-marked`; iteration 1 implements only that value — any other value (enum member or garbage) fails the orchestrator config load naming the knob, and no value disables verification.
- The two new knobs (`AGENT_VERDICT_POLICY`, `AGENT_VERDICT_JUDGE_TIMEOUT_MS`) follow the fail-closed `AGENT_*` discipline; the judge timeout is REQUIRED, the policy has its default.

**Never:**
- No BFF frame writer, no client frame, no client frame name in the seam vocabulary (the seam kind is `verdict`, not `agent_verdict` — the import-time guard holds); the frame projection and the queries-doc marking write are 2.4/2.5.
- No answer translation or translation call in this story (2.10); no legacy-path (noagent/chatqna) behavior change — their `is_grounded` heuristics are frozen by the V05 contract.
- No inline text citation markers, no answer-text rewriting, no prompt-only citation instruction (REC-5: prompt-only enforcement rejected).
- No new runtime dependency, no `comps` import (FR-20); no pydantic-ai/DSH spike (D03 is 2.2).
- No `response_format` protocol change on `LoopModelClient` — the judge's JSON rides the prompt, malformed output is `unverified`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grounded answer | Valid citations, judge completes `grounded` | `verdict` event: `grounding_status=grounded`, `is_grounded=true`, marking not required | N/A |
| Unsupported answer | Valid citations, judge completes `ungrounded` | `verdict` event: `ungrounded`, `is_grounded=false`, `marking.required=true` | Judge reason recorded in payload |
| Hallucinated reference | Ledger has no entry for a served identity | The citation is dropped, recorded as invalid; verdict `ungrounded`, judge skipped | Per-citation invalid detail in payload |
| No retrieval at all | Every search returned insufficiency/empty | `unverified`, judge skipped; no marking | Insufficiency answers never marked ungrounded |
| Judge timeout | Judge exceeds `AGENT_VERDICT_JUDGE_TIMEOUT_MS` | `unverified`, never `grounded`; judge outcome `timeout` | Cancelled judge call, run unaffected |
| Judge over budget | `take_aux_model_call` raises BudgetExhausted | `unverified`, judge outcome `budget_exhausted` | Run terminal state unchanged |
| Malformed judge output | Judge text not parseable JSON / wrong shape | `unverified`, judge outcome `error` | Never parse-guessed into `grounded` |
| Run fails/cancelled | No answer text (error, budget, cancellation) | NO verdict event; terminal contract unchanged | N/A |
| Unimplemented policy | `AGENT_VERDICT_POLICY=verdict-silent` | Config load error naming knob, value and the not-implemented reason | Run surface 503 (`run_surface_unconfigured`) |
| Missing judge timeout | Knob unset/empty/non-positive | `MissingKnobsError` naming it | Run surface 503 with `missing_knobs` |

## Code Map

- `components/agent-service/agent/verification.py` -- NEW: `RetrievalLedger` (per-run record of tool-result outcomes + served provenance/passages; insufficiency-aware), `ReferenceValidity` (the mechanical per-citation check), `GroundingJudge` (one budgeted aux call, timeout, strict JSON), `VerificationPipeline` (orchestrates: ledger → validity → judge → `VerdictProjection`), `Verdict` (tri-state enum + payload builder).
- `components/agent-service/agent/events.py` -- add `VERDICT = "verdict"` to the closed vocabulary; `BFF_FRAME_NAMES` guard already blocks `agent_verdict` (events.py:39); docstring notes the projection seam `verdict` → client `agent_verdict`.
- `components/agent-service/agent/loop.py` -- `AgentLoop` gains `verifier`; `_dispatch_tool` feeds every result payload to the ledger (error envelopes included — the ledger classifies them); `_finish` runs verification between `TEXT_MESSAGE_FINISHED` and `RUN_FINISHED` and emits the `verdict` event; `_fail`/cancellation paths emit none.
- `components/agent-service/agent/orchestrator.py` -- `OrchestratorConfig` reads the two new knobs fail-closed (`policy` validated: only `verdict-marked` in iteration 1); `run()` builds the per-run `VerificationPipeline` (ledger + judge with the run's model client + monitor) and hands it to the loop.
- `components/agent-service/agent/budget.py:200` -- `take_aux_model_call()` (shared model-call budget, aux tallied separately) — consumed as-is; `remaining_output_tokens()` bounds the judge's output.
- `components/agent-service/agent/probe.py` -- the probe harness builds its own loop: verification optional (`verifier=None` there, documented), smoke unaffected.
- `components/agent-service/capabilities/contract.py:267-292` -- `LegacyFileProvenance{file_id}` / `OkfConceptProvenance{source:"okf-concept", concept_id, repo_id, bundle_version}` — the stable source ids; `SearchHit{provenance, text, score}` (:336).
- `components/agent-service/capabilities/search_knowledge.py:284-298` -- hit minting: provenance from the enriched candidates; insufficiency outcome codes — the ledger's raw material.
- `components/agent-service/noagent/pipeline.py:116-187,477` -- `source_document_envelope` (the source_documents variants) + the frozen `is_grounded` heuristic — projection target shape, NOT modified.
- `components/gov-chat-backend/routes/query-routes.js:162-173,701-776` + `services/query-service.js:891-914` -- client metadata frame + `finalizeStreamQuery` — where 2.4/2.5 project `grounding_status`/`is_grounded` and persist the marking; read-only reference.
- `components/agent-service/tests/conftest.py` -- `ScriptedLoopModel`/`HangingLoopModel` doubles (one-home rule) — the judge suite reuses them.

## Tasks & Acceptance

**Execution:**
- [ ] `components/agent-service/agent/verification.py` -- ledger, mechanical reference validity, budgeted grounding judge (timeout knob, strict JSON), tri-state verdict + projection payload builder -- the pipeline
- [ ] `components/agent-service/agent/events.py` -- `VERDICT` kind + docstring projection note -- the seam vocabulary
- [ ] `components/agent-service/agent/loop.py` -- verifier wiring: ledger feed in `_dispatch_tool`, finalize verification + `verdict` emission in `_finish` -- the answer-path integration point
- [ ] `components/agent-service/agent/orchestrator.py` -- policy + judge-timeout knobs fail-closed; per-run pipeline construction -- the governed wiring
- [ ] `components/agent-service/agent/probe.py` -- smoke path documented with `verifier=None` -- probe stays green
- [ ] `components/agent-service/tests/test_agent_verification.py` -- NEW: validity (valid/invalid/unauthorized/empty), judge (grounded/ungrounded/timeout/budget/error), mechanical pre-judge rules, payload contract (`is_grounded` derivation, `translation_mode`, `marking`) -- the ACs as executable checks
- [ ] `components/agent-service/tests/test_agent_loop.py`, `test_agent_events.py`, `test_agent_orchestrator.py`, `test_app_runs.py` -- extend: verdict position pinned (after last text event, before terminal), no aux `agent_activity`/tool events, knob failures 503/`MissingKnobsError`, cancelled run emits no verdict -- the seams
- [ ] `env` + `docker-compose.yaml` -- pass-through + docs for `AGENT_VERDICT_POLICY` (default `verdict-marked`) and `AGENT_VERDICT_JUDGE_TIMEOUT_MS` -- operators can size the deployment

**Acceptance Criteria:**
- Given a run whose answer cites ledger-traced sources, when verification runs, then the `verdict` event lands strictly between the last `text_message_finished` and `run_finished` with the tri-state payload.
- Given a judge that cannot complete (absence, timeout, budget, malformed output), when finalize verifies, then `grounding_status` is `unverified` and `is_grounded` is false — never grounded.
- Given an `ungrounded` verdict under `verdict-marked`, when the payload is projected, then the correction event exists (the `verdict` event's payload) and `marking.required` is true for the queries-doc persistence.
- Given any auxiliary call (judge here; classification/translation by their owners), when events stream, then no `agent_activity`-projecting tool event is emitted for it.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **The seam kind is `verdict`, not `agent_verdict`.** The events module's import-time guard already carried `agent_verdict` in `BFF_FRAME_NAMES` (the client frame names were pinned there since story 2.1), so the seam kind is `verdict` and the docstring pins the projection (`verdict` → client `agent_verdict`, position after the last chunk, before `metadata`). The guard suite's `EXPECTED_KINDS` grew by one.
- **`AgentLoop._finish` went async.** The verdict's judged call is async; `_finish` is now a coroutine and its call site awaits it. The probe harness is untouched — `AgentLoop.verifier` defaults to `None`, and the probe's `run_probe` docstring now states why (the smoke harness measures the loop, not the verdict).
- **The judge rides the prompt, not `response_format`.** The `LoopModelClient` protocol is unchanged (no new parameter, no implementer churn): the judge's system message carries the strict JSON contract, and `parse_judge_verdict` accepts ONLY a one-key object with verdict `grounded|ungrounded` — fenced JSON, prose, extra keys and unknown values are all a judge error, and a judge error is `unverified`.
- **The judge's wall-clock shape.** `check_wall_clock` runs before the judge claims the fleet budget, but the call itself is bounded by `AGENT_VERDICT_JUDGE_TIMEOUT_MS` — so the agent phase can overrun `deadline_ms` by at most that timeout. `docs/agent-budget-deadline-pairs.md` gained the judge-overrun ceiling in the V08 derivation (the pair rule's sum now names the knob).
- **The insufficiency case resolves to `unverified`, not `ungrounded`.** A run whose ledger holds no retrieval produced an insufficiency statement — it claims nothing, so there is nothing to ground and nothing to mark; the judge is skipped with no fleet-budget spend. Retrieval that happened but yielded nothing validly citable IS ungrounded (claims without support), mechanically, before any judge runs.
- **The dedup convention is shared.** `citation_identity` reuses the no-agent mapping's identity key (`(repo_id, concept_id)` / `(None, file_id)`), so a search hit and a `read_source` of the same document deliver ONE citation — the same rule the `source_documents` envelope will apply in 2.5.
- **Script helper grew one parameter.** `multihop_turns(judge_reply=...)` appends the judge's turn — the governed wiring (orchestrator-built pipeline) needs it scripted; the direct-loop suites keep the three-turn script. The app stream test now pins the full 10-frame shape including the verdict payload.
- **Knobs.** `AGENT_VERDICT_JUDGE_TIMEOUT_MS` is REQUIRED (fail-closed, in `REQUIRED_KNOBS`, empty env names it); `AGENT_VERDICT_POLICY` defaults to `verdict-marked` and any other value — enum member or garbage — refuses the config load naming the knob (`ValueError` → the run surface's 503 `run_surface_unconfigured`). Documented in `env` + `docker-compose.yaml` pass-through.
- **Config-validator** needed no change: its agent-service gates assert structural parity (image/flag/replicas), not the knob list; the two new vars follow the 2.3 pattern (root `env` + compose pass-through only).

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

### Global review G1 (2026-11-21, xhigh effort, whole branch)

| Finding | Verdict | Disposition |
|---|---|---|
| Insufficiency answers marked `ungrounded` + marking (ledger keyed `unverified` on `retrieval_attempted`, which any dispatched search/read sets) | high — real, contradicts this spec's own I/O matrix and the story mapping table | FIXED: the `unverified` branch now keys on the ledger's `entries` (citability), the flag is deleted; insufficiency outcomes, error envelopes and malformed results cite nothing → `unverified`, no marking. Finalize-level tests added for both. |
| `_run_stream` leaks a pending `events.get()` task on client disconnect (finally cancels only `run_task`) | high — real | FIXED: `getter.cancel()` in the `finally` (no-op on the done getter); the disconnect test now asserts the loop holds no pending task after the cancellations settle. |
| `ProbeModelClient.complete` sends `tools: []` + `tool_choice` unconditionally — strict endpoints answer 400, every judge verdict degrading to `unverified` | high — real portability defect | FIXED: `tools`/`tool_choice` omitted when the definition tuple is empty (the judge's no-toolset case); test pins the omission. |
| `POST /v1/runs` takes `CallerContext` from the body — no caller auth | nit — real but owned elsewhere | Already handled by the slice contract: the trusted-caller-context rule assigns server-side assembly to the BFF (story 2.4); the surface is internal-only, declares no gateway route and ships dark (`AGENT_ENABLED=0`) — the spine's deployment shape documents it. No change in 2.6. |
| Judge claims the aux slot before reading the output bound — usage record counts a call that never happened | nit — real ordering wart | FIXED: the remaining allowance is read first; a spent token budget refuses before `take_aux_model_call`. Test pins the zero-claim. |
| Policy error preempts the aggregated missing-knob refusal (one defect at a time) | nit — real | FIXED: the `MissingKnobsError` aggregation runs first; test pins the precedence. |
| `tei_reranking._tei_scores` calls `json()` before the status check — non-JSON upstream errors lose their status, non-JSON 422 loses the too-long abstention | nit — real, PRE-EXISTING (adapter predates 2.6, untouched by it) | Filed as issue #2056 (`type::bug`, `area::tei`, `status::backlog`) — out of this story's scope. |

### Global review G2 (2026-11-21, whole branch vs origin/main — note: most findings land on pre-existing Epic 1/2.1 code, not this story's diff)

| Finding | Verdict | Disposition |
|---|---|---|
| `arango_retrieval.dense_search` raises `TypeError` on a null embedding score OUTSIDE its try — a run errors where the recorded behavior is dense-only degradation | high — real, PRE-EXISTING (Epic 1 adapter, V02-frozen file, untouched by 2.6) | Filed as issue #2057 (`type::bug`, `area::retriever`, `status::backlog`). |
| `RequestsTransport` docstring claims per-caller cookie isolation; the shipped one-Session-per-process wiring shares cookies across callers | nit — real, PRE-EXISTING | Filed as issue #2058 (`type::bug`, `area::backend`, `status::backlog`). |
| compose never maps `VLLM_API_KEY`/`OPENAI_API_KEY` — every run fails at model auth with no knob named | nit — real, PRE-EXISTING deployment gap | Filed as issue #2059 (`type::bug`, `area::deploy`, `status::backlog`). |
| `_env_bool` accepts only `"true"` — the repo's 0/1 convention silently reads false (`AGENT_ANSWER_TRANSLATION_ENABLED`) | nit — real, PRE-EXISTING | Filed as issue #2060 (`type::bug`, `area::backend`, `status::backlog`). |
| compose/env comments say an invalid `AGENT_VERDICT_POLICY` is "refused at startup"; the config loads lazily (first run request), container boots green | nit — real, on THIS diff's comments | FIXED: wording corrected to "refused at the first run request (503 naming the knob; the config is read lazily)" in both `env` and `docker-compose.yaml`. |
| `GroundingJudge` timeout under-counts the judge's server-side spend in the usage record | nit — inherent to timeout, not a code defect: a timed-out call's response (the only usage carrier) never arrives; nothing reportable exists | Documented: the judge's docstring now states the lower-bound honesty rule (same mechanism as the usage-gap path). |
| One malformed model tool call (empty/hallucinated name) is fatal to the run instead of a structured tool result | nit — deliberate 2.1 contract (the registry refusal ends the run honestly; the loop docstring records it) | Already handled — behavior re-declaring is a 2.1-scope change, not this story's. |
| Story/AD/FR refs in production comments across the new tree | nit — operator convention (comments describe the code, no refs) | FIXED for every comment THIS diff added (verification/loop/events/env/compose); pre-existing files' comments are their stories' output, not this diff's. |

## Design Notes

**Why the ledger defines citations.** The client citation surface is `metadata.source_documents` (no inline text markers exist anywhere — frontend, mobile, BFF). A citation the user can click must resolve to a source the run actually served; the ledger makes "actually-retrieved" a recorded fact instead of an assumption, and the mechanical check turns that fact into the invariant "every delivered citation resolves".

**Payload example (grounded):**

```json
{
  "grounding_status": "grounded",
  "is_grounded": true,
  "translation_mode": "none",
  "policy": "verdict-marked",
  "judge": {"ran": true, "outcome": "completed"},
  "citations": [{"file_id": "f1", "text": "...", "score": 0.83}],
  "marking": {"required": false, "reason": null}
}
```

**Judge call shape:** system = the fixed judge prompt (JSON verdict schema in-prompt); user = answer text + numbered cited passages; `complete(messages, (), max_output_tokens=remaining)`. The aux call reuses the run's `LoopModelClient` — same endpoint, counted by `take_aux_model_call`.

## Verification

**Commands:**
- `cd components/agent-service && python -m pytest tests/test_agent_verification.py tests/test_agent_loop.py tests/test_agent_events.py tests/test_agent_orchestrator.py tests/test_app_runs.py` -- expected: all pass
- `cd components/agent-service && python -m pytest` -- expected: whole suite green (no regression)
- `cd components/agent-service && ruff check .` -- expected: clean (CI `lint:agent-service`)
- `cd tests/config-validator && npm test` -- expected: green with the two new vars documented (if the whitelist covers them)
