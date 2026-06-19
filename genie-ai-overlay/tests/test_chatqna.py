# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import copy
from datetime import date
from enum import Enum
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from chatqna.genieai_chatqna import (
    ChatQnAService,
    ChatTemplate,
    GenieUserProfileClient,
    UserContextBuilder,
    align_generator,
    align_inputs,
    align_outputs,
)


# ---------------------------------------------------------------------------
# FakeServiceType — real enum for align_inputs/align_outputs comparisons
# ---------------------------------------------------------------------------
class FakeServiceType(Enum):
    TRANSLATOR = "translator"
    EMBEDDING = "embedding"
    RETRIEVER = "retriever"
    RERANK = "rerank"
    LLM = "llm"


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
    """Create a mock FastAPI Request with configurable JSON body and headers."""
    req = MagicMock()
    req.json = AsyncMock(return_value=data or {})
    req.headers = headers or {}
    return req


def create_mock_chat_request_data(**overrides):
    """Return a dict matching ChatCompletionRequest schema."""
    defaults = {
        "messages": [{"role": "user", "content": "Hello"}],
        "context": None,
        "language": None,
        "max_tokens": 1024,
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


def create_mock_service_node(service_type_value):
    """Create a mock service node with a real service_type attribute."""
    node = MagicMock()
    node.service_type = service_type_value
    return node


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
    def test_set_token_stores_token(self):
        client = GenieUserProfileClient()
        client.set_token("my-token")
        assert client._token == "my-token"

    @pytest.mark.asyncio
    async def test_get_user_profile_valid_token_returns_profile(self):
        client = GenieUserProfileClient()
        client.set_token("valid-token")
        mock_session, mock_timeout = create_mock_aiohttp_session(status=200, json_data={"firstName": "John"})
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await client.get_user_profile()
        assert result == {"firstName": "John"}

    @pytest.mark.asyncio
    async def test_get_user_profile_no_token_returns_none(self):
        client = GenieUserProfileClient()
        result = await client.get_user_profile()
        assert result is None

    @pytest.mark.asyncio
    async def test_get_user_profile_401_returns_none(self):
        client = GenieUserProfileClient()
        client.set_token("bad-token")
        mock_session, mock_timeout = create_mock_aiohttp_session(status=401)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await client.get_user_profile()
        assert result is None

    @pytest.mark.asyncio
    async def test_get_user_profile_404_returns_none(self):
        client = GenieUserProfileClient()
        client.set_token("valid-token")
        mock_session, mock_timeout = create_mock_aiohttp_session(status=404)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await client.get_user_profile()
        assert result is None

    @pytest.mark.asyncio
    async def test_get_user_profile_connection_exception_returns_none(self):
        client = GenieUserProfileClient()
        client.set_token("valid-token")
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", side_effect=Exception("Connection refused")),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=MagicMock()),
        ):
            result = await client.get_user_profile()
        assert result is None


