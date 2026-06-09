---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/project-context.md'
  - 'docs/architecture.md'
  - 'docs/LOGGING-ARCHITECTURE-EVALUATION.md'
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-04-28'
project_name: 'genie-ai'
user_name: 'God'
date: '2026-04-28'
---

# Architecture Decision Document — Testing Framework

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

46 functional requirements across 10 categories:

| Category | FRs | Scope |
|---|---|---|
| **Pipeline** | FR1–FR8 | CI/CD orchestration: lint, unit, config, integration, RAG quality gates |
| **API Testing** | FR9–FR26 | Per-component API and interface verification across all 5 components |
| **Configuration** | FR27–FR31 | Env var schema validation, hardware profiles, feature flag interdependencies |
| **Quality** | FR32–FR35 | RAGAS-based RAG output quality against known document corpora |
| **Infrastructure** | FR36–FR44 | Test data management, MELT instrumentation, AI-assisted generation |
| **AI Generation** | FR45–FR46 | AI-leveraged test scaffolding and suggestion from code changes |

The requirements treat each component as an interface with specific environment expectations and output — consistent with the "testing configured deployments" philosophy. No requirement assumes code-level fixed behavior; all account for environment-driven variance.

**Non-Functional Requirements:**

24 NFRs with three hard constraints that shape architecture:

1. **Time budgets** (NFR1–NFR5): Unit <10 min, config <2 min, E2E <30 min, RAG quality <60 min. These force strict parallelization in CI and tiered execution (mandatory gates vs. scheduled).
2. **Determinism** (NFR6–NFR10): Zero flaky tests in mandatory gates, order-independent execution, mocked external dependencies in CI, conditional GPU test skipping. This requires robust fixture isolation and mock architecture.
3. **Language constraints** (NFR21–NFR24): CommonJS-only backend, Options API-only frontend, ITU copyright headers on Python, Ruff compliance. These constrain test tooling choices and code generation templates.

**Scale & Complexity:**

- Primary domain: Platform Infrastructure / Deployment Verification System
- Complexity level: Very High
- Estimated architectural components: ~12

### Technical Constraints & Dependencies

**Codebase Blocking Issues:**

| Blocker | Component | Impact | Resolution |
|---|---|---|---|
| `index.js` does not export `createApp()` | gov-chat-backend | Cannot test route handlers without starting server; Supertest unusable | Prerequisite refactor task (FR12) with own tests |
| `comps` library vendored at build time | genie-ai-overlay | Cannot pip-install OPEA deps locally; `docarray` → `opea_docarray` rename | All OPEA deps mocked; interface tests only |
| `shared/lib/db-connection-service.js` frozen singleton | gov-chat-backend | Auto-creates ArangoDB on import; side effects break test isolation | Module-level mock via `moduleNameMapper` |
| Zero CI/CD pipeline exists | All components | No automated gates, no test orchestration, no artifact collection | Build from scratch (FR1–FR8) |

**Test Ecosystem Coordination:**

| Component | Runner | Convention | Existing Tests | Coverage Gap |
|---|---|---|---|---|
| gov-chat-backend | Jest + Supertest | `__tests__/*.test.js` | 8 files, 3,633 lines (auth-only) | All route handlers, all non-auth services, all middleware |
| gov-chat-frontend | Jest + @vue/test-utils | `src/__tests__/*.test.js` | 8 files, 2,688 lines (stores/services only) | All 38 Vue components (0%), 16 services |
| genie-ai-overlay | pytest (not configured) | `tests/*.py` | 0 files | All 5,018 lines of Python across 4 services + core |
| document-repository | Jest + Supertest | `__tests__/*.test.js` | 8 files, 1,274 lines (helpers only) | Route handlers, fileService, route-level integration |
| genie_ai_mobile | flutter_test | `test/*.dart` | 8 files, ~104 tests (service-layer) | All 15 proxy services, all UI widgets, integration |
| E2E | Playwright | `e2e/**/*.spec.js` | 13 files, 1,077 lines (auth-only) | Chatbot, document upload, admin, search flows |

**Environment Variable Surface:**

The `env` template contains 50+ variables across 13 sections with complex interdependencies:
- 13 required secrets (no defaults in code) — `ARANGO_PASSWORD`, `KEYCLOAK_*`, `KONG_*`, `EMAIL_*`
- GPU-specific profiles (`env.t4`, `env.rtx6000`) override memory, model length, TEI image, batch settings
- Feature flag `DEPLOY_OPEA` controls whether 5 services exist in the topology
- Multi-node variable overrides in Section 12 of the env template
- No validation exists — a single typo can produce incorrect behavior across a country deployment

**Deployment Target Matrix:**

| Target | CI Execution | GPU Access | Test Scope |
|---|---|---|---|
| Docker Compose | Scheduled integration | Optional (local) | Full stack integration, RAG quality |
| Docker Swarm | Scheduled | Self-hosted runner | Placement constraints, service topology |
| Kubernetes | Future (Sprint 24+) | Self-hosted runner | Helm chart validation, K8s-native features |

### Cross-Cutting Concerns Identified

1. **Application Observability (OTel)** — Application services (Express backend, FastAPI/OPEA) emit OTel-compatible distributed traces and structured logs from Sprint 22. W3C traceparent header propagation links spans across services. Shared JSON log schema includes `trace_id` and `span_id` for log-trace correlation. Issue #601 (Sprint 23) builds the MELT Provider API on top of this foundation.

2. **Configuration-as-Test-Input** — Every test must account for env var profiles as first-class inputs. The same codebase produces different behavior based on `DEPLOY_OPEA`, GPU profiles, language settings, and document corpora. Test fixtures include env var profiles alongside mocks and stubs.

3. **Custom OPEA Overlay Divergence** — GENIE.AI's hybrid RAG (vector + graph + labels) has no OPEA equivalent. Tests validate against GENIE.AI-specific interfaces. OPEA upstream updates may break custom implementations without regression tests catching the breakage.

