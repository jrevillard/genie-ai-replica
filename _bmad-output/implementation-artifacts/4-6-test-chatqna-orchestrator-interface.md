# Story 4.6: Test ChatQnA Orchestrator Interface

Status: review

## Story

As a developer,
I want pytest tests for the ChatQnA orchestrator interface,
so that the custom OPEA overlay orchestrator is validated without real services.

## Acceptance Criteria

1. **Given** `genieai_chatqna.py` implements a custom MegaService orchestrator (1,774 lines), **when** I create `tests/test_chatqna.py`, **then** tests verify the orchestrator accepts valid chat requests and returns responses
2. **Given** `UserContextBuilder` sanitizes and enriches user profile data, **when** I run tests, **then** tests verify user profile enrichment logic with mocked user data (sanitization, DoB→age conversion, primitive field extraction)
3. **Given** the orchestrator integrates multilingual translation, **when** I run tests, **then** tests verify multilingual translation integration with mocked translation service
4. **Given** the orchestrator produces citation-formatted responses, **when** I run tests, **then** tests verify citation formatting in response output (source_documents, confidence_score, file_id_pairs)
5. **Given** downstream services (retriever, reranker, vLLM, translation) can fail, **when** I run tests, **then** tests verify error handling when downstream services fail (profile fetch failure, translation timeout, metadata fetch failure)
6. **Given** the orchestrator handles streaming responses (SSE), **when** I run tests, **then** tests verify `align_generator()` parses SSE chunks correctly
7. **Given** all downstream services are mocked via conftest fixtures, **when** I run tests, **then** no real network calls occur and all external dependencies are mocked

## Tasks / Subtasks

