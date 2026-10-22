# Issue 1090 — Tracing gaps: design

**Date:** 2026-10-16
**Issue:** [!1090](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1090)
**Branch:** `worktree-issue-1090-tracing-gaps` (off `origin/main` @ `86fe49b70`)
**Delivery:** Path 1 — local test suites, MR to `main`

## Problem

An RAG turn cannot be reconstructed from VictoriaTraces alone. The audit behind
issue 1090 walked a live 246-span trace and found six gaps, in priority order:

1. The LLM span carries no model, no sampling params, no token usage, no
   `finish_reason` — while being ~70% of the turn's wall time.
2. `retriever.hybrid_search` records neither retrieval parameters, nor the hybrid
   scores that produced the ranking, nor whether graph traversal ran.
3. `chatqna.orchestrate` records no blend alpha, no history-turn count, and no
   prompt-budget telemetry — including a context-budget guard that truncates
   history and emits nothing.
4. No `genie.query_id` on any span, so trace ↔ query ↔ conversation joins happen
   only by accident.
5. Streaming turns emit their outcome (confidence, groundedness) only inside the
   SSE stream, never in a trace.
6. `rag.adaptive_breakdown` entries carry `original_index` but not the chunk key,
   and the join to `rag.candidate_chunk_keys` is undocumented.

The 2026-10-15 redeploy closed the sibling gaps (chunk identity on the reranker
selection and adaptive spans). This design closes what remains.

## Constraints

### Privacy — binding, and enforced by test

The traces pipeline has **no collector-side redaction**. `transform/pii_redact`
runs on the logs branch of `configs/otel/otel-collector-config.yaml` only.
Whatever enters a span attribute reaches VictoriaTraces verbatim for the 30-day
retention window.

Rules, all enforced mechanically:

1. No free text in any attribute value. Permitted: integers, floats, booleans,
   closed enums, opaque ids, and JSON arrays of those.
2. `file_id`, never `file_name`.
3. Endpoints recorded as `urlparse(...).path` only — never host, port, or query
   string. This mirrors the existing client-span `request_hook` in
   `genie-ai-overlay/tracing.py:687`.
4. `genie.query_id` is the opaque ArangoDB `queries._key`. It is linkable to a
   user only through database admin access. Never a username, email, or any
   other user-identifying string.
5. No span per chunk and no span per candidate. Per-candidate vectors are single
   JSON-array attributes.

Detection is two-layered, because neither layer alone catches the leak class
the acceptance criterion names.

**Layer 1 — positive vocabulary check (the strong one).** Every attribute key on
every exported span must be a member of `ATTRIBUTE_NAMES.values()`. Adding an
attribute that carries query text is therefore impossible without a deliberate
edit to the vocabulary, which review already reads. This reuses the vocabulary
the design needs anyway rather than inventing a second source of truth: the
"allowlist" objection applies to a *list of exempt values*, not to the list of
attribute names we already committed to publishing.

**Layer 2 — value shape (the backstop).** Any string value containing
whitespace, or longer than 96 characters, is a violation. No value allowlist.

Layer 2 alone is not sufficient and the design does not claim it is: a one-word
user query such as `"banana"` has no whitespace and passes. Layer 1 is what
closes that, because it makes an unregistered key impossible rather than merely
discouraged. The taxonomy-label problem that would once have required a value
allowlist is handled structurally instead (below), which is what makes layer 2
safe to keep absolute.

**Labels are emitted as digests, not strings.** The taxonomy is fetched from the
Backend Service at runtime (`dataprep:717`), so there is no static vocabulary to
validate a label against, and labels like `"Soil Management"` carry whitespace
that would trip the shape rule. Emitting them raw would require either an
exemption list that nobody maintains or a validation dependency the retriever
does not have. Instead each label is reduced to a truncated BLAKE2s digest under
a fixed, repo-committed salt: deterministic across deployments, so an operator
matches a digest against their own taxonomy to recover which label was active;
8 hex characters, no free text, and nothing to maintain. Brute-forcing a digest
yields only values the operator already holds.

