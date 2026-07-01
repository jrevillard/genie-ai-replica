---
title: Contextual Retrieval
description: On-by-default per-chunk or per-document context prefix that improves retrieval precision by embedding chunks with their source context.
weight: 6
---

Standard retrieval embeds each chunk in isolation. A chunk removed from its
section can be hard to match: a paragraph about "renewing it" will not retrieve
well for a query about "permit renewal" because the chunk alone does not say what
"it" is. **Contextual Retrieval** (an Anthropic-style technique) fixes this by
prepending a short, LLM-generated **doc-context prefix** to each chunk *before*
it is embedded and labelled, so the chunk's vector carries its surrounding
meaning.

This feature is **on by default** (`CONTEXTUAL_RETRIEVAL_ENABLED=true`). It is an
**ingest-time** operation: it costs one extra LLM call per chunk (or per document)
at ingestion, and zero at query time. It never blocks ingestion — if context
generation fails for a chunk, the raw chunk is embedded as a fallback.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `CONTEXTUAL_RETRIEVAL_ENABLED` | `true` | Master switch. On by default; set `false` to disable (a no-op beyond skipping context generation). |
| `CONTEXTUAL_STRATEGY` | `doc_level` | `doc_level` (one context call per document) or `per_chunk` (one per chunk). |
| `DATAPREP_CONTEXTUAL_MODEL` | _(reuses LLM)_ | Model for context generation. Empty = reuse `VLLM_LLM_MODEL_ID`. Must support guided JSON. |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | 6000 | Max chars of doc text fed to the context LLM (~1500 tokens). |
| `DATAPREP_CONTEXTUAL_MAX_TOKENS` | 512 | Max tokens of generated context (avoids truncation under load). |
| `CONTEXTUAL_LABEL_RAW` | `true` | Decoupled mode: label the **raw** chunk but embed the **contextualised** chunk. |

## Strategies

- **`doc_level`** (default) — one context-generation call per document, and the
  *same* context is prepended to every chunk in that document. N× cheaper than
  per-chunk, and enough to propagate the document's subject into every chunk's
  vector. The right default for cost-sensitive deployments where subject
  propagation is the goal.
- **`per_chunk`** — one context-generation call per chunk. Each chunk gets a
  context tailored to its own section; this is the canonical Anthropic recipe.
  Highest precision, highest cost (N calls for N chunks). Choose it when the
  extra ingest cost is acceptable for maximum retrieval precision.

## Decoupled labelling (`CONTEXTUAL_LABEL_RAW`)

On by default. The pipeline labels the **raw** chunk (preserving label precision)
while embedding the **contextualised** chunk (propagating the subject via the
vector). A/B testing showed that feeding the generated context *to the labeler*
distorts labelling — broad doc-level context over-labels (~×3.6), focused
per-chunk context under-labels (many empty label sets). Labelling the raw chunk
restores precision (~2.3 labels/chunk) while the embedding still carries the
subject. Set `false` only if you want the labeler to see the context too.

## Resilience

- Context generation **never blocks ingestion**. On failure (model error, `0/N`
  JSON, timeout), the raw chunk is embedded and an error is logged so operators
  notice.
- Prefix caching (`--enable-prefix-caching` on vLLM) substantially reduces the
  cost of `per_chunk`, because the shared document text is cached across the
  per-chunk calls.

## Model requirement

The context-generation model must support OpenAI-compatible guided JSON output
(`response_format={"type":"json_object"}`, returning `{"context": "..."}`).
Validated on `ibm-granite/granite-4.1-8b`. See
[Choosing models]({{< relref "choosing-models" >}}).

> **Disabling.** To run plain (non-contextual) retrieval, set
> `CONTEXTUAL_RETRIEVAL_ENABLED=false`. Everything else continues to work; chunks
> are simply embedded and labelled without the context prefix.
