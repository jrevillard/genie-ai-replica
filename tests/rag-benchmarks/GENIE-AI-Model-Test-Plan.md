# GENIE.AI — Model Configuration Test Plan

## Objective

Validate that recommended model combinations from the [Choosing LLMs Guide](site/content/en/docs/rag/choosing-models.md) work correctly across the three supported hardware profiles. This plan tests each model against all the roles it must serve: main inference, chunk labeling, graph extraction, translation, and the full RAG pipeline.

---

## Test Environment Setup

Before running any tests, ensure the baseline is healthy:

1. `docker compose ps` — all containers healthy (except initial vLLM timeout — wait and re-run `up -d`)
2. `watch nvidia-smi` — verify all GPU processes are running and memory is allocated
3. ArangoDB accessible at `http://localhost:8529` (root/test)
4. Login to the application at `https://localhost` (Admin/ADMINadmin)
5. Knowledge hierarchy exists with at least 3 categories and 9+ services
6. At least 3 PDF documents uploaded and labeled with the knowledge hierarchy

---

## Profile 1: RTX 6000 Ada (48GB VRAM, compute 8.9, bfloat16)

### Test Matrix

| Test # | Main Model | Labeling Strategy | Translation Model | Expected Outcome |
|--------|-----------|------------------|------------------|-----------------|
| 1A | Qwen 2.5 7B (FP16) | `llm` | TranslateGemma 4B | Full pipeline works. Graph extraction produces entities. |
| 1B | Qwen 2.5 7B (FP16) | `embedding` | TranslateGemma 4B | Full pipeline works. Labeling uses embeddings. |
| 1C | Qwen 2.5 7B (FP16) | `llm` | Gemma 3 4B | Full pipeline works. Alternative translation model. |
| 1D | Llama 3.1 8B (FP16) | `llm` | TranslateGemma 4B | Full pipeline works. Function calling available. |
| 1E | Llama 3.1 8B (FP16) | `embedding` | TranslateGemma 4B | Full pipeline works. No LLM labeling. |
| 1F | Qwen 2.5 14B (FP16) | `llm` | Qwen 2.5 7B | Full pipeline works. Largest practical single-GPU config. |
| 1G | Qwen 2.5 14B (FP16) | `llm` | TranslateGemma 4B | Full pipeline works. 14B main + 4B translation. |
| 1H | Mistral 7B v0.3 (FP16) | `llm` | TranslateGemma 4B | Full pipeline works. Graph extraction may be inconsistent. |

### Configuration Template

```bash
# .env overrides for Profile 1 (start from the env template)
VLLM_LLM_MODEL_ID=Qwen/Qwen2.5-7B-Instruct
VLLM_GPU_UTIL=0.6
VLLM_MAX_MODEL_LEN=65536
VLLM_DTYPE=auto
LABELING_STRATEGY=llm

VLLM_TRANSLATION_MODEL_ID=Infomaniak-AI/vllm-translategemma-4b-it
VLLM_TRANSLATION_GPU_UTIL=0.3
VLLM_TRANSLATION_MAX_MODEL_LEN=2048
VLLM_TRANSLATION_DTYPE=auto

EMBEDDING_MODEL_ID=BAAI/bge-base-en-v1.5
RERANKER_MODEL_ID=cross-encoder/ms-marco-MiniLM-L-6-v2
```

### Test 1A — Qwen 2.5 7B + LLM Labeling + TranslateGemma (Recommended Config)

**Steps:**

1. Update `.env` with the configuration template above
2. `docker compose down && docker compose up -d --build`
3. Monitor GPU allocation with `watch nvidia-smi` — verify both vLLM processes and both TEI processes are running
4. Wait for all services healthy: `docker compose ps`
5. Run inference verification:
   ```bash
   curl -s http://localhost:8000/v1/models | python3 -m json.tool
   curl -s http://localhost:9031/v1/models | python3 -m json.tool
   ```
6. Log into the application, navigate to a conversation, ask a question about an ingested document
7. **Pass criteria:** Coherent answer referencing source material. No 400/500 errors in backend or vllm logs.

