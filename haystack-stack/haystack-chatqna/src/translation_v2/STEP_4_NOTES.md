# Step 4 — PDF Ingest + Hybrid Retrieval (no generation yet)

**Date:** 2026-04-20
**Result:** 222/222 tests passing in 1.73s (Step 1: 50 + Step 2: 51 + Step 3: 66 + Step 4: 55).

## What changed

Additive. No existing source/config files edited; only new files plus appends to v2-owned modules.

| File | Status | Role |
|---|---|---|
| `flags.py` | Edited (v2, mine) | Added `V2_RAG_EMBED_URL`, `V2_RAG_EMBED_MODEL`, `V2_RAG_CHUNK_SIZE_CHARS`, `V2_RAG_CHUNK_OVERLAP_CHARS`, `V2_RAG_MIN_CHUNK_CHARS`, `V2_RAG_SCANNED_TEXT_THRESHOLD` |
| `rag/pdf_loader.py` | New | PyMuPDF-backed per-page loader; emits `PageText` with `is_scanned` flag |
| `rag/chunker.py` | New | `LayoutAwareChunker` — sliding-window with soft sentence-boundary preference; chunks never span pages; skips scanned pages |
| `rag/embedder.py` | New | `TEIEmbedder` — httpx client against text-embeddings-inference `/embed` endpoint |
| `rag/vector_store.py` | New | `VectorStore` Protocol + `InMemoryVectorStore` (numpy cosine similarity) |
| `rag/reranker.py` | New | `Reranker` Protocol + `NoOpReranker`; real reranker slots in at Step 5 |
| `rag/ingest.py` | Rewritten from stub | `IngestPipeline` orchestrator; module-level `ingest_pdf` convenience wrapper |
| `rag/retrieve.py` | Rewritten from stub | `HybridRetriever` — BM25 + dense + RRF fusion + optional reranker |
| `rag/cli.py` | New | `python -m translation_v2.rag ingest <pdf>` / `pipeline <pdf> --query "..."` |
| `rag/__main__.py` | New | dispatcher |
| `tests/conftest.py` | Appended | `make_native_pdf`, `make_scanned_pdf`, `FakeEmbedder`, `fake_embedder` fixtures |
| `tests/test_pdf_loader.py` | New | 6 tests — native extraction, scanned detection, threshold override, empty docs |
| `tests/test_chunker.py` | New | 11 tests — sizing, overlap, page boundaries, scanned-page skip, sentence-boundary preference, config validation |
| `tests/test_embedder.py` | New | 7 tests — HTTP shape, empty batch, bad response shapes, HTTP error, base URL cleanup |
| `tests/test_vector_store.py` | New | 11 tests — add, search, k limit, doc_id filter, magnitude invariance, dim mismatch, Protocol conformance |
| `tests/test_retrieve.py` | New | 13 tests — tokenizer, BM25-only, dense-only, RRF fusion, reranker pluggability, end-to-end retrieve |
| `tests/test_ingest.py` | New | 7 tests — single-page native, doc_id defaulting/override, scanned-page accounting, embedder contract, multi-PDF store sharing |
| `requirements-test.txt` | Appended | `pymupdf>=1.24,<2.0` |

## What was NOT touched

- `services/translator.py`, `tts_mandinka_fix.py`, `agent_routes.py`, `main.py`, `requirements.txt` — no edits
- `docker-compose*.yaml`, `.env`, `.env.example` — no edits
- The legacy `arcade_vector_retriever.py` — untouched; v2 has its own in-memory store
- Step 1-3 production files — untouched; Step 3's 66 tests still pass unchanged

## Design decisions

1. **PyMuPDF over pdfplumber / pypdf.** Fastest, best layout API, supports both native-text extraction and image detection via `page.get_images()`. Installed into the shared .venv (additive; `pip uninstall pymupdf` reverts). Listed in `requirements-test.txt`; production deployment will need it in the runtime image once v2 RAG ships live.

2. **Scanned detection is hint-based, not definitive.** `is_scanned = len(text.strip()) < threshold AND has_images`. This won't flag every scan (pure text-less pages without images still read as "native empty"), but it catches the common case — a whole-page image with no OCR layer. Real OCR integration is Step 4.5.

3. **Chunks never span pages.** Citation simplicity trumps cross-page context. A patient asking "what did page 3 say" can get an exact answer. Cross-page RAG is possible in theory but almost always confuses more than it helps in clinical Q&A.

4. **RRF fusion over linear score combination.** BM25 and cosine produce scores on incompatible scales; you cannot meaningfully add them. RRF sidesteps this by combining *ranks*, not scores. rrf_k=60 is the Cormack 2009 default; kept it.

5. **InMemoryVectorStore for Step 4, ArcadeDB adapter later.** The Protocol is defined now so a drop-in ArcadeDB-backed `VectorStore` can land in Step 5/6 without touching `ingest.py` / `retrieve.py`. Adapter will wrap the existing `arcade_vector_retriever.py` — same external shape, different storage.

