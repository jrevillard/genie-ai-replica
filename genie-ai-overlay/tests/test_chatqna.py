# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import copy
from datetime import date
from enum import Enum
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

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
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
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
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
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
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=True),
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
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
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
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
            patch("chatqna.genieai_chatqna.TRANSLATION_LLM_URL", "http://localhost/v1/chat/completions"),
        ):
            result = await svc._translate_text_chunk("Original text", "French")
        assert result == "Original text"

    @pytest.mark.asyncio
    async def test_translate_text_chunk_timeout_returns_original(self):
        svc = create_chatqna_service()
        with (
            patch("chatqna.genieai_chatqna.httpx.AsyncClient", side_effect=TimeoutError("Request timed out")),
            patch("chatqna.genieai_chatqna._is_translategemma", return_value=False),
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
        metadata = {"success": True, "data": {"categoryLabels": "Health", "serviceLabels": ["H1"]}}
        mock_session, mock_timeout = create_mock_aiohttp_session(status=200, json_data=metadata)
        with (
            patch("chatqna.genieai_chatqna.aiohttp.ClientSession", return_value=mock_session),
            patch("chatqna.genieai_chatqna.aiohttp.ClientTimeout", return_value=mock_timeout),
        ):
            result = await svc.fetch_file_metadata("file123")
        assert result == {"categoryLabels": "Health", "serviceLabels": ["H1"]}

    @pytest.mark.asyncio
    async def test_empty_file_id_returns_default(self):
        svc = create_chatqna_service()
        result = await svc.fetch_file_metadata("")
        assert result == {"categoryLabels": None, "serviceLabels": []}

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
        # Rank-weighted confidence (CONFIDENCE_RANK_DECAY default 0.5): the top doc
        # (0.95) dominates the second (0.85), so the result (~0.91) sits above the
        # flat mean (0.90) and below the top score — richer context is no longer
        # punished by a tail of lower scores.
        assert round(confidence, 2) == 0.91
        assert 0.90 < confidence < 0.95
        assert [d["document_id"] for d in docs] == ["f1", "f2"]
        assert [round(d["score"], 2) for d in docs] == [0.95, 0.85]

    @pytest.mark.asyncio
    async def test_metadata_failure_excludes_doc_and_does_not_zero_confidence(self):
        """D1 regression: a failed metadata lookup must neither surface a fake
        'error' source document nor inject score=0 into the confidence aggregation.
        Previously the else-branch fell through to ``scores.append(0)``, which
        tanked the mean whenever the document-repository metadata call failed."""
        svc = create_chatqna_service()
        # f1 metadata resolves; f2 metadata fetch fails (returns None).
        svc.fetch_file_metadata = AsyncMock(side_effect=[{"labels": ["Beekeeping"], "file_name": "bee.pdf"}, None])
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 0.95},
                {"id": "d2", "text": "honey", "score": 0.85},
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f2"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
        # Only the resolvable doc is surfaced; no synthetic 'error' document.
        assert [d["document_id"] for d in docs] == ["f1"]
        assert all(d["document_id"] != "error" for d in docs)
        # Confidence reflects the kept doc only (0.95), NOT the bug's (0.95+0.0)/2.
        assert round(confidence, 2) == 0.95
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
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
        # Per-doc displayed scores are the calibrated values, not the raw logits.
        assert 0.880 <= docs[0]["score"] <= 0.881  # sigmoid(2.0) ~ 0.8808
        assert docs[1]["score"] == 0.5
        assert grounded is True

    @pytest.mark.asyncio
    async def test_all_metadata_fail_forces_not_grounded(self):
        """When the reranker found docs but none resolve to sources (e.g. a
        document-repository outage), is_grounded is forced False so the UI does
        not claim backing that is absent."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value=None)  # every lookup fails
        result_dict = self._result_dict(
            rerank_verdict=[{"id": "d1", "text": "hives", "score": 0.95}],
            retrieved_docs=[{"id": "d1", "text": "hives"}],
            file_id_pairs={"d1": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
        assert docs == []
        assert confidence == 0.0
        assert grounded is False

    @pytest.mark.asyncio
    async def test_duplicate_of_failed_metadata_does_not_inject_score(self):
        """M3: a duplicate of a file whose metadata failed must not contribute its
        score to the aggregation while the file remains invisible. The file_id is
        marked surfaced only after a successful metadata lookup, so the duplicate
        re-attempts (and re-fails) instead of being counted as a dedup hit."""
        svc = create_chatqna_service()
        svc.fetch_file_metadata = AsyncMock(return_value=None)  # all lookups fail
        result_dict = self._result_dict(
            rerank_verdict=[
                {"id": "d1", "text": "hives", "score": 0.95},
                {"id": "d2", "text": "honey", "score": 0.80},  # same file f1
            ],
            retrieved_docs=[{"id": "d1", "text": "hives"}, {"id": "d2", "text": "honey"}],
            file_id_pairs={"d1": "f1", "d2": "f1"},
        )
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
        assert docs == []  # nothing surfaced
        assert confidence == 0.0  # no invisible-doc score counted
        assert grounded is False

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
        docs, confidence, grounded = await svc._assemble_source_documents(result_dict)
        # One source row (deduped), but both scores count toward confidence.
        assert [d["document_id"] for d in docs] == ["f1"]
        assert 0.90 < confidence < 0.95  # rank-weighted over [0.95, 0.90]
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "Hello" in decoded
        assert "World" in decoded

    @pytest.mark.asyncio
    async def test_strips_separator_split_across_chunks(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("Hello |<-M"), self._chunk("SG->| World"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "Hello" in decoded
        assert "World" in decoded

    @pytest.mark.asyncio
    async def test_strips_user_role_marker_after_separator(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("|<-MSG->| USER: what is genai?"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "USER:" not in decoded
        assert "what is genai?" in decoded

    @pytest.mark.asyncio
    async def test_strips_assistant_role_marker(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("|<-MSG->| ASSISTANT: it is ai."), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
        decoded = self._decode_content(out)
        assert decoded.startswith("a")
        assert decoded.endswith("b")

    @pytest.mark.asyncio
    async def test_preserves_normal_content_unchanged(self):
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("The capital of France is Paris."), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
        assert self._decode_content(out) == "The capital of France is Paris."

    @pytest.mark.asyncio
    async def test_preserves_pipe_in_normal_content(self):
        # A lone "|" that is NOT part of the separator must survive.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("Use cmd | grep | sort"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
        assert self._decode_content(out) == "Use cmd | grep | sort"

    @pytest.mark.asyncio
    async def test_partial_separator_at_stream_end_emitted_as_literal(self):
        # Characters that look like the start of a separator but never complete
        # are real content and must be flushed, not silently dropped.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body([self._chunk("result |<-M"), "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
        assert self._decode_content(out) == "result |<-M"

    @pytest.mark.asyncio
    async def test_unparseable_chunk_forwarded_verbatim(self):
        # A chunk not in the data: b'...' format must pass through untouched so
        # an unexpected orchestrator format never breaks the stream.
        svc = create_chatqna_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.0, False))
        body = self._make_body(["data: not-bytes-repr\n\n", "data: [DONE]\n\n"])
        out = await self._drain(svc._stream_with_metadata(body, {}))
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
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
        out = await self._drain(svc._stream_with_metadata(body, {}))
        decoded = self._decode_content(out)
        assert "|<-MSG->|" not in decoded
        assert "Réponse" in decoded
        assert "über Straße" in decoded


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
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}))
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
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}))
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
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}))
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
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}))
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
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}))
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
        out = await TestStreamWithMetadata._drain(svc._stream_with_metadata(body, {}))
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
        svc.load_language_codes = MagicMock(return_value={})
        captured = {}

        async def fake_translate(text, target_lang, original_language):
            captured["text"] = text
            return f"[ES]{text}"

        svc._translate_with_chunking = fake_translate
        final_text, self_conf = await svc._finalize_llm_response("Respuesta.\n[[CONF:90]]", "ES")
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
        final_text, self_conf = await svc._finalize_llm_response("|<-MSG->| USER: hi\nanswer", "EN")
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
