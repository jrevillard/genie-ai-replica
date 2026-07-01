---
title: Choosing and Configuring Models
description: "Selecting and configuring models for GENIE.AI (LLM, embedding, reranker, translation) across GPU profiles."
weight: 7
---

## Overview

GENIE.AI uses a **multi-model architecture** where different AI models serve distinct purposes across the entire framework — from document ingestion and knowledge graph construction through to retrieval, reranking, and response generation. Not every model is suitable for every role. Choosing the wrong model for a given purpose will cause silent failures — ingestion batches being skipped, labels returning garbage, or graph data not being created.

This guide explains what each model does, what capabilities it **must** have, what license it is released under, and provides specific recommendations for both open-source and commercial models across different hardware tiers.

---

## Model Licensing — What You Need to Know

Every model has a license that governs how you can use it. **This is your responsibility to verify before deployment.** Licenses can change between model versions. The information below was accurate at the time of writing but you should always check the model card on HuggingFace for the latest terms.

### License Categories

| License | Commercial Use | Modification | Distribution | Notable Restriction |
|---------|---------------|-------------|--------------|---------------------|
| **Apache 2.0** | Yes | Yes | Yes | None. Most permissive. |
| **MIT** | Yes | Yes | Yes | None. Most permissive. |
| **Gemma Terms of Use** | Yes | Yes | Yes | >700M monthly users must request permission. |
| **Llama 3.x Community License** | Yes | Yes | Yes | >700M monthly users must request license. |
| **Mistral AI License** | Yes | Yes | Yes | Some restrictions on competitive use. |
| **OpenAI Terms of Service** | Yes (paid) | N/A | No | Usage-based pricing. No weight access. |
| **Anthropic Terms of Service** | Yes (paid) | N/A | No | Usage-based pricing. No weight access. |
| **Google Cloud Terms** | Yes (paid) | N/A | No | Usage-based pricing. No weight access. |

> **Important:** If you are deploying GENIE.AI for a government, enterprise, or high-traffic public service, check whether your expected monthly active users exceed 700 million. If so, models under the Gemma and Llama community licenses require you to request a special license from Google or Meta respectively.

---

## The Framework Pipeline: Where Models Are Used

Understanding where each model fits in the GENIE.AI pipeline helps you make informed choices:

```
DOCUMENT INGESTION PIPELINE:
                                                                                    
  Upload → Docling/OCR → Chunking → Guardrails → Labeling → Graph Extraction → Embedding → ArangoDB
              (GPU)       (config)    (optional)    (LLM)    (LLM + FC?)      (TEI)
                                           ↑          ↑           ↑               ↑
                                      Translation  Translation  Translation    Translation
                                      LLM (shared)  LLM (shared)  LLM (shared)  (separate vLLM)

QUERY PIPELINE:

  User Query → Translation → Embedding → Retrieval → Graph Traversal → Reranking → LLM Inference → Response
                 (vLLM)       (TEI)     (ArangoDB)   (optional)       (TEI)        (vLLM)
```

---

## The Six Model Roles

GENIE.AI has **six distinct AI model roles**, served by **two vLLM instances** and **two TEI instances**:

| # | Role | Docker Service | Config Variable | Shared With | License Sensitivity |
|---|------|---------------|-----------------|-------------|-------------------|
| 1 | **Main Inference** (Chat/QnA) | `vllm` | `VLLM_LLM_MODEL_ID` | Labeling, Graph Extraction | High — visible to users |
| 2 | **Chunk Labeling** | `vllm` (same) | `VLLM_MODEL_ID` | Main Inference, Graph Extraction | Low — internal pipeline |
| 3 | **Graph Extraction** | `vllm` (same) | `VLLM_MODEL_ID` | Main Inference, Labeling | Low — internal pipeline |
| 4 | **Translation & Guardrails** | `vllm-translation-guardrail` | `VLLM_TRANSLATION_MODEL_ID` | Guardrails | Medium — user-facing |
| 5 | **Embeddings** | `tei` | `EMBEDDING_MODEL_ID` | — | Low — internal pipeline |
| 6 | **Reranking** | `tei_reranker` | `RERANKER_MODEL_ID` | — | Low — internal pipeline |

**Critical architecture point:** Roles 1, 2, and 3 **all share the same vLLM instance** (the main inference server at `http://vllm:8000`). The model you choose for `VLLM_LLM_MODEL_ID` must be capable of serving **all three** of these roles simultaneously. Role 4 (Translation) has its own dedicated vLLM instance. In docker-compose, `VLLM_MODEL_ID` is derived from `VLLM_LLM_MODEL_ID`, so setting the latter configures all three shared roles — you only set one.

---

## Role 1: Main Inference (Chat/QnA)

### What It Does

This is the "brain" of the chatbot. It receives the user's query along with retrieved document chunks from the RAG pipeline and generates a natural language answer. It is the most visible model in the system and has the greatest impact on answer quality.

### Required Capabilities

| Capability | Required | Notes |
|-----------|----------|-------|
| Chat completion API | Yes | Must support OpenAI-compatible `/v1/chat/completions` |
| Function calling | No | Not used for inference |
| Context window | 4K+ tokens | Larger is better for RAG (retrieved chunks consume context) |
| JSON output | No | Answers are free-text |
| Multi-language | Optional | Only needed if serving non-English queries directly |

### How It Is Called

The ChatQnA orchestrator sends retrieved chunks as system/user context and asks the model to answer the user's question. The `CHATQNA_SYSTEM_PROMPT` environment variable controls the instruction framing.

### Model Recommendations

#### Open Source

