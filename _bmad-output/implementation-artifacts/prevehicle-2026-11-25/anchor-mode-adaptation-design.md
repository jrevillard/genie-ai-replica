# Anchor mode for the agent path — the adaptation design

**Scope note.** This is the design the campaign's workstream 4 asks for
BEFORE any implementation: "Produce the ADAPTATION DESIGN first (target:
POST /v1/runs via tests/rag-benchmarks/protocol/drivers.py config-c driver —
reuse, don't reinvent; anchor span: the agent-service tool-call spans; tuple
extraction from the SSE frames; chunk-key identity re-verified). Then
implement ONLY if KISS-feasible this campaign (a driver flag + span-name
config + SSE tuple extractor); otherwise deliver the design + scoped deferral
rationale."

The verdict of the design: **the driver-flag + span-name-config + SSE
tuple-extractor adaptation is KISS-feasible and is implemented at the
FILE level; the CHUNK level is NOT derivable from what the agent emits
today and is deferred with a stated reason.** The two halves are separated
below because they have different evidence values and different costs.

## 1. What the legacy anchor mode measures

`tests/rag-benchmarks/eval/run_eval.py` in `--mode anchor`:

1. drives each case through **config B** (`OPEA_HOST:OPEA_PORT/v1/chatqna`),
2. reads the matching span out of **VictoriaTraces** through the Jaeger
   query API (`/select/jaeger/api/traces?service=genieai-chatqna`),
3. extracts the retrieval tuple from the span:
   `reranker_selection` → `rag.candidate_chunk_keys` /
   `rag.selected_chunk_keys` (the reranker's `_key`s),
4. projects those `_key`s to **content hashes** (`build_key_to_content_hash`,
   sha256 of the normalized text — content identity survives re-ingest),
5. scores recall / precision / nDCG / passage recall against the gold set,
6. counts `n_missed_traces` = rows with `trace_found is False`
   (`_derive_missed`).

The anchor is therefore TWO things joined by one identity: **the trace**
(what the retrieval actually served) and **the content hash** (the gold's
identity). Lose either half and the mode cannot score.

## 2. What the agent path emits

| what the legacy path emits | what the agent path emits | where |
|---|---|---|
| `reranker_selection` span with `rag.selected_chunk_keys` (chunk `_key`s) | `agent.tool_call` span with `call_id`, `tool`, `errored` — **counters/ids only** | `components/agent-service/agent/loop.py:333-338` |
| `reranker.tei_invoke` span with the adaptive breakdown | `agent.model_call` span with `step` | `components/agent-service/agent/loop.py:198` |
| the chatqna parent span | the `agent.run` parent span (`service.name=agent-service`) | `components/agent-service/agent/loop.py:188` |
| the answer's cited chunks | the answer's cited **files** (`provenance.file_id`, or `repo_id`/`concept_id` for an OKF concept) | `components/agent-service/agent/verification.py:132-138` |

Two consequences, both verified in the code:

- **The chunk key never reaches the agent's output surface.** The capability
  layer DOES hold it (`capabilities/adapters/arango_retrieval.py:264`,
  `"key": doc._key`), but the citation envelope drops it on purpose
  (`citation_identity` keeps `(repo_id, concept_id)` or `(None, file_id)`),
  and the spans carry no chunk identity at all.
- **The run id DOES reach the surface**: the run body's `run_id` opens the
  `agent.run` span, the SSE `run_started` envelope carries it, and the BFF
  persists it in `metadata.agent_run.run_id` (verified live — see the probe
  log).

## 3. The adaptation, in three levels

### L1 — the trace anchor (IMPLEMENTED)

The agent's trace half of the anchor needs no product change — but it needed
one harness change, and the live measurement corrected the design.

**What the live measurement corrected.** The design assumed the run could be
matched by its `run_id`. It cannot: the agent's spans carry counters and ids
only, and the run id is NOT among them. The live span dump:

```
agent.run       span=7b31cbda05742fb3  tags: span.kind, otel.scope.name, error
agent.tool_call span=bab4abecb34a8e7a  tags: span.kind, otel.scope.name, errored, tool, call_id
```

No `run_id`, no `query_id`, no chunk keys. A time-window match would be a
guess; the identity has to come from the CALLER.

**The identity the caller can own: the propagated trace id.** The shipped
config-C driver now propagates its OWN W3C `traceparent`
(`00-<trace id>-<span id>-01`) on the run request, and records that trace id
on the row. The agent's spans join that trace (the OTel SDK extracts the
incoming context), so the run's trace is fetchable BY ID:

```
GET /select/jaeger/api/traces/{trace_id}
```

→ the `agent.run` parent with its `agent.model_call` / `agent.tool_call` /
`agent.grounding_judge` / `agent.verify_finalize` children under it, with
`service_name=agent-service`.

`trace_found` is true when that trace exists and carries the `agent.run`
span; `n_missed_traces` counts the runs with no matching trace, exactly as
the legacy mode does.

**Span-name config**: the span names (`agent.run`, `agent.model_call`,
`agent.tool_call`) and the service name (`agent-service`) are named in ONE
place (`run_agent_anchor.py`) rather than scattered — a rename on the agent
side must break there, not silently.

### L2 — the retrieval tuple at FILE level (the SSE tuple extractor is implemented; the gold-scored scoring is DEFERRED)