4. **Multi-Language Telemetry Parity** — Node.js (winston JSON) and Python (CustomLogger structured JSON) must share a common log schema for OTel ingestion. Test assertion helpers must validate structured log output from both languages.

5. **GPU-Conditional Test Execution** — Standard CI runners lack GPUs. OPEA interface tests use mocked vLLM/TEI dependencies. GPU integration tests (RAG quality, performance benchmarks) run in scheduled pipelines against deployed infrastructure with conditional skip reporting.

6. **Existing Test Debt Assessment** — Before building new suites, all existing tests must be assessed (keep/extend/rewrite). Some tests may be outdated after prerequisite refactors (e.g., `createApp()` extraction may invalidate existing backend test patterns).

7. **AI-Assisted Generation Guardrails** — AI-generated tests must pass linting (ESLint, Ruff, Flutter analyze), follow project conventions (CommonJS, Options API, ITU headers), and be human-reviewed before CI integration. False positives from AI generation are a documented risk.

8. **Probabilistic Quality Validation** — RAGAS metrics for RAG outputs are inherently non-deterministic. Thresholds must be conservative initially and tuned against real country deployments. Quality gates for citizen-facing government services carry higher stakes than typical software quality validation.

## Starter Template Evaluation

### Primary Technology Domain

Platform Infrastructure / Deployment Verification System — adding test infrastructure to an existing brownfield codebase with 5 components across 3 languages (Node.js, Python, Dart). No greenfield starter template applies; instead, we adopt existing test runner configurations and configure the missing ones.

### Existing Foundation Assessment

Three of five components already have established test runner configurations. One has no test infrastructure at all. The CI/CD pipeline must be built from scratch.

**Adopt (existing, working configurations):**
- **Jest 29.x** for backend, frontend, and document-repository — already configured with appropriate environments (node/jsdom), test matchers, and transforms. Upgrade path to Jest 30 available but not required for MVP.
- **flutter_test** for mobile — SDK-bundled, 8 test files with ~104 passing tests.
- **Playwright** for E2E — configured with Chromium, HTTPS, and auth helper modules.

**Create from scratch:**
- **pytest** for genie-ai-overlay — zero test infrastructure exists. Must configure pytest, add test dependencies (httpx, pytest-asyncio, pytest-cov), establish `tests/` directory structure, and add ITU copyright headers.
- **GitLab CI** pipeline — zero CI/CD exists. Must build `.gitlab-ci.yml` from scratch with stages, per-component jobs, artifact collection, and merge request gates.

### Test Framework Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend test runner | Jest 29.x (existing) | Already configured, 8 test files pass. Add `jest-junit` for CI reporting. |
| Frontend test runner | Jest 29.x (existing) | Already configured with vue3-jest transform. Add `jest-junit` for CI reporting. |
| Document-repository test runner | Jest 29.x (existing) | Already configured with coverage and moduleNameMapper. Add `jest-junit` for CI reporting. |
| OPEA test runner | pytest 9.x (new) | Industry standard for Python/FastAPI. Built-in JUnit XML. `httpx.AsyncClient` for ASGI testing. |
| Mobile test runner | flutter_test (existing) | SDK-bundled, no alternative needed. Add `junitreport` package for CI XML output. |
| E2E test runner | Playwright (existing) | Already configured. Add built-in `junit` reporter for CI. |
| CI/CD orchestrator | GitLab CI (new) | Platform is GitLab (opensource.unicc.org). Native MR integration, JUnit artifact visualization, path-based triggers. |

### JUnit XML Reporting (Universal CI Artifact)

All test runners must produce JUnit XML for GitLab CI's built-in test visualization:

| Runner | Mechanism | Configuration |
|---|---|---|
| Jest (×3 components) | `jest-junit` v17 | `--reporters=jest-junit`, output to `reports/jest-*.xml` |
| pytest | Built-in `junitxml` | `--junitxml=reports/pytest-report.xml` |
| flutter_test | `junitreport` package | `flutter test --machine \| tojunit --output reports/flutter-report.xml` |
| Playwright | Built-in `junit` reporter | `reporter: [['junit', { outputFile: 'reports/playwright-report.xml' }]]` |

### Dependency Additions Required

**Backend, Frontend, Document-Repository (per component):**
- `jest-junit: ^17.0.0` — JUnit XML report generation

**genie-ai-overlay (new):**
- `pytest` — test runner
- `pytest-asyncio` — async test support for FastAPI
- `pytest-cov` — coverage reporting
- `httpx` — ASGI test client for FastAPI endpoints
- `asgi-lifespan` — lifespan event support for FastAPI test fixtures
- `ruff` — already configured for linting

**Mobile:**
- `junitreport` — JUnit XML output from flutter test

**Root (CI):**
- `.gitlab-ci.yml` — new file, full pipeline definition

### No External Starter Template Selected

No third-party starter template or boilerplate is used. The testing framework is built directly onto the existing codebase using each component's established test runner. This avoids framework version conflicts, respects existing conventions (CommonJS, Options API, ITU headers), and ensures tests run in the same environment as production code.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- CI/CD pipeline stage structure and job parallelism
- Mock and fixture architecture (hybrid centralized + co-located)
- Test execution tiers (mandatory / scheduled / on-demand)
- Configuration validation approach (hybrid programmatic)

**Important Decisions (Shape Architecture):**
- OTel instrumentation architecture (application services + Collector stack)
- RAG quality test architecture (designed Sprint 22, built Sprint 23)
- Test data management and fixture locations
- External service mock strategy

**Deferred Decisions (Post-MVP):**
- Kubernetes deployment target verification (Sprint 24+)
- Multi-GPU sharding test coverage (Sprint 24+)
- Chaos engineering test strategy (Sprint 24+)
- Pact contract testing for inter-service boundaries (if needed beyond OpenAPI) (Sprint 24+)

### CI/CD Pipeline Architecture

**Pipeline Stage Structure:**
```
lint → test → config → (scheduled: integration → e2e) → (manual: rag-quality)
```

