---
title: "Environment variables (single source)"
weight: 1
description: "Every supported env-var with default, scope, and the container that reads it — generated from env and docker-compose.yaml."
mode: reference
persona: mixed
owner: docs-stewards
last_reviewed: 2026-09-29
---

## Purpose

This page is the **single source of truth** for GENIE.AI environment
variables. It supersedes the three divergent tables that previously lived in
`deploy/install-guide.md`, `deploy/docker-compose-setup.md`, and
`deploy/docker-swarm-setup.md` (22 drift errors in Wave 1).

The defaults are pulled from the root `env` file and
`docker-compose.yaml`. When a default disagrees with this table, **fix the
source first** (the file in the repo), then regenerate.

## Required secrets (no default — must be set)

| Variable | Used by | Notes |
|---|---|---|
| `ARANGO_PASSWORD` | backend, dataprep, retriever, document-repository | Root DB password. Must be URL-safe; avoid `+`, `/`, `=` |
| `POSTGRES_PASSWORD` | postgres (kong-db, keycloak-db) | Kong + Keycloak shared PostgreSQL instance |
| `KONG_DB_PASSWORD` | kong-db, kong | Dedicated Kong DB user |
| `KEYCLOAK_DB_PASSWORD` | keycloak-db, keycloak | Dedicated Keycloak DB user |
| `KEYCLOAK_ADMIN_PASSWORD` | keycloak | Master admin console password |
| `KEYCLOAK_CLIENT_SECRET` | backend (BFF) | OIDC client secret for `genie-app` |
| `KEYCLOAK_PROXY_CLIENT_SECRET` | backend (admin proxy) | Service account secret for Admin API proxy |
| `KC_DATAPREP_CLIENT_SECRET` | dataprep | `client_credentials` grant secret |
| `EMAIL_HOST` | keycloak | SMTP server hostname |
| `EMAIL_PORT` | keycloak | SMTP server port (default 587) |
| `EMAIL_USER` | keycloak | SMTP username |
| `EMAIL_PASSWORD` | keycloak | SMTP password |
| `EMAIL_FROM` | keycloak | From address for user-verification emails |
| `HUGGING_FACE_HUB_TOKEN` | vllm, embedding, reranker (via HF_TOKEN) | Required to pull models |
| `VLLM_API_KEY` | all OPEA clients | Bearer token sent as `Authorization: Bearer` |
| `GRAFANA_ADMIN_PASSWORD` | grafana | Required when `ENABLE_OBSERVABILITY=1` |
| `GENIE_ADMIN_PASSWORD` | backend (BFF) | Realm-level admin bootstrap password — created on first run if absent. See [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) |

## Keycloak realm & OIDC clients (defaults — override per deployment)

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `KEYCLOAK_URL` | `https://localhost/auth` | backend, frontend, mobile | Public URL users reach your Keycloak at. BFF validates tokens against `<KEYCLOAK_URL>/realms/<KEYCLOAK_REALM>`. |
| `KEYCLOAK_REALM` | `genie` | backend, frontend, mobile | Realm name. Switch via Keycloak admin console dropdown. |
| `KEYCLOAK_CLIENT_ID` | `genie-app` | backend, frontend | Web SPA OIDC client id (must match the realm client). |
| `KC_DATAPREP_CLIENT_ID` | `dataprep-service-client` | dataprep | Service-account client for the `client_credentials` grant. |
| `KC_MOBILE_CLIENT_ID` | `genie-mobile-<institution>` | mobile | Mobile OIDC client id (PKCE flow). Per-flavor suffix — see `mobile/genie_ai_mobile/lib/config/flavors/<flavor>.dart` (e.g. `genie-mobile-itu`). |
| `KC_MOBILE_REDIRECT_SCHEME` | `com.<institution>.genieai` | mobile | Deep-link scheme registered on Android/iOS for the OIDC redirect. Android package convention (`com.<institution>.genieai[.<flavor>]`). |

## Realm-level admin bootstrap (defaults — override per deployment)

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `GENIE_ADMIN_USERNAME` | `genie-admin` | backend (BFF) | Realm-level admin username; created on first run if absent. |
| `GENIE_ADMIN_EMAIL` | _(unset)_ | backend (BFF) | Email for the bootstrap admin user; recommended for `emailVerified: true` on first login. |
| `TRANSLATION_CACHE_PASSWORD` | _(random per-service, persisted in volume)_ | backend (BFF) | Password for the translation-cache Redis user (set when a Redis password is enabled). |

