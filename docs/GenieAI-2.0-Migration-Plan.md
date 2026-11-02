# A10 GPU Upgrade & RAG Pipeline Improvements Plan

**Project:** BDT 9LES25007 — Open-Source AI Agriculture Advisory Service for Lesotho  
**Last Updated:** August 25, 2026  
**Approach:** Upgrade GPU hardware (T4 → A10) and backport RAG pipeline improvements from GenieAI 2.0 into the current Agrivisory codebase  
**Current Hardware:** Azure NC4as_T4_v3 (1x NVIDIA T4 16GB, 4 vCPUs, 28GB RAM)  
**Target Hardware:** Azure A10 GPU VM (24GB VRAM)  
**Upstream Reference:** https://opensource.unicc.org/un/itu/genie-ai (main branch, OPEA 1.5)

---

## 1. Executive Summary

Rather than a full migration to GenieAI 2.0 (estimated 5-8 weeks, high risk of feature regression), this plan takes a lighter approach: keep the current working Agrivisory codebase, move it to an A10 GPU VM, upgrade the LLM and translation models to leverage the additional VRAM, and selectively backport RAG pipeline improvements from 2.0's OPEA overlay.

This delivers the same user-facing quality improvements (better answers, faster translation, working knowledge graph) with significantly lower risk and effort.

### Key Principles

1. **Keep what works** — Current codebase, all Agrivisory features, deployment process unchanged
2. **No hallucination risk** — Only instruct-tuned models for inference (Qwen2.5-7B-Instruct)
3. **Cherry-pick, don't rewrite** — Backport specific RAG improvements from 2.0 overlay code
4. **Incremental rollout** — Each improvement independently testable and reversible
5. **Full 2.0 migration deferred** — Revisit when upstream ships features that can't be backported (e.g., OTel observability, mobile app)

---

## 2. Why A10 (24GB) Changes Everything

The T4's 16GB forced compromises that shaped the entire current architecture:

| Constraint (T4 16GB) | Workaround Applied | With A10 (24GB) |
|---|---|---|
| Can't run 2 vLLM instances | Removed translation vLLM, moved to CPU NLLB | Re-enable GPU translation (~7GB) alongside main LLM (~14GB) |
| Granite 2B (only model that fits at 85%) | Accepted poor labeling, broken graph extraction, weak reasoning | Upgrade to Qwen2.5-7B-Instruct (fits at 60%) |
| MiniLM reranker (bge-reranker-v2-m3 too large) | English-only reranker on T4 | Multilingual reranker on A10 (2GB fits) |
| Translation latency ~37s (CPU NLLB) | Accepted; increased gateway timeout to 180s | GPU TranslateGemma ~1-3s OR keep NLLB if Sesotho quality is better |
| No graph extraction (Granite 2B lacks function calling) | Knowledge graph empty after ingestion | Qwen2.5-7B has function calling → graph extraction works |
| Labeling failures (Granite 2B can't produce reliable JSON) | Fell back to `LABELING_STRATEGY=embedding` | Guided JSON decoding + 7B model → LLM labeling works |

---

## 3. Target Architecture (A10)

```
┌──────────────────────────────────────────────────────────────────┐
│                    Azure A10 VM (24GB VRAM)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  Docker Compose (same as today)              │ │
│  │                                                             │ │
│  │  ┌─────────┐  ┌──────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │  Nginx  │→ │ Kong │→ │   Backend    │  │  Frontend   │  │ │
│  │  │ (TLS)   │  │      │  │ (Node.js)    │  │  (Vue 3)    │  │ │
│  │  └─────────┘  └──────┘  └──────────────┘  └────────────┘  │ │
│  │                                                             │ │
│  │  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌─────────┐  │ │
│  │  │ Keycloak │  │ ArangoDB  │  │   Redis   │  │ ClamAV  │  │ │
│  │  └──────────┘  └───────────┘  └───────────┘  └─────────┘  │ │
│  │                                                             │ │
│  │  ┌──────────────────── GPU Services ─────────────────────┐  │ │
│  │  │                                                       │  │ │
│  │  │  vLLM (Main)              vLLM (Translation)          │  │ │
│  │  │  Qwen2.5-7B-Instruct     TranslateGemma-4B           │  │ │
│  │  │  ~14GB (60% util)         ~7GB (30% util)             │  │ │
│  │  │                                                       │  │ │
│  │  │  TEI Embedding            TEI Reranker                │  │ │
│  │  │  bge-m3 (~1GB)            bge-reranker-v2-m3 (~2GB)   │  │ │
│  │  │                                                       │  │ │
│  │  │  Total GPU: ~24GB                                     │  │ │
│  │  └───────────────────────────────────────────────────────┘  │ │
│  │                                                             │ │
│  │  ┌──────────────────── OPEA Services (CPU) ──────────────┐  │ │
│  │  │  ChatQnA │ Retriever │ Reranker │ Dataprep │ Embedding│  │ │
│  │  │  Textgen │ Translation │ Guardrail                    │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 GPU Memory Budget

| Component | Model | VRAM | Config |
|-----------|-------|------|--------|
| Main vLLM | `Qwen/Qwen2.5-7B-Instruct` | ~14 GB | `gpu_memory_utilization=0.60` |
| Translation vLLM | `Infomaniak-AI/vllm-translategemma-4b-it` | ~7 GB | `gpu_memory_utilization=0.30` |
| TEI Embedding | `BAAI/bge-m3` | ~1 GB | Already in use (unchanged) |
| TEI Reranker | `BAAI/bge-reranker-v2-m3` | ~2 GB | Upgrade from ms-marco-MiniLM |
| **Total** | | **~24 GB** | |

**Safer alternative (3GB headroom):**

Replace reranker with `cross-encoder/ms-marco-MiniLM-L-6-v2` (~200MB) → total ~22GB, leaves room for KV cache spikes under concurrent load. Trade-off: English-only reranker (current setup, works fine with NLLB translating queries to English before retrieval).

### 3.2 Model Selection Rationale

| Role | Model | Why this one |
|------|-------|---|
| **Main LLM** | Qwen2.5-7B-Instruct | Instruct-tuned (no hallucination), strong instruction following, function calling (graph extraction), guided JSON (labeling), Apache 2.0 license, GenieAI 2.0's recommended model for enterprise GPUs |
| **Translation** | TranslateGemma-4B-IT | Instruct-tuned (IT = instruction-tuned), fine-tuned specifically for translation, 100+ languages, ~1-3s latency |
| **Embedding** | bge-m3 | Already in use, multilingual, supports Sesotho cross-lingual retrieval |
| **Reranker** | bge-reranker-v2-m3 | Multilingual cross-encoder, was too large for T4, fits on A10 |

**Why NOT AfriqueGemma / AfriqueQwen / AfriqueQwen3.5-4B-ExtendedCM:**
- All are base/CPT models — NOT instruction-tuned
- Will hallucinate (generate plausible-sounding but wrong agricultural advice)
- Cannot follow RAG grounding instructions ("answer only from provided context")
- Cannot reliably abstain when knowledge base lacks answer
- Guardrail evaluation breaks without instruction following
- **Wait for instruction-tuned variants** from McGill-NLP before deploying to production

### 3.3 Translation Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    Translation (Hybrid)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  UI Strings (menus, labels, buttons, Knowledge Areas):      │
│    → CPU NLLB-200 + Redis cache (unchanged from today)      │
│    → Instant (cached), high Sesotho quality                 │
│                                                             │
│  RAG Pipeline (chat messages, LLM responses):               │
│    → GPU TranslateGemma-4B (primary path)                   │
│    → ~1-3s latency (vs current ~37s)                        │
│    → Falls back to CPU NLLB on failure                      │
│                                                             │
│  Decision point (Phase 2):                                  │
│    Evaluate TranslateGemma vs NLLB for Sesotho quality.     │
│    If NLLB is materially better for Sesotho, keep NLLB      │
│    for pipeline translation too (accept slower latency).    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. RAG Pipeline Improvements (Backported from 2.0)

These are the specific improvements to cherry-pick from GenieAI 2.0's OPEA overlay. Each is independently implementable and testable.

### 4.1 Hybrid Retrieval (Dense + BM25 + RRF)

**What:** Currently using dense vector search only. Add BM25 lexical search and combine results via Reciprocal Rank Fusion.

**Why:** Agricultural terminology (crop names, farming techniques, Sesotho terms) benefits from exact keyword matching that dense vectors miss. RRF combines both signals.

**Where to modify:** `genie-ai-overlay/retriever/`

**Configuration (from 2.0):**
```env
RETRIEVER_HYBRID_RETRIEVAL_ENABLED=true
RETRIEVER_HYBRID_RRF_K=60
RETRIEVER_HYBRID_BM25_CANDIDATES=50
RETRIEVER_HYBRID_DENSE_WEIGHT=1.0
RETRIEVER_HYBRID_LEXICAL_WEIGHT=1.0
RETRIEVER_HYBRID_BM25_ANALYZER=text_en
```

**ArangoDB requirement:** Create an Analyzer view for BM25 over the chunks collection. ArangoDB 3.12 supports this natively.

**Effort:** Medium (retriever code changes + ArangoDB view setup)

---

### 4.2 Knowledge Graph Traversal at Query Time

**What:** After vector retrieval returns candidate chunks, traverse the knowledge graph to find related chunks via entity-relationship edges.

**Why:** Connects related agricultural concepts (e.g., query about "maize pests" also finds chunks about "fall armyworm control" via graph relationship). Currently the graph exists in ArangoDB but isn't used during retrieval.

**Where to modify:** `genie-ai-overlay/retriever/`

**Configuration (from 2.0):**
```env
RETRIEVER_ARANGO_TRAVERSAL_ENABLED=true
RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH=2
RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED=5
RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD=0.7
```

**Prerequisite:** Graph extraction must work first (requires Qwen2.5-7B on A10 — see 4.4). Existing documents need re-ingestion.

**Effort:** Medium (retriever code changes)

---

### 4.3 Guided JSON Labeling

**What:** Use vLLM's `response_format={"type": "json_object"}` to force valid JSON output during chunk labeling, instead of hoping the LLM produces valid JSON.

**Why:** Granite 2B failed at labeling (~80% failure rate on JSON formatting), forcing fallback to `LABELING_STRATEGY=embedding`. Qwen2.5-7B + guided JSON = reliable LLM labeling with better quality than embedding similarity.

**Where to modify:** `genie-ai-overlay/dataprep/` — labeling LLM calls

**Configuration:**
```env
LABELING_STRATEGY=llm
DATAPREP_LLM_LABEL_BATCH_SIZE=4
```

**vLLM requirement:** vLLM v0.4+ supports `response_format`. Current v0.10.0 (in 2.0's compose) supports it fully.

**Effort:** Low (add `response_format` parameter to existing LLM calls in dataprep)

---

### 4.4 Working Knowledge Graph Extraction

**What:** LLM-based entity and relationship extraction from document chunks during ingestion.

**Why:** Currently broken with Granite 2B (no function calling, produces malformed JSON for entity types). Qwen2.5-7B supports function calling → LangChain's LLMGraphTransformer works correctly.

**Where:** Already exists in `genie-ai-overlay/dataprep/` — just needs a model that supports it.

**Configuration:** No code change needed. Qwen2.5-7B advertises function calling via vLLM's OpenAI-compatible API. LangChain detects this automatically.

**Impact:** After re-ingestion, ArangoDB will have entities + relationships → enables graph traversal (4.2).

**Effort:** Low (model upgrade handles this; just verify it works and re-ingest)

---

### 4.5 Contextual Retrieval (Per-Chunk Context Prefix)

**What:** During ingestion, generate a ~50-100 word document-context prefix per chunk that describes what document and section the chunk belongs to. This prefix is prepended before embedding, so chunks carry their source context in the vector space.

**Why:** Isolated chunks lose context ("the committee decided..." — which committee?). The context prefix grounds the chunk in its source document, improving retrieval precision.

**Where to modify:** `genie-ai-overlay/dataprep/` — add context generation step after chunking, before embedding

**Configuration (from 2.0):**
```env
CONTEXTUAL_RETRIEVAL_ENABLED=true
CONTEXTUAL_STRATEGY=doc_level
CONTEXTUAL_LABEL_RAW=true
DATAPREP_CONTEXTUAL_DOC_BUDGET=6000
DATAPREP_CONTEXTUAL_MAX_TOKENS=512
```

**How it works:**
1. After chunking, send each chunk + document context to LLM
2. LLM generates a short context prefix (guided JSON: `{"context": "..."}`)
3. Prefix is prepended to chunk text before embedding
4. Labeling still uses the raw chunk (not the prefixed version) for precision

**Effort:** Medium (new pipeline step in dataprep, LLM call per chunk)

---

### 4.6 Adaptive Reranker Strategy

**What:** Instead of a fixed top-N slice or hard threshold, select chunks using a utility-cost model that considers relevance, novelty (diversity), and token budget.

**Why:** Fixed top-3 sometimes includes a redundant chunk (same info from different doc pages) while dropping a novel relevant chunk. Adaptive selection picks the best non-redundant context set.

**Where to modify:** `genie-ai-overlay/reranker/`

**Configuration (from 2.0):**
```env
RERANKING_STRATEGY=adaptive
NOVELTY_SIGMOID_A=20.0
NOVELTY_SIGMOID_B=0.25
CONTEXT_DECAY_FACTOR=0.0025
MIN_VALUE_THRESHOLD=-1.0
```

**Alternative:** Start with `RERANKING_STRATEGY=slice_threshold` (simpler — top-N but only above threshold). Move to `adaptive` after validating slice_threshold works well.

**Effort:** Medium (port reranker strategy code from 2.0)

---

### 4.7 Improved Confidence Scoring

**What:** Replace arithmetic mean of reranker scores with rank-weighted exponential decay aggregation + optional score calibration.

**Why:** Current scoring is count-dependent (more chunks = lower mean) and tail-sensitive (one weak chunk tanks the score). Rank-weighted scoring ensures the strongest match dominates.

**Where to modify:** `genie-ai-overlay/chatqna/genieai_chatqna.py`

**Configuration (from 2.0):**
```env
CONFIDENCE_RANK_DECAY=0.5
RERANKER_SCORE_CALIBRATION=none
RERANKER_SCORE_TEMPERATURE=1.0
```

**Effort:** Low (port scoring function from 2.0 chatqna)

---

### 4.8 Multi-Turn Retrieval Blending

**What:** For follow-up questions ("can you elaborate on that?"), blend the current query embedding with embeddings from previous conversation turns so the retriever resolves pronouns/references.

**Why:** Stateless retrieval fails on follow-ups — "that" has no meaning without the prior turn. Blending carries forward the prior topic.

**Configuration (from 2.0):**
```env
MULTI_TURN_BLEND_ENABLED=true
MULTI_TURN_BLEND_ALPHA=0.7
MULTI_TURN_HISTORY_TURNS=1
```

**Where to modify:** `genie-ai-overlay/chatqna/genieai_chatqna.py` — embedding step

**Effort:** Low-Medium (port blending logic from 2.0)

---

### 4.9 Abstention Enforcement

**What:** Configure the LLM to explicitly refuse answering when the knowledge base doesn't contain relevant information.

**Why:** Prevents hallucination in production. A farmer asks about something not in the knowledge base → LLM says "I don't have information on this" instead of inventing an answer.

**Configuration (from 2.0):**
```env
CHATQNA_ENFORCE_ABSTENTION=true
```

**Where:** System prompt modification in chatqna + response parsing to detect abstention.

**Effort:** Low (system prompt + config)

---

## 5. Implementation Phases

### Phase 1: A10 Provisioning & Model Upgrade (1 week)

**Goal:** Current codebase running on A10 with upgraded models.

| # | Task | Details |
|---|------|---------|
| 1.1 | Provision A10 staging VM | Azure `NC8ads_A10_v3` (or equivalent). Install Docker, NVIDIA drivers, CUDA toolkit |
| 1.2 | Clone current deployment | Copy `docker-compose-t4.yaml` → `docker-compose-a10.yaml`; copy all Agrivisory code |
| 1.3 | Create `env-A10` config | New model IDs, GPU utilization values, VRAM allocations per Section 3.1 |
| 1.4 | Re-enable translation vLLM | Remove `profiles: [disabled]` from `vllm-translation-guardrail`; configure TranslateGemma-4B |
| 1.5 | Upgrade vLLM version | Update image tag to `vllm/vllm-openai:v0.10.0` (supports guided JSON, better memory management) |
| 1.6 | Switch main model | Change `VLLM_LLM_MODEL_ID` to `Qwen/Qwen2.5-7B-Instruct` |
| 1.7 | Upgrade reranker model | Change `RERANKER_MODEL_ID` to `BAAI/bge-reranker-v2-m3` (multilingual, fits on A10) |
| 1.8 | Restore production data | ArangoDB dump + documents + Keycloak (same versions, no schema change) |
| 1.9 | Test: All services healthy | `docker compose up -d`, all healthchecks pass, GPU memory within budget |
| 1.10 | Test: Basic chat works | Login, ask question in English and Sesotho, verify grounded response |
| 1.11 | Test: Translation speed | Measure Sesotho response latency (target: <5s translation, <20s total) |

**Exit criteria:** Agrivisory fully functional on A10 with Qwen2.5-7B + TranslateGemma + bge-reranker-v2-m3. All existing features work. Translation latency dramatically reduced.

---

### Phase 2: Translation Evaluation (3-5 days)

**Goal:** Decide whether GPU TranslateGemma or CPU NLLB is better for Sesotho pipeline translation.

| # | Task | Details |
|---|------|---------|
| 2.1 | Prepare test set | 50 sentence pairs: 25 EN→Sesotho, 25 Sesotho→EN. Include agricultural terminology (crop names, farming instructions, weather terms) |
| 2.2 | Run through TranslateGemma | Translate test set via GPU `vllm-translation-guardrail` |
| 2.3 | Run through NLLB-200 | Translate same test set via CPU backend `/api/translate` |
| 2.4 | Compare quality | Evaluate: terminology accuracy, grammar, fluency, hallucinated content |
| 2.5 | Compare latency | Measure: TranslateGemma (expected ~1-3s) vs NLLB (expected ~2-5s uncached, <50ms cached) |
| 2.6 | Decision | If TranslateGemma quality >= NLLB → use GPU for pipeline. If NLLB is materially better → keep NLLB for pipeline, use TranslateGemma only as future option |
| 2.7 | Configure chosen path | Update chatqna translation routing based on decision |

**Exit criteria:** Translation path decided and configured. Benchmark documented.

---

### Phase 3: RAG Pipeline Improvements (2-3 weeks)

**Goal:** Backport RAG improvements from 2.0 into the current overlay code.

Ordered by impact and dependency:

| # | Task | Depends on | Effort | Impact |
|---|------|-----------|--------|--------|
| 3.1 | Guided JSON labeling (4.3) | vLLM v0.10.0 (Phase 1) | Low | High — fixes broken labeling |
| 3.2 | Abstention enforcement (4.9) | Qwen2.5-7B (Phase 1) | Low | High — prevents hallucination |
| 3.3 | Confidence scoring upgrade (4.7) | None | Low | Medium — better UX |
| 3.4 | Graph extraction verification (4.4) | Qwen2.5-7B (Phase 1) | Low | High — enables graph traversal |
| 3.5 | Hybrid retrieval (4.1) | ArangoDB BM25 view | Medium | High — better recall |
| 3.6 | Graph traversal (4.2) | 3.4 + re-ingestion | Medium | Medium — related docs discovery |
| 3.7 | Contextual retrieval (4.5) | vLLM v0.10.0 (Phase 1) | Medium | Medium — better retrieval precision |
| 3.8 | Adaptive reranker (4.6) | None | Medium | Medium — better context selection |
| 3.9 | Multi-turn blending (4.8) | None | Low-Medium | Medium — better follow-ups |
| 3.10 | Re-ingest all documents | 3.1, 3.4, 3.5, 3.7 | Time (hours) | Required — new embeddings, labels, graph, contexts |

**Suggested implementation order:**

```
Week 1:  3.1 (labeling) → 3.2 (abstention) → 3.3 (confidence) → 3.4 (graph verify)
Week 2:  3.5 (hybrid retrieval) → 3.6 (graph traversal) → 3.7 (contextual retrieval)
Week 3:  3.8 (adaptive reranker) → 3.9 (multi-turn) → 3.10 (re-ingest all docs)
```

**Exit criteria:** All RAG improvements active, documents re-ingested with new pipeline, answer quality measurably improved.

---

### Phase 4: Validation & Production Cutover (1 week)

**Goal:** Validate everything works end-to-end, then switch production.

| # | Task | Details |
|---|------|---------|
| 4.1 | Functional test — Chat (English) | 20 agricultural queries, verify grounded answers with sources |
| 4.2 | Functional test — Chat (Sesotho) | 20 agricultural queries, verify translation + grounded answers |
| 4.3 | Functional test — Abstention | 10 questions NOT in knowledge base, verify LLM refuses |
| 4.4 | Functional test — Document ingestion | Ingest 5 docs, verify: progress tracking, labels (JSON), graph entities, contextual prefixes, embeddings |
| 4.5 | Functional test — All Agrivisory features | Health monitoring, security scanner, logs, query inspector, farmer profile, weather, user approval |
| 4.6 | Performance test — Latency | Measure end-to-end response time (target: EN <10s, Sesotho <15s) |
| 4.7 | Performance test — Concurrent users | 5 simultaneous sessions, no OOM or degraded quality |
| 4.8 | Hallucination test | Ask farming questions that could be confused (wrong region, wrong crop). Verify LLM stays grounded |
| 4.9 | Production cutover | Schedule 30-min maintenance window → backup T4 data → DNS/Front Door flip to A10 → smoke test |
| 4.10 | Monitor 24h | Watch GPU utilization, response times, error rates via admin dashboard |
| 4.11 | Keep T4 as rollback | Preserve T4 VM for 7 days. Revert Front Door if critical issues |

**Exit criteria:** Production running on A10, all tests pass, latency targets met, no hallucination detected.

---

## 6. Environment Configuration (`env-A10`)

```env
# =============================================================================
# GENIE.AI Agrivisory — A10 GPU Configuration
# =============================================================================

# --- Primary LLM (Inference + Labeling + Graph Extraction) ---
VLLM_LLM_MODEL_ID=Qwen/Qwen2.5-7B-Instruct
VLLM_GPU_UTILIZATION=0.60
VLLM_MAX_MODEL_LEN=32768
VLLM_DTYPE=auto
VLLM_MAX_NUM_SEQS=64
LABELING_STRATEGY=llm
DATAPREP_LLM_LABEL_BATCH_SIZE=4

# --- Translation LLM (GPU, re-enabled on A10) ---
VLLM_TRANSLATION_MODEL_ID=Infomaniak-AI/vllm-translategemma-4b-it
VLLM_TRANSLATION_GPU_UTILIZATION=0.30
VLLM_TRANSLATION_MAX_MODEL_LEN=2048
VLLM_TRANSLATION_DTYPE=auto
VLLM_TRANSLATION_SERVICE_PORT=9031

# --- Embedding ---
EMBEDDING_MODEL_ID=BAAI/bge-m3

# --- Reranker ---
RERANKER_MODEL_ID=BAAI/bge-reranker-v2-m3

# --- Retrieval (hybrid) ---
RETRIEVER_HYBRID_RETRIEVAL_ENABLED=true
RETRIEVER_HYBRID_RRF_K=60
RETRIEVER_HYBRID_BM25_CANDIDATES=50
RETRIEVER_HYBRID_DENSE_WEIGHT=1.0
RETRIEVER_HYBRID_LEXICAL_WEIGHT=1.0
RETRIEVER_ARANGO_TRAVERSAL_ENABLED=true
RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH=2
RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED=5
RETRIEVER_ARANGO_K=20
RETRIEVER_ARANGO_FETCH_K=30
RETRIEVER_ARANGO_SCORE_THRESHOLD=0.2

# --- Reranking strategy ---
RERANKING_STRATEGY=slice_threshold
RERANKING_THRESHOLD=0.75
RERANKER_TOP_N=3
CONFIDENCE_RANK_DECAY=0.5

# --- Contextual retrieval ---
CONTEXTUAL_RETRIEVAL_ENABLED=true
CONTEXTUAL_STRATEGY=doc_level
CONTEXTUAL_LABEL_RAW=true

# --- Multi-turn ---
MULTI_TURN_BLEND_ENABLED=true
MULTI_TURN_BLEND_ALPHA=0.7
MULTI_TURN_HISTORY_TURNS=1

# --- Abstention ---
CHATQNA_ENFORCE_ABSTENTION=true

# --- Context window budget ---
MAX_MODEL_LEN_TEXTGEN=16384

# --- Translation cache (CPU NLLB, kept for UI strings) ---
TRANSLATION_CACHE=on
TRANSLATION_CACHE_HOST=redis-cache
TRANSLATION_CACHE_PORT=6379

# --- Timeouts (keep 180s for safety) ---
# Nginx and Kong timeouts remain at 180s as fallback

# --- Weather RAG (unchanged) ---
WEATHER_AUGMENTATION_ENABLED=true
```

---

## 7. Comparison: Before (T4) vs After (A10)

| Metric | T4 (Current) | A10 (After) | Improvement |
|--------|-------------|-------------|-------------|
| GPU VRAM | 16 GB | 24 GB | +50% |
| Main LLM | Granite 3.3 2B | Qwen2.5-7B-Instruct | ~3.5x params, 45%+ quality |
| Context window | 16K tokens | 32K tokens | 2x |
| Translation | CPU NLLB (~37s) | GPU TranslateGemma (~1-3s) | ~12-37x faster |
| Reranker | MiniLM (English) | bge-reranker-v2-m3 (multilingual) | Cross-lingual support |
| Labeling | Embedding fallback (mediocre) | LLM + guided JSON (good) | Correct label assignment |
| Graph extraction | Broken (no function calling) | Working (Qwen2.5 FC) | Knowledge graph actually populated |
| Retrieval | Dense only | Dense + BM25 + Graph traversal | Better recall |
| Reranking | Fixed threshold | Adaptive/slice_threshold | Better context selection |
| Follow-up questions | Stateless (broken pronouns) | Multi-turn blending | Coherent conversations |
| Abstention | Weak (Granite 2B ignores prompts) | Strong (Qwen2.5-7B follows instructions) | No hallucination |
| End-to-end latency (Sesotho) | ~90s | ~15-20s (estimated) | ~4-6x faster |

---

## 8. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| A10 VRAM too tight with all 4 GPU services | Low | High | Use lighter reranker (MiniLM) or reduce `gpu_memory_utilization` slightly |
| TranslateGemma Sesotho quality worse than NLLB | Medium | Medium | Phase 2 evaluation; keep NLLB as fallback |
| Qwen2.5-7B labeling quality different from embedding strategy | Low | Low | Compare label quality; can revert to `LABELING_STRATEGY=embedding` |
| Hybrid retrieval returns too many low-quality results | Low | Low | Tune RRF weights and BM25 candidates; revert to dense-only if needed |
| Re-ingestion takes too long (large knowledge base) | Low | Medium | Schedule overnight; process in batches |
| Docker Compose file changes break existing services | Low | Medium | Test on staging first; keep T4 as rollback |
| vLLM v0.10.0 introduces regressions | Low | Medium | Test thoroughly on staging; can pin to earlier version if needed |

---

## 9. Timeline Summary

| Phase | Duration | Key Outcome |
|-------|----------|-------------|
| Phase 1: A10 + Model Upgrade | 1 week | Current system running on A10 with better models |
| Phase 2: Translation Evaluation | 3-5 days | TranslateGemma vs NLLB decision for Sesotho |
| Phase 3: RAG Improvements | 2-3 weeks | Hybrid retrieval, graph, contextual, adaptive reranker |
| Phase 4: Validation + Cutover | 1 week | Production on A10, all tests pass |
| **Total** | **~5 weeks** | |

---

## 10. What About Full GenieAI 2.0 Migration?

Deferred. Revisit when:

- Upstream releases OTel observability as a must-have (current health monitoring is sufficient)
- Mobile app (Flutter) becomes a project requirement
- Production AKS deployment is prioritized (Helm chart already built, independent of this)
- Upstream ships a feature that can't be backported (e.g., major auth architecture change)
- Fork divergence becomes a maintenance burden (currently manageable)

When that time comes, the path will be easier: same models, same RAG config, just different deployment infrastructure wrapping the same logic.

---

## 11. Post-Upgrade Opportunities

Once stable on A10 with RAG improvements:

| Opportunity | Notes |
|---|---|
| ArangoDB Backup to Azure Blob Storage | Already scoped in Workplan; same backend code |
| Weather RAG Phase 2 (historical rainfall) | Same architecture, add Open-Meteo historical API |
| Streaming translation (`STREAMING_TRANSLATION_ENABLED=1`) | Available in 2.0; port if GPU translation chosen |
| AfriqueQwen instruct model (when released) | Swap model config; A10 has VRAM headroom |
| GPU VM Status Panel (in-app) | Build on existing health monitoring |
| Full observability (OTel + Grafana) | Add as standalone profile without full 2.0 migration |
| Production AKS cutover | Independent of this upgrade; Helm chart ready |

---

## 12. References

| Document | Location |
|----------|----------|
| GenieAI 2.0 Model Selection Guide | https://genie-ai-7e342b.opensource.unicc.org/docs/rag/choosing-models/ |
| GenieAI 2.0 RAG Pipeline | https://genie-ai-7e342b.opensource.unicc.org/docs/rag/ |
| GenieAI 2.0 Architecture | https://genie-ai-7e342b.opensource.unicc.org/docs/architecture/architecture/ |
| Current GPU Optimization (CPU Translation) | `docs/GPU-Optimization-CPU-Translation.md` |
| Current RAG Quality Improvements | `docs/RAG-Quality-Improvements.md` |
| Current System Health Monitoring | `docs/System-Health-Monitoring.md` |
| Current Deployment Summary | `docs/Lesotho-Deployment-Optimizations-Summary.md` |
| Workplan — System Improvements | `docs/Workplan-System-Improvements.md` |
