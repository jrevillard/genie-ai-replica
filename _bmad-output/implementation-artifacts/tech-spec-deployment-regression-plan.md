---
title: 'Deployment & Functional Regression Plan'
slug: 'deployment-regression-plan'
created: '2026-03-27'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - Docker / Docker Compose
  - NGINX (reverse proxy, SSL termination, envsubst template rendering)
  - Kong (API gateway, DB-backed with PostgreSQL)
  - Node.js 22 / Express (backend)
  - Vue 3 (frontend)
  - ArangoDB 3.12+
  - Redis
  - OPEA microservices (vLLM, TEI, ChatQnA, Retriever, Dataprep, Reranker)
  - ClamAV
files_to_modify:
  - GENIE.AI-Installation-Configuration-Guide.md
  - docker-compose.yaml
  - env
  - api-gateway-solution/nginx/conf/default.conf.template
  - api-gateway-solution/nginx/entrypoint.sh
  - api-gateway-solution/new-config/kong_config.json
  - api-gateway-solution/new-config/restore-kong-config.sh
  - api-gateway-solution/new-config/manage-kong-config.sh
  - config/prompts/chatqna-system.txt
  - config/prompts/chatqna-abstention.txt
  - config/prompts/label-selector.txt
  - secrets/README.md
  - components/gov-chat-backend/routes/user-routes.js
  - components/gov-chat-frontend/src/components/ChatBotComponent.vue
  - components/document-repository/src/server.js
code_patterns:
  - envsubst for nginx template rendering (container-side via entrypoint.sh)
  - Docker secrets for SSL certificates (production) / self-signed certs (development)
  - Environment variables with ${VAR:-default} pattern in docker-compose.yaml
  - Kong Admin API via curl + jq for runtime configuration
  - Single .env file at project root for all configuration
  - GPU-specific env overrides (env.t4, env.rtx6000)
  - 3-tier LLM prompt priority: ENV VAR > FILE (config/prompts/) > DEFAULT (in code)
  - 20+ services in root docker-compose with health check dependencies
  - JWT-based auth with access + refresh tokens, email verification flow
  - Chat RAG via /api/queries with category filtering and document context
  - Document upload with ClamAV scanning, then async ingestion via OPEA dataprep
test_patterns: []
---

# Tech-Spec: Deployment & Functional Regression Plan

**Created:** 2026-03-27

## Overview

### Problem Statement

The `deployment-stabilization` branch restructures the entire deployment infrastructure: deletion of 48 obsolete files (redundant docker-compose files, single-node Dockerfiles, per-service env files, old Kong backups and scripts), centralization of configuration into a single `env` file with GPU overrides, and refactoring of the API gateway (nginx template + entrypoint). This massive cleanup requires a comprehensive regression plan to validate that (1) the full-stack deployment works correctly, (2) the installation guide accurately reflects the new reality, and (3) all functional use cases still work end-to-end.

### Solution

A manual validation checklist structured in 2 sequential phases:

**Phase 1 — Guided Deployment + Guide Audit:** Follow the installation guide step-by-step in real conditions. Each guide instruction is verified against the actual files and configuration. Any discrepancy between the guide and reality is documented as a finding. Environment variable propagation is verified per container. The deployment must succeed by strictly following the guide — if it doesn't, the guide (or the deployment) has a defect.

**Phase 2 — Functional Use Cases:** Once the stack is running, exhaustively test the full user journey: registration, login, chat RAG, admin dashboard, document upload/ingestion, knowledge hierarchy management, translation generation. Each use case is a potential break point.

### Scope

**In Scope:**
- Full-stack deployment validation (`docker compose up -d` from root)
- Per-service health checks (frontend, backend, arango, redis, doc-repo, OPEA AI/ML services, nginx, kong)
- Installation guide audit: `GENIE.AI-Installation-Configuration-Guide.md` vs actual code/config state
- Critical configuration points: env variables, ports, GPU overrides, SSL certificates, CSP/CORS
- Exhaustive functional use cases: registration, login, chat RAG, admin dashboard, document upload/ingestion, knowledge hierarchy management, translation generation
- Infrastructure edge cases: nginx template rendering, Kong route configuration, SSL termination

