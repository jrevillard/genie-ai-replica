---
prd_key: testing-framework
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
status: complete
inputDocuments:
  - '_bmad-output/project-context.md'
  - 'docs/architecture.md'
  - 'docs/roadmap-sprint-20-to-25.md'
  - 'docs/e2e-tests/README.md'
  - 'docs/keycloak-admin-guide.md'
  - 'docs/docker-compose-setup.md'
  - 'docs/database-migrations.md'
  - 'docs/LOGGING-ARCHITECTURE-EVALUATION.md'
  - 'GitLab Issue #599 - Establish automated test suite for OPEA microservices'
  - '_bmad-output/planning-artifacts/research/technical-identity-provider-integration-research-2026-03-26.md'
documentCounts:
  briefs: 0
  research: 1
  brainstorming: 0
  projectDocs: 8
  gitlabIssues: 1
  projectContext: '_bmad-output/project-context.md'
workflowType: 'prd'
classification:
  projectType: 'Platform Infrastructure / Deployment Verification System'
  domain: 'Govtech — Digital Public Infrastructure (DPI)'
  complexity: 'Very High'
  projectContext: 'Mixed (brownfield application code across 6 country deployments; greenfield quality infrastructure with zero CI/CD)'
  scopeMatrix:
    components:
      - 'gov-chat-backend (Node.js/Express, CommonJS)'
      - 'gov-chat-frontend (Vue 3, Options API)'
      - 'genie-ai-overlay (4 Python/FastAPI OPEA microservices)'
      - 'document-repository (Node.js)'
      - 'genie_ai_mobile (Flutter/Dart)'
    deploymentTargets: ['Docker Compose', 'Docker Swarm', 'Kubernetes']
    testEcosystems: ['Jest', 'pytest', 'Vue Test Utils', 'Flutter test', 'Playwright']
    existingCoverage: 'Sparse — backend auth-only, frontend stores-only, OPEA zero, mobile service-layer-only, E2E auth-only, CI/CD zero'
  testingPhilosophy: >
    Interface-based: treat each layer and component as an interface with specific
    environment and expected outputs. Organized by PCCQ pillars (Pipeline, Contract,
    Configuration, Quality) rather than traditional test levels. Deterministic scaffolding
    tests for contracts and configuration; probabilistic quality bounds for RAG outputs.
    Existing test strategy covers dataprep, retriever, and LLM validation with RAGAS
    framework metrics. El-Salvador branch as canonical test bed.
---

# Product Requirements Document - genie-ai (Testing Framework)

**Author:** God
**Date:** 2026-04-27

## Executive Summary

GENIE.AI is an open-source sovereign RAG framework deployed across 6+ country projects for government digital public infrastructure. Each deployment is a unique configuration of the same codebase — different documents, languages, GPU profiles, and environment variables producing different behavior. This initiative establishes the automated quality assurance infrastructure that enables a small dev/QA team to confidently merge framework changes without risking regression across any active or future deployment.

The primary consumers are the core development and QA team, who must validate that every framework version supports all deployed use cases and new use cases under development. The remit is comparable to OPEA and Haystack — providing the quality assurance foundation that makes a RAG framework trustworthy for citizen-facing government services. Automation is non-negotiable given the surface area: 5 components across 3 languages (Node.js, Python, Dart), 3 deployment targets (Docker Compose, Swarm, Kubernetes), 50+ environment variables with complex interdependencies, and probabilistic RAG outputs that cannot be validated through deterministic assertions alone.

### What Makes This Special

The system under test is not code — it is a *configured deployment*. Correctness is defined as: given configuration X and documents Y, the pipeline produces outputs within quality bounds Z across deployment target T. This demands a testing philosophy organized around four pillars rather than traditional test levels:

- **Pipeline integrity** — data flows correctly through each stage (extraction, chunking, embedding, retrieval, reranking, generation)
- **Contract verification** — every interface between components honors its API contract
- **Configuration validation** — the massive environment variable surface controls system behavior as documented
- **Quality assurance** — RAG outputs meet RAGAS-based thresholds (faithfulness, relevance, context precision/recall) against known document sets

An existing test strategy covers the AI/ML pipeline (dataprep extraction fidelity, retriever hybrid search optimization, LLM grounding and parameter tuning) with detailed parameter sweep matrices for GPU profiles. vLLM was selected as the inference engine to support multi-GPU sharding for large LLMs, though multi-GPU testing is out of scope for the current initiative due to resource constraints. The framework targets any CUDA-compatible GPU hardware (H100, A40, H200, RTX 6000 Ada, Tesla T4, and future-compatible devices), with the aspiration of eventual hardware-agnostic support beyond CUDA where technology permits.

