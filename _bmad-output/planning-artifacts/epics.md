---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
---

# genie-ai - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the Testing Framework initiative, decomposing the requirements from the PRD and Architecture into implementable stories. Stories are organized by user value and will be created as GitLab Epics and Issues.

## Requirements Inventory

### Functional Requirements

- FR1: The CI pipeline runs lint checks across all JavaScript, Python, and Dart components on every merge request
- FR2: The CI pipeline executes unit tests for all 5 components (backend, frontend, OPEA microservices, document-repository, mobile) on every merge request
- FR4: The CI pipeline executes configuration validation tests on every merge request
- FR5: The CI pipeline blocks merge requests when any mandatory test stage fails
- FR6: The CI pipeline produces JUnit XML test reports as artifacts for all test runners
- FR7: The CI pipeline executes integration tests on a scheduled basis against deployed infrastructure
- FR8: The CI pipeline executes RAG quality regression tests on a scheduled basis
- FR9: The test suite validates API route handlers for all route groups (auth, chat, analytics, admin, files, categories)
- FR10: The test suite verifies service layer business logic for all backend services (not limited to auth)
- FR11: The test suite validates middleware behavior (authentication, authorization, error handling, rate limiting)
- FR12: The test suite tests route handlers via HTTP requests against an in-memory Express application
- FR13: The test suite validates component rendering and user interaction for critical UI components (ChatBot, NavBar, UserProfile)
- FR14: The test suite verifies Vuex store state management for all store modules
- FR15: The test suite validates HTTP service interactions with mocked API responses
- FR16: The test suite verifies authentication state transitions and token management in the UI
- FR17: The test suite validates the retriever's hybrid search logic (vector similarity, graph traversal, label filtering) with mocked ArangoDB
- FR18: The test suite validates the dataprep extraction pipeline (multi-format parsing, chunking, labeling) with mocked dependencies
- FR19: The test suite validates the reranker's score validation and top-K constraint enforcement with mocked TEI
- FR20: The test suite validates core type definitions, protocols, and constants
- FR21: The test suite validates custom overlay interfaces that deviate from standard OPEA component interfaces
- FR22: The test suite validates file upload, download, search, and delete endpoint behavior
- FR23: The test suite verifies security middleware (ClamAV virus scanning, file type validation, authentication)
- FR24: The test suite validates metadata and label service business logic
- FR25: The test suite executes existing service-layer tests (~104 tests) within the CI pipeline
- FR26: The test suite reports Flutter test results in a CI-compatible format
- FR27: The validation suite verifies that all environment variables referenced in docker-compose are documented in the env template
- FR28: The validation suite verifies that required environment variables have no undefined defaults
- FR29: The validation suite detects conflicting or orphaned environment variable configurations
- FR30: The validation suite validates environment variable values against hardware-specific parameter ranges (GPU profiles)
- FR31: The validation suite verifies feature flag interdependencies (e.g., DEPLOY_OPEA affecting expected service topology)
- FR32: The quality suite executes predefined queries against a known document corpus and measures retrieval accuracy
- FR33: The quality suite computes RAGAS metrics (faithfulness, answer relevance, context precision, context recall) for RAG pipeline outputs
- FR34: The quality suite compares RAGAS scores against configurable thresholds and reports pass/fail
- FR35: The quality suite validates RAG pipeline stage integrity (embedding dimensions, reranker top-K, retriever score thresholds)
- FR36: The framework provides version-controlled test fixtures (mocks, stubs, factory data) for each component
- FR37: The framework provides test document corpora in multiple formats (.txt, .md, .pdf, .xlsx, .docx) for RAG quality testing
- FR38: The framework provides controlled ArangoDB test database states (graph structures, vector embeddings) for integration tests
- FR39: The framework provides environment-specific configuration profiles for different deployment targets and GPU hardware
- FR40: The test framework produces structured output (JSON, JUnit XML) consumable by the OpenTelemetry pipeline
- FR41: The test framework propagates OTel trace context in test fixtures for distributed trace correlation
- FR42: The test framework provides assertion helpers for validating structured JSON log output from services under test
- FR43: Test execution results are queryable via the MELT Provider API for post-test diagnostics
- FR44: Test health metrics (pass rates, execution times, flaky test detection) are visualizable in Grafana dashboards
- FR45: The framework leverages AI to generate test scaffolding (boilerplate test files, mock factories, fixture generators) from existing code
- FR46: The framework leverages AI to suggest test cases based on code changes and API specifications

### NonFunctional Requirements

- NFR1: Unit test stages complete in under 10 minutes total on every merge request
- NFR2: Configuration validation completes in under 2 minutes
- NFR3: Full E2E test suite (Playwright) completes in under 30 minutes
- NFR4: Individual component test suites execute in isolation without waiting for other components (parallel execution where possible)
- NFR5: RAG quality regression suite completes in under 60 minutes against a deployed environment
- NFR6: All unit tests produce identical results across repeated executions with the same inputs (no flaky tests in mandatory CI gates)
- NFR7: Test execution is independent of execution order — no test depends on side effects from another test
- NFR8: Tests requiring external services (ArangoDB, Redis, Keycloak, vLLM) use mocked dependencies in CI; real service integration runs only in scheduled pipelines against deployed infrastructure
- NFR9: GPU-dependent tests are conditionally skipped in CI environments without GPU access, with clear skip reporting
- NFR10: Test fixtures are version-controlled and produce reproducible results across environments
- NFR11: Test code follows the same linting and formatting standards as production code (ESLint, Ruff, Flutter analyze)
- NFR12: Test file structure mirrors the production code structure within each component
- NFR13: Mock and fixture definitions are centralized in __tests__/mocks/ (backend, frontend) and tests/ (Python) directories, not duplicated across test files
- NFR14: AI-assisted test generation produces code that passes linting and follows project conventions
- NFR15: Adding a new test for an existing feature requires changes in only one file (the test file) — no cross-file fixture setup for standard cases
- NFR16: The CI pipeline operates identically across GitLab shared runners and self-hosted runners
- NFR17: All test runners produce JUnit XML reports in a format consumable by GitLab CI test reporting
- NFR18: The test framework supports execution in Docker Compose, Docker Swarm, and Kubernetes environments
- NFR19: Python tests run on Python 3.10+; Node.js tests run on Node.js 18+; Dart tests run on Flutter 3.10+
- NFR20: Application services emit OTel-compatible telemetry (traces via OTLP protocol) consumable by standard observability tools (Grafana, VictoriaMetrics, Jaeger)
- NFR21: Backend tests use CommonJS module syntax exclusively (no ESM imports)
- NFR22: Frontend component tests use Options API exclusively (no Composition API patterns)
- NFR23: Python test files include ITU copyright headers as required by project convention
- NFR24: All Python test code passes Ruff linting and formatting checks

### Additional Requirements

