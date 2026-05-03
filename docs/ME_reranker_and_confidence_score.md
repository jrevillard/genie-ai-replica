# Reranker & Confidence Score — Complete Guide

> **Scope**: How the two-layer reranker works, all three scoring strategies, how the confidence score is derived from reranker output, the bug that caused 1%/16% confidence on correct answers, and the fix.

---

## 1. Why a Reranker?

Vector similarity search (ArangoDB approximate nearest-neighbour) retrieves the top-K chunks whose *embeddings* are close to the query embedding. Embeddings capture semantic similarity, but they cannot directly compare the query to each chunk at token level — they just compare geometric distance in 768-dimensional space.

A **cross-encoder reranker** solves this by:
- Taking the query **and** a candidate chunk as a joint input  
- Scoring them together through a full transformer attention pass  
- Producing a single relevance scalar for each (query, chunk) pair

This is more accurate than embedding distance because cross-encoders can attend to every word in both texts simultaneously.

```
Vector search (fast, ~20 candidates)  →  Reranker (slower, ~5-20 pairs)  →  LLM (1-5 chunks)
     ArangoDB ANN                            cross-encoder MiniLM              Granite 3.3-2b
```

---

## 2. Architecture: Two Layers

The reranker is split into two Docker containers:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │  ChatQnA Megaservice  (genie-ai-chatqna-server, port 8888)            │
 │                                                                        │
 │   [embedding] → [retriever] → [reranker] → [llm]                     │
 │                                   ↓                                   │
 │            POST /v1/reranking   (port 6100)                           │
 └────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┴──────────────────────┐
              │                                            │
 ┌────────────▼────────────────────┐    ┌─────────────────▼──────────────┐
 │  reranker  (Python wrapper)     │    │  tei_reranker  (Rust/GPU)      │
 │  genie-ai-reranker:latest       │    │  text-embeddings-inference     │
 │  container: genie-ai-reranker   │    │  container: tei-reranker-serving│
 │  port: 6100 → 8000              │    │  port: 7100 → 80               │
 │                                 │    │                                │
 │  GenieTEIReranking class        │    │  Model loaded at startup:      │
 │  genieai_tei_reranker.py        │    │  cross-encoder/ms-marco-       │
 │                                 │    │  MiniLM-L-6-v2                 │
 │  Strategy logic:                │    │                                │
 │    slice | threshold |          │    │  POST /rerank                  │
 │    knee_threshold               │    │  → returns [{index, score}]    │
 └─────────────────────────────────┘    └────────────────────────────────┘
```

### Layer 1 — TEI (`tei_reranker`)

Hugging Face **Text Embeddings Inference** (Rust, GPU-accelerated). Loads `cross-encoder/ms-marco-MiniLM-L-6-v2` at startup. Exposes a single HTTP endpoint:

```http
POST http://tei_reranker:80/rerank
Content-Type: application/json

{
  "query": "What is the crop duration of potato?",
  "texts": [
    "Potato in Dhaka has a crop duration of 105 days...",
    "Wheat requires about 120 days of growth...",
    "...more chunks..."
  ]
}
```

Response (sorted by score descending, returns original array indices):
```json
[
  { "index": 0, "score": 0.99780875 },
  { "index": 3, "score": 0.06465348 },
  { "index": 1, "score": 0.00605039 },
  { "index": 2, "score": 0.00001834 },
  { "index": 4, "score": 0.00001156 }
]
```

Scores are **raw logits passed through sigmoid** — they represent the cross-encoder's confidence that the chunk answers the query. Range: 0.0–1.0.

### Layer 2 — Python Wrapper (`reranker`)

`genie-ai-overlay/reranker/genieai_tei_reranker.py` wraps the TEI call and applies a filtering strategy before returning documents to the ChatQnA megaservice.

```python
# docker-compose.yaml — reranker service
environment:
  - RERANKER_MODEL_ENDPOINT=${RERANKER_MODEL_ENDPOINT}   # http://tei_reranker:80
  - TEI_RERANKING_ENDPOINT=${TEI_RERANKING_ENDPOINT}     # http://tei_reranker:80
  - RERANK_COMPONENT_NAME=GENIE_TEI_RERANKING
  - RERANKING_STRATEGY=${RERANKING_STRATEGY}             # slice | threshold | knee_threshold
  - RERANKING_THRESHOLD=${RERANKING_THRESHOLD}           # 0.01 (production)