### Cardinality

Per-candidate score vectors are bounded by the deployment's `fetch_k` / `k`
(32 today). Tests pin that bound: feeding more than the ceiling must still yield
a capped array, and the attribute must record that a cap was applied. An
unbounded array is how a single attribute eats a trace budget on a deployment
someone else operates.

## Architecture

### Attribute vocabulary

`genie-ai-overlay/core/span_attrs.py` — every new attribute name as a constant,
plus the privacy allowlist, plus the baggage reader. Precedent:
`core/label_contract.py`.

`components/shared/lib/span-attrs.js` — the JS mirror.

Two hard requirements from `components/CLAUDE.md`, both of which have shipped
runtime bugs before:

- **Pitfall 2** — the new helper must be re-exported from
  `components/shared/lib/index.js`, or consumers barrel-importing get `undefined`.
- **Pitfall 1** — consumers must import as `require('../shared-lib')` (no `/lib/`
  segment). The `/lib/` spelling resolves under Jest and vanishes in the image.

### Correlation id transport

`genie.query_id` rides **OTel baggage**, not a bespoke header.

Verified asymmetry:

| Side | Propagator | Baggage? |
|---|---|---|
| Python services (`genie-ai-overlay/tracing.py`) | OTel default — `setup_tracing` never calls `set_global_textmap` | ✅ extracts and injects |
| Backend (`components/gov-chat-backend/tracing.js:223`) | `new W3CTraceContextPropagator()` | ❌ trace context only |

So the fix is one line on the JS side:

```js
textMapPropagator: new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()]
}),
```

Python needs **zero** propagation change.

Rejected alternatives:

- **Explicit `X-Genie-Query-Id` header.** OPEA's `ServiceOrchestrator` builds the
  outbound requests to retriever and reranker internally. chatqna cannot inject a
  custom header into those without patching vendored comps. Dead end past hop 1.
- **Encoding into `search_start`**, following the `label_contract.py` precedent.
  Survives only OPEA-internal hops, never backend → chatqna, and overloads a
  retrieval-semantics field with a correlation id.

Backend injection point: `query-routes.js:193`, where `initStreamQuery` has
already returned `queryId` and `axios.post` sends to chatqna. `@opentelemetry/
instrumentation-http` is enabled, so a baggage entry set on the active context
is injected into the outgoing request automatically.

### Span parenting

`chatqna.orchestrate` is opened with `tracer.start_as_current_span`
(`genieai_chatqna.py:2806`), so it **is** the active span while comps calls back
into `align_inputs` / `align_outputs` / `align_generator`. That makes events and
properly-parented child spans available there with no plumbing.

This is load-bearing and must be verified, not assumed: comps schedules nodes,
and if alignment ever moves to a thread pool, contextvars do not cross the
boundary and events land on the wrong span or vanish.

An OTel **event has no parent** — it is an attribute-on-a-span, not an entity,
so "the event's parent is the orchestrate span" is not an expressible
assertion. The invariant is instead: the span the event is recorded on must be
the orchestrate span. A test that hands `add_event` its own span and then
asserts the event is on that span proves nothing about production wiring, so
the gap-3 test drives the real `handle_request` path and asserts the
`context_budget.truncated` event appears on the exported
`chatqna.orchestrate` span. Additionally a source-level guard pins line 2806 to
`start_as_current_span`, because changing it to `start_span` would silently
drop every event while leaving any hand-built-span test green.

### Where each gap is emitted

| Gap | Span | Mechanism |
|---|---|---|
| 1 | `llm.invoke` (new child) | chatqna orchestrator boundary |
| 2 | `retriever.hybrid_search` (extend) | existing span |
| 3 | `chatqna.orchestrate` (extend + event) | existing span |
| 4 | 5 spans | baggage read |
| 5 | `chatqna.stream_outcome` (new) | tail of `_stream_with_metadata` |
| 6 | `reranker.tei_invoke` (extend) | existing span |

