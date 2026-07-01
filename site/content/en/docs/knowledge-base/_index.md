---
title: Knowledge Base
description: Managing the GENIE.AI knowledge base — ingesting documents, the processing pipeline, the label taxonomy, document lifecycle, and content guidance.
weight: 10
slug: knowledge-base
---

GENIE.AI answers only from the documents you load into it. The **knowledge base**
is the curated set of source documents that retrieval searches and the LLM reads
from. This section is for the people who **own and curate that content** —
knowledge managers, domain experts, and administrators — not developers of the
pipeline internals.

If you want to understand *how retrieval works under the hood*, read the
[RAG Pipeline]({{< relref "/docs/rag" >}}) section first. This section is about
the **operational** side: how documents get in, how they are processed, how to
organise and maintain them, and what makes content retrieve well.

## Pages in this section

- [Ingestion]({{< relref "ingestion" >}}) — the upload → scan → chunk → label →
  embed → store pipeline, supported formats, and size limits.
- [Document lifecycle]({{< relref "document-lifecycle" >}}) — upload, processing
  states, updating, and retracting documents.
- [Labelling & taxonomy]({{< relref "labelling-taxonomy" >}}) — how chunks are
  labelled, the service-category taxonomy, and label-based filtering at retrieve
  time.
- [Content guidance]({{< relref "content-guidance" >}}) — what makes knowledge-base
  content retrieve well: document structure, chunking, and the effect of
  contextual retrieval.

## How documents flow through the system

```
Upload (UI/API)
  → Document repository (ClamAV virus scan, storage)
  → Dataprep: docling parse → chunk → LLM label → context prefix → embed
  → ArangoDB (chunks + embeddings + graph nodes + labels)
  → Retrievable at query time
```

Every document is tracked by `file_id`, with per-chunk progress visible in the
ingestion log. A document can be **retracted** at any time, which removes its
chunks, embeddings, and graph nodes cleanly.

## Who this is for

| Role | What you'll do here |
|---|---|
| Knowledge manager | Upload and curate documents; organise the taxonomy. |
| Domain expert | Review and refine labels; judge retrieval quality. |
| Administrator | Monitor ingestion health; retract outdated content; size the knowledge base. |
