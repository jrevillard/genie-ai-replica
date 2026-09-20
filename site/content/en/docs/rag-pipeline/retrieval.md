---
title: Retrieval
description: Hybrid dense-vector + lexical (BM25) retrieval over ArangoDB, optional knowledge-graph traversal, reciprocal-rank fusion, and label filtering.
weight: 3
aliases:
  - /docs/rag/retrieval/
mode: how-to
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Retrieval is the stage that decides **which** chunks of the knowledge base the
LLM is allowed to see. GENIE.AI does not rely on a single signal: it
fuses **dense-vector** search with **lexical (BM25)** search, and can
additionally walk the **knowledge graph** to surface related chunks. The
result is high recall (semantic matches the exact-keyword search would miss)
without losing precision on proper nouns, codes, and rare terms that dense
models handle poorly.

The retriever is a Python/FastAPI service
(`genie-ai-overlay/retriever/`) backed by **ArangoDB**, which stores chunks as
documents with three fields used at query time: `text`, `embedding`, and
`file_id`.

This page is for developers and deployers who need to tune retrieval quality
or debug why a query returned (or failed to return) a particular chunk.

## Prerequisites

- A running GENIE.AI stack with the **Retriever** service healthy
  (`docker service ls | grep retriever-arango-service`).
- ArangoDB seeded — see [Knowledge base → Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}}).
- Familiarity with [Labelling & Taxonomy]({{< relref "/docs/knowledge-base/labelling-taxonomy" >}})
  — labels are how chunks are filtered to a user's intent.

## The three signals

### 1. Dense-vector search

The query is embedded with the same model used at ingest time (default
`BAAI/bge-base-en-v1.5`, 768-dim, configured by `EMBEDDING_MODEL_ID`) and
compared against chunk embeddings by cosine similarity. This catches
semantic matches ("how do I renew my permit?" matching a "licence renewal"
chunk).

### 2. Lexical search (BM25)

A BM25 ranking over chunk text catches exact-token matches — IDs, acronyms,
names, legislation references — that dense models tend to blur. Enabled by
`RETRIEVER_HYBRID_RETRIEVAL_ENABLED=true` (the docker-compose runtime
default; the `env` template comments it as `false`, which is overridden by
docker-compose). Set it to `false` in `.env` to fall back to dense-only.
The lexical analyzer is set by
`RETRIEVER_HYBRID_BM25_ANALYZER` (default `text_en`).

### 3. Knowledge-graph traversal (optional)

Chunks are connected by graph edges extracted at ingest time (see
[Data labelling]({{< relref "data-labeling" >}})). When
`RETRIEVER_ARANGO_TRAVERSAL_ENABLED=true`, the retriever follows edges from
vector-hit chunks to pull in related chunks one hop away, recovering context
the vector search ranked just below the cutoff.

> **Failure mode.** When the knowledge graph is sparse — e.g., a fresh
> ingest before label propagation finishes, or a corpus with few edges —
> graph traversal returns no extra chunks and behaves like dense + BM25
> alone. Verify edge counts via the `kg_edges` count in VictoriaMetrics or
> the admin UI before tuning traversal thresholds.

## Fusion: reciprocal rank

The dense and lexical result lists are merged with **reciprocal-rank fusion
(RRF)**, a rank-based combiner that does not need the two scores to be on
the same scale. The fusion knobs are independent of the
`RETRIEVER_ARANGO_*` knobs below — those govern the dense-leg candidate
selection only.

| Variable | Default | Meaning |
|---|---|---|
| `RETRIEVER_HYBRID_RETRIEVAL_ENABLED` | `true` (docker-compose) / `false` (env template) | Master switch. When `false`, the retriever skips the BM25 channel entirely (dense-only). docker-compose default is `true` (hybrid); the `env` template comments it as `false`, which docker-compose overrides. See [Multi-Turn Retrieval]({{< relref "multi-turn-retrieval" >}}) for why this matters for query-time blending. |
| `RETRIEVER_HYBRID_DENSE_WEIGHT` | 1.0 | Weight of the dense-vector ranking. |
| `RETRIEVER_HYBRID_LEXICAL_WEIGHT` | 1.0 | Weight of the BM25 ranking. |
| `RETRIEVER_HYBRID_RRF_K` | 60 | RRF smoothing constant (literature standard). |
| `RETRIEVER_HYBRID_BM25_CANDIDATES` | 50 | BM25 candidate fetch depth before fusion. |
| `RETRIEVER_HYBRID_BM25_ANALYZER` | `text_en` | ArangoSearch analyzer on the text field. |

Graph-traversal hits are merged in alongside the fused set.

## Label filtering

Every chunk carries one or more **labels** drawn from the service-category
taxonomy (see [Knowledge base → Labelling & Taxonomy]({{< relref "/docs/knowledge-base/labelling-taxonomy" >}})
— the curated vocabulary chunks are labelled against at ingest time).
At query time the retriever applies a label filter so a query only returns
chunks whose labels are relevant to the user's intent (for example,
restricting to a service category). This is what prevents cross-topic bleed
in a multi-domain knowledge base.

