# AMINA Translation Refactor — Migration Complete

**Target language:** English → Mandinka (mnk_Latn)
**Migration start:** 2026-04-20 (inventory)
**All 7 steps code-complete:** 2026-04-20
**Final result:** 308/308 tests green in 2.21 s

This document is the long-lived historical record. It stays in the repo forever.

---

## What shipped

| Step | Focus | Files added/edited | New tests |
|---|---|---|---|
| 0 | Scaffold | 18 new, 0 edits outside `translation_v2/` | 0 |
| 1 | Protocols + characterization | 11 new | 50 |
| 2 | Shared services (TM, glossary, PII, observability) | 11 new + 1 v2 edit | 51 |
| 3 | v2 text translation path + `/api/v2/agent/translate` | 12 new | 66 |
| 4 | PDF ingest + hybrid retrieval CLI | 9 new | 55 |
| 5 | PDF Q&A + QE + `/api/v2/agent/pdf-*` endpoints | 11 new | 60 |
| 6 | Prometheus metrics + `/api/v2/agent/metrics` + RUNBOOK | 2 new + 2 v2 edits | 11 |
| 7 | v1 compat middleware + final docs | 4 new + 2 v2 edits | 15 |
| **Total** | | **78 new v2 files** | **308** |

**Edits to existing (non-v2) code: zero.** Every legacy file — `translator.py`, `tts_mandinka_fix.py`, `agent_routes.py`, `main.py`, `docker-compose*.yaml`, `.env*`, frontend modules, mobile modules — remains byte-for-byte unchanged from pre-migration state. This is a strict-additive migration.

---

## The canonical rollout flow

```
Normal deploy                  →  src.main:app                           → legacy only
↓
Switch entry point             →  src.main_with_translation_v2:app      → legacy + v2 inert
↓
Flip per-feature flags         →  USE_V2_TRANSLATION_PIPELINE=true etc. → v2 serves on /api/v2/*
↓
Transparent cutover            →  USE_V2_FOR_V1_ENDPOINTS=true          → v1 URLs now v2-served
↓
Gateway canary (optional)      →  nginx split_clients N%                → controlled traffic shift
```

Each arrow is **one flag or one config line** and is **independently reversible in under 5 minutes**. The legacy code path remains hot and callable throughout.

---

## Legacy quirks — preserved vs fixed

Each decision was explicit, captured in characterization tests from Step 1, and annotated in the relevant step's notes.

| Legacy behaviour | Verdict | Where |
|---|---|---|
| Translation failure returns input text (not an exception) | **Preserved** — downstream callers already depend on it (autoTranslator batches 200 strings; raising on one would break the batch) | `test_legacy_cache.py::TestLLMFailureFallback` |
| Redis cache read/write failure is swallowed silently | **Preserved** — alternative is to couple translator availability to Redis availability, which is worse | `test_legacy_cache.py::TestCacheFailureIsSwallowed` |
| Same-language / empty / unsupported-language early return | **Preserved** | `test_legacy_adapter.py::TestAdapterPreservesLegacyQuirks` |
| Mandinka detection thresholds (0.35 / 0.50 / 0.60) | **Preserved** — calibrated by hand on realistic Gambian messages; not changed without a labelled validation set | `test_detector.py::TestThresholds` |
| LLM output quote-stripping (single + double) | **Preserved** | `test_legacy_cache.py::TestLLMFailureFallback::test_quoting_is_stripped_from_llm_output` |
| `translate_batch` dict-based I/O (legacy) | **Wrapped** — adapter converts to list Protocol without collapsing duplicates | `test_legacy_batch.py::TestListDictConversion` |
| LLM output with markdown fence + leading "Translation:" label | **Fixed** in v2 post_process — legacy has no such cleanup | `test_post_process.py::TestCleanAnswer::test_markdown_then_normalize` |
| QE reference-free evaluation | **Added** — legacy has no QE | `test_qe.py::TestHeuristicQE` |
| PII-aware routing (force local provider) | **Added** — legacy sends all text to OpenAI | `test_router.py::TestPIIRouting` |
| Shadow-mode provider comparison | **Added** — legacy has no shadow | `test_router.py::TestShadowMode` |
| Prometheus metrics surface | **Added** — legacy has no metrics | `test_metrics.py` |

---

## Bugs found (and actually fixed) during the migration

These were bugs in v2 code I wrote, caught by the characterization test discipline. Each was diagnosed at root cause, not silenced.

1. **`LayoutAwareChunker` config validation** (Step 4). `chunk_size or default` treated `0` as falsy and silently substituted the flag default, so the subsequent `<= 0` guard never fired. Fix: explicit `is not None else default` for all three config knobs. Caught by `test_chunker.py::TestConfigValidation::test_chunk_size_positive`.

2. **`strip_model_artifacts` order-of-operations** (Step 5). Stripped the leading "Translation:" label *before* the markdown fence, so the label survived when fences wrapped it. Fix: swap the order — fences first, then labels. Caught by `test_post_process.py::TestCleanAnswer::test_markdown_then_normalize`.

