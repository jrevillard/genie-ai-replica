# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

"""Tests for GenieArangoDataprep extraction, chunking, labeling, and ingestion.

Covers _load_and_chunk, _run_guardrail, _label_with_llm, _label_with_embedding,
_label_with_bm25, _apply_labels, ingest_file_with_guardrail, retract_file, and
utility methods with fully mocked ArangoDB, LangChain, aiohttp, and OpenAI deps.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dataprep.genieai_dataprep_arangodb as dp_module
from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def create_dataprep(db_mock=None, embeddings_mock=None, graph_mock=None):
    """Create a GenieArangoDataprep with mocked dependencies.

    Uses __new__ to bypass __init__ which chains through parent classes
    that connect to ArangoDB.
    """
    dp = GenieArangoDataprep.__new__(GenieArangoDataprep)
    dp.db = db_mock or MagicMock()
    dp.embeddings = embeddings_mock or MagicMock()
    dp.graph = graph_mock or MagicMock()
    dp.llm_transformer = MagicMock()
    dp._log_semaphore = asyncio.Semaphore(100)
    dp._initialize_llm = MagicMock()
    dp._initialize_embeddings = MagicMock()
    return dp


def create_mock_ingest_input(file_id="test-file-123", **overrides):
    """Create a mock ArangoDBDataprepRequestFromDocRepo."""
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


def _mock_aiohttp_response(status=200, json_data=None, text_data=""):
    """Create a mock aiohttp response that works as an async context manager."""
    response = AsyncMock()
    response.status = status
    response.json = AsyncMock(return_value=json_data or {})
    response.text = AsyncMock(return_value=text_data)

    @asynccontextmanager
    async def _ctx(*args, **kwargs):
        yield response

    return _ctx()


def _mock_aiohttp_session(method="patch", response_ctx=None):
    """Create a mock aiohttp.ClientSession that works with the parenthesized
    async-with pattern used in the source code."""
    # Use MagicMock (not AsyncMock) so method calls return their return_value
    # directly instead of wrapping in a coroutine.
    session = MagicMock()
    method_mock = getattr(session, method)
    if response_ctx is not None:
        method_mock.return_value = response_ctx
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


# ---------------------------------------------------------------------------
# TestLoadAndChunk
# ---------------------------------------------------------------------------


class TestLoadAndChunk:
    """Tests for GenieArangoDataprep._load_and_chunk()."""

    @pytest.mark.asyncio
    async def test_docling_routing_pdf(self):
        """PDF with CONTENT_EXTRACTION_METHOD=docling calls docling_document_loader."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "test.pdf"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        mock_doc = MagicMock(page_content="Some text content")
        splitter = MagicMock()
        splitter.create_documents.return_value = [mock_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "docling"),
            patch.object(
                dp_module,
                "docling_document_loader",
                new_callable=AsyncMock,
                return_value="Some text content",
            ),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n", "\n", ". ", " "]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["Some text content"]

    @pytest.mark.asyncio
    async def test_docling_routing_docx(self):
        """DOCX with docling method calls docling_document_loader."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "report.docx"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        mock_doc = MagicMock(page_content="DOCX content")
        splitter = MagicMock()
        splitter.create_documents.return_value = [mock_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "docling"),
            patch.object(dp_module, "docling_document_loader", new_callable=AsyncMock, return_value="DOCX content"),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["DOCX content"]

    @pytest.mark.asyncio
    async def test_standard_loader_fallback(self):
        """Non-docling extension or opea method calls document_loader."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "test.txt"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        mock_doc = MagicMock(page_content="Standard content")
        splitter = MagicMock()
        splitter.create_documents.return_value = [mock_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="Standard content"),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["Standard content"]

    @pytest.mark.asyncio
    async def test_html_uses_html_header_splitter(self):
        """HTML files use HTMLHeaderTextSplitter instead of RecursiveCharacterTextSplitter."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "page.html"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        html_splitter = MagicMock()
        html_splitter.create_documents.return_value = [MagicMock(page_content="Title Content")]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(
                dp_module,
                "document_loader",
                new_callable=AsyncMock,
                return_value="<h1>Title</h1><p>Content</p>",
            ),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "HTMLHeaderTextSplitter", return_value=html_splitter),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["Title Content"]

    @pytest.mark.asyncio
    async def test_empty_content_returns_empty(self):
        """Empty content from loader returns empty list."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "empty.pdf"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "docling"),
            patch.object(dp_module, "docling_document_loader", new_callable=AsyncMock, return_value=""),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == []

    @pytest.mark.asyncio
    async def test_content_filtering_by_is_valid(self):
        """Only chunks passing is_valid_content() are returned."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "test.txt"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        docs = [MagicMock(page_content="valid chunk"), MagicMock(page_content="no")]
        splitter = MagicMock()
        splitter.create_documents.return_value = docs

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="content"),
            patch.object(dp_module, "is_valid_content", side_effect=lambda c: len(c) > 5),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["valid chunk"]

    @pytest.mark.asyncio
    async def test_list_content_handled(self):
        """When loader returns a list, each item is processed individually."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "multi.pdf"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        splitter = MagicMock()
        # Each item is short enough (< chunk_size), so split_text not called
        # items pass through directly
        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "docling"),
            patch.object(dp_module, "docling_document_loader", new_callable=AsyncMock, return_value=["item1", "item2"]),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["item1", "item2"]


