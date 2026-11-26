# V06 runtime verification - 2026-11-21

> **Re-run 2026-11-24:** the venue remediation below landed (issue #2052)
> and the matrix re-ran —
> [`v06-runtime-verification-2026-11-24.md`](v06-runtime-verification-2026-11-24.md)
> is the after record; this document stays verbatim as the "before"
> evidence.

The V06 evidence record: the runtime verification the D03 decision (ADR
`docs/adr/agentic-002-first-agent-runtime-d03.md`) cites, run against the
DEPLOYED combination. The harness is
`components/agent-service/measurement/v06_harness.py` (`python -m
measurement.v06_harness`) — a re-runnable producer, so the matrix re-runs in one
command after any remediation below lands.

- **Captured:** 2026-11-21 (final live run 15:30 UTC / 16:30 CET, after the
  review-round harness corrections; earlier runs are superseded by this one)
- **Venue:** the V03 baseline deployment — GPU node `ai.assembly.govstack.global`
  (`:444/llm`), reached from the forge k3s dev cluster host; namespace
  `genieai`, chart `genieai-umbrella` 0.2.182 (V03 record attests identity)
- **V03 baseline:** `docs/baselines/v03-deployed-baseline-2026-11-19.md`
- **Producer:** `agent.v06_harness` + `agent.probe`, on the shipped pins
> Renamed from `agent.verification` to `agent.v06_harness` in the story-2.6 merge resolution (!1006); the captured evidence below predates the rename and keeps the old producer string verbatim — a re-run now emits `agent.v06_harness`.
  (httpx 0.28.1, pydantic 2.14.4, stdlib only — no new dependency)
- **Volume:** 12 matrix completions + 2 cancellation-demonstration calls +
  1 plain (no-tools) control call + 1 probe run, all serial, read-only; no
  corpus mutation, no deployment change.

## The deployed combination, verbatim from the endpoint

Read from the endpoint itself (`GET /version`, `GET /v1/models`) — never
assumed:

| Fact | Served value | Source |
|---|---|---|
| vLLM version | `{"version": "0.29.0"}` | `GET https://ai.assembly.govstack.global:444/llm/version` |
| Model id | `ibm-granite/granite-4.1-8b` | `GET .../llm/v1/models` (no `VLLM_LLM_MODEL_ID` override set) |
| Context window | `max_model_len: 65536` | same discovery entry |
| Parser / tool flags | **none configured** (server-side; observed behaviorally, see matrix) | the server's own 400 messages |

Matches the V03 record (llm row: `ibm-granite/granite-4.1-8b`, `server=vLLM`,
`max_model_len=65536`) and the spine's seed (vLLM v0.29.0).

## Headline finding: the serving config has NO tool-calling enabled

**Every matrix cell failed with the server's own rejection.** The endpoint
answers plain completions normally (machine-evidenced: the harness's plain
no-tools control call serves 200 with content — `plain_control` in the
machine record — and the streaming cancellation demo's first delta arrives),
but ANY request carrying `tools` + a `tool_choice` is refused with 400:

- `tool_choice=auto` → `"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`
- `tool_choice={"function":{"name":...}}` (named) → `tool_choice=function "search_knowledge" requires --tool-call-parser to be set` (harness-truncated form)
- `tool_choice="required"` → `tool_choice="required" requires --tool-call-parser to be set`

This is vLLM's own launch-flag contract, not a client defect: the REC-6
prerequisites are **not pinned** on this venue's serving configuration. The
consequences, recorded honestly:

1. **No cell observed an actual tool call.** Cell verdicts are `null` with
   the 400 carried as the cell's error — the matrix validates the deployed
   combination AS FOUND, and as found it cannot serve the agentic path.
2. **Latency observations are rejection round-trips** (95-105 ms), not
   model-call latencies, and the FSM-compile first-call-latency slots are
   EMPTY in the machine record — the slot fills only from an error-free
   cell, and no cell is error-free on this venue. The FSM-compile
   observation (REC-6) is UNOBSERVABLE until the parser flags are pinned;
   the numbers below bound the rejection path only.
3. **The probe's model leg failed on the same rejection** (its evidence
   record below) — the custom loop is client-side correct (suite-green,
   cancellation demonstrated live) and blocked at the server surface.
4. The streaming tool-delta read (the harness's reassembly) is exercised by
   the unit suite on MockTransport; against the live server it could not be
   exercised for tool deltas, because no tool-calling stream can start.

### REC-6 prerequisites, pinned for the deployed combination

Per REC-6 (pin parser family per served model; enforce strict tool calling;
budget first-call FSM latency; test tool-delta streaming against the deployed
parser), a deployment serving granite-4.1-8b for the agentic path MUST pin:

| Prerequisite | Value for this model | Status on the venue |
|---|---|---|
| vLLM version with tool-calling support | 0.29.0 (served; granite4 parser present in the docs' parser list for supported vLLM) | OK |
| `--enable-auto-tool-choice` | required | **MISSING** |
| `--tool-call-parser` | `granite4` (vLLM tool-calling docs, IBM Granite docs for Granite 4.0 models) | **MISSING** |
| strict-schema handling | strict cell of the matrix (xgrammar FSM per schema) | UNVERIFIED — blocked by the flags |
| first-call FSM latency budget | measured per schema by the harness on re-run | UNOBSERVABLE — blocked by the flags |
| tool-delta streaming | streaming cells of the matrix on re-run | UNVERIFIED — blocked by the flags |

**Remediation is operations-side** (GPU node launch config; out of this
story's boundaries — no venue mutation), tracked as issue
[#2052](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2052)
(`status::backlog`): relaunch the vLLM server with
`--enable-auto-tool-choice --tool-call-parser granite4`, then re-run
`python -m measurement.v06_harness` at the venue. The harness is the acceptance
check for that pin (its exit code reads 0 only on the full acceptance
semantics: every cell valid, cancellation demos proven).

## The compatibility matrix (as found)

Judged per cell on observable response validity (tool-call arguments parse as
JSON matching the registered schema, call id present, no malformed markup in
content, streamed deltas reassemble). All 12 cells: transport-level failure —
the honest verdict for a server that refuses the request class.

| # | tool_choice | schema | streaming | verdict | latency (ms) | evidence |
|---|---|---|---|---|---|---|
| 1 | auto | strict | off | failed (400) | 99.438 | `"auto" tool choice requires --enable-auto-tool-choice...` |
| 2 | auto | strict | on | failed (400) | 104.869 | same, on the streaming leg |
| 3 | auto | permissive | off | failed (400) | 99.325 | same |
| 4 | auto | permissive | on | failed (400) | 102.123 | same |
| 5 | named | strict | off | failed (400) | 102.214 | `tool_choice=function "search_knowledge" requires --tool-call-parser...` |
| 6 | named | strict | on | failed (400) | 97.561 | same, streaming leg |
| 7 | named | permissive | off | failed (400) | 95.408 | same |
| 8 | named | permissive | on | failed (400) | 100.235 | same |
| 9 | required | strict | off | failed (400) | 94.979 | `tool_choice="required" requires --tool-call-parser` |
| 10 | required | strict | on | failed (400) | 102.849 | same, streaming leg |
| 11 | required | permissive | off | failed (400) | 95.032 | same |
| 12 | required | permissive | on | failed (400) | 98.959 | same |

First-call latency per schema (the FSM-compile observation slot): EMPTY on
this run — the slot fills only from the first error-free cell per schema,
and every cell errored, so the record carries no latency number that could
be mistaken for compile latency. Re-read after the parser pin. The machine
record (all fields; repeated cell-error strings collapsed for length, every
distinct message in full) is Appendix A.

**A research claim this observation contradicts** (the freshness gate at
work): the S1 research extract (REC-6, 2026-11-16) states that vLLM 0.29.0
serves named and `required` `tool_choice` "by default ... no parser flag
needed for those modes". The served 0.29.0 refuses BOTH modes with
`requires --tool-call-parser to be set` — the v0.29.0 tool-calling docs
match the server, not the extract: every mode except `none` needs the
parser flag server-side, and `auto` additionally needs
`--enable-auto-tool-choice`. The pinned prerequisite table above reflects
the observed-and-documented contract; the extract's version-scoped claim
was exactly the class the 2026-12-01 re-check exists for.

## Cancellation evidence (runtime level)

Both demos ran against the live endpoint. The full request path
(client-disconnect → BFF → agent-service) is story 2.3/2.4; these
demonstrate the RUNTIME level only.

### Streaming completion cancelled mid-flight — PASS

A plain streaming completion (no tools — the demo isolates the cancellation
variable from the tool-calling matrix), cancelled after the first delta (the
consumer parks there, the shape of a slow downstream consumer):

```json
{"deltas_received": 1, "cancelled_error_raised": true, "connection_aborted": true,
 "completion_delivered": false, "wait_seconds": 1.208, "error": null}
```

CancelledError raised in the consuming task; no completion delivered; and
`connection_aborted` is the stream's OWN teardown observation, not the
cancellation signal: the demo cancels the consumer, explicitly closes the
stream (response and client), and records the abort from the teardown flag
that flips when the response/client unwind completes. A cancel without
teardown — or a stream that drained to completion — never reads as an
abort. The server keeps generating into an abandoned connection —
abandoned, not delivered.

### Loop-level cancellation during a live model call — PASS

`AgentLoop` on the seam drove the live endpoint through the probe's model
client over a registered fake tool (`read_clock`); the token fired during
the in-flight call:

```json
{"cancelled_error_propagated": true, "in_flight_model_call_cancelled": true,
 "model_post_dispatched": true, "terminal_events_emitted": [],
 "steps": 1, "model_calls": 1, "tool_calls": 0,
 "wall_clock_seconds": 0.003, "error": null}
```

CancelledError propagated untouched out of `loop.run`, and NO terminal event
was emitted — the seam's honesty contract holds on a live run. The two
evidence flags make the demo's claim precise: `model_post_dispatched: true`
— the recorder transport records the POST dispatch before anything cancels
(the model id is pinned into the client, so no discovery leg precedes it) —
and `in_flight_model_call_cancelled`: the cancellation landed inside that
POST's await (dispatched, response not awaited; the wall clock of 3 ms is
the dispatch-to-cancel interval, not a served call). The cancelled call
was a tool-calling request the venue would have 400'd — the demonstration
is of the cancellation mechanics, which are server-answer-independent; the
tool-call surface evidence lives in the matrix.

## The live probe record

`python -m measurement.probe` against the venue with the real port assembled
(doc-repo and ArangoDB via port-forward, TEI embed on the GPU node,
`ARANGO_DB=_system` / `GRAPH` as deployed):

```json
{
  "runtime_id": "custom-minimal-loop",
  "toolset": ["search_knowledge", "read_source"],
  "question_id": "probe-multihop-001",
  "outcome": "error",
  "steps": 1, "model_calls": 1, "tool_calls": 0,
  "wall_clock_seconds": 0.29,
  "prompt_tokens": null, "completion_tokens": null,
  "error": "ProbeTransientError: the generation endpoint answered 400: {'error': {'message': '\"auto\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', ..."
}
```

One evidence record, honest outcome: the run fails at the model leg for the
same REC-6 root cause as the matrix (discovery itself served 200). The
corpus legs (search embedding, doc-repo read) were not reached. A first
attempt 401'd transiently at discovery (envoy answered 401 once; the rerun
succeeded with no change) — recorded because a failure is evidence.

## Posture observations on the venue (read-only findings)

- **Plain completions and plain streaming work**: the endpoint serves
  non-tool traffic normally (the plain control call is machine-evidenced in
  the record; plain streaming is evidenced by the cancellation demo's first
  delta); the gap is exclusively the tool-calling surface.
- **The embed endpoint requires the API key** (`401` without the bearer,
  `200` with it). The TEI adapter deliberately sends no Authorization header
  (the recorded V02 contract: deployed TEI calls carry trace context only) —
  correct for compose-internal TEI, blocked on THIS venue's keyed gateway. A
  deployment serving the agentic path here must either exempt the internal
  callers or extend the adapter's bearer wiring; recorded for the 2.3/2.5
  wiring decisions, unchanged in this story.
- **okf-server is not deployed** on this venue (`OKF_ENABLED=0`, no
  okf-server workload): the probe assembled with the okf adapter nominal and
  exercised the legacy-graph path only. The OKF tool path re-verifies on a
  venue that serves OKF.

## V07a — license gate (exact shipped versions)

```
verify-dependency-licenses.py --verify components/agent-service/requirements.txt \
  components/agent-service/requirements-test.txt \
  --evidence docs/dependencies/agent-service-dependency-evidence.json
OK 47 pinned package(s): licence verified, defaults audit recorded.  (exit 0)
```

Every exact pin carries a verified licence, a licence source, a defaults
verdict (telemetry + cloud export) and a release-channel status; the beta
lines (`opentelemetry-instrumentation` 0.48b0 and siblings) carry the
explicit operational-risk acceptance recorded at story 1.3 (2026-11-19). The
selected runtime adopts NO dependency beyond this audited tree, so V07a is
satisfied for the exact shipped versions and no new adoption gates behind
D03.

## Telemetry / cloud-export posture (NFR-2)

- **Selected runtime (custom minimal loop):** first-party code over the
  audited pins. Defaults audit: every shipped package answers `telemetry:
  none`, `cloud_export: none` (evidence JSON, 47 rows). No telemetry or
  cloud export exists outside the OTel wiring the deployment itself configures
  (`ENABLE_OBSERVABILITY`-gated, collector endpoint deployment-owned).
- **pydantic-ai 2.68.0 (fallback candidate, NOT adopted):** research-verified
  2026-11-16 as Production/Stable, MIT, "plain OTel — any backend you already
  run works" (no vendor-cloud default; research §2, source [6]). Compat-class
  claims re-check 2026-12-01.
- **OpenAI Agents SDK (screened, not preferred):** carries the field's
  documented sovereignty failure — tracing exports to the vendor cloud BY
  DEFAULT (research §2.2, NFR-2's named example). Not an active candidate;
  recorded as the posture bar any future candidate must clear.
- **DeepSeek Harness (ranked last provisionally):** developer preview, no
  security audit, zero evidenced adoption (research AM-1); telemetry posture
  of the subprocess runtime unassessed — part of the outstanding operational
  assessment. Not adopted.

## Verdict

The RUNTIME-LEVEL mechanics the seam owns — bounded dispatch, cancellation
reaching an in-flight (dispatched) call with no fabricated terminal event,
and a streaming read whose abort is observed through the connection's own
teardown — are demonstrated live and pass. The server-side REC-6
prerequisites are NOT pinned on the deployed combination: every tool-calling
cell fails on the serving config's missing flags, and the matrix cannot
observe parser behavior, strict-schema handling, tool-delta streaming or
FSM latency until they are. The decision record (ADR agentic-002) closes D03
on this evidence with the parser pin as a named, acceptance-tested
remediation (the harness IS the re-run check), and carries the residual
risk: candidate DIFFERENTIATION on tool-call handling (the matrix's real
subject) remains unobserved until the flags land.

## Appendix A — the machine record

Captured 2026-11-21T15:30:35+00:00 by `python -m agent.verification`
(`AGENT_VERIFICATION_VENUE="GPU node ai.assembly.govstack.global (V03
baseline venue), reached from the forge k3s dev cluster host"`), after the
review-round harness corrections. Latency values are the live observations;
errors are the server's own messages (harness-truncated at 300 chars);
repeated cell-error strings are collapsed to `(as the <mode>/<strictness>/streaming=<bool> row)` — the label is the duplicated row's own
cell identity — for length; every distinct message appears in full at least once.

```json
{
  "producer": "agent.verification",
  "venue": "GPU node ai.assembly.govstack.global (V03 baseline venue), reached from the forge k3s dev cluster host",
  "captured_at_utc": "2026-11-21T15:30:35+00:00",
  "identity": {
    "generation_endpoint": "https://ai.assembly.govstack.global:444/llm",
    "version_raw": "{\"version\": \"0.29.0\"}",
    "version_note": null,
    "model_id": "ibm-granite/granite-4.1-8b",
    "max_model_len": 65536,
    "served_at_utc": "2026-11-21T15:30:32+00:00",
    "venue": "GPU node ai.assembly.govstack.global (V03 baseline venue), reached from the forge k3s dev cluster host"
  },
  "cells": [
    {
      "tool_choice_mode": "auto",
      "schema_strictness": "strict",
      "streaming": false,
      "valid": null,
      "reasons": [],
      "latency_ms": 99.43806705996394,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "VerificationTransientError: the endpoint answered 400: {'error': {'message': '\"auto\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}"
    },
    {
      "tool_choice_mode": "auto",
      "schema_strictness": "strict",
      "streaming": true,
      "valid": null,
      "reasons": [],
      "latency_ms": 104.86905300058424,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"\\"auto\\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}"
    },
    {
      "tool_choice_mode": "auto",
      "schema_strictness": "permissive",
      "streaming": false,
      "valid": null,
      "reasons": [],
      "latency_ms": 99.32491485960782,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "(as the auto/strict/streaming=False row)"
    },
    {
      "tool_choice_mode": "auto",
      "schema_strictness": "permissive",
      "streaming": true,
      "valid": null,
      "reasons": [],
      "latency_ms": 102.12304210290313,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "(as the auto/strict/streaming=True row)"
    },
    {
      "tool_choice_mode": "named",
      "schema_strictness": "strict",
      "streaming": false,
      "valid": null,
      "reasons": [],
      "latency_ms": 102.21425793133676,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "VerificationTransientError: the endpoint answered 400: {'error': {'message': 'tool_choice=function \"search_knowledge\" requires --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}"
    },
    {
      "tool_choice_mode": "named",
      "schema_strictness": "strict",
      "streaming": true,
      "valid": null,
      "reasons": [],
      "latency_ms": 97.56066394038498,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"tool_choice=function \\"search_knowledge\\" requires --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}"
    },
    {
      "tool_choice_mode": "named",
      "schema_strictness": "permissive",
      "streaming": false,
      "valid": null,
      "reasons": [],
      "latency_ms": 95.40754114277661,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "(as the named/strict/streaming=False row)"
    },
    {
      "tool_choice_mode": "named",
      "schema_strictness": "permissive",
      "streaming": true,
      "valid": null,
      "reasons": [],
      "latency_ms": 100.23473598994315,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "(as the named/strict/streaming=True row)"
    },
    {
      "tool_choice_mode": "required",
      "schema_strictness": "strict",
      "streaming": false,
      "valid": null,
      "reasons": [],
      "latency_ms": 94.97884684242308,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "VerificationTransientError: the endpoint answered 400: {'error': {'message': 'tool_choice=\"required\" requires --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}"
    },
    {
      "tool_choice_mode": "required",
      "schema_strictness": "strict",
      "streaming": true,
      "valid": null,
      "reasons": [],
      "latency_ms": 102.84863808192313,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"tool_choice=\\"required\\" requires --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}"
    },
    {
      "tool_choice_mode": "required",
      "schema_strictness": "permissive",
      "streaming": false,
      "valid": null,
      "reasons": [],
      "latency_ms": 95.03220999613404,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "(as the required/strict/streaming=False row)"
    },
    {
      "tool_choice_mode": "required",
      "schema_strictness": "permissive",
      "streaming": true,
      "valid": null,
      "reasons": [],
      "latency_ms": 98.95932907238603,
      "finish_reason": null,
      "content_preview": null,
      "tool_calls": [],
      "delta_count": 0,
      "error": "(as the required/strict/streaming=True row)"
    }
  ],
  "first_call_latency_ms": {},
  "first_call_cell": {},
  "streaming_cancel": {
    "deltas_received": 1,
    "cancelled_error_raised": true,
    "connection_aborted": true,
    "completion_delivered": false,
    "wait_seconds": 1.2076701051555574,
    "error": null
  },
  "loop_cancel": {
    "cancelled_error_propagated": true,
    "in_flight_model_call_cancelled": true,
    "model_post_dispatched": true,
    "terminal_events_emitted": [],
    "steps": 1,
    "model_calls": 1,
    "tool_calls": 0,
    "wall_clock_seconds": 0.003059983951970935,
    "error": null
  },
  "plain_control": {
    "status_ok": true,
    "content_present": true,
    "detail": null
  },
  "notes": [
    "rec6_serving_flags: not pinned (12 of 12 cells rejected with the parser-flag 400)"
  ],
  "acceptance": {
    "passed": false,
    "reasons": [
      "cell auto/strict/streaming=False errored: VerificationTransientError: the endpoint answered 400: {'error': {'message': '\"auto\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}",
      "cell auto/strict/streaming=True errored: VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"\\"auto\\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}",
      "cell auto/permissive/streaming=False errored: VerificationTransientError: the endpoint answered 400: {'error': {'message': '\"auto\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}",
      "cell auto/permissive/streaming=True errored: VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"\\"auto\\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}",
      "cell named/strict/streaming=False errored: VerificationTransientError: the endpoint answered 400: {'error': {'message': 'tool_choice=function \"search_knowledge\" requires --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}",
      "cell named/strict/streaming=True errored: VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"tool_choice=function \\"search_knowledge\\" requires --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}",
      "cell named/permissive/streaming=False errored: VerificationTransientError: the endpoint answered 400: {'error': {'message': 'tool_choice=function \"search_knowledge\" requires --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}",
      "cell named/permissive/streaming=True errored: VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"tool_choice=function \\"search_knowledge\\" requires --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}",
      "cell required/strict/streaming=False errored: VerificationTransientError: the endpoint answered 400: {'error': {'message': 'tool_choice=\"required\" requires --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}",
      "cell required/strict/streaming=True errored: VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"tool_choice=\\"required\\" requires --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}",
      "cell required/permissive/streaming=False errored: VerificationTransientError: the endpoint answered 400: {'error': {'message': 'tool_choice=\"required\" requires --tool-call-parser to be set', 'type': 'BadRequestError', 'param': None, 'code': 400}}",
      "cell required/permissive/streaming=True errored: VerificationTransientError: the streaming endpoint answered 400: {\"error\":{\"message\":\"tool_choice=\\"required\\" requires --tool-call-parser to be set\",\"type\":\"BadRequestError\",\"param\":null,\"code\":400}}"
    ]
  }
}
```

## How to re-run

```bash
# the matrix + cancellation demos (venue env: VLLM_LLM_ENDPOINT, VLLM_API_KEY,
# OPEA_SSL_SKIP_VERIFY=1, optional AGENT_VERIFICATION_VENUE label)
cd components/agent-service && python -m measurement.v06_harness

# the probe (adds corpus knobs: TEI_EMBEDDING_ENDPOINT, TEI_RERANKING_ENDPOINT,
# ARANGO_URL/ARANGO_PASSWORD/ARANGO_DB/ARANGO_GRAPH_NAME, AGENT_DOCREPO_URL,
# AGENT_OKF_URL, AGENT_AUTHORIZED_GRAPHS)
cd components/agent-service && python -m measurement.probe

# the license gate (offline)
python scripts/dependencies/verify-dependency-licenses.py --verify \
  components/agent-service/requirements.txt components/agent-service/requirements-test.txt \
  --evidence docs/dependencies/agent-service-dependency-evidence.json
```
