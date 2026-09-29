---
title: Tracing
description: W3C traceparent propagation across the RAG pipeline, the span taxonomy, and how traces connect to logs.
weight: 2
---

Tracing is what makes a GENIE.AI user query legible. Because every service
propagates a single W3C `traceparent` header and every RAG stage emits a span,
one user question produces one contiguous trace that can be read end-to-end in
Grafana — revealing exactly where time went and which chunks were retrieved.

The same `trace_id` also appears on every log line touched by that request, so
a trace span and its log lines can be cross-referenced in either direction —
see [Trace ↔ log correlation](#trace-log-correlation) below.

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

## Trace ↔ log correlation

A `trace_id` is not only a trace concept: the same identifier is stamped on
every log line produced while handling that request. The connection works in
both directions:

- **From a log line to a trace.** In the *Service logs* dashboard, copy the
  `trace_id` field out of any log row and paste it into *Trace explorer* to
  pull up the full distributed trace that produced it.
- **From a trace span to logs.** In *Trace explorer* (or the *RAG pipeline trace
  waterfall* dashboard), open a span and copy its `trace_id`. Paste it into the
  *Service logs* dashboard's filter to see every log line from every service
  involved in that request, in order.

This is the operator's main "I see an error, now what?" tool. A typical flow:

1. *Service health* or *Application metrics* shows an error spike.
2. *Trace explorer* locates a failing trace and identifies the slow / failing
   span.
3. The span's `trace_id` filters *Service logs* to the matching lines, where
   the actual error message lives.

## Span taxonomy

The spans you will see in *Trace explorer* cover the major services and RAG
stages. You do not need to memorise them; the *RAG pipeline trace waterfall*
dashboard arranges them by service so the slow stage is visible at a glance.

| Service | Representative spans | What they reveal |
|---|---|---|
| ChatQnA | per-stage (embed, retrieve, rerank, generate, translate) | Which stage took the time; model id and token counts on the LLM stage. |
| Retriever | `retrieval` | `k`, `fetch_k`, hit count, fusion weights. |
| Reranker | `reranking` | Strategy used, `top_n`, calibrated scores. |
| Dataprep | `dataprep.ingest`, `dataprep.retract`, `dataprep.chunking` | File type and size, file id, chunk count. |
| Dataprep LLM | `dataprep.llm.label_chunk`, `dataprep.llm.label_batch` | Per-chunk vs. batched labelling (labelling-throughput regressions show up here). |

## PII filtering

Telemetry never carries secrets or user PII. Sensitive attributes (tokens,
passwords, user PII) are stripped from span attributes before export.

> **What you will not see on a span.** Bearer tokens, user emails, raw
> passwords, or any other PII. If a span attribute looks like it might contain
> sensitive data, treat it as a bug — the filter should have caught it.

## Sampling

Traces pass through a **probabilistic sampler** in the collector. The sampling
rate is configurable:

| Variable | Default | Effect |
|---|---|---|
| `OTEL_TRACES_SAMPLER_RATE` | 100.0 | Percentage of traces exported by the collector's tail-based sampler (100 = all traces). |
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