Two placement decisions worth stating explicitly, because the obvious alternative
is wrong:

- **Gap 1 emits from chatqna, not from the textgen wrapper.** The textgen wrapper
  measures server-side truth but is blind to params dropped in transit — which is
  precisely the failure class the issue exists to catch. Only the orchestrator
  boundary sees both what was sent and what came back.
- **Gap 1's span is opened with `start_span`, not `start_as_current_span`.**
  The latter returns an `_AgnosticContextManager`, not a `Span` — calling
  `.set_attribute()` on it raises `AttributeError`, and every downstream assertion
  fails with a traceback that reads like a typo rather than a design error.
  `start_span` returns a real `Span` whose lifetime we control, which the
  streaming path needs regardless: the span must stay open across `yield`s and
  must be closable from a `finally` when the generator is abandoned mid-iteration.
  Parenting stays correct because the current context is captured at open time.
- **One source of truth for "is this streaming".** `llm.stream`,
  `llm.stream_options.include_usage`, and the `align_outputs` branch condition are
  all the same fact read three ways. All three resolve from
  `llm_parameters_dict["stream"]` — which is what actually decides which branch
  comps takes, and what `align_outputs` already branches on at line 1628.
- **Gap 5 is a span, not an event on `chatqna.orchestrate`.** The streaming body
  is consumed by Starlette after `orchestrate` has ended; an event added there is
  dropped by the SDK without error.
- **Gap 5's span is explicitly parented, not merely current.** Because
  `orchestrate` has already ended by the time Starlette iterates the body, the
  context active at that moment is the request task's, not the RAG trace's. A
  `background_span` opened with no `context=` would therefore start a **new
  trace**, and the streaming outcome — the exact thing gap 5 exists to capture —
  would not join the RAG trace in VictoriaTraces. `handle_request` captures the
  orchestrate span's context at line 2806 and hands it to the outcome-span
  opener, which passes it through as a non-recording parent.

## Attribute inventory

### `llm.invoke` (gap 1)

Params come from `llm_parameters_dict` — comps' own record of what it is about to
send (`align_inputs:1284-1285` already writes `max_tokens` and `top_p` from it).
Recording *that* dict is what proves a drop: a param configured in the OPEA
service definition but absent from `llm_parameters_dict` shows as absent in the
trace. Each param is set **only when present** — absence is the signal, so no
sentinel values are used.

| Attribute | Type | Source |
|---|---|---|
| `llm.model` | str | response `model` |
| `llm.service_path` | str | `urlparse(endpoint).path` — joins to the service definition |
| `llm.stream` | bool | request |
| `llm.request.temperature` | float | `llm_parameters_dict` |
| `llm.request.top_p` | float | `llm_parameters_dict` |
| `llm.request.max_tokens` | int | `llm_parameters_dict` |
| `llm.request.frequency_penalty` | float | `llm_parameters_dict` |
| `llm.request.repetition_penalty` | float | `llm_parameters_dict` |
| `llm.usage.prompt_tokens` | int | response `usage` |
| `llm.usage.completion_tokens` | int | response `usage` |
| `llm.usage.total_tokens` | int | response `usage` |
| `llm.finish_reason` | enum | `choices[0].finish_reason` |
| `llm.stream_options.include_usage` | bool | whether we requested streaming usage |

**Streaming usage is opt-in and currently absent.** `grep` over
`genie-ai-overlay/` finds `stream_options` nowhere, and vLLM only returns `usage`
on a streamed response when the request carries
`stream_options: {include_usage: true}`. Without setting it, `usage` never
arrives and acceptance criterion 1 holds only for the sync path — reproducing the
exact "params silently dropped" class the issue exists to detect. chatqna already
writes onto the outgoing LLM request (`align_inputs:1278-1286`), so this is one
line when streaming. Tests assert `usage` is **present and non-null** on a
streaming response, not that the attribute key exists — an attribute set to null
teaches the reader nothing and satisfies a naive assertion perfectly.

### `retriever.hybrid_search` (gap 2)

