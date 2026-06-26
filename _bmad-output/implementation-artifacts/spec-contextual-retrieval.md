---
title: Contextual Retrieval — dataprep contextualization (Part A)
type: feature
status: done
slug: contextual-retrieval
created: 2026-06-26
baseline_commit: f825d8fff
---

# Contextual Retrieval — Dataprep Contextualization (Part A)

## Intent

Per-chunk labeling/embedding lose document-level context → chunks miss the document's subject (cucumber case: 11/34). Add an LLM-generated document-context prefix in the dataprep, prepended to each chunk before embedding + labeling. Two strategies via `CONTEXTUAL_STRATEGY`:

- `per_chunk` (default) — one section-tailored context per chunk (the Anthropic recipe), **batched** so the document context is sent once per batch.
- `doc_level` — ONE document-level context prepended to every chunk (N× cheaper; uses a larger doc budget).

Gated by `CONTEXTUAL_RETRIEVAL_ENABLED` (default off → true no-op). Part A of the SOTA recipe; Part B (retriever BM25 hybrid + RRF) is a separate spec in `deferred-work.md`. Flags are orthogonal (A off + B on = plain lexical hybrid).

## Boundaries

**Always**
- Behind `CONTEXTUAL_RETRIEVAL_ENABLED`, default off → identical current behavior when off (no client construction, no `chunk_text` field).
- Ingestion never fails because of context generation: client-build guard + per-chunk/batch fallback + 0/N ERROR summary.
- Self-hosted vLLM only (`_build_vllm_client`, shared with the labeling hot-path).
- English ingestion; `response_format={"type":"json_object"}` (validated on `ibm-granite/granite-4.1-8b`).
- Original chunk preserved in metadata `chunk_text` (flag-gated, index-guarded).
- Vertex `text` stores the contextualized text → Part B's BM25 will index it.
- OTel spans: `dataprep.llm.context_chunk` (per-chunk fallback), `context_batch` (per_chunk batch), `context_doc` (doc_level).
- Ingestion-log progress; WARN when the document context is truncated.

**Ask First**
- Storage semantics: vertex `text` becomes `<context> + <chunk>` (generator LLM + UI reading `text` see the preamble). Confirmed acceptable — Part B relies on this contract.

**Never**
- External API dependencies; retrieval / reranker / chatqna changes (Part B); schema migration that breaks existing chunks; enable by default.

## I/O Matrix

| Scenario | Expected | Error handling |
|---|---|---|
| Flag off | identical pipeline; zero context-gen calls; no `chunk_text` field | n/a |
| `per_chunk` on | each chunk embedded+labeled with its own context; contexts produced via batched calls | n/a |
| `doc_level` on | the same document context on every chunk; 1 LLM call | n/a |
| Context-gen failure (chunk / batch / doc / client-init) | raw chunk(s); ingestion completes | WARN/ERROR log; 0/N → ERROR summary |
| Document larger than budget | document context truncated; WARN logged | n/a |
| Empty document | no-op | n/a |

## Code Map (`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`)

- Config L95-114: `CONTEXTUAL_RETRIEVAL_ENABLED`, `DATAPREP_CONTEXTUAL_MODEL`, `DATAPREP_CONTEXTUAL_DOC_BUDGET` (6000), `DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL` (30000), `CONTEXTUAL_STRATEGY`; prompt defaults; `_build_vllm_client` L196; `_log_environment_variables`.
- `_build_doc_context` L501 — budget param + truncation WARN.
- `_apply_contextualization` L530 — entry, client-build guard, strategy dispatch.
- `per_chunk`: `_contextualize_per_chunk` L575 (batched) + `_context_batch_call` L629 (batch JSON, per-chunk fallback) + `_context_single_call` L783 (3 retries).
- `doc_level`: `_contextualize_doc_level` L702 + `_context_doc_call` L722 (1 call, larger budget).
- Orchestrator L1196-1222 — contextualization → labeling; metadata `chunk_text` (flag-gated, index-guarded).
- Tests: `genie-ai-overlay/tests/test_dataprep.py` → `TestContextualRetrieval` L1446.

## Tasks

- Config flags + prompt defaults + log-env (match the `os.getenv` convention).
- `_build_vllm_client` extracted (DRY with labeling).
- `_apply_contextualization`: client-build guard + per_chunk/doc_level dispatch.
- per_chunk: `_contextualize_per_chunk` (batched) + `_context_batch_call` (batch → per-chunk fallback) + `_context_single_call`.
- doc_level: `_contextualize_doc_level` + `_context_doc_call` (1 call, `DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL`).
- Orchestrator wiring + `chunk_text` metadata (flag-gated).
- Tests: flag-off no-op; per_chunk batch happy / split / parse-failure-fallback; doc_level happy / failure; client-build guard; 0/N summary; ingest wiring (on/off).

