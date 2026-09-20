---
title: Ingestion Log Reference
description: Per-chunk progress log written by dataprep during ingestion — schema, endpoints, canonical message strings, and a debugging playbook.
weight: 5
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

The ingestion log is the **operator-facing diagnostic channel** for the
document ingestion pipeline. While dataprep parses, chunks, labels, and embeds a
file, it writes per-event entries to the backend ArangoDB `ingestion_log`
collection. Every entry is timestamped, has a level, and references the
`file_id` it belongs to.

This page is for **admins and operators** debugging stuck, failed, or
degraded ingestions. The companion operational recipes live in
`.claude/rules/DEBUGGING-TRACING.md`.

## What the log captures

For each file currently being processed, dataprep emits entries for:

- **Pipeline milestones** — `Ingestion task started.`, `Generated N chunks.`,
  `Chunk {i}: Final labels (N): [...].` (per-chunk), `Ingestion completed successfully.`.
- **Quality warnings** — `Chunk {i}: context generation failed after 3 attempts — using raw chunk.` (Contextual Retrieval failed for a chunk — chunk is indexed without context prefix), `Batch labeling parse failure for chunks [..]; falling back to per-chunk.` (LLM labelling batch parse failed; per-chunk retry used), `Batch labeling call failed for chunks [..] (...); falling back to per-chunk.` (LLM labelling batch call failed; per-chunk retry used).
- **Errors** — when ingestion fails, the log emits `{error_msg}. Rolling back.` at ERROR level and `dataprep.status` is set to `Ingestion Error`. The first ERROR-level entry is the failure reason.

Each entry is a single document with the schema below.

## Schema

| Field | Type | Notes |
| --- | --- | --- |
| `file_id` | string | The file the entry belongs to. **Not** `fileId`. |
| `level` | string | One of `INFO`, `WARN`, `ERROR`. |
| `stage` | string | Pipeline stage that emitted the entry. One of `System`, `Chunking`, `Labeling`, `Graph`, `Contextualization`, `Guardrail`, `Retract`. |
| `message` | string | Human-readable message. Canonical strings are listed below. |
| `timestamp` | ISO 8601 string | When the entry was written. |

## Endpoints

The log is read and written through the **document-repository** service
(`/api/files/{fileId}/ingestion-log`):

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/files/{fileId}/ingestion-log` | Admin or `dataprep-service` | Dataprep writes per-chunk entries here during ingest. |
| `GET /api/files/{fileId}/ingestion-log` | Admin or `dataprep-service` | Read all entries (paginated). Returns chronological entries. |
| `PATCH /api/files/{fileId}/status` | Admin or `dataprep-service` | Dataprep sets `dataprep.status` (`Pending`, `Ingesting`, `Ingested`, `Ingested with Warnings`, `Ingestion Error`, `Retracted`, `Killed`). |

> The `dataprep-service` role is the Keycloak service account used by the
> dataprep container. The `Admin` role is the human admin role.

## Canonical message strings

These are the messages operators learn to grep for:

| Message | Level | Meaning | Action |
| --- | --- | --- | --- |
| `Ingestion task started.` | INFO | Dataprep picked the file up; state machine started. | Watch for the next entry. |
| `Generated N chunks.` | INFO | Docling parsed the document; N chunks produced. | Cross-check `chunk_count` against expectation. |
| `Chunk {index}: Final labels ({N}): {labels_list}.` | INFO | Per-chunk labels assigned by the LLM/embedding/BM25 strategy. | Inspect array length — 0-label chunks are allowed but should not dominate. |
| `Ingestion completed successfully.` | INFO | Terminal success — the file is now retrievable. | None. |
| `Chunk {i}: context generation failed after 3 attempts — using raw chunk.` | WARN | Contextual Retrieval failed for one chunk; chunk was ingested without the LLM-generated context prefix. | Inspect Contextual Retrieval logs (`service:genieai-dataprep`); check `DATAPREP_CONTEXTUAL_MAX_TOKENS`. |
| `Doc-level context generation failed after 3 attempts — using raw chunks.` | WARN | Doc-level Contextual Retrieval failed; all chunks were ingested without an LLM-generated context prefix. | Inspect Contextual Retrieval logs (`service:genieai-dataprep`); check `DATAPREP_CONTEXTUAL_MAX_TOKENS`. |
| `vLLM client init failed ({err}); using raw chunks.` | ERROR | Contextual Retrieval disabled entirely for this file (vLLM client failed to initialize); chunks were ingested without context prefix. | Inspect vLLM health and the Contextual Retrieval init logs. |
| `Batch labeling parse failure for chunks [..]; falling back to per-chunk.` | WARN | Batch labelling parse failed; per-chunk retry used. | Check vLLM health; inspect the LLM response in the trace. |
| `Batch labeling call failed for chunks [..] (...); falling back to per-chunk.` | WARN | Batch labelling call failed (network/error); per-chunk retry used. | Check vLLM health; inspect the LLM response in the trace. |
| `{error_msg}. Rolling back.` | ERROR | Terminal failure; `dataprep.status` was set to `Ingestion Error`. | Triage per the message body (parser error, OOM, vLLM timeout, etc.). |

> **How to find a message in the admin UI.** Admin Dashboard → Document
> Management → click the file → "Ingestion log" tab. Use the level filter
> (INFO / WARN / ERROR) to narrow.

## Reading the log via ArangoDB AQL

When the admin UI is not enough (e.g. you want to grep across many files), use
AQL directly. Connect to ArangoDB with credentials from your deployment `.env`:

```bash
# ArangoDB credentials
ARANGO_URL=http://localhost:8529   # or http://arangodb:8529 inside the network
ARANGO_USER=root
ARANGO_PASSWORD=...                 # from .env
ARANGO_DB=genie-ai