**Parallel Execution:** All component tests run as parallel jobs within the `test` stage. Path-based `rules:changes` triggers run only affected component tests on MRs, full suite on main branch pushes.

**Caching Strategy:** Cache `node_modules` per component (keyed on `package-lock.json` hash) and Python `.venv` (keyed on `requirements.txt` hash).

**MR Blocking:** Mandatory stages (lint, test, config) block merge requests on failure (FR5). Scheduled and manual stages do not block MRs.

**Test Execution Tiers:**

| Tier | Tests | Trigger | Time Budget | GPU |
|---|---|---|---|---|
| Mandatory | Lint, Unit (5 components), Config validation | Every MR + main push | <10 min | No |
| Scheduled | Integration (Docker Compose), E2E (Playwright) | Nightly | <30 min | No |
| On-demand | RAG quality regression, Performance benchmarks | Manual trigger | <60 min | Yes |
| Future | K8s deployment, multi-GPU, chaos engineering | TBD | TBD | Yes |

### Mock & Fixture Architecture

**Organization: Hybrid (centralized factories + co-located overrides)**

Shared mock factories for external services in centralized locations:
- Backend: `__tests__/mocks/` (existing pattern with `shared-lib.js`)
- Frontend: `src/__tests__/mocks/`
- OPEA: `tests/conftest.py` (pytest standard pattern)
- Document-repository: `__tests__/mocks/` (existing `__mocks__/shared-lib.js`)

Test-specific data fixtures co-located with test files.

**External Service Mock Strategy:**

| Service | JS Mock | Python Mock | Rationale |
|---|---|---|---|
| ArangoDB | `jest.mock()` for db-connection-service | `unittest.mock` for arangodb driver | No DB in CI; validate logic, not storage |
| Redis | `ioredis-mock` | `fakeredis` | Lightweight, no Redis in CI |
| Keycloak | Pre-signed JWT fixtures | Pre-signed JWT fixtures | Validate claim parsing, not OIDC flows |
| vLLM/TEI | Mocked HTTP responses | Mocked httpx responses | GPU services not in CI |
| OPEA comps | N/A | Full mock via conftest.py | Vendored library, can't pip-install |

### Test Data Management

| Fixture Type | Location | Format |
|---|---|---|
| Mock data factories | `__tests__/fixtures/` (JS), `tests/fixtures/` (Python) | JSON, JS/Python modules |
| Document corpora (RAG) | `tests/fixtures/corpora/el-salvador/` | .txt, .md, .pdf, .xlsx, .docx |
| ArangoDB snapshots | `tests/fixtures/arangodb/` | JSON export |
| Env var profiles | `tests/fixtures/config/` | .env files per target |
| GPU profiles | `tests/fixtures/config/gpu-*.env` | .env files per GPU type |

**ArangoDB Test Strategy:**
- Unit/interface tests: Mocked database layer
- Integration tests (scheduled): Real ArangoDB in Docker Compose, seeded with fixture snapshots

### Configuration Validation Architecture

**Approach: Hybrid programmatic validator (Node.js)**

A single validation script that:
1. Parses the `env` template to extract all documented variables with types, defaults, sections
2. Cross-references `docker-compose.yaml` to find all `${VAR}` references
3. Validates every compose reference has a documented default or is a required secret
4. Checks hardware profile parameter ranges (GPU memory → valid model lengths)
5. Validates feature flag interdependencies (`DEPLOY_OPEA` controlling service topology)

Covers FR27–FR31. Runs as a Jest test suite or standalone Node.js script in CI.

### Application Observability Architecture (OpenTelemetry)

**OTel Collector Architecture:**

| Component | Role | SDK |
|---|---|---|
| Express Backend | HTTP spans, DB spans, outbound spans | `@opentelemetry/sdk-node` + auto-instrumentations |
| ChatQnA (FastAPI) | RAG pipeline spans (embedding, retrieval, LLM) | `opentelemetry-instrumentation-fastapi` |
| Retriever (FastAPI) | Hybrid search spans (vector + graph) | `opentelemetry-instrumentation-fastapi` |
| Dataprep (FastAPI) | Document ingestion spans (chunking, embedding) | `opentelemetry-instrumentation-fastapi` |
| Reranker (FastAPI) | Score validation spans | `opentelemetry-instrumentation-fastapi` |
| OTel Collector | Receives OTLP, exports to VictoriaMetrics | Standard OTel Collector image |
| VictoriaMetrics | Stores trace metrics | `victoriametrics/victoria-metrics` |
| Grafana | Dashboard visualization | `grafana/grafana` |

**Key Principle:** OTel SDK code is deployment-agnostic — works identically in Docker Compose, Docker Swarm, and Kubernetes. Only the Collector deployment config changes between environments.

### RAG Quality Test Architecture (Designed Sprint 22, Built Sprint 23)

| Aspect | Decision |
|---|---|
| Trigger | Manual/scheduled (requires GPU) |
| Test bed | El-Salvador branch, curated corpus + QA pairs |
| Metrics | RAGAS: faithfulness >0.95, relevance >0.85, context precision >0.80, context recall >0.90 |
| Output | JSON report + JUnit XML |
| Framework | `ragas` Python library + custom evaluation pipeline |
| Sprint 22 deliverable | Fixture structure, threshold config, corpus management |
| Sprint 23 deliverable | RAGAS execution pipeline, CI integration |

### Decision Impact Analysis

**Implementation Sequence:**
1. Backend `createApp()` refactor (prerequisite, unblocks route testing)
2. pytest configuration for OPEA overlay
3. GitLab CI pipeline (lint + test + config stages)
4. Per-component test suites (backend → frontend → doc-repo → OPEA → mobile)
5. Configuration validation suite
6. Application OTel instrumentation (distributed tracing, log correlation, observability stack)
7. RAG quality fixture structure (Sprint 22) → RAGAS pipeline (Sprint 23)