# ---------------------------------------------------------------------------
# TestApplyLabels
# ---------------------------------------------------------------------------


class TestApplyLabels:
    """Tests for _apply_labels() strategy dispatch."""

    @pytest.mark.asyncio
    async def test_dispatches_to_llm_by_default(self):
        dp = create_dataprep()

        with (
            patch.object(dp_module, "LABELING_STRATEGY", "llm"),
            patch.object(
                dp,
                "_label_with_llm",
                new_callable=AsyncMock,
                return_value=[{"text": "chunk", "labels": ["A"]}],
            ),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._apply_labels(["chunk"], ["A", "B"], [], "file1")

        assert result == [{"text": "chunk", "labels": ["A"]}]

    @pytest.mark.asyncio
    async def test_dispatches_to_embedding(self):
        dp = create_dataprep()

        with (
            patch.object(dp_module, "LABELING_STRATEGY", "embedding"),
            patch.object(dp, "_label_with_embedding", return_value=[{"text": "chunk", "labels": ["A"]}]),
        ):
            result = await dp._apply_labels(["chunk"], ["A", "B"], [], "file1")

        assert result == [{"text": "chunk", "labels": ["A"]}]

    @pytest.mark.asyncio
    async def test_dispatches_to_bm25(self):
        dp = create_dataprep()

        with (
            patch.object(dp_module, "LABELING_STRATEGY", "bm25"),
            patch.object(dp, "_label_with_bm25", return_value=[{"text": "chunk", "labels": ["A"]}]),
        ):
            result = await dp._apply_labels(["chunk"], ["A", "B"], [], "file1")

        assert result == [{"text": "chunk", "labels": ["A"]}]

    @pytest.mark.asyncio
    async def test_fallback_to_file_labels_when_empty_taxonomy(self):
        dp = create_dataprep()

        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result = await dp._apply_labels(["chunk"], [], ["FileLabel"], "file1")

        assert result == [{"text": "chunk", "labels": ["FileLabel"]}]

    @pytest.mark.asyncio
    async def test_fallback_to_empty_when_no_labels(self):
        dp = create_dataprep()

        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result = await dp._apply_labels(["chunk"], [], [], "file1")

        assert result == [{"text": "chunk", "labels": []}]


# ---------------------------------------------------------------------------
# TestLabelWithLlm
# ---------------------------------------------------------------------------


class TestLabelWithLlm:
    """Tests for _label_with_llm()."""

    @pytest.mark.asyncio
    async def test_calls_openai_with_correct_payload(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"labels": ["Healthcare"]})

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(["test chunk"], ["Healthcare", "Education"], [], "file1")

        assert len(result) == 1
        assert result[0]["labels"] == ["Healthcare"]
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["model"] == "test-model"
        assert "Healthcare" in call_kwargs["messages"][0]["content"]

    @pytest.mark.asyncio
    async def test_retry_and_fallback_on_failure(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("LLM error"))

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            # File labels must be in the taxonomy for synonym matching to accept them
            result = await dp._label_with_llm(["chunk"], ["FallbackLabel"], ["FallbackLabel"], "file1")

        assert result[0]["labels"] == ["FallbackLabel"]
        assert mock_client.chat.completions.create.call_count == 3

    @pytest.mark.asyncio
    async def test_synonym_matching_case_insensitive(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"labels": ["healthcare"]})

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

        assert "Healthcare" in result[0]["labels"]


