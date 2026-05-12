# Agricultural RAG — Phase roadmap (regional safety, hybrid search, comparisons)

Execution order for engineering (aligned with product phases):

1. **Taxonomy JSON / expert approval** — Controlled labels in dataprep (`agri_metadata`) and chunk fields `tax_*` in Arango.
2. **System prompt** — `CHATQNA_SYSTEM_PROMPT` / defaults in `genieai_chatqna.py` must require stating geographic scope at the start of agricultural answers.
3. **Dataprep auto-tagging** — Continues to populate `taxonomyMetadata` and chunk-level taxonomy fields for hybrid filters.
4. **Hybrid retrieval** — Backend sends `context.taxonomy_filters` to ChatQnA; retriever applies hard AQL filters before vector similarity (`genie-ai-overlay/retriever/genieai_retriever_arangodb.py`).
5. **Comparative “A vs B” agent (advanced)** — Full dual-index retrieval (separate searches per region) requires extending the ChatQnA orchestrator to run multiple retriever passes and merge chunks before rerank/LLM. Current stack implements **detection + prompt grounding** for multi-region questions instead.

## Implemented in this repository

| Phase | Status |
|-------|--------|
| 3 — Regional transparency in prompts | Default prompt + `env` comments + `env-T4` + Quick Help i18n (`en.js`). |
| 4 — Hybrid intent | `agricultural-query-intent-service.js` merges `taxonomy_filters` into OPEA `context`; retriever filters when chunk metadata matches vocabulary. |
| 4 — Rerank pool | ChatQnA uses `RETRIEVER_FETCH_K` (default 20) then TEI reranker; tune via env on ChatQnA service. |
| 5 — Comparisons | `comparative_regions` on context + extra system note in `genieai_chatqna.py` when ≥2 countries detected; **not** separate Arango searches per region yet. |

## Environment variables (reference)

- `CHATQNA_SYSTEM_PROMPT` — Override; must keep the CRITICAL regional rule for production farmer-facing deployments.
- `RETRIEVER_ARANGO_FETCH_K` — Pool size before reranking (ChatQnA pod).
- `RETRIEVER_ARANGO_K` — Final k after scoring strategies.
- Reranker: `RERANKER_TOP_N`, `RERANKING_STRATEGY`, `RERANKING_THRESHOLD` (see `env-T4` / compose).