**Cross-Component Dependencies:**
- Backend `createApp()` refactor blocks backend route testing
- GitLab CI pipeline depends on jest-junit, junitreport, pytest junitxml being configured
- OPEA pytest configuration depends on conftest.py mock factories for vendored comps
- OTel instrumentation is independent — no dependency on Sprint 23 MELT Provider API; OTel Collector runs locally
- RAG quality architecture is independent — fixture structure in Sprint 22, execution in Sprint 23

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 10 areas where AI agents writing tests across 5 components and 3 languages could produce incompatible code.

### Test Naming Patterns

**JavaScript (Jest — backend, frontend, document-repository):**
- `describe('moduleName')` → `describe('methodName')` → `it('should expected behavior')`
- Nested describes for hierarchy: module → method → scenario
- Descriptive "should" statements, not implementation details

```javascript
describe('chatController')
  describe('sendMessage')
    it('should return 200 and message ID when valid request')
    it('should return 400 when message body is empty')
    it('should return 401 when token is expired')
```

**Python (pytest — OPEA overlay):**
- `class TestModuleName:` → `def test_method_name_scenario():`
- snake_case function names, descriptive docstrings
- ITU copyright header on every test file

```python
class TestRetriever:
    def test_hybrid_search_returns_results_when_valid_query(self):
        """Hybrid search returns results for valid query with mocked ArangoDB."""

    def test_hybrid_search_raises_when_arangodb_unavailable(self):
        """Hybrid search raises ConnectionError when ArangoDB mock fails."""
```

**Dart (flutter_test — mobile):**
- `group('FeatureName')` → `test('behavior description')`
- Descriptive names with AC references where applicable
- Existing pattern: `test('succeeds — state becomes authenticated')`

```dart
group('ApiService')
  group('discoverEndpoints')
    test('returns endpoints when server responds 200')
    test('throws ApiException when server responds 503')
```

**Playwright (E2E):**
- `test.describe('feature')` → `test('user journey description')`
- User journey style, not unit-level descriptions
- File naming: `epic{N}-{feature}.spec.js`

### Test Structure Patterns (Arrange-Act-Assert)

**All components follow AAA structure:**
1. **Arrange**: Create test data, set up mocks, configure fixtures
2. **Act**: Call the function/endpoint/component under test
3. **Assert**: Verify outcomes

**JavaScript:**
```javascript
it('should return 200 with user profile when valid token', async () => {
  // Arrange
  const token = createValidToken({ sub: 'user-123' });
  mockUserProfileService.getBySub.mockResolvedValue({ name: 'Test User' });

  // Act
  const response = await request(app).get('/api/me/profile').set('Authorization', `Bearer ${token}`);

  // Assert
  expect(response.status).toBe(200);
  expect(response.body.name).toBe('Test User');
});
```

**Python:**
```python
async def test_chat_returns_response_when_valid_request(self):
    # Arrange
    payload = {"query": "test query", "user_id": "user-123"}
    mock_retriever.search.return_value = [{"text": "result"}]

    # Act
    response = await client.post("/v1/chatqna", json=payload)

    # Assert
    assert response.status_code == 200
    assert "response" in response.json()
```

### Mock & Fixture Patterns

**Mock Factory Pattern (all JS components):**
```javascript
// Shared factory with overrides — use this, not inline objects
function createMockUser(overrides = {}) {
  return {
    _key: 'user-1',
    sub: 'user-123',
    iss: 'https://keycloak.example.com/realms/genie',
    ...overrides
  };
}
```

**Closure-based Mock References (all JS components):**
```javascript
// Use this pattern to avoid jest.mock hoisting issues
const mockGetUser = jest.fn();
jest.mock('../services/user-service', () => ({
  getUser: (...args) => mockGetUser(...args)
}));
```

**Python Mock Fixtures (OPEA):**
```python
# tests/conftest.py — centralized mock factories
@pytest.fixture
def mock_arangodb():
    with patch('geniei_retriever_arangodb.arangodb') as mock:
        mock.db.collection.return_value = MagicMock()
        yield mock
```

**Dart Fake Classes (mobile):**
```dart
// Prefer fakes over mocks for service-layer tests
class FakeKeycloakService extends KeycloakService {
  bool endSessionResult = true;
  @override
  Future<bool> endSession() async => endSessionResult;
}
```

### Assertion Patterns

**Error Assertions (standardized across components):**

| Pattern | JavaScript (Jest) | Python (pytest) | Dart (flutter_test) |
|---|---|---|---|
| HTTP status | `expect(response.status).toBe(200)` | `assert response.status_code == 200` | `expect(response.statusCode, equals(200))` |
| Error thrown | `expect(fn).rejects.toMatchObject({ code: 'X' })` | `with pytest.raises(ValueError, match='msg')` | `expect(() => fn(), throwsException)` |
| Not called | `expect(mock).not.toHaveBeenCalled()` | `mock.assert_not_called()` | `verifyNever(mock.method())` |
| Called with | `expect(mock).toHaveBeenCalledWith(args)` | `mock.assert_called_once_with(args)` | `verify(mock.method(args)).called(1)` |
| Contains | `expect(body).toContain('text')` | `assert 'text' in body` | `expect(body, contains('text'))` |

### Conditional Skip Patterns

**GPU-dependent tests (OPEA):**
```python
import pytest

@pytest.mark.skipif(not os.getenv('GPU_AVAILABLE'), reason="No GPU in CI")
async def test_reranker_scores_with_real_tei(self):
    ...
```

**JavaScript equivalent:**
```javascript
const skipIfNoGPU = process.env.GPU_AVAILABLE ? it : it.skip;

skipIfNoGPU('should produce embeddings with real TEI', async () => {
  ...
});
```

### OTel Instrumentation Patterns

**Express backend tracing setup:**
```javascript
// tracing.js — Node.js OTel SDK initialization
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'genie-backend',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

**FastAPI service tracing setup:**
```python
# tracing.py — Python OTel SDK initialization
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

