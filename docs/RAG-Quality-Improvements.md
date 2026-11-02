# RAG Quality Improvements — GENIE.AI Lesotho Deployment

**Document Version:** 1.2  
**Last Updated:** June 5, 2026  
**Project:** BDT 9LES25007 — Open-Source AI Agriculture Advisory Service for Lesotho  
**Hardware:** Azure NC4as_T4_v3 (1× NVIDIA T4 16GB, 4 vCPUs, 28GB RAM)

---

## Purpose

This document tracks ongoing quality improvements to the RAG (Retrieval-Augmented Generation) pipeline for the Lesotho deployment. It covers LLM selection, translation quality, GPU/CPU optimization, and planned experiments.

---

## Current Architecture (as of May 28, 2026)

| Component | Model / Engine | Runs on | Status |
|-----------|---------------|---------|--------|
| Primary LLM | `ibm-granite/granite-3.3-2b-instruct` | GPU (T4, 85%) | ✅ Active |
| Translation (UI) | `Xenova/nllb-200-distilled-600M` | CPU | ✅ Active |
| Translation (RAG pipeline) | `Xenova/nllb-200-distilled-600M` via backend API | CPU | ✅ Deployed |
| Guardrail | `ibm-granite/granite-3.3-2b-instruct` (primary vLLM) | GPU | ✅ Active |
| Embeddings | `BAAI/bge-m3` | GPU (TEI) | ✅ Active |
| Reranker | `cross-encoder/ms-marco-MiniLM-L-6-v2` | GPU (TEI) | ✅ Active |
| Vector store | ArangoDB (hybrid vector-graph) | CPU | ✅ Active |

---

## Completed Improvements

### 1. GPU Consolidation — Remove Dedicated Translation GPU (May 28, 2026)

**Problem:** Two vLLM instances sharing a single T4 GPU at 40% each, leaving both memory-starved.

**Change:** Removed `vllm-translation-guardrail` (Gemma-3 1B) container. Primary vLLM now uses 85% GPU memory.

**Impact:**
- Primary LLM throughput improved (larger KV cache, more concurrent requests)
- One fewer container to manage
- Cold start time reduced (~30s vs ~60s)

**Details:** [GPU-Optimization-CPU-Translation.md](GPU-Optimization-CPU-Translation.md)

---

### 2. NLLB Routing for ChatQnA Pipeline Translation (May 28, 2026)

**Problem:** Granite 2B doing Sesotho translation via prompting produced poor results — incorrect translations, responses in English instead of Sesotho, confusion with Afrikaans.

**Root cause:** Granite 3.3 2B has minimal Sesotho in its training data. Prompt-based translation ("Translate this to Sesotho...") is unreliable for low-resource languages with small generalist models.

**Change:** Rerouted ChatQnA pipeline translation from vLLM prompt-based to the backend's NLLB CPU service (`/api/translate`). NLLB-200 was explicitly trained on Southern Sotho (`sot_Latn`).

**Files modified:**
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — replaced `_translate_text_chunk` and `_get_translated_history_string` to call NLLB via backend API

**Expected impact:**
- Significantly better Sesotho↔English translation quality
- ~2-5s additional latency per Sesotho conversation (acceptable for chat)
- Cached translations via Redis reduce repeated translation cost

---

### 3. Language Scope Reduction (May 28, 2026)

**Change:** Limited supported languages to English + Sesotho only (was 17 languages).

**Files modified:**
- `components/gov-chat-frontend/src/config/languageConfig.js`
- `genie-ai-overlay/chatqna/language_codes.json`

**Rationale:** Lesotho deployment only needs two languages. Removing others simplifies the UI and prevents users from selecting languages with poor support.

---

### 4. vLLM Context Window Increase (May 29, 2026)

**Problem:** With 85% GPU utilization, vLLM allocated ~105K tokens of KV cache capacity but `max_model_len` was set to only 8,192 tokens — using less than 8% of available cache. This limited conversation length and RAG context size unnecessarily.

**Change:** Increased `VLLM_MAX_MODEL_LEN` from 8,192 to 16,384 tokens. Added `MAX_MODEL_LEN_TEXTGEN=8192` to control the chatqna prompt construction budget.

**Configuration (env-T4):**