**Out of Scope:**
- Automated test creation
- Mobile application (Flutter)
- Code-level changes (minimal impact confirmed)

## Context for Development

### Codebase Patterns

- Single `.env` file at project root replaces all per-service env files
- GPU-specific overrides via `env.t4` and `env.rtx6000` (loaded with `--env-file`)
- NGINX uses `envsubst` template rendering via container-side `entrypoint.sh`
- Kong configuration managed through `kong_config.json` + `restore-kong-config.sh`
- LLM prompts follow 3-tier priority: ENV VAR > FILE (`config/prompts/`) > DEFAULT (code)
- SSL certs stored in `secrets/ssl/` (gitignored), README contains generation instructions
- `docker-compose.yaml` at root is the single source of truth for full-stack deployment
- `components/docker-compose.yaml` is the dev subset (GENIE.AI only, no OPEA)

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `docker-compose.yaml` | Full-stack deployment (single source of truth) |
| `components/docker-compose.yaml` | GENIE.AI only dev deployment |
| `env` | Centralized configuration template |
| `env.t4` | NVIDIA T4 GPU overrides |
| `env.rtx6000` | RTX 6000 ADA GPU overrides |
| `GENIE.AI-Installation-Configuration-Guide.md` | Installation guide to audit |
| `api-gateway-solution/nginx/conf/default.conf.template` | NGINX template |
| `api-gateway-solution/nginx/entrypoint.sh` | NGINX container entrypoint |
| `api-gateway-solution/new-config/kong_config.json` | Kong API configuration |
| `config/prompts/chatqna-system.txt` | LLM system prompt |
| `config/prompts/chatqna-abstention.txt` | LLM abstention instructions |
| `config/prompts/label-selector.txt` | Document labeling prompt |
| `secrets/README.md` | SSL certificate generation instructions |
| `CLAUDE.md` | Project architecture and conventions reference |

### Technical Decisions

- Manual checklist approach chosen over automated tests (project has 0 existing tests)
- Full-stack scope includes OPEA AI/ML services (not just GENIE.AI components)
- Guide audit focuses on sections that reference deleted/restructured files (Steps 3, 4, 6)
- Guide validation performed in real deployment conditions (not just reading), so discrepancies surface immediately as broken instructions
- Phase 1 (deployment + guide audit) and Phase 2 (functional) are sequential — functional testing requires a running stack

## Investigation Results

### Service Inventory (20+ services)

**Infrastructure layer:**
- `kong-database` (PostgreSQL, internal 5432) — no deps
- `kong-migrations` — depends on kong-database
- `kong` (ports 8010, 8443) — depends on kong-database, kong-migrations
- `nginx` (ports 80, 443) — depends on kong

**GENIE.AI services:**
- `frontend` (port 8090) — depends on backend
- `backend` (port 3000) — depends on arango-vector-db, redis-cache
- `document-repository` (port 3001) — depends on clamav, arango-vector-db
- `arango-vector-db` (port 8529) — no deps
- `redis-cache` (internal 6379) — no deps
- `clamav` (port 3310) — no deps

**OPEA AI/ML layer (GPU required):**
- `vllm` (port 8000) — no deps, GPU-intensive
- `vllm-translation-guardrail` (port 9031) — depends on vllm
- `tei` (port 7000) — depends on vllm-translation-guardrail
- `tei_reranker` (port 7100) — depends on vllm-translation-guardrail
- `embedding` (port 6000) — depends on tei
- `reranker` (port 6100) — depends on tei_reranker
- `textgen` (port 9000) — depends on vllm
- `translation` (port 9030) — depends on vllm-translation-guardrail
- `guardrail` (port 9090) — depends on vllm-translation-guardrail
- `dataprep-arango-service` (port 6007) — depends on arango-vector-db, embedding, vllm, guardrail
- `retriever-arango-service` (port 7025) — depends on arango-vector-db, embedding

**Other:**
- `http-service` (internal, no exposed port) — depends on backend
- `chatqna-xeon-ui-server` (port 5173) — depends on chatqna backend
- `chatqna-xeon-nginx-server` (port 80) — depends on chatqna backend + UI

### Required Secrets (no defaults in code)

