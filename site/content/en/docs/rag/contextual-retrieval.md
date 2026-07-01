---
title: Contextual Retrieval
description: Opt-in per-chunk or per-document context prefix that improves retrieval precision by embedding chunks with their source context.
weight: 6
---

Standard retrieval embeds each chunk in isolation. A chunk removed from its
section can be hard to match: a paragraph about "renewing it" will not retrieve
well for a query about "permit renewal" because the chunk alone does not say what
"it" is. **Contextual Retrieval** (an Anthropic-style technique) fixes this by
prepending a short, LLM-generated **doc-context prefix** to each chunk *before*
it is embedded and labelled, so the chunk's vector carries its surrounding
meaning.

This is an **ingest-time** feature: it costs one extra LLM call per chunk (or per
document) at ingestion, and zero at query time. It never blocks ingestion — if
context generation fails for a chunk, the raw chunk is embedded as a fallback.

## Enable

| Variable | Recommended (env) | Effect |
|---|---|---|
| `CONTEXTUAL_RETRIEVAL_ENABLED` | `false` | Opt-in master switch. |
| `CONTEXTUAL_STRATEGY` | `per_chunk` | `per_chunk` (one context call per chunk) or `doc_level` (one per document). |
| `DATAPREP_CONTEXTUAL_MODEL` | _(reuses LLM)_ | Model for context generation. Must support guided JSON. |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | 6000 | Max chars of doc text fed to the context LLM (~1500 tokens). |
| `DATAPREP_CONTEXTUAL_MAX_TOKENS` | 512 | Max tokens of generated context (avoids truncation under load). |
| `CONTEXTUAL_LABEL_RAW` | `false` | If true, label the **raw** chunk but embed the **contextualised** chunk. |

## Strategies

- **`per_chunk`** (recommended) — one context-generation call per chunk. Each
  chunk gets a context tailored to its own section. This is the canonical
  Anthropic recipe: highest precision, highest cost (N calls for N chunks).
- **`doc_level`** — one context-generation call per document, and the *same*
  context is prepended to every chunk in that document. N× cheaper, still
  propagates the document's subject into every chunk's vector. Good when chunks
  are short and the document has a single coherent topic.

## Decoupled labelling (`CONTEXTUAL_LABEL_RAW`)

By default the chunk is labelled *after* the context prefix is added, so labels
reflect the enriched text. With `CONTEXTUAL_LABEL_RAW=true` the pipeline labels
the **raw** chunk (preserving label precision) while embedding the
**contextualised** chunk (propagating the subject via the vector). This is useful
when the context prefix would dilute a specific label.

## Resilience

- Context generation **never blocks ingestion**. On failure (model error, `0/N`
  JSON, timeout), the raw chunk is embedded and an error is logged.
- Prefix caching (`--enable-prefix-caching` on vLLM) substantially reduces the
  cost of `per_chunk` because the shared document text is cached across the
  per-chunk calls.

## Model requirement

The context-generation model must support OpenAI-compatible guided JSON output
(`response_format={"type":"json_object"}`). Validated on
`ibm-granite/granite-4.1-8b`. See [Choosing models]({{< relref "choosing-models" >}}).

> **Cost / benefit.** Use Contextual Retrieval when retrieval precision on
> ambiguous or pronoun-heavy chunks matters more than ingest speed. For
> well-structured, self-contained chunks it adds cost with little gain.