This PRD expands the existing AI/ML test foundation floor-to-ceiling: backend API contracts, frontend component behavior, document repository security, mobile service layer, authentication flows, and a CI/CD pipeline that orchestrates everything from zero. AI is leveraged for test generation and maintenance to maximize coverage with limited team resources.

## Project Classification

| Dimension | Classification |
|-----------|---------------|
| Project Type | Platform Infrastructure / Deployment Verification System |
| Domain | Govtech — Digital Public Infrastructure (DPI) |
| Complexity | Very High |
| Project Context | Mixed (brownfield application code across 6 country deployments; greenfield quality infrastructure with zero CI/CD) |
| Components | gov-chat-backend (Node.js/Express), gov-chat-frontend (Vue 3), genie-ai-overlay (4 Python/FastAPI OPEA microservices), document-repository (Node.js), genie_ai_mobile (Flutter/Dart) |
| Deployment Targets | Docker Compose, Docker Swarm, Kubernetes |
| GPU Hardware | Any CUDA-compatible device (H100, A40, H200, RTX 6000 Ada, Tesla T4); multi-GPU sharding supported by vLLM but out of scope for initial testing |
| Test Ecosystems | Jest, pytest, Vue Test Utils, Flutter test, Playwright |
| Observability (Sprint 23) | MELT Provider API (Metrics, Events, Logs, Traces) — VictoriaMetrics + Grafana + OpenTelemetry; Issues #354, #355-#361, #589-#591 |

## Success Criteria

### User Success

- A developer merges a PR and the CI pipeline runs the full test suite automatically, reporting pass/fail across all components within a configured time budget — no manual testing required
- A QA engineer runs a single command to execute the full verification suite against a local Docker Compose environment, seeing clear pass/fail results for pipeline integrity, contract compliance, configuration validation, and RAG quality thresholds
- A deployment engineer for a new country project runs the verification suite against their specific document corpus and configuration, receiving a quality report confirming the deployment is production-ready
- When tests fail, the developer can trace the failure through the full request path using MELT distributed traces — a single trace ID linking logs across Kong, Backend, ChatQnA, Retriever, and LLM services
- The team leverages AI-assisted test generation to produce new test cases from code changes, reducing the manual test authoring burden

### Business Success

- Sprint 24 ChatQnA refactoring proceeds with regression safety — the test suite catches breaking changes before they reach any deployment
- Sprint 24 agentic workflows (multi-step processes spanning multiple MCP servers) are debuggable through MELT distributed tracing
- New country onboarding time decreases as the verification framework provides automated validation of deployment correctness
- The framework serves as a quality gate for all merges, reducing production incidents caused by configuration drift or interface breakage across 6+ active country deployments
- The test infrastructure positions GENIE.AI for DPG compliance verification as the project matures

### Technical Success

- CI/CD pipeline runs on every merge request: unit tests, contract tests, and configuration validation as mandatory gates
- Integration tests run against deployed infrastructure (Docker Compose baseline) on a scheduled basis
- RAG quality regression suite produces RAGAS scores against the El-Salvador test bed, flagging degradation before release
- All 5 components have test coverage: backend (Jest), frontend (Vue Test Utils), OPEA microservices (pytest), document-repository (Jest), mobile (Flutter test)
- Test execution is deterministic and reproducible — same inputs produce same results across runs
- The test framework is adaptable to future GPU hardware and multi-GPU sharding configurations without architectural rework
- Test instrumentation interoperates with the MELT Provider API (Sprint 23) — test frameworks consume structured JSON logs, distributed trace context, and metrics from the same telemetry pipeline that powers production observability

### MELT Integration (Testing x Observability Synergy)