| Variable | Used By |
|---------|---------|
| `ARANGO_PASSWORD` | backend, document-repository, dataprep, retriever |
| `JWT_SECRET` | backend, document-repository |
| `SESSION_SECRET` | backend |
| `TRANSLATION_CACHE_PASSWORD` | redis-cache, translation |
| `POSTGRES_PASSWORD` | kong-database, kong |
| `AUTH_SERVICE_USERNAME` | http-service |
| `AUTH_SERVICE_PASSWORD` | http-service |
| `EMAIL_HOST/PORT/SECURE/USER/PASSWORD/FROM` | backend |
| `HUGGING_FACE_HUB_TOKEN` | vllm, vllm-translation, tei, tei_reranker |

### Guide Audit Findings

**References to deleted files (must fix):**
- Lines ~218-241: Directory structure lists `components/docker-compose.yaml` as "three-node", references per-service env files (`components/gov-chat-backend/env`, etc.), references `api-gateway-solution/docker-compose.yaml` — all deleted or restructured
- Line ~269: References `env-T4` — deleted, replaced by `env.t4`
- Missing instructions for `env.rtx6000` usage
- Missing documentation for `secrets/` directory and SSL cert generation workflow
- Missing documentation for `config/prompts/` directory (chatqna-system.txt, chatqna-abstention.txt, label-selector.txt)
- Missing explanation of new nginx template-based configuration system

**Correct references (no changes needed):**
- Step 4 Kong config references (`new-config/`, `manage-kong-config.sh`) — correct
- SSL/TLS section references `secrets/ssl/` — correct
- Mobile app section — no issues
- Step 4 nginx section references `default.conf.template` — correct

### Functional Smoke Test Scope

Since the branch only touches infrastructure, Phase 2 is a lightweight smoke test — just verify the core user journeys still work end-to-end through the GUI. No exhaustive feature testing.

**Critical paths to verify:**
1. Login → Chat RAG query (core value proposition)
2. Document upload → Ingestion → RAG query on ingested content
3. Double-save conversation bug (fix on this branch)

### Key Risks

- The guide was partially updated (Kong, SSL, nginx sections correct) but initial deployment and env config sections were stale — **now fixed**
- GPU model loading is the longest and most failure-prone step — allocate 15+ minutes
- Email verification requires SMTP configuration — if not available, auth testing is limited
- The guide may still contain stale port references for OPEA internal services (DATAPREP_SERVICE_PORT, RERANK_SERVER_PORT) — not critical for deployment but could confuse advanced users

## Implementation Plan

### Phase 1: Guided Deployment + Installation Guide Audit

#### 1.1 Prerequisites & Environment Setup

- [ ] **Task 1.1.1:** Verify Step 2 of the guide (Prerequisites) — Docker, Node.js, git are installed and versions match
  - File: `GENIE.AI-Installation-Configuration-Guide.md` (lines ~116-210)
  - Action: Follow Step 2 instructions. Verify each command works.
  - Severity: CRITICAL
  - PASS/FAIL: _____

- [ ] **Task 1.1.2:** Verify `env` file template is complete and documented
  - File: `env`
  - Action: Open `env`, verify all required secrets listed in Investigation Results are present with clear comments. Compare against the guide's Step 3 "Environment Configuration" section.
  - Severity: CRITICAL
  - PASS/FAIL: PASS (verified — 12 secrets present, guide references align)

- [ ] **Task 1.1.3:** Verify GPU override files are documented in the guide
  - Files: `env.t4`, `env.rtx6000`
  - Action: Check that the guide explains (a) the existence of these files, (b) how to use them with `--env-file`, (c) which GPU each targets. Verify the old `env-T4` reference is removed.
  - Severity: CRITICAL
  - PASS/FAIL: PASS (verified — both files documented with --env-file commands, env-T4 reference removed)

- [ ] **Task 1.1.4:** Verify `secrets/` directory is documented
  - Files: `secrets/README.md`, `secrets/.gitignore`
  - Action: Check that the guide explains (a) SSL cert generation or self-signed auto-generation, (b) `secrets/ssl/` path, (c) that secrets are gitignored.
  - Severity: HIGH
  - PASS/FAIL: PASS (verified — secrets/ssl/ path, gitignore, auto-generation mentioned)

