# Story 4.2: Test Retriever Hybrid Search Logic

Status: done

## Story

As a developer,
I want pytest tests for the retriever's hybrid search (vector + graph + labels),
so that retrieval logic is validated without real ArangoDB or embedding services.

## Acceptance Criteria

1. **AC1: Test file created** — `genie-ai-overlay/tests/test_retriever.py` is created with ITU copyright header, covering `GenieaiArangoRetriever` from `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`.

2. **AC2: Hybrid search combination** — Tests verify that `invoke()` combines vector similarity search, graph traversal (`fetch_neighborhoods`), and label filtering in a single call when `enable_traversal=True` and labels are provided.

3. **AC3: Query construction for search modes** — Tests verify `_build_subquery()` produces correct AQL for all three `search_start` modes: `"node"`, `"edge"`, and `"chunk"`. Each mode produces structurally different AQL queries. Custom `traversal_query` overrides the built-in query.

4. **AC4: Score threshold filtering** — Tests verify that `fetch_neighborhoods()` filters results below `traversal_score_threshold`. Invalid `distance_strategy` values (not `"COSINE"` or `"EUCLIDEAN_DISTANCE"`) raise `HTTPException(400)`.

5. **AC5: Pagination and top-K** — Tests verify `invoke()` passes `k`, `fetch_k`, `lambda_mult` parameters to vector search methods (`asimilarity_search_with_relevance_scores`, `amax_marginal_relevance_search`, `asimilarity_search`). Tests verify `LIMIT` in AQL subqueries respects `traversal_max_returned`.

6. **AC6: Empty ArangoDB results** — Tests verify `invoke()` returns `[]` when ArangoDB returns empty collections (`collection_count == 0`), missing graph (`has_graph() == False`), missing collection, or missing embedding field on documents.

7. **AC7: ArangoDB ConnectionError** — Tests verify `check_health()` returns `False` when ArangoDB throws an exception. Tests verify `invoke()` returns `[]` (not raises) when embedding generation or vector search fails.

8. **AC8: Label filter AQL construction** — Tests verify the AQL filter clause is constructed correctly for both `"OR"` and `"AND"` filter strategies. Invalid `filter_strategy` raises `HTTPException(400)`. Empty labels produce no filter clause.

9. **AC9: Summarization prompt** — Tests verify `generate_summarization_prompt()` produces a prompt containing the query and document text.

10. **AC10: All services mocked** — ArangoDB (`arango`), LangChain (`langchain_arangodb`, `langchain_community`, `langchain_huggingface`, `langchain_openai`), OpenAI (`openai`), and `comps` are fully mocked. No real external connections. All tests pass Ruff linting and formatting.

## Tasks / Subtasks