## Deployment-specific

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | translation | e.g. `facebook/m2m100-418M` |
| `EMBEDDING_MODEL_ID` | `BAAI/bge-large-en-v1.5` | embedding | Any TEI-supported encoder |
| `RERANKER_MODEL_ID` | `BAAI/bge-reranker-v2-m3` | reranker | Any TEI-supported cross-encoder |
| `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | vllm, okf-server | Must support guided JSON (`response_format={"type":"json_object"}`). The name the vLLM container is started with (`--served-model-name`) — the pin every service reads (`VLLM_MODEL_ID` is filled from it). |
| `VLLM_MODEL_ID` | _(empty)_ | chatqna, retriever, dataprep, okf-server | Pin the LLM name and skip discovery. Empty = discover the served model at `/v1/models`; `LLM_MODEL` is no longer read. It is the SPELLING the Python services read — in compose it is filled from `VLLM_LLM_MODEL_ID`, the name the vLLM container serves. okf-server reads both spellings (`VLLM_LLM_MODEL_ID` first, then `VLLM_MODEL_ID`): the raw spelling is its escape hatch for a deployment whose OKF legs talk to another server (a proxy whose `/v1/models` is not readable). A pin must name a model the CALLED endpoint serves — a name the endpoint does not serve 404s every call. |
| `MODEL_LLM_TIMEOUT_SECONDS` | `180` | dataprep, retriever | vLLM chat completions. Read by `core/model_http_policy.py`. On every shipped topology it is parsed but unused: its only consumer is the retriever's OpenAI-key probe, and no service is given `OPENAI_API_KEY`. |
| `MODEL_LLM_MAX_RETRIES` | `2` | dataprep, retriever | SDK retries on 408/409/429/5xx and connection errors. `0` is honoured as a real value. Values above 10 are rejected. |
| `MODEL_SUMMARIZER_TIMEOUT_SECONDS` | `600` | retriever | Document summarizer. A NEW ceiling, not the openai default kept. Not lowered: the call has no fallback, so its timeout becomes a 500 on the chat request. |
| `MODEL_EMBEDDING_TIMEOUT_SECONDS` | `600` | retriever | Embedding client, OpenAI-API branch ONLY. Also a NEW ceiling — `langchain-openai` forwards `request_timeout` (default `None`), which overrides the SDK default. Lowering it yields a silently EMPTY retrieval: the except clause returns `[]` ahead of the BM25 leg. |
| `MODEL_RERANK_TIMEOUT_SECONDS` | `300` | reranker | TEI rerank. Not lowered for the same reason as the summarizer. |
| `MODEL_AUTH_TIMEOUT_SECONDS` | `300` | dataprep | Keycloak service-account token fetch. Separate from the control-plane budget because every ingestion-log write and status update waits on it, one attempt, no retry, re-raises on failure. |
| `MODEL_CONTROL_PLANE_TIMEOUT_SECONDS` | `30` | dataprep, chatqna | Ingestion-log writes, doc-status updates, doc-repo callbacks. Not the Keycloak token fetch. |
| `MODEL_CONNECT_TIMEOUT_SECONDS` | `30` | dataprep, reranker | The CONNECT phase ceiling for every aiohttp session this policy budgeted. `aiohttp`'s default session already carried 30 s; passing an explicit `ClientTimeout(total=...)` drops it, and `None` means no limit rather than "inherit". Raise for slow DNS or a routed mesh. |
| `MODEL_PROBE_TIMEOUT_SECONDS` | `10` | dataprep, retriever, chatqna, okf-server | The `/v1/models` probe behind the TTL-cached model-id lookup. With no pinned name, a probe failure: chatqna → request fails closed (503); dataprep → the ingest job fails and rolls back; retriever → the summarizer is silently skipped; okf-server → the call fails loudly (503) instead of naming an unpinned model. Raise it on a remote GPU node whose models load slowly. It is a CEILING on the probe, not the probe's budget: the probe takes at most half of the caller's own timeout, and the chat call gets what is left of it — so on the first call after each cache expiry the chat window is shorter than on the calls that follow. The remainder is per ATTEMPT: a retried call re-runs with the same window, so the wall time of a failing call can exceed the declared timeout. |
| `MODEL_DETECT_TTL` | `60` | dataprep, retriever, chatqna, okf-server | TTL of the `/v1/models` model-id cache (seconds) — one knob for the Python services and the OKF Node services. Lower = fresher model ids, more probes. |
| `RAGAS_JUDGE_API_KEY` | _(empty)_ | ragas-service, okf-server | Bearer for the judge endpoint. The ragas sidecar falls back to `VLLM_API_KEY` (its judge base is the deployment vLLM); okf-server uses it only when the operator names it, and otherwise sends the deployment credential only when the judge base IS the deployment endpoint. |
| `RAGAS_JUDGE_BASE_URL` | `http://vllm:8000/v1` (compose) / the GPU URL when a remote GPU is configured (Ansible) | ragas-service, okf-server | Judge endpoint. Point it at the deployment's own model server: okf-server sends the deployment credential ONLY when the judge base is the deployment endpoint (same host, same port, same or version-prefixed path) — a judge on any other endpoint needs `RAGAS_JUDGE_API_KEY` named explicitly. |
| `RERANKING_STRATEGY` | `slice` | chatqna | `slice` / `threshold` / `slice_threshold` / `knee_threshold` / `adaptive` |
| `RERANKER_TOP_N` | `3` | chatqna | Top chunks kept by `slice`/`slice_threshold` |
| `CONTEXTUAL_RETRIEVAL_ENABLED` | `true` | dataprep | On by default; prepends doc-context prefix |
| `DATAPREP_CONTEXTUAL_MODEL` | _(empty = reuse `VLLM_LLM_MODEL_ID`)_ | dataprep | Must support guided JSON |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | `0` | dataprep | Max chars fed to the context LLM. `0` = **derived** from the window the endpoint serves, discovered at runtime from `VLLM_ENDPOINT` (the doc-level sibling `_DOC_LEVEL` is a maximum the same window caps). `>0` sets a maximum — the window still caps it whenever it is known, so a budget copied from a larger-window deployment cannot overflow a small one; the rejected calls would otherwise fall back to raw chunks silently. `<0` disables contextualization for the document. |
| `DATAPREP_CONTEXTUAL_MAX_TOKENS` | `512` | dataprep | Per-call max output tokens for context generation |
| `DATAPREP_MAX_MODEL_LEN` | `0` | dataprep | The context window (tokens) dataprep sizes document contexts against. `0` = discover it at runtime from `VLLM_ENDPOINT`. `>0` = the deployer states the window the endpoint serves — the only lever on a strict OpenAI-compatible provider (its `/v1/models` carries no `max_model_len`) and the way to state the window of a `DATAPREP_CONTEXTUAL_MODEL` that is not the model the endpoint lists first. |
| `CONTEXTUAL_STRATEGY` | `per_chunk` | dataprep | `per_chunk` (Anthropic recipe — default) or `doc_level` (N× cheaper, same context for every chunk) |
| `CONTEXTUAL_LABEL_RAW` | `true` | dataprep | `true` = label raw chunk, use context only for embedding |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:8090,http://127.0.0.1:8090,https://${NGINX_PUBLIC_DOMAIN:-localhost}` | backend | Comma-separated origins; localhost dev default |
| `CSP_CONNECT_SRC` | `'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090` | nginx | Content-Security-Policy `connect-src`; localhost dev default |
| `NGINX_PUBLIC_DOMAIN` | `localhost` | nginx | Public domain |
| `VUE_APP_API_URL` | `/api` | frontend | Frontend API base |
| `VUE_APP_AVAILABLE_LOCALES` | _(unset = all)_ | frontend | Comma-separated codes (e.g. `en,es`) — see [Restrict active locales](/docs/configure/locale-whitelist/) |
| `KEYCLOAK_SUPPORTED_LOCALES` | _(curated default)_ | keycloak | JSON array (e.g. `["en","es"]`) — see [Restrict active locales](/docs/configure/locale-whitelist/) |
| `STREAMING_TRANSLATION_ENABLED` | `0` | chatqna | `1`/`0`; stream translated tokens during generation |
| `KC_GRAFANA_CLIENT_ID` | `grafana` | keycloak, grafana | OIDC client ID for Grafana SSO |
| `KC_GRAFANA_CLIENT_SECRET` | _(required when observability enabled)_ | keycloak, grafana | OIDC client secret |

