# The agentic wire contract — the BFF ↔ agent-service seam

**Status:** FROZEN. Every byte of this contract is pinned by a test on the
side that owns it. A change to any of it is an operator decision, recorded
in an ADR under `docs/adr/` — never a side effect of a refactor.

**Scope:** the seam between the GENIE.AI backend (the BFF) and the
agent service. The contract is INTERNAL to the deployment: the client
speaks the BFF's frames, never the seam's.

**Read also:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`
§6 (the design of this contract), ADR-005 (the vocabulary is closed and
seam-owned), ADR-008 (additive and versioned).

---

## 1. The run request

`POST /v1/runs` — the agent service's only run entry point
(`components/agent-service/app.py`).

```json
{
  "question": "How are complaints handled?",
  "deadline_ms": 5000,
  "context": { "user_id": "u-1", "authorized_graph_names": ["GRAPH"], "authorized_repos": [] },
  "bearer": "…",
  "language": "fr"
}
```

| Field | Required | Meaning |
|---|---|---|
| `question` | yes | the question; non-empty text |
| `deadline_ms` | yes | the agent phase's REMAINING budget, in milliseconds — a duration, not a deadline; the deployment's ceiling caps it |
| `context` | yes | the trusted caller context, assembled server-side by the BFF — never by the model (`capabilities/contract.py`, `CallerContext`) |
| `bearer` | no | the caller's bearer, forwarded only to the services that validate their own callers |
| `language` | no | the UI locale the answer is displayed in; the BFF's translation leg translates on the same terms as any answer |

The body is `extra="forbid"` (`app.py`, `RunRequestBody`): an unknown field
is a 422, never a silent ignore.

**No budget value rides the request.** The bounds are server configuration
(`AGENT_RUN_*`, `AGENT_TOOL_*`, `AGENT_VERDICT_*`); the request carries
only the deadline the caller communicated.

### The refusals — before any stream byte

| Status | Body | When |
|---|---|---|
| 429 | `{"error": "admission_refused", "message": …}` + `Retry-After: 1` | every admission-lane slot is held |
| 503 | `{"error": "budget_configuration_missing", "message": …, "missing_knobs": [...]}` | a required budget knob is missing or unusable — the refusal names EVERY knob |
| 503 | `{"error": "run_surface_unconfigured", "message": …}` | the port assembly's own fail-closed read refused (a missing doc-repo / okf-server / TEI URL) |

The admission claim is taken BEFORE the response starts: a saturated lane
answers 429 with no stream byte written (`app.py`, `runs`).

## 2. The stream — the seam envelope

`text/event-stream`. Every frame is one `data:` line:

```
data: {"run_id":"…","call_id":null,"seq":0,"kind":"run_started","payload":{…}}