# ===========================================================================
# Task 6: Test align_inputs() for each service type
# ===========================================================================
class TestAlignInputs:
    # --- TRANSLATOR ---
    class TestTranslatorInput:
        def test_constructs_translation_prompt(self):
            self_mock = MagicMock()
            self_mock.services = {"translator_node": create_mock_service_node(FakeServiceType.TRANSLATOR)}
            llm_params = {"max_tokens": 512}
            inputs = {"text": "Hello world"}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_inputs(self_mock, inputs, "translator_node", MagicMock(), llm_params)
            assert "messages" in result
            assert "Translate" in result["messages"][0]["content"]
            assert result["temperature"] == 0
            assert result["stream"] is False

        def test_original_language_en_sets_target_english(self):
            self_mock = MagicMock()
            self_mock.services = {"translator_node": create_mock_service_node(FakeServiceType.TRANSLATOR)}
            llm_params = {"max_tokens": 512}
            inputs = {"text": "Hola"}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_inputs(
                    self_mock,
                    inputs,
                    "translator_node",
                    MagicMock(),
                    llm_params,
                    original_language="EN",
                )
            assert "English" in result["messages"][0]["content"]

    # --- EMBEDDING ---
    class TestEmbeddingInput:
        def test_renames_text_to_input(self):
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            llm_params = {}
            inputs = {"text": "Hello", "other": "value"}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_inputs(self_mock, inputs, "embedding_node", MagicMock(), llm_params)
            assert "input" in result
            assert result["input"] == "Hello"
            assert "text" not in result

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
        def test_constructs_system_and_user_messages(self):
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "context text", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.get_tokenizer", return_value=create_mock_tokenizer({})),
            ):
                result = align_inputs(self_mock, inputs, "llm_node", MagicMock(), llm_params)
            assert "messages" in result
            assert result["messages"][0]["role"] == "system"
            assert result["messages"][1]["role"] == "user"
            assert result["max_tokens"] == 1024

        def test_token_limit_truncation(self):
            self_mock = MagicMock()
            self_mock.services = {"llm_node": create_mock_service_node(FakeServiceType.LLM)}
            llm_params = {"max_tokens": 1024, "top_p": 0.9}
            inputs = {"inputs": "rag prompt", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
            history = "USER: msg1 |<-MSG->| USER: msg2 |<-MSG->| USER: msg3"

            # System prompt is ~200 tokens, user content is ~100 tokens = ~300 total
            # With max_model_tokens=600 and max_answer_tokens=1024 → need truncation
            # max_history_tokens = 600 - 1024 - 200 = -624 (negative → truncation triggers)
            mock_tok = create_mock_tokenizer({"system": 200, "USER": 100})
            with (
                patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
                patch("chatqna.genieai_chatqna.get_tokenizer", return_value=mock_tok),
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


# ===========================================================================
# Task 7: Test align_outputs() for each service type
# ===========================================================================
class TestAlignOutputs:
    # --- TRANSLATOR ---
    class TestTranslatorOutput:
        def test_extracts_translated_text(self):
            self_mock = MagicMock()
            self_mock.services = {"translator_node": create_mock_service_node(FakeServiceType.TRANSLATOR)}
            data = {"choices": [{"message": {"content": "  Bonjour  "}}]}
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "translator_node", {}, MagicMock(), llm_params)
            assert result["text"] == "Bonjour"

    # --- EMBEDDING ---
    class TestEmbeddingOutput:
        def test_transforms_to_text_and_embedding(self):
            self_mock = MagicMock()
            self_mock.services = {"embedding_node": create_mock_service_node(FakeServiceType.EMBEDDING)}
            data = {"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]}
            inputs = {"input": "Hello"}
            llm_params = {}
            with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
                result = align_outputs(self_mock, data, "embedding_node", inputs, MagicMock(), llm_params)
            assert result["text"] == "Hello"
            assert result["embedding"] == [0.1, 0.2, 0.3]

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

        def test_forwards_embeddings_for_adaptive_reranking(self):
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            data = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": "doc1"}],
                "metadata": [{"file_ids": ["f1"]}],
                "embedding": [0.1, 0.2, 0.3],
                "chunk_embeddings": [[0.1, 0.2], [0.3, 0.4]],
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
            # Query embedding + chunk embeddings forwarded to the reranker
            assert result["embedding"] == [0.1, 0.2, 0.3]
            assert result["chunk_embeddings"] == [[0.1, 0.2], [0.3, 0.4]]

        def test_forwards_query_embedding_from_request_when_retriever_drops_it(self):
            """The request (inputs) carries the query embedding; the retriever
            response may not echo it. align_outputs must forward inputs' embedding."""
            self_mock = MagicMock()
            self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
            graph = create_mock_runtime_graph(downstream_nodes=["rerank_node"])
            data = {
                "initial_query": "test",
                "retrieved_docs": [{"id": "d1", "text": "doc1"}],
                "metadata": [{"file_ids": ["f1"]}],
                "chunk_embeddings": [[0.1, 0.2], [0.3, 0.4]],
                # NOTE: no "embedding" in data (retriever did not echo it)
            }
            inputs = {"input": "test", "embedding": [0.5, 0.6, 0.7]}  # request carries it
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
            assert "cannot answer" in result["inputs"].lower()

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
            assert "cannot answer" in result["inputs"].lower()

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
            source_lang_name="English",
            target_lang_name="French",
        )
        assert "<bos>" in prompt
        assert "<start_of_turn>" in prompt
        assert "<end_of_turn>" in prompt
        assert "Hello" in prompt
        assert "French" in prompt

    def test_load_language_codes_success(self, tmp_path):
        svc = create_chatqna_service()
        lang_file = tmp_path / "codes.json"
        lang_file.write_text('{"en": "English", "fr": "French"}')
        result = svc.load_language_codes(str(lang_file))
        assert result == {"en": "English", "fr": "French"}

    def test_load_language_codes_file_error(self):
        svc = create_chatqna_service()
        result = svc.load_language_codes("/nonexistent/path.json")
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
            patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "test-model"),
        ):
            result = await svc._get_translated_history_string("Hello world", "French")
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
            patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "test-model"),
        ):
            result = await svc._get_translated_history_string(history, "English")
        assert "Translated history" in result

    @pytest.mark.asyncio
    async def test_translate_text_chunk_translategemma_format(self):
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
            patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", True),
            patch("chatqna.genieai_chatqna.TRANSLATION_COMPLETIONS_URL", "http://localhost/v1/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "translategemma-test"),
        ):
            result = await svc._translate_text_chunk("Hello", "French", iso_code="fr")
        assert result == "Bonjour"

    @pytest.mark.asyncio
    async def test_translate_text_chunk_generic_format(self):
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
            patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
            patch("chatqna.genieai_chatqna.TRANSLATION_MODEL_ID", "test-model"),
        ):
            result = await svc._translate_text_chunk("Hello", "Spanish")
        assert result == "Hola"

    @pytest.mark.asyncio
    async def test_translate_text_chunk_error_returns_original(self):
        svc = create_chatqna_service()
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", side_effect=Exception("Connection error")),
            patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
        ):
            result = await svc._translate_text_chunk("Original text", "French")
        assert result == "Original text"

    @pytest.mark.asyncio
    async def test_translate_text_chunk_timeout_returns_original(self):
        svc = create_chatqna_service()
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", side_effect=TimeoutError("Request timed out")),
            patch("chatqna.genieai_chatqna.IS_TRANSLATEGEMMA", False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
        ):
            result = await svc._translate_text_chunk("Original text", "French")
        assert result == "Original text"

    @pytest.mark.asyncio
    async def test_translate_with_chunking(self):
        svc = create_chatqna_service()
        call_count = 0

        async def mock_translate(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return f"translated_chunk_{call_count}"

        with (
            patch.object(svc, "_split_text_into_chunks", return_value=["chunk1", "chunk2"]),
            patch.object(svc, "_translate_text_chunk", side_effect=mock_translate),
        ):
            result = await svc._translate_with_chunking("long text", "French")
        assert "translated_chunk_1" in result
        assert "translated_chunk_2" in result


# ===========================================================================
# Task 11: Test fetch_file_metadata()
# ===========================================================================
class TestFetchFileMetadata:
    @pytest.mark.asyncio
    async def test_valid_file_id_and_token(self):
        svc = create_chatqna_service()
        svc.user_profile_client.set_token("valid-token")
        metadata = {"success": True, "data": {"categoryLabel": "Health", "serviceLabels": ["H1"]}}
        mock_session, mock_timeout = create_mock_aiohttp_session(status=200, json_data=metadata)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await svc.fetch_file_metadata("file123")
        assert result == {"categoryLabel": "Health", "serviceLabels": ["H1"]}

    @pytest.mark.asyncio
    async def test_empty_file_id_returns_default(self):
        svc = create_chatqna_service()
        result = await svc.fetch_file_metadata("")
        assert result == {"categoryLabel": None, "serviceLabels": []}

    @pytest.mark.asyncio
    async def test_no_token_returns_none(self):
        svc = create_chatqna_service()
        result = await svc.fetch_file_metadata("file123")
        assert result is None

    @pytest.mark.asyncio
    async def test_http_error_returns_none(self):
        svc = create_chatqna_service()
        svc.user_profile_client.set_token("valid-token")
        mock_session, mock_timeout = create_mock_aiohttp_session(status=500)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await svc.fetch_file_metadata("file123")
        assert result is None

    @pytest.mark.asyncio
    async def test_connection_exception_returns_none(self):
        svc = create_chatqna_service()
        svc.user_profile_client.set_token("valid-token")
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", side_effect=Exception("Connection refused")),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=MagicMock()),
        ):
            result = await svc.fetch_file_metadata("file123")
        assert result is None


