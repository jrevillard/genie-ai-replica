# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import pytest

from core.constants import (
    MegaServiceEndpoint,
    MicroServiceEndpoint,
    ServiceRoleType,
    ServiceType,
)
from core.genieai_api_protocol import (
    ArangoDBDataprepRequestFromDocRepo,
    ChatCompletionRequest,
    RequestContext,
    RetrievalRequestArangoDB,
    TranslationRequest,
)


# ---------------------------------------------------------------------------
# Constants: ServiceRoleType
# ---------------------------------------------------------------------------
class TestServiceRoleType:
    def test_has_two_members(self):
        assert len(ServiceRoleType) == 2

    def test_microservice_value(self):
        assert ServiceRoleType.MICROSERVICE.value == 0

    def test_megaservice_value(self):
        assert ServiceRoleType.MEGASERVICE.value == 1

    def test_values_are_int(self):
        for member in ServiceRoleType:
            assert isinstance(member.value, int)


# ---------------------------------------------------------------------------
# Constants: ServiceType
# ---------------------------------------------------------------------------
class TestServiceType:
    def test_member_count(self):
        assert len(ServiceType) == 25

    def test_key_services_exist(self):
        expected = ["EMBEDDING", "RETRIEVER", "RERANK", "LLM", "DATAPREP", "GUARDRAIL", "TRANSLATOR"]
        for name in expected:
            assert hasattr(ServiceType, name), f"Missing ServiceType.{name}"

    def test_translator_is_last(self):
        assert ServiceType.TRANSLATOR.value == 24

    def test_all_values_unique(self):
        values = [m.value for m in ServiceType]
        assert len(values) == len(set(values))

    def test_values_are_sequential_ints(self):
        values = sorted(m.value for m in ServiceType)
        assert values == list(range(len(ServiceType)))


# ---------------------------------------------------------------------------
# Constants: MegaServiceEndpoint
# ---------------------------------------------------------------------------
class TestMegaServiceEndpoint:
    def test_chat_qna_path(self):
        assert MegaServiceEndpoint.CHAT_QNA.value == "/v1/chatqna"

    def test_translation_path(self):
        assert MegaServiceEndpoint.TRANSLATION.value == "/v1/translation"

    def test_chat_completions_path(self):
        assert MegaServiceEndpoint.CHAT.value == "/v1/chat/completions"

    def test_embeddings_path(self):
        assert MegaServiceEndpoint.EMBEDDINGS.value == "/v1/embeddings"

    def test_reranking_path(self):
        assert MegaServiceEndpoint.RERANKING.value == "/v1/reranking"

    def test_str_returns_path(self):
        assert str(MegaServiceEndpoint.CHAT_QNA) == "/v1/chatqna"
        assert str(MegaServiceEndpoint.LIST_SERVICE) == "/v1/list_service"

    def test_member_count(self):
        assert len(MegaServiceEndpoint) == 26

    def test_str_returns_value_for_all_members(self):
        for member in MegaServiceEndpoint:
            assert str(member) == member.value, f"{member.name} __str__ does not return its value"


# ---------------------------------------------------------------------------
# Constants: MicroServiceEndpoint
# ---------------------------------------------------------------------------
class TestMicroServiceEndpoint:
    def test_all_prefixed_with_microservice(self):
        for member in MicroServiceEndpoint:
            assert member.value.startswith("/v1/microservice/"), f"{member.name} missing prefix"

    def test_key_endpoints(self):
        assert MicroServiceEndpoint.EMBEDDINGS.value == "/v1/microservice/embeddings"
        assert MicroServiceEndpoint.CHAT.value == "/v1/microservice/chat"
        assert MicroServiceEndpoint.RETRIEVAL.value == "/v1/microservice/retrieval"

    def test_str_returns_path(self):
        assert str(MicroServiceEndpoint.CHAT) == "/v1/microservice/chat"

    def test_member_count(self):
        assert len(MicroServiceEndpoint) == 8


