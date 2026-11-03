# Stack — RAGAS benchmarking (Story 8-6)

## Services

| Piece | Location | Shape |
|---|---|---|
| `ragas-service` sidecar (NEW) | `components/ragas-service/` | Flat Python mirroring `components/pii-service/`: `app.py` (FastAPI), `Dockerfile`, `requirements.txt`, `tests/`. No Arango access — stateless, called per job. |
| Orchestration (NEW) | `components/okf-server/services/ragas-suite-service.js` | CommonJS; clones `head-suite-service.js` skeleton: same collection, job pattern, locks, sweep, honest-empty summaries. |
| Routes/controller (NEW) | `components/okf-server/routes/repos-routes.js` + `controllers/repository-controller.js` | `/api/okf/repos/:repo_id/ragas-testsuite…` block cloned from the routing-testsuite block — incl. `rows` (add/modify/remove/**flip in-scope/out-of-scope**), `rename`, `DELETE`, `probe` (per-entry), `explain`, advisor; literal segments (`runs`, `explain`, `export`, `import`) above `/:suite_key`; admin writes / read polls; 202 handlers with detached-promise `done.catch(()=>{})`; xlsx export endpoints stream bytes (suite + results, on user request); PDF is client-side (no route). |
| Frontend (NEW) | `components/gov-chat-frontend/src/components/okf/editor/RagasPanel.vue` + tab entry in `TestingLabDialog.vue` (`tabDefs` ~:1499) | Options API; 4th pane; **full suite-management parity** — generate with user-settable dimensions, add/modify/remove entries, flip in-scope/out-of-scope, rename, delete, per-entry probe, explain, advisor (incl. repository-level suggestions), xlsx import/export, and a **PDF report view** (client-side export via a small PDF lib — no server-side rendering); existing saved-suites table gains the RAGAS pill; entry points (dashboard `StudioDashboard.vue:347`, `RepoEditorShell.vue:174`, `RepoEditor.vue:169`, wizard `Publish.vue:93`) untouched. |
| Service/store (NEW) | `src/services/ragasService.js` + actions in `store/modules/okf.js` (beside `headSuite*` :1099-1313) | Same `{ok, code, message, result}` envelope; store-side poll loops copied from `headSuiteGetRun` :1220. |
| Persistence | `okf_head_test_runs` collection (existing) | New kinds: `ragas_suite`, `ragas_run`, `ragas_explain`. No migration. |

## Sidecar endpoints (auth: `X-RAGAS-Secret` = `RAGAS_INTERNAL_SECRET`, default `OKF_INTERNAL_SECRET`)

- `GET /health` — liveness (okf-server 503-map probe).
- `POST /generate-testset` — `{documents: [{page_content, metadata}], testset_size, query_distribution?, num_personas?}` → samples (see xlsx-compat-formats.md §3). Internally: ragas `TestsetGenerator` + `default_transforms`, `LangchainLLMWrapper`/`LangchainEmbeddingsWrapper` (deprecated-but-functional path — exactly `run_ragas_eval.py`'s surface).
- `POST /evaluate` — samples (`user_input/retrieved_contexts/response/reference` [+ `reference_contexts` for the non-LLM metrics]) + `metrics: [<selection from the single-turn catalog; default = the harness four>]` → `{aggregate, per_query}`.
- `POST /xlsx/export-suite`, `/xlsx/export-results`, `/xlsx/import-suite` — JSON in, xlsx bytes out (and reverse for suite import); openpyxl only, layouts per xlsx-compat-formats.md. No results import (per David 2026-10-17).

## Dependencies (frozen — parity with Jerome's runner)

`ragas==0.4.3, langchain-openai==1.6.7, langchain-community==0.4.2, langchain-core==1.6.6, openai==3.3.0, httpx==0.28.1, openpyxl==3.1.5` + `fastapi/uvicorn`. Ruff-clean, copyright headers, `CustomLogger`-equivalent logging to stdout (fluentd path).

## Environment variables (four-site parity + config-validator)

**okf-server → sidecar**

| Var | Default | Purpose |
|---|---|---|
| `OKF_RAGAS_URL` | `http://ragas-service:8090` | okf-server → sidecar base URL |
| `RAGAS_INTERNAL_SECRET` | = `OKF_INTERNAL_SECRET` | sidecar auth (fail-closed both sides) |

**Sidecar — judge and embedder**

| Var | Default | Purpose |
|---|---|---|
| `RAGAS_JUDGE_BASE_URL` | = `VLLM_ENDPOINT` `/v1` | judge LLM (OpenAI-compatible) |
| `RAGAS_JUDGE_MODEL` | = `VLLM_LLM_MODEL_ID` *(inherited default — override per deployment; minimums: [model-requirements.md](model-requirements.md))* | judge/generator model id |
| `RAGAS_JUDGE_API_KEY` | = `VLLM_API_KEY` | judge bearer |
| `RAGAS_JUDGE_CONTEXT_TOKENS` | `65536` | the judge's window — sizes the document-text cap |
| `RAGAS_DOC_CHAR_CAP` | `auto` | document text fed to the generator (`auto` derives it from the window) |
| `RAGAS_DOC_CHAR_MAX` | `48000` | the hard ceiling on that cap |
| `RAGAS_EMBED_BASE_URL` | TEI embedding service | embedder endpoint (answer_relevancy) |
| `RAGAS_EMBED_MODEL` | = `EMBED_MODEL_ID` *(inherited default — override per deployment)* | embedder id |
| `RAGAS_EMBED_API` | `tei` | embedder wire dialect (`tei` \| `openai`) |
| `RAGAS_VERIFY_SSL` | `0` | verify the judge's TLS certificate |

**Sidecar — judge client behaviour**

| Var | Default | Purpose |
|---|---|---|
| `RAGAS_LLM_MAX_CONCURRENCY` | `8` | judge calls in flight |
| `RAGAS_LLM_MAX_RETRIES` | `5` | retries on a 429, with jittered backoff honouring `Retry-After` |
| `RAGAS_LLM_CACHE` | `1` | disk cache of judge responses, keyed on the EFFECTIVE model — switching judges never replays another model's cached answers |
| `RAGAS_LLM_CACHE_DIR` | `/tmp/ragas-llm-cache` | cache directory (a volume — the cache is the reason the sidecar is `replicas: 1`) |
| `RAGAS_LLM_CACHE_LEGACY` | `0` | legacy cache-key compatibility |
| `RAGAS_EVAL_MAX_WORKERS` | `8` | evaluate-side workers |
| `RAGAS_EVAL_BATCH_ROWS` | `1` | rows per evaluate batch |
| `RAGAS_EVAL_TIMEOUT_SECONDS` | `600` | per-sample judge timeout (floor 30) |
| `RAGAS_MAX_CONCURRENT_JOBS` | `2` | sidecar job concurrency |
| `RAGAS_JOB_TTL_S` | `3600` | how long a terminal job's result is retained |

**okf-server — run and generation behaviour**

| Var | Default | Purpose |
|---|---|---|
| `OKF_RAGAS_TESTSET_SIZE_DEFAULT` | `20` | default suite size on generate (user-settable per generation, like the existing suite-generator knobs) |
| `OKF_RAGAS_MAX_ENTRIES` | `200` | hard cap per suite (import + generate) |
| `OKF_RAGAS_MAX_CORPUS_CHUNKS` | `1600` | generation corpus budget — over it the corpus is an EVEN SPREAD across the chunk-key space, and the suite records `{total, used}` per graph |
| `OKF_RAGAS_CANDIDATE_K` | `24` | dense candidates per graph (the rank probe reports where a missed passage would have placed) |
| `OKF_RAGAS_TOP_N` | — | contexts kept per query |
| `OKF_RAGAS_RERANK_CONCURRENCY` | `3` | rerank batches in flight (the rerank transport dominated the retrieval leg at 192 candidates) |
| `OKF_RAGAS_RUN_CONCURRENCY` | `2` | per-run query concurrency (shared GPU) |
| `OKF_RAGAS_ANSWER_MAX_TOKENS` | `5000` | answer-leg output budget |
| `OKF_RAGAS_SERVE_URL` | `http://chatqna-xeon-backend-server:8888/v1/chatqna` | where the answer leg is served (serve mode) |
| `OKF_RAGAS_JOB_POLL_MS` | `3000` | poll interval for sidecar jobs |
| `OKF_RAGAS_LONG_TIMEOUT_MS` | `3600000` | liveness horizon — bounds only the unreachable-sidecar case, never a healthy job |
| `OKF_RAGAS_TIMEOUT_MS` | `600000` | sidecar call timeout (his EVAL_RAGAS_TIMEOUT=600s precedent) |
| `OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS` | — | submit-retry backoff |

Ops mapping to Jerome's runner: `RAGAS_JUDGE_*` ≡ his `EVAL_JUDGE_*`; `RAGAS_EMBED_*` ≡ his `EVAL_EMBED_*`.

## Deployment surface

- `docker-compose.yaml`: always-on GENIE.AI service (no profile) — the Lab is an always-on feature; okf-server probe → honest `503 RAGAS_UNAVAILABLE` per-route when absent.
- 17th image: `.gitlab-ci.yml` build/scan/promote entries + `deploy/ansible/tasks/deploy-shared-facts.yml` image list + `env.j2` rows + `env` template section.
- Healthcheck: `GET /health`; fluentd logging driver like every service.

## Test surface

- Sidecar pytest: xlsx round-trips against pinned reference fixtures (one exported benchmark suite → re-imported equality; one hand-authored sheet in his layout → expected entries; results export carries his column vocabulary incl. extended-metric columns); generate/evaluate handlers against mocked ragas incl. a non-default metric selection.
- okf-server jest: `__tests__/ragas-suite-service.test.js` with the `head-suite-service.test.js:11-45` mock header (arango-mock stores, frontmatter-service mocks); route/controller thin-wrap tests; 503-degrade path.
- Frontend jest: `ragas-panel.test.js` on the `mountDialog`/`fakeStore` pattern (`head-test-dialog.test.js:29-76`); progress-contract test mirroring `head-test-progress.test.js`.
- Config-validator: new-var coverage per AC7.
- Smoke: `scripts/okf-testing-lab/`-style script driving generate→run→export→import against the local build.