8. **Ingestion test:** Upload a new PDF, apply labels, click Ingest
9. Monitor ingestion logs:
   ```bash
   docker compose logs -f dataprep-arango-service
   ```
10. **Labeling checks:**
    - No `WARN` logs saying "non-string labels" or "Coercing non-string values"
    - `INFO` logs showing "LLM selected label 'X'" for each chunk
    - Final labels logged match the document's topic
11. **Graph extraction checks:**
    - No `WARN` logs saying "unhashable type: 'dict'"
    - No "Batch N skipped due to extraction error" warnings
    - `INFO` logs showing graph documents inserted
12. **Pass criteria:** All chunks labeled with valid taxonomy strings. No skipped batches.

13. **Translation test:** Switch UI language to French/Spanish (if translations exist)
14. Ask a question — verify the query is translated, answer generated, then translated back
15. **Pass criteria:** End-to-end multilingual flow completes without errors.

16. **Record:** `nvidia-smi` output showing total GPU memory usage

---

### Tests 1B–1H — Variations

For each variation, repeat steps 1–7 (inference) and 8–12 (ingestion) from Test 1A, adapting expectations:

| Test | Special Attention |
|------|-----------------|
| **1B** (embedding labeling) | No LLM labeling logs. Labels assigned via cosine similarity. Should be faster. |
| **1C** (Gemma 4B translation) | Verify translation quality is adequate. Gemma 4B is general-purpose, not fine-tuned. |
| **1D** (Llama 3.1 8B) | Verify function calling doesn't cause issues with OPEA's `ignore_tool_usage=True` setting. |
| **1E** (Llama + embedding) | Same as 1B but with Llama model. Compare answer quality vs 1A. |
| **1F** (Qwen 14B + Qwen 7B translation) | Two Qwen instances. Verify NVIDIA_VISIBLE_DEVICES isn't needed for single GPU. Check total VRAM fits in 48GB. |
| **1G** (Qwen 14B + TranslateGemma) | Verify 14B model loads without OOM. Check if `VLLM_GPU_UTIL=0.6` is sufficient or needs increase. |
| **1H** (Mistral 7B) | Expect some graph extraction failures. Document which batches are skipped. |

---

## Profile 2: A40 (48GB VRAM, compute 8.6, bfloat16)

### Test Matrix

| Test # | Main Model | Labeling Strategy | Translation Model | Expected Outcome |
|--------|-----------|------------------|------------------|-----------------|
| 2A | Qwen 2.5 7B (FP16) | `llm` | TranslateGemma 4B | Same as 1A. Should work identically to RTX 6000 Ada. |
| 2B | Llama 3.1 8B (FP16) | `llm` | TranslateGemma 4B | Same as 1D. |
| 2C | Qwen 2.5 7B (FP16) | `llm` | Qwen 2.5 7B (FP16) | Two identical vLLM instances. Test concurrent load. |

### Key Difference from RTX 6000 Ada

The A40 uses Ampere architecture (compute 8.6) vs Ada (compute 8.9). The practical difference is minimal:
- Both support bfloat16
- Both have 48 GB VRAM
- A40 may have slightly different memory bandwidth

**Run Test 1A and 1D from Profile 1.** No configuration changes needed — the A40 should behave identically to the RTX 6000 Ada. Record `nvidia-smi` output for comparison.

---

## Profile 3: Tesla T4 (16GB VRAM, compute 7.5, NO bfloat16)

### Test Matrix

| Test # | Main Model | Labeling Strategy | Translation Model | Expected Outcome |
|--------|-----------|------------------|------------------|-----------------|
| 3A | Granite 3.3 2B (FP16) | `embedding` | Gemma 3 4B | Baseline. Inference works. No graph extraction. |
| 3B | Granite 3.3 2B (FP16) | `bm25` | Gemma 3 4B | BM25 labeling. Strict keyword matching. |
| 3C | Gemma 3 4B (FP16) | `embedding` | Gemma 3 4B | Better inference quality. Tight VRAM. |
| 3D | Mistral 7B (FP16) | `embedding` | Gemma 3 4B | Best inference quality. Very tight VRAM. |