| Model | Params | VRAM (FP16) | VRAM (INT8/AWQ) | License | Strengths | Weaknesses |
|-------|--------|-------------|-----------------|---------|-----------|------------|
| **Qwen 2.5 7B** | 7B | ~14 GB | ~8 GB | Apache 2.0 | Excellent multilingual, strong reasoning, function calling | Large for constrained GPUs |
| **Qwen 2.5 14B** | 14B | ~28 GB | ~16 GB | Apache 2.0 | Very strong reasoning, good for complex RAG | Needs 24GB+ GPU |
| **Llama 3.1 8B** | 8B | ~16 GB | ~8 GB | Llama 3.x Community | Good all-round, strong instruction following, function calling | Weaker on multilingual than Qwen |
| **Llama 3.1 70B-Instruct-AWQ** | 70B (4-bit) | ~40 GB | ~40 GB | Llama 3.x Community | Enterprise-grade quality | Requires 48GB+ GPU |
| **Mistral 7B v0.3** | 7B | ~14 GB | ~8 GB | Apache 2.0 | Fast, efficient, good at following formats | Less capable than Llama 3.1 or Qwen |
| **Gemma 3 12B** | 12B | ~24 GB | ~12 GB | Gemma Terms of Use | Good multilingual, strong for its size | No function calling support |
| **Gemma 3 4B** | 4B | ~8 GB | ~5 GB | Gemma Terms of Use | Fits on small GPUs, multilingual | Limited reasoning depth |
| **Granite 3.3 2B** | 2B | ~4 GB | ~3 GB | Apache 2.0 | Very small footprint | Limited quality for complex RAG |
| **Granite 3.3 8B** | 8B | ~16 GB | ~8 GB | Apache 2.0 | Good instruction following | Less capable than Qwen/Llama at same size |
| **Phi-4-mini** | 3.8B | ~8 GB | ~5 GB | MIT | Strong reasoning for its size | Newer, less community validation |

#### Commercial (API-based)

| Provider | Model | License | Notes |
|----------|-------|---------|-------|
| **OpenAI** | GPT-4o, GPT-4o-mini | OpenAI ToS (paid) | Best overall quality. Requires OpenAI-compatible proxy or code change. |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Haiku | Anthropic ToS (paid) | Excellent RAG performance. Requires API integration. |
| **Google** | Gemini 2.0 Flash, Gemini 1.5 Pro | Google Cloud ToS (paid) | Strong multilingual. Access via Vertex AI or API. |
| **AWS** | Amazon Bedrock (Claude, Titan, etc.) | AWS ToS (paid) | For AWS-hosted deployments. |
| **Azure** | Azure OpenAI (GPT-4o, etc.) | Microsoft ToS (paid) | For Azure-hosted deployments. |

> **Note on commercial models:** The default GENIE.AI architecture uses local vLLM instances. To use commercial API-based models, you would need to configure `VLLM_ENDPOINT` to point to an OpenAI-compatible proxy that routes to the commercial API, or modify the ChatQnA orchestrator code.

### Configuration

```bash
# In your .env file
VLLM_LLM_MODEL_ID=Qwen/Qwen2.5-7B-Instruct
VLLM_GPU_UTILIZATION=0.6
VLLM_MAX_MODEL_LEN=65536
VLLM_DTYPE=auto
```

---

## Role 2: Chunk Labeling

### What It Does

During document ingestion, the dataprep service sends each chunk of text to the LLM along with the full taxonomy (list of labels). The LLM must return a JSON response selecting 1–4 labels from the taxonomy that best match the chunk content.

### Required Capabilities

| Capability | Required | Notes |
|-----------|----------|-------|
| Chat completion API | Yes | Must support OpenAI-compatible `/v1/chat/completions` |
| Guided JSON output | **Yes** | Must support `response_format={"type": "json_object"}` (vLLM guided JSON decoding). Dataprep requests a strict JSON object per chunk; without guided JSON, models wrap output in markdown or return malformed JSON → per-chunk fallback (slower, lower label quality). Validated on `ibm-granite/granite-4.1-8b`. |
| Function calling | No | Uses `response_format` + prompt-based label extraction |
| Consistency | **Yes** | Must return the same format on every call (`DATAPREP_LLM_TEMPERATURE=0.0` is set); no dict values in arrays |
| Multi-language | Helpful | If documents are in multiple languages |

### How It Is Called

The dataprep service sends:
- **System prompt:** `LABEL_SELECTOR_SYSTEM_PROMPT` (configurable in `.env`)
- **User prompt:** `"Input: {chunk_text}\nLabels: {taxonomy_list}"`
- **Sampling:** `temperature=0.0`, `response_format={"type": "json_object"}` (guided JSON), bounded `max_tokens`. Chunks may be batched (`DATAPREP_LLM_LABEL_BATCH_SIZE`, default 4) into one call returning `{"0": ["..."], "1": [...]}`.

The LLM must return **only** a JSON object with a `"labels"` key (or an index→labels map when batched) containing an **array of plain strings**. `response_format` enforces valid JSON at the token level; lenient client-side parsing tolerates residual variations (null → `[]`, bare string → `[string]`).

> **Contextual Retrieval (optional).** On by default (`CONTEXTUAL_RETRIEVAL_ENABLED=true`); the same vLLM model (override with `DATAPREP_CONTEXTUAL_MODEL`; empty = reuse this labeling model) is also called once per chunk to generate a ~50-100 word document-context prefix that is prepended before embedding + labeling. It has the **same guided-JSON requirement** (`response_format={"type":"json_object"}`, returning `{"context": "..."}`). On any failure the chunk is stored raw — ingestion never blocks. See the [Data Labelling Strategy]({{< relref "data-labeling" >}}) doc (§7).