- [ ] **Task 1.1.5:** Verify `config/prompts/` directory is documented
  - Files: `config/prompts/chatqna-system.txt`, `chatqna-abstention.txt`, `label-selector.txt`
  - Action: Check that the guide explains the 3-tier prompt priority (ENV VAR > FILE > DEFAULT) and the purpose of each prompt file.
  - Severity: MEDIUM
  - PASS/FAIL: PASS (verified — guide now includes "Customizing LLM Prompts" section with 3-tier explanation and file table)

#### 1.2 Guide Directory Structure Audit

- [ ] **Task 1.2.1:** Verify Step 3 directory structure matches reality
  - File: `GENIE.AI-Installation-Configuration-Guide.md` (lines ~218-241)
  - Action: Read the directory structure described in the guide. Verify each file/directory listed actually exists. Flag any reference to deleted files (per-service env, single-node Dockerfiles, old docker-compose files, old-config/).
  - Known stale references: `components/gov-chat-backend/env`, `components/gov-chat-frontend/env`, `components/document-repository/env`, `api-gateway-solution/docker-compose.yaml`, `api-gateway-solution/env`, `docker-compose-RTX6000-ADA.yaml`, `docker-compose-t4.yaml`, `env-T4`
  - Severity: HIGH
  - PASS/FAIL: PASS (verified — 19/19 files checked, all match, no stale references)

- [ ] **Task 1.2.2:** Verify deployment commands in the guide match the new approach
  - File: `GENIE.AI-Installation-Configuration-Guide.md` (lines ~764-890)
  - Action: Verify the guide shows `docker compose up -d --build` (default) and `docker compose --env-file .env --env-file env.t4 up -d --build` (GPU T4) and `docker compose --env-file .env --env-file env.rtx6000 up -d --build` (GPU RTX6000). Ensure no reference to separate docker-compose files per GPU.
  - Severity: CRITICAL
  - PASS/FAIL: PASS (verified — 3 commands correct, no stale references)

- [ ] **Task 1.2.3:** Verify single-node vs multi-node references are consistent
  - File: `GENIE.AI-Installation-Configuration-Guide.md` (throughout)
  - Action: Search for "three-node", "multi-node", "single-node" references. If multi-node architecture is mentioned, verify it's clear that the current deployment is single-node only.
  - Severity: HIGH
  - PASS/FAIL: PASS (verified — no stale "3-node" or "multi-node" references found)

#### 1.3 Deployment Execution (Following the Guide)

- [ ] **Task 1.3.1:** Clone repository and checkout `deployment-stabilization` branch
  - Action: Follow Step 3.1 of the guide to clone and switch branch.
  - Severity: CRITICAL
  - PASS/FAIL: _____

- [ ] **Task 1.3.2:** Create `.env` from template and fill secrets
  - File: `env` → `.env`
  - Action: Follow Step 3.2 of the guide. `cp env .env`, then fill in all required secrets. Verify every required variable from the secrets table has a value.
  - Severity: CRITICAL
  - PASS/FAIL: _____

- [ ] **Task 1.3.3:** Launch full stack with `docker compose up -d --build`
  - Action: Follow the guide's launch command for your GPU type (Option A or B). Wait for all services to start. Note any immediate failures.
  - Severity: CRITICAL
  - PASS/FAIL: _____

- [ ] **Task 1.3.4:** Verify all infrastructure services are healthy
  - Services: `kong-database`, `kong-migrations`, `kong`, `nginx`, `http-service`
  - Action: Run `docker compose ps`. Verify all 5 services show "healthy" or "running". Check logs for errors: `docker compose logs kong`, `docker compose logs nginx`.
  - Severity: CRITICAL
  - PASS/FAIL: _____

- [ ] **Task 1.3.5:** Verify all GENIE.AI services are healthy
  - Services: `arango-vector-db`, `redis-cache`, `clamav`, `backend`, `frontend`, `document-repository`
  - Action: Run `docker compose ps`. Verify all 6 services show "healthy" or "running". Check `docker compose logs backend` and `docker compose logs frontend` for startup errors.
  - Severity: CRITICAL
  - PASS/FAIL: _____

