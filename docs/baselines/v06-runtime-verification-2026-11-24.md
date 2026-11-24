# V06 runtime verification re-run — 2026-11-24 (the tool-calling-fixed venue)

The re-run the 2026-11-21 record promised: the venue remediation named there
(issue [#2052](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2052) —
`--enable-auto-tool-choice --tool-call-parser granite4` added to the GPU
node's `vllm-llm` service, done 2026-11-23) landed, and the harness — "a
re-runnable producer, so the matrix re-runs in one command after any
remediation below lands" — re-ran against the fixed venue. Issue
[#2120](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2120) is this
re-run's record.

- **Captured:** 2026-11-24 (matrix 13:58 UTC, probe 15:07 UTC)
- **Venue:** unchanged from the 2026-11-21 record — GPU node
  `ai.assembly.govstack.global` (`:444/llm`), reached from the forge k3s dev
  cluster host; only the tool-calling launch flags changed
- **Producer:** `agent.v06_harness` + `agent.probe`, on the shipped pins
  (the re-run emits the renamed producer string, as the 2026-11-21 record's
  rename note predicted)
- **Machine record:** `_bmad-output/implementation-artifacts/v06-rerun-2026-11-24/`
  (`harness-matrix.json`, `probe-as-found.json`, `probe-window-override.json`)
- **"Before" evidence:** `v06-runtime-verification-2026-11-21.md` (kept
  verbatim, unchanged)

## The deployed combination, read from the endpoint

`GET /version` and `GET /v1/models` at 2026-11-24T13:58:29+00:00 — the same
combination the V03/V06 records attest:

| Fact | Served value |
|---|---|
| vLLM version | `{"version": "0.29.0"}` |
| Model id | `ibm-granite/granite-4.1-8b` |
| Context window | `max_model_len: 65536` |

No re-baselining of the stack identity is needed: the model and window are
unchanged, only the serving configuration moved. The parser/flags are no
longer read from rejection messages — the matrix cells now carry served
tool calls, and the launch flags are confirmed behaviorally (the 400 class
every cell carried on 2026-11-21 is gone from all 12 cells).

## Matrix verdict: 10 of 12 cells valid — acceptance still NOT passed

The harness exit code is 1 on this run too, but for a completely different
reason: not one cell saw a rejection. The two failing cells now fail the
harness's streaming-reassembly criterion (a streamed tool call must arrive
as multiple tool-call deltas; these arrived as ONE blob delta inside a
3-delta stream — the call itself is well-formed, reassembles correctly, and
matches the registered schema):

- `auto/strict/streaming=True` — 1 tool-call delta (of 3 total deltas)
- `auto/permissive/streaming=True` — 1 tool-call delta (of 3 total deltas)

Named and `required` `tool_choice` stream INCREMENTALLY on the same server
(12–23 deltas per streamed cell), so the venue's granite4 parser streams
tool-call arguments fine — the single-blob emission is specific to the
`auto` mode's streaming path as served by vLLM 0.29.0 here.

### Cell-by-cell against the 2026-11-21 record

Latency moved from rejection round-trips (~100 ms) to real model calls
(400–1100 ms). Every cell changed state; none regressed to a transport
failure.

| # | cell | 2026-11-21 | 2026-11-24 | latency (ms) | deltas |
|---|---|---|---|---|---|
| 1 | auto / strict / off | failed (400) | **valid** | 1132.4 | — |
| 2 | auto / strict / on | failed (400) | **invalid** (single-blob) | 1070.0 | 1 tool of 3 |
| 3 | auto / permissive / off | failed (400) | **valid** | 830.8 | — |
| 4 | auto / permissive / on | failed (400) | **invalid** (single-blob) | 656.2 | 1 tool of 3 |
| 5 | named / strict / off | failed (400) | **valid** | 625.4 | — |
| 6 | named / strict / on | failed (400) | **valid** | 577.9 | 23 |
| 7 | named / permissive / off | failed (400) | **valid** | 414.1 | — |
| 8 | named / permissive / on | failed (400) | **valid** | 557.2 | 15 |
| 9 | required / strict / off | failed (400) | **valid** | 982.0 | — |
| 10 | required / strict / on | failed (400) | **valid** | 936.6 | 19 |
| 11 | required / permissive / off | failed (400) | **valid** | 611.4 | — |
| 12 | required / permissive / on | failed (400) | **valid** | 613.5 | 12 |

**Named improvements over the "before" record:**

1. Tool-calling served at all — 0/12 → 10/12 valid cells.
2. The REC-6 first-call FSM-latency observation slot, EMPTY on 2026-11-21,
   is filled: **strict 1132.4 ms** (`auto/strict/streaming=False`),
   **permissive 830.8 ms** (`auto/permissive/streaming=False`) — the first
   error-free cells per schema.
3. Strict-schema handling, UNVERIFIED on 2026-11-21, is observed valid on
   every strict cell that completed (3 of 4; the streaming-auto cell fails
   only the multi-delta criterion, and its reassembled call still matches
   the schema).
4. Tool-delta streaming, UNVERIFIED on 2026-11-21, is observed incremental
   for `named` and `required` modes.

**The one named deviation:** `tool_choice=auto` + streaming emits the whole
tool call in a single delta on this server (strict and permissive alike).
Client reassembly is unaffected — the call reassembles and validates — but
the harness's streamed-call criterion ("did not stream as tool-call
deltas") rejects the single-blob form, so acceptance is `passed: false`
with exactly these two reasons. This is the granite4 parser's served
auto-mode behavior, an upstream/server-side observation — recorded, not
fixable client-side; it feeds the runtime decision as a parser-behavior
fact.

### Cancellation demonstrations and control — both PASS, again

Identical flags to the 2026-11-21 run (the mechanics are
server-answer-independent, as that record predicted):

- Streaming completion cancelled mid-flight: `cancelled_error_raised: true`,
  `connection_aborted: true`, `completion_delivered: false` (1 delta
  received; wait 0.94 s).
- Loop-level cancellation inside a dispatched model call: `CancelledError`
  propagated, no terminal event emitted, `model_post_dispatched: true`.
- Plain no-tools control call: 200, content present.

## The probe: the model leg is FIXED; two NEW observations surface

With the parser flags live, the probe got past the model leg for the first
time on this venue — and exposed two findings the 2026-11-21 run could
never reach. Both are recorded as-found, plus one supported-override run
that proves the full pipeline.

### As-found: the probe's output budget overshoots the window (400)

`probe-as-found.json`: the run dies on

> `This model's maximum context length is 65536 tokens. However, you
> requested 65269 output tokens and your prompt contai[ned ...]`

The probe's run-level output allowance is capped to `window − estimate −
128`, where the estimate is `json.dumps(messages)/4 + 20` — and the
estimate does not count the declared tool schemas (#2091). Measured here:
estimate ≈ 139 tokens for a prompt the endpoint later served at
**2189 prompt tokens** — the room arithmetic overshoots by ~2050 tokens
and vLLM rejects the call. Unexposable before the venue fix (the 2026-11-21
probe died at the parser 400 first); now the dominant blocker on any
windowed venue. Already tracked: issue
[#2091](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2091)
(`status::backlog`) — this run is its first LIVE reproduction.

### With `AGENT_WINDOW_OVERRIDE_TOKENS=4096` (a shipped consumer-side cap): ANSWERED

`probe-window-override.json`: **outcome `answered`** — 4 steps, 4 model
calls, 3 tool calls, 5.56 s wall clock, 2189 prompt / 184 completion
tokens, `error: null`, exit 0. With the room sized conservatively, the
whole pipeline runs against the live venue: endpoint discovery, tool-call
serving, loop mechanics, budget accounting, tool dispatch, honest answer.

The 3 `search_knowledge` calls did NOT serve results — each reported
`transient_failure: the embedding stage failed: [SSL:
CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed
certificate` (see `probe-window-override.stderr.log`), and the model
completed with the corpus-unreachable answer the system prompt's honesty
clause demands. `answered` here proves the RUNTIME path, not corpus
retrieval.

### The corpus legs are blocked at the venue gateway — now two layers

The 2026-11-21 record's posture observation (the keyed gateway vs the TEI
adapter's no-Authorization contract) extends with a layer that run could
not see, because it never reached the corpus:

1. **TLS first:** the TEI adapters pin the default TLS-verify transport;
   the venue's self-signed certificate fails the handshake
   (`CERTIFICATE_VERIFY_FAILED`) before any HTTP happens.
   `OPEA_SSL_SKIP_VERIFY=1` — which the model client honors — has no
   wiring in the TEI adapter path; no knob exists.
2. **Then auth:** the gateway requires an Authorization header (401
   without one, 200 with ANY bearer value — verified live from the forge
   host), and the TEI adapter deliberately sends none (the recorded V02
   contract).

Both layers are the same remediation class the 2026-11-21 record named
(exempt internal callers at the gateway, or wire the adapter's
TLS/bearer posture); filed as an extracted issue. The `read_source` leg
resolved cleanly to the same behavior a healthy corpus would show for an
absent file (the seeded chunk's `file_id` carries no doc-repo metadata —
the `files` collection on this venue is empty — so the adapter's 404 →
`None` contract ran, not an error).

## REC-6 prerequisites, after the pin

| Prerequisite | Status on the venue (2026-11-24) |
|---|---|
| vLLM version with tool-calling support | OK (0.29.0 served) |
| `--enable-auto-tool-choice` | **PINNED** (behaviorally confirmed) |
| `--tool-call-parser` | **PINNED** (`granite4`; streamed tool calls served) |
| strict-schema handling | **OBSERVED** (every completed strict cell valid) |
| first-call FSM latency budget | **OBSERVED** (strict 1132.4 ms, permissive 830.8 ms) |
| tool-delta streaming | **PARTIAL** (incremental for named/required; single-blob for auto+streaming) |

## Verdict

**The fixed venue holds the V06 baseline: YES, with two named deviations.**
The stack identity is unchanged; every tool-calling rejection is gone; the
matrix observes real tool calls, filled FSM latencies, valid strict-schema
handling, incremental tool-delta streaming for two of three `tool_choice`
modes, and the cancellation/control evidence reproduces exactly. The two
deviations are named and located server-side/client-side respectively:

1. **auto + streaming emits single-blob tool calls** (server-side granite4
   parser behavior; client reassembly unaffected; the harness's strict
   streamed-call criterion rejects it — acceptance stays unpassed until
   the server streams auto-mode deltas or the criterion is revisited by
   the runtime decision).
2. **The probe's as-found output budget overshoots the window** (#2091,
   client-side; worked around by the shipped window-override knob, under
   which the pipeline answers end-to-end).

What this re-run does NOT prove: corpus retrieval on the venue (blocked at
the gateway TLS/auth layers — extracted issue), and it does not itself
sign story 2.5's binding acceptance — ADR
`docs/adr/agentic-002-first-agent-runtime-d03.md` gates that, and the
operator signs.

## How this run was made (reproduction)

```bash
# venv on the shipped pins (httpx 0.28.1, pydantic 2.14.4 + requirements.txt)
cd components/agent-service && uv venv .venv && uv pip install -r requirements.txt

# venue env
export VLLM_LLM_ENDPOINT="https://ai.assembly.govstack.global:444/llm"
export VLLM_API_KEY="$(kubectl -n genieai get secret vllm-api-key -o jsonpath='{.data.VLLM_API_KEY}' | base64 -d)"
export OPEA_SSL_SKIP_VERIFY=1
export AGENT_VERIFICATION_VENUE="GPU node ai.assembly.govstack.global (V03 baseline venue), reached from the forge k3s dev cluster host"

# the matrix + cancellation demos + plain control (exit 1: the 2 auto+streaming cells)
cd components/agent-service && .venv/bin/python -m agent.v06_harness

# the probe (as-found; + doc-repo/Arango via port-forward, TEI endpoints,
# ARANGO_DB=_system, ARANGO_GRAPH_NAME=GRAPH, AGENT_AUTHORIZED_GRAPHS=GRAPH,
# AGENT_PROBE_BEARER=<realm token>) — dies on the #2091 sizing 400
# the override run: AGENT_WINDOW_OVERRIDE_TOKENS=4096 — outcome answered
```
