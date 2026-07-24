# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## AI Agent Context

**Before implementing code, read `_bmad-output/project-context.md`** — it contains critical rules, conventions, and anti-patterns that AI agents must follow. This file covers unobvious details that are not duplicated here.

## Project Overview

GENIE.AI is an open-source generative AI framework for the public sector, providing a sovereign, DPG-compliant RAG (Retrieval-Augmented Generation) system with multilingual support. It integrates with [OPEA (Open Platform for Enterprise AI)](https://opea.dev) for AI/ML services.

## Language Policy

**ALL documentation, comments, and code MUST be in English.**

This includes:
- Documentation files (`*.md`)
- Code comments (`//`, `#`, `<!-- -->`)
- Variable names (except i18n content)
- User-facing text in code (except i18n translations)

**Exceptions:** Multilingual support in i18n files (e.g., `/src/i18n/locales/*.js`) is expected and required.

## Common Commands

### Environment Setup (First Time)

All deployments use a single `.env` file at the project root:

```bash
# Copy the template to your local environment file
cp env .env
# Then edit .env with your local values (API keys, passwords, etc.)
```

### Ansible Deployment (Recommended)

Automated Docker Swarm deployment via Ansible with per-environment secrets. See `deploy/ansible/README.md` for full documentation.

```bash
cd deploy/ansible
ansible-galaxy collection install -r requirements.yml
cp inventory/inventory.example inventory/test.ini          # edit with host IP
cp group_vars/itu_rtx_test/vars.yml group_vars/test/vars.yml  # base config
ansible-vault create group_vars/test/vault.yml --vault-id test@prompt  # set secrets
# Place SSL certs in files/certificates/test/
ansible-playbook -i inventory/test.ini deploy.yml --vault-id test@prompt
```

Tagged re-runs:
```bash
ansible-playbook -i inventory/test.ini deploy.yml --tags build,deploy --vault-id test@prompt
ansible-playbook -i inventory/test.ini deploy.yml --tags deploy --vault-id test@prompt
ansible-playbook -i inventory/test.ini teardown.yml --vault-id test@prompt
```

### Docker Deployment (Manual)

```bash
cp env .env                                           # First time: create local env
# Edit .env with your secrets

# Deploy modes (single root docker-compose.yaml):
docker compose up -d                                  # Core services only
docker compose --profile opea --profile gpu-models up -d  # Full stack with local GPU
docker compose --profile observability up -d          # Core + observability stack

# GPU-specific config:
docker compose --env-file .env --env-file env.t4 up -d        # NVIDIA T4 (16GB)
docker compose --env-file .env --env-file env.rtx6000 up -d   # RTX 6000 ADA (24GB)

# Useful commands:
docker compose build [service_name]                   # Rebuild after code changes
docker service logs genieai_<service> -f              # View logs
docker service scale genieai_<service>=<replicas>     # Scale a service
```

**Key notes:**
- Swarm: all images must be pre-built/pushed (`docker stack deploy` cannot build)
- Profiles: `opea` (AI orchestrators), `gpu-models` (vLLM, TEI), `observability` (OTel stack)
- Remote GPU: set `GPU_NODE_HOST` in `.env`, skip `gpu-models` profile — see `env` Section 14
- Only nginx ports (80, 443) exposed; all other services internal
- Node labels: `gateway=true`, `gpu=true`, `genieai=true`

### E2E Tests

Multi-phase procedure in `docs/e2e-tests/`:
1. Read `docs/e2e-tests/README.md` — execution order, prerequisites, conventions
2. Execute `docs/e2e-tests/00-clean-start.md` — Phase 0 (manual setup, MUST run first)
3. Execute all phases per their respective docs — mix of manual commands + Playwright
4. Each phase has prerequisites and cleanup steps — follow strictly, do not skip

**Important**: Phase K mutates realm settings. Cleanup steps K.5+K.6 MUST run after Phase K before proceeding to Phase L.

## Architecture

For the full architecture overview with diagrams (C4 context/container, authentication flows, service auth matrix, token lifecycle, RAG pipeline), see [Architecture Overview](site/content/en/docs/architecture/architecture.md).

### Layer Stack

1. **Client Layer**: Vue 3 web app (`components/gov-chat-frontend`), Flutter mobile (`mobile/genie_ai_mobile`)
2. **API Gateway**: Kong/NGINX (`api-gateway-solution`)
3. **Application Layer**: Node.js/Express backend (`components/gov-chat-backend`)
4. **AI Layer**: OPEA microservices (`genie-ai-overlay/`)
5. **Data Layer**: ArangoDB (graph + vector), Redis cache, file storage

### RAG Pipeline Flow

```
User Query → Backend (BFF) → ChatQnA Service → Embedding → Retriever (ArangoDB) → Reranker → LLM → Response
```

Each RAG pipeline stage emits OTel spans (when observability enabled), propagated via W3C `traceparent` header across service boundaries.

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `components/gov-chat-backend/` | Node.js API (auth, chat, analytics, users) |
| `components/gov-chat-backend/__tests__/` | Backend Jest tests (routes, services, middleware, tracing) |
| `components/gov-chat-frontend/` | Vue 3 web UI with Vuex state management |
| `components/gov-chat-frontend/src/__tests__/` | Frontend Jest tests (components, stores, services) |
| `components/document-repository/` | File upload/processing with ClamAV scanning |
| `mobile/genie_ai_mobile/` | Flutter mobile app (Android/iOS) |
| `genie-ai-overlay/embedding/`, `genie-ai-overlay/textgen/` | OPEA embedding + generation service wrappers |
| `deploy/ansible/` | Automated Docker Swarm deployment |
| `tests/rag-benchmarks/` | RAG evaluation harness + benchmarking |
| `tests/config-validator/` | Environment-variable coverage validation |
| `site/` | Hugo/Docsy documentation site (published on merge → main) |
| `genie-ai-overlay/chatqna/` | Main chat microservice (Python/FastAPI) |
| `genie-ai-overlay/retriever/` | Hybrid vector-graph retrieval service |
| `genie-ai-overlay/dataprep/` | Document ingestion and chunking pipeline |
| `genie-ai-overlay/reranker/` | Result reranking service |
| `genie-ai-overlay/core/` | Shared types, protocols, constants |
| `genie-ai-overlay/tests/` | OPEA pytest suite (retriever, dataprep, reranker, tracing) |
| `api-gateway-solution/` | Kong/NGINX configuration and scripts |
| `secrets/` | **Secrets** (SSL certificates - NOT committed) |
| `configs/` | **Configuration** (LLM prompts, OTel collector, Grafana dashboards) |
| `configs/otel/` | OTel Collector configuration |
| `configs/grafana/provisioning/` | Grafana datasources and dashboard definitions |
| `tests/` | E2E tests (Playwright), config validation, log assertions, metrics overhead |

## Documentation Structure

User-facing and dev-internal docs live in **separate** places — no duplication, no build-time copy:

- **User-facing docs → `site/content/en/docs/`** — canonical, published to the GitLab Pages docs site, editable in the GitLab Web IDE. Grouped by section (`core/`, `rag/`, `observability/`, `knowledge-base/`, `operations/`, `deployment/`, `configuration/`, `architecture/`, `frontend/`, `backend/`, `mobile/`). Hugo + Docsy; see `.claude/rules/SITE-LOCAL-DEV.md` to run locally.
- **Dev-internal docs → `docs/`** — repo-resident, referenced by code/developers (e.g. `docs/e2e-tests/`, `docs/database-migrations.md`). NOT published.

When adding a doc, pick one home based on audience. Do not duplicate across both.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vue 3, Vuex, vue-i18n, axios, ECharts/ApexCharts |
| Mobile | Flutter 3.10+, Dart |
| Backend | Node.js 18+, Express, JWT, winston |
| AI/ML | OPEA, vLLM, TEI (embeddings/reranking) |
| Database | ArangoDB 3.12+ (multi-model: document + graph + vector) |
| Cache | Redis |
| API Gateway | Kong, NGINX |
| Testing | Jest (Node.js), pytest (Python), Playwright (E2E), flutter_test |
| Observability | OTel SDK, VictoriaMetrics, VictoriaLogs, VictoriaTraces, Grafana |
| CI/CD | GitLab CI (`.gitlab-ci.yml`) |

## Linting and Formatting

ESLint 10 + Prettier 3 are configured across all JS components. Ruff is configured for Python (`genie-ai-overlay/`). Flutter's `analysis_options.yaml` configures Dart linting (`mobile/genie_ai_mobile/`). PostToolUse hooks automatically run ESLint on `.js`/`.vue` files and Ruff on `.py` files after edits.

**Before completing a task, run:**
```bash
npm run lint            # Check all JS components
npm run format:check    # Verify JS formatting without modifying files
npm run lint:fix        # Auto-fix JS lint issues
npm run format          # Auto-format all JS files
npm run lint:py         # Check Python code (Ruff)
npm run format:py:check # Check Python formatting (Ruff)
npm run lint:py:fix     # Auto-fix Python lint issues
npm run format:py       # Auto-format Python files
npm run lint:dart       # Analyze Flutter/Dart code
npm run format:dart:check # Check Dart formatting without modifying files
npm run format:dart     # Auto-format Dart files
```

## Testing

Test frameworks: Jest (backend, frontend, doc-repo), pytest (OPEA), flutter_test (mobile), Playwright (E2E). CI pipeline (`.gitlab-ci.yml`) runs a multi-stage pipeline (lint → test → config → build → scan → e2e → promote; plus scheduled/manual/deploy) on every MR with JUnit XML reports.

- **Backend `createApp()` pattern**: `index.js` exports `createApp()` — tests use `supertest` without starting HTTP server
- **OPEA shared fixtures**: `genie-ai-overlay/tests/conftest.py` mocks comps library, ArangoDB, model endpoints
- **Config validation**: `tests/config-validator/` validates env variable coverage

→ Full commands, patterns, CI details: `.claude/rules/TESTING.md`

## Code Standards Summary

### JavaScript/Vue 3

- Use `const` by default, `let` for reassignments, avoid `var`
- 2-space indentation, single quotes, mandatory semicolons
- Vue 3: Use **Options API** (existing codebase convention)
- Component structure: `<script>`, `<template>`, `<style scoped>`
- Props: Use `props` option with Object definition
- State: Vuex (existing) or Pinia (new projects)
- i18n: Use `vue-i18n` with `translate('key.path', 'default text')`

### Node.js/Express

- Controller → Service pattern: Controllers handle HTTP, Services contain business logic
- **`createApp()` pattern**: Backend `index.js` exports `createApp()` for testability — inject dependencies, create isolated Express app for supertest without starting server
- Use `dotenv` for configuration, centralized `config.js`
- Security: `helmet`, `express-rate-limit`, proper CORS
- Logging: `winston` with daily rotation
- API docs: `swagger-jsdoc` served at `/api-docs`

### Python (OPEA Services)

- Follow PEP 8, use `ruff` for linting and formatting (configured in `genie-ai-overlay/pyproject.toml`)
- Copyright headers required (ITU, or Intel+ITU for OPEA adaptations)
- Use `CustomLogger` from `comps` library
- Environment via `os.getenv()` with defaults

### Environment Configuration

- All services configured via `env` file (copy to `.env` for local dev)
- Key tokens: `HUGGING_FACE_HUB_TOKEN`, `VLLM_API_KEY`
- Database: `ARANGO_URL`, `ARANGO_DB`, `ARANGO_USER`, `ARANGO_PASSWORD`

#### Environment Variables Structure (Best Practices)

Following DRY principle, defaults live in code/docker-compose, not in env files.

**Main `env` file contains:**

**Secrets (required, no defaults in code):**
- `ARANGO_PASSWORD` - ArangoDB root password
- `POSTGRES_PASSWORD` - PostgreSQL superuser password
- `KONG_DB_PASSWORD` - PostgreSQL dedicated Kong user password
- `KEYCLOAK_DB_PASSWORD` - PostgreSQL dedicated Keycloak user password
- `KEYCLOAK_ADMIN_PASSWORD` - Keycloak master admin console password
- `KEYCLOAK_CLIENT_SECRET` - OIDC client secret for genie-app
- `KEYCLOAK_PROXY_CLIENT_SECRET` - Service account secret for admin API proxy
- `KC_DATAPREP_CLIENT_SECRET` - Dataprep service account secret (client_credentials grant)
- `EMAIL_*` - SMTP configuration (required for user verification)

**Deployment-Specific:**
- `VLLM_TRANSLATION_MODEL_ID` - GPU translation model ID
- `EMBEDDING_MODEL_ID` / `RERANKER_MODEL_ID` - AI model IDs
- `VLLM_LLM_MODEL_ID` - Labeling/chat LLM. **Must support OpenAI-compatible `response_format={"type":"json_object"}`** (vLLM guided JSON); dataprep requests strict JSON label output per chunk. Models without guided JSON produce malformed output → per-chunk fallback (slower, lower label quality). Validated on `ibm-granite/granite-4.1-8b`.
- `RERANKING_STRATEGY` - Strategy for selecting the final reranked set: `slice` (default; top-N), `threshold`, `slice_threshold`, `knee_threshold`, or `adaptive`.
- `RERANKER_TOP_N` - Number of top chunks kept by `slice`/`slice_threshold` strategies (default 3).
- `CONTEXTUAL_RETRIEVAL_ENABLED` - Contextual Retrieval (Anthropic-style), **on by default**: prepend an LLM doc-context prefix to each chunk before embedding + labeling (default `true`; set `false` to disable — a no-op beyond skipping context generation). Adds one vLLM call/chunk at ingest; never blocks ingestion (raw-chunk fallback). See the [Data Labelling Strategy](site/content/en/docs/rag/data-labeling.md) doc (§7 — Contextual Retrieval).
- `DATAPREP_CONTEXTUAL_MODEL` - Model for context generation (empty = reuse `VLLM_LLM_MODEL_ID`); must support guided JSON.
- `DATAPREP_CONTEXTUAL_DOC_BUDGET` - Max chars of doc text fed to the context LLM (~1500 tokens); <=0 disables truncation (default 100000).
- `DATAPREP_CONTEXTUAL_MAX_TOKENS` - Max output tokens for the context-generation LLM call (doc-level + per-chunk). The model writes ~196 tokens; the legacy hard cap of 200 left no headroom, so the JSON `{"context":"..."}` was truncated mid-string under concurrent vLLM load → JSONDecodeError → raw-chunk fallback. 512 gives comfortable margin at no extra cost (default 512).
- `CONTEXTUAL_STRATEGY` - `per_chunk` (default; one call/chunk, section-tailored context — the Anthropic recipe) or `doc_level` (one call/doc, same context on every chunk — N× cheaper, still propagates the doc subject).
- `CONTEXTUAL_LABEL_RAW` - Decoupled mode (default `true`): label the RAW chunk, use the generated context ONLY for the embedding (keeps label precision while propagating the subject via vectors).
- `CORS_ALLOWED_ORIGINS` - CORS allowed origins
- `CSP_CONNECT_SRC` - Content Security Policy connect sources
- `NGINX_PUBLIC_DOMAIN` - Public domain for Nginx
- `VUE_APP_API_URL` - Frontend API URL
- `VUE_APP_AVAILABLE_LOCALES` - Whitelist of active UI locales (comma-separated codes, e.g. `en,es`; unset = all locales)
- `KEYCLOAK_SUPPORTED_LOCALES` - Keycloak login-page locales (JSON array, e.g. `["en","es"]`; unset = curated default)
- `STREAMING_TRANSLATION_ENABLED` - Stream the target-language chat translation during generation instead of English-then-flip (issue #829). `1`/`0`; default `0` (current behavior)

**API Keys:**
- `HUGGING_FACE_HUB_TOKEN` - Required for pulling models
- `VLLM_API_KEY` - GPU node API key, sent as `Authorization: Bearer` by all clients. OpenAI-compatible clients (ChatOpenAI, AsyncOpenAI) use `api_key` param natively; OPEA TEI wrapper services (embedding, reranker) use `HF_TOKEN` env var (automatically set from `VLLM_API_KEY` in docker-compose.yaml)

**Observability (optional, Section 12C):**
- `ENABLE_OBSERVABILITY` - Enable observability stack (default: false)
- `GRAFANA_ADMIN_USER` - Grafana admin username (default: admin)
- `GRAFANA_ADMIN_PASSWORD` - Grafana admin password (required when enabled)
- `GRAFANA_PORT` - Grafana host port (default: 3002, avoids Backend port conflict)
- `VICTORIAMETRICS_RETENTION` - Metric retention period (default: 30d)
- `VICTORIALOGS_RETENTION` - Log retention period (default: 30d)
- `VICTORIATRACES_RETENTION` - Trace retention period (default: 30d)
- `OTEL_TRACES_SAMPLER_RATE` - Trace sampling percentage (default: 100.0 = 100%)
- `KONG_TRACING_INSTRUMENTATIONS` - Kong tracing instrumentations (default: `request`). Negligible overhead when OTel plugin disabled.
- `KONG_TRACING_SAMPLING_RATE` - Kong trace sampling rate 0.0–1.0 (default: 1.0 = 100%, aligned with `OTEL_TRACES_SAMPLER_RATE`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP Collector base URL for all instrumented services — backend (Node.js), OPEA (Python), Kong (via restore script). Default: `http://otel-collector:4318`. Override for external collectors.

**Prompts (Two-tier priority):**

LLM prompts use a simple two-tier priority system:

1. **ENV VAR** (highest): Override in `.env` for deployment-specific customization
2. **DEFAULT** (lowest): Built-in prompts in Python code (works out-of-the-box)

**Prompt Variables:**
- `CHATQNA_SYSTEM_PROMPT` - LLM system prompt (optional, has built-in default)
- `CHATQNA_ABSTENTION_INSTRUCTIONS` - Abstention behavior (optional, has built-in default)
- `CHATQNA_ENFORCE_ABSTENTION` - Whether to enforce abstention (default: "true")
- `LABEL_SELECTOR_SYSTEM_PROMPT` - Document labeling (has built-in default with `{labels_list}` placeholder)
- `CONTEXTUAL_RETRIEVAL_PROMPT` - Per-chunk doc-context generation for Contextual Retrieval (has built-in default with `{document_context}` placeholder; only used when `CONTEXTUAL_RETRIEVAL_ENABLED=true`)

**Customizing Prompts:**

Override in `.env`:
```bash
CHATQNA_SYSTEM_PROMPT="Custom prompt here..."
```

To change built-in defaults, edit the Python code:
- `genie-ai-overlay/chatqna/genieai_chatqna.py` - CHATQNA_SYSTEM_PROMPT default
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` - LABEL_SELECTOR_SYSTEM_PROMPT default
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` - CONTEXTUAL_RETRIEVAL_PROMPT default

**GPU-specific files (`env.t4`, `env.rtx6000`) contain only:**
- GPU memory utilization (`VLLM_GPU_UTILIZATION`, `VLLM_TRANSLATION_GPU_UTILIZATION`)
- Model length limits (`VLLM_MAX_MODEL_LEN`, `VLLM_TRANSLATION_MAX_MODEL_LEN`)
- Sequence limits (`VLLM_MAX_NUM_SEQS`, `VLLM_TRANSLATION_MAX_NUM_SEQS`)

**Variables with defaults (NOT in env):**
- All ports: `FRONTEND_PORT`, `BACKEND_PORT`, etc. (defaults in docker-compose.yaml)
- Database URLs: `ARANGO_URL`, `VLLM_ENDPOINT`, etc. (defaults in docker-compose.yaml)
- Service configurations: `LOG_LEVEL`, `NODE_ENV`, `TRANSLATION_BACKEND`, etc. (defaults in code)

## Observability Stack (Optional)

Disabled by default. Enable: `docker compose --profile observability up -d` or `ENABLE_OBSERVABILITY=1` in `.env`.

- **Tracing**: OTel SDK (Node.js + Python), W3C `traceparent` propagation across RAG pipeline
- **Storage**: VictoriaMetrics (metrics), VictoriaLogs (logs), VictoriaTraces (traces)
- **Dashboards**: 9 pre-built Grafana dashboards (auto-provisioned from `configs/grafana/provisioning/`)
- **Access**: Grafana via Kong `/grafana/` with Keycloak SSO

→ Full details: `.claude/rules/OBSERVABILITY.md`

→ Debugging recipes (query traces/logs to debug the dataprep/RAG pipeline): `.claude/rules/DEBUGGING-TRACING.md`

## i18n System

- English (`nameEN`) is the source of truth for RAG compatibility
- Translations stored in dedicated collections (`serviceCategoryTranslations`, etc.)
- Translation keys follow pattern: `${sourceKey}_${languageCode}`
- Locale **availability** is config-driven, not file-presence: all locale files stay in source; a deployment restricts active locales via `VUE_APP_AVAILABLE_LOCALES` (web — runtime-injected through `window.APP_CONFIG`), `KeycloakConfig.supportedLocaleCodes` per flavor (mobile), and `KEYCLOAK_SUPPORTED_LOCALES` (Keycloak login pages). Unset = all locales.

## Docker Compose Structure

Single `docker-compose.yaml` for both `docker compose up` and `docker stack deploy`. Profiles control which layers activate:

```
docker-compose.yaml (dual-mode)
├── OPEA AI/ML (profiles: [opea], [gpu-models])
├── GENIE.AI Services (always active)
├── API Gateway (always active)
└── Observability (profile: [observability])
```

**Swarm**: OPEA controlled by `DEPLOY_OPEA`, observability by `ENABLE_OBSERVABILITY`. Node labels: `gateway=true`, `gpu=true`, `genieai=true`.

**Remote GPU**: Set `GPU_NODE_HOST` in `.env`, skip `gpu-models` profile. Orchestrator endpoints overridden to GPU node. `VLLM_API_KEY` for auth. See `env` Section 14.

→ Full architecture diagrams: `site/content/en/docs/architecture/architecture.md` | Deployment guides: `site/content/en/docs/deployment/docker-compose-setup.md`, `site/content/en/docs/deployment/docker-swarm-setup.md`

## Database Schema (ArangoDB)

- Collections: `users`, `conversations`, `messages`, `serviceCategories`, `services`, `serviceCategoryTranslations`
- Edges: `serviceCategoryTranslationsEdge`, graph relationships for knowledge graph
- Vector search enabled on chunk embeddings

## API Structure

Backend routes are organized by domain:
- `/api/auth/*` - Authentication (Keycloak OIDC)
- `/api/me/*` - User profile (singleton)
- `/api/chat/*` - Chat and conversation handling
- `/api/analytics/*` - Usage analytics
- `/api/admin/*` - Admin dashboard functions
- Document upload/management lives in the **document-repository** service (separate from the BFF), behind the gateway
- `/api/services/*`, `/api/service-categories/*` - Services and service-category hierarchy

<!-- headroom:learn:start -->
## Headroom Learned Patterns
*Auto-generated by `headroom learn` on 2026-06-25 — do not edit manually*

### RTK token proxy
*~2,000 tokens/session saved*
- `rtk find` / `rtk grep` reject compound predicates and actions (`-not`, `-exec`, `-o ... -print`): error `rtk find does not support compound predicates`. Use bare `find` or `rtk proxy find ...`.
- rtk-wrapped lint/format (`npm run lint`, `npx prettier`) report phantom errors. Get the real CI result via `rtk proxy npx eslint src/` / `rtk proxy npx prettier --check`.

### GitLab & glab
*~1,500 tokens/session saved*
- GitLab self-hosted: host `opensource.unicc.org`, project `un/itu/genie-ai` (numeric id `90`), remote `opensource.unicc.org:un/itu/genie-ai.git`.
- Prefer `glab api "projects/:id/<endpoint>"` — the `:id` placeholder auto-resolves and avoids the 2-vs-90 id confusion and `--output=json | python3` KeyErrors that `glab mr view --output=json` produces.
- glab CLI subcommands (`mr`, `ci`) often fail auth — prefix with `GITLAB_HOST=opensource.unicc.org`. `glab api` with `:id` works without the prefix.

### Deployment Hosts (SSH)
*~1,500 tokens/session saved*
- `govstack@10.0.0.100` — GitLab runner (CPU). `govstack@10.0.0.110` — GPU API node + 2nd runner, UFW was disabled to unblock docker socket-proxy. `govstack@10.0.0.102` — `release/el-salvador` deployed stack.
- SSH key auth works; `sudo` needs interactive password (cannot `sudo` non-interactively). Wrap remote calls with `timeout N ssh -o ConnectTimeout=8 govstack@<ip> '...'`.

<!-- headroom:learn:end -->
