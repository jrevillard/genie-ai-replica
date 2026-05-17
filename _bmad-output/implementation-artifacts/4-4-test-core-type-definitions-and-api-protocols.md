# Story 4.4: Test Core Type Definitions and API Protocols

Status: ready-for-dev

## Story

As a developer,
I want pytest tests for shared core type definitions,
so that Pydantic models, protocol constants, and type validation are verified as a foundation for other OPEA tests.

## Acceptance Criteria

1. **Given** `genie-ai-overlay/core/constants.py` defines service enums, **when** I run `tests/test_core.py`, **then** tests verify `ServiceRoleType`, `ServiceType`, `MegaServiceEndpoint`, and `MicroServiceEndpoint` enum values and `__str__` behavior
2. **Given** `genie-ai-overlay/core/genieai_api_protocol.py` defines custom Pydantic models, **when** I run `tests/test_core.py`, **then** tests verify `RetrievalRequestArangoDB` serialization/deserialization with optional graph/hybrid search fields
3. **Given** `RequestContext` is a metadata filtering model, **when** I run tests, **then** tests verify construction, defaults, and optional field handling
4. **Given** `ChatCompletionRequest` extends OpenAI's protocol with GENIE.AI fields, **when** I run tests, **then** tests verify required fields, defaults, GENIE.AI-specific fields (context, language, image_path, audio_path), retrieval parameters, and reranking parameters
5. **Given** `TranslationRequest` is a simple model, **when** I run tests, **then** tests verify required/optional fields
6. **Given** `ArangoDBDataprepRequestFromDocRepo` extends the OPEA base, **when** I run tests, **then** tests verify GENIE.AI file metadata fields (file_id, storage_path, file_type, file_labels) are set correctly while OPEA fields pass through to super()
7. **Given** this story is a prerequisite for Stories 4.5 and 4.6, **when** tests complete, **then** all type validation patterns are established for downstream test suites to rely on

## Tasks / Subtasks