```

---

## 3. Model: `cross-encoder/ms-marco-MiniLM-L-6-v2`

| Property | Value |
|---|---|
| Architecture | MiniLM-L-6 (BERT-based, 6 layers) |
| Task | Cross-encoder relevance scoring |
| Training data | MS MARCO passage ranking dataset |
| Input | (query, passage) pair, concatenated with `[SEP]` |
| Output | Single float — relevance score (after sigmoid) |
| Max tokens | 512 (combined query + passage) |
| Speed | Fast — 6 layers vs 12 for full BERT |

**Why cross-encoder vs bi-encoder**: Bi-encoders (used for embedding) encode query and document independently, then compare. Cross-encoders encode both jointly — every query token can attend to every document token. This is ~10-100× slower but significantly more accurate for relevance judgement.

---

## 4. Three Reranking Strategies

Set via `RERANKING_STRATEGY` in `.env`. The strategy controls how many documents are forwarded to the LLM after scoring.

### 4.1 `slice` (simplest)

Take the top-N documents by score. N is controlled by `RERANKER_TOP_N`.

```python
# genieai_tei_reranker.py
if reranking_strategy == "slice":
    top_n = reranker_top_n if reranker_top_n else 1
    for best_response in decoded_response[:top_n]:
        reranking_results.append({
            "text": input.retrieved_docs[best_response["index"]].text,
            "score": best_response["score"]
        })
```

**Example** with `RERANKER_TOP_N=5`:
```
Input scores:  [0.998, 0.065, 0.006, 0.00002, 0.00001]
Output:         all 5 (just the top-5 slice)
```

**Use case**: Fixed number of context chunks. Predictable LLM prompt size.

### 4.2 `threshold`

Keep only documents whose score meets or exceeds `RERANKING_THRESHOLD`. Returns variable number of documents.

```python
elif reranking_strategy == "threshold":
    document_scores = [resp["score"] for resp in decoded_response]
    for best_response in decoded_response:
        if best_response["score"] >= reranking_threshold:
            reranking_results.append({
                "text": input.retrieved_docs[best_response["index"]].text,
                "score": best_response["score"]
            })
```

**Example** with `RERANKING_THRESHOLD=0.75`:
```
Input scores:  [0.998, 0.065, 0.006, 0.00002, 0.00001]
Threshold:      0.75
Output:         [0.998]   ← only 1 document passes
```

**Example** with `RERANKING_THRESHOLD=0.01` (current production):
```
Input scores:  [0.998, 0.065, 0.006, 0.00002, 0.00001]
Threshold:      0.01
Output:         [0.998, 0.065, 0.006]   ← 3 documents pass
```

**Use case**: Quality gating — only confident chunks reach the LLM.

### 4.3 `knee_threshold`

Uses the **Kneedle algorithm** to automatically detect the "elbow" point in the score curve — the natural drop-off where scores stop being meaningful.

```python
elif reranking_strategy == "knee_threshold":
    document_scores = [resp["score"] for resp in decoded_response]
    indices = list(range(len(document_scores)))

    kneedle = KneeLocator(
        indices,
        document_scores,
        curve="convex",
        direction="decreasing"
    )

    cutoff = kneedle.knee + 1 if kneedle.knee is not None else len(document_scores)

    for i in range(cutoff):
        best_response = decoded_response[i]
        reranking_results.append({...})
```

**Example**:
```
Scores:  [0.998, 0.065, 0.006, 0.00002, 0.00001]
         ^              ^
         plateau        knee detected here (index 1 or 2)

Output: [0.998, 0.065]   ← up to the knee
```

**Use case**: Adaptive — works well across different query types where the number of relevant documents varies.

### Strategy Comparison

```
Strategy        Docs returned   Controlled by         Best for
──────────────  ─────────────   ───────────────────   ─────────────────────────
slice           fixed N         RERANKER_TOP_N        Predictable prompt size
threshold       variable        RERANKING_THRESHOLD   Quality gating
knee_threshold  adaptive        automatic             Mixed query difficulty
```

**Current production `.env`**:
```
RERANKING_STRATEGY=slice
RERANKER_TOP_N=5
RERANKING_THRESHOLD=0.01   # only relevant if strategy=threshold
```

---

## 5. Score Flow: From TEI to Confidence %

This is the full path a reranker score takes before appearing as "Confidence: X%" in the frontend.

```
TEI /rerank endpoint
  └─ Returns raw sigmoid scores: [0.998, 0.065, 0.006, ...]
       │
       ▼
