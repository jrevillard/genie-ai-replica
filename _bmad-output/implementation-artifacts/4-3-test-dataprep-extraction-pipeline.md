# Story 4.3: Test Dataprep Extraction Pipeline

Status: review

## Story

As a developer,
I want pytest tests for the dataprep extraction and chunking pipeline,
so that document processing logic is validated without real file system or embedding services.

## Acceptance Criteria

1. **AC1: Test file created** — `genie-ai-overlay/tests/test_dataprep.py` is created with ITU copyright header, covering `GenieArangoDataprep` from `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`.

2. **AC2: Multi-format document parsing** — Tests verify `_load_and_chunk()` routes to Docling loader for supported extensions (`.pdf`, `.docx`, `.pptx`, `.xlsx`, `.html`, `.txt`, `.md`) when `CONTENT_EXTRACTION_METHOD=docling`, and to standard loader otherwise. Tests verify HTML files use `HTMLHeaderTextSplitter` while all other formats use `RecursiveCharacterTextSplitter`. Tests verify chunks are filtered through `is_valid_content()`.

3. **AC3: Chunking strategy produces correctly sized chunks** — Tests verify `_load_and_chunk()` respects `chunk_size` and `chunk_overlap` from the `DocPath` parameter. Tests verify long content is split and short content is kept intact. Tests verify empty content returns `[]`.

4. **AC4: Labeling logic assigns correct labels to chunks** — Tests verify all three labeling strategies:
   - `_label_with_llm()` calls OpenAI chat completions with correct system prompt (including `{labels_list}` substitution) and returns `{"text", "labels"}` dicts. Tests verify retry logic (3 attempts) and fallback to file labels on failure. Tests verify synonym matching (plural/singular/case-insensitive).
   - `_label_with_embedding()` computes cosine similarity between chunk and label embeddings, selecting labels above `EMBEDDING_LABEL_THRESHOLD`.
   - `_label_with_bm25()` tokenizes chunks and labels, scores with BM25Okapi, and selects labels above `BM25_LABEL_THRESHOLD`.
   - `_apply_labels()` dispatches to the correct strategy based on `LABELING_STRATEGY` env var. When `all_labels` is empty, falls back to `file_labels`.

5. **AC5: Embedding generation calls TEI with correct payload** — Tests verify `_label_with_embedding()` calls `self.embeddings.embed_documents(all_labels)` and `self.embeddings.embed_query(text)` with correct arguments. Tests verify cosine similarity formula `dot(a, b) / (norm(a) * norm(b))`.

6. **AC6: ArangoDB document insertion with correct graph structure** — Tests verify `ingest_file_with_guardrail()` creates `Document` objects with correct metadata (`file_id`, `file_path`, `chunk_index`, `chunk_labels`), batches documents (BATCH_SIZE=10), and calls `_process_batch()` with correct arguments. Tests verify `ArangoGraph` is initialized with `db=self.db`.

7. **AC7: Error handling for corrupted or unsupported file formats** — Tests verify error handling paths:
   - `_load_and_chunk()` returns `[]` when loaders return empty content
   - `ingest_file_with_guardrail()` raises when no valid content extracted
   - `ingest_file_with_guardrail()` auto-retracts on failure (calls `retract_file`)
   - `ingest_file_with_guardrail()` sets status to "Ingestion Error" on exception
   - `ingest_file_with_guardrail()` handles `CancelledError` (kill switch) with retraction + "Killed" status
   - `_run_guardrail()` returns failure when guardrail blocks content or connection fails
   - `retract_file()` handles `AQLQueryExecuteError` gracefully

8. **AC8: Retraction cascade deletion** — Tests verify `retract_file()` executes the correct 5-step cascade: (1) identify chunks by `file_id`, (2) identify HAS_SOURCE edges, (3) delete chunks, (4) delete edges + file-specific LINKS_TO edges, (5) detect and delete orphan entities + their LINKS_TO edges. Tests verify final status update to "Retracted" and return dict with deletion counts.

