# Story 4.5: Test Reranker Score Validation and Top-K Constraints

Status: ready-for-dev

## Story

As a developer,
I want pytest tests for the reranker's score validation and result limiting,
so that score boundaries and top-K enforcement are validated.

## Acceptance Criteria

1. **Given** `genieai_tei_reranker.py` validates scores and enforces top-K constraints, **when** I create `tests/test_reranker.py`, **then** tests verify score validation accepts valid scores (0.0–1.0) and rejects out-of-range values
2. **Given** the reranker supports `top_n` parameter, **when** I run tests, **then** tests verify top-K constraint enforcement returns exactly K results for the "slice" strategy
3. **Given** the reranker calls the TEI `/rerank` endpoint, **when** I run tests, **then** tests verify TEI service call with correct payload (query + texts)
4. **Given** TEI service is mocked via conftest fixture, **when** I run tests, **then** all external dependencies are mocked and no real network calls occur
5. **Given** the reranker supports 3 strategies plus a fallback, **when** I run tests, **then** tests cover all 4 code paths: "slice", "threshold", "knee_threshold", and unknown strategy fallback

## Tasks / Subtasks

- [ ] Task 1: Update conftest.py with reranker-specific mocks (AC: #4)
  - [ ] 1.1 Add `sys.modules.setdefault("kneed", MagicMock())` and `sys.modules.setdefault("kneed", MagicMock()).KneeLocator = MagicMock()` to the conftest mock block
  - [ ] 1.2 Add `sys.modules.setdefault("integrations", MagicMock())` and `sys.modules.setdefault("integrations.tei", MagicMock())` for the `from integrations.tei import OpeaTEIReranking` import
  - [ ] 1.3 Verify `comps.cores.proto.opea_docarray` is already mocked — add specific mock types if needed: `SearchedDoc`, `LLMParamsDoc`, `RerankedDoc`, `SearchedMultimodalDoc`, `LVMVideoDoc`
  - [ ] 1.4 Verify all existing tests still pass after conftest changes
- [ ] Task 2: Create helper functions for test setup (AC: #1–5)
  - [ ] 2.1 Create `create_reranker()` helper that instantiates `GenieTEIReranking.__new__()` with `base_url` set (bypasses `__init__` which calls OPEA parent)
  - [ ] 2.2 Create `create_mock_searched_doc()` helper returning a mock `GenieSearchedDoc` with `retrieved_docs` list and `initial_query`
  - [ ] 2.3 Create `create_tei_rerank_response()` helper returning a list of dicts with `index` and `score` fields, simulating TEI `/rerank` response
  - [ ] 2.4 Create `mock_aiohttp_session()` helper that returns an async context manager mock for `aiohttp.ClientSession()` with configurable response data
- [ ] Task 3: Test "slice" strategy — top-K enforcement (AC: #2, #5)
  - [ ] 3.1 Test that slice with `top_n=1` returns exactly 1 result (the highest-scored)
  - [ ] 3.2 Test that slice with `top_n=3` returns exactly 3 results when 5 documents are available
  - [ ] 3.3 Test that slice with `top_n` greater than available docs returns all available docs
  - [ ] 3.4 Test that slice uses `RERANKER_TOP_N` env var default when `top_n` not in input
  - [ ] 3.5 Verify returned results preserve original document text and TEI score
- [ ] Task 4: Test "threshold" strategy — score boundary validation (AC: #1, #5)
  - [ ] 4.1 Test that threshold strategy returns only documents with score >= `reranking_threshold`
  - [ ] 4.2 Test with all documents above threshold — all returned
  - [ ] 4.3 Test with all documents below threshold — empty results
  - [ ] 4.4 Test with mixed scores — only above-threshold returned
  - [ ] 4.5 Test that threshold uses `RERANKING_THRESHOLD` env var default (0.75) when not in input
- [ ] Task 5: Test "knee_threshold" strategy — KneeLocator integration (AC: #5)
  - [ ] 5.1 Test that knee_threshold strategy calls `KneeLocator` with correct params (indices, scores, curve="convex", direction="decreasing")
  - [ ] 5.2 Test when knee is found — returns docs up to knee+1
  - [ ] 5.3 Test when knee is None — returns all documents
  - [ ] 5.4 Verify `kneed` mock is properly configured in conftest
- [ ] Task 6: Test unknown strategy fallback (AC: #5)
  - [ ] 6.1 Test that unknown strategy falls back to slice behavior using `input.top_n`
  - [ ] 6.2 Verify logger.warning is called with the unknown strategy name
- [ ] Task 7: Test TEI service call payload (AC: #3)
  - [ ] 7.1 Verify `aiohttp.ClientSession.post()` is called with URL `{base_url}/rerank`
  - [ ] 7.2 Verify JSON payload contains `query` and `texts` keys
  - [ ] 7.3 Verify `texts` contains document text strings from `retrieved_docs`
  - [ ] 7.4 Verify `query` comes from `input.initial_query` for SearchedDoc inputs
- [ ] Task 8: Test empty/no-docs edge cases (AC: #1)
  - [ ] 8.1 Test when `retrieved_docs` is empty list — returns empty results (early return)
  - [ ] 8.2 Test when `retrieved_docs` is None — verify behavior (may raise or return empty)
- [ ] Task 9: Test output types for different input types (AC: #5)
  - [ ] 9.1 Test that SearchedDoc input returns `RerankingResponse` with `reranked_docs` list
  - [ ] 9.2 Test that `RerankingRequest` input returns `RerankingResponse`
  - [ ] 9.3 Test that `ChatCompletionRequest` input returns the same input with `reranked_docs` and `documents` fields populated
- [ ] Task 10: Test environment variable defaults (AC: #1–5)
  - [ ] 10.1 Test `RERANKING_STRATEGY` defaults to "slice"
  - [ ] 10.2 Test `RERANKING_THRESHOLD` defaults to 0.75
  - [ ] 10.3 Test `RERANKER_TOP_N` defaults to 1
  - [ ] 10.4 Test that input-level overrides take precedence over env defaults
- [ ] Task 11: Run full test suite and validate (AC: #1–5)
  - [ ] 11.1 Run `python -m pytest tests/ -v` — all tests pass (new + existing)
  - [ ] 11.2 Run `ruff check tests/test_reranker.py` — clean
  - [ ] 11.3 Run `ruff format --check tests/test_reranker.py` — clean

## Dev Notes

### Critical: OPEA Vendored Import Chain

The reranker imports are:

```python
# genieai_tei_reranker.py
from comps import CustomLogger, LLMParamsDoc, OpeaComponentRegistry, SearchedDoc
from comps.cores.proto.api_protocol import ChatCompletionRequest, RerankingRequest, RerankingResponse, RerankingResponseData
from integrations.tei import OpeaTEIReranking
from kneed import KneeLocator
import aiohttp

# genieai_reranking_microservice.py
from comps import CustomLogger, OpeaComponentLoader, ServiceType, opea_microservices, register_microservice, register_statistics, statistics_dict
from comps.cores.proto.api_protocol import ChatCompletionRequest, RerankingRequest, RerankingResponse
from comps.cores.proto.opea_docarray import LLMParamsDoc, LVMVideoDoc, RerankedDoc, SearchedDoc, SearchedMultimodalDoc
from comps.rerankings.src.integrations.genieai_tei_reranker import GenieTEIReranking
```

**Modules already mocked in conftest.py**: `comps`, `comps.cores.proto.api_protocol`, `aiohttp`, `comps.cores.proto`

**Modules NOT yet mocked** (must add to conftest.py):
- `kneed` — `KneeLocator` class used in knee_threshold strategy
- `integrations` and `integrations.tei` — base class `OpeaTEIReranking` for `GenieTEIReranking`
- `comps.cores.proto.opea_docarray` — for `SearchedDoc`, `LLMParamsDoc`, `RerankedDoc`, etc.
- `comps.rerankings` and submodules — only needed if testing the microservice wrapper

### Critical: Bypassing __init__ for Testable Instances

`GenieTEIReranking` inherits from `OpeaTEIReranking` which is mocked. The parent `__init__` calls OPEA infrastructure. Use `__new__()` to create instances for testing:

```python
def create_reranker(base_url="http://localhost:80"):
    reranker = GenieTEIReranking.__new__(GenieTEIReranking)
    reranker.base_url = base_url
    return reranker
```

### Critical: Mocking aiohttp for TEI Rerank Call

The reranker creates an `aiohttp.ClientSession()` inline in `invoke()`. The conftest already mocks `aiohttp` at module level, but the test needs a properly structured async context manager mock:

```python
from contextlib import asynccontextmanager

def create_mock_aiohttp_session(response_data):
    """Create mock aiohttp session returning specific TEI rerank responses."""
    mock_resp = AsyncMock()
    mock_resp.json = AsyncMock(return_value=response_data)
    mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_resp.__aexit__ = AsyncMock(return_value=False)

    mock_session = AsyncMock()
    mock_session.post = MagicMock(return_value=mock_resp)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    return mock_session
```

Then patch `aiohttp.ClientSession` in the test to return this mock:

```python
with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
    result = await reranker.invoke(input_doc)
```

### Critical: Mocking KneeLocator for knee_threshold Tests

`kneed.KneeLocator` is called with `(indices, document_scores, curve="convex", direction="decreasing")`. The `.knee` attribute determines the cutoff:

```python
mock_knee = MagicMock()
mock_knee.knee = 2  # means cutoff at index 3 (knee + 1)
with patch("reranker.genieai_tei_reranker.KneeLocator", return_value=mock_knee):
    result = await reranker.invoke(input_doc)
```

When `knee is None`, all documents are returned.

### Source File Details

**`genie-ai-overlay/reranker/genieai_tei_reranker.py`** (139 lines):

- `GenieSearchedDoc(SearchedDoc)` — extends SearchedDoc with `reranking_strategy`, `reranking_threshold`, `top_n` fields
- Environment constants: `RERANKING_STRATEGY` (default "slice"), `RERANKING_THRESHOLD` (default 0.75), `RERANKER_TOP_N` (default 1)
- `GenieTEIReranking.invoke()` — main entry point:
  1. Extracts strategy/threshold/top_n from input or env defaults
  2. If `input.retrieved_docs` is truthy, calls TEI `/rerank` endpoint
  3. Applies one of 4 strategies to filter results
  4. Returns `RerankingResponse` (for SearchedDoc/RerankingRequest) or modified `ChatCompletionRequest`

**Strategy Details:**

| Strategy | Behavior | Parameters |
|---|---|---|
| `slice` | Returns top N results by score | `top_n` (env default: 1) |
| `threshold` | Returns results with score >= threshold | `reranking_threshold` (env default: 0.75) |
| `knee_threshold` | Uses KneeLocator to find score drop-off, returns up to cutoff | KneeLocator(convex, decreasing) |
| unknown | Falls back to slice using `input.top_n` | Logs warning |

**TEI Response Format:**
```json
[
  {"index": 0, "score": 0.95},
  {"index": 2, "score": 0.82},
  {"index": 1, "score": 0.61}
]
```
TEI returns results sorted by score (descending), with original document indices.

**Return Types:**
- `SearchedDoc` input → `RerankingResponse(reranked_docs=[RerankingResponseData(text, score)])`
- `RerankingRequest` input → `RerankingResponse(reranked_docs=[...])`
- `ChatCompletionRequest` input → same input with `reranked_docs` and `documents` fields set

### Important: The Reranker Does NOT Validate Score Ranges

Looking at the source code carefully: `genieai_tei_reranker.py` does **not** validate that scores are in [0.0, 1.0] range. It trusts TEI responses and passes scores through. The AC "rejects out-of-range values" should be interpreted as: verify that scores from TEI are passed through as-is (no transformation), and test that the threshold strategy correctly compares against the configured threshold regardless of the actual score range. Do NOT write a test that expects a score validation error — the code doesn't perform one.

### Test Organization

Follow established pattern from test_retriever.py and test_dataprep.py:
- Helper functions at top (create_reranker, create_mock_searched_doc, etc.)
- Class-per-strategy: `TestSliceStrategy`, `TestThresholdStrategy`, `TestKneeThresholdStrategy`
- Class-per-feature: `TestTeiServiceCall`, `TestOutputTypes`, `TestEnvDefaults`, `TestEdgeCases`
- AAA structure (Arrange-Act-Assert)
- Descriptive docstrings on each test
- ITU copyright header

### Testing Standards

- **Runner**: pytest 9.x
- **Location**: `genie-ai-overlay/tests/test_reranker.py`
- **Lint**: ruff (target py310, line-length 120, double quotes)
- **Header**: ITU copyright (`# Copyright (c) 2024-2026 International Telecommunication Union (ITU)`)
- **Naming**: `class TestFeatureGroup:` with `def test_method_scenario():`
- **Async**: Use `async def test_*()` — pytest-asyncio handles the rest

### Previous Story Intelligence (Story 4.4)

Key learnings from Stories 4.1–4.4:
- conftest.py sys.modules block handles all OPEA vendored imports — new modules need adding only if not already covered
- `patch.object(module, "CONSTANT_NAME", value)` is needed for module-level constants evaluated at import time (e.g., `RERANKING_STRATEGY`, `RERANKING_THRESHOLD`, `RERANKER_TOP_N`)
- Use `monkeypatch.setenv()` for env var tests (autouse fixture already sets base env vars)
- Tests run from `genie-ai-overlay/` directory with venv activated
- All existing tests must continue to pass — verify with full suite run
- OPEA base class types (SearchedDoc, etc.) are MagicMock — use standalone mock objects for test inputs rather than trying to instantiate them
- For models that inherit from mocked bases, test via mock input objects with the expected attributes set

### References

- [Source: genie-ai-overlay/reranker/genieai_tei_reranker.py] — Main reranker logic with 3 strategies
- [Source: genie-ai-overlay/reranker/genieai_reranking_microservice.py] — Microservice wrapper (lower priority for testing)
- [Source: genie-ai-overlay/tests/conftest.py] — Existing mock setup, needs kneed/integrations.tei additions
- [Source: genie-ai-overlay/tests/test_dataprep.py] — Reference for helper function patterns
- [Source: genie-ai-overlay/tests/test_retriever.py] — Reference for mocking aiohttp patterns
- [Source: _bmad-output/planning-artifacts/architecture.md#OPEA Test Suite Structure] — test_reranker.py location
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 4 Story 4.5] — Story requirements

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
