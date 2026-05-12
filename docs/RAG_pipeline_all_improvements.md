# RAG Pipeline — Complete Improvement Log

> **Project:** MEWA v2 — Bangladesh Agricultural Advisory Chatbot  
> **Stack:** OPEA ChatQnA · Docling · vLLM (Granite 3.3-2b-instruct) · ArangoDB · TEI Embedding & Reranker · Docker Compose  
> **Files changed across both improvement rounds:**
> - `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`
> - `genie-ai-overlay/chatqna/genieai_chatqna.py`
> - `genie-ai-overlay/core/genieai_dataprep_utils.py`
> - `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`
> - `Dockerfile-retriever_genie-ai`
> - `.env`

---

## Table of Contents

1. [Problem Landscape](#1-problem-landscape)
2. [Round 1 — Retrieval Quality Improvements](#2-round-1--retrieval-quality-improvements)
   - 2.1 [Structured Chunking with HybridChunker](#21-structured-chunking-with-hybridchunker)
   - 2.2 [Heading-Prepend Embedding Enrichment](#22-heading-prepend-embedding-enrichment)
   - 2.3 [Rich Metadata in ArangoDB](#23-rich-metadata-in-arangodb)
   - 2.4 [Retrieval Parameter Tuning](#24-retrieval-parameter-tuning)
   - 2.5 [BM25 Reranking Layer](#25-bm25-reranking-layer)
3. [Round 2 — Generation Quality & Data Integrity Improvements](#3-round-2--generation-quality--data-integrity-improvements)
   - 3.1 [System Role Separation](#31-system-role-separation)
   - 3.2 [System Prompt Leakage Stripper](#32-system-prompt-leakage-stripper)
   - 3.3 [Deterministic Temperature](#33-deterministic-temperature)
   - 3.4 [Month-Week Format Cleaner](#34-month-week-format-cleaner)
   - 3.5 [Synthetic Aggregation Chunks](#35-synthetic-aggregation-chunks)
   - 3.6 [Language Detection Guard](#36-language-detection-guard)
   - 3.7 [Stricter Abstention System Prompt](#37-stricter-abstention-system-prompt)
4. [Full Pipeline: Before vs After](#4-full-pipeline-before-vs-after)
5. [Configuration Reference](#5-configuration-reference)

---

## 1. Problem Landscape

Across two rounds of improvement, the following failure classes were diagnosed and fixed:

| # | Symptom | Root Cause Category |
|---|---------|---------------------|
| 1 | "I don't have enough information" for known facts | Retrieval — decontextualised chunks, k too small |
| 2 | Wrong chunks ranked first | Retrieval — cosine-only ranking, no keyword signal |
| 3 | Incomplete answers to "list all X" queries | Ingestion — multi-chunk split for list columns |
| 4 | Month values with appended numbers (`November.47`) | Ingestion — PyMuPDF cell-address encoding leaking into chunks |
| 5 | LLM echoes its own system instructions in the response | Generation — system prompt placed in user role, not system role |
| 6 | Inconsistent answers across identical queries | Generation — temperature > 0 allowing sampling variance |
| 7 | French responses to English queries | Generation — `langdetect` misidentifying short English texts |

---

## 2. Round 1 — Retrieval Quality Improvements

### 2.1 Structured Chunking with HybridChunker

**File:** `genie-ai-overlay/core/genieai_dataprep_utils.py`

#### Problem

`export_to_markdown()` discarded all document structure — headings, section hierarchy, page numbers — and returned a flat string that was then split by character count. Chunks had no idea which section they belonged to.

#### Fix

`load_with_docling()` now drives Docling's `HybridChunker`, which works directly on the internal document model before any serialisation to text.

```python
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

```
┌──────────────────────────────────────────────────────────┐
│  Docling Internal Document Model                          │
│                                                           │
│  DoclingDocument                                          │
│  ├── Section: "Crop Weather Calendar"   ← heading L1     │
│  │   ├── Section: "December - Week 50" ← heading L2     │
│  │   │   ├── ListItem: "Rainfall: 4.5 mm"               │
│  │   │   ├── ListItem: "Max Temp: 26.2°C"               │
│  │   │   └── ListItem: "Stage: Tuber Set"  ← page 3     │
│  └── Section: "Pest & Disease Thresholds"               │
│                                                           │
│  HybridChunker output for the Week 50 block:             │
│  {                                                        │
│    text: "Rainfall: 4.5 mm\nMax Temp: 26.2°C\n…",      │
│    headings: ["Crop Weather Calendar","December-Week 50"]│
│    page_numbers: [3]                                      │
│  }                                                        │
└──────────────────────────────────────────────────────────┘
```

---

### 2.2 Heading-Prepend Embedding Enrichment

**File:** `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — `_load_and_chunk()`

#### Problem

Even with structured chunks, the embedding model only saw the bare chunk body. A chunk containing `"- Rainfall: 4.5 mm\n- Max Temp: 26.2°C"` carried no signal about *potato*, *Dhaka*, or *December*. The query `"potato temperature in December Dhaka"` would land far from this chunk in vector space.

#### Fix

The heading path is prepended to each chunk's text **before embedding**:

```python
# _load_and_chunk() — Docling path
for chunk in raw_chunks:
    text     = chunk.get("text", "")
    headings = chunk.get("headings") or []
    pages    = chunk.get("page_numbers") or []

    if not is_valid_content(text):
        continue

    if headings:
        heading_prefix = " > ".join(headings)
        embedded_text = f"{heading_prefix}\n\n{text}"
    else:
        embedded_text = text

    enriched.append({
        "text":         embedded_text,
        "headings":     headings,
        "page_numbers": pages,
    })
```

```
┌──────────────────────────────────────────────────────────┐
│  BEFORE — bare chunk sent to embedding model:            │
│                                                          │
│  "- Rainfall: 4.5 mm                                    │
│   - Max Temp: 26.2°C                                    │
│   - Min Temp: 14.7°C                                    │
│   - Stage: Tuber Set / Initiation"                      │
│                                                          │
│  ────────────────────────────────────────────────────── │
│                                                          │
│  AFTER — enriched text sent to embedding model:         │
│                                                          │
│  "Crop Weather Calendar - Potato (Dhaka Region) >       │
│   December - Week 50                                    │
│                                                          │
│   - Rainfall: 4.5 mm                                    │
│   - Max Temp: 26.2°C                                    │
│   - Min Temp: 14.7°C                                    │
│   - Stage: Tuber Set / Initiation"                      │
└──────────────────────────────────────────────────────────┘
```

The raw heading list is stored separately in ArangoDB metadata so it can be used for citation or filtering without re-parsing the source.

---

### 2.3 Rich Metadata in ArangoDB

**File:** `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — `ingest_file_with_guardrail()`

`Document()` objects now carry `headings` and `page_numbers` alongside the existing fields:

```python
Document(
    page_content=doc["text"],
    metadata={
        "file_id":      input.file_id,
        "file_path":    input.storage_path,
        "chunk_index":  i,
        "chunk_labels": doc["labels"],
        "headings":     doc.get("headings", []),    # NEW
        "page_numbers": doc.get("page_numbers", []), # NEW
    }
)
```

**Resulting ArangoDB document:**

```json
{
  "_key": "abc123",
  "text": "Crop Weather Calendar - Potato (Dhaka Region) > December - Week 50\n\n- Rainfall: 4.5 mm\n- Max Temp: 26.2°C",
  "embedding": [0.012, -0.043, "...768 dims..."],
  "file_id": "1777735767269_2acb4dcf",
  "chunk_index": 9,
  "chunk_labels": ["Weather Forecasts"],
  "headings": ["Crop Weather Calendar - Potato (Dhaka Region)", "December - Week 50"],
  "page_numbers": [3]
}
```

---

### 2.4 Retrieval Parameter Tuning

**File:** `.env`

```
# Before → After
RETRIEVER_ARANGO_K               = 5  → 20
RETRIEVER_ARANGO_FETCH_K         = 15 → 40
RETRIEVER_ARANGO_SCORE_THRESHOLD = 0.5 → 0.35
```

```
┌──────────────────────────────────────────────────────────┐
│  K=5 (old):                                              │
│                                                          │
│  Vector search → [c1, c2, c3, c4, c5]                   │
│       ↓                                                  │
│  TEI reranker (top_n=5) → same 5, barely reordered      │
│                                                          │
│  ────────────────────────────────────────────────────── │
│                                                          │
│  K=20 (new):                                             │
│                                                          │
│  Vector search → [c1 … c20]   ← wide candidate set      │
│       ↓                                                  │
│  BM25 rerank → combined scores across 20 candidates     │
│       ↓                                                  │
│  TEI cross-encoder (top_n=5) → cuts 20 → 5 best        │
│       ↓                                                  │
│  LLM receives the 5 genuinely best chunks               │
└──────────────────────────────────────────────────────────┘
```

**Score threshold 0.5 → 0.35:** Agricultural factual chunks score 0.70–0.78 in cosine similarity. The old threshold of 0.5 had zero filtering effect. Lowering to 0.35 widens the candidate pool while still excluding truly irrelevant content (which scores < 0.30).

---

### 2.5 BM25 Reranking Layer

**File:** `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`  
**Dockerfile:** `Dockerfile-retriever_genie-ai` — `RUN pip install --no-cache-dir rank_bm25`

BM25 runs **after vector search** and **before the TEI cross-encoder**. It rewards exact keyword matches for domain-specific terms (`wire worm`, `fusarium wilt`, `BPH`) that the embedding model dilutes across 768 dimensions.

```python
if len(search_res) > 1:
    try:
        tokenize = lambda text: re.findall(r"\b\w+\b", text.lower())

        corpus            = [r["doc"].page_content for r in search_res]
        tokenized_corpus  = [tokenize(doc) for doc in corpus]
        bm25              = BM25Okapi(tokenized_corpus)
        bm25_scores       = bm25.get_scores(tokenize(query))

        # Normalise to [0,1] — BM25 scores are unbounded
        bm25_max  = max(bm25_scores) if max(bm25_scores) > 0 else 1.0
        bm25_norm = [s / bm25_max for s in bm25_scores]

        for i, r in enumerate(search_res):
            r["bm25_score"]     = bm25_norm[i]
            r["combined_score"] = (r.get("score", 0.0) or 0.0) + bm25_norm[i]

        search_res.sort(key=lambda r: r["combined_score"], reverse=True)

    except Exception as e:
        logger.warning(f"[BM25] Reranking failed, keeping vector order: {e}")
```

```
┌───────────────────────────────────────────────────────────────┐
│                 RETRIEVAL PIPELINE (Round 1 final)            │
│                                                               │
│  Query text                                                   │
│      │                                                        │
│      ▼                                                        │
│  TEI Embedding (768-dim vector)                               │
│      │                                                        │
│      ▼                                                        │
│  ArangoDB COSINE_SIMILARITY search                            │
│  └─ returns top 20 chunks (score ≥ 0.35)                     │
│      │                                                        │
│      ▼                                                        │
│  ┌──────────────────────────────────────────────────┐        │
│  │  BM25 reranking (in-memory, rank_bm25)           │        │
│  │  combined = cosine_score + bm25_normalised       │        │
│  │  sort by combined DESC                           │        │
│  └──────────────────────────────────────────────────┘        │
│      │                                                        │
│      ▼                                                        │
│  TEI cross-encoder reranker → top 5 (RERANKER_TOP_N)        │
│      │                                                        │
│      ▼                                                        │
│  LLM generates answer from 5 ranked chunks                   │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Round 2 — Generation Quality & Data Integrity Improvements

### 3.1 System Role Separation

**File:** `genie-ai-overlay/chatqna/genieai_chatqna.py` — `align_inputs()` (~line 538)

#### Problem

The system prompt and the user context (RAG chunks + query) were concatenated into a **single `{"role": "user"}` message**. Granite 3.3 treats the user role as content it may reflect on or echo, not as instructions to follow silently. On the first query, the model would reproduce the system instructions verbatim before giving the actual answer.

#### Fix

System instructions go in the **`system` role**; user context + query go in the **`user` role**.

```python
# BEFORE — everything lumped into one user message
next_inputs["messages"] = [
    {"role": "user", "content": system_instructions + "\n\n" + prompt_add_context}
]

# AFTER — roles separated as OpenAI format intended
next_inputs["messages"] = [
    {"role": "system", "content": system_instructions},
    {"role": "user",   "content": prompt_add_context.lstrip()},
]
```

This is the **primary fix** for leakage. The stripper (§3.2) is a safety net for residual cases.

---

### 3.2 System Prompt Leakage Stripper

**File:** `genie-ai-overlay/chatqna/genieai_chatqna.py` — module level + `align_outputs()` (~line 757)

#### Problem

After the role-separation fix, some cached or in-flight responses (and some Granite fine-tuning edge cases) still prefixed answers with partial system instructions.

#### Fix

A post-processor scans for known end-of-system-prompt marker phrases and strips everything that precedes them from the LLM output.

```python
# Known phrases that appear at the very end of the system prompt,
# just before the model's actual answer starts.
_SYSTEM_PROMPT_END_MARKERS = [
    "Answer the user's latest question using ONLY the provided knowledge base content.",
    "</INSTRUCTIONS>",
]


def _strip_system_prompt_leakage(text: str) -> str:
    """Remove system-prompt content if the LLM echoed it before its answer."""
    for marker in _SYSTEM_PROMPT_END_MARKERS:
        if marker in text:
            idx     = text.find(marker) + len(marker)
            stripped = text[idx:].lstrip("\n ")
            if stripped:
                logger.warning("[LLM] System prompt leakage detected and stripped.")
                return stripped
    return text
```

Wired into `align_outputs()` at the LLM output node:

```python
# align_outputs() — LLM non-streaming branch
raw_text = data["choices"][0]["message"]["content"]
next_data["text"] = _strip_system_prompt_leakage(raw_text)
```

```
┌──────────────────────────────────────────────────────────────┐
│  LLM raw output (leakage present):                           │
│                                                              │
│  "STRICT KNOWLEDGE RULES:                                    │
│   - Only use content from the knowledge base.               │
│   Answer the user's latest question using ONLY the          │
│   provided knowledge base content.                          │
│                                                              │
│   Potatoes have seven growth stages: Sprouting,…"          │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  After _strip_system_prompt_leakage():                      │
│                                                              │
│  "Potatoes have seven growth stages: Sprouting,…"          │
└──────────────────────────────────────────────────────────────┘
```

---

### 3.3 Deterministic Temperature

**File:** `genie-ai-overlay/chatqna/genieai_chatqna.py` (LLM parameter section)

```python
# BEFORE
"temperature": 0.01

# AFTER
"temperature": 0
```

**Why it matters:** With `temperature=0.01`, the model still samples stochastically. This produced inconsistent month answers for identical crop calendar queries (e.g., `"November"` on one request, `"December"` on the next). Setting `temperature=0` makes the model deterministic — the same context always produces the same answer.

---

### 3.4 Month-Week Format Cleaner

**File:** `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — module level + `_load_and_chunk()`

#### Problem

PyMuPDF extracts crop-calendar PDF tables **column by column**. Cell addresses are encoded as `CropName.Month.WeekNumber` inside the chunk text:

```
Potato.November.47 = 22.3
Potato.November.48 = 19.1
Potato.December.49 = 15.4
```

When these chunks were retrieved and fed to the LLM, week numbers leaked into answers: `"harvesting occurs in November.47 November.48 December.49"`.

#### Fix

A regex cleaner runs on every chunk before it is embedded or stored:

```python
_MONTH_WEEK_RE = re.compile(
    r'\b[A-Z]\w*\.(January|February|March|April|May|June|July|August|September|'
    r'October|November|December)\.(\d{1,2})\b'
)


def _clean_chunk_text(text: str) -> str:
    """Replace 'CropName.Month.NN' with 'Month (week NN)'."""
    return _MONTH_WEEK_RE.sub(r'\1 (week \2)', text)
```

The pattern requires a **capital first letter** (`[A-Z]\w*`) so it only matches proper crop-name prefixes (e.g. `Potato`, `Rice`) — not lowercase variable names like `days` that could accidentally match.

**Applied in both extraction paths:**

```python
# Docling path (line ~437)
text = _clean_chunk_text(text)

# Non-Docling path (line ~494)
result = [
    {"text": _clean_chunk_text(c), "headings": [], "page_numbers": []}
    for c in plain_chunks
    if is_valid_content(c)
]
```

```
┌──────────────────────────────────────────────────────────┐
│  BEFORE (stored in ArangoDB, sent to LLM):               │
│                                                          │
│  "Potato.November.47 = 22.3                              │
│   Potato.November.48 = 19.1                              │
│   Potato.December.49 = 15.4"                             │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│                                                          │
│  AFTER (stored in ArangoDB, sent to LLM):                │
│                                                          │
│  "November (week 47) = 22.3                              │
│   November (week 48) = 19.1                              │
│   December (week 49) = 15.4"                             │
└──────────────────────────────────────────────────────────┘
```

> **Requires re-ingestion.** The cleaner runs at ingest time. Existing documents in ArangoDB were created before this fix and still contain the raw format. Delete and re-upload affected PDFs after deploying the new dataprep image.

---

### 3.5 Synthetic Aggregation Chunks

**File:** `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — module level + `_load_and_chunk()`

#### Problem

Crop-calendar PDFs are extracted column by column by PyMuPDF/Docling. A "Stages" column spanning 10 rows becomes **10 separate chunks** (or two chunks if the column is split across pages). A query like `"what are the growth stages of potato?"` would retrieve one or two chunks and give an incomplete answer.

The same problem affects pest/disease lists — each pest is its own key-value chunk:

```
# Chunk 30: "Potato Wire Worm, N = Soil temperature 10-27°C"
# Chunk 31: "Late Blight, N = Humidity > 90%, Temp 10-25°C"
# Chunk 32: "Aphids, N = Temp 20-30°C"
```

A `"list all pests"` query can only retrieve a few of these at a time.

#### Fix

`_build_aggregation_chunks()` makes **one pass over all chunks after `_load_and_chunk()`** and emits synthetic aggregation chunks — one for lifecycle stages, one for pests/diseases.

```python
_METEO_COLUMN_RE = re.compile(       # meteorological variable names to EXCLUDE
    r'(?i)^(max\.?\s*temp|min\.?\s*temp|rainfall|humidity|rh\s*max|...)'
)
_LIFECYCLE_RE = re.compile(           # lifecycle keyword detector
    r'(?i)\b(stage|sprouting|seedling|vegetative|tuber|maturity|harvest|...)\b'
)
_ENTITY_RE = re.compile(              # pest/disease keyword detector
    r'(?i)\b(pest|worm|aphid|mite|larva|larvae|blight|fungus|...)\b'
)


def _build_aggregation_chunks(chunks: list) -> list:
    lifecycle_values: list = []
    entity_names: set     = set()

    for chunk in chunks:
        text  = chunk.get("text", "")
        lines = [l.strip() for l in text.splitlines() if l.strip()]

        # Type A: pure short-line list (no "=" signs)
        if '=' not in text:
            all_short = all(len(l) <= 80 and len(l.split()) <= 8 for l in lines)
            if all_short and len(lines) >= 2:
                if _LIFECYCLE_RE.search(text):
                    lifecycle_values.extend(lines)
                elif _ENTITY_RE.search(text):
                    for line in lines:
                        if not re.match(r'(?i)^(pest|disease|insect|pathogen)s?$', line):
                            entity_names.add(line)

        # Type B: "EntityName, N = Condition" key-value format
        else:
            for entry in re.split(r'\.\s+', text):
                m = re.match(r'^(.+?),\s*\d+\s*=', entry.strip())
                if not m:
                    continue
                col_name = m.group(1).strip()
                if _METEO_COLUMN_RE.match(col_name):
                    continue          # skip meteo variables
                if len(col_name.split()) >= 2:
                    entity_names.add(col_name)

    synthetic = []

    if lifecycle_values:
        unique = deduplicate(lifecycle_values)  # preserves order
        body   = "\n".join(f"- {v}" for v in unique)
        synthetic.append({
            "text": "[AGGREGATED] Complete list of crop growth stages in this document:\n" + body,
            "headings": ["Stages"],
            "page_numbers": [],
        })

    if entity_names:
        body = "\n".join(f"- {name}" for name in sorted(entity_names))
        synthetic.append({
            "text": "[AGGREGATED] Pests, diseases, and organisms affecting this crop "
                    "(complete list from this document):\n" + body,
            "headings": ["Pests", "Diseases"],
            "page_numbers": [],
        })

    return synthetic
```

```
┌──────────────────────────────────────────────────────────────────┐
│  WITHOUT aggregation — query "what are the growth stages?":      │
│                                                                  │
│  Retrieved chunk 11:                                             │
│  "Stages                                                         │
│   Sprouting                                                      │
│   Seedling                                                       │
│   Vegetative                                                     │
│   Tuber Initiation                                               │
│   Tuber Bulking"           ← only 5 of 7 stages                 │
│                                                                  │
│  Retrieved chunk 12:                                             │
│  "Maturity                                                       │
│   Harvesting"              ← 2 remaining stages, separate chunk │
│                                                                  │
│  LLM answer: "The potato growth stages are: Sprouting,          │
│   Seedling, Vegetative, Tuber Initiation, Tuber Bulking."       │
│   (Maturity and Harvesting omitted — different chunk)           │
│                                                                  │
│  ──────────────────────────────────────────────────────────────  │
│                                                                  │
│  WITH aggregation — one synthetic chunk injected at ingest time: │
│                                                                  │
│  "[AGGREGATED] Complete list of crop growth stages:             │
│   - Sprouting                                                    │
│   - Seedling                                                     │
│   - Vegetative                                                   │
│   - Tuber Initiation                                             │
│   - Tuber Bulking                                                │
│   - Maturity                                                     │
│   - Harvesting"            ← all 7 stages in one retrievable    │
│                               chunk, always returned together   │
└──────────────────────────────────────────────────────────────────┘
```

**Detection logic — Type A vs Type B:**

```
Type A (pure list):                Type B (key=value):
─────────────────────              ─────────────────────────────────
"Stages                            "Potato Wire Worm, N = Soil temp 10-27°C.
 Sprouting                          Late Blight, N = Humidity > 90%.
 Seedling                           Aphids, N = Temp 20-30°C"
 Vegetative"

No "=" sign anywhere.              Has "EntityName, N = Condition" pattern.
All lines ≤ 80 chars.              Multi-word entity (≥2 words): kept.
Lifecycle keyword present.         Meteo column name: skipped.
→ lifecycle_values bucket          → entity_names set
```

Applied after both extraction paths:

```python
# Docling path
enriched += _build_aggregation_chunks(enriched)

# Non-Docling path
result += _build_aggregation_chunks(result)
```

---

### 3.6 Language Detection Guard

**File:** `genie-ai-overlay/chatqna/genieai_chatqna.py` — `_preprocess_inputs()` (~line 1291)

#### Problem

`langdetect` is unreliable for short texts. A 6-word English query like `"what pests affect potato crops?"` was being classified as French (`fr`) or another language, triggering unnecessary translation and producing answers in the wrong language.

#### Fix

Auto-detection is gated on a **minimum text length of 80 characters**. Shorter texts default to English without calling `langdetect`.

```python
# BEFORE — called detect() on any non-empty string
if last_user_content:
    detected_lang = detect(last_user_content)
    ...

# AFTER — 80-char minimum before trusting auto-detection
if last_user_content and len(last_user_content.strip()) >= 80:
    detected_lang = detect(last_user_content)
    # ... validate + apply
else:
    logger.info(
        f"Text too short for reliable language detection "
        f"({len(last_user_content.strip()) if last_user_content else 0} chars)"
        f" — defaulting to EN."
    )
    original_language = "EN"
```

The 80-character threshold was chosen empirically: it is roughly the length of two full sentences, at which point `langdetect` accuracy is acceptable for common Latin-script languages. Queries shorter than this in any language still work correctly because the response is generated from the RAG context (which is in English) and formatted for the user without translation.

---

### 3.7 Stricter Abstention System Prompt

**File:** `.env` — `CHATQNA_SYSTEM_PROMPT`

Two new rules were added to prevent the model from guessing or hallucinating:

```
NEVER infer or connect information across separate retrieved chunks.
Each fact must be explicitly stated in a single chunk.

NEVER guess a month, date, or value.
If no chunk explicitly states the answer, say you cannot find it.

If the answer is not in the provided content, say clearly:
'The provided documents do not contain that information.'
```

These rules target a specific failure mode: the model was connecting a *stage name* (from one chunk) to a *month name* (from a different chunk) and hallucinating stage-to-month mappings that were never stated in any single chunk.

---

## 4. Full Pipeline: Before vs After

### Ingestion

```
BEFORE:
───────
PDF
 │
 ▼
docling.convert() → export_to_markdown()   ← flat string, no structure
 │
 ▼
RecursiveCharacterTextSplitter             ← character count split
 │  produces: List[str]
 ▼
Document(page_content=bare_text,
         metadata={file_id, chunk_labels})
 │
 ▼
ArangoDB: {text: "bare chunk", embedding: [...]}


AFTER (Round 1 + Round 2):
───────────────────────────
PDF
 │
 ▼
docling.convert() → HybridChunker.chunk()  ← respects semantic boundaries
 │  produces: [{text, headings, page_numbers}]
 ▼
_clean_chunk_text()                        ← "Crop.Month.NN" → "Month (week NN)"
 │
 ▼
heading-prepend enrichment                 ← "H1 > H2\n\nchunk body"
 │  embedding vector now carries section context
 ▼
is_valid_content() filter                  ← drops base64, MIME garbage
 │
 ▼
_apply_labels()                            ← LLM / BM25 / embedding labelling
 │
 ▼
_build_aggregation_chunks()                ← synthetic lifecycle + entity chunks
 │
 ▼
_run_guardrail()
 │
 ▼
Document(
    page_content = enriched_text,
    metadata = {
        file_id, file_path, chunk_index,
        chunk_labels,
        headings,       ← section path
        page_numbers,   ← for citations
    }
)
 │
 ▼
ArangoDB:
{
  text: "Crop Calendar > Dec Week 50\n\n- Min Temp: 14.7°C",
  embedding: [...],
  headings: ["Crop Calendar", "December - Week 50"],
  page_numbers: [3]
}
```

### Retrieval & Generation

```
BEFORE:
───────
Query → embed → cosine search (k=5, threshold=0.5) → TEI reranker (no-op on 5)
      → LLM (system prompt in user role, temperature=0.01)


AFTER:
──────
Query
 │
 ▼
TEI Embedding (768-dim)
 │
 ▼
ArangoDB cosine search
 └─ k=20, threshold=0.35
 │
 ▼
BM25 rerank (in-memory)
 │  combined = cosine + bm25_normalised
 │  sort DESC
 ▼
TEI cross-encoder → top 5
 │
 ▼
LLM (Granite 3.3)
 │  messages: [
 │    {"role": "system", "content": <instructions>},   ← system role
 │    {"role": "user",   "content": <context+query>},  ← user role
 │  ]
 │  temperature = 0   ← deterministic
 │
 ▼
_strip_system_prompt_leakage()   ← safety net for residual leakage
 │
 ▼
Answer to user
```

---

## 5. Configuration Reference

### Retrieval (`.env`)

| Variable | Before | After | Effect |
|---|---|---|---|
| `RETRIEVER_ARANGO_K` | 5 | 20 | Candidate pool for BM25 + reranker |
| `RETRIEVER_ARANGO_FETCH_K` | 15 | 40 | MMR diversity candidate pool |
| `RETRIEVER_ARANGO_SCORE_THRESHOLD` | 0.5 | 0.35 | Min cosine similarity to enter pool |
| `RETRIEVER_ARANGO_SEARCH_MODE` | vector | vector | `vector` \| `mmr` |

### Ingestion (`.env`)

| Variable | Value | Effect |
|---|---|---|
| `CONTENT_EXTRACTION_METHOD` | `docling` | Uses HybridChunker; `opea` falls back to character splitter |
| `DOCLING_DEVICE` | `cuda` / `cpu` | GPU vs CPU for Docling inference |
| `LABELING_STRATEGY` | `llm` | `llm` \| `embedding` \| `bm25` |

### Reranker (`.env`)

| Variable | Value | Effect |
|---|---|---|
| `RERANKER_TOP_N` | 5 | Chunks the TEI cross-encoder keeps from k=20 |

### Generation (`.env` / code)

| Setting | Before | After | Location |
|---|---|---|---|
| `temperature` | 0.01 | 0 | `genieai_chatqna.py` |
| System role | user role | system role | `genieai_chatqna.py` `align_inputs()` |
| Leakage stripper | absent | `_strip_system_prompt_leakage()` | `genieai_chatqna.py` `align_outputs()` |
| Language detection min length | none | 80 chars | `genieai_chatqna.py` `_preprocess_inputs()` |
| `CHATQNA_SYSTEM_PROMPT` | basic | + abstention rules | `.env` |

### Rebuild Sequence

After any change to source files, both the image **and** ArangoDB data must be refreshed:

```bash
# 1. Rebuild and restart the affected services
docker compose build chatqna-xeon-backend-server dataprep-arango-service
docker compose up -d chatqna-xeon-backend-server dataprep-arango-service

# 2. Re-ingest documents to apply chunk cleaner + aggregation chunks
#    (via Admin Dashboard: delete existing file → re-upload)
#    Required after any change to _clean_chunk_text() or _build_aggregation_chunks()
```

> **Tip for debugging retrieval:** `scripts/inspect_retrieval.py` replays the full pipeline (embed → ArangoDB cosine → BM25 rerank) and prints every candidate chunk with `vector`, `bm25`, and `combined` scores. Run it when answers seem incomplete or wrongly ranked.