resource = Resource.create({SERVICE_NAME: "chatqna"})
provider = TracerProvider(resource=resource)
provider.add_span_processor(BatchSpanProcessor(
    OTLPSpanExporter(endpoint=f"{os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4318')}/v1/traces")
))
trace.set_tracer_provider(provider)
FastAPIInstrumentor.instrument_app(app)
```

**Log-trace correlation (winston):**
```javascript
// Adds trace_id and span_id to all winston log entries
const { trace, context } = require('@opentelemetry/api');
const span = trace.getSpan(context.active());
if (span) {
  const { traceId, spanId } = span.spanContext();
  // Inject into winston metadata
}
```

**Log-trace correlation (Python CustomLogger):**
```python
# Injects trace_id and span_id into log records
from opentelemetry import trace
span = trace.get_current_span()
if span.is_recording():
    ctx = span.get_span_context()
    extra = {"trace_id": format(ctx.trace_id, "032x"), "span_id": format(ctx.span_id, "016x")}
```

**Structured log assertion helpers (kept for test suites):**
```javascript
function expectLogged(loggerMock, level, message) {
  expect(loggerMock).toHaveBeenCalledWith(
    expect.objectContaining({ level, message })
  );
}
```

```python
def assert_logged(caplog, level, message):
    assert any(r.levelname == level and message in r.message for r in caplog.records)
