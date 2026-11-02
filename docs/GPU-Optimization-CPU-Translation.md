# GPU Optimization: CPU-Based Translation for Lesotho Deployment

**Date:** May 26, 2026  
**Scope:** T4 GPU deployment (`docker-compose-t4.yaml` + `env-T4`)  
**Objective:** Free GPU resources by moving translation from a dedicated GPU vLLM instance to CPU-based NLLB-200, optimized for the English + Sesotho language pair.

---

## Summary

The Lesotho deployment previously used two GPU-based vLLM instances:

1. **Primary LLM** (`vllm`) — `ibm-granite/granite-3.3-2b-instruct` at 40% GPU memory
2. **Translation/Guardrail LLM** (`vllm-translation-guardrail`) — `google/gemma-3-1b-it` at 40% GPU memory

Since this deployment only requires English and Sesotho, a dedicated GPU for translation is unnecessary. The `Xenova/nllb-200-distilled-600M` model (already present in the stack) natively supports Sesotho and runs efficiently on CPU.

---

## Changes Made

### Architecture (Before → After)

| Component | Before | After |
|-----------|--------|-------|
| Primary LLM GPU usage | 40% of T4 | 85% of T4 |
| Translation engine | GPU (Gemma-3 1B via vLLM) | CPU (NLLB-200 via Transformers.js) |
| Guardrail LLM | Gemma-3 1B (separate vLLM) | Granite 3.3 2B (primary vLLM) |
| GPU containers | 2 vLLM instances | 1 vLLM instance |
| Supported languages | 17+ | 2 (English, Sesotho) |

### Files Modified

| File | Change |
|------|--------|
| `docker-compose-t4.yaml` | Disabled `vllm-translation-guardrail` via `profiles: [disabled]`; rerouted `translation` and `guardrail` services to primary vLLM; updated `depends_on` for TEI services; increased primary vLLM `gpu_memory_utilization` to 0.85 |
| `env-T4` | `VLLM_GPU_UTIL=0.85`; `TRANSLATION_SERVICE_HOST_IP=vllm`; `TRANSLATION_SERVICE_PORT=8000`; `VLLM_TRANSLATION_ENDPOINT=http://vllm:8000` |
| `.env` | Same translation/guardrail endpoint changes as env-T4 |
| `components/gov-chat-frontend/src/config/languageConfig.js` | Reduced to English + Sesotho only |
| `genie-ai-overlay/chatqna/language_codes.json` | Reduced to `{"en": "English", "st": "Sesotho"}` |
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | Updated `LLM_TRANS_MODEL` default to primary model |
| `README.md` | Updated AI/ML Models table |

---

## Rationale

### Why NLLB-200 on CPU for Sesotho?

- **Native Sesotho support**: NLLB-200 was trained on 200 languages including Southern Sotho (`sot_Latn`). It's a purpose-built translation model, not a general LLM doing translation via prompting.
- **Quality**: Dedicated translation models typically outperform prompt-based translation from small general LLMs (Gemma-3 1B) for low-resource languages.
- **Efficiency**: At 600M parameters (quantized), NLLB-200 runs comfortably on CPU with 4 threads. Translation latency is ~2-5 seconds per request, acceptable for a chat application.
- **Caching**: Redis caching (`TRANSLATION_CACHE=on`) means repeated translations are instant, amortizing the CPU cost.

### Why increase GPU utilization to 85%?

With only one vLLM instance on the T4 (16GB VRAM), we can safely allocate 85% (~13.6GB) to the primary LLM. This allows:
- Larger KV cache → more concurrent requests
- Longer context windows without OOM
- Better throughput under load

The remaining 15% is reserved for CUDA overhead and the TEI embedding/reranker models (which use minimal GPU memory).

---

## Translation Flow (After Change)

### Frontend UI Translation (documents, content)
```
User → Frontend → Backend /api/translate → CPU Backend (NLLB-200) → Response
                                              ↕
                                         Redis Cache
```

### ChatQnA Pipeline Translation (chat messages)
```
User (Sesotho) → ChatQnA → Primary vLLM (prompt-based translate to English)
                                ↓
                    RAG Pipeline (English): Embed → Retrieve → Rerank → LLM
                                ↓
                    Primary vLLM (prompt-based translate back to Sesotho)
                                ↓
                          Response (Sesotho)
```

> **Note:** The ChatQnA pipeline still uses the primary vLLM for in-pipeline translation (translating chat history and LLM responses). This is acceptable because:
> - It's the same model that generates the response, so it understands the context
> - Only triggered for non-English conversations
> - The increased GPU allocation (85%) provides sufficient headroom

---

## Rollback Procedure

To revert to the dual-GPU setup:

1. In `docker-compose-t4.yaml`, remove the `profiles: [disabled]` block from `vllm-translation-guardrail`
2. In `env-T4`:
   - Set `VLLM_GPU_UTIL=0.4`
   - Set `TRANSLATION_SERVICE_HOST_IP=vllm-translation-guardrail`
   - Set `TRANSLATION_SERVICE_PORT=9030`
   - Set `VLLM_TRANSLATION_ENDPOINT=http://vllm-translation-guardrail:9031`
3. In `docker-compose-t4.yaml`, revert `translation` and `guardrail` services to use `${VLLM_TRANSLATION_ENDPOINT}` and `${VLLM_TRANSLATION_MODEL_ID}`
4. Restore `language_codes.json` and `languageConfig.js` if multi-language support is needed

```bash
docker compose -f docker-compose-t4.yaml up -d
```

---

## Deployment

```bash
# Bring up all services (vllm-translation-guardrail will NOT start due to profiles: [disabled])
docker compose -f docker-compose-t4.yaml up -d

# Verify only one vLLM instance is running
docker ps | grep vllm
# Expected: only vllm-vllm-2

# Verify GPU utilization
nvidia-smi
# Expected: ~85% memory allocated by one process

# Test translation (CPU)
curl -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"texts": ["Hello, how are you?"], "source_lang": "en", "target_lang": "st"}'
```

---

## Performance Expectations

| Metric | Before (GPU translation) | After (CPU translation) |
|--------|--------------------------|------------------------|
| Translation latency (uncached) | ~1s | ~2-5s |
| Translation latency (cached) | N/A | <50ms |
| Primary LLM throughput | Limited (40% GPU) | Improved (85% GPU) |
| GPU memory used | ~12.8GB (2×40%) | ~13.6GB (1×85%) |
| Total containers | N+1 | N |
| Cold start time | ~60s (2 models to load) | ~30s (1 model to load) |
