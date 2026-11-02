# Translation Service Plan — GENIE.AI (Lesotho Deployment)

**Document Version:** 1.1  
**Last Updated:** June 5, 2026  
**Project:** BDT 9LES25007 — Open-Source AI Agriculture Advisory Service for Lesotho  
**Target Language:** Sesotho (Southern Sotho, ISO 639-3: `sot`)

---

## 1. Context

The GENIE.AI Lesotho deployment requires translation capabilities to serve smallholder farmers in their native language, Sesotho (Southern Sotho). The translation service runs as a vLLM instance (`vllm-translation-guardrail`) that also handles content guardrails.

---

## 2. T4 GPU Compatibility Issue

### Problem

The original configuration used `google/gemma-3-4b-it` as the translation/guardrail model. This model uses the `gemma3_text` architecture which **does not support float16 (half precision)**. It requires `bfloat16`, which T4 GPUs (NVIDIA Turing architecture) do not natively support.

**Error observed:**

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for ModelConfig
  Value error, The model type 'gemma3_text' does not support float16.
  Reason: Numerical instability. Please use bfloat16 or float32 instead.
```

### Root Cause

| GPU | Architecture | Native bfloat16 | Native float16 |
|-----|-------------|-----------------|----------------|
| NVIDIA T4 | Turing (SM 7.5) | No | Yes |
| NVIDIA A100 | Ampere (SM 8.0) | Yes | Yes |
| NVIDIA RTX 6000 Ada | Ada Lovelace (SM 8.9) | Yes | Yes |

T4 GPUs can only emulate bfloat16 via software, resulting in significant performance degradation. Gemma 3 models explicitly reject float16 due to numerical instability in their architecture.

### Resolution

Switched to `google/gemma-2-2b-it` which:
- Supports float16 natively
- Runs efficiently on T4 GPUs
- Is compatible with vLLM's OpenAI-compatible API
- Serves as both translation and guardrail model

### Configuration Changes

**File:** `env` (and `env-T4`)

```bash
# Before (broken on T4)
VLLM_TRANSLATION_MODEL_ID=google/gemma-3-4b-it
VLLM_TRANSLATION_DTYPE=auto

