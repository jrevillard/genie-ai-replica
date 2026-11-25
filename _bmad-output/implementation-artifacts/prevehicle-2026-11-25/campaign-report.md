# #2170 — PRE-VEHICLE VALIDATION CAMPAIGN (agentic path) — FINAL REPORT

Venue: the shared **forge k3s** cluster (namespace `genieai`), umbrella tip
`d1648d17f` deployed flag-ON (`AGENT_ENABLED=1`, dedicated agent-service
deployment, dedicated Keycloak user, one serial campaign — no shared mutable
state). Branch: `feat/agentic-foundations/chore-prevehicle-validation` → MR !1079
(draft). **No merge, no auto-merge: the orchestrator gate decides.**

## 1. Legitimacy (checked BEFORE any work)

The issue's three premises were verified in the CODE and LIVE before anything was
built:

| premise | how it was checked | verdict |
|---|---|---|
| the BFF cannot reach the agent | `axios.post(agentServiceUrl(), …)` posts the configured url verbatim while the agent serves `POST /v1/runs`; the live hop answered `POST / HTTP/1.1 404` | TRUE — issue #2072 |
| the agent's search scope is empty | the scope was the chatqna CARRIER's graph set (empty = "the carrier adds nothing") while the agent's contract reads it as "the set I MAY search" (empty = fail-closed, `capabilities/executor.py:111`) | TRUE |
| the credential is double-prefixed | the BFF forwards the caller's `Authorization` verbatim into the run body's `bearer`, and the agent's transport prefixed the scheme again | TRUE — `Bearer Bearer <jwt>` |

## 2. What the campaign fixed (the landed diff)

Three product defects, all measured live, plus the eval-harness adaptation and the
campaign's artifacts. The three fixes are in `components/`; nothing else in
`components/` changed except comments.

| # | file | fix |
|---|---|---|
| 1 | `components/gov-chat-backend/services/agent-routing.js` | `agentRunUrl()` appends the run surface ONCE; an override that already names it keeps working |
| 2 | `components/gov-chat-backend/services/query-service.js` | `_agentGraphSet(posture)` — the agent's scope is the SEARCH scope, not the carrier's payload set |
| 3 | `components/agent-service/capabilities/adapters/http.py` | `_bearer_token()` — the transport owns the scheme |

Proof on the venue with the fixed images: the run path answered `201`, the
answers carried non-empty `source_documents`, `abstained=false`, and
`AGENT_SERVICE_URL` went back to the shipped base url (no `/v1/runs` override).

## 3. The E2E suite (the FULL tree, flag ON)

`tests/e2e/run/run-local-e2e.sh` over the whole `tests/e2e/` tree, against the
deployed venue, 40.1 min, 571 tests.

| outcome | count |
|---|---|
| passed | **541** |
| failed | **5** |
| skipped | **25** (all the OKF-pillar specs — the venue runs `okfEnabled=0`, and the runner names the reason per spec) |

Every failure classified, none silent:

| # | spec | classification | why |
|---|---|---|---|
| 1 | `helpers/stream-route.spec.js:32` "two-arg call builds exactly the legacy bytes" | **PRE-EXISTING TEST DEFECT** (not the campaign's diff) | the helper now builds every frame through the shared `sseFrame()`, which terminates a frame with a blank line — the spelling the BFF really writes (`services/sse-frame.js:15`); the pin still expects the old mock's layout. Extracted: **#2178** |
| 2 | `theme/responsive-layout.spec.js:309` (1280px @light) | **VENUE AVAILABILITY** | `net::ERR_CONNECTION_REFUSED` — the runner's own classifier: "a venue outage that healed mid-run, NOT product findings". The node stalled for ~10 min (every pod's probe timed out at once; the LB dropped the edge) |
| 3 | `theme/responsive-layout.spec.js:309` (1280px @dark) | **VENUE AVAILABILITY** | same window, same signature |
| 4 | `chatbot/send-message-and-stream.spec.js:139` "receives a bot response carrying the stream metadata" | **REAL DEFECT OF THE VEHICLE** | the agentic metadata frame carries NO `responseTime`, while the legacy path always writes one (`query-routes.js:664`) and the spec pins that contract. Extracted: **#2180** |
| 5 | `chatbot/send-message-and-stream.spec.js:252` "the streamed answer is in French when the UI locale is fr" | **VEHICLE DEFECT (fixed) + VENUE SATURATION** | the answer was the insufficiency statement because the deployed agent image predated fix #3 (the double-prefixed bearer → the translation leg 401'd). After the redeploy with the fixed image, the run no longer 401s but the GPU is saturated: the model call times out at 180 s (`ProbeTransientError: … ReadTimeout`), and the run that holds the single admission slot makes the NEXT turn a `429` ("the admission lane is saturated: all 1 slots are held"). Extracted: **#2181** |