The label filter is encoded in the `search_start` field of the standard
`EmbedDoc` shape — the retriever decodes it via `decode_filter_labels`.
Per-request label overrides are documented in
[Per-request overrides]({{< relref "per-request-overrides" >}}).

## Knobs

| Variable | Default | Effect |
|---|---|---|
| `RETRIEVER_ARANGO_K` | `4` (chatqna in-code fallback) / `20` (docker-compose runtime default) | Chunks returned after retrieval — the reranker's input set size. |
| `RETRIEVER_ARANGO_FETCH_K` | `20` (chatqna in-code fallback) / `30` (docker-compose runtime default) | Wider candidate set fetched before fusion. |
| `RETRIEVER_ARANGO_SCORE_THRESHOLD` | `0.1` (chatqna in-code fallback) / `0.2` (docker-compose runtime default) | Minimum fused score to keep a chunk. |
| `RETRIEVER_ARANGO_DISTANCE_THRESHOLD` | 1 | Maximum cosine distance. |
| `RETRIEVER_ARANGO_LAMBDA_MULT` | 0.5 | Legacy langchain-style blend (rarely used; the live fusion is RRF, see above). |
| `RETRIEVER_ARANGO_TRAVERSAL_ENABLED` | `true` (docker-compose) / `false` (env template) | Turn on knowledge-graph traversal. docker-compose default is `true`; the `env` template comments it as `false`, which docker-compose overrides. |
| `RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH` | 1 (retriever) / 2 (chatqna wrapper) | How many graph hops to follow. Two code paths read the same env var with different defaults — the retriever service owns the lower bound. |
| `RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED` | `5` (docker-compose) / `3` (env template & retriever code default) | Cap on graph-derived chunks. docker-compose default is `5`; the retriever code default is `3`. |
| `RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD` | `0.7` (docker-compose) / `0.5` (env template & retriever code default) | Minimum score for a graph chunk. docker-compose default is `0.7`; the retriever code default is `0.5`. |
| `RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES` | `10` (docker-compose) / `1` (env template & retriever code default) | Concurrency for graph expansion. docker-compose default is `10`; the retriever code default is `1`. |

> **Tuning order.** Start with the defaults, then adjust
> `RETRIEVER_ARANGO_K` and `RETRIEVER_ARANGO_FETCH_K` for breadth, and the
> thresholds for precision. Enable hybrid (BM25) when proper nouns, codes,
> or rare terms matter for recall. Enable graph traversal last — it helps
> when a domain is densely cross-referenced but adds latency.

## Embedding-model note

Changing `EMBEDDING_MODEL_ID` requires **re-ingesting** the whole knowledge
base, because existing chunk vectors live in the old model's space. Pick the
embedding model deliberately at deploy time; see
[Choosing models]({{< relref "choosing-models" >}}).

## Verification

After a tuning change, send a known-good query and check the per-chunk spans
in VictoriaTraces (see
[Observability → Traces]({{< relref "/docs/observe" >}})). The
retrieved chunk count and top-K scores should reflect the new thresholds.
Cross-check the `ingestion_log` collection in ArangoDB for label-filter
hits — if zero, the label scope may be too narrow for the test query.

For ArangoDB inspection:

```bash
# In a swarm node:
docker exec $(docker ps --format '{{.Names}}' | grep arango-vector-db | head -1) \
  arangosh --server.endpoint tcp://localhost:8529 \
  --server.authentication true \
  --server.username root --server.password "$ARANGO_PASSWORD" \
  --javascript.execute-string "db._query('FOR d IN chunks LIMIT 1 RETURN {file_id: d.file_id, labels: d.labels}').toArray()"
```

A useful probe of the live retriever directly:

```bash
docker exec $(docker ps --format '{{.Names}}' | grep retriever-arango | head -1) \
  curl -s -X POST http://localhost:7000/v1/retrieval \
  -H 'Content-Type: application/json' \
  -d '{"embedding":[0.0, ... ,0.0], "search_start":"chunk"}' | jq '.retrieved_docs | length'
```

(Use a real 768-dim query vector — a zero vector returns no hits.)

## Related

- [Pipeline architecture]({{< relref "pipeline" >}}) — where retrieval fits in
  the end-to-end flow.
- [Reranking]({{< relref "reranking" >}}) — what happens to the chunks
  retrieval returns.
- [Multi-turn retrieval]({{< relref "multi-turn-retrieval" >}}) — how
  `RETRIEVER_HYBRID_RETRIEVAL_ENABLED` interacts with vector-space blending.
- [Per-request overrides]({{< relref "per-request-overrides" >}}) — how to
  override `RETRIEVER_ARANGO_K` etc. on a single chat request.