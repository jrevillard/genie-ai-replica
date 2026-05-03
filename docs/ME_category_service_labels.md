# Category & Service Label System — End-to-End

## Overview

The label system is the primary mechanism for scoping retrieval in the RAG pipeline.
Labels are assigned to document chunks at ingestion time and optionally used as hard
filters at query time. The same taxonomy — the service category tree managed in the
backend — is used at both ends.

This document traces the full lifecycle: document upload → chunk labeling → storage →
query context → ArangoDB filter → retrieval result.

---

## Part 1 — The Taxonomy

All labels come from a single source of truth: the service category tree stored in
ArangoDB and served by the backend at:

```
GET /api/service-categories/categories
```

The tree has two levels:

```
Category (e.g. "Agriculture Guidance")
  └── Service (e.g. "Crop Management")
  └── Service (e.g. "Pest & Disease Management")
  └── Service (e.g. "Crop Calendar")

Category (e.g. "Early Warning")
  └── Service (e.g. "Flood Advisory")
  └── Service (e.g. "Cyclone Alert")
```

Both category names and service names are valid labels. They are all treated as a flat
list internally — the hierarchy exists in the UI and for human navigation, not for
filtering logic.

---

## Part 2 — Document Upload

### 2.1 What the user does in the frontend

When uploading a document via the document repository UI, the user is presented with
the service category tree and asked to assign:

- **One category** (e.g. `"Agriculture Guidance"`)
- **One or more services** under that category (e.g. `"Crop Management"`)

These selections become `fileLabels` in the upload payload sent to the backend, which
then forwards them to the dataprep microservice as `file_labels`.

### 2.2 What `file_labels` actually does

`file_labels` is stored on the **file record** in the document repository as metadata.
It is visible in the UI when browsing uploaded files.

Inside the ingestion pipeline (`genieai_dataprep_arangodb.py`), `file_labels` is
passed into `_apply_labels()` but its role is **limited**:

```python
async def _apply_labels(self, plain_chunks, all_labels, file_labels, file_id):
    if not all_labels:
        # FALLBACK ONLY: taxonomy fetch failed → use file_labels as-is for every chunk
        return [{"text": c, "labels": file_labels if file_labels else []} for c in plain_chunks]

    # Normal path: ignore file_labels, run labeling strategy on full taxonomy
    if LABELING_STRATEGY == "embedding":
        return await asyncio.to_thread(self._label_with_embedding, plain_chunks, all_labels)
    elif LABELING_STRATEGY == "bm25":
        return await asyncio.to_thread(self._label_with_bm25, plain_chunks, all_labels)
    else:
        return await self._label_with_llm(plain_chunks, all_labels, file_labels, file_id)
```

`file_labels` is **not injected into the LLM labeling prompt**. The LLM user message is:

```python
{"role": "user", "content": f"Input: {text}\nLabels: {all_labels}"}
```

`file_labels` only appears in a debug print statement. In normal operation, the manual
selection at upload time has no influence on which labels end up on chunks.

**Summary of `file_labels` usage:**

| Purpose | Used? |
|---|---|
| Stored on file record in document repository | ✅ |
| Displayed in the UI file browser | ✅ |
| Fallback if taxonomy API is unreachable | ✅ |
| Injected into LLM chunk labeling prompt | ❌ |
| Injected into embedding or BM25 labeling | ❌ |
| Directly written to `chunk_labels` in normal operation | ❌ |

---

## Part 3 — Chunk Labeling During Ingestion

### 3.1 The full taxonomy is fetched fresh for every ingestion job

```python
all_labels = await self._fetch_all_labels()
```

`_fetch_all_labels()` calls `GET /api/service-categories/categories` and flattens
the category tree into a single list of strings — every category name and every
service name across the entire taxonomy. This is what the labeling strategies work
against.

### 3.2 Each chunk is labeled independently

The document is split into chunks first, then each chunk is labeled on its own content.
The parent document's `file_labels` play no role in this process under normal operation.

#### Strategy: LLM (default, `LABELING_STRATEGY=llm`)

Each chunk is sent to vLLM with the full taxonomy and this system prompt:

```
You are a precise semantic labeler for a RAG knowledge graph.
Goal: Assign 1–4 MOST RELEVANT labels from the list below that best match the chunk content.
Rules:
- Return ONLY labels that are strongly relevant.
- Most chunks get 1–3 labels. Never exceed 5.
- Do NOT "maximize" coverage.
- Do NOT suggest new labels.
- If nothing fits well → return empty list.
- Use ONLY exact strings from the list.
```

The LLM reads the chunk text and picks whichever labels from the full taxonomy best
describe that specific chunk's content — completely independent of what the user
selected at upload time.

#### Strategy: Embedding (`LABELING_STRATEGY=embedding`)

Cosine similarity is computed between the chunk embedding and the embedding of each
label string. Any label with similarity ≥ `EMBEDDING_LABEL_THRESHOLD` (default 0.75)
is assigned.

#### Strategy: BM25 (`LABELING_STRATEGY=bm25`)

BM25 keyword overlap score between the chunk text and each label name. Any label
scoring ≥ `BM25_LABEL_THRESHOLD` (default 2.0) is assigned.

### 3.3 Labels are stored on each chunk in ArangoDB

After labeling, every chunk is written to the `{GRAPH_NAME}_SOURCE` collection with:

```json
{
  "file_id": "1776722231961_499d8fca",
  "chunk_index": 15,
  "chunk_labels": ["Pest & Disease Management", "Crop Management"],
  "text": "| Infestation stage | Seedling to flowering stage ...",
  "embedding": [0.023, -0.041, ...],
  "type": "Document"
}
```

**Key point**: a single chunk can carry labels from multiple services, and those labels
can differ from the document-level `file_labels`. A document uploaded as
`"Crop Management"` can produce chunks labeled `["Pest & Disease Management"]`,
`["Crop Calendar", "Crop Management"]`, or even `[]` (empty, if the LLM finds no
strong match), depending entirely on the chunk's text content.

---

## Part 4 — Query Time

### 4.1 How the user selects context in the frontend

Category and service selection in `ChatBotComponent.vue` is **fully manual**. There is
no automatic intent detection. Two UI mechanisms set the context:

**Quick Help buttons** — pre-configured buttons shown at chat start. Each button has a
hardcoded `category` ID. Clicking one sets `currentCategoryId` and adds to
`selectedContextItems`.

**Sidebar knowledge tree** — `RightSideBarComponent` renders the service tree. Clicking
a node emits `treeNodeSelected`, which pushes the service into `selectedContextItems`
and sets `currentCategoryId` to the node's category.

If the user selects nothing and just types a question, no context is sent.

### 4.2 What gets sent in the request

**With context selected** (`contextOption = "conversation-with-labels"`):

```json
{
  "messages": [...],
  "context": {
    "categoryLabel": "Agriculture Guidance",
    "serviceLabels": ["Crop Management"],
    "language": "EN"
  }
}
```

`categoryLabel` is the resolved string name of `currentCategoryId`.
`serviceLabels` is the list of service name strings from `selectedContextItems`.

**Without context selected** (`contextOption = "single-message"`):

```json
{
  "text": "What pesticides treat Brown Plant Hopper?"
}
```

No `context` field at all. The backend defaults `categoryLabel` to `"General"`.

### 4.3 How the retriever builds the AQL filter

In `genieai_retriever_arangodb.py`:

```python
filter_data = input_dict.get("context", {})

labels_to_filter = []
if filter_data.get("categoryLabel"):
    labels_to_filter.append(filter_data["categoryLabel"])
if filter_data.get("serviceLabels"):
    labels_to_filter.extend(filter_data["serviceLabels"])
```

Both `categoryLabel` and all `serviceLabels` are merged into one flat list. Then an AQL
FILTER clause is constructed based on `ARANGO_FILTER_STRATEGY` (default `OR`):

```python
# OR strategy (current default)
aql_filter_clause = 'FILTER (doc.chunk_labels != null) AND (["Agriculture Guidance", "Crop Management"] ANY IN doc.chunk_labels)'

# AND strategy (stricter — chunk must have ALL selected labels)
aql_filter_clause = 'FILTER (doc.chunk_labels != null) AND (["Agriculture Guidance", "Crop Management"] ALL IN doc.chunk_labels)'
```

If `labels_to_filter` is empty (no context selected), `aql_filter_clause` is `""` —
no filter is applied.

### 4.4 The filter runs before vector similarity

