# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **RAG eval toolchain overhaul** (`tests/rag-benchmarks/eval/` + `tests/rag-benchmarks/scripts/`): a single command now drives a full RAG-quality evaluation on a deployed stack — Phase 3 dump-tuples + Phase 5 anchor + Phase 4 RAGAS — with provably-safe ROPC enable/disable (curl-K secrets off argv, container-side expansion via `docker exec -e`, re-auth inside trap, 3 retries, exit 9 on revert failure), in-run realm-token refresh (240s TTL, 401→refresh+retry, `EVAL_KC_URL` / `EVAL_KC_REALM` / `EVAL_KC_CLIENT_ID` / `EVAL_KC_USER` / `EVAL_KC_PASSWORD`), atomic out-writes, resume derived from rows (1-row-per-id invariant), and a per-run sidecar JSON (`.meta.json`) with `n_entries` / `n_tuples` / `n_http_errors` / `n_missed_traces` / `skipped` for post-run assertions. The retired `run_eval_chunked.py` orchestrator is replaced by direct `python3 run_eval.py` calls in `run_anchor_with_cleanup.sh`; `run_eval.py` exits deterministically (0 clean, 2 usage, 3 degraded, 4 zero-scored) so a single shell pipe can drive CI. New exit codes on the wrapper itself: 8 = ROPC enable failed, 9 = ROPC revert failed (the revert is the only one that leaves a real security hole, so the wrapper exits 9 and the operator must verify manually).
- **`tests/rag-benchmarks/eval/RUNBOOK.md`**: the new end-to-end recipe for the RAG eval toolchain. Five phases (0 pre-flight / 1 xlsx → gold / 2 match gold chunks / 3 dump-tuples / 4 RAGAS / 5 calibrate), each with copy-pasteable commands, env-var tables, exit-code maps, and a "When things go wrong" section (resume from `.done.jsonl`, salvage partial outputs, ROPC-left-enabled verification curl, chatqna warm-up, `ps` secrets spot-check, full `n_missed_traces` and `n_http_errors` triage tables). Replaces the old "use the script and hope" pattern. Generic placeholders only — no deployment-specific hostname, IP, stack, or DB name in the commands.
- **RAGAS judge pinned for sovereign deployments:** `tests/rag-benchmarks/eval/requirements.txt` pins `ragas==0.4.3`, `langchain-openai==1.6.7`, `langchain-community==0.4.2`, `langchain-core==1.6.6`, `openai==3.3.0`, `httpx==0.28.1`. The judge endpoint stays env-driven (`EVAL_JUDGE_BASE_URL` / `EVAL_JUDGE_API_KEY` / `EVAL_JUDGE_MODEL`), so any OpenAI-compatible LLM works (vLLM, LiteLLM, ollama, external API). Embeddings path is independent (`EVAL_EMBED_BASE_URL` / `EVAL_EMBED_MODEL`). The `langchain-community.vertexai` import is stubbed so the suite runs in a sovereign stack that does not have GCP credentials installed. Ragas `RunConfig.timeout` is now env-overridable via `EVAL_RAGAS_TIMEOUT` (default 600s — the previous 180s default silently NaN'd slow reasoning-judge rows on large `context_precision` prompts).
- **Adaptive-reranker offline calibrator pin:** `calibrate.py` accepts a custom grid (`--factors F1,F2,...` / `--thresholds T1,T2,...`) and exposes a `_strip_eq_prefix` helper so `--thresholds =-1.0,=-0.5` (the form the shell requires to escape leading `-` as an option flag) parses correctly without flipping the sign of negative thresholds. `--check-baseline` is the validity check — it replays the selection with the live capture params and asserts replay-vs-live recall delta is under 0.05; it must be paired with `--baseline-factor` equal to the live `CONTEXT_DECAY_FACTOR` at capture time.
- **Shared eval modules:** `eval/harness.py` (docker_exec wrapper + atomic JSON IO via tmp + `os.replace`, with `HarnessError`) and `eval/keycloak.py` (the only Keycloak token fetcher for the eval toolchain; the legacy Master Admin token path used by the wrapper is kept as a fallback). `eval/arango.py` exposes `source_chunks(graph_source, text_field, conn=None)` and the paginated `cursor(aql, *, url, db, user, password, batch_size, timeout)`, with one centralized `_api/cursor` implementation — `match_gold_chunks.py` and `run_eval.py` both delegate. The legacy benchmark suite (`benchmark_*.py` + `run_benchmarks.sh`, 2549 lines) is removed; latency and load-testing now happen on the OTel trace waterfall.
- **Capture baseline driver extended for the new harness:** `tests/rag-benchmarks/capture_baseline.py` now imports `docker_exec` + `write_json` from `harness.py` (was a local private copy), and its out-file write is atomic (was a non-atomic `open + json.dump` that could leave a truncated JSON on `SIGKILL`). The `EVAL_IDENTITY_FILES` set (used to compute `harness_sha` for baseline provenance) now includes `harness.py` and `keycloak.py`.

- **GPU OCR on dataprep:** `dataprep-arango-service` now declares `NVIDIA_VISIBLE_DEVICES=all` in the Swarm env (was previously unset, leaving the GPU-in-Docling/EasyOCR path inert despite `DOCLING_DEVICE=cuda` default). The v2.1.0 image already ships `torch==2.13.0+cu130` + `cuda-toolkit==13.0.3.0` + `nvidia-cudnn-cu13==9.20.0.48`, so no image rebuild is required. Requires a Swarm node with the `gpu == true` label and `nvidia-container-toolkit` installed (already in place for the 4 OPEA services).
- **Frontend responsive CSS overrides (Saved Chats card + dialog scroll pattern):** `theme-components.css` gains `:root body` selectors that fix mobile overflow on `ChatFolders.vue` (constrain `.chat-item` to parent width, add `flex-wrap` on `.chat-header` so actions drop to a second row when long titles crowd the sidebar) and pin the DsTabs nav inside fixed-height dialog bodies (`FileDetailsDialog` and any modal using `DsTabs` in a flex column) so the body scrolls while the tabs stay reachable — `.ds-tabs` flex-shrinks and `.ds-tabs__content` scrolls, with `min-width: 0` on the `.tab-content-details` grid items to keep long unbreakable strings (e.g. MIME types) inside their column. Backported from `release/el-salvador`. (!409)
- **Bulk-retract UI parity with bulk-ingest in Document Management** (`!469`): New "Retract Selected" button next to "Ingest Selected", mirroring the existing ingest path. Driven by the same `handleBatchAction(action)` dispatcher — `showRetractButton` computed blocks the button when any selected document is already retracted (case-insensitive, matching the symmetric `showIngestButton` filter). The handler opens a confirm dialog, calls the existing `POST /api/files/retract` batch endpoint, and surfaces per-file outcomes through the same 207 response handling. Translations added to all 14 supported locales (ar, bn, de, en, es, fr, id, man, pt, ru, st, sw, th, zh).
- **Query-instruction prefix for contrastive / instruction-tuned embedding models.** `QueryInstructionEmbeddingsWrapper` prepends the model-specific instruction to `embed_query` only — `embed_documents` (passage encoding during ingestion) passes through verbatim, preserving the query/passage asymmetry. Built-in coverage: `BAAI/bge-{large,base,small}-{en,zh}-v1.5`, `hkunlp/instructor`, `nomic-ai/nomic-embed`. Deployers extend via the `EMBEDDING_QUERY_INSTRUCTIONS` env var (`substring=instruction,substring=instruction`). The shared TEI embedding service stays prefix-free, so dataprep ingestion (passages) and retrieval (queries) coexist on a single microservice. Measured A/B on the live corpus (42 gold queries vs 850 chunks): +1.62% retrieval recall at K=32, +1.85% at K=50. No re-ingest required. **Behavior change for deployments using the local `HuggingFaceBgeEmbeddings` fallback** (no `TEI_EMBEDDING_ENDPOINT` set): langchain's default `query_instruction` (`"Represent this question for searching relevant passages: "`, with **"question"**) is cleared and replaced by the BAAI-canonical English string (`"Represent this sentence for searching relevant passages: "`, with **"sentence"**). The wrapper applies the prefix; langchain no longer does. Deployment paths that bypass the wrapper (direct `HuggingFaceBgeEmbeddings.embed_query()` usage outside the retriever) keep the langchain default. (#1035)

### Fixed

- **Run-eval exit contract:** `run_eval.py` now exits deterministically (0 / 2 / 3 / 4) instead of the previous always-0 path. The contract: 0 = clean, 2 = usage error OR gold-mismatch (a resume .done.jsonl referenced ids not in the current gold — operator must run `EVAL_FRESH=1` or restore the prior gold), 3 = degraded (anchor: `skipped_entries` non-empty without `EVAL_ALLOW_PARTIAL` / `missed > EVAL_MAX_MISSED_TRACES` / `unmapped > 0` without `EVAL_ALLOW_UNMAPPED`; dump-tuples: `len(tuples) < len(entries)` without `EVAL_ALLOW_PARTIAL` / missed over threshold), 4 = zero scored rows. A crashed mid-run no longer silently returns 0 — the run surfaces its real state in the meta sidecar.
- **Atomic out-writes and per-run sidecar:** every per-query row is written via tmp + `os.replace`, so a `SIGKILL` mid-run leaves no half-written JSON. The meta sidecar `<out_path>.meta.json` (with `n_entries` / `n_tuples` / `n_http_errors` / `n_missed_traces` / `skipped`) is also written atomically — a non-atomic sidecar was a NaN trap on truncated files.
- **CHATQNA_CONTAINER re-resolved on docker-exec failure:** when a `docker service update` rotates the chatqna container mid-run (new replica suffix), the cached container name silently kills every subsequent query. `run_eval.py` now re-resolves on failure and lets the existing 3-attempt retry consume the recovered attempt. `VICTORIATRACES_SVC` is intentionally NOT re-resolved — it is a service DNS name, stable across service updates.
- **RAGAS judge n>1 generation collapse fixed:** `langchain-openai` 1.6.7 returns `ChatResult.generations` FLAT for the single input. The judge fan-out subclass (`_FanoutChatOpenAI` in `run_ragas_eval.py`) was previously written assuming the pre-1.x nested shape and iterated one level too deep, producing a list of pydantic field tuples per merge — the ChatResult validator then raised `ValidationError: generations.0 — input_value=[('text', ...)]` for every job. The merge now normalizes both shapes (pre-1.x nested + 1.x flat) and outputs the 1.x shape; usage totals are summed across the n parallel single-n calls. **No prompt-nonce is added** to distinguish the parallel calls — the ccr router was empirically verified (3 parallel identical prompts at temperature 0.7 returned 3 distinct completions) to NOT cache-dedup, so the n parallel calls are honest samples. The recipe to re-verify against a future gateway change is in the RUNBOOK's Phase 4.
- **Calibrate CLI negative-threshold sign-flip regression fixed:** a previous patch used `lstrip('=-')` which silently turned `-1.0` into `1.0` (sign flip). The new helper `_strip_eq_prefix` strips a single leading `=` only and never `-`, with a RED-first test (`test_strip_eq_prefix_does_not_flip_negative_signs`) pinning the behaviour. (`!509`)

- **Dataprep `DATAPREP_CHUNK_OVERLAP` silently inert at runtime:** `DATAPREP_CHUNK_OVERLAP` was declared in `env.j2` and read in code (`genieai_dataprep_microservice.py`), but `docker-compose.yaml` had no matching entry for the dataprep service, so the env var never reached the container and deployments could not tune overlap from Ansible/vars.yml. The doc-repo `POST /v1/dataprep/ingest_file` payload also omitted `chunk_overlap`, so no per-request override existed. Wired `DATAPREP_CHUNK_OVERLAP` through `docker-compose.yaml` (default `50`), extended `DocRepoIngestPayload` with an optional `chunkOverlap` field, and passed it through `fileController._ingestFileById` for both single and batch ingest routes (the batch Joi schema also gained `chunkOverlap` so it is no longer rejected as an unknown key). Rejects negative overlap at runtime. Override hierarchy: per-request `chunkOverlap` > `DATAPREP_CHUNK_OVERLAP` env > hardcoded 50. (!1033)
- **vllm-llm CUDA illegal-memory-access crash loop (RTX 6000 Ada):** The `vllm` Swarm service and the standalone-GPU `vllm-llm` service restart-looped under dataprep labeling load with `RuntimeError: CUDA error: an illegal memory access was encountered` at `gpu_model_runner.py` `sampled_token_ids.tolist()`. Root cause is a known race in vLLM 0.10 V1 between xgrammar guided JSON decoding, chunked prefill, and long-context concurrent requests (upstream vllm-project/vllm#19483, #24107, #23814, #28028). Default `--max_num_seqs` lowered from 64 to 32 across `docker-compose.yaml`, `docker-compose.gpu.yaml`, and `deploy/ansible/templates/docker-compose.gpu.yaml.j2`. Empirical starting point — the crash log showed 19 running requests at the time of failure; iterate to 16 / 8 if 32 is insufficient. Chunked prefill, prefix caching, and `gpu_memory_utilization` are unchanged to preserve the Contextual Retrieval long-prompt path, chat performance, and the shared-GPU memory split with `vllm-translation-guardrail`.
- **Weather third-party API removal:** Removed the `ipapi.co` (server location) and `nominatim.openstreetmap.org` (reverse geocoding) dependencies. Weather service now uses a bundled GeoNames cities500 dataset for offline reverse geocoding — no third-party calls for user-location resolution.
- **Chat markdown rendering:** Tightened the markdown renderer — strips the stray `<p>` wrap around list items and collapses the phantom `<ol>`/`<ul>` gap. Chat output no longer shows broken spacing around bullet lists.
- **Splash image from runtime config:** `SplashScreen.vue` previously hardcoded `src="/config/splash.png"`, ignoring `config.app.splash.value` which lets each deployment point at a branded splash. Every brand-customized splash image was invisible. `SplashScreen.vue` now accepts a `splashPath` prop (default `/config/splash.png`) and `App.vue` passes it from `config.app.splash.value`. (#394)
- **Mobile auth regression on ChatQnA:** drop `azp` claim check in `genie-ai-overlay/chatqna/keycloak_token_validator.py` to align with the Node.js services (`gov-chat-backend`, `document-repository`) which deliberately skip `azp` per standard OIDC Resource Server behavior. Token validation still enforces signature, issuer, and expiry. Resolves the per-flavor `KC_CLIENT_ID` deployment configuration that broke mobile auth on new country deployments.
- **Dataprep defensively creates the ArangoDB vector index on the embedding field (#1002):** New `ensure_vector_index()` helper in `genieai_dataprep_arangodb.py` runs post-ingest. Idempotent and dim/metric/nLists-aware: skip if the canonical `vector_index` (the langchain-arangodb default `ArangoVector.vector_index_name` — the same index the retriever queries) already matches, drop+recreate on dim/metric/nLists drift (e.g. an embedder model swap from bge-base 768-dim to bge-large 1024-dim). Telemetry via the `dataprep.ensure_vector_index` OTel span; status events routed through `_write_ingestion_log` so they appear in the UI. Defensive only — behaviour under the default `RETRIEVER_ARANGO_USE_APPROX_SEARCH=false` is unchanged.
- **Query Inspector shows the visible user question for Quick Help / dual-prompt queries:** `pickUserText(messages, userQuestion)` helper in `services/query-service.js` now prefers the frontend's explicit `userQuestion` field over the `messages` array tail when computing the value stored in `queries.text`. `ChatBotComponent.vue` now sends `userQuestion: messageForDisplay` alongside `messages` and filters out the streaming placeholder so the tail isn't empty. Previously Quick Help prompts (which use the dual-prompt swap to send a hidden persona prompt to OPEA) saved either an empty string or the hidden persona prompt to `queries.text`, leaving the Query Inspector blank. (!401)
- **Service-categories translation payload field names aligned (`lang`/`text` → `languageCode`/`translation`):** `services/service-category-service.js` now reads `trans.languageCode` / `trans.translation` (was `trans.lang` / `trans.text`) on POST/PUT for categories and services. Swagger spec in `routes/service-category-routes.js` updated to document the new field names (`required: [languageCode, translation]`, ISO 639-1 codes stored uppercased). **Breaking** for clients still sending the old field names — `lang` and `text` are no longer accepted and translations are silently lost on round-trips. (!407)
- **otel-collector-init `CAP_CHOWN` restored:** Regression from the 2.1.0 container least-privilege hardening (#320) — the otel-collector init container needed `CAP_CHOWN` to chown telemetry volume directories. Stacks with `ENABLE_OBSERVABILITY=1` had the init container failing silently. (!426)
- **Missing i18n key `weatherAuthRequired`:** Key referenced in `vue-i18n` translations but missing from several locale files, causing the weather auth-required UI to fall back to English in some locales. Dead key `weatherError` removed. (!430)
- **Markdown chunking now section-aware (.md files):** `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py::_load_and_chunk` routes `.md` through `MarkdownHeaderTextSplitter(headers=[H1-H4], strip_headers=True)` chained with `RecursiveCharacterTextSplitter(chunk_size=doc_path.chunk_size, chunk_overlap=doc_path.chunk_overlap)` — splits on heading hierarchy, caps each section at the configured `chunk_size` with intra-section overlap (never crossing `H1 → H2`), and prepends the joined section path (`## H1 > H2 > ...`) to each chunk so the LLM labeler and downstream retrieval see the heading context. Metadata filter strips `add_start_index`-injected ints before joining (`Document.metadata` from `split_documents` carries both the heading keys and the int offset; naive `.join(values)` crashed with `TypeError: expected str instance, int found`). Plain-prose chunks (no headers) and the existing `.html` / `.pdf` / non-md paths are unchanged. (#467)
- **Document Management batch ingest/retract silently dropped per-file failures** (`!469`): The frontend per-row checkbox and select-all pushed ArangoDB `_key` into `selectedDocuments`, but the backend batch handlers (`POST /api/files/ingest`, `POST /api/files/retract`) look up by semantic `file_id` via `metadataService.getMetadataById` — every batch call returned 404 for every file. The controller wrapped the per-file failures in a `200 {success: true, results: [...]}` envelope, so the UI showed a green "queued for ingestion" toast for a no-op. Now: backend batch endpoints return **207 Multi-Status** with `{success, successCount, failureCount, results[]}`; the frontend reads the payload and shows success / partial / all-failure toasts with per-file error detail, keeping only failed selections selected for retry; batch endpoints reject purely numeric IDs at the Joi validation layer as defense against a future `_key` regression. Swagger docs (`@swagger` annotations in `routes/fileRoutes.js`) updated to reflect the 207 contract and per-file result schema — previously they lied about a `200` response, which would have produced wrong client-generated types. Live-verified on the AgroGenio .102 deployment.
- **Post-batch reload could overwrite the precise batch-result toast:** `handleBatchAction` awaited `loadDocuments()` inside the same try/catch as the batch API call, so a stale-token 401 on reload (access tokens expire after 60s) tripped the outer catch and showed the generic "An error occurred during the batch ingestion process." toast — overwriting the success/partial toast that had already been set. Reload is now isolated in its own try/catch with a `console.warn`; a reload failure logs but never overrides the user-visible batch result. (!469)
- Reranker silently truncated inputs larger than 1024 tokens because TEI 1.9.3 computes the effective per-input cap as `min(model.max_position_embeddings, --max-batch-tokens)` and the deployed `--max-batch-tokens` was 1024. The cap is now aligned with the model (`bge-reranker-v2-m3` has `max_position_embeddings=8194`, `model_max_length=8192`) by raising `--max-batch-tokens` to 8192, and the silent-truncation path (`--auto-truncate=true` by default) is replaced with `--auto-truncate=false` so any input exceeding the 8192-token cap raises an HTTP 422 Validation (typed as `RerankerInputTooLong` in the wrapper, error_type `RerankerInputTooLong` by the reranker microservice) which chatqna translates into an abstention response (`abstained: true`, `abstention_reason: "reranker_input_too_long"`). A new Prometheus counter `rag.rerank.input_too_long` and a span attribute (`reranker.input_too_long`) make the condition operator-visible. New env vars `TEI_RERANKING_MAX_BATCH_TOKENS` (default `8192`), `TEI_RERANKING_AUTO_TRUNCATE` (default `false`), `TEI_RERANKING_MAX_CONCURRENT_REQUESTS` (default `32`) document the new TEI runtime caps; lower `MAX_CONCURRENT_REQUESTS` if VRAM budget tighter (bench-validated safe at 32 with shared vLLM on RTX 6000 Ada).

### Changed

- **Legacy benchmark suite removed** (`tests/rag-benchmarks/{benchmark_*.py, run_benchmarks.sh}`, 2549 lines): the scripts were run-once-and-never-rerun, had no live test, and produced numbers that drifted from the rest of the eval surface. Latency and load-testing now live on the OTel trace waterfall (Grafana RAG Pipeline Trace Waterfall dashboard) — the OTel collector already captures every request with `latency` and `http.status_code` attributes, so the dashboards cover the same question without a separate harness. The site docs (`source-tree-analysis.md`) no longer mention the deleted files.
- **Wrapper ROPC `EVAL_DEPLOY_ENV` is no longer defaulted:** the wrapper used to silently fall back to `/opt/genieai-el-salvador/.env` when the env var was unset — a stack-specific hardcode inside a script that should be generic. The wrapper now fails LOUD with `:?` and a message naming the expected `/opt/<stack>/.env` pattern (per `deploy/ansible/templates/env.j2` layout) when neither the env var nor `GENIE_ADMIN_PASSWORD` is set. The MR replaces the runbook / docs and the wrapper's "wrapper / argparse defaults" table to make the override path explicit.
- **Per-context manual slicing heredocs removed from the root `CLAUDE.md` golden-dataset recipe:** the manual `for i in range(N): chunk = dict(gold); chunk['entries'] = gold['entries'][i::N]; open(f'/tmp/batches/gold_{i:02d}.json', 'w').write(json.dumps(chunk))` loop is gone — `run_eval.py` now slices the gold internally when `EVAL_CHUNK_SIZE` is set, and the sidecar already records per-chunk progress so a manual round-robin shell loop is no longer needed.
- **Eval reports and gold datasets stop tracking new artifacts in `tests/rag-benchmarks/eval/{eval-reports,gold_datasets}/` for code-only changes:** campaign-generated Markdown reports and the campaign gold dataset stay on the integration branch (`feat/eval-toolchain`) for traceability but do not ship to `main` in a code-only MR. The directories themselves are kept (with a README) so future eval runs have a place to land.
- **`run_ragas_eval.py` judge requires `n_samples=3` to actually emit 3 samples:** when a single OpenAI-compatible LLM endpoint rejects `n>1` upstream (the ccr router / MiniMax-M3 case), the previous `langchain-openai` fallback collapsed to a single sample, NaN'ing the `answer_relevancy` metric. The fan-out subclass now fires n independent single-n calls in parallel (`ThreadPoolExecutor` for `_generate`, `asyncio.gather` for `_agenerate`) and merges the results. **Performance note:** the wall-clock cost of the merged result is ~max(single-call latency) instead of the naive ~n× that the previous serialization would have imposed — verified by sibling-overlap tests.
- **`run_eval.py` and `keycloak.py` no longer pin `langchain_community.vertexai` at import time** — the `vertexai` import is now stubbed in `run_ragas_eval.py` so sovereign stacks that do not have GCP credentials installed can still run the suite. Deployers on GCP should override the stub by installing `langchain-community[vertexai]` as before.

- **Default embedding model `bge-base-en-v1.5` → `bge-large-en-v1.5`:** New deployments now use the 1024-dim `BAAI/bge-large-en-v1.5` model by default for better semantic recall on multilingual/agricultural corpora. The smaller `BAAI/bge-base-en-v1.5` (768-dim) remains available as an opt-in override via `embedding_model_id` in `group_vars/<env>/vars.yml` or `EMBEDDING_MODEL_ID` in `.env`. Embedding latency ~3× higher (~10 ms/query vs ~3 ms), VRAM footprint +~0.9 GB (~1.3 GB total), per-chunk storage +1 KB. **Existing deployments that already ingested with bge-base must re-ingest their documents** — querying against mismatched dims silently returns empty results. Re-deploy the GPU node after merging to pick up the new default.
- **vLLM bump v0.10.0 to v0.29.0 (both services):** Mitigates the persistent CUDA illegal-memory-access crash loop in the chat/labeling vLLM under dataprep labeling load (vllm-project/vllm#23814, #24107 family — closed stale, no documented fix). Both `vllm-llm` and `vllm-translation` images are bumped for version consistency. The `--max_num_seqs` default is also lowered from 64 to 16 (iterative tuning showed no measurable effect on the crash, but kept as defense in depth).
- **Contextual Retrieval default strategy `doc_level` → `per_chunk`:** `CONTEXTUAL_STRATEGY` env default now follows the Anthropic recipe (one context-generation call per chunk with section-tailored context) instead of one call per document. Deployers who relied on the previous default should re-evaluate context quality on existing corpora. (!406)
- **Default chatqna abstention prompt updated:** Built-in fallback when `CHATQNA_ABSTENTION_INSTRUCTIONS` is unset now instructs the LLM to surface partial KB content with an up-front disclaimer about ungrounded training-data fill-in (`_DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS` in `genieai_chatqna.py`, header `[No Relevant Documents Found]`). Replaces the legacy "State clearly that you cannot answer" wording. Deployers can override the prompt via the `CHATQNA_ABSTENTION_INSTRUCTIONS` env var (now templated in `deploy/ansible/templates/env.j2`). (!456)

### Security

- **chatqna rejects unauthenticated requests:** `handle_request` now requires a `Bearer` token in the `Authorization` header and validates it against the Keycloak JWKS before reaching any business logic. Missing, malformed, or invalid tokens raise `HTTPException(status_code=401)`. The Bearer scheme is matched case-insensitively per RFC 7235 §2.1. The validated token is threaded as a function argument through `fetch_file_metadata`, `get_user_profile`, `_assemble_source_documents`, and `_stream_with_metadata`; no token state lives on the service instance or `request.state`, so concurrent requests cannot leak each other's tokens on outbound service-to-service calls. The legacy `tests/testing_genieai_chatqna.py` (a manual end-to-end CLI harness with its own copy of the old `set_token`/`_token` API) is removed.

### Added

- **Admin Logs panel powered by VictoriaLogs.** The admin logs UI now reads every container log from VictoriaLogs via the `/api/admin/logs/*` endpoints (search, range, summary, services). The previous file-rotation viewer is gone — operators get one queryable, time-bounded, service/level-filterable view across the whole stack from a single panel, with the same `trace_id` link to VictoriaTraces that already exists for the rest of the observability stack. A service-level inventory powers the panel's service dropdown from a single live VL query.
- **Trace correlation between logs and traces.** Each VictoriaLogs row carries the originating OTel `trace_id` / `span_id`, so clicking a trace id from the logs panel (or the LogQL `trace_id:` filter in Grafana) jumps directly to the matching span in VictoriaTraces. Applies to every service that emits through fluentd (backend, document-repository, all OPEA overlay services). Upstream images we do not fork (vLLM, TEI, ArangoDB, Kong, …) keep their plain-text logs and remain uncorrelated.
- **Per-service per-level error-rate metrics in the admin dashboard.** The admin system-health tile surfaces live error/warning rates per service (backed by OTel collector self-telemetry over VictoriaLogs), so an operator can spot a degraded service without opening Grafana.
- **VictoriaLogs health in the observability dashboards.** New tiles in the Observability Grafana folder expose ingest rate, query latency, storage size, and retention — previously these were implicit in the admin logs UI's response time.
- **Alert rule for silent PII-redaction regression.** `otel-pii-redact-fail` fires critical if the OTel collector's PII redaction transform drops anything or stops accepting records for 15 minutes — a safety net for the new collector-edge redaction pipeline.

### Changed

- **Single log ingestion channel.** Every log line from every service now flows through `stdout → Docker fluentd driver → OTel Collector → VictoriaLogs`. The previous dual-channel architecture (an in-process OTel SDK LoggerProvider exporting directly to VL alongside the fluentd driver) is gone. Deployers no longer need to configure `LOG_TO_VICTORIALOGS` or `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` — the docker logging driver carries every record to the collector regardless of env.
- **Admin logs outage behaviour is now a typed HTTP 503.** When VictoriaLogs is unreachable, `/api/admin/logs/*` returns `503` with `{error: "vl_unreachable", message}` instead of the previous soft-fail empty-state envelope. The frontend renders this as an explicit "VL unreachable" banner with the underlying error message — operators always know whether they are looking at "no data" or "VL is down". The previous `VL_FAIL_OPEN` env-var escape hatch is dropped.
- **Morgan HTTP access logs (Node services) normalised in the admin TYPE column.** The collector rewrites the raw morgan format into `METHOD PATH STATUS TIME` so the admin TYPE column shows a usable request summary instead of the raw `HTTP_REQUEST:` line.
- **Python log-level prefixes stripped at the collector.** The OTel collector strips the `ERROR:` / `WARNING:` / `INFO:` / `DEBUG:` prefix that Python's `logging` module (and uvicorn) prepends to every message, so the admin TYPE column shows the actual error message instead of bare severity words.

### Removed

- **`LOG_TO_VICTORIALOGS` env var.** No longer read by the runtime; safe to leave set in `.env`. Removed from `env`, the Ansible template, and `docker-compose.yaml`.
- **`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` env var.** No longer read; the docker fluentd driver has its own collector address.
- **`ADMIN_LOGS_SOURCE` env var.** No longer read; VictoriaLogs is the only source. Setting it has no effect.
- **`VL_FAIL_OPEN` env var.** Replaced by the typed `503 / vl_unreachable` contract — there is no longer a soft-fail mode.
- **`LOG_TO_FILE` host bind mounts.** The `${DATA_DIR}/logs/{backend,doc-repo}:/app/logs` bind mounts are removed from `docker-compose.yaml`. The runtime `LOG_TO_FILE` boolean env var still works as an audit-retention escape hatch for operators who want to re-enable local file rotation, but they must now manually re-add the `/app/logs` bind mount if they do so (a comment in `env` documents this).

### Fixed

- **Trace correlation across services we control.** Logs from backend, document-repository, and every OPEA overlay service now carry `trace_id` / `span_id` end-to-end, so clicking a log row opens the originating trace in VictoriaTraces. (#343)
- **Python `uvicorn.access` logs correlated with traces.** uvicorn HTTP access logs from OPEA services now include `trace_id` / `span_id` (previously they were plain text and uncorrelatable). (#343)
- **Log loss under burst ingest.** The docker fluentd driver buffer was saturated at 1 MB during ingest peaks and dropped records before they reached the collector. Bumped to 8 MB / 5 retries / 2 s backoff in the `x-logging` compose anchor. (#343)
- **Bare-severity rows in the admin logs TYPE column.** Python uvicorn / `logging` module messages no longer surface as `ERROR`, `WARNING`, `INFO` in the admin TYPE column — the leading level prefix is stripped at the collector and the column now shows the actual message head. (#343)

### Security

- **PII redaction enforced at the OTel collector edge.** The 19-key PII list (`configs/otel/pii-key-list.md`, CODEOWNER @jrevillard) is now applied at the export boundary into VictoriaLogs, covering every log path: docker fluentd driver (non-Node services, crashed-process edge cases), Winston envelope, and any ingestion route that bypasses the in-process SDK. Previously only services with a working in-process OTel SDK LoggerProvider had redaction; the collector-edge transform closes the gap and protects services that historically bypassed it. The new `otel-pii-redact-fail` alert rule (see Added) detects silent regressions. (#343)


## [2.1.0] - 2026-08-31

### Changed

- **OPEA upgrade from v1.3 to v1.5:** All four OPEA overlay images (chatqna, dataprep, retriever, reranker) now build from OPEA v1.5. The upgrade absorbs 7.5 months of upstream bug fixes and dependency CVEs while preserving GENIE's RAG behavior (retrieval, reranking, labeling, contextual retrieval). Rollback: redeploy the previous v1.3-based image tags.
- **Python 3.11:** Replaces Python 3.10 in all OPEA overlay images (matching OPEA v1.5's base). The dataprep image base changed from `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` to `python:3.11-slim` to align with OPEA v1.5 upstream — GPU support is maintained via pip-installed CUDA libraries (`cuda-toolkit`, `nvidia-cuda-runtime`).
- **Mobile client ID placeholders:** `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` in the `env` template changed from ITU-specific values to generic institutional placeholders (`genie-mobile-<institution>`, `com.<institution>.genieai`). Existing deployments unaffected.

### Fixed

- **Query endpoint ownership validation:** Query-related endpoints now enforce userId ownership. A user can no longer access query data belonging to another user — the endpoint returns 404 for non-existent queries, 403 for queries owned by another user.
- **Backend input validation:** API endpoints now validate `limit` and `offset` query parameters with proper bounds checking (min/max constraints). Invalid values (negative, non-numeric) return the default instead of silently producing unexpected queries.
- **Analytics filters error handling:** The `filters` query parameter on the analytics endpoint now returns a proper 400 error with `INVALID_FILTERS_JSON` code when malformed JSON is provided, instead of crashing with an unhandled exception.
- **Reranker index bounds:** Reranker now handles out-of-range TEI indices defensively — a buggy TEI response that returns fewer scores than documents no longer crashes with `IndexError`; the affected entry is skipped and the partial result is preserved.
- **Docling device auto-detection:** When `DOCLING_DEVICE=cuda` is requested but no GPU is available (CPU-only deployment), the dataprep service now falls back to CPU with a visible warning instead of crashing at docling initialization.
- **Backend CPU translation fallback crash:** When the GPU translation endpoint was unreachable, the CPU fallback crashed the backend at startup (EACCES on the transformers.js model cache and log directories owned by root while the image runs as uid 1000). Image directories are now pre-created writable, and fatal translation-worker errors fail fast with a clear message instead of hanging for the 20-minute init timeout. (#325)

### Security

- **Horizontal privilege escalation prevented:** Query message endpoints now validate that the requesting user owns the queried resource.
- **Dependency CVE remediation (GitLab Ultimate pipeline 6345, 2026-08-22):** Resolved 21 high-severity runtime CVEs across all JS components by bumping affected transitive and direct dependencies. Highlights: `protobufjs` 7.5.5 → 7.5.6 (5 CVEs including RCE via prototype pollution CVE-2026-44291, code injection CVE-2026-44293, DoS recursion CVE-2026-44289); `sharp` 0.32.6 → 0.35.0 (inherited libvips CVEs); `ip-address` 5.9.4 → 10.3.1 (SSRF via Address4 octal/decimal confusion CVE-2026-69192) via `geoip-lite` 1.4.10 → 2.0.3; `@opentelemetry/propagator-jaeger` 2.7.1 → 2.9.0 (DoS via malformed Jaeger header CVE-2026-59892); `js-yaml` → 4.3.1 across all manifests (quadratic CPU `!!omap` GHSA-5p4m-2wfm-xmqj); `dompurify` 3.2.6 → 3.4.14 (IN_PLACE hook XSS); `uuid`, `postcss`, `serialize-javascript`, `fast-uri` overrides; `@opentelemetry/core` 2.7.1 → 2.8.0 (unbounded memory W3C Baggage CVE-2026-54285).
- **Mobile AppAuth MITM vulnerability fixed:** The vendored `flutter_appauth` Android plugin previously wired an `InsecureConnectionBuilder` (which disables TLS certificate validation via a trust-everything `X509TrustManager`) into the `AuthorizationService` unconditionally at engine attach. Production now never instantiates an insecure service: `createAuthorizationServices()` lazy-instantiates the insecure service only when `allowInsecureConnections=true`, which only the dev and E2E configs set. Production flavors (`flavors/itu.dart`, `flavors/template.dart`) inherit `false` from `KeycloakConfig` and reach the secure path. An attacker on a hostile network (Wi-Fi, ISP proxy) can no longer MITM the Keycloak login flow on Android production builds.
- **SAST scan surface restricted:** `.gitlab-ci.yml` adds `SAST_EXCLUDED_PATHS` covering only dev/test-only paths (Windows desktop CMake runner, real-comps contract tests, jest test dirs, dev migration scripts, synthetic-data generators, coverage reports). The production Docker entrypoint `document-repository/scripts/clamav-node.sh` remains scanned. The previously advertised `SEARCH_IGNORED` variable was removed — it is not honored by any official GitLab SAST template.

- **Container least-privilege hardening:** All 37 compose services now run with `cap_drop: [ALL]`, `no-new-privileges`, and only the capabilities their entrypoints require. The GPU-node (`docker-compose.gpu.yaml`) and standalone-Arango compose files are hardened identically. **Breaking** for custom deployments with modified entrypoints: add the required `cap_add` to your overrides (#320, #324, #329)
- **Slimmed runtime images:** Backend, doc-repo, dataprep, retriever and reranker runtime stages moved to Debian slim bases with `apt-get upgrade` security-update layers at build time, removing the kernel-headers CVE surface; entrypoint/healthcheck tool inventory audited per image (#315)
- **keycloak-config image security updates:** The `adorsys/keycloak-config-cli` base (Ubuntu 24.04) now receives `apt-get upgrade` at build time, pulling published perl/p11-kit fixes on every rebuild (#328)
- **Crawler SSRF hardening:** Literal-IP validation (encoded-IPv4 normalization), DNS resolution checked against private ranges, and manual per-hop redirect revalidation (#318)
- **Dynamic `RegExp` hardening:** All interpolated `RegExp` construction sites escape their inputs or were refactored to plain string operations; the DNS safety layer gained dedicated tests (#319, #321)
- **Conversation key generation:** Backend uses `crypto.randomInt` instead of `Math.random` for conversation key suffixes (#318)
- **Frontend dev-server path containment:** The `gov-chat-frontend` static server restricts served paths to the project root (#323)
- **OPEA base images security patch:** `apt-get upgrade` layer added to the embedding/textgen wrappers, fixing openssl CVE-2026-31789 (#314)
- **Brace-expansion DoS overrides:** `brace-expansion` pinned above the affected versions across all four package locks (#323, #330)
- **file-type nested copy eliminated:** The transitive `file-type@16.5.4` under `mime-kind` (CVE-2026-31808, ASF parser infinite loop) is removed via a self-referencing override resolving to the direct 21.3.4 (#330)

## [2.0.1] - 2026-08-03

### Security

- **CVE remediation:** 3,466 critical/high vulnerabilities resolved across Docker base images, npm dependencies, and image tags
- **PostgreSQL 13 → 16 upgrade:** PostgreSQL 13 is end-of-life. The default image is now `postgres:16`.
  - **⚠ Deployers MUST follow `docs/UPGRADE.md`** — this is a **mandatory migration** with planned downtime. Run `pg_dumpall`, reset the `genieai`/`kong`/`keycloak` role passwords, and verify before restarting services.

### Changed

- **Docker base images updated:** Node.js `node:22`, Alpine `3.22`, Keycloak `26.7`, PostgreSQL `16`
- **Image tags pinned:** all `:latest` tags pinned to specific versions (Kong `3.9.3`, ClamAV `stable-debian`, vLLM `v0.10.0`, OPEA services, etc.)
- **Reranker default strategy:** `RERANKING_STRATEGY` now defaults to `slice` (top-N) with `RERANKER_TOP_N=3` — the `adaptive` strategy could return 0 documents with low TEI scores

### Fixed

- **Chat responses interrupted:** `max_tokens=None` rejected by pydantic ≥2.13 caused chat stream failures — fixed in ChatQnA

## [2.0.0] - 2026-07-28

### Added

- **Quick Help:** configurable dual-prompt system with customizable welcome message, knowledge hierarchy categories, and service labels for precise RAG retrieval filtering
- **Non-English document ingestion:** upload and translate Spanish PDFs into the RAG knowledge base
- **Account management:** administrators can deactivate and reactivate user accounts
- **RAG abstention:** the assistant now says "I don't know" instead of hallucinating when no relevant information is found — toggle via `CHATQNA_ENFORCE_ABSTENTION`
- **Contextual Retrieval (Anthropic-style):** LLM-generated document context is prepended to each chunk before embedding, improving retrieval relevance for domain-specific documents — toggle via `CONTEXTUAL_RETRIEVAL_ENABLED`
- **Reranking strategies:** configurable via `RERANKING_STRATEGY` (slice, threshold, knee, adaptive) — each deployment can select the method best suited to its data
- **Streaming translation:** chat output now streams in the target language during generation instead of waiting for the full English response first — enable via `STREAMING_TRANSLATION_ENABLED`
- **Multi-turn vector-space blending:** previous conversation turns influence retrieval, improving relevance in multi-turn chats — enable via `MULTI_TURN_BLEND_ENABLED`
- **Multi-crop query support:** users can query across multiple crop categories simultaneously
- **Faster document ingestion:** batched LLM labeling (4 chunks per call) with increased concurrency — processing time reduced by an order of magnitude
- **Remote GPU node:** deploy model services (vLLM, TEI) on a dedicated machine with TLS and API key authentication
- **Config-driven locale whitelist:** restrict active UI locales per deployment via `VUE_APP_AVAILABLE_LOCALES` — applies to web, mobile, and Keycloak login pages
- **Documentation site:** public Hugo/Docsy site with redesigned landing page, dark mode, and curated reference docs
- **Model selection guide:** comprehensive documentation on choosing and configuring LLM, embedding, and reranker models
- **Docker Swarm deployment:** fully automated via Ansible — one command to deploy the entire stack
- **Kong API gateway:** production-grade API gateway with automatic route configuration
- **SSL certificates:** automatic Let's Encrypt certificate provisioning and renewal
- **GPU support:** configurable NVIDIA GPU utilization and data type for vLLM inference in Swarm mode
- **Configurable RAG pipeline:** new variables (`ARANGO_PORT`, `EMBEDDING_SERVER_ENDPOINT`, `RETRIEVER_ARANGO_GRAPH_NAME`)
- **Keycloak OIDC authentication:** replaced the legacy authentication system with Keycloak as the central identity provider — single sign-on, password reset, and token lifecycle management
- **Mobile app OIDC migration:** Flutter app now uses Keycloak OIDC with build flavors, custom URL schemes, TLS enforcement, and network error recovery — no more legacy auth
- **SSE streaming:** LLM responses now stream in real-time via Server-Sent Events instead of waiting for the full response
- **Query Inspector:** admin tool for inspecting and debugging RAG pipeline results (what was retrieved, reranked, and sent to the LLM)
- **Dynamic favicon:** the browser favicon is set from the deployment configuration
- **Weather API hardening:** 5-second timeout on all external weather service calls to prevent hangs
- **Observability stack:** OpenTelemetry tracing across the entire RAG pipeline, with Grafana dashboards, VictoriaMetrics, and alerting (enable via `ENABLE_OBSERVABILITY=1`)

### Changed

- **UI theme system:** replaced hardcoded colors with CSS custom properties — custom themes can now be applied by overriding variables
- **Document repository file upload limit:** default reduced from 500 MB to 50 MB — adjustable via `MAX_FILE_SIZE`
- **Translation pipeline:** automatically detects model type from `VLLM_TRANSLATION_MODEL_ID` — no manual config needed
- **Translation backend:** default mode changed from `cpu` to `auto` — the system picks the best available translation method
- **Guardrails:** content guardrail service is now disabled by default; enable explicitly if needed
- **Deployment:** consolidated to a single `docker-compose.yaml` supporting both local dev (`docker compose`) and production Swarm (`docker stack deploy`)
- **Deployment:** all persistent data centralized under `./data/` directory
- **Deployment:** configuration files consolidated into single `configs/` directory
- **Nginx security headers:** `Permissions-Policy` now configurable per environment
- **LLM token limit:** removed the arbitrary 1024 max_tokens default — the LLM can now generate full responses
- **Locale parity:** all 14 locales brought to strict key parity — 81 unused keys removed, 9 missing translations added

### Security

- Fixed authentication bypass on `/email` route — no-token access to email operations (#422)
- Added admin authorization checks to database operations routes (#423)
- Prevented AQL injection by converting all database queries to tagged template literals (#425)
- Replaced all shell `exec()` calls with Node.js built-in APIs (#426)
- Prevented path traversal in file upload and log file operations (#431)
- Removed hardcoded `JWT_SECRET` fallback — the server now fails fast at startup if the secret is missing (#430)
- Removed hardcoded database password fallback in connection service (#432)
- Stopped leaking internal error messages in API responses (#434)
- Replaced real credentials with placeholders in environment templates (#424)
- Added admin authorization to file deletion routes (#467)
- Added magic-byte validation for file uploads — rejects files disguised by MIME type (#470)
- Sanitized Content-Disposition headers against CRLF injection attacks (#471)
- Added array size validation on batch file endpoints (#472)
- Added path traversal guard in file storage operations (#477)
- Removed legacy `_key <= 10` admin bypass — all admin access now role-based (#429)

### Fixed

- Mobile app now sends timestamps in UTC instead of device local time
- Translations created without `nameEN` on category and service documents (#531, #532)
- JWT token not forwarded from Authorization header to logout endpoint (#530)
- Duplicate logout call when navigating away from the app (#527)
- Database statistics API returning 404 on `/admin/database/stats` (#528)
- Admin toast notification when Quick Help labels don't match the knowledge hierarchy (#529)
- Admin role checks now use JWT claims instead of stale cached roles — changes take effect immediately
- Admin document search bar no longer collapses; pagination button labels no longer overflow (#830)
- Admin document status filter now case-insensitive (#832)
- Document re-ingestion/retraction status guard now case-insensitive (#831)
- Conversation saved twice on certain actions
- Markdown conversation export producing broken PDFs
- Missing routes causing mobile registration screen to fail
- Spanish responses appearing when English is selected — the UI language is now correctly included in all LLM requests (#579)
- Wrong i18n key causing SatisfactionHeatmap to display incorrectly (#580)
- Streaming SSE `|<-MSG->|` boundary markers no longer visible in chat output
- Label filters now correctly cleared when switching to Just Chat mode (#249)
- Just Chat no longer auto-submits a hidden prompt — enters free-form mode without sending any message
- Cross-document label contamination fixed — chunk labels scoped to their document (#216)

## [R_1_0_0] - 2026-03-16

Initial release for El Salvador agricultural AI assistant deployment.

[R_1_0_0]: https://opensource.unicc.org/un/itu/genie-ai/-/tags/R_1_0_0
[2.0.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/R_1_0_0...v2.0.0
[2.0.1]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.0...v2.0.1
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.1.0...main
[2.1.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.1...v2.1.0
