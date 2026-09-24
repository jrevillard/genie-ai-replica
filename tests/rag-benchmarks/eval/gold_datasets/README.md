# Gold datasets

This directory holds **stack-specific** gold datasets used by the eval
pipeline (`tests/rag-benchmarks/`). One subdirectory per stack:

```
gold_datasets/
├── README.md           # this file (generic policy)
└── <stack>/            # one dir per stack
    ├── README.md       # stack-specific files + regen commands
    ├── gold_dataset_<stack>.json            # raw (durable)
    └── gold_dataset_<stack>.matched.vN.json # matched (versioned snapshot)
```

## Two file roles

Every stack has two files with very different lifetimes.

### Raw `gold_dataset_<stack>.json` — durable, never versioned

Output of `xlsx_to_gold.py` from a benchmark xlsx. Contains queries,
reference answers, previews, difficulty, language metadata. **Independent
of the deployed corpus** — does not change as long as the xlsx source is
unchanged. Re-generate only if the xlsx source itself is updated.

### Matched `gold_dataset_<stack>.matched.vN.json` — versioned snapshot

Output of `match_gold_chunks.py` after the corpus is ingested into
ArangoDB. Contains per-chunk `chunk_key`, `content_hash`, `passage_id`,
plus `match_run.{ran_at, graph_source, stats}`. **Coupled to a specific
ingestion state** (collection name, chunking params, splitter, dataprep
build).

The file does NOT capture: chunk_size, chunk_overlap, splitter type,
embedding model, dataprep git SHA. These live in the dataprep deployment
(`.env`, docker image label) and must be tracked separately if needed.

## When to bump (v3 → v4, v4 → v5)

Bump and re-run `match_gold_chunks.py` when **any** of:

- The corpus has been re-ingested with **different chunking params**
  (chunk_size, chunk_overlap, splitter) — chunk texts change → content
  hashes change → the old version no longer matches.
- The ArangoDB SOURCE collection has been renamed or recreated.
- `match_gold_chunks.py` itself changes behaviour (bug fix, new
  matching strategy, window-size tweak) — bump to reflect the new
  matching logic.
- Re-ingestion with **identical** chunking params does NOT require a
  bump: `content_hash` survives (it's sha256 of normalized text), so
  `run_eval.py` still matches correctly. `chunk_key` values will be
  stale but the eval is content-hash based.

## Never overwrite a matched.vN.json

Each matched version is the **historical truth of an eval report**.
Overwriting v3 silently invalidates the numbers published in any report
that referenced it. Always write to a new file (`v4`, `v5`, …) and
update the report's reference if the new version supersedes the old.

## Why content_hash + chunk_key both exist

`content_hash` (sha256 of normalized text) is the **eval identity** —
`run_eval.py` matches gold `expected_chunks[].content_hash` against the
selection converted from span `_key`s. Stable across re-ingests.

`chunk_key` (the ArangoDB `_key`) is kept for **traceability** — the
chatqna `reranker_selection` span emits `chunk_key`, and operators
debugging a specific chunk benefit from a stable reference. But it is
NOT the eval identity: a corpus re-ingest gives every chunk a new
`_key` while leaving `content_hash` intact.