# ---------------------------------------------------------------------------
# TestLabelWithEmbedding
# ---------------------------------------------------------------------------


class TestLabelWithEmbedding:
    """Tests for _label_with_embedding()."""

    def test_selects_labels_above_threshold(self):
        dp = create_dataprep()

        embeddings = MagicMock()
        embeddings.embed_documents.return_value = [[1.0, 0.0], [0.0, 1.0]]
        embeddings.embed_query.return_value = [0.9, 0.1]
        dp.embeddings = embeddings

        with (
            patch.object(dp_module, "EMBEDDING_LABEL_THRESHOLD", 0.5),
            patch.object(dp_module, "dot", return_value=0.95),
            patch.object(dp_module, "norm", return_value=1.0),
        ):
            result = dp._label_with_embedding(["test chunk"], ["LabelA", "LabelB"])

        assert len(result) == 1
        assert "LabelA" in result[0]["labels"]

    def test_initializes_embeddings_if_not_set(self):
        dp = create_dataprep()
        dp.embeddings = None

        # _initialize_embeddings is already a MagicMock on the instance.
        # Make it set embeddings when called so the method can proceed.
        def fake_init():
            dp.embeddings = MagicMock()

        dp._initialize_embeddings.side_effect = fake_init

        with (
            patch.object(dp_module, "EMBEDDING_LABEL_THRESHOLD", 0.5),
            patch.object(dp_module, "dot", return_value=0.95),
            patch.object(dp_module, "norm", return_value=1.0),
        ):
            dp._label_with_embedding(["chunk"], ["A"])

        dp._initialize_embeddings.assert_called_once()


# ---------------------------------------------------------------------------
# TestLabelWithBm25
# ---------------------------------------------------------------------------


class TestLabelWithBm25:
    """Tests for _label_with_bm25()."""

    def test_selects_labels_above_threshold(self):
        dp = create_dataprep()

        # BM25Okapi is mocked, so we need to mock its get_scores behavior
        mock_bm25 = MagicMock()
        mock_bm25.get_scores.return_value = [5.0, 0.1, 0.5]

        with (
            patch.object(dp_module, "BM25Okapi", return_value=mock_bm25),
            patch.object(dp_module, "BM25_LABEL_THRESHOLD", 2.0),
        ):
            result = dp._label_with_bm25(
                ["healthcare hospital medical"],
                ["Healthcare", "Education", "Technology"],
            )

        assert len(result) == 1
        assert "Healthcare" in result[0]["labels"]
        assert "Education" not in result[0]["labels"]


# ---------------------------------------------------------------------------
# TestIngestFileWithGuardrail
# ---------------------------------------------------------------------------