```

### Configuration Fixture Patterns

**Env var profile fixtures:**
```
tests/fixtures/config/default.env      — baseline configuration
tests/fixtures/config/gpu-t4.env       — T4 GPU overrides
tests/fixtures/config/gpu-rtx6000.env  — RTX 6000 overrides
tests/fixtures/config/no-opea.env      — DEPLOY_OPEA=0 profile
```

**Using env fixtures in tests:**
```javascript
describe('vLLM config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, VLLM_MAX_MODEL_LEN: '32768' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });
});
```

### AI-Generated Test Rules

AI agents generating tests MUST follow these rules:
1. Use factory functions with overrides pattern, not inline objects (except trivial cases)
2. Use closure-based mock references for `jest.mock()` to avoid hoisting issues
3. Follow the naming conventions for the target language (see Test Naming Patterns)
4. Include ITU copyright headers on all Python test files
5. Use CommonJS `require()` in backend tests, never ESM `import`
6. Use Options API `mount()` patterns in frontend tests, never Composition API
7. All generated tests must pass ESLint (JS) / Ruff (Python) / `flutter analyze` (Dart)
8. Place mocks in centralized locations (`__tests__/mocks/` or `tests/conftest.py`), not duplicated

### Enforcement Guidelines

**All AI Agents MUST:**
- Follow the test naming conventions for the target language
- Use AAA (Arrange-Act-Assert) structure
- Place shared mocks in centralized mock directories
- Use factory functions for test data creation
- Follow the conditional skip pattern for GPU-dependent tests
- Emit JUnit XML-compatible output for CI consumption
- Follow language constraints: CommonJS (backend), Options API (frontend), ITU headers (Python), Ruff (Python)

**Pattern Enforcement:**
- CI lint stages catch formatting violations (ESLint, Ruff, flutter analyze)
- CI test stages catch runtime errors
- Code review catches pattern deviations not caught by linting
- Project-context.md documents hard constraints (CommonJS, Options API)

## Project Structure & Boundaries

### Complete Project Directory Structure

New files and directories are marked with `← NEW`. Existing files are shown without markers.

```
genie-ai/                                          # Repository root
├── .gitlab-ci.yml                                 # ← NEW: CI/CD pipeline definition
├── package.json                                   # EXISTING: add jest-junit dep + test scripts
├── playwright.config.js                           # EXISTING: add junit reporter config
│
├── tests/                                         # EXISTING: shared test infrastructure
│   ├── e2e/                                       # EXISTING: Playwright E2E tests
│   │   ├── helpers/
│   │   │   ├── auth.js                            # EXISTING
│   │   │   └── keycloak-admin.js                  # EXISTING
│   │   ├── epic1-*.spec.js                        # EXISTING: 4 auth specs
│   │   ├── epic2-*.spec.js                        # EXISTING: 5 specs
│   │   └── epic3-*.spec.js                        # EXISTING: 3 specs
│   │
│   ├── fixtures/                                  # ← NEW: shared test data
│   │   ├── config/                                # ← NEW: env var profiles
│   │   │   ├── default.env                        # ← NEW: baseline config
│   │   │   ├── gpu-t4.env                         # ← NEW: T4 GPU profile
│   │   │   ├── gpu-rtx6000.env                    # ← NEW: RTX 6000 profile
│   │   │   └── no-opea.env                        # ← NEW: DEPLOY_OPEA=0 profile
│   │   ├── corpora/                               # ← NEW: RAG document corpora
│   │   │   └── el-salvador/                       # ← NEW: canonical test bed
│   │   │       ├── qa-pairs.json                  # ← NEW: query-answer pairs
│   │   │       └── *.txt, *.md, *.pdf             # ← NEW: test documents
│   │   ├── arangodb/                              # ← NEW: ArangoDB fixture snapshots
│   │   │   ├── collections/                       # ← NEW: collection fixtures
│   │   │   └── graphs/                            # ← NEW: graph structure fixtures
│   │   └── jwt/                                   # ← NEW: pre-signed JWT tokens
│   │       ├── valid-token.json                   # ← NEW: valid user token
│   │       ├── expired-token.json                 # ← NEW: expired token
│   │       └── invalid-issuer-token.json          # ← NEW: wrong issuer
│   │
│   ├── config-validator/                          # ← NEW: configuration validation suite
│   │   ├── validate-env.js                        # ← NEW: env template parser
│   │   ├── validate-compose.js                    # ← NEW: docker-compose cross-ref
│   │   ├── validate-hardware.js                   # ← NEW: GPU profile range checks
│   │   ├── validate-features.js                   # ← NEW: feature flag interdependencies
│   │   ├── __tests__/                             # ← NEW: Jest test suite
│   │   │   └── config-validation.test.js          # ← NEW
│   │   └── package.json                           # ← NEW: standalone or root script
│   │
│   ├── rag-quality/                               # ← NEW: RAG quality regression suite
│   │   ├── thresholds.json                        # ← NEW: RAGAS threshold config
│   │   ├── evaluate.py                            # ← NEW: RAGAS evaluation pipeline
│   │   ├── generate-report.py                     # ← NEW: JSON + JUnit report generator
│   │   └── README.md                              # ← NEW: usage documentation
│   │
│   ├── log-assertions/                            # ← NEW: structured log assertion helpers
│   │   ├── log-assertions.js                      # ← NEW: structured log assertion helpers (JS)
│   │   └── log-assertions.py                      # ← NEW: structured log assertion helpers (Python)
│   │
│   └── rag-benchmarks/                            # EXISTING: existing benchmark suite
│       └── ...
│
├── components/
│   ├── gov-chat-backend/
│   │   ├── __tests__/                             # EXISTING: 8 test files
│   │   │   ├── mocks/
│   │   │   │   └── shared-lib.js                  # EXISTING: module-level mock
│   │   │   ├── authController.test.js             # EXISTING
│   │   │   ├── keycloakAuthMiddleware.test.js      # EXISTING
│   │   │   └── ...                                # EXISTING: 6 more
│   │   ├── __tests__/fixtures/                    # ← NEW: test data fixtures
│   │   │   ├── users.js                           # ← NEW: user factory functions
│   │   │   ├── tokens.js                          # ← NEW: JWT creation helpers
│   │   │   └── requests.js                        # ← NEW: HTTP request helpers
│   │   ├── __tests__/routes/                      # ← NEW: route handler tests (after createApp refactor)
│   │   │   ├── auth.test.js                       # ← NEW
│   │   │   ├── chat.test.js                       # ← NEW
│   │   │   ├── analytics.test.js                  # ← NEW
│   │   │   ├── admin.test.js                      # ← NEW
│   │   │   ├── files.test.js                      # ← NEW
│   │   │   └── categories.test.js                 # ← NEW
│   │   ├── __tests__/services/                    # ← NEW: service layer tests
│   │   │   ├── query-service.test.js              # ← NEW
│   │   │   ├── chat-history-service.test.js       # ← NEW
│   │   │   ├── analytics-service.test.js          # ← NEW
│   │   │   └── ...                                # ← NEW: remaining services
│   │   ├── __tests__/middleware/                   # ← NEW: middleware tests
│   │   │   ├── security-middleware.test.js        # ← NEW
│   │   │   └── error-handler.test.js              # ← NEW
│   │   └── jest.config.js                         # EXISTING: add jest-junit reporter
│   │
│   ├── gov-chat-frontend/
│   │   ├── src/__tests__/                         # EXISTING: 8 test files
│   │   │   ├── mocks/                             # ← NEW: shared frontend mocks
│   │   │   │   ├── axios.js                       # ← NEW: centralized axios mock
│   │   │   │   └── keycloakAuthService.js         # ← NEW: centralized auth mock
│   │   │   ├── authStore.test.js                  # EXISTING
│   │   │   └── ...                                # EXISTING: 7 more
│   │   ├── src/__tests__/fixtures/                # ← NEW: test data fixtures
│   │   │   ├── store-state.js                     # ← NEW: Vuex state factories
│   │   │   └── api-responses.js                   # ← NEW: mocked API response data
│   │   ├── src/__tests__/components/              # ← NEW: Vue component tests
│   │   │   ├── ChatBotComponent.test.js           # ← NEW
│   │   │   ├── NavBarComponent.test.js            # ← NEW
│   │   │   ├── UserProfileComponent.test.js       # ← NEW
│   │   │   ├── AdminDashboard.test.js             # ← NEW (may split)
│   │   │   └── ...                                # ← NEW: remaining critical components
│   │   ├── src/__tests__/services/                # ← NEW: service tests
│   │   │   ├── chatService.test.js                # ← NEW
│   │   │   ├── analyticsService.test.js           # ← NEW
│   │   │   └── ...                                # ← NEW: remaining services
│   │   ├── src/__tests__/store/                   # ← NEW: Vuex store module tests
│   │   │   └── chatHistory.test.js                # ← NEW
│   │   └── jest.config.js                         # EXISTING: add jest-junit reporter
│   │
│   └── document-repository/
│       ├── __tests__/                             # EXISTING: 8 test files
│       │   ├── __mocks__/
│       │   │   └── shared-lib.js                  # EXISTING: module-level mock
│       │   ├── mocks/                             # ← NEW: additional mock factories
│       │   │   ├── files.js                       # ← NEW: file fixture factories
│       │   │   └── clamav.js                      # ← NEW: ClamAV mock
│       │   ├── fixtures/                          # ← NEW: test data
│       │   │   ├── test-document.txt              # ← NEW: test upload file
│       │   │   ├── test-document.pdf              # ← NEW: PDF test fixture
│       │   │   └── eicar.txt                      # ← NEW: EICAR test virus
│       │   ├── routes/                            # ← NEW: route handler tests
│       │   │   ├── upload.test.js                 # ← NEW
│       │   │   ├── download.test.js               # ← NEW
│       │   │   ├── search.test.js                 # ← NEW
│       │   │   └── delete.test.js                 # ← NEW
│       │   ├── services/                          # ← NEW: service tests
│       │   │   └── fileService.test.js            # ← NEW
│       │   └── ...                                # EXISTING: 8 existing test files
│       └── jest.config.js                         # EXISTING: add jest-junit reporter
│
├── genie-ai-overlay/                              # EXISTING: OPEA microservices
│   ├── pyproject.toml                             # EXISTING: add pytest + test deps
│   ├── pytest.ini                                 # ← NEW: pytest configuration
│   ├── tests/                                     # ← NEW: pytest test directory
│   │   ├── conftest.py                            # ← NEW: shared fixtures + mock factories
│   │   ├── fixtures/                              # ← NEW: test data
│   │   │   ├── retriever-responses.json           # ← NEW: mocked ArangoDB responses
│   │   │   ├── dataprep-documents/                # ← NEW: test documents for ingestion
│   │   │   └── chatqna-requests.json              # ← NEW: sample chat request payloads
│   │   ├── test_retriever.py                      # ← NEW: hybrid search tests
│   │   ├── test_dataprep.py                       # ← NEW: extraction/chunking tests
│   │   ├── test_reranker.py                       # ← NEW: score validation tests
│   │   ├── test_core.py                           # ← NEW: type/protocol tests
│   │   └── test_chatqna.py                        # ← NEW: orchestrator interface tests
│   ├── retriever/
│   │   └── geniei_retriever_arangodb.py           # EXISTING
│   ├── dataprep/
│   │   └── genieai_dataprep_arangodb.py           # EXISTING
│   ├── reranker/
│   │   └── genieai_reranker.py                    # EXISTING
│   ├── chatqna/
│   │   └── genieai_chatqna.py                     # EXISTING
│   └── core/
│       └── genieai_api_protocol.py                # EXISTING
│
└── mobile/genie_ai_mobile/
    ├── test/                                      # EXISTING: 8 test files
    │   ├── services/
    │   │   ├── auth/                              # EXISTING: auth tests
    │   │   └── ...                                # EXISTING: service-layer tests
    │   └── config/
    │       └── keycloak_config_test.dart          # EXISTING
    ├── test/fixtures/                             # ← NEW: shared test data
    │   ├── tokens.dart                            # ← NEW: JWT fixture factories
    │   └── api_responses.dart                     # ← NEW: mock API response factories
    └── pubspec.yaml                               # EXISTING: add junitreport dep
