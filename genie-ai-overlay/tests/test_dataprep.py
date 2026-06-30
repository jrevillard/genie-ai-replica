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
        # Deterministic sampling → clean JSON (granite adds prose at higher temp).
        assert call_kwargs["temperature"] == 0.0
        assert call_kwargs["max_tokens"] == 160
        assert call_kwargs["response_format"] == {"type": "json_object"}

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

    @pytest.mark.asyncio
    async def test_file_labels_scope_filters_out_of_scope(self, monkeypatch):
        """Labels not in file_labels are dropped even if valid taxonomy entries.

        Reproduces the tomato-guide/Cucumber leakage: the LLM is prompted with
        the full taxonomy and may suggest sibling labels (e.g. Cucumber on a
        tomato document); the document's file_labels define the eligible scope,
        so out-of-scope suggestions must be removed before storage.
        """
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        # LLM suggests a sibling crop (Cucumber) plus the in-scope Tomato.
        mock_response.choices[0].message.content = json.dumps({"labels": ["Cucumber", "Tomato"]})

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(
                ["chunk"],
                ["Cucumber", "Tomato", "Water"],  # full taxonomy (all_labels)
                ["Tomato", "Water"],  # document scope (file_labels)
                "file1",
            )

        # Cucumber is a valid taxonomy entry but outside file_labels -> dropped.
        assert "Cucumber" not in result[0]["labels"]
        assert "Tomato" in result[0]["labels"]

    @pytest.mark.asyncio
    async def test_file_labels_empty_keeps_taxonomy_labels(self, monkeypatch):
        """Empty file_labels must NOT filter, else every chunk loses all labels.

        Guards the scope filter so documents without file_labels keep the
        existing taxonomy-validated behavior.
        """
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
            result = await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

        assert result[0]["labels"] == ["Healthcare"]

    @pytest.mark.asyncio
    async def test_batch_labeling_makes_one_call_per_batch(self, monkeypatch):
        """With LABEL_LLM_BATCH_SIZE>1, multiple chunks share a single LLM call."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dp_module, "LABEL_LLM_BATCH_SIZE", 2)

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"0": ["Healthcare"], "1": ["Education"]})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(
                ["health chunk", "school chunk"], ["Healthcare", "Education"], [], "file1"
            )

        # 2 chunks / batch_size 2 → exactly one LLM call.
        assert mock_client.chat.completions.create.call_count == 1
        assert result[0]["labels"] == ["Healthcare"]
        assert result[1]["labels"] == ["Education"]

    @pytest.mark.asyncio
    async def test_batch_labeling_falls_back_on_parse_failure(self, monkeypatch):
        """A malformed batch response triggers per-chunk fallback (labels still correct)."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dp_module, "LABEL_LLM_BATCH_SIZE", 2)

        bad = MagicMock()
        bad.choices = [MagicMock()]
        bad.choices[0].message.content = "not json"
        good = MagicMock()
        good.choices = [MagicMock()]
        good.choices[0].message.content = json.dumps({"labels": ["Healthcare"]})

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=[bad, good, good])

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(["chunk0", "chunk1"], ["Healthcare"], [], "file1")

        # 1 batch attempt (fails) + 2 per-chunk fallback calls.
        assert mock_client.chat.completions.create.call_count == 3
        assert result[0]["labels"] == ["Healthcare"]
        assert result[1]["labels"] == ["Healthcare"]

    @pytest.mark.asyncio
    async def test_batch_handles_null_labels_without_fallback(self, monkeypatch):
        """A null value for a chunk (no labels) is coerced to [] — no batch fallback."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dp_module, "LABEL_LLM_BATCH_SIZE", 2)

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        # chunk 0 -> labels, chunk 1 -> null (model's "no labels" convention)
        mock_response.choices[0].message.content = json.dumps({"0": ["Healthcare"], "1": None})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(["chunk0", "chunk1"], ["Healthcare"], [], "file1")

        # No fallback — one batch call, null coerced to [].
        assert mock_client.chat.completions.create.call_count == 1
        assert result[0]["labels"] == ["Healthcare"]
        assert result[1]["labels"] == []

    @pytest.mark.asyncio
    async def test_single_handles_null_labels(self, monkeypatch):
        """A null labels value in single-chunk mode returns [] instead of retrying."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"labels": None})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

        assert result[0]["labels"] == []
        assert mock_client.chat.completions.create.call_count == 1  # no retry

    @pytest.mark.asyncio
    async def test_batch_wraps_bare_string_label(self, monkeypatch):
        """A bare string label (not a list) is wrapped — no batch fallback."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dp_module, "LABEL_LLM_BATCH_SIZE", 2)

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"0": "Healthcare", "1": ["Education"]})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(["chunk0", "chunk1"], ["Healthcare", "Education"], [], "file1")

        assert mock_client.chat.completions.create.call_count == 1  # no fallback
        assert result[0]["labels"] == ["Healthcare"]
        assert result[1]["labels"] == ["Education"]

    @pytest.mark.asyncio
    async def test_batch_skips_unusable_label_value(self, monkeypatch):
        """A per-chunk unusable value (e.g. a number) is skipped to [] — no batch fallback."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dp_module, "LABEL_LLM_BATCH_SIZE", 2)

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        # chunk 0 -> number (unusable), chunk 1 -> valid list
        mock_response.choices[0].message.content = json.dumps({"0": 123, "1": ["Education"]})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._label_with_llm(["chunk0", "chunk1"], ["Education"], [], "file1")

        assert mock_client.chat.completions.create.call_count == 1  # no fallback
        assert result[0]["labels"] == []  # unusable -> skipped
        assert result[1]["labels"] == ["Education"]

    @pytest.mark.asyncio
    async def test_consolidated_logging_writes_one_entry_per_chunk(self, monkeypatch):
        """Per-label progress logs collapse to a single summary per chunk."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        # Two exact-match labels → previously 2 per-label logs + 1 final = 3.
        mock_response.choices[0].message.content = json.dumps({"labels": ["Healthcare", "Education"]})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        log_mock = AsyncMock()
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new=log_mock),
        ):
            result = await dp._label_with_llm(["chunk"], ["Healthcare", "Education"], [], "file1")

        assert set(result[0]["labels"]) == {"Healthcare", "Education"}
        assert log_mock.call_count == 1  # one consolidated summary, not per-label

    @pytest.mark.asyncio
    async def test_consolidated_logging_warns_on_new_labels(self, monkeypatch):
        """Non-taxonomy suggestions surface as a single WARN, not one log per label."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"labels": ["Healthcare", "QuantumAgriculture"]})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        log_mock = AsyncMock()
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new=log_mock),
        ):
            await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

        assert log_mock.call_count == 1
        args = log_mock.call_args.args
        # _write_ingestion_log(file_id, level, stage, message) — positional.
        assert args[1] == "WARN"
        assert "QuantumAgriculture" in args[3]

    @pytest.mark.asyncio
    async def test_llm_labeling_emits_span(self, monkeypatch):
        """Each LLM call is wrapped in a dataprep.llm.label_chunk span."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"labels": ["Healthcare"]})
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        span = MagicMock()
        cm = MagicMock()
        cm.__enter__ = MagicMock(return_value=span)
        cm.__exit__ = MagicMock(return_value=False)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp_module, "with_span", return_value=cm) as ws,
        ):
            await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

        ws.assert_called_once()
        assert ws.call_args.args[0] == "dataprep.llm.label_chunk"
        assert ws.call_args.kwargs["attributes"]["dataprep.chunk_index"] == 0

    @pytest.mark.asyncio
    async def test_failed_attempt_logs_exception_reason(self, monkeypatch):
        """A failed LLM attempt logs the exception type+message for diagnosis."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=TimeoutError("simulated timeout"))

        log_mock = AsyncMock()
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new=log_mock),
        ):
            result = await dp._label_with_llm(["chunk"], ["Healthcare"], ["Healthcare"], "file1")

        # 3 failed attempts → fallback to file labels (Healthcare is in taxonomy, survives).
        assert result[0]["labels"] == ["Healthcare"]
        # Each failure must surface the exception type so it is diagnosable.
        logged_msgs = [c.args[3] for c in log_mock.call_args_list]
        assert any("TimeoutError" in m and "attempt" in m for m in logged_msgs)


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


