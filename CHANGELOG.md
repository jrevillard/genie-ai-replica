# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-28

### Added

- Quick Help dual-prompt system with UI configuration and knowledge hierarchy category mapping
- Document translation pipeline for ingesting non-English (Spanish) PDFs into the RAG system
- User account deactivation and reactivation routes and service methods
- RAG abstention control via `CHATQNA_ENFORCE_ABSTENTION` and `CHATQNA_ABSTENTION_INSTRUCTIONS` parameters
- Improved LLM prompt construction in `align_outputs` to avoid redundancy between system prompt and Chat/PromptTemplate
- HuggingFace `hf_xet` for model downloads, label validation with fallback in dataprep, and ArangoDB schema additions (conversationFiles, crawl_job, crawl_log, crawl_metrics)
- Mailpit service, `VUE_API_PROXY`, and `FRONTEND_URL` trailing slash fix
- Async automated testing logic to avoid threading congestion
- Comprehensive model selection and configuration guide
- Conversation marker stripping in ChatQnA responses
- Ansible deployment automation for Docker Swarm
- Kong API gateway with automatic configuration init service
- Let's Encrypt certificate management with certbot service
- NVIDIA GPU support for Swarm containers with configurable VLLM utilization and dtype
- Auto-create ArangoDB collections on fresh database
- Configurable `ARANGO_PORT`, `EMBEDDING_SERVER_ENDPOINT`, and `RETRIEVER_ARANGO_GRAPH_NAME` environment variables
- OPEA model ID variables in Ansible env template
- 5-second timeout on all external API calls in WeatherService
- Unit tests for the document-repository module (#492)
- ESLint, Prettier, and `.editorconfig` for document-repository
- labelRoutes in Swagger API docs generation (#494)
- Release process guide (`docs/RELEASE.md`) and agent instructions (`.claude/rules/RELEASE.md`)
- Docker image build, scan, and promote pipeline with pre-release support
- Docker tag summary and CI changelog validation (`config:changelog`, `release:create` jobs)

### Changed

- Replaced theme utility hardcoded colors with CSS variable-based global theme system (#524, #525)
- Merged `authService` into `userService`, eliminating ~90% code duplication (#396)
- Replaced `exec()` calls with Node.js built-in APIs to eliminate shell injection surface (#426)
- Converted all AQL queries to `aql` tagged template literals to prevent injection (#425)
- Standardized authentication patterns in user-routes.js — removed manual header checks (#439)
- Replaced fragile `error.message` string matching with typed error classes (#435)
- Replaced `console.log` calls with structured logger throughout backend
- Replaced `http-server` with nginx for SPA routing
- Consolidated to single Swarm-compatible `docker-compose.yaml` with dual-mode support
- Simplified LLM prompt architecture to 2-tier system
- Centralized bind mounts under `./data/` and renamed `DATA_PATH` to `DATA_DIR`
- Unified `config/` and `configs/` into single `configs/` directory
- Parameterized api-gateway-solution for cloud-native deployment
- Made nginx `Permissions-Policy` configurable per environment
- Changed translation backend default from `cpu` to `auto`
- Disabled guardrail service by default (replicas: 0)
- Reduced `MAX_FILE_SIZE` from 500 MB to 50 MB in Dockerfiles (#478)
- Standardized on `uploaded_date` field, replaced `console.log` with logger (#484)
- Updated E2E A40 Install Guide with corrections, new reranker parameters, and expanded instructions
- Translation pipeline supports both generic LLM and purpose-built translation models — auto-detected from `VLLM_TRANSLATION_MODEL_ID`
- ChatQnA translation calls vLLM directly (bypassing OPEA translation proxy) when `VLLM_TRANSLATION_ENDPOINT` is set (#581)
- Branching model: one `release/X.Y` branch per MAJOR/MINOR series, cherry-pick PATCH from `main`
- Changelog format updated to Keep a Changelog 2.0.0

### Deprecated

- Console-based logging in production code paths — use structured logger instead

### Removed

- Hardcoded fallback and sample data generators from backend analytics, chart components, services, and dashboard (#410)
- 11 dead service methods from `userService.js` and `userProfileService.js` (#400)
- Duplicate `api.js` HTTP client module (#393)
- Dead conversation export endpoint (#428)
- Legacy `_key <= 10` admin bypass — now role-based only (#429)
- Hardcoded `JWT_SECRET` fallback in auth-service — fail fast at startup (#430)
- Hardcoded default password in shared-lib DB connection service (#432)
- `userService.js.backup` file (#418)
- Debug `console.log` statements and broken `terser` `drop_console` config (#395, #399)
- Dead test files, deferred Vitest setup (#402)
- Unused `node-fetch` dependency from shared-lib (#445)
- Dead `swagger.yaml` — JSDoc-driven Swagger is now the single source of truth (#483)
- 7 unused npm packages and associated dead code (#489)
- Unused `console` import from fileController.js (#490)
- `application/octet-stream` MIME bypass in file uploads (#470)
- Debug RUN commands from Dockerfile-single-node (#497)
- Dead code from frontend nginx and `PROXY_TARGET` wiring

### Fixed

- **Security:** Removed auth bypass on `/email` route — no-token authentication vulnerability (#422)
- **Security:** Added admin authorization check to database operations routes (#423)
- **Security:** Converted all AQL queries to `aql` tagged templates to prevent injection (#425)
- **Security:** Replaced all `exec()` calls with Node.js built-in APIs (#426)
- **Security:** Prevented path traversal in file upload and log operations (#431)
- **Security:** Removed hardcoded `JWT_SECRET` fallback — fail fast at startup (#430)
- **Security:** Removed hardcoded default password in DB connection service (#432)
- **Security:** Stopped leaking internal `error.message` details in API responses (#434)
- **Security:** Replaced credentials with placeholders in env templates (#424)
- **Security:** Added Admin authorization to file DELETE routes (#467)
- **Security:** Added magic-byte validation for file uploads, removed MIME type bypass (#470)
- **Security:** Sanitized Content-Disposition headers against CRLF injection (#471)
- **Security:** Added fileIds array size validation on batch endpoints (#472)
- **Security:** Added path traversal guard in `_getFileAndPath` (#477)
- Fixed mobile timestamps sent as local time — use UTC for analytics heatmap
- Fixed `nameEN` on category/service documents when creating or updating translations (#531, #532)
- Fixed JWT token not passed from Authorization header to `authService.logout()` (#530)
- Fixed duplicate logout call from NavBarComponent (#527)
- Fixed database stats API URL to `/admin/database/stats` (#528)
- Fixed admin toast when Quick Help labels don't match knowledge hierarchy (#529)
- Fixed conversation double-save bug
- Fixed PDF export of markdown conversations
- Fixed missing routes and mobile registration screen
- Fixed `ARANGO_DB_NAME` not passed to document-repository and backend services
- Fixed ESLint, Prettier, husky, and lint-staged tooling for Vue app and backend (#412, #449)
- Fixed `uploaded_date` field standardization across file operations (#484)
- Fixed `searchFiles` AQL query and wired it to `/search/files` route (#476)
- Fixed invalid AQL in `getFileStats` method (#498)
- Fixed ClamAV init conditional — added braces, skip scan when disabled (#474)
- Fixed unhandled rejection and uncaught exception handling (#479)
- Fixed `throw err.message` to `throw err` in `labelService.createLabel` (#475)
- Fixed healthcheck log pollution — replaced TCP probes with HTTP `/health` checks
- Fixed ArangoDB port external access — use mode host
- Fixed healthcheck IP Blocked warning — skip `/api/health` in security middleware
- Fixed nginx key validation (pkey vs rsa) and cert reload flow
- Fixed certbot entrypoint — use POSIX sh (bash not in certbot image)
- Fixed `depends_on` format and stripped blocks for Swarm compatibility
- Fixed Kong restore script — process all services and fix curl stdin bug
- Fixed Kong files-route and labels-route — add prefix path matching
- Fixed `RETRIVER` typo in docker-compose retriever env var references
- Fixed retriever port — 7000 (code default) not 7025
- Fixed embedding response format — handle OpenAI-compatible JSON
- Fixed embedding endpoint mismatch — make `EMBEDDING_SERVER_ENDPOINT` configurable
- Fixed `ARANGO_DB` not passed to dataprep and retriever services
- Fixed CSP values quoting in Ansible `.env` to survive docker compose config
- Fixed resolved docker-compose generation for Swarm variable substitution
- Fixed healthcheck ports and env file load order
- Fixed translation service healthcheck port from 9030 to 8888
- Fixed ARANGO credentials not passed to OPEA retriever and dataprep services
- Fixed Docker DNS resolver for lazy upstream hostname resolution in nginx
- Fixed Ansible deployment playbook and prompt env rendering
- Fixed service health verification with retry logic
- Fixed stale comment in `mimeTypeValidator.js` (#485)
- Fixed 404 handler — replaced console.log route dump with structured logger (#473)
- Fixed Spanish responses in single-message mode when English is selected — include language in payload and handle string-type messages in ChatQnA (#579)
- Fixed wrong i18n key in SatisfactionHeatmap and removed restrictive locale enum (#580)

## [Unreleased]

## [R_1_0_0] - 2026-03-16

Initial release for El Salvador agricultural AI assistant deployment.

[R_1_0_0]: https://opensource.unicc.org/un/itu/genie-ai/-/tags/R_1_0_0
[2.0.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/R_1_0_0...v2.0.0
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.0...main