# After (working on T4)
VLLM_TRANSLATION_MODEL_ID=google/gemma-2-2b-it
VLLM_TRANSLATION_DTYPE=half
```

**Restart command:**

```bash
cd ~/genie-ai-replica
docker compose -f docker-compose-t4.yaml up -d vllm-translation-guardrail chatqna-xeon-backend-server
```

---

## 3. Sesotho Language Support — Options Analysis

Sesotho (Southern Sotho) is a low-resource language spoken by approximately 5.6 million people, primarily in Lesotho and South Africa. AI/ML support for Sesotho is limited compared to high-resource languages. Below are the viable options for providing Sesotho translation.

---

### Option A: Meta NLLB-200 (Dedicated Translation Model)

**Model:** `facebook/nllb-200-distilled-1.3B` or `facebook/nllb-200-3.3B`  
**Type:** Sequence-to-sequence encoder-decoder (not a generative LLM)  
**Sesotho code:** `sot_Latn`

| Aspect | Details |
|--------|---------|
| Sesotho quality | High — purpose-built for 200 languages including Sesotho with validated benchmarks |
| Model size | 1.3B (distilled) or 3.3B (full) |
| T4 compatible | Yes — runs in float16 |
| GPU memory | ~3 GB (1.3B) or ~7 GB (3.3B) |
| Architecture | Encoder-decoder, not compatible with vLLM OpenAI API |

**Pros:**
- Best translation quality for Sesotho among open-source options
- Specifically trained and evaluated on low-resource African languages
- Small memory footprint, leaves GPU headroom for other services
- Direct language-pair translation (no prompt engineering needed)
- Validated by Meta's NLLB research team with human evaluations

**Cons:**
- Requires a separate microservice (not vLLM-compatible)
- Cannot double as a guardrail model — would need to keep Gemma 2 for guardrails
- Different API interface (not OpenAI-compatible), requires integration work
- Translation only — no general text generation capabilities

**Implementation effort:** Medium — requires building a new translation microservice container using HuggingFace Transformers or CTranslate2, and updating the OPEA translation endpoint routing.

---

### Option B: google/gemma-2-2b-it (Current Setup)

**Model:** `google/gemma-2-2b-it`  
**Type:** Generative decoder-only LLM

| Aspect | Details |
|--------|---------|
| Sesotho quality | Low — primarily English-trained, limited multilingual capability |
| Model size | 2B parameters |
| T4 compatible | Yes — runs in float16 |
| GPU memory | ~5 GB |
| Architecture | Decoder-only, vLLM-compatible |

**Pros:**
- Already deployed and working
- Dual-purpose: handles both translation and guardrails
- Compatible with existing vLLM + OpenAI API infrastructure
- No additional services or integration work needed

**Cons:**
- Poor Sesotho translation quality — model was not trained on Sesotho data
- May produce hallucinated or incorrect translations
- Not suitable for production Sesotho-facing service
- English-centric training data

**Implementation effort:** None — already in place.

---

### Option C: meta-llama/Llama-3.1-8B-Instruct

**Model:** `meta-llama/Llama-3.1-8B-Instruct`  
**Type:** Generative decoder-only LLM

| Aspect | Details |
|--------|---------|
| Sesotho quality | Low-Medium — broader multilingual training but Sesotho is still underrepresented |
| Model size | 8B parameters |
| T4 compatible | Yes — with quantization (4-bit) or reduced context length |
| GPU memory | ~16 GB (float16) or ~6 GB (4-bit quantized) |
| Architecture | Decoder-only, vLLM-compatible |

**Pros:**
- Better multilingual coverage than Gemma 2
- Some exposure to African languages in training data
- vLLM-compatible, drop-in replacement
- Dual-purpose (translation + guardrails)

**Cons:**
- Requires quantization on T4 (16 GB VRAM limit), which degrades quality
- Sesotho is still a low-resource language in its training data
- Larger model means less GPU headroom for other services
- Translation quality still significantly below NLLB for Sesotho

**Implementation effort:** Low — change model ID in env file, may need to add quantization flags.

---

### Option D: Hybrid Architecture (Recommended)

**Models:** `facebook/nllb-200-distilled-1.3B` (translation) + `google/gemma-2-2b-it` (guardrails)

| Aspect | Details |
|--------|---------|
| Sesotho quality | High — NLLB handles translation, Gemma handles guardrails |
| Total GPU memory | ~8 GB combined |
| T4 compatible | Yes |
| Architecture | Two separate services |

**Pros:**
- Best Sesotho translation quality available in open-source
- Guardrails remain functional via Gemma 2
- Both models fit comfortably on a single T4 (16 GB)
- Each model does what it's best at — separation of concerns
- NLLB is battle-tested for low-resource language translation

**Cons:**
- Two services to maintain instead of one
- Requires building an NLLB translation microservice
- Slightly more complex deployment and monitoring
- Additional Docker container and network configuration

**Implementation effort:** Medium — build NLLB container, expose translation API, update routing in the OPEA translation service to point to NLLB instead of vLLM for translation tasks.

---

## 4. Recommendation

### Short-term (current): Option B — Gemma 2 (already deployed)

Get the system running with `google/gemma-2-2b-it` for both translation and guardrails. This provides functional guardrails and basic (English-centric) translation capability while the Sesotho-specific solution is developed.

### Medium-term (recommended): Option D — Hybrid Architecture

Deploy NLLB-200 as a dedicated translation microservice alongside Gemma 2 for guardrails. This provides:

1. Production-quality Sesotho ↔ English translation
2. Functional content guardrails
3. Efficient GPU utilization on T4 hardware
4. Clear separation of concerns

### Implementation Roadmap

```
Phase 1 (Done):  Switch to Gemma 2 — system operational
Phase 2 (Next):  Build NLLB translation microservice container
Phase 3:         Integrate NLLB service into OPEA translation endpoint
Phase 4:         Validate Sesotho translation quality with native speakers
Phase 5:         Fine-tune NLLB on agriculture-specific Sesotho terminology (optional)
```

---

## 5. NLLB Integration Architecture (Phase 2-3)

```
┌─────────────────┐     ┌──────────────────────────┐
│   User Query    │────▶│   gov-chat-backend       │
│   (Sesotho)     │     │   (Node.js)              │
└─────────────────┘     └──────────┬───────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼                             ▼
        ┌───────────────────┐         ┌────────────────────┐
        │  NLLB Translation │         │  Gemma 2 Guardrail │
        │  (sot_Latn ↔ eng) │         │  (content safety)  │
        │  Port: 9032       │         │  Port: 9031        │
        └───────────────────┘         └────────────────────┘
                    │
                    ▼
        ┌───────────────────┐
        │  ChatQnA (OPEA)   │
        │  English query     │
        │  Port: 8888       │
        └───────────────────┘