### What Goes Wrong with Small Models

Models below ~7B parameters frequently fail at labeling:

- **Dict instead of string:** Returns `{"labels": [{"name": "Procurement"}]}` instead of `{"labels": ["Procurement"]}`. The dict is unhashable and crashes downstream set operations.
- **Missing JSON structure:** Returns conversational text like "Here are the labels: Procurement, Finance" instead of JSON.
- **Invented labels:** Returns labels that don't exist in the taxonomy (less critical — the code handles this with warnings).
- **Inconsistent format:** Works on some chunks, fails on others (non-deterministic).

### Model Recommendations

#### Open Source

| Model | Params | Labeling Quality | License | Notes |
|-------|--------|-----------------|---------|-------|
| **Qwen 2.5 7B** | 7B | Excellent | Apache 2.0 | Best open-source for structured output at this size. |
| **Llama 3.1 8B** | 8B | Very Good | Llama 3.x Community | Strong JSON formatting. |
| **Mistral 7B v0.3** | 7B | Good | Apache 2.0 | Reliable JSON output. |
| **Gemma 3 12B** | 12B | Good | Gemma Terms of Use | Decent but no function calling fallback. |
| **Gemma 3 4B** | 4B | Poor | Gemma Terms of Use | Frequently returns malformed JSON. **Not recommended.** |
| **Granite 3.3 2B** | 2B | Poor | Apache 2.0 | Too small for reliable JSON formatting. **Not recommended.** |
| **Gemma 3 1B** | 1B | Unusable | Gemma Terms of Use | Consistently fails. **Do not use.** |

#### Important: Labeling Shares the Main vLLM

Labeling uses `VLLM_ENDPOINT` + `VLLM_MODEL_ID` — the **same** vLLM instance as main inference. There is no separate configuration for a labeling-specific model. If your main inference model is too small for labeling (e.g., Granite 2B), consider using the `embedding` or `bm25` labeling strategies instead (see Step 8 in the Installation Guide).

### Alternative Labeling Strategies

If your LLM cannot reliably produce JSON, switch to a non-LLM strategy:

```bash
# Embedding-based labeling (recommended for production)
LABELING_STRATEGY=embedding
EMBEDDING_LABEL_THRESHOLD=0.75

# BM25 keyword matching (strict, CPU-only)
LABELING_STRATEGY=bm25
BM25_LABEL_THRESHOLD=2.0
```

| Strategy | LLM Required? | Quality | Speed |
|----------|--------------|---------|-------|
| `llm` | Yes (7B+ recommended) | Best (understands context) | Slowest |
| `embedding` | No | Good (semantic matching) | Fast |
| `bm25` | No | Adequate (keyword matching) | Fastest |

---

## Role 3: Graph Extraction

### What It Does

The dataprep service uses LangChain's `LLMGraphTransformer` to extract entities (nodes) and relationships (edges) from document chunks. These are stored in ArangoDB as a knowledge graph used for graph traversal during retrieval.

### Required Capabilities

| Capability | Required | Notes |
|-----------|----------|-------|
| Chat completion API | Yes | Must support OpenAI-compatible `/v1/chat/completions` |
| Function calling | **Strongly recommended** | Without it, falls back to prompt-based JSON which frequently fails |
| JSON output | **Yes** | Must return structured entity/relationship JSON |
| Reasoning | **Yes** | Must understand entities, types, and relationships in text |

### How It Is Called

The `LLMGraphTransformer` sends each document chunk to the LLM and expects a response containing:
- **head**: entity name (string)
- **head_type**: entity type (string) — e.g., "Person", "Organization"
- **tail**: related entity name (string)
- **tail_type**: related entity type (string)
- **relation**: relationship type (string) — e.g., "WORKS_FOR", "LOCATED_IN"

When function calling is supported, the LLM uses structured tool schemas which guarantee correct types. **Without function calling**, the LLM must return this as raw JSON — and small models routinely return dicts instead of strings for the type fields, causing `unhashable type: 'dict'` crashes.

### Model Recommendations

#### Open Source

| Model | Params | Function Calling | Graph Quality | License | Notes |
|-------|--------|-----------------|---------------|---------|-------|
| **Qwen 2.5 7B** | 7B | Yes | Excellent | Apache 2.0 | Best choice for graph extraction. Structured output works reliably. |
| **Llama 3.1 8B** | 8B | Yes | Very Good | Llama 3.x Community | Native function calling support. |
| **Qwen 2.5 14B** | 14B | Yes | Excellent | Apache 2.0 | Higher quality entity extraction. |
| **Llama 3.1 70B-Instruct-AWQ** | 70B (4-bit) | Yes | Best | Llama 3.x Community | Enterprise-grade graph quality. |
| **Mistral 7B v0.3** | 7B | Partial | Good | Apache 2.0 | Has some function calling support but less reliable. |
| **Gemma 3 12B** | 12B | **No** | Poor | Gemma Terms of Use | No function calling. Prompt-based extraction fails frequently. |
| **Gemma 3 4B** | 4B | **No** | Unusable | Gemma Terms of Use | **Do not use for graph extraction.** |
| **Granite 3.3 2B** | 2B | **No** | Unusable | Apache 2.0 | **Do not use for graph extraction.** |
| **Gemma 3 1B** | 1B | **No** | Unusable | Gemma Terms of Use | **Do not use for graph extraction.** |

#### Why Function Calling Matters

When `ignore_tool_usage=False` (function calling supported), LangChain uses the model's native structured output API. This guarantees that `head_type`, `tail_type`, and `relation` are strings.

When `ignore_tool_usage=True` (no function calling), LangChain parses raw JSON from the model's text output. Small models return malformed types — dicts, arrays, or nested objects — which crash when added to Python sets.

