---
title: Retrieval
description: Hybrid dense-vector + lexical (BM25) retrieval over ArangoDB, optional knowledge-graph traversal, reciprocal-rank fusion, and label filtering.
weight: 2
---

Retrieval is the stage that decides *which* chunks of the knowledge base the LLM
is allowed to see. GENIE.AI does not rely on a single signal: it fuses
**dense-vector** search with **lexical (BM25)** search, and can additionally walk
the **knowledge graph** to surface related chunks. The result is high recall
(semantic matches the exact-keyword search would miss) without losing precision
on proper nouns, codes, and rare terms that dense models handle poorly.

The retriever is a Python/FastAPI service
(`genie-ai-overlay/retriever/`) backed by **ArangoDB**, which stores chunks as
documents with three fields used at query time: `text`, `embedding`, and
`file_id`.

## The three signals

### 1. Dense-vector search

The query is embedded with the same model used at ingest time (default
`BAAI/bge-base-en-v1.5`, 768-dim) and compared against chunk embeddings by cosine
similarity. This catches semantic matches ("how do I renew my permit?" matching a
"licence renewal" chunk).

### 2. Lexical search (BM25)

A BM25 ranking over chunk text catches exact-token matches — IDs, acronyms,
names, legislation references — that dense models tend to blur.

### 3. Knowledge-graph traversal (optional)

Chunks are connected by graph edges extracted at ingest time (see
[Data labelling]({{< relref "data-labeling" >}})). When enabled, the retriever
follows edges from vector-hit chunks to pull in related chunks one hop away,
recovering context the vector search ranked just below the cutoff.

## Fusion: reciprocal rank

The dense and lexical result lists are merged with **reciprocal-rank fusion
(RRF)**, a rank-based combiner that does not need the two scores to be on the
same scale:

| Variable | Meaning |
|---|---|
| `HYBRID_DENSE_WEIGHT` | Weight of the dense-vector ranking. |
| `HYBRID_LEXICAL_WEIGHT` | Weight of the BM25 ranking. |
| `HYBRID_RRF_K` | RRF smoothing constant. |

Graph-traversal hits are merged in alongside the fused set.

## Label filtering

Every chunk carries one or more **labels** assigned at ingest time. The retriever
applies a label filter so a query only returns chunks whose labels are relevant
to the user's intent (for example, restricting to a service category). This is
what prevents cross-topic bleed in a multi-domain knowledge base. The labelling
itself is documented in [Data labelling]({{< relref "data-labeling" >}}).

## Knobs

| Variable | Default | Effect |
|---|---|---|
| `RETRIEVE_K` | 4 | Chunks returned to the reranker. |
| `RETRIEVE_FETCH_K` | 20 | Wider candidate set fetched before fusion. |
| `RETRIEVE_SCORE_THRESHOLD` | 0.1 | Minimum fused score to keep a chunk. |
| `RETRIEVE_DISTANCE_THRESHOLD` | 1 | Maximum cosine distance. |
| `TRAVERSAL_ENABLED` | false | Turn on knowledge-graph traversal. |
| `TRAVERSAL_MAX_DEPTH` | 2 | How many graph hops to follow. |
| `TRAVERSAL_MAX_RETURNED` | 3 | Cap on graph-derived chunks. |
| `TRAVERSAL_SCORE_THRESHOLD` | 0.5 | Minimum score for a graph chunk. |
| `RETRIEVE_LAMBDA_MULT` | 0.5 | Fusion blend (dense vs lexical emphasis). |

> **Tuning order.** Start with the defaults, then adjust `RETRIEVE_K` and
> `RETRIEVE_FETCH_K` for breadth, and the thresholds for precision. Enable graph
> traversal last — it helps when a domain is densely cross-referenced but adds
> latency.

## Embedding model note

Changing the embedding model requires **re-ingesting** the whole knowledge base,
because existing chunk vectors live in the old model's space. Pick the embedding
model deliberately at deploy time; see
[Choosing models]({{< relref "choosing-models" >}}).
