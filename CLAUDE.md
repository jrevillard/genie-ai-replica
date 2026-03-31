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

**Note:** The per-service `env` files in `components/` are deprecated - use the root `env` file.

### Ansible Deployment (Recommended)

Automated Docker Swarm deployment via Ansible with per-environment secrets. See `deploy/ansible/README.md` for full documentation.

```bash
cd deploy/ansible
ansible-galaxy collection install -r requirements.yml
cp inventory.example inventory/test.ini          # edit with host IP
cp group_vars/test.vault.example group_vars/test.vault
ansible-vault edit --vault-id test@prompt group_vars/test.vault  # set secrets
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

**Option 1 - Full stack** (GENIE.AI + OPEA infrastructure):
```bash
# First time: create your .env from template
cp env .env
# Edit .env with your secrets (ARANGO_PASSWORD, JWT_SECRET, etc.)

# Deploy with default settings
docker compose up -d

# Or with GPU-specific settings:
docker compose --env-file .env --env-file env.t4 up -d
docker compose --env-file .env --env-file env.rtx6000 up -d
```

**Option 2 - GENIE.AI only** (frontend, backend, arango, redis):
```bash
# From project root:
docker compose --env-file .env -f components/docker-compose.yaml up -d

# OR from components/ directory:
cd components
docker compose --env-file ../.env up -d
```

**Important notes:**
- All images must be pre-built and pushed to a registry before deploying (`docker stack deploy` cannot build)
- `depends_on` removed; services use healthchecks + Swarm restart policy for startup ordering
- Node labels control service placement (`gateway=true` for API gateway, `gpu=true` for OPEA/GPU services, `genieai=true` for GENIE.AI core services)
- Only nginx ports (80, 443) are exposed; all other services are internal
- Kong config is applied via `kong-config` one-shot Swarm service (auto-runs after deploy)
- To skip OPEA services: set `DEPLOY_OPEA=0` in `.env`
- See `env` template Section 12 for multi-node variable overrides

### Docker Commands

```bash
# Rebuild after code changes
docker compose build [service_name]

# View logs
docker compose logs -f [service_name]

# Stop all services
docker compose down
```

## Architecture

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

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `components/gov-chat-backend/` | Node.js API (auth, chat, analytics, users) |
| `components/gov-chat-frontend/` | Vue 3 web UI with Vuex state management |
| `components/document-repository/` | File upload/processing with ClamAV scanning |
| `genie-ai-overlay/chatqna/` | Main chat microservice (Python/FastAPI) |
| `genie-ai-overlay/retriever/` | Hybrid vector-graph retrieval service |
| `genie-ai-overlay/dataprep/` | Document ingestion and chunking pipeline |
| `genie-ai-overlay/reranker/` | Result reranking service |
| `genie-ai-overlay/core/` | Shared types, protocols, constants |
| `api-gateway-solution/` | Kong/NGINX configuration and scripts |
| `secrets/` | **Secrets** (SSL certificates - NOT committed) |
| `config/` | **Configuration** (LLM prompts - committed) |
| `tests/` | Integration tests for RAG pipeline |

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
- Use `dotenv` for configuration, centralized `config/appConfig.js`
- Security: `helmet`, `express-rate-limit`, proper CORS
- Logging: `winston` with daily rotation
- API docs: `swagger-jsdoc` served at `/api-docs`

### Python (OPEA Services)

- Follow PEP 8, use `black` formatter and `flake8` linter
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
- `JWT_SECRET` - JWT token signing secret
- `SESSION_SECRET` - Session encryption secret
- `POSTGRES_PASSWORD` - Kong database password (creates kong user)
- `AUTH_SERVICE_USERNAME` / `AUTH_SERVICE_PASSWORD` - Internal microservice auth
- `EMAIL_*` - SMTP configuration (required for user verification)

**Deployment-Specific:**
- `VLLM_TRANSLATION_MODEL_ID` - GPU translation model ID
- `EMBEDDING_MODEL_ID` / `RERANKER_MODEL_ID` - AI model IDs
- `CORS_ALLOWED_ORIGINS` - CORS allowed origins
- `CSP_CONNECT_SRC` - Content Security Policy connect sources
- `NGINX_PUBLIC_DOMAIN` - Public domain for Nginx
- `VUE_APP_API_URL` - Frontend API URL

**API Keys:**
- `HUGGING_FACE_HUB_TOKEN` - Required for pulling models
- `VLLM_API_KEY` - Optional, if required by your vLLM deployment

**Prompts (Cloud-Native Configuration):**

LLM prompts use a three-tier priority system:

1. **ENV VAR** (highest): Override inline in `.env`
2. **FILE** (medium): Custom files in `config/prompts/` (committed to git)
3. **DEFAULT** (lowest): Built-in prompts in code (most deployments)

**Directory Structure:**
```
config/prompts/           # LLM behavior prompts (committed to git)
├── chatqna-system.txt
└── chatqna-abstention.txt