# ---------------------------------------------------------------------------
# Protocol: RetrievalRequestArangoDB (OPEA base — NOT a Pydantic model)
# ---------------------------------------------------------------------------
class TestRetrievalRequestArangoDB:
    def test_construction_with_kwargs_no_error(self):
        req = RetrievalRequestArangoDB(graph_name="GRAPH_1")
        assert req is not None

    def test_construction_with_all_kwargs_no_error(self):
        req = RetrievalRequestArangoDB(
            graph_name="G",
            search_start="node",
            search_mode="vector",
            num_centroids=5,
            distance_strategy="COSINE",
            use_approx_search=True,
            enable_traversal=True,
            enable_summarizer=False,
            traversal_max_depth=3,
            traversal_max_returned=10,
            traversal_score_threshold=0.75,
            traversal_query="test query",
            context={"key": "value"},
        )
        assert req is not None

    def test_defaults_are_none(self):
        req = RetrievalRequestArangoDB()
        for field_name in [
            "graph_name",
            "search_start",
            "search_mode",
            "num_centroids",
            "distance_strategy",
            "use_approx_search",
            "enable_traversal",
            "enable_summarizer",
            "traversal_max_depth",
            "traversal_max_returned",
            "traversal_score_threshold",
            "traversal_query",
            "context",
        ]:
            assert getattr(req, field_name) is None, f"{field_name} should default to None"

    def test_has_optional_fields_as_class_annotations(self):
        field_names = {
            "graph_name",
            "search_start",
            "search_mode",
            "num_centroids",
            "distance_strategy",
            "use_approx_search",
            "enable_traversal",
            "enable_summarizer",
            "traversal_max_depth",
            "traversal_max_returned",
            "traversal_score_threshold",
            "traversal_query",
            "context",
        }
        for name in field_names:
            assert hasattr(RetrievalRequestArangoDB, name), f"Missing field: {name}"

    def test_attribute_assignment_works(self):
        req = RetrievalRequestArangoDB()
        req.graph_name = "GRAPH_1"
        req.search_mode = "hybrid"
        assert req.graph_name == "GRAPH_1"
        assert req.search_mode == "hybrid"


# ---------------------------------------------------------------------------
# Protocol: RequestContext (Pydantic BaseModel)
# ---------------------------------------------------------------------------
class TestRequestContext:
    def test_defaults(self):
        ctx = RequestContext()
        assert ctx.categoryLabels is None
        assert ctx.serviceLabels is None
        assert ctx.language is None

    def test_construction_with_values(self):
        ctx = RequestContext(categoryLabels=["Health"], serviceLabels=["A", "B"], language="en")
        assert ctx.categoryLabels == ["Health"]
        assert ctx.serviceLabels == ["A", "B"]
        assert ctx.language == "en"

    def test_serialization_round_trip(self):
        original = RequestContext(categoryLabels=["Education"], language="fr")
        data = original.model_dump()
        restored = RequestContext(**data)
        assert restored.categoryLabels == ["Education"]
        assert restored.language == "fr"

    def test_model_dump_excludes_none(self):
        ctx = RequestContext(categoryLabels=["Test"])
        dumped = ctx.model_dump(exclude_none=True)
        assert "categoryLabels" in dumped
        assert "serviceLabels" not in dumped
        assert "language" not in dumped


