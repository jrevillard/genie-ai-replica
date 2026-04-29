# Step 5 — PDF Q&A Generation + QE Gating

**Date:** 2026-04-20
**Result:** 293/293 tests passing in ~2s (Step 1-4: 222 + Step 5: 60 + Step 6: 11).

## What changed

Additive. Step 5-owned files only; no edits to legacy code.

| File | Status | Role |
|---|---|---|
| `flags.py` | Edited (v2) | Added `V2_RAG_DEFAULT_STRATEGY`, `V2_RAG_DEFAULT_K`, `V2_RAG_QE_THRESHOLD` |
| `post_process.py` | Rewritten from stub | `normalize_mandinka`, `strip_model_artifacts`, `clean_answer` — preserves diacritics |
| `qe.py` | Rewritten from stub | `ChrFPlusPlusQE` (reference-based) + `HeuristicQE` (reference-free, length + preserved terms + numbers) + `CompositeQE` |
| `rag/llm_generator.py` | New | `LLMGenerator` — OpenAI-compatible chat wrapper for RAG answers (distinct from `TranslationProvider`) |
| `rag/generate.py` | Rewritten from stub | `PDFQueryPipeline` + `AnswerStrategy` enum (ANSWER_THEN_TRANSLATE / CROSS_LINGUAL_DIRECT); built-in retry on QE fail for cross-lingual |
| `rag/vector_store.py` | Extended | `InMemoryVectorStore.all_chunks()` public accessor |
| `api/rag_schemas.py` | New | Pydantic models for PDF ingest + query |
| `api/rag_routes.py` | New | `POST /agent/pdf/ingest`, `POST /agent/pdf-query` — flag-gated on `USE_V2_RAG` |
| `api/bootstrap.py` | Extended | RAG singletons + test overrides (`set_pdf_query_pipeline_for_testing`, etc.) |
| `main_with_translation_v2.py` | Extended | Now mounts both `_v2_router` and `_v2_rag_router` |
| `tests/test_post_process.py` | New | 16 tests |
| `tests/test_qe.py` | New | 16 tests |
| `tests/test_llm_generator.py` | New | 5 tests |
| `tests/test_rag_generate.py` | New | 14 tests |
| `tests/test_rag_routes.py` | New | 9 tests |

## Bug caught during test run

`clean_answer("```\\nTranslation: X\\n```")` returned `"Translation: X"` because `strip_model_artifacts` stripped the leading label *before* the markdown fence — so the fence was anchored at position 0 when the label regex looked, and the label was anchored at position 0 only *after* fences were removed. Fix: swap the order so fences go first. Test `test_markdown_then_normalize` now passes. Root-caused, not silenced.

## Design decisions

1. **QE is reference-free by default.** COMET-Kiwi isn't trained on Mandinka; chrF++ needs a reference we usually don't have in live traffic. `HeuristicQE` combines length-ratio sanity (catches truncation and hallucination), preserved-terms check (medication names, places), and number preservation. `ChrFPlusPlusQE` is there for when a reference *is* available (glossary / TM hit / offline eval harness).

2. **Retry policy is asymmetric.** If CROSS_LINGUAL_DIRECT fails QE, we retry as ANSWER_THEN_TRANSLATE — the latter is the more conservative path (explicit English step → translate). If ANSWER_THEN_TRANSLATE fails QE, there's no "safer" option, so we return it flagged and let the caller decide. Retry is bounded to 1 to keep latency predictable.

3. **Citations are always returned.** Even when the answer is a refusal ("I don't know"), the citations show what the retriever saw. This lets the operator distinguish "RAG found nothing relevant" from "RAG found context but the model declined". Makes debugging 10× easier.

4. **`LLMGenerator` is separate from `TranslationProvider`.** The Protocol shapes are genuinely different — `translate(text, source, target)` vs `answer(system, user)`. Forcing one into the other would have invented an awkward adapter for no real win. Small amount of duplication; clearer boundaries.

5. **In-memory vector store is intentionally single-process.** Multi-worker uvicorn deployments will have per-worker stores — fine for Step 5 manual validation, *not* acceptable for general rollout. The ArcadeDB-backed `VectorStore` adapter (Step 5.5 or 6) uses the existing `arcade_vector_retriever.py`. Protocol stays the same.

6. **BM25 reindex on every ingest.** O(n) rebuild, not incremental. In production (ArcadeDB adapter), full-text indexing is handled by the DB. In-memory rebuild is fine for dev-sized corpora.

7. **Preserved terms default to glossary do-not-translate entries.** The bootstrap loads `data/glossary_seed.csv` and passes `terms_to_preserve()` to `HeuristicQE`, so `metformin`, `Banjul`, `benachin`, etc. automatically trigger QE penalties if they disappear from the answer.

## Deployment shape (what changes in production)

Uvicorn target change (same command that activated Step 3):

```
command: uvicorn src.main_with_translation_v2:app --host 0.0.0.0 --port 8000 --workers 4
```

Env to turn the RAG endpoints on:
```
USE_V2_RAG=true
V2_RAG_DEFAULT_STRATEGY=answer_then_translate
V2_RAG_DEFAULT_K=5
V2_RAG_QE_THRESHOLD=0.5
```

Smoke:
```bash
curl -X POST http://host/api/v2/agent/pdf/ingest \
  -H 'Content-Type: application/json' \
  -H 'X-Translation-Pipeline: v2' \
  -d '{"path": "/data/pdfs/diabetes_handout.pdf", "doc_id": "diabetes"}'

curl -X POST http://host/api/v2/agent/pdf-query \
  -H 'Content-Type: application/json' \
  -H 'X-Translation-Pipeline: v2' \
  -d '{"question": "Mennu dookuwolu be taaring?", "target": "ma", "k": 3}'
```

## Rollback

1. Revert uvicorn command → legacy continues; v2 vanishes.
2. `USE_V2_RAG=false` → endpoints 503.
3. File-level rollback leaves the rest of v2 untouched; just delete rag/generate.py, rag/llm_generator.py, qe.py, post_process.py, api/rag_routes.py, api/rag_schemas.py + their tests.

## Not in Step 5 (deliberately)

- OCR for scanned PDFs (Step 4's scanned detection still just skips them).
- bge-reranker integration (NoOp reranker is still the default; Step 5.5 can add it with zero pipeline changes).
- ArcadeDB-backed `VectorStore` adapter (Step 5.5 / 6).
- Gemini / other LLMs as alternative answer generators following AMINA's legacy approach (Step 6.5 if we need it).