### Configuration Template

```bash
# .env overrides for Profile 3 (start from the env-T4 template)
VLLM_LLM_MODEL_ID=ibm-granite/granite-3.3-2b-instruct
VLLM_GPU_UTIL=0.4
VLLM_MAX_MODEL_LEN=65536
VLLM_DTYPE=half
LABELING_STRATEGY=embedding

VLLM_TRANSLATION_MODEL_ID=google/gemma-3-4b-it
VLLM_TRANSLATION_GPU_UTIL=0.4
VLLM_TRANSLATION_DTYPE=half
VLLM_TRANSLATION_KV_CACHE_DTYPE=fp8

EMBEDDING_MODEL_ID=BAAI/bge-base-en-v1.5
RERANKER_MODEL_ID=cross-encoder/ms-marco-MiniLM-L-6-v2
```

### Test 3A — Granite 2B + Embedding Labeling (Baseline)

**Steps:**

1. Use `docker-compose-t4.yaml` with the configuration template above
2. `docker compose -f docker-compose-t4.yaml down && docker compose -f docker-compose-t4.yaml up -d --build`
3. Monitor GPU allocation — verify total usage stays under 15 GB
4. Wait for all services healthy
5. Run inference verification (curl + application login)
6. **Pass criteria:** Coherent answers. No OOM errors in any service.

7. Upload a new PDF, apply labels, click Ingest
8. **Labeling checks:**
    - Labels assigned via embedding similarity (no LLM calls in logs)
    - Labels should match the document topic (may be broader/less precise than LLM)
    - No errors or warnings related to JSON parsing
9. **Graph extraction checks:**
    - Expect "Batch N skipped due to extraction error: unhashable type: 'dict'" warnings
    - This is expected and acceptable on T4 — document it, don't treat it as a failure
10. **Pass criteria:** Document ingested with labels and embeddings. Graph batches skipped (expected).

11. **Translation test:** Switch UI language, ask a question
12. **Pass criteria:** Translation works. May be slower than Ada/Ampere GPUs.

13. **Context window test:** Ask a question that triggers retrieval of multiple chunks
14. **Pass criteria:** No `ValueError: maximum context length` errors. If this occurs, reduce `RETRIEVER_ARANGO_K` or `RETRIEVER_ARANGO_FETCH_K`.

15. **Record:** `nvidia-smi` output

---

### Test 3B — Granite 2B + BM25 Labeling

Same as 3A but with `LABELING_STRATEGY=bm25` and `BM25_LABEL_THRESHOLD=2.0`.

**Expected differences from 3A:**
- Labels assigned only when exact keywords from the taxonomy appear in the chunk
- May produce fewer labels per chunk than embedding strategy
- Faster ingestion (CPU-only, no LLM/TEI calls for labeling)

**Pass criteria:** Document ingested. Labels are strict keyword matches. No errors.

---

### Test 3C — Gemma 4B + Embedding Labeling

**Steps:**

1. Change only `VLLM_LLM_MODEL_ID=google/gemma-3-4b-it` in `.env`
2. Rebuild and restart: `docker compose -f docker-compose-t4.yaml build vllm && docker compose -f docker-compose-t4.yaml up -d --force-recreate vllm`
3. Verify model loads without OOM — watch `nvidia-smi`
4. Run inference test and ingestion test as in 3A

**Risk:** Gemma 4B at FP16 uses ~8 GB. Combined with translation Gemma 4B (~8 GB), this exceeds 16 GB. May need to reduce `VLLM_GPU_UTIL` to 0.35 for both instances, or reduce `VLLM_MAX_MODEL_LEN` to 1024.

**Pass criteria:** If model loads, inference quality should be noticeably better than Granite 2B. If OOM, document it and revert to 3A.

---

### Test 3D — Mistral 7B + Embedding Labeling

**Steps:**