The tuple comes from the **SSE frames of the config-c driver**, which
already parses the run's frames. The `verdict` frame's payload carries
`source_documents` — the delivered provenance (the file ids the answer was
composed from). The driver's row already keeps it (`run_one_case_c`:
`source_documents = verdict_payload["source_documents"]`).

Scoring at file level needs the gold's **file** identity, not the gold's
chunk identity: the gold set names chunk keys; the mapping chunk key →
file id is the very AQL the agent's own capability runs
(`arango_retrieval.py:474-480`, `FILTER doc._key IN @chunk_ids … RETURN
{key, file_id}`). The harness reads the same collection with the same
query, so the identity is re-verified rather than re-derived.

So L2 = "did the agent cite the FILE that holds the gold chunk?" — a weaker
but honest statement than the legacy chunk-level recall, and it is labelled
as such in the report (`file_recall`, never `recall`).

**What is implemented**: the SSE TUPLE EXTRACTOR — the shipped config-C
driver lifts the verdict frame's `citations` (the delivered provenance) onto
the row, next to the `source_documents` it already carried. The agent's
verdict frame is the surface that carries what the answer was composed from,
so the tuple is there to be read.

**What is deferred, and why**: the gold-scored file-level NUMBER needs two
things this campaign does not have: the gold set projected to FILE ids (the
gold names chunk keys; the chunk→file mapping is an ArangoDB read the
harness can make — the agent's own capability makes the same read), and a
venue whose corpus carries that gold. The campaign's venue corpus is the
demo seed, not an eval corpus; the gold set that exists in the repo
(`eval/gold_dataset.example.json`) is an EXAMPLE, not a measured set. A
file-level recall computed against an example gold would be a number about
nothing. The trace property (L1) does not need a gold set — which is exactly
why it is the half this campaign measures.

### L3 — the chunk-level anchor (DEFERRED, with the reason)

Chunk-level scoring needs the agent to emit the chunk `_key`s it actually
served. Today it does not, in any surface the harness can read:

- the spans carry counters and ids only (by design — "the record and the
  events carry the facts", `loop.py:184-188`);
- the verdict's citations are file-level by contract
  (`verification.py:132-138`).

Making it derivable is a **product change in the vehicle's branch** (the
agent would have to carry the chunk keys into its citations, or emit a
`rag.selected_chunk_keys` attribute on the tool-call span). This campaign
is a VALIDATION campaign: it must not widen the diff to change the
behaviour it is validating, and the change belongs to the umbrella branch
(`feat/agentic-foundations/prd`), not to the validation branch.

**Deferral, stated plainly:** the chunk-level anchor for the agent path is
out of scope for #2170 and needs (a) an agent-side change (chunk identity
in the citation envelope or on the tool-call span), and (b) a harness-side
change (the file→chunk projection). The campaign delivers L1 + L2 and
names the missing piece.

## 4. The implementation surface (what "the driver flag + span-name config +
SSE tuple extractor" means concretely)

| piece | file | shape |
|---|---|---|
| the run driver (REUSED, not reinvented) | `tests/rag-benchmarks/protocol/drivers.py` | `run_config_c` already drives `POST /v1/runs` and records `run_id`, `outcome`, `source_documents`, `usage_record`. Two additions: the **SSE tuple extractor** (the verdict frame's `citations` — the delivered provenance — lifted onto the row as the run's retrieval tuple) and the **trace propagation** (the driver's own W3C `traceparent`, with the trace id recorded on the row — the exact handle on the run's spans). |
| the span-name config | `tests/rag-benchmarks/eval/run_agent_anchor.py` | ONE place naming the agent's span names and service name (`agent.run` / `agent.model_call` / `agent.tool_call`, service `agent-service`), used by the fetch + the match. The legacy chatqna names stay where they are. |
| the anchor fetch + match | `tests/rag-benchmarks/eval/run_agent_anchor.py` | the Jaeger query API by trace id (`/select/jaeger/api/traces/{trace_id}`), the same API the Grafana datasource proxies; `trace_found` + the per-run span summary (parent + children) on the row; `n_missed_traces` on the aggregate. |
| the file-level gold projection | DEFERRED | the chunk→file AQL (the agent's own) applied to the gold set — it needs a measured gold set, which this venue's corpus does not carry (see L2). |

**One new file, and why**: the shipped harness's `run_eval.py` is
config-B-shaped end to end (the chatqna drive leg is an in-cluster exec, the
scoring is chunk→content-hash against a gold set). The agent anchor shares
the DRIVER and the trace API with it, but not the drive leg (the config-C
seam is a plain HTTP POST) nor the scoring (there is no chunk tuple to
score). A sibling runner that reuses `protocol/drivers.py::run_one_case_c`
keeps the legacy anchor mode untouched — a change there risks the shipped
deterministic path for a measurement the legacy path cannot make anyway.

## 5. What the campaign runs

- The runner drives the **run-scoped agent-service** (the same deployment
  the E2E suite and the trace evidence use) through a port-forward.
- The acceptance number is the one the campaign names: **`n_missed_traces`
  must be 0 on a clean run** — every run's `agent.run` span is in
  VictoriaTraces, fetched BY ID.
- The report states the level it measured: the **trace** (L1), with the
  file-scored (L2) and chunk-level (L3) deferrals named.
