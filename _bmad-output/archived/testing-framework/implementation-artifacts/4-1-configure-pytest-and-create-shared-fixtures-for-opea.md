# Story 4.1: Configure pytest and Create Shared Fixtures for OPEA

Status: done

## Story

As a developer,
I want pytest configured with shared mock fixtures for the OPEA overlay,
so that all OPEA microservice tests have a consistent mock foundation.

## Acceptance Criteria

1. **AC1: pytest.ini configuration** — `genie-ai-overlay/pytest.ini` is created with test discovery (`testpaths = tests`), asyncio mode (`asyncio_mode = auto`), and junitxml output configuration (`--junitxml=reports/pytest-report.xml` in addopts). The `[tool.pytest.ini_options]` section is NOT added to pyproject.toml — pytest.ini is the single source of truth.

2. **AC2: Test dependencies in pyproject.toml** — `genie-ai-overlay/pyproject.toml` includes a `[project.optional-dependencies]` section with `test` extra: `pytest>=8.0`, `pytest-asyncio>=0.24`, `pytest-cov>=6.0`, `httpx>=0.28`, `asgi-lifespan>=2.0`. These are added without modifying existing `[tool.ruff]` configuration.

3. **AC3: tests/conftest.py with mock_arangodb** — `genie-ai-overlay/tests/conftest.py` provides a `mock_arangodb()` pytest fixture that mocks the ArangoDB Python driver (`arango.ArangoClient`, `arango.database.StandardDatabase`). The mock provides: `.db.collection()` returning a MagicMock, `.db.query()` returning mock cursor with `.all()` and `.next()` methods, `.db.aql.execute()` for AQL queries. Supports both sync and async patterns.

4. **AC4: tests/conftest.py with mock_redis** — Provides a `mock_redis()` pytest fixture using `unittest.mock.MagicMock` to mock Redis client. Provides `.get()`, `.set()`, `.delete()`, `.exists()`, `.expire()` methods returning appropriate defaults.

5. **AC5: tests/conftest.py with mock_vllm** — Provides a `mock_vllm()` pytest fixture that mocks vLLM inference responses. Returns a MagicMock with `.generate()` returning mock completion objects with `.choices[0].text` and `.choices[0].message.content` attributes. Configurable for streaming vs non-streaming responses.

6. **AC6: tests/conftest.py with mock_tei** — Provides a `mock_tei()` pytest fixture that mocks TEI (Text Embeddings Inference) responses for both embedding and reranking. Embedding mock returns a numpy-like array of floats. Reranking mock returns scored documents with `.score` attributes. Uses `unittest.mock.AsyncMock` for async HTTP calls.

7. **AC7: tests/conftest.py with mock_comps** — Provides a `mock_comps()` pytest fixture that mocks the vendored OPEA `comps` library (`CustomLogger`, `OpeaComponent`, `OpeaComponentRegistry`, `ServiceOrchestrator`, `MicroService`, `MegaServiceEndpoint`, `ServiceType`, `ServiceRoleType`, `EmbedDoc`, `SearchedDoc`, `LLMParamsDoc`, `DocPath`). All classes are replaced with MagicMock instances. The `CustomLogger` mock provides `.info()`, `.error()`, `.warning()`, `.debug()` methods.

8. **AC8: ITU copyright headers** — All Python test files (`conftest.py`, `test_*.py`) include the ITU copyright header comment block at the top: `# Copyright (c) 2024-2026 International Telecommunication Union (ITU)`. No Intel+ITU header — these are GENIE.AI-specific tests, not OPEA adaptations.

9. **AC9: Ruff compliance** — All Python code (test files, conftest.py, pytest.ini) passes Ruff linting and formatting as configured in `genie-ai-overlay/pyproject.toml` (`line-length = 120`, `quote-style = "double"`). Run `ruff check` and `ruff format --check` to verify.

10. **AC10: Self-tests verify fixtures** — `genie-ai-overlay/tests/test_conftest_fixtures.py` contains tests that import and exercise every fixture from conftest.py, verifying mock objects have the expected methods and return types.

## Tasks / Subtasks