# Pull all "Final labels" entries for one file
curl -sk -u "${ARANGO_USER}:${ARANGO_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "FOR d IN ingestion_log FILTER d.file_id == \"<file_id>\" AND d.message LIKE \"%Final labels%\" RETURN d.message"
  }' \
  "${ARANGO_URL}/_db/${ARANGO_DB}/_api/cursor"
```

For a deployment-wide view of failures in the last day:

```aql
FOR d IN ingestion_log
  FILTER d.level == "ERROR"
    AND d.timestamp >= DATE_ISO8601(DATE_NOW() - 86400)
  SORT d.timestamp DESC
  RETURN { file_id: d.file_id, message: d.message, timestamp: d.timestamp }
```

The debug patterns from `.claude/rules/DEBUGGING-TRACING.md` §3 use the same
`file_id` field (not `fileId`) — note the case-sensitive `file_id` spelling.

## Failure-mode playbook

Match a symptom against the canonical message strings to find the right fix:

### Symptom: file stuck in `Ingesting` for > 1 hour

1. Open the ingestion log; check whether entries are still being written.
2. If yes — the worker is alive but slow. Check dataprep container CPU/memory
   (`docker service ps genieai_dataprep-arango-service` for Swarm — in Swarm mode,
   container names are randomized; the service-style command works, while
   `docker stats` requires the exact randomized container name).
3. If no — the worker probably crashed. Restart the dataprep container; the
   file stays in `Ingesting` until the worker resumes or you kill it.

### Symptom: file ends in `Ingestion Error` with labelling parse failures

The labelling LLM returned malformed JSON. Almost always a model issue, not a
document issue. Steps:

1. Probe the live vLLM with the real `LABEL_SELECTOR_SYSTEM_PROMPT` and a real
   chunk from the file (see `.claude/rules/DEBUGGING-TRACING.md` §7 — use the
   base64 ssh pattern).
2. If the probe succeeds — check whether the file's content includes very long
   sections that may have hit `DATAPREP_CONTEXTUAL_MAX_TOKENS` (default `512`).
3. If the probe fails — the model is overloaded or misconfigured; check vLLM
   health and the model's guided-JSON support.

### Symptom: many files show batch labelling fallbacks

The primary embedding model is degraded. Steps:

1. Check the `embedding` / `tei` container logs.
2. Check the embedding service endpoint (`EMBEDDING_SERVICE_URL`) is reachable
   from `dataprep-arango-service` (the Docker service / DNS hostname; the OTel
   service.name for queries in VictoriaLogs is `genieai-dataprep`).
3. If `tei` is OOM-killed, scale down concurrency (`VLLM_MAX_NUM_SEQS`) or
   upgrade the embedding model.

### Symptom: file in `Ingested with Warnings`

Ingestion succeeded but at least one chunk used a fallback. The document IS
retrievable, but quality may be reduced. Open the ingestion log, count
warnings per chunk, and decide whether to retract + re-upload.

## Correlating with traces

Every chunk operation lives under a single trace. To find the trace for a file:

1. The ingestion log entry schema does NOT include a `trace_id` field. To find the
   trace for a file, use the file_id as a search key — dataprep emits a span
   attribute `dataprep.file_id` on every span.
2. In Grafana → Observability → **Traces**, search for spans with attribute
   `dataprep.file_id=<file_id>` to retrieve the trace.
3. The trace shows `dataprep.ingest` (root) → `dataprep.chunking` → per-chunk
   `dataprep.llm.label_chunk` (or `label_batch`) → embed spans.

See `.claude/rules/DEBUGGING-TRACING.md` §1 for the exact Jaeger/VictoriaTraces
query and the field-name gotchas (`startTime` not `timestamp`, `duration` in
microseconds).

## Ingestion log vs `dataprep.status`

These two are related but distinct:

- **`dataprep.status`** is per-document and tracks the file's state in the
  state machine (`Pending` / `Ingesting` / `Ingested` / …). See
  [Document lifecycle]({{< relref "document-lifecycle" >}}).
- **ingestion_log** is per-event and tracks every milestone inside one
  document's ingest. A document can be in `Ingested` state with zero log
  entries (rare — ingest never even started) or many log entries (normal —
  per-chunk + warnings).

If a state says `Ingested` but the log is empty, dataprep never wrote to the
log — check the dataprep container logs (`service:genieai-dataprep` in
VictoriaLogs).

## Next steps

- [Document lifecycle]({{< relref "document-lifecycle" >}}) — the state machine,
  the admin UI walkthrough, and the retract/kill endpoints.
- [Ingestion]({{< relref "ingestion" >}}) — the pipeline stages and failure
  semantics.
- [Labelling & taxonomy]({{< relref "labelling-taxonomy" >}}) — what labels
  are and how to curate the taxonomy.
- [Troubleshooting]({{< relref "/docs/operate/troubleshooting" >}}) —
  broader operational recipes (services down, ArangoDB issues, etc.).