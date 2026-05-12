# Ingestion lifecycle with agricultural taxonomy

## End-to-end steps

1. **Upload** (`POST /api/files/upload`) — file stored, metadata row in `files` with `dataprep.status: Pending`.
2. **Ingest** (`POST /api/files/:fileId/ingest`) — document-repository posts to dataprep `ingest_file`.
3. **Dataprep** (background task):
   - **Extract** — Docling or standard loader → raw `str` or `list` (HTML).
   - **Taxonomy** (if `AGRI_TAXONOMY_ENABLED`) — build context text → vLLM JSON → validate with Pydantic → **normalize** (Lesotho/South Africa policy, synonyms) → **PATCH** `ingestion-metadata` on document-repository.
   - **Chunk** — same raw content as extract, split with `RecursiveCharacterTextSplitter` / HTML splitter.
   - **Guardrail** — optional per-chunk HTTP check.
   - **Labels** — existing service-category labeling (LLM / embedding / BM25).
   - **Graph** — `ArangoGraph.add_graph_documents` with chunk metadata including `tax_*` fields.
4. **Status** — `PATCH /api/files/:id/status` → `Ingested`, `chunk_count` set.

## Metadata-only reprocessing

- **Admin UI / API:** `POST /api/files/:fileId/reextract-taxonomy` — re-sends file to dataprep `reextract_taxonomy`; updates **files** collection only.
- **Chunks:** Unchanged until a **full retract + ingest** rebuilds graph vectors with new inherited metadata.

## Environment variables

See **Section 14** in the root `env` template (`AGRI_TAXONOMY_*`).
