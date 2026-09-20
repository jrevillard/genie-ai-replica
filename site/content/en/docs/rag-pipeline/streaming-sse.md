---
title: Streaming & Metadata Events
description: The SSE wire format ChatQnA emits to the backend, the metadata envelope, and the marker-stripping pass that keeps internal conversation markers out of the stream.
weight: 9
aliases:
  - /docs/rag/streaming-sse/
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

When the backend calls `POST /v1/chatqna` with `stream: true`, ChatQnA
streams the answer back as **Server-Sent Events** (SSE). Each event is a
single line `data: <json>\n\n`; the terminal event is `data: [DONE]\n\n`.
Between the first and the last, ChatQnA interleaves per-token content
events and a single terminal **metadata event** carrying
`source_documents`, `retrieval_confidence_score`, `confidence_score`,
`is_grounded`, and (when `LLM_SELF_CONFIDENCE_ENABLED=1`) `self_confidence`.

This page is for backend developers parsing the stream, frontend developers
rendering the citation list, and operators debugging what the user actually
receives.

## Prerequisites

- A running ChatQnA service (`docker service ls | grep chatqna-xeon-backend-server`).
- Familiarity with [Generation]({{< relref "generation" >}}) — the
  metadata envelope is computed there.
- The canonical source for the streaming logic is
  `genie-ai-overlay/chatqna/genieai_chatqna.py:_stream_with_metadata`
  (line 1697 for the function definition, lines 1778-1814 for the
  terminal metadata envelope assembly).

## Wire format

```text
data: {"ops":[{"value":"..."}]}\n\n
data: {"ops":[{"value":"..."}]}\n\n
... (per-token content events) ...
data: {"ops":[{"value":"..."}], "source_documents":[...], "retrieval_confidence_score":0.82, "confidence_score":0.82, "is_grounded":true, "self_confidence":null}\n\n
data: [DONE]\n\n
```

Every `data:` line is JSON-encoded and **escaped** (`repr(json_str)`
then `.encode('utf-8')`) so it can be safely concatenated to the SSE
stream regardless of content. Decode each line by stripping the `data:`
prefix and `json.loads` (or equivalent in your language).

### Per-token content events

Each token of the streamed English answer is one event:

```json
{"ops": [{"value": "Here's "}]}
{"ops": [{"value": "the "}]}
{"ops": [{"value": "first "}]}
```

When **streaming translation** is enabled
(`STREAMING_TRANSLATION_ENABLED=1`), the `value` carries the translated
fragment instead of the English token — the client cannot tell the
difference in the wire format; it just receives whatever ChatQnA decides
to publish. Markdown structure (headings, lists, code blocks, links) is
preserved across translation boundaries via an AST-based
`translateMarkdown`-per-unit approach.

### The terminal metadata event

The last data event before `[DONE]` is the **metadata envelope**:

```json
{
  "ops": [{"value": ""}],
  "source_documents": [
    {
      "text": "...first chunk text...",
      "metadata": {
        "file_id": "...",
        "labels": ["Healthcare", "Diabetes"],
        "score": 0.91,
        "rank": 0
      }
    }
  ],
  "retrieval_confidence_score": 0.82,
  "confidence_score": 0.82,
  "is_grounded": true,
  "self_confidence": null
}
```

| Field | Type | When present | Meaning |
|---|---|---|---|
| `source_documents` | array | Always | The kept chunks used for the answer (after reranking). Each entry has `text` and `metadata`. |
| `retrieval_confidence_score` | float 0–1 | Always | Rank-weighted aggregate of the calibrated reranker scores — see [Reranking → The displayed confidence score]({{< relref "reranking" >}}). |
| `confidence_score` | float 0–1 | Always | The user-facing score. Equals `self_confidence` if available, otherwise `retrieval_confidence_score`. |
| `is_grounded` | bool | Always | `true` iff ≥1 chunk passed the reranker. When `false` and `CHATQNA_ENFORCE_ABSTENTION=true`, the answer ends with the configured refusal phrase. |
| `self_confidence` | int 0–100 | Only when `LLM_SELF_CONFIDENCE_ENABLED=1` | The LLM's own certainty, from the `[[CONF:n]]` token. |

The metadata event is emitted **once per request**, on the same SSE
stream as the content events. Backend parsers should buffer until the
metadata arrives before surfacing the citation list.

### Terminal `data: [DONE]`

The SSE standard terminal marker. `data: [DONE]` is **not** JSON; it is
the literal string `[DONE]`. Parsers should treat it as the end of the
stream and close the connection.

## Marker stripping (what's not in the stream)

Internal conversation markers must never leak into the visible answer.
ChatQnA strips the patterns defined in `_CONV_MARKER_PREFIXES`
(`genieai_chatqna.py:266-275` — covers `_CONV_MSG_SEPARATOR` through
`_CONV_MARKER_PREFIXES`):

