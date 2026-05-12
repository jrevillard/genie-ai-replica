# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Changes across `main`, `vue-app-cleanup`, `backend-node-cleanup`, `document-repository-cleanup`, and `deployment-stabilization` branches since R_1_0_0.

### Added

- Quick Help dual-prompt system with UI configuration and knowledge hierarchy category mapping (`main`)
- Document translation pipeline for ingesting non-English (Spanish) PDFs into the RAG system (`main`)
- User account deactivation and reactivation routes and service methods (`main`)
- RAG abstention control via `CHATQNA_ENFORCE_ABSTENTION` and `CHATQNA_ABSTENTION_INSTRUCTIONS` parameters (`main`)
- Improved LLM prompt construction in `align_outputs` to avoid redundancy between system prompt and Chat/PromptTemplate (`main`)
- HuggingFace `hf_xet` for model downloads, label validation with fallback in dataprep, and ArangoDB schema additions (conversationFiles, crawl_job, crawl_log, crawl_metrics) (`main`)
- Mailpit service, `VUE_API_PROXY`, and `FRONTEND_URL` trailing slash fix (`main`)
- Async automated testing logic to avoid threading congestion (`main`)
- Comprehensive model selection and configuration guide (`main`)
- Conversation marker stripping in ChatQnA responses (`main`)
- Ansible deployment automation for Docker Swarm (`deployment-stabilization`)
- Kong API gateway with automatic configuration init service (`deployment-stabilization`)
- Let's Encrypt certificate management with certbot service (`deployment-stabilization`)
- NVIDIA GPU support for Swarm containers with configurable VLLM utilization and dtype (`deployment-stabilization`)
- Auto-create ArangoDB collections on fresh database (`deployment-stabilization`)
- Configurable `ARANGO_PORT`, `EMBEDDING_SERVER_ENDPOINT`, and `RETRIEVER_ARANGO_GRAPH_NAME` environment variables (`deployment-stabilization`)
- OPEA model ID variables in Ansible env template (`deployment-stabilization`)
- 5-second timeout on all external API calls in WeatherService (`deployment-stabilization`)
- Unit tests for the document-repository module (#492) (`document-repository-cleanup`)
- ESLint, Prettier, and `.editorconfig` for document-repository (`document-repository-cleanup`)
- labelRoutes in Swagger API docs generation (#494) (`document-repository-cleanup`)

### Changed

- Replaced theme utility hardcoded colors with CSS variable-based global theme system (#524, #525) (`main`)
- Merged `authService` into `userService`, eliminating ~90% code duplication (#396) (`main`)
- Replaced `exec()` calls with Node.js built-in APIs to eliminate shell injection surface (#426) (`main`)
- Converted all AQL queries to `aql` tagged template literals to prevent injection (#425) (`main`)
- Standardized authentication patterns in user-routes.js — removed manual header checks (#439) (`main`)
- Replaced fragile `error.message` string matching with typed error classes (#435) (`main`)
- Replaced `console.log` calls with structured logger throughout backend (`main`)
- Replaced `http-server` with nginx for SPA routing (`deployment-stabilization`)
- Consolidated to single Swarm-compatible `docker-compose.yaml` with dual-mode support (`deployment-stabilization`)
- Simplified LLM prompt architecture to 2-tier system (`deployment-stabilization`)
- Centralized bind mounts under `./data/` and renamed `DATA_PATH` to `DATA_DIR` (`deployment-stabilization`)
- Unified `config/` and `configs/` into single `configs/` directory (`deployment-stabilization`)
- Parameterized api-gateway-solution for cloud-native deployment (`deployment-stabilization`)
- Made nginx `Permissions-Policy` configurable per environment (`deployment-stabilization`)
- Changed translation backend default from `cpu` to `auto` (`deployment-stabilization`)
- Disabled guardrail service by default (replicas: 0) (`deployment-stabilization`)
- Reduced `MAX_FILE_SIZE` from 500 MB to 50 MB in Dockerfiles (#478) (`document-repository-cleanup`)
- Standardized on `uploaded_date` field, replaced `console.log` with logger (#484) (`document-repository-cleanup`)
- Updated E2E A40 Install Guide with corrections, new reranker parameters, and expanded instructions (`main`)

### Deprecated

- Console-based logging in production code paths — use structured logger instead (`main`)

### Removed

- Hardcoded fallback and sample data generators from backend analytics, chart components, services, and dashboard (#410) (`main`)
- 11 dead service methods from `userService.js` and `userProfileService.js` (#400) (`main`)
- Duplicate `api.js` HTTP client module (#393) (`main`)
- Dead conversation export endpoint (#428) (`main`)
- Legacy `_key <= 10` admin bypass — now role-based only (#429) (`main`)
- Hardcoded `JWT_SECRET` fallback in auth-service — fail fast at startup (#430) (`main`)
- Hardcoded default password in shared-lib DB connection service (#432) (`main`)
- `userService.js.backup` file (#418) (`main`)
- Debug `console.log` statements and broken `terser` `drop_console` config (#395, #399) (`main`)
- Dead test files, deferred Vitest setup (#402) (`main`)
- Unused `node-fetch` dependency from shared-lib (#445) (`main`)
- Dead `swagger.yaml` — JSDoc-driven Swagger is now the single source of truth (#483) (`document-repository-cleanup`)
- 7 unused npm packages and associated dead code (#489) (`document-repository-cleanup`)
- Unused `console` import from fileController.js (#490) (`document-repository-cleanup`)
- `application/octet-stream` MIME bypass in file uploads (#470) (`document-repository-cleanup`)
- Debug RUN commands from Dockerfile-single-node (#497) (`document-repository-cleanup`)
- Dead code from frontend nginx and `PROXY_TARGET` wiring (`deployment-stabilization`)

### Fixed

- **Security:** Removed auth bypass on `/email` route — no-token authentication vulnerability (#422) (`main`)
- **Security:** Added admin authorization check to database operations routes (#423) (`main`)
- **Security:** Converted all AQL queries to `aql` tagged templates to prevent injection (#425) (`main`)
- **Security:** Replaced all `exec()` calls with Node.js built-in APIs (#426) (`main`)
- **Security:** Prevented path traversal in file upload and log operations (#431) (`main`)
- **Security:** Removed hardcoded `JWT_SECRET` fallback — fail fast at startup (#430) (`main`)
- **Security:** Removed hardcoded default password in DB connection service (#432) (`main`)
- **Security:** Stopped leaking internal `error.message` details in API responses (#434) (`main`)
- **Security:** Replaced credentials with placeholders in env templates (#424) (`main`)
- **Security:** Added Admin authorization to file DELETE routes (#467) (`document-repository-cleanup`)
- **Security:** Added magic-byte validation for file uploads, removed MIME type bypass (#470) (`document-repository-cleanup`)
- **Security:** Sanitized Content-Disposition headers against CRLF injection (#471) (`document-repository-cleanup`)
- **Security:** Added fileIds array size validation on batch endpoints (#472) (`document-repository-cleanup`)
- **Security:** Added path traversal guard in `_getFileAndPath` (#477) (`document-repository-cleanup`)
- Fixed mobile timestamps sent as local time — use UTC for analytics heatmap (`main`)
- Fixed `nameEN` on category/service documents when creating or updating translations (#531, #532) (`main`)
- Fixed JWT token not passed from Authorization header to `authService.logout()` (#530) (`main`)
- Fixed duplicate logout call from NavBarComponent (#527) (`main`)
- Fixed database stats API URL to `/admin/database/stats` (#528) (`main`)
- Fixed admin toast when Quick Help labels don't match knowledge hierarchy (#529) (`main`)
- Fixed conversation double-save bug (`main`)
- Fixed PDF export of markdown conversations (`main`)
- Fixed missing routes and mobile registration screen (`main`)
- Fixed `ARANGO_DB_NAME` not passed to document-repository and backend services (`main`)
- Fixed ESLint, Prettier, husky, and lint-staged tooling for Vue app and backend (#412, #449) (`main`)
- Fixed `uploaded_date` field standardization across file operations (#484) (`document-repository-cleanup`)
- Fixed `searchFiles` AQL query and wired it to `/search/files` route (#476) (`document-repository-cleanup`)
- Fixed invalid AQL in `getFileStats` method (#498) (`document-repository-cleanup`)
- Fixed ClamAV init conditional — added braces, skip scan when disabled (#474) (`document-repository-cleanup`)
- Fixed unhandled rejection and uncaught exception handling (#479) (`document-repository-cleanup`)
- Fixed `throw err.message` to `throw err` in `labelService.createLabel` (#475) (`document-repository-cleanup`)
- Fixed healthcheck log pollution — replaced TCP probes with HTTP `/health` checks (`deployment-stabilization`)
- Fixed ArangoDB port external access — use mode host (`deployment-stabilization`)
- Fixed healthcheck IP Blocked warning — skip `/api/health` in security middleware (`deployment-stabilization`)
- Fixed nginx key validation (pkey vs rsa) and cert reload flow (`deployment-stabilization`)
- Fixed certbot entrypoint — use POSIX sh (bash not in certbot image) (`deployment-stabilization`)
- Fixed `depends_on` format and stripped blocks for Swarm compatibility (`deployment-stabilization`)
- Fixed Kong restore script — process all services and fix curl stdin bug (`deployment-stabilization`)
- Fixed Kong files-route and labels-route — add prefix path matching (`deployment-stabilization`)
- Fixed `RETRIVER` typo in docker-compose retriever env var references (`deployment-stabilization`)
- Fixed retriever port — 7000 (code default) not 7025 (`deployment-stabilization`)
- Fixed embedding response format — handle OpenAI-compatible JSON (`deployment-stabilization`)
- Fixed embedding endpoint mismatch — make `EMBEDDING_SERVER_ENDPOINT` configurable (`deployment-stabilization`)
- Fixed `ARANGO_DB` not passed to dataprep and retriever services (`deployment-stabilization`)
- Fixed CSP values quoting in Ansible `.env` to survive docker compose config (`deployment-stabilization`)
- Fixed resolved docker-compose generation for Swarm variable substitution (`deployment-stabilization`)
- Fixed healthcheck ports and env file load order (`deployment-stabilization`)
- Fixed translation service healthcheck port from 9030 to 8888 (`deployment-stabilization`)
- Fixed ARANGO credentials not passed to OPEA retriever and dataprep services (`deployment-stabilization`)
- Fixed Docker DNS resolver for lazy upstream hostname resolution in nginx (`deployment-stabilization`)
- Fixed Ansible deployment playbook and prompt env rendering (`deployment-stabilization`)
- Fixed service health verification with retry logic (`deployment-stabilization`)
- Fixed `uploaded_date` field standardization across file operations (#484) (`document-repository-cleanup`)
- Fixed stale comment in `mimeTypeValidator.js` (#485) (`document-repository-cleanup`)
- Fixed 404 handler — replaced console.log route dump with structured logger (#473) (`document-repository-cleanup`)
- Fixed Spanish responses in single-message mode when English is selected — include language in payload and handle string-type messages in ChatQnA (#579) (`sprint-21-bug-fixes`)
- Fixed wrong i18n key in SatisfactionHeatmap and removed restrictive locale enum (#580) (`sprint-21-bug-fixes`)

### Changed

- Translation pipeline now supports both `google/gemma-3-*` (generic LLM translation) and `google/translategemma-4b-it` (purpose-built translation with Sesotho support) — model auto-detected from `VLLM_TRANSLATION_MODEL_ID` env var, no code changes needed to switch (#581) (`sprint-21-bug-fixes`)
- ChatQnA translation now calls vLLM directly (bypassing OPEA translation proxy) when `VLLM_TRANSLATION_ENDPOINT` is set (#581) (`sprint-21-bug-fixes`)
- Pinned `vllm-translation-guardrail` to v0.10.0 — the only version that loads TranslateGemma-4b-it correctly (#581) (`sprint-21-bug-fixes`)
- TranslateGemma uses `/v1/completions` API with manually applied chat template to bypass vLLM v0.10.0 bug that normalizes structured content before Jinja2 rendering (#581) (`sprint-21-bug-fixes`)

---

## [R_1_0_0] - 2026-03-16

Initial release for El Salvador agricultural AI assistant deployment.

[R_1_0_0]: https://opensource.unicc.org/un/itu/genie-ai/-/tags/R_1_0_0
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/R_1_0_0...main