## Observability

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `ENABLE_OBSERVABILITY` | `0` | root | `0`/`1` (not `true`/`false`) |
| `GRAFANA_ADMIN_USER` | `admin` | grafana | |
| `GRAFANA_PORT` | `3002` | grafana | Host port; avoids Backend port conflict |
| `VICTORIAMETRICS_RETENTION` | `30d` | victoriametrics | |
| `VICTORIALOGS_RETENTION` | `30d` | victorialogs | |
| `VICTORIALOGS_URL` | _(no in-code default — `VictoriaLogsClient` constructor must receive `baseURL`; Ansible `env.j2:243` sets `http://victorialogs:9428`)_ | backend | VL HTTP base URL. Injected by `env.j2`; bypass only when running outside Ansible and set it explicitly. |
| `VICTORIALOGS_TENANT_ID` | _(no in-code default — read by `shared/lib/melt/victorialogs-client.js:105`, defaults `AccountID:0, ProjectID:0` when unset)_ | backend | Tenant header for `/select/logsql/*` (`AccountID:ProjectID`). Ansible splits `VICTORIALOGS_TENANT_ID` into `VICTORIALOGS_TENANT_ID_ACCOUNT_ID` + `VICTORIALOGS_TENANT_ID_PROJECT_ID` for the underlying VL request. |
| `VICTORIATRACES_RETENTION` | `30d` | victoriatraces | |
| `MELT_PROVIDER` | `victorialogs` (hardcoded constant in `components/shared/lib/melt/index.js`) | backend | Future-proof seam selector for the OTel metrics/logs/traces exporter. Whitelisted by `tests/config-validator/` so a deployer may override the env file; the runtime constant is the actual current value. Today there is only one backend implementation. |
| `OTEL_TRACES_SAMPLER_RATE` | `100.0` | backend, opea | 0.0–100.0 |
| `KONG_TRACING_INSTRUMENTATIONS` | `request` | kong | |
| `KONG_TRACING_SAMPLING_RATE` | `1.0` | kong | 0.0–1.0 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | backend, opea, kong | Base URL for OTLP |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | _(not set — collector derives `/v1/logs` from `OTEL_EXPORTER_OTLP_ENDPOINT`)_ | backend, opea | Set only when the logs endpoint must override the inferred one (signal-specific URL is used as-is; no path appended). |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | _(not set — collector derives `/v1/traces` from `OTEL_EXPORTER_OTLP_ENDPOINT`)_ | backend, opea | Set only when the traces endpoint must override the inferred one. |
| `VL_QUERY_TIMEOUT_MS` | `30000` | backend | axios timeout for VictoriaLogs `query` / `hits` |

