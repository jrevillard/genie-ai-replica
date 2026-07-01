---
title: Content Guidance
description: What makes knowledge-base content retrieve well — document structure, chunking, tables, and how contextual retrieval and labelling interact with content quality.
weight: 4
---

The single biggest factor in GENIE.AI answer quality is the **quality of the
documents in the knowledge base**. No amount of retrieval tuning fixes documents
that are poorly structured, ambiguous, or full of content the parser cannot read.
This page is practical guidance for the people choosing and preparing source
documents.

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

## Chunking

The dataprep splits parsed text into retrieval-sized chunks. You do not control
chunk boundaries directly, but you influence their quality through document
structure: well-headed documents chunk cleanly; wall-of-text documents chunk
arbitrarily. If a specific document retrieves badly, the first fix is almost
always the document's structure, not a pipeline knob.

## Contextual retrieval

When [Contextual Retrieval]({{< relref "/docs/rag/contextual-retrieval" >}})
is on (the default), each chunk is given a short LLM-generated document-context
prefix before embedding. This is especially valuable for:

- **pronoun-heavy or section-dependent chunks** ("renewing *it*…") that lose
  their subject in isolation,
- **generic chunks** whose topic is only clear from the document title or
  surrounding section.

It does not rescue unparseable content — a scanned-image chunk has nothing to
contextualise.

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
