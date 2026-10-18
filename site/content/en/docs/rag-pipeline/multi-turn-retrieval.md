---
title: Multi-Turn Retrieval
description: Feature-flagged vector-space blending lets follow-up questions retrieve the subject of the previous turn, fixing stateless retrieval for pronoun-heavy queries.
weight: 10
aliases:
  - /docs/rag/multi-turn-retrieval/
mode: explanation
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

By default ChatQnA retrieval is **stateless**: only the last user message is
embedded and searched against the knowledge base. This is fine for
standalone questions but breaks for multi-turn follow-ups:

> **User (turn 1):** How do I renew my residence permit?
> **User (turn 2):** Can you elaborate on this?

"Can you elaborate on this?" has no semantic content on its own. Embedding
it in isolation retrieves nothing useful, even though the conversation is
clearly about permit renewal.

This page is for developers tuning ChatQnA's query-time behaviour and
operators debugging multi-turn interactions.

## How blending works

When enabled, ChatQnA blends the **query embedding** with a **history
embedding** (the previous N turns) before retrieval:

```text
V = α · EQ + (1 − α) · EH
```

where `EQ` is the embedded current query, `EH` is the embedded history,
and `α` is a configurable weight (default `0.7`, query-weighted). The
blended vector `V` is what the retriever's dense-vector leg searches with.

The blend happens inside the existing embedding pipeline node — the
query and history are sent as a **single batched embedding call** to TEI,
so no extra embedding round-trip is added beyond the batch itself and no
embedding logic is duplicated.

{{% alert title="Distinct from Contextual Retrieval" color="note" %}}
This is a **query-time** feature.
[Contextual Retrieval](./contextual-retrieval/) is an **ingest-time**
feature that prepends doc-context to chunks *before* they are embedded.
They are independent and complementary — both can be enabled at once.
{{% /alert %}}

| Flag | Default | Purpose |
|------|---------|---------|
| `MULTI_TURN_BLEND_ENABLED` | `false` | Master switch. Set `true` to enable blending. |
| `MULTI_TURN_BLEND_ALPHA` | `0.7` | Query weight `α`. `1.0` = query-only (equivalent to disabled), `0.0` = history-only. |
| `MULTI_TURN_HISTORY_TURNS` | `1` | Number of prior turns blended. `1` = previous turn only. `0` disables even if the flag is on (chatqna.py:2373 guards on `> 0`). |

History text is the last `MULTI_TURN_HISTORY_TURNS` user/assistant
messages, normalised to English by the backend before embedding (see
[Generation → Multilingual chat history]({{< relref "generation" >}})).
This keeps the `bge-large-en-v1.5` embedding space consistent regardless
of the UI language.

## Limitations

Only the **dense-vector leg** is blended. Under the docker-compose
runtime default (`RETRIEVER_HYBRID_RETRIEVAL_ENABLED=true`), the retriever
runs **hybrid** (dense + BM25 + RRF) — the blended vector controls the
dense leg while BM25 still uses the isolated query text and RRF fuses the
two. Set `RETRIEVER_HYBRID_RETRIEVAL_ENABLED=false` in `.env` to fall
back to dense-only, where the blended vector controls all retrieval.

The reranker also scores retrieved chunks against the isolated query
text (separate concern, not addressed by this feature).

### Failure modes

- `MULTI_TURN_BLEND_ALPHA=0.0` → retrieval runs against the prior turn
  only. Queries that don't reference history will degenerate to
  garbage. Leave at the default (`0.7`) unless you have a measured
  reason.
- `MULTI_TURN_HISTORY_TURNS=0` → silent no-op even when the master
  switch is on (chatqna.py:2373).
- `MULTI_TURN_BLEND_ENABLED=true` while history translation is slow →
  per-turn latency adds up. See
  [Generation → Multilingual chat history]({{< relref "generation" >}}).

## Benchmark

In a head-to-head benchmark, vector-space blending (Recall@1 = 91.7%)
outperformed both the stateless baseline (66.7%) and an LLM
query-rewriting alternative on pronoun-heavy multi-turn queries. The
benchmark is being reproduced inside the repo's `tests/rag-benchmarks/`
harness; until then the numbers above come from an external evaluation.

## Verification

After enabling, send a pronoun-heavy follow-up and confirm the blend
executed: the `_blend_history_text` and `_blend_alpha` inputs flow into
the megaservice at `genieai_chatqna.py:2472-2473`, but the blend itself
is **not** surfaced as a chatqna span attribute — verify via the
`source_documents` array in the SSE metadata event (the prior-turn
subject should appear in the kept chunks) and via the OPEA megaservice
embedding HTTP client span (`POST /v1/embeddings`) which carries the
batched query+history call.

## Related

- [Retrieval]({{< relref "retrieval" >}}) — what the blended vector is
  fed into. Note the interaction with `RETRIEVER_HYBRID_RETRIEVAL_ENABLED`.
- [Generation → Multilingual chat history]({{< relref "generation" >}}) —
  where the history text comes from before embedding.
- [Streaming & metadata events]({{< relref "streaming-sse" >}}) —
  ChatQnA's per-stage spans, including `chatqna.orchestrate` (root) and
  `chatqna.reranker_selection`.

## Condense mode (`MULTI_TURN_MODE=condense`)

Blending reshapes the *embedding*. Condense mode instead rewrites the
*query text* — each follow-up is sent through an LLM that turns it
into a standalone information-retrieval question before it reaches
the retriever and reranker. This targets the same failure mode
(pronoun-heavy follow-ups that have no semantic content on their own)
but with a different trade-off: one extra round-trip to the chat LLM
per multi-turn query, in exchange for the raw retriever behaving as
if every turn were standalone.

