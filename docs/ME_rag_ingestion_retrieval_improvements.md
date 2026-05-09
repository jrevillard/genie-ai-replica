# RAG Pipeline Improvements — Ingestion & Retrieval

> **Scope:** Structured chunking with Docling + HybridChunker, heading-prepend embedding enrichment, BM25 reranking, retrieval parameter tuning, and rich metadata storage in ArangoDB.  
> **Files changed:** `genieai_dataprep_utils.py`, `genieai_dataprep_arangodb.py`, `genieai_retriever_arangodb.py`, `Dockerfile-retriever_genie-ai`, `.env`

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Overview of Changes](#3-overview-of-changes)
4. [Change 1 — Structured Chunking with HybridChunker](#4-change-1--structured-chunking-with-hybridchunker)
5. [Change 2 — Heading-Prepend Embedding Enrichment](#5-change-2--heading-prepend-embedding-enrichment)
6. [Change 3 — Rich Metadata in ArangoDB](#6-change-3--rich-metadata-in-arangodb)
7. [Change 4 — Retrieval Parameter Tuning](#7-change-4--retrieval-parameter-tuning)
8. [Change 5 — BM25 Reranking](#8-change-5--bm25-reranking)
9. [End-to-End Pipeline: Before vs After](#9-end-to-end-pipeline-before-vs-after)
10. [Inspecting Retrieved Chunks](#10-inspecting-retrieved-chunks)
11. [Configuration Reference](#11-configuration-reference)

---

## 1. Problem Statement

Users were getting poor or irrelevant answers from the chatbot even when the knowledge base contained the right information. A typical failure looked like this:

> **User:** "What is the minimum temperature for potato cultivation in Dhaka?"  
> **Bot:** "I don't have enough information to answer that."

The knowledge base had the answer. The retriever just wasn't finding it — or was finding the wrong chunks and ranking them incorrectly.

---

## 2. Root Cause Analysis

There were **four independent failures** stacked on top of each other:

### 2.1 Decontextualised chunks

PDFs were converted using `export_to_markdown()` which strips all structural information — headings, section hierarchy, page numbers — and returns a flat string. That string was then split by a character-count splitter. The result was chunks with no idea of which section they belonged to.

```
# What the embedding model actually saw (old):

"- Min temp < 10°C and Max. Temp >30°C"

# It had no idea this line was under:
# "Weather Warning > Crop Calendar > Temperature Thresholds"
```

A user asking about *temperature thresholds* would get a very different embedding than a chunk saying *"Min temp < 10°C"* in isolation. The semantic gap between query and chunk was too large.

### 2.2 K was too small (K=5)

The retriever fetched **5 chunks** and sent them directly to the cross-encoder TEI reranker with `slice` strategy. With only 5 inputs and 5 outputs, the reranker was doing nothing useful — it received 5 chunks and returned the same 5 chunks in roughly the same order.

### 2.3 Score threshold too strict (0.5)

Cosine similarity scores for short, factual agricultural chunks were consistently in the 0.70–0.78 range. A threshold of **0.5 had zero effect** — all retrieved chunks passed it. But any genuinely relevant chunk that scored 0.36–0.49 was being silently dropped.

### 2.4 No keyword signal

The pipeline relied entirely on semantic (vector) similarity. When a user typed an exact term like *"wire worm"* or *"fusarium wilt"*, the embedding model spread that signal across 768 dimensions and diluted it. A keyword-aware ranking signal was completely absent.

---

## 3. Overview of Changes

```
┌─────────────────────────────────────────────────────────────┐
│                    CHANGES AT A GLANCE                       │
├─────────────────┬───────────────────┬───────────────────────┤
│ Area            │ Before            │ After                  │
├─────────────────┼───────────────────┼───────────────────────┤
│ PDF parser      │ export_to_markdown │ Docling + HybridChunker│
│ Chunk context   │ bare text only    │ headings prepended     │
│ Chunk metadata  │ file_id, labels   │ + headings, page_nos   │
│ Retrieval K     │ 5                 │ 20                     │
│ Fetch K (MMR)   │ 15                │ 40                     │
│ Score threshold │ 0.5               │ 0.35                   │
│ Ranking signal  │ cosine only       │ cosine + BM25 combined │
└─────────────────┴───────────────────┴───────────────────────┘
```

---

## 4. Change 1 — Structured Chunking with HybridChunker

### What changed

`load_with_docling()` in `genieai_dataprep_utils.py` was changed from returning a plain markdown string to returning a structured list of chunk dictionaries, each carrying the heading hierarchy and page numbers it came from.

### Before

```python
# genieai_dataprep_utils.py (OLD)
async def load_with_docling(doc_path: str) -> str:
    def process_doc():
        result = docling_converter.convert(doc_path)
        return result.document.export_to_markdown()   # flat string, no structure

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, process_doc)
```

`export_to_markdown()` concatenates all document content into one big markdown string. It throws away the internal document model — element types, heading levels, page provenance — and gives back plain text.

### After

```python
# genieai_dataprep_utils.py (NEW)
async def load_with_docling(doc_path: str) -> list:
    """
    Returns list[dict]:
        {
            "text":         str,        # chunk body text
            "headings":     list[str],  # section heading hierarchy above this chunk
            "page_numbers": list[int],  # page(s) the chunk spans (1-based)
        }
    """
    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker

    def process_doc():
        result = docling_converter.convert(doc_path)
        chunker = HybridChunker()
        chunks = []
        for chunk in chunker.chunk(result.document):
            # Collect unique page numbers from all doc_items in this chunk
            page_nos = sorted({
                prov.page_no
                for item in chunk.meta.doc_items
                for prov in item.prov
            })
            chunks.append({
                "text":         chunk.text,
                "headings":     chunk.meta.headings or [],
                "page_numbers": page_nos,
            })
        return chunks

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, process_doc)
```

### Why HybridChunker is better

`HybridChunker` (from `docling-core`) works directly on Docling's internal document model before anything is serialised to text. It:

- Respects natural semantic boundaries (headings, paragraphs, list boundaries, table edges)
- Respects a configurable token budget per chunk (default tokenizer: `sentence-transformers/all-MiniLM-L6-v2`)
- Attaches `chunk.meta.headings` — the full ancestor heading path for every chunk
- Attaches `chunk.meta.doc_items` — the actual document elements (with page provenance)

```
┌─────────────────────────────────────────────────────────────────┐
│  Docling Internal Document Model                                 │
│                                                                  │
│  DoclingDocument                                                 │
│  ├── Section: "Crop Weather Calendar"      ← heading level 1    │
│  │   ├── Section: "December - Week 50"    ← heading level 2    │
│  │   │   ├── ListItem: "Rainfall: 4.5 mm"                      │
│  │   │   ├── ListItem: "Max Temp: 26.2°C"                      │
│  │   │   └── ListItem: "Stage: Tuber Set" ← page 3             │
│  │   └── Section: "December - Week 51"    ← heading level 2    │
│  └── Section: "Pest & Disease Thresholds"  ← heading level 1   │
│      └── Section: "Fusarium Wilt"          ← heading level 2   │
│                                                                  │
│  HybridChunker output for the Week 50 block:                    │
│  {                                                               │
│    text: "Rainfall: 4.5 mm\nMax Temp: 26.2°C\n...",            │
│    headings: ["Crop Weather Calendar", "December - Week 50"],   │
│    page_numbers: [3]                                             │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Change 2 — Heading-Prepend Embedding Enrichment

### The problem it solves

Even with structured chunks, the embedding model only sees the chunk body at embed time. A chunk that reads:

```
- Rainfall: 4.5 mm
- Max Temp: 26.2°C
- Min Temp: 14.7°C
- Stage: Tuber Set / Initiation
```

...is semantically ambiguous without context. Is this about rice? Wheat? What region? What time of year?

When a user asks *"what is the temperature during potato tuber development in Dhaka?"*, the query embedding and the bare chunk embedding are far apart in vector space because the chunk says nothing about *potato*, *Dhaka*, or *tuber development* — all of that was in the heading.

### What changed

In `_load_and_chunk()` inside `genieai_dataprep_arangodb.py`, after getting chunks from HybridChunker, the heading path is prepended to each chunk's text **before embedding**:

```python
# genieai_dataprep_arangodb.py — _load_and_chunk()

for chunk in raw_chunks:
    text     = chunk.get("text", "")
    headings = chunk.get("headings") or []
    pages    = chunk.get("page_numbers") or []

    if not is_valid_content(text):
        continue

    # Prepend heading breadcrumb so the embedding captures section context.
    if headings:
        heading_prefix = " > ".join(headings)
        embedded_text = f"{heading_prefix}\n\n{text}"
    else:
        embedded_text = text

    enriched.append({
        "text":         embedded_text,   # this is what gets embedded and stored
        "headings":     headings,        # raw list stored in metadata
        "page_numbers": pages,
    })
```

### The result

```
┌─────────────────────────────────────────────────────────────────┐
│  BEFORE (bare chunk text sent to embedding model):              │
│                                                                  │
│  "- Rainfall: 4.5 mm                                            │
│   - Max Temp: 26.2°C                                            │
│   - Min Temp: 14.7°C                                            │
│   - Stage: Tuber Set / Initiation"                              │
│                                                                  │
│  ──────────────────────────────────────────────────────────     │
│                                                                  │
│  AFTER (enriched text sent to embedding model):                 │
│                                                                  │
│  "Crop Weather Calendar - Potato (Dhaka Region) >               │
│   December - Week 50                                            │
│                                                                  │
│   - Rainfall: 4.5 mm                                            │
│   - Max Temp: 26.2°C                                            │
│   - Min Temp: 14.7°C                                            │
│   - Stage: Tuber Set / Initiation"                              │
└─────────────────────────────────────────────────────────────────┘
```

Now the embedding vector carries signal about *potato*, *Dhaka*, *crop calendar*, and *December*. A query like *"potato temperature in Dhaka December"* will produce a much closer vector to this chunk than before.

### Why this is safe

The raw `headings` and `page_numbers` lists are stored separately in ArangoDB metadata. The enriched `text` (with headings prepended) is what gets embedded and stored as `page_content`. The LLM receives the enriched text, which is fine — the heading prefix is human-readable and provides useful context for generation.

---

## 6. Change 3 — Rich Metadata in ArangoDB

### What changed

The `Document()` objects built in `ingest_file_with_guardrail()` now include `headings` and `page_numbers` in their metadata:

```python
# genieai_dataprep_arangodb.py — ingest_file_with_guardrail()

Document(
    page_content=doc["text"],          # enriched text (headings prepended)
    metadata={
        "file_id":      input.file_id,
        "file_path":    input.storage_path,
        "chunk_index":  i,
        "chunk_labels": doc["labels"],
        # NEW ↓
        "headings":     doc.get("headings", []),
        "page_numbers": doc.get("page_numbers", []),
    }
)
```

### ArangoDB document structure (after)

```json
{
  "_key": "abc123",
  "_id": "GRAPH_TEST_SOURCE/abc123",
  "text": "Crop Weather Calendar - Potato (Dhaka Region) > December - Week 50\n\n- Rainfall: 4.5 mm\n- Max Temp: 26.2°C\n- Min Temp: 14.7°C",
  "embedding": [0.012, -0.043, ...],    // 768-dim vector
  "file_id": "1777735767269_2acb4dcf",
  "file_path": "./uploaded_files/potato_dhaka.md",
  "chunk_index": 9,
  "chunk_labels": ["Weather Forecasts", "Potato Threshold Profiles"],
  "headings": ["Crop Weather Calendar - Potato (Dhaka Region)", "December - Week 50"],
  "page_numbers": [3]
}
```

### Why this matters

- The inspection script and any future tooling can retrieve headings and page numbers without re-parsing the source document
- The heading list is the canonical structured form (not baked into the text) — useful for filtering or grouping
- Page numbers enable citation ("see page 3") in future UI features

---

## 7. Change 4 — Retrieval Parameter Tuning

### Parameters changed in `.env`

```bash
# Before
RETRIEVER_ARANGO_K              = 5
RETRIEVER_ARANGO_FETCH_K        = 15
RETRIEVER_ARANGO_SCORE_THRESHOLD = 0.5

# After
RETRIEVER_ARANGO_K              = 20
RETRIEVER_ARANGO_FETCH_K        = 40
RETRIEVER_ARANGO_SCORE_THRESHOLD = 0.35
```

### K: 5 → 20

K controls how many chunks the vector store returns before reranking. With K=5, the cross-encoder TEI reranker received 5 chunks and returned 5 chunks — it was completely wasted.

```
┌─────────────────────────────────────────────────────────────────┐
│  K=5 (old):                                                     │
│                                                                  │
│  Vector search → [chunk1, chunk2, chunk3, chunk4, chunk5]       │
│                              ↓                                  │
│  TEI reranker (top_n=5) → same 5, barely reordered             │
│  BM25 (also on 5) → no meaningful spread                        │
│                                                                  │
│  ──────────────────────────────────────────────────────         │
│                                                                  │
│  K=20 (new):                                                    │
│                                                                  │
│  Vector search → [c1 … c20]  ← wide candidate set              │
│                              ↓                                  │
│  BM25 rerank → combined scores spread across 20 candidates      │
│                              ↓                                  │
│  TEI cross-encoder (top_n=5) → cuts 20 → 5 best               │
│                              ↓                                  │
│  LLM receives the 5 genuinely best chunks                       │
└─────────────────────────────────────────────────────────────────┘
```

### Score threshold: 0.5 → 0.35

With the embedding model used (768-dim sentence transformer), factual agricultural content typically scores 0.70–0.78. The old threshold of 0.5 was passing everything — it had no filtering effect. Meanwhile, any chunk that genuinely deserved to be in the top 20 but scored 0.36–0.49 (perhaps because it was short or used different terminology) was being silently dropped.

Lowering to **0.35** widens the candidate pool while still excluding truly irrelevant content (which scores below 0.30).

### Fetch K: 15 → 40

`FETCH_K` is used in MMR (Maximum Marginal Relevance) search mode: the vector store fetches `fetch_k` candidates, then applies the diversity algorithm to return `k`. With `fetch_k=15` and `k=5`, the diversity selection was too constrained. With `fetch_k=40`, MMR has a much larger pool to pick diverse results from.

---

## 8. Change 5 — BM25 Reranking

### What is BM25?

BM25 (Best Match 25) is a classic information retrieval ranking function based on term frequency and inverse document frequency. It answers the question: *"how many times do the query words appear in this document, weighted by how rare those words are across the corpus?"*

Unlike cosine similarity over dense embeddings, BM25 rewards **exact keyword matches**. It is particularly useful for:
- Domain-specific terminology (e.g., *"fusarium wilt"*, *"BPH"*, *"wire worm"*)
- Acronyms and proper nouns the embedding model may generalise over
- Short factual queries where word overlap matters

### Where it sits in the pipeline

BM25 runs **after** vector search and **before** the TEI cross-encoder reranker. It re-scores all K=20 candidates using keyword overlap, then combines with the cosine score. The TEI reranker then makes the final cut.

```
┌───────────────────────────────────────────────────────────────────┐
│                    RETRIEVAL PIPELINE (new)                       │
│                                                                   │
│  Query text                                                       │
│      │                                                            │
│      ▼                                                            │
│  TEI Embedding (768-dim vector)                                   │
│      │                                                            │
│      ▼                                                            │
│  ArangoDB COSINE_SIMILARITY search                                │
│  └─ returns top 20 chunks (score ≥ 0.35)                         │
│      │                                                            │
│      ▼                                                            │
│  ┌──────────────────────────────────────────────┐                │
│  │  BM25 reranking (in-memory, rank_bm25)       │                │
│  │                                              │                │
│  │  1. Tokenise each chunk: findall(\b\w+\b)    │                │
│  │  2. Build BM25Okapi on the 20-chunk corpus   │                │
│  │  3. Score each chunk against query tokens    │                │
│  │  4. Normalise scores to [0, 1]               │                │
│  │  5. combined = cosine_score + bm25_norm      │                │
│  │  6. Sort by combined DESC                    │                │
│  └──────────────────────────────────────────────┘                │
│      │                                                            │
│      ▼                                                            │
│  TEI cross-encoder reranker                                       │
│  └─ cuts 20 → top 5 (RERANKER_TOP_N)                             │
│      │                                                            │
│      ▼                                                            │
│  LLM (vLLM) generates answer from 5 ranked chunks                │
└───────────────────────────────────────────────────────────────────┘
```

### Implementation

```python
# genieai_retriever_arangodb.py — BM25 block (added after vector search)

if len(search_res) > 1:
    try:
        tokenize = lambda text: re.findall(r"\b\w+\b", text.lower())

        # Build corpus from all 20 retrieved chunks
        corpus = [r["doc"].page_content for r in search_res]
        tokenized_corpus = [tokenize(doc) for doc in corpus]
        bm25 = BM25Okapi(tokenized_corpus)

        # Score each chunk against the query
        bm25_scores = bm25.get_scores(tokenize(query))

        # Normalise to [0, 1] — BM25 scores are unbounded
        bm25_max = max(bm25_scores) if max(bm25_scores) > 0 else 1.0
        bm25_norm = [s / bm25_max for s in bm25_scores]

        # Combine: cosine + normalised BM25
        for i, r in enumerate(search_res):
            vector_score = r.get("score", 0.0) or 0.0
            r["bm25_score"]     = bm25_norm[i]
            r["combined_score"] = vector_score + bm25_norm[i]

        # Sort by combined score
        search_res.sort(key=lambda r: r["combined_score"], reverse=True)

    except Exception as e:
        logger.warning(f"[BM25] Reranking failed, keeping vector order: {e}")
```

### Score interpretation

```
┌──────────────────────────────────────────────────────────────────┐
│  Example output from inspect_retrieval.py:                       │
│                                                                  │
│  CHUNK #1    combined=1.7161  vector=0.7161  bm25=1.0000        │
│  ─ query: "what is the minimum temperature of the crop calendar" │
│  ─ chunk: "# Favorable Weather Conditions > Potato Wire Worm     │
│            Soil temperature 10-27°C"                            │
│                                                                  │
│  → bm25=1.0 means this chunk had the highest keyword overlap     │
│    with the query ("temperature", "minimum"). Pure cosine        │
│    ranked it #5 (score=0.7161). BM25 promoted it to #1.         │
│                                                                  │
│  CHUNK #5    combined=0.9306  vector=0.7483  bm25=0.1823        │
│  ─ chunk: "# Crop Weather Calendar > December - Week 50          │
│            Min Temp: 14.7°C, Max Temp: 26.2°C"                 │
│                                                                  │
│  → vector=0.7483 (highest cosine score), but bm25=0.18          │
│    (few exact keyword matches). Combined score is lower.         │
└──────────────────────────────────────────────────────────────────┘
```

### Normalisation rationale

BM25 scores are unbounded — a score of 3.2 in one query is not comparable to 1.8 in another. Dividing by the max score within each query's result set normalises to [0, 1], making the addition with cosine similarity (already in [0, 1]) meaningful.

### Dockerfile change

`rank_bm25` was already present in the dataprep container (for label BM25 strategy). It was missing from the retriever:

```dockerfile
# Dockerfile-retriever_genie-ai — added

# Step C2: Additional GENIE-AI retriever dependencies
RUN pip install --no-cache-dir rank_bm25
```

---

## 9. End-to-End Pipeline: Before vs After

### Before

```
PDF / DOCX
    │
    ▼
docling_converter.convert()
    │
    ▼
export_to_markdown()            ← all structure discarded
    │  returns: one big string
    ▼
RecursiveCharacterTextSplitter  ← splits by character count
    │  produces: List[str]
    ▼
_apply_labels()                 ← labels added
    │  produces: [{"text": str, "labels": [...]}]
    ▼
_run_guardrail()
    ▼
Document(page_content=text, metadata={file_id, file_path, chunk_index, chunk_labels})
    │
    ▼
ArangoDB _SOURCE collection
    {text: "bare chunk text", embedding: [...], chunk_labels: [...]}

──────────────────────────────────────────────────────────

RETRIEVAL (k=5, threshold=0.5)

Query → embed → cosine search → 5 chunks → TEI reranker (no-op) → LLM
```

### After

```
PDF / DOCX
    │
    ▼
docling_converter.convert()     ← builds full DoclingDocument model
    │
    ▼
HybridChunker.chunk()           ← respects semantic boundaries
    │  produces: List[{text, headings, page_numbers}]
    ▼
heading-prepend enrichment      ← "H1 > H2\n\nchunk body"
    │  enriched text carries section context into embedding
    ▼
is_valid_content() filter       ← drops base64, MIME garbage
    ▼
_apply_labels()                 ← works on enriched texts
    │  produces: [{text, headings, page_numbers, labels}]
    ▼
_run_guardrail([c["text"] for c in chunks])
    ▼
Document(
    page_content = enriched_text,
    metadata = {
        file_id, file_path, chunk_index,
        chunk_labels,
        headings,       ← NEW
        page_numbers,   ← NEW
    }
)
    │
    ▼
ArangoDB _SOURCE collection
    {
      text: "Crop Calendar > December - Week 50\n\n- Min Temp: 14.7°C",
      embedding: [...],
      chunk_labels: ["Weather Forecasts"],
      headings: ["Crop Calendar", "December - Week 50"],
      page_numbers: [3]
    }

──────────────────────────────────────────────────────────

RETRIEVAL (k=20, threshold=0.35)

Query
  │
  ▼
TEI embed (768-dim)
  │
  ▼
ArangoDB cosine search → 20 candidates (threshold=0.35)
  │
  ▼
BM25 rerank (in-memory)
  │   combined = cosine + bm25_normalised
  │   sort by combined DESC
  ▼
TEI cross-encoder reranker → top 5
  │
  ▼
LLM generates answer
```

---

## 10. Inspecting Retrieved Chunks

The script `scripts/inspect_retrieval.py` reproduces the full pipeline (vector search + BM25 rerank) and shows every chunk with its scores and metadata.

### From the host (simplest)

```bash
# Replay last logged query automatically
python3 scripts/inspect_retrieval.py

# Custom query
python3 scripts/inspect_retrieval.py "what fertilizer for potato late blight?"

# Full chunk text, lower threshold, fewer results
python3 scripts/inspect_retrieval.py --full --k 5 --threshold 0.2 "wire worm soil treatment"
```

### Via docker exec

```bash
docker exec \
  -e INSPECT_ARANGO_URL=http://arango-vector-db:8529 \
  -e INSPECT_TEI_URL=http://tei:80 \
  -e INSPECT_EMBED_URL=http://embedding:6000/v1/embeddings \
  -i genie-ai-retriever-arango \
  python3 - < scripts/inspect_retrieval.py "your query here"
```

### Reading the output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CHUNK #1   combined=1.7161  vector=0.7161  bm25=1.0000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Headings   : Favorable Weather Conditions > Potato Wire Worm
  Pages      : [2]
  Labels     : ['Weather Forecasts', 'Pest & Disease Management']
  File       : ./uploaded_files/potato_dhaka.md  (chunk #30)

  ──────────────────────────────────────────────────────────────────
  # Favorable Weather Conditions for Pests & Diseases
  ## Potato Wire Worm
  - Soil temperature 10-27°C
```

| Field | Meaning |
|---|---|
| `combined` | Final ranking score (cosine + normalised BM25). Sort key. |
| `vector` | Raw cosine similarity from ArangoDB vector search (0–1). |
| `bm25` | Normalised BM25 keyword overlap score (0–1, 1.0 = best in set). |
| `Headings` | Section path from the source document's heading hierarchy. |
| `Pages` | Page numbers in the source PDF where this chunk appears. |
| `Labels` | Taxonomy labels assigned by the LLM during ingestion. |

---

## 11. Configuration Reference

All tuning parameters are in `.env` at the project root.

### Retrieval

| Variable | Default | Effect |
|---|---|---|
| `RETRIEVER_ARANGO_K` | `20` | Chunks returned by vector search (candidate pool for BM25 + reranker) |
| `RETRIEVER_ARANGO_FETCH_K` | `40` | Candidate pool for MMR search mode |
| `RETRIEVER_ARANGO_SCORE_THRESHOLD` | `0.35` | Min cosine similarity to enter the candidate pool |
| `RETRIEVER_ARANGO_SEARCH_MODE` | `vector` | `vector` \| `mmr` |
| `RETRIEVER_ARANGO_DISTANCE_STRATEGY` | `COSINE` | `COSINE` \| `EUCLIDEAN_DISTANCE` |
| `RETRIEVER_ARANGO_FILTER_STRATEGY` | `OR` | `AND` \| `OR` — how label filters combine |

### Ingestion

| Variable | Default | Effect |
|---|---|---|
| `CONTENT_EXTRACTION_METHOD` | `docling` | `docling` uses HybridChunker; `opea` uses the original character splitter |
| `DOCLING_DEVICE` | `cuda` | `cuda` for GPU, `cpu` to force CPU inference |
| `LABELING_STRATEGY` | `llm` | `llm` \| `embedding` \| `bm25` |
| `EMBEDDING_LABEL_THRESHOLD` | `0.75` | Min cosine similarity for embedding-based label assignment |
| `BM25_LABEL_THRESHOLD` | `2.00` | Min BM25 score for BM25-based label assignment |

### Reranker

| Variable | Default | Effect |
|---|---|---|
| `RERANKER_TOP_N` | `5` | How many chunks the TEI cross-encoder keeps from the K=20 candidates |
| `RERANKER_SCORE_THRESHOLD` | _none_ | Optional min cross-encoder score (slice strategy ignores this) |

> **Tip:** If answers are missing detail, raise `RETRIEVER_ARANGO_K` (more candidates) or lower `RETRIEVER_ARANGO_SCORE_THRESHOLD` (wider net). If answers contain noise, raise the threshold or lower K.
