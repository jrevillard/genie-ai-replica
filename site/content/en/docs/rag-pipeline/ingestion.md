---
title: "Ingestion and chunking strategies"
description: "How GENIE.AI turns an uploaded document into searchable, contextualised, labelled chunks — chunk sizing, Contextual Retrieval strategies, and the decoupled-labelling mode."
weight: 1
aliases:
  - /docs/rag/ingestion/
mode: explanation
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-20
---

Ingestion is **step 0 of the RAG pipeline**. It runs before the embedding model
sees anything, before the retriever ever queries ArangoDB, and before any
context prefix is generated. Its job is to turn an uploaded file into a list
of well-sized, well-labelled chunks whose vectors (computed downstream by the
embedding model) will actually match what users ask.

This page consolidates the **RAG-specific side** of ingestion: how the
chunker sizes chunks per format, how the Contextual Retrieval prefix is
generated (per-chunk vs doc-level), and how the decoupled-labelling mode
keeps the labeler honest. For the **operator side** — supported formats,
file-size limits, ClamAV scanning, the file lifecycle states — see
[Knowledge base → Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}}).

## Overview

The dataprep service
(`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`) runs the full
ingestion sequence inside the cluster. For each uploaded file it does, in
order:

```
1. Parse         — docling (PDF/DOCX/PPTX/XLSX/HTML/TXT/MD) extracts text + structure
2. Chunk         — split into retrieval-sized chunks (per format: see table below)
3. Context prefix — (if enabled) prepend an LLM-generated doc-context to each chunk
4. Label         — each chunk labelled against the service taxonomy
5. Embed         — vectorise each chunk (uses the contextualised text)
6. Store         — chunks + embeddings + labels + graph nodes → ArangoDB
```

Steps 1–2 are deterministic and fast. Steps 3–5 make **LLM calls** (one per
chunk of context, one per batch of labels, one per chunk for embedding); this
is where the bulk of ingest wall-time goes.

For the full **operator-side** flow (upload → antivirus → status states →
where the ingestion log lives), see
[Knowledge base → Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}}).
For the per-chunk LLM-detail (which span is emitted where, how to read a
trace), see [Observability → Debugging]({{< relref "/docs/operate" >}}).

## Chunking

### How chunking works