```

**Flow:**
1. User submits query in Sesotho
2. NLLB translates Sesotho → English
3. English query goes to ChatQnA RAG pipeline
4. Response comes back in English
5. NLLB translates English → Sesotho
6. Guardrail checks content safety
7. Response delivered to user in Sesotho

---

## 8. Translation Performance Optimization Plan

**Added:** June 5, 2026  
**Status:** 🔍 Investigation complete — awaiting implementation prioritization  
**Problem:** End-to-end Sesotho chat response time is ~60-65s, with translation accounting for ~45s of that.

### Current Performance Breakdown

A Sesotho user message flows through the following pipeline:

```
Input translation (history ST→EN):   ~8s
RAG pipeline (embed→retrieve→rerank→LLM): ~15-20s
Output translation (EN→ST):          ~37s
────────────────────────────────────────────
Total end-to-end:                     ~60-65s
```

The output translation dominates because:
- LLM responses are typically 500-2000 characters
- NLLB-200 distilled 600M on CPU processes ~50-70 tokens/second via `@xenova/transformers` (ONNX runtime)
- Translation is sequential: the full LLM response must complete before any translation begins

### Current Implementation Architecture

```
ChatQnA (Python) ──HTTP POST──▶ Backend /api/translate (Node.js)
                                        │
                                        ▼
                               Worker Thread (cpu-translation-worker.js)
                                        │
                                        ▼
                               @xenova/transformers (ONNX runtime)
                               NLLB-200 distilled 600M
                               4 threads, quantized INT8
```

**Key observations from code review:**
- Single worker thread handles all translation requests (potential queue bottleneck under concurrency)
- Redis caching is enabled but **only for markdown document translations** (`translateMarkdown()`), NOT for real-time chat translations via `/api/translate`
- Output translation uses chunking (2000 char chunks) with `asyncio.gather` for parallel chunk translation — but each chunk still goes through the single worker sequentially
- Input history translation is capped at `MAX_TRANSLATION_CHARS=2000` characters
- HTTP overhead per translation call: ChatQnA (Python) → Node.js backend → Worker thread → response back through HTTP

### Optimization Options

#### Option 1: Redis Caching for Chat Translations

**Effort:** Low  
**Impact:** Variable — significant for repeat/similar queries, zero for novel queries  
**Risk:** Low

Add per-segment Redis caching to the `/api/translate` route, keyed by `md5(text + source_lang + target_lang)`. Agricultural advisory responses have high repetition — common phrases about planting schedules, soil preparation, and crop care will be served instantly from cache after first occurrence.

**Implementation:**
- Add cache lookup in `translation-service.js` `translate()` method (not just `translateMarkdown()`)
- Key format: `chat_translation:{md5(text)}:{source}:{target}`
- TTL: 7 days (or permanent, like markdown cache)
- Segment cached texts at sentence level for higher hit rates

**Expected impact:** Cache hit rates of 20-40% for typical agricultural advisory conversations after warm-up period.

---

#### Option 2: Switch to CTranslate2 Backend

**Effort:** Medium  
**Impact:** High — estimated 2-4x speedup (~37s → ~10-15s for output translation)  
**Risk:** Low-Medium

Replace `@xenova/transformers` (JavaScript, ONNX runtime) with [CTranslate2](https://github.com/OpenNMT/CTranslate2) — a C++ inference engine specifically optimized for seq2seq/encoder-decoder models like NLLB. Published benchmarks show 2-4x throughput improvement on CPU for the same model.

**Implementation approaches:**

**A) Sidecar container (recommended):**
```yaml
nllb-ct2:
  image: custom-nllb-ct2:latest  # Build with CTranslate2 + converted NLLB model
  container_name: nllb-ct2
  ports:
    - "9032:9032"
  environment:
    - MODEL_PATH=/models/nllb-200-distilled-600M-ct2
    - DEVICE=cpu
    - INTER_THREADS=1
    - INTRA_THREADS=4
  networks:
    - genieai_network
