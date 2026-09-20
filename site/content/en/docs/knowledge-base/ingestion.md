---
title: Ingestion
description: The document ingestion pipeline — upload, antivirus scan, parsing, chunking, labelling, embedding, and storage — with supported formats and limits.
weight: 1
mode: how-to
persona: mixed
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Ingestion turns a raw uploaded file into searchable, labelled, embedded chunks in
ArangoDB. Ingestion does **not** start automatically. After upload the file sits
at `status = Pending`; an admin must call
`POST /api/files/{fileId}/ingest` (or `POST /api/files/ingest` for batch
ingestion) on the document-repository service to start it. The pipeline is
designed so that **a failure at any stage never loses the file** — the upload is
stored first, then processed.

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
[Observability]({{< relref "/docs/observe" >}}) for how to watch a specific
file's ingestion in the traces and the ingestion log.

For the chunking strategies (per-chunk vs doc-level context) and the
contextual-retrieval knobs (`CONTEXTUAL_RETRIEVAL_ENABLED`, `CONTEXTUAL_STRATEGY`,
`DATAPREP_CONTEXTUAL_DOC_BUDGET`, `DATAPREP_CONTEXTUAL_MAX_TOKENS`,
`CONTEXTUAL_LABEL_RAW`), see [RAG Pipeline → Ingestion and chunking
strategies]({{< relref "/docs/rag-pipeline/ingestion" >}}).

> **Glossary.** *docling* is the IBM open-source document parser used by dataprep
> to extract structured text (headings, tables, lists) from PDFs and Office files.
> *Guided JSON* means vLLM constrains the LLM to emit a parseable JSON object via
> OpenAI's `response_format={"type":"json_object"}` flag, instead of free text.
> A *fallback embedding* is the vector produced when the primary embedding model
> fails for a single chunk — that chunk is still indexed, just with lower-quality
> recall.

## Supported formats

The accepted formats are enforced by `allowedExtensions` and `allowedMimeTypes` in
`components/document-repository/src/config/appConfig.js`, plus a magic-byte check
in `components/document-repository/src/utils/mimeTypeValidator.js`. The
upload flow performs two checks: the multer `fileFilter` accepts a file if
EITHER its MIME type is in `allowedMimeTypes` OR its extension is in
`allowedExtensions`; then the `validateFileType` middleware confirms the
extension is in `allowedExtensions` and validates the file's magic bytes.
The authoritative extension list is `allowedExtensions`; the MIME list covers
browser-reported types (e.g., `application/zip` for Office files).

| Format | Extensions accepted | Notes |
|---|---|---|
| PDF | `.pdf` | Text-based PDFs only; scanned/image PDFs need OCR first. |
| Word | `.docx` | Office Open XML. The legacy `.doc` format is **rejected** (`.doc` is permitted by MIME type `application/msword` in `allowedMimeTypes`, but rejected at the extension check in `mimeTypeValidator.js`). |
| Excel | `.xlsx` | Office Open XML. The legacy `.xls` format is **rejected** (same dual-check: `.xls` is permitted by MIME type `application/vnd.ms-excel` in `allowedMimeTypes`, but rejected at the extension check). Table-heavy sheets chunk poorly. |
| Markdown | `.md` | Cleanest source — well-structured text chunks best. Note that `.markdown` is **not** whitelisted. |
| Plain text | `.txt` | |
| HTML | `.html` | |

> **Office files reported as ZIP.** Some browsers report `.docx`/`.xlsx` uploads
> as `application/zip` or `application/x-zip-compressed`; these MIME types are
> accepted so Office uploads are not rejected by MIME sniffing. The authoritative
> allowlist is `allowedExtensions` / `allowedMimeTypes` in
> `components/document-repository/src/config/appConfig.js`.

> **Plain, well-structured documents retrieve best.** Documents that are mostly
> scanned images, heavily nested tables, or image-only PDFs produce poor text and
> therefore poor chunks. See [Content guidance]({{< relref "content-guidance" >}}).

## Limits

| Setting | Default | Variable | Where to set |
|---|---|---|---|
| Max files per upload | `10` | `MAX_FILES_UPLOAD` | Add to the `document-repository` service `environment` block in `docker-compose.yaml` |
| Max file size | `50 MB` | `MAX_FILE_SIZE` (bytes) | Same — no default exists in `env`, so add the var explicitly |

