---
title: "Environment variables (single source)"
weight: 1
description: "Every supported env-var with default, scope, and the container that reads it — generated from env and docker-compose.yaml."
mode: reference
persona: mixed
owner: docs-stewards
last_reviewed: 2026-09-18
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
| `EMAIL_*` | keycloak | SMTP settings for user verification emails |
| `HUGGING_FACE_HUB_TOKEN` | vllm, embedding, reranker (via HF_TOKEN) | Required to pull models |
| `VLLM_API_KEY` | all OPEA clients | Bearer token sent as `Authorization: Bearer` |
| `GRAFANA_ADMIN_PASSWORD` | grafana | Required when `ENABLE_OBSERVABILITY=1` |

## Deployment-specific

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | translation | e.g. `facebook/m2m100-418M` |
| `EMBEDDING_MODEL_ID` | `BAAI/bge-base-en-v1.5` | embedding | Any TEI-supported encoder |
| `RERANKER_MODEL_ID` | `BAAI/bge-reranker-v2-m3` | reranker | Any TEI-supported cross-encoder |
| `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | vllm | Must support guided JSON (`response_format={"type":"json_object"}`) |
| `RERANKING_STRATEGY` | `slice` | chatqna | `slice` / `threshold` / `slice_threshold` / `knee_threshold` / `adaptive` |
| `RERANKER_TOP_N` | `3` | chatqna | Top chunks kept by `slice`/`slice_threshold` |
| `CONTEXTUAL_RETRIEVAL_ENABLED` | `true` | dataprep | On by default; prepends doc-context prefix |
| `DATAPREP_CONTEXTUAL_MODEL` | _(empty = reuse `VLLM_LLM_MODEL_ID`)_ | dataprep | Must support guided JSON |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | `100000` | dataprep | Max chars fed to context LLM (~1500 tokens; ≤0 disables truncation) |
| `DATAPREP_CONTEXTUAL_MAX_TOKENS` | `512` | dataprep | Per-call max output tokens for context generation |
| `CONTEXTUAL_STRATEGY` | `per_chunk` | dataprep | `per_chunk` (Anthropic recipe — default) or `doc_level` (N× cheaper, same context for every chunk) |
| `CONTEXTUAL_LABEL_RAW` | `true` | dataprep | `true` = label raw chunk, use context only for embedding |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:8090,http://127.0.0.1:8090,https://${NGINX_PUBLIC_DOMAIN:-localhost}` | backend | Comma-separated origins; localhost dev default |
| `CSP_CONNECT_SRC` | `'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090` | nginx | Content-Security-Policy `connect-src`; localhost dev default |
| `NGINX_PUBLIC_DOMAIN` | `localhost` | nginx | Public domain |
| `VUE_APP_API_URL` | `/api` | frontend | Frontend API base |
| `VUE_APP_AVAILABLE_LOCALES` | _(unset = all)_ | frontend | Comma-separated codes (e.g. `en,es`) |
| `KEYCLOAK_SUPPORTED_LOCALES` | _(curated default)_ | keycloak | JSON array (e.g. `["en","es"]`) |
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
| `VICTORIATRACES_RETENTION` | `30d` | victoriatraces | |
| `OTEL_TRACES_SAMPLER_RATE` | `100.0` | backend, opea | 0.0–100.0 |
| `KONG_TRACING_INSTRUMENTATIONS` | `request` | kong | |
| `KONG_TRACING_SAMPLING_RATE` | `1.0` | kong | 0.0–1.0 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | backend, opea, kong | Base URL for OTLP |
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

See [Configure → CORS / CSP / public-domain](/docs/configure/cors-csp/) for
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
| `VLLM_GPU_UTILIZATION` | `0.4` | `0.6` | Fraction of GPU memory vLLM pre-allocates |
| `VLLM_MAX_MODEL_LEN` | `2048` | `4096` | Context length |
| `VLLM_MAX_NUM_SEQS` | `64` | `1024` | Max concurrent sequences |
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

- [Deploy → Install guide](/docs/deploy/install-guide/) — deployment narrative
- [Configure → CORS / CSP](/docs/configure/cors-csp/) — public-domain knobs
- [Configure → Keycloak admin guide](/docs/configure/keycloak-admin-guide/) — realm/service configuration