class TestIngestFileWithGuardrail:
    """Tests for ingest_file_with_guardrail() main pipeline."""

    @pytest.mark.asyncio
    async def test_happy_path(self):
        """Successful ingestion sets status to Ingested with correct chunk count."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock) as mock_status,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["Healthcare"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["chunk1", "chunk2"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=[
                    {"text": "chunk1", "labels": ["A"]},
                    {"text": "chunk2", "labels": ["B"]},
                ],
            ),
            patch.object(dp, "_process_batch", new_callable=AsyncMock),
            patch.object(dp_module, "ArangoGraph"),
        ):
            result = await dp.ingest_file_with_guardrail(inp, lock_file=None)

        assert result["status"] == 200
        assert "2 chunks" in result["message"]
        status_calls = [c.args[1] for c in mock_status.call_args_list]
        assert "Ingesting" in status_calls
        assert "Ingested" in status_calls

    @pytest.mark.asyncio
    async def test_no_content_raises_and_retracts(self):
        """No chunks extracted -> raises, auto-retracts, Ingestion Error."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()

        with (  # noqa: SIM117
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock) as mock_status,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["A"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=[]),
            patch.object(dp, "retract_file", new_callable=AsyncMock),
        ):
            with pytest.raises(Exception):  # noqa: B017
                await dp.ingest_file_with_guardrail(inp, lock_file=None)

        status_calls = [c.args[1] for c in mock_status.call_args_list]
        assert "Ingestion Error" in status_calls

    @pytest.mark.asyncio
    async def test_cancelled_error_triggers_kill_path(self):
        """CancelledError -> retracts + Killed status + re-raises."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock) as mock_status,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, side_effect=asyncio.CancelledError()),
            patch.object(dp, "retract_file", new_callable=AsyncMock) as mock_retract,
            pytest.raises(asyncio.CancelledError),
        ):
            await dp.ingest_file_with_guardrail(inp, lock_file=None)

        mock_retract.assert_called_once_with(file_id="test-file-123", graph_name="GRAPH")
        status_calls = [c.args[1] for c in mock_status.call_args_list]
        assert "Killed" in status_calls

    @pytest.mark.asyncio
    async def test_guardrail_violation_blocks_ingestion(self):
        """Guardrail failure -> raises, auto-retracts."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()

        with (  # noqa: SIM117
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["A"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["chunk1"]),
            patch.object(
                dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": False, "message": "Blocked"}
            ),
            patch.object(dp, "retract_file", new_callable=AsyncMock),
        ):
            with pytest.raises(Exception, match="Guardrail Violation"):
                await dp.ingest_file_with_guardrail(inp, lock_file=None)

    @pytest.mark.asyncio
    async def test_lock_released_in_finally(self):
        """Lock file is released even on error."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()
        mock_lock = MagicMock()

        with (  # noqa: SIM117
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, side_effect=Exception("boom")),
            patch.object(dp, "retract_file", new_callable=AsyncMock),
            patch("dataprep.genieai_dataprep_arangodb.fcntl"),
        ):
            with pytest.raises(Exception):  # noqa: B017
                await dp.ingest_file_with_guardrail(inp, lock_file=mock_lock)

        mock_lock.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_document_metadata_correct(self):
        """Document objects have correct metadata (file_id, chunk_index, chunk_labels)."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()

        captured_docs = []

        async def capture_batch(batch, *args, **kwargs):
            captured_docs.extend(batch)

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["A"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["chunk1"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=[
                    {"text": "chunk1", "labels": ["Healthcare"]},
                ],
            ),
            patch.object(dp, "_process_batch", new_callable=AsyncMock, side_effect=capture_batch),
            patch.object(dp_module, "ArangoGraph"),
            patch.object(dp_module, "Document", side_effect=lambda **kw: type("Doc", (), kw)),
        ):
            await dp.ingest_file_with_guardrail(inp, lock_file=None)

        assert len(captured_docs) == 1
        doc = captured_docs[0]
        assert doc.metadata["file_id"] == "test-file-123"
        assert doc.metadata["chunk_index"] == 0
        assert doc.metadata["chunk_labels"] == ["Healthcare"]

    @pytest.mark.asyncio
    async def test_document_metadata_sequential_indices(self):
        """Multiple documents get sequential chunk_index (0, 1, 2)."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()

        captured_docs = []

        async def capture_batch(batch, *args, **kwargs):
            captured_docs.extend(batch)

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["A"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["c1", "c2", "c3"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=[
                    {"text": "c1", "labels": ["A"]},
                    {"text": "c2", "labels": ["B"]},
                    {"text": "c3", "labels": ["A"]},
                ],
            ),
            patch.object(dp, "_process_batch", new_callable=AsyncMock, side_effect=capture_batch),
            patch.object(dp_module, "ArangoGraph"),
            patch.object(dp_module, "Document", side_effect=lambda **kw: type("Doc", (), kw)),
        ):
            await dp.ingest_file_with_guardrail(inp, lock_file=None)

        assert len(captured_docs) == 3
        indices = [doc.metadata["chunk_index"] for doc in captured_docs]
        assert indices == [0, 1, 2]


# ---------------------------------------------------------------------------
# TestRetractFile
# ---------------------------------------------------------------------------


class TestRetractFile:
    """Tests for retract_file() cascade deletion."""

    @pytest.mark.asyncio
    async def test_full_cascade_deletion(self):
        """Retraction executes all steps with correct AQL queries."""
        dp = create_dataprep()

        chunk_cursor = MagicMock()
        chunk_cursor.__iter__ = MagicMock(
            return_value=iter(
                [
                    {"key": "c1", "id": "SOURCE/c1"},
                    {"key": "c2", "id": "SOURCE/c2"},
                ]
            )
        )

        edge_cursor = MagicMock()
        edge_cursor.__iter__ = MagicMock(
            return_value=iter(
                [
                    {"key": "e1", "id": "HAS_SOURCE/e1", "from": "ENTITY/ent1"},
                ]
            )
        )

        del_chunk_cursor = MagicMock()
        del_chunk_cursor.__iter__ = MagicMock(return_value=iter(["SOURCE/c1", "SOURCE/c2"]))

        del_edge_cursor = MagicMock()
        del_edge_cursor.__iter__ = MagicMock(return_value=iter(["HAS_SOURCE/e1"]))

        del_links_cursor = MagicMock()
        del_links_cursor.__iter__ = MagicMock(return_value=iter([]))

        orphan_cursor = MagicMock()
        orphan_cursor.__iter__ = MagicMock(return_value=iter([]))

        execute_returns = [
            chunk_cursor,
            edge_cursor,
            del_chunk_cursor,
            del_edge_cursor,
            del_links_cursor,
            orphan_cursor,
        ]
        dp.db.aql.execute = MagicMock(side_effect=execute_returns)

        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
        ):
            result = await dp.retract_file("file-123", "GRAPH")

        assert result["status"] == 200
        assert result["details"]["deleted_chunks"] == 2
        assert result["details"]["deleted_edges"] == 1

    @pytest.mark.asyncio
    async def test_no_chunks_returns_early(self):
        """No chunks found -> early return with 'No chunks found.' message."""
        dp = create_dataprep()

        empty_cursor = MagicMock()
        empty_cursor.__iter__ = MagicMock(return_value=iter([]))
        dp.db.aql.execute = MagicMock(return_value=empty_cursor)

        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
        ):
            result = await dp.retract_file("nonexistent-file", "GRAPH")

        assert result["message"] == "No chunks found."
        assert result["details"]["deleted_chunks"] == 0


# ---------------------------------------------------------------------------
# TestUtilityMethods
# ---------------------------------------------------------------------------


class TestServiceHeaders:
    """Tests for _service_headers()."""

    @pytest.mark.asyncio
    async def test_returns_auth_headers_on_success(self):
        dp = create_dataprep()

        with patch.object(dp_module, "get_service_account_token", new_callable=AsyncMock, return_value="tok123"):
            headers = await dp._service_headers()

        assert headers["Authorization"] == "Bearer tok123"
        assert headers["Content-Type"] == "application/json"

    @pytest.mark.asyncio
    async def test_returns_none_on_failure(self):
        dp = create_dataprep()

        with patch.object(
            dp_module,
            "get_service_account_token",
            new_callable=AsyncMock,
            side_effect=Exception("fail"),
        ):
            headers = await dp._service_headers()

        assert headers is None


class TestUpdateDocStatus:
    """Tests for _update_doc_status()."""

    @pytest.mark.asyncio
    async def test_sends_patch_with_correct_payload(self):
        dp = create_dataprep()

        resp_ctx = _mock_aiohttp_response(status=200)
        session = _mock_aiohttp_session("patch", resp_ctx)

        with (
            patch.object(
                dp,
                "_service_headers",
                new_callable=AsyncMock,
                return_value={"Authorization": "Bearer t", "Content-Type": "application/json"},
            ),
            patch.object(dp_module, "aiohttp") as mock_aiohttp,
        ):
            mock_aiohttp.ClientTimeout.return_value = MagicMock()
            mock_aiohttp.ClientSession.return_value = session
            await dp._update_doc_status("file1", "Ingesting", chunk_count=5)

        session.patch.assert_called_once()
        call_args = session.patch.call_args
        assert "file1/status" in call_args.args[0]

    @pytest.mark.asyncio
    async def test_skips_when_headers_unavailable(self):
        dp = create_dataprep()

        with patch.object(dp, "_service_headers", new_callable=AsyncMock, return_value=None):
            await dp._update_doc_status("file1", "Ingesting")


class TestWriteIngestionLog:
    """Tests for _write_ingestion_log()."""

    @pytest.mark.asyncio
    async def test_sends_post_with_correct_payload(self):
        dp = create_dataprep()

        resp_ctx = _mock_aiohttp_response(status=201)
        session = _mock_aiohttp_session("post", resp_ctx)

        with (
            patch.object(
                dp,
                "_service_headers",
                new_callable=AsyncMock,
                return_value={"Authorization": "Bearer t", "Content-Type": "application/json"},
            ),
            patch.object(dp_module, "aiohttp") as mock_aiohttp,
        ):
            mock_aiohttp.ClientTimeout.return_value = MagicMock()
            mock_aiohttp.ClientSession.return_value = session
            await dp._write_ingestion_log("file1", "INFO", "Chunking", "Generated 5 chunks")

        session.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_handles_429_gracefully(self):
        dp = create_dataprep()

        resp_ctx = _mock_aiohttp_response(status=429)
        session = _mock_aiohttp_session("post", resp_ctx)

        with (
            patch.object(
                dp,
                "_service_headers",
                new_callable=AsyncMock,
                return_value={"Authorization": "Bearer t", "Content-Type": "application/json"},
            ),
            patch.object(dp_module, "aiohttp") as mock_aiohttp,
        ):
            mock_aiohttp.ClientTimeout.return_value = MagicMock()
            mock_aiohttp.ClientSession.return_value = session
            await dp._write_ingestion_log("file1", "INFO", "System", "test")


class TestFetchAllLabels:
    """Tests for _fetch_all_labels()."""

    @pytest.mark.asyncio
    async def test_parses_taxonomy_response(self):
        dp = create_dataprep()

        taxonomy = [
            {"name": "Healthcare", "children": [{"name": "Hospitals"}, {"name": "Clinics"}]},
            {"name": "Education", "children": ["Schools"]},
        ]
        resp_ctx = _mock_aiohttp_response(status=200, json_data=taxonomy)
        session = _mock_aiohttp_session("get", resp_ctx)

        with (
            patch.object(
                dp,
                "_service_headers",
                new_callable=AsyncMock,
                return_value={"Authorization": "Bearer t", "Content-Type": "application/json"},
            ),
            patch.object(dp_module, "aiohttp") as mock_aiohttp,
        ):
            mock_aiohttp.ClientTimeout.return_value = MagicMock()
            mock_aiohttp.ClientSession.return_value = session
            labels = await dp._fetch_all_labels()

        assert "Healthcare" in labels
        assert "Hospitals" in labels
        assert "Schools" in labels

    @pytest.mark.asyncio
    async def test_returns_empty_on_error(self):
        dp = create_dataprep()

        with patch.object(dp, "_service_headers", new_callable=AsyncMock, return_value=None):
            labels = await dp._fetch_all_labels()

        assert labels == []


class TestRunGuardrail:
    """Tests for _run_guardrail()."""

    @pytest.mark.asyncio
    async def test_returns_success_when_disabled(self):
        dp = create_dataprep()

        with patch.object(dp_module, "GUARDRAIL_ENABLED", False):
            result = await dp._run_guardrail(["chunk1", "chunk2"])

        assert result == {"success": True}

    @pytest.mark.asyncio
    async def test_returns_failure_when_blocked(self):
        dp = create_dataprep()

        resp_ctx = _mock_aiohttp_response(status=200, json_data={"text": "different"})
        session = _mock_aiohttp_session("post", resp_ctx)

        with (
            patch.object(dp_module, "GUARDRAIL_ENABLED", True),
            patch.object(dp_module, "GUARDRAIL_URL", "http://guardrail:9090/v1/guardrails"),
            patch.object(dp_module, "aiohttp") as mock_aiohttp,
        ):
            mock_aiohttp.ClientTimeout.return_value = MagicMock()
            mock_aiohttp.ClientSession.return_value = session
            result = await dp._run_guardrail(["chunk1"])

        assert result["success"] is False
        assert "Blocked" in result["message"]

    @pytest.mark.asyncio
    async def test_partial_failure_returns_first_blocked(self):
        """Guardrail passes first chunk, blocks second — fails fast with chunk index."""
        dp = create_dataprep()

        resp_pass = _mock_aiohttp_response(status=200, json_data={"text": "chunk1"})
        resp_block = _mock_aiohttp_response(status=200, json_data={"text": "filtered"})

        session = MagicMock()
        post_mock = session.post
        post_mock.side_effect = [resp_pass, resp_block]
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with (
            patch.object(dp_module, "GUARDRAIL_ENABLED", True),
            patch.object(dp_module, "GUARDRAIL_URL", "http://guardrail:9090/v1/guardrails"),
            patch.object(dp_module, "aiohttp") as mock_aiohttp,
        ):
            mock_aiohttp.ClientTimeout.return_value = MagicMock()
            mock_aiohttp.ClientSession.return_value = session
            result = await dp._run_guardrail(["chunk1", "chunk2"])

        assert result["success"] is False
        assert result["chunk_index"] == 1
