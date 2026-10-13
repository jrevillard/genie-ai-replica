---
title: Labelling & Taxonomy
description: How chunks are labelled against the service-category taxonomy, and how labels filter retrieval to keep answers on-topic.
weight: 3
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-19
---

Labelling is what keeps a multi-domain knowledge base from bleeding across
topics. Every chunk is assigned one or more **labels** drawn from the
**service-category taxonomy**, and at query time the retriever uses those labels
to return only on-topic chunks. Without labels, a question about one service
could pull in unrelated chunks from another.

## Where this lives now

The full labelling reference (developer and operator angles, including the
configuration table, output contract, file-scope labels, failure modes,
verification steps, and the document-repository `/api/labels` surface) has
moved to
[RAG pipeline → Data labelling strategy]({{< relref "/docs/rag-pipeline/data-labeling" >}}).

## Manage the taxonomy

Knowledge managers curate the service-category hierarchy through the **Admin
Dashboard → Knowledge Hierarchy** tab, which edits the same backend CRUD
endpoints (`/api/service-categories/*`) documented in the canonical reference.
For guidance on diagnosing label quality (per-chunk `Final labels` log entries,
the >80 % labelled threshold, probing the live vLLM, and the
document-repository label-tree CRUD), see the
[Diagnosing label quality]({{< relref "/docs/rag-pipeline/data-labeling#diagnosing-label-quality" >}})
section of the canonical reference.

For per-chunk log-schema details and the canonical message strings to grep for,
see the
[Ingestion log reference]({{< relref "/docs/operate/ingestion-log" >}}).