- [x] Task 1: Configure pytest (AC: #1, #2)
  - [x] 1.1 Create `genie-ai-overlay/pytest.ini` with testpaths, asyncio_mode, and junitxml addopts
  - [x] 1.2 Add `[project.optional-dependencies]` with `test` extra to `genie-ai-overlay/pyproject.toml`
  - [x] 1.3 Create `genie-ai-overlay/tests/` directory and empty `tests/__init__.py`

- [x] Task 2: Create conftest.py with core mocks (AC: #3, #4, #7, #8)
  - [x] 2.1 Create `genie-ai-overlay/tests/conftest.py` with ITU copyright header
  - [x] 2.2 Implement `mock_arangodb()` fixture — mock ArangoClient, StandardDatabase, collections, AQL queries
  - [x] 2.3 Implement `mock_redis()` fixture — mock Redis client with get/set/delete/exists/expire
  - [x] 2.4 Implement `mock_comps()` fixture — mock all comps imports (CustomLogger, OpeaComponent, etc.)
  - [x] 2.5 Add `@pytest.fixture(autouse=True)` fixture to set required env vars (ARANGO_URL, ARANGO_DB, etc.) before any test runs

- [x] Task 3: Create AI service mocks (AC: #5, #6)
  - [x] 3.1 Implement `mock_vllm()` fixture — mock vLLM completion responses (streaming and non-streaming)
  - [x] 3.2 Implement `mock_tei()` fixture — mock TEI embedding and reranking responses with AsyncMock

- [x] Task 4: Write fixture self-tests (AC: #10)
  - [x] 4.1 Create `genie-ai-overlay/tests/test_conftest_fixtures.py` with ITU copyright header
  - [x] 4.2 Test mock_arangodb has collection(), query(), aql.execute() methods
  - [x] 4.3 Test mock_redis has get(), set(), delete() methods
  - [x] 4.4 Test mock_vllm returns completion objects with correct shape
  - [x] 4.5 Test mock_tei returns embedding arrays and reranked documents
  - [x] 4.6 Test mock_comps provides CustomLogger with info/error/warning/debug

- [x] Task 5: Verify linting and test execution (AC: #9)
  - [x] 5.1 Run `cd genie-ai-overlay && pip install -e ".[test]"` — install test dependencies
  - [x] 5.2 Run `cd genie-ai-overlay && python -m pytest tests/ -v` — all self-tests pass
  - [x] 5.3 Run `cd genie-ai-overlay && ruff check tests/` — zero lint errors
  - [x] 5.4 Run `cd genie-ai-overlay && ruff format --check tests/` — formatting passes

## Dev Notes

### Critical: comps Library Cannot Be pip-installed

The OPEA `comps` library is vendored at Docker build time (the Dockerfile renames `docarray` → `opea_docarray` and applies patches). It CANNOT be installed via pip locally. Every import from `comps` must be mocked in conftest.py. This is the single most important mock — without it, NO OPEA test can run.

**Imports that reference `comps` across services:**
```python
# retriever
from comps import CustomLogger, EmbedDoc, OpeaComponent, OpeaComponentRegistry, ServiceType
from comps.cores.proto.genieai_api_protocol import ChatCompletionRequest, RetrievalRequest, RetrievalRequestArangoDB

# dataprep
from comps import CustomLogger, DocPath, OpeaComponentRegistry
from comps.cores.proto.genieai_api_protocol import ArangoDBDataprepRequestFromDocRepo
from comps.dataprep.src.genieai_dataprep_utils import docling_document_loader, document_loader, is_valid_content
from comps.dataprep.src.integrations.arangodb import OpeaArangoDataprep
from comps.dataprep.src.utils import get_separators

# reranker
from comps import CustomLogger, LLMParamsDoc, OpeaComponentRegistry, SearchedDoc
from comps.cores.proto.api_protocol import ...
from integrations.tei import OpeaTEIReranking

# chatqna
from comps import CustomLogger, MegaServiceEndpoint, MicroService, ServiceOrchestrator, ServiceRoleType, ServiceType
from comps.cores.proto.docarray import LLMParams, RerankerParms, RetrieverParms
from comps.cores.proto.genieai_api_protocol import ...
```

**Mock strategy:** Use `sys.modules` patching in conftest.py to pre-populate the `comps` module tree before any test imports run:
```python
import sys
from unittest.mock import MagicMock

# Pre-populate comps module tree so imports don't fail
comps_mock = MagicMock()
sys.modules.setdefault('comps', comps_mock)
sys.modules.setdefault('comps.cores', MagicMock())
sys.modules.setdefault('comps.cores.proto', MagicMock())
sys.modules.setdefault('comps.cores.proto.api_protocol', MagicMock())
sys.modules.setdefault('comps.cores.proto.genieai_api_protocol', MagicMock())
sys.modules.setdefault('comps.cores.proto.docarray', MagicMock())
sys.modules.setdefault('comps.dataprep', MagicMock())
sys.modules.setdefault('comps.dataprep.src', MagicMock())
sys.modules.setdefault('comps.dataprep.src.genieai_dataprep_utils', MagicMock())
sys.modules.setdefault('comps.dataprep.src.integrations', MagicMock())
sys.modules.setdefault('comps.dataprep.src.integrations.arangodb', MagicMock())
sys.modules.setdefault('comps.dataprep.src.utils', MagicMock())
```

### pytest.ini Configuration

```ini
[pytest]
testpaths = tests
asyncio_mode = auto
addopts = -v --tb=short
```

Note: Do NOT add `--junitxml` to addopts — it's configured in CI via CLI args. Keep pytest.ini minimal.

### pyproject.toml Changes

Add only the `[project.optional-dependencies]` section. Do NOT modify existing `[tool.ruff]` configuration:

```toml
[project.optional-dependencies]
test = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-cov>=6.0",
    "httpx>=0.28",
    "asgi-lifespan>=2.0",
]
```

### Environment Variables Required by OPEA Services

All OPEA services read config from env vars at import time. Tests need these set before imports:
```python
@pytest.fixture(autouse=True)
def set_env_vars(monkeypatch):
    monkeypatch.setenv("ARANGO_URL", "http://localhost:8529")
    monkeypatch.setenv("ARANGO_DB", "genie")
    monkeypatch.setenv("ARANGO_USER", "root")
    monkeypatch.setenv("ARANGO_PASSWORD", "testpass")
    monkeypatch.setenv("TEI_EMBEDDING_ENDPOINT", "http://localhost:80")
    monkeypatch.setenv("TEI_RERANKING_ENDPOINT", "http://localhost:80")
    monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
    monkeypatch.setenv("LOCAL_EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")
    monkeypatch.setenv("RETRIEVER_MODEL_ID", "BAAI/bge-base-en-v1.5")
```

### Fixture Design Pattern

Follow the same factory pattern as backend Story 2.2 — fixtures return factory functions that accept overrides:
```python
@pytest.fixture
def mock_arangodb():
    """Factory fixture returning a mock ArangoDB client."""
    client = MagicMock(spec=ArangoClient)
    db = MagicMock(spec=StandardDatabase)
    client.db.return_value = db

    # Default cursor behavior
    mock_cursor = MagicMock()
    mock_cursor.all.return_value = []
    mock_cursor.next.return_value = None
    db.query.return_value = mock_cursor

    # Collection mock
    mock_collection = MagicMock()
    db.collection.return_value = mock_collection

    return {"client": client, "db": db, "cursor": mock_cursor, "collection": mock_collection}
```

### Existing Ruff Configuration

From `genie-ai-overlay/pyproject.toml`:
```toml
[tool.ruff]
target-version = "py310"
line-length = 120
exclude = ["build-patches/"]

[tool.ruff.lint]
select = ["E", "W", "F", "I", "UP", "B", "SIM"]
ignore = ["E402", "E741"]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

### Cross-Component Fixture Consistency

Per architecture and Story 2.2 AC#8: fixture response shapes (user, conversation, file metadata) from the backend are the source of truth. OPEA fixtures dealing with user data or file metadata MUST match the shapes from `components/gov-chat-backend/__tests__/fixtures/users.js` and related fixtures.

**User shape (from backend):**
```python
# OPEA fixtures should match this shape when dealing with user data
MOCK_USER = {
    "_key": "user-123",
    "sub": "user-123",
    "iss_sub": "http://localhost:8080/realms/genie#user-123",
    "iss": "http://localhost:8080/realms/genie",
    "name": "Test User",
    "email": "test@example.com",
}
```

### Files to Create

| File | Action |
|------|--------|
| `genie-ai-overlay/pytest.ini` | NEW |
| `genie-ai-overlay/pyproject.toml` | MODIFY (add test deps) |
| `genie-ai-overlay/tests/__init__.py` | NEW (empty) |
| `genie-ai-overlay/tests/conftest.py` | NEW |
| `genie-ai-overlay/tests/test_conftest_fixtures.py` | NEW |

### Files NOT Modified

All existing Python service files in `genie-ai-overlay/` remain unchanged. The only modification is adding `[project.optional-dependencies]` to `pyproject.toml` — existing Ruff config stays intact.

### Directory Structure After This Story

```
genie-ai-overlay/
├── pyproject.toml          # MODIFIED: add [project.optional-dependencies]
├── pytest.ini              # NEW: pytest configuration
├── tests/
│   ├── __init__.py         # NEW: empty package marker
│   ├── conftest.py         # NEW: shared fixtures (mock_arangodb, mock_redis, mock_vllm, mock_tei, mock_comps)
│   └── test_conftest_fixtures.py  # NEW: self-tests for all fixtures
├── core/
├── chatqna/
├── retriever/
├── dataprep/
├── reranker/
└── build-patches/
```

### Dependencies to Mock (Complete List)

| Module | Mock Strategy | Used By |
|--------|--------------|----------|
| `comps` (entire tree) | `sys.modules` pre-population with MagicMock | ALL services |
| `arango.ArangoClient` | `unittest.mock.MagicMock(spec=ArangoClient)` | retriever, dataprep |
| `arango.database.StandardDatabase` | `unittest.mock.MagicMock(spec=StandardDatabase)` | retriever, dataprep |
| `langchain_arangodb.ArangoVector` | `unittest.mock.MagicMock` | retriever |
| `langchain_community.embeddings.HuggingFaceBgeEmbeddings` | `unittest.mock.MagicMock` | retriever |
| `langchain_huggingface.HuggingFaceEndpointEmbeddings` | `unittest.mock.MagicMock` | retriever |
| `langchain_openai.ChatOpenAI`, `OpenAIEmbeddings` | `unittest.mock.MagicMock` | retriever |
| `openai.AsyncOpenAI` | `unittest.mock.AsyncMock` | dataprep |
| `aiohttp.ClientSession` | `unittest.mock.AsyncMock` | chatqna, dataprep, reranker |
| `httpx.AsyncClient` | `unittest.mock.AsyncMock` | chatqna |
| `langdetect.detect` | `unittest.mock.MagicMock(return_value='en')` | chatqna |
| `transformers.AutoTokenizer` | `unittest.mock.MagicMock` | chatqna |
| `docling` | `unittest.mock.MagicMock` | dataprep |
| `rank_bm25.BM25Okapi` | `unittest.mock.MagicMock` | dataprep |
| `kneed.KneeLocator` | `unittest.mock.MagicMock` | reranker |

### Anti-Patterns to Avoid

- Do NOT install `comps` via pip — it's vendored at build time and cannot be installed locally
- Do NOT try to import actual OPEA service modules in conftest.py — they depend on `comps` which doesn't exist locally
- Do NOT use `pytest.ini` for `--junitxml` — let CI control output format
- Do NOT modify existing `[tool.ruff]` configuration in pyproject.toml
- Do NOT add `[tool.pytest.ini_options]` to pyproject.toml — pytest.ini is the single source of truth
- Do NOT create real ArangoDB, Redis, or HTTP connections in fixtures
- Do NOT skip the ITU copyright header — required on all Python test files
- Do NOT use `pytest-mock` or additional test dependencies beyond what's specified
- Do NOT hardcode fixture data — use factory functions with defaults + overrides

### Project Structure Notes

- OPEA services live at `genie-ai-overlay/` — separate ecosystem from backend/frontend
- Python 3.10+ target (per pyproject.toml `target-version = "py310"`)
- Ruff (not Black, not flake8) for linting and formatting
- `pyproject.toml` is the existing config file — add deps there, not in requirements.txt
- The `tests/` directory goes at `genie-ai-overlay/tests/` (pytest convention)
- FastAPI services tested with `httpx.AsyncClient` + `asgi-lifespan` (future stories)

### Downstream Impact

This story creates the mock foundation that ALL OPEA test stories (4.2–4.6) depend on. Stories 4.2–4.6 will import fixtures from `conftest.py`. The `mock_comps` fixture is the most critical — without it, no OPEA service can be imported in tests.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1] — Original story definition
- [Source: _bmad-output/planning-artifacts/architecture.md#OPEA Testing] — pytest config, mock strategy, fixture patterns
- [Source: _bmad-output/implementation-artifacts/2-2-create-backend-test-fixtures-and-shared-mocks.md] — Backend fixture patterns (cross-component consistency)
- [Source: genie-ai-overlay/pyproject.toml] — Existing Ruff configuration
- [Source: genie-ai-overlay/core/constants.py] — Service types, enums (fixtures may need these)
- [Source: genie-ai-overlay/core/genieai_api_protocol.py] — Custom Pydantic models (fixtures may need these shapes)
- [Source: genie-ai-overlay/retriever/genieai_retriever_arangodb.py] — ArangoDB + LangChain imports
- [Source: genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py] — comps + docling + openai imports
- [Source: genie-ai-overlay/reranker/genieai_tei_reranker.py] — TEI + kneed imports
- [Source: genie-ai-overlay/chatqna/genieai_chatqna.py] — comps + transformers + langdetect imports
- [Source: _bmad-output/project-context.md#Python OPEA Services] — PEP 8, ruff, CustomLogger, copyright headers

## Dev Agent Record

### Agent Model Used

Claude Code (GLM-5-turbo)

### Debug Log References

- Initial attempt used `MagicMock(spec=ArangoClient)` which required importing `arango` — not available in test venv. Fixed by removing spec-based mocks (plain MagicMock).
- `git stash` doesn't include untracked files — had to manually copy new files from PRD worktree to story worktree.
- pyproject.toml needed `[project]` section (name, version) and `[tool.setuptools] packages = []` for editable install to work with flat layout.

### Completion Notes List

- All 10 ACs satisfied: pytest.ini, pyproject.toml test deps, conftest.py with 5 fixtures (mock_arangodb, mock_redis, mock_vllm, mock_tei, mock_comps), autouse env var fixture, ITU copyright headers, Ruff compliance, 28 self-tests passing.
- comps library mocked via sys.modules pre-population — no pip install needed.
- Story branch: feat/testing-framework/4-1-configure-pytest-and-create-shared-fixtures-for-opea
- Added CLAUDE.md in genie-ai-overlay/ for venv/test/lint instructions.

**Murat (Test Architect) review — 3 findings addressed:**
1. (High) mock_comps was mutating a module-level singleton — fixed: each factory call creates a fresh MagicMock. Test `test_isolation_between_calls` validates no cross-contamination.
2. (High) Fixtures were not factory functions — fixed: all 5 fixtures now return inner `_factory()` with keyword overrides (cursor_results, get_value, default_text, etc.). 5 new tests cover override paths.
3. (Medium) pyproject.toml `packages = []` was undocumented — fixed: added `[build-system]` (PEP 517) and header comment explaining why overlay is not a pip-installable package.

### File List

- `genie-ai-overlay/pytest.ini` — NEW
- `genie-ai-overlay/pyproject.toml` — MODIFIED (added [project] + [project.optional-dependencies] + [tool.setuptools])
- `genie-ai-overlay/CLAUDE.md` — NEW
- `genie-ai-overlay/tests/__init__.py` — NEW
- `genie-ai-overlay/tests/conftest.py` — NEW
- `genie-ai-overlay/tests/test_conftest_fixtures.py` — NEW
- `_bmad-output/implementation-artifacts/4-1-configure-pytest-and-create-shared-fixtures-for-opea.md` — MODIFIED
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED

### Review Findings

- [x] [Review][Defer] Missing comps submodule mocks for telemetry/retrievers/rerankers paths [conftest.py:14-26] — deferred, pre-existing. Actual service imports (stories 4.2-4.6) may need `comps.cores.telemetry`, `comps.retrievers.src.*`, `comps.rerankings.src.*` added to sys.modules pre-population. Current mock list matches the spec Dev Notes exactly; self-tests pass without these.
- [x] [Review][Defer] Mock response shapes may need dict-access support for service code [conftest.py:176-244] — deferred, pre-existing. chatqna uses `data["choices"][0]["message"]["content"]` (dict access) while mocks provide attribute access. Stories 4.2-4.6 may need to extend mock helpers to support both access patterns.