## Prompts (override defaults)

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `CHATQNA_SYSTEM_PROMPT` | _(built-in)_ | chatqna | LLM system prompt |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | _(built-in)_ | chatqna | |
| `CHATQNA_ENFORCE_ABSTENTION` | `true` | chatqna | |
| `LABEL_SELECTOR_SYSTEM_PROMPT` | _(built-in)_ | dataprep | `{labels_list}` placeholder |
| `CONTEXTUAL_RETRIEVAL_PROMPT` | _(built-in)_ | dataprep | `{document_context}` placeholder |

## Service ports (with defaults baked in)

See [Core → Project Overview](/docs/core/project-overview/) for
the `nginx` / `kong` / `keycloak` port map.

## Variables with code-side defaults (not in `env`)

Ports, database URLs, and service configurations default in
`docker-compose.yaml` / code, **not** in `env`. The full list is too long
to reproduce here — see `docker-compose.yaml` for the canonical values.

## GPU profile overlays

`env.t4` and `env.rtx6000` overlay these on top of `env` to set GPU-memory
utilization and model-length limits per profile. They are read via
`docker compose --env-file .env --env-file env.<profile> up -d`.

| Variable | env.t4 default | env.rtx6000 default | Notes |
|---|---|---|---|
| `VLLM_GPU_UTILIZATION` | `0.4` | `0.55` | Fraction of GPU memory vLLM pre-allocates |
| `VLLM_MAX_MODEL_LEN` | `2048` | `65536` | Context length — the vLLM-side memory knob (`--max-model-len`). Dataprep does NOT read it: it discovers the served window at runtime from `VLLM_ENDPOINT` (see `DATAPREP_MAX_MODEL_LEN`) |
| `VLLM_MAX_NUM_SEQS` | `16` | `16` | Max concurrent sequences |
| `VLLM_DTYPE` | `half` | _(unset, defaults in docker-compose)_ | Compute dtype |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.3` | `0.4` | |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `2048` | `8192` | |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | `16` | `32` | |

## Validation

```bash
cd tests/config-validator
npm install
npm test
```

The validator fails CI if a required env-var is undocumented here.

## Related

- [Deployment → Install guide](/docs/deploy/install-guide/) — deployment narrative
- [Configure → CORS / CSP](/docs/configure/cors-csp/) — public-domain knobs
- [Configure → Keycloak admin guide](/docs/configure/keycloak-admin-guide/) — realm/service configuration
- [Configure → Restrict active locales](/docs/configure/locale-whitelist/) — `VUE_APP_AVAILABLE_LOCALES` / `KEYCLOAK_SUPPORTED_LOCALES` / mobile whitelist