genieai_tei_reranker.py  (GenieTEIReranking.invoke)
  └─ Applies strategy filtering
  └─ Returns RerankingResponse(reranked_docs=[{text, score}, ...])
       │
       ▼
genieai_chatqna.py  (handle_request → RERANK branch)
  └─ Extracts reranked_docs with scores into retrieved_docs_with_scores
  └─ Passes to LLM with documents as context
       │
       ▼
genieai_chatqna.py  (post-LLM section)
  └─ Iterates over retrieved_docs_with_scores
  └─ For each doc: extracts score, fetches metadata from doc repo API
  └─ Builds scores[] list
  └─ confidence_score = max(scores)
  └─ round(confidence_score, 2)   → e.g. 0.998 → 1.0 (rounds to 1.00)
       │
       ▼
JSON response payload
  └─ { "metadata": { "confidence_score": 1.0 } }
       │
       ▼
Frontend (ChatBotComponent.vue)
  └─ Displays: "Confidence: 100%"   (multiplies by 100)
```

### Score extraction in `genieai_chatqna.py`

```python
# After LLM response is assembled (lines ~1430–1513)
rerank_key = self._find_node_key("rerank", result_dict)
retriever_key = self._find_node_key("retriever", result_dict)
source_node_key = rerank_key if rerank_key else retriever_key

# reranked_docs list: [{id, text, score}, ...]
retrieved_docs_with_scores = result_dict.get(source_node_key, {}).get("retrieved_docs", [])

# file_id_pairs: {doc_id: file_id} — from retriever output
file_id_pairs = result_dict.get(retriever_key, {}).get("file_id_pairs", {})

scores = []
for item in retrieved_docs_with_scores:
    score = item.get("score", 0.0)
    # ... metadata fetch ...
    scores.append(score)

confidence_score = max(scores) if scores else 0.0
```

---

## 6. The Confidence Score Bug

### Symptom

The chatbot answered factual questions correctly, but the confidence score was extremely low:

```
Q: What is the crop duration of potato in Dhaka?
A: The crop duration of potato in Dhaka is 105 days.
Confidence: 1%

Q: What are the October minimum temperatures in Dhaka?
A: The minimum temperature in Week 42 was 23.8°C.
Confidence: 16%
```

Both answers were correct. The reranker had actually scored the best chunks very high.

### Root Cause Investigation

**Step 1 — Check raw reranker scores via docker logs**:

```bash
docker logs genie-ai-chatqna-server 2>&1 | grep "document conf"
```

```
[ DEBUG ] appendding document conf score: 0
[ DEBUG ] appendding document conf score: 0.064653486
[ DEBUG ] appendding document conf score: 0.0060503976
[ DEBUG ] appendding document conf score: 1.8342893e-05
[ DEBUG ] appendding document conf score: 1.1568796e-05
[ DEBUG ] document confidence scores: [0, 0.064653486, 0.0060503976, 1.8342893e-05, 1.1568796e-05]
confidence_score: 0.01
```

The best chunk had score `0` — but TEI actually returned `0.99780875` for it.

**Step 2 — Trace why the best chunk's score became 0**:

The culprit was in the metadata-fetch error handler. When `fetch_file_metadata` fails (network error, wrong URL, token issues), the code at the time reassigned `score = 0`:

```python
# BUGGY CODE (before fix)
file_metadata = await self.fetch_file_metadata(file_id)
if file_metadata and isinstance(file_metadata, dict):
    labels = file_metadata['labels']
    file_name = file_metadata.get('file_name', '')
    # ... set labels, file_name from metadata ...
else:
    logger.warning(f"Skipping metadata for file ID {file_id} due to fetch failure.")
    labels = "error"
    file_id = "error"
    file_name = "error"
    file_read_url = "error"
    score = 0   # ← BUG: overwrites the real reranker score with 0