The GPU state at the moment of the failures (measured, not inferred):
`vllm:num_requests_running 16`, `vllm:num_requests_waiting 19` on
`ibm-granite/granite-4.1-8b` — the model was busy with other workloads. The same
agentic specs PASS when the GPU is idle (an agentic run answered in 4.5 s on the
same venue: `started_at 11:47:53`, `finished_at 11:47:57`, `outcome=answered`).

**Coverage gap, declared:** the flag-ON run exercises the AGENTIC path only —
`chatqna` took **0** `POST /v1/chatqna` in the whole window (`resolveQueryRoute()`
routes to the agent; the agent calls no chatqna). The chatqna leg is covered only
with `AGENT_ENABLED=0`, which this campaign did not run.

## 4. The live trace verification

`verify-traces.sh` (the artifact) against the live endpoints:

1. **VictoriaTraces** holds the agent-service spans — the `agent.run` PARENT and
   its `agent.model_call` / `agent.tool_call` children, `service_name=agent-service`.
   Measured, by span id (`verify-traces-final.log`): `agent.run` spans
   `b5d9ea64bbd05698` and `69a0c4a854c0553c`, each with its `agent.model_call`
   child (`f7fd70b51627c250`, `48cef0272f910d5c`).
   The anchor's own two runs, fetched BY IDENTITY: trace
   `92532ac6302683291d997f926cfc9b77` and `907a6ea230d4a38c8376b3e9c66630bf`,
   each carrying the `agent.run` parent with its `agent.model_call` child. Both
   runs carry NO `agent.tool_call`: the model never answered (the GPU queue —
   see §3), so no tool was ever called.
2. The same traces answer through the **Grafana datasource proxy** (the
   `/select/jaeger` path the dashboards use).
3. **VictoriaMetrics** holds the agent-service series under the `service_name`
   label the dashboards discover services by (`service_name=agent-service` →
   238 samples) — so "agent-service appears in the dashboards" is a DATA
   statement, not a config statement.
4. **Grafana** carries the 9 pre-built dashboards, and the service-health
   dashboard's service discovery is the generic `service_name=~…` query, so the
   agent-service series appears without any dashboard edit.

## 5. The queries document (the run's own record)

Every turn's `metadata.agent_run` carries `run_id`, `execution_versions`
(configuration / implementation / model / prompt), `started_at`, `usage_record`,
`outcome` and `finished_at` — including the runs that did NOT answer:

| outcome | example |
|---|---|
| `answered` | `11:47:52` — `run_id run-988d`, `execution_versions` complete, FR locale |
| `cancelled` | `11:47:30` — the turn's own cancellation, recorded, no answer fabricated |
| `interrupted` | `11:44:41`, `11:43:59`, … — the interrupted turns, recorded |
| `error` | `12:38:31` — the GPU-saturated run: `ProbeTransientError: the generation call failed: ReadTimeout` after exactly 180 s |

## 6. The anchor mode (the adaptation)

