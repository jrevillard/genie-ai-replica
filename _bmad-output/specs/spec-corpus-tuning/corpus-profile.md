# Corpus Profile Schema — CAP-1 output

The CAP-1 corpus-shape analyzer emits a single JSON document conforming to this schema. CAP-2 (preset matrix) consumes it; CAP-3 (sweep runner) re-validates the recommended config against the live corpus.

## Design constraints

- **Stable field set.** Add fields in minor versions; never rename. Downstream tools (CAP-2) key by name.
- **Deterministic.** Same corpus → same bytes. Sort AQL results; hash numeric aggregates to integers; no timestamps in the profile body (recorded in `_meta.generated_at` separately).
- **Read-only.** The analyzer issues AQL `RETURN` queries against `<GRAPH>_SOURCE`, `<GRAPH>_LINKS_TO`, the taxonomy collections, and a sample of `messages` for query-pattern signature. No writes.

## Schema (v1)

```json
{
  "_meta": {
    "schema_version": "1",
    "generated_at": "<ISO-8601>",
    "graph_source": "GRAPH_<STACK>_SOURCE",
    "corpus_sha256": "<uuid5 of corpus content>"
  },

  "shape": {
    "n_chunks": 0,
    "n_documents": 0,
    "total_text_mb": 0.0,
    "avg_chunk_chars": 0,
    "p50_chunk_chars": 0,
    "p95_chunk_chars": 0,
    "max_chunk_chars": 0,
    "doc_size_distribution": {
      "small_lt_50kb": 0,
      "medium_50kb_500kb": 0,
      "large_gt_500kb": 0
    }
  },

  "language": {
    "primary": "es",
    "detected_languages": {"es": 0.74, "en": 0.20, "other": 0.06},
    "multilingual": false,
    "auto_detect_method": "accent-heuristic"
  },

  "taxonomy": {
    "n_categories": 0,
    "n_services": 0,
    "avg_categories_per_doc": 0.0,
    "label_density_per_chunk": 0.0
  },

  "queries": {
    "sample_size": 0,
    "avg_query_chars": 0,
    "n_with_category_label": 0,
    "n_with_service_label": 0,
    "n_multi_label": 0,
    "common_patterns": {
      "single_fact": 0.40,
      "synthesis": 0.30,
      "temporal": 0.15,
      "out_of_scope": 0.10,
      "adversarial": 0.05
    }
  },

  "links": {
    "n_links_to_edges": 0,
    "graph_density": 0.0,
    "avg_neighbors_per_chunk": 0.0,
    "is_graph_shaped": true
  },

  "hardware_target": {
    "gpu_model": "NVIDIA RTX 6000 ADA",
    "vram_gb": 48,
    "bf16": true,
    "fits_14b_main": true
  }
}
```

## Field guidance

### `shape`
Computed via AQL aggregation over `GRAPH_<STACK>_SOURCE`. `corpus_sha256` is the SHA-256 of concatenated `_key` + `text` (sorted), not a single document hash — this lets a partial re-ingest invalidate only the affected slice.

### `language`
Primary language detected via the same accent heuristic as `chatqna.genieai_chatqna.py:2363-2437`. `detected_languages` is a probability-like distribution summing to 1.0; `multilingual = true` iff the top language is <0.80 of detected distribution.

### `taxonomy`
Pulled from the `serviceCategories` and `services` collections + the `serviceCategoryTranslations` edges. `label_density_per_chunk` = total label assignments ÷ n_chunks; drives the preset matrix's `LABELING_STRATEGY` recommendation (dense labels favor `bm25`; sparse labels favor `llm`).

### `queries`
Sample of N=200 `messages` (sorted by `created_at` desc, deterministic sample). Pattern classifier: rule-based for v1 (e.g., questions under 3 tokens = "single_fact", contains "¿cuándo?" or temporal markers = "temporal"). When the sample size is <10, set `n_with_*` to 0 and let CAP-2 default to "insufficient signal".

### `links`
From `<GRAPH>_LINKS_TO` edges. `graph_density` = edges ÷ (n_chunks × (n_chunks − 1)). `is_graph_shaped = true` iff `graph_density > 0.001` OR `n_links_to_edges > 1000`.

### `hardware_target`
Operator-supplied via CLI flag (`--gpu-model`); the analyzer does not auto-detect GPU. Defaults documented in `tests/rag-benchmarks/GENIE-AI-Model-Test-Plan.md`.

## Determinism

- All AQL queries use `SORT key ASC` before `LIMIT` / `COLLECT`.
- Aggregation results are stored as integers where possible.
- `corpus_sha256` is computed once at the top of the run and reused.

## When the schema changes

- Add new fields with default values so old consumers continue to work.
- Bump `schema_version` only on renames or semantic shifts.
- A new schema version requires a companion update here AND a CAP-2 capability gate (CAP-2 must declare which schema versions it understands).