# ===========================================================================
# Task 12: Test _assemble_source_documents() — grounding + reranker verdict
# ===========================================================================
class TestAssembleSourceDocuments:
    """Source documents must reflect the reranker's verdict, not the retriever's
    raw cosine hits. When the reranker rejects everything, the response is flagged
    as not grounded (LLM-generated) and no documents are shown."""

    @staticmethod
    def _result_dict(rerank_verdict=None, retrieved_docs=None, file_id_pairs=None, with_reranker=True):
        rd = {
            "retriever_service": {
                "retrieved_docs": retrieved_docs or [],
                "file_id_pairs": file_id_pairs or {},
            }
        }
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
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
        assert grounded is True
        # confidence is returned unrounded; handle_request rounds it for the payload
        assert round(confidence, 2) == round((0.95 + 0.85) / 2, 2)
        assert [d["document_id"] for d in docs] == ["f1", "f2"]
        assert [round(d["score"], 2) for d in docs] == [0.95, 0.85]

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
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
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
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
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
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
        joined = "".join(out)
        assert '"is_grounded": false' in joined
        assert '"source_documents": []' in joined

    @pytest.mark.asyncio
    async def test_appends_done_if_missing(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(["data: b'Hi'\n\n"])  # no [DONE]
        out = await self._drain(svc._stream_with_metadata(body, {}))
        joined = "".join(out)
        assert '"type": "metadata"' in joined
        assert joined.rstrip().endswith("data: [DONE]")