- `|<-MSG->|` and the like — internal chat-history separators.
- `USER:` / `ASSISTANT:` — role prefixes from the prompt template.
- The `[[CONF:n]]` self-confidence sentinel (when enabled) — parsed and
  stripped from the visible text, surfaced separately as
  `self_confidence`.

Stripping is shared between the streaming path (`_stream_with_metadata`)
and the non-streaming path (`handle_request`), so a chunked marker that
spans token boundaries (e.g. `USE` arriving in token 1 and `R:` in
token 2) is reassembled before the regex strip runs.

Excess-blank markdown runs (e.g. three blank lines from a heading close)
are also collapsed across token boundaries so the rendered markdown does
not show visual gaps that did not exist in the source.

## Span attributes emitted

The same metadata fields are emitted as OpenTelemetry span attributes on
the `chatqna.orchestrate` root span (and per-stage child spans from the
OPEA megaservice HTTP client instrumentation). The actual span attributes
on `chatqna.orchestrate` are:

| Span attribute | Source |
|---|---|
| `rag.query_length` | Length of the query fed into the megaservice. |
| `rag.model_id` | The chat LLM model (resolved from `VLLM_LLM_MODEL_ID` or the live vLLM endpoint via `core/model_cache.py`). |
| `rag.chunk_count` | Number of chunks that reached the LLM after reranking. |

Additional attributes emitted from the reranker microservice span:

| Span attribute | Source |
|---|---|
| `reranker.strategy` | The strategy used for this request (`slice`, `adaptive`, etc.). |
| `reranker.input_doc_count` / `reranker.output_doc_count` | Candidate and kept chunk counts. |
| `reranker.score_threshold` | The `RERANKING_THRESHOLD` value applied. |
| `rag.adaptive_context_decay_factor` / `rag.adaptive_min_value_threshold` / `rag.adaptive_breakdown` | Emitted on the reranker microservice span when `adaptive` was used. |

The `is_grounded`, `confidence_score`, and `self_confidence` values are
**not** exposed as chatqna span attributes — they are surfaced via the
SSE metadata event (see the metadata envelope above). The `abstained`
value is exposed as a metric attribute on `chat_requests_total` in
VictoriaMetrics.

Look for these on VictoriaTraces to debug why a particular answer was
generated. Per-stage child spans are OPEA megaservice HTTP client spans
named `METHOD /path` by the request hook in `genie-ai-overlay/tracing.py`,
e.g. `POST /v1/embeddings`, `POST /v1/retrieval`, plus the chatqna-side
`chatqna.reranker_selection` emitted during the reranker alignment.

## Custom metrics

ChatQnA emits two per-request metrics, scraped by the OTel Collector and
forwarded to VictoriaMetrics:

| Metric | Type | Attributes |
|---|---|---|
| `chat_requests_total` | Counter | `response_type` (`streaming`/`sync`), `abstained` (`true`/`false` — currently hardcoded to `false`; see note below), `error` (`true`/`false`), `retrieval_source` (`chunk`/`chunk_label_filter`/`hybrid`). |
| `chat_rag_duration_seconds` | Histogram | `response_type`, `abstained`, `error`, `retrieval_source`. |

A PromQL probe to graph RAG latency over the last 5 minutes:

```promql
histogram_quantile(0.95, sum(rate(genie_ai_chat_rag_latency_seconds_bucket[5m])) by (le))
```

## Curl probe

A direct probe of the ChatQnA SSE stream (run from a swarm node with
network access to the `chatqna-xeon-backend-server` container):

```bash
curl -sk -N -X POST http://chatqna-xeon-backend-server:8888/v1/chatqna \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role": "user", "content": "Summarise the ingestion pipeline"}],
    "stream": true
  }'
```

You should see a sequence of `data: {...}` events followed by
`data: [DONE]`. The last content-bearing event carries the metadata
envelope.

> **Note.** This probe sends an **anonymous** request (no JWT); ChatQnA
> in production requires a Keycloak Bearer token. To probe with a token,
> follow the [Server API Testing recipe]({{< relref "/docs/operate" >}})
> to obtain a token, then add `Authorization: Bearer $TOKEN`.

## Related

- [Generation]({{< relref "generation" >}}) — what produces the streamed
  answer.
- [Reranking]({{< relref "reranking" >}}) — the source of the
  `retrieval_confidence_score` and `is_grounded` fields.
- [Pipeline architecture]({{< relref "pipeline" >}}) — how the
  per-stage spans and metrics relate to the wire format.
- [Backend → API contracts]({{< relref "/docs/backend/api-contracts-backend" >}})
  — the BFF route that wraps this stream for the frontend.