The OPEA code sets `ignore_tool_usage=True` when using vLLM (line 173 of `arangodb.py`), because vLLM's OpenAI-compatible API does not advertise function calling support in a way LangChain detects. **This means graph extraction relies entirely on the model's ability to return correct raw JSON.**

#### Important: Graph Extraction Shares the Main vLLM

Graph extraction uses the same `VLLM_ENDPOINT` + `VLLM_MODEL_ID` as main inference and labeling. There is no separate configuration. **The model you choose for `VLLM_LLM_MODEL_ID` must handle all three roles.**

### If Your Model Cannot Do Graph Extraction

If your main inference model lacks function calling or produces unreliable JSON, the graph extraction batches will be silently skipped (logged as WARN). Documents will still be ingested with chunks and embeddings, but without knowledge graph relationships. This means:
- Hybrid retrieval will still work (vector + label filtering)
- Graph traversal in the retriever will return no additional context
- Related Documents feature will not function

---

## Role 4: Translation & Guardrails

### What It Does

This dedicated vLLM instance handles two tasks:

1. **Translation:** Translates user queries, chat history, and system prompts between languages for the multi-language RAG pipeline. Uses structured chat prompts with language codes.
2. **Guardrails:** The OPEA guardrails service sends content through this model for safety classification. (Currently disabled by default: `GUARDRAIL_ENABLED=false`)

### Required Capabilities

| Capability | Required | Notes |
|-----------|----------|-------|
| Chat completion API | Yes | OpenAI-compatible `/v1/chat/completions` |
| Function calling | No | Not used |
| Multi-language | **Yes** | Must support the target languages |
| Context window | 2K+ tokens | Translation prompts are typically short |
| Instruction following | **Yes** | Must follow language code instructions precisely |

### How It Is Called

The ChatQnA orchestrator sends translation requests in a structured format:
```
Translate the following text from {source_lang} to {target_lang}:
{text}
```

For TranslateGemma fine-tuned models, a specific chat template with language codes is used.

### Model Recommendations

#### Open Source — Dedicated Translation Models (Recommended)

| Model | Params | VRAM (FP16) | Languages | License | Notes |
|-------|--------|-------------|-----------|---------|-------|
| **Infomaniak-AI/vllm-translategemma-4b-it** | 4B | ~8 GB | 100+ | Gemma Terms of Use | Fine-tuned specifically for translation via vLLM. **Best choice.** |
| **facebook/m2m100-12B-last** | 12B | ~24 GB | 100+ | MIT | Dedicated translation model. |
| **facebook/nllb-200-distilled-600M** | 600M | ~1.5 GB | 200 | MIT | Very small. Used for CPU-based fallback in backend. |

#### Open Source — General Instruction Models

| Model | Params | VRAM (FP16) | Translation Quality | License | Notes |
|-------|--------|-------------|---------------------|---------|-------|
| **Gemma 3 4B** | 4B | ~8 GB | Good | Gemma Terms of Use | Default in GENIE.AI. Works well for translation. |
| **Qwen 2.5 7B** | 7B | ~14 GB | Very Good | Apache 2.0 | Excellent multilingual support. |
| **Llama 3.1 8B** | 8B | ~16 GB | Good | Llama 3.x Community | Good multilingual but less than Qwen. |
| **Gemma 3 12B** | 12B | ~24 GB | Very Good | Gemma Terms of Use | Strong multilingual capabilities. |

#### Commercial

| Provider | Model | License | Notes |
|----------|-------|---------|-------|
| **Google** | Gemini 2.0 Flash | Google Cloud ToS (paid) | Excellent multilingual. Best commercial option for translation. |
| **OpenAI** | GPT-4o-mini | OpenAI ToS (paid) | Good translation quality, low cost. |
| **DeepL** | DeepL API | DeepL ToS (paid) | Best-in-class translation quality. Requires separate integration. |

### Configuration

```bash
# In your .env file
VLLM_TRANSLATION_MODEL_ID=Infomaniak-AI/vllm-translategemma-4b-it
VLLM_TRANSLATION_GPU_UTILIZATION=0.3
VLLM_TRANSLATION_MAX_MODEL_LEN=2048
VLLM_TRANSLATION_DTYPE=auto
```

### Language Support

