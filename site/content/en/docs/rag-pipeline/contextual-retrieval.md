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
| `CONTEXTUAL_STRATEGY` | `per_chunk` | Strategy selector. Both docker-compose and env-template now default to `per_chunk` (one context per chunk — the Anthropic recipe); `doc_level` is a cheaper opt-in. |
| `DATAPREP_CONTEXTUAL_MODEL` | _(reuses `VLLM_LLM_MODEL_ID`)_ | Model for context generation. Empty = reuse `VLLM_LLM_MODEL_ID`. Must support guided JSON. |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | `0` (= derived) | Max chars of document text placed in the context LLM's system prompt. `0` derives it from `VLLM_MAX_MODEL_LEN`; set `>0` to pin a value, `<0` to disable contextualization. |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL` | `100000` | Max chars of document text when `CONTEXTUAL_STRATEGY=doc_level` (a single call, so it can afford a larger window than `per_chunk`). |
| `DATAPREP_CONTEXTUAL_MAX_TOKENS` | `512` | Max OUTPUT tokens **per chunk in the batch** (avoids truncation under load; the model writes ~196). A batch of 4 therefore reserves 2048 output tokens. |
| `CONTEXTUAL_LABEL_RAW` | `true` | Decoupled mode: label the **raw** chunk but embed the **contextualised** chunk. |
| `VLLM_MAX_MODEL_LEN` | `65536` | The served model's context window. Set by `env.t4` (2048) / `env.rtx6000` (4096). This is what the budget is derived from. |

### The budget is derived, not chosen

`DATAPREP_CONTEXTUAL_DOC_BUDGET=0` means "work it out". The context-generation
call carries the system prompt + the document context + the batch's chunk text,
and reserves `DATAPREP_CONTEXTUAL_MAX_TOKENS` for **each** chunk in the batch.
Everything except the document context is subtracted from
`VLLM_MAX_MODEL_LEN`, and whatever remains is the budget.

The point of deriving it: GENIE.AI is a framework, not a deployment pinned to one
model. The document size a curator can work with follows the model you serve.

| `VLLM_MAX_MODEL_LEN` | Derived budget | Documents up to |
|---|---|---|
| 2048 (`env.t4`) | none — the output reservation alone exceeds the window | contextualization is skipped, chunks are ingested raw |
| 4096 (`env.rtx6000`) | ~11 000 chars | ~40 chunks |
| 65536 (default) | ~250 000 chars | ~500 chunks |

Provision a larger-parameter model and raise the window, and the budget — and
therefore the largest usable concept document — scales with it. Nothing else needs
re-tuning. Two caveats: the window costs KV-cache memory roughly linearly (which
is why `env.t4` is pinned to 2048), and when the window is genuinely too small the
service falls back to raw chunks rather than failing the ingest.

### If you see "Document context truncated"

A truncation warning in the Ingestion Log means the document is larger than the
derived budget. Chunks from beyond the budget still ingest, but their context
describes the *beginning* of the document, which degrades their embedding and the
graph extraction drawn from them. In order of preference: raise
`VLLM_MAX_MODEL_LEN` if the GPU has the memory; otherwise split the document
during curation; only pin `DATAPREP_CONTEXTUAL_DOC_BUDGET` manually when you have
a reason to, since a budget sized for one GPU overflows a smaller one and the
rejected calls fall back to raw chunks silently.

## Strategies

- **`per_chunk`** (default — docker-compose, env template, code) — one
  context-generation call per chunk. Each chunk gets a context tailored to
  its own section; this is the canonical Anthropic recipe. Highest
  precision, highest cost (N calls for N chunks). Choose it when retrieval
  precision on individual chunks matters more than ingest cost.
- **`doc_level`** (opt-in) — one context-generation call per document, and
  the *same* context is prepended to every chunk in that document. N×
  cheaper than `per_chunk`, and enough to propagate the document's subject
  into every chunk's vector. The right choice for cost-sensitive deployments
  where subject propagation is the goal.

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