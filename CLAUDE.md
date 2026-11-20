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

All Compose and Swarm deployments use a single `.env` file at the project
root (the Kubernetes path has no `.env` — its configuration is the chart
values plus Secret env rows):

```bash
# Copy the template to your local environment file
cp env .env
# Then edit .env with your local values (API keys, passwords, etc.)
```

### Ansible Deployment (Recommended)

Automated Docker Swarm deployment with per-environment secrets — full first-time
setup, vault secrets, tagged re-runs and teardown: `deploy/ansible/README.md`.

### Docker Deployment (Manual)

Single root `docker-compose.yaml`, dual-mode (`docker compose up` and
`docker stack deploy`). Profiles: `opea` (AI orchestrators), `gpu-models` (vLLM,
TEI), `observability` (OTel stack).

```bash
cp env .env                                           # First time: create local env
docker compose up -d                                  # Core services only
docker compose --profile opea --profile gpu-models up -d  # Full stack with local GPU
docker compose --env-file .env --env-file env.t4 up -d        # NVIDIA T4 (16GB)
docker compose --env-file .env --env-file env.rtx6000 up -d   # RTX 6000 ADA (48GB)
```

Key notes: Swarm pulls pre-built images from GitLab Container Registry; remote GPU
= set `GPU_NODE_HOST` in `.env`, skip `gpu-models` profile (`env` Section 14); only
nginx ports (80/443) exposed; node labels `gateway=true`, `gpu=true`, `genieai=true`.

→ Full guides: `site/content/en/docs/deploy/docker-compose-setup.md`,
`site/content/en/docs/deploy/docker-swarm-setup.md`

### Kubernetes

Helm chart on `main`, deployed to laptop minikube via Flux from
`genie-ai-deploy`. Compose + Ansible remain primary (see above). Per-env
overlays + SealedSecrets live in the deploy repo.

→ Full chart workflow, render gates, Helm traps and the live validation
set: `.claude/rules/K8s-WORKFLOW.md` (the only k8s rule file — read it
before touching `charts/**`).

Key notes (not repeated in the rule file):
- Chart at `charts/genieai-umbrella/`, library at `charts/genieai-common/`; see `charts/README.md`
- Cluster prerequisites: CNPG (a CRD serving `postgresql.cnpg.io/v1`), kube-arangodb 1.4.x, keycloak-operator 26.x, sealed-secrets ≥0.40 — installed once per cluster, before any release
- GPU tier is binary (`opea.gpu.mode=external|in-cluster`); ArangoDB mode switch needs `helm uninstall` + `helm install` (no auto-promote)
- Live state + plan status: `docs/charts/migration-status.md`

### E2E Tests

Multi-phase procedure in `docs/e2e-tests/`:
1. Read `docs/e2e-tests/README.md` — execution order, prerequisites, conventions
2. Execute `docs/e2e-tests/00-clean-start.md` — Phase 0 (manual setup, MUST run first)
3. Execute all phases per their respective docs — mix of manual commands + Playwright
4. Each phase has prerequisites and cleanup steps — follow strictly, do not skip

