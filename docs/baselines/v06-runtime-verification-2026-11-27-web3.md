# V06 runtime verification — 2026-11-27 (the matrix with THREE tool declarations)

The re-run design spec §13.3 asked for ("S3-plan-2 re-runs it with `web_search`
registered (three tools)"): the tool-calling matrix re-ran against the venue
with **three** tool declarations registered — `web_search` (the target, the
tool the slice added) plus two distractors (`search_knowledge`, `read_source`)
present so the model's CHOICE is observable. The previous record
[`v06-runtime-verification-2026-11-24.md`](v06-runtime-verification-2026-11-24.md)
(kept verbatim, unchanged) ran the SAME 12-cell matrix with ONE declaration;
this run's subject is the three-declaration catalog, not the one.

- **Captured:** 2026-11-27 (identity 12:01:32 UTC, matrix 12:02:20 UTC)
- **Venue:** unchanged from the 2026-11-24 record — GPU node
  `ai.assembly.govstack.global` (`:444/llm`), reached from the forge k3s dev
  cluster host
- **Producer:** `measurement.v06_harness` (the module's own string, post-rename)
- **Machine record:** `_bmad-output/implementation-artifacts/v06-rerun-2026-11-27/harness-matrix.json`
- **"Before" evidence:** `v06-runtime-verification-2026-11-24.md` (one
  declaration; kept verbatim, unchanged)

## The deployed combination, read from the endpoint

`GET /version` and `GET /v1/models` at 2026-11-27T12:01:32+00:00 — the same
combination every record since V03 attests:

| Fact | Served value |
|---|---|
| vLLM version | `{"version": "0.29.0"}` |
| Model id | `ibm-granite/granite-4.1-8b` |
| Context window | `max_model_len: 65536` |

No re-baselining of the stack identity is needed.

## Matrix verdict: 10 of 12 cells valid — acceptance NOT passed (the operator signs)

Harness exit code 1, for the SAME reason as 2026-11-24 and none other: the
two `auto` + `streaming` cells still emit the whole tool call as ONE blob
delta (the call itself is well-formed, reassembles correctly, names the
target, and matches the registered schema — only the harness's
streamed-call criterion rejects the single-blob form). This is the venue's
granite4-parser auto-mode streaming property as served by vLLM 0.29.0 — the
2026-11-24 record's finding, reproduced unchanged. It is a SERVING
property, not a code defect and not a three-declaration artifact.

The acceptance verdict is `passed: false` with exactly these two reasons;
the operator signs the binding acceptance (ADR
`docs/adr/agentic-002-first-agent-runtime-d03.md` gates it).

### The choice observation — the point of the three declarations

Every cell that issued a tool call named **`web_search`** — the TARGET — in
all 12 cells, under every `tool_choice` mode, both schema strictnesses,
streaming on and off:

- `auto` cells: the model chose the target among three declarations.
- `named` cells: `tool_choice` pinned `web_search`; served.
- `required` cells: the mode means "some tool" — the model picked the
  TARGET (the prompt names it) in both strictnesses.

No distractor was ever called: the endpoint handles the three-tool catalog
and the prompt steers the choice. One declaration on 2026-11-24 could not
observe any of this — there was nothing to choose between.

### Cell-by-cell against the one-declaration record (2026-11-24)

| # | cell | 2026-11-24 (1 tool) | 2026-11-27 (3 tools) | latency (ms) | deltas | call |
|---|---|---|---|---|---|---|
| 1 | auto / strict / off | valid | **valid** | 34385.8 | — | web_search |
| 2 | auto / strict / on | invalid (single-blob) | **invalid** (single-blob) | 1710.6 | 1 tool of 3 | web_search |
| 3 | auto / permissive / off | valid | **valid** | 1066.6 | — | web_search |
| 4 | auto / permissive / on | invalid (single-blob) | **invalid** (single-blob) | 1170.5 | 1 tool of 3 | web_search |
| 5 | named / strict / off | valid | **valid** | 955.2 | — | web_search |
| 6 | named / strict / on | valid | **valid** | 1063.9 | 22 | web_search |
| 7 | named / permissive / off | valid | **valid** | 513.6 | — | web_search |
| 8 | named / permissive / on | valid | **valid** | 994.1 | 14 | web_search |
| 9 | required / strict / off | valid | **valid** | 1101.2 | — | web_search |
| 10 | required / strict / on | valid | **valid** | 1158.0 | 18 | web_search |
| 11 | required / permissive / off | valid | **valid** | 1177.0 | — | web_search |
| 12 | required / permissive / on | valid | **valid** | 784.2 | 11 | web_search |

**Comparison with the one-declaration record:**

1. The validity surface is IDENTICAL: 10/12 valid, the same two
   `auto`+`streaming` cells invalid, the same single-blob reason. Adding
   two declarations changed nothing about how the venue serves tool calls.
2. The REC-6 first-call FSM-latency slots: **strict 34385.8 ms**
   (`auto/strict/streaming=False` — the run's FIRST completion; a cold-start
   outlier, ~30× the same slot's 1132.4 ms on 2026-11-24, attributed to the
   venue's first-token warm-up, not to the declaration count — every later
   strict cell sits in the ~1 s band), **permissive 1066.6 ms**
   (`auto/permissive/streaming=False` — in line with the before-record's
   830.8 ms). Both slots filled by the same cells as on 2026-11-24.
3. Incremental tool-delta streaming reproduces for `named` and `required`
   (11–22 tool deltas per streamed cell); `auto`+`streaming` stays
   single-blob — the before-record's named deviation, unchanged.
4. The distractors were never called: the CHOICE observation (above) is the
   new evidence this run adds, and it is the slice's answer to spec §13.3 —
   the endpoint handles the three-tool catalog.

### Cancellation demonstrations and control — all pass, again

Identical flags to the 2026-11-24 run:

- Streaming completion cancelled mid-flight: `cancelled_error_raised: true`,
  `connection_aborted: true`, `completion_delivered: false` (1 delta
  received; wait 1.83 s).
- Loop-level cancellation inside a dispatched model call: `CancelledError`
  propagated, no terminal event emitted, `model_post_dispatched: true`.
- Plain no-tools control call: 200, content present.

## Verdict

**The three-declaration matrix reproduces the one-declaration baseline
exactly, and adds the choice evidence spec §13.3 asked for: YES, with the
one named (carried-over) deviation.** The stack identity is unchanged; 10/12
cells valid; every issued call names the target `web_search`; the two
invalid cells fail for the venue's known auto-streaming single-blob serving
property — recorded, not fixable client-side, and unchanged by adding
declarations. Acceptance is NOT passed (`passed: false`, the two
single-blob reasons); the operator signs.

What this re-run does NOT prove: the deployed agent-service end-to-end on
the cluster (out of scope — a separate deployment exercise), the probe legs
(the 2026-11-24 record's probe findings stand; this plan re-ran the matrix
only), and corpus retrieval on the venue.

## How this run was made (reproduction)

```bash
# venv on the shipped pins
cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q

# venue env (API key read from the cluster's vllm-api-key Secret)
export VLLM_LLM_ENDPOINT="https://ai.assembly.govstack.global:444/llm"
export VLLM_API_KEY="$(kubectl -n genieai get secret vllm-api-key -o jsonpath='{.data.VLLM_API_KEY}' | base64 -d)"
export OPEA_SSL_SKIP_VERIFY=1
export AGENT_VERIFICATION_VENUE="GPU node ai.assembly.govstack.global (V03 baseline venue), reached from the forge k3s dev cluster host — three tool declarations registered"

# the matrix + cancellation demos + plain control (exit 1: the 2 auto+streaming cells)
cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m measurement.v06_harness > /tmp/harness-matrix-3tools.json 2>/tmp/harness-matrix-3tools.stderr.txt
echo "exit=$?"
```

## The criterion fork, resolved (2026-11-27, operator decision)

The 2026-11-24 record left this fork open: "until the server streams
auto-mode deltas or the criterion is revisited by the runtime decision". The
investigation that followed this re-run (live SSE capture + the upstream
parser sources) settled the FACTS, and the operator settled the criterion:

- **The fact**: the blob is the `granite4` parser's DESIGNED streaming shape
  in vLLM 0.29.0 — it buffers and emits ONE `tool_calls` delta carrying id,
  name and the COMPLETE arguments; `content` stays clean (nothing leaks).
  The OpenAI streaming contract sets no minimum delta count — chunking is
  the server's discretion. The parser never streams argument fragments on
  any release through main under the `granite4` name; the incremental engine
  parser exists as `granite` from v0.31.0.
- **The decision**: the judge STAYS STRICT (≥2 tool-call deltas). Incremental
  tool-progress delivery remains a REQUIREMENT of the P3 gate; this re-run's
  acceptance stays NOT passed for the two cells, and no harness change is
  made to relax it.
- **The planned remedy** (separate work, tracked in the tracker): upgrade the
  GPU venue to vLLM ≥ 0.31.0 AND switch `--tool-call-parser granite4` →
  `granite` (the engine parser with `stream_arg_deltas=True`), mirrored in
  `deploy/ansible/templates/docker-compose.gpu.yaml.j2` +
  `vllm_tool_call_parser` in `group_vars`. Hazards recorded there: the
  engine parser's format config must be probed against granite-4.1-8b's
  markup on a NON-PRODUCT venue first; the venue serves the product chat
  (chatqna, translation ride the same compose file).
