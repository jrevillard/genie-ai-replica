# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import ast
import contextlib
import copy
import json
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

import chatqna.genieai_chatqna as chatqna_module
from chatqna.genieai_chatqna import (
    ChatQnAService,
    ChatTemplate,
    GenieUserProfileClient,
    UserContextBuilder,
    _calibrate_reranker_score,
    _count_final_chunks,
    _display_confidence,
    _extract_self_confidence,
    _rank_weighted_confidence,
    align_generator,
    align_inputs,
    align_outputs,
)
from core import embedding_query_prefix as core_query_prefix
from tests.conftest import FakeServiceType, create_mock_service_node


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
def create_chatqna_service():
    """Create a ChatQnAService without calling __init__."""
    svc = ChatQnAService.__new__(ChatQnAService)
    svc.host = "0.0.0.0"
    svc.port = 8888
    svc.megaservice = MagicMock()
    svc.endpoint = "/v1/chatqna"
    svc.user_profile_client = GenieUserProfileClient()
    return svc


def create_mock_request(data=None, headers=None):
    """Create a mock FastAPI Request with configurable JSON body and headers.

    ``request.state`` is a real ``SimpleNamespace`` (not a child Mock) so tests
    that ``setattr`` / ``getattr`` attributes on it observe the real values.
    """
    from types import SimpleNamespace

    req = MagicMock()
    req.json = AsyncMock(return_value=data or {})
    req.headers = headers or {}
    req.state = SimpleNamespace()
    return req


def create_mock_chat_request_data(**overrides):
    """Return a dict matching ChatCompletionRequest schema."""
    defaults = {
        "messages": [{"role": "user", "content": "Hello"}],
        "context": None,
        "language": None,
        "top_k": 4,
        "top_p": 0.9,
        "temperature": 0.7,
        "frequency_penalty": 0.0,
        "presence_penalty": 0.0,
        "repetition_penalty": 1.0,
        "stream": False,
        "chat_template": None,
        "model": None,
        "search_type": "hybrid",
        "k": 4,
        "fetch_k": 20,
        "search_start": "chunk",
        "enable_traversal": "false",
        "traversal_max_depth": 2,
        "traversal_max_returned": 3,
        "traversal_score_threshold": 0.5,
        "distance_threshold": 1,
        "lambda_mult": 0.5,
        "score_threshold": 0.1,
        "reranking_strategy": "threshold",
        "top_n": 2,
        "reranking_threshold": 0.9,
    }
    defaults.update(overrides)
    return defaults


def create_mock_user_profile(**overrides):
    """Return a realistic user profile dict."""
    defaults = {
        "firstName": "John",
        "lastName": "Doe",
        "email": "john@example.com",
        "phoneNumber": "+1234567890",
        "dob": "1990-05-15",
        "gender": "male",
        "preferences": {"theme": "dark", "language": "en"},
        "address": {"city": "Geneva", "country": "Switzerland"},
    }
    defaults.update(overrides)
    return defaults


def create_mock_aiohttp_session(status=200, json_data=None):
    """Create a mock aiohttp session and timeout for async context manager usage."""
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


def create_mock_runtime_graph(downstream_nodes=None):
    """Create a mock runtime_graph with downstream(), add_edge(), delete_node_if_exists()."""
    graph = MagicMock()
    graph.downstream.return_value = downstream_nodes or []
    return graph


def create_mock_tokenizer(token_counts):
    """Create a mock tokenizer with a real .encode() method.

    token_counts: dict mapping text content substring -> int (token count).
    If no exact match, returns 0 tokens.
    """
    tokenizer = MagicMock()

    def mock_encode(text):
        for key, count in token_counts.items():
            if key in text:
                return [0] * count
        return []

    tokenizer.encode = mock_encode
    return tokenizer


def _counting_tokenizer():
    """Additive mock tokenizer: 100 tokens per 'RAGTOK' occurrence, 500 per 'HISTTOK'.

    Unlike the substring-keyed create_mock_tokenizer, this counts every
    occurrence, so combined strings (prompt + embedded history) accumulate
    deterministically.
    """

    class _CountingTokenizer:
        def encode(self, text):
            return [0] * (100 * text.count("RAGTOK") + 500 * text.count("HISTTOK"))

    return _CountingTokenizer()


@pytest.fixture(autouse=True)
def _clear_model_len_cache():
    """Isolate the module-global model_cache TTL cache per test."""
    from core.model_cache import clear_cache

    clear_cache()
    yield
    clear_cache()


@pytest.fixture(autouse=True)
def _no_vllm_endpoints():
    """No vLLM exists in CI: window-discovery probes must fail fast.

    Window probing is always on, so any test that reaches httpx.get without
    its own mock would hit a real socket. Default to ConnectError; tests that
    need a probe response patch httpx.get inside their own with-block (the
    inner patch wins while active).
    """
    with patch("httpx.get", side_effect=httpx.ConnectError("no vLLM in unit tests")):
        yield


# ===========================================================================
# Task 3: Test ChatTemplate.generate_rag_prompt()
# ===========================================================================
class TestChatTemplate:
    def test_english_documents_returns_english_template(self):
        documents = ["This is a document about AI.", "Another document here."]
        result = ChatTemplate.generate_rag_prompt("What is AI?", documents)
        assert "Question:" in result
        assert "Answer:" in result
        assert "Search results:" in result
        assert "What is AI?" in result
        assert "问题" not in result

    def test_chinese_documents_returns_chinese_template(self):
        documents = ["这是一段关于人工智能的文档。" * 5, "另一个文档。" * 3]
        result = ChatTemplate.generate_rag_prompt("什么是AI？", documents)
        assert "问题：" in result or "问题:\n" in result
        assert "回答：" in result or "回答:\n" in result
        assert "搜索结果：" in result or "搜索结果:" in result
        assert "Question:" not in result
        assert "Answer:" not in result
        assert "Search results:" not in result

    def test_mixed_documents_below_cjk_threshold(self):
        # Less than 30% CJK characters
        documents = ["This is a document with 少量中文.", "Another English document."]
        result = ChatTemplate.generate_rag_prompt("test question", documents)
        assert "Question:" in result

    def test_empty_documents_list(self):
        result = ChatTemplate.generate_rag_prompt("test question", [])
        assert "test question" in result


# ===========================================================================
# Task 4: Test UserContextBuilder — sanitization and enrichment
# ===========================================================================
class TestUserContextBuilderSanitizeData:
    def test_removes_sensitive_keys(self):
        builder = UserContextBuilder()
        data = {"email": "test@test.com", "name": "John", "phoneNumber": "123"}
        with patch("chatqna.genieai_chatqna.SENSITIVE_KEYS", {"email", "phoneNumber"}):
            result = builder._sanitize_data(data)
        assert "email" not in result
        assert "phoneNumber" not in result
        assert "name" in result

    def test_recurse_into_nested_dicts(self):
        builder = UserContextBuilder()
        data = {"name": "John", "nested": {"email": "hidden@test.com"}}
        with patch("chatqna.genieai_chatqna.SENSITIVE_KEYS", {"email"}):
            result = builder._sanitize_data(data)
        assert "email" not in result["nested"]

    def test_recurse_into_lists(self):
        builder = UserContextBuilder()
        data = {"name": "John", "items": [{"email": "a@b.com"}, {"safe": "value"}]}
        with patch("chatqna.genieai_chatqna.SENSITIVE_KEYS", {"email"}):
            result = builder._sanitize_data(data)
        assert "email" not in result["items"][0]

    def test_fallback_when_sensitive_keys_empty_or_exception(self):
        builder = UserContextBuilder()

        class BrokenSet:
            def __contains__(self, item):
                raise TypeError("broken")

        data = {"email": "test@test.com", "name": "John", "ssn": "123-456"}
        with patch("chatqna.genieai_chatqna.SENSITIVE_KEYS", BrokenSet()):
            result = builder._sanitize_data(data)
        assert "email" not in result
        assert "ssn" not in result
        assert "name" in result


class TestUserContextBuilderParseDob:
    def test_yyyy_mm_dd_format(self):
        assert UserContextBuilder()._parse_dob("1990-05-15") == date(1990, 5, 15)

    def test_yyyy_mm_dd_with_dots(self):
        assert UserContextBuilder()._parse_dob("1990.05.15") == date(1990, 5, 15)

    def test_invalid_string_returns_none(self):
        assert UserContextBuilder()._parse_dob("not-a-date") is None

    def test_non_string_returns_none(self):
        assert UserContextBuilder()._parse_dob(12345) is None


class TestUserContextBuilderCalculateAge:
    def test_known_birth_date(self):
        age = UserContextBuilder()._calculate_age(date(2000, 1, 1))
        assert isinstance(age, int)
        assert age >= 25

    def test_none_returns_na(self):
        assert UserContextBuilder()._calculate_age(None) == "N/A"


class TestUserContextBuilderExtractPrimitiveFields:
    def test_nested_dict_and_list_structure(self):
        data = {
            "name": "John",
            "age": 30,
            "nested": {"city": "Geneva"},
            "tags": ["admin", "user"],
        }
        result = UserContextBuilder()._extract_primitive_fields(data)
        assert result["name"] == "John"
        assert result["age"] == 30
        assert result["city"] == "Geneva"
        assert result["tags"] == "admin, user"


class TestUserContextBuilderBuildString:
    def test_full_pipeline(self):
        profile = create_mock_user_profile()
        with patch("chatqna.genieai_chatqna.SENSITIVE_KEYS", {"email", "phoneNumber"}):
            result = UserContextBuilder().build_user_context_string(profile)
        assert "John" in result
        assert "Age:" in result
        assert "email" not in result

    def test_empty_input_returns_empty_string(self):
        assert UserContextBuilder().build_user_context_string({}) == ""

    def test_original_not_mutated(self):
        original = create_mock_user_profile()
        original_copy = copy.deepcopy(original)
        with patch("chatqna.genieai_chatqna.SENSITIVE_KEYS", set()):
            UserContextBuilder().build_user_context_string(original)
        assert original == original_copy


# ===========================================================================
# Task 5: Test GenieUserProfileClient
# ===========================================================================
class TestGenieUserProfileClient:
    @pytest.mark.asyncio
    async def test_get_user_profile_valid_token_returns_profile(self):
        client = GenieUserProfileClient()
        mock_session, mock_timeout = create_mock_aiohttp_session(status=200, json_data={"firstName": "John"})
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await client.get_user_profile(token="valid-token")
        assert result == {"firstName": "John"}

    @pytest.mark.asyncio
    async def test_get_user_profile_no_token_returns_none(self):
        client = GenieUserProfileClient()
        result = await client.get_user_profile(token=None)
        assert result is None

    @pytest.mark.asyncio
    async def test_get_user_profile_401_returns_none(self):
        client = GenieUserProfileClient()
        mock_session, mock_timeout = create_mock_aiohttp_session(status=401)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await client.get_user_profile(token="bad-token")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_user_profile_404_returns_none(self):
        client = GenieUserProfileClient()
        mock_session, mock_timeout = create_mock_aiohttp_session(status=404)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await client.get_user_profile(token="valid-token")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_user_profile_connection_exception_returns_none(self):
        client = GenieUserProfileClient()
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", side_effect=Exception("Connection refused")),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=MagicMock()),
        ):
            result = await client.get_user_profile(token="valid-token")
        assert result is None


# ===========================================================================
# Task 6: Test align_inputs() for each service type
# ===========================================================================
class TestAlignInputs:
    # --- EMBEDDING ---
    class TestEmbeddingInput:
        def test_renames_text_to_input(self):
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "Hello", "other": "value"}
            # Non-BGE embedding model → no prefix; raw query passes through.
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "text-embedding-3-small"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert "input" in result
            assert result["input"] == "Hello"
            assert "text" not in result

        def test_default_bge_model_applies_prefix(self):
            """Issue #1035: default TEI_EMBED_MODEL is BAAI/bge-large-en-v1.5 →
            query is prefixed before the embedding microservice call."""

            expected = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["BAAI/bge-large-en-v1.5"]
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "Hello"}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == expected + "Hello"

        def test_bge_prefix_applied_to_query_single(self):
            """Issue #1035: BGE-large-en-v1.5 requires query instruction prefix at the
            embedding microservice call site (one prefix per query, not per passage)."""

            expected = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["BAAI/bge-large-en-v1.5"]
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "What are drought-resistant bean varieties?"}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "BAAI/bge-large-en-v1.5"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == expected + "What are drought-resistant bean varieties?"

        def test_bge_prefix_applied_to_query_batch(self):
            """History-blend path: both query and history strings receive the prefix
            before the batched TEI call (BGE asymmetry must hold for both vectors)."""

            expected = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["BAAI/bge-large-en-v1.5"]
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "elaborate on this", "_blend_history_text": "prior turn", "_blend_alpha": 0.5}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "BAAI/bge-large-en-v1.5"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == [
                expected + "elaborate on this",
                expected + "prior turn",
            ]

        def test_instructor_prefix_applied_to_query(self):
            """Generalized: hkunlp/instructor uses task-specific prefix."""

            expected = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["hkunlp/instructor"]
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "legal question"}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "hkunlp/instructor-base"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == expected + "legal question"

        def test_no_prefix_model_passes_raw_text(self):
            """Models without an instruction entry (BGE-m3, mxbai) → raw text."""
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "plain query"}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "BAAI/bge-m3"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == "plain query"

        def test_user_override_via_user_query_instructions(self):
            """Deployer-supplied EMBEDDING_QUERY_INSTRUCTIONS overrides built-in."""

            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "hi"}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "my-org/bge-finetune"),
                patch.object(
                    core_query_prefix, "_USER_QUERY_INSTRUCTIONS", (("my-org/bge-finetune", "Custom prefix: "),)
                ),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == "Custom prefix: hi"

    # --- RETRIEVER ---
    class TestRetrieverInput:
        def test_merges_retriever_parameters(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            llm_params = {}
            inputs = {"text": "query", "k": 4}
            retriever_params = MagicMock()
            retriever_params.model_dump.return_value = {"search_type": "hybrid", "fetch_k": 20}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_inputs(
                    self_mock,
                    inputs,
                    "retriever_node",
                    MagicMock(),
                    llm_params,
                    retriever_parameters=retriever_params,
                )
            assert result["search_type"] == "hybrid"

        def test_embedding_batch_when_history_present(self):
            """issue #833 E2: embedding node receives [query, history] batch when history set."""
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "elaborate on this", "_blend_history_text": "prior turn", "_blend_alpha": 0.5}
            # Non-BGE model → no prefix; raw strings pass through.
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "text-embedding-3-small"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            # Batched input: [query, history]
            assert result["input"] == ["elaborate on this", "prior turn"]
            assert "text" not in result
            assert result["_blend_alpha"] == 0.5

        def test_embedding_single_when_history_absent(self):
            """Regression guard: no history → single-string input (baseline path)."""
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "standalone query"}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "text-embedding-3-small"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == "standalone query"
            assert "_blend_alpha" not in result

        def test_embedding_empty_history_string_treated_as_absent(self):
            """Empty history_text (first turn / flag off) → single-string, no blend artifacts."""
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "query", "_blend_history_text": "", "_blend_alpha": 0.5}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.TEI_EMBED_MODEL", "text-embedding-3-small"),
            ):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert result["input"] == "query"
            assert "_blend_alpha" not in result

    # --- RERANK ---
    class TestRerankInput:
        def test_merges_reranker_parameters(self):
            self_mock = MagicMock()
            self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
            llm_params = {}
            inputs = {"initial_query": "test", "documents": []}
            reranker_params = MagicMock()
            reranker_params.model_dump.return_value = {"top_n": 3, "threshold": 0.8}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_inputs(
                    self_mock,
                    inputs,
                    "rerank_node",
                    MagicMock(),
                    llm_params,
                    reranker_parameters=reranker_params,
                )
            assert result["top_n"] == 3

    # --- LLM ---
    class TestLlmInput:
        def test_constructs_system_and_user_messages(self, count_patch):
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "context text", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(create_mock_tokenizer({})),
            ):
                result = align_inputs(self_mock, inputs, "llm_node", MagicMock(), llm_params)
            assert "messages" in result
            assert result["messages"][0]["role"] == "system"
            assert result["messages"][1]["role"] == "user"
            assert result["max_tokens"] == 1024

        def test_token_limit_truncation(self, count_patch):
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "rag prompt", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            history = "USER: msg1 |<-MSG->| USER: msg2 |<-MSG->| USER: msg3"

            # System prompt is ~200 tokens, user content is ~100 tokens = ~300 total
            # With max_model_tokens=600 and max_answer_tokens=1024 → need truncation
            # max_history_tokens = 600 - system(0) - 1024 - skeleton(0) - 200 = -624
            # (negative → truncation triggers; this mock matches neither the system
            # prompt nor the skeleton, so only the window/answer/buffer terms bite)
            mock_tok = create_mock_tokenizer({"system": 200, "USER": 100})
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(mock_tok),
                patch("chatqna.genieai_chatqna.MAX_MODEL_LEN_TEXTGEN", 600),
            ):
                result = align_inputs(
                    self_mock,
                    inputs,
                    "llm_node",
                    MagicMock(),
                    llm_params,
                    full_chat_history_string=history,
                )
            assert "messages" in result
            # Truncation should have occurred — history segments should not appear
            user_msg = result["messages"][1]["content"]
            assert "msg1" not in user_msg  # truncated away
            assert "rag prompt" in user_msg  # content preserved

        def test_history_survives_prompt_that_fits_discovered_window(self, count_patch):
            """Prompt (~8k tokens) + answer fit the real 65536-token window discovered
            from /v1/models → the guard must not touch the chat history.

            Under the stale 4096 default the same prompt overflows the budget and
            the guard wipes the history entirely.
            """
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "RAGTOK" * 80, "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            history = "USER: HISTTOK |<-MSG->| USER: HISTTOK |<-MSG->| USER: HISTTOK"

            counting_tok = _counting_tokenizer()
            models_resp = MagicMock()
            models_resp.json.return_value = {"data": [{"id": "m", "max_model_len": 65536}]}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(counting_tok),
                patch("chatqna.genieai_chatqna._LLM_DISCOVERY_ENDPOINT", "https://gpu-host/llm"),
                patch("httpx.get", return_value=models_resp),
            ):
                result = align_inputs(
                    self_mock, inputs, "llm_node", MagicMock(), llm_params, full_chat_history_string=history
                )
            user_msg = result["messages"][1]["content"]
            assert "HISTTOK" in user_msg  # history intact
            assert "RAGTOK" in user_msg  # KB content preserved

        def test_history_wiped_only_when_budget_truly_exhausted_and_reported(self, count_patch):
            """When prompt+answer genuinely exhaust the window, history is dropped —
            and the drop is reported through the truncation counter."""
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "RAGTOK" * 648, "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            history = "USER: HISTTOK |<-MSG->| USER: HISTTOK |<-MSG->| USER: HISTTOK"

            counting_tok = _counting_tokenizer()
            models_resp = MagicMock()
            models_resp.json.return_value = {"data": [{"id": "m", "max_model_len": 65536}]}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(counting_tok),
                patch("chatqna.genieai_chatqna._LLM_DISCOVERY_ENDPOINT", "https://gpu-host/llm"),
                patch("httpx.get", return_value=models_resp),
                patch("chatqna.genieai_chatqna.history_truncation_total") as mock_counter,
            ):
                result = align_inputs(
                    self_mock, inputs, "llm_node", MagicMock(), llm_params, full_chat_history_string=history
                )
            user_msg = result["messages"][1]["content"]
            assert "HISTTOK" not in user_msg  # no room — dropped
            assert "RAGTOK" in user_msg  # KB content preserved
            mock_counter.add.assert_called_once()
            # Counts stay in the warning log; metric attributes stay low-cardinality.
            assert mock_counter.add.call_args.args[1] == {"path": "generation"}

        def test_no_truncation_no_truncation_metric(self, count_patch):
            """A prompt well inside the window never increments the truncation counter."""
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "rag prompt", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            history = "USER: msg1 |<-MSG->| USER: msg2"
            mock_tok = create_mock_tokenizer({"rag prompt": 100})
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(mock_tok),
                patch("chatqna.genieai_chatqna._LLM_DISCOVERY_ENDPOINT", "https://gpu-host/llm"),
                patch(
                    "httpx.get", return_value=MagicMock(json=lambda: {"data": [{"id": "m", "max_model_len": 65536}]})
                ),
                patch("chatqna.genieai_chatqna.history_truncation_total") as mock_counter,
            ):
                result = align_inputs(
                    self_mock, inputs, "llm_node", MagicMock(), llm_params, full_chat_history_string=history
                )
            user_msg = result["messages"][1]["content"]
            assert "msg1" in user_msg
            mock_counter.add.assert_not_called()

        def test_large_system_prompt_shrinks_history_budget(self, count_patch):
            """The system prompt consumes the history budget: with a 1000-token
            system prompt the oldest segment no longer fits and is dropped."""

            class _Tok:
                def encode(self, text):
                    return [0] * (
                        1000 * text.count("SYSTOK") + 100 * text.count("RAGTOK") + 500 * text.count("HISTTOK")
                    )

            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "RAGTOK" * 5, "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            history = "USER: HISTTOK-old |<-MSG->| USER: HISTTOK-mid |<-MSG->| USER: HISTTOK-new"

            # window 4096 − system 1000 − answer 1024 − skeleton (RAG 500) − 200
            # = 1372 tokens of history: the newest (500) and mid (500) fit, the
            # oldest does not. The old formula ignored the system prompt and
            # kept all three.
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(_Tok()),
                patch("chatqna.genieai_chatqna.CHATQNA_SYSTEM_PROMPT", "SYSTOK"),
                patch("chatqna.genieai_chatqna.MAX_MODEL_LEN_TEXTGEN", 4096),
                patch("chatqna.genieai_chatqna.history_truncation_total") as mock_counter,
            ):
                result = align_inputs(
                    self_mock, inputs, "llm_node", MagicMock(), llm_params, full_chat_history_string=history
                )
            user_msg = result["messages"][1]["content"]
            assert "HISTTOK-new" in user_msg  # newest kept
            assert "HISTTOK-mid" in user_msg  # mid kept
            assert "HISTTOK-old" not in user_msg  # oldest dropped
            assert mock_counter.add.call_args.args[1] == {"path": "generation"}

        def test_system_and_content_alone_over_window_wipes_history(self, count_patch):
            """System prompt + RAG content alone overflow the window: the history
            budget goes negative and every segment is dropped and reported."""

            class _Tok:
                def encode(self, text):
                    return [0] * (
                        1000 * text.count("SYSTOK") + 100 * text.count("RAGTOK") + 500 * text.count("HISTTOK")
                    )

            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "RAGTOK" * 5, "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            history = "USER: HISTTOK-a |<-MSG->| USER: HISTTOK-b |<-MSG->| USER: HISTTOK-c"

            # system 3000 + skeleton 500 = 3500 prompt tokens before any history;
            # budget = 4096 − 3000 − 1024 − 500 − 200 < 0 → wipe.
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(_Tok()),
                patch("chatqna.genieai_chatqna.CHATQNA_SYSTEM_PROMPT", "SYSTOK SYSTOK SYSTOK"),
                patch("chatqna.genieai_chatqna.MAX_MODEL_LEN_TEXTGEN", 4096),
                patch("chatqna.genieai_chatqna.history_truncation_total") as mock_counter,
            ):
                result = align_inputs(
                    self_mock, inputs, "llm_node", MagicMock(), llm_params, full_chat_history_string=history
                )
            user_msg = result["messages"][1]["content"]
            assert "HISTTOK" not in user_msg  # nothing fits
            assert "RAGTOK" in user_msg  # KB content preserved
            assert mock_counter.add.call_args.args[1] == {"path": "generation"}

        def test_empty_history_never_reports_truncation(self, count_patch):
            """First turn (no history) with an overflowing prompt: nothing can be
            dropped, so no warning and no counter event."""

            class _Tok:
                def encode(self, text):
                    return [0] * (1000 * text.count("SYSTOK") + 100 * text.count("RAGTOK"))

            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "RAGTOK" * 5, "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}

            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                count_patch(_Tok()),
                patch("chatqna.genieai_chatqna.CHATQNA_SYSTEM_PROMPT", "SYSTOK SYSTOK SYSTOK"),
                patch("chatqna.genieai_chatqna.MAX_MODEL_LEN_TEXTGEN", 4096),
                patch("chatqna.genieai_chatqna.history_truncation_total") as mock_counter,
            ):
                result = align_inputs(
                    self_mock, inputs, "llm_node", MagicMock(), llm_params, full_chat_history_string=""
                )
            mock_counter.add.assert_not_called()
            assert "RAGTOK" in result["messages"][1]["content"]