The rewrite runs **upstream of both retrieval and reranking**: the
rewritten standalone query is what the dense + BM25 legs search with,
and it is also what the reranker scores the candidates against. The
raw last user message is kept as the RAG prompt question (what the LLM
actually answers), so the user sees their own words in the response.

### Fail-closed semantics

Condense is **fail-closed**: a failed rewrite fails the turn. There is
no fallback to the isolated query — if the rewrite call times out,
returns a malformed body, or produces a missing/blank
`standalone_query`, ChatQnA responds with HTTP `503` and a structured
envelope:

```json
{
  "error": "condense_failed",
  "reason": "timeout | http_error | bad_body | missing_field | empty_query",
  "message": "Query rewriting failed; this turn cannot be answered reliably. Please retry."
}
```

This is deliberate. A silent fallback to the raw message would let
broken rewrites silently degrade retrieval quality, which is harder to
diagnose than a 503. Operators see the failure in VictoriaTraces
(status `failed`) and in the chatqna logs; users get a retry prompt
rather than a confident-but-wrong answer.

### Environment variables

| Flag | Default | Purpose |
|------|---------|---------|
| `MULTI_TURN_MODE` | `blend` | Mode selector. Only the exact string `condense` (after `strip().lower()`) enters the condense branch — anything else skips it. Vector-space blending runs in the `elif` branch, gated on `MULTI_TURN_BLEND_ENABLED=true` AND `MULTI_TURN_HISTORY_TURNS > 0`. A typo'd mode with blend disabled (the default) falls through to stateless retrieval on the raw query — neither condense nor blend runs. |
| `MULTI_TURN_CONDENSE_HISTORY_TURNS` | `8` | Number of prior conversation segments fed to the condense rewrite prompt. Only consulted when `MULTI_TURN_MODE=condense`; the blend path keeps its own `MULTI_TURN_HISTORY_TURNS` knob. |
| `MULTI_TURN_CONDENSE_MAX_TOKENS` | `256` | Output cap (tokens) for the condense rewrite LLM call. A rewrite longer than the cap truncates the guided JSON mid-string → `bad_body` → the turn fails closed (503). Raise it if valid rewrites of long multi-clause follow-ups keep failing. |
| `MULTI_TURN_CONDENSE_TIMEOUT_SECONDS` | `5.0` | Fail-closed budget (seconds) for the condense rewrite call. A timeout fails the turn (503). Raise it for slow GPU nodes. |
| `MULTI_TURN_CONDENSE_SYSTEM_PROMPT` | *(built-in)* | Overrides the condense rewrite prompt. A custom prompt must still demand JSON-only output — the response is parsed as `{"standalone_query": "..."}` and anything else fails the turn (503). |

Setting `MULTI_TURN_MODE=condense` while `MULTI_TURN_BLEND_ENABLED=true`
logs a warning and **ignores the blend flag** — the two paths cannot
run together, and condense wins. This avoids a confused state where
the embedding is blended AND the query text is rewritten, which would
double-count the same prior-turn signal.

### Observability

The `chatqna.query_condense` span is emitted **only when
`MULTI_TURN_MODE=condense`** — the span emission is gated on the
mode check in `handle_request`, so blend-mode traffic never opens it
at all. Under condense mode, every multi-turn turn opens exactly one
span via one of two paths:

- **Call path** (`status` ∈ `ok` / `failed`): the rewrite call
  executed. `ok` means a usable standalone query was returned;
  `failed` means the rewrite raised (HTTP 503 returned to the
  caller).
- **Skip path** (`status` = `skipped_no_history`): condense mode is
  active but the history window is empty, so zero LLM calls were
  made — the raw last message becomes the retrieval query. The span
  exists specifically to answer "why is there no rewrite?" from
  traces.

Attributes:

| Attribute | When set | Notes |
|-----------|----------|-------|
| `genie.condense.mode` | every condense-mode span | Current value of `MULTI_TURN_MODE` at span time. |
| `genie.condense.status` | every condense-mode span | `ok` / `failed` / `skipped_no_history` as above. |
| `genie.condense.latency_ms` | `ok` / `failed` only | Wall-clock for the rewrite call (rounded). Not set on `skipped_no_history` — no LLM call was made. |
| `genie.condense.prompt_tokens` | `ok` only | Tokens consumed by the condense prompt. |
| `genie.condense.completion_tokens` | `ok` only | Tokens emitted by the condense response. |

In Grafana's RAG pipeline waterfall, `chatqna.query_condense` precedes
`chatqna.orchestrate` on every condense-mode turn where history is
present; the two spans are siblings (not nested), with condense first.
Under condense mode every request opens the span — `ok`/`failed` on the
call path, `skipped_no_history` when the history window is empty
(including single-turn requests). Under blend mode (`MULTI_TURN_MODE=blend`,
the default) no `chatqna.query_condense` span is opened at all — the span
emission is gated on the mode check in `handle_request`.

### Verification

After enabling, send a pronoun-heavy follow-up and confirm the
rewrite ran:

- The `chatqna.query_condense` span has `status=ok` and the
  `latency_ms` is roughly the chat-LLM round-trip.
- The `source_documents` array in the SSE metadata event contains
  chunks whose prior-turn subject is in evidence — the retrieval ran
  on the rewritten query, not the pronoun.
- The chat LLM's response still quotes the user's *raw* words
  (the rewrite is retrieval-only).

To force the fail-closed path: set `MULTI_TURN_MODE=condense`, point
`OPENAI_API_KEY` (or the upstream chat backend) at an unreachable
endpoint, and send a multi-turn query — expect a 503 with
`error=condense_failed, reason=timeout` rather than a degraded
retrieval.
