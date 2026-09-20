---
title: Content Guidance
description: What makes knowledge-base content retrieve well — document structure, chunking, tables, and how contextual retrieval and labelling interact with content quality.
weight: 4
mode: how-to
persona: mixed
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

The single biggest factor in GENIE.AI answer quality is the **quality of the
documents in the knowledge base**. No amount of retrieval tuning fixes documents
that are poorly structured, ambiguous, or full of content the parser cannot read.
This page is practical guidance for the people choosing and preparing source
documents.

This page is for **content authors and knowledge managers** — not pipeline
developers. If you need to know how retrieval actually works under the hood,
read the [RAG Pipeline]({{< relref "/docs/rag-pipeline" >}}) section.

## What retrieves well

- **Clean, text-based documents** — real text the parser can extract, not scanned
  images.
- **Clear structure** — headings, sections, lists. Structure helps both chunking
  (cleaner chunk boundaries) and the knowledge graph.
- **Self-contained sections** — a chunk that makes sense on its own retrieves far
  better than one full of "see above" or dangling pronouns.
- **One topic per section** — focused sections produce precise labels.
- **Explicit language** — the words a user would actually type. A document that
  calls it "the Programme" everywhere will not retrieve for "permit renewal".

### Example — a section that retrieves well

> ## Renewing a passport
>
> To renew an adult passport, you must submit:
>
> - the expired passport or a police-loss report,
> - a recent colour photograph (35 × 45 mm, white background),
> - proof of residence (utility bill or bank statement under three months old),
> - the renewal fee of 50 USD, payable at any post office.
>
> Processing time is 10 working days. You will be notified by SMS when the
> passport is ready for collection at the issuing office.

Why this works: the heading names the topic; the list enumerates requirements;
the language is the same a user would type; the section stands alone without
referring to other sections.

## What retrieves poorly

- **Scanned / image-only PDFs** — there is little or no extractable text; the
  chunk is near-empty. OCR these into real text first.
- **Table-heavy documents** — most chunks become padded table rows with low
  information density and poor labels. This is a known, expected pattern, not a
  labelling bug.
- **Documents that are all boilerplate** — headers/footers repeated on every page
  pollute chunks.
- **Enormous, undifferentiated documents** — without structure, chunks are
  arbitrary windows of text.

### Example — a section that retrieves poorly

> (continued from page 12) ...as mentioned above, the said procedure shall
> apply mutatis mutandis in such cases, subject to the provisions hereof, and
> pursuant to the aforementioned, the relevant authority may, at its
> discretion, provided that…

Why this fails: no heading; no nouns the user would search for; pronouns that
refer back to a different page; legalese the user would never type; no
self-contained meaning.

## Chunking

The dataprep splits parsed text into retrieval-sized chunks. You do not control
chunk boundaries directly, but you influence their quality through document
structure: well-headed documents chunk cleanly; wall-of-text documents chunk
arbitrarily. If a specific document retrieves badly, the first fix is almost
always the document's structure, not a pipeline knob.

## Contextual retrieval

When [Contextual Retrieval]({{< relref "/docs/rag-pipeline/contextual-retrieval" >}})
is on (the default), GENIE.AI automatically prepends a short LLM-generated
**summary of the document** to every chunk before embedding. The summary
explains what "it" refers to in a sentence like "renewing it…", so the chunk
retrieves correctly even in isolation.

This is especially valuable for:

- **pronoun-heavy or section-dependent chunks** ("renewing *it*…") that lose
  their subject in isolation,
- **generic chunks** whose topic is only clear from the document title or
  surrounding section.

It does **not** rescue unparseable content — a scanned-image chunk has nothing
to contextualise.

## Labelling interaction

Good content → clear labels → precise filtering. If you see
[labelling problems]({{< relref "labelling-taxonomy" >}}#when-labels-look-wrong),
check the content first: a chunk that says nothing definite cannot be labelled
precisely by any model.

## A practical checklist before publishing a document

1. Is it real, selectable text (not a scan)?
2. Does it have a clear heading structure?
3. Does each section stand on its own, or does it depend heavily on context
   above?
4. Does it use the terms a user would actually search?
5. Is it free of heavy table-only content?
6. Does it fit a single taxonomy category (so it labels cleanly)?

Fix the document where it fails, re-upload, and confirm a test query retrieves
the expected chunk before declaring the document live.

### Test query — what to do

In the chat UI, ask a representative question about the document (one that
a user would actually type). Verify the cited chunk list points at the new
upload (not a stale one). If it does not:

1. Open the new file in Admin → Document Management and confirm the status is
   `ingested`.
2. If the status is correct but the chat still cites the old chunk,
   [retract]({{< relref "document-lifecycle" >}}) the old version (or any
   other document carrying the same text) and try again.

A chat answer that cites both the new and the old version is a strong signal
that you forgot to retract the previous one.

## Next steps

- [Document lifecycle]({{< relref "document-lifecycle" >}}) — how to upload,
  monitor, retract, and re-upload a document.
- [Labelling & taxonomy]({{< relref "labelling-taxonomy" >}}) — how labels
  are assigned, how to curate the taxonomy, and how to diagnose "why does
  this chunk get the wrong label".
- [Ingestion]({{< relref "ingestion" >}}) — the pipeline stages, supported
  formats, and size limits.
- [Ingestion log reference]({{< relref "ingestion-log" >}}) — where to look
  when a document fails to ingest or labels look wrong.