# ===========================================================================
# Bundled-dict path: align_inputs consumes from genie_params dict
# ===========================================================================
class TestAlignInputsBundledDict:
    """Verify align_inputs extracts values from the bundled genie_params dict.

    v1.5 re-graft: the 6 custom kwargs are packed into one ``genie_params``
    dict at the ``schedule()`` call site. These tests call ``align_inputs``
    with the bundled dict (not flat kwargs) and assert the handlers extract
    values from the dict — closing the verification gap where the existing
    mocked suite only exercises the flat-kwargs fallback.
    """

    def test_retriever_extracts_retriever_parameters_from_dict(self):
        """RETRIEVER branch reads retriever_parameters from genie_params dict."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        llm_params = {}
        inputs = {"text": "query", "k": 4}
        retriever_params = MagicMock()
        retriever_params.model_dump.return_value = {"search_type": "hybrid", "fetch_k": 20}
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            result = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                llm_params,
                genie_params={"retriever_parameters": retriever_params},
            )
        assert result["search_type"] == "hybrid"
        assert result["fetch_k"] == 20

    def test_retriever_extracts_retrieval_context_from_dict(self):
        """RETRIEVER branch reads retrieval_context from genie_params dict."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        llm_params = {}
        inputs = {"text": "query", "search_start": "chunk"}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.encode_filter_labels") as mock_encode,
        ):
            # chatqna binds encode_filter_labels at module load; the
            # function-local import is gone, so patch the NAME it uses.
            mock_encode.return_value = "chunk::labels:Tomato"
            result = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                llm_params,
                genie_params={"retrieval_context": {"categoryLabels": ["Tomato"]}},
            )
        assert result["search_start"] == "chunk::labels:Tomato"
        mock_encode.assert_called_once_with("chunk", ["Tomato"])

    def test_retriever_carrier_includes_sticky_segment(self):
        """Story 1.3 — sticky_graph_names in retrieval_context flow into the
        carrier encode as the ::sticky: continuity set (routed ∪ sticky at the
        retriever)."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        llm_params = {}
        inputs = {"text": "query", "search_start": "chunk"}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            mock_contract = sys.modules["core.label_contract"]
            mock_contract.encode.return_value = "chunk::graphs:GRAPH,OKF_a_v1::sticky:OKF_a_v1"
            align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                llm_params,
                genie_params={
                    "retrieval_context": {
                        "authorized_graph_names": ["GRAPH", "OKF_a_v1"],
                        "sticky_graph_names": ["OKF_a_v1"],
                    }
                },
            )
        # The encoded-string echo of mock_contract.encode.return_value proves
        # nothing (the mock supplies it); the kwarg plumbing is the contract.
        mock_contract.encode.assert_called_once_with(
            "chunk", labels=[], graphs=["GRAPH", "OKF_a_v1"], sticky=["OKF_a_v1"]
        )

    def test_retriever_carrier_omits_sticky_kwarg_when_empty(self):
        """Story 1.3 — no sticky set → encode never receives the sticky kwarg
        (the mocked pre-1.3 encode signature keeps working on the default path)."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        llm_params = {}
        inputs = {"text": "query", "search_start": "chunk"}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            mock_contract = sys.modules["core.label_contract"]
            mock_contract.encode.return_value = "chunk::graphs:GRAPH,OKF_a_v1"
            align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                llm_params,
                genie_params={"retrieval_context": {"authorized_graph_names": ["GRAPH", "OKF_a_v1"]}},
            )
        mock_contract.encode.assert_called_once_with("chunk", labels=[], graphs=["GRAPH", "OKF_a_v1"])

    def test_retriever_carrier_sticky_only_encodes(self):
        """DW-430 (review 2026-10-29 round 3): a sticky-only carrier — sticky
        set, labels/graphs/no_legacy all empty — must reach encode with the
        ::sticky: segment. The dispatch previously matched NEITHER branch, so
        the continuity set was silently dropped from search_start (only the
        retriever-side sticky⊆authorized invariant saved it from fanning
        out)."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        llm_params = {}
        inputs = {"text": "query", "search_start": "chunk"}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            mock_contract = sys.modules["core.label_contract"]
            mock_contract.encode.return_value = "chunk::sticky:OKF_a_v1"
            align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                llm_params,
                genie_params={"retrieval_context": {"sticky_graph_names": ["OKF_a_v1"]}},
            )
        mock_contract.encode.assert_called_once_with("chunk", labels=[], graphs=[], sticky=["OKF_a_v1"])

    def test_rerank_extracts_reranker_parameters_from_dict(self):
        """RERANK branch reads reranker_parameters from genie_params dict."""
        self_mock = MagicMock()
        self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
        llm_params = {}
        inputs = {"text": "query"}
        reranker_params = MagicMock()
        reranker_params.model_dump.return_value = {"top_n": 3}
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            result = align_inputs(
                self_mock,
                inputs,
                "rerank_node",
                MagicMock(),
                llm_params,
                genie_params={"reranker_parameters": reranker_params},
            )
        assert result["top_n"] == 3

    def test_llm_extracts_full_chat_history_string_from_dict(self):
        """LLM branch reads full_chat_history_string from genie_params dict."""
        self_mock = MagicMock()
        self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
        llm_params = {"max_tokens": 512, "top_p": 0.9}
        inputs = {"inputs": "rag prompt", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna._count_tokens", return_value=0),
        ):
            result = align_inputs(
                self_mock,
                inputs,
                "llm_node",
                MagicMock(),
                llm_params,
                genie_params={"full_chat_history_string": "prior turn |<-MSG->| earlier"},
            )
        assert "prior turn" in result["messages"][1]["content"]

    def test_llm_extracts_user_details_from_dict(self):
        """LLM branch reads user_details from genie_params dict."""
        self_mock = MagicMock()
        self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
        llm_params = {"max_tokens": 512, "top_p": 0.9}
        inputs = {"inputs": "rag prompt", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna._count_tokens", return_value=0),
            patch("chatqna.genieai_chatqna.UserContextBuilder") as mock_builder,
        ):
            mock_builder.return_value.build_user_context_string.return_value = "user context"
            result = align_inputs(
                self_mock,
                inputs,
                "llm_node",
                MagicMock(),
                llm_params,
                genie_params={"user_details": {"role": "citizen"}},
            )
        assert "user context" in result["messages"][1]["content"]

    def test_llm_extracts_original_language_from_dict(self):
        """LLM branch reads original_language from genie_params dict."""
        self_mock = MagicMock()
        self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
        llm_params = {"max_tokens": 512, "top_p": 0.9}
        inputs = {"inputs": "rag prompt", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna._count_tokens", return_value=0),
        ):
            result = align_inputs(
                self_mock,
                inputs,
                "llm_node",
                MagicMock(),
                llm_params,
                genie_params={"original_language": "EN"},
            )
        # EN language injects mandatory English instruction into system prompt
        assert "MANDATORY" in result["messages"][0]["content"]
        assert "English" in result["messages"][0]["content"]


# ===========================================================================
# Task 7: Test align_outputs() for each service type
# ===========================================================================
class TestAlignOutputs:
    # --- EMBEDDING ---
    class TestEmbeddingOutput:
        def test_transforms_to_text_and_embedding(self):
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            data = {"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]}
            # _original_query is stashed by align_inputs(EMBEDDING); align_outputs
            # raises if missing (issue #1035 BM25-leak fix).
            inputs = {"input": "Hello", "_original_query": "Hello"}
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "embedding_node", inputs, MagicMock(), llm_params)
            assert result["text"] == "Hello"
            assert result["embedding"] == [0.1, 0.2, 0.3]

        def test_blends_query_and_history_when_batch_returned(self):
            """issue #833 E2: align_outputs EMBEDDING blends batch [query, history] response."""
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            data = {
                "data": [
                    {"index": 0, "embedding": [1.0, 0.0]},
                    {"index": 1, "embedding": [0.0, 1.0]},
                ]
            }
            # _original_query mirrors what align_inputs(EMBEDDING) stashes.
            inputs = {
                "input": ["query", "history"],
                "_original_query": "query",
                "_blend_alpha": 0.5,
            }
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "embedding_node", inputs, MagicMock(), llm_params)
            # alpha=0.5 → midpoint
            assert result["embedding"] == [0.5, 0.5]
            # BM25/hybrid leg must receive the isolated QUERY string, not the
            # batch list (would 422 on retriever pydantic text:str otherwise).
            assert result["text"] == "query"

        def test_no_blend_when_single_embedding_returned(self):
            """Regression guard: single-input path unchanged (no _blend_alpha)."""
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            data = {"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]}
            inputs = {"input": "standalone query", "_original_query": "standalone query"}
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "embedding_node", inputs, MagicMock(), llm_params)
            assert result["embedding"] == [0.1, 0.2, 0.3]

        def test_raises_when_original_query_missing(self):
            """Issue #1035: align_outputs MUST receive _original_query from
            align_inputs(EMBEDDING) — the no-fallback contract prevents the
            BM25-leak regression from re-emerging via a hand-crafted inputs
            dict that bypassed align_inputs."""
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            data = {"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]}
            inputs = {"input": "prefixed text"}  # no _original_query
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                pytest.raises(ValueError, match="_original_query"),
            ):
                align_outputs(self_mock, data, "embedding_node", inputs, MagicMock(), llm_params)

        def test_single_path_echoes_original_query_not_prefixed(self):
            """Issue #1035 (BM25-leak fix): align_inputs may have prepended the
            model-specific query instruction to inputs["input"]. align_outputs
            must echo the stashed raw text so the retriever's BM25 leg
            (TOKENS(@query, ...)) tokenizes the user's actual query rather
            than the instruction tokens."""

            prefix = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["BAAI/bge-large-en-v1.5"]
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            data = {"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]}
            inputs = {
                "input": prefix + "drought-resistant beans",
                "_original_query": "drought-resistant beans",
            }
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "embedding_node", inputs, MagicMock(), llm_params)
            assert result["text"] == "drought-resistant beans"
            assert result["embedding"] == [0.1, 0.2, 0.3]

        def test_batch_path_echoes_original_query_not_prefixed(self):
            """BM25-leak fix for the batched (history-blend) path: the
            retriever's BM25 leg receives the isolated raw query string, not
            the list (which would 422) and not the prefixed first element."""

            prefix = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["BAAI/bge-large-en-v1.5"]
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            data = {
                "data": [
                    {"index": 0, "embedding": [1.0, 0.0]},
                    {"index": 1, "embedding": [0.0, 1.0]},
                ]
            }
            inputs = {
                "input": [prefix + "elaborate", prefix + "prior turn"],
                "_original_query": "elaborate",
                "_blend_alpha": 0.5,
            }
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "embedding_node", inputs, MagicMock(), llm_params)
            assert result["text"] == "elaborate"
            # alpha=0.5 → midpoint (dense channel still works as before)
            assert result["embedding"] == [0.5, 0.5]

    # --- RETRIEVER ---
    class TestRetrieverOutput:
        def test_with_rerank_downstream_passes_docs(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            data = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": "doc1"}],
                "metadata": [{"file_ids": ["f1"]}],
            }
            inputs = {}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
            ):
                result = align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            assert result["initial_query"] == "test"
            assert len(result["retrieved_docs"]) == 1

        def test_chunk_embeddings_flow_via_metadata_channel(self):
            """Verify chunk embeddings propagate via retrieved_docs[].metadata,
            which survives the OPEA megaservice hop (top-level fields are
            stripped). chatqna assembles chunk_embeddings from there."""
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            data = {
                "initial_query": "test",
                "retrieved_docs": [
                    {"id": "d1", "text": "doc1"},
                    {"id": "d2", "text": "doc2"},
                ],
                "metadata": [
                    {"file_ids": ["f1"], "chunk_embedding": [0.1, 0.2]},
                    {"file_ids": ["f2"], "chunk_embedding": [0.3, 0.4]},
                ],
            }
            inputs = {"input": "test", "embedding": [0.5, 0.6, 0.7]}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
            ):
                result = align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            assert result["embedding"] == [0.5, 0.6, 0.7]
            assert result["chunk_embeddings"] == [[0.1, 0.2], [0.3, 0.4]]

        def test_forwards_query_embedding_from_request_when_retriever_drops_it(self):
            """The request (inputs) carries the query embedding; the retriever
            response may not echo it. align_outputs must forward inputs' embedding."""
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            data = {
                "initial_query": "test",
                "retrieved_docs": [
                    {"id": "d1", "text": "doc1"},
                    {"id": "d2", "text": "doc2"},
                ],
                "metadata": [
                    {"file_ids": ["f1"], "chunk_embedding": [0.1, 0.2]},
                    {"file_ids": ["f2"], "chunk_embedding": [0.3, 0.4]},
                ],
            }
            inputs = {"input": "test", "embedding": [0.5, 0.6, 0.7]}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
            ):
                result = align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            # Query embedding taken from the request (inputs), not lost
            assert result["embedding"] == [0.5, 0.6, 0.7]
            assert result["chunk_embeddings"] == [[0.1, 0.2], [0.3, 0.4]]

        def test_without_rerank_no_docs_adds_abstention(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            # downstream returns a node NOT starting with "rerank" → with_rerank=False
            graph = create_mock_runtime_graph(downstream_nodes=["llm_node"])
            data = {"initial_query": "test", "retrieved_docs": [], "metadata": []}
            inputs = {"text": "test"}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
                patch("chatqna.genieai_chatqna.CHATQNA_ENFORCE_ABSTENTION", "true"),
                patch("chatqna.genieai_chatqna.CHATQNA_ABSTENTION_INSTRUCTIONS", None),
            ):
                result = align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            # Default built-in instructs the LLM to disclose the ungrounded
            # origin of any training-data fill-in; the header
            # "[No Relevant Documents Found]" is the pin.
            assert "no relevant documents found" in result["inputs"].lower()

        def test_chunk_mode_file_id_pairing(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            data = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": "doc1"}, {"id": "d2", "text": "doc2"}],
                "metadata": [{"file_ids": ["f1", "f2"]}],
            }
            inputs = {}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
            ):
                result = align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            assert result["file_id_pairs"]["d1"] == "f1"
            assert result["file_id_pairs"]["d2"] == "f2"

        def test_node_mode_file_id_pairing(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            related_text = "some text\n------\nRELATED INFORMATION:\n------\nrelated info"
            data = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": related_text}, {"id": "d2", "text": "no related"}],
                "metadata": [{"file_ids": ["f1"]}],
            }
            inputs = {}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "node"),
            ):
                result = align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            assert result["file_id_pairs"]["d1"] == "f1"

        def test_invalid_search_start_logs_error(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            data = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": "doc1"}],
                "metadata": [{"file_ids": ["f1"]}],
            }
            inputs = {"text": "test"}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "invalid"),
                patch("chatqna.genieai_chatqna.logger") as mock_logger,
            ):
                align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            # The error should be logged
            mock_logger.error.assert_called_once()
            assert "invalid" in mock_logger.error.call_args[0][0]

        def test_empty_docs_with_rerank_deletes_rerank_node(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            graph.downstream.side_effect = lambda node: {
                "retriever_node": ["rerank_node"],
                "rerank_node": ["llm_node"],
            }.get(node, [])
            data = {
                "initial_query": "test",
                "retrieved_docs": [],
                "metadata": [],
            }
            inputs = {"text": "test"}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
            ):
                align_outputs(
                    self_mock,
                    data,
                    "retriever_node",
                    inputs,
                    graph,
                    llm_params,
                )
            graph.delete_node_if_exists.assert_called()
            graph.add_edge.assert_called_with("retriever_node", "llm_node")

    # --- RERANK ---
    class TestRerankOutput:
        def test_builds_reranked_docs_with_scores(self):
            self_mock = MagicMock()
            self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
            data = {"reranked_docs": [{"text": "doc1", "score": 0.95}, {"text": "doc2", "score": 0.80}]}
            inputs = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": "doc1"}, {"id": "d2", "text": "doc2"}],
            }
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "rerank_node", inputs, MagicMock(), llm_params)
            assert "inputs" in result
            assert "Retrieved Document" in result["inputs"]
            assert len(result["retrieved_docs"]) == 2

        def test_empty_docs_enforces_abstention(self):
            self_mock = MagicMock()
            self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
            data = {"reranked_docs": []}
            inputs = {"initial_query": "test", "retrieved_docs": []}
            llm_params = {}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.CHATQNA_ENFORCE_ABSTENTION", "true"),
                patch("chatqna.genieai_chatqna.CHATQNA_ABSTENTION_INSTRUCTIONS", None),
            ):
                result = align_outputs(self_mock, data, "rerank_node", inputs, MagicMock(), llm_params)
            # Default built-in instructs the LLM to disclose the ungrounded
            # origin of any training-data fill-in; the header
            # "[No Relevant Documents Found]" is the pin.
            assert "no relevant documents found" in result["inputs"].lower()

        def test_documents_format_rerank_output(self):
            self_mock = MagicMock()
            self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
            # Format 2: data["documents"] is a list of plain-text strings
            data = {"documents": ["doc from reranker service"]}
            inputs = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": "original text"}],
            }
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "rerank_node", inputs, MagicMock(), llm_params)
            assert "inputs" in result
            assert len(result["retrieved_docs"]) == 1
            assert result["retrieved_docs"][0]["text"] == "doc from reranker service"

        def test_list_format_tei_rerank_output(self):
            self_mock = MagicMock()
            self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
            # Format 3: raw TEI list output with index referencing input documents
            data = [{"index": 0, "score": 0.92}]
            inputs = {
                "initial_query": "test",
                "documents": [{"id": "d1", "text": "original text"}],
            }
            llm_params = {}
            reranker_params = MagicMock()
            reranker_params.top_n = 2
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(
                    self_mock, data, "rerank_node", inputs, MagicMock(), llm_params, reranker_parameters=reranker_params
                )
            assert "inputs" in result
            assert len(result["retrieved_docs"]) == 1
            assert result["retrieved_docs"][0]["score"] == 0.92

    # --- LLM ---
    class TestLlmOutput:
        def test_non_streaming_extracts_text(self):
            self_mock = MagicMock()
            self_mock.services = {
                "llm_node": create_mock_service_node(
                    FakeServiceType.LLM,
                )
            }
            self_mock.services["llm_node"].endpoint = "/v1/chat/completions"
            data = {"choices": [{"message": {"content": "Generated response"}}]}
            inputs = {}
            llm_params = {"stream": False}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "llm_node", inputs, MagicMock(), llm_params)
            assert result["text"] == "Generated response"

        def test_streaming_passes_data_unchanged(self):
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            self_mock.services["llm_node"].endpoint = "/v1/chat/completions"
            data = {"raw": "streaming data"}
            inputs = {}
            llm_params = {"stream": True}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "llm_node", inputs, MagicMock(), llm_params)
            assert result == data