- Backend `index.js` (1,193 lines) must export `createApp()` before any route testing can begin — prerequisite refactor with its own tests
- `shared/lib/db-connection-service.js` frozen singleton must be mocked at module level via `moduleNameMapper` in all backend tests
- OPEA `comps` library is vendored at build time (`docarray` → `opea_docarray` rename in Dockerfile) — cannot pip-install locally, all OPEA dependencies must be mocked in tests
- pytest must be configured from scratch for `genie-ai-overlay/` — zero test infrastructure exists (5,018 lines of Python untested)
- GitLab CI pipeline must be built from scratch (no `.gitlab-ci.yml` exists)
- JUnit XML reporting: `jest-junit` v17 for JS, built-in `junitxml` for pytest, `junitreport` for Flutter, built-in `junit` for Playwright
- Test execution tiers: mandatory (lint, unit, config on every MR), scheduled (integration, E2E nightly), on-demand (RAG quality, manual GPU)
- MELT instrumentation hooks must function independently in Sprint 22, consumable by Sprint 23 OTel pipeline without code changes
- Hybrid mock architecture: centralized shared factories in `__tests__/mocks/` and `tests/conftest.py` + co-located test-specific overrides
- Testing organized by validation concern: pipeline integrity, API verification, configuration validation, quality assurance
- 80+ new files/directories across 5 components plus shared infrastructure at root `tests/`
- Implementation sequence: createApp refactor → pytest config → CI pipeline → per-component suites → config validation → OTel instrumentation → RAG fixtures
- GitLab Ultimate Epics for grouping, Issues for stories, all in `un/itu/genie-ai` on `opensource.unicc.org`

### UX Design Requirements

None — testing framework has no user-facing UI.

### FR Coverage Map

| FR | Epic | Description |
|---|---|---|
| FR1 | Epic 1 | CI lint checks on every MR |
| FR2 | Epic 1 | CI unit tests for all 5 components on every MR |
| FR3 | _(removed)_ | _Contract stage removed — route tests run in test stage_ |
| FR4 | Epic 1 | CI config validation on every MR |
| FR5 | Epic 1 | CI blocks MR on failure |
| FR6 | Epic 1 | JUnit XML test reports |
| FR7 | Epic 1 | Scheduled integration tests |
| FR8 | Epic 1 | Scheduled RAG quality tests |
| FR9 | Epic 2 | Backend route handler tests |
| FR10 | Epic 2 | Backend service layer tests |
| FR11 | Epic 2 | Backend middleware tests |
| FR12 | Epic 2 | Backend HTTP route tests via Supertest |
| FR13 | Epic 3 | Frontend component rendering tests |
| FR14 | Epic 3 | Vuex store state management tests |
| FR15 | Epic 3 | Frontend HTTP service tests |
| FR16 | Epic 3 | Auth state transition tests |
| FR17 | Epic 4 | Retriever hybrid search tests |
| FR18 | Epic 4 | Dataprep extraction pipeline tests |
| FR19 | Epic 4 | Reranker score validation tests |
| FR20 | Epic 4 | Core type/protocol tests |
| FR21 | Epic 4 | Custom overlay interface tests |
| FR22 | Epic 5 | File CRUD endpoint tests |
| FR23 | Epic 5 | Security middleware tests |
| FR24 | Epic 5 | Metadata/label service tests |
| FR25 | Epic 1 | Mobile tests in CI |
| FR26 | Epic 1 | Flutter CI-compatible reporting |
| FR27 | Epic 6 | Env var documentation coverage |
| FR28 | Epic 6 | Required var default validation |
| FR29 | Epic 6 | Conflicting config detection |
| FR30 | Epic 6 | Hardware profile range validation |
| FR31 | Epic 6 | Feature flag interdependency validation |
| FR32 | Epic 8 | RAG corpus query execution |
| FR33 | Epic 8 | RAGAS metric computation |
| FR34 | Epic 8 | Threshold comparison and pass/fail |
| FR35 | Epic 8 | Pipeline stage integrity validation |
| FR36 | Epics 2–5 | Version-controlled test fixtures (distributed per component) |
| FR37 | Epic 8 | Multi-format document corpora |
| FR38 | Epic 8 | ArangoDB test database states |
| FR39 | Epic 6 | Environment-specific config profiles |
| FR40 | Epic 7 | OTel distributed traces from application services |
| FR41 | Epic 7 | W3C traceparent propagation across services |
| FR42 | Epic 7 | Structured log assertion helpers |
| FR43 | Sprint 23 | MELT Provider API queryability (Vision) |
| FR44 | Sprint 23 | Grafana service health dashboards (Vision) |
| FR45 | Epic 9 | AI test scaffolding generation |
| FR46 | Epic 9 | AI test case suggestions |

## Execution Dependencies

Epics are numbered for reference, not for sequential execution. The recommended execution order for parallel work:

**Wave 0 — Foundation (must complete first):**
- Epic 1 Stories 1.1–1.3 (JUnit reporting, lint stage, test stage) — CI infrastructure
- Epic 7 Stories 7.1–7.2 (OTel tracing foundation, OPEA tracing) — application observability; no dependency on test epics
- Story 2.2 (backend fixtures) and Story 4.1 (OPEA pytest config + fixtures) — shared mock infrastructure

**Wave 1 — Core tests (parallel across components):**
- Epic 2 Stories 2.1, 2.3–2.8 (backend tests) — after `createApp()` refactor
- Epic 3 Stories 3.1–3.5 (frontend tests) — after frontend fixtures
- Epic 4 Stories 4.1–4.6 (OPEA tests) — after pytest config, Story 4.4 (core types) before 4.5–4.6
- Epic 5 Stories 5.1–5.4 (doc-repo tests) — after doc-repo fixtures

**Wave 2 — Cross-cutting and advanced:**
- Epic 1 Stories 1.4–1.7 (contract stage removed, config validation, MR blocking, caching) — needs tests from Wave 1
- Epic 6 (config validation) — independent, can start in Wave 0
- Epic 8 (RAG quality) — needs OPEA fixtures from Epic 4
- Epic 9 (AI test generation) — needs existing tests from Epics 2–5

**Cross-component fixture consistency:**
- Backend (Story 2.2), frontend (Story 3.1), and OPEA (Story 4.1) fixture stories MUST use consistent response shapes for shared entities (user, conversation, file metadata). When in doubt, the backend API response shape is the source of truth.

## Epic List

### Epic 1: Merge with Confidence — CI/CD Pipeline
The developer merges a feature branch and the CI pipeline automatically runs lint, unit tests, and configuration validation across all 5 components, blocking the merge request on failure with clear pass/fail reporting via JUnit XML.
**FRs covered:** FR1–FR2, FR4–FR8, FR25–FR26
**Sprint:** 22 (MVP)

### Epic 2: Backend API Test Suite
The developer writes and runs tests for backend route handlers, service layer business logic, and middleware behavior against an in-memory Express application with deterministic mocks.
**FRs covered:** FR9–FR12, FR36 (backend fixtures)
**Sprint:** 22 (MVP)

### Epic 3: Frontend Component Test Suite
The developer writes and runs tests for Vue components (ChatBot, NavBar, UserProfile), Vuex store modules, and HTTP service interactions using Options API patterns.
**FRs covered:** FR13–FR16, FR36 (frontend fixtures)
**Sprint:** 22 (MVP)

### Epic 4: OPEA Microservice Test Suite
The developer writes and runs pytest tests for the retriever's hybrid search, dataprep extraction pipeline, reranker score validation, core types, and custom overlay interfaces — all with mocked ArangoDB, vLLM, and TEI dependencies.
**FRs covered:** FR17–FR21, FR36 (OPEA fixtures)
**Sprint:** 22 (MVP)

