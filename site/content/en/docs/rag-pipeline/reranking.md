---
title: Reranking
description: Cross-encoder reranking strategies, score calibration, and how the user-facing confidence score is derived.
weight: 4
aliases:
  - /docs/rag/reranking/
mode: how-to
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Retrieval hands the reranker a candidate set of chunks; the reranker's job
is to re-order them by **true relevance** to the query and decide **how
many** (if any) are good enough to send to the LLM. A cross-encoder reranker
is more accurate than the bi-encoder used for retrieval because it reads the
query and each chunk together, but it is also slower — which is why it runs
only on the small candidate set, not the whole corpus.

The default reranker model is `BAAI/bge-reranker-v2-m3` (set via
`RERANKER_MODEL_ID`).

This page is for developers tuning the reranker and operators debugging the
confidence score the user sees.

## Prerequisites

- The Retriever service is returning chunks (see [Retrieval]({{< relref "retrieval" >}})).
- The TEI reranker is reachable from ChatQnA (`RERANK_SERVER_HOST_IP`,
  `RERANK_SERVER_PORT`).
- For the **displayed confidence score** debugging, familiarity with
  VictoriaTraces (per-chunk reranker spans) helps.

## Selection strategies

The reranker supports five strategies for turning a scored list into a final
set. Choose one with `RERANKING_STRATEGY`:

| Strategy | How it decides the cut | When to use |
|---|---|---|
| **`slice`** (default in the reranker service, `genieai_tei_reranker.py:46`) | Top-N by TEI cross-encoder score (`RERANKER_TOP_N` = 3). | Predictable context size. The right default for most deployments. |
| **`adaptive`** (default in the chatqna wrapper, `genieai_chatqna.py:204`) | Utility-cost selection: `relevance × novelty − token_cost`; penalises near-duplicates (novelty sigmoid) and large context windows (context decay). | Dynamic context; tune `CONTEXT_DECAY_FACTOR` and friends. |
| **`threshold`** | Keeps every chunk above `RERANKING_THRESHOLD`. | Strict quality gate. |
| **`slice_threshold`** | Top-N, but only chunks that also clear `RERANKING_THRESHOLD`. | Predictable size + a quality floor. |
| **`knee_threshold`** | Keeps chunks up to the largest score drop ("knee"). | Adapts to varied query difficulty. |

With `slice`, `RERANKER_TOP_N` (default 3) sets how many top chunks go to
the LLM.

> **Two defaults, two layers.** The TEI reranker microservice reads
> `RERANKING_STRATEGY` with default `slice` (`genieai_tei_reranker.py:46`).
> The ChatQnA wrapper reads it with default `adaptive`
> (`genieai_chatqna.py:204`). ChatQnA's value wins when ChatQnA is in the
> path; the reranker service only sees the per-request override that
> ChatQnA forwards. Pick the strategy that matches the layer you expect to
> serve the request.

### Adaptive knobs

`adaptive` activates four knobs at once:

| Variable | Default | Effect |
|---|---|---|
| `NOVELTY_SIGMOID_A` | 20.0 | Novelty → weight logistic steepness. Higher = sharper novelty penalty. |
| `NOVELTY_SIGMOID_B` | 0.25 | Novelty → weight logistic midpoint. Higher = chunks need to be less duplicative to be picked. |
| `CONTEXT_DECAY_FACTOR` | 0.0025 | Per-token context-window cost coefficient. Larger = shorter kept context. |
| `MIN_VALUE_THRESHOLD` | -1.0 | Select a chunk only if `relevance × novelty − token_cost` exceeds this. |

The formula implemented in `genieai_tei_reranker.py` is documented inline
at lines 99-160 — see the `adaptive_select` function for the exact
arithmetic.

## Score calibration

Raw reranker outputs are logits and are **not comparable across models or
queries**. GENIE.AI *can* map them into the `[0, 1]` range with a sigmoid
(`RERANKER_SCORE_CALIBRATION=sigmoid`), but this is **off by default**
(`none`) — raw scores pass through untouched. Enable `sigmoid` only after
verifying the TEI reranker emits raw logits: applied naively it
*compresses* scores and can make the displayed confidence misleading. The
confidence score below is relative either way.

| Variable | Default | Effect |
|---|---|---|
| `RERANKER_SCORE_CALIBRATION` | `none` | Raw-score → `[0,1]` mapping (`sigmoid` is opt-in). |
| `RERANKER_SCORE_TEMPERATURE` | 1.0 | Temperature for sigmoid calibration (only used when `sigmoid`). |

> **Failure signature.** A misconfigured sigmoid typically shows
> confidence values clustered around 0.5 across all queries. Revert to
> `none` and compare the before/after distribution in VictoriaMetrics
> (`rag.reranker.calibrated_score`).

## The displayed confidence score

The user-facing **confidence score** is a **rank-weighted aggregate of the
calibrated reranker scores** of the chunks actually used for the answer.
Rank-weighting is what makes rank 0 matter more than rank 1 — a strongly
relevant top chunk contributes disproportionately to the displayed score.

