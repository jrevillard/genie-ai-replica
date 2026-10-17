# Operations routing map — what delegates, where it lives today

Companion to SPEC.md. File:line references are from the 2026-10-18 call-site research
(branch feat/okf-ragas @ 7b5a4b671). "v1 toggle" = exposed checkbox in the config
screen; "local" = never routed.

## The routing table

| Operation key | v1 toggle | Work | Service · call site today | Today's config | Failure mode to preserve |
|---|---|---|---|---|---|
| `import_curation` | ✔ | Import-time per-concept {type,label,summary} curation | okf-server · `llm-curation-service.js:70-97` (`callVllm`), from `ingest-service.js:652` | VLLM_ENDPOINT / VLLM_MODEL_ID / VLLM_API_KEY | fail-soft: concept degrades to heuristics, `resolved_by:'llm-error'` |
| `ingest_labeling` | ✔ | Chunk labeling during ingestion (dataprep) | genie-ai-overlay · `genieai_dataprep_arangodb.py` `_label_with_llm:1247` → batch/single `:1974/:1887` | VLLM_* env family, per-leg client build `:424` | batch → per-chunk → file_labels only, logged to ingestion_log |
| `ingest_contextual` | ✔ | Contextual Retrieval context generation (dataprep) | same file, `_context_*` (`:1551/:1689/:1764`); per-leg model override precedent `DATAPREP_CONTEXTUAL_MODEL:290` | VLLM_* + CONTEXTUAL_* env | raw-chunk fallback, 0/N loud ERROR in ingestion log |
| `head_tags` | ✔ | Repo head/tag generation (suggestTags) | okf-server · `frontmatter-service.js:783` via `vllmChatCompletions:339` | VLLM_LLM_* (see model-string bug below) | LLM_PARSE 502 with repair-truncated-JSON salvage |
| `suite_generation` | ✔ | Head/query test-suite generation | okf-server · `head-suite-service.js:545` | same helper | LLM failure ⇒ deterministic fallback queries fill the suite |
| `ragas_generation` | ✔ | RAGAS benchmark-suite generation (KG + synthesis) | ragas-service · `ragas_engine.generate_testset` → `build_llm:151` (per-job factory) | RAGAS_JUDGE_* env; window via RAGAS_JUDGE_CONTEXT_TOKENS | job fails honestly (202+poll surfaced); cap derives from window |
| `ragas_judging` | off by default (open question) | RAGAS run evaluation (judge) | ragas-service · `evaluate_samples` → `build_llm(temperature=0)` | same | metric NaN rows, aggregate skips |
| `inference` | ✔ (off by default) | ChatQnA answering — the RAG the user sees | genie-ai-overlay · `genieai_chatqna.py:213-229` (LLM_SERVER_*, VLLM_LLM_ENDPOINT, LLM_MODEL) | env at boot | chat must answer; local default resumes on frontier failure |
| csv topic derivation | rides `import_curation` | Tabular import topic suggestion | okf-server · `csvTopicsService.js:99` | VLLM_ENDPOINT guard | filename-slug fallback, non-fatal |
| bundle manifest summary | rides `import_curation` | Discovery summary | okf-server · `concept-meta-service.js:723-745` | VLLM_* (dead config?.llm? lookups live here) | returns null, fail-soft |
| autocorrect propose / link suggestions | rides `head_tags` | Frontmatter + concept-link proposals | `repository-controller.js:1328/493` → llm-curation `callVllm` | VLLM_* | proposals empty, guarded |
| topic-link authoring | rides `import_curation` | Publish-time cross-concept links | okf-server · `topic-link-authoring-service.js:225-245` | VLLM_*, OKF_TOPIC_LINK_ENABLED | dangling drops, never exceptions |
| advisors / explains (head + RAGAS) | local in v1 | Small suggestion calls (≤300 tok) | `head-suite-service.js:2439/2711`, `head-test-service.js:665`, `ragas-suite-service.js:1345` | same helper | mechanical attribution stands without LLM |
| RAGAS run answer leg | rides `inference` semantics, but stays server-side | Answer generation during benchmark runs | `ragas-suite-service.js:408` | same helper | abstention phrase fallback |
| graph extraction (dataprep) | local in v1 (vendored comps) | LLMGraphTransformer | `genieai_dataprep_arangodb.py:2271` (comps vendored at build) | VLLM_* | all-batches-fail refuses 'Ingested' verdict |
| translation | local (separate model) | Streaming translation | `geniei_chatqna.py:166-180` | VLLM_TRANSLATION_* dual-model precedent | unchanged |

## Never routed (hard)

- **TEI embeddings** — `frontmatter-service.js:68`, ragas `RAGAS_EMBED_*`, dataprep
  `TEI_EMBEDDING_ENDPOINT`. Dimension-coupled to the indexed vectors; routing breaks
  retrieval.
- **TEI reranking** — `OKF_RERANK_ENDPOINT/TOKEN` (head-suite `:1337`, ragas `:312`).
- **PII** — spaCy/Presidio, CPU, no LLM (`pii-service/app.py`).

## The model-string bug the router fixes

`frontmatter-service.js:56` reads container var `VLLM_LLM_MODEL_ID`, but
`docker-compose.yaml:730` maps host `VLLM_LLM_MODEL_ID` → container `VLLM_MODEL_ID`. So
every okf-server admin LLM call sends the hardcoded `ibm-granite/granite-4.1-8b` string
today regardless of deployment config. The router centralizes model resolution
(local leg included), killing this class of drift.

## Propagation mechanism (one design, all Python services)

okf-server serves `GET /internal/llm-routing` (X-Internal-Secret, the
`RAGAS_INTERNAL_SECRET` convention) returning the RESOLVED routing: per operation,
`{ provider, base_url, model, api_key, context_tokens, max_tokens, dialect }` — or
`{ provider: 'local' }`. Python services (dataprep, chatqna) pull it with a ~30–60 s TTL
cache; unreachable/unconfigured ⇒ env/local behavior. The RAGAS sidecar, being
request-driven from okf-server, takes the same shape as per-request job overrides
through its existing `build_llm` factory. Token transit is internal-network-only — the
same trust level as `VLLM_API_KEY` in those containers' env today.