### Epic 5: Document Repository Test Suite
The developer writes and runs tests for file upload/download/search/delete endpoints, ClamAV security scanning, file type validation, and metadata service business logic.
**FRs covered:** FR22–FR24, FR36 (doc-repo fixtures)
**Sprint:** 22 (MVP)

### Epic 6: Configuration Integrity Validation
The DevOps engineer runs the configuration validation suite and sees clear pass/fail results for env var coverage, required secret defaults, conflicting configurations, hardware-specific parameter ranges, and feature flag interdependencies.
**FRs covered:** FR27–FR31, FR39
**Sprint:** 22 (MVP)

### Epic 7: Application Observability — OTel Instrumentation
The developer instruments Express backend and OPEA (FastAPI) services with OpenTelemetry SDKs, establishing distributed tracing and structured logging that enables end-to-end request tracing across the full stack.
**FRs covered:** FR40–FR42
**Sprint:** 22 (MVP)

### Epic 8: RAG Quality Assurance
The QA engineer runs the RAG quality regression suite against a curated document corpus, sees RAGAS metrics compared against configurable thresholds, and flags quality degradation before release.
**FRs covered:** FR32–FR35, FR37–FR38
**Sprint:** 22 (fixture structure) → 23 (RAGAS pipeline)

### Epic 9: AI-Assisted Test Generation
The developer leverages AI to generate test scaffolding (boilerplate, mock factories, fixture generators) from existing code and receive test case suggestions based on code changes and API specifications.
**FRs covered:** FR45–FR46
**Sprint:** 23

## Epic 1: Merge with Confidence — CI/CD Pipeline

The developer merges a feature branch and the CI pipeline automatically runs lint, unit tests, and configuration validation across all 5 components, blocking the merge request on failure with clear pass/fail reporting via JUnit XML.

### Story 1.1: Configure JUnit XML Reporting for All Test Runners

As a developer,
I want all test runners to produce JUnit XML reports,
So that GitLab CI can visualize test results and track pass/fail trends.

**Acceptance Criteria:**

**Given** the project has 5 test runners (Jest ×3, pytest, flutter_test, Playwright)
**When** I install the required reporting dependencies
- `jest-junit: ^17.0.0` added to `gov-chat-backend/package.json`, `gov-chat-frontend/package.json`, `document-repository/package.json`
- `junitreport` added to `mobile/genie_ai_mobile/pubspec.yaml`
- Playwright junit reporter configured in `playwright.config.js`
- pytest junitxml configured in `genie-ai-overlay/pytest.ini`
**Then** all test runners can produce JUnit XML output
**And** Jest configs include `jest-junit` in reporters configuration
**And** Playwright config includes `['junit', { outputFile: 'reports/playwright-report.xml' }]` in reporter array
**And** pytest is configured with `--junitxml=reports/pytest-report.xml`
**And** Flutter test command pipes to `tojunit` for XML output
**And** all dependencies pass their respective lint checks (ESLint, Ruff, flutter analyze)

### Story 1.2: Create CI Pipeline Lint Stage

As a developer,
I want the CI pipeline to run lint checks across all components on every merge request,
So that code quality violations are caught before review.

**Acceptance Criteria:**

**Given** a `.gitlab-ci.yml` exists at the repository root
**When** a merge request is opened or updated
**Then** the pipeline runs parallel lint jobs:
- `lint:backend` — ESLint on `components/gov-chat-backend/`
- `lint:frontend` — ESLint on `components/gov-chat-frontend/`
- `lint:doc-repo` — ESLint on `components/document-repository/`
- `lint:python` — Ruff on `genie-ai-overlay/`
- `lint:dart` — Flutter analyze on `mobile/genie_ai_mobile/`
**And** each job uses the appropriate Docker image (node:20, python:3.10)
**And** jobs fail the pipeline if any lint errors are found
**And** path-based `rules:changes` trigger only relevant linters on MRs

### Story 1.3: Create CI Pipeline Test Stage

As a developer,
I want the CI pipeline to run unit tests for all 5 components in parallel on every merge request,
So that I get fast feedback on whether my changes break anything.

**Acceptance Criteria:**

**Given** the lint stage passes
**When** the test stage runs
**Then** parallel test jobs execute:
- `test:backend` — `npm ci && npm test` in `components/gov-chat-backend/`
- `test:frontend` — `npm ci && npm test` in `components/gov-chat-frontend/`
- `test:doc-repo` — `npm ci && npm test` in `components/document-repository/`
- `test:python` — `pip install && pytest` in `genie-ai-overlay/`
- `test:mobile` — `flutter test --machine | tojunit` in `mobile/genie_ai_mobile/`
**And** each job produces JUnit XML as `artifacts:reports:junit`
**And** each job uses `cache:` for `node_modules` and Python `.venv`
**And** `NODE_ENV=test` is set for all Node.js jobs
**And** path-based `rules:changes` trigger only affected component tests on MRs
**And** all 5 jobs run on `main` branch pushes regardless of path changes

### Story 1.4: Create CI Pipeline Contract Test Stage

As a developer,
I want the CI pipeline to run contract tests as a dedicated stage,
So that breaking interface changes are caught before merge.

**Acceptance Criteria:**

**Given** the test stage passes and route handler tests exist from Epics 2 and 5
**When** the contract stage runs
**Then** a `contract` CI stage executes `npm run test:contract` in backend and document-repository
**And** the stage runs existing Supertest-based route handler tests that verify request/response schemas
**And** the stage does NOT write new tests — it orchestrates execution of tests written in Epics 2 and 5
**And** JUnit XML reports are collected as `artifacts:reports:junit`
**And** the stage blocks the MR on failure
**And** path-based `rules:changes` trigger only relevant contract tests on MRs

> **Design Change (2026-05-25):** The `contract` CI stage has been removed from `.gitlab-ci.yml`. The same route handler tests already run in the `test` stage (test:backend, test:doc-repo), making the dedicated contract stage redundant. The `test:contract` npm script remains as a convenience alias for local development. This story was correctly implemented at the time; the design change reflects a simplification of the CI pipeline to `lint → test → config → e2e`.

### Story 1.5: Create CI Pipeline Configuration Validation Stage

As a developer,
I want the CI pipeline to validate the environment configuration,
So that configuration drift and missing variables are caught automatically.

**Acceptance Criteria:**

**Given** the test stage passes
**When** the config stage runs
**Then** the configuration validation suite executes in `tests/config-validator/`
**And** it validates all env vars referenced in `docker-compose.yaml` are documented in the `env` template
**And** it checks required secrets have no undefined defaults
**And** it detects conflicting or orphaned configurations
**And** it validates feature flag interdependencies (e.g., `DEPLOY_OPEA`)
**And** JUnit XML reports are collected as artifacts
**And** the stage completes in under 2 minutes (NFR2)

### Story 1.6: Configure MR Blocking and Scheduled Jobs

As a developer,
I want mandatory CI stages to block merge requests and integration/RAG tests to run on schedule,
So that every merged change is validated while heavy tests don't slow down reviews.

**Acceptance Criteria:**