# ---------------------------------------------------------------------------
# TestLoadWithDoclingRemote
# ---------------------------------------------------------------------------


class TestLoadWithDoclingRemote:
    """Tests for _load_with_docling_remote() SSL connector behavior.

    aiohttp is already mocked via conftest (sys.modules["aiohttp"]).
    We grab the mock reference and configure it per test.
    """

    @pytest.fixture
    def temp_file(self, tmp_path):
        f = tmp_path / "test.pdf"
        f.write_bytes(b"%fake-pdf")
        return str(f)

    @pytest.fixture
    def mock_aiohttp_session(self):
        """Configure the conftest aiohttp mock for a successful docling call."""
        import aiohttp as aiohttp_mod

        aiohttp_mod.TCPConnector.reset_mock()

        mock_session = MagicMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_resp = AsyncMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json = AsyncMock(
            return_value={"document": {"md_content": "# doc", "html_content": None}, "status": "success"}
        )
        mock_session.post.return_value.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_session.post.return_value.__aexit__ = AsyncMock(return_value=False)
        aiohttp_mod.ClientSession.return_value = mock_session
        aiohttp_mod.ClientTimeout.return_value = MagicMock()
        aiohttp_mod.FormData.return_value = MagicMock()
        return aiohttp_mod

    @pytest.mark.asyncio
    async def test_ssl_verify_enabled_by_default(self, temp_file, mock_aiohttp_session):
        """When OPEA_SSL_SKIP_VERIFY is unset, TCPConnector(ssl=True)."""
        import os

        from dataprep.genieai_dataprep_utils import _load_with_docling_remote

        old = os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)
        try:
            with (
                patch(
                    "dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT",
                    "https://gpu:5001",
                ),
                patch("dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT_TIMEOUT", 30),
            ):
                await _load_with_docling_remote(temp_file)
        finally:
            if old is not None:
                os.environ["OPEA_SSL_SKIP_VERIFY"] = old

        mock_aiohttp_session.TCPConnector.assert_called_once_with(ssl=True)

    @pytest.mark.asyncio
    async def test_ssl_skip_verify_when_env_set(self, temp_file, mock_aiohttp_session):
        """When OPEA_SSL_SKIP_VERIFY=1, TCPConnector(ssl=False)."""
        import os

        from dataprep.genieai_dataprep_utils import _load_with_docling_remote

        os.environ["OPEA_SSL_SKIP_VERIFY"] = "1"
        try:
            with (
                patch(
                    "dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT",
                    "https://gpu:5001",
                ),
                patch("dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT_TIMEOUT", 30),
            ):
                await _load_with_docling_remote(temp_file)
        finally:
            os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)

        mock_aiohttp_session.TCPConnector.assert_called_once_with(ssl=False)

    @pytest.mark.asyncio
    async def test_api_key_injected_when_set(self, temp_file, mock_aiohttp_session):
        """When VLLM_API_KEY is set, ClientSession receives Authorization: Bearer header."""
        import os

        from dataprep.genieai_dataprep_utils import _load_with_docling_remote

        os.environ["VLLM_API_KEY"] = "test-key"
        os.environ["OPEA_SSL_SKIP_VERIFY"] = "1"
        try:
            with (
                patch(
                    "dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT",
                    "https://gpu:5001",
                ),
                patch("dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT_TIMEOUT", 30),
            ):
                await _load_with_docling_remote(temp_file)
        finally:
            os.environ.pop("VLLM_API_KEY", None)
            os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)

        _, kwargs = mock_aiohttp_session.ClientSession.call_args
        assert kwargs["headers"] == {"Authorization": "Bearer test-key"}

    @pytest.mark.asyncio
    async def test_no_api_key_when_unset(self, temp_file, mock_aiohttp_session):
        """When VLLM_API_KEY is unset, ClientSession receives empty headers."""
        import os

        from dataprep.genieai_dataprep_utils import _load_with_docling_remote

        old_key = os.environ.pop("VLLM_API_KEY", None)
        os.environ["OPEA_SSL_SKIP_VERIFY"] = "1"
        try:
            with (
                patch(
                    "dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT",
                    "https://gpu:5001",
                ),
                patch("dataprep.genieai_dataprep_utils.DOCLING_ENDPOINT_TIMEOUT", 30),
            ):
                await _load_with_docling_remote(temp_file)
        finally:
            if old_key is not None:
                os.environ["VLLM_API_KEY"] = old_key
            os.environ.pop("OPEA_SSL_SKIP_VERIFY", None)

        _, kwargs = mock_aiohttp_session.ClientSession.call_args
        assert kwargs["headers"] == {}


