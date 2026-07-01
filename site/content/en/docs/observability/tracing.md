---
title: Tracing
description: W3C traceparent propagation across the RAG pipeline, the span taxonomy, and automatic PII filtering.
weight: 2
---

Tracing is what makes a GENIE.AI user query legible. Because every service
propagates a single W3C `traceparent` header and every RAG stage emits a span,
one user question produces one contiguous trace that can be read end-to-end in
Grafana — revealing exactly where time went and which chunks were retrieved.

## Trace propagation

The trace starts at the edge. Kong creates the root span and injects a
`traceparent` header into the request. Each downstream hop reads that header,
joins the trace as a child span, and re-injects the header for the next hop:

```
Client → Kong (root span, injects traceparent)
       → Backend BFF (child span, re-injects)
       → ChatQnA (child span, re-injects)
          → Embedding, Retriever, Reranker, LLM, Translation (stage spans)
```

This is plain W3C Trace Context — no GENIE.AI-specific protocol — so standard
OTel tooling and Jaeger clients interoperate.

## Span taxonomy

### Backend (Node.js)

Created with `tracing.withSpan(name, fn)`. Key spans cover Express request
handling, middleware, and ArangoDB queries (instrumented in `tracing-db.js`).

### RAG pipeline (Python/OPEA)

Each RAG stage emits a named span with structured attributes:

| Service | Representative spans | Key attributes |
|---|---|---|
| ChatQnA | per-stage (embed, retrieve, rerank, generate, translate) | stage name, model id, token counts |
| Retriever | `retrieval` | `k`, `fetch_k`, hit count, fusion weights |
| Reranker | `reranking` | strategy, `top_n`, calibrated scores |
| Dataprep | `dataprep.ingest`, `dataprep.retract`, `dataprep.chunking` | `file_type`, `file_size_bytes`, `file_id`, `chunk_count` |
| Dataprep LLM | `dataprep.llm.label_chunk`, `dataprep.llm.label_batch` | `chunk_index`/`chunk_indices`, `llm_model`, `labels_suggested`, `llm.completion_tokens`, `llm_batched` |

The dataprep labelling spans distinguish single-chunk calls from batched calls
(`llm_batched`), which is what makes labelling-throughput regressions visible.

### Kong

The OTel plugin emits a `request` span per proxied call, carrying HTTP method,
route, and status.

## PII filtering

Telemetry must never leak secrets. The backend applies a PII filter
(`tracing-pii.js`) that strips sensitive attributes — tokens, passwords, user
PII — from span attributes before export. The rule for engineers:

> **Never log raw tokens, passwords, or user PII in span attributes.** Put
> structured, non-sensitive identifiers on spans (e.g. a user id, a file id); let
> the filter catch anything that slips through, but do not rely on it.

## Sampling

Traces pass through a **probabilistic sampler** in the collector. The sampling
rate is configurable:

| Variable | Default | Effect |
|---|---|---|
| `OTEL_TRACES_SAMPLER_RATE` | 100.0 | Percentage of traces exported (100 = head-based all). |
| `KONG_TRACING_SAMPLING_RATE` | 1.0 | Kong trace sampling rate (0–1), aligned with the above. |

> **Cost lever.** Lower the sample rate in high-volume production to cut
> VictoriaTraces storage; raise it when diagnosing. Metrics and logs are not
> sampled — only traces.

## Reading a trace

Two Grafana views are built for this:

- **Trace explorer** — search traces by service, operation, duration, or
  attribute (VictoriaTraces via the Jaeger datasource).
- **RAG pipeline trace waterfall** — a waterfall tailored to the RAG stages, so
  the embedding/retrieve/rerank/generate breakdown is immediately visible.

See [Dashboards]({{< relref "dashboards" >}}).
