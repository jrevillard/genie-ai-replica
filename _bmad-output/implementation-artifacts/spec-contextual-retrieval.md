---
title: Per-chunk Contextual Retrieval — dataprep contextualization
type: feature
status: done
slug: contextual-retrieval
created: 2026-06-26
baseline_commit: f825d8fff
---

# Per-chunk Contextual Retrieval — Dataprep Contextualization (A)

## Intent

Per-chunk labeling and embedding lose document-level context. A chunk about a generic technique (e.g. irrigation) inside a cucumber cultivation guide is embedded and labeled without knowing it belongs to cucumber, so both vector and label-filtered retrieval miss roughly two thirds of a document's chunks (cucumber case: 11/34). Recurs for every document across all topics.

Add an LLM-generated, per-chunk document-context prefix (Anthropic "Contextual Retrieval") in the dataprep. The contextualized text `<context> + <chunk>` is used for **both embedding and labeling**, and stored in the chunk vertex `text` field. Gated by a feature flag, default off. This is part A of the SOTA recipe; part B (retriever BM25 hybrid + RRF fusion over the same `text` field) is a separate spec tracked in `deferred-work.md`.

## Boundaries

**Always**
- Behind `CONTEXTUAL_RETRIEVAL_ENABLED` flag, default off → identical current behavior when off.
- Ingestion never fails because of context generation: on any LLM error/timeout for a chunk, fall back to the raw chunk and continue.
- Self-hosted vLLM only (reuse `VLLM_ENDPOINT`/`VLLM_API_KEY`/`VLLM_MODEL_ID`). No external API.
- Ingestion corpus is English.
- Preserve original chunk text in chunk metadata (`chunk_text`) for display/debug.
- Emit OTel spans (`dataprep.llm.context_chunk`, `context_batch` if batched) and ingestion-log progress, mirroring labeling instrumentation.
- Store the contextualized text in vertex field `text` (the field ArangoGraph writes from `page_content` and that part B's BM25 will index).

**Ask First**
- Storage semantics: `page_content`/vertex `text` becomes `<context> + <chunk>`, so the generator LLM (and any UI reading `text`) will see the context preamble. Confirm acceptable; otherwise switch to embed-contextualized / store-original (pre-embedding) design — but note this breaks part B's "contextual BM25".

**Never**
- External API dependencies.
- Retriever / reranker / chatqna code changes (part B).
- Schema migration that breaks already-ingested chunks.
- Enabling by default.

## I/O Matrix

| Scenario | Input / state | Expected | Error handling |
|---|---|---|---|
| Happy path | flag on, N-chunk document | each chunk embedded and labeled against `<context> + <chunk>`; vertex `text` = contextualized; original in metadata | n/a |
| Flag off | flag off | identical to current pipeline; zero context-gen LLM calls | n/a |
| Context-gen LLM failure | LLM errors or times out for a chunk | that chunk embedded/labeled as raw text; ingestion completes | WARN log; continue, never block |
| Empty document | 0 chunks | no-op | n/a |
| Large document | many chunks | bounded by existing concurrency + batching | n/a |

## Code Map

- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — only change site.
  - Config flags near the existing `os.getenv` block (~line 87) + log in `_log_environment_variables` (~134).
  - New `_generate_chunk_contexts()` (reuse the local `AsyncOpenAI` construction from `_label_with_llm`, 358-362).
  - Wire into `ingest_file_with_guardrail` between chunking (756) and labeling (770): when flag on, contextualize; pass contextualized text to `_apply_labels` (labeling) and to `Document.page_content` (779, → embedding + vertex `text`); keep original in metadata `chunk_text`.
- `genie-ai-overlay/tests/test_dataprep.py` — new test class mirroring `TestLabelWithLlm`.
- `genie-ai-overlay/tests/conftest.py` — no change (already mocks `comps`, `AsyncOpenAI`, arango, langchain).

## Tasks

- `genieai_dataprep_arangodb.py` — add config: `CONTEXTUAL_RETRIEVAL_ENABLED` (default false), `DATAPREP_CONTEXTUAL_MODEL` (default = `VLLM_MODEL_ID`), `CONTEXTUAL_RETRIEVAL_PROMPT` (built-in default, env-overridable, following the `LABEL_SELECTOR_SYSTEM_PROMPT` pattern). Log them.
- `genieai_dataprep_arangodb.py` — add `_generate_chunk_contexts(chunks, input, file_id)`: batched + concurrency-bounded (reuse `MAX_CONCURRENT_BATCHES` + `LABEL_LLM_BATCH_SIZE`), OTel span per call, returns contextualized text per chunk; per-chunk failure → raw chunk + WARN ingestion-log.
- `genieai_dataprep_arangodb.py` — integrate after chunking, before labeling (flag on): feed contextualized text to `_apply_labels` and to `Document.page_content`; store original in metadata `chunk_text`. Flag off → unchanged.
- `genie-ai-overlay/tests/test_dataprep.py` — TDD: flag-off no-op; happy-path prefix reaches embed + label inputs, original retained in metadata; LLM-failure fallback; batching/concurrency; span emission.

## Acceptance Criteria

- **Given** `CONTEXTUAL_RETRIEVAL_ENABLED=false`, **when** a document is ingested, **then** the pipeline is identical to today (the context-generation `AsyncOpenAI` client is never constructed/called).
- **Given** the flag is on, **when** an N-chunk document is ingested, **then** every chunk's `page_content` passed to `embeddings.embed_query` begins with its generated context; `_apply_labels` receives the contextualized text; the stored vertex `text` is contextualized; and metadata retains the original `chunk_text`.
- **Given** the flag is on and the context LLM raises for a chunk, **when** the document is ingested, **then** that chunk is embedded/labeled as raw text, ingestion completes, and a WARN is written to the ingestion log.
- **Given** the flag is on, **when** a document is ingested, **then** a `dataprep.llm.context_chunk` OTel span is emitted per chunk (or `context_batch` per batched call).

## Design Notes

- Canonical Contextual Retrieval stores `<context> + <chunk>` as the indexed text so both embedder and generator see context. Here `page_content`/vertex `text` = contextualized; original kept in metadata `chunk_text`. This storage contract is what part B (BM25 over `text`) relies on — do not change it without coordinating B.
- Context-gen input: filename + `file_labels` + token-budgeted join of document chunks + the specific chunk → ~50-100 word context. Batch chunks/call (reuse labeling batch size); concurrency via existing semaphore.
- Cost: per-chunk LLM call (the "most promising, complexity-ignored" variant). Mitigations: batching + vLLM prompt caching (`--enable-prefix-caching`, repeated doc prefix). Flag default-off → no regression. Cheaper doc-level (1 call/file) alternative in the research report if cost blocks.
- Labeling consumes the contextualized text → fixes the 11/34 doc-subject gap even before part B ships.

## Verification

- `cd genie-ai-overlay && ruff check .`
- `cd genie-ai-overlay && pytest tests/test_dataprep.py -k context`
- `cd genie-ai-overlay && pytest tests/test_dataprep.py`

## Spec Change Log

- 2026-06-26 — Adversarial review (blind hunter + edge-case hunter + acceptance auditor). Blind + edge returned REQUEST CHANGES; acceptance auditor APPROVE. Review-driven changes implemented:
  - **Never-block guarantee (HIGH)**: `_apply_contextualization` wraps `_build_vllm_client()` in try/except → on init failure logs ERROR + returns raw chunks (ingestion proceeds). Regression test added.
  - **Silent-degradation guard (MED)**: if 0/N contexts generated, emit one ERROR-level log + ingestion_log entry (a misconfigured `DATAPREP_CONTEXTUAL_MODEL` that rejects guided JSON is now visible). Regression test added.
  - **Progress logging (MED)**: log contextualization progress every 50 chunks + final count.
  - **Index safety + true no-op (MED)**: `metadata["chunk_text"]` write guarded by `i < len(original_chunks)`; field gated to flag-on only → flag-off writes no schema field (true no-op).
  - **Cheap**: ASCII truncation marker; `dataprep.llm.prompt_tokens` span attr; `CHUNK:` user-message label; `DOC_BUDGET<=0` → no truncation.
- Deferred (non-blocking): per-chunk call batching (cost optimization); separate concurrency limit for context-gen; single shared client across contextualization + labeling; `return_exceptions=True` on gather. Captured in `deferred-work.md` where relevant.
- Result: 81/81 tests pass (11 in `TestContextualRetrieval`), `ruff check` + `ruff format` clean.

## Suggested Review Order

Ordered by concern (clickable links). Paths relative to this spec file.

1. **Design intent / pipeline wiring** — [`genieai_dataprep_arangodb.py:977`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L977) (orchestrator: contextualization → labeling step), [`:984`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L984) (the contextualization call), [`:1003`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L1003) (`metadata.chunk_text` — flag-gated, index-guarded).
2. **Core: context generation** — [`_apply_contextualization :482`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L482), [`_context_single_call :564`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L564) (per-chunk LLM, 3 retries, OTel span).
3. **Resilience (never-block boundary)** — client-build guard [`:496`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L496); silent-degradation (0/N) guard [`:545`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L545).
4. **Shared client (DRY refactor of the labeling hot-path)** — [`_build_vllm_client :157`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L157).
5. **Config + prompt** — flags [`:95`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L95), prompt default [`:133`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L133).
6. **Tests** — [`TestContextualRetrieval :1446`](../../genie-ai-overlay/tests/test_dataprep.py#L1446).