6. **Embedder is HTTP, not library-local.** Matches the existing haystack-stack pattern of a separate TEI container. Avoids loading heavyweight transformer weights into the FastAPI process. Default URL `http://tei:80` matches `EMBEDDING_SERVER_HOST_IP=tei` from the env file.

7. **CLI is single-process only.** Both `ingest` and `pipeline` subcommands operate within one Python invocation — the in-memory store does not persist across CLI invocations. The `pipeline` subcommand ingests a PDF then queries it in one shot. Persistent indexing flows through the API wiring in Step 5.

8. **Reranker is a NoOp by default.** A real reranker (bge-reranker-v2-m3) is a meaningful quality lift but also a separate container. Shipping NoOp-first lets Step 5 treat reranker wiring as an independent change.

9. **Mandinka-aware tokenizer for BM25.** The token regex preserves the five mnk diacritics (`ŋ ñ ɛ ɔ ɲ`) so queries with native Mandinka orthography don't lose those tokens.

## Bug caught by tests (instructive)

`test_chunker.py::TestConfigValidation::test_chunk_size_positive` failed on first run. Root cause: my chunker used `chunk_size or flags.V2_RAG_CHUNK_SIZE_CHARS`, which treats `0` as falsy and silently swaps in the default, so the subsequent `<= 0` guard never triggered. Fix: explicit `if chunk_size is not None else default` for all three config knobs. This is exactly the kind of thing characterization tests catch early.

## Running the CLI

The CLI needs a live TEI container at `$V2_RAG_EMBED_URL`. From `haystack-chatqna/`:

```bash
# Ingest-only (just prints the chunking summary):
../.venv/Scripts/python.exe -m translation_v2.rag ingest /path/to/doc.pdf

# End-to-end ingest + retrieve (in-process):
../.venv/Scripts/python.exe -m translation_v2.rag pipeline /path/to/doc.pdf \
    --query "what medication was prescribed"
```

## Running tests

```bash
cd haystack-chatqna/src/translation_v2
../../../.venv/Scripts/python.exe -m pytest tests/
```

Expected: `222 passed in ~2s`.

## Rollback

```bash
rm -rf haystack-chatqna/src/translation_v2/rag/{pdf_loader,chunker,embedder,vector_store,reranker,cli,__main__}.py
# Revert rag/ingest.py and rag/retrieve.py to Step 0 NotImplementedError stubs.
rm haystack-chatqna/src/translation_v2/tests/test_{pdf_loader,chunker,embedder,vector_store,retrieve,ingest}.py
# Revert flags.py additions (remove V2_RAG_*).
# Revert conftest.py append (PDF + FakeEmbedder fixtures).
# Optionally: pip uninstall pymupdf, then remove it from requirements-test.txt.
```

Production impact: zero. Nothing outside `translation_v2/` imports anything from `rag/`, and nothing is mounted to the running app.

## Open questions status

| Q | Status |
|---|---|
| Q11 `/v2/*` URL shape | Step 3 resolved |
| Q7 Cache namespacing | Step 2 resolved |
| Q9 PII policy | Step 3 resolved (detect + optional local-route) |
| Q5 TTS UX | deferred; Step 5+ |
| Q6 Gambia GPU | deferred; non-blocking (Gemma wired-not-default) |
| Q1 Mobile Mandinka | Step 6 cutover scope |
| Q2 Wolof / Fula / Jola | Step 6+ scope |
| Q3 Native Mandinka NLP | out of scope unless tech lead says otherwise |
| Q4 Detection validation set | still needs Gambian labelers |
| Q8 Batch cap | still open; frontend work, not in Step 4 |
| Q10 Frontend retry on translate failure | still open; frontend work |
| Q12 Legacy Express translation envs | still look unused |

## Next step

**Step 5 — PDF Q&A Generation + QE Gating.**

- `rag/generate.py` — implement "Answer-then-Translate" (default) and "Cross-lingual direct" strategies. Uses v2 providers (already built in Step 3) for the answering + translation LLM calls.
- `qe.py` — implement chrF++ scoring with threshold-based retry gating. COMET-Kiwi is NOT used (not trained on mnk).
- Wire retrieval → generation → post-process → QE → optional retry end-to-end.
- New endpoint `POST /api/v2/agent/pdf-query` behind `USE_V2_RAG` flag (default OFF). Does NOT replace any v1 endpoint.
- Integration test with one real fixture PDF + a mocked provider.
- Decision to make before start: native Mandinka rerankers don't really exist — do we ship with reranker OFF (NoOp) or stand up a bge-reranker-v2-m3 container? (Default: OFF. Reranker can layer in during Step 5.5.)

Requires explicit "proceed" ack. Also time to sort the NLLB container deployment (from Step 3) — Step 5 with PII routing will exercise the real NLLB for the first time.