The chunker is
[`RecursiveCharacterTextSplitter`](https://python.langchain.com/docs/modules/data_connection/document_transformers/recursive_text_splitter)
from `langchain_text_splitters` (the `_load_and_chunk` method at
`genieai_dataprep_arangodb.py:438`). It splits text recursively on a list of
separators (paragraph, sentence, word — falling back gracefully) so a chunk
rarely cuts a sentence in half. The chunker honours two knobs, both sourced
from `DocPath` and ultimately from the per-format env vars:

| Knob | Default | Effect |
|---|---|---|
| `chunk_size` | per-format (see below) | Target chunk size in characters |
| `chunk_overlap` | `50` (env `DATAPREP_CHUNK_OVERLAP`) | Characters of overlap between consecutive chunks — gives the retriever a sliding window instead of hard cuts |

HTML is the only exception: it is split on **header structure** first
(`HTMLHeaderTextSplitter(headers_to_split_on=[("h1", "H1"), ("h2", "H2")])`),
then the resulting sections are sized against the same chunk-size knob.

### Default chunk size per format

The microservice
(`genieai_dataprep_microservice.py:get_chunk_size_for_file`, line 81) picks a
chunk size based on the file extension. If no per-format override is set, it
falls back to the global `DATAPREP_CHUNK_SIZE` (default `500`).

| Format | Env var | Compose default | Rationale |
|---|---|---|---|
| PDF | `DATAPREP_CHUNK_SIZE_PDF` | `500` | Docling outputs structured text — small chunks keep tables atomic |
| DOCX | `DATAPREP_CHUNK_SIZE_DOCX` | `1000` | Headings + paragraphs; larger chunks preserve section context |
| XLSX | `DATAPREP_CHUNK_SIZE_XLSX` | `1500` | Tables; **1500+ recommended** so a row rarely splits |
| PPTX | `DATAPREP_CHUNK_SIZE_PPTX` | `500` | Slide bullets are short; 500 captures one slide cleanly |
| HTML | `DATAPREP_CHUNK_SIZE_HTML` | `500` | Header-aware splitting first, then sized |
| TXT | `DATAPREP_CHUNK_SIZE_TXT` | `500` | Plain text; conservative default |
| Markdown | `DATAPREP_CHUNK_SIZE_MD` | `500` | Plain text + headings; 500 works for most guides |
| Fallback | `DATAPREP_CHUNK_SIZE` | `500` | Any other extension |

The compose runtime defaults are set in `docker-compose.yaml:1156-1162`; the
`env` template and `install-guide.md` document the same values. The canonical
installation reference (per-format table + type) is
[Install guide → Dataprep]({{< relref "/docs/deploy/install-guide" >}}#dataprep).

### When to override the defaults

- **Tables splitting across chunks** (XLSX, PDF tables) → raise
  `DATAPREP_CHUNK_SIZE_XLSX` / `DATAPREP_CHUNK_SIZE_PDF` so a row fits whole.
  The retriever cannot reconstruct a half-row from two chunks.
- **Generic guide PDFs where you lose the subject** → lower `DATAPREP_CHUNK_SIZE_PDF`
  (e.g. `300`). Smaller chunks + Contextual Retrieval propagates subject more
  precisely; larger chunks + doc-level context is cheaper but coarser.
- **Massive XML / JSON exports** that arrive as `.txt` → split on JSON
  structure upstream; raise `DATAPREP_CHUNK_SIZE_TXT` only if the JSON
  documents are themselves large.
- **Overlap too tight** (chunks lose cross-boundary context) → raise
  `DATAPREP_CHUNK_OVERLAP` from `50` toward `100-150`. Going higher
  increases embedding cost (each chunk now contains more duplicate text) — the
  tradeoff is usually not worth it past `200`.

After changing any chunk-size knob, **re-ingest** the corpus — chunking runs
once at ingest time and the values are baked into the stored chunk text. See
[Knowledge base → Document lifecycle]({{< relref "/docs/knowledge-base/document-lifecycle" >}})
for the retract-and-re-ingest flow.

## Contextual Retrieval strategies

Standard retrieval embeds each chunk in isolation. A chunk removed from its
section is hard to match: a paragraph about "renewing it" will not retrieve
well for a query about "permit renewal" because the chunk alone does not say
what "it" is. **Contextual Retrieval** (Anthropic-style) fixes this by
prepending a short, LLM-generated document-context prefix to each chunk
**before** embedding (and, depending on `CONTEXTUAL_LABEL_RAW`, before
labelling).

This is **on by default** (`CONTEXTUAL_RETRIEVAL_ENABLED=true`). It is an
**ingest-time** operation — one extra LLM call per chunk (or per document) at
ingestion, and zero at query time. It never blocks ingestion: if context
generation fails for a chunk, the raw chunk is embedded as a fallback (and an
error is written to the ingestion log).

The two strategies differ only in **how many LLM calls** the context
generation makes per document.

### `per_chunk` — the Anthropic recipe

- **How many calls**: **N calls per document** (one per chunk), batched by
  `DATAPREP_LLM_LABEL_BATCH_SIZE` (default `4`) and concurrency-bounded by
  `DATAPREP_MAX_CONCURRENT_BATCHES` (default `20`).
- **Result**: each chunk gets a context **tailored to its own section**.
- **Quality**: highest. The context reflects the immediate section (the
  heading, the table that follows, the footnote), so a chunk about "the
  renewal form" is prefixed with "Section 4.2: Permit renewal — applies to
  foreign residents".
- **Cost**: highest. N calls per doc × token cost.
- **Best when**: retrieval precision on individual chunks matters more than
  ingest cost. Small/medium corpora, or where the corpus has many
  section-specific terms that a doc-level summary would flatten.

### `doc_level` — one call per document

- **How many calls**: **1 call per document**. The single generated context
  is prepended to **every** chunk.
- **Result**: every chunk in the document carries the **same** subject
  preamble (e.g. "This is a permitting guide for foreign residents in
  Region X").
- **Quality**: lower than `per_chunk` because the prefix cannot reflect
  per-section nuance, but still high enough to fix the classic
  "isolated-chunk" loss — generic chunks become retrievable by the
  document's subject.
- **Cost**: N× cheaper than `per_chunk`. The natural choice for large
  corpora where ingest cost dominates.
- **Best when**: cost matters, the corpus is large, or you are scaling to
  10k+ documents and the per-chunk LLM spend is the bottleneck.

### Which is the actual default?

This is the one piece of the configuration that has **two contradictory
defaults** depending on where you look — preserve that nuance when
configuring:

- **Code default** (`genieai_dataprep_arangodb.py:112`):
  `CONTEXTUAL_STRATEGY = "per_chunk"`.
- **`env` template comment** (line 224): documents `per_chunk` as the
  expected default.
- **docker-compose runtime default** (`docker-compose.yaml:1170`):
  `CONTEXTUAL_STRATEGY=${CONTEXTUAL_STRATEGY:-doc_level}`. This is what the
  **deployed service actually sees** if you do not override the env var.

In practice, a fresh `docker compose up` deploys with `doc_level`; a
deployer who follows the `env` comments without also reading the compose
file ends up with `per_chunk`. Choose explicitly and verify with
[§ Verification](#verification).

For the developer-side discussion of resilience (the silent-degradation
guard that fires when the model returns no contexts), model requirements
(guided JSON), and the `MAX_CONCURRENT_BATCHES` / `LABEL_LLM_BATCH_SIZE`
knobs, see [Contextual Retrieval]({{< relref "contextual-retrieval" >}}).

## Decoupled labelling (`CONTEXTUAL_LABEL_RAW=true`)

A subtler decision: when the context prefix is generated, **what does the
labeller see**? The default (`CONTEXTUAL_LABEL_RAW=true`) decouples the
two:

- **Labelling** runs on the **raw chunk**. The labeler sees the chunk as a
  user would read it, with no prefix to confuse the category match.
- **Embedding** runs on the **contextualised chunk** (raw + prefix). The
  vector carries the document's subject.

The decoupled mode was validated empirically. Feeding the generated context
to the labeler distorts it: broad doc-level context **over-labels**
(~×3.6 labels per chunk); focused per-chunk context **under-labels** (many
empty label sets, ~24% in the corpus we tested). Labelling the raw chunk
restores label precision (~2.3 labels/chunk) while the embedding still
carries the subject.

If you want the labeler to see the context too (e.g. for a corpus where the
labels are themselves very abstract), set `CONTEXTUAL_LABEL_RAW=false`. For
the full labelling-side discussion (batch sizing, sampling temperature,
`file_labels` scoping), see [Data labelling strategy]({{< relref "data-labeling" >}}).

## Configuration matrix

All knobs live in the `dataprep` service environment block. The compose file
seeds the runtime defaults shown below; the `env` template documents the
same values as commented-out examples.

### Chunk sizing

| Variable | Default | Effect |
|---|---|---|
| `DATAPREP_CHUNK_SIZE` | `500` | Fallback chunk size (chars) when no per-format override matches. |
| `DATAPREP_CHUNK_SIZE_PDF` | `500` | PDF chunk size. |
| `DATAPREP_CHUNK_SIZE_DOCX` | `1000` | DOCX chunk size (1000+ recommended). |
| `DATAPREP_CHUNK_SIZE_XLSX` | `1500` | XLSX chunk size (1500+ recommended to avoid splitting rows). |
| `DATAPREP_CHUNK_SIZE_PPTX` | `500` | PPTX chunk size. |
| `DATAPREP_CHUNK_SIZE_HTML` | `500` | HTML chunk size (header-aware splitting first). |
| `DATAPREP_CHUNK_SIZE_TXT` | `500` | Plain-text chunk size. |
| `DATAPREP_CHUNK_SIZE_MD` | `500` | Markdown chunk size. |
| `DATAPREP_CHUNK_OVERLAP` | `50` | Overlap between consecutive chunks (chars). |

### Contextual Retrieval

| Variable | Default (compose) | Default (code/env template) | Effect |
|---|---|---|---|
| `CONTEXTUAL_RETRIEVAL_ENABLED` | `true` | `true` | Master switch. `false` skips context generation entirely (a no-op — chunks are embedded and labelled raw). |
| `CONTEXTUAL_STRATEGY` | `doc_level` | `per_chunk` | `per_chunk` = N LLM calls/doc, section-tailored context. `doc_level` = 1 call/doc, same context on every chunk. See the [§ Which is the actual default?](#which-is-the-actual-default) caveat. |
| `DATAPREP_CONTEXTUAL_MODEL` | _(empty)_ | _(empty)_ | Model for context generation. Empty = reuse `VLLM_LLM_MODEL_ID`. Must support guided JSON. |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | `6000` | `100000` | Max chars of doc text fed to the context LLM under `per_chunk` (it is called N times, so the window is small). |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL` | `100000` | `100000` | Max chars of doc text fed to the context LLM under `doc_level` (1 call, larger window). |
| `DATAPREP_CONTEXTUAL_MAX_TOKENS` | `512` | `512` | Max OUTPUT tokens of generated context. The model writes ~196 tokens; the legacy cap of 200 truncated the JSON under load — `512` gives comfortable margin. |
| `CONTEXTUAL_LABEL_RAW` | `true` | `true` | Decoupled labelling. `true` (default) = label the raw chunk, embed the contextualised chunk. |
| `CONTEXTUAL_RETRIEVAL_PROMPT` | _(empty)_ | _(empty)_ | Per-chunk context-generation system prompt override. Empty = built-in default (uses `{document_context}` placeholder). |

## Decision tree

**Your chunks are landing well, retrieval precision is fine.**

- Leave everything at the defaults. Re-validate after any change to the
  corpus or the taxonomy.

**Retrieval is too imprecise — generic chunks don't match their subject.**

- Lower `DATAPREP_CHUNK_SIZE_PDF` / `DATAPREP_CHUNK_SIZE_DOCX` (more,
  smaller chunks). The Contextual prefix has more granularity to work with.
- If you are on `doc_level`, switch to `per_chunk` for higher precision
  (at higher ingest cost).
- Make sure `CONTEXTUAL_RETRIEVAL_ENABLED=true` and `CONTEXTUAL_LABEL_RAW=true`.

**Ingest is too slow / GPU cost too high.**

- Switch `CONTEXTUAL_STRATEGY=doc_level` (1 call/doc instead of N).
- Keep `CONTEXTUAL_LABEL_RAW=true` (the label cost is unchanged; only the
  context-generation path is cheaper).
- Raise `DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL` (already `100000`) only
  if you have docs longer than that limit being truncated — see the WARN
  in the dataprep log.

**Tables split across chunks in XLSX / PDF tables.**

- Raise `DATAPREP_CHUNK_SIZE_XLSX` (default `1500`) toward `2000-3000`.
- For PDF tables specifically, also raise `DATAPREP_CHUNK_SIZE_PDF` and
  lower `DATAPREP_CHUNK_OVERLAP` slightly so a row rarely straddles two
  chunks.

**You have no GPU / no vLLM available at all.**

- Set `CONTEXTUAL_RETRIEVAL_ENABLED=false`. Everything else keeps working:
  chunks are embedded and labelled without the context prefix. The
  ingestion wall-time drops sharply; retrieval precision drops on generic
  chunks that lack a document subject.

**You have a very small corpus and can afford to be slow.**

- Switch `CONTEXTUAL_STRATEGY=per_chunk` (overriding the compose default of
  `doc_level`). You get the most precise retrievals at the cost of one
  context-generation call per chunk.

## Verification

After a fresh deploy, confirm the context prefix is actually being generated
rather than silently falling back to raw chunks.

### Inspect a chunk in ArangoDB

When Contextual Retrieval is enabled and `CONTEXTUAL_LABEL_RAW=true`, each
chunk is stored with **two** text fields:

- `text` — the **contextualised** chunk used for embedding and shown in
  citations.
- `chunk_text` — the **raw** chunk (original, no prefix). Present only when
  Contextual Retrieval is enabled.

```bash
docker exec $(docker ps --format '{{.Names}}' | grep arango-vector-db | head -1) \
  arangosh --server.endpoint tcp://localhost:8529 \
  --server.authentication true \
  --server.username root --server.password "$ARANGO_PASSWORD" \
  --javascript.execute-string 'db._query("FOR d IN chunks FILTER d.file_id==\"<file_id>\" LIMIT 1 RETURN {text: d.text, chunk_text: d.chunk_text, labels: d.labels}").toArray()'
```

Expected when Contextual Retrieval is on:

- `text` starts with a short prose prefix that names the document subject.
- `chunk_text` is present and shorter than `text`.
- `labels` was generated against `chunk_text` (decoupled mode).

A **missing `chunk_text`** indicates either `CONTEXTUAL_LABEL_RAW=false` or
a disabled context pipeline. A `text` that equals `chunk_text` indicates
context generation silently failed for that chunk — see the dataprep log
for the file_id.

### Inspect the contextualization stage in VictoriaLogs

The dataprep service emits structured logs to VictoriaLogs (service
`genieai-dataprep`) for every batch. Search for:

```text
service:genieai-dataprep AND message:"Contextual Retrieval*"
```

You should see one of:

- `Contextual Retrieval (per_chunk): N chunks (batch_size=4, concurrency=20, model=...)`
- `Contextual Retrieval (doc_level): 1 call for N chunks (model=...)`

A **silent-degradation guard** fires when the model returns zero contexts
across the whole document:

```text
ERROR Contextual Retrieval produced 0/N contexts for <file_id> — likely
<model> does not support guided JSON or is unreachable. Check
DATAPREP_CONTEXTUAL_MODEL / VLLM_ENDPOINT.
```

If you see this, the file was indexed with **raw** chunks (no prefix) — the
ingestion log will also carry a `"0/N contexts generated"` warning. Fix the
model and re-ingest.

For the span-level view (`dataprep.llm.context_batch` and
`dataprep.llm.context_doc` spans on the `file_id` trace), see
[Observability → Debugging with tracing]({{< relref "/docs/operate" >}}).

## Related

- [Knowledge base → Ingestion]({{< relref "/docs/knowledge-base/ingestion" >}})
  — operator-side flow: supported formats, file-size limits, ClamAV, file
  lifecycle states, ingestion log.
- [Contextual Retrieval]({{< relref "contextual-retrieval" >}}) —
  developer-side deep dive: span taxonomy, silent-degradation guard, model
  requirements, batching and concurrency knobs.
- [Data labelling strategy]({{< relref "data-labeling" >}}) — how labels
  are generated, the `file_labels` document-scope constraint, and the
  labelling failure modes.
- [Install guide → Dataprep]({{< relref "/docs/deploy/install-guide" >}}#dataprep)
  — the canonical per-format chunk-size table and full env-var reference.
- [Pipeline architecture]({{< relref "pipeline" >}}) — the query-side RAG
  pipeline (embedding → retrieval → reranking → generation) that consumes
  the chunks ingestion produces.
- [Knowledge base → Document lifecycle]({{< relref "/docs/knowledge-base/document-lifecycle" >}})
  — retract-and-re-ingest flow when chunking knobs change.