The `aql_filter_clause` is injected directly into the ArangoDB vector search call:

```python
docs_and_similarities = await vector_db.asimilarity_search_with_relevance_scores(
    query=query,
    embedding=embedding,
    k=input.k,
    score_threshold=input.score_threshold,
    filter_clause=aql_filter_clause   # ← hard gate, runs in AQL before any scoring
)
```

This is not a post-filter or a re-ranking weight. ArangoDB evaluates the `FILTER`
clause as part of the AQL query. Chunks that do not satisfy it are **never retrieved**
and never scored.

---

## Part 5 — The Mismatch Problem

### 5.1 What happens when the user selects the wrong label

Suppose a chunk exists with `chunk_labels: ["Pest & Disease Management"]` only.
The user selects `"Crop Management"` as context.

The AQL filter becomes:
```
FILTER (doc.chunk_labels != null) AND (["Crop Management"] ANY IN doc.chunk_labels)
```

This chunk does not pass. It is excluded from the vector search entirely. The LLM
never sees it. The user gets a worse answer (or no answer) with no explanation.

### 5.2 What partially saves this

The LLM labeler assigns **1–4 labels per chunk**. Chunks about overlapping topics
(e.g. pest management in the context of crop guidance) often receive both
`"Pest & Disease Management"` and `"Crop Management"`. This creates overlap that
makes wrong-label selections work more often than they should by design.

But this is not reliable:
- Narrow, highly specific chunks may only get one label
- The LLM may assign different labels on re-ingestion (non-deterministic)
- Users have no visibility into which labels were actually assigned to which chunks

### 5.3 What happens with no selection at all

No `aql_filter_clause` is built. The vector search runs across every chunk in the
entire knowledge base, unfiltered. This always returns results but precision degrades
as the corpus grows, since semantically similar chunks from unrelated topics compete.

---

## Part 6 — Summary of the Full Flow

```
INGESTION
─────────────────────────────────────────────────────────────
User uploads document
  └── Selects category + service in UI  →  stored as file_labels on file record only
  └── Document is chunked
  └── Full taxonomy fetched from backend  (all category + service names)
  └── Each chunk labeled independently by LLM / embedding / BM25
        → chunk_labels = whatever the model decides, from the full taxonomy
        → file_labels are NOT used (except as fallback if taxonomy fetch fails)
  └── Chunks written to ArangoDB _SOURCE collection with chunk_labels[]


QUERY
─────────────────────────────────────────────────────────────
User types a question
  └── Optionally selects category + service in sidebar  →  context.categoryLabel + serviceLabels
  └── Request sent to backend  →  query-service.js
  └── Routed to OPEA ChatQnA (if not a weather query)
  └── ChatQnA passes context to retriever

Retriever
  └── Builds AQL FILTER from context labels (OR: any label matches)
  └── Runs vector similarity search with FILTER applied as hard gate
        → chunks NOT matching any selected label: excluded entirely
        → chunks matching: ranked by cosine similarity, top-k returned
  └── Reranker: top-N by score or rank
  └── LLM: generates answer from reranked chunks
```

---

## Part 7 — Known Gaps

| Gap | Impact |
|---|---|
| `file_labels` not injected into LLM labeling prompt | Manual selection at upload has no influence on chunk labels |
| No automatic label inference at query time | User must guess which service to select |
| User has no visibility into which chunk_labels were assigned | Wrong selection silently excludes relevant chunks |
| LLM labeling is non-deterministic | Same document re-ingested may produce different chunk_labels |
| `categoryLabel = "General"` default when no context sent | Searches all chunks unfiltered — broad but imprecise at scale |

---

## Part 8 — Environment Variables

| Variable | Default | Effect |
|---|---|---|
| `LABELING_STRATEGY` | `llm` | How chunks are labeled: `llm`, `embedding`, `bm25` |
| `EMBEDDING_LABEL_THRESHOLD` | `0.75` | Cosine similarity cutoff for embedding strategy |
| `BM25_LABEL_THRESHOLD` | `2.0` | Score cutoff for BM25 strategy |
| `ARANGO_FILTER_STRATEGY` | `OR` | `OR`: any label matches. `AND`: all labels must match |
| `LABEL_SELECTOR_SYSTEM_PROMPT` | (see code) | System prompt for LLM labeling — overridable via env |