# ===========================================================================
# Bundled-dict path: align_outputs consumes from genie_params dict
# ===========================================================================
class TestAlignOutputsBundledDict:
    """Verify align_outputs extracts values from the bundled genie_params dict.

    v1.5 re-graft: the 6 custom kwargs are packed into one ``genie_params``
    dict at the ``schedule()`` call site. These tests call ``align_outputs``
    with the bundled dict (not flat kwargs) and assert the handlers extract
    values from the dict — closing the verification gap where the existing
    mocked suite only exercises the flat-kwargs fallback.
    """

    def test_rerank_extracts_reranker_parameters_from_dict(self):
        """RERANK branch reads reranker_parameters from genie_params dict.

        The raw TEI output path (data is a list) uses reranker_parameters.top_n
        to slice the results. This test verifies the bundled dict path works.
        """
        self_mock = MagicMock()
        self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
        # Raw TEI output: list of {index, score} dicts
        data = [
            {"index": 0, "score": 0.9},
            {"index": 1, "score": 0.8},
            {"index": 2, "score": 0.7},
        ]
        # The RERANK branch reads original docs from inputs["documents"] (raw TEI path)
        inputs = {
            "documents": [
                {"text": "doc0", "id": "id0"},
                {"text": "doc1", "id": "id1"},
                {"text": "doc2", "id": "id2"},
            ],
            "retrieved_docs": [
                {"text": "doc0", "id": "id0"},
                {"text": "doc1", "id": "id1"},
                {"text": "doc2", "id": "id2"},
            ],
            "initial_query": "query",
        }
        reranker_params = MagicMock()
        reranker_params.top_n = 2
        llm_params = {}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna._emit_reranker_selection_span"),
        ):
            result = align_outputs(
                self_mock,
                data,
                "rerank_node",
                inputs,
                MagicMock(),
                llm_params,
                genie_params={"reranker_parameters": reranker_params},
            )
        # top_n=2 slices the first 2 docs
        assert len(result["retrieved_docs"]) == 2
        assert result["retrieved_docs"][0]["text"] == "doc0"
        assert result["retrieved_docs"][1]["text"] == "doc1"


# ===========================================================================
# Task 8: Test align_generator() — SSE streaming
# ===========================================================================
class TestAlignGenerator:
    def _run_generator(self, gen):
        """Collect all yielded values from a generator."""
        return list(gen)

    def test_standard_sse_chunks(self):
        chunks = [
            b'data:{"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            b'data:{"choices":[{"delta":{"content":" world"}}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        assert any(b"Hello" in r.encode() for r in result)
        assert any(b"world" in r.encode() for r in result)
        assert result[-1] == "data: [DONE]\n\n"

    def test_ops_format_chunks(self):
        chunks = [
            b'data:{"ops":[{"op":"replace","value":"ops content"}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        assert any(b"ops content" in r.encode() for r in result)
        assert result[-1] == "data: [DONE]\n\n"

    def test_yields_done_as_final_chunk(self):
        chunks = [b'data:{"choices":[{"delta":{"content":"Hi"}}]}\n\n']
        result = self._run_generator(align_generator(None, gen=chunks))
        assert result[-1] == "data: [DONE]\n\n"

    def test_malformed_json_fallback(self):
        chunks = [b"data: this is not json\n\n"]
        result = self._run_generator(align_generator(None, gen=chunks))
        assert len(result) == 2  # fallback + DONE
        assert result[-1] == "data: [DONE]\n\n"

    def test_empty_bytes_chunks(self):
        chunks = [b"", b'data:{"choices":[{"delta":{"content":"X"}}]}\n\n']
        result = self._run_generator(align_generator(None, gen=chunks))
        assert any(b"X" in r.encode() for r in result)
        assert result[-1] == "data: [DONE]\n\n"

    def _assert_stream(self, result, *contains, excludes=()):
        """Shared coda for the frame-routing tests: every expected fragment is
        present in the decoded stream, every excluded one absent, and the
        terminal [DONE] closes the stream."""
        joined = "".join(result)
        excludes = (excludes,) if isinstance(excludes, str) else tuple(excludes)
        for text in contains:
            assert text in joined
        for text in excludes:
            assert text not in joined
        assert result[-1] == "data: [DONE]\n\n"

    def test_usage_only_frame_dropped_from_stream(self):
        """vLLM's terminal usage-only chunk (choices:[] + usage) is transport
        metadata: it feeds the llm.invoke span, never the user-visible stream."""
        usage_frame = (
            '{"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,'
            '"model":"m","choices":[],"usage":{"prompt_tokens":1,"total_tokens":2},'
            '"system_fingerprint":"vllm-0.29.0-nohash"}'
        )
        chunks = [
            b'data:{"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            ("data:" + usage_frame + "\n\n").encode("utf-8"),
            b'data:{"choices":[{"delta":{"content":" world"}}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        self._assert_stream(result, "Hello", " world", excludes="chat.completion.chunk")

    def test_parsed_frame_without_content_is_not_forwarded_raw(self):
        """A frame that PARSES but carries no forwardable content (e.g. a
        keepalive with "choices": null) must be skipped, not dumped on the
        user as raw transport JSON — the fallback below json.loads is for
        UNPARSEABLE lines only."""
        chunks = [
            b'data:{"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            b'data:{"choices": null}\n\n',
            b'data:{"choices": [{"delta": null}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        self._assert_stream(result, "Hi", excludes=('"choices": null', '"delta": null'))

    def test_content_frame_carrying_usage_still_forwards_content(self):
        """Provider variants exist that attach usage to the LAST content chunk:
        the usage key must not disqualify a frame with non-empty choices."""
        chunk = (
            b'data:{"choices":[{"delta":{"content":"tail"},"finish_reason":"stop"}],'
            b'"usage":{"prompt_tokens":10,"total_tokens":12}}\n\n'
        )
        result = self._run_generator(align_generator(None, gen=[chunk]))
        self._assert_stream(result, "tail")

    def test_content_null_frame_does_not_kill_the_stream(self):
        """The OpenAI tool-call delta shape carries "content": null. Key
        presence alone would route it into .encode on None — the skip path
        must degrade, never tear down a live answer mid-stream."""
        chunks = [
            b'data:{"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            b'data:{"choices":[{"delta":{"content": null}}]}\n\n',
            b'data:{"choices":[{"delta":{"content":"ok"}}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        self._assert_stream(result, "Hi", "ok", excludes='"content": null')

    def test_lone_surrogate_content_does_not_kill_the_stream(self):
        """A JSON \\ud800 escape parses to a lone surrogate; the text is
        forwarded lossily (str.encode's replacement marker '?'), the stream
        survives."""
        chunks = [
            b'data:{"choices":[{"delta":{"content":"\\ud800"}}]}\n\n',
            b'data:{"choices":[{"delta":{"content":"after"}}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        self._assert_stream(result, "after", "b'?'\n\n")

    def test_upstream_error_object_frame_is_skipped_not_leaked(self):
        """A parsed upstream error frame carries no forwardable content: it is
        skipped (diagnostics, not raw JSON in the answer) and the stream
        survives to [DONE]."""
        chunks = [
            b'data:{"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            b'data:{"error": {"message": "Model overloaded"}}\n\n',
            b'data:{"choices":[{"delta":{"content":"ok"}}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        self._assert_stream(result, "Hi", "ok", excludes="Model overloaded")

    def test_content_parts_array_frame_forwards_joined_text(self):
        """A provider streaming text as OpenAI content parts must not lose the
        answer: the parts are joined and forwarded."""
        chunk = (
            b'data:{"choices":[{"delta":{"content":[{"type":"text","text":"par"},{"type":"text","text":"tial"}]}}]}\n\n'
        )
        result = self._run_generator(align_generator(None, gen=[chunk]))
        self._assert_stream(result, "partial")

    def test_undecodable_upstream_bytes_do_not_kill_the_stream(self):
        """Invalid UTF-8 in an upstream line decodes lossily (one replacement
        character per bad byte); the text still routes to the user and the
        stream survives."""
        chunks = [
            b'data:{"choices":[{"delta":{"content":"caf\xe9"}}]}\n\n',
            b'data:{"choices":[{"delta":{"content":" after"}}]}\n\n',
        ]
        result = self._run_generator(align_generator(None, gen=chunks))
        self._assert_stream(result, " after", "\\xef\\xbf\\xbd")


# ===========================================================================
# Task 9: Test ChatQnAService initialization and service graph
# ===========================================================================
class TestChatQnAServiceInit:
    def test_init_monkey_patches_align_methods(self):
        with patch("chatqna.genieai_chatqna.ServiceOrchestrator") as mock_orch:
            svc = ChatQnAService(host="0.0.0.0", port=9999)
            assert mock_orch.align_inputs == align_inputs
            assert mock_orch.align_outputs == align_outputs
            assert mock_orch.align_generator == align_generator
            assert svc.host == "0.0.0.0"
            assert svc.port == 9999
            assert svc.user_profile_client is not None

    def test_add_remote_service_creates_correct_graph(self):
        with (
            patch("chatqna.genieai_chatqna.ServiceOrchestrator") as mock_orch,
            patch("chatqna.genieai_chatqna.MicroService") as mock_ms,
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
        ):
            mock_orch_instance = MagicMock()
            mock_orch_instance.add.return_value = mock_orch_instance  # chainable
            mock_orch.return_value = mock_orch_instance

            svc = ChatQnAService()
            svc.add_remote_service()

            # Graph structure: embedding → retriever → rerank → llm
            assert mock_orch_instance.add.call_count == 4
            assert mock_orch_instance.flow_to.call_count == 3

            # Verify each MicroService is constructed with the correct kwargs
            add_kwargs = [call[1] for call in mock_ms.call_args_list if call[1]]
            assert len(add_kwargs) == 4

            # 1. embedding
            assert add_kwargs[0]["name"] == "embedding"
            assert add_kwargs[0]["use_remote_service"] is True
            assert add_kwargs[0]["service_type"] == FakeServiceType.EMBEDDING
            assert add_kwargs[0]["endpoint"] is not None

            # 2. retriever
            assert add_kwargs[1]["name"] == "retriever"
            assert add_kwargs[1]["use_remote_service"] is True
            assert add_kwargs[1]["service_type"] == FakeServiceType.RETRIEVER
            assert add_kwargs[1]["endpoint"] == "/v1/retrieval"

            # 3. rerank
            assert add_kwargs[2]["name"] == "rerank"
            assert add_kwargs[2]["use_remote_service"] is True
            assert add_kwargs[2]["service_type"] == FakeServiceType.RERANK
            assert add_kwargs[2]["endpoint"] == "/v1/reranking"

            # 4. llm
            assert add_kwargs[3]["name"] == "llm"
            assert add_kwargs[3]["use_remote_service"] is True
            assert add_kwargs[3]["service_type"] == FakeServiceType.LLM
            assert add_kwargs[3]["endpoint"] == "/v1/chat/completions"

    def test_add_remote_service_without_rerank(self):
        with (
            patch("chatqna.genieai_chatqna.ServiceOrchestrator") as mock_orch,
            patch("chatqna.genieai_chatqna.MicroService") as mock_ms,
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
        ):
            mock_orch_instance = MagicMock()
            mock_orch_instance.add.return_value = mock_orch_instance  # chainable
            mock_orch.return_value = mock_orch_instance

            svc = ChatQnAService()
            svc.add_remote_service_without_rerank()

            # Graph structure: embedding → retriever → llm (no rerank)
            assert mock_orch_instance.add.call_count == 3
            assert mock_orch_instance.flow_to.call_count == 2

            # Verify each MicroService is constructed with the correct kwargs
            add_kwargs = [call[1] for call in mock_ms.call_args_list if call[1]]
            assert len(add_kwargs) == 3

            # 1. embedding
            assert add_kwargs[0]["name"] == "embedding"
            assert add_kwargs[0]["use_remote_service"] is True
            assert add_kwargs[0]["service_type"] == FakeServiceType.EMBEDDING
            assert add_kwargs[0]["endpoint"] is not None

            # 2. retriever
            assert add_kwargs[1]["name"] == "retriever"
            assert add_kwargs[1]["use_remote_service"] is True
            assert add_kwargs[1]["service_type"] == FakeServiceType.RETRIEVER
            assert add_kwargs[1]["endpoint"] == "/v1/retrieval"

            # 3. llm (no rerank in between)
            assert add_kwargs[2]["name"] == "llm"
            assert add_kwargs[2]["use_remote_service"] is True
            assert add_kwargs[2]["service_type"] == FakeServiceType.LLM
            assert add_kwargs[2]["endpoint"] == "/v1/chat/completions"

    def _run_graph_builder(self, method_name):
        """Run one add_remote_service* variant and return (services, flow_edges).

        Captures the graph the consolidated ``_build_rag_graph`` produces for a
        given public wrapper, asserting the same node set + ``flow_to`` edges
        the pre-cleanup variants built (AC4 — graph equivalence, asserted).

        MicroService is patched with a side_effect so each construction returns
        a DISTINCT instance carrying the real ``name`` (``MagicMock(name=...)``
        would instead set the mock's own name and share one return_value).
        """
        with (
            patch("chatqna.genieai_chatqna.ServiceOrchestrator") as mock_orch,
            patch("chatqna.genieai_chatqna.MicroService") as mock_ms,
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
        ):
            built = []

            def _microservice(**kwargs):
                svc = MagicMock()
                svc.name = kwargs.get("name")
                built.append(svc)
                return svc

            mock_ms.side_effect = _microservice

            mock_orch_instance = MagicMock()
            mock_orch_instance.add.return_value = mock_orch_instance  # chainable
            mock_orch.return_value = mock_orch_instance

            svc = ChatQnAService()
            getattr(svc, method_name)()

            nodes = [svc.name for svc in built]
            edges = [(call[0][0].name, call[0][1].name) for call in mock_orch_instance.flow_to.call_args_list]
            return nodes, edges

    def test_faqgen_graph_equivalent_to_full(self):
        """AC4: faqgen mode builds the SAME graph shape as the full graph, only
        the LLM endpoint differs (/v1/faqgen vs /v1/chat/completions)."""
        full_nodes, full_edges = self._run_graph_builder("add_remote_service")
        faqgen_nodes, faqgen_edges = self._run_graph_builder("add_remote_service_faqgen")

        assert faqgen_nodes == full_nodes  # embedding, retriever, rerank, llm
        assert faqgen_edges == full_edges  # emb→ret→rerank→llm

        # Endpoint differs — the one sanctioned axis of variation.
        self._assert_faqgen_endpoint()

    def _assert_faqgen_endpoint(self):
        with (
            patch("chatqna.genieai_chatqna.ServiceOrchestrator") as mock_orch,
            patch("chatqna.genieai_chatqna.MicroService") as mock_ms,
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
        ):
            mock_orch_instance = MagicMock()
            mock_orch.return_value = mock_orch_instance
            svc = ChatQnAService()
            svc.add_remote_service_faqgen()
            add_kwargs = [call[1] for call in mock_ms.call_args_list if call[1]]
            llm = next(k for k in add_kwargs if k["name"] == "llm")
            assert llm["endpoint"].endswith("/v1/faqgen")

    def test_without_translation_alias_builds_full_graph(self):
        """AC4: the without_translation alias produces the same graph as
        add_remote_service (translation is not a graph node)."""
        full_nodes, full_edges = self._run_graph_builder("add_remote_service")
        alias_nodes, alias_edges = self._run_graph_builder("add_remote_service_without_translation")
        assert alias_nodes == full_nodes
        assert alias_edges == full_edges

    def test_genieai_alias_builds_full_graph(self):
        """AC4: the genieai alias produces the same graph as add_remote_service."""
        full_nodes, full_edges = self._run_graph_builder("add_remote_service")
        alias_nodes, alias_edges = self._run_graph_builder("add_remote_service_genieai")
        assert alias_nodes == full_nodes
        assert alias_edges == full_edges

    def test_find_node_key_finds_match(self):
        svc = create_chatqna_service()
        result_dict = {"embedding_service": "data1", "retriever_service": "data2"}
        key = svc._find_node_key("retriever", result_dict)
        assert key == "retriever_service"

    def test_find_node_key_returns_none(self):
        svc = create_chatqna_service()
        result_dict = {"embedding_service": "data1"}
        assert svc._find_node_key("rerank", result_dict) is None


# ===========================================================================
# Task 10: Test translation helpers
# ===========================================================================
class TestTranslationHelpers:
    def test_build_translategemma_prompt(self):
        svc = create_chatqna_service()
        prompt = svc._build_translategemma_prompt(
            text="Hello",
            source_lang_code="en",
            target_lang_code="fr",
        )
        assert "<bos>" in prompt
        assert "<start_of_turn>" in prompt
        assert "<end_of_turn>" in prompt
        assert "Hello" in prompt
        assert "French" in prompt

    def test_read_language_registry_file_error(self):
        # The well-formed/ malformed parse cases live with the language
        # boundary suite (TestLanguageMapShape); this pins the missing-file
        # path it does not cover.
        result = chatqna_module._read_language_registry("/nonexistent/path.json")
        assert result == {}

    def test_split_text_into_chunks_short_text(self):
        svc = create_chatqna_service()
        result = svc._split_text_into_chunks("Short text", max_chars=2000)
        assert len(result) == 1
        assert result[0] == "Short text"

    def test_split_text_into_chunks_splits_at_sentences(self):
        svc = create_chatqna_service()
        text = "First sentence. Second sentence. Third sentence."
        result = svc._split_text_into_chunks(text, max_chars=30)
        assert len(result) > 1

    @pytest.mark.asyncio
    async def test_get_translated_history_string_with_string(self):
        svc = create_chatqna_service()
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"message": {"content": "Translated"}}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "test-model"),
        ):
            result = await svc._get_translated_history_string("Hello world")
        assert "Translated" in result

    @pytest.mark.asyncio
    async def test_get_translated_history_string_with_list(self):
        svc = create_chatqna_service()
        history = [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi there"}]
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"message": {"content": "Translated history"}}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "test-model"),
        ):
            result = await svc._get_translated_history_string(history)
        assert "Translated history" in result

    @pytest.mark.asyncio
    async def test_translation_budget_derived_from_discovered_window(self):
        """8192-token translation window → 11520-char budget: both messages are
        forwarded where the stale 2000-char budget dropped the oldest one."""
        svc = create_chatqna_service()
        history = [
            {"role": "user", "content": "A" * 2500},
            {"role": "assistant", "content": "B" * 500},
        ]
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"message": {"content": "Translated history"}}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        models_resp = MagicMock()
        models_resp.json.return_value = {"data": [{"id": "gemma", "max_model_len": 8192}]}
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna._TRANSLATION_DISCOVERY_ENDPOINT", "https://gpu-host/translation"),
            patch("httpx.get", return_value=models_resp),
        ):
            await svc._get_translated_history_string(history)

        sent_prompt = mock_client.post.call_args.kwargs["json"]["messages"][0]["content"]
        assert "AAAA" in sent_prompt  # oldest message forwarded
        assert "BBBB" in sent_prompt  # newest message forwarded

    @pytest.mark.asyncio
    async def test_translation_dropped_messages_reported(self):
        """Messages dropped by the translation budget are counted and attributed."""
        svc = create_chatqna_service()
        history = [
            {"role": "user", "content": "KEEPME-xx"},
            {"role": "assistant", "content": "DROPME-yyyyyyyyyyyyyyyyyyyy"},
        ]
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"message": {"content": "Translated history"}}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna.MAX_TRANSLATION_CHARS", 70),
            patch("chatqna.genieai_chatqna.history_truncation_total") as mock_counter,
        ):
            await svc._get_translated_history_string(history)

        sent_prompt = mock_client.post.call_args.kwargs["json"]["messages"][0]["content"]
        assert "DROPME" in sent_prompt  # newest kept
        assert "KEEPME" not in sent_prompt  # oldest dropped
        mock_counter.add.assert_called_once()
        # Counts stay in the warning log; metric attributes stay low-cardinality.
        assert mock_counter.add.call_args.args[1] == {"path": "translation"}

    @pytest.mark.asyncio
    async def test_translategemma_output_cap_fits_discovered_window(self):
        """The TranslateGemma payload's max_tokens is clamped so prompt estimate +
        completion cannot exceed the discovered window (else vLLM rejects the
        whole request and the history goes back untranslated)."""
        svc = create_chatqna_service()
        history = [
            {"role": "user", "content": "A" * 4000},
            {"role": "assistant", "content": "B" * 4000},
        ]
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"text": "Translated"}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        models_resp = MagicMock()
        models_resp.json.return_value = {"data": [{"id": "gemma", "max_model_len": 6144}]}
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=True),
            patch("chatqna.genieai_chatqna.TRANSLATION_COMPLETIONS_URL", "http://localhost/v1/completions"),
            patch("chatqna.genieai_chatqna._TRANSLATION_DISCOVERY_ENDPOINT", "https://gpu-host/translation"),
            patch("httpx.get", return_value=models_resp),
        ):
            await svc._get_translated_history_string(history)

        payload = mock_client.post.call_args.kwargs["json"]
        # Both messages survive the char-budget filter (8028 ≤ 8448). Flattened
        # prompt ≈ 8028 chars → ~2676 tokens at 3 chars/token; the output cap is
        # clamped to 6144 − 512 (prompt wrapper) − 2676 = 2956, below the len//2
        # base ceiling that would overflow a 6144-token window.
        assert payload["max_tokens"] == 2956

    @pytest.mark.asyncio
    async def test_small_window_still_translates_tiny_history(self):
        """A tiny history on a small (1024-token) window fits comfortably: the
        cap is clamped to the room left (1024 − 512 − ~109 = ~147) and the
        translation RUNS — the old fixed 512-token floor disabled it forever."""
        svc = create_chatqna_service()
        history = [
            {"role": "user", "content": "A" * 150},
            {"role": "assistant", "content": "B" * 150},
        ]
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"message": {"content": "Translated"}}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        models_resp = MagicMock()
        models_resp.json.return_value = {"data": [{"id": "gemma", "max_model_len": 1024}]}
        mock_response.json.return_value = {"choices": [{"text": "Translated"}]}
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=True),
            patch("chatqna.genieai_chatqna.TRANSLATION_COMPLETIONS_URL", "http://localhost/v1/completions"),
            patch("chatqna.genieai_chatqna._TRANSLATION_DISCOVERY_ENDPOINT", "https://gpu-host/translation"),
            patch("httpx.get", return_value=models_resp),
        ):
            result = await svc._get_translated_history_string(history)

        assert result == ("Translated", "translated")
        payload = mock_client.post.call_args.kwargs["json"]
        # flattened ≈ 328 chars → ~109 prompt tokens; base cap floor 512
        # clamped to the room left: 1024 − 512 − 109 = 403
        assert payload["max_tokens"] == 403

    @pytest.mark.asyncio
    async def test_translation_skipped_when_budget_fits_no_message(self):
        """A budget smaller than the newest message drops everything: no empty
        prompt is sent to the translation model (its junk reply would become
        the next prompt's chat history) — the result is an empty history."""
        svc = create_chatqna_service()
        history = [{"role": "user", "content": "X" * 600}]
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=MagicMock())
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna._TRANSLATION_DISCOVERY_ENDPOINT", "https://gpu-host/translation"),
            patch("httpx.get", return_value=MagicMock(json=lambda: {"data": [{"id": "m", "max_model_len": 768}]})),
        ):
            result = await svc._get_translated_history_string(history)

        assert result == ("", "fallback_error")  # nothing survived the budget: empty history, flagged fallback
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_translate_chunk_in_language_translategemma_format(self):
        svc = create_chatqna_service()
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"text": "Bonjour"}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=True),
            patch("chatqna.genieai_chatqna.TRANSLATION_COMPLETIONS_URL", "http://localhost/v1/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "translategemma-test"),
        ):
            result = await svc._translate_chunk_in_language("Hello", "fr", "French")
        assert result == "Bonjour"

    @pytest.mark.asyncio
    async def test_translate_chunk_in_language_generic_format(self):
        svc = create_chatqna_service()
        mock_response = MagicMock()
        mock_response.json.return_value = {"choices": [{"message": {"content": "Hola"}}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "test-model"),
        ):
            result = await svc._translate_chunk_in_language("Hello", "es", "Spanish")
        assert result == "Hola"

    @pytest.mark.asyncio
    async def test_translate_chunk_in_language_context_overflow_raises_typed(self):
        """vLLM context overflow on translation raises TranslationInputTooLongError
        instead of silently returning the English source (multilingual UX issue #829)."""
        from chatqna.genieai_chatqna import TranslationInputTooLongError

        svc = create_chatqna_service()
        with (
            patch(
                "chatqna.genieai_chatqna.httpx.AsyncClient",
                side_effect=Exception(
                    "HTTP 400: BadRequestError - context length exceeded (max 2048 tokens). "
                    "Please reduce the length of the input."
                ),
            ),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            pytest.raises(TranslationInputTooLongError),
        ):
            await svc._translate_chunk_in_language("x" * 10000, "fr", "French")

    @pytest.mark.asyncio
    async def test_translate_chunk_in_language_classifier_matches_live_httpx_shape(self):
        """Reviewer Finding 1+2 regression: production exception is `httpx.HTTPStatusError`
        whose `str()` is JUST the status phrase — the body lives on `.response.text`.
        The classifier must read the body, not just `str(exc)`. Construct a real
        `httpx.HTTPStatusError` so this test fails fast if `_overflow_message_from_exc`
        regresses to a str()-only check.
        """
        import json as _json

        import httpx as _httpx

        from chatqna.genieai_chatqna import TranslationInputTooLongError

        svc = create_chatqna_service()

        # Real httpx response body shape — same as granite-4.1-8b vLLM emits.
        _body = _json.dumps(
            {
                "error": {
                    "message": "This model's maximum context length is 65536 tokens. "
                    "However, you requested 160 output tokens and your prompt contains "
                    "at least 65437 input tokens, for a total of at least 65597 tokens. "
                    "Please reduce the length of the input prompt."
                }
            }
        ).encode()

        # Build a real httpx.HTTPStatusError — `str()` shows ONLY the status phrase,
        # NOT the body. Body lives on `.response.text`.
        _req = _httpx.Request("POST", "http://localhost/v1/chat/completions")
        _resp = _httpx.Response(400, content=_body, request=_req)
        _exc = _httpx.HTTPStatusError(
            "Client error '400 Bad Request' for url 'http://localhost/v1/chat/completions'",
            request=_req,
            response=_resp,
        )

        # Sanity: the bug WAS here. str(_exc) does NOT contain "context length".
        assert "context length" not in str(_exc).lower()

        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", side_effect=_exc),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            pytest.raises(TranslationInputTooLongError),
        ):
            await svc._translate_chunk_in_language("x" * 10000, "fr", "French")

    @pytest.mark.asyncio
    async def test_finalize_llm_response_propagates_translation_overflow(self):
        """Regression (reviewer note 71785): `_finalize_llm_response`'s outer
        `except Exception` previously swallowed `TranslationInputTooLongError`,
        returning the English source text. The narrowed catch must re-raise."""
        from chatqna.genieai_chatqna import TranslationInputTooLongError

        svc = create_chatqna_service()
        # Patch _translate_with_chunking (or its callee) to raise the typed
        # exception. With the swallow in place this returns the original; with
        # the fix it re-raises.
        with (
            patch.object(
                svc,
                "_translate_with_chunking",
                new=AsyncMock(side_effect=TranslationInputTooLongError("overflow")),
            ),
            pytest.raises(TranslationInputTooLongError),
        ):
            await svc._finalize_llm_response(
                "original English response body",
                original_language="es",  # non-EN triggers translation path
            )

    @pytest.mark.asyncio
    async def test_translate_with_chunking(self):
        svc = create_chatqna_service()
        call_count = 0
        languages = set()

        async def mock_translate(chunk, canonical_code, target_lang, source_lang_code="en"):
            nonlocal call_count
            call_count += 1
            languages.add((canonical_code, target_lang))
            return f"translated_chunk_{call_count}"

        with (
            patch.object(svc, "_split_text_into_chunks", return_value=["chunk1", "chunk2"]),
            patch.object(svc, "_translate_chunk_in_language", side_effect=mock_translate),
        ):
            result = await svc._translate_with_chunking("long text", "fr")
        assert "translated_chunk_1" in result
        assert "translated_chunk_2" in result
        # The language is resolved once for the whole document: every chunk is
        # written in the language the map named.
        assert languages == {("fr", "French")}