- [ ] **Task 1.3.6:** Verify all OPEA AI/ML services are healthy (GPU-dependent)
  - Services: `vllm`, `vllm-translation-guardrail`, `tei`, `tei_reranker`, `embedding`, `reranker`, `textgen`, `translation`, `guardrail`, `dataprep-arango-service`, `retriever-arango-service`, `chatqna-xeon-ui-server`, `chatqna-xeon-nginx-server`
  - Action: Run `docker compose ps`. Verify all 13 services are running. **Wait for all 5 models to fully load** (this can take 5-15 min). Check `docker compose logs vllm` for model loading confirmation. Check `docker compose logs tei` for embedding/reranker model readiness.
  - Severity: CRITICAL
  - PASS/FAIL: _____

- [ ] **Task 1.3.7:** Verify environment variable propagation per container
  - Action: For each critical service, exec into the container and verify env vars are set:
    - `backend`: `ARANGO_URL`, `ARANGO_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`, `OPEA_HOST`
    - `frontend`: `VUE_APP_API_URL`
    - `nginx`: `NGINX_PUBLIC_DOMAIN`, `CSP_CONNECT_SRC`, `KONG_PROXY_HOST`
    - `document-repository`: `ARANGO_URL`, `ARANGO_PASSWORD`, `JWT_SECRET`
    - `redis-cache`: `TRANSLATION_CACHE_PASSWORD`
  - Severity: HIGH
  - PASS/FAIL: _____

#### 1.4 API Gateway Verification

- [ ] **Task 1.4.1:** Verify NGINX SSL and template rendering
  - Files: `api-gateway-solution/nginx/conf/default.conf.template`, `api-gateway-solution/nginx/entrypoint.sh`
  - Action: Verify that (a) self-signed certs were auto-generated in dev mode, (b) HTTPS works on port 443, (c) `default.conf` was rendered from template with correct env var substitution (check: `docker compose exec nginx cat /etc/nginx/conf.d/default.conf`).
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 1.4.2:** Verify Kong routes are configured correctly
  - File: `api-gateway-solution/new-config/kong_config.json`
  - Action: Follow Step 4.2 of the guide to configure Kong. After configuration, verify all routes are active: `curl -s http://localhost:8010/api/auth/login` should return a Kong response (not connection refused). Verify `document-repository` service points to port 3001 (not 3000).
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 1.4.3:** Verify frontend is accessible through NGINX
  - Action: Open browser to `http://localhost` (or `https://localhost`). Verify the Vue.js frontend loads. Verify API calls are proxied through Kong (check browser dev tools → Network tab, API calls should go to `/api/` and return responses).
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 1.4.4:** Verify CSP and CORS headers
  - Action: Check response headers in browser dev tools. Verify `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` are present. Verify CORS allows the configured origins.
  - Severity: MEDIUM
  - PASS/FAIL: _____

#### 1.5 Database & Infrastructure Initialization

- [ ] **Task 1.5.1:** Verify Step 4.1 — ArangoDB initialization
  - Action: Follow Step 4.1 of the guide to initialize the database. Verify collections are created (users, conversations, messages, serviceCategories, services, etc.).
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 1.5.2:** Verify ArangoDB web UI is accessible
  - Action: Open `http://localhost:8529/_admin`. Login with root credentials. Verify database `genie-ai` exists and collections are populated.
  - Severity: MEDIUM
  - PASS/FAIL: _____

- [ ] **Task 1.5.3:** Verify dev subset still works (optional)
  - File: `components/docker-compose.yaml`
  - Action: Run `docker compose -f components/docker-compose.yaml --env-file .env up -d`. Verify GENIE.AI services (frontend, backend, arango, redis, doc-repo) start. Then `docker compose -f components/docker-compose.yaml down` to clean up before full-stack testing.
  - Severity: MEDIUM
  - PASS/FAIL: _____

### Phase 2: Functional Smoke Test

Since this branch only modifies infrastructure, the functional phase is a lightweight smoke test — verify the core user journeys still work end-to-end through the GUI.

#### 2.1 Authentication & Access

