---
title: Contextual Retrieval
description: On-by-default per-chunk context prefix that improves retrieval precision by embedding chunks with their source context.
weight: 6
aliases:
  - /docs/rag/contextual-retrieval/
mode: explanation
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Standard retrieval embeds each chunk in isolation. A chunk removed from its
section can be hard to match: a paragraph about "renewing it" will not
retrieve well for a query about "permit renewal" because the chunk alone
does not say what "it" is. **Contextual Retrieval** (an Anthropic-style
technique) fixes this by prepending a short, LLM-generated **doc-context
prefix** to each chunk *before* it is embedded and labelled, so the chunk's
vector carries its surrounding meaning.

This feature is **on by default** (`CONTEXTUAL_RETRIEVAL_ENABLED=true`). It
is an **ingest-time** operation: it costs one extra LLM call per chunk (or
per document) at ingestion, and zero at query time. It never blocks
ingestion — if context generation fails for a chunk, the raw chunk is
embedded as a fallback.

This page is for developers tuning dataprep and operators debugging why
chunks are (or are not) landing well in the vector space.

## Prerequisites

- The Dataprep service is deployed with OPEA / vLLM available
  (`docker service ls | grep dataprep-arango-service`).
- The context-generation LLM (default = `VLLM_LLM_MODEL_ID`) supports
  OpenAI-compatible guided JSON output (`response_format={"type":
  "json_object"}`, returning `{"context": "..."}`). Validated on
  `ibm-granite/granite-4.1-8b`. See
  [Choosing models]({{< relref "choosing-models" >}}).
- Familiarity with [Knowledge base → Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}})
  — Contextual Retrieval is an ingest-time enrichment.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `CONTEXTUAL_RETRIEVAL_ENABLED` | `true` | Master switch. On by default; set `false` to disable (a no-op beyond skipping context generation). |
| `CONTEXTUAL_STRATEGY` | `doc_level` (docker-compose) / `per_chunk` (env template & code default) | Strategy selector. The docker-compose runtime default is `doc_level` (one context per document, reused for every chunk); the in-code and env-template default is `per_chunk` (one context per chunk — the Anthropic recipe). |
| `DATAPREP_CONTEXTUAL_MODEL` | _(reuses `VLLM_LLM_MODEL_ID`)_ | Model for context generation. Empty = reuse `VLLM_LLM_MODEL_ID`. Must support guided JSON. |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | `6000` (docker-compose) / `100000` (env template & code default) | Max chars of doc text fed to the context LLM when `CONTEXTUAL_STRATEGY=per_chunk`. The docker-compose runtime default (`6000`, ~1 500 tokens at ~4 chars/token) is set in `docker-compose.yaml:1164`; the in-code and env-template default is `100000` (~25 000 tokens). |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL` | `100000` | Max chars of doc text fed to the context LLM when `CONTEXTUAL_STRATEGY=doc_level`. |
| `DATAPREP_CONTEXTUAL_MAX_TOKENS` | `512` | Max OUTPUT tokens of generated context (avoids truncation under load; the model writes ~196). |
| `CONTEXTUAL_LABEL_RAW` | `true` | Decoupled mode: label the **raw** chunk but embed the **contextualised** chunk. |

## Strategies

- **`doc_level`** (docker-compose default) — one context-generation call
  per document, and the *same* context is prepended to every chunk in
  that document. N× cheaper than `per_chunk`, and enough to propagate
  the document's subject into every chunk's vector. The right choice for
  cost-sensitive deployments where subject propagation is the goal.
- **`per_chunk`** (code / env-template default) — one context-generation
  call per chunk. Each chunk gets a context tailored to its own section;
  this is the canonical Anthropic recipe. Highest precision, highest
  cost (N calls for N chunks). Choose it when retrieval precision on
  individual chunks matters more than ingest cost.

The choice is one env var: `CONTEXTUAL_STRATEGY=per_chunk|doc_level`.
Both can be re-applied to a corpus by re-ingesting.

## Decoupled labelling (`CONTEXTUAL_LABEL_RAW`)

On by default. The pipeline labels the **raw** chunk (preserving label
precision) while embedding the **contextualised** chunk (propagating the
subject via the vector). A/B testing showed that feeding the generated
context *to the labeler* distorts labelling — broad doc-level context
over-labels (~×3.6), focused per-chunk context under-labels (many empty
label sets). Labelling the raw chunk restores precision (~2.3 labels/
chunk) while the embedding still carries the subject. Set `false` only if
you want the labeler to see the context too.

## Resilience

- Context generation **never blocks ingestion**. On failure (model error,
  `0/N` JSON, timeout), the raw chunk is embedded and an error is logged
  so operators notice.
- Check VictoriaLogs for `dataprep.contextual.failure` events; if you see
  >5% of chunks failing, the contextual model is misconfigured and you
  are running on raw embeddings (silently degraded retrieval).
- Prefix caching (`--enable-prefix-caching` on vLLM) substantially
  reduces the cost of `per_chunk`, because the shared document text is
  cached across the per-chunk calls. In internal benchmarks this cut
  per-chunk context-generation cost by ~80% on multi-section documents.

## Model requirement

The context-generation model must support OpenAI-compatible guided JSON
output (`response_format={"type": "json_object"}`, returning
`{"context": "..."}`). Validated on `ibm-granite/granite-4.1-8b`. See
[Choosing models]({{< relref "choosing-models" >}}).

> **Disabling.** To run plain (non-contextual) retrieval, set
> `CONTEXTUAL_RETRIEVAL_ENABLED=false`. Everything else continues to
> work; chunks are simply embedded and labelled without the context
> prefix. Set `CONTEXTUAL_RETRIEVAL_ENABLED=false` only if you have a
> specific reason — the on-by-default behaviour is the recommended
> default.

## Verification

Confirm labels and the contextual prefix landed by inspecting a chunk
in ArangoDB:

```bash
docker exec $(docker ps --format '{{.Names}}' | grep arango-vector-db | head -1) \
  arangosh --server.endpoint tcp://localhost:8529 \
  --server.authentication true \
  --server.username root --server.password "$ARANGO_PASSWORD" \
  --javascript.execute-string 'db._query("FOR d IN chunks FILTER d.file_id==\"<file_id>\" LIMIT 1 RETURN {text: d.text, chunk_text: d.chunk_text, labels: d.labels}").toArray()'
```

You should see `text` (the contextualised chunk used for embedding and
the visible source text in citations), `chunk_text` (the original raw
chunk when `CONTEXTUAL_LABEL_RAW=true`), and `labels` (assigned against
the raw chunk). A missing `chunk_text` field indicates
`CONTEXTUAL_LABEL_RAW=false` or a disabled context pipeline.

## Related

- [Knowledge base → Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}})
  — how the dataprep pipeline fits together.
- [Data labelling]({{< relref "data-labeling" >}}) — how labels are
  assigned and what `file_labels` scopes them to.
- [Choosing models]({{< relref "choosing-models" >}}) — model trade-offs
  for the context-generation LLM.