class TestQueryTranslationStatus:
    """`_get_translated_history_string` must report what the embedder received.

    The history translation is normalized for the retriever and never shown to
    the user, so a failed translation falls back to the flattened source text
    instead of failing the turn — but a fallback the caller cannot distinguish
    from a translation degrades retrieval silently (the untranslated source is
    embedded into an English space). The status says which one it was.
    """

    @staticmethod
    def _mock_client(side_effect=None, content="Translated history", completions=False):
        mock_response = MagicMock()
        if completions:
            mock_response.json.return_value = {"choices": [{"text": content}]}
        else:
            mock_response.json.return_value = {"choices": [{"message": {"content": content}}]}
        mock_response.raise_for_status = MagicMock()
        mock_client = AsyncMock()
        if side_effect is not None:
            mock_client.post = AsyncMock(side_effect=side_effect)
        else:
            mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        return mock_client

    SPANISH_HISTORY = [{"role": "user", "content": "qué es X?"}]

    def _translation_patches(self, mock_client, translategemma=False):
        # ExitStack: `with` takes no star-unpacking, and the patches live in a
        # helper so each test states only what it varies. The TranslateGemma
        # payload branch posts to the completions endpoint; the generic branch
        # to the chat-completions one. Window derivation stays per-test (the
        # live discovery probe and a patched window are different mechanisms).
        stack = contextlib.ExitStack()
        for p in (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", return_value=mock_client),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=translategemma),
            patch(
                "chatqna.genieai_chatqna."
                + ("TRANSLATION_COMPLETIONS_URL" if translategemma else "TRANSLATION_LLM_URL"),
                "http://localhost/v1/completions" if translategemma else "http://localhost/v1/chat/completions",
            ),
        ):
            stack.enter_context(p)
        return stack

    @pytest.mark.asyncio
    async def test_a_translated_history_reports_translated(self):
        svc = create_chatqna_service()
        mock_client = self._mock_client(content="USER: what is X?")
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string(self.SPANISH_HISTORY)
        assert text == "USER: what is X?"
        assert status == "translated"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "timeout",
        [
            pytest.param("httpx", id="httpx_timeout"),
            pytest.param("builtin", id="builtin_timeout"),
        ],
    )
    async def test_a_timeout_reports_fallback_timeout_and_returns_the_source(self, timeout):
        """The issue's headline path: the translation service times out, the
        flattened Spanish history goes to the embedder, and the caller can
        tell it from a translation. Both timeout flavours count."""
        import httpx

        svc = create_chatqna_service()
        error = httpx.TimeoutException("timed out") if timeout == "httpx" else TimeoutError("timed out")
        mock_client = self._mock_client(side_effect=error)
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string(self.SPANISH_HISTORY)
        assert text == "USER: qué es X?"  # the flattened, UNTRANSLATED source
        assert status == "fallback_timeout"

    @pytest.mark.asyncio
    async def test_a_generic_error_reports_fallback_error_and_returns_the_source(self):
        svc = create_chatqna_service()
        mock_client = self._mock_client(side_effect=RuntimeError("the model is unreachable"))
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string(self.SPANISH_HISTORY)
        assert text == "USER: qué es X?"
        assert status == "fallback_error"

    @pytest.mark.asyncio
    async def test_a_single_message_failure_reports_fallback_error(self):
        """Single-message mode must not report `translated` for a swallowed
        failure: it goes through the chunk translator, which raises, and the
        source text is the fallback. Drives the real translator under a
        mocked transport, so a drift at the wrap site fails this test."""
        svc = create_chatqna_service()
        mock_client = self._mock_client(side_effect=RuntimeError("the model is unreachable"))
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string("¿qué es X?", source_lang_code="es")
        assert text == "¿qué es X?"
        assert status == "fallback_error"

    @pytest.mark.asyncio
    async def test_a_single_message_timeout_reports_fallback_timeout(self):
        """The real chain: the chunk translator raises the typed
        TranslationTimeoutError on a timeout, and the history path keeps its
        own status. Drives the real translator under a mocked transport, so
        a drift at the wrap site fails this test."""
        import httpx

        svc = create_chatqna_service()
        mock_client = self._mock_client(side_effect=httpx.TimeoutException("timed out"))
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string("¿qué es X?", source_lang_code="es")
        assert text == "¿qué es X?"
        assert status == "fallback_timeout"

    @pytest.mark.asyncio
    async def test_a_builtin_timeout_reports_fallback_timeout(self):
        """A timeout that is not httpx's own class (a socket-level or
        wait_for timeout) is still a timeout: the vocabulary separates 'the
        service was slow' from 'the service broke'."""
        svc = create_chatqna_service()
        mock_client = self._mock_client(side_effect=TimeoutError("timed out"))
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string(self.SPANISH_HISTORY)
        assert text == "USER: qué es X?"
        assert status == "fallback_timeout"

    @pytest.mark.asyncio
    async def test_an_empty_completion_reports_fallback_error(self):
        """A 200 with an empty completion is not a translation: an empty
        history would blank the retrieval query, and the status must not
        claim `translated`."""
        svc = create_chatqna_service()
        mock_client = self._mock_client(content="   ")
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string(self.SPANISH_HISTORY)
        assert text == "USER: qué es X?"
        assert status == "fallback_error"

    @pytest.mark.asyncio
    async def test_a_single_message_success_reports_translated(self):
        svc = create_chatqna_service()

        async def translate(text, canonical_code, target_lang, **_kwargs):
            return "what is X?"

        svc._translate_chunk_in_language = translate
        text, status = await svc._get_translated_history_string("¿qué es X?", source_lang_code="es")
        assert text == "what is X?"
        assert status == "translated"

    @pytest.mark.asyncio
    async def test_an_empty_single_message_is_refused_not_translated(self):
        """A blank history sent to the model would only harvest its junk
        reply as the embedded query (the chunk translator's empty check
        passes for a whitespace input): the empty-history refusal applies
        to the string shape too."""
        svc = create_chatqna_service()
        mock_client = self._mock_client(content="JUNK-FROM-EMPTY-PROMPT")
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string("  ", source_lang_code="es")
        assert text == "  "  # nothing to translate: the blank comes back
        assert status == "fallback_error"
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_blank_list_messages_are_refused_not_translated(self):
        """The same refusal on the list shape: whitespace-only messages fit
        the budget (blank content still counts chars) and would otherwise
        come back as the model's junk reply reported as a translation."""
        svc = create_chatqna_service()
        history = [
            {"role": "user", "content": "   "},
            {"role": "assistant", "content": "\n"},
        ]
        mock_client = self._mock_client(content="JUNK-FROM-EMPTY-PROMPT")
        with self._translation_patches(mock_client):
            text, status = await svc._get_translated_history_string(history)
        assert text == "USER:     |<-MSG->| ASSISTANT: \n"  # the flattened blanks
        assert status == "fallback_error"
        mock_client.post.assert_not_called()

    def test_a_window_too_tight_refuses_the_output_cap(self):
        """The TranslateGemma output-cap guard refuses a window too tight to
        translate into (cap below the input estimate): the helper returns
        None and the history-string caller maps that refusal to
        `fallback_error`."""
        svc = create_chatqna_service()
        with patch("chatqna.genieai_chatqna._get_translation_window", return_value=256):
            assert svc._translation_output_cap("A" * 3000) is None
        with patch("chatqna.genieai_chatqna._get_translation_window", return_value=6144):
            assert svc._translation_output_cap("A" * 3000) == 1500

    @pytest.mark.asyncio
    async def test_a_history_past_the_output_base_cap_is_translated_inside_the_window(self):
        """The completion ceiling scales with the discovered translation
        window: a history past the 4096 base ceiling still goes out as a
        translation request — the fixed ceiling capped the completion below
        the input past ~12k chars (their prompt estimate crossed 4096 tokens
        inside the char budget) and refused them untranslated."""
        svc = create_chatqna_service()
        history = [{"role": "user", "content": "A" * 13000}]
        mock_client = self._mock_client(content="USER: AAAA", completions=True)
        models_resp = MagicMock()
        models_resp.json.return_value = {"data": [{"id": "gemma", "max_model_len": 65536}]}
        stack = self._translation_patches(mock_client, translategemma=True)
        stack.enter_context(
            patch("chatqna.genieai_chatqna._TRANSLATION_DISCOVERY_ENDPOINT", "https://gpu-host/translation")
        )
        stack.enter_context(patch("httpx.get", return_value=models_resp))
        with stack:
            text, status = await svc._get_translated_history_string(history)
        assert status == "translated"
        # Flattened "USER: " + 13000 chars → cap len//2 = 6503, inside the
        # 65536-window allowance (65536 − 512 − 4335 = 60689).
        assert mock_client.post.call_args.kwargs["json"]["max_tokens"] == 6503
        assert text == "USER: AAAA"

    @pytest.mark.asyncio
    async def test_a_history_in_a_window_too_tight_is_still_refused_and_named(self):
        """A window too tight even after scaling (the allowance falls below
        the prompt estimate) still refuses at the caller: the history goes
        out untranslated and the status names it — scaling the ceiling must
        not turn a genuinely tight window into a doomed request."""
        svc = create_chatqna_service()
        # Seven assistant messages whose flattened length (13023 chars) sits
        # just past the half-window line on a 9193-token window: the char
        # budget (13020) admits every message while the allowance
        # (9193 − 512 − 4341 = 4340) falls one token short of the estimate.
        history = [{"role": "assistant", "content": "A" * 1840} for _ in range(7)]
        mock_client = self._mock_client()
        stack = self._translation_patches(mock_client, translategemma=True)
        stack.enter_context(patch("chatqna.genieai_chatqna._get_translation_window", return_value=9193))
        with stack:
            text, status = await svc._get_translated_history_string(history)
        assert text.startswith("ASSISTANT: AAAA")  # untranslated
        assert status == "fallback_error"
        mock_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_map_without_english_reports_fallback_error(self):
        svc = create_chatqna_service()
        stack = self._translation_patches(self._mock_client())
        stack.enter_context(patch("chatqna.genieai_chatqna.language_codes_map", return_value={}))
        with stack:
            text, status = await svc._get_translated_history_string(self.SPANISH_HISTORY)
        assert text == "USER: qué es X?"
        assert status == "fallback_error"

    @pytest.mark.asyncio
    async def test_a_message_without_content_does_not_crash_the_budget_loop(self):
        """Request validation permits a message with no content key; the
        budget loop must read it as empty, not raise."""
        svc = create_chatqna_service()
        history = [{"role": "user", "content": "qué es X?"}, {"role": "assistant"}]
        with self._translation_patches(self._mock_client(content="USER: what is X?")):
            text, status = await svc._get_translated_history_string(history)
        assert text == "USER: what is X?"
        assert status == "translated"


# ===========================================================================
# Task 11: Test fetch_file_metadata()
# ===========================================================================
class TestFetchFileMetadata:
    @pytest.mark.asyncio
    async def test_valid_file_id_and_token(self):
        svc = create_chatqna_service()
        metadata = {"success": True, "data": {"categoryLabels": "Health", "serviceLabels": ["H1"]}}
        mock_session, mock_timeout = create_mock_aiohttp_session(status=200, json_data=metadata)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await svc.fetch_file_metadata("file123", token="valid-token")
        assert result == {"categoryLabels": "Health", "serviceLabels": ["H1"]}

    @pytest.mark.asyncio
    async def test_empty_file_id_returns_default(self):
        svc = create_chatqna_service()
        result = await svc.fetch_file_metadata("", token="valid-token")
        assert result == {"categoryLabels": None, "serviceLabels": []}

    @pytest.mark.asyncio
    async def test_no_token_returns_none(self):
        """No token → return None. Caller must pass token explicitly."""
        svc = create_chatqna_service()
        result = await svc.fetch_file_metadata("file123", token=None)
        assert result is None

    @pytest.mark.asyncio
    async def test_http_error_returns_none(self):
        svc = create_chatqna_service()
        mock_session, mock_timeout = create_mock_aiohttp_session(status=500)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await svc.fetch_file_metadata("file123", token="valid-token")
        assert result is None

    @pytest.mark.asyncio
    async def test_connection_exception_returns_none(self):
        svc = create_chatqna_service()
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", side_effect=Exception("Connection refused")),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=MagicMock()),
        ):
            result = await svc.fetch_file_metadata("file123", token="valid-token")
        assert result is None


# ===========================================================================
# Test fetch_file_metadata() and get_user_profile() — per-request token threading
# ===========================================================================
class TestTokenThreading:
    """``GenieUserProfileClient`` carries no token state. Every call to
    ``get_user_profile`` must receive the validated Bearer explicitly; the
    caller (``handle_request``) forwards the token from the request's
    ``Authorization`` header."""

    @pytest.mark.asyncio
    async def test_get_user_profile_requires_token(self):
        svc = create_chatqna_service()
        result = await svc.user_profile_client.get_user_profile(token=None)
        assert result is None

    @pytest.mark.asyncio
    async def test_get_user_profile_passes_token_to_backend(self):
        svc = create_chatqna_service()
        profile = {"name": "DAVID Forden", "role": "admin"}
        mock_session, mock_timeout = create_mock_aiohttp_session(status=200, json_data=profile)
        # Capture the headers forwarded to the backend.
        captured_headers: dict[str, str] = {}
        original_get = mock_session.get

        def _capture_get(url, **kwargs):
            captured_headers.update(kwargs.get("headers") or {})
            return original_get.return_value

        mock_session.get.side_effect = _capture_get
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await svc.user_profile_client.get_user_profile(token="user-jwt-abc")
        assert captured_headers.get("Authorization") == "Bearer user-jwt-abc"
        assert result == profile


