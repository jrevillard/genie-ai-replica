---
title: RAG Pipeline
description: Sovereign retrieval-augmented generation pipeline — embedding, hybrid retrieval, reranking, generation, and optional translation.
weight: 60
slug: rag
aliases:
  - /docs/rag/
---

The RAG (Retrieval-Augmented Generation) pipeline turns a user question into a
grounded answer drawn from the indexed knowledge base. Every stage runs on
infrastructure you control: no third-party model API is required.

## How a query flows

```
Query → Backend (BFF) → ChatQnA → Embedding → Retriever (ArangoDB) → Reranker → LLM → [Translation] → Response
```

Every stage emits OpenTelemetry spans, propagated across service boundaries
with the W3C `traceparent` header, so a single query can be traced end to end
in VictoriaTraces and Grafana. See the
[Observability section]({{< relref "/docs/observe" >}}) for the full
debugging workflow.

## Pages in this section

The list is ordered to follow the pipeline end-to-end, from ingest (step 0)
through query and back to the user.

### Core flow

- [Ingestion and chunking]({{< relref "ingestion" >}}) — **step 0** of the
  pipeline: chunking strategies, the contextual-retrieval knobs (`per_chunk`
  vs `doc_level`), the labelling + embedding stage, what gets stored in
  ArangoDB, and per-chunk observability. Pairs with the user-facing
  [Knowledge base → Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}}).
- [Pipeline architecture]({{< relref "pipeline" >}}) — the end-to-end flow,
  service roles, request lifecycle, and configuration surface.
- [Retrieval]({{< relref "retrieval" >}}) — hybrid dense-vector + BM25 retrieval
  over ArangoDB, score thresholds, reciprocal-rank fusion, and label filtering.
- [Reranking]({{< relref "reranking" >}}) — reranker strategies, score
  calibration, and how the user-facing confidence score is derived.
- [Generation]({{< relref "generation" >}}) — the LLM system prompt, abstention
  behaviour, self-confidence scoring, and translation.
- [Data labelling strategy]({{< relref "data-labeling" >}}) — how ingested
  chunks are labelled against the taxonomy and filtered at retrieve time.
- [Contextual retrieval]({{< relref "contextual-retrieval" >}}) — the on-by-
  default per-chunk context prefix that improves retrieval precision.
- [Streaming translation]({{< relref "streaming-translation" >}}) — translate
  the answer in the target language WHILE the English stream is being
  delivered (unit-by-unit, with markdown AST preservation), gated by
  `STREAMING_TRANSLATION_ENABLED`.
- [Streaming & metadata events]({{< relref "streaming-sse" >}}) — the SSE wire
  format ChatQnA emits to the backend, including per-token `data:` events,
  the terminal `data: [DONE]`, and the metadata envelope (`source_documents`,
  `retrieval_confidence_score`, `confidence_score`, `is_grounded`,
  `self_confidence`).

### Knowledge-base alignment

- [Multi-turn retrieval]({{< relref "multi-turn-retrieval" >}}) — opt-in
  vector-space blending so follow-up questions retrieve the subject of the
  previous turn.
- [Per-request overrides]({{< relref "per-request-overrides" >}}) — how to
  override `retriever_parameters` and `reranker_parameters` on a single chat
  request without changing global env defaults.
- [Choosing models]({{< relref "choosing-models" >}}) — model and GPU-profile
  selection for embedding, reranking, generation, and translation.
- [Model capability cache]({{< relref "model-capability-cache" >}}) —
  TTL-cached auto-detection of the model served by a remote vLLM endpoint
  so services pick up model swaps without a restart (`MODEL_DETECT_TTL`).

### Related

- [Knowledge base]({{< relref "/docs/knowledge-base" >}}) — managing the
  documents the pipeline retrieves from (ingestion, taxonomy, lifecycle).

## Design principles

- **Grounded by default.** The LLM is instructed to answer only from retrieved
  context and to abstain when the knowledge base does not contain the answer.
  `CHATQNA_ENFORCE_ABSTENTION=true` is the default and is the single most
  important guardrail for a public-sector knowledge base — see
  [Generation → Abstention]({{< relref "generation" >}}#abstention).
- **Sovereign and self-hosted.** Every model (embedding, reranker, LLM,
  translation) runs on infrastructure you control via OPEA / vLLM / TEI.
- **Configurable, not hardcoded.** Knobs such as retrieval depth, reranker
  strategy, and the system prompt are environment variables with safe defaults,
  so deployments can tune behaviour without code changes.
- **Observable.** Each stage is an instrumented span (`chatqna.orchestrate`
  root, with chatqna-side children such as `chatqna.reranker_selection` emitted
  during reranker alignment) plus per-request metrics
  (`chat_requests_total`, `chat_rag_duration_seconds`), making latency and
  retrieval-quality regressions visible in VictoriaMetrics.