**Given** the `.gitlab-ci.yml` has lint, test, and config stages
**When** a merge request fails any mandatory stage
**Then** the MR is blocked and cannot be merged
**When** the nightly schedule triggers
**Then** integration tests run against deployed Docker Compose infrastructure (FR7)
**And** E2E Playwright tests run against deployed infrastructure
**When** a developer manually triggers the RAG quality pipeline
**Then** RAG quality regression tests execute (FR8)
**And** GPU-dependent jobs are conditional on runner tags
**And** scheduled and manual jobs do not block MRs

### Story 1.7: Configure CI Caching and Path-Based Triggers

As a developer,
I want CI jobs to use caching and only run when relevant files change,
So that pipeline execution is fast and efficient.

**Acceptance Criteria:**

**Given** the `.gitlab-ci.yml` pipeline is defined
**When** a merge request modifies only `components/gov-chat-backend/`
**Then** only `lint:backend` and `test:backend` run (not frontend, Python, mobile, etc.)
**And** `npm ci` uses cached `node_modules` keyed on `package-lock.json` hash
**And** Python jobs use cached `.venv` keyed on dependency file hash
**And** Flutter jobs use cached build artifacts
**And** full suite runs on `main` branch pushes regardless of path changes
**And** total mandatory pipeline time is under 10 minutes (NFR1)

### Story 1.8: E2E Playwright Tests for Chatbot Interaction Flows

As a developer,
I want automated Playwright E2E tests for the chatbot interaction flows,
So that critical user journeys through the RAG pipeline are validated in CI.

**Acceptance Criteria:**

**Given** the existing manual E2E procedures in `docs/e2e-tests/` have been validated
**When** I create automated Playwright tests for chatbot flows
**Then** tests cover the full chatbot interaction: user sends a message → backend processes → RAG pipeline retrieves → LLM generates response → frontend displays answer
**And** tests validate streaming SSE responses are rendered correctly
**And** tests validate conversation history persistence across sessions
**And** tests validate error handling when the RAG pipeline is unavailable
**And** tests run as a scheduled CI job (not blocking MRs)
**And** the full E2E suite completes within NFR3 (<30 minutes)

### Story 1.9: E2E Playwright Tests for Document Upload and Search Flows

As a developer,
I want automated Playwright E2E tests for document upload and search flows,
So that the document ingestion pipeline is validated end-to-end in CI.

**Acceptance Criteria:**

**Given** the existing manual E2E procedures in `docs/e2e-tests/` have been validated
**When** I create automated Playwright tests for document flows
**Then** tests cover: user uploads a document → ClamAV scanning → dataprep ingestion → chunking + embedding → document appears in search results
**And** tests validate multi-format upload (.txt, .md, .pdf)
**And** tests validate file type rejection for unsupported formats
**And** tests validate search returns relevant results after ingestion
**And** tests run as a scheduled CI job (not blocking MRs)
**And** the full E2E suite completes within NFR3 (<30 minutes)

## Epic 2: Backend API Test Suite

The developer writes and runs tests for backend route handlers, service layer business logic, and middleware behavior against an in-memory Express application with deterministic mocks.

### Story 2.1: Refactor Backend index.js to Export createApp()

As a developer,
I want `index.js` to export a `createApp()` function,
So that I can test route handlers via Supertest without starting the server.

**Acceptance Criteria:**

**Given** `components/gov-chat-backend/index.js` is 1,193 lines with inline middleware and route registration
**When** I extract the Express app creation into a `createApp()` function
**Then** `createApp()` accepts an optional config object and returns the configured Express app without calling `app.listen()`
**And** all middleware registration (helmet, cors, express.json, rate limiting, error handling) is inside `createApp()`
**And** all route registration is inside `createApp()`
**And** `index.js` calls `createApp()` and starts the server when run directly (`require('./index')`)
**And** `createApp()` is exported via `module.exports = { createApp }`
**And** the refactor includes its own tests verifying `createApp()` returns an Express app with all routes registered
**And** all existing auth tests continue to pass unchanged

### Story 2.2: Create Backend Test Fixtures and Shared Mocks

As a developer,
I want centralized test fixtures and mock factories for the backend,
So that all backend tests use consistent, maintainable test data.

**Acceptance Criteria:**

**Given** the backend has `__tests__/mocks/shared-lib.js` for module-level mocking
**When** I create the fixture infrastructure
**Then** `__tests__/fixtures/users.js` exports `createMockUser(overrides)` factory function
**And** `__tests__/fixtures/tokens.js` exports `createValidToken(claims)` and `createExpiredToken()` helpers
**And** `__tests__/fixtures/requests.js` exports `createMockReq(overrides)` and `createMockRes()` helpers
**And** all factories use the overrides pattern (spread with defaults)
**And** `db-connection-service.js` is mocked at module level via `jest.mock()` in a setup file
**And** all fixtures use CommonJS `require()` syntax (NFR21)
**And** fixture response shapes (user, conversation, file metadata) are the source of truth — frontend (Story 3.1) and OPEA (Story 4.1) fixtures MUST match these shapes for cross-component consistency

### Story 2.3: Test Backend Auth Route Handlers

As a developer,
I want tests for the authentication route group,
So that auth endpoints are validated against the API specification.

**Acceptance Criteria:**

**Given** `createApp()` is exported from `index.js`
**When** I create `__tests__/routes/auth.test.js`
**Then** tests cover POST `/api/auth/login` with valid credentials (200 + token)
**And** tests cover POST `/api/auth/login` with invalid credentials (401)
**And** tests cover POST `/api/auth/logout` with valid token (200)
**And** tests cover POST `/api/auth/logout` with expired token (401)
**And** tests cover POST `/api/auth/refresh` with valid refresh token (200 + new token pair)
**And** tests use Supertest `request(app)` with pre-signed JWT fixtures
**And** Keycloak is mocked — no real OIDC calls
**And** all tests follow AAA structure and "should" naming convention

### Story 2.4: Test Backend Chat Route Handlers

As a developer,
I want tests for the chat route group,
So that conversation endpoints are validated against the API specification.

**Acceptance Criteria:**

**Given** `createApp()` is exported from `index.js`
**When** I create `__tests__/routes/chat.test.js`
**Then** tests cover GET `/api/chat/conversations` (200 + conversation list)
**And** tests cover POST `/api/chat/conversations` (201 + new conversation)
**And** tests cover GET `/api/chat/conversations/:id/messages` (200 + messages)
**And** tests cover POST `/api/chat/conversations/:id/messages` (201 + message sent)
**And** tests cover error cases (401 unauthorized, 404 conversation not found)
**And** query-service and chat-history-service are mocked
**And** all tests use factory fixtures from `__tests__/fixtures/`

### Story 2.5: Test Backend Analytics and Categories Route Handlers

As a developer,
I want tests for analytics and categories route groups,
So that these backend API endpoints are fully validated.

**Acceptance Criteria:**

**Given** `createApp()` is exported from `index.js`
**When** I create route test files for analytics and categories
**Then** `__tests__/routes/analytics.test.js` covers GET `/api/analytics/*` endpoints
**And** `__tests__/routes/categories.test.js` covers GET `/api/categories/*` endpoints
**And** analytics-service is mocked via `jest.mock()`
**And** error format follows `{ error, message, details }` (RFC 9457)

### Story 2.6: Test Backend Admin and Files Route Handlers