```

**B) Direct integration in Python chatqna service:**
```python
import ctranslate2
import sentencepiece

translator = ctranslate2.Translator("/models/nllb-200-ct2", device="cpu", inter_threads=1, intra_threads=4)
tokenizer = sentencepiece.SentencePieceProcessor("/models/nllb-200-ct2/sentencepiece.model")
```

This eliminates the HTTP round-trip to the Node.js backend entirely.

**Model conversion (one-time):**
```bash
pip install ctranslate2
ct2-opus-mt-converter --model_name facebook/nllb-200-distilled-600M --output_dir nllb-200-ct2
```

**Expected throughput:** ~150-200 tokens/second on CPU (vs current ~50-70 with ONNX).

---

#### Option 3: Streaming Translation (Perceived Performance)

**Effort:** Medium-High  
**Impact:** High perceived improvement — first translated sentence visible in ~18-20s vs 60s total wait  
**Risk:** Medium (requires frontend + backend changes)

Instead of waiting for the complete LLM response, translate progressively:
1. Stream LLM output from vLLM
2. Buffer until a sentence boundary is detected
3. Translate each completed sentence immediately
4. Stream translated sentences to the frontend via SSE/WebSocket

**Current vs Proposed UX:**
```
Current:  [──────── 60s wait ────────] [full response appears]
Proposed: [── 18s ──] [first sentence] [+3s] [second sentence] [+3s] ...
```

**Implementation scope:**
- Modify `genieai_chatqna.py` to use vLLM streaming endpoint
- Add sentence boundary detection and accumulation buffer
- Translate each sentence independently (parallel with next sentence generation)
- Frontend: handle streaming responses and progressively render translated text
- Backend: SSE or chunked transfer encoding for progressive delivery

**Trade-off:** Total time may be similar or slightly longer (per-sentence translation has more overhead than bulk), but perceived UX is dramatically better.

---

#### Option 4: Parallelize Input Translation with Other Work

**Effort:** Low  
**Impact:** Low (~1-2s saved)  
**Risk:** Very low

Currently in `genieai_chatqna.py`, input translation, weather context fetch, and user profile fetch run sequentially. These are independent operations that can run in parallel:

```python
# Current (sequential):
translated_history = await self._get_translated_history_string(...)  # ~8s
weather_context = await self._fetch_weather_context(...)             # ~1-2s

# Proposed (parallel):
translated_history, weather_context = await asyncio.gather(
    self._get_translated_history_string(full_chat_history, "English"),
    self._fetch_weather_context(weather_location, query_text=last_user_content)
)
```

**Note:** The weather fetch currently runs after translation because it uses `last_translated_message_content`. This would need to be reorganized — either fetch weather using the raw Sesotho text (if the weather API doesn't need English), or run a lightweight parallel translation of just the last message for weather keyword extraction.

---

#### Option 5: GPU-Accelerated NLLB via CTranslate2

**Effort:** Medium-High  
**Impact:** Transformative — translation drops from ~45s to ~2-3s total  
**Risk:** Medium (GPU memory contention with vLLM)

Run NLLB-200 600M on the T4 GPU using CTranslate2 with float16. The model requires ~1.2 GB VRAM.

**Feasibility on current hardware:**
- Current vLLM uses 85% GPU utilization (~13.6 GB) for Granite 2B
- vLLM metrics show peak KV cache usage of only ~1.3%
- Reducing `VLLM_GPU_MEMORY_UTILIZATION` to 0.75 would free ~1.6 GB
- NLLB 600M in FP16 needs ~1.2 GB → fits with margin

**Configuration change:**
```env
# Reduce vLLM allocation to make room for NLLB on GPU
VLLM_GPU_UTIL=0.75