# DocRepoIngestPayload contract
# ---------------------------------------------------------------------------
class TestDocRepoIngestPayload:
    """The dataprep ingest endpoint must not require uploadDate.

    uploadDate is document-repository metadata that dataprep never consumes
    (see ingest_file_with_guardrail — upload_date is never read). Requiring it
    caused a 422 → 500 whenever a legacy file had uploaded_date == null in the
    files collection. The field must be absent from the contract.
    """

    def _payload(self, **overrides):
        base = {
            "fileId": "test-file-123",
            "fileName": "doc.md",
            "fileType": "text/markdown",
            "fileBase64": "dGVzdCBjb250ZW50",  # "test content"
        }
        base.update(overrides)
        return base

    def test_validates_without_upload_date(self):
        from dataprep.genieai_dataprep_microservice import DocRepoIngestPayload

        payload = DocRepoIngestPayload(**self._payload())
        assert payload.fileId == "test-file-123"

    def test_upload_date_null_does_not_raise(self):
        """Reproduces the production 422: legacy file with uploaded_date=null."""
        from dataprep.genieai_dataprep_microservice import DocRepoIngestPayload

        payload = DocRepoIngestPayload(**self._payload(uploadDate=None))
        assert payload.fileId == "test-file-123"


# ---------------------------------------------------------------------------
# TestContextualRetrieval (Contextual Retrieval — spec-contextual-retrieval.md)
# ---------------------------------------------------------------------------