Read from `input_dict` **after** `decode_filter_labels` (`retriever:894` — the
call site; `:897` is the nested `if _encoded_labels:` assignment), so the
recorded values are the effective ones, not the encoded wire form.

The emission point is **unconditional**. Emitting from inside
`if _encoded_labels:` would set none of these on every label-free query, which
is most production traffic and precisely the case where "did the label filter
silently not apply?" is the question being asked.

`rag.fetch_k` is recorded unconditionally but is only *consulted* by the `mmr`
branch (`retriever:1125`); chatqna defaults `search_type` to
`similarity_score_threshold`. Recording it regardless is correct — a span that
said what was configured rather than what was used would be the same
transparency failure this issue is about — but the vocabulary documents that it
is advisory under other search types.

| Attribute | Type |
|---|---|
| `rag.search_type` | enum `similarity_score_threshold \| mmr \| default` |
| `rag.fetch_k` | int |
| `rag.search_start_base` | enum `chunk \| edge \| node` |
| `rag.filter_labels_enabled` | bool |
| `rag.filter_label_count` | int |
| `rag.filter_label_digests` | JSON array of 8-hex digests, positional with the active labels |
| `rag.hybrid.enabled` | bool |
| `rag.hybrid.dense_weight` / `.lexical_weight` / `.rrf_k` | float / float / int |
| `rag.candidate_keys` | JSON array — **the fused ordering**, and the reference every other array is keyed against |
| `rag.scores.dense` | JSON array of float, aligned to `rag.candidate_keys` |
| `rag.scores.dense_present` | JSON array of bool — `false` where the chunk was absent from the dense leg |
| `rag.scores.bm25` | JSON array of float, aligned to `rag.candidate_keys` (hybrid only) |
| `rag.scores.fused` | JSON array of float, aligned, before the `[:k]` cut |
| `rag.scores.capped` | bool — input exceeded the ceiling |
| `traversal.enabled` | bool |
| `traversal.max_depth` / `.max_returned` / `.score_threshold` | int / int / float |
| `traversal.injected_docs` | int |
| `traversal.injected_neighbor_items` | int |

**Alignment is by construction, not by coincidence.** `rrf_fuse` returns a *new*
list, sorted by fused score descending, de-duplicated by chunk identity, and it
may contain BM25-only chunks that the dense leg never saw. Emitting the pre-fusion
dense leg beside the fused order would make index *i* of two attributes describe
different chunks — confidently wrong data, which is worse than absent data. So
the dense and lexical legs are **keyed by chunk id and re-expanded in fused
order**, with `rag.scores.dense_present` distinguishing "not retrieved by this
leg" from "scored zero". A chunk absent from a leg gets `0.0` plus a `false` in
the presence mask; it never silently inherits another chunk's score.

Capture points: the dense leg is snapshotted **unconditionally** after the dense
search and label filter settle (`:1170`) — not inside the `HYBRID_RETRIEVAL_ENABLED`
block. That flag is **on by default** (`config.py:227` reads
`os.getenv(..., "true")` and compose sets `:-true`), so the dense-only path is not the
common case today — but it is reachable, and a snapshot taken inside the block would
leave the variable undefined on every request where the flag is off. The lexical leg is
snapshotted from the `bm25_res` assignment (`:1181`). The fused leg is the `rrf_fuse`
return before the top-k cut (`:1190`).

Traversal from the block at `:1226-1300`. `traversal.injected_docs` counts seed
documents that received content; `traversal.injected_neighbor_items` counts the
neighbour items appended across them. They are different quantities and are
recorded under different names.

### `chatqna.orchestrate` (gap 3)

| Attribute | Type |
|---|---|
| `rag.blend.enabled` | bool |
| `rag.blend.alpha` | float — the **per-request** `_blend_alpha` (`:2833`), not the module constant |
| `rag.blend.history_turns` | int — segments actually fed, not `MULTI_TURN_HISTORY_TURNS` |
| `rag.history.segments_in` / `.segments_sent` | int |
| `rag.prompt.window_tokens` | int |
| `rag.prompt.answer_budget_tokens` | int |
| `rag.prompt.tokens_estimate` | int |