# CTranslate2 NLLB on GPU
CT2_DEVICE=cuda
CT2_COMPUTE_TYPE=float16
```

**Risk mitigation:** Monitor vLLM KV cache eviction rates after the change. If evictions occur under concurrent load, revert to CPU translation.

**Expected throughput:** ~500-1000 tokens/second on T4 GPU (vs 50-70 on CPU) — effectively making translation near-instant.

---

#### Option 6: Upgrade to NLLB-200 1.3B

**Effort:** Low  
**Impact:** Marginal speed improvement, meaningful quality improvement  
**Risk:** Low (more RAM required: ~5 GB system RAM vs ~2.5 GB for 600M)

The 1.3B model produces better translations, especially for low-resource languages like Sesotho. With ONNX INT8 quantization, throughput is comparable to the 600M model while producing more accurate translations that need fewer corrections.

**Configuration change:**
```env
TRANSLATION_CPU_MODEL_ID=facebook/nllb-200-distilled-1.3B
```

**Note:** The VM has 28 GB RAM; current usage is ~18-20 GB. The 1.3B model fits comfortably.

---

### Recommended Implementation Order

| Priority | Optimization | Effort | Time Saved | Notes |
|----------|-------------|--------|-----------|-------|
| **1** | Redis caching for chat translations | Low | 20-40% of requests instant | Quick win, low risk |
| **2** | Parallelize input translation + weather fetch | Low | ~1-2s per request | Trivial code change |
| **3** | Switch to CTranslate2 (CPU sidecar) | Medium | ~25-30s (37s → 10-15s) | Biggest single improvement |
| **4** | Streaming translation (progressive UX) | Medium-High | Perceived: ~40s faster first content | Best UX improvement, more complex |
| **5** | GPU NLLB via CTranslate2 | Medium-High | ~43s (45s → 2-3s) | Best absolute performance, GPU memory risk |
| **6** | Upgrade to NLLB 1.3B | Low | Marginal speed, better quality | Do alongside CTranslate2 migration |

**Recommended path:** Start with #1 and #2 (low-effort, immediate benefit), then implement #3 (CTranslate2) as the primary performance fix. Consider #4 (streaming) as a UX enhancement if end-to-end time is still perceived as too slow even after CTranslate2. Reserve #5 (GPU NLLB) as a future option if GPU memory analysis confirms it's safe.

**Combined projected improvement (Options 1-3):**
```
Current:   Input ~8s + RAG ~17s + Output ~37s = ~62s total
Projected: Input ~3s + RAG ~17s + Output ~12s = ~32s total (with CTranslate2 + caching)
```

---

### Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| May 12, 2026 | Initial translation service plan (Options A-D) | Evaluating model options for Sesotho support |
| May 28, 2026 | Implemented Option D (Hybrid: NLLB CPU + Granite guardrail) | See [RAG-Quality-Improvements.md](RAG-Quality-Improvements.md) |
| June 5, 2026 | Performance optimization analysis completed | Translation latency (~45s of ~62s total) identified as primary UX bottleneck. CTranslate2 + caching recommended as first interventions. |

---

## 6. References

- [Meta NLLB-200 Project](https://ai.meta.com/research/no-language-left-behind/)
- [NLLB-200 Distilled 1.3B on HuggingFace](https://huggingface.co/facebook/nllb-200-distilled-1.3B)
- [Gemma 2 Model Card](https://huggingface.co/google/gemma-2-2b-it)
- [vLLM Documentation](https://docs.vllm.ai/)
- [NVIDIA T4 Specifications](https://www.nvidia.com/en-us/data-center/tesla-t4/)
- [Enhancing LLM Performance for Low-Resource African Languages](https://arxiv.org/abs/2412.12417) — includes Sesotho benchmarks


---

## 7. Knowledge Area Auto-Translation

### Overview

Knowledge Areas (categories and services displayed in the sidebar) support automatic translation using the NLLB-200 model. When a category or service is created or updated via the Admin Dashboard, translations for all configured languages are generated automatically in the background.

### How It Works

1. Admin creates/updates a category or service with an English name
2. The system checks which target languages are missing translations
3. NLLB-200 (CPU backend, `Xenova/nllb-200-distilled-600M`) translates the English text to each missing language
4. Translations are saved to ArangoDB (`serviceCategoryTranslations` / `serviceTranslations` collections)
5. Translations are marked with `autoTranslated: true` for identification

### Configured Target Languages

The following languages are auto-translated (matching frontend i18n locales supported by NLLB):

| Code | Language | NLLB Code |
|------|----------|-----------|
| ST | Sesotho | sot_Latn |
| FR | French | fra_Latn |
| ES | Spanish | spa_Latn |
| PT | Portuguese | por_Latn |
| AR | Arabic | arb_Arab |
| BN | Bengali | ben_Beng |
| DE | German | deu_Latn |
| ID | Indonesian | ind_Latn |
| RU | Russian | rus_Cyrl |
| SW | Swahili | swh_Latn |
| TH | Thai | tha_Thai |
| ZH | Chinese | zho_Hans |

### Bulk Translation (One-Time Catch-Up)

To generate translations for all existing Knowledge Areas that are missing translations:

#### Option 1: CLI (from the VM)

```bash
docker compose -f docker-compose-t4.yaml exec backend node -e "
const svc = require('./services/service-category-service');
const ts = require('./services/translation-service');
async function run() {
  await svc.init();
  await ts.init();
  const result = await svc.bulkAutoTranslate();
  console.log(JSON.stringify(result, null, 2));
}
run().catch(e => console.error(e.message));
"
```

**Important:** The `TranslationService` must be explicitly initialized (`await ts.init()`) before running bulk translation. This loads the NLLB ONNX model into memory. Without this step, translations will fail silently or produce garbage output.

#### Option 2: API Endpoint (Admin Only)

```bash
curl -X POST https://agrivisory.itu.int/api/service-categories/auto-translate \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json"
```

### Resetting Translations for a Specific Language

If translations need to be regenerated (e.g., after fixing a translation quality issue):

```bash
docker compose -f docker-compose-t4.yaml exec backend node -e "
const { dbService } = require('./shared-lib');
const svc = require('./services/service-category-service');
const ts = require('./services/translation-service');
async function run() {
  const db = await dbService.getConnection();
  await svc.init();
  await ts.init();
  // Delete all translations for a specific language (case-insensitive)
  const LANG = 'st';
  await db.query('FOR t IN serviceCategoryTranslations FILTER LOWER(t.languageCode) == \"' + LANG + '\" REMOVE t IN serviceCategoryTranslations');
  await db.query('FOR t IN serviceTranslations FILTER LOWER(t.languageCode) == \"' + LANG + '\" REMOVE t IN serviceTranslations');
  console.log('Deleted all ' + LANG.toUpperCase() + ' translations');
  // Re-generate
  const result = await svc.bulkAutoTranslate();
  console.log(JSON.stringify(result, null, 2));
}
run().catch(e => console.error(e.message));
"
```

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Translations show `(ST)` suffix | NLLB model not loaded when translation ran | Delete bad translations and re-run with explicit `await ts.init()` |
| Translations are empty/null | No translation exists for requested locale | Run bulk auto-translate or check `_getTargetLanguages()` includes the language |
| `bulkAutoTranslate is not a function` | Container has old code | Rebuild: `docker compose -f docker-compose-t4.yaml up -d --build --force-recreate backend` |
| Translation takes very long | NLLB runs on CPU, 12 languages × N items | Expected — ~10-20 minutes for full corpus on first run |

### Architecture Notes

- Auto-translation is **non-blocking** — it runs after the save operation completes and won't fail the admin's request if translation fails
- The `bulkAutoTranslate()` method only generates translations for items that are **missing** — it won't overwrite manually entered translations
- Language codes are stored in **uppercase** in the DB (e.g., `ST`, `FR`, `EN`)
- The AQL query in `getAllCategoriesWithServices` uses case-insensitive comparison (`LOWER()`) for robustness
- If no translation exists for the requested locale, the system falls back to English, then to the `nameEN` field on the document
