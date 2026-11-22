---
title: 'Story 2.11 — Execution attribution and observability'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '7e59deae7dd90413edb5a347175532db13656204'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1969 acceptance criteria, operator-authored">

## Intent

**Problem:** No agent execution is attributable today: no execution-version record exists anywhere (grep-verified — `RUN_STARTED` carries only the question; the BFF persists only `run_id` + counters at successful finalize), so a cancelled, timed-out or crashed run leaves the `queries` doc with no versions and no honest terminal state (mid-stream error/timeout writes nothing). The run path is unobservable: `agent/` emits no spans, outbound model/doc-repo calls carry no traceparent, agent-service emits no metrics (invisible to the existing dashboards), and the service lacks the compose↔source `OTEL_SERVICE_NAME` pair (AD-11).

**Approach:** Build the execution-version record (implementation, model, prompt, configuration ids) at run assembly, carry it on the `RUN_STARTED` seam event, and have the BFF persist it into the `queries` doc AT START; every terminal path — success, seam `run_error`, client disconnect, BFF deadline abort, upstream death before final metadata — then updates the doc with an honest outcome. Give agent-service run-path spans and outbound traceparent propagation, emit the http-server metrics the existing dashboards discover by `service_name`, and add the OTel env pair. No dedicated admin UI; no credentials in records (FR-17/FR-18, AD-11).

## Boundaries & Constraints

**Always:**
- AD-11 handshake shape: agent-service emits the run-start seam event carrying the execution-version record; the BFF persists it into the `queries` doc at start (the doc already exists, `isAnswered:false`); the final metadata frame carries the completed record and the terminal outcome. Cancelled, timed-out and crashed runs keep their versions and an honest terminal/interrupted state.
- Version records carry ids/fingerprints only — never credentials, never prompt bodies (a hash only), never question/answer text.
- Honest outcome vocabulary on the doc's `metadata.agent_run.outcome`: the agent outcome codes (`answered`, `error`, `budget_exhausted`) verbatim from the usage record; BFF-terminal states `cancelled` (client disconnect), `timed_out` (BFF deadline abort), `interrupted` (upstream stream error/close before a terminal event). `isAnswered` never flips true outside the success finalize.
- Client API untouched: an additive payload key on the seam's `run_started`; additive fields inside `metadata.agent_run`; the five existing SSE frame types and the two agentic event types unchanged; the legacy path byte-identical.
- Tracing stays the AD-11 port of the overlay pattern, comps-free (passes the AD-1 gate): spans on the run path via `tracing.with_span`; W3C traceparent propagation BFF → agent-service (existing http instrumentation) → model/doc-repo outbound calls (httpx/requests instrumented behind the same `ENABLE_OBSERVABILITY` gate).
- New pinned dependencies pass the pre-adoption checklist (V07a licence + defaults audit) like every other pin.

**Never:**
- No new stores or doc shapes (AD-12): everything rides additively inside the existing `metadata.agent_run` block of the `queries` doc.
- No new dashboards and no hardcoded service panels: the existing dashboards discover services by the `service_name` label — make agent-service emit what they already query; do not edit `configs/grafana/**` (so no chart-copy resync, no chart bump).
- No OPEA imports anywhere in the new code.
- Nothing sensitive in records: bearer tokens, API keys, full prompt text, question or answer text never enter version records, usage records, span attributes, or the doc.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy run | Admitted run, versions resolvable | `run_started` carries `execution_versions`; the doc holds them at start (`isAnswered:false`); finalize writes outcome `answered` + the completed record | N/A |
| Cancel before first token | Client disconnects after `run_started`, before any chunk | Doc keeps versions, `outcome: cancelled`, `isAnswered:false`, no fabricated response | Slot release per 2.3 unchanged |
| Timeout during judge | BFF deadline aborts after chunks, before metadata | Doc keeps versions, `outcome: timed_out`; today's error contract for the client unchanged | Upstream leg aborted |
| Kill before final metadata | Upstream stream error/close after chunks, before metadata | Doc keeps versions, `outcome: interrupted` | Today's error frame unchanged |
| Seam `run_error` | `RUN_ERROR` + usage record (`budget_exhausted` or `error`) | Doc outcome = the usage-record outcome verbatim | Today's error frame unchanged |
| Model id unresolvable at start | Endpoint `/v1/models` unreachable at assembly | Record carries the configured id (or null) + an unresolved note; the run proceeds | Fail-soft, recorded |
| Observability off | `ENABLE_OBSERVABILITY=0` | SDK no-op; the version handshake is pure code and unaffected | N/A |

