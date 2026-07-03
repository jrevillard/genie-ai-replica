---
title: Multi-Turn Retrieval
description: Feature-flagged vector-space blending lets follow-up questions retrieve the subject of the previous turn, fixing stateless retrieval for pronoun-heavy queries.
weight: 8
---

By default ChatQnA retrieval is **stateless**: only the last user message is
embedded and searched against the knowledge base. This is fine for standalone
questions but breaks for multi-turn follow-ups:

> **User (turn 1):** How do I renew my residence permit?
> **User (turn 2):** Can you elaborate on this?

"Can you elaborate on this?" has no semantic content on its own. Embedding it
in isolation retrieves nothing useful, even though the conversation is clearly
about permit renewal.

## How blending works

When enabled, ChatQnA blends the **query embedding** with a **history
embedding** (the previous N turns) before retrieval:

```
V = α · EQ + (1 − α) · EH
```

where `EQ` is the embedded current query, `EH` is the embedded history, and `α`
is a configurable weight (default `0.7`, query-weighted). The blended vector
`V` is what the retriever's dense-vector leg searches with.

The blend happens inside the existing embedding pipeline node — the query and
history are sent as a **single batched embedding call** to TEI, so no extra
embedding round-trip is added beyond the batch itself and no embedding logic is
duplicated.

{{% alert title="Distinct from Contextual Retrieval" color="note" %}}
This is a **query-time** feature. [Contextual Retrieval](../contextual-retrieval/)
is an **ingest-time** feature that prepends doc-context to chunks *before* they
are embedded. They are independent and complementary — both can be enabled at
once.
{{% /alert %}}

## Configuration

All three flags default to safe no-op values. The feature is **OFF by default**.

| Flag | Default | Purpose |
|------|---------|---------|
| `MULTI_TURN_BLEND_ENABLED` | `false` | Master switch. Set `true` to enable blending. |
| `MULTI_TURN_BLEND_ALPHA` | `0.7` | Query weight `α`. `1.0` = query-only (equivalent to disabled), `0.0` = history-only. |
| `MULTI_TURN_HISTORY_TURNS` | `1` | Number of prior turns blended. `1` = previous turn only. `0` disables even if the flag is on. |

History text is drawn from the same English-normalized conversation blob used
for LLM generation, so it matches the `bge-base-en-v1.5` embedding space
regardless of the UI language.

## Limitations

Only the **dense-vector leg** is blended. Under the default production
configuration (`RETRIEVER_HYBRID_RETRIEVAL_ENABLED=false`), the retriever runs
**dense-only** — so the blended vector controls all retrieval. This limitation
has no impact unless you explicitly enable
[hybrid retrieval](../retrieval/) (opt-in), in which case the BM25 lexical leg
still uses the isolated query text and RRF fuses it with the blended dense
candidates.

The reranker also scores retrieved chunks against the isolated query text
(separate concern, not addressed by this feature).

## Benchmark

In a head-to-head benchmark, vector-space blending (Recall@1 = 91.7%)
outperformed both the stateless baseline (66.7%) and an LLM query-rewriting
alternative on pronoun-heavy multi-turn queries. The benchmark is being
reproduced inside the repo's `tests/rag-benchmarks/` harness; until then the
numbers above come from an external evaluation.