# ===========================================================================
# Test handle_request() — auth gating
# ===========================================================================
class TestHandleRequestAuth:
    """chatqna requires every call to carry a valid Bearer token. handle_request
    raises ``HTTPException(401)`` if the token is missing, malformed, or fails
    JWKS validation. The validated Bearer token is forwarded to downstream
    methods as a function argument (not stashed on ``request.state``)."""

    @pytest.mark.asyncio
    async def test_missing_authorization_header_raises_401(self):
        svc = create_chatqna_service()
        req = create_mock_request(data={"messages": []}, headers={})
        with pytest.raises(HTTPException) as exc_info:
            await svc.handle_request(req)
        assert exc_info.value.status_code == 401
        assert "Missing or malformed" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_authorization_without_bearer_prefix_raises_401(self):
        svc = create_chatqna_service()
        req = create_mock_request(data={}, headers={"Authorization": "Basic dXNlcjpwYXNz"})
        with pytest.raises(HTTPException) as exc_info:
            await svc.handle_request(req)
        assert exc_info.value.status_code == 401
        assert "Bearer scheme" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_empty_bearer_token_raises_401(self):
        svc = create_chatqna_service()
        # ``"Bearer "`` with no token → partition yields empty token.
        req = create_mock_request(data={}, headers={"Authorization": "Bearer "})
        with pytest.raises(HTTPException) as exc_info:
            await svc.handle_request(req)
        assert exc_info.value.status_code == 401
        assert "Bearer scheme" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_jwks_validation_failure_raises_401(self):
        svc = create_chatqna_service()
        req = create_mock_request(data={}, headers={"Authorization": "Bearer invalid.token.here"})
        with (
            patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value=None)),
            pytest.raises(HTTPException) as exc_info,
        ):
            await svc.handle_request(req)
        assert exc_info.value.status_code == 401
        assert "Token validation failed" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_bearer_scheme_is_case_insensitive(self):
        """RFC 7235 §2.1: auth-scheme is case-insensitive — ``bearer`` works.

        Rather than rely on ``suppress(Exception)`` (which would hide auth
        regressions), we patch ``validate_token`` to raise a sentinel the test
        recognises. The reachable sentinel proves the lowercase scheme passed
        auth and reached the JWKS validator.
        """
        from contextlib import suppress

        svc = create_chatqna_service()
        req = create_mock_request(data={}, headers={"Authorization": "bearer eyJ.fake.token"})
        validate_sentinel = AsyncMock(side_effect=Exception("REACHED_VALIDATE"))
        with (
            patch("chatqna.genieai_chatqna.validate_token", new=validate_sentinel),
            suppress(Exception),
        ):
            await svc.handle_request(req)
        validate_sentinel.assert_awaited_once_with("eyJ.fake.token")

    def test_user_profile_client_carries_no_token_state(self):
        """Invariant pinned by the CHANGELOG: GenieUserProfileClient exposes no
        ``set_token`` / ``_token`` attribute — the singleton state we removed
        to fix the cross-request leak. A future contributor who re-adds them
        trips this test."""
        client = GenieUserProfileClient()
        assert not hasattr(client, "_token")
        assert not hasattr(client, "set_token")


