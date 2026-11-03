# Story 1.0 — Retriever provenance materialization (fusion-time attribution)

**Status:** DONE 2026-09-21 (implementation + design decisions + behavioral
correction to `fanout_should_engage`).
**Sources:** epics.md 1.0 (G18); [fan-out course-correction](../planning-artifacts/okf-fanout-course-correction-2026-09-20.md)
amendment C (provenance = fusion-time attribution; chunk `file_id == concept_id`
from content-only chunking); David, 2026-09-20: the graph existence must
maintain parity AND RELATIONSHIP with the ingested OKF repo — the retriever's
"graph exists" check is the lens through which the chat path knows the
repo's current serving reality; David, 2026-09-21: "always fan out when >1
graph is encoded" + "the retriever must work smoothly and consistently
when we have A: the single legacy graph only, B: fan out with the legacy
graph and one or more OKF graphs if they exist".

## Story

As an **agent / chat user**,
I want **every retrieval hit to carry its `graph_name` / `repo_id` / `concept_id`**,
So that **I can cite and audit which repository a grounded fact came from**.

## Acceptance criteria

1. **Fusion-time attribution (amendment C simplification)** — the per-leg
   fan-out already knows the graph name (it's the leg's graph). The chunk
   `file_id` IS the `concept_id` (proven by [ingest-service.js:1109](file:///d:/ITU-Gitlab/components/okf-server/services/ingest-service.js#L1109):
   "Chunk rows carry `file_id == concept_id`"). No chunk-doc schema change.
2. **`graph_name`** — ambient per-leg from the fan-out's per-graph loop.
3. **`concept_id`** — read from `chunk.file_id` at fusion time (alias).
4. **`repo_id`** — looked up via the resolver's `graph_name → repo_id` map
   populated in Story 6.1b (`serving_graphs[]` already carries it).
5. **All three survive fusion** (RRF) into the served result, so the reranker
   + ChatQnA + Studio tab can render provenance consistently.
6. **Zero-hit per missing graph (Story 1.4 + R3 alignment)** — a per-leg
   ArangoDB error or missing-graph signal returns [] from that leg, gets
   logged at INFO with the graph name, counted as a `fan_out.per_graph.failures`
   span attribute, and the fusion proceeds with the surviving legs. ADR-039
   D8 skip-on-timeout semantics, generalized to skip-on-missing.

## Verification plan

- pytest for the fusion function asserting:
  - provenance fields populated from per-leg attribution (no chunk-doc read needed)
  - chunk `file_id` carries through as `concept_id`
  - fusion preserves provenance across all output items
  - missing-graph leg returns [] without breaking survivors
  - log emission + span attribute coverage

## Non-goals

- No chunk-doc schema migration. Content-only chunking already gave us the
  `file_id == concept_id` invariant (Amendment C).
- The authz resolver→retriever carrier (label_contract graphs segment) is
  Story 1.2 (Wave R5). This story's provenance path operates on whatever
  fan-out produces — no carrier coupling.

## Implementation decisions (2026-09-20, with David)

### Decision A — Additive-first, no Pydantic mutation

The existing single-graph `invoke()` reads `input.graph_name` as a Pydantic
attribute and defaults to `ARANGO_GRAPH_NAME` when absent. The retriever
ALREADY separates the carrier (`_encoded_graph_names`, decoded from
`search_start`) from the per-request `graph_name` field — the legacy path
ignores the carrier when empty, which is the documented D8 invariant.

For the fan-out path, the per-leg invocation needs to drive the legacy
extraction against a *specific* graph name, not the request's default.
Two options were on the table:

1. **Mutate `leg_input.graph_name = graph_name` before delegating to
   `self.invoke(leg_input)`** — relies on Pydantic v2 attribute mutation
   round-tripping through `model_dump()`. Smallest diff. **Rejected** —
   the legacy code's contract on `graph_name` mutability is unverified,
   and touching Pydantic model state from a side-channel helper is
   exactly the kind of "dirty fix" the BMAD additive-first / no-dirty-hacks
   rule guards against.

2. **Duplicate extraction per-leg (no mutation)** — extract the
   single-graph extraction body into a private helper
   `_invoke_against_graph(graph_name, input, input_dict) -> list` that
   takes the graph name as an explicit argument. The legacy `invoke()`
   becomes a thin wrapper that calls it once with
   `graph_name=input.graph_name or ARANGO_GRAPH_NAME`. The fan-out
   orchestrator calls the helper once per authorized graph with no
   Pydantic mutation. **Selected.** Aligns with the no-dirty-hacks rule:
   ZERO mutation of legacy model state, ZERO risk of breaking the
   single-graph path.

### Decision B — Highest RAG accuracy + performance

Three extraction-scope options were on the table (full / partial /
revert+redo). Decision criterion: **highest RAG accuracy AND highest
performance**.

- **Partial extraction (search + response only, skip BM25/traversal)**
  saves cross-graph BM25 cost, but loses the BM25 fusion leg of the
  retriever's hybrid path — which is one of the *proved accuracy wins*
  of the Contextual Retrieval Part B work. RAG accuracy would regress on
  every query in fan-out mode. **Rejected.**

- **Full extraction (all ~280 lines: input processing → vector search →
  BM25 hybrid → traversal → final response assembly) per leg** — keeps
  the per-leg path identical to the legacy single-graph path, including
  the BM25 hybrid fusion and the `source='author'` spine traversal. The
  full per-leg extraction is the only option that preserves both RAG
  accuracy (full hybrid + traversal per leg) and performance (per-leg
  parallelism via `asyncio.Semaphore(FANOUT_MAX_GRAPHS)` and per-graph
  timeout via `asyncio.wait_for`). **Selected.** One focused PR
  extracted from the existing single-graph body — no behavior change to
  the single-graph path, additive everywhere else.

### Decision C — Full extraction now, not split

The 280-line `invoke()` body is a critical hot path. Splitting the work
(e.g. extract only the dense path now, defer the BM25+traversal legs
to a later PR) would land a fast PR but ship a degraded fan-out mode
that a future PR would have to re-touch — exactly the BMAD
no-remove-shortcuts / no-dirty-hacks principle. Full extraction now:
one focused change, no future rework, the legacy path is byte-identical
because the same body runs through the new helper with one argument
substituted.

### Decision D — Orchestrator MUST handle two shapes smoothly (David, 2026-09-21)

The retriever must handle BOTH shapes the chat can produce:

- **Case A — legacy single graph only**: the carrier is empty; fan-out
  does not engage; the legacy single-graph path runs unchanged against
  `ARANGO_GRAPH_NAME`.
- **Case B — legacy graph + one or more OKF graphs**: the carrier
  carries the legacy graph (`GRAPH`) as the first element plus N OKF
  graph names. Fan-out engages with the **full set** (every entry
  treated equally — the legacy graph is just one leg, not a special
  case).

This is the corrected rule (2026-09-21, supersedes the earlier "≥2
graphs" gate): the carrier is the single source of truth, the chat
forwarder MUST send `[GRAPH, OKF_<repo_a>_v<N_a>, ...]` whenever it
wants the legacy graph included, and the retriever treats every entry
as one leg. There is NO implicit "default legacy graph" fallback in
the fan-out path — once ≥1 graph is encoded, the carrier is exhaustive.

The single-element carrier IS the fan-out shape with one leg (the
legacy graph). The empty carrier IS the legacy single-graph shape.
**Selected.**

### Decision E — Per-leg timeout (ADR-039 D8)

The orchestrator wraps each per-leg `invoke()` call in
`asyncio.wait_for(..., timeout=FANOUT_PER_GRAPH_TIMEOUT_MS / 1000.0)`.
On timeout OR exception, the leg returns `[]` and logs at INFO with
the graph name. The fusion then proceeds with the surviving legs. The
Studio card (Story 10.7) surfaces per-leg failures via the
`okf.fanout.legs_failed` span attribute. **Selected.** Zero-hit per
missing graph is the correct semantic — a sick repo cannot stall every
chat.

### Decision F — Concurrency bound

`asyncio.Semaphore(FANOUT_MAX_GRAPHS)` (default 5, env-tunable) bounds
the in-flight legs. **Selected.** Matches the ADR-039 ≤20ms router gate's
fan-out cap and prevents a 50-repository deployment from spawning 50
concurrent retriever requests per query.
