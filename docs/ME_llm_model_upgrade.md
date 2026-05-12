# LLM Model Upgrade — Granite 3.3 2B → Qwen 2.5 7B

## What Changed

| Setting | Before | After |
|---|---|---|
| `VLLM_LLM_MODEL_ID` | `ibm-granite/granite-3.3-2b-instruct` | `Qwen/Qwen2.5-7B-Instruct` |
| `VLLM_MODEL_ID` | `ibm-granite/granite-3.3-2b-instruct` | `Qwen/Qwen2.5-7B-Instruct` |
| `LLM_MODEL` | `ibm-granite/granite-3.3-2b-instruct` | `Qwen/Qwen2.5-7B-Instruct` |
| `VLLM_GPU_UTIL` | `0.35` | `0.40` |
| `VLLM_MAX_MODEL_LEN` | `16384` | `8192` |
| `VLLM_DTYPE` | `half` (float16) | `auto` (bfloat16 on A40/A100) |
| `VLLM_TRANSLATION_GPU_UTIL` | `0.35` | `0.30` |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `8192` | `2048` |

Translation model (`google/gemma-3-4b-it`) is unchanged.

---

## Why Granite 3.3 2B Was Insufficient

The main vLLM instance serves three roles simultaneously: chat inference, chunk labeling, and graph extraction. Granite 3.3 2B failed at two of the three.

### Chunk Labeling

During document ingestion, the dataprep service sends each chunk to the LLM with a list of taxonomy labels and expects a strict JSON response:

```json
{"labels": ["Weather Forecasts", "Pest & Disease Management"]}
```

Granite 3.3 2B frequently returned malformed output — dicts inside the array, plain text instead of JSON, or invented labels. The labeling strategy had to be set to `LABELING_STRATEGY=embedding` (cosine similarity fallback) to avoid crashes. Embedding-based labeling is less accurate because it matches label names by vector distance rather than understanding the chunk's actual meaning.

### Graph Extraction

LangChain's `LLMGraphTransformer` extracts entities and relationships from each chunk and stores them in ArangoDB as a knowledge graph. It requires the LLM to return structured JSON with string fields for entity types and relationship names. Without function calling support, Granite 3.3 2B returned dicts instead of strings for these fields, causing `unhashable type: 'dict'` errors on every batch. Every ingested document had an empty knowledge graph — graph traversal during retrieval returned nothing.

### Chat Inference

Granite 3.3 2B is a capable 2B model but has limited reasoning depth for multi-fact agricultural queries. Answers were often incomplete or failed to synthesise across retrieved chunks correctly.

---

## Why Qwen 2.5 7B

### Reliable JSON Output for Labeling

Qwen 2.5 7B consistently returns correctly structured JSON for the labeling prompt. `LABELING_STRATEGY=llm` now works as intended, giving semantic label assignment based on actual chunk meaning rather than keyword matching.

### Function Calling for Graph Extraction

Qwen 2.5 7B has native function calling support. When `LLMGraphTransformer` calls the model with a structured tool schema, entity types and relationship fields are guaranteed to be strings. Graph extraction now succeeds — re-ingested documents populate `GRAPH_TEST_ENTITY` and `GRAPH_TEST_LINKS_TO` collections, enabling graph traversal during retrieval.

### Better RAG Inference Quality

The jump from 2B to 7B parameters meaningfully improves the model's ability to:
- Follow complex system prompt instructions (identity, scope, abstention rules)
- Synthesise answers from multiple retrieved chunks
- Produce well-structured, natural responses in English

### License

Both models are **Apache 2.0**. No license change, no additional restrictions.

---

## GPU Memory Budget (A40 — 44.35 GB usable)

| Service | Memory reserved |
|---|---|
| Main vLLM — Qwen 2.5 7B (`gpu_util=0.40`) | ~17.7 GB |
| Translation vLLM — Gemma 3 4B (`gpu_util=0.30`) | ~13.3 GB |
| TEI Embedding (bge-base-en-v1.5) | ~0.5 GB |
| TEI Reranker (ms-marco-MiniLM-L-6-v2) | ~0.4 GB |
| Docling GPU inference + other processes | ~8.5 GB |
| OS / CUDA overhead | ~1.0 GB |
| **Total** | **~41.4 GB** |

`VLLM_MAX_MODEL_LEN` was reduced from 16384 to 8192 for the main model. For RAG, retrieved chunks + system prompt + query rarely exceed 4000 tokens. Halving the context window significantly reduces KV cache pre-allocation, freeing headroom for the translation model.

`VLLM_TRANSLATION_MAX_MODEL_LEN` was reduced from 8192 to 2048. Translation prompts are always short — the full 8192 token window was wasted KV cache.

`VLLM_DTYPE` changed from `half` (float16) to `auto`. On A40/A100 (Ampere architecture), `auto` resolves to bfloat16, which has better numerical stability for inference at the same memory footprint. `half` was required on T4 (Turing) which does not support bfloat16.

---

## System Prompt Update

The system prompt was updated alongside the model upgrade to take advantage of Qwen's stronger instruction following.

**Before:** Overly restrictive scope rules (`"Short factual question = one or two sentence answer maximum"`, `"Answer ONLY what the user asked. Nothing else."`) produced terse, robotic responses with no personality.

**After:** Knowledge strictness rules are unchanged (no hallucination, no cross-chunk inference, no guessing). The scope rules were replaced with response style guidance:
- MEWA introduces itself and acknowledges questions warmly
- Lists use bullet points with a brief intro sentence
- Longer responses close with an offer to help further
- Unsolicited information is still suppressed

The factual accuracy guarantee is identical. The user experience is significantly improved.

---

## What Requires Re-Ingestion

Switching models does not automatically improve stored data. To get the full benefit of LLM-based labeling and graph extraction, **all documents must be deleted and re-uploaded** through the Admin Dashboard. The re-ingestion will:

1. Run chunks through Qwen for accurate taxonomy label assignment
2. Run `LLMGraphTransformer` through Qwen to populate the knowledge graph
3. Apply `_clean_chunk_text()` to remove `CropName.Month.WeekNumber` encoding
4. Emit synthetic aggregation chunks for stages and pests/diseases