As a developer,
I want tests for admin and files route groups,
So that role-based access control and file proxy routing are validated.

**Acceptance Criteria:**

**Given** `createApp()` is exported from `index.js`
**When** I create route test files for admin and files
**Then** `__tests__/routes/admin.test.js` covers GET/PUT `/api/admin/*` endpoints with role-based access (403 for non-admin)
**And** `__tests__/routes/files.test.js` covers POST/GET/DELETE `/api/files/*` endpoints as BFF proxy handlers
**And** file route tests mock the document-repository service (`fileService`) — these tests validate the backend HTTP layer only, NOT the document-repository business logic (see Epic 5)
**And** admin controller is mocked via `jest.mock()`
**And** error format follows `{ error, message, details }` (RFC 9457)

### Story 2.7: Test Backend Service Layer

As a developer,
I want unit tests for backend service business logic,
So that service-layer bugs are caught without network or database dependencies.

**Acceptance Criteria:**

**Given** the backend has multiple service files in `services/`
**When** I create `__tests__/services/` test files
**Then** `query-service.test.js` tests query construction and formatting logic
**And** `chat-history-service.test.js` tests conversation/message CRUD operations
**And** `analytics-service.test.js` tests analytics data aggregation
**And** `user-profile-service.test.js` tests profile retrieval and update logic
**And** `translation-service.test.js` tests translation request handling
**And** ArangoDB and external services are mocked via `jest.mock()`
**And** all tests are independent of execution order (NFR7)

### Story 2.8: Test Backend Middleware

As a developer,
I want tests for middleware behavior,
So that authentication, authorization, rate limiting, and error handling work correctly.

**Acceptance Criteria:**

**Given** the backend uses Express middleware for auth, security, and error handling
**When** I create `__tests__/middleware/` test files
**Then** `keycloak-auth-middleware.test.js` validates JWT claims (`iss_sub`, `sub`, `iss`) and rejects invalid tokens
**And** `security-middleware.test.js` tests rate limiting, threat detection, and IP reputation
**And** `error-handler.test.js` tests error response format (`{ error, message, details }`)
**And** middleware is tested in isolation with mock `req`/`res`/`next` objects
**And** all tests follow closure-based mock reference pattern

## Epic 3: Frontend Component Test Suite

The developer writes and runs tests for Vue components (ChatBot, NavBar, UserProfile), Vuex store modules, and HTTP service interactions using Options API patterns.

### Story 3.1: Create Frontend Test Fixtures and Shared Mocks

As a developer,
I want centralized test fixtures and mock factories for the frontend,
So that all frontend tests use consistent, maintainable test data.

**Acceptance Criteria:**

**Given** the frontend has 8 existing test files covering stores and services
**When** I create the fixture infrastructure
**Then** `src/__tests__/mocks/axios.js` exports a centralized axios mock with request/response interception
**And** `src/__tests__/mocks/keycloakAuthService.js` exports a centralized Keycloak auth mock
**And** `src/__tests__/fixtures/store-state.js` exports `createAuthenticatedState(overrides)` and `createUnauthenticatedState()` factories
**And** `src/__tests__/fixtures/api-responses.js` exports mocked API response data for chat, categories, user profile
**And** all mocks follow the closure-based reference pattern to avoid hoisting issues
**And** all code follows ESLint and Prettier standards (NFR11)

### Story 3.2: Test Critical Vue Components — ChatBot and NavBar

As a developer,
I want component tests for ChatBotComponent and NavBarComponent,
So that the most critical UI interactions are validated.

**Acceptance Criteria:**

**Given** ChatBotComponent is 2,441 lines and NavBarComponent handles navigation/auth state
**When** I create `src/__tests__/components/ChatBotComponent.test.js`
**Then** tests verify the component renders with an empty message list
**And** tests verify a user message is displayed after submission
**And** tests verify the chat input is cleared after submission
**And** tests verify loading state is shown while waiting for response
**And** tests verify error state is shown when API call fails
**When** I create `src/__tests__/components/NavBarComponent.test.js`
**Then** tests verify navigation links render correctly
**And** tests verify login/logout button state reflects auth status
**And** tests verify user dropdown appears when authenticated
**And** all components are mounted using Options API `mount()` with full Vuex store setup (NFR22)
**And** all tests use `@vue/test-utils` `mount()` or `shallowMount()`

### Story 3.3: Test Critical Vue Components — UserProfile and Admin Dashboard

As a developer,
I want component tests for UserProfileComponent and AdminDashboard,
So that profile management and admin functionality are validated.

**Acceptance Criteria:**

**Given** UserProfileComponent displays user data and AdminDashboard is 4,885 lines
**When** I create `src/__tests__/components/UserProfileComponent.test.js`
**Then** tests verify user profile data displays correctly (name, email, organization)
**And** tests verify edit mode allows profile modification
**And** tests verify save triggers the correct API call
**When** I create `src/__tests__/components/AdminDashboard.test.js`
**Then** tests verify the dashboard renders without errors (may be split into sub-components)
**And** tests verify admin-only access control (non-admin users see restricted view)
**And** tests verify key admin sections render (users, analytics, settings)
**And** all tests use Options API patterns (NFR22)

### Story 3.4: Test Vuex Store Modules

As a developer,
I want tests for all Vuex store modules,
So that state management logic is validated independently of components.

**Acceptance Criteria:**

**Given** the frontend has a root store with auth and chatHistory modules
**When** I create `src/__tests__/store/chatHistory.test.js`
**Then** tests verify chatHistory module initial state
**And** tests verify `ADD_CONVERSATION` mutation adds a conversation to state
**And** tests verify `SET_CURRENT_CONVERSATION` mutation updates current conversation
**And** tests verify `ADD_MESSAGE` mutation appends a message
**And** tests verify chatHistory actions dispatch API calls correctly
**And** the existing `authStore.test.js` continues to pass unchanged
**And** all store tests use `createStore` or direct commit testing

### Story 3.5: Test HTTP Services

As a developer,
I want tests for frontend HTTP service interactions,
So that API communication is validated with mocked responses.

**Acceptance Criteria:**

**Given** the frontend has 16 service files (only httpService is partially tested)
**When** I create `src/__tests__/services/chatService.test.js`
**Then** tests verify `sendMessage()` posts to the correct endpoint with the correct payload
**And** tests verify `getConversations()` fetches and returns conversation list
**And** tests verify error handling (401 redirects to login, 500 shows error message)
**When** I create `src/__tests__/services/analyticsService.test.js`
**Then** tests verify analytics data fetching and formatting
**And** tests verify API error handling and retry behavior
**And** all services use the centralized axios mock from `src/__tests__/mocks/`

## Epic 4: OPEA Microservice Test Suite

The developer writes and runs pytest tests for the retriever's hybrid search, dataprep extraction pipeline, reranker score validation, core types, and custom overlay interfaces — all with mocked ArangoDB, vLLM, and TEI dependencies.

**Note:** Story 4.4 (Core Types) is a prerequisite for Stories 4.5 and 4.6 — other OPEA tests depend on validated type definitions.

### Story 4.1: Configure pytest and Create Shared Fixtures for OPEA

As a developer,
I want pytest configured with shared mock fixtures for the OPEA overlay,
So that all OPEA microservice tests have a consistent mock foundation.