## Acceptance Criteria

- **Given** flag off, **when** ingest, **then** identical pipeline (no client built, no `chunk_text` field).
- **Given** `per_chunk` on, **when** ingest, **then** every chunk's `page_content` begins with its context; labeling receives contextualized text; `chunk_text` retained; a `dataprep.llm.context_batch` span is emitted per batch.
- **Given** `doc_level` on, **when** ingest, **then** exactly 1 context-gen LLM call; the same context on every chunk; a `dataprep.llm.context_doc` span is emitted.
- **Given** any context-gen failure, **when** ingest, **then** chunk(s) stored raw, ingestion completes, WARN/ERROR logged; 0/N → ERROR summary.
- **Given** a document larger than the budget, **when** ingest, **then** the document context is truncated and a WARN is logged.
- **Given** client-build failure, **when** ingest, **then** raw chunks; ingestion not blocked.

## Design Notes

- Canonical Contextual Retrieval stores `<context> + <chunk>` (embedder + generator both see context). vertex `text` = contextualized; original in metadata `chunk_text`.
- **Strategy trade-off**: `per_chunk` = max quality (section-tailored, batched → fewer calls + doc_context once per batch); `doc_level` = N× cheaper (1 call, larger budget), enough to propagate the document subject. Choose `doc_level` for large / cost-sensitive docs.
- **Large docs**: `doc_level` can use a large budget (1 call within `VLLM_MAX_MODEL_LEN`). `per_chunk` uses the smaller `DATAPREP_CONTEXTUAL_DOC_BUDGET` (repeated per batch). Truncation WARN fires when exceeded. For docs beyond the model window, **Map-Reduce** (summarize in windows → combine) is the future fix — not implemented.
- Cost mitigations: per_chunk batching + vLLM prompt caching (`--enable-prefix-caching`, repeated doc prefix).
- Labeling consumes the contextualized text → fixes 11/34 even before Part B ships.

## Verification

- `cd genie-ai-overlay && ruff check .` ✓
- `cd genie-ai-overlay && ruff format --check .` ✓
- `cd genie-ai-overlay && pytest tests/test_dataprep.py tests/test_dataprep_tracing.py` → 85 pass
- `cd tests/config-validator && npm test` → 25/25

## Spec Change Log

- 2026-06-26 — Adversarial review (blind + edge-case + acceptance). Changes: client-build guard (never-block); 0/N ERROR summary; progress logging; index safety + `chunk_text` flag-gating; ASCII truncation marker; `prompt_tokens` span attr; `CHUNK:` user label; `DOC_BUDGET<=0` → no truncation. Acceptance auditor APPROVE.
- 2026-06-26 — `CONTEXTUAL_STRATEGY` flag (`per_chunk` default | `doc_level`). `doc_level` = 1 call/doc (N× cheaper), same context on every chunk, dedicated doc-level prompt + `dataprep.llm.context_doc` span.
- 2026-06-26 — `per_chunk` **batching** (`LABEL_LLM_BATCH_SIZE`; document context once per batch; `_context_batch_call` with per-chunk fallback; `dataprep.llm.context_batch` span). `doc_level` larger budget (`DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL`=30000) for large docs. `_build_doc_context` budget param + truncation WARN. Motivated by the large-doc context-size concern + yesterday's labeling-batching pattern.
- Config + docs rolled out across `env`, `docker-compose.yaml`, ansible (`env.j2` + `all.yml`), config-validator, `CLAUDE.md`, install guide, labeling-strategy §7, dataprep README, ChoosingLLMs — for every variable.
- Result: 85 tests pass (15 in `TestContextualRetrieval`); `ruff check` + `ruff format` clean; config-validator 25/25.

## Suggested Review Order

Ordered by concern (clickable). Paths relative to this spec.

1. **Pipeline wiring** — orchestrator [`:1196`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L1196), contextualization call [`:1203`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L1203), metadata `chunk_text` gate [`:1222`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L1222).
2. **Entry + strategy dispatch** — [`_apply_contextualization :530`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L530) (client-build guard + per_chunk/doc_level branch).
3. **per_chunk (batched)** — [`_contextualize_per_chunk :575`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L575), [`_context_batch_call :629`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L629), [`_context_single_call :783`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L783).
4. **doc_level** — [`_contextualize_doc_level :702`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L702), [`_context_doc_call :722`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L722).
5. **Doc context + truncation** — [`_build_doc_context :501`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L501).
6. **Shared client + config** — [`_build_vllm_client :196`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L196), flags [`:95`](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py#L95).
7. **Tests** — [`TestContextualRetrieval :1446`](../../genie-ai-overlay/tests/test_dataprep.py#L1446).
