# El Salvador gold datasets

This directory holds the el-salvador-specific gold datasets used by the
3-config reranker evaluation reported in
`tests/rag-benchmarks/eval/eval-reports/2026-09-23-el-salvador-reranker-evaluation.md`.

See [`../README.md`](../README.md) for the **generic versioning policy**
(raw = durable, matched = versioned snapshot, when to bump, never
overwrite).

## Files

- **`gold_dataset_el_salvador.json`** — 42-query raw gold (output of
  `xlsx_to_gold.py` from the el-salvador xlsx source). 26 EN + 16 ES
  queries with reference answers, difficulty, language metadata.
- **`gold_dataset_el_salvador.matched.v3.json`** — post-match gold with
  `passage_id` on each `expected_chunks[]` entry. Produced by running
  `match_gold_chunks.py` against the el-salvador SOURCE collection
  (`GRAPH_TEST_SOURCE`, 332 chunks). 74 resolved chunks across 20 split
  passages; 3 unresolved previews (Q40/41/42 — paraphrased section
  headers that don't verbatim-match any chunk).

## Regeneration

To rebuild the matched gold from the raw one:

```bash
python3 match_gold_chunks.py \
    --arango-url http://localhost:8529 --arango-db el-salvador \
    --arango-user root --arango-password "$ARANGO_PASSWORD" \
    --graph-source GRAPH_TEST_SOURCE \
    --gold-dataset gold_dataset_el_salvador.json \
    --output gold_dataset_el_salvador.matched.vN.json \
    --mode in-place-new
```

Bump `vN` (e.g. v3 → v4) per the generic policy. The el-salvador
report referenced `v3`; any new report must bump and reference the
new version explicitly.