# ---------------------------------------------------------------------------
# Protocol: ChatCompletionRequest (Pydantic BaseModel — extensive)
# ---------------------------------------------------------------------------
class TestChatCompletionRequest:
    def test_required_field_messages_as_string(self):
        req = ChatCompletionRequest(messages="Hello")
        assert req.messages == "Hello"

    def test_required_field_messages_as_list(self):
        msgs = [{"role": "user", "content": "Hello"}]
        req = ChatCompletionRequest(messages=msgs)
        assert req.messages == msgs

    def test_openai_defaults(self):
        req = ChatCompletionRequest(messages="hi")
        assert req.temperature == 0.01
        assert req.max_tokens == 1024
        assert req.stream is False
        assert req.n == 1
        assert req.frequency_penalty == 0.0
        assert req.presence_penalty == 0.0
        assert req.top_p is None
        assert req.model is None

    def test_genieai_context_field(self):
        ctx = RequestContext(categoryLabels=["Health"])
        req = ChatCompletionRequest(messages="hi", context=ctx)
        assert req.context is not None
        assert req.context.categoryLabels == ["Health"]

    def test_genieai_language_default(self):
        req = ChatCompletionRequest(messages="hi")
        assert req.language == "auto"

    def test_genieai_language_custom(self):
        req = ChatCompletionRequest(messages="hi", language="en")
        assert req.language == "en"

    def test_genieai_image_audio_paths(self):
        req = ChatCompletionRequest(messages="hi", image_path="/img/test.png", audio_path="/audio/test.wav")
        assert req.image_path == "/img/test.png"
        assert req.audio_path == "/audio/test.wav"

    def test_retrieval_fields(self):
        req = ChatCompletionRequest(
            messages="hi",
            search_type="mmr",
            k=5,
            fetch_k=20,
            score_threshold=0.8,
        )
        assert req.search_type == "mmr"
        assert req.k == 5
        assert req.fetch_k == 20
        assert req.score_threshold == 0.8

    def test_retrieval_default_search_type(self):
        req = ChatCompletionRequest(messages="hi")
        assert req.search_type == "similarity_score_threshold"

    def test_reranking_fields(self):
        req = ChatCompletionRequest(
            messages="hi",
            reranking_strategy="cross-encoder",
            top_n=3,
            reranking_threshold=0.5,
        )
        assert req.reranking_strategy == "cross-encoder"
        assert req.top_n == 3
        assert req.reranking_threshold == 0.5

    def test_request_type_always_chat(self):
        req = ChatCompletionRequest(messages="hi")
        assert req.request_type == "chat"

    def test_embedding_fields(self):
        req = ChatCompletionRequest(
            messages="hi",
            input="embed this",
            encoding_format="float",
            dimensions=384,
        )
        assert req.input == "embed this"
        assert req.encoding_format == "float"
        assert req.dimensions == 384

    def test_retrieved_docs_and_reranked_docs_default_empty(self):
        req = ChatCompletionRequest(messages="hi")
        assert req.retrieved_docs == []
        assert req.reranked_docs == []

    def test_serialization_preserves_field_types(self):
        req = ChatCompletionRequest(
            messages=[{"role": "user", "content": "test"}],
            language="fr",
            context=RequestContext(categoryLabels=["Test"]),
            temperature=0.5,
            k=10,
        )
        dumped = req.model_dump()
        assert dumped["language"] == "fr"
        assert dumped["temperature"] == 0.5
        assert dumped["k"] == 10
        assert dumped["request_type"] == "chat"
        assert isinstance(dumped["context"], dict)

    def test_vllm_and_tgi_fields(self):
        req = ChatCompletionRequest(
            messages="hi",
            repetition_penalty=1.2,
            best_of=3,
            top_k=50,
            typical_p=0.9,
            timeout=30,
        )
        assert req.repetition_penalty == 1.2
        assert req.best_of == 3
        assert req.top_k == 50
        assert req.typical_p == 0.9
        assert req.timeout == 30

    def test_extra_params_fields(self):
        req = ChatCompletionRequest(
            messages="hi",
            echo=True,
            add_generation_prompt=False,
            add_special_tokens=True,
            documents=[{"title": "doc1", "text": "content"}],
            chat_template="{context}\n{question}",
        )
        assert req.echo is True
        assert req.add_generation_prompt is False
        assert req.add_special_tokens is True
        assert len(req.documents) == 1
        assert req.chat_template == "{context}\n{question}"

    def test_missing_messages_raises_validation_error(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ChatCompletionRequest()


# ---------------------------------------------------------------------------
# Protocol: TranslationRequest (Pydantic BaseModel — simple)
# ---------------------------------------------------------------------------
class TestTranslationRequest:
    def test_required_text_field(self):
        req = TranslationRequest(text="Hello world")
        assert req.text == "Hello world"

    def test_stream_defaults_false(self):
        req = TranslationRequest(text="hi")
        assert req.stream is False

    def test_stream_can_be_true(self):
        req = TranslationRequest(text="hi", stream=True)
        assert req.stream is True

    def test_serialization_round_trip(self):
        original = TranslationRequest(text="Bonjour", stream=True)
        data = original.model_dump()
        restored = TranslationRequest(**data)
        assert restored.text == "Bonjour"
        assert restored.stream is True

    def test_missing_text_raises_validation_error(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            TranslationRequest()


# ---------------------------------------------------------------------------
# Protocol: ArangoDBDataprepRequestFromDocRepo (OPEA base — custom __init__)
# ---------------------------------------------------------------------------
class TestArangoDBDataprepRequestFromDocRepo:
    def test_file_metadata_fields(self):
        req = ArangoDBDataprepRequestFromDocRepo(
            file_id="f-123",
            file_name="report.pdf",
            storage_path="/uploads/report.pdf",
            file_path="/tmp/report.pdf",
            file_type="pdf",
            file_labels=["Health", "Public"],
            upload_date="2025-01-01",
        )
        assert req.file_id == "f-123"
        assert req.file_name == "report.pdf"
        assert req.storage_path == "/uploads/report.pdf"
        assert req.file_path == "/tmp/report.pdf"
        assert req.file_type == "pdf"
        assert req.file_labels == ["Health", "Public"]
        assert req.upload_date == "2025-01-01"

    def test_opea_passthrough_defaults_no_error(self):
        req = ArangoDBDataprepRequestFromDocRepo()
        assert req is not None

    def test_opea_passthrough_defaults_forwarded_to_super(self):
        received = {}
        original_init = ArangoDBDataprepRequestFromDocRepo.__bases__[0].__init__
        ArangoDBDataprepRequestFromDocRepo.__bases__[0].__init__ = lambda self, **kw: received.update(kw)
        try:
            ArangoDBDataprepRequestFromDocRepo()
            assert received["chunk_size"] == 1500
            assert received["chunk_overlap"] == 100
            assert received["process_table"] is False
            assert received["table_strategy"] == "fast"
        finally:
            ArangoDBDataprepRequestFromDocRepo.__bases__[0].__init__ = original_init

    def test_opea_passthrough_custom_no_error(self):
        req = ArangoDBDataprepRequestFromDocRepo(
            chunk_size=2000,
            chunk_overlap=200,
            process_table=True,
            table_strategy="accurate",
            graph_name="TEST_GRAPH",
        )
        assert req is not None

    def test_opea_passthrough_custom_forwarded_to_super(self):
        received = {}
        original_init = ArangoDBDataprepRequestFromDocRepo.__bases__[0].__init__
        ArangoDBDataprepRequestFromDocRepo.__bases__[0].__init__ = lambda self, **kw: received.update(kw)
        try:
            ArangoDBDataprepRequestFromDocRepo(
                chunk_size=2000,
                chunk_overlap=200,
                process_table=True,
                table_strategy="accurate",
                graph_name="TEST_GRAPH",
            )
            assert received["chunk_size"] == 2000
            assert received["chunk_overlap"] == 200
            assert received["process_table"] is True
            assert received["table_strategy"] == "accurate"
            assert received["graph_name"] == "TEST_GRAPH"
        finally:
            ArangoDBDataprepRequestFromDocRepo.__bases__[0].__init__ = original_init

    def test_genieai_fields_default_none(self):
        req = ArangoDBDataprepRequestFromDocRepo()
        assert req.file_id is None
        assert req.file_name is None
        assert req.storage_path is None
        assert req.file_path is None
        assert req.file_type is None
        assert req.file_labels is None
        assert req.upload_date is None

    def test_embedding_flags_no_error(self):
        req = ArangoDBDataprepRequestFromDocRepo(
            embed_nodes=True,
            embed_edges=False,
            embed_chunks=True,
        )
        assert req is not None
