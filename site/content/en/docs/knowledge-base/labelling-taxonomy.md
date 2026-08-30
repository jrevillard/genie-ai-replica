---
title: Labelling & Taxonomy
description: How chunks are labelled against the service-category taxonomy, and how labels filter retrieval to keep answers on-topic.
weight: 3
---

Labelling is what keeps a multi-domain knowledge base from bleeding across
topics. Every chunk is assigned one or more **labels** drawn from the
**service-category taxonomy**, and at query time the retriever uses those labels
to return only on-topic chunks. Without labels, a question about one service
could pull in unrelated chunks from another.

## The taxonomy

The taxonomy is the **service-category hierarchy** — the set of categories and
services the deployment answers about. It is managed in the backend
(`serviceCategories`, `services`) and is the same structure the application uses
to organise its service catalogue.

- English (`nameEN`) is the **source of truth** for RAG compatibility; labels are
  matched in English regardless of the user's UI language.
- Translations live in dedicated translation collections, so labelling and
  retrieval operate on a single canonical language.

> **Curate the taxonomy deliberately.** Labels are only as good as the taxonomy
> they reference. A flat or ambiguous taxonomy produces vague labels; a
> well-structured one produces precise retrieval. Domain experts should review
> the category set, not just the documents.

## How chunks are labelled

At ingest time, the dataprep calls an LLM once per chunk (or per batch) and asks
it to assign the most relevant taxonomy label(s) to that chunk's text:

- The model is constrained to **guided JSON** output (`response_format` =
  `json_object`) and to pick only from the provided taxonomy.
- A chunk may get **zero, one, or several** labels. Getting no label is usually
  *correct* — the chunk does not match any taxonomy entry — not a bug.
- The label selector prompt is environment-overridable
  (`LABEL_SELECTOR_SYSTEM_PROMPT`).

Two labelling strategies exist:

| Strategy | Cost | Use when |
|---|---|---|
| LLM (default) | one LLM call per chunk | label precision matters. |
| Embedding-based | cheaper, no LLM call | ingest speed matters more than precision. |

## Label filtering at retrieve time

When a query comes in, the retriever applies a **label filter**: only chunks
whose labels are relevant to the query's intent are considered, before vector /
lexical ranking. This is the mechanism that prevents cross-topic bleed. See
[Retrieval]({{< relref "/docs/rag/retrieval" >}}).

## Contextual retrieval interaction

When [Contextual Retrieval]({{< relref "/docs/rag/contextual-retrieval" >}}) is
on (it is on by default), a doc-context prefix is prepended to each chunk before
embedding. By default the chunk is labelled on its **raw** text
(`CONTEXTUAL_LABEL_RAW=true`), so labels keep their precision while the embedding
gains the document's subject. This is the recommended setting — feeding the
context to the labeler distorts labelling (over- or under-labelling).

## When labels look wrong

- **Many chunks get `[]`** → usually correct (no taxonomy match). Verify the
  taxonomy is loaded and some chunks *do* get specific labels.
- **Labels drift to neighbouring categories** → the taxonomy may be too coarse,
  or the label selector prompt needs tightening.
- **All chunks get the document's main label only** → sub-category structure may
  be missing from the taxonomy.

Diagnose by reading the ingestion log for a representative document, and by
probing the live LLM with a real chunk (see
[Data labelling strategy]({{< relref "/docs/rag/data-labeling" >}}) for the
diagnostic recipe).