- [ ] **Task 2.1.1:** Register and verify a new user
  - Action: Register a new user via the UI. Verify email is sent (check logs). Extract the verification token from logs, confirm the email. Then login with the new user.
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 2.1.2:** Login with existing user (if upgrading)
  - Action: If upgrading from an existing deployment, login with the test account (jrevillard / Test1234!). Verify the user reaches the main chat interface. Skip on fresh deployment.
  - Severity: HIGH
  - PASS/FAIL: _____ (N/A on fresh deploy)

#### 2.2 Knowledge Hierarchy — Pre-requisite for Chat RAG

- [ ] **Task 2.2.1:** Admin — create category and services
  - Action: Via the admin UI, create a new category and add services under it. Verify they appear in the chat sidebar.
  - Severity: HIGH
  - PASS/FAIL: _____

#### 2.3 Document Upload & Ingestion — Pre-requisite for RAG Query

- [ ] **Task 2.3.1:** Upload and ingest a document
  - Action: Upload a PDF through the document management UI. Verify (a) upload succeeds, (b) ClamAV scan passes, (c) trigger ingestion, (d) ingestion completes.
  - Severity: HIGH
  - PASS/FAIL: _____

#### 2.4 Chat RAG — Core Flow

- [ ] **Task 2.4.1:** Send a chat query and get a RAG response
  - Action: From the chat interface, type a query. Verify (a) the query is sent, (b) an AI response is received within a reasonable time, (c) the response is relevant.
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 2.4.2:** Query with category filter
  - Action: Select the category created in 2.2.1, then send a query. Verify the response is scoped to that category.
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 2.4.3:** RAG query on ingested content
  - Action: Ask a query specifically related to the uploaded document content. Verify the response references the ingested document with source attribution.
  - Severity: HIGH
  - PASS/FAIL: _____

- [ ] **Task 2.4.4:** Conversation history — no double-save
  - Action: Have a multi-turn conversation (3+ messages). Verify (a) history is maintained across turns, (b) each message appears exactly once (no duplicates). **This is a known bug fix on this branch.**
  - Severity: HIGH
  - PASS/FAIL: _____

#### 2.5 Navigation & UI

- [ ] **Task 2.5.1:** Verify all main UI sections load
  - Action: Navigate through the main sections: Chat, Documents, Admin Dashboard. Verify each loads without errors.
  - Severity: MEDIUM
  - PASS/FAIL: _____

## Acceptance Criteria

- [ ] **AC 1:** Given a fresh server, when following the installation guide step-by-step, then the full stack deploys successfully with all services healthy.
- [ ] **AC 2:** Given the stack is running, when accessing the frontend through NGINX, then the UI loads correctly with all API calls proxied through Kong.
- [ ] **AC 3:** Given a registered user, when logging in and sending a chat query, then a relevant RAG response is received.
- [ ] **AC 4:** Given ingested documents, when sending a related query, then the response includes source attribution.
- [ ] **AC 5:** Given the installation guide, when comparing every file/command reference against the actual codebase, then no reference points to a deleted or non-existent file.
- [ ] **AC 6:** Given a conversation with multiple messages, then each message is stored exactly once (no double-save regression).

## Additional Context

### Dependencies

- GPU hardware (NVIDIA T4 16GB or RTX 6000 ADA 24GB) required for full-stack deployment
- SMTP server access for email verification testing
- Hugging Face Hub token for pulling AI models
- Sufficient disk space (~50GB) for Docker images and model weights
- Internet access for model downloading on first deployment

### Testing Strategy

- Manual checklist execution on a fresh server
- Guide followed literally — any deviation documented as a finding
- Each checklist item marked PASS/FAIL with notes
- Severity classification for each item to prioritize post-MR fixes
- CRITICAL/HIGH items must all PASS before MR can be approved

### Notes

**High-risk items requiring extra attention:**
1. GPU model loading is the longest and most failure-prone step — allocate 15+ minutes
2. Email verification requires SMTP configuration — if not available, auth testing is limited
3. The installation guide's env section may document variables that no longer exist in the current `env` template — verify alignment
4. The installation guide's Step 3 has the most stale references — this section needs the most careful review

**Known limitations:**
- Mobile app (Flutter) is out of scope for this regression plan
- No automated tests exist in the project — all validation is manual
- GPU-specific testing can only be done on matching hardware