```

### Architectural Boundaries

**Test Scope Boundaries:**

| Boundary | Inside (tests here) | Outside (mocked/stubbed) |
|---|---|---|
| Backend unit tests | Service logic, middleware, route handlers | ArangoDB, Redis, Keycloak, OPEA services |
| Frontend unit tests | Component rendering, store logic, service calls | Backend API, Keycloak, browser APIs |
| OPEA interface tests | Service logic, request/response shaping | ArangoDB, Redis, vLLM, TEI, OPEA comps |
| Doc-repo unit tests | Route handlers, file processing, metadata | ArangoDB, ClamAV, file system |
| Mobile unit tests | State management, service calls, token handling | Backend API, Keycloak, platform channels |
| E2E tests | Full user journeys across real services | GPU services (mocked or conditional skip) |
| Config validation | Env template, docker-compose, hardware profiles | Running services |

**Cross-Component Test Boundaries:**

- Each component's test suite is independent — no test in one component imports from another
- Shared test infrastructure lives in root `tests/` directory (fixtures, config validator, MELT helpers, RAG quality)
- Each component's test runner is configured independently (own `jest.config.js`, `pytest.ini`, etc.)
- The CI pipeline is the only cross-component orchestrator

### Requirements to Structure Mapping

| FR Category | Primary Location | Supporting Locations |
|---|---|---|
| FR1–FR8 (CI/CD) | `.gitlab-ci.yml` | Per-component jest configs, pytest.ini |
| FR9–FR12 (Backend) | `components/gov-chat-backend/__tests__/routes/`, `services/`, `middleware/` | `tests/fixtures/jwt/` |
| FR13–FR16 (Frontend) | `components/gov-chat-frontend/src/__tests__/components/`, `services/`, `store/` | `tests/fixtures/jwt/` |
| FR17–FR21 (OPEA) | `genie-ai-overlay/tests/` | `tests/fixtures/arangodb/` |
| FR22–FR24 (Doc-repo) | `components/document-repository/__tests__/routes/`, `services/` | `__tests__/fixtures/` |
| FR25–FR26 (Mobile) | `mobile/genie_ai_mobile/test/` (existing) | `test/fixtures/` |
| FR27–FR31 (Config) | `tests/config-validator/` | `tests/fixtures/config/` |
| FR32–FR35 (RAG Quality) | `tests/rag-quality/` | `tests/fixtures/corpora/` |
| FR36–FR39 (Test Data) | `tests/fixtures/` | Per-component fixture directories |
| FR40–FR42 (Observability) | OTel SDK in app services + Collector stack | Grafana dashboards |
| FR45–FR46 (AI Generation) | AI agent tooling, not file-structured | All component test directories |

### Integration Points

**CI Pipeline Integration (`.gitlab-ci.yml`):**
```
MR push → lint (parallel: eslint, ruff, flutter analyze)
       → test (parallel: backend, frontend, doc-repo, python, mobile)
       → config (env validation suite)
       → MR blocked if any mandatory stage fails

Nightly  → integration (Docker Compose, seeded ArangoDB)
        → e2e (Playwright, full user journeys)

Manual   → rag-quality (RAGAS scoring, requires GPU)
```

**Test Data Flow:**
```
tests/fixtures/jwt/          → consumed by backend, frontend, doc-repo tests (auth mocks)
tests/fixtures/arangodb/     → consumed by OPEA tests (mocked DB responses)
tests/fixtures/config/       → consumed by config-validator (env profiles)
tests/fixtures/corpora/      → consumed by rag-quality (document test bed)
tests/log-assertions/        → imported by any test needing structured log assertions
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices work together without conflicts. Jest 29.x across 3 JS components is version-consistent. pytest 9.x is the standard for Python/FastAPI. JUnit XML is a universal format consumable by all runners and GitLab CI. OTel SDK code is deployment-agnostic — works identically in Docker Compose, Docker Swarm, and Kubernetes. The Node.js config validator can parse both `env` (plain text) and `docker-compose.yaml` (YAML) without cross-language dependencies.

**Pattern Consistency:** AAA structure defined for all 3 languages. Naming conventions are per-language but follow the same hierarchy principle (module → method → scenario). Mock patterns use the appropriate idiom for each ecosystem (closure-based refs for Jest, conftest.py fixtures for pytest, fake classes for Dart). Assertion patterns are cross-referenced in a comparison table. No contradictions between patterns.