The design came FIRST (`anchor-mode-adaptation-design.md`), then the
implementation, KISS-scoped: the shipped config-C driver + a span-name config +
the SSE tuple extractor. Three levels, honestly separated:

| level | what | status |
|---|---|---|
| L1 — the trace anchor | every run's trace, fetched BY IDENTITY (the driver propagates its own W3C `traceparent`, so the run's spans join that trace) | **IMPLEMENTED and MEASURED**: `n_missed_traces = 0` — both runs' `agent.run` spans landed in VictoriaTraces and were fetched by id (`agent-anchor-report.json`). The runs themselves did NOT answer (the GPU queue): the runner's exit code is **6** ("a run did not answer"), not 0, and the `agent.tool_call` child is absent because the model never produced a tool call |
| L2 — the file-level tuple | the verdict frame's `citations` lifted onto the row | **IMPLEMENTED (extractor)**; the gold-scored number is deferred — this venue's corpus is the demo seed, and `gold_dataset.example.json` is an EXAMPLE, not a measured set |
| L3 — the chunk-level tuple | the chunk `_key`s the agent actually served | **DEFERRED** — the agent emits no chunk identity in any readable surface (the spans carry counters/ids; the citations are file-level by contract). It needs a change in the vehicle's branch, not in the validation branch |

## 7. The findings (extracted, not fixed in this diff)

| issue | finding | base | impact |
|---|---|---|---|
| **#2172** | the chart rendered the storage class under `className`, but the operator decodes `spec.storage` as a raw PVC spec → `storageClassName`; every venue that set a storage class could not enable the tier (admission error: `json: unknown field "className"`) | the chart | the observability tier could not be enabled at all. **FIXED in this MR** (chart 0.2.185) + the per-tier `extraArgs` knob (0.2.186) |
| **#2178** | the e2e "legacy bytes" pin contradicts the frame terminator the app really sends | the vehicle branch (pre-existing) | the e2e suite is red on the vehicle branch |
| **#2180** | the agentic metadata frame carries no `responseTime` | the vehicle branch | the live chat loses the answer's response time; the e2e contract is red |
| **#2181** | the chat surface's budget (120 s) is shorter than the agent's model timeout (180 s), and one run at a time refuses the second turn (429) | the vehicle branch | on a busy GPU the user gets an error, and a second message is refused |

Nothing outside the campaign's scope was widened into this diff.

## 8. The venue cleanup (the receipt)

The run-scoped objects, the two storage PVCs, the dedicated Keycloak user, the
ROPC posture and the baseline images all went back — the receipt is the script's
own output (`cleanup-venue.sh`), reproduced in the MR description and in the
issue comment.

## 9. The review chain

The global review over the full diff, then the scoped fix-review chain on the
landed code (BASE_SHA = the HEAD before each mutation, HEAD_SHA = the HEAD
after). The decision log: `~/.claude/state/review/issue-2170-review.jsonl`. The
quality record: **not applicable — evidence-only campaign** (the deliverable is
E2E reports, trace proofs, queries-doc outcomes and a cleanup receipt; the
scoped review covered ONLY the landed driver/harness code, and the run reports
and artifacts are gated on evidence completeness).

## 10. The anchor's two harness corrections (found by the campaign, not by the code)

The anchor's first run measured nothing: the harness's own deadline (the
driver's `deadline_ms` + 60 s margin) was shorter than the agent's own model
timeout (180 s), so the driver gave up before the run ended, and the poll
stopped at "a trace exists" — while the parent span is exported at the run's
END. Both are the harness's parameters, both are now corrected (a deadline
that covers the agent's budget; a poll that waits for the property), and both
are pinned by the new test file.

## 11. What is NOT proven here

- the chatqna leg (flag OFF) — not exercised by this campaign;
- the chunk-level retrieval tuple for the agent path — deferred by design;
- a green agentic answer on a saturated GPU — the venue's model queue, not the
  product: measured (`16 running / 19 waiting`), and the same path answered in
  4.5 s when the queue was free.
