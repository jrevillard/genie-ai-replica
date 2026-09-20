---
title: Per-Request Overrides
description: How to override retriever and reranker parameters on a single chat request without changing global env defaults.
weight: 12
aliases:
  - /docs/rag/per-request-overrides/
mode: how-to
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Most RAG knobs in GENIE.AI are deployment-wide (set in `.env`). A subset
can be overridden on a **single** chat request via the OpenAI-compatible
`retriever_parameters` and `reranker_parameters` fields on the request
body — useful for an admin tool that wants to A/B a chunk count, for an
experiment harness that varies `top_n` per query, or for an integration
test that needs to lock in a known reranker strategy.

This page is for backend developers building integrations against ChatQnA
and operators experimenting with retrieval and reranking knobs.

## Prerequisites

- Familiarity with [Retrieval]({{< relref "retrieval" >}}) and
  [Reranking]({{< relref "reranking" >}}) — these override the same
  knobs.
- The canonical Pydantic models are
  `GenieaiRetrieverParms(RetrieverParms)` and
  `GenieaiRerankerParms(RerankerParms)` in
  `genie-ai-overlay/chatqna/genieai_chatqna.py:595-602`.
- The request must include `Authorization: Bearer <keycloak_jwt>` and a
  `traceparent` header (ChatQnA propagates the trace).

## How overrides flow

```text
POST /v1/chatqna
   request.retriever_parameters = {top_k: 2, score_threshold: 0.2}
   request.reranker_parameters  = {top_n: 1, reranking_strategy: "slice"}
        ↓
ChatQnA (chatqna.py:908-941)
   safe_params = model_dump(exclude_unset=True, exclude_none=True)
   inputs.update(safe_params)
        ↓
Retriever microservice / Reranker microservice
   inputs["top_k"] / inputs["top_n"] / ... consumed by that stage
```

Two important behaviours:

1. **`exclude_unset=True, exclude_none=True`.** Any field the caller does
   *not* set falls back to the env var / in-code default. You don't need
   to repeat the whole schema — send only what you want to override.
2. **Encoding the label filter.** The label filter is encoded in the
   standard `search_start` field (`"chunk"` / `"chunk_label_filter"`).
   Overriding `search_start` overrides the auto-filter — see
   `encode_filter_labels` (defined in
   `genie-ai-overlay/core/label_contract.py`, imported and called at
   `genieai_chatqna.py:933-936`) and the data contract note in
   [Retrieval → Label filtering]({{< relref "retrieval" >}}).

## Retriever overrides

Backed by `GenieaiRetrieverParms(RetrieverParms)` in
`genieai_chatqna.py:595`. The fields forwarded to the retriever service:

| Field | Type | Default | Effect |
|---|---|---|---|
| `embedding` | list[float] | _(none)_ | Pre-computed query embedding. Skips the embedding service call. |
| `search_type` | string | `"chunk"` | `"chunk"` or `"chunk_label_filter"` (encodes a label filter). |
| `search_start` | string | `"chunk"` | One of the standard `EmbedDoc` `search_start` values; encodes the label filter when `search_type=chunk_label_filter`. |
| `k` | int | `RETRIEVER_ARANGO_K` | Chunks returned. |
| `fetch_k` | int | `RETRIEVER_ARANGO_FETCH_K` | Candidate fetch width. |
| `score_threshold` | float | `RETRIEVER_ARANGO_SCORE_THRESHOLD` | Minimum fused score. |
| `distance_threshold` | float | `RETRIEVER_ARANGO_DISTANCE_THRESHOLD` | Maximum cosine distance. |
| `lambda_mult` | float | `RETRIEVER_ARANGO_LAMBDA_MULT` | Legacy langchain-style blend. |
| `enable_traversal` | bool | `RETRIEVER_ARANGO_TRAVERSAL_ENABLED` | Turn on graph traversal. |
| `traversal_max_depth` | int | `RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH` | Graph hops. |
| `traversal_max_returned` | int | `RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED` | Graph chunk cap. |
| `traversal_score_threshold` | float | `RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD` | Graph chunk min score. |
| `traversal_concurrent_batches` | int | `RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES` | Concurrency. |
| `filter_labels` | list[string] | `[]` | Constrains retrieval to chunks whose labels intersect this list. Encoded into `search_start`. |

## Reranker overrides

Backed by `GenieaiRerankerParms(RerankerParms)` in
`genieai_chatqna.py:602`. The fields forwarded to the reranker service:

| Field | Type | Default | Effect |
|---|---|---|---|
| `top_n` | int | `RERANKER_TOP_N` | Chunks kept for `slice` / `slice_threshold`. |
| `reranking_strategy` | string | `RERANKING_STRATEGY` | `slice`, `adaptive`, `threshold`, `slice_threshold`, `knee_threshold`. |
| `reranking_threshold` | float | `RERANKING_THRESHOLD` | Score gate. |

## Example: A/B a top-k comparison

```bash
# Default env: RETRIEVER_ARANGO_K=4. We want to A/B with top_k=2.
curl -sk -X POST http://localhost:8888/v1/chatqna \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "traceparent: 00-$TRACE_ID-01" \
  -d '{
    "messages": [{"role": "user", "content": "How do I renew my permit?"}],
    "stream": false,
    "retriever_parameters": {
      "k": 2,
      "fetch_k": 12
    },
    "reranker_parameters": {
      "top_n": 1
    }
  }'
```

The response carries the same `source_documents` array as the streaming
metadata event — compare its length and `metadata.score` to the
un-overridden baseline.

## Example: constrain retrieval to a service category

```bash
# Filter retrieval to chunks whose labels include "Healthcare".
curl -sk -X POST http://localhost:8888/v1/chatqna \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What are the diabetes management guidelines?"}],
    "stream": false,
    "retriever_parameters": {
      "filter_labels": ["Healthcare"]
    }
  }'
```

`filter_labels` is intersected with the labels actually assigned to
chunks at ingest time — empty intersection returns no chunks.

## Verification

After a per-request override, the result is observable through the
`source_documents` array in the SSE metadata event — ChatQnA does not
emit `retriever.parameters` / `reranker.parameters` as chatqna span
attributes (the overrides flow into the per-request retriever and
reranker microservice HTTP calls, but no dedicated span attribute is
set on the `chatqna.orchestrate` root span). The `reranker.strategy`
attribute on the reranker microservice span can confirm the strategy
override landed.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Override has no effect | `exclude_unset=True` — your field was at the env default | Send an explicitly different value. |
| All chunks filtered out | `filter_labels` doesn't intersect any chunk's labels | Inspect a known chunk's labels via ArangoDB (`FOR d IN chunks FILTER ... RETURN d.labels`); adjust. |
| Retriever returns a different `k` than requested | Backend cache / request shape stripped the field | Confirm `retriever_parameters` is at the top level of the request body, not nested in `messages`. |
| ChatQnA returns 422 | One of the override values failed Pydantic validation | Check the field types in the tables above. |

## Related

- [Retrieval]({{< relref "retrieval" >}}) — what the retriever does with
  the overrides.
- [Reranking]({{< relref "reranking" >}}) — what the reranker does with
  the overrides.
- [Streaming & metadata events]({{< relref "streaming-sse" >}}) — how
  the result of the override is surfaced to the backend.
- [Backend → API contracts]({{< relref "/docs/backend/api-contracts-backend" >}})
  — the BFF route that proxies this.