**Acceptance Criteria:**

**Given** `genie-ai-overlay/` has zero test infrastructure (5,018 lines of Python untested)
**When** I configure pytest
**Then** `genie-ai-overlay/pytest.ini` is created with test discovery, asyncio mode, and junitxml output
**And** `genie-ai-overlay/pyproject.toml` includes `pytest`, `pytest-asyncio`, `pytest-cov`, `httpx`, `asgi-lifespan` in test dependencies
**When** I create `genie-ai-overlay/tests/conftest.py`
**Then** shared fixtures provide `mock_arangodb()` mocking the ArangoDB driver (collections, queries, AQL)
**And** shared fixtures provide `mock_redis()` mocking the Redis client
**And** shared fixtures provide `mock_vllm()` mocking vLLM inference responses
**And** shared fixtures provide `mock_tei()` mocking TEI embedding/reranking responses
**And** shared fixtures provide `mock_comps()` mocking the vendored OPEA comps library
**And** all Python test files include ITU copyright headers (NFR23)
**And** all Python code passes Ruff linting and formatting (NFR24)

### Story 4.2: Test Retriever Hybrid Search Logic

As a developer,
I want pytest tests for the retriever's hybrid search (vector + graph + labels),
So that retrieval logic is validated without real ArangoDB or embedding services.

**Acceptance Criteria:**

**Given** `geniei_retriever_arangodb.py` implements custom hybrid search (854 lines)
**When** I create `tests/test_retriever.py`
**Then** tests verify hybrid search combines vector similarity, graph traversal, and label filtering
**And** tests verify query construction for different search modes (vector-only, graph-only, hybrid)
**And** tests verify score threshold filtering (minimum score cutoff)
**And** tests verify pagination and top-K result limiting
**And** tests verify error handling when ArangoDB mock returns empty results
**And** tests verify error handling when ArangoDB mock raises ConnectionError
**And** ArangoDB and embedding services are fully mocked

### Story 4.3: Test Dataprep Extraction Pipeline

As a developer,
I want pytest tests for the dataprep extraction and chunking pipeline,
So that document processing logic is validated without real file system or embedding services.

**Acceptance Criteria:**

**Given** `genieai_dataprep_arangodb.py` implements custom ingestion (877 lines)
**When** I create `tests/test_dataprep.py`
**Then** tests verify multi-format document parsing (txt, md, pdf, xlsx, docx)
**And** tests verify chunking strategy produces correctly sized chunks
**And** tests verify labeling logic assigns correct labels to chunks
**And** tests verify embedding generation calls TEI with correct payload
**And** tests verify ArangoDB document insertion with correct graph structure
**And** tests verify error handling for corrupted or unsupported file formats
**And** all external services (Docling, TEI, ArangoDB) are mocked

### Story 4.4: Test Core Type Definitions and API Protocols

As a developer,
I want pytest tests for shared core type definitions,
So that Pydantic models, protocol constants, and type validation are verified as a foundation for other OPEA tests.

**Acceptance Criteria:**

**Given** `genie-ai-overlay/core/` defines custom Pydantic models and protocol constants
**When** I create `tests/test_core.py`
**Then** tests verify custom Pydantic models serialize/deserialize correctly
**And** tests verify protocol constants match expected values
**And** tests verify type validation on request/response models
**And** this story is a prerequisite for Stories 4.5 and 4.6 (other OPEA tests depend on these types)

### Story 4.5: Test Reranker Score Validation and Top-K Constraints

As a developer,
I want pytest tests for the reranker's score validation and result limiting,
So that score boundaries and top-K enforcement are validated.

**Acceptance Criteria:**

**Given** `genieai_reranker.py` validates scores and enforces top-K constraints
**When** I create `tests/test_reranker.py`
**Then** tests verify score validation accepts valid scores and rejects out-of-range values
**And** tests verify top-K constraint enforcement returns exactly K results
**And** tests verify TEI service call with correct payload
**And** TEI service is mocked via conftest fixture

### Story 4.6: Test ChatQnA Orchestrator Interface

As a developer,
I want pytest tests for the ChatQnA orchestrator interface,
So that the custom OPEA overlay orchestrator is validated without real services.

**Acceptance Criteria:**

**Given** `genieai_chatqna.py` implements a custom MegaService orchestrator (1,673 lines)
**When** I create `tests/test_chatqna.py`
**Then** tests verify the orchestrator accepts valid chat requests and returns responses
**And** tests verify user profile enrichment logic with mocked user data
**And** tests verify multilingual translation integration with mocked translation service
**And** tests verify citation formatting in response output
**And** tests verify error handling when downstream services fail
**And** tests verify the orchestrator handles streaming responses (SSE)
**And** all downstream services (retriever, reranker, vLLM, translation) are mocked via conftest fixtures

## Epic 5: Document Repository Test Suite

The developer writes and runs tests for file upload/download/search/delete endpoints, ClamAV security scanning, file type validation, and metadata service business logic.

### Story 5.1: Create Document Repository Test Fixtures and Mocks

As a developer,
I want centralized test fixtures and mock factories for the document repository,
So that all doc-repo tests use consistent, maintainable test data.

**Acceptance Criteria:**

**Given** the document-repository has `__tests__/__mocks__/shared-lib.js` for module-level mocking
**When** I create the fixture infrastructure
**Then** `__tests__/mocks/files.js` exports `createMockFile(overrides)` factory for file metadata objects
**And** `__tests__/mocks/clamav.js` exports a mock ClamAV scanner that returns clean/infected results
**And** `__tests__/fixtures/test-document.txt` is a plain text test file for upload tests
**And** `__tests__/fixtures/test-document.pdf` is a PDF test file for multi-format validation
**And** `__tests__/fixtures/eicar.txt` contains the standard EICAR test virus signature for ClamAV validation
**And** the existing `__mocks__/shared-lib.js` continues to work unchanged
**And** all fixtures use CommonJS `require()` syntax (NFR21)

### Story 5.2: Test File Upload, Download, Search, and Delete Endpoints

As a developer,
I want route handler tests for all document repository endpoints,
So that file operations are validated against the API specification.

**Acceptance Criteria:**

**Given** the document-repository has `fileController.js` (1,374 lines) with zero route tests
**When** I create `__tests__/routes/upload.test.js`
**Then** tests verify POST `/files/upload` accepts multipart file upload (201 + file metadata)
**And** tests verify upload rejects unsupported file types (415)
**And** tests verify upload triggers ClamAV scan
**When** I create `__tests__/routes/download.test.js`
**Then** tests verify GET `/files/:id/download` returns file content with correct headers
**And** tests verify download returns 404 for non-existent file
**When** I create `__tests__/routes/search.test.js`
**Then** tests verify GET `/files/search` returns matching files for valid queries
**And** tests verify search with empty query returns appropriate response
**When** I create `__tests__/routes/delete.test.js`
**Then** tests verify DELETE `/files/:id` removes a file (200)
**And** tests verify delete returns 404 for non-existent file
**And** all tests use Supertest with mocked fileService and ArangoDB

### Story 5.3: Test File Service Business Logic

As a developer,
I want unit tests for the file service layer,
So that file processing logic is validated without file system dependencies.

**Acceptance Criteria:**