secrets/ssl/              # SSL certificates (NOT committed)
├── server.crt
└── server.key
```

**Prompt Variables:**
- `CHATQNA_SYSTEM_PROMPT` - LLM system prompt (optional, has default in code and config)
- `CHATQNA_ABSTENTION_INSTRUCTIONS` - Abstention behavior (optional, has default in code and config)
- `LABEL_SELECTOR_SYSTEM_PROMPT` - Document labeling (has default in code, detailed version in config)

**Customizing Prompts:**

```bash
# Edit the default prompt files
nano config/prompts/chatqna-system.txt
docker compose restart chatqna-xeon-backend-server
```

**Power users:** Override inline in `.env`:
```bash
CHATQNA_SYSTEM_PROMPT="Custom prompt here..."
```

**GPU-specific files (`env.t4`, `env.rtx6000`) contain only:**
- GPU memory utilization settings
- Model length limits
- TEI image versions
- Batch processing configurations

**Variables with defaults (NOT in env):**
- All ports: `FRONTEND_PORT`, `BACKEND_PORT`, etc. (defaults in docker-compose.yaml)
- Database URLs: `ARANGO_URL`, `VLLM_ENDPOINT`, etc. (defaults in docker-compose.yaml)
- Service configurations: `LOG_LEVEL`, `NODE_ENV`, `TRANSLATION_BACKEND`, etc. (defaults in code)

## i18n System

- English (`nameEN`) is the source of truth for RAG compatibility
- Translations stored in dedicated collections (`serviceCategoryTranslations`, etc.)
- Translation keys follow pattern: `${sourceKey}_${languageCode}`

## Docker Compose Structure

### Project Docker Compose Files

| File | Scope | Contains | Use Case |
|------|-------|----------|----------|
| `docker-compose.yaml` (root) | **Full stack** | OPEA + GENIE.AI + API Gateway | Complete deployment (use `--env-file env.t4` or `env.rtx6000` for GPU) |
| `components/docker-compose.yaml` | **GENIE.AI only** | frontend, backend, arango, redis, doc-repo | Local development without OPEA |

**GPU Configuration**: Use GPU-specific env files with your .env:
```bash
docker compose --env-file .env --env-file env.t4 up -d        # NVIDIA T4 (16GB VRAM)
docker compose --env-file .env --env-file env.rtx6000 up -d   # RTX 6000 ADA (24GB VRAM)
```

### Deployment Architecture

All services are defined in the root `docker-compose.yaml` with cloud-native configuration:

```
docker-compose.yaml (root - single source of truth)
├── Layer 1: OPEA AI/ML Infrastructure
│   ├── vLLM (LLM inference)
│   ├── TEI (embeddings/reranking)
│   ├── Retriever
│   ├── Dataprep
│   └── ChatQnA
├── Layer 2: GENIE.AI Services
│   ├── Frontend (Vue 3)
│   ├── Backend (Node.js)
│   ├── ArangoDB
│   ├── Redis
│   └── Document Repository
└── Layer 3: API Gateway
    ├── Kong
    └── NGINX

components/docker-compose.yaml (development subset)
└── Layer 2 only: GENIE.AI Services (for local dev)
```

### Usage

```bash
# Full production deployment
docker compose up -d

# With GPU-specific configuration
docker compose --env-file .env --env-file env.t4 up -d

# GENIE.AI only (local development)
cd components
docker compose --env-file ../.env up -d
```

## Database Schema (ArangoDB)

- Collections: `users`, `conversations`, `messages`, `serviceCategories`, `services`, `serviceCategoryTranslations`
- Edges: `serviceCategoryTranslationsEdge`, graph relationships for knowledge graph
- Vector search enabled on chunk embeddings

## API Structure

Backend routes are organized by domain:
- `/api/auth/*` - Authentication (JWT-based)
- `/api/users/*` - User management
- `/api/chat/*` - Chat and conversation handling
- `/api/analytics/*` - Usage analytics
- `/api/admin/*` - Admin dashboard functions
- `/api/files/*` - Document upload/management
- `/api/categories/*` - Service category hierarchy