The translation system supports these language codes (defined in the backend's language maps):
`ar`, `bn`, `de`, `en`, `es`, `fr`, `id`, `man`/`mnk`, `pt`, `ru`, `st`, `sw`, `th`, `zh`

For low-resource languages (e.g., Mandinka), the system uses Dyula as a linguistic proxy from the NLLB-200 model.

---

## Role 5: Embeddings

### What It Does

Converts document chunks and user queries into mathematical vectors (embeddings). These vectors are stored in ArangoDB and used for semantic similarity search during retrieval. The embedding model is critical for RAG accuracy — if the embeddings don't capture meaning well, the retriever will return irrelevant results.

### Required Capabilities

| Capability | Required | Notes |
|-----------|----------|-------|
| TEI-compatible | Yes | Must run in HuggingFace Text Embeddings Inference |
| GPU support | Yes | Served via `text-embeddings-router` |
| Vector dimension | Any | Stored in ArangoDB. Larger dimensions use more memory. |

### Model Recommendations

| Model | Dimensions | VRAM | Multilingual | License | Notes |
|-------|-----------|------|-------------|---------|-------|
| **BAAI/bge-base-en-v1.5** | 768 | ~500 MB | No (English only) | MIT | Default. Good quality for English. |
| **BAAI/bge-m3** | 1024 | ~1 GB | Yes | MIT | **Recommended upgrade.** Supports 100+ languages, dense + sparse + ColBERT retrieval. |
| **BAAI/bge-large-en-v1.5** | 1024 | ~800 MB | No | MIT | Higher quality English embeddings. |
| **intfloat/multilingual-e5-base** | 768 | ~500 MB | Yes | Apache 2.0 | Good multilingual alternative. |
| **intfloat/multilingual-e5-large** | 1024 | ~800 MB | Yes | Apache 2.0 | Higher quality multilingual. |
| **sentence-transformers/all-MiniLM-L6-v2** | 384 | ~200 MB | No | Apache 2.0 | Very small. Use only if GPU memory is extremely constrained. |

> **T4 Warning:** Do not use `BAAI/bge-reranker-v2-m3` on a Tesla T4. It uses an XLM-RoBERTa architecture that may have compatibility issues with T4-optimized TEI images and its memory footprint is too large for a shared 16GB card.

### Configuration

```bash
# In your .env file
EMBEDDING_MODEL_ID=BAAI/bge-base-en-v1.5
TEI_EMBED_MODEL=BAAI/bge-base-en-v1.5
```

---

## Role 6: Reranking

### What It Does

After the retriever fetches candidate chunks, the reranker performs a more computationally expensive "cross-encoder" analysis to re-score each chunk against the actual user query. This is the final quality filter before chunks are sent to the LLM.

### Required Capabilities

| Capability | Required | Notes |
|-----------|----------|-------|
| TEI-compatible | Yes | Must run in HuggingFace Text Embeddings Inference |
| Cross-encoder architecture | Yes | Must be a cross-encoder reranker model, not an embedding model |
| GPU support | Yes | Served via `text-embeddings-router` |

### Model Recommendations

| Model | VRAM | Language | License | Notes |
|-------|------|----------|---------|-------|
| **BAAI/bge-reranker-v2-m3** | ~2 GB | Multilingual | MIT | Default. Multilingual; enterprise GPUs (>=24 GB). **Do not use on T4.** |
| **cross-encoder/ms-marco-MiniLM-L-6-v2** | ~200 MB | English | Apache 2.0 | Use on T4 / constrained GPUs (English). Fast, reliable. |
| **cross-encoder/ms-marco-MiniLM-L-12-v2** | ~400 MB | English | Apache 2.0 | Higher quality, more memory. |

### Configuration

```bash
# In your .env file (default; multilingual, requires >=24 GB VRAM)
RERANKER_MODEL_ID=BAAI/bge-reranker-v2-m3
# T4 / constrained GPUs (English only) — override with the lighter model:
# RERANKER_MODEL_ID=cross-encoder/ms-marco-MiniLM-L-6-v2
```

---

## Hardware Profiles and Model Combinations

### Understanding GPU Memory Allocation

GENIE.AI runs multiple AI services on the same GPU. Each service claims a portion of VRAM, and the total must fit within your GPU's capacity. Here is what consumes GPU memory:

| Service | Typical VRAM | Notes |
|---------|-------------|-------|
| **Main vLLM** (inference) | 4–40 GB | Depends on model size, `VLLM_GPU_UTILIZATION`, and `VLLM_MAX_MODEL_LEN` |
| **Translation vLLM** | 4–14 GB | Depends on model size and `VLLM_TRANSLATION_GPU_UTILIZATION` |
| **TEI Embedding** | 200–1000 MB | Depends on embedding model |
| **TEI Reranker** | 200–2000 MB | Depends on reranker model |
| **OS / CUDA overhead** | 500–1000 MB | Always present |

**Key parameter: `VLLM_GPU_UTILIZATION`**

This controls what fraction of GPU memory vLLM reserves for the model weights and KV cache. It does **not** control the total memory used — vLLM will use the full allocation for model weights plus KV cache for concurrent requests.

| Value | Effect |
|-------|--------|
| `0.3` | Only 30% of GPU reserved. Limits concurrent requests but leaves room for other services. |
| `0.6` | 60% reserved. Good balance for enterprise GPUs with multiple services. |
| `0.9` | 90% reserved. Maximizes throughput but leaves almost no room for other services. |

**Key parameter: `VLLM_MAX_MODEL_LEN`**

This controls the maximum context window (in tokens). **Higher values consume more VRAM for the KV cache**, reducing the number of concurrent requests the model can handle.

| Value | VRAM Impact | Use Case |
|-------|------------|----------|
| `2048` | Low | Simple QnA, short documents |
| `4096` | Medium | Standard RAG with retrieved chunks |
| `8192` | High | Complex RAG with long retrieved context |
| `16384` | Very High | Long document analysis |

**Key parameter: `VLLM_DTYPE`**

The weight precision directly affects model quality and VRAM usage:

| Value | VRAM Usage | Quality | GPU Compatibility |
|-------|-----------|---------|-------------------|
| `half` (float16) | Baseline | Good | All GPUs |
| `auto` (usually bfloat16) | Similar to half | Slightly better | Ampere+ (A100, RTX 3090+, Ada) |
| `bfloat16` | Similar to half | Slightly better | Ampere+ only |
| `fp8` | ~50% of half | Acceptable | Ada+ (RTX 4060+, H100) |

> **T4 Warning:** The Tesla T4 does **not** support bfloat16. Always use `VLLM_DTYPE=half` on T4.

### The GPU Memory Budgeting Process

Before choosing models, calculate your GPU memory budget:

1. **Start with total VRAM** (e.g., 16 GB for T4, 48 GB for A100)
2. **Reserve 1 GB for OS/CUDA overhead**
3. **Reserve ~500 MB for TEI embedding**
4. **Reserve ~200 MB for TEI reranker**
5. **Divide remaining memory** between main vLLM and translation vLLM

Example for T4 (16 GB):
```
Total: 16 GB
- OS/CUDA:    1 GB
- TEI embed:  0.5 GB
- TEI rerank: 0.2 GB
- Remaining: 14.3 GB
  - Main vLLM (40%):    5.7 GB  → fits Granite 2B or Gemma 4B
  - Translation (60%):  8.6 GB  → fits Gemma 4B
```

Example for A100 (48 GB):
```
Total: 48 GB
- OS/CUDA:    1 GB
- TEI embed:  1 GB (bge-m3)
- TEI rerank: 0.2 GB
- Remaining: 45.8 GB
  - Main vLLM (60%):   27.5 GB → fits Qwen 2.5 14B
  - Translation (40%): 18.3 GB → fits Qwen 2.5 7B
```

### Loading Models and Verifying GPU Allocation

After configuring your `.env`, bring up the services and monitor GPU usage:

```bash
# Step 1: Start services
docker compose up -d --build

# Step 2: Watch GPU allocation in real-time
watch nvidia-smi
```

**What to look for in `nvidia-smi`:**

| Indicator | Good | Bad |
|-----------|------|-----|
| GPU memory usage | Close to total VRAM | Very low (models failed to load) |
| "No space left on device" in logs | N/A | Model too large for available VRAM |
| All services listed in Processes | Yes | Missing service = model failed to load |

**Expected timeline:**
- TEI models (embedding, reranker): Load in 30–60 seconds
- Translation vLLM: 2–5 minutes (model download + GPU loading)
- Main vLLM: 3–10 minutes (model download + GPU loading)

**vLLM healthcheck timeout is normal.** The healthcheck often fails during initial startup because the model is still loading. Wait for the model to fully load, then run `docker compose up -d` again to restart any services that timed out.

```bash
# Check which services are healthy
docker compose ps

# If vllm is unhealthy, wait and retry
docker compose up -d
```

### Testing Model Loading

After all services are up, run these verification steps:

**1. Verify main inference is working:**
```bash
# Check vLLM is serving the model
curl http://localhost:8000/v1/models
```

**2. Verify embedding service:**
```bash
# 7000 is the internal retriever port (dev/Compose only). In Swarm, run inside the net:
# docker exec <retriever-container> curl http://tei:80/embed -X POST ... \
curl http://localhost:7000/embed -X POST \
  -H "Content-Type: application/json" \
  -d '{"inputs": "test query"}'
```

**3. Verify translation service:**
```bash
curl http://localhost:9031/v1/models
```

**4. Test end-to-end RAG:**
Log into the application and ask a question about an ingested document. If the response is coherent and references the source material, the pipeline is working correctly.

---

### Profile A: Tesla T4 (16GB VRAM) — Entry Level

This is the most constrained profile. Multiple models must share a single 16GB GPU. The T4 uses Turing architecture (compute 7.5) which does **not** support bfloat16.

**Hardware specs:** 16 GB GDDR6, compute 7.5, CUDA 12.4 driver typical

**Main vLLM (serves Inference + Labeling + Graph):**

| Model | VRAM Used | Labeling | Graph Extraction | Inference Quality |
|-------|-----------|----------|-----------------|-------------------|
| **Granite 3.3 2B** | ~4 GB | Poor | Unusable | Adequate |
| **Gemma 3 4B** | ~8 GB | Poor | Unusable | Good |
| **Mistral 7B** | ~14 GB | Good | Poor (no FC) | Good |

**Recommendation:** Use `Granite 3.3 2B` for inference and switch labeling to `embedding` or `bm25` strategy. Accept that graph extraction will not work reliably.

**Translation vLLM:**

| Model | VRAM Used | Quality |
|-------|-----------|---------|
| **Gemma 3 4B** | ~8 GB | Good |

**Total GPU allocation (T4):** Main (~4-8 GB) + Translation (~8 GB) + TEI Embedding (~500 MB) + TEI Reranker (~200 MB) = ~13-17 GB. This is extremely tight on 16 GB.

```bash
# T4 Configuration
VLLM_LLM_MODEL_ID=ibm-granite/granite-3.3-2b-instruct
VLLM_GPU_UTILIZATION=0.4
VLLM_MAX_MODEL_LEN=65536
VLLM_DTYPE=half
LABELING_STRATEGY=embedding    # Do NOT use llm with 2B model

VLLM_TRANSLATION_MODEL_ID=google/gemma-3-4b-it
VLLM_TRANSLATION_GPU_UTILIZATION=0.4
VLLM_TRANSLATION_DTYPE=half
VLLM_TRANSLATION_KV_CACHE_DTYPE=fp8

EMBEDDING_MODEL_ID=BAAI/bge-base-en-v1.5
RERANKER_MODEL_ID=cross-encoder/ms-marco-MiniLM-L-6-v2
```

### Profile B: RTX 4060 Laptop (8GB VRAM) — Development Only

**Not recommended for production.** Even more constrained than T4. The RTX 4060 has Ada Lovelace architecture (compute 8.9) which supports bfloat16 and fp8.

**Hardware specs:** 8 GB GDDR6, compute 8.9, CUDA 12.8 driver typical

**Recommendation:** Use `Gemma 3 4B` for inference with `LABELING_STRATEGY=embedding`. Accept that graph extraction will not work. Translation may need to use the CPU-based NLLB fallback or share the main vLLM (reducing available VRAM further).

```bash
VLLM_LLM_MODEL_ID=google/gemma-3-4b-it
VLLM_GPU_UTILIZATION=0.30
VLLM_MAX_MODEL_LEN=65536
VLLM_DTYPE=half
LABELING_STRATEGY=embedding

VLLM_TRANSLATION_MODEL_ID=google/gemma-3-4b-it
VLLM_TRANSLATION_GPU_UTILIZATION=0.35
VLLM_TRANSLATION_MAX_MODEL_LEN=2048
VLLM_TRANSLATION_DTYPE=half

EMBEDDING_MODEL_ID=BAAI/bge-base-en-v1.5
RERANKER_MODEL_ID=cross-encoder/ms-marco-MiniLM-L-6-v2
```

### Profile C: RTX 6000 Ada / A40 / L40S / A100 (48GB VRAM) — Enterprise

This profile has room for high-quality models across all roles. These GPUs support bfloat16.

**Hardware specs:** 48 GB GDDR6 (RTX 6000 Ada) / 48 GB HBM2e (A100), compute 8.9 (Ada) / 8.0 (Ampere)

**Main vLLM (serves Inference + Labeling + Graph):**

| Model | VRAM Used | Labeling | Graph Extraction | Inference Quality |
|-------|-----------|----------|-----------------|-------------------|
| **Qwen 2.5 7B** | ~14 GB | Excellent | Excellent | Very Good |
| **Llama 3.1 8B** | ~16 GB | Very Good | Very Good | Very Good |
| **Qwen 2.5 14B** | ~28 GB | Excellent | Excellent | Excellent |
| **Llama 3.1 70B-Instruct-AWQ** | ~40 GB | Excellent | Excellent | Best |

**Recommendation:** Use **Qwen 2.5 7B** or **Llama 3.1 8B** as the best balance of quality, capability, and VRAM. Both support function calling and reliably produce structured JSON for labeling and graph extraction. For maximum quality, use **Llama 3.1 70B-Instruct-AWQ** if the GPU supports 48GB+.

**Translation vLLM:**

| Model | VRAM Used | Quality |
|-------|-----------|---------|
| **Infomaniak-AI/vllm-translategemma-4b-it** | ~8 GB | Excellent |
| **Qwen 2.5 7B** | ~14 GB | Very Good |

```bash
# Enterprise Configuration (Recommended)
VLLM_LLM_MODEL_ID=Qwen/Qwen2.5-7B-Instruct
VLLM_GPU_UTILIZATION=0.6
VLLM_MAX_MODEL_LEN=65536
VLLM_DTYPE=auto
LABELING_STRATEGY=llm    # LLM strategy works well with 7B+ models

VLLM_TRANSLATION_MODEL_ID=Infomaniak-AI/vllm-translategemma-4b-it
VLLM_TRANSLATION_GPU_UTILIZATION=0.3
VLLM_TRANSLATION_MAX_MODEL_LEN=2048
VLLM_TRANSLATION_DTYPE=auto

EMBEDDING_MODEL_ID=BAAI/bge-m3          # Multilingual upgrade
RERANKER_MODEL_ID=BAAI/bge-reranker-v2-m3   # Multilingual reranker (enterprise GPU)
```

### Profile D: Multi-GPU / Separate Nodes

If you have multiple GPUs or separate servers, you can dedicate resources more effectively:

**Option 1: Two GPUs, single node (e.g., 2x A100 48GB)**
```bash
# GPU 1: Main inference + labeling + graph extraction
VLLM_LLM_MODEL_ID=meta-llama/Meta-Llama-3.1-70B-Instruct-AWQ
VLLM_GPU_UTILIZATION=0.9
NVIDIA_VISIBLE_DEVICES=0

# GPU 2: Translation + embeddings + reranking
VLLM_TRANSLATION_MODEL_ID=Infomaniak-AI/vllm-translategemma-4b-it
VLLM_TRANSLATION_GPU_UTILIZATION=0.5
NVIDIA_VISIBLE_DEVICES=1
```

**Option 2: Separate servers (recommended for production)**
| Server | GPU | Role | Model |
|--------|-----|------|-------|
| GPU Server | 48GB+ | Main inference, labeling, graph | Llama 3.1 70B-AWQ or Qwen 2.5 14B |
| GPU Server | 16GB+ | Translation, embeddings, reranking | TranslateGemma 4B + bge-m3 |
| App Server | CPU only | Backend, frontend, Kong, ArangoDB | N/A |

### Other Notable Hardware

| GPU | VRAM | Compute | bfloat16 | Notes |
|-----|------|---------|----------|-------|
| **RTX 3090** | 24 GB | 8.6 | Yes | Good budget option for development. |
| **RTX 4090** | 24 GB | 8.9 | Yes | Excellent single-GPU for all roles. |
| **H100 SXM** | 80 GB | 9.0 | Yes | Best performance. Overkill for most deployments. |
| **L4** | 24 GB | 8.9 | Yes | Good server GPU, similar to RTX 4090. |
| **A10G** | 24 GB | 8.6 | Yes | AWS GPU instance option. |

---

## Decision Matrix: Which Model Should I Choose?

### For Main Inference + Labeling + Graph Extraction (shared vLLM)

```
Do you have 48GB+ VRAM?
├── YES → Use Qwen 2.5 7B or Llama 3.1 8B
│         (or Llama 3.1 70B-AWQ for maximum quality)
└── NO
    ├── Do you have 24GB+ VRAM?
    │   ├── YES → Use Qwen 2.5 7B or Llama 3.1 8B (INT8/AWQ)
    │   └── NO
    │       ├── Do you have 16GB VRAM?
    │       │   ├── YES → Use Mistral 7B with LABELING_STRATEGY=embedding
    │       │   │         (graph extraction will be unreliable)
    │       │   └── NO
    │       │       └── Use Gemma 3 4B with LABELING_STRATEGY=embedding
    │       │           (graph extraction will NOT work)
```

### For Translation (dedicated vLLM)

```
Do you need high-quality translation for many languages?
├── YES → Use Infomaniak-AI/vllm-translategemma-4b-it
└── NO
    └── Use Gemma 3 4B (default, adequate for most use cases)
```

---

## Key Environment Variables Reference

### Main Inference (Roles 1, 2, 3)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Main chat model (recommended: `ibm-granite/granite-4.1-8b`) |
| `VLLM_MODEL_ID` | (alias of above) | Used by dataprep for labeling & graph |
| `VLLM_ENDPOINT` | `http://vllm:8000` | Main vLLM endpoint |
| `VLLM_GPU_UTILIZATION` | `0.55` | GPU memory fraction |
| `VLLM_MAX_MODEL_LEN` | `65536` | Max context window |
| `VLLM_DTYPE` | `auto` | Weight precision (half/auto/bfloat16) |

### Translation (Role 4)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | Translation model |
| `VLLM_TRANSLATION_ENDPOINT` | `http://vllm-translation-guardrail:9031` | Translation endpoint |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.3` | GPU memory fraction |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `2048` | Max context window |
| `VLLM_TRANSLATION_DTYPE` | `auto` | Weight precision |

### Labeling Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `LABELING_STRATEGY` | `llm` | Strategy: `llm`, `embedding`, or `bm25` |
| `LABEL_SELECTOR_SYSTEM_PROMPT` | (built-in) | System prompt for LLM labeling |
| `EMBEDDING_LABEL_THRESHOLD` | `0.75` | Threshold for embedding strategy |
| `BM25_LABEL_THRESHOLD` | `2.00` | Threshold for BM25 strategy |

### Embeddings & Reranking (Roles 5, 6)

| Variable | Default | Purpose |
|----------|---------|---------|
| `EMBEDDING_MODEL_ID` | `BAAI/bge-base-en-v1.5` | Embedding model |
| `TEI_EMBED_MODEL` | (must match above) | TEI embedding model |
| `RERANKER_MODEL_ID` | `BAAI/bge-reranker-v2-m3` | Reranking model (use MiniLM on T4) |

### Document Extraction (Non-LLM AI)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTENT_EXTRACTION_METHOD` | `docling` | Extraction engine: `docling` or `opea` |
| `DOCLING_DEVICE` | `cuda` | Docling device: `cuda` or `cpu` |

### OCR Models (Pre-downloaded, not configured)

| Model | Purpose | Size | License |
|-------|---------|------|---------|
| **EasyOCR CRAFT** (craft_mlt_25k) | Text detection in images/PDFs | ~100 MB | Apache 2.0 |
| **EasyOCR English** (english_g2) | Text recognition (English) | ~10 MB | Apache 2.0 |

These models are downloaded at build time (see the Dockerfile) and stored inside the container. They do not require GPU allocation — EasyOCR can run on CPU if needed, but GPU (`DOCLING_DEVICE=cuda`) is much faster for PDF processing.

---

## Non-AI Components Worth Understanding

While this guide focuses on LLM and model selection, the following non-AI components are critical to the framework's performance and should be understood:

| Component | Purpose | Why It Matters |
|-----------|---------|---------------|
| **ArangoDB** | Graph + vector database | Stores documents, embeddings, knowledge graph. Performance directly affects retrieval latency. |
| **Kong API Gateway** | Routes and secures traffic | All user requests pass through Kong. Misconfiguration blocks the entire application. |
| **Redis** | Caching layer | Caches translation results. Reduces load on translation vLLM. |
| **Docling** | PDF/document extraction | Converts PDFs, DOCX, etc. into text chunks. Quality of extraction directly affects RAG quality. |
| **Nginx** | Reverse proxy / SSL termination | External entry point. CSP and CORS must be configured correctly. |
| **Node.js Backend** | Business logic | Handles auth, sessions, document management, and orchestrates OPEA services. |

---

## Common Pitfalls

### 1. Using a 1B-2B model for everything

Small models (Gemma 1B, Granite 2B) cannot reliably produce structured JSON. Using them for labeling or graph extraction will cause silent failures — batches skipped, garbage labels, empty graphs.

### 2. Assuming all models work for graph extraction

Graph extraction requires either function calling support or extremely reliable JSON formatting. Most models below 7B fail at this. If your model lacks function calling, graph batches will be skipped with `unhashable type: 'dict'` warnings.

### 3. Not accounting for shared VRAM

The main vLLM, translation vLLM, embedding TEI, and reranking TEI all run on the same GPU (in single-node deployments). A 7B model at FP16 uses ~14 GB. On a 16 GB T4, that leaves almost nothing for translation and embeddings.

### 4. Ignoring the labeling strategy option

If your LLM cannot do labeling reliably, switch to `LABELING_STRATEGY=embedding`. This uses the embedding model (which is much more reliable) for semantic label matching instead of the LLM.

### 5. Using the wrong dtype for your GPU

- **T4 (Turing):** Does not support bfloat16. Use `half` (float16).
- **Ampere+ (A100, RTX 3090+, RTX 6000 Ada):** Supports bfloat16. Use `auto` or `bfloat16`.
- **RTX 4060 (Ada Lovelace):** Supports bfloat16. Use `auto`.

### 6. PyTorch CUDA version mismatch

When building the dataprep Docker image, `pip install torch` without an explicit index URL pulls the latest PyTorch (currently CUDA 13.0). If your host driver is CUDA 12.8, this makes CUDA unavailable inside the container. To fix this, add a `TORCH_CUDA_VERSION` build ARG to the Dockerfile and pass the correct value from docker-compose. See the Dockerfile comments for details.