data: {"usage_record":{…}}
```

The envelope is `{run_id, call_id, seq, kind, payload}` — owned by the
seam (`components/agent-service/agent/events.py`, `AgentEvent`). `seq` is
the emitter's monotonic per-run counter: a consumer that replays or
reorders events reconstructs the run's order from it, never from arrival
order. `call_id` names the tool call whose effect the event reports; the
run-level and text-message events carry `null`.

The LAST line of the stream is the terminal usage record
(`{"usage_record": {…}}`) — the shared counters the BFF's residual-budget
contract consumes:

| Field | Meaning |
|---|---|
| `run_id`, `outcome` | the run's identity and its outcome (`answered`, `error`, `budget_exhausted`) |
| `steps`, `model_calls`, `aux_model_calls`, `tool_calls` | the run's counts; the auxiliary calls (the grounding judge, the preparation translation) are tallied separately from the runtime's own |
| `evidence_bytes` | the executed tool-result bytes |
| `prompt_tokens`, `completion_tokens` | the SERVED usage — `null` when the endpoint discarded it, never a local estimate |
| `wall_clock_seconds` | the run's wall clock |
| `error`, `language`, `preparation_status`, `injection_findings` | the failure text (truncated), the requested display locale, the first query's preparation status, the taint scan's finding count |

## 3. The seam kinds

The vocabulary is CLOSED and seam-owned (ADR-005). A kind is never a client
frame name — a module-level guard fails the import the day a kind value
collides with one (`agent/events.py`, `BFF_FRAME_NAMES`).

| Kind | Payload | Meaning |
|---|---|---|
| `run_started` | `{"question": …, "execution_versions": {…}}` | the handshake. The execution-version record is persisted AT START, so a cancelled, timed-out or crashed run keeps its versions. `execution_versions` is absent on the probe-shaped path. |
| `tool_call_started` | `{"name": …, "arguments": {…}}` | one dispatched tool call begins. The checks precede it, so a refused dispatch never announces a call that will not run. |
| `tool_call_finished` | `{"result": {…}}` or `{"error": {"code": …, "operation": …, "message": …}}` | one dispatched tool call ended — successfully or not. |
| `text_message_started` | `{"role": "assistant"}` | the answer's text begins. |
| `text_message_content` | `{"text": …}` | one chunk of the DELIVERED text. |
| `text_message_finished` | `{}` | the answer's text ended. |
| `verdict` | the verification payload | the citation verdict, after the last text event and before the terminal. |
| `run_finished` | `{"outcome": "answered"}` | the terminal: an answer was delivered. |
| `run_error` | `{"code": …, "message": …}` | the terminal: the run failed honestly. `code` is the outcome (`error`, `budget_exhausted`). |

**The wire order is pinned:** `run_started` → the tool events →
`text_message_started`, `text_message_content`, `text_message_finished` →
`verdict` → `run_finished`.

**A cancelled run has NO terminal event.** The cancellation propagates
untouched (`asyncio.CancelledError`), the BFF's own teardown finalizes the
turn, and no terminal state is fabricated for a run whose outcome is
"stopped" (`agent/governance.py`, `agent/cancellation.py`).

## 4. The execution-version record

The handshake's `execution_versions` — five axes, all ids and fingerprints:

```json
{
  "implementation": {"version": "0.1.0"},
  "model": {"id": "served-model", "source": "discovered", "note": "…"},
  "prompt": {"version": "prod-1", "sha256": "d7ed66b8bcaf"},
  "configuration": {"sha256": "0823eae7cdf1", "values": {…}},
  "runtime": {"id": "custom-minimal-loop"}
}
```

| Axis | What it identifies |
|---|---|
| `implementation` | the agent service's code |
| `model` | the model the run called — the id, its resolution source (`override`, `discovered`, `unresolved`) and, when the resolution was not clean, a clamped note |
| `prompt` | the EFFECTIVE prompt — its version name and the hash of the text. The prompt body never rides the record. |
| `configuration` | the resolved, non-secret knob values and their fingerprint. No credential has a path into the record. |
| `runtime` | the runtime that drove the run |

The fingerprints are SHORT (12 hex): they identify, they do not attest.

The record's shape NEVER varies: the degraded fallback (a record whose
build failed) carries the same five axes (`agent/version_record.py`).

## 5. The client frames — the BFF's

The agent service writes NO client frame. The BFF parses the seam stream
and writes every client frame itself
(`components/gov-chat-backend/services/agent-frame-writer.js`).

| Frame | Written when |
|---|---|
| `chunk` | one `text_message_content` — the answer's text |
| `agent_activity` (version 1) | one `tool_call_started` / `tool_call_finished` — `status` is `started`, `completed` or `failed` |
| `agent_verdict` (version 1) | the terminal, after the last chunk and before the metadata |
| `metadata` | the terminal (the run's attribution) |
| `translation` | the terminal, when the answer is translated |
| `done` | the terminal, ALWAYS last |
| `error` | a genuine failure — the error frame then the end: no `done`, no metadata |

The five legacy client types are byte-compatible with the pre-agentic
dialect. The two additive types (`agent_activity`, `agent_verdict`) are
ignored by a client that does not know them.

**A seam kind the BFF does not know is IGNORED, at debug level** — the
envelope is additive by design, so a newer agent service does not break an
older BFF. The pair is deployed together.

## 6. The versioning policy

1. The seam's vocabulary is CLOSED (ADR-005): a kind is added, never
   renamed, never repurposed.
2. The BFF's frames are ADDITIVE and VERSIONED (ADR-008): a new frame
   carries its version; an existing frame's fields are only added.
3. The agent service never speaks a client frame name; the BFF never
   renames a seam kind.
4. The two components are deployed TOGETHER: the forward compatibility is
   real, and it is not a substitute for a paired deployment.

## 7. Who pins what

| Contract | Pinned by |
|---|---|
| the request's shape and the refusals | `components/agent-service/tests/test_app_runs.py` |
| the envelope and the closed vocabulary | `components/agent-service/tests/test_agent_events.py` |
| the wire order and the byte-identical stream | `components/agent-service/tests/test_event_stream_gate.py` (the recorded fixture) |
| the record's five axes | `components/agent-service/tests/test_version_record.py` |
| the seam kinds the BFF projects, and the unknown-kind behaviour | `components/agent-service/tests/test_wire_contract.py` and `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js` |
| the RAG capability's behavior (unchanged by any of the above) | `components/agent-service/tests/test_equivalence_v02.py` |

## 8. Not in this contract

- **The pause surface** (the design's §5.4): `pause_requested`, `run_paused`, the `agent_pause` client frame and the decision endpoint are NOT part of the frozen wire. They arrive with the pipelines, and their UX is an operator decision.
- **The pipelines' request fields** (`plan`, `resume`, `turns`): the design's §6.1 proposes them; they are not in the request body today, and `extra="forbid"` refuses them.