</frozen-after-approval>

## Code Map

- `components/agent-service/agent/events.py:41-67,85-129` -- seam envelope + closed `EventKind` vocabulary; `RUN_STARTED` emitted at `agent/loop.py:175` with payload `{"question"}` (orchestrator pre-loop failure: `agent/orchestrator.py:428`).
- `components/agent-service/agent/orchestrator.py:136-180,219-255,416-430` -- `OrchestratorConfig.load` (fail-closed knobs, the fingerprint's input), `RunUsageRecord` (counters only), cancellation logs partials and re-raises, pre-loop failure emits `RUN_STARTED`+`RUN_ERROR`.
- `components/agent-service/agent/probe.py:321-343` -- `_resolve_model_id` (override first, then `/v1/models`); the model id source for the record.
- `components/agent-service/agent/prompt.py:28-37` -- `PRODUCTION_SYSTEM_PROMPT`, override knob `AGENT_RUN_SYSTEM_PROMPT` (`orchestrator.py:177`); unversioned today.
- `components/agent-service/tracing.py` -- the AD-11 port: `setup_tracing`, `with_span`, `RedactingSpanProcessor`, FastAPI instrumentor; `app.py:50-62` wires it. Outbound httpx/requests NOT instrumented; `requirements.txt:51-60` carries only `-fastapi`/`-asgi`.
- `components/agent-service/preparation/prepare.py:135`, `noagent/pipeline.py:273` -- the only two spans today; `capabilities/adapters/http.py:26-52` (requests-based doc-repo/OKF calls) and `preparation/translation.py:252-273` (`HttpxTransport`) are the outbound hops to cover.
- `components/gov-chat-backend/services/agent-frame-writer.js:402-409` -- `run_started`/`run_finished` are explicit no-ops; `runId` captured `:401`. Terminal paths: disconnect `:153-184` (partial save only when partial text exists), seam `run_error` `:455-465` (no doc write), upstream error `:509-517` / close `:533-541` (no doc write), deadline abort `:135-144` (no doc write).
- `components/gov-chat-backend/services/agent-run-contract.js:200-229` -- `assembleAgentMetadata`, `metadata.agent_run = {run_id, usage_record}` at `:224-227` (the 2.11 hook); success finalize `query-service.js:1092-1115`; non-streaming tail `:1356-1369`.
- `components/gov-chat-backend/routes/query-routes.js:326-342` -- `initStreamQuery` runs BEFORE `proxyAgentRun`: the doc exists when `run_started` arrives.
- `components/gov-chat-backend/services/query-service.js:587-641` -- `initStreamQuery` mints the doc without `metadata`; a run-start update must create the `metadata.agent_run` path it later merges with.
- `docker-compose.yaml:1459-1460` -- agent-service carries `logging: *fluent-logging` (the fluentd anchor: exists); env block lacks `ENABLE_OBSERVABILITY` / `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` (the pair convention: `docker-compose.yaml:921-931` is the backend pattern).
- `configs/grafana/provisioning/dashboards/service-health.json`, `rag-pipeline-trace-waterfall.json` -- both discover services via `label_values(…, service_name)`; the collector's `prometheusremotewrite` turns `service.name` into the `service_name` label. Emitting http-server duration metrics makes agent-service appear — no dashboard edit.
- `tests/config-validator/__tests__/agent-service.test.js` -- the compose/env/source checks this story extends (OTel pair, fluentd anchor, licence pins).

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/agent/version_record.py` (NEW) -- `IMPLEMENTATION_VERSION` (single source, imported by `app.py`'s FastAPI `version`), `PROMPT_VERSION`, `build_execution_version_record(...)` returning `{implementation, model, prompt, configuration}`: prompt = `{version, sha256}` over the EFFECTIVE prompt (override hashable too); configuration = sha256-over-canonical-JSON fingerprint + the resolved non-secret knob values of `OrchestratorConfig`; model = `{id, source, note?}`; no secret can enter (inputs audited) -- the FR-17 record
- [x] `components/agent-service/agent/orchestrator.py` -- build the record at run assembly (model id resolved fail-soft per the matrix row) and emit it on `RUN_STARTED` payload as `execution_versions` (both the loop path and the pre-loop failure path) -- the run-start handshake emission
- [x] `components/agent-service/tracing.py` + `requirements.txt` -- instrument outbound httpx + requests behind the observability gate; add the two instrumentation pins with their pre-adoption licence/defaults audit entries -- W3C propagation on every outbound hop
- [x] `components/agent-service/agent/orchestrator.py` + `agent/loop.py` (+ `capabilities/` call sites where a span belongs) -- run-path spans (`agent.run` parent; per-model-call, per-tool-call, verification/judge children) via `tracing.with_span`; attributes are counters/ids only -- the run path observable
- [x] `docker-compose.yaml` (agent-service env) -- `ENABLE_OBSERVABILITY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME=agent-service` per the backend pattern (:921-931) -- the compose↔source pair
- [x] `components/gov-chat-backend/services/query-service.js` -- one additive method persisting the run-start block (`metadata.agent_run = {run_id, execution_versions, started_at}`) and one additive outcome patch (`metadata.agent_run.outcome` + `finished_at`) that merges without clobbering -- the doc writes
- [x] `components/gov-chat-backend/services/agent-frame-writer.js` -- consume `run_started` (persist versions via the new method), and write the honest outcome on EVERY terminal path: disconnect (incl. before-first-token), seam `run_error` (usage-record outcome verbatim), upstream error/close (`interrupted`), deadline abort (`timed_out`); `assembleAgentMetadata` (agent-run-contract.js) merges the run-start block + `outcome` into the success finalize instead of clobbering -- every run ends attributable
- [x] `components/gov-chat-backend/__tests__/` -- the matrix as executable checks, incl. the three named AC tests (cancel-before-first-token, timeout-during-judge, kill-before-final-metadata) + no-credentials assertion on the persisted block + legacy-path unchanged pins
- [x] `components/agent-service/tests/` -- version-record builder units (fields, hash stability, no secrets, override prompt hashed), `RUN_STARTED` payload carries the record (loop + pre-loop-failure), span emission on the run path, outbound traceparent injection -- the agent side of the AC
- [x] `tests/config-validator/__tests__/agent-service.test.js` -- extend: the OTel env pair present in compose; the fluentd anchor stays; the new pins carry licence evidence -- config-level AC
- [x] `docs/agent-budget-deadline-pairs.md` or the observability recipe doc -- the attribution/observability contract line (record fields, outcome vocabulary, dashboard discovery) -- the operator-facing contract

**Acceptance Criteria:**
- Given any admitted run, when it starts, then the run-start handshake persists implementation/model/prompt/configuration versions into the `queries` doc at start and the terminal outcome updates the doc at end — every terminal path writes exactly one honest outcome, and the three named failure cases (cancel-before-first-token, timeout-during-judge, kill-before-final-metadata) each leave versions + their honest state.
- Given the observability stack enabled, when the agentic path serves a request, then W3C traceparent propagates BFF → agent-service → model/doc-repo calls, run-path spans exist for the pipeline stages, container logs reach VictoriaLogs through the existing fluentd anchor, and the existing dashboards discover agent-service by `service_name` — no dedicated admin UI, no dashboard JSON edit.
- Given any persisted record (doc block, usage record, span attributes), when inspected, then it carries ids/fingerprints/counters only — no credential, no prompt body, no question/answer text.
- Given the legacy path and the V05 client contract, when the full suites run, then every legacy pin stays green unmodified and the client-visible SSE contract is unchanged.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **Record build (2026-11-22).** `agent/version_record.py` is pure — the
  orchestrator resolves the model axis through an OPTIONAL client protocol
  (`getattr(model_client, "model_identity", None)`; `ProbeModelClient`
  implements it — override first, then the same cached `/v1/models` GET the
  first model call runs, `ProbeTransientError` degrading to the unresolved
  entry with a truncated note). A client without the source (the test
  doubles, the probe harness) resolves to `unresolved` + note, so the
  record build can never fail a run; `_execution_versions()` additionally
  wraps the pure builder in a defensive catch. The build runs BEFORE the
  per-request try block — a slow discovery delays `run_started` by at most
  the probe timeout, the same discovery the first model call would pay
  anyway (cached).
- **Span nesting.** `agent.run` uses `tracing.background_span` (the
  ACTIVATING helper — `start_as_current_span`) precisely so the children
  opened with `tracing.with_span` (non-activating, parent-from-ambient)
  NEST under it and the outbound hops inherit it for traceparent
  propagation; `with_span` alone would have made every span a sibling of
  the ASGI server span. Refused dispatches (budget/step/token checks
  precede the span) open no span — spans cover DISPATCHED work only. No
  `capabilities/` executor spans were added: the per-tool-call span covers
  the port hop and the outbound client spans (httpx/requests
  instrumentation) cover the wire legs — another layer would double-count
  the same hop. `asyncio.to_thread` copies the trace context, so the
  requests-based doc-repo/okf GETs still parent correctly from the worker
  thread.
- **Outcome-write gates.** The streaming consumer gates the outcome patch
  on `res.headersSent` and the JSON consumer on a `legEstablished` flag
  (set after the 200 status ladder) — the pre-stream refusals (429/503/422)
  and a disconnect during the upstream wait write NOTHING, exactly as
  today. The one-honest-outcome latch (`outcomePersisted`) makes the first
  terminal fact win: a deadline fire's `timed_out` is never overwritten by
  the `interrupted` teardown it caused. Both consumers wrap the
  fire-and-forget writes in `Promise.resolve(...)` so a sync throw or a
  non-promise return from the injected service lands in the logged catch,
  never breaks the stream handler. On the streaming `run_error` path the
  outcome written is the event's `code` — the loop guarantees it equals the
  usage record's outcome that follows (the record itself is still not
  persisted: the run failed; the doc stays unanswered).
- **The JSON entry shares the writes** (`agent-json-result.js`): run-start
  persist on `run_started`, outcome patches on `run_error` (verbatim
  code) / stream error (`interrupted`) / deadline fire (`timed_out`); the
  success metadata assembles with `runStart` + `outcome: 'answered'` and
  createQuery's tail (which runs AFTER the doc mint — verified at
  `query-service.js` createQuery) completes the block. The throw paths
  keep the typed error contract untouched.
- **Config evidence.** The two instrumentation pins were audited from the
  artifacts (both Apache-2.0, licence sha256 `c71d239d…` — the same
  licence file the existing instrumentation rows carry); the install was
  verified in a venv built from the exact pinned tree (setuptools 81 still
  serves the `pkg_resources` entry-point read both packages perform).
- **env template untouched**: `ENABLE_OBSERVABILITY` /
  `OTEL_EXPORTER_OTLP_ENDPOINT` are already documented there;
  `OTEL_SERVICE_NAME` is hardcoded per service (the backend block's
  convention — compose block name and source `SERVICE_NAME` must move
  together, which the config-validator now pins for agent-service).
- **Agentic pins updated, legacy pins untouched.** The additive
  `agent_run` keys (started_at/execution_versions/outcome/finished_at)
  required updating the exact-shape pins in the two agentic suites; the
  legacy suite (`query-routes.test.js`, flag off) runs byte-identical code
  and passed unmodified (full backend suite green: 101 suites / 2662
  tests).

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log


### Global review C1 (2026-11-22, head 87cb4aca2)

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | compose agent-service block lacks `ARANGO_GRAPH_NAME` → silent `GRAPH` default vs the BFF posture's real graph | real, PRE-EXISTING (story 1.3 block; this diff only added OTel env lines) | linked issue, `status::backlog` — adjacent deployment-config gap, not this story's contract |
| 2 | `_mergeAgentRunMetadata` client-side read-merge-write races the finalize's wholesale metadata write | CONFIRMED, this story's code | FIXED (6b8123ec7): merge runs server-side in one AQL UPDATE over the doc's current state; suite assertions moved to the patch shape |
| 3 | ansible env.j2/group_vars carry none of the agentic run-surface knobs — activation path dead on ansible deployments | real, PRE-EXISTING (stories 1.3/2.3/2.10 never extended the ansible layer) | linked issue, `status::backlog` |
| 4 | `agentic-translation-leg.js` / `agent-residual-budget.js` have no production consumer; header claims one | real, PRE-EXISTING (story 2.10 landed the leg; the wiring story deferred) | linked issue, `status::backlog` |
| 5 | `docs/rollouts/v08-rollout.md` names a real username | real, PRE-EXISTING (story 3.3 artifact; no-real-names hygiene) | linked issue, `status::backlog` |

Note: the reviewer scoped the branch's full stacked chain (~60k lines), so four of five findings sit outside this story's diff; only finding 2 is 2.11 code. The disconnect-path instance of finding 2's race class was already fixed during step-03 verification; the run-start/success-path instance is the 6b8123ec7 fix.


## Design Notes

- **Version-record shapes** (the only new vocabulary):
  ```json
  {
    "implementation": {"version": "0.1.0"},
    "model": {"id": "<resolved-or-configured>", "source": "override|discovered|unresolved"},
    "prompt": {"version": "prod-1", "sha256": "<12 hex of the effective prompt>"},
    "configuration": {"sha256": "<12 hex over canonical JSON>", "values": {<resolved knobs>}}
  }
  ```
  `values` holds the fail-closed knob resolution (`OrchestratorConfig` — budgets, endpoint URLs, flags): numbers and URLs, never secrets. A prompt override changes `sha256` and sets `version: "override"` — the hash is the identifier, the version names the shipped template.
- **Outcome vocabulary on the doc** — `metadata.agent_run.outcome` ∈ `answered | error | budget_exhausted | cancelled | timed_out | interrupted`. The first three come verbatim from the agent's usage record; the last three are BFF-terminal facts the agent never learns (it got no terminal event either). `answer_interrupted` (ADR agentic-003) keeps its existing semantics; `outcome` is strictly additive alongside it.
- **Dashboard discovery is label-driven** — both `service-health` and the trace waterfall template on `label_values(…, service_name)`; the collector's `prometheusremotewrite` exports `service.name` as the `service_name` label. The FastAPI instrumentation already produces the http-server duration series the panels query (old/new semconv both covered by the panels' regexes); enabling the meter path + the env pair is what makes agent-service appear. Verified against the dashboard JSON, not assumed.
- **The usage record stays the terminal carrier on the wire**; the doc's completed record is assembled BFF-side (`agent_run` gains `outcome` + keeps `usage_record` + `execution_versions` from the start write). Success finalize MERGES the run-start block — a finalize that never arrives leaves the start write intact, which IS the cancelled-run guarantee.
- **Non-streaming entry** shares the frame-writer consumption (`agent-json-result.js` path): the same run-start/outcome writes apply; verify the doc is minted before the seam stream is consumed there (same `initStreamQuery`-before-consumption ordering as the streaming route).

## Verification

**Commands:**
- `cd components/agent-service && python -m pytest tests/` -- expected: green (new record/span/propagation suites + existing suites unmodified)
- `cd components/gov-chat-backend && npx jest __tests__/services/agent-frame-writer.test.js __tests__/services/agent-run-contract.test.js` (or the suites the new tests land in) -- expected: green, incl. the three named AC tests
- `cd components/gov-chat-backend && npm test` -- expected: full backend suite green (legacy pins untouched)
- `cd tests/config-validator && npm test` -- expected: green (extended agent-service checks)
- `rtk proxy npx eslint <touched js> && rtk proxy npx prettier --check <touched js>` -- expected: clean
- Manual: confirm `docker-compose.yaml` agent-service block carries `logging: *fluent-logging` and the three OTel env lines matching `setup_tracing("agent-service")` in source.
- **Race fix (verifier pass, 2026-11-22).** The disconnect-with-partial-text
  path originally fired the standalone `cancelled` patch fire-and-forget
  BEFORE the partial save — two concurrent read-merge-writes on the same
  doc, and the patch's stale read landing after the save would overwrite
  the save's assembled metadata (losing `answer_interrupted`, verdict,
  usage_record). Fixed: the partial save's metadata carries the outcome
  (it already merged the run-start block); the standalone patch fires only
  when there is no partial text, and as the save's failure fallback — one
  write per run on every path. Regression pins: patch not called on a
  successful partial save; patch called exactly once when the save fails.
- **Quality pass (2026-11-22, heads 7e91ae164 + 7e17cf20f).** The four-angle
  simplify review ran (reuse/simplification/efficiency/altitude): applied —
  the attribution helpers into one home (agent-run-contract.js:
  captureRunStart / seamRunOutcome / createAgentRunAttribution), the block
  persisted verbatim (one started_at mint), span attributes read off the
  results, the total degraded record builder, the single note clamp, the
  model-source constants, the run_started payload helper, the fixture and
  test-twin dedups; skipped with reasons (negative probe cache: retry
  semantics; finalize-through-merge: V05 finalize semantics; protocol
  declaration: identity optional by contract). The test-audit retained
  every contract test and dropped one redundant span-activation anchor
  (owned more strongly by the span-tree test). Full validation over the
  merged live head (umbrella +6 commits, zero file intersection):
  agent-service 864 pytest, backend 101 suites / 2662 tests,
  config-validator 678, eslint+prettier+ruff clean.
