---
title: Ingestion
description: The document ingestion pipeline — upload, antivirus scan, parsing, chunking, labelling, embedding, and storage — with supported formats and limits.
weight: 1
---

Ingestion turns a raw uploaded file into searchable, labelled, embedded chunks in
ArangoDB. It runs automatically once a file is uploaded; no manual trigger is
needed. The pipeline is designed so that **a failure at any stage never loses the
file** — the upload is stored first, then processed.

## The pipeline

```
1. Upload            — file received by the document-repository service
2. Antivirus scan    — ClamAV scans the file; infected files are rejected
3. Store             — file saved to disk; a file_id is assigned
4. Parse             — docling extracts text + structure (headings, tables)
5. Chunk             — text split into retrieval-sized chunks
6. Label             — each chunk labelled against the service taxonomy
7. Context prefix    — (if enabled) an LLM doc-context prefix is prepended
8. Embed             — each chunk vectorised with the embedding model
9. Store             — chunks, embeddings, labels, and graph nodes written to ArangoDB
```

Steps 4–9 are owned by the **dataprep** service
(`genie-ai-overlay/dataprep/`). The whole sequence is observable end-to-end — see
[Observability]({{< relref "/docs/observability" >}}) for how to watch a specific
file's ingestion in the traces and the ingestion log.

## Supported formats

| Format | Extensions | Notes |
|---|---|---|
| PDF | `.pdf` | Text-based PDFs only; scanned/image PDFs need OCR first. |
| Word | `.doc`, `.docx` | Legacy and Office Open XML. |
| Excel | `.xls`, `.xlsx` | Legacy and Office Open XML. Table-heavy sheets chunk poorly. |
| Markdown | `.md`, `.markdown` | Cleanest source — well-structured text chunks best. |
| Plain text | `.txt` | |
| HTML | `.html` | |

> **Office files reported as ZIP.** Some browsers report `.docx`/`.xlsx` uploads
> as `application/zip` or `application/x-zip-compressed`; these are accepted so
> Office uploads are not rejected by MIME sniffing. The authoritative list is
> `allowedExtensions` / `allowedMimeTypes` in
> `components/document-repository/src/config/appConfig.js`.

> **Plain, well-structured documents retrieve best.** Scanned images, heavily
> nested tables, and image-only PDFs produce poor text and therefore poor chunks.
> See [Content guidance]({{< relref "content-guidance" >}}).

> **Plain, well-structured documents retrieve best.** Documents that are mostly
> scanned images, heavily nested tables, or image-only PDFs produce poor text and
> therefore poor chunks. See [Content guidance]({{< relref "content-guidance" >}}).

## Limits

| Setting | Default | Variable |
|---|---|---|
| Max files per upload | 10 | `MAX_FILES_UPLOAD` |
| Max file size | 50 MB | `MAX_FILE_SIZE` |

These are operational defaults in the document-repository service and can be
adjusted per deployment.

## Antivirus scanning

Every upload passes through **ClamAV** before it is accepted. A file that fails
the scan is rejected at the upload boundary — it is never stored or processed.
This protects the knowledge base from malicious payloads in uploaded documents.

## Per-chunk progress

Ingestion of a large document is not instantaneous: each chunk is labelled (an
LLM call) and embedded. Progress is written to the **ingestion log** as each
chunk completes, so you can watch a file move through the pipeline rather than
waiting blind. The ingestion log is queryable through the backend and visible in
the admin UI.

## What gets stored

For each chunk, ArangoDB stores:

- the **text** (and the original chunk text, if a context prefix was added),
- the **embedding** vector,
- the **labels** assigned during labelling,
- the **file_id** it came from,
- **graph nodes and edges** (entities and relationships extracted for
  knowledge-graph retrieval).

This is what the retriever searches at query time. See
[Retrieval]({{< relref "/docs/rag/retrieval" >}}) for how these pieces are used.

## Failure behaviour

The pipeline is **resilient by design**:

- **Upload failure** → the file never enters the system.
- **Antivirus failure** → rejected, never stored.
- **Parse/chunk failure** → the file is marked failed; nothing partial is indexed.
- **Labelling or embedding failure for a chunk** → that chunk is stored raw
  (unlabelled / fallback embedding); ingestion of the rest of the document
  continues. An error is logged so operators notice.

This means a single model hiccup never blocks an entire document — it degrades
one chunk, visibly, and carries on.