Plus event `context_budget.truncated`, emitted inside `align_inputs` at `:1257`
where `dropped_segments` is already in scope, carrying `dropped_segments`,
`window_tokens`, `answer_budget_tokens`, `max_history_tokens`.

This is the gap that "fired silently for weeks". One event turns it from a code
read into a Grafana query.

### `chatqna.stream_outcome` (gap 5)

Opened at the tail of `_stream_with_metadata` via `background_span` — so it
activates and its logs inherit the trace context.

| Attribute | Type |
|---|---|
| `retrieval.confidence` | float |
| `llm.self_confidence` | float (attribute **omitted** when None) |
| `answer.is_grounded` | bool |
| `answer.sentinel_present` | bool |
| `answer.abstained` | bool |

All values are already computed at that point (`:2062-2098`).

### `reranker.tei_invoke` (gap 6)

New parallel attribute `rag.adaptive_chunk_keys`, emitted in the same loop that
sets `rec["original_index"]` (`reranker:534-535`), pulled from
`input.retrieved_docs` metadata. Same length and order as
`rag.adaptive_breakdown`; the join is documented in `span_attrs.py`.

Deliberately **not** a shape change to `rag.adaptive_breakdown`: the eval harness
already keys on the `rag.*` attributes in that family, and reshaping a shipped
attribute breaks consumers silently.

An entry whose chunk key cannot be resolved contributes `__unresolved__`, a
reserved token — **not** `"unknown"` and not `""`, which would satisfy the shape
rule while reading like a real value. The distinction matters: `__unresolved__`
means "this index had no metadata", while an empty string would mean "there was
an empty key". `__unresolved__` contains no whitespace and is declared in the
vocabulary module, so the shape rule stays absolute without an exemption.

**Value encoding follows what OTel can represent.** OTel attribute values are
primitives or *homogeneous* sequences, so a flat list of scalars goes on as a
Python list and OTel renders it as an array. A **list of dicts is not
representable** and must be JSON-encoded — which is why `rag.adaptive_breakdown`
(`reranker:543`) and `retriever.summarizer.overflow_doc_ids` (`retriever:1359`)
are `json.dumps` strings, deliberately.

Those names are declared in `span_attrs.py:JSON_ENCODED_ATTRIBUTE_NAMES` and
validated by **parsing** rather than by the flat shape rule: the value must
`json.loads`, and every leaf string recursively gets the normal shape check. That
is strictly stronger than exempting them — a JSON blob carrying prose still
fails, because the leaf trips the rule — and it fails closed on anything that
does not parse. `rag.adaptive_chunk_keys` is a flat list of strings and therefore
a real array, differing from its neighbour for a concrete reason rather than by
inconsistency.

### `genie.query_id` (gap 4)

Set on: the backend `POST /api/chat/stream` span, `chatqna.orchestrate`,
`llm.invoke`, `retriever.hybrid_search`, `reranker.tei_invoke`.

**Absent baggage means the attribute is not set** — never a placeholder, so
"missing" stays distinguishable from "empty".

## Testing

One session-scoped `TracerProvider` fixture in `genie-ai-overlay/tests/conftest.py`
with a function-scoped `InMemorySpanExporter` reset, plus a `SimpleSpanProcessor`.
The fixture installs and tears down the global provider, so the teardown question
is answered once for the whole suite.

**Assertions read finished spans out of the exporter. Never mocks.** A mock-based
assertion passes regardless of what the SDK does — and this repo already has that
bug in the record: `tests/otel-collector/run-pii-smoke.sh` sat unwired and its
assertions queried `_msg:REDACTED`, which by construction excludes the unredacted
rows it was supposed to catch. It passed against a completely broken redactor. A
test that passes when the feature is broken is worse than no test, because it
buys the confidence that was the reason for skipping the check.

Per gap:

- **Gap 1** — drive `align_outputs` with a realistic OpenAI response; assert
  model, each present param, `usage.*`, `finish_reason`. Drive `align_generator`
  with a chunk stream; assert `usage` is **non-null** on the streaming path, and
  that `llm.stream_options.include_usage` is `true`. A negative test asserts a
  param absent from `llm_parameters_dict` produces no attribute.
- **Gap 2** — invoke the retriever with a stubbed AQL executor; assert the
  effective `search_start_base` and the label digest array (not the encoded wire
  form), the three score arrays in matching positional order, and the traversal
  counters. A dedicated digest test asserts the digest is stable across calls and
  that two different labels produce two different digests. Pin the ceiling: feed
  32, get 32; feed more, get capped plus the cap-flag.
- **Gap 3** — force truncation with a tight `max_history_tokens`; assert the event
  exists **and that its parent is `chatqna.orchestrate`**.
- **Gap 4** — unit round-trip: set baggage, assert the reader returns it, assert
  `span_attrs.js` and `span_attrs.py` agree on the key. Backend Jest: assert the
  `baggage` header appears on an outgoing axios request under the composite
  propagator, and does **not** under the old trace-only one.
- **Gap 5** — drive `_stream_with_metadata` with a fake iterator; assert the
  outcome span exists with the expected values and that `llm.self_confidence` is
  absent when the sentinel never completed.
- **Gap 6** — run the adaptive path with stubbed TEI; assert
  `rag.adaptive_chunk_keys` has the same length and order as
  `rag.adaptive_breakdown`, and that the keys join to the emitted selection.
- **Privacy** — a synthetic end-to-end turn; sweep every attribute of every
  exported span against the shape rules and the allowlist.

Suites run in full before the MR: `pytest tests/`, backend `npm test`,
`npm run lint`, `npm run format:check`, `ruff check`, `ruff format --check`.

## Verification after merge

The merge is **not** gated on live validation — that is the delivery decision, and
it stands. But local tests cannot observe the layers between "code is correct"
and "anyone can see it"; a previous fix in this repo was invisible three times
over (stale container, stale on-disk cache with no freshness gate, immutable
browser bundle).

So issue 1090 carries a **named follow-up** holding a copy-pasteable Jaeger
query against VictoriaTraces, listing every attribute this design introduces and
failing loudly when any is absent. That command — not the merge — is what closes
the issue.

## Unverified assumptions (gates, not facts)

`comps` is **not in this repository** — it is vendored at build time and mocked
in `tests/conftest.py`. Two things this design depends on therefore cannot be
settled from the source tree, and neither is assumed:

1. **Does `align_generator(self, gen, **kwargs)` receive `llm_parameters_dict`?**
   `align_inputs` and `align_outputs` take it as a *named positional* (`:1036`,
   `:1302`); `align_generator` takes only `gen`. If comps does not pass it,
   `kwargs.get("llm_parameters_dict")` yields `None` and gap 1's parameter
   attributes vanish on the streaming path — silently, because every unit test
   calls the helper directly.
2. **Does `stream_options: {include_usage: true}` survive chatqna → textgen →
   vLLM?** `core/genieai_api_protocol.py` already declares
   `stream_options: StreamOptions | None`, which is necessary but not
   sufficient; the textgen wrapper's forwarding is vendored.

Both are verified against the vendored `comps` **inside the built image**, using
`genie-ai-overlay/contracts/` — the suite that exists for exactly this purpose,
running against real `comps` rather than the mock. If either fails, the affected
step is redesigned rather than shipped on assumption.

## Out of scope

- The full-prompt log line in chatqna (`Full messages array`, which includes the
  `USER INFORMATION` block) remains the actual PII-bearing channel. It is already
  covered by logs-pipeline redaction and its smoke test.
- Collector-side redaction for the traces pipeline. The issue's chosen discipline
  is emission-side, and this design enforces it with a test instead.
- Any new dashboard or Grafana provisioning. The issue tracks span attributes.
- Renaming or reshaping `rag.adaptive_breakdown`.