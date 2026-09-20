---
title: Document Lifecycle
description: Upload, processing states, updating, and retracting documents in the GENIE.AI knowledge base.
weight: 2
mode: reference
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Every document in the knowledge base has a lifecycle: it is uploaded, processed,
made retrievable, and eventually updated or removed. Each document is tracked by
a stable `file_id`, so its status, chunks, and graph footprint are all addressable.

This page is for **admins and operators** who run the admin UI and operate the
ingestion pipeline. End users (who only chat with the system) do not need this
page; they can rely on the chat UI and the answers it surfaces.

## States

A document moves through these states. The values are **exactly what the backend
persists** (capitalized) — `dataprep.status` field on each file record. The
admin UI shows them lowercased (`pending`, `ingesting`, etc.) — see the
"Frontend display" column for what you see in the UI.

| State (persisted) | Frontend display | Meaning |
|---|---|---|
| `Pending` | `pending` | File received and virus-scanned; stored on disk. Not yet searchable. |
| `Ingesting` | `ingesting` | Dataprep is parsing, chunking, labelling, and embedding. |
| `Ingested` | `ingested` | All chunks indexed; the document is **retrievable**. |
| `Ingested with Warnings` | `ingested with warnings` | Ingestion succeeded but at least one chunk used a fallback (raw chunk / fallback embedding). Retrievable, but inspect the ingestion log. |
| `Ingestion Error` | `ingestion error` | Processing failed; the document is **not** searchable. Check the ingestion log for the reason. |
| `Killed` | `killed` | Ingestion was aborted by an admin (see "Kill an in-flight ingest" below). |
| `Retracted` | `retracted` | The document was deliberately removed via the retract flow. Not searchable. |

Only documents in the **`Ingested`** or **`Ingested with Warnings`** state
contribute to answers. A document stuck in `Ingesting` or in `Ingestion Error`
is invisible to retrieval.

The Joi schema that validates these values lives at
`components/document-repository/src/controllers/fileController.js:96`. The set of
states is enforced at the API boundary.

## Uploading

There are three ways to add a document to the knowledge base:

### From the admin UI

1. Sign in as an **Admin** user.
2. Open the **Admin Dashboard** (left-rail "Admin" item in the main app).
3. Click the **Document Management** tab.
4. Click **Upload** (top-right of the table).
5. Pick one or more files (subject to the [size and format limits]({{< relref "ingestion" >}})).
6. The upload call accepts the file, virus-scans it via ClamAV, and stores it on
   disk. A `file_id` is assigned and the status moves to `Pending`.
7. **Trigger ingestion** — call `POST /api/files/{fileId}/ingest` (or
   `POST /api/files/ingest` for batch ingestion) on the document-repository
   service. The `Admin` Keycloak role is required. The upload itself only stores
   the file; dataprep does not pick it up automatically.
8. Dataprep begins processing once the ingest endpoint is called — status moves
   to `Ingesting`, then `Ingested` (or `Ingestion Error`).
9. **You do not need to wait.** The ingest call returns once dispatch is
   complete; processing is asynchronous.

### Via the API

The upload endpoint lives on the **document-repository service** (not the BFF
backend) and is exposed under `/api/files`:

```bash
curl -sk -X POST \
  "https://${<NGINX_PUBLIC_DOMAIN>}/api/files/upload" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -F "files=@./manual.pdf"
```

- `POST /api/files/upload` — single file
- `POST /api/files/uploads` — multiple files (respects `MAX_FILES_UPLOAD`)
- `POST /api/files/upload-link` — register a URL for fetch-then-ingest
- `POST /api/files/crawl/schedule` — schedule a web crawl job

All four require the **`Admin`** Keycloak role. The `fileService.uploadFile` flow
stores the file, runs ClamAV, sets the record to `Pending`, and waits for a
separate manual trigger (`POST /api/files/{fileId}/ingest`) to forward the file
to dataprep.

## Monitoring processing

Three places to watch a document's progress:

- **Admin UI** — Admin Dashboard → **Document Management** tab → click the file
  → status pill at the top → "Ingestion log" tab for per-chunk milestones.
- **API** — `GET /api/files/{file_id}/ingestion-log` on the document-repository
  service. Returns chronological per-event entries (`file_id`, `level`,
  `message`, `timestamp`). Admin or `dataprep-service` role required.
- **Distributed trace** — Grafana → Observability → **Traces**, search by the
  `trace_id` for that file. The `dataprep.ingest` root span fans out into
  `dataprep.chunking` and per-chunk label / embed child spans.