# ===========================================================================
# Task 12: Test _assemble_source_documents() — grounding + reranker verdict
# ===========================================================================
class TestAssembleSourceDocuments:
    """Source documents must reflect the reranker's verdict, not the retriever's
    raw cosine hits. When the reranker rejects everything, the response is flagged
    as not grounded (LLM-generated) and no documents are shown."""

    @staticmethod
    def _result_dict(
        rerank_verdict=None,
        retrieved_docs=None,
        file_id_pairs=None,
        with_reranker=True,
        provenance_by_doc=None,
    ):
        rd = {
            "retriever_service": {
                "retrieved_docs": retrieved_docs or [],
                "file_id_pairs": file_id_pairs or {},
            }
        }
        if provenance_by_doc:
            # Story 1.1 per-hit provenance as align_outputs preserves it
            # (graph_name/repo_id/concept_id keyed by orchestrator doc id).
            rd["retriever_service"]["provenance_by_doc"] = provenance_by_doc
        if with_reranker:
            # align_outputs (RERANK branch) stores the verdict under "retrieved_docs"
            # (with id + reranker score reconstructed), NOT under "reranked_docs".
            rd["rerank_service"] = {"retrieved_docs": rerank_verdict or []}
        return rd

    @pytest.mark.asyncio
    async def test_grounded_uses_reranker_verdict(self):
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["Beekeeping and Honey"], "file_name": "bee.pdf"})
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 0.95},
                {"id": "d2", "text": "honey", "score": 0.85},
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f2"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        assert grounded is True
        # Rank-weighted confidence (CONFIDENCE_RANK_DECAY default 0.5): the top doc
        # (0.95) dominates the second (0.85), so the result (~0.91) sits above the
        # flat mean (0.90) and below the top score — richer context is no longer
        # punished by a tail of lower scores.
        assert round(confidence, 2) == 0.91
        assert 0.90 < confidence < 0.95
        assert [d["document_id"] for d in docs] == ["f1", "f2"]
        assert [round(d["score"], 2) for d in docs] == [0.95, 0.85]

    @pytest.mark.asyncio
    async def test_metadata_failure_surfaces_okf_concept_source_with_real_score(self):
        """Story 1.1 (live-caught 2026-10-06): a failed doc-repo metadata lookup
        is the DESIGNED path for OKF concept chunks (file_id == concept_id —
        they resolve in okf-server, not doc-repository). The old D1 behavior
        (skip entirely) discarded all OKF ground truth and forced
        is_grounded=False on every OKF query. Now the doc is surfaced from its
        in-payload provenance with its REAL reranker score — the D1 poison
        (a fake 'error' doc / forced 0.0 in the aggregate) stays dead: no
        synthetic document, no zero injected."""
        svc = create_chatqna_service()
        # f1 metadata resolves; f2 metadata fetch fails (returns None) — but f2
        # carries OKF_ provenance, so the fallback gate admits it.
        svc.fetch_file_metadata = AsyncMock(side_effect=[{"labels": ["Beekeeping"], "file_name": "bee.pdf"}, None])
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 0.95},
                {"id": "d2", "text": "honey", "score": 0.85},
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f2"},
            provenance_by_doc={"d2": {"graph_name": "OKF_demo_v1", "repo_id": "demo", "concept_id": "f2"}},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        # Both surfaced: f1 enriched from doc-repo, f2 as an OKF concept source.
        assert [d["document_id"] for d in docs] == ["f1", "f2"]
        assert docs[0]["document_name"] == "bee.pdf"
        assert docs[1]["source"] == "okf-concept"
        assert docs[1]["concept_id"] == "f2"
        assert docs[1]["url"] == ""
        # Confidence reflects BOTH real scores (0.95 dominates 0.85) — no zero injected.
        assert 0.90 < confidence <= 0.95
        assert grounded is True

    @pytest.mark.asyncio
    async def test_sigmoid_calibration_applied_end_to_end(self, monkeypatch):
        """Calibration must actually be applied inside _assemble_source_documents,
        not just exist as an unused helper (guards against someone removing the
        _calibrate_reranker_score call from the loop while unit tests still pass)."""
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_CALIBRATION", "sigmoid")
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_TEMPERATURE", 1.0)
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["X"], "file_name": "a.pdf"})
        # Raw logits as reranker scores: sigmoid(2.0) ~ 0.881, sigmoid(0.0) = 0.5.
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 2.0},
                {"id": "d2", "text": "honey", "score": 0.0},
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f2"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        # Per-doc displayed scores are the calibrated values, not the raw logits.
        assert 0.880 <= docs[0]["score"] <= 0.881  # sigmoid(2.0) ~ 0.8808
        assert docs[1]["score"] == 0.5
        assert grounded is True

    @pytest.mark.asyncio
    async def test_metadata_outage_on_legacy_hit_surfaces_nothing_and_not_grounded(self):
        """The doc-repo OUTAGE guard: a failed metadata lookup on a LEGACY hit
        (provenance without the OKF_ prefix — or no provenance at all) surfaces
        NO source, contributes no confidence, and grounds False. The 1.1
        revision deleted this contract by surfacing every miss as a fabricated
        okf-concept source; the OKF_ provenance gate (review 2026-10-29)
        restores it — fetch_file_metadata returns None for BOTH the by-design
        OKF-concept 404 AND a network outage, and only provenance can tell
        them apart."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value=None)  # doc-repo outage
        # Case 1: a legacy graph name in provenance.
        result_dict = self._result_dict(
            rerank_verdict=[{"id": "d1", "text": "hives", "score": 0.95}],
            retrieved_docs=[{"id": "d1", "text": "hives"}],
            file_id_pairs={"d1": "f1"},
            provenance_by_doc={"d1": {"graph_name": "GRAPH", "repo_id": "legacy"}},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        assert docs == []
        assert confidence == 0.0
        assert grounded is False
        # Case 2: no provenance at all (payload predates Story 1.0 attribution).
        result_dict = self._result_dict(
            rerank_verdict=[{"id": "d1", "text": "hives", "score": 0.95}],
            retrieved_docs=[{"id": "d1", "text": "hives"}],
            file_id_pairs={"d1": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        assert docs == []
        assert confidence == 0.0
        assert grounded is False

    @pytest.mark.asyncio
    async def test_all_metadata_fail_surfaces_okf_concept_sources(self):
        """Story 1.1: when every metadata lookup fails because every hit IS an
        OKF concept chunk (provenance graph_name carries the OKF_ prefix — they
        resolve in okf-server, not doc-repository, so the fetch 404s BY
        DESIGN), each doc still surfaces from its in-payload provenance with
        its real score and grounding stays True. The outage guard must not eat
        OKF ground truth either."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value=None)  # every lookup 404s by design
        result_dict = self._result_dict(
            rerank_verdict=[{"id": "d1", "text": "hives", "score": 0.95}],
            retrieved_docs=[{"id": "d1", "text": "hives"}],
            file_id_pairs={"d1": "f1"},
            provenance_by_doc={"d1": {"graph_name": "OKF_demo_v1", "repo_id": "demo", "concept_id": "f1"}},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        assert [d["document_id"] for d in docs] == ["f1"]
        assert docs[0]["source"] == "okf-concept"
        assert docs[0]["concept_id"] == "f1"
        assert docs[0]["graph_name"] == "OKF_demo_v1"
        assert docs[0]["repo_id"] == "demo"
        assert confidence == 0.95
        assert grounded is True

    @pytest.mark.asyncio
    async def test_duplicate_of_failed_metadata_dedups_to_one_source(self):
        """M3 (Story 1.1 revision): the file_id is marked surfaced on FIRST
        surfacing — a duplicate of an already-surfaced file dedups to one
        source entry and does not double-count in the aggregation. Since
        Story 1.1 the failed-metadata doc IS surfaced (OKF concept source), so
        the duplicate hits the normal dedup branch rather than re-failing."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value=None)  # all lookups 404 by design (OKF concepts)
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 0.95},
                {"id": "d2", "text": "honey", "score": 0.80},  # same file f1
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f1"},
            provenance_by_doc={
                "d1": {"graph_name": "OKF_demo_v1", "repo_id": "demo", "concept_id": "f1"},
                "d2": {"graph_name": "OKF_demo_v1", "repo_id": "demo", "concept_id": "f1"},
            },
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        assert [d["document_id"] for d in docs] == ["f1"]  # deduped to one
        assert docs[0]["source"] == "okf-concept"
        assert grounded is True

    @pytest.mark.asyncio
    async def test_duplicate_of_surfaced_doc_counts_score(self):
        """A duplicate of a successfully-surfaced file still contributes its score
        (unchanged dedup behaviour) — locks that the M3 fix only excludes duplicates
        of *failed* files, not of surfaced ones."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["X"], "file_name": "a.pdf"})
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 0.95},
                {"id": "d2", "text": "honey", "score": 0.90},  # same file f1
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        # One source row (deduped), but both scores count toward confidence.
        assert [d["document_id"] for d in docs] == ["f1"]
        assert 0.90 < confidence < 0.95  # rank-weighted over [0.95, 0.90]
        assert grounded is True

    @pytest.mark.asyncio
    async def test_duplicate_chunk_text_merges_into_benchmark_context(self):
        """Benchmark opt-in (include_contexts): a duplicate chunk's text must
        land on the surviving doc's context — appended to it — instead of
        being dropped with the duplicate row, or the evaluator scores
        context_recall against fewer contexts than the model actually saw
        (review 2026-10-29 round 3)."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["X"], "file_name": "a.pdf"})
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 0.95},
                {"id": "d2", "text": "honey", "score": 0.90},  # same file f1
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t", include_contexts=True)
        assert [d["document_id"] for d in docs] == ["f1"]
        assert docs[0]["text"] == "hives\nhoney"
        assert grounded is True

    @pytest.mark.asyncio
    async def test_duplicate_chunk_text_survives_when_surviving_doc_has_no_text(self):
        """The residual drop (review 2026-10-29 round 3): when the FIRST
        chunk's text is absent from the verdict (text_by_doc has no entry for
        it), the surviving doc surfaces without a text key — the duplicate's
        text must still be attached, not silently discarded."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["X"], "file_name": "a.pdf"})
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "score": 0.95},  # first chunk: no text in the verdict
                {"id": "d2", "text": "honey", "score": 0.90},  # same file f1
            ],
            retrieved_docs=[{"id": "d1"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t", include_contexts=True)
        assert [d["document_id"] for d in docs] == ["f1"]
        assert docs[0]["text"] == "honey"
        assert grounded is True

    @pytest.mark.asyncio
    async def test_not_grounded_when_reranker_rejects_all(self):
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["Fruit"], "file_name": "fruit.pdf"})
        # Retriever found docs, but the reranker rejected them all (verdict = []).
        result_dict = self._result_dict(
            rerank_verdict=[],
            retrieved_docs=[{"id": "d1", "text": "jocote", "metadata": {"score": 0.72}}],
            file_id_pairs={"d1": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        # The irrelevant retriever hits must NOT leak into the response.
        assert grounded is False
        assert docs == []
        assert confidence == 0.0

    @pytest.mark.asyncio
    async def test_reranker_verdict_filters_non_kept_docs(self):
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["X"], "file_name": "a.pdf"})
        result_dict = self._result_dict(
            # Reranker kept only the second doc.
            rerank_verdict=[{"id": "d2", "text": "honey", "score": 0.92}],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f2"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        assert grounded is True
        assert [d["document_id"] for d in docs] == ["f2"]
        assert confidence == 0.92

    @pytest.mark.asyncio
    async def test_no_reranker_falls_back_to_retriever_docs(self):
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value={"labels": ["X"], "file_name": "a.pdf"})
        result_dict = self._result_dict(
            with_reranker=False,
            retrieved_docs=[{"id": "d1", "text": "hives", "metadata": {"score": 0.7}}],
            file_id_pairs={"d1": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict, token="t")
        assert grounded is True
        assert [d["document_id"] for d in docs] == ["f1"]
        assert confidence == 0.7


# ===========================================================================
# Task 13: Test _stream_with_metadata() — metadata event in token stream
# ===========================================================================
class TestStreamWithMetadata:
    """The streaming response must append a `metadata` SSE event (reranker-grounded
    source documents + is_grounded) before the terminal [DONE], so the backend can
    forward it instead of re-running retrieval."""

    @staticmethod
    async def _drain(gen):
        out = []
        async for item in gen:
            out.append(item)
        return out

    @staticmethod
    def _make_body(chunks):
        async def _aiter():
            for c in chunks:
                yield c

        return _aiter()

    @pytest.mark.asyncio
    async def test_metadata_emitted_before_done(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1", "score": 0.95}], 0.95, True))
        body = self._make_body(["data: b'Hello'\n\n", "data: b' world'\n\n", "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        # Token chunks forwarded verbatim
        assert "data: b'Hello'\n\n" in joined
        assert "data: b' world'\n\n" in joined
        # Metadata event present, BEFORE [DONE]
        meta_idx = joined.find('"type": "metadata"')
        done_idx = joined.find("[DONE]")
        assert meta_idx != -1 and meta_idx < done_idx
        assert '"is_grounded": true' in joined
        assert '"confidence_score": 0.95' in joined

    @pytest.mark.asyncio
    async def test_not_grounded_flagged_in_metadata(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(["data: b'Hi'\n\n", "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        assert '"is_grounded": false' in joined
        assert '"source_documents": []' in joined

    @pytest.mark.asyncio
    async def test_query_translation_status_reaches_the_metadata_event(self):
        """The streamed metadata frame carries the query-translation status
        handle_request resolved, so a streamed answer is no blinder than a
        JSON one."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(["data: b'Hi'\n\n", "data: [DONE]\n\n"])
        out = await self._drain(
            svc._stream_with_metadata(body, {}, token="t", query_translation_status="fallback_timeout")
        )
        joined = "".join(out)
        assert '"query_translation_status": "fallback_timeout"' in joined

    @pytest.mark.asyncio
    async def test_usage_only_frame_never_leaks(self):
        """vLLM's terminal usage-only chunk (choices:[] + usage) is transport
        metadata the orchestrator forwards like a token. Live 2026-10-23: the
        raw JSON leaked into user-visible answers AND benchmark answers (the
        judge scored it as answer content). It must be dropped from the
        stream; ordinary JSON-looking answer text is unaffected."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        usage_frame = (
            '{"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,'
            '"model":"m","choices":[],"usage":{"prompt_tokens":1,"total_tokens":2}}'
        )
        # The keyless twin (review 2026-10-29 round 3): usage OBJECT, no
        # choices key at all — must drop the same way.
        keyless_usage_frame = '{"id":"chatcmpl-x","usage":{"prompt_tokens":1,"total_tokens":2}}'
        body = self._make_body(
            [
                "data: b'Real answer text.'\n\n",
                f"data: b'{usage_frame}'\n\n",
                f"data: b'{keyless_usage_frame}'\n\n",
                "data: [DONE]\n\n",
            ]
        )
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        assert "Real answer text." in joined
        assert "chat.completion.chunk" not in joined
        assert "usage" not in joined.split('"type": "metadata"')[0]

    def test_is_usage_only_frame_discriminator(self):
        from chatqna.genieai_chatqna import _is_usage_only_frame

        usage = '{"id":"chatcmpl-x","choices":[],"usage":{"total_tokens":2}}'
        assert _is_usage_only_frame(usage) is True
        # Content-bearing frames are NEVER usage-only
        assert _is_usage_only_frame('{"id":"x","choices":[{"delta":{"content":"hi"}}]}') is False
        assert _is_usage_only_frame("plain answer text") is False
        assert _is_usage_only_frame("{broken json") is False
        assert _is_usage_only_frame("") is False
        # Keyless terminal frame (review 2026-10-29 round 3): some vLLM builds
        # end with a usage OBJECT and NO choices key at all — usage-only too,
        # or the raw JSON leaks into the answer text.
        assert _is_usage_only_frame('{"id":"x","usage":{"total_tokens":2}}') is True
        # The tightening holds: a usage STRING with no choices key is answer
        # content (a model asked for JSON can return {"usage": "5 kWh"}).
        assert _is_usage_only_frame('{"usage":"5 kWh"}') is False

    async def test_the_derived_outcome_reaches_the_metadata_event(self):
        """The outcome handle_request derived (for the metric) must land in
        the metadata event verbatim — flag AND reason. Derivation itself is
        owned by the handle_request tests; this owns the pass-through wiring.
        The reranker-kept-nothing reason doubles as the check that a second
        cause flows through the same channel."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(["data: b'I cannot answer that'\n\n", "data: [DONE]\n\n"])
        result_dict = {"retriever": {"error": "shape changed"}}
        out = await self._drain(
            svc._stream_with_metadata(
                body,
                result_dict,
                token="t",
                abstained=True,
                abstention_reason="reranker_selected_nothing",
            )
        )
        joined = "".join(out)
        assert '"abstained": true' in joined
        assert '"abstention_reason": "reranker_selected_nothing"' in joined

    @pytest.mark.asyncio
    async def test_appends_done_if_missing(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(["data: b'Hi'\n\n"])  # no [DONE]
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        assert '"type": "metadata"' in joined
        assert joined.rstrip().endswith("data: [DONE]")

    # ----------------------------------------------------------------------
    # Conversation-marker stripping in the streaming path (issue #830).
    # The non-streaming path strips |<-MSG->| delimiters and USER:/ASSISTANT:
    # role markers the LLM sometimes echoes back. The streaming path used to
    # forward chunks verbatim, leaking those internal markers to the frontend.
    # ----------------------------------------------------------------------

    @staticmethod
    def _chunk(content):
        """Build a ``data: b'...'`` SSE chunk from a content string.

        Mirrors ``align_generator``'s output format exactly so the stripper is
        exercised against realistic chunks.
        """
        return f"data: {repr(content.encode('utf-8'))}\n\n"

    @staticmethod
    def _decode_content(out):
        """Concatenate decoded text from all ``data: b'...'`` chunks.

        Excludes metadata and ``[DONE]`` events so assertions target only the
        forwarded token text.
        """
        import ast

        parts = []
        for item in out:
            text = item.decode("utf-8") if isinstance(item, (bytes, bytearray)) else str(item)
            if not text.startswith("data: ") or text.strip() == "data: [DONE]":
                continue
            payload = text[len("data: ") :].rstrip()
            if payload.startswith("b'") or payload.startswith('b"'):
                try:
                    raw = ast.literal_eval(payload)
                    if isinstance(raw, (bytes, bytearray)):
                        parts.append(raw.decode("utf-8"))
                except (ValueError, SyntaxError):
                    pass
        return "".join(parts)

    @pytest.mark.asyncio
    async def test_strips_complete_separator_single_chunk(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("Hello |<-MSG->| World"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "Hello" in decoded
        assert "World" in decoded

    @pytest.mark.asyncio
    async def test_strips_separator_split_across_chunks(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("Hello |<-M"), self._chunk("SG->| World"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "Hello" in decoded
        assert "World" in decoded

    @pytest.mark.asyncio
    async def test_strips_user_role_marker_after_separator(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("|<-MSG->| USER: what is genai?"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "USER:" not in decoded
        assert "what is genai?" in decoded

    @pytest.mark.asyncio
    async def test_strips_assistant_role_marker(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("|<-MSG->| ASSISTANT: it is ai."), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "ASSISTANT:" not in decoded
        assert "it is ai." in decoded

    @pytest.mark.asyncio
    async def test_strips_role_marker_split_from_separator(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        # Separator replaced -> "\n", then " US" in one chunk and "ER: q" in the
        # next: the role marker is split from its preceding separator across
        # chunk boundaries AND its connecting whitespace.
        body = self._make_body(
            [
                self._chunk("|<-MSG->|"),
                self._chunk(" US"),
                self._chunk("ER: the answer"),
                "data: [DONE]\n\n",
            ]
        )
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "USER:" not in decoded
        assert "the answer" in decoded

    @pytest.mark.asyncio
    async def test_strips_assistant_role_split_across_chunks(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(
            [
                self._chunk("|<-MSG->| ASS"),
                self._chunk("ISTANT: reply"),
                "data: [DONE]\n\n",
            ]
        )
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "ASSISTANT:" not in decoded
        assert "ASS" not in decoded
        assert "reply" in decoded

    @pytest.mark.asyncio
    async def test_strips_role_marker_split_at_newline_without_separator(self):
        # Bare role marker (no preceding |<-MSG->|) split across a newline
        # boundary: "\nUS" then "ER: hello". The [ \t]* tolerance in _CONV_ROLE_RE
        # exists for this case — the streaming buffer must still strip it.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("intro\nUS"), self._chunk("ER: hello"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "USER:" not in decoded
        assert "intro" in decoded
        assert "hello" in decoded

    @pytest.mark.asyncio
    async def test_whitespace_run_does_not_grow_buffer_unboundedly(self):
        # Regression guard: a long trailing-whitespace run must not be withheld
        # forever (capped lead-in). The excess flushes as content and the stream
        # still terminates with all real text present.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("a" + " " * 200 + "b"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert decoded.startswith("a")
        assert decoded.endswith("b")

    @pytest.mark.asyncio
    async def test_preserves_normal_content_unchanged(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("The capital of France is Paris."), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        assert self._decode_content(out) == "The capital of France is Paris."

    @pytest.mark.asyncio
    async def test_preserves_pipe_in_normal_content(self):
        # A lone "|" that is NOT part of the separator must survive.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("Use cmd | grep | sort"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        assert self._decode_content(out) == "Use cmd | grep | sort"

    @pytest.mark.asyncio
    async def test_partial_separator_at_stream_end_emitted_as_literal(self):
        # Characters that look like the start of a separator but never complete
        # are real content and must be flushed, not silently dropped.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("result |<-M"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        assert self._decode_content(out) == "result |<-M"

    @pytest.mark.asyncio
    async def test_unparseable_chunk_forwarded_verbatim(self):
        # A chunk not in the data: b'...' format must pass through untouched so
        # an unexpected orchestrator format never breaks the stream.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(["data: not-bytes-repr\n\n", "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        assert "data: not-bytes-repr\n\n" in joined

    @pytest.mark.asyncio
    async def test_realistic_history_echo_fully_stripped(self):
        # The LLM echoes the entire internal chat-history block; every marker
        # and role label must be gone, real content preserved.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        history_echo = (
            "|<-MSG->| USER: previous question\n|<-MSG->| ASSISTANT: previous answer\nThe real answer is here."
        )
        body = self._make_body([self._chunk(history_echo), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "USER:" not in decoded
        assert "ASSISTANT:" not in decoded
        assert "previous question" in decoded
        assert "previous answer" in decoded
        assert "The real answer is here." in decoded

    @pytest.mark.asyncio
    async def test_strips_separator_from_unicode_content(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("Réponse |<-MSG->| über Straße"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}, token="t"))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "Réponse" in decoded
        assert "über Straße" in decoded


# ===========================================================================
# Excess-blank-line collapse (_EXCESS_BLANK_RE)
# Applied in both _stream_with_metadata and _finalize_llm_response. The
# regression around granite emitting `\n\n\n` between sections (header→list,
# list→next header) shows up as extra visual blank lines in the rendered
# chat. The unit below pins the contract for both paths and the boundary
# case (partial triple split across token chunks).
# ===========================================================================
class TestExcessBlankCollapse:
    """Pin the `\n{3,}` → `\n\n` collapse on both paths + cross-chunk boundary."""

    @staticmethod
    def _streamed_text(out):
        # Strip the metadata JSON event and the [DONE] terminator from the
        # streamed yield list, leaving only the chunk payloads (whose content
        # is repr-encoded, so decode with ast.literal_eval).
        chunks = []
        for item in out:
            if not item.startswith("data: "):
                continue
            if item.startswith("data: [DONE]"):
                continue
            try:
                payload = ast.literal_eval(item[len("data: ") :].rstrip("\n"))
            except (SyntaxError, ValueError):
                continue
            if isinstance(payload, (bytes, bytearray)):
                chunks.append(payload.decode("utf-8"))
            elif isinstance(payload, str):
                chunks.append(payload)
        return "".join(chunks)

    @pytest.mark.asyncio
    async def test_streaming_collapses_triple_newlines_within_a_chunk(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.5, False))
        body = TestStreamWithMetadata._make_body(
            [
                "data: b'**Header:**\\n\\n\\n\\n* item\\n\\n\\n* next item'\n\n",
                "data: [DONE]\n\n",
            ]
        )
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        text = self._streamed_text(out)
        # Triple+ newlines reduced to single paragraph break; no 3+ runs survive.
        assert "\n\n\n" not in text
        # Single paragraph breaks preserved.
        assert "\n\n* item" in text
        assert "**Header:**" in text

    @pytest.mark.asyncio
    async def test_streaming_collapses_across_chunk_boundary(self):
        """A triple-newline run that straddles a token-chunk boundary must not
        survive: collapsing on every buffer accumulation (before marker-tail
        handling) keeps the held-back tail consistent with what has already
        been emitted, so the second chunk's leading newlines can only add
        onto an already-collapsed tail."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.5, False))
        body = TestStreamWithMetadata._make_body(
            [
                "data: b'**Header:**\\n\\n'\n\n",  # ends with \n\n
                "data: b'\\n\\n* item'\n\n",  # would form \n\n\n\n at join
                "data: [DONE]\n\n",
            ]
        )
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        text = self._streamed_text(out)
        assert "\n\n\n" not in text
        assert "**Header:**" in text
        assert "* item" in text

    @pytest.mark.asyncio
    async def test_streaming_preserves_single_blank_line(self):
        """A single paragraph break must survive untouched — collapsing only
        fires on 3+ runs."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.5, False))
        body = TestStreamWithMetadata._make_body(
            [
                "data: b'paragraph one\\n\\nparagraph two'\n\n",
                "data: [DONE]\n\n",
            ]
        )
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        text = self._streamed_text(out)
        assert "paragraph one\n\nparagraph two" in text

    @pytest.mark.asyncio
    async def test_streaming_collapses_in_held_back_tail(self):
        """Regression: if the tail-withhold logic is in play (a partial
        marker at end), the collapse must still apply before the buffer is
        settled. No multi-blank run can leak via the tail."""
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.5, False))
        body = TestStreamWithMetadata._make_body(
            [
                "data: b'answer\\n\\n\\n\\n\\n'\n\n",  # triple then withheld tail
                "data: [DONE]\n\n",
            ]
        )
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        text = self._streamed_text(out)
        # The final flush emits the held-back tail as part of the answer.
        assert "\n\n\n" not in text

    @pytest.mark.asyncio
    async def test_finalize_collapses_excess_blanks_before_translation(self, monkeypatch):
        """The non-streaming path collapses excess blanks BEFORE handing
        content to the translator — same invariant the streaming path applies
        at emission. Without this, the translation cache would persist entries
        pre-collapse that re-introduce blanks on cache hit."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", False)
        svc = create_chatqna_service()
        captured = {}

        async def fake_translate(text, iso_code):
            captured["text"] = text
            return f"[ES]{text}"

        svc._translate_with_chunking = fake_translate
        # 4 newlines then 5 newlines between the three paragraphs.
        await svc._finalize_llm_response(
            "respuesta.\n\n\n\nsiguiente párrafo\n\n\n\n\núltimo",
            "ES",
        )
        # Translator received collapsed text (3+ runs → \n\n).
        assert "\n\n\n" not in captured["text"]
        assert captured["text"] == "respuesta.\n\nsiguiente párrafo\n\núltimo"


# ===========================================================================
# Shared conversation-marker stripping patterns (_CONV_SEP_RE / _CONV_ROLE_RE)
# Both the assembled-response (handle_request) and streaming
# (_stream_with_metadata) paths strip the same leaked |<-MSG->| delimiters
# and USER:/ASSISTANT: role markers, so the patterns are defined once at
# module level. These tests lock the canonical behaviour both paths inherit.
# ===========================================================================
class TestConvMarkerPatterns:
    def test_separator_replaced_by_newline(self):
        from chatqna.genieai_chatqna import _CONV_SEP_RE

        assert _CONV_SEP_RE.sub("\n", "a |<-MSG->| b") == "a\nb"

    def test_separator_collapses_surrounding_whitespace(self):
        from chatqna.genieai_chatqna import _CONV_SEP_RE

        assert _CONV_SEP_RE.sub("\n", "a   |<-MSG->|   b") == "a\nb"

    def test_role_marker_stripped_at_line_start(self):
        from chatqna.genieai_chatqna import _CONV_ROLE_RE

        assert _CONV_ROLE_RE.sub("", "\nUSER: hello") == "\nhello"
        assert _CONV_ROLE_RE.sub("", "\nASSISTANT: reply") == "\nreply"

    def test_role_marker_tolerates_leading_whitespace(self):
        # A role marker split from its preceding separator across streaming
        # chunks lands after a space; the shared regex must still strip it.
        from chatqna.genieai_chatqna import _CONV_ROLE_RE

        assert _CONV_ROLE_RE.sub("", "\n USER: hello") == "\nhello"

    def test_role_marker_not_stripped_mid_line(self):
        from chatqna.genieai_chatqna import _CONV_ROLE_RE

        # Must not touch "USER:" that is real content in the middle of a line.
        assert _CONV_ROLE_RE.sub("", "the USER: field is here") == "the USER: field is here"

    def test_assembled_history_echo_matches_streaming_output(self):
        # Non-streaming and streaming stripping must produce the same result
        # for a realistic history echo — the single source of truth guarantee.
        from chatqna.genieai_chatqna import _CONV_ROLE_RE, _CONV_SEP_RE

        echo = "|<-MSG->| USER: q\n|<-MSG->| ASSISTANT: a\nreal answer"
        assembled = _CONV_ROLE_RE.sub("", _CONV_SEP_RE.sub("\n", echo))
        assert "|<-MSG->|" not in assembled
        assert "USER:" not in assembled
        assert "ASSISTANT:" not in assembled
        assert "real answer" in assembled
        assert "q" in assembled
        assert "a" in assembled


# ===========================================================================
# Confidence aggregation helpers (rank-weighted retrieval confidence)
# ===========================================================================
class TestConfidenceAggregation:
    """The flat mean was count-dependent and tail-sensitive; rank-weighting lets the
    most relevant document dominate so a long tail of low-scoring chunks no longer
    depresses the score."""

    def test_empty_is_zero(self):
        assert _rank_weighted_confidence([]) == 0.0

    def test_single_is_the_score(self):
        assert _rank_weighted_confidence([0.77]) == 0.77

    def test_top_dominates_over_flat_mean(self):
        # Flat mean would be ~0.35; rank-weighting keeps the strong top doc dominant.
        scores = [0.95, 0.2, 0.15, 0.1]
        weighted = _rank_weighted_confidence(scores)
        flat = sum(scores) / len(scores)
        assert weighted > flat
        assert weighted < scores[0]

    def test_rank_order_matters(self):
        # rank 0 = first element = most relevant; swapping the order changes the result.
        assert _rank_weighted_confidence([0.9, 0.1]) > _rank_weighted_confidence([0.1, 0.9])

    def test_calibration_none_is_identity(self, monkeypatch):
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_CALIBRATION", "none")
        # Already-[0,1] scores are NOT compressed under the default.
        assert _calibrate_reranker_score(0.42) == 0.42
        assert _calibrate_reranker_score(0.95) == 0.95

    def test_calibration_sigmoid_maps_logits(self, monkeypatch):
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_CALIBRATION", "sigmoid")
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_TEMPERATURE", 1.0)
        assert _calibrate_reranker_score(0.0) == 0.5
        assert _calibrate_reranker_score(10.0) > 0.99
        assert _calibrate_reranker_score(-10.0) < 0.01

    def test_calibration_sigmoid_saturates_on_overflow(self, monkeypatch):
        # A large negative logit with a tiny temperature makes math.exp overflow;
        # the guard saturates to the asymptote instead of raising OverflowError.
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_CALIBRATION", "sigmoid")
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_TEMPERATURE", 0.01)
        assert _calibrate_reranker_score(-1000.0) == 0.0  # overflow -> guard
        assert _calibrate_reranker_score(1000.0) == 1.0  # underflow -> natural 1.0

    def test_calibration_handles_non_numeric_score(self, monkeypatch):
        # A None / non-numeric score must not crash the chat; treated as no signal.
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_CALIBRATION", "sigmoid")
        assert _calibrate_reranker_score(None) == 0.0
        monkeypatch.setattr(chatqna_module, "RERANKER_SCORE_CALIBRATION", "none")
        assert _calibrate_reranker_score("not-a-number") == 0.0

    def test_decay_zero_yields_flat_mean(self, monkeypatch):
        # decay=0 means equal weighting (exp(0)=1) -> the flat arithmetic mean.
        monkeypatch.setattr(chatqna_module, "CONFIDENCE_RANK_DECAY", 0.0)
        scores = [0.9, 0.5, 0.3]
        assert _rank_weighted_confidence(scores) == sum(scores) / len(scores)

    def test_display_confidence_prefers_self_when_present(self):
        assert _display_confidence(0.3, 0.9) == 0.9

    def test_display_confidence_falls_back_to_retrieval_when_self_none(self):
        assert _display_confidence(0.42, None) == 0.42

    def test_display_confidence_treats_zero_self_as_present(self):
        # 0.0 is a valid self-grade, not "missing" — only None falls back.
        assert _display_confidence(0.7, 0.0) == 0.0


# ===========================================================================
# LLM self-grade sentinel (opt-in via LLM_SELF_CONFIDENCE_ENABLED)
# ===========================================================================
class TestSelfConfidenceSentinel:
    """When enabled, the model appends a `[[CONF:<0-100>]]` self-grade. We strip it
    before the text reaches the user or the translation pipeline and expose its value
    as `self_confidence`. Missing/malformed sentinels yield None — never a hard fail."""

    def test_extract_valid_trailing_sentinel(self):
        text, val = _extract_self_confidence("The answer is 42.\n[[CONF:85]]")
        assert val == 0.85
        assert "[[CONF:" not in text
        assert text.rstrip().endswith("42.")

    def test_extract_missing_returns_none(self):
        text, val = _extract_self_confidence("No sentinel here.")
        assert val is None
        assert text == "No sentinel here."

    def test_extract_malformed_preserves_text(self):
        text, val = _extract_self_confidence("Answer.\n[[CONF:abc]]")
        assert val is None
        assert text == "Answer.\n[[CONF:abc]]"

    def test_extract_out_of_range_returns_none(self):
        _, val = _extract_self_confidence("Answer.\n[[CONF:150]]")
        assert val is None

    def test_extract_empty_text(self):
        assert _extract_self_confidence("")[1] is None

    @pytest.mark.asyncio
    async def test_streaming_strips_sentinel_and_emits_self_confidence(self, monkeypatch):
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1"}], 0.9, True))
        body = TestStreamWithMetadata._make_body(
            ["data: b'It is 42.'\n\n", "data: b'[[CONF:80]]'\n\n", "data: [DONE]\n\n"]
        )
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        # The sentinel never reaches the user.
        assert "[[CONF:" not in joined
        assert "It is 42." in joined
        # self_confidence (raw) + retrieval_confidence_score (raw) emitted for admin/eval.
        assert '"self_confidence": 0.8' in joined
        assert '"retrieval_confidence_score": 0.9' in joined
        # Citizen-facing confidence_score reflects the LLM self-grade (transparent to
        # clients), NOT the retrieval value, when the feature is on + sentinel present.
        assert '"confidence_score": 0.8' in joined
        assert '"confidence_score": 0.9' not in joined

    @pytest.mark.asyncio
    async def test_streaming_self_confidence_null_when_sentinel_missing(self, monkeypatch):
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = TestStreamWithMetadata._make_body(["data: b'Hi'\n\n", "data: [DONE]\n\n"])
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        assert '"self_confidence": null' in joined
        # Fallback: with no sentinel, the citizen-facing confidence_score falls back
        # to the retrieval confidence so the badge never disappears.
        assert '"confidence_score": 0.0' in joined
        assert '"retrieval_confidence_score": 0.0' in joined

    @pytest.mark.asyncio
    async def test_streaming_no_self_confidence_field_when_flag_off(self):
        # Default flag off: the metadata contract must stay stable (no new field).
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = TestStreamWithMetadata._make_body(["data: b'Hi'\n\n", "data: [DONE]\n\n"])
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        assert "self_confidence" not in joined
        # retrieval_confidence_score is always present (admin/eval) even with the
        # flag off; confidence_score equals retrieval when the flag is off.
        assert '"retrieval_confidence_score": 0.0' in joined
        assert '"confidence_score": 0.0' in joined

    @pytest.mark.asyncio
    async def test_streaming_sentinel_split_across_chunks_is_stitched(self, monkeypatch):
        """The sentinel may arrive split across token chunks; the marker-tail
        withholding must stitch it and neither leak a fragment nor lose the value."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1"}], 0.9, True))
        body = TestStreamWithMetadata._make_body(
            ["data: b'It is 42.'\n\n", "data: b'[[CO'\n\n", "data: b'NF:80]]'\n\n", "data: [DONE]\n\n"]
        )
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        # No fragment of the sentinel leaks to the user.
        assert "[[CO" not in joined
        assert "NF:80" not in joined
        assert "[[CONF:" not in joined
        assert "It is 42." in joined
        assert '"self_confidence": 0.8' in joined

    @pytest.mark.asyncio
    async def test_streaming_sentinel_split_at_full_prefix_is_withheld(self, monkeypatch):
        """Regression: when the tokenizer emits the FULL `[[CONF:` prefix as a chunk
        boundary (number + closing arriving later), the bare prefix has no regex
        substitute, so the marker-tail withholding must withhold the full literal —
        not only proper prefixes. Otherwise `[[CONF:` leaks and the value is lost
        (the production symptom: sentinel visible to the user + confidence fell back
        to the retrieval value)."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1"}], 0.04, True))
        body = TestStreamWithMetadata._make_body(
            ["data: b'It is 42.'\n\n", "data: b'\\n[[CONF:'\n\n", "data: b'100]]'\n\n", "data: [DONE]\n\n"]
        )
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        # No fragment of the sentinel leaks.
        assert "[[CONF:" not in joined
        assert "100]]" not in joined
        assert "It is 42." in joined
        # Value captured -> citizen-facing confidence_score reflects the self-grade
        # (1.0), NOT the fallback retrieval value (0.04).
        assert '"self_confidence": 1.0' in joined
        assert '"confidence_score": 1.0' in joined
        assert '"confidence_score": 0.04' not in joined

    @pytest.mark.parametrize(
        "chunks",
        [
            ("It is 42.", "[[CONF:80]]"),  # complete sentinel in one chunk
            ("It is 42.", "[[CO", "NF:80]]"),  # split mid-prefix (proper prefix)
            ("It is 42.", "[[CONF:", "80]]"),  # split at the full prefix
            ("It is 42.", "[[CONF:8", "0]]"),  # split AFTER a digit (prod tokenization)
            ("It is 42.", "[[CONF:80", "]]"),  # split after all digits
            ("It is 42.", "[[CONF:80]", "]"),  # split after one closing bracket
        ],
    )
    @pytest.mark.asyncio
    async def test_streaming_sentinel_never_leaks_any_chunk_boundary(self, monkeypatch, chunks):
        """The sentinel is a VARIABLE pattern [[CONF:<digits>]], not a fixed literal.
        Any chunk boundary the tokenizer chooses — mid-prefix, after digits, after a
        closing bracket — must be withheld and stitched, never leaked, and the value
        must always be captured. Regression for the prod leak where a digit-bearing
        partial (`[[CONF:100`) was not withheld."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1"}], 0.04, True))
        body = TestStreamWithMetadata._make_body([f"data: b'{c}'\n\n" for c in chunks] + ["data: [DONE]\n\n"])
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}, token="t"))
        joined = "".join(out)
        # No fragment of the sentinel leaks (uppercase CONF:/brackets only appear in it;
        # the metadata JSON is lowercase "confidence_*").
        assert "[[CONF" not in joined
        assert "80]]" not in joined
        assert "It is 42." in joined
        # Value always captured -> citizen confidence reflects the self-grade.
        assert '"self_confidence": 0.8' in joined
        assert '"confidence_score": 0.8' in joined
        assert '"confidence_score": 0.04' not in joined

    def test_extraction_yields_translation_safe_text_multilingual(self, monkeypatch):
        """Strip-before-translate invariant (the #1 sentinel/translation collision
        risk): extraction must leave text safe to pass to the translation pipeline —
        no sentinel and no trailing partial marker — including for multilingual
        answers. (Full handle_request + translation integration is deferred:
        handle_request has no existing test harness.)"""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        from chatqna.genieai_chatqna import _SELF_CONF_PARTIAL_RE

        text, val = _extract_self_confidence("Respuesta en español sobre apicultura.\n[[CONF:90]]")
        assert val == 0.9
        assert "[[CONF:" not in text
        assert _SELF_CONF_PARTIAL_RE.search(text) is None
        assert "español" in text  # answer content preserved for translation

    def test_inline_non_terminal_sentinel_is_not_stripped(self, monkeypatch):
        """The sentinel regex is terminal-only: an inline `[[CONF:N]]` that is real
        answer content (not the trailing self-grade) must NOT be stripped or corrupt
        the answer. Only the trailing sentinel is extracted."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        original = "See [[CONF:50]] in the docs for details."
        text, val = _extract_self_confidence(original)
        assert val is None
        assert text == original

    @pytest.mark.asyncio
    async def test_finalize_strips_sentinel_before_translation(self, monkeypatch):
        """Real integration of the strip-before-translate ordering (I3): the
        translator receives text WITHOUT the sentinel, and self_confidence is
        captured. Mocks only the translator — no megaservice harness needed."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = create_chatqna_service()
        captured = {}

        async def fake_translate(text, iso_code):
            captured["text"] = text
            return f"[ES]{text}"

        svc._translate_with_chunking = fake_translate
        final_text, self_conf, _status = await svc._finalize_llm_response("Respuesta.\n[[CONF:90]]", "ES")
        # Translator received clean text (sentinel stripped before the call).
        assert "[[CONF:" not in captured["text"]
        assert captured["text"].rstrip().endswith("Respuesta.")
        # self_confidence captured; final text is the sentinel-free translation.
        assert self_conf == 0.9
        assert "[[CONF:" not in final_text

    @pytest.mark.asyncio
    async def test_finalize_flag_off_en_returns_conv_stripped_text(self, monkeypatch):
        """Flag off + EN: finalize returns conv-marker-stripped text unchanged and
        self_confidence None (metadata contract stable, no translation invoked)."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", False)
        svc = create_chatqna_service()
        svc._translate_with_chunking = AsyncMock()  # EN must not invoke translation
        final_text, self_conf, _status = await svc._finalize_llm_response("|<-MSG->| USER: hi\nanswer", "EN")
        svc._translate_with_chunking.assert_not_called()
        assert self_conf is None
        assert "|<-MSG->|" not in final_text
        assert "USER:" not in final_text
        assert "answer" in final_text


