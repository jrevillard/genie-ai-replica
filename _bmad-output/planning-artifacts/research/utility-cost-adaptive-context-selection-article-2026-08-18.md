---
title: "Article — Rethinking Context Selection in RAG: A Utility–Cost Framework for Adaptive Context Selection"
author: Roman Chestnov (@roman.digitallab, Medium)
source: https://medium.com/@roman.digitallab/rethinking-context-selection-in-rag-a-utility-cost-framework-for-adaptive-context-selection-8ccb185f1f5d
published: 2026-08-18
captured: 2026-08-18
capture_note: >-
  Medium returns HTTP 403 to direct fetches; this capture was retrieved via the
  Jina reader proxy (r.jina.ai). Code referenced in the article:
  github.com/romanchest/adaptive_context_selection_for_RAG
type: research (third-party)
relevance: OKF multi-graph RAG — context selection stage after reranking
---

# Article: Rethinking Context Selection in RAG — A Utility–Cost Framework

**Author:** Roman Chestnov (@roman.digitallab) — Medium, 2026-08-18.

## 1. Core problem

RAG is a building block for grounding models in domain knowledge, controlling token
usage, and giving AI agents long-term memory. Retrieval strategies and rerankers get
attention, but the step of **selecting which documents (chunks) to pass to the LLM
from the reranked candidates** is rarely discussed — despite having as much influence
on response quality as retrieval itself.

Common approaches are fixed rules:

- **Top-K** — return a fixed number of documents
- **Static threshold** — include documents whose reranker score exceeds a cutoff
- **Slice-threshold combinations** of the above

These are cheap and often effective, but they assume the optimal selection strategy is
constant across queries, collections, and retrieval scenarios. In practice retrieval
quality, redundancy, semantic overlap, and ranking confidence vary. Adaptive
thresholding (e.g. Kneedle knee-point detection) uses a single signal and ignores
everything else.

Motivation from public-sector RAG: policy/regulatory documents distribute information
across semantically similar chunks describing different aspects of the same topic.
Simple selection either excludes relevant chunks or introduces excessive noise.

## 2. Proposed framework — utility–cost optimization

Instead of asking "which documents are relevant?", ask **"which documents are worth
including?"**. Each candidate has:

- **Expected utility U** — contribution to final response quality
- **Expected cost C** — negative impact of inclusion

```
V_i = U_i − C_i
k*  = argmax_k Σ (U_i − C_i)      # subset maximizing total expected value
```

Approximated greedily: select document i iff **V_i > 0**, processing candidates in
reranker order.

Design principles: **adaptive not static** (decision depends on current retrieval
characteristics), **multiple signals** (not one metric), **modular** (utility and cost
estimators calibrated independently), **lightweight** (no agentic-RAG added inference,
latency, or privacy concerns).

## 3. Estimating utility — U = R × K

Multiplicative: a document is useful only when BOTH relevance and complementarity are
present (highly relevant but redundant ⇒ little added; novel but unrelated ⇒ nothing).

### Relevance R

Reranker score s_i, interpreted within its distribution (0.85 is strong when mean is
0.5, weak when scores cluster above 0.9):

```
R_i = s_i × (1 + tanh((s_i − mean(s)) / σ))     # σ = std dev of candidate scores
```

Keeps relevance positive, smooth on small changes, no extreme fluctuations.

### Complementarity K — how much new info beyond what's already selected

**Overlap** — cosine similarity of candidate to the most similar already-selected doc:

```
O = cos(v_i, v_j)                                # j = most similar selected
```

**Query-specific complementarity** — do two docs become collectively more relevant?

```
v_ij = (v_i + v_j) / 2
D = cos(v_ij, q) − max(cos(v_i, q), cos(v_j, q))
```

Positive D ⇒ the docs capture complementary aspects of the query (e.g. two tomato
irrigation chunks — early growth vs pre-harvest — have similar embeddings but answer
different questions).

**Retrieval-set concentration** — in specialized collections (policy, manuals) many
chunks occupy a small embedding region, so high cosine similarity ≠ redundancy:

```
H = μ_q × e^(−σ_q)                               # μ_q mean cos(v,q); σ_q std dev
```

Large H = homogeneous set ⇒ more permissive redundancy filter.

**Full complementarity:**

```
B = (1 − O) + (1 + γ) D
K_i = B^(ε + (1 − H))
```

γ calibrates the query-specific signal; ε is the baseline redundancy strictness.

## 4. Estimating cost — C = C_processing + C_dilution

### Processing cost

Transformer inference scales ~linearly with input tokens:

```
C_processing = α × T                             # T ≈ token estimate (tokenizer or chars/4); α configurable
```

### Context-dilution cost

Risk of introducing ambiguity/distraction. Deliberately NOT modeled as (1 − R) (would
double-count evidence). Three factors, each answering a distinct question:

- **Absolute weakness:** (1 − s_i) — how weak is the document in absolute terms?
- **Relative margin:** (1 + ρ(M − s_i)) where M = max score — how weak vs other candidates?
- **Distribution structure G:** how confident is the reranker that weaker docs should be excluded?

```
G = ((1 + M − mean(s)) × (1 + s_{i−1} − s_i)) / (1 + mean(Δ))
     # s_{i−1} = previous candidate score; mean(Δ) = mean score gap
C_dilution = (1 − s_i)(1 + ρ(M − s_i))(1 + o·G)
```

Cost is always positive with normalized scores, scales roughly linearly, spikes only at
large score gaps.

## 5. Complete framework

```
V_i = R_i × K_i − C_processing − C_dilution
```

Greedy selection in reranker order; include iff V_i > 0. The decision boundary emerges
from the utility–cost interaction, not a fixed rule — sometimes a few docs, sometimes a
larger context, and occasionally (correctly) none.

**All signals already exist during standard RAG** — reranker scores, embeddings, token
counts. Only arithmetic + cosine similarities are added. **No extra model inference.**

## 6. Experimental results

- 30 AI-generated, manually reviewed queries; 5–10 candidate docs/query (~120 tokens each)
- Scenarios: single relevant doc; information distributed across complementary chunks;
  redundant docs; ambiguous retrievals; **retrieving nothing is correct**
- Embedding: BAAI/bge-m3; Reranker: BAAI/bge-reranker-v2-m3
- Baselines: Top-K (K=5), threshold (0.50), slice-threshold

| Method | Precision | Recall | Noise |
|---|---|---|---|
| Baselines (slice/threshold) | 0.67–0.68 | 0.92–0.93 | 0.32–0.33 |
| Adaptive (untuned defaults) | 0.77–0.83 | 0.86–0.91 | 0.17–0.23 |

Tunable in a smooth, predictable way:
- **γ=3, ε=1.5** (aggressive redundancy filtering): precision ↑ 0.83, noise ↓ 0.17
- **γ=2, ε=0.5** (permissive): recall ↑ 0.91, precision 0.77

Key finding: small changes to few interpretable parameters produce smooth, predictable
behavior — unlike fixed Top-K/threshold requiring discrete rule changes.

## 7. Implementation

Complete Python implementation + synthetic benchmarks + evaluation scripts:
**github.com/romanchest/adaptive_context_selection_for_RAG**

## 8. Limitations (author-acknowledged)

- Small eval set (30 queries) — differences not statistically significant
- Short chunks; other chunking strategies may behave differently
- No systematic parameter optimization
- A large share of remaining errors came from the reranker scoring superficially related
  docs highly — **if the underlying model fails, any selection strategy fails** (its
  outputs are the signals)

## 9. Key takeaways

1. Context selection deserves first-class treatment — as influential as retrieval.
2. Fixed selection rules are a simplifying assumption that doesn't hold across diverse
   queries/collections.
3. Utility–cost framing (value = utility − cost) shifts the question from relevance to worth.
4. Multiple complementary signals beat a single metric.
5. Achievable without added inference — all signals already produced during standard RAG.
6. Tunable + interpretable parameters (γ, ε, ρ, o, α) give continuous precision/recall
   calibration per deployment.
7. Retrieval quality remains the ceiling — reranker errors propagate to selection errors.