- [x] Task 1: Update conftest.py with ChatQnA-specific mocks (AC: #7)
  - [x] 1.1 Add `sys.modules.setdefault("transformers", MagicMock())` and mock `AutoTokenizer` for the `from transformers import AutoTokenizer` import
  - [x] 1.2 Add `sys.modules.setdefault("langdetect", MagicMock())` for the `from langdetect import detect` import
  - [x] 1.3 Add `sys.modules.setdefault("keycloak_token_validator", MagicMock())` for the `from keycloak_token_validator import validate_token` import in `handle_request()`
  - [x] 1.4 Verify `httpx` is importable (it is a real pip dependency, not vendored) — no mock needed
  - [x] 1.5 Verify `aiohttp` is already mocked in conftest (it is) — add `aiohttp.ClientTimeout = MagicMock(return_value=MagicMock())` alongside the existing `sys.modules.setdefault("aiohttp", ...)` so that `aiohttp.ClientTimeout(total=30)` in `GenieUserProfileClient` and `fetch_file_metadata` doesn't fail
  - [x] 1.6 Verify all existing tests still pass after conftest changes
- [x] Task 2: Create helper functions for test setup (AC: #1–7)
  - [x] 2.1 Create `create_chatqna_service()` helper that instantiates `ChatQnAService.__new__()` bypassing `__init__` (which calls OPEA ServiceOrchestrator), then manually sets required attributes
  - [x] 2.2 Create `create_mock_request()` helper returning a mock FastAPI `Request` with configurable JSON body and headers
  - [x] 2.3 Create `create_mock_chat_request_data()` helper returning a dict matching `ChatCompletionRequest` schema (messages, max_tokens, temperature, stream, etc.)
  - [x] 2.4 Create `create_mock_user_profile()` helper returning a realistic user profile dict with fields the `UserContextBuilder` expects
  - [x] 2.5 Create `create_mock_aiohttp_response()` helper for mocking aiohttp responses in `GenieUserProfileClient` and `fetch_file_metadata`
  - [x] 2.6 Create `create_mock_runtime_graph()` helper with `.downstream()` and `.add_edge()` / `.delete_node_if_exists()` methods
- [x] Task 3: Test `ChatTemplate.generate_rag_prompt()` (AC: #1)
  - [x] 3.1 Test with English documents — returns English template with context and question
  - [x] 3.2 Test with Chinese documents (>30% CJK characters) — returns Chinese template
  - [x] 3.3 Test with mixed documents — behavior depends on CJK ratio threshold (0.3)
  - [x] 3.4 Test with empty documents list — template renders with empty context
- [x] Task 4: Test `UserContextBuilder` — sanitization and enrichment (AC: #2)
  - [x] 4.1 Test `_sanitize_data()` removes keys in `SENSITIVE_KEYS` set (email, phoneNumber, ssn, etc.)
  - [x] 4.2 Test `_sanitize_data()` recurses into nested dicts and lists
  - [x] 4.2b Test `_sanitize_data()` fallback when `SENSITIVE_KEYS` is empty or causes exception — verify hardcoded fallback list is used (lines 213-237)
  - [x] 4.3 Test `_parse_dob()` with `YYYY-MM-DD` format
  - [x] 4.4 Test `_parse_dob()` with `YYYY.MM.DD` format
  - [x] 4.5 Test `_parse_dob()` with invalid string returns None
  - [x] 4.6 Test `_calculate_age()` with known birth date
  - [x] 4.7 Test `_calculate_age()` with None returns "N/A"
  - [x] 4.8 Test `_extract_primitive_fields()` with nested dict/list structure
  - [x] 4.9 Test `build_user_context_string()` full pipeline: sanitize → extract → convert DoB → format string
  - [x] 4.10 Test `build_user_context_string()` with empty input returns empty string
  - [x] 4.11 Test that original input is not mutated (deepcopy behavior)
- [x] Task 5: Test `GenieUserProfileClient` (AC: #2, #5)
  - [x] 5.1 Test `set_token()` stores the token
  - [x] 5.2 Test `get_user_profile()` with valid token returns profile data on 200 response
  - [x] 5.3 Test `get_user_profile()` with no token returns None (logs warning)
  - [x] 5.4 Test `get_user_profile()` handles 401 response (logs error, returns None)
  - [x] 5.5 Test `get_user_profile()` handles 404 response (logs warning, returns None)
  - [x] 5.6 Test `get_user_profile()` handles connection exception (logs error, returns None)
- [x] Task 6: Test `align_inputs()` for each service type (AC: #1, #3)
  - [x] 6.1 Test TRANSLATOR branch: constructs translation prompt messages with correct target language
  - [x] 6.2 Test TRANSLATOR branch with `original_language="EN"` sets target to "English"
  - [x] 6.3 Test EMBEDDING branch: renames `text` to `input`
  - [x] 6.4 Test RETRIEVER branch: merges retriever_parameters and retrieval_context into inputs
  - [x] 6.5 Test RERANK branch: merges reranker_parameters into inputs
  - [x] 6.6 Test LLM branch: constructs system+user messages, applies user context, handles token limit truncation. **CRITICAL**: Patch `ServiceType` with a real enum via `with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):` — without this, `self.services[cur_node].service_type == ServiceType.LLM` always returns False because `ServiceType` is a MagicMock from conftest. See dev notes "Critical: `align_inputs()` / `align_outputs()`" section for `FakeServiceType` definition.
- [x] Task 7: Test `align_outputs()` for each service type (AC: #1, #4)
  - [x] 7.1 Test TRANSLATOR output: extracts translated text from choices[0].message.content
  - [x] 7.2 Test EMBEDDING output: transforms response to {text, embedding} format
  - [x] 7.3 Test RETRIEVER output with rerank downstream: passes docs to rerank with file_id_pairs
  - [x] 7.4 Test RETRIEVER output without rerank: builds prompt with abstention when no docs
  - [x] 7.5 Test RETRIEVER output file_id pairing for "chunk" search_start mode
  - [x] 7.6 Test RETRIEVER output file_id pairing for "node"/"edge" search_start mode with related info
  - [x] 7.6b Test RETRIEVER output with invalid `RETRIEVER_SEARCH_START` value (not "node", "edge", or "chunk") — verify error is logged and no file_id_pairs are created
  - [x] 7.6c Test RETRIEVER output with empty `retrieved_docs` AND rerank downstream enabled — verify the rerank node is deleted from the runtime graph and edges are rewired (retriever → llm). **CRITICAL**: Patch `RETRIEVER_SEARCH_START` to "chunk" and provide a mock `runtime_graph` with `.downstream()`, `.add_edge()`, `.delete_node_if_exists()` methods.
  - [x] 7.7 Test RERANK output: builds reranked docs list with scores, constructs RAG prompt
  - [x] 7.8 Test RERANK output with empty docs enforces abstention
  - [x] 7.9 Test LLM output (non-streaming): extracts text from choices[0].message.content
  - [x] 7.10 Test LLM output (streaming): passes data through unchanged
- [x] Task 8: Test `align_generator()` — SSE streaming (AC: #6)
  - [x] 8.1 Test with standard SSE chunks: yields `data: repr(content)` lines
  - [x] 8.2 Test with "ops" format chunks: yields value from ops[0].value
  - [x] 8.3 Test that generator yields `[DONE]` as final chunk
  - [x] 8.4 Test with malformed JSON: falls back to yielding raw string
  - [x] 8.5 Test with empty bytes chunks (`b''`) — verify generator handles without error and still yields `[DONE]`
- [x] Task 9: Test `ChatQnAService` initialization and service graph (AC: #1)
  - [x] 9.1 Test `__init__` monkey-patches align_inputs/align_outputs/align_generator onto ServiceOrchestrator
  - [x] 9.2 Test `add_remote_service()` creates correct service graph: embedding → retriever → rerank → llm
  - [x] 9.3 Test `add_remote_service_without_rerank()` creates graph: embedding → retriever → llm
  - [x] 9.4 Test `_find_node_key()` finds correct key prefix in result dict
  - [x] 9.5 Test `_find_node_key()` returns None when no match
- [x] Task 10: Test translation helpers (AC: #3)
  - [x] 10.1 Test `_build_translategemma_prompt()` produces correct prompt format with BOS/EOS tokens
  - [x] 10.2 Test `load_language_codes()` loads JSON file correctly
  - [x] 10.3 Test `load_language_codes()` returns empty dict on file error
  - [x] 10.4 Test `_split_text_into_chunks()` with short text returns single chunk
  - [x] 10.5 Test `_split_text_into_chunks()` splits at sentence boundaries
  - [x] 10.6 Test `_get_translated_history_string()` with string history delegates to `_translate_text_chunk`
  - [x] 10.7 Test `_get_translated_history_string()` with list history flattens and translates
  - [x] 10.8 Test `_translate_text_chunk()` uses TranslateGemma format when IS_TRANSLATEGEMMA is true. **CRITICAL**: Patch the module-level constant via `with patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", True):` — this is evaluated once at import, not per-call
  - [x] 10.9 Test `_translate_text_chunk()` uses generic chat format when IS_TRANSLATEGEMMA is false. **CRITICAL**: Patch via `with patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", False):`
  - [x] 10.10 Test `_translate_text_chunk()` returns original text on error (graceful fallback)
  - [x] 10.11 Test `_translate_with_chunking()` splits and reassembles chunks
- [x] Task 11: Test `fetch_file_metadata()` (AC: #4, #5)
  - [x] 11.1 Test with valid file_id and token returns metadata
  - [x] 11.2 Test with empty file_id returns default structure
  - [x] 11.3 Test with no token returns None (logs error)
  - [x] 11.4 Test with HTTP error returns None (logs error)
  - [x] 11.5 Test with connection exception returns None (logs error)
- [x] Task 12: Run full test suite and validate (AC: #1–7)
  - [x] 12.1 Run `python -m pytest tests/ -v` — all tests pass (new + existing)
  - [x] 12.2 Run `ruff check tests/test_chatqna.py` — clean
  - [x] 12.3 Run `ruff format --check tests/test_chatqna.py` — clean

## Dev Notes

### Critical: ChatQnA Import Chain — Module-Level Side Effects

`genieai_chatqna.py` has heavy module-level side effects:

```python
# Module-level constants evaluated at import time:
MEGA_SERVICE_PORT = int(os.getenv("MEGA_SERVICE_PORT", 8888))
CHATQNA_SYSTEM_PROMPT = os.getenv("CHATQNA_SYSTEM_PROMPT", "").strip() or _CHATQNA_SYSTEM_DEFAULT
IS_TRANSLATEGEMMA = "translategemma" in TRANSLATION_MODEL_ID.lower()
_VLLM_TRANSLATION_ENDPOINT = os.getenv("VLLM_TRANSLATION_ENDPOINT", "")
# ... and 30+ more env-var-based constants
```

The autouse `set_env_vars` fixture in conftest.py sets base env vars (ARANGO_URL, etc.) but does NOT set ChatQnA-specific ones. Some constants like `CHATQNA_SYSTEM_PROMPT` are already resolved by the time the test runs because the module is imported after conftest sets env vars.

**For `IS_TRANSLATEGEMMA`**: This is evaluated once at import. To test both branches (TranslateGemma vs generic), you must patch the module-level constant: `patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", True/False)`.

**For `TRANSLATION_LLM_URL` / `TRANSLATION_COMPLETIONS_URL`**: These are resolved at import time based on `_VLLM_TRANSLATION_ENDPOINT`. Patch the module-level constant, not the env var.

**For `TOKENIZER` / `get_tokenizer()`**: This calls `AutoTokenizer.from_pretrained(LLM_MODEL)` which requires the `transformers` library. Since `transformers` is mocked in conftest, `get_tokenizer()` will return a MagicMock. The LLM branch of `align_inputs()` calls `tokenizer.encode()` — this will return a MagicMock, and `len(MagicMock)` returns 0. For token limit tests, mock `get_tokenizer()` to return an object with a real `.encode()` method.

### Critical: Bypassing `ChatQnAService.__init__` for Unit Testing

`ChatQnAService.__init__()` calls `ServiceOrchestrator()` (mocked) and sets up monkey-patches. For unit testing individual methods:

```python
def create_chatqna_service():
    """Create a ChatQnAService without calling __init__."""
    svc = ChatQnAService.__new__(ChatQnAService)
    svc.host = "0.0.0.0"
    svc.port = 8888
    svc.megaservice = MagicMock()
    svc.endpoint = "/v1/chatqna"
    svc.user_profile_client = GenieUserProfileClient()
    return svc
```

For testing `__init__` itself, you can call it normally since ServiceOrchestrator is mocked.

### Critical: `align_inputs()` / `align_outputs()` — Standalone Functions Patched at Init

These are standalone functions (not methods) that get monkey-patched onto `ServiceOrchestrator`:

```python
# In __init__:
ServiceOrchestrator.align_inputs = align_inputs
ServiceOrchestrator.align_outputs = align_outputs
ServiceOrchestrator.align_generator = align_generator
```

They receive `self` as first argument (the ServiceOrchestrator instance). For testing, call them directly:

```python
from chatqna.genieai_chatqna import align_inputs, align_outputs, align_generator
```

`align_inputs` expects `self.services[cur_node].service_type` — the mock `self` must have a `.services` dict where each key maps to an object with a `.service_type` attribute matching `ServiceType` enum values.

```python
def create_mock_service_node(service_type_value):
    node = MagicMock()
    node.service_type = service_type_value
    return node

# ServiceType is mocked in conftest — create real enum-like values
# The code compares with ServiceType.TRANSLATOR, ServiceType.EMBEDDING, etc.
# Since ServiceType is a MagicMock, these comparisons will always be False
# SOLUTION: Use the actual string/int values that the comparisons expect
```

**CRITICAL**: `ServiceType` is a MagicMock from conftest. `self.services[cur_node].service_type == ServiceType.TRANSLATOR` will never match because both sides are different MagicMock instances.

**Solution**: Patch the module-level `ServiceType` import with a real enum or namespace:

```python
from unittest.mock import patch, MagicMock
from enum import Enum

class FakeServiceType(Enum):
    TRANSLATOR = "translator"
    EMBEDDING = "embedding"
    RETRIEVER = "retriever"
    RERANK = "rerank"
    LLM = "llm"
```

Then in each test: `with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):`

### Critical: `handle_request()` Integration Testing

`handle_request()` is a 250-line async method that orchestrates the entire chat flow. It:

1. Parses the FastAPI `Request` (JSON body + headers)
2. Validates the Bearer token via `keycloak_token_validator.validate_token`
3. Fetches user profile via `GenieUserProfileClient`
4. Parses `ChatCompletionRequest` from the data
5. Detects language (langdetect) and translates chat history
6. Builds LLM/retriever/reranker parameters
7. Calls `self.megaservice.schedule()` (the core pipeline)
8. Processes results: extracts LLM response, formats citations, fetches file metadata
9. Optionally translates the response back to the original language
10. Returns final payload with `{response, metadata: {source_documents, confidence_score}}`

For unit testing `handle_request`, mock everything:

```python
async def test_handle_request_basic():
    svc = create_chatqna_service()
    mock_req = create_mock_request(data=..., headers={"Authorization": "Bearer test-token"})

    with patch("chatqna.genieai_chatqna.validate_token", AsyncMock(return_value={"sub": "user1"})), \
         patch.object(svc.user_profile_client, "get_user_profile", AsyncMock(return_value=None)), \
         patch.object(svc, "load_language_codes", return_value={}):
        result = await svc.handle_request(mock_req)
```

### Critical: `align_inputs()` LLM Branch — Token Limit Truncation

The LLM branch of `align_inputs()` (lines 415–528) has token limit logic:

```python
tokenizer = get_tokenizer()
full_prompt_tokens = len(tokenizer.encode(system_instructions + user_content))
if full_prompt_tokens + max_answer_tokens > max_model_tokens - 200:
    # Truncation logic...
```

Since `get_tokenizer()` returns a MagicMock, `tokenizer.encode()` returns a MagicMock, and `len(MagicMock)` returns 0. This means the truncation branch will NEVER be hit unless you mock `get_tokenizer()` properly.

**For testing token limit truncation**: mock `get_tokenizer()` to return an object with a real `.encode()` method:

```python
def create_mock_tokenizer(token_counts):
    """token_counts is a dict mapping string -> int for encode() calls."""
    tokenizer = MagicMock()
    def mock_encode(text):
        return [0] * token_counts.get(text, 0)
    tokenizer.encode = mock_encode
    return tokenizer
```

### Critical: `align_outputs()` RETRIEVER Branch — File ID Pairing Logic

The retriever branch has two modes based on `RETRIEVER_SEARCH_START`:

| Mode | Condition | File ID Mapping |
|------|-----------|----------------|
| `"node"` or `"edge"` | Docs have "RELATED INFORMATION" sections | Only docs with related info get file IDs |
| `"chunk"` | Default | 1:1 mapping between file_ids and retrieved_docs |
| Other | Invalid | Logs error, no mapping |

Patch the module-level constant: `patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk")`.

### Critical: `align_outputs()` RERANK Branch — Three Output Formats

The rerank branch handles three data formats:

1. **Dict with `reranked_docs`**: Custom Genie Python Wrapper output
2. **Dict with `documents`**: Simple document list
3. **List**: Raw TEI output — uses `index` field to map back to original docs

For list format, it accesses `reranker_parameters.top_n` to limit results.

### Critical: `align_generator()` SSE Format

`align_generator()` receives a byte stream generator and yields SSE-formatted chunks:

Input format (bytes):
```
b'data:{"id":"","choices":[{"delta":{"content":"Hello"}}]}\n\n'
```

Output format (string):
```
data: b'Hello'\n\n
data: [DONE]\n\n
```

It handles:
- Standard OpenAI streaming chunks: `choices[0].delta.content`
- "ops" format: `ops[0].value` (alternative streaming format)
- Malformed JSON: yields raw string as fallback
- Always yields `data: [DONE]\n\n` at end

### Critical: `GenieUserProfileClient` — aiohttp Mocking

`GenieUserProfileClient.get_user_profile()` uses `aiohttp.ClientSession` as async context manager:

```python
async with aiohttp.ClientSession(timeout=_timeout) as session, \
     session.get(url, headers=headers) as response:
```

Since `aiohttp` is mocked at module level in conftest, you need to configure the mock to return proper async context manager behavior. The conftest `aiohttp` mock may not have `ClientTimeout` configured:

```python
def create_mock_aiohttp_session(status=200, json_data=None):
    mock_response = AsyncMock()
    mock_response.status = status
    mock_response.json = AsyncMock(return_value=json_data or {})
    mock_response.text = AsyncMock(return_value="")
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session = AsyncMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_timeout = MagicMock()
    return mock_session, mock_timeout
```

### Critical: `ChatCompletionRequest` — Mock Input Construction

`ChatCompletionRequest` is from the mocked `comps.cores.proto.genieai_api_protocol`. It cannot be instantiated normally. For `handle_request()`, the code calls `ChatCompletionRequest.parse_obj(data)` — this returns a MagicMock because the class itself is a MagicMock.

The parsed `chat_request` object needs these attributes (the code accesses them directly):

```python
chat_request.messages        # list of message dicts
chat_request.context         # object with .language attribute (or None)
chat_request.language        # string or None
chat_request.max_tokens      # int
chat_request.top_k           # int
chat_request.top_p           # float
chat_request.temperature     # float
chat_request.frequency_penalty  # float
chat_request.presence_penalty   # float
chat_request.repetition_penalty # float
chat_request.stream          # bool
chat_request.chat_template   # string or None
chat_request.model           # string or None
chat_request.search_type     # string
chat_request.k               # int
chat_request.fetch_k         # int
chat_request.search_start    # string
chat_request.enable_traversal           # string
chat_request.traversal_max_depth       # int
chat_request.traversal_max_returned    # int
chat_request.traversal_score_threshold # float
chat_request.distance_threshold        # int
chat_request.lambda_mult               # float
chat_request.score_threshold           # float
chat_request.reranking_strategy        # string
chat_request.top_n                     # int
chat_request.reranking_threshold       # float
```

Since `ChatCompletionRequest.parse_obj()` returns a MagicMock, all attribute accesses return MagicMock (falsy for bool checks). This means ALL defaults from `LLMParams()` and `GenieaiRetrieverParms()` will be used. This is fine for testing — just be aware.

### Source File Map

**`genie-ai-overlay/chatqna/genieai_chatqna.py`** (1,774 lines):

| Lines | Component | Purpose |
|-------|-----------|---------|
| 1–101 | Constants & Config | 30+ env-var-based constants, system prompt, sensitive keys |
| 107–117 | Data subclasses | `GenieaiRetrieverParms`, `GenieaiRerankerParms` |
| 122–146 | `ChatTemplate` | Static `generate_rag_prompt()` with Chinese/English detection |
| 149–207 | `GenieUserProfileClient` | Async HTTP client for backend user profile |
| 209–342 | `UserContextBuilder` | Sanitize, extract, format user context string |
| 349–358 | `get_tokenizer()` | Lazy-loaded AutoTokenizer singleton |
| 364–528 | `align_inputs()` | Input transform per service type (TRANSLATOR, EMBEDDING, RETRIEVER, RERANK, LLM) |
| 531–770 | `align_outputs()` | Output transform per service type with file_id pairing |
| 772–798 | `align_generator()` | SSE streaming response parser |
| 800–858 | `ChatQnAService.__init__`, `_find_node_key`, `fetch_file_metadata` | Service setup and metadata client |
| 860–1072 | `add_remote_service*` methods | 5 variants of service graph construction |
| 1074–1096 | `_build_translategemma_prompt()` | TranslateGemma-specific prompt builder |
| 1098–1200 | `_get_translated_history_string()` | Chat history translation with chunking |
| 1202–1232 | `load_language_codes()`, `_split_text_into_chunks()` | Utility methods |
| 1234–1313 | `_translate_text_chunk()`, `_translate_with_chunking()` | Translation with error fallback |
| 1315–1733 | `handle_request()` | Main orchestrator entry point (418 lines) |
| 1735–1773 | `start()`, `__main__` | FastAPI service bootstrap |

### Test Organization

Follow established pattern from test_reranker.py:

```
tests/test_chatqna.py
├── Helper functions (create_chatqna_service, create_mock_request, etc.)
├── TestChatTemplate           — AC #1
├── TestUserContextBuilder      — AC #2
│   ├── TestSanitizeData
│   ├── TestParseDob
│   ├── TestCalculateAge
│   ├── TestExtractPrimitiveFields
│   └── TestBuildUserContextString
├── TestGenieUserProfileClient  — AC #2, #5
├── TestAlignInputs             — AC #1, #3
│   ├── TestTranslatorInput
│   ├── TestEmbeddingInput
│   ├── TestRetrieverInput
│   ├── TestRerankInput
│   └── TestLlmInput
├── TestAlignOutputs            — AC #1, #4
│   ├── TestTranslatorOutput
│   ├── TestEmbeddingOutput
│   ├── TestRetrieverOutput
│   ├── TestRerankOutput
│   └── TestLlmOutput
├── TestAlignGenerator          — AC #6
├── TestChatQnAServiceInit      — AC #1
├── TestTranslationHelpers      — AC #3
├── TestFetchFileMetadata       — AC #4, #5
└── TestHandleRequest           — AC #1, #4, #5 (integration-level)
```

### Testing Standards

- **Runner**: pytest 9.x with asyncio mode
- **Location**: `genie-ai-overlay/tests/test_chatqna.py`
- **Lint**: ruff (target py310, line-length 120, double quotes)
- **Header**: ITU copyright (`# Copyright (c) 2024-2026 International Telecommunication Union (ITU)`)
- **Naming**: `class TestFeatureGroup:` with `def test_method_scenario():`
- **Async**: Use `async def test_*()` — pytest-asyncio handles the rest
- **AAA**: Arrange-Act-Assert structure in every test

### Previous Story Intelligence (Stories 4.1–4.5)

Key learnings from previous stories:

- conftest.py sys.modules block handles all OPEA vendored imports — add new modules only if not already covered
- `patch.object(module, "CONSTANT_NAME", value)` is needed for module-level constants evaluated at import time
- Use `monkeypatch.setenv()` for env var tests (autouse fixture already sets base env vars)
- Tests run from `genie-ai-overlay/` directory with venv activated
- All existing tests must continue to pass — verify with full suite run
- OPEA base class types are MagicMock — use standalone mock objects for test inputs
- For models inheriting from mocked bases, test via mock input objects with expected attributes
- **CRITICAL from Story 4.5**: `model_dump()` on MagicMock returns another MagicMock — always configure `return_value` as a real dict
- **CRITICAL from Story 4.5**: `isinstance(mock_input, MockedType)` always returns False — set attributes for both branches
- **CRITICAL from Story 4.5**: Use `__new__()` to bypass parent `__init__` for testable instances
- **CRITICAL from Stories 4.2-4.3**: `patch()` path must be relative to the module under test, e.g., `"chatqna.genieai_chatqna.IS_TRANSLATEGEMMA"` not `"genieai_chatqna.IS_TRANSLATEGEMMA"`
- **CRITICAL from Stories 4.2-4.3**: When testing methods that call `aiohttp.ClientSession`, use `asynccontextmanager` pattern for mocking
- **CRITICAL from Story 4.5**: `isinstance(mock_input, MockedType)` raises TypeError when MockedType is a MagicMock created via `type()` — set attributes for both branches or use autouse fixtures to create real types for isinstance checks (as done in test_reranker.py conftest)

### References

- [Source: genie-ai-overlay/chatqna/genieai_chatqna.py] — Main ChatQnA orchestrator (1,774 lines)
- [Source: genie-ai-overlay/tests/conftest.py] — Existing mock setup, may need transformers/langdetect additions
- [Source: genie-ai-overlay/tests/test_reranker.py] — Reference for helper patterns, aiohttp mocking, `__new__()` bypass
- [Source: genie-ai-overlay/tests/test_retriever.py] — Reference for mocking aiohttp patterns
- [Source: genie-ai-overlay/tests/test_dataprep.py] — Reference for complex test organization
- [Source: _bmad-output/planning-artifacts/architecture.md] — test_chatqna.py location and testing standards
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 4 Story 4.6] — Story requirements
- [Source: _bmad-output/implementation-artifacts/4-5-test-reranker-score-validation-and-top-k-constraints.md] — Previous story dev notes and learnings

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

- Updated conftest.py with 3 new sys.modules mocks: transformers, langdetect, keycloak_token_validator
- Added aiohttp.ClientTimeout mock to existing aiohttp mock entry
- Created test_chatqna.py with 69 tests covering all 7 acceptance criteria
- Used FakeServiceType enum to bypass ServiceType MagicMock comparison issue
- Used BrokenSet class to trigger SENSITIVE_KEYS fallback code path
- Flattened nested test classes to avoid pytest-asyncio setup_method propagation issue
- Full suite: 275 passed (206 existing + 69 new), 0 failures, 0 regressions

### File List

- `genie-ai-overlay/tests/conftest.py` (modified — added ChatQnA mocks)
- `genie-ai-overlay/tests/test_chatqna.py` (new — 69 tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status update)
- `_bmad-output/implementation-artifacts/4-6-test-chatqna-orchestrator-interface.md` (modified — task completion)