def _recordable_doc(**kwargs):
    """Stand-in for langchain ``Document`` (mocked by conftest) exposing kwargs as attrs."""
    from types import SimpleNamespace

    return SimpleNamespace(**kwargs)


class TestContextualRetrieval:
    """Tests for _apply_contextualization() / _context_single_call()."""

    @pytest.fixture(autouse=True)
    def _isolate_defaults(self, monkeypatch):
        """Explicit flags so tests don't depend on module defaults."""
        monkeypatch.setattr(dp_module, "CONTEXTUAL_STRATEGY", "per_chunk")
        monkeypatch.setattr(dp_module, "CONTEXTUAL_LABEL_RAW", False)

    @pytest.mark.asyncio
    async def test_flag_off_returns_chunks_unchanged(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", False)
        mock_client = AsyncMock()
        chunks = ["chunk one", "chunk two"]
        with patch.object(dp_module, "AsyncOpenAI", return_value=mock_client):
            result = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "file1")
        assert result == chunks
        mock_client.chat.completions.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_flag_off_empty_is_noop(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", False)
        with patch.object(dp_module, "AsyncOpenAI", return_value=AsyncMock()):
            result = await dp._apply_contextualization([], create_mock_ingest_input(), "file1")
        assert result == []

    def test_build_doc_context_includes_filename_labels_and_truncates(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_DOC_BUDGET", 40)
        ctx = dp._build_doc_context(["aaaaaaaaaa" * 20, "tail"], create_mock_ingest_input(), 40)
        assert "Filename: test_document.pdf" in ctx
        assert "Document labels: Healthcare, Public Services" in ctx
        assert "[truncated]" in ctx  # joined content exceeded the 40-char budget

    @pytest.mark.asyncio
    async def test_flag_on_prepends_context(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        async def fake_create(*args, **kwargs):
            # per_chunk batches chunks → user message is a JSON list of {index, text}.
            items = json.loads(kwargs["messages"][1]["content"])
            contexts = {str(it["index"]): f"CTX[{it['text'][:5]}]" for it in items}
            r = MagicMock()
            r.choices = [MagicMock()]
            r.choices[0].message.content = json.dumps({"contexts": contexts})
            r.usage = MagicMock(completion_tokens=20, prompt_tokens=80)
            return r

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=fake_create)
        chunks = ["alpha chunk text", "beta chunk text"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "file1")

        assert len(result) == 2
        assert result[0].startswith("CTX[alpha") and result[0].endswith("alpha chunk text")
        assert result[1].startswith("CTX[beta ") and result[1].endswith("beta chunk text")
        # 2 chunks with default batch_size=4 → ONE batched call.
        assert mock_client.chat.completions.create.call_count == 1
        # Deterministic, JSON-mode, doc context (filename) carried in the system prompt.
        sys_content = mock_client.chat.completions.create.call_args_list[0].kwargs["messages"][0]["content"]
        assert "test_document.pdf" in sys_content
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["model"] == "test-model"
        assert call_kwargs["temperature"] == 0.0
        assert call_kwargs["response_format"] == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_assembly_falls_back_to_raw_when_context_empty(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "m")

        async def fake_batch(client, model, sys_prompt, batch, file_id):
            # batch returns {index: context}; index 0 gets none → raw fallback.
            return {0: "", 1: "GOOD CONTEXT"}

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=AsyncMock()),
            patch.object(dp, "_context_batch_call", new=AsyncMock(side_effect=fake_batch)),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._apply_contextualization(["raw zero", "raw one"], create_mock_ingest_input(), "f")

        assert result[0] == "raw zero"  # empty context → raw chunk
        assert result[1] == "GOOD CONTEXT\n\nraw one"

    @pytest.mark.asyncio
    async def test_context_single_call_parses_json_context(self, monkeypatch):
        dp = create_dataprep()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"context": "doc context"})
        mock_response.usage = MagicMock(completion_tokens=7)
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            ctx = await dp._context_single_call(mock_client, "m", "sys", 3, "chunk text", "file1")
        assert ctx == "doc context"
        assert mock_client.chat.completions.create.call_count == 1

    @pytest.mark.asyncio
    async def test_context_single_call_retries_then_returns_empty(self, monkeypatch):
        dp = create_dataprep()
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("boom"))
        log = AsyncMock()
        with patch.object(dp, "_write_ingestion_log", new=log):
            ctx = await dp._context_single_call(mock_client, "m", "sys", 0, "c", "f")
        assert ctx == ""
        assert mock_client.chat.completions.create.call_count == 3  # 3 retries
        # Final "giving up" warning emitted.
        assert log.await_count >= 1

    @pytest.mark.asyncio
    async def test_ingest_flag_on_contextualizes_and_keeps_original(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        inp = create_mock_ingest_input()
        original = ["orig chunk one", "orig chunk two"]
        contextualized = ["CTX one\n\norig chunk one", "CTX two\n\norig chunk two"]
        captured = {"ctx_in": None, "labels_in": None}
        built = []

        async def fake_context(chunks, _inp, file_id):
            captured["ctx_in"] = list(chunks)
            return contextualized

        async def fake_labels(chunks, all_labels, file_labels, file_id):
            captured["labels_in"] = list(chunks)
            return [{"text": c, "labels": ["L"]} for c in chunks]

        async def fake_process_batch(batch_docs, *a, **k):
            built.extend(batch_docs)

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["L"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=original),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(dp, "_apply_contextualization", new=AsyncMock(side_effect=fake_context)),
            patch.object(dp, "_apply_labels", new=AsyncMock(side_effect=fake_labels)),
            patch.object(dp, "_process_batch", new=AsyncMock(side_effect=fake_process_batch)),
            patch.object(dp_module, "Document", _recordable_doc),
            patch.object(dp_module, "ArangoGraph"),
        ):
            await dp.ingest_file_with_guardrail(inp)

        assert captured["ctx_in"] == original  # contextualization got originals
        assert captured["labels_in"] == contextualized  # labeling got contextualized
        assert len(built) == 2
        assert built[0].page_content == contextualized[0]  # embedded text
        assert built[0].metadata["chunk_text"] == original[0]  # original preserved
        assert built[1].metadata["chunk_text"] == original[1]

    @pytest.mark.asyncio
    async def test_ingest_flag_off_is_passthrough(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", False)
        inp = create_mock_ingest_input()
        original = ["orig chunk one", "orig chunk two"]
        captured = {"labels_in": None}
        built = []

        async def fake_labels(chunks, all_labels, file_labels, file_id):
            captured["labels_in"] = list(chunks)
            return [{"text": c, "labels": ["L"]} for c in chunks]

        async def fake_process_batch(batch_docs, *a, **k):
            built.extend(batch_docs)

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["L"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=original),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(dp, "_apply_labels", new=AsyncMock(side_effect=fake_labels)),
            patch.object(dp, "_process_batch", new=AsyncMock(side_effect=fake_process_batch)),
            patch.object(dp_module, "Document", _recordable_doc),
            patch.object(dp_module, "ArangoGraph"),
        ):
            # Real _apply_contextualization runs (flag off → returns chunks unchanged,
            # no vLLM client). No VLLM_* env required.
            await dp.ingest_file_with_guardrail(inp)

        assert captured["labels_in"] == original  # no contextualization
        assert built[0].page_content == original[0]
        assert "chunk_text" not in built[0].metadata  # gated: flag off → no-op, no field

    @pytest.mark.asyncio
    async def test_client_build_failure_falls_back_to_raw(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        chunks = ["a", "b"]
        with (
            patch.object(dp_module, "_build_vllm_client", side_effect=RuntimeError("init failed")),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as log,
        ):
            result = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
        assert result == chunks  # raw; ingestion must not be blocked
        assert any(call.args[1] == "ERROR" for call in log.call_args_list)

    @pytest.mark.asyncio
    async def test_all_chunks_fail_emits_error_summary(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://x")
        monkeypatch.setenv("VLLM_MODEL_ID", "m")
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("boom"))
        chunks = ["c1", "c2"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as log,
        ):
            result = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
        assert result == chunks  # all raw
        assert any(call.args[1] == "ERROR" for call in log.call_args_list)

    @pytest.mark.asyncio
    async def test_doc_level_strategy_one_call_prepends_same_context(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setattr(dp_module, "CONTEXTUAL_STRATEGY", "doc_level")
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://x")
        monkeypatch.setenv("VLLM_MODEL_ID", "m")
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps({"context": "CUCUMBER GUIDE"})
        mock_response.usage = MagicMock(completion_tokens=10, prompt_tokens=40)
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        chunks = ["c1", "c2", "c3"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
        # doc_level = ONE call for the whole document
        assert mock_client.chat.completions.create.call_count == 1
        # the same context is prepended to every chunk
        assert all(r.startswith("CUCUMBER GUIDE\n\nc") for r in result)
        assert [r.split("\n\n", 1)[1] for r in result] == chunks

    @pytest.mark.asyncio
    async def test_doc_level_strategy_failure_falls_back_to_raw(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setattr(dp_module, "CONTEXTUAL_STRATEGY", "doc_level")
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://x")
        monkeypatch.setenv("VLLM_MODEL_ID", "m")
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("boom"))
        chunks = ["c1", "c2"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as log,
        ):
            result = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
        assert result == chunks  # all raw; ingestion not blocked
        assert mock_client.chat.completions.create.call_count == 3  # 3 retries, single doc call
        assert any(call.args[1] == "ERROR" for call in log.call_args_list)

    @pytest.mark.asyncio
    async def test_per_chunk_batch_size_splits_into_batches(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setattr(dp_module, "LABEL_LLM_BATCH_SIZE", 2)  # 5 chunks → 3 batches
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "m")

        async def fake_create(*args, **kwargs):
            items = json.loads(kwargs["messages"][1]["content"])
            ctxmap = {str(it["index"]): f"C{it['index']}" for it in items}
            r = MagicMock()
            r.choices = [MagicMock()]
            r.choices[0].message.content = json.dumps({"contexts": ctxmap})
            r.usage = MagicMock(completion_tokens=10, prompt_tokens=40)
            return r

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=fake_create)
        chunks = ["c0", "c1", "c2", "c3", "c4", "c5"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
        assert mock_client.chat.completions.create.call_count == 3  # 6 chunks / batch_size 2
        assert [r.split("\n\n", 1)[1] for r in result] == chunks  # originals preserved, in order
        assert result[0] == "C0\n\nc0" and result[5] == "C5\n\nc5"

    @pytest.mark.asyncio
    async def test_per_chunk_batch_parse_failure_falls_back_to_single(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "m")
        # Batch response unparseable → _context_batch_call falls back to per-chunk.
        bad = MagicMock()
        bad.choices = [MagicMock()]
        bad.choices[0].message.content = "not json"
        bad.usage = MagicMock(completion_tokens=1, prompt_tokens=1)
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=bad)
        called = []

        async def fake_single(client, model, sys_prompt, index, text, file_id):
            called.append(index)
            return f"S{index}"

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_context_single_call", new=AsyncMock(side_effect=fake_single)),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result = await dp._apply_contextualization(["c0", "c1"], create_mock_ingest_input(), "f")
        assert sorted(called) == [0, 1]  # both chunks fell back to per-chunk
        assert result[0] == "S0\n\nc0" and result[1] == "S1\n\nc1"

    @pytest.mark.asyncio
    async def test_ingest_label_raw_decouples_labeling_from_embedding(self, monkeypatch):
        """CONTEXTUAL_LABEL_RAW: label the RAW chunk, embed the CONTEXTUALIZED one."""
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setattr(dp_module, "CONTEXTUAL_LABEL_RAW", True)
        inp = create_mock_ingest_input()
        original = ["raw chunk one", "raw chunk two"]
        contextualized = ["CTX one\n\nraw chunk one", "CTX two\n\nraw chunk two"]
        captured = {"ctx_in": None, "labels_in": None}
        built = []

        async def fake_context(chunks, _inp, file_id):
            captured["ctx_in"] = list(chunks)
            return contextualized

        async def fake_labels(chunks, all_labels, file_labels, file_id):
            captured["labels_in"] = list(chunks)
            return [{"text": c, "labels": ["L"]} for c in chunks]

        async def fake_process_batch(batch_docs, *a, **k):
            built.extend(batch_docs)

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["L"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=original),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(dp, "_apply_contextualization", new=AsyncMock(side_effect=fake_context)),
            patch.object(dp, "_apply_labels", new=AsyncMock(side_effect=fake_labels)),
            patch.object(dp, "_process_batch", new=AsyncMock(side_effect=fake_process_batch)),
            patch.object(dp_module, "Document", _recordable_doc),
            patch.object(dp_module, "ArangoGraph"),
        ):
            await dp.ingest_file_with_guardrail(inp)

        # Decoupled: labeling got the RAW chunks; contextualization got the originals.
        assert captured["labels_in"] == original
        assert captured["ctx_in"] == original
        # Embedding gets the CONTEXTUALIZED text; metadata.chunk_text keeps the raw.
        assert len(built) == 2
        assert built[0].page_content == contextualized[0]
        assert built[0].metadata["chunk_text"] == original[0]
        assert built[1].page_content == contextualized[1]