| Variable | Before | After | Purpose |
|----------|--------|-------|---------|
| `VLLM_MAX_MODEL_LEN` | 8192 | 16384 | vLLM's maximum context window (KV cache allocation per sequence) |
| `MAX_MODEL_LEN_TEXTGEN` | 4096 (default) | 8192 | ChatQnA prompt budget (system prompt + history + RAG content + response) |

**How these relate:**
- `VLLM_MAX_MODEL_LEN` = the hard ceiling vLLM enforces per request. Set to 16K to allow longer sequences.
- `MAX_MODEL_LEN_TEXTGEN` = the soft budget the chatqna service uses when constructing prompts. Set lower than vLLM's max to leave headroom for concurrent requests and avoid truncation edge cases.
- `max_tokens` (per request, default 1024) = the maximum response length. Subtracted from `MAX_MODEL_LEN_TEXTGEN` to determine how much space is available for the prompt.

**Observed vLLM metrics (T4, 85% GPU, Granite 2B):**

| Metric | Value |
|--------|-------|
| Available KV cache memory | ~8 GB |
| KV cache capacity | ~105,000 tokens |
| Peak KV cache usage (single request) | ~1.3% |
| Prefix cache hit rate | up to 82% |

**Impact:**
- Longer conversations can be maintained without truncation
- More RAG context (retrieved documents) can be included in prompts
- Better response quality for complex multi-turn agricultural advisory chats
- No performance penalty — KV cache capacity is far from saturated

---

### 5. Gateway Timeout Increase (May 29, 2026)

**Problem:** With NLLB translation added to the RAG pipeline, total request time increased to 60-90s (input translation ~8s + RAG pipeline ~15s + LLM generation ~15s + output translation ~37s). The default 60s timeout in Nginx and Kong caused 504 Gateway Timeout errors.

**Change:** Increased proxy timeouts from 60s to 180s in both Nginx and Kong.

**Files modified:**
- `api-gateway-solution/nginx/conf/default.conf` — added `proxy_read_timeout 180s`, `proxy_send_timeout 180s`, `proxy_connect_timeout 30s` to the `/api/` location
- `api-gateway-solution/new-config/kong_config.json` — updated `express-api` service: `read_timeout: 180000`, `write_timeout: 180000`, `connect_timeout: 30000`

**Kong live update (for running instance):**
```bash
curl -s -X PATCH http://localhost:8001/services/express-api \
  -d "read_timeout=180000" \
  -d "write_timeout=180000" \
  -d "connect_timeout=30000"
```

**Nginx reload (after git pull):**
```bash
docker exec nginx nginx -s reload
```

**Note:** The Kong timeout change via admin API is in-memory. The `kong_config.json` backup ensures persistence across container restarts when restored via the `restore-kong-config.sh` script.

---

## Under Investigation

### 4. Primary LLM Replacement — Candidate Comparison

**Status:** 🔍 Evaluating  
**Updated:** June 5, 2026