**Given** `fileService.js` (882 lines) handles upload, download, delete, search, and ingestion
**When** I create `__tests__/services/fileService.test.js`
**Then** tests verify file upload stores file metadata in ArangoDB
**And** tests verify file download retrieves file from storage
**And** tests verify file search queries ArangoDB with correct filters
**And** tests verify file delete removes metadata and triggers storage cleanup
**And** tests verify ingestion triggers dataprep pipeline for new documents
**And** ArangoDB, file system, and ClamAV are fully mocked
**And** error handling covers storage failures and database errors

### Story 5.4: Test Security Middleware and Metadata Services

As a developer,
I want tests for security middleware and metadata/label services,
So that file security and metadata management are validated.

**Acceptance Criteria:**

**Given** the document-repository has security middleware and metadata/label services
**When** I create `__tests__/middleware/security.test.js`
**Then** tests verify ClamAV integration detects infected files (using EICAR test signature)
**And** tests verify file type validation accepts allowed MIME types
**And** tests verify file type validation rejects dangerous types (executable, script)
**And** tests verify authentication middleware rejects unauthenticated requests
**When** I extend existing `metadataService.test.js` and `labelService.test.js`
**Then** tests verify metadata extraction from uploaded files
**And** tests verify label assignment and retrieval
**And** all security tests use the EICAR test fixture

## Epic 6: Configuration Integrity Validation

The DevOps engineer runs the configuration validation suite and sees clear pass/fail results for env var coverage, required secret defaults, conflicting configurations, hardware-specific parameter ranges, and feature flag interdependencies.

### Story 6.1: Build Env Template Parser and Docker-Compose Cross-Reference Validator

As a DevOps engineer,
I want the configuration validator to parse the `env` template and cross-reference all variables against `docker-compose.yaml`,
So that every compose reference is documented and no orphaned variables exist.

**Acceptance Criteria:**

**Given** the `env` template contains 50+ variables across 13 sections
**When** I create `tests/config-validator/validate-env.js`
**Then** the parser extracts all documented variables with their types, defaults, sections, and descriptions
**When** I create `tests/config-validator/validate-compose.js`
**Then** the cross-referencer finds all `${VAR}` references in `docker-compose.yaml`
**And** it verifies every compose reference has a documented default in the `env` template
**And** it identifies required secrets (no defaults) that are referenced in compose
**And** it detects orphaned env template variables not referenced in compose
**And** it produces structured output (pass/fail per variable) consumable by Jest
**And** the validator completes in under 30 seconds for the full env template

### Story 6.2: Build Hardware Profile and Feature Flag Validators

As a DevOps engineer,
I want the configuration validator to check hardware-specific parameter ranges and feature flag interdependencies,
So that GPU misconfigurations and topology inconsistencies are caught automatically.

**Acceptance Criteria:**

**When** I create `tests/config-validator/validate-hardware.js`
**Then** the validator defines valid parameter ranges per GPU profile (T4: 16GB VRAM, RTX 6000: 24GB VRAM)
**And** it validates `VLLM_MAX_MODEL_LEN` against GPU memory constraints
**And** it validates `TEI_BATCH_SIZE` and embedding model compatibility
**And** it produces warnings for unsupported GPU types while allowing any CUDA-compatible device
**When** I create `tests/config-validator/validate-features.js`
**Then** the validator checks `DEPLOY_OPEA=0` means vLLM/TEI/retriever/dataprep/chatqna vars are irrelevant
**And** it checks `DEPLOY_OPEA=1` means all OPEA-related vars must be set
**And** it validates `KC_DATAPREP_CLIENT_SECRET` is required when dataprep features are enabled
**And** it produces structured output consumable by Jest

### Story 6.3: Create Configuration Validation Test Suite and Env Profiles

As a DevOps engineer,
I want a Jest test suite and environment-specific config profiles,
So that configuration validation runs in CI and profiles can validate specific deployments.

**Acceptance Criteria:**

**When** I create `tests/config-validator/__tests__/config-validation.test.js`
**Then** tests cover env template parsing with all 50+ variables extracted
**And** tests cover docker-compose cross-reference with known compose references
**And** tests cover hardware profile validation with valid and invalid GPU configs
**And** tests cover feature flag interdependency checks
**And** tests cover error reporting for missing or conflicting configurations
**And** the test suite produces JUnit XML for GitLab CI reporting
**When** I create config profile fixtures in `tests/fixtures/config/`
**Then** `default.env` contains baseline configuration values
**And** `gpu-t4.env` contains T4 GPU-specific overrides
**And** `gpu-rtx6000.env` contains RTX 6000 GPU-specific overrides
**And** `no-opea.env` contains `DEPLOY_OPEA=0` with minimal config

## Epic 7: Application Observability — OTel Instrumentation

The developer instruments Express backend and OPEA (FastAPI) services with OpenTelemetry SDKs, establishing distributed tracing and structured logging that enables end-to-end request tracing across the full stack. Deploy an OTel Collector + VictoriaMetrics + Grafana stack for telemetry visualization.

### Story 7.1: Express Backend OTel Tracing Foundation

As a developer,
I want the Express backend instrumented with OpenTelemetry tracing,
So that every HTTP request, database query, and external API call produces distributed trace spans.

**Acceptance Criteria:**

