# Stack — RAGAS benchmarking (Story 8-6)

## Services

| Piece | Location | Shape |
|---|---|---|
| `ragas-service` sidecar (NEW) | `components/ragas-service/` | Flat Python mirroring `components/pii-service/`: `app.py` (FastAPI), `Dockerfile`, `requirements.txt`, `tests/`. No Arango access — stateless, called per job. |
| Orchestration (NEW) | `components/okf-server/services/ragas-suite-service.js` | CommonJS; clones `head-suite-service.js` skeleton: same collection, job pattern, locks, sweep, honest-empty summaries. |
| Routes/controller (NEW) | `components/okf-server/routes/repos-routes.js` + `controllers/repository-controller.js` | `/api/okf/repos/:repo_id/ragas-testsuite…` block; literal segments (`runs`, `explain`, `export`, `import`) above `/:suite_key`; admin writes / read polls; 202 handlers with detached-promise `done.catch(()=>{})`. |
| Frontend (NEW) | `components/gov-chat-frontend/src/components/okf/editor/RagasPanel.vue` + tab entry in `HeadTestDialog.vue` (`tabDefs` ~:1499) | Options API; 4th pane; existing saved-suites table gains the RAGAS pill; entry points (dashboard `StudioDashboard.vue:347`, `RepoEditorShell.vue:174`, `RepoEditor.vue:169`, wizard `Publish.vue:93`) untouched. |
| Service/store (NEW) | `src/services/ragasService.js` + actions in `store/modules/okf.js` (beside `headSuite*` :1099-1313) | Same `{ok, code, message, result}` envelope; store-side poll loops copied from `headSuiteGetRun` :1220. |
| Persistence | `okf_head_test_runs` collection (existing) | New kinds: `ragas_suite`, `ragas_run`, `ragas_explain`. No migration. |

## Sidecar endpoints (auth: `X-RAGAS-Secret` = `RAGAS_INTERNAL_SECRET`, default `OKF_INTERNAL_SECRET`)

- `GET /health` — liveness (okf-server 503-map probe).
- `POST /generate-testset` — `{documents: [{page_content, metadata}], testset_size, query_distribution?, num_personas?}` → samples (see xlsx-compat-formats.md §3). Internally: ragas `TestsetGenerator` + `default_transforms`, `LangchainLLMWrapper`/`LangchainEmbeddingsWrapper` (deprecated-but-functional path — exactly `run_ragas_eval.py`'s surface).
- `POST /evaluate` — samples (`user_input/retrieved_contexts/response/reference`) + `metrics` → `{aggregate, per_query}`.
- `POST /xlsx/export-suite`, `/xlsx/export-results`, `/xlsx/import-suite`, `/xlsx/import-results` — JSON in, xlsx bytes out (and reverse); openpyxl only, layouts per xlsx-compat-formats.md.

## Dependencies (frozen — parity with Jerome's runner)

`ragas==0.4.3, langchain-openai==1.6.7, langchain-community==0.4.2, langchain-core==1.6.6, openai==3.3.0, httpx==0.28.1, openpyxl==3.1.5` + `fastapi/uvicorn`. Ruff-clean, copyright headers, `CustomLogger`-equivalent logging to stdout (fluentd path).

## Environment variables (four-site parity + config-validator)

| Var | Default | Purpose |
|---|---|---|
| `OKF_RAGAS_URL` | `http://ragas-service:8090` | okf-server → sidecar base URL |
| `RAGAS_INTERNAL_SECRET` | = `OKF_INTERNAL_SECRET` | sidecar auth (fail-closed both sides) |
| `RAGAS_JUDGE_BASE_URL` | = `VLLM_ENDPOINT` `/v1` | judge LLM (OpenAI-compatible) |
| `RAGAS_JUDGE_MODEL` | = `VLLM_LLM_MODEL_ID` *(inherited default — override per deployment; minimums: [model-requirements.md](model-requirements.md))* | judge/generator model id |
| `RAGAS_JUDGE_API_KEY` | = `VLLM_API_KEY` | judge bearer |
| `RAGAS_EMBED_BASE_URL` | TEI embedding service | embedder endpoint (answer_relevancy) |
| `RAGAS_EMBED_MODEL` | = `EMBED_MODEL_ID` *(inherited default — override per deployment)* | embedder id |
| `OKF_RAGAS_TESTSET_SIZE_DEFAULT` | `12` | default suite size on generate |
| `OKF_RAGAS_MAX_ENTRIES` | `200` | hard cap per suite (import + generate) |
| `OKF_RAGAS_RUN_CONCURRENCY` | `2` | per-run query concurrency (shared GPU) |
| `OKF_RAGAS_TIMEOUT_MS` | `600000` | sidecar call timeout (his EVAL_RAGAS_TIMEOUT=600s precedent) |

Ops mapping to Jerome's runner: `RAGAS_JUDGE_*` ≡ his `EVAL_JUDGE_*`; `RAGAS_EMBED_*` ≡ his `EVAL_EMBED_*`.

## Deployment surface

- `docker-compose.yaml`: always-on GENIE.AI service (no profile) — the Lab is an always-on feature; okf-server probe → honest `503 RAGAS_UNAVAILABLE` per-route when absent.
- 17th image: `.gitlab-ci.yml` build/scan/promote entries + `deploy/ansible/tasks/deploy-shared-facts.yml` image list + `env.j2` rows + `env` template section.
- Healthcheck: `GET /health`; fluentd logging driver like every service.

## Test surface

- Sidecar pytest: xlsx round-trips against pinned reference fixtures (one exported benchmark suite → re-imported equality; one hand-authored sheet in his layout → expected entries; results round-trip); generate/evaluate handlers against mocked ragas.
- okf-server jest: `__tests__/ragas-suite-service.test.js` with the `head-suite-service.test.js:11-45` mock header (arango-mock stores, frontmatter-service mocks); route/controller thin-wrap tests; 503-degrade path.
- Frontend jest: `ragas-panel.test.js` on the `mountDialog`/`fakeStore` pattern (`head-test-dialog.test.js:29-76`); progress-contract test mirroring `head-test-progress.test.js`.
- Config-validator: new-var coverage per AC7.
- Smoke: `scripts/okf-routing-lab/`-style script driving generate→run→export→import against the local build.
