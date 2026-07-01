---
title: RAG Pipeline
description: Sovereign retrieval-augmented generation pipeline — embedding, hybrid vector-graph retrieval, reranking, generation, and optional translation.
weight: 2
slug: rag
---

GENIE.AI answers user questions strictly from an indexed knowledge base rather
than from model memory. The Retrieval-Augmented Generation (RAG) pipeline turns
each query into a grounded, cite-able answer through five stages: **embedding,
hybrid retrieval, reranking, generation, and optional translation**.

This section documents the pipeline that runs in the OPEA overlay
(`genie-ai-overlay/`), its configuration knobs, and the model-selection
trade-offs for each stage.

## How a query flows

```
Query → Backend (BFF) → ChatQnA → Embedding → Retriever (ArangoDB) → Reranker → LLM → [Translation] → Response
```

Every stage emits OpenTelemetry spans, propagated across service boundaries with
the W3C `traceparent` header, so a single query can be traced end to end in
Grafana. See [Observability]({{< relref "/docs/observability" >}}).

## Pages in this section

- [Pipeline architecture]({{< relref "pipeline" >}}) — the end-to-end flow,
  service roles, and request lifecycle.
- [Retrieval]({{< relref "retrieval" >}}) — hybrid vector + graph retrieval over
  ArangoDB, score thresholds, and reciprocal-rank fusion.
- [Reranking]({{< relref "reranking" >}}) — reranker strategies, score
  calibration, and the displayed confidence score.
- [Generation]({{< relref "generation" >}}) — the LLM system prompt, abstention
  behaviour, self-confidence, and translation.
- [Data labelling strategy]({{< relref "data-labeling" >}}) — how ingested chunks
  are labelled and filtered at retrieve time.
- [Contextual retrieval]({{< relref "contextual-retrieval" >}}) — the opt-in
  per-chunk context prefix that improves retrieval precision.
- [Choosing models]({{< relref "choosing-models" >}}) — model and GPU-profile
  selection for embedding, reranking, generation, and translation.

## Design principles

- **Grounded by default.** The LLM is instructed to answer only from retrieved
  context and to abstain when the knowledge base does not contain the answer.
- **Sovereign and self-hosted.** Every model (embedding, reranker, LLM,
  translation) runs on infrastructure you control via OPEA/vLLM/TEI — no
  third-party model API is required.
- **Configurable, not hardcoded.** Knobs such as retrieval depth, reranker
  strategy, and the system prompt are environment variables with safe defaults,
  so deployments can tune behaviour without code changes.
- **Observable.** Each stage is an instrumented span, making latency and
  retrieval-quality regressions visible.