```

**Step 3 — Why only the top chunk failed metadata fetch**:

The top-scoring chunk came from the document with the highest relevance. That document's `file_id` was (likely) either:
- Deleted from the document repository but still indexed in ArangoDB
- Had a different ID format that the metadata URL could not resolve

The lower-ranked chunks happened to come from documents that *did* resolve metadata successfully — so their real scores (0.065, 0.006, etc.) were preserved.

**Step 4 — How the average made it worse**:

The original aggregation was `sum(scores) / len(scores)`:

```python
# For crop duration query:
scores = [0, 0.064653486, 0.0060503976, 1.8342893e-05, 1.1568796e-05]
#          ↑ zeroed          ↑ real scores
confidence = sum(scores) / len(scores) = 0.071 / 5 = 0.014 = 1%

# For temperatures query:
scores = [0, 0.461, 0.357, 0.001, 0.00005]
confidence = 0.819 / 5 = 0.163 = 16%
```

Even if the zeroing had not happened, averaging penalizes queries where most retrieved chunks are irrelevant (which is normal — only 1-2 chunks usually answer any query well).

---

## 7. The Fix

Two changes in `genieai_chatqna.py`:

### Fix 1 — Remove `score = 0` from metadata error handler

```python
# BEFORE (line ~1494)
else:
    logger.warning(f"Skipping metadata for file ID {file_id} due to fetch failure.")
    labels = "error"
    file_id = "error"
    file_name = "error"
    file_read_url = "error"
    score = 0   # ← REMOVED

# AFTER
else:
    logger.warning(f"Skipping metadata for file ID {file_id} due to fetch failure.")
    labels = "error"
    file_id = "error"
    file_name = "error"
    file_read_url = "error"
    # score is intentionally NOT reset — the reranker score is still valid
    # even when document metadata (labels, filename) is unavailable.
```

The reranker score was computed before the metadata fetch. It reflects how well the chunk text answers the query. A metadata API failure is an infrastructure issue — it does not change the chunk's relevance.

### Fix 2 — Use `max` instead of `sum/len`

```python
# BEFORE
confidence_score = sum(scores) / len(scores) if scores else 0.0

# AFTER
# Use the best (max) reranker score as confidence — it reflects how well the
# top retrieved chunk matches the query. Averaging pulls the score down when
# lower-ranked chunks are irrelevant, which is expected and not a failure.
confidence_score = max(scores) if scores else 0.0
```

**Why `max` is the right aggregation**:

The reranker returns scores in ranked order. The top chunk is the one the LLM will primarily answer from. If it scores 0.997, the answer has 99.7% confidence. The 4th-ranked chunk scoring 0.00002 is irrelevant context that happens to be in the prompt — it should not dilute the confidence signal.

```
scores = [0.998, 0.065, 0.006, 0.00002, 0.00001]
                  │
max(scores) = 0.998 → Confidence: 100%  ✓ (rounded to 2 dp)
avg(scores) = 0.214 → Confidence: 21%  ✗ (misleading)
```

### Expected output after fix

```
Q: What is the crop duration of potato in Dhaka?
A: The crop duration of potato in Dhaka is 105 days.
Confidence: 100%   ← was 1%

Q: What are the October minimum temperatures in Dhaka?
A: The minimum temperature in Week 42 was 23.8°C.
Confidence: 100%   ← was 16%
```

---

## 8. Deploying the Fix to the Running Container

The fix is in source file `genie-ai-overlay/chatqna/genieai_chatqna.py`. Since the container uses a copy baked at image build time, you hot-patch it without rebuilding:

```bash
# Copy fixed file into running container
docker cp genie-ai-overlay/chatqna/genieai_chatqna.py \
    genie-ai-chatqna-server:/app/ChatQnA/genieai_chatqna.py

# Restart to reload the module
docker restart genie-ai-chatqna-server
```

To make it permanent (survives container recreation), rebuild the image:
```bash
docker compose build chatqna-xeon-backend-server
docker compose up -d chatqna-xeon-backend-server
```

---

## 9. Configuration Reference

All reranker settings live in `.env` and are passed into the `reranker` container via `docker-compose.yaml`:

```bash
# ========= RERANKER SERVICE =========
RERANK_SERVER_HOST_IP=reranker        # Python wrapper container name
RERANK_SERVER_PORT=8000               # Internal port of wrapper

RERANK_COMPONENT_NAME=GENIE_TEI_RERANKING   # selects which class to use