The MELT framework (Sprint 23, Issues #354-#361, #589-#591) transforms testing from pass/fail assertions into full-lifecycle quality intelligence:

**Testing enables MELT:** Test execution produces structured telemetry (results as events, assertion counts as metrics, traces as spans) feeding the same VictoriaMetrics + Grafana stack used for production monitoring.

**MELT enables testing:** Distributed traces turn a failing E2E test from "request timed out" into "retriever span took 12s because ArangoDB query hit graph traversal depth 4." Structured JSON logs enable programmatic log assertion — assert on structure, not parse plain text.

**MELT Provider API as test utility:** Test suites query MELTService post-execution to verify error logs were emitted for expected failures, trace spans completed within latency thresholds, and metrics stayed within bounds.

**Dependency alignment:** Issue #601 depends on "Sprint 22 test framework (test instrumentation)." The testing framework must establish instrumentation hooks that Sprint 23 builds upon — test fixtures producing trace context, assertion helpers validating log output, metric collection patterns feeding VictoriaMetrics.

### Measurable Outcomes

| Metric | Target | Measurement |
|--------|--------|-------------|
| Component test coverage (floor-to-ceiling) | All 5 components with test suites | Test files exist and pass for each component |
| CI pipeline gate coverage | Unit + contract + config validation on every MR | Pipeline runs and blocks on failure |
| RAG quality regression | RAGAS scores within thresholds (Faithfulness >0.95, Relevance >0.85, Context Precision >0.80, Context Recall >0.90) | Automated scoring against El-Salvador test bed |
| Configuration validation | All env vars documented, defaults validated, interdependencies checked | Static analysis + integration verification |
| Deployment target verification | Tests pass against Docker Compose baseline | Automated test matrix |
| Test execution time (unit + contract) | <10 minutes total | CI pipeline timing |
| E2E test execution time | <30 minutes | CI pipeline timing |
| MELT-ready test output | Test results consumable as structured events via OTel | Test framework emits OTel-compatible telemetry |

## Product Scope

### MVP - Minimum Viable Product

- CI/CD pipeline (GitLab CI) with unit test, contract test, and configuration validation gates
- Backend test suite: API route contracts, service layer unit tests, middleware tests
- Frontend test suite: component tests for critical UI flows, store/service tests
- OPEA microservice test suite: pytest for retriever, dataprep, reranker, core (interface tests with mocked dependencies)
- Document-repository test suite: route handler tests, middleware tests
- Configuration validation suite: env template schema validation, docker-compose var coverage
- Mobile test suite: existing service-layer tests integrated into CI
- Test instrumentation patterns: structured log assertions, trace context propagation in test fixtures (MELT-ready hooks for Sprint 23)

### Growth Features (Post-MVP)

- RAG quality regression suite with RAGAS scoring against El-Salvador test bed
- Integration tests against deployed Docker Compose environment
- Swarm deployment target verification
- E2E Playwright expansion beyond auth flows (chatbot, document upload, admin)
- AI-assisted test generation and maintenance tooling
- Kubernetes deployment target verification
- Performance benchmarking (latency, throughput) per the existing test strategy
- MELT-powered test diagnostics: query traces/logs/metrics from test runs via MELT Provider API
- Test health dashboards in Grafana alongside service health dashboards

### Vision (Future)

- Multi-GPU sharding test coverage
- Hardware-agnostic GPU testing (beyond CUDA where technology permits)
- Country-specific test beds with per-deployment RAG quality verification
- Automated test generation from OpenAPI specs and code changes
- Chaos engineering tests for deployment resilience
- SBOM/SLSA compliance test integration
- Contract testing with Pact for inter-service boundaries
- MELT-driven continuous quality validation: metrics from test runs feed anomaly detection, alerting on degradation trends, and automated regression detection without explicit test cases

## User Journeys

### Journey 1: Developer Merges a Feature Branch (Happy Path)

**Alex** is a backend developer who just finished refactoring the ChatQnA service interface. They push to a feature branch and open a merge request.

The CI pipeline triggers automatically. Within minutes, Alex sees the pipeline status: backend unit tests pass, contract tests pass, configuration validation passes. But the OPEA microservice integration test fails — the retriever is returning a different response shape after the refactor. Alex clicks into the failing test, sees the exact assertion that failed and the actual vs. expected response. They fix the interface mismatch, push again, and the full pipeline goes green. They merge with confidence.

### Journey 2: QA Engineer Validates a Release Candidate (Edge Case)

**Sam** is preparing the v2.x release for the El-Salvador deployment. They run the full verification suite locally against Docker Compose. The RAG quality regression suite executes 100 queries against the El-Salvador document corpus. The RAGAS report shows Faithfulness at 0.96, Answer Relevance at 0.87 — both above threshold. But Context Precision drops to 0.78, below the 0.80 target. Sam investigates: a recent chunking parameter change in dataprep caused slightly broader retrieval. They flag this for the team, document the regression, and the release proceeds with a known issue tracked for the next sprint.

### Journey 3: DevOps Engineer Onboards a New Country (Operations)

**Priya** is setting up GENIE.AI for a new government deployment in Southeast Asia. The documents are in a mix of English and the local language, and the GPU hardware is an A40.

Priya follows the installation guide, configures the `.env` file for the A40 profile, and runs the configuration validation suite. It flags two issues: `VLLM_MAX_MODEL_LEN` is set to 32768 (too high for the A40's 48GB with the selected model), and `DOCUMENT_INGESTION_LANGUAGE` is set to `en` but the document corpus includes local-language files. Priya corrects both, validation passes, and she proceeds with document ingestion and quality verification.

### Journey 4: Developer Debugs a Multi-Service Failure (MELT-Enabled Troubleshooting)

**Marcus** sees that an E2E test for the full RAG pipeline is failing intermittently — "request timed out after 30s."

After Sprint 23's MELT rollout, Marcus doesn't just see a timeout. The test framework captures the OTel trace context from the failed request. Marcus queries the MELT Provider API and sees the full trace waterfall: Kong forwarded in 5ms, Backend processed in 12ms, ChatQnA received the request, but the Retriever span shows a 28s ArangoDB query hitting a graph traversal depth of 4. The test fixture had stale test data that created an unexpectedly deep graph. Marcus updates the fixture, the test passes consistently, and the trace data is archived as part of the test report.

### Journey 5: Team Lead Reviews Test Health Dashboard (MELT-Enabled Visibility)

**David** opens Grafana and sees the Test Health dashboard alongside Service Health — one pane of glass. The dashboard shows: 847 tests across 5 components, 99.4% pass rate over 7 days. One test is flaky — `retriever-hybrid-search` fails intermittently on Friday afternoons. The error logs panel shows the failure correlates with ArangoDB compaction cycles. David creates a task to add a retry decorator and isolate the test from compaction timing.

### Journey Requirements Summary

| Journey | Key Capabilities |
|---------|-----------------|
| Developer merges feature | CI pipeline, per-component stages, fast feedback, clear failure reporting |
| QA validates release | Local execution, RAGAS scoring, threshold comparison, regression tracking |
| DevOps onboards country | Config validation, hardware-aware checks, env interdependency checks, corpus-specific verification |
| Developer debugs failure | OTel trace context in tests, MELT Provider API diagnostics, trace-linked reporting |
| Team lead reviews health | Test telemetry in Grafana, flaky test detection, execution time trends |

## Domain-Specific Requirements

### Compliance & Regulatory

- DPG (Digital Public Goods) compliance — the framework must produce verification artifacts demonstrating reliability for sovereign deployments
- SBOM/SLSA Level 2 supply chain security (on the roadmap for future sprints)
- ISO 42001 (AI Management System) alignment from the GovStack AI Readiness Guide
- OpenAPI 3.1 contract compliance for all service interfaces
- RFC 9457 error format compliance (already enforced — `{ error, message, details }` format)

### Technical Constraints

- Keycloak OIDC authentication — tests validate JWT claims (`iss_sub`, `sub`, `iss`), not `_key`
- ArangoDB multi-model database (document + graph + vector) — test fixtures handle graph relationships, vector embeddings, and edge collections
- vLLM/TEI GPU-dependent services — tests account for GPU availability in CI (mock or conditional skip)
- Kong API gateway — tests validate routing, rate limiting, and OTel plugin behavior
- Docker Swarm placement constraints (`gateway=true`, `gpu=true`, `genieai=true` labels)
- OpenTelemetry Collector as universal telemetry pipeline — test instrumentation is OTel-compatible
- Multi-language telemetry parity — Node.js and Python JSON logs share a common schema for OTel ingestion

### GENIE.AI Overlay Architecture

The RAG backend is a custom overlay built on the OPEA framework, deviating significantly from standard OPEA component implementations. GENIE.AI implements a proprietary hybrid RAG approach combining vectors, graph RAG, and labels — with custom ingestion, custom dataprep, and custom retrieval pipelines:

- OPEA ServiceOrchestrator is the orchestration layer, but service implementations are GENIE.AI-specific
- Contract tests validate against GENIE.AI's custom interfaces, not standard OPEA component contracts
- Hybrid retrieval logic (vector similarity + ArangoDB graph traversal + label-based filtering) is custom with no OPEA equivalent
- Ingestion and dataprep pipelines use custom extraction, chunking, labeling, and embedding strategies
- Test coverage treats these custom components as first-class, not assuming OPEA compatibility

### Domain-Specific Risks

- RAG hallucination in citizen-facing government services — quality thresholds are a safety concern, not just a convenience
- Configuration drift across 6 country deployments — a misconfigured env var can produce incorrect government service information
- GPU resource contention between main LLM and translation model — OOM crashes affect citizen access
- Custom overlay divergence from upstream OPEA — OPEA updates may break GENIE.AI-specific implementations without regression tests catching the breakage

## Innovation & Novel Patterns

### Detected Innovation Areas

**PCCQ Testing Philosophy** — Organizing tests by *what* they validate (Pipeline, Contract, Configuration, Quality) rather than *where* they run (unit, integration, e2e). Standard test pyramids don't map to systems where the same codebase produces different behavior based on environment variables and document corpora.

**Testing Configured Deployments, Not Code** — The system under test is not code with fixed behavior, but a *configured deployment* where correctness means: given configuration X and documents Y, outputs are within quality bounds Z across deployment target T. Test fixtures must include env var profiles, document corpora, and deployment target configurations alongside code.

**Probabilistic Quality Gates with RAGAS** — RAGAS metrics (faithfulness >0.95, relevance >0.85, context precision >0.80, context recall >0.90) as automated pass/fail thresholds in a CI pipeline for a government RAG platform. Most RAG deployments rely on manual evaluation; this embeds quality validation into the merge workflow.

**MELT x Testing Convergence** — Test framework and MELT observability platform share the same telemetry pipeline (OTel → VictoriaMetrics → Grafana). Test results are MELT events, test traces are MELT spans, test metrics are MELT metrics. Test health and service health share one pane of glass.

**AI-Leveraged Test Generation** — Using AI to generate and maintain tests across 5 components, 3 languages, and 3 deployment targets to compensate for limited team resources.

### Delivery Timeline

- **Sprint 22 (current):** Testing framework foundation — CI/CD pipeline, component test suites, configuration validation, MELT-ready instrumentation hooks
- **Sprint 23 (next):** Evolve alongside MELT observability platform — MELT-powered test diagnostics, Grafana test health dashboards, OTel trace context integration, AI-assisted test generation tooling

### Validation Approach

- PCCQ pillars validated through the existing RAGAS-based test strategy for the AI/ML pipeline (dataprep, retriever, LLM)
- Configuration-to-output quality validation proven against the El-Salvador test bed
- MELT convergence validated through Sprint 23 integration — test telemetry flows through OTel → VictoriaMetrics → Grafana alongside production telemetry
- AI-generated tests validated against human-authored baselines for coverage parity and false-positive rates

### Risk Mitigation

- PCCQ is a novel organizing principle — mitigated by mapping each pillar to concrete test types with clear examples
- RAGAS thresholds are domain-specific — mitigated by starting with conservative thresholds and tuning against real country deployments
- MELT convergence creates a Sprint 23 dependency — mitigated by designing MELT-ready hooks in Sprint 22 that function independently until Sprint 23's observability stack is available
- AI-generated tests may produce false positives — mitigated by human review before integration into CI

## Platform Infrastructure Specific Requirements

### Technical Architecture

**Test Framework Architecture:** 5 independent test ecosystems (Jest, pytest, Vue Test Utils, Flutter test, Playwright) orchestrated by a unified CI pipeline. Shared test infrastructure: fixtures, mocks, test data, configuration profiles. MELT-ready instrumentation hooks in all test frameworks. AI-assisted test generation tooling to maximize coverage with limited resources.

**CI/CD Pipeline Architecture:** GitLab CI as pipeline orchestrator. Stages: lint → unit tests (per component) → contract tests → configuration validation → integration tests (scheduled). Mandatory gates on merge requests: lint, unit, contract, config validation. Scheduled gates: integration tests, RAG quality regression. JUnit XML report artifacts for all test runners.

**Configuration Testing Architecture:** Env template schema generation from the `env` file (50+ variables with interdependencies). Hardware profile validation (GPU type → valid parameter ranges for vLLM/TEI). Deployment target validation (Compose vs Swarm vs K8s configuration differences). Feature flag interdependency validation (`DEPLOY_OPEA=0/1` changes expected service topology).

**RAG Quality Testing Architecture:** El-Salvador branch as canonical test bed with curated document corpus and QA pairs. RAGAS metric computation pipeline (faithfulness, relevance, context precision, context recall). Quality threshold enforcement as CI gates for release candidates. Parameter sweep infrastructure per existing test strategy (chunk size, label thresholds, retrieval K values, graph traversal depth).

**Test Data Management:** Version-controlled test fixtures per component (mocks, stubs, factory data). Document corpus fixtures for RAG quality testing (multi-format: .txt, .md, .pdf, .xlsx, .docx). ArangoDB test database snapshots with controlled graph structures and vector embeddings. Environment-specific configuration profiles for deployment targets and GPU hardware.

### Component-Specific Test Requirements

**gov-chat-backend (Node.js/Express, CommonJS):** Jest with `__tests__/*.test.js` convention. Supertest for route handler integration tests (requires `createApp()` export from `index.js`). Mock ArangoDB, Redis, Keycloak, and OPEA service calls via `__tests__/mocks/`. API contract tests validating request/response schemas per route.

**gov-chat-frontend (Vue 3, Options API):** Jest + @vue/test-utils with `src/__tests__/*.test.js` convention. Component tests for critical UI flows (ChatBotComponent, NavBarComponent, UserProfileComponent). Vuex store tests (extend existing coverage). Service tests with mocked HTTP responses. Options API constraints: `mount()` with full store setup, no Composition API patterns.

**genie-ai-overlay (Python/FastAPI, OPEA custom overlay):** pytest with `tests/*.py` convention. httpx ASGI test client for FastAPI endpoint testing. Interface tests with mocked dependencies (ArangoDB, Redis, vLLM, TEI). Custom overlay-specific tests: hybrid retrieval logic (vector + graph + labels), custom ingestion pipeline, custom dataprep. Copyright headers required on all test files.

**document-repository (Node.js):** Jest with Supertest for route handler tests. File upload/download/delete endpoint tests. ClamAV integration tests (EICAR test file). Metadata and label service tests (extend existing coverage to route integration).

**genie_ai_mobile (Flutter/Dart):** flutter_test with existing service-layer tests (~104 tests) integrated into CI pipeline. `flutter test` execution in CI with result reporting.

### Implementation Prerequisites

- **Backend testability:** `components/gov-chat-backend/index.js` (1,193 lines) does not export `createApp()`. Route handler integration tests require this export. This refactor is a prerequisite task with its own tests.
- **Existing test assessment:** 8 backend test files (auth-only), 8 frontend test files (stores-only, 0% components), 8 document-repository test files (helpers-only), 8 mobile test files (service-layer, good quality), 12 E2E Playwright specs (auth-only), 0 OPEA tests. Existing tests must be assessed (keep/extend/rewrite) before building new suites.
- **GPU-dependent tests in CI:** Standard CI runners lack GPUs. OPEA interface tests use mocked dependencies; GPU integration tests run in scheduled pipelines against deployed infrastructure.

## Project Scoping & Phased Development

### MVP Strategy

**MVP Approach:** Platform MVP — deliver the CI/CD pipeline foundation and per-component test suites that establish the quality gate for all merges. Without this, Sprint 24's ChatQnA refactoring and Sprint 23's MELT instrumentation have no regression safety net.

**MVP Philosophy:** The minimum that makes a developer say "I can merge with confidence." Lint passes, unit tests pass, contract tests pass, configuration validation passes — all automated, all on every MR. Anything beyond that is Phase 2.

### MVP Feature Set (Phase 1) — Sprint 22

**Core Journeys Supported:** Journey 1 (Developer merges feature), Journey 3 (DevOps onboards country — config validation only)

1. **CI/CD Pipeline (GitLab CI):** Lint, unit test, contract test, configuration validation stages. JUnit XML artifacts. MR blocking on failure.
2. **Backend Test Suite:** Prerequisite `createApp()` refactor. API route contracts (all route groups). Service layer unit tests (extend beyond auth). Middleware tests.
3. **Frontend Test Suite:** Component tests (ChatBot, NavBar, UserProfile). Vuex store module tests. Service tests with mocked HTTP.
4. **OPEA Microservice Test Suite:** pytest setup. Retriever interface tests (hybrid search, mocked ArangoDB). Dataprep interface tests (extraction, chunking). Reranker interface tests. Core type/protocol tests. Custom overlay-specific tests.
5. **Document-Repository Test Suite:** Route handler tests (upload, download, search, delete). Security tests (ClamAV, file type validation). Extended service tests.
6. **Configuration Validation Suite:** Env template schema validation. Docker-compose var coverage. Hardware profile parameter ranges. Feature flag interdependencies.
7. **Mobile Test Suite:** Existing ~104 service-layer tests integrated into CI.
8. **MELT-Ready Instrumentation Hooks:** Structured test output formats (JSON, JUnit XML). Trace context propagation patterns in fixtures. Log assertion helpers.

### Post-MVP Features (Phase 2) — Sprint 23

**Core Journeys Supported:** Journey 2 (QA validates release), Journey 4 (Developer debugs failure), Journey 5 (Team lead reviews health)

- RAG quality regression suite with RAGAS scoring (El-Salvador test bed)
- Integration tests against deployed Docker Compose environment
- Swarm deployment target verification
- E2E Playwright expansion (chatbot, document upload, admin flows)
- MELT-powered test diagnostics (query traces/logs/metrics via MELT Provider API)
- Test health dashboards in Grafana alongside service health
- AI-assisted test generation and maintenance tooling
- Performance benchmarking per existing test strategy

### Expansion Features (Phase 3) — Sprint 24+

- Kubernetes deployment target verification
- Multi-GPU sharding test coverage
- Country-specific test beds with per-deployment RAG quality verification
- Automated test generation from OpenAPI specs and code changes
- Chaos engineering tests for deployment resilience
- SBOM/SLSA compliance test integration
- Contract testing with Pact for inter-service boundaries
- MELT-driven continuous quality validation (anomaly detection, degradation trending)

### Risk Mitigation Strategy

**Technical Risks:**
- **Backend `index.js` refactor** — Extracting `createApp()` from 1,193 lines could introduce regressions. Mitigation: refactor is a prerequisite task with its own tests.
- **GPU-dependent tests in CI** — Standard runners lack GPUs. Mitigation: OPEA interface tests use mocked dependencies; GPU integration tests run in scheduled pipelines.
- **5 test ecosystem coordination** — Different runners, assertion libraries, report formats. Mitigation: GitLab CI orchestrates all; JUnit XML is universal report format; <10 min time budget keeps CI fast.
- **Existing test debt** — Some tests may be outdated after refactoring. Mitigation: assess all existing tests (keep/extend/rewrite) before building new suites.

**Resource Risks:**
- **Limited team, no dedicated QA** — AI-assisted test generation must compensate. Mitigation: prioritize highest-ROI tests first (config validation, API contracts).
- **Sprint 22 timeline** — Sprint ends May 31. Mitigation: MVP scope focused on CI pipeline + per-component unit/contract tests; RAG quality and integration tests defer to Sprint 23.

**Dependency Risks:**
- **Sprint 23 MELT dependency** — Issue #601 depends on Sprint 22 test instrumentation. Mitigation: MELT-ready hooks in Sprint 22 function independently until Sprint 23's stack is available.
- **Sprint 24 ChatQnA refactoring** — Issue #599 blocks this work. Mitigation: backend test suite (especially ChatQnA contracts) is an MVP priority.

## Functional Requirements

### Continuous Integration & Pipeline Orchestration

- FR1: The CI pipeline runs lint checks across all JavaScript, Python, and Dart components on every merge request
- FR2: The CI pipeline executes unit tests for all 5 components (backend, frontend, OPEA microservices, document-repository, mobile) on every merge request
- FR3: The CI pipeline executes contract tests validating API request/response schemas on every merge request
- FR4: The CI pipeline executes configuration validation tests on every merge request
- FR5: The CI pipeline blocks merge requests when any mandatory test stage fails
- FR6: The CI pipeline produces JUnit XML test reports as artifacts for all test runners
- FR7: The CI pipeline executes integration tests on a scheduled basis against deployed infrastructure
- FR8: The CI pipeline executes RAG quality regression tests on a scheduled basis

### Backend Verification (gov-chat-backend)

- FR9: The test suite validates API route contracts for all route groups (auth, chat, analytics, admin, files, categories)
- FR10: The test suite verifies service layer business logic for all backend services (not limited to auth)
- FR11: The test suite validates middleware behavior (authentication, authorization, error handling, rate limiting)
- FR12: The test suite tests route handlers via HTTP requests against an in-memory Express application

### Frontend Verification (gov-chat-frontend)

- FR13: The test suite validates component rendering and user interaction for critical UI components (ChatBot, NavBar, UserProfile)
- FR14: The test suite verifies Vuex store state management for all store modules
- FR15: The test suite validates HTTP service interactions with mocked API responses
- FR16: The test suite verifies authentication state transitions and token management in the UI

### OPEA Microservice Verification (genie-ai-overlay)

- FR17: The test suite validates the retriever's hybrid search logic (vector similarity, graph traversal, label filtering) with mocked ArangoDB
- FR18: The test suite validates the dataprep extraction pipeline (multi-format parsing, chunking, labeling) with mocked dependencies
- FR19: The test suite validates the reranker's score validation and top-K constraint enforcement with mocked TEI
- FR20: The test suite validates core type definitions, protocols, and constants
- FR21: The test suite validates custom overlay interfaces that deviate from standard OPEA component contracts

### Document Repository Verification

- FR22: The test suite validates file upload, download, search, and delete endpoint behavior
- FR23: The test suite verifies security middleware (ClamAV virus scanning, file type validation, authentication)
- FR24: The test suite validates metadata and label service business logic

### Mobile Verification (genie_ai_mobile)

- FR25: The test suite executes existing service-layer tests (~104 tests) within the CI pipeline
- FR26: The test suite reports Flutter test results in a CI-compatible format

### Configuration Validation

- FR27: The validation suite verifies that all environment variables referenced in docker-compose are documented in the env template
- FR28: The validation suite verifies that required environment variables have no undefined defaults
- FR29: The validation suite detects conflicting or orphaned environment variable configurations
- FR30: The validation suite validates environment variable values against hardware-specific parameter ranges (GPU profiles)
- FR31: The validation suite verifies feature flag interdependencies (e.g., `DEPLOY_OPEA` affecting expected service topology)

### RAG Quality Verification

- FR32: The quality suite executes predefined queries against a known document corpus and measures retrieval accuracy
- FR33: The quality suite computes RAGAS metrics (faithfulness, answer relevance, context precision, context recall) for RAG pipeline outputs
- FR34: The quality suite compares RAGAS scores against configurable thresholds and reports pass/fail
- FR35: The quality suite validates RAG pipeline stage integrity (embedding dimensions, reranker top-K, retriever score thresholds)

### Test Data & Fixture Management

- FR36: The framework provides version-controlled test fixtures (mocks, stubs, factory data) for each component
- FR37: The framework provides test document corpora in multiple formats (.txt, .md, .pdf, .xlsx, .docx) for RAG quality testing
- FR38: The framework provides controlled ArangoDB test database states (graph structures, vector embeddings) for integration tests
- FR39: The framework provides environment-specific configuration profiles for different deployment targets and GPU hardware

### MELT Integration (Sprint 23 Evolution)

- FR40: The test framework produces structured output (JSON, JUnit XML) consumable by the OpenTelemetry pipeline
- FR41: The test framework propagates OTel trace context in test fixtures for distributed trace correlation
- FR42: The test framework provides assertion helpers for validating structured JSON log output from services under test
- FR43: Test execution results are queryable via the MELT Provider API for post-test diagnostics
- FR44: Test health metrics (pass rates, execution times, flaky test detection) are visualizable in Grafana dashboards

### AI-Assisted Test Generation

- FR45: The framework leverages AI to generate test scaffolding (boilerplate test files, mock factories, fixture generators) from existing code
- FR46: The framework leverages AI to suggest test cases based on code changes and API specifications

## Non-Functional Requirements

### Performance

- NFR1: Unit and contract test stages complete in under 10 minutes total on every merge request
- NFR2: Configuration validation completes in under 2 minutes
- NFR3: Full E2E test suite (Playwright) completes in under 30 minutes
- NFR4: Individual component test suites execute in isolation without waiting for other components (parallel execution where possible)
- NFR5: RAG quality regression suite completes in under 60 minutes against a deployed environment

### Reliability & Determinism

- NFR6: All unit and contract tests produce identical results across repeated executions with the same inputs (no flaky tests in mandatory CI gates)
- NFR7: Test execution is independent of execution order — no test depends on side effects from another test
- NFR8: Tests requiring external services (ArangoDB, Redis, Keycloak, vLLM) use mocked dependencies in CI; real service integration runs only in scheduled pipelines against deployed infrastructure
- NFR9: GPU-dependent tests are conditionally skipped in CI environments without GPU access, with clear skip reporting
- NFR10: Test fixtures are version-controlled and produce reproducible results across environments

### Maintainability

- NFR11: Test code follows the same linting and formatting standards as production code (ESLint, Ruff, Flutter analyze)
- NFR12: Test file structure mirrors the production code structure within each component
- NFR13: Mock and fixture definitions are centralized in `__tests__/mocks/` (backend, frontend) and `tests/` (Python) directories, not duplicated across test files
- NFR14: AI-assisted test generation produces code that passes linting and follows project conventions
- NFR15: Adding a new test for an existing feature requires changes in only one file (the test file) — no cross-file fixture setup for standard cases

### Compatibility

- NFR16: The CI pipeline operates identically across GitLab shared runners and self-hosted runners
- NFR17: All test runners produce JUnit XML reports in a format consumable by GitLab CI test reporting
- NFR18: The test framework supports execution in Docker Compose, Docker Swarm, and Kubernetes environments
- NFR19: Python tests run on Python 3.10+; Node.js tests run on Node.js 18+; Dart tests run on Flutter 3.10+
- NFR20: Test output formats are compatible with OpenTelemetry ingestion (structured JSON, trace context propagation) for MELT integration in Sprint 23

### Language & Framework Constraints

- NFR21: Backend tests use CommonJS module syntax exclusively (no ESM imports)
- NFR22: Frontend component tests use Options API exclusively (no Composition API patterns)
- NFR23: Python test files include ITU copyright headers as required by project convention
- NFR24: All Python test code passes Ruff linting and formatting checks