- [ ] Task 1: Set up test imports and conftest compatibility (AC: #1-7)
  - [ ] 1.1 Create `genie-ai-overlay/tests/test_core.py` with ITU copyright header
  - [ ] 1.2 Import core modules: `from core.constants import ServiceRoleType, ServiceType, MegaServiceEndpoint, MicroServiceEndpoint` and `from core.genieai_api_protocol import RetrievalRequestArangoDB, RequestContext, ChatCompletionRequest, TranslationRequest, ArangoDBDataprepRequestFromDocRepo`
  - [ ] 1.3 Verify conftest.py already mocks `comps.cores.proto.api_protocol` and `comps.cores.proto.genieai_api_protocol` — no new sys.modules entries needed since `core/` uses `from api_protocol import *` (vendored OPEA)
- [ ] Task 2: Test constants.py enum definitions (AC: #1)
  - [ ] 2.1 `TestServiceRoleType` — verify enum members (`MICROSERVICE=0`, `MEGASERVICE=1`), value types
  - [ ] 2.2 `TestServiceType` — verify enum member count (25 members), verify key members (`EMBEDDING`, `RETRIEVER`, `RERANK`, `LLM`, `DATAPREP`, `GUARDRAIL`, `TRANSLATOR`), verify all values are unique
  - [ ] 2.3 `TestMegaServiceEndpoint` — verify endpoint paths (`/v1/chatqna`, `/v1/translation`, `/v1/chat/completions`, etc.), verify `__str__` returns path string
  - [ ] 2.4 `TestMicroServiceEndpoint` — verify endpoint paths (`/v1/microservice/*`), verify `__str__` returns path string
- [ ] Task 3: Test RetrievalRequestArangoDB model (AC: #2)
  - [ ] 3.1 Verify construction with all optional graph/hybrid fields (graph_name, search_start, search_mode, num_centroids, distance_strategy, use_approx_search, enable_traversal, enable_summarizer, traversal_max_depth, traversal_max_returned, traversal_score_threshold, traversal_query, context)
  - [ ] 3.2 Verify all fields default to `None`
  - [ ] 3.3 Verify model serializes to dict with `model_dump()` (exclude None defaults)
  - [ ] 3.4 Verify deserialization from dict with correct types
- [ ] Task 4: Test RequestContext model (AC: #3)
  - [ ] 4.1 Verify construction with all fields (categoryLabel, serviceLabels, language)
  - [ ] 4.2 Verify all fields default to `None`
  - [ ] 4.3 Verify construction with values, serialization round-trip
- [ ] Task 5: Test ChatCompletionRequest model (AC: #4)
  - [ ] 5.1 Verify required field `messages` (accepts string, list of dicts, complex nested formats)
  - [ ] 5.2 Verify OpenAI-compatible defaults (temperature=0.01, max_tokens=1024, stream=False, n=1)
  - [ ] 5.3 Verify GENIE.AI-specific fields: `context` (RequestContext), `language` (default "auto"), `image_path`, `audio_path`
  - [ ] 5.4 Verify retrieval fields: search_type, k, fetch_k, score_threshold, retrieved_docs
  - [ ] 5.5 Verify reranking fields: reranking_strategy, top_n, reranking_threshold, reranked_docs
  - [ ] 5.6 Verify `request_type` is always "chat"
  - [ ] 5.7 Verify embedding fields: input, encoding_format, dimensions, embedding
  - [ ] 5.8 Verify serialization round-trip preserves all field types
- [ ] Task 6: Test TranslationRequest model (AC: #5)
  - [ ] 6.1 Verify required field `text`, optional field `stream` defaults to False
  - [ ] 6.2 Verify construction, serialization, deserialization round-trip
- [ ] Task 7: Test ArangoDBDataprepRequestFromDocRepo model (AC: #6)
  - [ ] 7.1 Verify construction with GENIE.AI file metadata fields (file_id, file_name, storage_path, file_path, file_type, file_labels, upload_date)
  - [ ] 7.2 Verify OPEA passthrough fields are forwarded to super().__init__() (chunk_size, chunk_overlap, process_table, table_strategy, graph_name, etc.)
  - [ ] 7.3 Verify defaults: chunk_size=1500, chunk_overlap=100, process_table=False, table_strategy="fast"
  - [ ] 7.4 Verify all GENIE.AI fields default to None when not provided
- [ ] Task 8: Run full test suite and validate (AC: #7)
  - [ ] 8.1 Run `python -m pytest tests/ -v` — all tests pass (new + existing retriever + dataprep tests)
  - [ ] 8.2 Run `ruff check tests/test_core.py` — clean
  - [ ] 8.3 Run `ruff format --check tests/test_core.py` — clean

## Dev Notes

### Critical: OPEA Vendored Import Chain

`genieai_api_protocol.py` uses `from api_protocol import *` which imports from the vendored OPEA `comps.cores.proto.api_protocol`. The conftest.py **already mocks** this module at collection time:

```python
sys.modules.setdefault("comps.cores.proto.api_protocol", MagicMock())
```

This means all OPEA base types (`RetrievalRequest`, `ArangoDBDataprepRequest`, `ResponseFormat`, `StreamOptions`, `ChatCompletionToolsParam`, `ChatCompletionNamedToolChoiceParam`, `RetrievalResponseData`, `RerankingResponseData`, `EmbeddingResponse`, `UploadFile`) resolve to `MagicMock` objects at import time. **This is expected and correct** — we test the GENIE.AI custom extensions, not the OPEA base classes.

**HOWEVER**: Because the OPEA base types are MagicMock, we CANNOT instantiate models that inherit from them directly in the normal way. The approach depends on whether the mocked base type supports Pydantic model behavior:

- `RetrievalRequestArangoDB(RetrievalRequest)` — `RetrievalRequest` is MagicMock, so this class may not behave as a proper Pydantic model
- `ChatCompletionRequest(BaseModel)` — inherits from `pydantic.BaseModel` directly (imported explicitly), so this **will** work as a proper Pydantic model
- `RequestContext(BaseModel)` — inherits from `pydantic.BaseModel` directly, so this **will** work
- `TranslationRequest(BaseModel)` — inherits from `pydantic.BaseModel` directly, so this **will** work
- `ArangoDBDataprepRequestFromDocRepo(ArangoDBDataprepRequest)` — `ArangoDBDataprepRequest` is MagicMock, so may not behave properly

**Strategy**: For models that inherit from mocked OPEA bases (`RetrievalRequestArangoDB`, `ArangoDBDataprepRequestFromDocRepo`), test them by verifying class attributes and construction patterns rather than full Pydantic serialization. For models inheriting directly from `BaseModel` (`ChatCompletionRequest`, `RequestContext`, `TranslationRequest`), test full Pydantic validation and serialization.

### Critical: Verify Mock Compatibility Before Writing Tests

Before writing each test class, verify the actual behavior of the model class with the mocked OPEA base. Run a quick import test:

```python
# In a python session or temporary test:
from core.genieai_api_protocol import RetrievalRequestArangoDB
# Check: is RetrievalRequestArangoDB a proper class? Can we instantiate it?
# If MagicMock base prevents instantiation, adapt test strategy
```

### Source File Details

**`genie-ai-overlay/core/constants.py`** (96 lines):
- `ServiceRoleType(Enum)` — 2 members: MICROSERVICE=0, MEGASERVICE=1
- `ServiceType(Enum)` — 25 members (0-24): GATEWAY through TRANSLATOR
- `MegaServiceEndpoint(Enum)` — 28 endpoint paths with `__str__` returning path value
- `MicroServiceEndpoint(Enum)` — 9 endpoint paths with `__str__` returning path value

**`genie-ai-overlay/core/genieai_api_protocol.py`** (241 lines):
- `RetrievalRequestArangoDB(RetrievalRequest)` — 13 optional fields for graph traversal, hybrid search, context
- `RequestContext(BaseModel)` — 3 optional fields: categoryLabel, serviceLabels, language
- `ChatCompletionRequest(BaseModel)` — ~70 fields covering OpenAI + vLLM + TGI + GENIE.AI extensions
  - OpenAI fields: messages, model, temperature, max_tokens, stream, top_p, etc.
  - vLLM fields: repetition_penalty, best_of
  - TGI fields: top_k, typical_p, timeout
  - Extra params: echo, add_generation_prompt, add_special_tokens, documents, chat_template
  - Embedding fields: input, encoding_format, dimensions, embedding
  - Retrieval fields: search_type, k, fetch_k, score_threshold, retrieved_docs
  - Reranking fields: reranking_strategy, top_n, reranking_threshold, reranked_docs
  - GENIE.AI: context (RequestContext), language ("auto"), image_path, audio_path
  - request_type: Literal["chat"] = "chat"
- `TranslationRequest(BaseModel)` — text (str, required), stream (bool, default False)
- `ArangoDBDataprepRequestFromDocRepo(ArangoDBDataprepRequest)` — custom __init__ with file metadata fields

### Test Organization

Follow the established pattern from test_retriever.py and test_dataprep.py:
- Class-per-feature-group with descriptive `test_method_scenario` names
- AAA structure (Arrange-Act-Assert)
- Descriptive docstrings on each test
- ITU copyright header
- No external dependencies beyond pytest + pydantic + existing conftest.py

### Testing Standards

- **Runner**: pytest 9.x
- **Location**: `genie-ai-overlay/tests/test_core.py`
- **Lint**: ruff (target py310, line-length 120, double quotes)
- **Header**: ITU copyright (`# Copyright (c) 2024-2026 International Telecommunication Union (ITU)`)
- **Naming**: `class TestFeatureGroup:` with `def test_method_scenario():`

### Previous Story Intelligence (Story 4.3)

Key learnings from Stories 4.1-4.3:
- conftest.py sys.modules block handles all OPEA vendored imports — no need to add entries for `core/` modules (they import from mocked `api_protocol`)
- `patch.object(module, "CONSTANT_NAME", value)` is needed for module-level constants that are evaluated at import time (NOT relevant for this story — core types are class definitions, not env-var-derived constants)
- Tests run from `genie-ai-overlay/` directory with venv activated
- All 112 existing tests (76 retriever + 36 dataprep) must continue to pass

### References

- [Source: genie-ai-overlay/core/constants.py] — Enum definitions
- [Source: genie-ai-overlay/core/genieai_api_protocol.py] — Pydantic model definitions
- [Source: genie-ai-overlay/tests/conftest.py] — Existing mock setup
- [Source: _bmad-output/planning-artifacts/architecture.md#OPEA Test Suite Structure] — test_core.py location
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 4 Story 4.4] — Story requirements

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
