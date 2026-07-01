---
title: Document Lifecycle
description: Upload, processing states, updating, and retracting documents in the GENIE.AI knowledge base.
weight: 2
---

Every document in the knowledge base has a lifecycle: it is uploaded, processed,
made retrievable, and eventually updated or removed. Each document is tracked by
a stable `file_id`, so its status, chunks, and graph footprint are all addressable.

## States

A document moves through these states (recorded as `dataprep.status`):

| State | Meaning |
|---|---|
| _uploaded_ | File received and virus-scanned; stored on disk. Not yet searchable. |
| _processing_ | Dataprep is parsing, chunking, labelling, and embedding. |
| _completed_ | All chunks indexed; the document is retrievable. |
| _failed_ | Processing failed; the document is **not** searchable. Check the ingestion log for the reason. |

Only documents in the **completed** state contribute to answers. A document
stuck in _processing_ or in _failed_ is invisible to retrieval.

## Uploading

Upload a file through the application UI or the backend `/api/files` endpoint.
The upload is accepted, virus-scanned, and stored first; processing then starts
asynchronously. You do not need to wait for processing to finish before the
upload call returns — but the document is not searchable until processing
completes.

See [Ingestion]({{< relref "ingestion" >}}) for formats and limits.

## Monitoring processing

Watch a document's progress via:

- the **admin UI** (per-file status and ingestion log), or
- the backend ingestion-log endpoint, or
- the **distributed trace** for that file_id in Grafana (see
  [Observability]({{< relref "/docs/observability" >}})).

The ingestion log records per-chunk milestones (labels assigned, embed outcomes,
fallbacks), which is the fastest way to diagnose a slow or failed ingestion.

## Updating a document

To replace a document, **retract the old version and upload the new one**. There
is no in-place edit: the safest, cleanest update is a retract + re-upload, which
guarantees no stale chunks or labels remain from the previous version.

## Retracting

Retraction removes everything a document contributed to the knowledge base:

- its chunks and embeddings,
- its graph nodes and edges,
- its labels (as carried by the chunks).

Use retraction when content is outdated, superseded, or was uploaded in error.
After retraction the document is no longer retrievable and cannot leak into
answers. The original uploaded file can also be removed from document storage.

> **Retract is clean by design.** A common mistake in RAG systems is leaving
> "orphan" chunks after a delete. GENIE.AI's retract removes by `file_id`, so
> every chunk, embedding, and graph node that came from that file is removed
> together.

## Recommended cadence

- **Review failed ingestions** regularly — a silent _failed_ document is a gap in
  the knowledge base users will hit.
- **Retract superseded content** before it contradicts newer documents.
- **Periodically check the ingestion log** for repeated per-chunk fallbacks (a
  sign of a labelling or embedding quality issue across many documents).