class TestCountFinalChunks:
    """Tests for _count_final_chunks — the rag.chunk_count metric helper.

    Regression: the old code used hasattr(dict, "retrieved_docs") which is always
    False, so the metric was stuck at 0 even when chunks were retrieved.
    """

    def test_empty_result_is_zero(self):
        assert _count_final_chunks({}) == 0

    def test_dict_node_returns_count(self):
        result = {"retriever": {"retrieved_docs": ["a", "b", "c", "d"]}}
        assert _count_final_chunks(result) == 4

    def test_keeps_deepest_stage_reranker_wins(self):
        # retriever returns 4, reranker slices to 1 -> final = 1 (post-rerank).
        result = {
            "retriever": {"retrieved_docs": ["a", "b", "c", "d"]},
            "reranker": {"retrieved_docs": ["a"]},
        }
        assert _count_final_chunks(result) == 1

    def test_node_without_retrieved_docs_skipped(self):
        result = {"llm": {"text": "answer"}, "retriever": {"retrieved_docs": ["x", "y"]}}
        assert _count_final_chunks(result) == 2

    def test_none_safe(self):
        assert _count_final_chunks(None) == 0


# ===========================================================================
# Task: Multi-turn blend pure helpers (issue #833)
# ===========================================================================
class TestMultiTurnBlendHelpers:
    """Direct unit tests for the pure helpers (no I/O, no mocks)."""

    # --- _extract_history_text ---

    def test_extract_history_text_empty_string(self):
        assert chatqna_module._extract_history_text("", 1) == ""

    def test_extract_history_text_first_turn_no_history(self):
        """Single segment (current turn only) → no prior history."""
        assert chatqna_module._extract_history_text("USER: hello", 1) == ""

    def test_extract_history_text_n_zero_or_negative(self):
        blob = "USER: q1 |<-MSG->| ASSISTANT: a1 |<-MSG->| USER: q2"
        assert chatqna_module._extract_history_text(blob, 0) == ""
        assert chatqna_module._extract_history_text(blob, -1) == ""

    def test_extract_history_text_previous_turn_only(self):
        blob = "USER: q1 |<-MSG->| ASSISTANT: a1 |<-MSG->| USER: q2"
        # last segment is current query (q2); n_turns=1 → previous segment only
        assert chatqna_module._extract_history_text(blob, 1) == "ASSISTANT: a1"

    def test_extract_history_text_multiple_turns(self):
        blob = "USER: q1 |<-MSG->| ASSISTANT: a1 |<-MSG->| USER: q2 |<-MSG->| ASSISTANT: a2 |<-MSG->| USER: q3"
        # n_turns=2 → last 2 prior segments joined
        result = chatqna_module._extract_history_text(blob, 2)
        assert "USER: q2" in result and "ASSISTANT: a2" in result
        assert "q1" not in result and "q3" not in result

    def test_extract_history_text_n_exceeds_available(self):
        """Requesting more turns than available → returns all prior segments."""
        blob = "USER: q1 |<-MSG->| ASSISTANT: a1 |<-MSG->| USER: q2"
        result = chatqna_module._extract_history_text(blob, 10)
        assert "q1" in result and "a1" in result

    def test_extract_history_text_filters_empty_segments(self):
        """Pipe-delimited blob with stray separators → empty segments filtered."""
        blob = "|<-MSG->| USER: q1 |<-MSG->|  |<-MSG->| USER: q2"
        result = chatqna_module._extract_history_text(blob, 1)
        assert result == "USER: q1"

    # --- _blend_embeddings ---

    def test_blend_alpha_one_returns_query(self):
        q = [1.0, 2.0, 3.0]
        h = [9.0, 9.0, 9.0]
        assert chatqna_module._blend_embeddings(q, h, 1.0) == q

    def test_blend_alpha_zero_returns_history(self):
        q = [1.0, 2.0, 3.0]
        h = [9.0, 9.0, 9.0]
        assert chatqna_module._blend_embeddings(q, h, 0.0) == h

    def test_blend_alpha_half_is_midpoint(self):
        q = [0.0, 2.0]
        h = [4.0, 6.0]
        assert chatqna_module._blend_embeddings(q, h, 0.5) == [2.0, 4.0]

    def test_blend_alpha_above_one_clamps_to_query(self):
        q = [1.0]
        h = [5.0]
        assert chatqna_module._blend_embeddings(q, h, 5.0) == q

    def test_blend_alpha_below_zero_clamps_to_history(self):
        q = [1.0]
        h = [5.0]
        assert chatqna_module._blend_embeddings(q, h, -3.0) == h

    def test_blend_dimension_mismatch_returns_query(self):
        q = [1.0, 2.0]
        h = [1.0, 2.0, 3.0]
        assert chatqna_module._blend_embeddings(q, h, 0.5) == q

    def test_blend_empty_history_returns_query(self):
        q = [1.0, 2.0]
        assert chatqna_module._blend_embeddings(q, [], 0.5) == q

    class TestLlmParamsMaxTokens:
        """max_tokens=None must not be passed to LLMParams (pydantic >=2.13 rejects None for int)."""

        def test_max_tokens_none_omitted_from_kwargs(self):
            """When chat_request.max_tokens is None, LLMParams is called without max_tokens kwarg."""
            chat_request = MagicMock()
            # Simulate the llm_kwargs logic from genieai_chatqna (schedule_stream method)
            chat_request.max_tokens = None
            chat_request.top_k = None
            chat_request.top_p = None
            chat_request.temperature = None
            chat_request.frequency_penalty = None
            chat_request.presence_penalty = None
            chat_request.stream = None
            chat_request.chat_template = None
            chat_request.model = None

            # Build kwargs the same way the production code does
            llm_kwargs = dict(
                top_k=chat_request.top_k if chat_request.top_k else 10,
                top_p=chat_request.top_p if chat_request.top_p else 0.95,
                temperature=chat_request.temperature if chat_request.temperature else 0.01,
                frequency_penalty=chat_request.frequency_penalty if chat_request.frequency_penalty else 0.0,
                presence_penalty=chat_request.presence_penalty if chat_request.presence_penalty else 0.0,
                stream=chat_request.stream if chat_request.stream else False,
            )
            if chat_request.max_tokens is not None:
                llm_kwargs["max_tokens"] = chat_request.max_tokens
            if chat_request.chat_template:
                llm_kwargs["chat_template"] = chat_request.chat_template
            if chat_request.model:
                llm_kwargs["model"] = chat_request.model

            # max_tokens MUST be absent when None
            assert "max_tokens" not in llm_kwargs

        def test_max_tokens_set_included_in_kwargs(self):
            """When chat_request.max_tokens is set, it IS passed to LLMParams."""
            chat_request = MagicMock()
            chat_request.max_tokens = 512
            chat_request.top_k = None
            chat_request.top_p = None
            chat_request.temperature = None
            chat_request.frequency_penalty = None
            chat_request.presence_penalty = None
            chat_request.stream = None
            chat_request.chat_template = None
            chat_request.model = None

            llm_kwargs = dict(
                top_k=chat_request.top_k if chat_request.top_k else 10,
                top_p=chat_request.top_p if chat_request.top_p else 0.95,
                temperature=chat_request.temperature if chat_request.temperature else 0.01,
                frequency_penalty=chat_request.frequency_penalty if chat_request.frequency_penalty else 0.0,
                presence_penalty=chat_request.presence_penalty if chat_request.presence_penalty else 0.0,
                stream=chat_request.stream if chat_request.stream else False,
            )
            if chat_request.max_tokens is not None:
                llm_kwargs["max_tokens"] = chat_request.max_tokens
            if chat_request.chat_template:
                llm_kwargs["chat_template"] = chat_request.chat_template
            if chat_request.model:
                llm_kwargs["model"] = chat_request.model

            # max_tokens MUST be present when set
            assert "max_tokens" in llm_kwargs
            assert llm_kwargs["max_tokens"] == 512


class TestAbstentionDefault:
    """Default abstention instructions when no override is provided.

    Pins the constant so a stray refactor cannot silently change the
    user-visible behaviour of the fallback prompt.
    """

    def test_default_constant_is_non_empty_string(self):
        default = chatqna_module._DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS
        assert isinstance(default, str)
        assert default.strip() != ""

    def test_default_constant_contains_disclaimer_keyword(self):
        """The default must tell the LLM to disclose the ungrounded origin
        of any partial answer — not just refuse to answer."""
        default = chatqna_module._DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS
        lowered = default.lower()
        # At least one signal of the disclaimer pattern: training-data
        # provenance, verified-source qualifier, knowledge-base scope, or
        # sufficiency check.
        assert any(
            needle in lowered for needle in ("general ai training", "verified source", "knowledge base", "sufficient")
        )

    def test_default_does_not_say_cannot_answer(self):
        """A blanket "cannot answer" wording would discard partial KB
        content; the disclaimer pattern is the project-wide default."""
        default = chatqna_module._DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS
        assert "cannot answer" not in default.lower()

    def test_default_bracketed_with_no_relevant_documents_header(self):
        """Header convention `[No Relevant Documents Found]` so the LLM
        can spot it as a post-retrieval note."""
        default = chatqna_module._DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS
        assert "[No Relevant Documents Found]" in default

    def test_env_override_takes_precedence_over_default(self):
        """When CHATQNA_ABSTENTION_INSTRUCTIONS is set, the env value is
        used — the default is only the fallback. Pin the priority at the
        constant read site."""
        from chatqna import genieai_chatqna as mod

        # Simulate an override via direct attribute injection (the constants
        # are read at module import; this test verifies the constant
        # structure, not the runtime env re-read).
        sentinel = "CUSTOM_OVERRIDE"
        original = mod.CHATQNA_ABSTENTION_INSTRUCTIONS
        try:
            mod.CHATQNA_ABSTENTION_INSTRUCTIONS = sentinel
            chosen = (
                mod.CHATQNA_ABSTENTION_INSTRUCTIONS
                if mod.CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                else mod._DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS
            )
            assert chosen == sentinel
        finally:
            mod.CHATQNA_ABSTENTION_INSTRUCTIONS = original


# ===========================================================================
# Query-translation status on the response and the orchestrate span
# ===========================================================================
async def _full_flow_payload(svc, *, stream, language="es", history_status=None, messages=None):
    """Drive handle_request end to end with the history translation mocked.

    `history_status` is the (text, status) tuple the history-translation
    helper reports; None leaves the real helper in place (used by the
    passthrough cases, which never reach it). `messages` overrides the
    request's message list; None keeps the Spanish-query default.
    """
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return (
            {
                "retriever": {"retrieved_docs": []},
                "rerank": {"retrieved_docs": []},
                "llm": {"text": "English answer"},
            },
            None,
        )

    svc.megaservice.schedule = fake_schedule
    if history_status is not None:
        svc._get_translated_history_string = AsyncMock(return_value=history_status)

    async def fake_translate(text, iso_code, **_kwargs):
        return f"[{iso_code}]{text}"

    svc._translate_with_chunking = fake_translate

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=messages or [{"role": "user", "content": "qué es X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    patches = [
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=stream, language=language, **({"messages": messages} if messages else {})),
    ]
    with contextlib.ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        return await svc.handle_request(req)


@pytest.mark.asyncio
async def test_a_fallback_query_translation_is_flagged_in_the_response_metadata():
    """The caller of a chat turn has to be able to tell an English embedding
    query from a Spanish one: a timeout fallback is flagged, not silent."""
    svc = create_chatqna_service()
    payload = await _full_flow_payload(svc, stream=False, history_status=("USER: qué es X?", "fallback_timeout"))
    assert payload["metadata"]["query_translation_status"] == "fallback_timeout"


@pytest.mark.asyncio
async def test_a_translated_query_is_flagged_in_the_response_metadata():
    svc = create_chatqna_service()
    payload = await _full_flow_payload(svc, stream=False, history_status=("USER: what is X?", "translated"))
    assert payload["metadata"]["query_translation_status"] == "translated"


@pytest.mark.asyncio
async def test_an_english_query_reports_passthrough_english():
    """No translation asked for is a status too: 'no source language' must be
    distinguishable from 'translated'."""
    svc = create_chatqna_service()
    payload = await _full_flow_payload(svc, stream=False, language="en")
    assert payload["metadata"]["query_translation_status"] == "passthrough_english"


@pytest.mark.asyncio
async def test_an_undetectable_query_reports_passthrough_unknown_language():
    """A query whose language nobody could name is embedded as-is too — but
    it must not be reported as if it were English (detection-healthy
    passthrough), or the runbook filter misses exactly these turns."""
    svc = create_chatqna_service()
    payload = await _full_flow_payload(svc, stream=False, language=None, messages=[{"role": "user", "content": ""}])
    assert payload["metadata"]["query_translation_status"] == "passthrough_unknown_language"


@pytest.mark.asyncio
async def test_a_refused_language_with_nothing_to_detect_reports_unknown_not_english():
    """A refused request code falls back to 'EN' for the ANSWER side; the
    query status must not inherit that fabrication: nobody ever established
    the query was English."""
    svc = create_chatqna_service()
    payload = await _full_flow_payload(svc, stream=False, language="xx", messages=[{"role": "user", "content": ""}])
    assert payload["metadata"]["query_translation_status"] == "passthrough_unknown_language"


@pytest.mark.asyncio
async def test_a_detected_english_query_reports_passthrough_english():
    """No language declared, detection concludes English: the query IS
    English, so the status must say so — not 'unknown', which would flag
    every ordinary English turn."""
    svc = create_chatqna_service()
    with patch("chatqna.genieai_chatqna.detect", return_value="en"):
        payload = await _full_flow_payload(
            svc, stream=False, language=None, messages=[{"role": "user", "content": "what is X?"}]
        )
    assert payload["metadata"]["query_translation_status"] == "passthrough_english"


@pytest.mark.asyncio
async def test_a_crashed_detection_reports_unknown_not_english():
    """A detection that crashes leaves the answer side on its English
    fallback; the query status must not inherit that fabrication."""
    svc = create_chatqna_service()
    with patch("chatqna.genieai_chatqna.detect", side_effect=RuntimeError("detector exploded")):
        payload = await _full_flow_payload(
            svc, stream=False, language=None, messages=[{"role": "user", "content": "what is X?"}]
        )
    assert payload["metadata"]["query_translation_status"] == "passthrough_unknown_language"


@pytest.mark.asyncio
async def test_a_whitespace_declared_language_is_no_establishment():
    """A blank language value resolves to 'no language asked for'; if the
    detection then crashes, the fabricated English fallback must not be
    read as an established English declaration."""
    svc = create_chatqna_service()
    with patch("chatqna.genieai_chatqna.detect", side_effect=RuntimeError("detector exploded")):
        payload = await _full_flow_payload(
            svc, stream=False, language="  ", messages=[{"role": "user", "content": "what is X?"}]
        )
    assert payload["metadata"]["query_translation_status"] == "passthrough_unknown_language"


@pytest.mark.asyncio
async def test_the_query_translation_status_reaches_the_orchestrate_span(captured_spans):
    """The span attribute is the operator's answer to 'why is retrieval bad
    on this Spanish query' — it must carry what the embedder actually got,
    and only values the shared vocabulary names."""
    svc = create_chatqna_service()
    payload = await _full_flow_payload(svc, stream=False, history_status=("USER: qué es X?", "fallback_timeout"))
    assert payload["metadata"]["query_translation_status"] == "fallback_timeout"
    (orchestrate,) = captured_spans("chatqna.orchestrate")
    from core.span_attrs import ATTRIBUTE_NAMES as A
    from core.span_attrs import QUERY_TRANSLATION_STATUSES

    status = orchestrate.attributes[A["rag_translation_query_status"]]
    assert status == "fallback_timeout"
    assert status in QUERY_TRANSLATION_STATUSES


# ===========================================================================
# Test reranker input-too-long abstention (422 body through align_outputs)
# ===========================================================================
# The 422 body the reranker microservice returns for oversized input. OPEA
# v1.5's ServiceOrchestrator.execute() does NOT check HTTP status (no
# raise_for_status), so this dict reaches align_outputs as the reranker
# node's "successful" output — the detection must live there.
RERANK_422_BODY = {
    "detail": {
        "error_type": chatqna_module._RERANKER_INPUT_TOO_LONG_TYPE,
        "error": "TEI rejected input: Given: 19505 tokens, max-client-input-length 8192",
    }
}


def test_align_outputs_raises_on_reranker_422_body():
    """align_outputs(RERANK) must raise _RerankerInputTooLongError when the
    node output is the reranker's 422 error body — schedule() never sees an
    exception from the orchestrator, so this is the only production
    detection point."""
    self_mock = MagicMock()
    self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
    with (
        patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
        pytest.raises(chatqna_module._RerankerInputTooLongError, match="TEI rejected input"),
    ):
        align_outputs(self_mock, RERANK_422_BODY, "rerank_node", {}, MagicMock(), {})


def test_align_outputs_passes_through_normal_rerank_output():
    """The detection must not fire on normal reranker output dicts (no
    'detail' key) — regression guard against an over-broad check."""
    self_mock = MagicMock()
    self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
    data = {"reranked_docs": [{"text": "doc1", "score": 0.95}]}
    inputs = {"initial_query": "test", "retrieved_docs": [{"id": "d1", "text": "doc1"}]}
    with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
        result = align_outputs(self_mock, data, "rerank_node", inputs, MagicMock(), {})
    assert len(result["retrieved_docs"]) == 1


@pytest.mark.asyncio
async def test_reranker_input_too_long_returns_abstention():
    """When schedule() raises the typed marker (align_outputs detected the
    reranker node's 422 body — see the align_outputs tests above), chatqna
    must return an abstention response (HTTP 200, abstained=True), NOT
    propagate the error as a 500 to the user."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def _raise_marker(*_args, **_kwargs):
        raise chatqna_module._RerankerInputTooLongError("TEI rejected input")

    svc.megaservice.schedule = _raise_marker

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"]["abstained"] is True
    assert payload["metadata"]["abstention_reason"] == "reranker_input_too_long"
    assert payload["metadata"]["is_grounded"] is False
    assert payload["metadata"]["source_documents"] == []
    assert payload["metadata"]["confidence_score"] == 0.0
    assert payload["metadata"]["retrieval_confidence_score"] == 0.0
    assert "exceed the reranker's input limit" in payload["response"]


@pytest.mark.asyncio
async def test_reranker_input_too_long_abstention_path_translation_overflow_falls_back_to_english():
    """When the reranker abstention path fires for a non-EN query and the
    translation service rejects the abstention text for exceeding the
    model's context window, the user still gets the contract-promised
    HTTP 200 + abstained=True + abstention_reason=reranker_input_too_long
    with the English source text and `translation_status="failed"` flagged
    in metadata.
    """
    from chatqna.genieai_chatqna import TranslationInputTooLongError

    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def _raise_marker(*_args, **_kwargs):
        raise chatqna_module._RerankerInputTooLongError("TEI rejected input")

    svc.megaservice.schedule = _raise_marker

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "qué es X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        patch.object(
            svc,
            "_finalize_llm_response",
            new=AsyncMock(side_effect=TranslationInputTooLongError("abstention text overflow")),
        ),
        _patched_chat_request(stream=False, language="es"),
    ):
        payload = await svc.handle_request(req)

    # Contract: HTTP 200 + abstained=True preserved on the abstention path,
    # and the response is the English source (not a half-translated / English
    # fallback as before) with translation_status="failed" surfaced.
    assert payload["metadata"]["abstained"] is True
    assert payload["metadata"]["abstention_reason"] == "reranker_input_too_long"
    assert payload["metadata"]["translation_status"] == "failed"
    assert "exceed the reranker's input limit" in payload["response"]


@pytest.mark.asyncio
async def test_non_streaming_answer_reports_that_it_was_translated():
    """The answer the caller reads is in the language it asked for, or it is
    not — `translation_status` says which. A caller that asked for a
    translation and got the English answer has to be able to tell."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return (
            {
                "retriever": {"retrieved_docs": []},
                "rerank": {"retrieved_docs": []},
                "llm": {"text": "English answer"},
            },
            None,
        )

    svc.megaservice.schedule = fake_schedule
    # The history is normalized to English for the retriever: that translation
    # is not the answer's translation, and it is not what this contract is about.
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    async def fake_translate(text, iso_code, **_kwargs):
        return f"[{iso_code}]{text}"

    svc._translate_with_chunking = fake_translate

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "qué es X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False, language="es"),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"]["translation_status"] == "ok"
    assert payload["response"] == "[ES]English answer"