The implementation lives in `_display_confidence` (`genieai_chatqna.py:407-417`),
`_rank_weighted_confidence` (`genieai_chatqna.py:390-404`), and the
surrounding calibration block (`genieai_chatqna.py:340-389`):

```text
weight_i       = exp(-rank_i × CONFIDENCE_RANK_DECAY)         # rank 0 = best
confidence    = Σ_i (weight_i × calibrated_score_i) / Σ_i weight_i
```

`CONFIDENCE_RANK_DECAY` (default 0.5) controls how sharply later ranks lose
weight. Larger values decay faster (rank 1 contributes less); smaller values
flatten the contribution (more like an arithmetic mean).

Why not an arithmetic mean? The plain arithmetic mean is
**count-dependent and tail-sensitive**: the adaptive reranker strategy
keeps low-scoring-but-novel chunks, each of which would drag the mean
down, so richer context was *punished*. See the rank-weighted aggregate
rationale documented at `genieai_chatqna.py:1677-1684`. (A historical
D1 metadata-failure bug — documented at `genieai_chatqna.py:1647-1656` —
previously injected 0.0 scores into the aggregation when a
document-repository metadata lookup failed; that path now skips the
document instead.) Rank-weighted aggregate is more stable.

The displayed value is an **uncalibrated, relative** signal — useful as a
"how strongly was this answer grounded?" hint, not an absolute correctness
guarantee. The two complementary signals are:

- **`self_confidence`** (optional, `LLM_SELF_CONFIDENCE_ENABLED=1`): the
  LLM itself emits a `[[CONF:0-100]]` token reflecting its own certainty.
  See [Generation → Self-confidence]({{< relref "generation" >}}#self-confidence).
- **`is_grounded`** (always): a boolean, true iff at least one chunk
  passed the reranker. When false and `CHATQNA_ENFORCE_ABSTENTION=true`,
  the pipeline declines to answer rather than guess. See
  [Generation → Abstention]({{< relref "generation" >}}#abstention).

The three signals appear separately in the SSE metadata event — see
[Streaming & metadata events]({{< relref "streaming-sse" >}}).

## Knobs

| Variable | Default | Effect |
|---|---|---|
| `RERANKING_STRATEGY` | `slice` (reranker) / `adaptive` (chatqna) | Selection strategy. |
| `RERANKER_TOP_N` | 3 | Chunks kept (for `slice` / `slice_threshold`, and as a cap). |
| `RERANKING_THRESHOLD` | 0.75 | Score gate (for `threshold` / `slice_threshold` / `knee_threshold`). The docker-compose / TEI reranker default is `0.75`; the in-code chatqna default is `0.9` (overridden by the env var / docker-compose at runtime). |
| `RERANKER_SCORE_CALIBRATION` | `none` | Raw-score → `[0,1]` mapping (`sigmoid` is opt-in). |
| `RERANKER_SCORE_TEMPERATURE` | 1.0 | Temperature for sigmoid calibration. |
| `CONFIDENCE_RANK_DECAY` | 0.5 | Per-rank exponential weight decay (rank 0 = best). |
| `NOVELTY_SIGMOID_A` | 20.0 | `adaptive` only — novelty logistic steepness. |
| `NOVELTY_SIGMOID_B` | 0.25 | `adaptive` only — novelty logistic midpoint. |
| `CONTEXT_DECAY_FACTOR` | 0.0025 | `adaptive` only — per-token context cost. |
| `MIN_VALUE_THRESHOLD` | -1.0 | `adaptive` only — marginal-value cut. |

> **Retrieval quality first.** A reranker re-orders; it cannot rescue
> chunks that were never retrieved. If answers feel off, widen retrieval
> (`RETRIEVER_ARANGO_FETCH_K`, thresholds, enable `RETRIEVER_HYBRID_RETRIEVAL_ENABLED`)
> before tuning the reranker.

## Verification

After changing the strategy, run a small A/B over 5–10 known queries and
compare the reranker's per-chunk scores (see per-chunk spans in
[Observability → Traces]({{< relref "/docs/observe" >}})). The kept
set should change in line with the strategy:

- `threshold` → drop chunks below `RERANKING_THRESHOLD`.
- `knee_threshold` → drop chunks past the largest score drop.
- `adaptive` → drop near-duplicates and large context-window chunks.
- `slice` → keep exactly the top-N regardless of score.

Inspect the `reranker.strategy` attribute on the reranker microservice span
in VictoriaTraces to confirm what the pipeline did. The
`confidence_score` (the value users see) is exposed via the SSE metadata
event (`confidence_score` field) — see
[Streaming & metadata events]({{< relref "streaming-sse" >}}).

## Related

- [Retrieval]({{< relref "retrieval" >}}) — produces the chunks the
  reranker consumes.
- [Generation]({{< relref "generation" >}}) — what happens to the kept
  chunks next.
- [Streaming & metadata events]({{< relref "streaming-sse" >}}) — the
  SSE envelope that exposes the confidence score to the backend.