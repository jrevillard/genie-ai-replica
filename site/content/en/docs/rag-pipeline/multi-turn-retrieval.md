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
[Contextual Retrieval](../contextual-retrieval/) is an **ingest-time**
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
This keeps the `bge-base-en-v1.5` embedding space consistent regardless
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