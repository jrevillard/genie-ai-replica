# Review Prompt 2/3 — Edge Case Hunter

> Run this in a **separate session**. Paste back findings.

## Invoke

Use the **`bmad-review-edge-case-hunter`** skill.

## Constraints

- You may read the **diff + the project source** (the retriever code, config, tests) to understand real call sites and data shapes.
- You may **NOT** read the spec or planning docs (you are intentionally blind to stated intent).

## Inputs

- Verbatim diff: `_bmad-output/implementation-artifacts/review/part-b-code-diff.patch`
- Then explore the repo as needed (e.g. `genie-ai-overlay/retriever/`, `genie-ai-overlay/tests/conftest.py`).

## Your Job

Orthogonal edge-case hunt. Specifically probe:

- **Hybrid OFF path**: is it truly a byte-for-byte no-op? Any import-time side effect (e.g. view creation at import / `__init__` when flag off)?
- **`doc.id` identity**: what if dense returns a doc with `id=None` or a non-string? Does `rrf_fuse`'s dict-key break? Are dense and BM25 ids guaranteed comparable (`_key` vs something else)?
- **View creation races/failures**: `_bm25_views_ensured` is a process-local set — multi-worker (gunicorn/uvicorn workers) race? What if `create_arangosearch_view` partially succeeds?
- **ArangoSearch query**: `TOKENS`/`ANALYZER`/`BM25` correctness; what if `text` is null/empty? AQL injection via `query` (bind vars OK, but f-string view/field names)? `LIMIT @n` with negative/zero?
- **Label filter divergence**: does the Python `_chunk_passes_label_filter` actually match the dense AQL `OR`/`AND` semantics? Any `None`/empty-list asymmetry?
- **Score truncation**: `[:int(input.k)]` — what if `input.k` is None/0/negative? Fusion drops BM25-only docs beyond dense?
- **Exception scope**: the `try/except` in `invoke` — does it swallow too much or too little? Does `_bm25_search`'s internal `except` mask real bugs?
- **MMR branch**: dense `search_res` from MMR uses `score_map.get(id(doc), 0.0)` — does fusing MMR results (id-based) collide with BM25 by `_key`?

For each finding: **file:line**, scenario (concrete input/state that triggers it), impact, severity. Distinguish "real bug" from "defensive nit".
