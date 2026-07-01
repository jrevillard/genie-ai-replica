---
title: Reranking
description: Cross-encoder reranking strategies, score calibration, and how the user-facing confidence score is derived.
weight: 3
---

Retrieval hands the reranker a candidate set of chunks; the reranker's job is to
re-order them by true relevance to the query and decide **how many** (if any) are
good enough to send to the LLM. A cross-encoder reranker is more accurate than
the bi-encoder used for retrieval because it reads the query and each chunk
together, but it is also slower — which is why it runs only on the small
candidate set, not the whole corpus.

The default reranker model is `BAAI/bge-reranker-v2-m3`.

## Selection strategies

The reranker supports four strategies for turning a scored list into a final set.
Choose one with `RERANKER_STRATEGY`:

| Strategy | How it decides the cut | When to use |
|---|---|---|
| **`adaptive`** (default) | Picks the strategy automatically based on the score distribution. | General purpose; safe default. |
| **`slice`** | Keeps a fixed number of top chunks (`RERANKER_TOP_N`). | Predictable context size. |
| **`threshold`** | Keeps every chunk above `RERANKER_THRESHOLD`. | Strict quality gate. |
| **`knee_threshold`** | Keeps chunks up to the largest score drop ("knee"). | Adapts to varied query difficulty. |

With `slice` (the simplest mental model), `RERANKER_TOP_N=2` sends the two
best-scoring chunks to the LLM.

## Score calibration

Raw reranker outputs are logits and are **not comparable across models or
queries**. GENIE.AI calibrates them with a sigmoid mapping into the `[0, 1]`
range (`RERANKER_SCORE_CALIBRATION`) so that scores become meaningful
probabilities. Calibration is what makes a single threshold usable across
deployments and is the prerequisite for a sensible confidence score.

## The displayed confidence score

The user-facing **confidence score** is a **rank-weighted aggregate of the
calibrated reranker scores** of the chunks actually used for the answer:

- More-relevant chunks (higher rank) contribute more.
- Fewer, low-scoring chunks → lower confidence.
- Many high-scoring chunks → higher confidence.

This is an **uncalibrated, relative** signal — useful as a "how strongly was this
answer grounded?" hint, not an absolute correctness guarantee. Two complementary
signals exist:

- **Self-confidence** (optional): the LLM itself emits a `[[CONF:0-100]]` token
  reflecting its own certainty. See [Generation]({{< relref "generation" >}}).
- **Abstention**: when no chunk clears the relevance bar, the pipeline declines
  to answer rather than guess. See
  [Generation &rarr; Abstention]({{< relref "generation" >}}#abstention).

## Knobs

| Variable | Default | Effect |
|---|---|---|
| `RERANKER_STRATEGY` | `adaptive` | Selection strategy. |
| `RERANKER_TOP_N` | 2 | Chunks kept (for `slice`, and as a cap elsewhere). |
| `RERANKER_THRESHOLD` | 0.9 | Score gate (for `threshold` / `knee_threshold`). |
| `RERANKER_SCORE_CALIBRATION` | sigmoid | Raw-score → `[0,1]` mapping. |

> **Retrieval quality first.** A reranker re-orders; it cannot rescue chunks that
> were never retrieved. If answers feel off, widen retrieval (`fetch_k`,
> thresholds) before tuning the reranker.