> **Prerequisite for the trace path.** Grafana and the trace pipeline are part
> of the optional observability profile (`ENABLE_OBSERVABILITY=1` in your
> `.env`); if disabled, use the admin UI and the ingestion-log API only. See
> [Observability overview]({{< relref "/docs/observe/overview" >}}).

### Verify it worked

After a successful upload, the admin UI status pill for the file must read
**ingested**. If it shows **ingestion error**, open the ingestion log: the
first `ERROR`-level entry is the failure reason. Most common causes are
unparseable PDFs, oversized files, or a transient LLM/vLLM outage during
labelling.

## Updating a document

There is **no in-place edit** for an ingested document. To replace content, the
canonical workflow is:

1. **Retract** the old version (see below) so its chunks, embeddings, and graph
   nodes are removed.
2. **Upload** the new version — it gets a fresh `file_id` and goes through the
   full pipeline.

This guarantees no stale chunks or labels remain from the previous version and
that ingest metric history (counts, latency) for the two versions stays cleanly
attributed to distinct `file_id`s.

## Retracting

Retraction removes everything a document contributed to the knowledge base:

- its chunks and embeddings,
- its graph nodes and edges,
- its labels (as carried by the chunks).

After retraction the document is no longer retrievable and cannot leak into
answers. The original uploaded file can also be removed from document storage.

### From the admin UI

1. Open Admin Dashboard → **Document Management** tab.
2. Click the file to open its detail dialog.
3. Click **Retract** (top-right of the dialog — visible only when status is
   `Ingested` or `Ingested with Warnings`).
4. Confirm the dialog. The flow calls `POST /api/files/retract` on the
   document-repository service.

### Via the API

```bash
curl -sk -X POST \
  "https://${<NGINX_PUBLIC_DOMAIN>}/api/files/retract" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"fileIds": ["<file_id>"]}'
```

The retract endpoint is idempotent: retracting an already-retracted file is a
no-op. The dataprep service deletes chunks by `file_id` from the
`<GRAPH>_SOURCE` collection, removes the corresponding edges in
`<GRAPH>_LINKS_TO` / `<GRAPH>_HAS_SOURCE`, and updates `dataprep.status` to
`Retracted`.

> **Retract is clean by design.** A common mistake in RAG systems is leaving
> "orphan" chunks after a delete. GENIE.AI's retract removes by `file_id`, so
> every chunk, embedding, and graph node that came from that file is removed
> together.

## Kill an in-flight ingest

If a document is stuck in `Ingesting` (or producing repeated warnings) and you
need to stop it without waiting for it to finish:

```bash
curl -sk -X POST \
  "https://${<NGINX_PUBLIC_DOMAIN>}/api/files/{file_id}/kill-ingest" \
  -H "Authorization: Bearer ${ADMIN_JWT}"
```

The dataprep worker checks the kill flag between chunks and aborts cleanly,
setting the file's `dataprep.status` to `Killed` and writing a `WARN`-level
entry to the ingestion log (`"Ingestion process killed. Starting cleanup..."`),
followed by an `INFO`-level entry (`"Cleanup complete. Document state set to Killed."`).
After a kill, the document is not retrievable and
its chunks may be partially present — retract it before re-uploading.

## Recommended cadence

- **Review failed ingestions** regularly — a silent `Ingestion Error` document
  is a gap in the knowledge base users will hit. Filter the Document Management
  table by status = `Ingestion Error` and triage each row.
- **Retract superseded content** before it contradicts newer documents. In
  particular, retract the old version of a policy/manual at the same time you
  upload the new one — never leave both versions live.
- **Periodically check the ingestion log** for repeated per-chunk fallbacks
  (fallback embedding, raw-chunk fallback) — a sign of a labelling / embedding
  quality issue affecting many documents at once. If the pattern is
  deployment-wide, check the vLLM endpoint and the embedding service health.

## Next steps

- [Ingestion]({{< relref "ingestion" >}}) — the pipeline stages, supported
  formats, and size limits.
- [Ingestion log reference]({{< relref "ingestion-log" >}}) — per-chunk log
  schema and canonical message strings.
- [Labelling & taxonomy]({{< relref "labelling-taxonomy" >}}) — what labels
  chunks get and how to curate the taxonomy that drives them.
- [Content guidance]({{< relref "content-guidance" >}}) — how to prepare
  documents so they retrieve well.