9. **AC9: All external services mocked** — aiohttp (Document Repository, Backend, Guardrail), ArangoDB, OpenAI/AsyncOpenAI, LangChain (`langchain_arangodb`, `langchain_core`, `langchain_text_splitters`), Docling utils, Keycloak, TEI/embeddings, `rank_bm25`, and `comps` are fully mocked. No real external connections. All tests pass Ruff linting and formatting.

## Tasks / Subtasks

- [x] Task 1: Add dataprep import-time dependencies to conftest.py (AC: #9)
  - [x] 1.1 Add `sys.modules` entries for: `langchain_core`, `langchain_core.documents`, `langchain_text_splitters`, `rank_bm25`, `arango.exceptions`, `keycloak_service_account` — these are import-time dependencies that must be pre-populated before `genieai_dataprep_arangodb` can be collected by pytest
  - [x] 1.2 Verify existing entries cover: `aiohttp` (standard lib, no mock needed), `numpy` (standard lib), `pydantic` (standard lib), `fastapi` (standard lib)

- [x] Task 2: Create dataprep-specific helpers and mock factories (AC: #9)
  - [x] 2.1 Create `create_dataprep()` helper that patches parent class `__init__` (`OpeaArangoDataprep.__init__`), sets `self.db`, `self.embeddings`, `self.graph`, `self.llm_transformer` to mocks. The dataprep class extends `OpeaArangoDataprep` which has its own `_initialize_client` — patch at the right level.
  - [x] 2.2 Create `create_mock_ingest_input(**overrides)` factory returning a mock `ArangoDBDataprepRequestFromDocRepo` with sensible defaults: `file_id`, `file_path`, `storage_path`, `file_type`, `file_labels`, `chunk_size`, `chunk_overlap`, `graph_name`, `process_table`, `table_strategy`, `allowed_node_types`, `allowed_edge_types`, `node_properties`, `edge_properties`, `include_chunks`, `embed_chunks`, `embed_nodes`, `embed_edges`, `text_capitalization_strategy`
  - [x] 2.3 Create `create_mock_aiohttp_response(status=200, json_data=None)` helper for mocking aioHTTP responses used by `_update_doc_status`, `_write_ingestion_log`, `_fetch_all_labels`, `_run_guardrail`

- [x] Task 3: Test `_load_and_chunk()` — document loading and chunking (AC: #2, #3)
  - [x] 3.1 Test Docling routing: file ending in `.pdf` with `CONTENT_EXTRACTION_METHOD=docling` calls `docling_document_loader`
  - [x] 3.2 Test Docling routing: file ending in `.docx`/`.pptx`/`.xlsx`/`.html`/`.txt`/`.md` with `CONTENT_EXTRACTION_METHOD=docling` calls `docling_document_loader`
  - [x] 3.3 Test standard loader fallback: non-Docling extension or `CONTENT_EXTRACTION_METHOD=opea` calls `document_loader`
  - [x] 3.4 Test HTML splitter: `.html` files use `HTMLHeaderTextSplitter` (not `RecursiveCharacterTextSplitter`)
  - [x] 3.5 Test chunk size: long content is split using `RecursiveCharacterTextSplitter` with correct `chunk_size` and `chunk_overlap`
  - [x] 3.6 Test short content: content shorter than `chunk_size` is kept as single chunk
  - [x] 3.7 Test empty content: loader returns empty → `_load_and_chunk()` returns `[]`
  - [x] 3.8 Test content filtering: only chunks passing `is_valid_content()` are returned
  - [x] 3.9 Test list content: when loader returns a list, each item is individually split or preserved

- [x] Task 4: Test labeling strategies (AC: #4, #5)
  - [x] 4.1 Test `_apply_labels()` dispatches to `_label_with_llm()` by default (`LABELING_STRATEGY=llm`)
  - [x] 4.2 Test `_apply_labels()` dispatches to `_label_with_embedding()` when `LABELING_STRATEGY=embedding`
  - [x] 4.3 Test `_apply_labels()` dispatches to `_label_with_bm25()` when `LABELING_STRATEGY=bm25`
  - [x] 4.4 Test `_apply_labels()` falls back to `file_labels` when `all_labels` is empty
  - [x] 4.5 Test `_label_with_llm()` calls `AsyncOpenAI.chat.completions.create` with correct system prompt and user message
  - [x] 4.6 Test `_label_with_llm()` parses JSON response `{"labels": [...]}` correctly
  - [x] 4.7 Test `_label_with_llm()` retry: 3 failures → falls back to `file_labels`
  - [x] 4.8 Test `_label_with_llm()` synonym matching: plural/singular/case-insensitive mapping
  - [x] 4.9 Test `_label_with_llm()` logs warning for labels not in taxonomy
  - [x] 4.10 Test `_label_with_embedding()` computes cosine similarity and selects labels above threshold
  - [x] 4.11 Test `_label_with_embedding()` initializes embeddings via `_initialize_embeddings()` if not set
  - [x] 4.12 Test `_label_with_bm25()` tokenizes and scores with BM25Okapi, selects above threshold

- [x] Task 5: Test `ingest_file_with_guardrail()` — main ingestion pipeline (AC: #6, #7)
  - [x] 5.1 Test happy path: status transitions "Ingesting" → "Ingested", correct chunk count reported
  - [x] 5.2 Test `_fetch_all_labels()` is called during ingestion
  - [x] 5.3 Test `_initialize_llm()` is called with correct parameters from input
  - [x] 5.4 Test `_load_and_chunk()` is called with correct `DocPath` from input
  - [x] 5.5 Test `_run_guardrail()` is called (when enabled) and blocks ingestion on failure
  - [x] 5.6 Test `_apply_labels()` is called with chunks, labels, and file_labels
  - [x] 5.7 Test `Document` objects created with correct metadata (`file_id`, `file_path`, `chunk_index`, `chunk_labels`)
  - [x] 5.8 Test batching: documents split into batches of 10, `_process_batch()` called for each
  - [x] 5.9 Test no valid content: raises exception, auto-retracts, sets "Ingestion Error" status
  - [x] 5.10 Test guardrail violation: raises "Guardrail Violation", auto-retracts
  - [x] 5.11 Test `CancelledError` (kill switch): retracts file, sets "Killed" status, re-raises
  - [x] 5.12 Test generic exception: auto-retracts, sets "Ingestion Error", raises `HTTPException(500)`
  - [x] 5.13 Test lock release in `finally` block: `fcntl.flock(LOCK_UN)` and `lock_file.close()` called

- [x] Task 6: Test `retract_file()` — cascade deletion (AC: #8)
  - [x] 6.1 Test step 1: AQL query finds chunks by `file_id` in SOURCE collection
  - [x] 6.2 Test step 2: AQL query finds HAS_SOURCE edges linked to chunk IDs
  - [x] 6.3 Test step 3: DELETE chunks by key from SOURCE collection
  - [x] 6.4 Test step 4: DELETE HAS_SOURCE edges by key
  - [x] 6.5 Test step 4.5: DELETE file-specific LINKS_TO edges
  - [x] 6.6 Test step 5: detect orphan entities (no incoming edges), delete their LINKS_TO edges, delete entities
  - [x] 6.7 Test no chunks found: returns early with `"No chunks found."` and status "Retracted"
  - [x] 6.8 Test `AQLQueryExecuteError`: error is logged, status set to "Retraction Error"
  - [x] 6.9 Test final return dict contains correct `deleted_chunks`, `deleted_edges`, `deleted_entities` counts

- [x] Task 7: Test utility methods (AC: #1, #7)
  - [x] 7.1 Test `_service_headers()` returns auth headers with Bearer token from Keycloak
  - [x] 7.2 Test `_service_headers()` returns `None` when Keycloak fails
  - [x] 7.3 Test `_update_doc_status()` sends PATCH to Document Repository with correct payload
  - [x] 7.4 Test `_update_doc_status()` skips when headers unavailable
  - [x] 7.5 Test `_write_ingestion_log()` sends POST to Document Repository with correct payload
  - [x] 7.6 Test `_write_ingestion_log()` handles 429 rate limiting gracefully
  - [x] 7.7 Test `_fetch_all_labels()` parses backend taxonomy response (categories + children)
  - [x] 7.8 Test `_fetch_all_labels()` returns `[]` on error or missing auth
  - [x] 7.9 Test `_run_guardrail()` returns `{"success": True}` when `GUARDRAIL_ENABLED=false`
  - [x] 7.10 Test `_run_guardrail()` returns failure when guardrail blocks content

- [x] Task 8: Verify all tests pass and code is clean (AC: #9)
  - [x] 8.1 Run `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_dataprep.py -v` — all tests pass
  - [x] 8.2 Run existing conftest fixture tests still pass: `python -m pytest tests/test_conftest_fixtures.py -v`
  - [x] 8.3 Run existing retriever tests still pass: `python -m pytest tests/test_retriever.py -v`
  - [x] 8.4 Run `ruff check tests/test_dataprep.py` — zero lint errors
  - [x] 8.5 Run `ruff format --check tests/test_dataprep.py` — formatting passes

## Dev Notes

### Critical: Import-Time Dependencies Must Be Pre-Populated

The dataprep module imports these at the **top level** (module-level, not lazy). If pytest collects the test file, Python evaluates the dataprep's imports, which will fail without mocks:

```python
# From genieai_dataprep_arangodb.py — import-time deps:
from arango.exceptions import AQLQueryExecuteError              # NEW — needs mock
from comps import CustomLogger, DocPath, OpeaComponentRegistry  # already mocked in conftest.py
from comps.cores.proto.genieai_api_protocol import ...          # already mocked in conftest.py
from comps.dataprep.src.genieai_dataprep_utils import ...       # already mocked in conftest.py
from comps.dataprep.src.integrations.arangodb import ...        # already mocked in conftest.py
from comps.dataprep.src.utils import get_separators             # already mocked in conftest.py
from langchain_arangodb import ArangoGraph                      # already mocked in conftest.py
from langchain_core.documents import Document                   # NEW — needs mock
from langchain_text_splitters import HTMLHeaderTextSplitter, RecursiveCharacterTextSplitter  # NEW — needs mock
from numpy import dot                                           # standard lib — no mock needed
from numpy.linalg import norm                                   # standard lib — no mock needed
from openai import AsyncOpenAI                                  # already mocked in conftest.py
from pydantic import ValidationError                            # standard lib — no mock needed
from rank_bm25 import BM25Okapi                                 # NEW — needs mock
from keycloak_service_account import get_service_account_token  # NEW — needs mock
```

**Must add to `conftest.py` sys.modules block:**

```python
# Dataprep import-time dependencies
sys.modules.setdefault("arango.exceptions", MagicMock())
sys.modules.setdefault("langchain_core", MagicMock())
sys.modules.setdefault("langchain_core.documents", MagicMock())
sys.modules.setdefault("langchain_text_splitters", MagicMock())
sys.modules.setdefault("rank_bm25", MagicMock())
sys.modules.setdefault("keycloak_service_account", MagicMock())
```

**CRITICAL:** Add these to the **existing** `conftest.py` sys.modules block, NOT in the test file. Pytest collects conftest.py before test files, so the mocks must be in place at collection time.

### Critical: Cannot Instantiate Dataprep Normally

`GenieArangoDataprep.__init__` calls `super().__init__()` which chains to `OpeaArangoDataprep.__init__()` → `OpeaComponentBase.__init__()`. The parent init likely tries to connect to ArangoDB. These MUST be bypassed for testing.

**Approach:** Patch the parent class `__init__` as a no-op, then manually set required attributes:

```python
def create_dataprep(db_mock=None, embeddings_mock=None, graph_mock=None):
    """Create a GenieArangoDataprep with mocked dependencies."""
    with patch.object(GenieArangoDataprep, "__init__", lambda self, *a, **kw: None):
        dataprep = GenieArangoDataprep(name="test-dataprep", description="Test")
    dataprep.db = db_mock or MagicMock()
    dataprep.embeddings = embeddings_mock or MagicMock()
    dataprep.graph = graph_mock or MagicMock()
    dataprep.llm_transformer = MagicMock()
    dataprep._log_semaphore = asyncio.Semaphore(100)
    return dataprep
```

### Dataprep Method Architecture

```
GenieArangoDataprep (extends OpeaArangoDataprep)
├── __init__(name, description, config)
│   └── super().__init__() → OpeaArangoDataprep.__init__() — MUST PATCH
├── _log_environment_variables()            # Pure logging
├── _service_headers() → dict|None          # Keycloak token
├── _update_doc_status(file_id, status)     # aiohttp PATCH to Doc Repo
├── _write_ingestion_log(file_id, ...)      # aiohttp POST to Doc Repo
├── _fetch_all_labels() → list[str]         # aiohttp GET to Backend
├── _load_and_chunk(doc_path) → list[str]   # Docling/Standard + split + filter
├── _run_guardrail(chunks) → dict           # aiohttp POST to Guardrail
├── _label_with_llm(chunks, labels, ...)    # AsyncOpenAI chat completions
├── _label_with_embedding(chunks, labels)   # Cosine similarity via self.embeddings
├── _label_with_bm25(chunks, labels)        # BM25Okapi keyword matching
├── _apply_labels(chunks, labels, ...)      # Strategy dispatcher
├── _process_batch(docs, ...)               # Graph extraction + ArangoDB insert
├── ingest_file_with_guardrail(input, lock) # Main pipeline (140+ lines)
└── retract_file(file_id, graph_name)       # Cascade deletion (200+ lines)
```

### ingest_file_with_guardrail() Flow

```
1. Update status → "Ingesting"
2. Write log → "Ingestion task started."
3. Fetch taxonomy labels (Backend Service)
4. Initialize LLM transformer (node/edge types from input)
5. Create DocPath from input parameters
6. Load and chunk document → chunks[]
7. If no chunks → raise "No valid content" (triggers error path)
8. Run guardrail check (if GUARDRAIL_ENABLED)
9. Apply labels to chunks
10. Create Document objects with metadata
11. Batch documents (BATCH_SIZE=10)
12. Process batches concurrently (Semaphore for concurrency)
13. Update status → "Ingested" + chunk_count
14. Return success dict

Error paths:
- CancelledError → retract + "Killed" status + re-raise
- Exception → retract + "Ingestion Error" + HTTPException(500)
- Finally → release lock file
```

**ALL error paths trigger auto-retraction via `retract_file()`.** This is critical behavior to test.

### retract_file() Cascade Deletion Flow

```
1. Compute collection names from graph_name: {graph}_SOURCE, {graph}_ENTITY, {graph}_HAS_SOURCE, {graph}_LINKS_TO
2. AQL: Find chunks by file_id → chunk_objects (key + id)
3. If no chunks → early return "No chunks found." + "Retracted" status
4. AQL: Find HAS_SOURCE edges linking to chunk IDs → edge_objects (key, id, from)
5. AQL: DELETE chunks by key from SOURCE collection
6. AQL: DELETE HAS_SOURCE edges by key
7. AQL: DELETE file-specific LINKS_TO edges (filter by file_id)
8. AQL: Find orphan entities (no incoming HAS_SOURCE edges)
9. AQL: DELETE LINKS_TO edges connected to orphans
10. AQL: DELETE orphan entities from ENTITY collection
11. Update status → "Retracted"
12. Return dict with deleted_chunks, deleted_edges, deleted_entities counts

Error: AQLQueryExecuteError → log error, status "Retraction Error"
```

### The `input` Object Shape

`ingest_file_with_guardrail()` accepts `ArangoDBDataprepRequestFromDocRepo`. For tests, use `MagicMock` with appropriate attributes:

```python
def create_mock_ingest_input(file_id="test-file-123", **overrides):
    """Create a mock input matching ingest_file_with_guardrail() expectations."""
    mock = MagicMock()
    defaults = {
        "file_id": file_id,
        "file_path": "/tmp/test_document.pdf",
        "storage_path": "/uploads/test_document.pdf",
        "file_type": "pdf",
        "file_labels": ["Healthcare", "Public Services"],
        "chunk_size": 1500,
        "chunk_overlap": 150,
        "graph_name": "GRAPH",
        "process_table": True,
        "table_strategy": "fast",
        "allowed_node_types": [],
        "allowed_edge_types": [],
        "node_properties": ["description"],
        "edge_properties": ["description"],
        "include_chunks": True,
        "embed_chunks": True,
        "embed_nodes": True,
        "embed_edges": True,
        "text_capitalization_strategy": "upper",
    }
    defaults.update(overrides)
    for k, v in defaults.items():
        setattr(mock, k, v)
    return mock
```

### Labeling Strategy Details

**LLM Labeling (`_label_with_llm`):**
- Creates `AsyncOpenAI` client pointing to VLLM endpoint
- Replaces `{labels_list}` placeholder in `LABEL_SELECTOR_SYSTEM_PROMPT`
- Parses JSON response: `{"labels": ["Label1", "Label2"]}`
- Retry logic: 3 attempts, fallback to `file_labels` on all failures
- Synonym matching: exact → case-insensitive → plural/singular
- Logs warnings for labels not in taxonomy

**Embedding Labeling (`_label_with_embedding`):**
- Initializes embeddings if not set (`self._initialize_embeddings()`)
- Computes `dot(a, b) / (norm(a) * norm(b))` for each chunk-label pair
- Selects labels above `EMBEDDING_LABEL_THRESHOLD` (default: 0.75)

**BM25 Labeling (`_label_with_bm25`):**
- Tokenizes labels and chunks with `re.findall(r"\b\w+\b", text.lower())`
- Creates `BM25Okapi` index from tokenized labels
- Scores each chunk, selects labels above `BM25_LABEL_THRESHOLD` (default: 2.0)

### Mocking aiohttp for External Service Calls

The dataprep uses `aiohttp.ClientSession` extensively for HTTP calls to Document Repository, Backend, and Guardrail. Mock the session at the method level:

```python
@pytest.fixture
def mock_aiohttp_session():
    """Create a mock aiohttp.ClientSession for testing HTTP calls."""
    session = AsyncMock()
    response = AsyncMock()
    response.status = 200
    response.json = AsyncMock(return_value={})
    response.text = AsyncMock(return_value="")

    # Context manager support
    session.get = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=response), __aexit__=AsyncMock()))
    session.post = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=response), __aexit__=AsyncMock()))
    session.patch = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=response), __aexit__=AsyncMock()))
    return session
```

For `aiohttp.ClientSession` constructor mocking:
```python
with patch("genieai_dataprep_arangodb.aiohttp.ClientSession", return_value=mock_session):
    ...
```

### Concurrency Model

`ingest_file_with_guardrail()` creates concurrent batch tasks:
```python
semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)  # default: 5
tasks = [asyncio.create_task(self._process_batch(...)) for batch in batches]
await asyncio.gather(*tasks)
```

Tests for `_process_batch()` should verify:
- Semaphore limits concurrency
- Graph extraction calls (`llm_transformer.convert_to_graph_documents`)
- Graph insertion calls (`graph.add_graph_documents`)
- Retry logic for individual docs on batch failure

### File Locking

`ingest_file_with_guardrail()` receives a `lock_file` parameter (already locked by the microservice). The `finally` block releases it:

```python
finally:
    if lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_UN)
        lock_file.close()
```

For testing, create a mock file object:
```python
mock_lock = MagicMock()
mock_lock.fileno.return_value = 0
```

### Label Taxonomy Response Shape

`_fetch_all_labels()` expects the Backend to return a list of categories with nested children:

```python
[
    {"name": "Healthcare", "children": [{"name": "Hospitals"}, {"name": "Clinics"}]},
    {"name": "Education", "children": ["Schools", "Universities"]},  # Children can be strings
]
```

The method handles both dict and string children, flattens the hierarchy, and deduplicates with `list(set(...))`.

### Story 4.1 Review Findings (Potential Impact)

From the 4-1 code review (deferred items):
1. **Mock response shapes may need dict-access support** — dataprep code uses `response.status`, `await response.json()`, `await response.text()`. Ensure aiohttp mocks support these patterns.
2. **`comps.dataprep.src.genieai_dataprep_utils`** is already mocked in conftest.py — verify `docling_document_loader`, `document_loader`, `is_valid_content` are accessible through the mock.

### Files to Create/Modify

| File | Action |
|------|--------|
| `genie-ai-overlay/tests/conftest.py` | MODIFY — add `langchain_core`, `langchain_core.documents`, `langchain_text_splitters`, `rank_bm25`, `arango.exceptions`, `keycloak_service_account` to sys.modules pre-population |
| `genie-ai-overlay/tests/test_dataprep.py` | NEW — all dataprep tests |

### Files NOT Modified

All existing Python service files in `genie-ai-overlay/dataprep/` remain unchanged.

### Project Structure Notes

- Dataprep source: `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` (878 lines)
- Dataprep microservice: `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py` (280 lines, NOT tested here — HTTP wrapper)
- Dataprep utils: `genie-ai-overlay/dataprep/genieai_dataprep_utils.py` (181 lines, mocked)
- Keycloak module: `genie-ai-overlay/dataprep/keycloak_service_account.py` (76 lines, mocked)
- Protocol models: `genie-ai-overlay/core/genieai_api_protocol.py` (241 lines)
- Test location: `genie-ai-overlay/tests/test_dataprep.py`
- Ruff config: `genie-ai-overlay/pyproject.toml` (target-version py310, line-length 120, quote-style double)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — Original story definition and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#OPEA Testing] — pytest patterns, mock strategy, fixture design, test naming conventions
- [Source: _bmad-output/implementation-artifacts/4-1-configure-pytest-and-create-shared-fixtures-for-opea.md] — Previous story: conftest.py design, sys.modules mock strategy
- [Source: _bmad-output/implementation-artifacts/4-2-test-retriever-hybrid-search-logic.md] — Previous story: mock patterns, helper factories, review findings
- [Source: genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py] — Source under test (878 lines)
- [Source: genie-ai-overlay/dataprep/genieai_dataprep_microservice.py] — Microservice wrapper (not tested)
- [Source: genie-ai-overlay/dataprep/genieai_dataprep_utils.py] — Document loading utilities (mocked)
- [Source: genie-ai-overlay/dataprep/keycloak_service_account.py] — Keycloak token management (mocked)
- [Source: genie-ai-overlay/core/genieai_api_protocol.py] — Pydantic request models
- [Source: genie-ai-overlay/tests/conftest.py] — Existing shared fixtures
- [Source: _bmad-output/project-context.md#Python OPEA Services] — PEP 8, ruff, CustomLogger, copyright headers

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

- aiohttp/numpy not mocked (standard lib, but aiohttp needs AsyncMock, not MagicMock)
- OpeaArangoDataprep not a real class — it's a factory-created mixin, must patch `__init__` on the actual GenieArangoDataprep class
- Module-level constants (e.g., `EMBEDDING_LABEL_THRESHOLD`) cannot be changed via `monkeypatch.setenv` — must use `monkeypatch.setattr` on the actual module attribute
- AsyncMock vs MagicMock for aiohttp sessions — AsyncMock required for async context managers (`__aenter__`/`__aexit__`)
- fcntl needs patching for `fcntl.flock()` calls in lock release logic
- Document mock needs real class instance for metadata attribute access, not MagicMock

### Completion Notes List

- 36 tests passing covering:
  - Document loading and chunking (Docling vs standard loader, HTML vs text splitter, chunk sizing, empty content handling)
  - Labeling strategies (LLM with retry/fallback/synonym matching, embedding cosine similarity, BM25 keyword scoring, strategy dispatcher)
  - Ingestion pipeline (status transitions, guardrail integration, batching, error handling with auto-retraction, lock release)
  - Retraction cascade (5-step deletion: chunks → edges → file-specific links → orphan detection → cleanup)
  - Utility methods (service headers, doc status updates, ingestion logging, label fetching, guardrail checks)
- All 112 tests in suite pass (36 dataprep + 76 retriever)
- Ruff lint and format clean
- No regressions in existing test fixtures or retriever tests

### File List

- NEW: genie-ai-overlay/tests/test_dataprep.py
- MODIFIED: genie-ai-overlay/tests/conftest.py

## Change Log

- Story 4.3 complete: 36 pytest tests for dataprep extraction pipeline
