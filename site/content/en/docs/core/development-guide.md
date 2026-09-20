---
title: "Development Guide"
description: "Setting up a local development environment across all GENIE.AI components: prerequisites, commands, tests, linting, and observability."
weight: 4
section: "core"
audience: "developer"
mode: how-to
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

This guide gets you from a fresh clone to a working local stack across every
GENIE.AI component — frontend, backend, document-repository, mobile, OPEA
microservices, Kong/Nginx. It also covers the daily commands you need while
developing.

For high-level orientation, see [Project Overview](/docs/core/project-overview/).
For code layout, see [Source Tree Analysis](/docs/core/source-tree-analysis/).
For service-to-service contracts, see
[Integration Architecture](/docs/core/integration-architecture/).

> **CI/CD pipeline, Ansible deployment, and observability dashboards live
> in their own sections.** This page focuses on local dev. Links at the
> bottom of each section point to the canonical home of each topic.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure (TL;DR)](#project-structure-tldr)
- [Environment Configuration](#environment-configuration)
- [Component Development](#component-development)
  - [Frontend (Vue 3)](#frontend-vue-3)
  - [Backend (Node.js)](#backend-nodejs)
  - [Document Repository](#document-repository)
  - [Mobile (Flutter)](#mobile-flutter)
  - [AI/ML Services (Python/OPEA)](#aiml-services-pythonopea)
  - [API Gateway (Kong/Nginx)](#api-gateway-kongnginx)
- [Docker Development](#docker-development)
- [Database Setup](#database-setup)
- [Testing](#testing)
- [Linting and Formatting](#linting-and-formatting)
- [Adding Tracing to New Code](#adding-tracing-to-new-code)
- [Git Workflow](#git-workflow)
- [Troubleshooting](#troubleshooting)
- [Where to Go Next](#where-to-go-next)

---

## Prerequisites

### Global tools

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22.x LTS | Frontend, backend, document-repository, shared/lib |
| npm | 9.x or later | JS dependency management |
| Python | 3.11 or later | OPEA services (chatqna, dataprep, retriever, reranker, embedding) |
| Docker | 24.x or later | Container runtime |
| Docker Compose | v2.x | Local stack |
| Git | 2.x or later | Version control |
| Flutter | 3.10+ (Dart 3.10.8+) | Mobile app |
| Ansible (optional) | latest | Recommended deployment (see [Deployment](/docs/deploy/)) |

### Component-specific requirements

| Component | Requirements |
|---|---|
| Frontend | Node.js 22+, npm 9+ |
| Backend | Node.js 22+, npm 9+ |
| Document Repository | Node.js 22+, npm 9+ |
| Mobile | Flutter 3.10+ (Dart 3.10.8+), Android Studio (Android) or Xcode (iOS) |
| AI/ML Services | Python 3.11+ in a venv (never `--break-system-packages`); NVIDIA GPU recommended for OPEA |
| API Gateway | Docker, OpenSSL (for self-signed dev certificates) |

### GPU / OPEA prerequisites

The OPEA pipeline (`vllm`, `tei-embedding`, `tei-reranker`, `chatqna`,
`dataprep-arango-service`, `retriever-arango-service`, `reranker`) needs an
NVIDIA GPU.

- **Minimum VRAM:** 16 GB (NVIDIA T4) for the default model set
  (`VLLM_LLM_MODEL_ID=ibm-granite/granite-4.1-8b` validated).
- **No GPU?** Skip OPEA: `docker compose up -d` (no `--profile opea` and
  no `--profile gpu-models`). The stack still serves the UI and API but
  chat returns "AI service unavailable".

GPU-specific env files:

- `env.t4` — NVIDIA T4 (16 GB VRAM).
- `env.rtx6000` — RTX 6000 ADA (24 GB VRAM).

```bash
docker compose --env-file .env --env-file env.t4 --profile opea --profile gpu-models up -d
```

---

## Quick Start

> Run every command from the **repository root**.

### 1. Clone and install

```bash
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai

# Root npm install (shared tooling)
npm install

# Component installs
npm install --prefix components/gov-chat-frontend
npm install --prefix components/gov-chat-backend
npm install --prefix components/document-repository
npm install --prefix components/shared/lib       # required: backend imports frozen shared-lib
```

The backend imports `shared-lib` (a frozen singleton that exports `logger`,
`reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog`,
`parsePositiveInt`, `dbService`, `securityHeaders`, `SecurityMiddleware`,
`melt`). Without `components/shared/lib/node_modules/`, the backend fails
to start with `Cannot find module 'winston-transport'`.

### 2. Configure environment

```bash
cp env .env
# Edit .env with local values. Required secrets (no defaults in code):
#   ARANGO_PASSWORD, POSTGRES_PASSWORD, KONG_DB_PASSWORD,
#   KEYCLOAK_ADMIN_PASSWORD, KEYCLOAK_CLIENT_SECRET,
#   KEYCLOAK_PROXY_CLIENT_SECRET, KC_DATAPREP_CLIENT_SECRET,
#   GENIE_ADMIN_PASSWORD, KC_GRAFANA_CLIENT_SECRET,
#   EMAIL_HOST/USER/PASSWORD/FROM (SMTP for user verification),
#   HUGGING_FACE_HUB_TOKEN, VLLM_API_KEY
```

> **Never `source .env`** — passwords with `+`, `)`, etc. break shell
> expansion. Always extract specific vars with `grep | cut`.

### 3. Start the stack

```bash
# Core services only (no AI/ML) — fastest local bring-up
docker compose up -d

# With OPEA (needs GPU + model downloads)
docker compose --profile opea up -d

# With GPU-specific tuning
docker compose --env-file .env --env-file env.t4 --profile opea --profile gpu-models up -d

# With observability stack (OTel Collector + VictoriaMetrics + VictoriaLogs + VictoriaTraces + Grafana)
docker compose --profile observability up -d
```

### 4. Verify it's healthy

```bash
# Backend health
curl -sI http://localhost:3000/api/health
# Expected: HTTP/1.1 200 OK + JSON body { "status": "ok", "serverTime": "...", "uptime": "..." }

# Frontend served on 8090 (internal) → proxied through Nginx on 80/443 (host)
# Open https://localhost in your browser → expect the GENIE.AI landing page.

# Keycloak admin console (https://localhost/auth/admin)
# Login with KEYCLOAK_ADMIN_USERNAME=admin + KEYCLOAK_ADMIN_PASSWORD from .env.

# Backend API docs (Swagger UI)
# Open https://localhost/api-docs

# ArangoDB web UI
# Open https://localhost:8529 (host-exposed when ArangoDB is enabled)
```

If `curl -sI http://localhost:3000/api/health` returns anything other than
`200 OK`, jump to [Troubleshooting](#troubleshooting) below.

---

## Project Structure (TL;DR)

```
genie-ai/
├── components/
│   ├── gov-chat-frontend/        # Vue 3 (Vue CLI), port 8090
│   ├── gov-chat-backend/         # Express BFF, port 3000 — createApp() pattern
│   ├── document-repository/      # Express, port 3001 — src/server.js + src/app.js
│   └── shared/lib/               # Frozen backend shared library
├── genie-ai-overlay/             # OPEA microservices (Python/FastAPI)
├── mobile/genie_ai_mobile/       # Flutter mobile app (Riverpod, flutter_appauth fork)
├── api-gateway-solution/         # Kong (kong_config.json) + NGINX + ModSecurity + Certbot
├── configs/                      # OTel, Grafana, Keycloak, PostgreSQL config
├── deploy/ansible/               # Ansible playbook + per-env vault files
├── tests/                        # RAG benchmarks, config validator, E2E
├── docs/                         # Developer-internal KB (NOT published)
├── site/                         # Hugo + Docsy docs site (this page)
├── docker-compose.yaml           # Single-file orchestration (Compose + Swarm)
└── env                           # Environment variable template
```

For the per-directory walk-through, see
[Source Tree Analysis](/docs/core/source-tree-analysis/).

---

## Environment Configuration

### env / .env convention

- **`env`** (root, committed) — template with every variable and inline
  comments. Defaults live in `docker-compose.yaml` (`${VAR:-default}`) and
  in code; `env` lists every tunable and the format for secrets.
- **`.env`** (root, gitignored) — your local overrides.

### Required secrets

| Variable | Why |
|---|---|
| `ARANGO_PASSWORD` | ArangoDB root password |
| `POSTGRES_PASSWORD` | PostgreSQL superuser password (Kong + Keycloak DBs) |
| `KONG_DB_PASSWORD` | Dedicated Kong PostgreSQL user |
| `KEYCLOAK_DB_PASSWORD` | Dedicated Keycloak PostgreSQL user |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak master admin console password |
| `KEYCLOAK_CLIENT_SECRET` | OIDC client secret for `genie-app` |
| `KEYCLOAK_PROXY_CLIENT_SECRET` | Service-account secret for the Admin API proxy |
| `KC_DATAPREP_CLIENT_SECRET` | Dataprep service-account secret (`client_credentials` grant) |
| `GENIE_ADMIN_PASSWORD` | GENIE realm admin password (provisioned by `keycloak-config-cli`) |
| `KC_GRAFANA_CLIENT_SECRET` | Grafana OIDC client secret (when observability is on) |
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin password (when observability is on) |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` / `EMAIL_FROM` | SMTP for user email verification |
| `HUGGING_FACE_HUB_TOKEN` | Pull models from HF Hub |
| `VLLM_API_KEY` | Bearer token for the GPU node's vLLM endpoint (OPEA TEI wrappers pick it up automatically as `HF_TOKEN`) |

### Optional but recommended

| Variable | Default | Notes |
|---|---|---|
| `KEYCLOAK_URL` | `https://localhost/auth` | Public URL for Keycloak |
| `KEYCLOAK_REALM` | `genie` | Realm name |
| `KEYCLOAK_CLIENT_ID` | `genie-app` | Web client id |
| `VUE_APP_API_URL` | (unset → relative `/api`) | Override when the backend is on a different host |
| `VUE_APP_AVAILABLE_LOCALES` | (unset → all 14 locales active) | Comma-separated whitelist (e.g. `en,es,fr`) — see [Restrict active locales](/docs/configure/locale-whitelist/) |
| `LOG_LEVEL` | `info` | Winston verbosity (`debug` for tracing dataprep) |

> **Prompts** (`CHATQNA_SYSTEM_PROMPT`, `LABEL_SELECTOR_SYSTEM_PROMPT`,
> `CONTEXTUAL_RETRIEVAL_PROMPT`, etc.) follow a two-tier priority — ENV VAR
> overrides the built-in Python default. The full list lives at
> [Configuration → Prompts](/docs/configure/#prompts); do not duplicate
> it here.

---

## Component Development

### Frontend (Vue 3)

**Stack:** Vue 3 (Options API), Vuex, vue-i18n, ApexCharts, Axios, Vue CLI.

```bash
cd components/gov-chat-frontend

# Dev server with hot reload
npm run serve        # alias: npm run dev
# → http://localhost:8090  (NOT 5173 — Vue CLI sets port 8090)

# Build (production)
npm run build

# Lint + format
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

**Verify your dev server is up:**

```bash
curl -sI http://localhost:8090/         # → HTTP 200
# Open http://localhost:8090 in your browser → expect the GENIE.AI landing page.
```

**Tech notes**

- **Charts:** only `apexcharts` + `vue3-apexcharts` are dependencies.
  There is **no ECharts** in the codebase.
- **State:** Vuex (`src/store/index.js`, `src/store/modules/`). Use the
  Options API for components — that's the existing codebase convention.
- **Design System:** always use DS primitives in `src/components/ds/`
  (`DsButton`, `DsCard`, `DsModal`, etc.). Do not roll your own.

#### Adding a DS component (snippet)

```vue
<template>
  <DsCard variant="elevated" :padding="space-md" hoverable>
    <h3>{{ title }}</h3>
    <slot />
  </DsCard>
</template>

<script>
import DsCard from '@/components/ds/Card.vue';
export default {
  components: { DsCard },
  props: { title: { type: String, required: true } }
};
</script>
```

Padding uses a CSS custom-property token (`--space-md`) — pass it as a
literal CSS variable in `:style`, not a string prop like `'md'`. See
`DsCard.vue` for the full prop list.

#### Adding a Vue Router route

```javascript
// src/router.js
{
  path: '/admin',
  name: 'Admin',
  component: () => import('@/components/AdminDashboard.vue'),
  meta: { requiresAuth: true, showSidebar: false }
}
```

The auth guard in `router.js` automatically redirects unauthenticated users
to Keycloak.

---

### Backend (Node.js)

**Stack:** Node.js 22, Express, `shared-lib` singleton, JWT validation
against Keycloak JWKS, Winston.

```bash
cd components/gov-chat-backend

# Development server (auto-reload via nodemon)
npm run dev

# Production start
npm start

# DB setup scripts (run after ArangoDB is up)
npm run setup-db                # Creates collections + indexes
npm run init-categories         # Seeds service categories from configs/
npm run setup-all               # setup-db + init-categories
```

**Verify:**

```bash
curl -sI http://localhost:3000/api/health
# Expected: HTTP/1.1 200 OK + JSON body { "status": "ok", "serverTime": "...", "uptime": "..." }
```

#### Adding a new route

The backend mounts routes via `ROUTE_CONFIGS` in `index.js`. To add a new
route module:

1. Create `routes/foo-routes.js` exporting a router factory:
   ```javascript
   // routes/foo-routes.js
   const express = require('express');
   module.exports = (fooService) => {
     const router = express.Router();
     router.get('/', async (req, res, next) => {
       try { res.json(await fooService.list(req.userId)); }
       catch (err) { next(err); }
     });
     return router;
   };
   ```

2. Register it in `ROUTE_CONFIGS` (`index.js` lines 469-504):
   ```javascript
   { file: 'foo-routes', paths: ['/api/foo'], serviceName: 'fooService', keycloakAuth: true }
   ```

3. Wire the service in `initializeServices()` (`index.js`):
   ```javascript
   const FooService = require('./services/foo-service');
   services.fooService = new FooService({ dbService, logger });
   ```

#### Adding a new service

Use the `shared-lib` singleton — never raw `arangojs`:

```javascript
// services/foo-service.js
const { logger, dbService } = require('../shared-lib');

class FooService {
  async list(userId) {
    const aql = require('arangojs').aql;
    return dbService.query(aql`FOR u IN users FILTER u.userId == ${userId} RETURN u`).then((c) => c.all());
  }
}
module.exports = FooService;
```

Raw `arangojs` is reserved for migrations under `scripts/migrations/`.

#### Logging from the backend

```javascript
const { logger } = require('../shared-lib');
logger.info('starting operation', { fooId });
logger.warn('recoverable failure', { error: err.message });
logger.error('unrecoverable', { error: err.message, stack: err.stack });
```

The Winston logger ships to stdout (and to VictoriaLogs when
`ENABLE_OBSERVABILITY=1`).

---

### Document Repository

**Stack:** Node.js/Express, Multer, ClamAV, ArangoDB.

```bash
cd components/document-repository

# Development server
npm run dev          # nodemon src/server.js

# Production start
npm start            # node src/server.js

# Tests
npm test             # All Jest tests
npm run test:contract  # __tests__/unit/(controllers|middlewares)/
npm run test:coverage
```

**Verify:**

```bash
curl -sI http://localhost:3001/health
# Expected: HTTP 200 OK
```

**ClamAV operational note:** the container shells out to `clamdscan` via
`clamav-node.sh`. After every image rebuild, verify with
`docker exec <doc-repo> clamdscan --version` — `clamav-daemon` must be
installed at runtime.

---

### Mobile (Flutter)

**Stack:** Flutter 3.10+ (Dart 3.10.8+), Riverpod (`flutter_riverpod ^3.0.0`),
local `flutter_appauth` fork, `flutter_secure_storage`.

```bash
cd mobile/genie_ai_mobile

# Fetch packages
flutter pub get

# Run on a connected device / emulator
flutter run --flavor dev           # dev flavour (localhost)
flutter run --flavor itu           # prod flavour (real OIDC client id)
flutter run --flavor staging       # staging flavour

# Static analysis (Dart linting)
flutter analyze                    # aliased as `npm run lint:dart` at repo root
dart format                        # aliased as `npm run format:dart`

# Tests
flutter test                       # aliased as `npm run test:flutter`
```

**Scheme Coherence Rule** — these four values MUST match for the OIDC
PKCE flow to work on a real device:

| Location | Where to set | What to set | Verify |
|---|---|---|---|
| `lib/config/flavors/<flavor>.dart` | Flutter source | `keycloakUrl`, `realm`, `clientId` (camelCase fields on `KeycloakConfig`) | `flutter run --flavor dev` shows the login screen |
| `mobile/genie_ai_mobile/android/app/build.gradle` | Android Gradle | `applicationId` + `manifestPlaceholders["appAuthRedirectScheme"]` | `adb shell pm dump <package> \| grep -i redirect` |
| `mobile/genie_ai_mobile/ios/Runner/Info.plist` | Xcode | `CFBundleURLSchemes` (must match `KC_MOBILE_REDIRECT_SCHEME`) | Xcode target → Info → URL Types |
| `configs/keycloak/genie-realm.yaml` | Keycloak | `redirectUris`, `webOrigins` (must include the bundle id) | `docker logs keycloak-config` after deploy |

A mismatch produces an infinite "logging in..." spinner or
`error: invalid_request` from Keycloak. See the [Mobile deployment
guide](/docs/mobile/) for full setup.

---

### AI/ML Services (Python/OPEA)

**Stack:** Python 3.11 (always use a venv), FastAPI, vLLM, TEI, ArangoDB,
Docling.

```bash
cd genie-ai-overlay

# Always create a venv (never --break-system-packages)
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[test]"

# Run a service locally (each has its own entry point)
python genieai_chatqna.py                 # ChatQnA — port 8888 (MEGA_SERVICE_PORT)
python genieai_dataprep_microservice.py   # Dataprep — port 5000
python genieai_retriever_microservice.py  # Retriever — port 7000
python genieai_reranking_microservice.py  # Reranker — port 8000

# Tests
pytest                                   # All (comps mocked via conftest.py)
pytest tests/test_chatqna.py             # Specific service
pytest contracts/                        # Contract tests vs real vendored comps
```

> The retriever entry point is **`genieai_retriever_microservice.py`** —
> not `genieai_retriever.py` (that file does not exist). Same pattern for
> the other services.

**Override audit** — every deviation from upstream OPEA is tracked in
`OVERRIDES.yaml` AND mirrored as a `# OVERRIDE …` marker in source. After
editing any override, run:

```bash
python build-patches/lint_overrides.py   # must exit 0
```

---

### API Gateway (Kong/Nginx)

Kong runs in **DB-less mode** with declarative config
(`api-gateway-solution/new-config/kong_config.json`). Reload via the
`restore-kong-config.sh` script.

```bash
# Inside the kong container (admin port 8001 is internal only)
docker exec kong kong reload

# From anywhere with admin access (inside the docker network only)
docker exec kong curl -s http://localhost:8001/routes | jq '.data[].paths'

# Validate the kong_config.json structure
cd api-gateway-solution/new-config
npm install   # if you haven't already
npm run test:ci
```

> **Kong admin port 8001 is internal only** — it is not exposed to the
> host in `docker-compose.yaml`. Use `docker exec kong curl
> http://localhost:8001/...` (admin is on `0.0.0.0:8001` inside the
> container) or run `curl http://kong:8001/...` from any container on
> the `genieai_network`.

To debug a route, first verify the live table matches the file:

```bash
docker exec kong curl -s http://localhost:8001/routes | jq '.data[].paths'
jq '.routes[].paths' api-gateway-solution/new-config/kong_config.json
```

See the Kong gateway routing section in
[Integration Architecture](/docs/core/integration-architecture/#kong-gateway-routing)
for the full route table.

---

## Docker Development

### Stack lifecycle

```bash
# Bring up the stack
docker compose up -d                      # core only
docker compose --profile opea up -d       # with OPEA (GPU)
docker compose --profile observability up -d  # with OTel + Victoria + Grafana

# Tail logs
docker compose logs -f backend
docker service logs genieai_backend -f   # Swarm equivalent

# Rebuild a single service after code change
docker compose build backend
docker compose up -d --force-recreate backend

# Run a one-off command inside a running service
docker compose exec backend bash
docker compose exec postgres psql -U genieai -d kong
docker compose exec arango-vector-db arangosh --server.password "$ARANGO_PASSWORD"

# Tear down (deletes volumes)
docker compose down -v
```

### Service-specific port reachability

Only **Nginx (80/443)** and **ArangoDB (8529)** are host-exposed. To reach
anything else from your laptop, run `docker exec …` into a container on
the same network, or proxy through Nginx on 80/443. See
[Project Overview → Quick reference](/docs/core/project-overview/#quick-reference)
for the full port table.

---

## Database Setup

The backend runs migrations and seed scripts via npm wrappers:

```bash
cd components/gov-chat-backend
npm run setup-db              # Create collections + indexes (idempotent)
npm run init-categories       # Seed serviceCategories from configs/
npm run setup-all             # Both, in order
```

For dataprep, the ArangoDB graph (`ARANGO_GRAPH_NAME`, default `GRAPH`) and
vector indexes are created on the first run of `dataprep-arango-service`.
If you change the model (e.g. different embedding dimension), drop the
`chunks` collection and let dataprep recreate the vector index.

For ArangoDB access:

```bash
# Arango shell
docker compose exec arango-vector-db arangosh --server.password "$ARANGO_PASSWORD"

# Web UI
open https://localhost:8529
# Login: ARANGO_USER (default `root`) + ARANGO_PASSWORD
```

---

## Testing

### Backend

```bash
cd components/gov-chat-backend
npm test                  # All Jest tests (~30 files, flat under __tests__/)
npm run test:contract     # Filters to --testPathPattern='__tests__/routes/' (route-handler tests)
npm run test:coverage
```

`createApp()` pattern: tests construct an isolated Express app via
`createApp({ services })` and use `supertest` — no HTTP server is started.

### Frontend

```bash
cd components/gov-chat-frontend
npm test                  # Jest + @vue/test-utils, mirrors src/ structure
```

The frontend has **no** `test:contract` script — all tests run under
`npm test`.

### Document Repository

```bash
cd components/document-repository
npm test                  # All Jest tests
npm run test:contract     # Filters to src/__tests__/unit/(controllers|middlewares)/
npm run test:coverage
```

### Mobile

```bash
cd mobile/genie_ai_mobile
flutter test              # aliased as `npm run test:flutter` at the repo root
```

### OPEA

```bash
cd genie-ai-overlay
source .venv/bin/activate
pytest                                    # Unit tests (comps mocked via conftest.py)
pytest tests/test_chatqna.py              # Specific service
pytest contracts/                         # Contract tests vs REAL vendored comps
```

The `contracts/` suite runs **inside the built image** against the real
vendored comps — its parent conftest does NOT stub `comps`, so a
sibling-directory layout is intentional (no parent conftest would
contaminate it). See `genie-ai-overlay/contracts/README.md`.

### E2E

Multi-phase Playwright + Patrol tests — see
[E2E Tests](/docs/e2e-tests/) for the full execution order. Each phase has
prerequisites and cleanup steps.

### Config validator

```bash
cd tests/config-validator
npm test
```

---

## Linting and Formatting

Run **all** checks locally before pushing — CI uses the same scripts and
blocks MRs on failure.

```bash
# Root scripts (delegate to each component)
npm run lint              # ESLint (backend, frontend, doc-repo)
npm run lint:fix
npm run format            # Prettier (JS + Vue)
npm run format:check
npm run lint:py           # Ruff (Python)
npm run lint:py:fix
npm run format:py
npm run format:py:check
npm run lint:dart         # Flutter analyze
npm run format:dart
npm run format:dart:check
```

ESLint, Prettier, Ruff, and `flutter analyze` all run via PostToolUse hooks
on the relevant file extensions. CI adds `lint:overrides` to enforce
OVERRIDES.yaml ↔ source-marker sync in `genie-ai-overlay/`.

> rtk-wrapped lint/format occasionally reports **phantom errors** — re-run
> via `rtk proxy npx eslint src/` (or `rtk proxy npx prettier --check`)
> for the real CI result.

---

## Adding Tracing to New Code

### Backend (Node.js)

```javascript
const { withSpan } = require('./tracing');

async function fetchSomething(userId) {
  return withSpan('service.fetchSomething', async (span) => {
    span.setAttribute('user.id', userId);
    const result = await dbService.query(/* ... */);
    span.setAttribute('result.count', result.length);
    return result;
  });
}
```

`tracing-pii.js` automatically filters sensitive attributes (passwords,
tokens, emails) — do not log raw user PII in span attributes.

### OPEA (Python)

```python
from tracing import with_span

async def fetch_documents(query):
    with with_span("retriever.fetch_documents", attributes={"query.length": len(query)}):
        result = await arango_search(query)
        return result
```

Tracing is a no-op when `ENABLE_OBSERVABILITY` is not `1`, so adding
`withSpan` calls in production code is safe.

For full architecture (collector config, dashboards, alert rules, RAG
debugging recipes), see [Observability](/docs/observe/) and
[Debugging with Tracing & Logs](/docs/observe/tracing/).

---

## Git Workflow

> **NEVER commit or push directly to `main` or `release/*`.** Use a
> worktree + dedicated branch + MR. Direct commits have repeatedly broken
> CI; if a push to a protected branch fails, surface it rather than
> force-pushing.

### Worktree workflow

```bash
# Create a feature branch + worktree
git worktree add ../genie-ai-fix-xyz -b fix/xyz main

# Develop inside the worktree
cd ../genie-ai-fix-xyz
# … edit, commit …
git push -u origin fix/xyz
# Open MR on GitLab
```

### Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) (enforced by
CI). Examples:

- `feat(backend): add SSE keepalive ping`
- `fix(dataprep): avoid JSON truncation under vLLM load`
- `chore(ci): drop scan artifact on rerun`
- `docs(site): fix project-overview port typo`

Use the global `user.email`/`user.name` (`jerome.revillard@wanadoo.fr`) —
never override with `-c user.email=...` on `git commit`.

### Pre-push checklist

```bash
npm run lint && npm run format:check
npm run lint:py && npm run format:py:check
npm run lint:dart && npm run format:dart:check
# Run the relevant component's test suite
```

CI runs the full multi-stage pipeline on every MR — see the canonical
[CI/CD](/docs/core/development-guide/) for the 12-stage structure
(`lint → test → config → build → scan → contract-in-image → e2e → promote
→ release → scheduled → manual → deploy`). Cancelling obsolete pipelines
before triggering new ones saves runner minutes.

---

## Troubleshooting

### Port already in use

```bash
# Linux
lsof -i :3000
sudo lsof -i :3000            # If lsof returns no PID, the port may be
                              # held by a system process — try sudo or
                              # `fuser 3000/tcp`
kill -9 <PID>

# macOS
sudo lsof -i :3000
```

### Backend won't start: `Cannot find module 'winston-transport'`

`shared/lib` is imported by the backend (`logger.js` internally requires
`victorialogs-transport`, which depends on `winston-transport`). Install
it explicitly:

```bash
npm install --prefix components/shared/lib
```

### Frontend shows "EAI_AGAIN" / blank screen

`VUE_APP_API_URL` is wrong, or Kong cannot reach the backend. Check:

```bash
docker compose ps backend          # Is it healthy?
docker compose logs backend        # Look for "shared-lib components missing"
curl -sI http://backend:3000/api/health   # From any container on the network
```

### Dataprep labelling times out / `JSONDecodeError`

Almost always the `DATAPREP_CONTEXTUAL_MAX_TOKENS` cap is too low under
vLLM load. The legacy hardcoded 200 truncated `{"context":"…"}`. Bump it
(default is now 512):

```bash
DATAPREP_CONTEXTUAL_MAX_TOKENS=512   # default in `env`
```

### ClamAV not actually scanning

Verify the daemon is installed in the deployed image:

```bash
docker exec <doc-repo> clamdscan --version
```

If it returns `command not found`, `clamav-daemon` was dropped by
`--no-install-recommends`. Re-add it to the `Dockerfile` runtime stage
(post-!324 hardening).

### Keycloak login loop

- ROPC is enabled but the user lacks `firstName`, `lastName`, or
  `emailVerified=true` — see [Server Testing](/docs/core/development-guide/)
  for the canonical user-creation payload.
- Mobile scheme mismatch — see the [Scheme Coherence Rule](#mobile-flutter).

### OPEA services unhealthy in `docker compose ps`

Check that `arango-vector-db` is `healthy` first (dataprep and retriever
both `depends_on: arango-vector-db: condition: service_healthy`). Then:

```bash
docker compose logs dataprep-arango-service | tail -50
docker compose logs retriever-arango-service | tail -50
```

Common root causes: missing `HUGGING_FACE_HUB_TOKEN`, model download
interrupted, or VRAM exhaustion (drop model size or run with
`env.cpu` / no `gpu-models` profile).

### Where to look first when stuck

| Symptom | Where to look |
|---|---|
| Frontend blank page | browser DevTools network tab → which request failed? |
| Backend 500 | `docker compose logs backend` → stack trace |
| Backend 401 on protected route | Keycloak realm access → user has `user`/`admin` role |
| Dataprep silent failure | ArangoDB `ingestion_log` collection (per-chunk progress) |
| Slow chat response | VictoriaTraces → `chatqna.llm_inference` span duration |
| Translation missing | Backend `services/logs/` → `[TRANSLATION-SERVICE]` config |

---

## Related

| You want to… | Read |
|---|---|
| Deploy to a real environment | [Deployment](/docs/deploy/) (Ansible recommended) |
| Add observability (OTel, Grafana, dashboards) | [Observability](/docs/observe/) |
| Debug a slow chat / failing ingest | [Debugging with Tracing & Logs](/docs/observe/tracing/) |
| Find the CI/CD pipeline structure | [CI/CD](/docs/core/development-guide/) |
| Look up an environment variable | [Configuration](/docs/configure/) |
| Understand the C4 architecture | [Architecture](/docs/architecture/) |
| Run the multi-phase E2E suite | [E2E Tests](/docs/e2e-tests/) |
| Work on the mobile app | [Mobile](/docs/mobile/) |

You're ready to develop. A natural first end-to-end check is to **run a
sample query against the seeded knowledge base** (open
`https://localhost`, log in, ask a question and watch the SSE chunks),
then **add a service category via the admin UI** and confirm it appears in
the dropdown. After that, **instrument your first new route with
`withSpan`** and watch the span land in Grafana → Trace Explorer.
