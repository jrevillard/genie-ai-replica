---
title: "OPEA protocol extensions"
weight: 3
description: "GENIE.AI extensions to the standard OPEA protocol — genieai_api_protocol.py."
mode: reference
persona: developer
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Purpose

GENIE.AI extends the standard OPEA mega-service protocol with several
GENIE.AI-specific fields and event types. This page is the canonical
reference; the implementation lives in
`genie-ai-overlay/core/genieai_api_protocol.py`.

## Standard OPEA protocol (recap)

OPEA's mega-service defines a DAG of microservices. Each downstream service
accepts an `asyncio` input that is itself a dict — typically:

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "retriever_parameters": {},
  "reranker_parameters": {}
}
```

The mega-service streams the final LLM response via SSE, plus per-stage
metadata events.

## GENIE.AI extensions

### `retrieval_confidence_score`

Field on the terminal SSE event. Computed as a **rank-weighted
exponential-decay aggregate** of calibrated reranker scores (top-ranked
chunks dominate — flat mean was tail-sensitive). Individual reranker
scores are calibrated by `RERANKER_SCORE_CALIBRATION` before the
aggregate. The citizen-facing `confidence_score` field falls back to
`self_confidence` when `LLM_SELF_CONFIDENCE_ENABLED=true`; the raw
`retrieval_confidence_score` is still emitted for admin/eval.

### `is_grounded`

Boolean on the terminal event. `true` when at least one document was
returned by the reranker (no threshold check — `is_grounded =
bool(display_docs)` in `genieai_chatqna.py`); or, when no reranker is
configured, when at least one document was returned by the retriever.
`false` otherwise. Useful for UI badges.

### `self_confidence`

The LLM's own confidence in its answer (0.0–1.0), as a JSON field it
returns alongside the answer. Emitted only when
`LLM_SELF_CONFIDENCE_ENABLED=true`.

### `metadata.source_documents`

List of source-document references (built in `genieai_chatqna.py`). Each
entry shape:

```json
{
  "document_id": "<file_id>",
  "document_name": "<file_name>",
  "url": "<pre-signed file read URL>",
  "categoryLabels": ["<label>", "..."],
  "serviceLabels": [],
  "score": 0.87
}
```

There is no `text`, no nested `metadata` object, and no `chunk_id`/`source`
field on the wire. The frontend renders these as **Source** chips under the
answer (label = `document_name`, link = `url`).

### `metadata.rag_chunks`

**Not emitted.** The chatqna terminal-event payload (`genieai_chatqna.py`,
non-streaming branch around the metadata assembly) includes
`source_documents`, `retrieval_confidence_score`, `confidence_score` and
`is_grounded` — there is no `rag_chunks` field. Frontends should read
`source_documents` only.

### Per-request overrides

The backend forwards `retriever_parameters` and `reranker_parameters` from
the request body. See
[RAG pipeline → Per-request overrides](/docs/rag-pipeline/per-request-overrides/).

### Streaming translation events

When `STREAMING_TRANSLATION_ENABLED=1`, the chat SSE stream emits a
`chunk` event per translated text segment. The wire shape:

```
data: {"type":"chunk","content":"<translated_text>"}

```

The frontend concatenates these in arrival order, not the source order.
There is no `event` key and no `target_lang` field on the SSE frame —
the target language is negotiated once at the start of the stream and is
not re-emitted per chunk. On translation failure the original (untranslated)
content is re-emitted with the same shape.

## Custom event types

The retriever, reranker and dataprep microservices do not emit any custom
SSE events. They return results synchronously to chatqna; chatqna is the
only service that streams SSE events to the backend / frontend.

## Service-registry enum

The canonical enum of service types lives in
`genie-ai-overlay/core/constants.py` as `ServiceType` (with values
`EMBEDDING`, `RETRIEVER`, `RERANK`, `LLM`, `DATAPREP`, `TRANSLATOR`,
etc.). It is **not** a service-name enum. Service names that appear in
OTel `service.name` attributes are passed as string literals to
`setup_tracing()` per microservice:

| Service | OTel `service.name` | Notes |
|---|---|---|
| `chatqna` | `genieai-chatqna` | `setup_tracing("genieai-chatqna")` in `genieai_chatqna.py` |
| `retriever` | `genieai-retriever` | `setup_tracing("genieai-retriever")` in retriever microservice |
| `reranker` | `genieai-reranker` | `setup_tracing("genieai-reranker")` in reranker microservice |
| `dataprep` | `genieai-dataprep` | `setup_tracing("genieai-dataprep")` in dataprep microservice |
| `embedding` | _(external — TEI)_ | TEI has its own OTel settings; not instrumented by GENIE.AI |
| `vllm` | _(external)_ | vLLM has its own telemetry |
| `translation` | _(part of chatqna)_ | No standalone `translation/` service; translation is in chatqna |
| `doc-repo` | _(Node.js — separate OTel init)_ | See `components/document-repository/` for instrumentation |
| `backend` | `genie-backend` | From `components/gov-chat-backend/tracing.js` |

See [Reference → Service registry enum](/docs/reference/service-registry/).

## Related

- [Architecture → OPEA microservices](/docs/architecture/opea-microservices/)
- [RAG pipeline → Pipeline architecture](/docs/rag-pipeline/pipeline/)
- [RAG pipeline → Streaming & metadata events](/docs/rag-pipeline/streaming-sse/)
- [Observe → Tracing](/docs/observe/tracing/)