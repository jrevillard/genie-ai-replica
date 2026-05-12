# Future Improvement: Table-Aware Parser for Crop Calendar PDFs

## The Remaining Gap

All current RAG improvements (HybridChunker, heading enrichment, BM25 reranking, aggregation chunks) operate on text. They cannot fix a structural extraction problem: **PyMuPDF and Docling both extract tables column by column**, not row by row.

A crop calendar PDF table looks like this:

```
│ Stage            │ Month    │ Week │ Max Temp │ Min Temp │ Rainfall │
├──────────────────┼──────────┼──────┼──────────┼──────────┼──────────┤
│ Sprouting        │ October  │  41  │  30.2    │  22.1    │  12.4    │
│ Seedling         │ October  │  43  │  29.8    │  21.3    │   8.2    │
│ Vegetative       │ November │  45  │  27.5    │  18.6    │   3.1    │
│ Tuber Initiation │ November │  47  │  25.1    │  15.2    │   1.0    │
│ Tuber Bulking    │ December │  49  │  22.3    │  12.8    │   0.4    │
```

What the extractor actually produces (one chunk per column):

```
# Column 1 chunk — stages only
Stages
Sprouting
Seedling
Vegetative
Tuber Initiation
Tuber Bulking

# Column 2 chunk — months only
Month
October
October
November
November
December

# Column 3 chunk — temperatures only (with cell-address encoding)
Potato.October.41 = 30.2
Potato.October.43 = 29.8
Potato.November.45 = 27.5
Potato.November.47 = 25.1
Potato.December.49 = 22.3
```

Each column becomes a separate chunk. **No chunk ever contains a stage name and its corresponding month in the same text.** The row-level relationship — the fact that links Tuber Initiation to November — is destroyed at extraction time and cannot be recovered by any LLM at query time.

---

## Why No Current Fix Solves This

| Fix applied | What it solves | What it does NOT solve |
|---|---|---|
| `_clean_chunk_text()` | `November.47` → `November (week 47)` in output | Month still in a different chunk from stage name |
| Aggregation chunks | "List all stages" returns all 7 at once | Does not reconstruct stage → month mapping |
| Qwen 2.5 7B | Better reasoning, says "I cannot find it" reliably | Cannot infer facts that don't co-exist in any chunk |
| Heading enrichment | Adds section context to embedding | Does not re-join table rows |

---

## The Fix: Row-Oriented Table Extraction

After Docling converts the PDF, its internal document model contains structured `TableItem` objects with explicit row and column indices. A table-aware pass over these objects can reconstruct each row as a self-contained chunk:

```python
for table in doc.tables:
    headers = [cell.text for cell in table.data[0]]   # first row = column headers
    for row in table.data[1:]:                         # each subsequent row = one entity
        cells = {headers[i]: cell.text for i, cell in enumerate(row)}
        # cells = {"Stage": "Tuber Initiation", "Month": "November",
        #          "Week": "47", "Max Temp": "25.1", "Min Temp": "15.2", ...}
        text = " | ".join(f"{k}: {v}" for k, v in cells.items() if v.strip())
        yield {"text": text, "headings": [...], "page_numbers": [...]}
```

Each yielded chunk reads:

```
Stage: Tuber Initiation | Month: November | Week: 47 | Max Temp: 25.1°C | Min Temp: 15.2°C | Rainfall: 1.0 mm
```

Now a query `"what month is tuber initiation?"` embeds close to this chunk, and the LLM has everything it needs in a single retrieved passage.

---

## Impact on Query Types

| Query | Current behaviour | After row-oriented extraction |
|---|---|---|
| "What month is tuber initiation?" | "I cannot find that information" | "Tuber Initiation occurs in November (week 47)" |
| "What temperature during seedling stage?" | Guesses or misses | "Max 29.8°C, Min 21.3°C in October (week 43)" |
| "List all growth stages" | Works (aggregation chunk) | Still works |
| "What are the conditions for Tuber Bulking?" | Partial, stitched from two chunks | Complete in one chunk |

---

## Where to Implement

**File:** `genie-ai-overlay/core/genieai_dataprep_utils.py` — inside `load_with_docling()`

After `docling_converter.convert(doc_path)`, the result contains `result.document.tables` as a list of `TableItem` objects. The row-oriented extraction pass runs before `HybridChunker` and emits additional row-chunks that are merged with the regular text chunks.

The regular `HybridChunker` pass should still run for all non-table content (paragraphs, lists, headings). Only `TableItem` elements should be handled by the row-oriented pass to avoid double-chunking.

---

## When to Prioritise This

This is the correct fix for any document type where the answer to a user query lives **across a row** of a structured table:

- Crop weather calendars (stage ↔ month ↔ temperature)
- Pest threshold tables (pest ↔ temperature range ↔ humidity range)
- Fertiliser schedules (crop stage ↔ nutrient ↔ dose)
- Variety comparison tables (variety ↔ yield ↔ maturity days)

It is not needed for prose documents, lists, or single-column data.