1. Change `VLLM_LLM_MODEL_ID=mistralai/Mistral-7B-Instruct-v0.3` in `.env`
2. Set `VLLM_GPU_UTIL=0.4`, `VLLD_DTYPE=half`, `VLLM_MAX_MODEL_LEN=65536`
3. Rebuild and restart

**Risk:** Mistral 7B at FP16 is ~14 GB. With translation and TEI, this will almost certainly OOM on a single T4. This test is primarily to confirm that fact.

**Expected outcome:** vLLM fails to load with OOM error. Document it as confirmed incompatible.

---

## Cross-Profile Comparison Tests

After running all profile-specific tests, compare:

### Answer Quality

For each profile, ask the same 5 questions about ingested documents. Rate answers 1–5 for:
- Accuracy (correctly reflects source material)
- Completeness (covers all relevant aspects)
- Conciseness (no unnecessary filler)

| Profile | Model | Q1 Score | Q2 Score | Q3 Score | Q4 Score | Q5 Score | Avg |
|---------|-------|----------|----------|----------|----------|----------|-----|
| RTX 6000 Ada | Qwen 2.5 7B | | | | | | |
| RTX 6000 Ada | Llama 3.1 8B | | | | | | |
| A40 | Qwen 2.5 7B | | | | | | |
| T4 | Granite 2B | | | | | | |

### GPU Utilization

Record peak VRAM usage from `nvidia-smi`:

| Profile | Main vLLM | Translation vLLM | TEI Embed | TEI Rerank | Total | Free |
|---------|-----------|-----------------|-----------|------------|-------|------|
| RTX 6000 Ada | | | | | | |
| A40 | | | | | | |
| T4 | | | | | | |

### Ingestion Speed

Time a 10-page PDF ingestion from click to "Ingested" status:

| Profile | Model | Labeling Strategy | Ingestion Time | Errors |
|---------|-------|------------------|---------------|--------|
| RTX 6000 Ada | Qwen 2.5 7B | `llm` | | |
| RTX 6000 Ada | Qwen 2.5 7B | `embedding` | | |
| T4 | Granite 2B | `embedding` | | |
| T4 | Granite 2B | `bm25` | | |

---

## Failure Documentation

For every test failure, record:

| Field | Value |
|-------|-------|
| Test ID | e.g., 1A |
| Profile | e.g., RTX 6000 Ada |
| Model | e.g., Qwen 2.5 7B |
| Error Type | OOM / JSON parse / Context overflow / Timeout / 400 Bad Request |
| Error Message | Exact error from logs |
| Container | Which service threw the error |
| Log Snippet | 10 lines before and after the error |
| Workaround | What configuration change resolved it (if any) |
| Resolution | Passed on retry / Reverted to smaller model / Known limitation |

---

## Test Execution Checklist

- [ ] Profile 1: RTX 6000 Ada — Test 1A (Qwen 7B, LLM labeling, TranslateGemma)
- [ ] Profile 1: RTX 6000 Ada — Test 1B (Qwen 7B, embedding labeling)
- [ ] Profile 1: RTX 6000 Ada — Test 1D (Llama 8B, LLM labeling)
- [ ] Profile 1: RTX 6000 Ada — Test 1F (Qwen 14B, LLM labeling)
- [ ] Profile 2: A40 — Test 2A (Qwen 7B)
- [ ] Profile 2: A40 — Test 2B (Llama 8B)
- [ ] Profile 3: T4 — Test 3A (Granite 2B, embedding)
- [ ] Profile 3: T4 — Test 3B (Granite 2B, bm25)
- [ ] Profile 3: T4 — Test 3C (Gemma 4B, embedding) — expected OOM
- [ ] Profile 3: T4 — Test 3D (Mistral 7B) — expected OOM
- [ ] Cross-profile: Answer quality comparison table filled
- [ ] Cross-profile: GPU utilization table filled
- [ ] Cross-profile: Ingestion speed table filled
- [ ] All failures documented
- [ ] Update site/content/en/docs/rag/choosing-models.md with confirmed results