Neither was a legacy bug. Legacy code was not modified.

---

## Final flag state (defaults)

All flags default **OFF**. Production is v1-only until flipped.

| Flag | Default | Role |
|---|---|---|
| `USE_V2_TRANSLATION_PIPELINE` | `false` | Master gate for `/api/v2/agent/translate` |
| `USE_V2_RAG` | `false` | Master gate for `/api/v2/agent/pdf-*` |
| `USE_V2_FOR_V1_ENDPOINTS` | `false` | Transparently route `/api/v1/agent/translate{,batch}` through v2 |
| `USE_V2_TM_CACHE` | `false` | v2 Redis TM in front of providers |
| `USE_V2_GLOSSARY` | `false` | Reserved |
| `USE_V2_QE` | `false` | Reserved |
| `USE_V2_SHADOW_MODE` | `false` | Reserved alias; see `V2_SHADOW_PERCENT` |
| `USE_V2_PII_LOCAL_ROUTING` | `false` | PII → NLLB, never falls back to cloud |
| `V2_SHADOW_PERCENT` | `0` | 0..100; shadow-compare sample rate |
| `V2_PRIMARY_PROVIDER` | `openai` | `openai \| gemma \| nllb` |
| `V2_FALLBACK_PROVIDER` | `nllb` | `openai \| gemma \| nllb`; same as primary disables fallback |
| `V2_RAG_EMBED_URL` | `http://tei:80` | TEI container |
| `V2_RAG_EMBED_MODEL` | `intfloat/multilingual-e5-large` | Informational; TEI serves one model |
| `V2_RAG_CHUNK_SIZE_CHARS` | `2400` | ~600 tokens |
| `V2_RAG_CHUNK_OVERLAP_CHARS` | `400` | ~15 % |
| `V2_RAG_MIN_CHUNK_CHARS` | `100` | Drop tiny tails |
| `V2_RAG_SCANNED_TEXT_THRESHOLD` | `50` | Scanned-page detection boundary |
| `V2_RAG_DEFAULT_STRATEGY` | `answer_then_translate` | Alt: `cross_lingual_direct` |
| `V2_RAG_DEFAULT_K` | `5` | Default retrieval depth |
| `V2_RAG_QE_THRESHOLD` | `0.5` | Composite QE pass threshold |

---

## Metrics (live today at `/api/v2/agent/metrics`)

See `STEP_6_NOTES.md` for the full table. Quick overview:

```
v2_translate_total{provider, source, target, reason}                counter
v2_translate_duration_ms{provider, source, target, status}          summary
v2_translate_fallback_duration_ms{...}                              summary
v2_pii_local_routed_total{provider}                                 counter
v2_shadow_mismatch_total{provider}                                  counter
v2_rag_ingest_duration_ms{status}                                   summary
v2_rag_query_duration_ms{target, k, status}                         summary
```

---

## What remains work for humans, not code

- **NLLB container** stand-up. `NLLBProvider` is wired; the container deployment is an ops task and uses a standard HuggingFace + FastAPI image serving NLLB-200.
- **Gambia GPU confirmation** before `V2_PRIMARY_PROVIDER=gemma`.
- **Gambian-speaker validation set** for the Mandinka detector thresholds (Q4 in the inventory). 500-1000 labelled messages closes the biggest quality-monitoring gap.
- **Frontend-visible v2 QE feedback.** The backend returns QE scores; exposing them in the UI (e.g., a small "reviewed ✓" badge on high-QE responses) is a frontend change, out of scope for this migration.
- **Mobile Mandinka locale file.** `i18n_service.dart` has 11 locales, none of which is `ma`. Adding it is a mobile-side PR, not a backend concern.

---

## The legacy code — why it's still here

`services/translator.py`, `services/tts_mandinka_fix.py`, and all their friends remain exactly where they were. They carry requirements that have been paid for in production bugs over prior sprints. They are:

- **Callable** — `from src.services.translator import get_translator; translator.translate(...)` still works.
- **Documented** — their own docstrings describe their design and remain accurate for that role.
- **Unblocked** — no v2 change imports, intercepts, monkey-patches, or otherwise depends on them.

If v2 regresses in production and flag rollback isn't sufficient (extremely unlikely — the flags are tested, reviewed, and staged), the next step is to switch the uvicorn entry back to `src.main:app`. Legacy is immediately the only path, as it was before the migration began.

The legacy code should not be deleted. Ever. Not until at least one full fiscal-year cycle has passed at 100% v2 with no rollback events, and even then a trivially-reachable archival copy stays in the repo with the re-enable steps in its header. This is not paranoia; it's the accumulated observation that **"working" is a property the field has already validated**, and the new code has not.

---

## For the next engineer

Read in order, and only read further if you need the detail:

1. `MIGRATION_INVENTORY.md` — what was here before we started, and what surprised us
2. `STEP_0_NOTES.md` … `STEP_7_NOTES.md` — the audit trail
3. `RUNBOOK.md` — how to actually deploy, canary, and roll back
4. This file — the historical record

If you're here because something broke, start with the RUNBOOK's rollback section, not with fixing code.