Three local candidates from the [AfriqueLLM suite](https://huggingface.co/collections/McGill-NLP/afriquellm) by McGill-NLP — a collection of models adapted to 20 African languages (including Southern Sotho / `sot_Latn`) through continued pre-training on ~26B tokens — plus a cloud-hosted API option. The comparison covers model architecture, size, deployment feasibility, and operational trade-offs.

#### Head-to-Head Comparison

| Attribute | Granite 3.3 2B (current) | AfriqueGemma-4B | AfriqueQwen-14B | Cloud API (GPT-4o / Claude) |
|-----------|--------------------------|-----------------|-----------------|----------------------------|
| Parameters | 2B | 4B | 14B (15B stored) | N/A (hosted) |
| Base model | IBM Granite | Google Gemma 3 4B PT | Alibaba Qwen 3 14B Base | Proprietary |
| Sesotho support | Minimal (low-resource) | ✅ Explicit (`sot_Latn`) | ✅ Explicit (`sot_Latn`) | ✅ Strong multilingual |
| Training data (CPT) | Enterprise English-focused | ~26B tokens, 20 African langs | ~26B tokens, 20 African langs | Massive (undisclosed) |
| African lang benchmark avg | ~40.3 | **47.9** (+18.8% over base) | **63.6** (+57.8% over base) | Not benchmarked (expected high) |
| Context length (native) | 8,192 | 8,192 | **32,768** | **128K+** |
| VRAM FP16 | ~4 GB | ~8 GB | ~28 GB ❌ | 0 GB (remote) |
| VRAM AWQ 4-bit | — | ~2.5 GB | ~8 GB | N/A |
| Fits T4 16GB (FP16) | ✅ easily | ⚠️ tight w/ TEI | ❌ No | ✅ No GPU needed |
| Fits T4 16GB (4-bit quant) | — | ✅ comfortably | ⚠️ possible (~8GB + TEI) | N/A |
| vLLM compatible | ✅ | ✅ | ✅ | ✅ (OpenAI-compatible API) |
| Model type | Instruct-tuned | Base (CPT only) | Base (CPT only) | Instruct-tuned (best-in-class) |
| License | Apache 2.0 | CC BY 4.0 | CC BY 4.0 | Proprietary (pay-per-token) |
| Community adoption | Moderate | 732 downloads/month | 1,523 downloads/month | Industry standard |
| Data stays on-premise | ✅ | ✅ | ✅ | ❌ Queries go external |

#### Benchmark Details (AfriqueLLM Paper Evaluation)

From the [AfriqueLLM paper](https://arxiv.org/abs/2601.06395), average across African language benchmarks:

| Model | Avg Score | Δ vs Base | Notes |
|-------|-----------|-----------|-------|
| Gemma 3 4B (base) | 40.31 | — | Pre-CPT baseline |
| **AfriqueGemma-4B** | **47.88** | +7.6 (+18.8%) | Best Gemma-based at 4B |
| Qwen 3 14B (base) | 40.29 | — | Pre-CPT baseline |
| **AfriqueQwen-14B** | **63.58** | +23.3 (+57.8%) | **Flagship, best overall** |
| AfriqueQwen-8B | 59.08 | +25.6 (vs Qwen3-8B) | Middle ground option |
| Gemma 3 27B | 60.71 | — | Reference (no CPT) |

Key takeaway: <REDACTED> (63.58) outperforms even the unmodified Gemma 3 27B (60.71), making it the strongest open African language model available. AfriqueGemma-4B is the best option in the ≤4B parameter range.

---

#### Option A: AfriqueGemma-4B (Conservative Upgrade)

**Rationale:** Drop-in replacement for Granite 2B on the existing T4 hardware.

**Pros:**
- Native Sesotho understanding — could eliminate translation step for chat
- Fits on T4 in FP16 (~8GB) leaving room for TEI embeddings/reranker
- With AWQ 4-bit (~2.5GB), leaves ample headroom for KV cache
- Same context length (8K) — no pipeline changes needed
- 18.8% improvement over base Gemma on African benchmarks
- vLLM-native deployment, same infrastructure as current setup

**Cons:**
- Base model only — no instruction tuning. Will need prompt engineering or fine-tuning for chat/RAG
- CC BY 4.0 license (vs project's Apache 2.0) — requires attribution
- Smaller capacity for complex English reasoning compared to larger models
- 8K context may limit future long-document RAG scenarios
- Moderate benchmark improvement (+7.6 absolute points)

**Deployment on current hardware (NC4as_T4_v3):**
```
# FP16 (tight but works)
VLLM_GPU_MEMORY_UTILIZATION=0.55  # ~8GB for model, ~5GB for TEI
VLLM_MAX_MODEL_LEN=4096           # Reduced to fit KV cache

# AWQ 4-bit (recommended)
VLLM_GPU_MEMORY_UTILIZATION=0.85  # ~2.5GB model + generous KV cache
VLLM_MAX_MODEL_LEN=8192           # Full context preserved
```

---

#### Option B: AfriqueQwen-14B (Performance Upgrade)

**Rationale:** Best-in-class African language model. Requires hardware upgrade or aggressive quantization.

**Pros:**
- Strongest African language benchmark score available (63.58 avg)
- 32K native context — excellent for long-document RAG and multi-turn conversations
- Qwen 3 architecture excels at preserving high-resource language performance after CPT
- Could potentially eliminate NLLB translation entirely (native Sesotho in + out)
- Better English instruction-following than 4B models (larger capacity)
- Higher community adoption (1,523 downloads/month vs 732)
- McGill-NLP researchers note Qwen3 models best preserve performance in high-resource languages after CPT

**Cons:**
- Does NOT fit T4 in FP16 (~28GB VRAM needed)
- AWQ 4-bit (~8GB) is feasible on T4 but leaves minimal room for TEI models
- Requires either VM upgrade or aggressive quantization strategy
- Base model only — same instruction-tuning gap as AfriqueGemma-4B
- Higher latency due to larger model (tokens/sec will be lower)
- CC BY 4.0 license — requires attribution

**Deployment scenarios:**

| Scenario | Hardware | Quantization | VRAM Budget | Feasibility |
|----------|----------|-------------|-------------|-------------|
| A: Current VM | NC4as_T4_v3 (T4 16GB) | AWQ 4-bit | ~8GB model + ~3GB TEI = 11GB | ⚠️ Tight, `max_model_len≤4096` |
| B: VM upgrade | NC8as_T4_v3 (T4 16GB, 8 vCPU) | AWQ 4-bit | Same GPU, better CPU | ⚠️ Same GPU constraint |
| C: GPU upgrade | NC6s_v3 (V100 16GB) | AWQ 4-bit | Same 16GB limit | ⚠️ Same constraint |
| D: GPU upgrade | NC12s_v3 (2× V100) | FP16 on 1 GPU + TEI on other | 16+16 GB | ✅ Comfortable |
| E: GPU upgrade | NC24ads_A100_v4 (A100 80GB) | FP16 | 28GB model + TEI = ~32GB | ✅ Ideal |
| F: Current VM | NC4as_T4_v3 | GPTQ 3-bit | ~6GB model + 3GB TEI | ⚠️ Quality risk |

**Recommended deployment (current T4):**
```
# AWQ 4-bit quantization on T4
vllm serve McGill-NLP/AfriqueQwen-14B \
  --quantization awq \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.60 \
  --dtype half

# TEI embeddings on remaining GPU (~3-4GB)
# Or move TEI to CPU if GPU memory too tight
```

---

#### Option C: Cloud-Hosted LLM API (Azure OpenAI / AWS Bedrock / OpenAI)

**Rationale:** Offload the primary LLM to a cloud API. Keep all other components (TEI embeddings, TEI reranker, ArangoDB, NLLB translation, guardrails, frontend, backend) running locally on the T4 VM. Eliminates GPU constraints for the LLM while leveraging best-in-class instruct-tuned models with native Sesotho support.

**Architecture change:**
```
Current:  User → ChatQnA → vLLM (local T4, GPU) → response
Option C: User → ChatQnA → Azure OpenAI / AWS Bedrock API → response
```

The chatqna service already communicates with vLLM via an OpenAI-compatible `/v1/chat/completions` endpoint. Azure OpenAI and OpenAI expose the same interface, making the integration change minimal:

```env
# Before (local vLLM)
VLLM_ENDPOINT=http://vllm:8000
VLLM_LLM_MODEL_ID=ibm-granite/granite-3.3-2b-instruct

# After (Azure OpenAI example)
VLLM_ENDPOINT=https://<deployment>.openai.azure.com
VLLM_LLM_MODEL_ID=gpt-4o
OPENAI_API_KEY=<key>
OPENAI_API_VERSION=2024-02-01
```

**Pros:**
- Access to best-in-class instruct-tuned models (GPT-4o, Claude 3.5/4, Gemini) with excellent Sesotho and multilingual support
- No instruction-tuning gap — these models are heavily RLHF'd for chat/RAG use cases
- Could eliminate NLLB translation entirely (native Sesotho input/output capability)
- Frees T4 GPU entirely for TEI embeddings, reranker, and dataprep
- 128K+ context window — far beyond any local option
- Scales automatically — no concurrent-request ceiling from KV cache limits
- Could potentially downgrade VM (remove GPU requirement) for significant cost savings on compute
- Minimal code changes required (same OpenAI-compatible API interface)
- Latency could improve overall: eliminates NLLB round-trip (~45s) even though API adds network latency (~2-5s)

**Cons:**
- Data sovereignty concern — user queries and RAG context leave the infrastructure. For a government/ITU project in Lesotho, this may require policy approval
- Recurring per-token cost (estimated $50-200/month for low-traffic pilot; scales with usage)
- Internet dependency — service unavailable if connectivity drops (relevant for rural Lesotho infrastructure)
- Vendor lock-in risk — pricing and availability controlled by third party
- Project positioning conflict — "Open-Source AI Agriculture Advisory" using proprietary APIs is a philosophical trade-off
- Guardrail service would also need to call the external API (or be reworked)

**Cost estimate (low-traffic agricultural advisory):**

| Provider | Model | Input cost | Output cost | Est. monthly (1000 queries/day) |
|----------|-------|-----------|-------------|--------------------------------|
| OpenAI | GPT-4o | $2.50/1M tokens | $10/1M tokens | ~$75-150 |
| OpenAI | GPT-4o-mini | $0.15/1M tokens | $0.60/1M tokens | ~$5-15 |
| Azure OpenAI | GPT-4o | Same as OpenAI | Same as OpenAI | ~$75-150 |
| AWS Bedrock | Claude 3.5 Sonnet | $3/1M tokens | $15/1M tokens | ~$100-200 |
| AWS Bedrock | Claude 3.5 Haiku | $0.25/1M tokens | $1.25/1M tokens | ~$10-25 |

**Note:** GPT-4o-mini or Claude Haiku could be a cost-effective middle ground — strong instruction-following, good multilingual support, at a fraction of the flagship model cost.

**Key decision factors:**
1. **Data sovereignty** — Does the Government of Lesotho / ITU policy allow agricultural queries to transit through external cloud APIs? Even if documents stay local, queries + generated answers pass externally.
2. **Open-source alignment** — The RAG infrastructure (retriever, reranker, embeddings, vector DB) remains fully open-source. Only the LLM generation is proprietary. Is this an acceptable hybrid?
3. **Connectivity reliability** — Is the Azure/AWS region connectivity from the VM reliable enough for production use?
4. **Cost predictability** — Local vLLM has fixed compute cost (VM rental). Cloud APIs scale with usage. For a national-scale rollout with thousands of farmers, costs could increase significantly.

**Hybrid approach (recommended for evaluation):**
Use cloud API during development and testing to establish quality baselines for Sesotho responses. This provides immediate access to best-quality outputs without any model deployment effort. Then decide whether to:
- Stay on cloud API if data sovereignty is cleared and costs are acceptable
- Deploy a local model (AfriqueGemma-4B or AfriqueQwen3.5-4B-ExtendedCM) for production, using the cloud outputs as a quality target for prompt engineering or fine-tuning

---

#### Important Note: Base Model vs Instruct Model Gap

Options A and B (AfriqueGemma-4B, AfriqueQwen-14B) are **base/CPT models only** — they have not been instruction-tuned. This is a significant concern for RAG applications:

- **Base models** predict the next token based on statistical patterns. They don't inherently understand they should *answer questions*, *follow system prompts*, or *stop generating* at appropriate points.
- **Instruct models** (like Granite 2B or cloud APIs) have been explicitly trained to follow instructions, stay grounded in provided context, and produce well-formatted responses.

**Impact on RAG specifically:**
- In a RAG pipeline, much of the work (retrieval, reranking, prompt construction) is done upstream, which partially mitigates the base-model gap
- However, base models may: ignore provided context in favor of parametric memory, fail to stop generating cleanly, produce inconsistent output formats, or break guardrail evaluation prompts
- Estimated reliability without instruction tuning: ~80% of responses acceptable, ~15% needing prompt adjustments, ~5% genuinely broken

**Mitigation strategies:**
1. Prompt engineering with few-shot examples showing expected input/output format
2. Strict stop-token configuration in vLLM to prevent runaway generation
3. Fine-tuning on a small instruction dataset (1,000+ examples) — most effective but requires effort
4. Using the instruct-tuned base model's chat template (e.g., Gemma-3-IT template) even though the CPT model wasn't trained on it

**Note on quantization availability (June 5, 2026):** No pre-quantized AWQ or GPTQ version of AfriqueGemma-4B exists on HuggingFace. GGUF versions are available ([mradermacher/AfriqueGemma-4B-GGUF](https://huggingface.co/mradermacher/AfriqueGemma-4B-GGUF)) but are not vLLM-compatible. AWQ quantization would need to be performed manually using AutoAWQ (straightforward, ~30 minutes on a GPU machine). Initial testing should use FP16 directly to validate quality before quantizing.

---

#### Recommendation

| Priority | Recommendation | Justification |
|----------|---------------|---------------|
| **Immediate (testing)** | Test **Cloud API** (GPT-4o-mini or Claude Haiku) | Establish Sesotho quality baseline with zero deployment effort. Validates whether translation step can be eliminated. |
| **Short-term (production, if data sovereignty cleared)** | Deploy **Cloud API** (GPT-4o-mini) | Best instruction-following, native Sesotho, no hardware constraints, low cost at pilot scale |
| **Short-term (production, if data must stay local)** | Deploy **AfriqueGemma-4B** FP16 on current T4 | Zero hardware changes, immediate Sesotho improvement, but requires prompt engineering for chat viability |
| **Medium-term (if budget allows)** | Upgrade to **AfriqueQwen-14B** AWQ 4-bit or **AfriqueQwen3.5-4B-ExtendedCM** | Best local quality, validate quantization loss first |
| **Long-term (ideal local)** | **AfriqueQwen-14B** FP16 on A100 or 2× V100 | Full model quality, 32K context, no quantization trade-offs |

**Decision factors:**
- If data sovereignty is not a blocker → Cloud API is the fastest path to high-quality Sesotho responses
- If data must stay fully on-premise → AfriqueGemma-4B (short-term) or AfriqueQwen3.5-4B-ExtendedCM (best 4B-class option)
- If staying on current hardware with minimal disruption → AfriqueGemma-4B
- Both local Afrique models need instruction-tuning or careful prompting for RAG chat use cases

---

#### Shared Next Steps

- [ ] **Cloud API test** — Set up Azure OpenAI or OpenAI endpoint, run 20 queries (10 EN, 10 Sesotho) through the RAG pipeline to establish quality baseline
- [ ] **Data sovereignty review** — Confirm with ITU/Lesotho stakeholders whether cloud API inference is acceptable for agricultural advisory queries
- [ ] Verify chat viability without instruction tuning (AfriqueGemma-4B and AfriqueQwen3.5-4B-ExtendedCM are base/CPT models — test with system prompts)
- [ ] Test AfriqueGemma-4B FP16 on current T4 (no AWQ available pre-built; test FP16 first, quantize later if viable)
- [ ] Test AfriqueQwen-14B AWQ 4-bit on current T4 (measure if TEI coexistence is feasible)
- [ ] Benchmark Sesotho generation quality: Cloud API vs AfriqueGemma-4B vs AfriqueQwen-14B vs Granite+NLLB
- [ ] Evaluate if translation step can be eliminated for chat flow with cloud API and/or Afrique models
- [ ] Measure latency: cloud API round-trip vs local vLLM + NLLB translation overhead
- [ ] Cost analysis: Cloud API at projected usage vs VM upgrade to A100 vs staying on T4 with quantized models
- [ ] Test local models' instruction-following with RAG-style prompts (retrieve + answer format)
- [ ] If AfriqueGemma-4B quality is viable, perform AWQ quantization using AutoAWQ

---

### 5. Alternative LLM Candidates (Updated)

| Model | Size | Sesotho | Benchmark Avg | Notes |
|-------|------|---------|---------------|-------|
| [McGill-NLP/AfriqueQwen-14B](https://huggingface.co/McGill-NLP/AfriqueQwen-14B) | 14B | ✅ (explicit) | **63.58** | 🏆 Flagship AfriqueLLM. Needs quantization or GPU upgrade. CC BY 4.0. |
| [McGill-NLP/AfriqueQwen-8B](https://huggingface.co/McGill-NLP/AfriqueQwen-8B) | 8B | ✅ (explicit) | **59.08** | Strong middle ground. ~16GB FP16, ~4.5GB AWQ. CC BY 4.0. |
| [McGill-NLP/AfriqueGemma-4B](https://huggingface.co/McGill-NLP/AfriqueGemma-4B) | 4B | ✅ (explicit) | **47.88** | Best ≤4B option. Fits T4 easily. CC BY 4.0. |
| [McGill-NLP/AfriqueQwen3.5-4B-ExtendedCM](https://huggingface.co/McGill-NLP/AfriqueQwen3.5-4B-ExtendedCM) | 4B | ✅ (explicit) | **58.26** | Qwen 3.5 base, ~34B training tokens. Best 4B-class option. CC BY 4.0. |
| [CohereLabs/tiny-aya-earth](https://huggingface.co/CohereLabs/tiny-aya-earth) | 3.35B | ✅ (70+ langs) | — | African/West Asian variant. SOTA translation at this size. Apache 2.0. |
| [lelapa/InkubaLM-0.4B](https://huggingface.co/lelapa/InkubaLM-0.4B) | 0.4B | ✅ | — | Tiny, African-focused. Good for understanding tasks, limited generation. |
| [McGill-NLP/AfriqueLlama-8B](https://huggingface.co/McGill-NLP/AfriqueLlama-8B) | 8B | ✅ | **49.41** | Llama-based. Less impressive improvement than Qwen variants. |

**Note:** The AfriqueQwen3.5-4B-ExtendedCM (58.26 avg) is a notable discovery — it achieves benchmark scores close to the 8B models while fitting in a 4B footprint. This should also be evaluated as a potential "best of both worlds" option for the T4 hardware.

**Evaluation criteria:**
1. Sesotho generation quality (can it respond directly in Sesotho?)
2. English instruction-following (RAG context comprehension)
3. VRAM fit on T4 (≤13GB with KV cache)
4. vLLM compatibility
5. License compatibility (project is Apache 2.0, CC BY 4.0 requires attribution)

---

### 6. Translation Quality — Further Improvements

**Current state:** NLLB-200 distilled 600M handles English↔Sesotho translation.

**Potential upgrades:**
- `facebook/nllb-200-1.3B` — larger NLLB variant, better quality, still runs on CPU (~5GB RAM)
- Fine-tuning NLLB on agriculture-specific Sesotho terminology
- Building a parallel corpus from existing translated agricultural documents in the knowledge base

**Open questions:**
- Is NLLB-200 600M quality sufficient for agricultural advisory content?
- Are there domain-specific translation errors (crop names, farming techniques)?
- Would a glossary/terminology override improve specific terms?

---

### 7. Embedding Model for Sesotho

**Current:** `BAAI/bge-m3` — multilingual embedding model supporting 100+ languages.

**Question:** Does BGE-M3 embed Sesotho text effectively for retrieval? If documents are in English but queries come in Sesotho (translated to English via NLLB before embedding), this may not be an issue. But if we move to native Sesotho processing (with AfriqueGemma or AfriqueQwen), we'd need embeddings that understand Sesotho directly.

**Candidates to evaluate:**
- `BAAI/bge-m3` (current) — likely adequate since it's multilingual
- `dsfsi/zabantu-xlm-roberta` — specifically trained on Southern African languages including Sesotho
- `Davlan/afro-xlmr-large` — trained on 17 African languages including Sesotho

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| May 28, 2026 | Remove GPU translation container | Free GPU for primary LLM, Sesotho translation better served by NLLB |
| May 28, 2026 | Route ChatQnA translation to NLLB | Granite 2B cannot translate Sesotho reliably via prompting |
| May 28, 2026 | Limit languages to EN + ST | Lesotho deployment only needs two languages |
| May 28, 2026 | Increase vLLM GPU util to 85% | Only one GPU model now, maximize throughput |
| May 29, 2026 | Increase VLLM_MAX_MODEL_LEN to 16384 | KV cache capacity (~105K tokens) was vastly underutilized at 8192 |
| May 29, 2026 | Set MAX_MODEL_LEN_TEXTGEN to 8192 | Allow larger prompts (more history + RAG context) while leaving headroom |
| May 29, 2026 | Increase gateway timeouts to 180s | NLLB translation adds 40-50s to request time, exceeding default 60s timeout |
| June 3, 2026 | Expanded LLM evaluation | Added AfriqueQwen-14B comparison. Recommended AfriqueGemma-4B (short-term) and AfriqueQwen-14B (medium-term with HW upgrade) |
| June 5, 2026 | Added Cloud API option (Option C) | Cloud-hosted LLM (GPT-4o/Claude) eliminates instruction-tuning gap and GPU constraints. Best quality path if data sovereignty is cleared. Added analysis of base-model vs instruct-model implications for RAG. |
| TBD | Primary LLM selection | Evaluating AfriqueGemma-4B vs AfriqueQwen-14B vs AfriqueQwen3.5-4B-ExtendedCM vs Cloud API |

---

## Testing Methodology

For evaluating translation and generation quality:

1. **Manual evaluation** — Native Sesotho speakers assess translation accuracy and naturalness
2. **Agricultural domain test set** — Curated questions about farming practices in Sesotho
3. **Round-trip translation** — Sesotho → English → Sesotho, measure semantic preservation
4. **Response relevance** — Does the RAG pipeline retrieve correct documents when query is in Sesotho?
5. **Latency measurement** — End-to-end response time for Sesotho conversations

---

## Related Documents

- [GPU Optimization: CPU-Based Translation](GPU-Optimization-CPU-Translation.md)
- [Translation Service Plan](translation-service-plan.md) (historical — partially superseded)
- [GENIE.AI Installation & Configuration Guide](../GENIE.AI-Installation-Configuration-Guide.md)