The values are read by `components/document-repository/src/config/appConfig.js`
(lines 30–31) but are **not** seeded in the project `env` template or
`docker-compose.yaml`. To change a limit, add the variable to your deployment
`.env` and reference it from the `document-repository` service's `environment:`
block; otherwise the parser-side defaults apply.

## Antivirus scanning

Every upload passes through **ClamAV** before it is accepted. A file that fails
the scan is rejected at the upload boundary — it is never stored or processed.
This protects the knowledge base from malicious payloads in uploaded documents.

The scan is configurable via the `clamscan` block in `appConfig.js`
(`CLAMSCAN_HOST`, `CLAMSCAN_PORT`, `CLAMSCAN_TIMEOUT`, `VIRUS_SCANNING`,
`CLAMSCAN_REMOVE_INFECTED`, `CLAMSCAN_QUARANTINE_INFECTED`); the defaults assume
the `clamav` service is on the internal network at `clamav:3310`.

## Per-chunk progress

Ingestion of a large document is not instantaneous: each chunk is labelled (an
LLM call) and embedded. Progress is written to the **ingestion log** as each
chunk completes, so you can watch a file move through the pipeline rather than
waiting blind.

You can read the ingestion log in three places:

- the **admin UI** — Admin Dashboard → Document Management → click a file → "Ingestion log" tab
- the **API** — `GET /api/files/{file_id}/ingestion-log` on the document-repository service (Admin or `dataprep-service` role required)
- the **distributed trace** for the file's `trace_id` in VictoriaTraces, accessed via Grafana → Observability → Traces

See the [Ingestion log reference]({{< relref "ingestion-log" >}}) for the
schema and canonical message strings.

## What gets stored

For each chunk, ArangoDB stores:

- the **text** (and the original chunk text, if a context prefix was added),
- the **embedding** vector,
- the **labels** assigned during labelling,
- the **file_id** it came from,
- **graph nodes and edges** (entities and relationships extracted for
  knowledge-graph retrieval).

This is what the retriever searches at query time. See
[Retrieval]({{< relref "/docs/rag-pipeline/retrieval" >}}) for how these pieces are used.

## Failure behaviour

The pipeline is **resilient by design**:

- **Upload failure** → the file never enters the system.
- **Antivirus failure** → rejected, never stored.
- **Parse/chunk failure** → the file is marked failed (`Ingestion Error`); nothing partial is indexed.
- **Labelling or embedding failure for a chunk** → that chunk is stored raw
  (unlabelled / fallback embedding); ingestion of the rest of the document
  continues. An error is written to the ingestion log so operators notice.

This means a single model hiccup never blocks an entire document — it degrades
one chunk, visibly, and carries on.

### Where to look when something goes wrong

- **Per-file ingestion log** (admin UI or `GET /api/files/{file_id}/ingestion-log`)
  lists per-chunk milestones and warnings — the canonical first stop.
- **Dataprep logs** in VictoriaLogs (`service:genieai-dataprep`) show
  exception traces and stack traces for the chunk/label/embed stages.
- **VictoriaTraces** correlates the `file_id` to a single trace_id (search by
  `dataprep.file_id`); every chunk spans lives under that root span.
- **Document lifecycle states** are explained in
  [Document lifecycle]({{< relref "document-lifecycle" >}}).

## Verification checklist (after a fresh deploy)

1. Upload a representative PDF through Admin → Document Management.
2. Open the file's status page; confirm `dataprep.status` transitions:
   `Pending` → `Ingesting` → `Ingested` (or `Ingested with Warnings`).
3. Open the "Ingestion log" tab — every chunk should have at least one
   `Final labels` entry; warnings (fallback embedding, raw-chunk fallback) are
   acceptable but should be reviewed.
4. In Grafana → Observability → Traces, search by span attribute
   `dataprep.file_id=<file_id>` (the ingestion log entry schema does not carry a
   `trace_id`) and confirm the trace contains the full dataprep span sequence
   (`dataprep.ingest` → `dataprep.chunking` → per-chunk label/embed spans).
5. Ask a representative question in the chat UI and verify the citation list
   includes the newly ingested chunk.