**When** I add `@opentelemetry/api`, `@opentelemetry/sdk-node`, and `@opentelemetry/auto-instrumentations-node` to the backend
**Then** all Express route handlers automatically produce HTTP spans
**And** ArangoDB queries produce database spans with collection and query type attributes
**And** outbound HTTP calls (to OPEA services, Keycloak) produce client-side spans
**And** spans include `service.name = "genie-backend"`, `service.version`, and `deployment.environment` resource attributes
**And** the SDK exports traces via OTLP to a configurable endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT`)
**And** trace context is propagated via W3C `traceparent` headers on all outbound requests
**And** the instrumentation is bootstrap-safe (graceful degradation if collector is unavailable)
**And** PII (user emails, query content) is sanitized from span attributes before export

### Story 7.2: OPEA Services OTel Tracing (ChatQnA + Retriever)

As a developer,
I want the ChatQnA and Retriever FastAPI services instrumented with OpenTelemetry,
So that RAG pipeline requests (embedding, retrieval, reranking, LLM inference) are traced end-to-end.

**Acceptance Criteria:**

**When** I add `opentelemetry-api`, `opentelemetry-sdk`, and `opentelemetry-instrumentation-fastapi` to the ChatQnA service
**Then** ChatQnA HTTP endpoints produce server-side spans with `service.name = "chatqna"`
**And** the retriever service produces server-side spans with `service.name = "retriever"`
**And** spans include RAG-specific attributes: `rag.query_length`, `rag.chunk_count`, `rag.model_id`
**And** the SDK exports traces via OTLP to a configurable endpoint
**And** trace context is propagated via W3C `traceparent` headers on inter-service calls
**And** the instrumentation does not alter existing API contracts or response formats
**And** the instrumentation adds <5ms latency overhead per request (NFR threshold)
**And** no user query content or document text is included in span attributes (PII protection)

### Story 7.3: OPEA Services OTel Tracing (Dataprep + Reranker)

As a developer,
I want the Dataprep and Reranker FastAPI services instrumented with OpenTelemetry,
So that document ingestion and result reranking are visible in distributed traces.

**Acceptance Criteria:**

**When** I add OpenTelemetry instrumentation to the Dataprep service
**Then** Dataprep endpoints produce server-side spans with `service.name = "dataprep"`
**And** spans include ingestion attributes: `dataprep.file_type`, `dataprep.chunk_count`, `dataprep.file_size_bytes`
**When** I add OpenTelemetry instrumentation to the Reranker service
**Then** Reranker endpoints produce server-side spans with `service.name = "reranker"`
**And** spans include reranking attributes: `reranker.top_k`, `reranker.score_threshold`, `reranker.model_id`
**And** both services export traces via OTLP to the same configurable endpoint
**And** trace context propagation is consistent with stories 7.1 and 7.2
**And** file content and document text are excluded from span attributes (PII protection)
**And** the instrumentation adds <5ms latency overhead per request

### Story 7.4: End-to-End Trace Propagation and Log Correlation

As a developer,
I want trace context propagated across all services and correlated with structured logs,
So that I can trace a user request from frontend → backend → OPEA services and find related log entries.

**Acceptance Criteria:**

**When** a request arrives at the Express backend with a `traceparent` header
**Then** the backend preserves and propagates the trace context to all downstream OPEA service calls
**And** the backend includes `trace_id` and `span_id` in all winston structured log entries
**When** a request flows through ChatQnA → Retriever → Reranker → LLM
**Then** the full chain shares a single `trace_id` visible in all service logs and spans
**And** Python services include `trace_id` and `span_id` in CustomLogger output
**And** log entries are JSON-structured with consistent fields: `timestamp`, `level`, `service`, `trace_id`, `span_id`, `message`
**And** the backend sends `traceparent` header on all outbound HTTP calls to OPEA services
**And** Grafana can correlate traces to logs using `trace_id` as the join key

### Story 7.5: Deploy Observability Stack (Collector + VictoriaMetrics + Grafana)

As a developer,
I want an OTel Collector, VictoriaMetrics, and Grafana deployed alongside the application,
So that telemetry data is collected, stored, and visualized without external SaaS dependencies.

**Acceptance Criteria:**

**When** I add OTel Collector, VictoriaMetrics, and Grafana services to docker-compose.yaml
**Then** the Collector receives OTLP traces from all instrumented services (stories 7.1–7.4)
**And** VictoriaMetrics stores trace metrics with configurable retention (default 30 days)
**And** Grafana queries VictoriaMetrics as its datasource
**And** a pre-configured dashboard shows: request rate, error rate, latency percentiles (p50, p95, p99) per service
**And** a pre-configured dashboard shows: RAG pipeline trace waterfall (backend → embedding → retrieval → reranking → LLM)
**And** the Collector is configured with a healthcheck endpoint
**And** Grafana is accessible on an internal port (not exposed to the public internet)
**And** Grafana requires authentication (admin credentials from `.env`)
**And** all observability services are disabled by default (enabled via `ENABLE_OBSERVABILITY=true` in `.env`)
**And** network policies restrict observability traffic to application services only (no external egress)

## Epic 8: RAG Quality Assurance

The QA engineer runs the RAG quality regression suite against a curated document corpus, sees RAGAS metrics compared against configurable thresholds, and flags quality degradation before release.

### Story 8.1: Create RAG Quality Test Bed and Document Corpus Fixtures

As a QA engineer,
I want a curated document corpus with known QA pairs for RAG quality testing,
So that RAG output quality is measured against a reproducible benchmark.

**Acceptance Criteria:**

**When** I create `tests/fixtures/corpora/el-salvador/`
**Then** the corpus contains test documents in multiple formats (.txt, .md, .pdf, .xlsx, .docx)
**And** `tests/fixtures/corpora/el-salvador/qa-pairs.json` contains curated query-answer pairs
**And** each QA pair has: query, expected answer (or quality bounds), relevant document references
**And** the corpus is version-controlled and committed to the repository
**And** `tests/fixtures/arangodb/` contains ArangoDB collection and graph fixtures for the corpus

### Story 8.2: Create RAGAS Threshold Configuration and Evaluation Pipeline

As a QA engineer,
I want a configurable RAGAS evaluation pipeline with quality thresholds,
So that RAG output quality is measured and compared against defined standards.

**Acceptance Criteria:**

**When** I create `tests/rag-quality/thresholds.json`
**Then** thresholds define: faithfulness >0.95, answer relevance >0.85, context precision >0.80, context recall >0.90
**And** thresholds are configurable per deployment (different countries may have different standards)
**When** I create `tests/rag-quality/evaluate.py`
**Then** the pipeline executes predefined queries against the document corpus
**And** the pipeline computes RAGAS metrics (faithfulness, answer relevance, context precision, context recall)
**And** the pipeline compares scores against thresholds and reports pass/fail per metric
**And** the pipeline handles GPU unavailability gracefully (conditional skip with clear reporting)
**And** a `tests/rag-quality/README.md` documents usage and configuration

### Story 8.3: Create RAG Quality Report Generator

As a QA engineer,
I want the RAG quality suite to produce machine-readable reports,
So that CI pipelines and developers can consume quality results programmatically.

**Acceptance Criteria:**

**When** I create `tests/rag-quality/generate-report.py`
**Then** the generator produces a JSON report with: timestamp, corpus used, per-query scores, overall scores, threshold comparison
**And** the generator produces JUnit XML for GitLab CI test visualization
**And** reports include per-metric pass/fail status and aggregate statistics
**And** reports are version-controlled or uploaded as CI artifacts
**And** the report format is compatible with Sprint 23 MELT ingestion (structured JSON)

## Epic 9: AI-Assisted Test Generation

The developer leverages AI to generate test scaffolding (boilerplate, mock factories, fixture generators) from existing code and receive test case suggestions based on code changes and API specifications.

### Story 9.1: Create AI Test Scaffolding Generator

As a developer,
I want AI to generate test file scaffolding from existing code,
So that writing boilerplate test files is automated and consistent.

**Acceptance Criteria:**

**When** AI generates test scaffolding for a production source file
**Then** the generated file includes correct test runner setup (describe/it for Jest, class/def for pytest, group/test for Dart)
**Then** the generated file includes correct imports using project conventions (CommonJS for backend, Options API for frontend, ITU headers for Python)
**Then** the generated file includes mock setup using centralized mock patterns (closure-based refs for Jest, conftest.py for pytest)
**Then** the generated file includes placeholder AAA structure with descriptive test names
**And** the generated file passes the project's linter (ESLint/Ruff/flutter analyze) without manual fixes
**And** the generated scaffolding follows the AI-Generated Test Rules from the architecture document

### Story 9.2: Create AI Test Case Suggestion Engine

As a developer,
I want AI to suggest test cases based on code changes and API specifications,
So that test coverage gaps are identified automatically.

**Acceptance Criteria:**

**When** AI analyzes a code change (diff or new file)
**Then** it suggests test cases covering: happy path, error cases, edge cases, boundary values
**And** suggestions reference specific functions, endpoints, or components being changed
**When** AI analyzes an API specification (OpenAPI/Swagger)
**Then** it suggests route handler tests for each endpoint with example request/response pairs
**And** suggestions are presented as human-readable descriptions before code generation
**And** human review is required before suggestions become test code (FR46)
