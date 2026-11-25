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

### L1 — the trace anchor (implemented)

The agent's trace half of the anchor needs no new instrumentation:

- the trace is fetched from the **same** VictoriaTraces Jaeger API, with
  `service=agent-service` instead of `service=genieai-chatqna`;
- the run is matched by its **`run_id`** (the id the driver already records
  on every row), not by a time window alone;
- `trace_found` is true when the `agent.run` span with that run id is
  present — the parent span, with the per-model-call and per-tool-call
  children under it;
- `n_missed_traces` counts the runs with no matching trace, exactly as the
  legacy mode does.

**Span-name config**: the span names (`agent.run`, `agent.model_call`,
`agent.tool_call`) and the service name (`agent-service`) are the
configuration surface — they are constants in the agent's code, so the
harness names them in ONE place rather than scattering them.

### L2 — the retrieval tuple at FILE level (implemented)

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
| the run driver (REUSED, not reinvented) | `tests/rag-benchmarks/protocol/drivers.py` | `run_config_c` already drives `POST /v1/runs` and records `run_id`, `outcome`, `source_documents`, `usage_record`. The **SSE tuple extractor** is the addition: the verdict frame's `citations` (the delivered provenance, richer than `source_documents`) are lifted onto the row as the run's retrieval tuple. |
| the span-name config | `tests/rag-benchmarks/eval/run_eval.py` | ONE place naming the agent's span names and service name (`agent.run` / `agent.model_call` / `agent.tool_call`, service `agent-service`), used by the fetch + the match. The legacy chatqna names stay where they are. |
| the anchor fetch + match | `tests/rag-benchmarks/eval/run_eval.py` | the same Jaeger query API, `service=agent-service`, matched by `run_id`; `trace_found` + the per-run span summary (parent + children) on the row. |
| the file-level gold projection | `tests/rag-benchmarks/eval/run_eval.py` | the chunk→file AQL (the agent's own), applied to the gold set; the score is `file_recall` — never named `recall`. |

**No new subsystem, no new protocol, no new file**: the campaign's
constraint is "a driver flag + span-name config + SSE tuple extractor", and
that is what this is.

## 5. What the campaign runs

- The driver runs against the **run-scoped agent-service** (the same
  deployment the E2E suite and the trace evidence use), through a
  port-forward, with the venue's own eval set.
- The acceptance number is the one the campaign names: **`n_missed_traces`
  must be 0 on a clean run** — every answered run has its `agent.run` span
  in VictoriaTraces.
- The report states the level it measured: **file-level** (L2), with the
  chunk-level (L3) deferral named.