# Strategy: slice | threshold | knee_threshold
RERANKING_STRATEGY=slice
RERANKER_TOP_N=5                      # used when strategy=slice
RERANKING_THRESHOLD=0.01              # used when strategy=threshold

# ========= TEI RERANKER (inference server) =========
RERANKER_MODEL_ID=cross-encoder/ms-marco-MiniLM-L-6-v2
RERANKER_MODEL_ENDPOINT=http://tei_reranker:80
TEI_RERANKING_ENDPOINT=http://tei_reranker:80
```

The `chatqna` service reads the same `.env` for its side of the connection:

```bash
RERANK_SERVER_HOST_IP=reranker        # route to Python wrapper
RERANK_SERVER_PORT=80                 # wrapper listens on 80 inside container
```

### Port map

```
Host        Container   Service
7100:80 →   tei_reranker   — direct TEI model inference (debug/test only)
6100:8000 → reranker       — Python strategy wrapper (used by chatqna)
```

---

## 10. Full Pipeline Diagram

```
User query: "What is the crop duration of potato in Dhaka?"
     │
     ▼
ChatQnA Megaservice
     │
     ▼ [1] Embed query
embedding service (TEI bge-base-en-v1.5)
→ 768-dim vector
     │
     ▼ [2] ANN vector search
ArangoDB (GRAPH_TEST)
→ top-20 candidate chunks (by cosine similarity)
→ [{id, text, file_id, score}, ...]
     │
     ▼ [3] Cross-encoder reranking
reranker (genie-ai-reranker → tei_reranker)
→ POST /rerank  {query, texts[20]}
→ TEI scores each (query, chunk) pair via cross-encoder
→ Returns [{index, score}] sorted by score desc
→ Strategy applies (slice top-5)
→ [{text, score}, ...] — 5 docs with real relevance scores
     │
     ▼ [4] LLM generation
vLLM (Granite 3.3-2b-instruct)
→ System prompt + retrieved chunks as context
→ LLM generates answer text
     │
     ▼ [5] Post-processing (genieai_chatqna.py)
→ Extract LLM answer text
→ Translate if needed (Gemma 3-1b)
→ For each reranked doc:
     fetch metadata (labels, filename) from doc-repo API
     if metadata fails → labels/name="error", score unchanged
     scores.append(doc.score)
→ confidence_score = max(scores)          ← the fix
→ Build source_documents_formatted[]
     │
     ▼ [6] JSON response
{
  "response": "The crop duration of potato in Dhaka is 105 days.",
  "metadata": {
    "confidence_score": 1.0,
    "source_documents": [
      {
        "document_id": "abc123",
        "document_name": "potato_crop_calendar.pdf",
        "url": "https://.../api/files/abc123/viewbrowser",
        "categoryLabel": ["agriculture", "crops"],
        "score": 0.998
      },
      ...
    ]
  }
}
     │
     ▼
Frontend ChatBotComponent.vue
→ Displays answer + "Confidence: 100%"
```

---

## 11. Secondary Issue: Why Does Metadata Fetch Fail?

After the confidence fix, the `source_documents` list in the response still shows `"document_id": "error"` for the top chunk. This means `fetch_file_metadata` returns `None` for that document's `file_id`.

**Possible causes to investigate**:

| Cause | How to check |
|---|---|
| Document deleted from doc-repo but still indexed in ArangoDB | `GET /api/files/{file_id}` from within the container — returns 404? |
| Auth token invalid or expired | Check logs for `Failed to get admin auth token` |
| `file_id` format mismatch (UUID vs ObjectId) | Log the raw `file_id` value before the fetch call |
| `DOC_REPO_URL` misconfigured | `echo $DOC_REPO_URL` inside the chatqna container |

**Diagnosis commands**:
```bash
# Check what file_id the top chunk has
docker logs genie-ai-chatqna-server 2>&1 | grep "mapped to File ID" | tail -10

# Test the metadata endpoint manually
docker exec genie-ai-chatqna-server \
  curl -s http://doc-service:3001/api/files/<FILE_ID> \
  -H "Authorization: Bearer <token>"
```

The confidence score is now correct regardless of this secondary issue (because we no longer zero the score on metadata failure), but fixing metadata fetch would restore the source document links and labels in the UI.