- [ ] Task 1: Create retriever-specific mock helpers (AC: #10)
  - [ ] 1.1 Add retriever-specific `sys.modules` entries in a test helper or conftest section for: `langchain_arangodb`, `langchain_community`, `langchain_community.embeddings`, `langchain_huggingface`, `langchain_openai`, `openai` — these are import-time dependencies that must be pre-populated before `genieai_retriever_arangodb` can be collected by pytest
  - [ ] 1.2 Create a `create_retriever()` helper that patches `_initialize_client` and optionally `_initialize_llm` so `GenieaiArangoRetriever` can be instantiated without real connections
  - [ ] 1.3 Create mock data factories: `create_mock_search_result(doc_id, text, score, metadata)`, `create_mock_document(key, text, embedding)`, `create_mock_input(query, **overrides)` for building test inputs that match `ChatCompletionRequest` / `RetrievalRequest` shapes

- [ ] Task 2: Test `_build_subquery()` — pure AQL construction (AC: #3)
  - [ ] 2.1 Test `search_start="node"` produces AQL with `FOR node, edge IN 1..depth ANY doc GRAPH_LINKS_TO` pattern
  - [ ] 2.2 Test `search_start="edge"` produces AQL with `DOCUMENT(GRAPH_SOURCE, doc.source_id)` pattern
  - [ ] 2.3 Test `search_start="chunk"` produces AQL with `INBOUND doc GRAPH_HAS_SOURCE` pattern
  - [ ] 2.4 Test custom `traversal_query` overrides built-in query and handles `@query_embedding` bind var
  - [ ] 2.5 Test distance strategy sets correct score function: `"COSINE"` → `COSINE_SIMILARITY` + `DESC`, `"EUCLIDEAN_DISTANCE"` → `L2_DISTANCE` + `ASC`

- [ ] Task 3: Test `fetch_neighborhoods()` — graph traversal logic (AC: #4, #5)
  - [ ] 3.1 Test single-query mode (`max_workers=1`) executes AQL and returns neighborhoods dict
  - [ ] 3.2 Test threaded mode (`max_workers > 1`) with `ThreadPoolExecutor` returns combined neighborhoods
  - [ ] 3.3 Test invalid `distance_strategy` raises `HTTPException(400)`
  - [ ] 3.4 Test `traversal_max_depth` and `traversal_max_returned` are clamped to minimum 1
  - [ ] 3.5 Test `ARANGO_TRAVERSAL_CONCURRENT_BATCHES` is capped at 4 and floored at 1

- [ ] Task 4: Test `invoke()` — main retrieval flow (AC: #2, #5, #6, #7)
  - [ ] 4.1 Test vector-only search (`enable_traversal=False`, no labels) returns search results via mocked `ArangoVector.asimilarity_search_with_relevance_scores`
  - [ ] 4.2 Test hybrid search (`enable_traversal=True`) calls `fetch_neighborhoods` and enriches results with neighborhood data
  - [ ] 4.3 Test label filtering with `"OR"` strategy produces correct AQL filter clause
  - [ ] 4.4 Test label filtering with `"AND"` strategy produces correct AQL filter clause
  - [ ] 4.5 Test invalid `filter_strategy` raises `HTTPException(400)`
  - [ ] 4.6 Test empty query returns `[]`
  - [ ] 4.7 Test missing graph returns `[]` (`db.has_graph() == False`)
  - [ ] 4.8 Test empty collection returns `[]` (`collection.count() == 0`)
  - [ ] 4.9 Test missing embedding field on document returns `[]`
  - [ ] 4.10 Test embedding generation failure returns `[]` (not raises)
  - [ ] 4.11 Test vector search failure returns `[]` (not raises)
  - [ ] 4.12 Test `search_type="mmr"` calls `amax_marginal_relevance_search` with correct params
  - [ ] 4.13 Test default `search_type="similarity"` calls `asimilarity_search`
  - [ ] 4.14 Test file_id metadata enrichment for `search_start="chunk"` via AQL lookup

- [ ] Task 5: Test `check_health()` and `generate_summarization_prompt()` (AC: #7, #9)
  - [ ] 5.1 Test `check_health()` returns `True` when `db.version()` succeeds
  - [ ] 5.2 Test `check_health()` returns `False` when `db.version()` raises exception
  - [ ] 5.3 Test `generate_summarization_prompt()` includes query and text in output

- [ ] Task 6: Verify all tests pass and code is clean (AC: #10)
  - [ ] 6.1 Run `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_retriever.py -v` — all tests pass
  - [ ] 6.2 Run existing conftest fixture tests still pass: `python -m pytest tests/test_conftest_fixtures.py -v`
  - [ ] 6.3 Run `ruff check tests/test_retriever.py` — zero lint errors
  - [ ] 6.4 Run `ruff format --check tests/test_retriever.py` — formatting passes

## Dev Notes

### Critical: Cannot Instantiate Retriever Normally

`GenieaiArangoRetriever.__init__` calls `_initialize_client()` which creates a **real ArangoDB connection** (`ArangoClient(hosts=ARANGO_URL)`) and optionally `_initialize_llm()` which creates a real LLM client. These MUST be bypassed for testing.

**Approach:** Patch `_initialize_client` and `_initialize_llm` as no-ops, then manually set `self.db` to a mock:

```python
def create_retriever(db_mock=None, with_llm=False):
    """Create a GenieaiArangoRetriever with mocked dependencies."""
    with patch.object(GenieaiArangoRetriever, "_initialize_client"):
        with patch.object(GenieaiArangoRetriever, "_initialize_llm"):
            retriever = GenieaiArangoRetriever(
                name="test-retriever",
                description="Test retriever",
            )
    retriever.db = db_mock or MagicMock()
    if with_llm:
        retriever.llm = MagicMock()
    return retriever
```

### Critical: Import-Time Dependencies Must Be Pre-Populated

The retriever module imports these at the **top level** (module-level, not lazy). If pytest collects the test file, Python evaluates the retriever's imports, which will fail without mocks:

```python
# From genieai_retriever_arangodb.py — import-time deps:
from arango import ArangoClient                           # needs mock
from arango.database import StandardDatabase              # needs mock
from comps import CustomLogger, EmbedDoc, ...             # already mocked in conftest.py
from comps.cores.proto.genieai_api_protocol import ...    # already mocked in conftest.py
from langchain_arangodb import ArangoVector               # needs mock
from langchain_community.embeddings import HuggingFaceBgeEmbeddings  # needs mock
from langchain_huggingface import HuggingFaceEndpointEmbeddings      # needs mock
from langchain_openai import ChatOpenAI, OpenAIEmbeddings            # needs mock
import openai                                              # needs mock
```

**Must add to `conftest.py` or a test-local setup:**

```python
# Add AFTER existing sys.modules entries in conftest.py:
sys.modules.setdefault("langchain_arangodb", MagicMock())
sys.modules.setdefault("langchain_community", MagicMock())
sys.modules.setdefault("langchain_community.embeddings", MagicMock())
sys.modules.setdefault("langchain_huggingface", MagicMock())
sys.modules.setdefault("langchain_openai", MagicMock())
sys.modules.setdefault("openai", MagicMock())
```

**CRITICAL:** These must be added to the **existing** `conftest.py` sys.modules block (lines 14-26), NOT in the test file. Pytest collects conftest.py before test files, so the mocks must be in place at collection time. Adding them in the test file's module-level code is too late — pytest will have already tried to import the retriever module.

### Retriever Method Architecture

```
GenieaiArangoRetriever
├── __init__(name, description, config)
│   ├── _initialize_client()     # ArangoDB connection — MUST PATCH
│   └── _initialize_llm()        # LLM connection — MUST PATCH (only if SUMMARIZER_ENABLED)
├── check_health() → bool         # db.version() check
├── generate_summarization_prompt(query, text) → str  # Pure string formatting
├── _build_subquery(...) → str    # Pure AQL string builder
├── fetch_neighborhoods(...) → dict  # Graph traversal (sync, uses ThreadPoolExecutor)
└── invoke(input) → list          # Main async entry point (200+ lines)
```

### invoke() Flow (the 200-line method)

Understanding the `invoke()` flow is essential for writing correct tests:

```
1. Parse input (model_dump) → extract query, search params, labels
2. Build AQL filter clause from labels (OR/AND strategy)
3. Validate graph and collection existence (db.has_graph, has_vertex_collection)
4. Check collection count > 0 and >= num_centroids
5. Get embedding dimension from random document
6. Initialize embeddings (OpenAI > TEI > HuggingFace fallback chain)
7. Create ArangoVector instance
8. Compute embedding for query (if not pre-embedded)
9. Execute vector search (similarity_score_threshold / mmr / similarity)
10. Enrich results with file_id metadata (AQL lookup, chunk mode only)
11. Optionally traverse graph neighborhoods (enable_traversal)
12. Optionally summarize results (enable_summarizer)
13. Return search_res list
```

**Key early-return paths in invoke():**
- Empty query → `[]`
- Missing graph → `[]` (logged error)
- Missing collection in graph → `[]` (logged error)
- Empty collection (count=0) → `[]` (logged error)
- Collection < num_centroids → `[]` (logged error)
- Missing embedding field → `[]` (logged error)
- Zero dimension → `[]` (logged error)
- Embedding generation failure → `[]` (logged error)
- ArangoVector init failure → `[]` (logged error)
- Vector search failure → `[]` (logged error)
- Empty search results → `[]` (logged info)

**ALL error paths return `[]`, never raise.** This is a critical behavior to test.

### The `input` Object Shape

`invoke()` accepts `ChatCompletionRequest | RetrievalRequest | RetrievalRequestArangoDB | GenieEmbedDoc`. For tests, use `MagicMock` with `.model_dump()` returning a dict with these keys:

```python
def create_mock_input(query="test query", **overrides):
    """Create a mock input object matching invoke() expectations."""
    mock = MagicMock()
    defaults = {
        "input": query,
        "text": query,
        "embedding": None,
        "graph_name": "GRAPH",
        "search_start": "node",
        "search_mode": "vector",
        "enable_traversal": False,
        "enable_summarizer": False,
        "distance_strategy": "COSINE",
        "use_approx_search": False,
        "num_centroids": 1,
        "traversal_max_depth": 1,
        "traversal_max_returned": 3,
        "traversal_score_threshold": 0.5,
        "traversal_query": None,
        "context": {},
        "filter_strategy": "OR",
        "search_type": "similarity_score_threshold",
        "k": 4,
        "fetch_k": 20,
        "lambda_mult": 0.5,
        "score_threshold": 0.5,
    }
    defaults.update(overrides)
    mock.model_dump.return_value = defaults
    mock.embedding = overrides.get("embedding", None)
    mock.search_type = defaults["search_type"]
    mock.k = defaults["k"]
    mock.fetch_k = defaults["fetch_k"]
    mock.lambda_mult = defaults["lambda_mult"]
    mock.score_threshold = defaults["score_threshold"]
    return mock
```

### Mocking ArangoVector for invoke() Tests

`invoke()` creates `ArangoVector(...)` inline. The test must patch the class to return a mock with async methods:

```python
mock_vector_db = AsyncMock()
mock_vector_db.db = db_mock
mock_vector_db.asimilarity_search_with_relevance_scores = AsyncMock(return_value=[])
mock_vector_db.amax_marginal_relevance_search = AsyncMock(return_value=[])
mock_vector_db.asimilarity_search = AsyncMock(return_value=[])

with patch("genieai_retriever_arangodb.ArangoVector", return_value=mock_vector_db):
    ...
```

**IMPORTANT:** The import in the retriever is `from langchain_arangodb import ArangoVector`. Since `langchain_arangodb` is mocked at sys.modules level, `ArangoVector` from the mock will be a `MagicMock()`. You need to patch the **specific reference** in the retriever module's namespace: `genieai_retriever_arangodb.ArangoVector`.

### Embedding Provider Fallback Chain

`invoke()` selects embeddings provider in this order:
1. `OPENAI_API_KEY` + `OPENAI_EMBED_ENABLED` → `OpenAIEmbeddings`
2. `TEI_EMBEDDING_ENDPOINT` + `HF_TOKEN` → `HuggingFaceEndpointEmbeddings`
3. Default → `HuggingFaceBgeEmbeddings`

Since all langchain modules are mocked, the constructor calls won't fail, but you should be aware of which path tests take based on env vars set by `set_env_vars` autouse fixture.

### Threading in fetch_neighborhoods

`fetch_neighborhoods()` has two code paths:
- `max_workers == 1` (default): Single AQL query with all keys
- `max_workers > 1`: ThreadPoolExecutor, one query per key

The `ARANGO_TRAVERSAL_CONCURRENT_BATCHES` env var (default: 1) controls this. Tests should cover both paths by patching the config import or setting the env var.

**Worker count validation:**
- `> 4` → capped to 4, logs error
- `< 1` → defaulted to 1, logs error
- `== 1` → single-query mode, logs info

### Story 4.1 Review Findings (Deferred — May Need Attention)

From the 4-1 code review:
1. **Missing comps submodule mocks** for `comps.retrievers.src.*` and `comps.rerankings.src.*` — may need to add if retriever microservice imports them. The main retriever module (`genieai_retriever_arangodb.py`) does NOT import from `comps.retrievers`, so this should be fine.
2. **Mock response shapes may need dict-access support** — retriever code uses `r["doc"].page_content` and `r["doc"].id` (attribute access). Current mocks use MagicMock which supports both. Verify this works.

### Files to Create/Modify

| File | Action |
|------|--------|
| `genie-ai-overlay/tests/conftest.py` | MODIFY — add `langchain_*` and `openai` to sys.modules pre-population |
| `genie-ai-overlay/tests/test_retriever.py` | NEW — all retriever tests |

### Files NOT Modified

All existing Python service files in `genie-ai-overlay/retriever/` remain unchanged.

### Project Structure Notes

- Retriever source: `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` (854 lines)
- Retriever config: `genie-ai-overlay/retriever/config.py` (env var definitions)
- Retriever microservice wrapper: `genie-ai-overlay/retriever/genieai_retriever_microservice.py` (not tested here — HTTP wrapper, tested in story 4.6)
- Protocol models: `genie-ai-overlay/core/genieai_api_protocol.py` (Pydantic models)
- Test location: `genie-ai-overlay/tests/test_retriever.py`
- Ruff config: `genie-ai-overlay/pyproject.toml` (target-version py310, line-length 120, quote-style double)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2] — Original story definition and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#OPEA Testing] — pytest patterns, mock strategy, fixture design, test naming conventions
- [Source: _bmad-output/implementation-artifacts/4-1-configure-pytest-and-create-shared-fixtures-for-opea.md] — Previous story: conftest.py design, sys.modules mock strategy, deferred findings
- [Source: genie-ai-overlay/retriever/genieai_retriever_arangodb.py] — Source under test (854 lines)
- [Source: genie-ai-overlay/retriever/config.py] — Env var configuration (ARANGO_TRAVERSAL_*, ARANGO_SEARCH_*, embedding config)
- [Source: genie-ai-overlay/core/genieai_api_protocol.py] — Pydantic request models (RetrievalRequestArangoDB, ChatCompletionRequest)
- [Source: genie-ai-overlay/tests/conftest.py] — Existing shared fixtures (mock_arangodb, mock_comps, mock_vllm, mock_tei)
- [Source: _bmad-output/project-context.md#Python OPEA Services] — PEP 8, ruff, CustomLogger, copyright headers

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Review Findings

- [x] [Review][Patch] AC2: No test combining vector + graph + labels in a single invoke() call — `test_hybrid_search_calls_fetch_neighborhoods` sets `enable_traversal=True` without labels (no `context`), so the combination of vector + graph + label filtering is never tested. Add a test with `enable_traversal=True` + `context={"categoryLabel": "...", "serviceLabels": [...]}` verifying that both fetch_neighborhoods AND label filtering are active. [test_retriever.py:~525]
- [x] [Review][Patch] AC4: No verification of score threshold in generated AQL — `TestFetchNeighborhoods` tests verify that `fetch_neighborhoods` is called but none inspect the AQL for `FILTER score >= threshold`. Add an assertion on the query content passed to `db.aql.execute`. [test_retriever.py:~450-500]
- [x] [Review][Patch] AC5: No verification of k/fetch_k/lambda_mult passed to vector search methods — `test_mmr_search_type_calls_correct_method` and `test_similarity_search_type_calls_correct_method` only verify the correct method is called (`.assert_called_once()`) but not that k, fetch_k, lambda_mult are passed with correct values. Add `call_kwargs.kwargs.get("k") == expected_k` etc. [test_retriever.py:~650-658]
- [x] [Review][Patch] AC8: Weak assertions on label filter — tests only check `"ANY IN" in filter_clause` and `"ALL IN" in filter_clause` without validating the complete AQL filter structure (e.g. `doc.chunk_labels != null`). Strengthen assertions. [test_retriever.py:~531-555]
- [x] [Review][Patch] No test for invalid search_start in invoke() — source code raises HTTPException(400) for invalid `search_start` but no test in TestInvoke covers this path. Add `test_invalid_search_start_raises_400`. [test_retriever.py]
- [x] [Review][Patch] No test for thread exception in fetch_neighborhoods — in threaded mode, if `run_for_single_key` raises, the key is silently skipped. No test simulates this case. Add a test with side_effect on AQL execute mock in threaded mode. [test_retriever.py]
- [x] [Review][Defer] Graph validation unreachable branch — pre-existing in source code, not introduced by this change. [genieai_retriever_arangodb.py:~583-598] — deferred, pre-existing