@pytest.mark.parametrize(
    "nodes,expect_reason",
    [
        # The label filter matched zero documents: the answer is an abstention.
        (
            {"retriever": {"retrieved_docs": [], "file_id_pairs": {}}, "rerank": {"retrieved_docs": []}},
            "no_documents_retrieved",
        ),
        # The retriever DID match documents and the reranker rejected them all:
        # also an abstention (align_outputs instructs the model to abstain when
        # its document list is empty), but with its own cause — reporting it as
        # "matched nothing" would send the operator after a label that is not
        # stale.
        (
            {
                "retriever": {"retrieved_docs": [{"id": "d1", "text": "doc"}], "file_id_pairs": {}},
                "rerank": {"retrieved_docs": []},
            },
            "reranker_selected_nothing",
        ),
    ],
    ids=["scope_matched_nothing", "reranker_dropped_every_document"],
)
@pytest.mark.asyncio
async def test_non_streaming_abstention_follows_the_retrieval(nodes, expect_reason):
    """The non-streaming metadata must say whether the turn abstained: the
    operator cannot tell an abstention from an ordinary answer by reading the
    response, and the flag is only truthful if it follows the retrieval."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return ({**nodes, "llm": {"text": "I cannot answer that"}}, None)

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"]["abstained"] is True
    assert payload["metadata"]["abstention_reason"] == expect_reason


@pytest.mark.asyncio
async def test_a_malformed_retriever_output_is_not_reported_as_an_abstention():
    """A retriever node result without retrieved_docs is a fault, not a scope
    that matched nothing: claiming an abstention about it would send the
    operator after the taxonomy while the real problem is the pipeline shape.
    The same conservative call the grounding decision makes."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return ({"retriever": {"error": "shape changed"}, "llm": {"text": "an answer"}}, None)

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"].get("abstained") is not True


@pytest.mark.asyncio
async def test_the_metadata_carries_the_labels_the_retrieval_filtered_on():
    """The Inspector reads the scope from the metadata, so the metadata has
    to carry the labels the pipeline filtered on — by the pipeline's own rule
    (core.label_contract): the service is the narrower scope, the category
    must not widen it."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return (
            {"retriever": {"retrieved_docs": [], "file_id_pairs": {}}, "llm": {"text": "I cannot answer that"}},
            None,
        )

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    context = MagicMock()
    context.model_dump.return_value = {"categoryLabel": "Taxes & Revenue", "serviceLabels": ["Tax Payment"]}

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False, context=context),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"]["filter_labels"] == ["Tax Payment"]


@pytest.mark.asyncio
async def test_an_unfiltered_query_carries_no_filter_labels():
    """A query the backend sent without any context (the single-message mode)
    filtered nothing: the metadata says so with an empty list."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return (
            {"retriever": {"retrieved_docs": [], "file_id_pairs": {}}, "llm": {"text": "I cannot answer that"}},
            None,
        )

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"]["filter_labels"] == []


@pytest.mark.asyncio
async def test_the_abstention_flag_follows_the_abstention_enforcement(monkeypatch):
    """A deployment that turned the guardrail off answers instead of
    abstaining: the flag must not claim an abstention that never happened.
    The field means "the turn abstained" everywhere else (the backend's
    contract comment says so)."""
    monkeypatch.setattr(chatqna_module, "CHATQNA_ENFORCE_ABSTENTION", "false")

    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return ({"retriever": {"retrieved_docs": [], "file_id_pairs": {}}, "llm": {"text": "Here is an answer"}}, None)

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"].get("abstained") is not True


@pytest.mark.parametrize(
    "retriever_docs,expected,expected_reason",
    [
        ([], "true", "no_documents_retrieved"),
        ([{"id": "d1", "text": "doc"}], "false", ""),
    ],
    ids=["scope_matched_nothing", "scope_matched_something"],
)
@pytest.mark.asyncio
async def test_the_metric_counts_the_abstentions_it_reports(monkeypatch, retriever_docs, expected, expected_reason):
    """The counter and the payload must agree: an operator reading
    genie_ai_chat_request_total{abstained="true"} must be counting the same
    turns the Inspector marks — and the cause rides on the same attribute
    set, so a spike can be split into stale scopes vs an over-rejecting
    reranker without querying the collection."""
    recorded = []

    class _Counter:
        def add(self, amount, attributes):
            recorded.append(attributes)

    monkeypatch.setattr(chatqna_module, "chat_requests_total", _Counter())

    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return (
            {
                "retriever": {"retrieved_docs": retriever_docs, "file_id_pairs": {}},
                "llm": {"text": "an answer"},
            },
            None,
        )

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        await svc.handle_request(req)

    assert recorded[-1]["abstained"] == expected
    assert recorded[-1]["abstention_reason"] == expected_reason


@pytest.mark.asyncio
async def test_non_streaming_answer_reports_a_refused_language():
    """A language the map does not know cannot steer the answer: the answer
    stays in English. The caller asked for a translation and did not get one,
    so it has to be told — an English answer that looks translated is the
    failure this signal exists for."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def fake_schedule(**_kwargs):
        return (
            {
                "retriever": {"retrieved_docs": []},
                "rerank": {"retrieved_docs": []},
                "llm": {"text": "English answer"},
            },
            None,
        )

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    async def fake_translate(text, iso_code, **_kwargs):
        raise AssertionError("a refused language must not reach the translator")

    svc._translate_with_chunking = fake_translate

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "qué es X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False, language="zz"),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"]["translation_status"] == "refused"
    assert payload["response"] == "English answer"


@pytest.mark.asyncio
async def test_reranker_input_too_long_stream_returns_sse():
    """stream=True abstention must use the same SSE envelope as a normal
    streamed answer: one content event, the metadata event, then [DONE]."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    async def _raise_marker(*_args, **_kwargs):
        raise chatqna_module._RerankerInputTooLongError("TEI rejected input")

    svc.megaservice.schedule = _raise_marker

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    from fastapi.responses import StreamingResponse

    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=True),
    ):
        resp = await svc.handle_request(req)

    assert isinstance(resp, StreamingResponse)
    events = [chunk.decode("utf-8") if isinstance(chunk, bytes) else str(chunk) async for chunk in resp.body_iterator]
    assert any("exceed the reranker's input limit" in e for e in events)
    metadata_events = [json.loads(e[len("data: ") :]) for e in events if e.startswith("data: {")]
    assert metadata_events[0]["abstained"] is True
    assert metadata_events[0]["abstention_reason"] == "reranker_input_too_long"
    assert events[-1].strip() == "data: [DONE]"


@pytest.mark.asyncio
async def test_a_streamed_turn_reports_the_abstention_the_metric_counts():
    """The streamed metadata event and the counter must come from ONE
    computation of the abstention outcome: handle_request derives it once for
    the metric and passes it into the stream wrapper, so
    genie_ai_chat_request_total{abstained="true"} and the Inspector flag
    cannot disagree for the same turn."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    from fastapi.responses import StreamingResponse

    async def _token_stream():
        yield b"data: b'I cannot answer that'\n\n"

    async def fake_schedule(**_kwargs):
        return (
            {
                "retriever": {"retrieved_docs": [], "file_id_pairs": {}},
                "rerank": {"retrieved_docs": []},
                "llm": StreamingResponse(_token_stream(), media_type="text/event-stream"),
            },
            None,
        )

    svc.megaservice.schedule = fake_schedule
    svc._get_translated_history_string = AsyncMock(return_value=("USER: what is X?", "translated"))

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )

    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        # language="en" pins the passthrough: langdetect on a short string is
        # not deterministic, and this test is about the abstention flag.
        _patched_chat_request(stream=True, language="en"),
    ):
        resp = await svc.handle_request(req)

    assert isinstance(resp, StreamingResponse)
    events = [chunk.decode("utf-8") if isinstance(chunk, bytes) else str(chunk) async for chunk in resp.body_iterator]
    metadata_events = [json.loads(e[len("data: ") :]) for e in events if e.startswith("data: {")]
    assert metadata_events[0]["abstained"] is True
    assert metadata_events[0]["abstention_reason"] == "no_documents_retrieved"
    # An English query never reaches the history translator: the abstention
    # metadata still says so, rather than omitting the field.
    assert metadata_events[0]["query_translation_status"] == "passthrough_english"


def _fake_parms(**_kwargs):
    """Stand-in for the Genieai*Parms classes in handle_request tests.

    Under the comps mock, subclassing a MagicMock yields a mock whose
    side_effect allows exactly ONE call per class definition — a second
    handle_request() in the same interpreter would raise StopIteration.
    """
    from types import SimpleNamespace

    return SimpleNamespace(search_type="hybrid")


def _patched_chat_request(**attrs):
    """Patch ChatCompletionRequest.model_validate to a controllable mock.

    Under the comps mock the parsed request is a bare MagicMock, so the
    boolean/None fields handle_request branches on (``stream``, ``context``,
    ``language``) are truthy Mocks — configure them explicitly per test.
    """
    defaults = {
        "stream": False,
        "context": None,
        "language": None,
        "messages": [{"role": "user", "content": "what is X?"}],
    }
    defaults.update(attrs)
    return patch.object(chatqna_module.ChatCompletionRequest, "model_validate", return_value=MagicMock(**defaults))


@pytest.mark.asyncio
async def test_reranker_input_too_long_defensive_chain_walk():
    """Defensive backup path: if a future OPEA version DOES raise on HTTP
    4xx and wraps the reranker's HTTPException, the chain walk in
    handle_request still maps the marker onto the abstention handler."""
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    # Simulate the orchestrator wrapping the reranker's HTTPException in
    # an arbitrary exception whose message carries the recognisable marker.
    class _WrappedOrchestratorError(Exception):
        pass

    async def _raise_wrapped(*_args, **_kwargs):
        raise _WrappedOrchestratorError(
            "downstream service returned HTTP 422: "
            '{"error": "TEI rejected input: Given: 19505", "error_type": "RerankerInputTooLong"}'
        )

    svc.megaservice.schedule = _raise_wrapped

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        payload = await svc.handle_request(req)

    assert payload["metadata"]["abstained"] is True
    assert payload["metadata"]["abstention_reason"] == "reranker_input_too_long"
    assert "exceed the reranker's input limit" in payload["response"]


@pytest.mark.asyncio
async def test_tokenize_failure_mid_truncation_loop_fails_the_request_503(monkeypatch):
    """Composition: the REAL ``_count_tokens`` (only httpx is mocked) runs
    inside ``align_inputs``' truncation loop and dies on a history-segment
    count, with one segment already accepted.

    The loop tests fake the counter and the counter tests run standalone, so
    before this test nothing pinned what a mid-loop transport failure does to
    the request. The contract: the request fails with the classified 503
    (``llm_unavailable``), the transport error rides as ``__cause__``, and no
    partially truncated history escapes as a response.
    """
    chatqna_module._count_static_tokens.cache_clear()

    recorded = []

    class _Counter:
        def add(self, amount, attributes):
            recorded.append(attributes)

    monkeypatch.setattr(chatqna_module, "chat_requests_total", _Counter())
    truncation_counter = MagicMock()
    monkeypatch.setattr(chatqna_module, "history_truncation_total", truncation_counter)

    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})
    svc.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}

    async def fake_history(history, source_lang_code="en"):
        blob = "USER: HISTTOK-1 |<-MSG->| USER: HISTTOK-2 |<-MSG->| USER: HISTTOK-3 |<-MSG->| USER: HISTTOK-4"
        return (blob, "translated")

    svc._get_translated_history_string = fake_history

    tokenize_calls = []

    def fake_post(url, headers=None, json=None, timeout=None, verify=None):
        prompt = json["prompt"]
        tokenize_calls.append(prompt)
        # The user content carries the whole history, so a segment prompt is
        # recognised by the absence of the RAG text, not by the marker alone.
        if "HISTTOK-3" in prompt and "RAGTOK" not in prompt:
            raise httpx.ConnectError("vLLM died mid-loop")
        if "RAGTOK" in prompt:
            # 100 per RAGTOK occurrence, 510 per history segment carried in
            # the same prompt, +10 base (mirrors _counting_tokenizer).
            count = 100 * prompt.count("RAGTOK") + 10 + 510 * prompt.count("HISTTOK-")
        elif "HISTTOK" in prompt:
            count = 510
        else:
            count = 10  # the bare system prompt
        return MagicMock(json=lambda: {"count": count})

    async def fake_schedule(initial_inputs=None, llm_parameters=None, genie_params=None, **_kw):
        # comps calls align_inputs for every node inside schedule() and returns
        # (result_dict, runtime_graph); this stub replays that call shape for
        # the LLM node. The propagation it models is UNWRAPPED: the vendored
        # comps orchestrator is known to wrap some node exceptions (the
        # reranker's HTTPException — see handle_request's chain walk), and if
        # it wraps align_inputs errors the same way, production would classify
        # differently from this pin — unobservable from this suite.
        return (
            align_inputs(
                svc,
                {"inputs": "RAGTOK" * 5, "stream": False, "frequency_penalty": 0.0, "temperature": 0.7},
                "llm_node",
                MagicMock(),
                {"max_tokens": 256, "top_p": 0.9},
                full_chat_history_string=genie_params["full_chat_history_string"],
            ),
            MagicMock(),
        )

    svc.megaservice.schedule = fake_schedule

    models_resp = MagicMock()
    models_resp.json.return_value = {"data": [{"id": "m", "max_model_len": 2048}]}
    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    # The lru_cache cleanup runs in a teardown, not a trailing line: this is
    # the one test that runs the REAL ``_count_static_tokens`` against a
    # mocked transport, and a cached system-prompt count left behind by an
    # assertion failure would hand the next real-counter test a number its
    # own mocks never produced — two failures where there is one.
    try:
        with (
            patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
            patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
            patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
            _patched_chat_request(stream=False, max_tokens=256),
            patch.object(chatqna_module, "detect", return_value="fr"),
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("httpx.post", side_effect=fake_post),
            patch("httpx.get", return_value=models_resp),
            pytest.raises(HTTPException) as exc_info,
        ):
            await svc.handle_request(req)

        assert exc_info.value.status_code == 503
        assert exc_info.value.detail == "llm_unavailable"
        # The classified 503 wraps the transport error that killed the loop.
        assert isinstance(exc_info.value.__cause__, httpx.HTTPError)
        # Died INSIDE the truncation loop: system prompt, user content and
        # skeleton were counted first; HISTTOK-4 was accepted; HISTTOK-3's call
        # is the one that failed.
        assert len(tokenize_calls) == 5
        assert "HISTTOK-4" in tokenize_calls[3]
        assert "HISTTOK-3" in tokenize_calls[4]
        # No partial-history response escaped: the loop never reached its
        # bookkeeping, and the request exited through the classified error branch.
        truncation_counter.add.assert_not_called()
        assert recorded[-1]["error"] == "true"
    finally:
        chatqna_module._count_static_tokens.cache_clear()


@pytest.mark.asyncio
async def test_a_refused_language_leaves_the_answer_in_english_and_still_normalizes_the_history():
    """A language the map does not know says nothing about the language the
    user writes in.

    The answer stays in English — a refused language must not steer it — but
    the history is still translated to English, so it lands in the
    English-only embedding space the retriever searches.
    """
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    history_calls = []
    scheduled = {}

    async def fake_history(history, source_lang_code="en"):
        history_calls.append(source_lang_code)
        return ("USER: qu'est-ce que X ?", "translated")

    svc._get_translated_history_string = fake_history

    async def fake_schedule(initial_inputs=None, llm_parameters=None, genie_params=None, **_kwargs):
        scheduled["original_language"] = genie_params.get("original_language")
        raise RuntimeError("stop right after the language decision")

    svc.megaservice.schedule = fake_schedule

    req = create_mock_request(
        data=create_mock_chat_request_data(
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        patch.object(chatqna_module, "detect", return_value="fr"),
        _patched_chat_request(
            stream=False,
            context=MagicMock(language="zz-not-a-language"),
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        contextlib.suppress(Exception),
    ):
        await svc.handle_request(req)

    assert history_calls == ["fr"]
    assert scheduled["original_language"] == "EN"


@pytest.mark.asyncio
async def test_a_refused_language_with_an_undetectable_source_still_normalizes_the_history():
    """The detected code does not have to be one the translation models cover.

    The history is translated with the detected code as the source and
    English as the target: the source names what the text is, and the
    translation model is asked for a target it knows. Dropping the code
    because the map does not list it would leave the history in its own
    language, out of the English-only embedding space.
    """
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    history_calls = []
    scheduled = {}

    async def fake_history(history, source_lang_code="en"):
        history_calls.append(source_lang_code)
        return ("USER: qu'est-ce que X ?", "translated")

    svc._get_translated_history_string = fake_history

    async def fake_schedule(initial_inputs=None, llm_parameters=None, genie_params=None, **_kwargs):
        scheduled["original_language"] = genie_params.get("original_language")
        raise RuntimeError("stop right after the language decision")

    svc.megaservice.schedule = fake_schedule

    req = create_mock_request(
        data=create_mock_chat_request_data(
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        # "ne" is a language langdetect can return that the translation
        # models do not cover.
        patch.object(chatqna_module, "detect", return_value="ne"),
        _patched_chat_request(
            stream=False,
            context=MagicMock(language="zz-not-a-language"),
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        contextlib.suppress(Exception),
    ):
        await svc.handle_request(req)

    assert history_calls == ["ne"]
    assert scheduled["original_language"] == "EN"


@pytest.mark.asyncio
async def test_a_detected_language_the_models_do_not_cover_still_normalizes_the_history():
    """The same rule, without a refused request in front of it.

    A request that names no language at all is answered in the language the
    conversation is written in, and the history is normalized to English
    whatever the detector answered — including a code the translation models
    do not cover. The answer stays in English (the models cannot write in the
    detected language), the history is translated all the same: dropping the
    detected code would leave the history in its own language, out of the
    English-only embedding space.
    """
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    history_calls = []
    scheduled = {}

    async def fake_history(history, source_lang_code="en"):
        history_calls.append(source_lang_code)
        return ("USER: qu'est-ce que X ?", "translated")

    svc._get_translated_history_string = fake_history

    async def fake_schedule(initial_inputs=None, llm_parameters=None, genie_params=None, **_kwargs):
        scheduled["original_language"] = genie_params.get("original_language")
        raise RuntimeError("stop right after the language decision")

    svc.megaservice.schedule = fake_schedule

    req = create_mock_request(
        data=create_mock_chat_request_data(
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        # "ne" is a language langdetect can return that the translation
        # models do not cover.
        patch.object(chatqna_module, "detect", return_value="ne"),
        _patched_chat_request(
            stream=False,
            context=MagicMock(language=None),
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        contextlib.suppress(Exception),
    ):
        await svc.handle_request(req)

    assert history_calls == ["ne"]
    assert scheduled["original_language"] == "EN"


@pytest.mark.asyncio
async def test_a_refused_language_with_a_failing_detection_leaves_the_history_alone():
    """A detection that raises leaves the history untranslated, not the
    request broken.

    Without a detected code there is nothing to translate the history from,
    so it is flattened as it is and the request carries on.
    """
    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

    history_calls = []
    scheduled = {}

    async def fake_history(history, source_lang_code="en"):
        history_calls.append(source_lang_code)
        return ("USER: qu'est-ce que X ?", "translated")

    svc._get_translated_history_string = fake_history

    async def fake_schedule(initial_inputs=None, llm_parameters=None, genie_params=None, **_kwargs):
        scheduled["original_language"] = genie_params.get("original_language")
        raise RuntimeError("stop right after the language decision")

    svc.megaservice.schedule = fake_schedule

    req = create_mock_request(
        data=create_mock_chat_request_data(
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        patch.object(chatqna_module, "detect", side_effect=RuntimeError("detector is down")),
        _patched_chat_request(
            stream=False,
            context=MagicMock(language="zz-not-a-language"),
            messages=[{"role": "user", "content": "qu'est-ce que X ?"}],
        ),
        contextlib.suppress(Exception),
    ):
        await svc.handle_request(req)

    assert history_calls == []
    assert scheduled["original_language"] == "EN"