**Structure Alignment:** The project structure places new test files within existing component directories, respecting current conventions. Shared infrastructure (`tests/fixtures/`, `tests/config-validator/`, `tests/log-assertions/`, `tests/rag-quality/`) lives at root level, accessible by all components without cross-component imports. CI pipeline is the only cross-component orchestrator.

### Requirements Coverage Validation

**Functional Requirements Coverage:** All 46 FRs mapped to specific architectural elements:

| FR Range | Category | Architectural Support |
|---|---|---|
| FR1–FR8 | CI/CD Pipeline | `.gitlab-ci.yml` with 4 stages, 3 tiers, path-based triggers |
| FR9–FR12 | Backend | `__tests__/routes/`, `services/`, `middleware/` + createApp refactor |
| FR13–FR16 | Frontend | `src/__tests__/components/`, `services/`, `store/` |
| FR17–FR21 | OPEA | `genie-ai-overlay/tests/` with conftest.py mock factories |
| FR22–FR24 | Doc-repo | `__tests__/routes/`, `services/` + ClamAV/file type mocks |
| FR25–FR26 | Mobile | Existing test suite integrated into CI via junitreport |
| FR27–FR31 | Config Validation | `tests/config-validator/` with 4 validation modules |
| FR32–FR35 | RAG Quality | `tests/rag-quality/` with RAGAS pipeline (Sprint 23) |
| FR36–FR39 | Test Data | `tests/fixtures/` with 5 fixture categories |
| FR40–FR42 | Application Observability | OTel SDK in Express + FastAPI services, Collector + VictoriaMetrics + Grafana stack |
| FR45–FR46 | AI Generation | AI-Generated Test Rules (8 mandatory rules) |

**Non-Functional Requirements Coverage:** All 24 NFRs addressed:

| NFR Range | Category | Architectural Support |
|---|---|---|
| NFR1–NFR5 | Performance | Parallel CI jobs, tiered execution, time budgets |
| NFR6–NFR10 | Reliability | AAA structure, mocked deps, conditional GPU skip |
| NFR11–NFR15 | Maintainability | CI lint stage, centralized mocks, AI test rules |
| NFR16–NFR20 | Compatibility | GitLab CI, JUnit XML, Docker targets, OTel hooks |
| NFR21–NFR24 | Language | CommonJS, Options API, ITU headers, Ruff rules |

### Implementation Readiness Validation

**Decision Completeness:** All critical decisions documented with versions (Jest 29.x, pytest 9.x, Playwright ^1.51, jest-junit v17). Rationale provided for each decision. Implementation sequence defined with 7 ordered steps. Cross-component dependencies explicitly mapped.

**Structure Completeness:** Complete directory tree with 80+ new files/directories identified. Every new file marked with `← NEW`. Existing files referenced without markers. FR-to-structure mapping table covers all 46 FRs.

**Pattern Completeness:** 10 conflict points identified and addressed. Per-language naming conventions with examples. Cross-language assertion comparison table. Mock patterns for each ecosystem. Conditional skip patterns for GPU tests. MELT instrumentation patterns for JS and Python. AI generation rules with 8 mandatory constraints.

### Gap Analysis Results

**No Critical Gaps Found.**

**Minor Gaps (non-blocking):**

1. **Route handler test mechanism clarified** — Route handler tests in `__tests__/routes/` validate API behavior using Supertest. OpenAPI schema validation can be added as a secondary check in Sprint 23.

2. **ioredis-mock and fakeredis missing from dependency additions** — The mock strategy table references these but they weren't listed in the Step 3 dependency additions. Resolution: Add `ioredis-mock` for JS components, `fakeredis` for OPEA Python tests.

3. **CI runner setup for Flutter SDK and Playwright browsers** — Not documented in the architecture (implementation detail). Resolution: Document in `.gitlab-ci.yml` as job-level setup steps during implementation.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed (Step 2)
- [x] Scale and complexity assessed (Very High, ~12 components)
- [x] Technical constraints identified (4 blocking issues, test ecosystem matrix)
- [x] Cross-cutting concerns mapped (8 concerns)

**Architectural Decisions**
- [x] Critical decisions documented with versions (Step 4)
- [x] Technology stack fully specified (5 runners + GitLab CI)
- [x] Integration patterns defined (CI pipeline, test data flow)
- [x] Performance considerations addressed (time budgets, parallelism)

**Implementation Patterns**
- [x] Naming conventions established (4 languages)
- [x] Structure patterns defined (AAA, mock factories, fixtures)
- [x] Communication patterns specified (assertion cross-reference)
- [x] Process patterns documented (skip patterns, OTel instrumentation)

**Project Structure**
- [x] Complete directory structure defined (80+ new files)
- [x] Component boundaries established (7 scope boundaries)
- [x] Integration points mapped (CI pipeline, test data flow)
- [x] Requirements to structure mapping complete (46 FRs)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all requirements covered, no critical gaps, decisions are coherent and mutually compatible.

**Key Strengths:**
- Tiered testing approach provides a well-defined organizing principle
- OTel SDK code is deployment-agnostic, enabling forward compatibility from Docker Compose to Kubernetes without changes
- Existing test patterns analyzed and extended rather than replaced
- Hybrid mock architecture balances centralization with test-local flexibility
- Tiered CI execution respects time budgets while maintaining coverage

**Areas for Future Enhancement:**
- Pact contract testing for inter-service boundaries (if needed beyond OpenAPI) (Sprint 24+)
- Kubernetes deployment target verification (Sprint 24+)
- Chaos engineering tests (Sprint 24+)
- Automated test generation from OpenAPI specs (Sprint 23+)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries — no cross-component test imports
- Refer to this document for all architectural questions
- Follow the 8 AI-Generated Test Rules when generating test code

**First Implementation Priority:**
1. Backend `createApp()` refactor (prerequisite — unblocks all route testing)
2. pytest configuration for OPEA overlay (zero test infrastructure exists)
3. GitLab CI pipeline (`.gitlab-ci.yml` with lint → test → config stages)
4. Per-component test suites (following the implementation sequence from Step 4)