**Important**: Phase K stops Keycloak (K.4) and sweeps test artifacts (K.5+K.6) — run those cleanup steps after Phase K before Phase L; the K.2 expiry is client-scoped and mutates no realm setting (#1835). Full procedure: `docs/e2e-tests/suite-map.md` § Phase K.

**The suite has no CI door** (operator decision, 2026-11-10: no CI resources
for the Playwright suite — it runs locally, regularly). The executed set is
the local run's: `tests/e2e/run/run-local-e2e.sh` runs the whole `tests/e2e/`
tree against a deployed stack, prints the outcome and the **context** of
every red (the build the venue serves, this checkout's HEAD, and the handles
the specs waited for) — the issue itself is written **by hand** →
`docs/e2e-tests/local-run.md`.

### Demo Data Seeding

Populate a fresh demo instance (knowledge hierarchy + docs corpus +
aligned quickHelp config) with `deploy/demo-seed/genie-demo-seed.py`
(data-driven: `demo-seed-config.json`). Runbook + contracts:
`deploy/demo-seed/README.md` (agent stub: `.claude/rules/DEMO-SEEDING.md`) —
run `--dry-run` first; never against production without an explicit operator GO.

## Architecture

For the full architecture overview with diagrams (C4 context/container, authentication flows, service auth matrix, token lifecycle, RAG pipeline), see [Architecture Overview](site/content/en/docs/architecture/architecture.md).

### Layer Stack

0. **Deployment Layer**: Helm chart (`charts/genieai-umbrella` + library `charts/genieai-common`) reconciled by Flux v2 from the `genie-ai-deploy` repo — Kubernetes path on `main`, validated on laptop minikube (`overlays/<dev>-laptop/dev`).
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
| `charts/genieai-umbrella/` | Single-install umbrella chart (data layer + services + OPEA tier) |
| `charts/genieai-common/` | Library chart (templates + helpers) |
| `api-gateway-solution/` | Kong/NGINX configuration and scripts |
| `secrets/` | **Secrets** (SSL certificates - NOT committed) |
| `configs/` | **Configuration** (LLM prompts, OTel collector, Grafana dashboards) |
| `configs/otel/` | OTel Collector configuration |
| `configs/grafana/provisioning/` | Grafana datasources and dashboard definitions |
| `tests/` | E2E tests (Playwright), config validation, log assertions, metrics overhead |

## Documentation Structure

User-facing and dev-internal docs live in **separate** places — no duplication, no build-time copy:

- **User-facing docs → `site/content/en/docs/`** — canonical, published to the GitLab Pages docs site, editable in the GitLab Web IDE. Grouped by section (`core/`, `rag/`, `observability/`, `knowledge-base/`, `operations/`, `deployment/`, `configuration/`, `architecture/`, `frontend/`, `backend/`, `mobile/`). Hugo + Docsy; see `.claude/rules/SITE-LOCAL-DEV.md` to run locally.
- **Dev-internal docs → `docs/`** — repo-resident, referenced by code/developers (e.g. `docs/e2e-tests/`, `docs/database-migrations.md`, `docs/RELEASE.md`). NOT published.
- **Presentations** use Reveal.js and Mermaid for new decks. Follow [the presentation authoring guide](docs/presentations/README.md) for sources, verification and Hugo publication.
- **Agent instructions → `.claude/rules/`** — step-by-step commands for AI agents (e.g. `RELEASE.md`, `TESTING.md`, `SERVER-TESTING.md`). Referenced by CLAUDE.md.
- **Archiving a completed BMAD initiative → `.claude/rules/POST-PRD-ARCHIVAL.md`** — when a PRD initiative closes and the next one starts.

When adding a doc, pick one home based on audience. Do not duplicate across both.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vue 3, Vuex, vue-i18n, axios, ECharts/ApexCharts |
| Mobile | Flutter 3.10+, Dart |
| Backend | Node.js 22, Express, JWT, winston |
| AI/ML | OPEA v1.5, Python 3.11, vLLM, TEI (embeddings/reranking) |
| Database | ArangoDB 3.12+ (multi-model: document + graph + vector) |
| Cache | Redis |
| API Gateway | Kong, NGINX |
| Testing | Jest (Node.js), pytest (Python), Playwright (E2E), flutter_test |
| Observability | OTel SDK, VictoriaMetrics, VictoriaLogs, VictoriaTraces, Grafana |
| Kubernetes deployment | Helm 3 + Flux v2 (`charts/genieai-umbrella` + `genie-ai-deploy`) |
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
→ How an E2E test locates an application element (`data-test-id` in the web app, `Key` in the Flutter app): `.claude/rules/E2E-TESTING.md`

**Visible behaviour** has its own rules, per client — read the one that matches what you are changing:

- **Web** (`components/gov-chat-frontend/`) → `components/gov-chat-frontend/CLAUDE.md` § *Visual Fidelity*. The
  rendered result is verified by the Playwright suite in `tests/e2e/`: measure it, mutation-test every assertion,
  and never judge a screenshot by eye.
- **Mobile** (`mobile/genie_ai_mobile/`) → `mobile/genie_ai_mobile/CLAUDE.md` § *Visual Fidelity*. No golden-image
  harness exists here: widget tests assert structure and resolved tokens, and the device screenshot is verified by
  a human in both themes.

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

→ Which file is which, what must never be committed, the service port map, the
**full environment-variable reference** (secrets, deployment-specific knobs,
import-capacity sizing, prompts): `.claude/rules/ENVIRONMENT.md`

**The three traps that bite hardest** (details in `ENVIRONMENT.md`):
- **Never copy a doc-context budget between deployments.** `DATAPREP_CONTEXTUAL_DOC_BUDGET`
  / `DATAPREP_MAX_MODEL_LEN` derive from the window `VLLM_ENDPOINT` actually serves — a
  budget sized for 65536 tokens overflows a 2048-token window and the rejected calls fall
  back to raw chunks *silently*.
- **Lane pairs move together or not at all.** `OKF_IMPORT_CONCURRENCY`=`PII_WEB_CONCURRENCY`
  (import) and `OKF_INGEST_CONCURRENCY`=`DATAPREP_INGEST_CONCURRENCY` (drain) are two
  pairs; raising one half queues (429 / sidecar backlog). Size ≈ `min(16, cores/2)`
  against measured headroom — every import logs the capacity it actually got.
- **A bind mount never falls back to image contents.** Unseeded `CONFIG_DIR_FRONTEND` /
  `CONFIG_DIR_KEYCLOAK` = unbranded frontend and Keycloak with no error anywhere.

## Observability Stack (Optional)

Disabled by default. Enable: `docker compose --profile observability up -d` or `ENABLE_OBSERVABILITY=1` in `.env`.

- **Tracing**: OTel SDK (Node.js + Python), W3C `traceparent` propagation across RAG pipeline
- **Storage**: VictoriaMetrics (metrics), VictoriaLogs (logs), VictoriaTraces (traces)
- **Dashboards**: 9 pre-built Grafana dashboards (auto-provisioned from `configs/grafana/provisioning/`)
- **Access**: Grafana via Kong `/grafana/` with Keycloak SSO

→ Full details: `.claude/rules/OBSERVABILITY.md`

→ Debugging recipes (query traces/logs to debug the dataprep/RAG pipeline): `.claude/rules/DEBUGGING-TRACING.md`

→ CVE triage, verification and mitigation playbook (GitLab 18.2.8-ee GraphQL APIs, triple-source verification, dismissal semantics, image-slimming checklist): `.claude/rules/CVE-REMEDIATION.md`

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

→ Full architecture diagrams: `site/content/en/docs/architecture/architecture.md` | Deployment guides: `site/content/en/docs/deploy/docker-compose-setup.md`, `site/content/en/docs/deploy/docker-swarm-setup.md` | Kubernetes: `site/content/en/docs/deploy/kubernetes.md`

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

### El Salvador dev workflow
- All dev work for el-salvador happens on `dev/el-salvador` (reset from `release/el-salvador` at each cycle). Permanent Draft MR `dev/el-salvador` → `release/el-salvador` (NEVER MERGE) keeps CI alive.
- After live validation, cherry-pick to main via MR, then rebase `release/el-salvador` onto main.
- Full pattern: `.claude/rules/EL-SALVADOR-WORKFLOW.md`

<!-- headroom:learn:end -->
