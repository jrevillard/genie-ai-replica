# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

"""Tests for GenieArangoDataprep extraction, chunking, labeling, and ingestion.

Covers _load_and_chunk, _run_guardrail, _label_with_llm, _label_with_embedding,
_label_with_bm25, _apply_labels, ingest_file_with_guardrail, retract_file, and
utility methods with fully mocked ArangoDB, LangChain, aiohttp, and OpenAI deps.
"""

import asyncio
import contextlib
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

try:
    import fcntl  # POSIX file locking — the service runs in a Linux container
except ModuleNotFoundError:  # Windows dev checkout: locking degrades to a no-op
    fcntl = None  # type: ignore[assignment]

import dataprep.genieai_dataprep_arangodb as dp_module
import dataprep.genieai_dataprep_microservice as ms
from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep
from tests.conftest import OVERLAY_ROOT

# The lock-acquisition tests assert on fcntl itself. POSIX locking does not
# exist on a Windows dev checkout, so those tests are skipped there (the
# microservice degrades to a no-op lock); they run everywhere else, including
# CI and the Linux container image.
requires_fcntl = pytest.mark.skipif(fcntl is None, reason="POSIX fcntl is unavailable on this platform")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def llm_response(content, prompt_tokens=80, completion_tokens=20):
    """A chat-completion response shaped like the real client's returns.

    ``usage`` carries INTEGER counters, and that is the whole point. A bare
    ``MagicMock`` answers ``response.usage.completion_tokens`` with another
    MagicMock, which passes production's ``getattr(_usage, "completion_tokens",
    None) is not None`` guard and is then handed to ``span.set_attribute``. The
    OTel SDK rejects the type and substitutes the mock's ``__str__`` — a
    free-text attribute that reaches VictoriaTraces verbatim.

    The span privacy sweep catches it, which is exactly why the fixture is
    shaped like the real response rather than the guard being loosened: the
    guard was right and the mock was lying about the contract.
    """
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].message.content = content
    response.usage = MagicMock(completion_tokens=completion_tokens, prompt_tokens=prompt_tokens)
    return response


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
    # Story 4.8-amend follow-up (David's 4th-time directive, 2026-08-21):
    # the bundle mirror helper looks up the concept file name from a cache.
    # __new__ skips __init__, so initialize the cache here too.
    dp._concept_file_name_cache = {}
    dp._bundle_file_id_cache = {}
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


async def _fetch_labels(taxonomy):
    """Run the real taxonomy fetch against *taxonomy* and return the labels."""
    dp = create_dataprep()
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
        return await dp._fetch_all_labels()


# The taxonomy the probe fetches, and the labels it asks the model to keep.
# The case variants are there on purpose: two labels that differ only in case
# must still have a defined order, in every process.
_PROBE_TAXONOMY = [
    {"name": "Healthcare", "children": [{"name": "Hospitals"}, {"name": "Clinics"}]},
    {"name": "Education", "children": ["Schools"]},
    {"name": "onion", "children": []},
    {"name": "Onion", "children": []},
]
_PROBE_SUGGESTED = ["Hospitals", "Clinics", "Schools"]

# The probe marks its result line, so a line the interpreter prints on the way
# out cannot be mistaken for the answer.
_PROBE_MARKER = "PROBE:"


async def _probe_main():
    """Fetch the taxonomy and finalise a chunk, in a fresh interpreter.

    The subprocess runs this: the point of the probe is the hash seed of the
    interpreter that builds the order, so the work has to happen in the child
    process rather than in the one running the suite.
    """
    labels = await _fetch_labels(_PROBE_TAXONOMY)
    dp = create_dataprep()
    with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
        stored = await dp._finalize_chunk_labels(0, _PROBE_SUGGESTED, labels, "file1")
    return {"labels": labels, "stored": stored}


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

    @pytest.mark.asyncio
    async def test_md_uses_markdown_header_splitter_with_h1_to_h4(self):
        """MD files use MarkdownHeaderTextSplitter with H1-H4 + strip_headers=True."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "README.md"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        md_doc = MagicMock(page_content="Section content", metadata={"Header 1": "Intro", "Header 2": "History"})
        md_splitter = MagicMock()
        md_splitter.split_text.return_value = [md_doc]
        char_splitter = MagicMock()
        char_splitter.split_documents.return_value = [md_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(
                dp_module,
                "document_loader",
                new_callable=AsyncMock,
                return_value="# Intro\n\n## History\n\nBody",
            ),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "MarkdownHeaderTextSplitter", return_value=md_splitter) as md_cls,
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=char_splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            await dp._load_and_chunk(doc_path)

        headers_call = md_cls.call_args.kwargs["headers_to_split_on"]
        assert [h[0] for h in headers_call] == ["#", "##", "###", "####"]
        assert md_cls.call_args.kwargs["strip_headers"] is True

    @pytest.mark.asyncio
    async def test_md_propagates_section_metadata_as_prefix(self):
        """Section path joined with ' > ' is prepended to chunk content for labelling."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "guide.md"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        md_doc = MagicMock(page_content="Body text", metadata={"Header 1": "A", "Header 2": "B", "Header 3": "C"})
        md_splitter = MagicMock()
        md_splitter.split_text.return_value = [md_doc]
        char_splitter = MagicMock()
        char_splitter.split_documents.return_value = [md_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="# A\n## B\n### C\nBody"),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "MarkdownHeaderTextSplitter", return_value=md_splitter),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=char_splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert len(result) == 1
        assert result[0].startswith("## A > B > C\n\n")
        assert "Body text" in result[0]

    @pytest.mark.asyncio
    async def test_md_ignores_non_string_metadata_values(self):
        """start_index (int) injected by add_start_index is excluded from section prefix."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "doc.md"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        # Real RecursiveCharacterTextSplitter(add_start_index=True) appends an
        # int offset to Document.metadata; the prefix must skip non-str values
        # to avoid TypeError on " > ".join().
        md_doc = MagicMock(
            page_content="Body",
            metadata={"Header 1": "Intro", "start_index": 42},
        )
        md_splitter = MagicMock()
        md_splitter.split_text.return_value = [md_doc]
        char_splitter = MagicMock()
        char_splitter.split_documents.return_value = [md_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="# Intro\nBody"),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "MarkdownHeaderTextSplitter", return_value=md_splitter),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=char_splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["## Intro\n\nBody"]

    @pytest.mark.asyncio
    async def test_md_no_section_metadata_omits_prefix(self):
        """Chunk without metadata (bare paragraph) gets no section prefix."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "notes.md"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        md_doc = MagicMock(page_content="Just prose", metadata={})
        md_splitter = MagicMock()
        md_splitter.split_text.return_value = [md_doc]
        char_splitter = MagicMock()
        char_splitter.split_documents.return_value = [md_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="Just prose"),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "MarkdownHeaderTextSplitter", return_value=md_splitter),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=char_splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        assert result == ["Just prose"]

    @pytest.mark.asyncio
    async def test_md_recursive_char_splitter_uses_doc_path_config(self):
        """RecursiveCharacterTextSplitter receives chunk_size/chunk_overlap from doc_path."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "doc.md"
        doc_path.chunk_size = 800
        doc_path.chunk_overlap = 80

        md_doc = MagicMock(page_content="x", metadata={"Header 1": "A"})
        md_splitter = MagicMock()
        md_splitter.split_text.return_value = [md_doc]
        char_splitter = MagicMock()
        char_splitter.split_documents.return_value = [md_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="# A\nx"),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "MarkdownHeaderTextSplitter", return_value=md_splitter),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=char_splitter) as char_cls,
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            await dp._load_and_chunk(doc_path)

        assert char_cls.call_args.kwargs["chunk_size"] == 800
        assert char_cls.call_args.kwargs["chunk_overlap"] == 80

    @pytest.mark.asyncio
    async def test_md_uses_split_documents_not_split_text(self):
        """RecursiveCharacterTextSplitter called via split_documents (preserves metadata + overlap)."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "doc.md"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        md_doc = MagicMock(page_content="y", metadata={"Header 1": "A"})
        md_splitter = MagicMock()
        md_splitter.split_text.return_value = [md_doc]
        char_splitter = MagicMock()
        char_splitter.split_documents.return_value = [md_doc]

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="# A\ny"),
            patch.object(dp_module, "is_valid_content", return_value=True),
            patch.object(dp_module, "MarkdownHeaderTextSplitter", return_value=md_splitter),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=char_splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            await dp._load_and_chunk(doc_path)

        char_splitter.split_documents.assert_called_once()
        char_splitter.split_text.assert_not_called()

    @pytest.mark.asyncio
    async def test_md_filters_invalid_content(self):
        """Invalid chunks (per is_valid_content) are filtered out."""
        dp = create_dataprep()

        doc_path = MagicMock()
        doc_path.path = "doc.md"
        doc_path.chunk_size = 1500
        doc_path.chunk_overlap = 150

        md_docs = [
            MagicMock(page_content="valid", metadata={"Header 1": "A"}),
            MagicMock(page_content="no", metadata={"Header 1": "A"}),
        ]
        md_splitter = MagicMock()
        md_splitter.split_text.return_value = md_docs
        char_splitter = MagicMock()
        char_splitter.split_documents.return_value = md_docs

        with (
            patch.object(dp_module, "CONTENT_EXTRACTION_METHOD", "opea"),
            patch.object(dp_module, "document_loader", new_callable=AsyncMock, return_value="# A\nvalid\nno"),
            patch.object(dp_module, "is_valid_content", side_effect=lambda c: len(c) > 10),
            patch.object(dp_module, "MarkdownHeaderTextSplitter", return_value=md_splitter),
            patch.object(dp_module, "RecursiveCharacterTextSplitter", return_value=char_splitter),
            patch.object(dp_module, "get_separators", return_value=["\n\n"]),
        ):
            result = await dp._load_and_chunk(doc_path)

        # Only "valid" survives (is_valid_content: len>5); "no" is dropped
        assert len(result) == 1
        assert result[0].startswith("## A\n\n")
        assert "valid" in result[0]
        assert "no" not in [r.replace("## A\n\n", "") for r in result]


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
                return_value=([{"text": "chunk", "labels": ["A"]}], []),
            ),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._apply_labels(["chunk"], ["A", "B"], [], "file1")

        assert result == [{"text": "chunk", "labels": ["A"]}]

    @pytest.mark.asyncio
    async def test_dispatches_to_embedding(self):
        dp = create_dataprep()

        with (
            patch.object(dp_module, "LABELING_STRATEGY", "embedding"),
            patch.object(dp, "_label_with_embedding", return_value=[{"text": "chunk", "labels": ["A"]}]),
        ):
            result, _degraded = await dp._apply_labels(["chunk"], ["A", "B"], [], "file1")

        assert result == [{"text": "chunk", "labels": ["A"]}]

    @pytest.mark.asyncio
    async def test_dispatches_to_bm25(self):
        dp = create_dataprep()

        with (
            patch.object(dp_module, "LABELING_STRATEGY", "bm25"),
            patch.object(dp, "_label_with_bm25", return_value=[{"text": "chunk", "labels": ["A"]}]),
        ):
            result, _degraded = await dp._apply_labels(["chunk"], ["A", "B"], [], "file1")

        assert result == [{"text": "chunk", "labels": ["A"]}]

    @pytest.mark.asyncio
    async def test_the_fallback_labels_are_stored_in_a_canonical_order(self):
        """Without a taxonomy the document's own scope is the only label source.

        The stored array must not depend on the order the scope arrived in.
        """
        dp = create_dataprep()

        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            docs, reasons = await dp._apply_labels(["chunk"], [], ["Schools", "Clinics"], "file1")

        assert docs == [{"text": "chunk", "labels": ["Clinics", "Schools"]}]
        assert reasons == []

    @pytest.mark.asyncio
    async def test_fallback_to_file_labels_when_empty_taxonomy(self):
        dp = create_dataprep()

        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result, _degraded = await dp._apply_labels(["chunk"], [], ["FileLabel"], "file1")

        assert result == [{"text": "chunk", "labels": ["FileLabel"]}]

    @pytest.mark.asyncio
    async def test_fallback_to_empty_when_no_labels(self):
        dp = create_dataprep()

        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result, _degraded = await dp._apply_labels(["chunk"], [], [], "file1")

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

        mock_response = llm_response(json.dumps({"labels": ["Healthcare"]}))

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["test chunk"], ["Healthcare", "Education"], [], "file1")

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
            result, _degraded = await dp._label_with_llm(["chunk"], ["FallbackLabel"], ["FallbackLabel"], "file1")

        assert result[0]["labels"] == ["FallbackLabel"]
        assert mock_client.chat.completions.create.call_count == 3

    @pytest.mark.asyncio
    async def test_synonym_matching_case_insensitive(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = llm_response(json.dumps({"labels": ["healthcare"]}))

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

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

        # LLM suggests a sibling crop (Cucumber) plus the in-scope Tomato.
        mock_response = llm_response(json.dumps({"labels": ["Cucumber", "Tomato"]}))

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(
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

        mock_response = llm_response(json.dumps({"labels": ["Healthcare"]}))

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

        assert result[0]["labels"] == ["Healthcare"]

    @pytest.mark.asyncio
    async def test_batch_labeling_makes_one_call_per_batch(self, monkeypatch):
        """With LABEL_LLM_BATCH_SIZE>1, multiple chunks share a single LLM call."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dp_module, "LABEL_LLM_BATCH_SIZE", 2)

        mock_response = llm_response(json.dumps({"0": ["Healthcare"], "1": ["Education"]}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(
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

        bad = llm_response("not json")
        good = llm_response(json.dumps({"labels": ["Healthcare"]}))

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=[bad, good, good])

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk0", "chunk1"], ["Healthcare"], [], "file1")

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

        # chunk 0 -> labels, chunk 1 -> null (model's "no labels" convention)
        mock_response = llm_response(json.dumps({"0": ["Healthcare"], "1": None}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk0", "chunk1"], ["Healthcare"], [], "file1")

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

        mock_response = llm_response(json.dumps({"labels": None}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

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

        mock_response = llm_response(json.dumps({"0": "Healthcare", "1": ["Education"]}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk0", "chunk1"], ["Healthcare", "Education"], [], "file1")

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

        # chunk 0 -> number (unusable), chunk 1 -> valid list
        mock_response = llm_response(json.dumps({"0": 123, "1": ["Education"]}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk0", "chunk1"], ["Education"], [], "file1")

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

        # Two exact-match labels → previously 2 per-label logs + 1 final = 3.
        mock_response = llm_response(json.dumps({"labels": ["Healthcare", "Education"]}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        log_mock = AsyncMock()
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new=log_mock),
        ):
            result, _degraded = await dp._label_with_llm(["chunk"], ["Healthcare", "Education"], [], "file1")

        assert set(result[0]["labels"]) == {"Healthcare", "Education"}
        assert log_mock.call_count == 1  # one consolidated summary, not per-label

    @pytest.mark.asyncio
    async def test_consolidated_logging_warns_on_new_labels(self, monkeypatch):
        """Non-taxonomy suggestions surface as a single WARN, not one log per label."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_response = llm_response(json.dumps({"labels": ["Healthcare", "QuantumAgriculture"]}))
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

        mock_response = llm_response(json.dumps({"labels": ["Healthcare"]}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        span = MagicMock()
        cm = MagicMock()
        cm.__enter__ = MagicMock(return_value=span)
        cm.__exit__ = MagicMock(return_value=False)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp_module, "background_span", return_value=cm) as ws,
        ):
            await dp._label_with_llm(["chunk"], ["Healthcare"], [], "file1")

        # Two spans now open around a labelling phase: the phase-level one that
        # carries the budget outcome, and one label_chunk per call. This test is
        # about the second, so it selects it rather than asserting a total.
        label_chunk_calls = [c for c in ws.call_args_list if c.args[0] == "dataprep.llm.label_chunk"]
        assert len(label_chunk_calls) == 1, [c.args[0] for c in ws.call_args_list]
        assert label_chunk_calls[0].kwargs["attributes"]["dataprep.chunk_index"] == 0
        # The phase span is what makes a budget exhaustion visible; without it
        # the whole incident this policy exists for leaves no span trace.
        assert [c.args[0] for c in ws.call_args_list].count("dataprep.llm.phase") == 1

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
            result, _degraded = await dp._label_with_llm(["chunk"], ["Healthcare"], ["Healthcare"], "file1")

        # 3 failed attempts → fallback to file labels (Healthcare is in taxonomy, survives).
        assert result[0]["labels"] == ["Healthcare"]
        # Each failure must surface the exception type so it is diagnosable.
        logged_msgs = [c.args[3] for c in log_mock.call_args_list]
        assert any("TimeoutError" in m and "attempt" in m for m in logged_msgs)


# ---------------------------------------------------------------------------
# TestLabelWithEmbedding
# ---------------------------------------------------------------------------


class TestDataprepInputTooLong:
    """Tests for the vLLM context-overflow fail-loud contract.

    Mirrors the reranker fix (RerankerInputTooLongError, genieai_tei_reranker.py:39):
    when vLLM rejects a request because the prompt exceeds the model's
    max_model_len, the dataprep call site must raise a typed exception
    instead of silently swallowing the error and falling back to the
    raw chunk. The classification is string-based (any exception whose
    message carries a vLLM/OpenAI context-overflow marker is treated as
    overflow) — no SDK version lock-in.
    """

    @pytest.mark.asyncio
    async def test_context_overflow_raises_typed_exception(self, monkeypatch):
        """vLLM 'context length exceeded' → raise DataprepInputTooLongError, no silent fallback."""
        from dataprep.genieai_dataprep_arangodb import DataprepInputTooLongError

        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception(
                "Error code: 400 - {'message': 'Input prompt (30000 tokens) exceeds "
                "maximum context length (8192 tokens). Please reduce the length.'}"
            )
        )

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            pytest.raises(DataprepInputTooLongError),
        ):
            await dp._label_with_llm(["chunk"], ["LabelA"], ["LabelA"], "file1")

    @pytest.mark.asyncio
    async def test_context_overflow_does_not_retry_three_times(self, monkeypatch):
        """Overflow fails fast — the 3x retry loop on identical oversized prompt is removed."""
        from dataprep.genieai_dataprep_arangodb import DataprepInputTooLongError

        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("BadRequestError: This model's maximum context length is 8192 tokens")
        )

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            pytest.raises(DataprepInputTooLongError),
        ):
            await dp._label_with_llm(["chunk"], ["LabelA"], ["LabelA"], "file1")

        # Fail-loud: exactly ONE attempt, not three.
        assert mock_client.chat.completions.create.call_count == 1

    @pytest.mark.asyncio
    async def test_context_overflow_writes_to_ingestion_log(self, monkeypatch):
        """The overflow reason surfaces via _write_ingestion_log (admin /api/admin/ingestion-log channel)."""
        from dataprep.genieai_dataprep_arangodb import DataprepInputTooLongError

        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("context_length_exceeded: prompt tokens (25000) > model max (4096)")
        )

        write_log = AsyncMock()
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", write_log),
            pytest.raises(DataprepInputTooLongError),
        ):
            await dp._label_with_llm(["chunk"], ["LabelA"], ["LabelA"], "file1")

        write_log.assert_awaited_once()
        first_args = write_log.await_args.args
        # _write_ingestion_log(self, file_id, level, stage, message) signature
        assert first_args[0] == "file1"
        msg = str(first_args[3])
        assert "context" in msg.lower() or "vllm" in msg.lower()

    @pytest.mark.asyncio
    async def test_non_overflow_bad_request_preserves_silent_fallback(self, monkeypatch):
        """Regression guard: only context-length errors escalate — other failures still silently fall back.

        A 400-class error like 'invalid_request_error' (guided-JSON failure, schema mismatch)
        is NOT overflow; the existing 'raw-chunk fallback' contract for those errors is preserved.
        """
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception(
                "BadRequestError: invalid_request_error - guided-json schema mismatch on field 'labels'"
            )
        )

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            # File labels in taxonomy → synonym-matching fallback succeeds.
            result, _degraded = await dp._label_with_llm(["chunk"], ["FallbackLabel"], ["FallbackLabel"], "file1")

        assert result[0]["labels"] == ["FallbackLabel"]

    @pytest.mark.asyncio
    async def test_batch_overflow_raises_typed_no_perchunk_fallback(self, monkeypatch):
        """Regression (reviewer note 71787): the batch overflow path must raise
        `DataprepInputTooLongError` IMMEDIATELY, not fall back to per-chunk
        (which would just issue one more identical-sized vLLM call)."""
        from dataprep.genieai_dataprep_arangodb import DataprepInputTooLongError

        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("Error code: 400 - context_length_exceeded (max 2048). Please reduce the length.")
        )

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            pytest.raises(DataprepInputTooLongError),
        ):
            # len(batch) > 1 forces the batch path (`_llm_suggest_labels` → `_llm_call_batch`).
            await dp._label_with_llm(
                ["chunk A", "chunk B", "chunk C"],
                ["Healthcare"],
                ["Healthcare"],
                "file_batch_overflow",
            )
        # Exactly one vLLM call attempted — NO per-chunk fallback for overflow.
        assert mock_client.chat.completions.create.call_count == 1

    @pytest.mark.asyncio
    async def test_live_openai_badrequest_classifier_matches(self, monkeypatch):
        """Reviewer Finding 1+2 regression: production exception (openai SDK >=3.x)
        has `str(exc)` that does NOT include the body — the body lives on `.body`
        (dict) and `.response.text`. The classifier reads BOTH. We use a duck-typed
        `__str__` that mimics the live SDK output (`"Error code: 400"` only) so the
        test exercises the production body-reading path."""
        import json as _json

        from dataprep.genieai_dataprep_arangodb import (
            DataprepInputTooLongError,
            _is_vllm_input_overflow,
            _overflow_message_from_exc,
        )

        body_dict = {
            "error": {
                "message": (
                    "This model's maximum context length is 65536 tokens. "
                    "However, you requested 160 output tokens and your prompt "
                    "contains at least 65437 input tokens. Please reduce the "
                    "length of the input prompt."
                )
            }
        }
        body_str = _json.dumps(body_dict)

        class _LiveShapeBadRequest(Exception):
            """Duck-types openai.BadRequestError 3.x — str() returns ONLY the
            status phrase, body is on .body (dict) and .response.text (string)."""

            def __init__(self, body, body_str):
                super().__init__("Error code: 400")
                self.body = body
                self.response = type("Resp", (), {"text": body_str})()

            def __str__(self):
                return "Error code: 400"

        exc = _LiveShapeBadRequest(body_dict, body_str)
        # The bug: str(exc) does NOT contain the marker.
        assert "context length" not in str(exc).lower()
        # The classifier must read the body and still match.
        assert "context length" in _overflow_message_from_exc(exc)
        assert _is_vllm_input_overflow(exc) is True

        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        # Audit: production path must raise DataprepInputTooLongError when the
        # catch block sees the same exception shape the unit-level classifier matched.
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=exc)

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            pytest.raises(DataprepInputTooLongError),
        ):
            await dp._label_with_llm(["chunk"], ["Healthcare"], ["Healthcare"], "file1")

    @pytest.mark.asyncio
    async def test_overflow_message_helper_extracts_from_httpx_response_text(self):
        """Unit-level: helper must read `.response.text` (httpx shape)."""

        class _LiveShapeHTTPStatusError:
            """Duck-types httpx.HTTPStatusError — str() returns the status phrase ONLY,
            body lives on .response.text."""

            def __init__(self, body_text):
                self.response = type("Resp", (), {"text": body_text})()

            def __str__(self):
                return "Client error '400 Bad Request' for url 'http://x/v1/chat/completions'"

        from dataprep.genieai_dataprep_arangodb import _is_vllm_input_overflow, _overflow_message_from_exc

        exc = _LiveShapeHTTPStatusError(
            '{"error":{"message":"maximum context length is 4096 tokens. Please reduce the length."}}'
        )
        assert "context length" not in str(exc).lower()
        assert "context length" in _overflow_message_from_exc(exc)
        assert _is_vllm_input_overflow(exc) is True

    @pytest.mark.asyncio
    async def test_overflow_message_helper_skips_overbroad_string_too_long(self):
        """Unit-level: 'string too long' is overbroad per reviewer Finding 5
        (fires on tool_calls[id] oversize, not just context overflow). It is NOT
        in the marker set."""
        from dataprep.genieai_dataprep_arangodb import _is_vllm_input_overflow

        exc = Exception("Invalid 'messages[2].tool_calls[0].id': string too long (max 64 chars).")
        assert _is_vllm_input_overflow(exc) is False

    @pytest.mark.asyncio
    async def test_context_single_call_overflow_returns_raw_no_retry(self, monkeypatch):
        """_context_single_call: vLLM context overflow degrades to the raw chunk
        (returns '') after ONE attempt — a 400 is deterministic, retrying the
        identical prompt is wasted calls.

        Bali regression (2026-10-16): this site used to raise
        DataprepInputTooLongError, which killed the WHOLE ingest (0 chunks
        persisted, concept terminal-failed) — breaking the documented
        "never blocks ingestion (raw-chunk fallback)" contextualization
        contract. The fail-loud contract above stays for LABELING only.
        """
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("Error code: 400 - context length exceeded (max 4096 tokens)")
        )
        write_log = AsyncMock()

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", write_log),
        ):
            ctx = await dp._context_single_call(mock_client, "m", "sys", 0, "chunk text", "file1")

        assert ctx == ""  # caller keeps the raw chunk
        assert mock_client.chat.completions.create.call_count == 1  # no 3x retry on a deterministic 400
        assert any("overflow" in str(c.args[3]).lower() for c in write_log.await_args_list)

    @pytest.mark.asyncio
    async def test_context_doc_call_overflow_returns_raw_no_retry(self, monkeypatch):
        """_context_doc_call: doc-level context overflow degrades to raw chunks
        (returns '') after ONE attempt — Bali regression 2026-10-16, see the
        single-call test above."""
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("This model's maximum context length is 2048 tokens. Please reduce the length.")
        )
        write_log = AsyncMock()

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", write_log),
        ):
            ctx = await dp._context_doc_call(mock_client, "m", "sys", "file1")

        assert ctx == ""  # caller (_contextualize_doc_level) falls back to raw chunks
        assert mock_client.chat.completions.create.call_count == 1
        assert any("overflow" in str(c.args[3]).lower() for c in write_log.await_args_list)

    @pytest.mark.asyncio
    async def test_context_batch_call_overflow_falls_back_per_chunk(self, monkeypatch):
        """Bali regression (2026-10-16): the batch context call 400'd by ONE token
        (Cyrillic-heavy doc at ~1.75 chars/token vs the CHARS_PER_TOKEN=4
        derivation estimate) and the fatal raise killed the whole ingest. The
        overflow must fall back to per-chunk calls — a per-chunk call reserves
        512 output tokens instead of the batch's N x 512, which is exactly the
        term that overflowed."""

        def ok_response(i):
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.content = json.dumps({"context": f"ctx {i}"})
            resp.usage = MagicMock(completion_tokens=5, prompt_tokens=10)
            return resp

        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        calls = {"n": 0}

        async def fake_create(**kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                # The batch call overflows; every per-chunk call then succeeds.
                raise Exception(
                    "Error code: 400 - {'error': {'message': \"This model's maximum context "
                    "length is 65536 tokens. However, you requested 8192 output tokens and "
                    'your prompt contains at least 57345 input tokens."}}'
                )
            return ok_response(calls["n"])

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=fake_create)
        write_log = AsyncMock()

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", write_log),
        ):
            out = await dp._context_batch_call(mock_client, "m", "sys", [(0, "a"), (1, "b"), (2, "c")], "file1")

        assert out == {0: "ctx 2", 1: "ctx 3", 2: "ctx 4"}  # all chunks contextualized
        assert calls["n"] == 4  # 1 failed batch + 3 per-chunk recoveries
        assert any("overflow" in str(c.args[3]).lower() for c in write_log.await_args_list)

    @pytest.mark.asyncio
    async def test_context_batch_call_overflow_then_single_overflow_yields_raw(self, monkeypatch):
        """Worst case: the doc context alone exceeds the window, so batch AND
        every per-chunk call overflow. Every chunk must come back '' (raw), and
        NOTHING may raise — the ingest completes on raw chunks."""

        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("BadRequestError: This model's maximum context length is 65536 tokens")
        )

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            out = await dp._context_batch_call(mock_client, "m", "sys", [(0, "a"), (1, "b")], "file1")

        assert out == {0: "", 1: ""}  # raw chunks — the ingest is NOT failed


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
# TestIsConceptId (review 2026-10-29 round 3: the old first-char-digit
# heuristic misclassified digit-leading concept ids like '3d_printing_guide'
# as doc-repo file_ids, silently skipping their bundle-log mirror)
# ---------------------------------------------------------------------------


class TestIsConceptId:
    """Tests for _is_concept_id() — the bundle-mirror eligibility predicate.

    Invariant: a value is a doc-repo file_id ONLY when it matches the
    timestamped shape `<millis>_<hex8+>` (fileUtils.generateUniqueFileId);
    every other value is a concept id whose ingestion log must mirror into
    the bundle.
    """

    def test_digit_leading_concept_id_is_a_concept(self):
        """'3d_printing_guide' begins with a digit but is a bare concept id —
        it must mirror (the old value[0].isdigit() check excluded it)."""
        dp = create_dataprep()
        assert dp._is_concept_id("3d_printing_guide") is True

    def test_timestamped_doc_repo_file_id_is_not_a_concept(self):
        """The real doc-repo shape (`${Date.now()}_${uuidv4()[:8]}`) is a
        file_id — no bundle mirror."""
        dp = create_dataprep()
        assert dp._is_concept_id("1774623200119_e9887fa8") is False

    def test_bare_word_concept_ids_are_concepts(self):
        dp = create_dataprep()
        assert dp._is_concept_id("ecitizen_digital_payments") is True
        assert dp._is_concept_id("index") is True

    def test_empty_and_none_are_safely_not_concepts(self):
        """Empty/None are not concept ids — callers treat False as 'do not
        mirror' without raising."""
        dp = create_dataprep()
        assert dp._is_concept_id("") is False
        assert dp._is_concept_id(None) is False


# ---------------------------------------------------------------------------
# TestUpdateDocStatusRouting (2026-10-10 live: 6× ERROR "Metadata not found"
# during the Slaugherhouse ingest — a call site that lost concept_id still
# carried a CONCEPT id as file_id and the fallthrough PATCHed doc-repo,
# which rightly has no metadata for concept ids. An OKF-context job must
# route to the OKF control plane even without concept_id.)
# ---------------------------------------------------------------------------


class TestUpdateDocStatusRouting:
    """Tests for _update_doc_status() endpoint routing."""

    def _mock_session(self):
        import aiohttp as aiohttp_mod

        mock_session = MagicMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.text = AsyncMock(return_value="ok")
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)
        mock_session.patch.return_value = mock_resp
        aiohttp_mod.ClientSession.return_value = mock_session
        aiohttp_mod.ClientTimeout.return_value = MagicMock()
        return mock_session

    @pytest.mark.asyncio
    async def test_okf_context_without_concept_id_routes_to_okf_server(self):
        """file_id is a CONCEPT id and concept_id was lost — the OKF ingest
        context (repo_id in ctx) still routes the callback to the OKF
        control plane, never to doc-repo (the 404-noise origin fix)."""
        dp = create_dataprep()
        dp._current_repo_id = None
        token = dp_module._INGEST_CTX.set({"repo_id": "repo-1"})
        try:
            with (
                patch.object(
                    dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}
                ),
                patch.object(dp_module, "OKF_SERVER_URL", "http://okf-test:3002"),
                patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
                patch.object(dp_module.propagate, "inject"),
            ):
                session = self._mock_session()
                await dp._update_doc_status("guidance-doc-import-smoke-1789404732138-sec5", "Ingested", chunk_count=8)

            called_url = session.patch.call_args[0][0]
            assert "/api/okf/internal/concepts/" in called_url
            assert "/api/files/" not in called_url
            payload = session.patch.call_args[1]["json"]
            assert payload["repo_id"] == "repo-1"
            assert payload["file_id"] == "guidance-doc-import-smoke-1789404732138-sec5"
        finally:
            dp_module._INGEST_CTX.reset(token)

    @pytest.mark.asyncio
    async def test_ctx_bound_okf_graph_hint_routes_without_repo_id(self):
        """An OKF_-graph ingest carries NO repo_id (a graph name is a name,
        not an identity field) — the ctx-bound okf_graph_hint must make
        is_okf_job true on its own, so the completion routes to the OKF
        control plane instead of the hardcoded-False legacy route (review
        round 2, thread e0e879eb). The payload claims no repo (there is
        none to claim)."""
        dp = create_dataprep()
        dp._current_repo_id = None
        token = dp_module._INGEST_CTX.set({"repo_id": None, "okf_graph_hint": True})
        try:
            with (
                patch.object(
                    dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}
                ),
                patch.object(dp_module, "OKF_SERVER_URL", "http://okf-test:3002"),
                patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
                patch.object(dp_module.propagate, "inject"),
            ):
                session = self._mock_session()
                await dp._update_doc_status("guidance-doc-import-smoke-1789404732138-sec5", "Ingested", chunk_count=3)

            called_url = session.patch.call_args[0][0]
            assert "/api/okf/internal/concepts/" in called_url
            assert "/api/files/" not in called_url
            payload = session.patch.call_args[1]["json"]
            assert "repo_id" not in payload  # nothing to claim — no repo_id in ctx
        finally:
            dp_module._INGEST_CTX.reset(token)

    @pytest.mark.asyncio
    async def test_ctx_bound_false_hint_routes_to_doc_repo(self):
        """A legacy-graph ingest binds okf_graph_hint=False in the ctx — the
        ctx-bound branch reads the hint (no longer hardcodes it) and still
        routes to doc-repo."""
        dp = create_dataprep()
        dp._current_repo_id = None
        token = dp_module._INGEST_CTX.set({"repo_id": None, "okf_graph_hint": False})
        try:
            with (
                patch.object(
                    dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}
                ),
                patch.object(dp_module, "OKF_SERVER_URL", "http://okf-test:3002"),
                patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
                patch.object(dp_module.propagate, "inject"),
            ):
                session = self._mock_session()
                await dp._update_doc_status("1791566703011_a807dad8", "Ingested", chunk_count=12)

            called_url = session.patch.call_args[0][0]
            assert "/api/files/1791566703011_a807dad8/status" in called_url
            assert "/api/okf/" not in called_url
        finally:
            dp_module._INGEST_CTX.reset(token)

    @pytest.mark.asyncio
    async def test_legacy_job_without_okf_context_routes_to_doc_repo(self):
        """No concept_id and no OKF context = a legacy single-file ingest —
        the doc-repo status PATCH is preserved unchanged."""
        dp = create_dataprep()
        dp._current_repo_id = None
        token = dp_module._INGEST_CTX.set({})
        try:
            with (
                patch.object(
                    dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}
                ),
                patch.object(dp_module, "OKF_SERVER_URL", "http://okf-test:3002"),
                patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
                patch.object(dp_module.propagate, "inject"),
            ):
                session = self._mock_session()
                await dp._update_doc_status("1791566703011_a807dad8", "Ingested", chunk_count=12)

            called_url = session.patch.call_args[0][0]
            assert "/api/files/1791566703011_a807dad8/status" in called_url
            assert "/api/okf/" not in called_url
            payload = session.patch.call_args[1]["json"]
            assert payload["dataprep"]["status"] == "Ingested"
        finally:
            dp_module._INGEST_CTX.reset(token)

    # -----------------------------------------------------------------
    # Retry contract (review 2026-10-29 round 3): this PATCH is the ONLY
    # channel that flips a meta row to 'indexed'. The loop used to return on
    # ANY response — a single transient 5xx discarded the whole ~30-min
    # ingest, the row never reached 'indexed', and the worker re-billed it
    # in full. Only the documented success status (200) may end the loop.
    # -----------------------------------------------------------------

    @staticmethod
    def _mock_session_with_statuses(statuses):
        """A session whose successive PATCH calls return the given statuses."""
        import aiohttp as aiohttp_mod

        mock_session = MagicMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        responses = []
        for status in statuses:
            resp = MagicMock()
            resp.status = status
            resp.text = AsyncMock(return_value=f"body-{status}")
            resp.__aenter__ = AsyncMock(return_value=resp)
            resp.__aexit__ = AsyncMock(return_value=False)
            responses.append(resp)
        mock_session.patch = MagicMock(side_effect=responses)
        aiohttp_mod.ClientSession.return_value = mock_session
        aiohttp_mod.ClientTimeout.return_value = MagicMock()
        return mock_session

    @pytest.mark.asyncio
    async def test_non_200_response_is_retried_until_success(self):
        """503 then 200: the non-200 attempt must be retried, not swallowed."""
        dp = create_dataprep()
        dp._current_repo_id = None
        token = dp_module._INGEST_CTX.set({})
        try:
            with (
                patch.object(
                    dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}
                ),
                patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
                patch.object(dp_module.propagate, "inject"),
                patch("dataprep.genieai_dataprep_arangodb.asyncio.sleep", new_callable=AsyncMock) as mock_sleep,
            ):
                session = self._mock_session_with_statuses([503, 200])
                await dp._update_doc_status("1791566703011_a807dad8", "Ingested", chunk_count=12)

            assert session.patch.call_count == 2, "the 503 attempt must be retried"
            mock_sleep.assert_awaited_once()  # backoff between attempt 1 and 2
        finally:
            dp_module._INGEST_CTX.reset(token)

    @pytest.mark.asyncio
    async def test_persistent_non_200_exhausts_three_attempts_without_raising(self):
        """All 500s: 3 attempts with backoff, then give up best-effort — the
        callback must never raise into the ingest's error path."""
        dp = create_dataprep()
        dp._current_repo_id = None
        token = dp_module._INGEST_CTX.set({})
        try:
            with (
                patch.object(
                    dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}
                ),
                patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
                patch.object(dp_module.propagate, "inject"),
                patch("dataprep.genieai_dataprep_arangodb.asyncio.sleep", new_callable=AsyncMock) as mock_sleep,
            ):
                session = self._mock_session_with_statuses([500, 500, 500, 500])
                await dp._update_doc_status("1791566703011_a807dad8", "Ingested")

            assert session.patch.call_count == 3
            assert mock_sleep.await_count == 2  # between 1->2 and 2->3 only
        finally:
            dp_module._INGEST_CTX.reset(token)

    @pytest.mark.asyncio
    async def test_first_attempt_200_returns_immediately(self):
        """A genuine 200 on the first attempt returns at once — no retry, no
        backoff (the old fast path, unchanged)."""
        dp = create_dataprep()
        dp._current_repo_id = None
        token = dp_module._INGEST_CTX.set({})
        try:
            with (
                patch.object(
                    dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}
                ),
                patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
                patch.object(dp_module.propagate, "inject"),
            ):
                session = self._mock_session_with_statuses([200])
                await dp._update_doc_status("1791566703011_a807dad8", "Ingested", chunk_count=12)

            assert session.patch.call_count == 1
        finally:
            dp_module._INGEST_CTX.reset(token)

    # -----------------------------------------------------------------
    # Standalone-retract routing (review 2026-10-29 round 3): retract_file
    # runs OUTSIDE any ingest context, so _update_doc_status's legacy
    # fallback read the singleton attrs — whatever repo a CONCURRENT ingest
    # last stashed on self. Routing must come from the retract request's own
    # OKF_ graph marker instead.
    # -----------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_standalone_okf_retract_routes_by_own_graph_name(self):
        """An OKF retract (graph OKF_...) routes its 'Retracted' callback to
        the OKF control plane even with another ingest's repo on the
        singleton — and claims no repo identity the request never carried."""
        dp = create_dataprep()
        dp._current_repo_id = "repo-from-concurrent-ingest"
        dp.db.aql.execute = MagicMock(return_value=TestRetractFile._empty_chunk_cursor())
        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}),
            patch.object(dp_module, "OKF_SERVER_URL", "http://okf-test:3002"),
            patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
            patch.object(dp_module.propagate, "inject"),
        ):
            session = self._mock_session()
            await dp.retract_file("concept-3d-printing", "OKF_repo_1")

        called_url = session.patch.call_args[0][0]
        assert "/api/okf/internal/concepts/" in called_url
        assert "/api/files/" not in called_url
        payload = session.patch.call_args[1]["json"]
        assert payload["status"] == "Retracted"
        # No repo identity is claimed on the retract's behalf: the request
        # carries none, and the singleton value belongs to another ingest.
        assert "repo_id" not in payload

    @pytest.mark.asyncio
    async def test_standalone_legacy_retract_ignores_stale_okf_singleton(self):
        """A legacy-graph retract must PATCH doc-repo even when a concurrent
        OKF ingest left its repo_id on the singleton — the stale value must
        not misroute the callback (the regression this pins)."""
        dp = create_dataprep()
        dp._current_repo_id = "repo-from-concurrent-okf-ingest"
        dp.db.aql.execute = MagicMock(return_value=TestRetractFile._empty_chunk_cursor())
        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_service_headers", new_callable=AsyncMock, return_value={"Authorization": "Bearer t"}),
            patch.object(dp_module, "OKF_SERVER_URL", "http://okf-test:3002"),
            patch.object(dp_module, "DOCUMENT_REPOSITORY_URL", "http://docrepo-test:3001"),
            patch.object(dp_module.propagate, "inject"),
        ):
            session = self._mock_session()
            await dp.retract_file("1791566703011_a807dad8", "GRAPH")

        called_url = session.patch.call_args[0][0]
        assert "/api/files/1791566703011_a807dad8/status" in called_url
        assert "/api/okf/" not in called_url
        payload = session.patch.call_args[1]["json"]
        assert payload["dataprep"]["status"] == "Retracted"


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
            # Not degraded: this test is about graph insertion, and with no vLLM
            # reachable the real _apply_contextualization reports its own
            # client-init failure as a degradation, which would flip the status
            # for reasons that have nothing to do with what is under test here.
            patch.object(
                dp,
                "_apply_contextualization",
                new_callable=AsyncMock,
                side_effect=lambda chunks, inp, fid: (list(chunks), []),
            ),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=(
                    [
                        {"text": "chunk1", "labels": ["A"]},
                        {"text": "chunk2", "labels": ["B"]},
                    ],
                    [],
                ),
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

    @staticmethod
    def _ctx_capture_patches(dp, inp):
        """Happy-path patch set for ingest_file_with_guardrail, with the
        first _update_doc_status call capturing the request ctx that the
        ingest start bound (the ctx is set BEFORE 'Ingesting', so the
        side_effect reads the production-shape dict)."""
        captured = {}

        async def _capture_ctx(file_id, status, **kwargs):
            captured.setdefault("ctx", dp_module._INGEST_CTX.get())

        patches = [
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock, side_effect=_capture_ctx),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["Healthcare"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["chunk1", "chunk2"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_contextualization",
                new_callable=AsyncMock,
                side_effect=lambda chunks, inp, fid: (list(chunks), []),
            ),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=(
                    [
                        {"text": "chunk1", "labels": ["A"]},
                        {"text": "chunk2", "labels": ["B"]},
                    ],
                    [],
                ),
            ),
            patch.object(dp, "_process_batch", new_callable=AsyncMock),
            patch.object(dp_module, "ArangoGraph"),
        ]
        return patches, captured

    @pytest.mark.asyncio
    async def test_okf_graph_ingest_binds_the_hint_into_the_request_ctx(self):
        """OKF_-graph ingest WITHOUT a repo_id: the ingest-start ctx binds
        okf_graph_hint=True NEXT TO repo_id=None — one per-request source
        carries both routing values, so a bound context no longer means the
        hint is hardcoded False (review round 2, thread e0e879eb)."""
        dp = create_dataprep()
        inp = create_mock_ingest_input(file_id="ctx-hint-okf", graph_name="OKF_ncd_v1", repo_id=None)
        patches, captured = self._ctx_capture_patches(dp, inp)

        try:
            with contextlib.ExitStack() as stack:
                for p in patches:
                    stack.enter_context(p)
                result = await dp.ingest_file_with_guardrail(inp, lock_file=None)
        finally:
            dp_module._INGEST_CTX.set(None)

        assert result["status"] == 200
        assert captured["ctx"] is not None
        assert captured["ctx"]["repo_id"] is None
        assert captured["ctx"]["okf_graph_hint"] is True

    @pytest.mark.asyncio
    async def test_legacy_graph_ingest_binds_hint_false_in_the_request_ctx(self):
        """A legacy-graph (non-OKF_) ingest without repo_id binds the hint
        False — the ctx-bound completion still routes to doc-repo."""
        dp = create_dataprep()
        inp = create_mock_ingest_input(file_id="ctx-hint-legacy", graph_name="GRAPH", repo_id=None)
        patches, captured = self._ctx_capture_patches(dp, inp)

        try:
            with contextlib.ExitStack() as stack:
                for p in patches:
                    stack.enter_context(p)
                result = await dp.ingest_file_with_guardrail(inp, lock_file=None)
        finally:
            dp_module._INGEST_CTX.set(None)

        assert result["status"] == 200
        assert captured["ctx"] is not None
        assert captured["ctx"]["okf_graph_hint"] is False

    @pytest.mark.asyncio
    async def test_zero_batch_ingest_completes_as_honest_empty_success(self):
        """A zero-batch ingest (no graph tasks scheduled) must complete as an
        honest empty success, not crash.

        Regression (review 2026-10-29 round 3): `results` was only assigned
        under `if tasks:`, so a zero-batch run hit the totals with the name
        unbound — UnboundLocalError — and the generic handler falsely marked
        the file 'Ingestion Error' and auto-retracted a valid (if empty) run.
        """
        dp = create_dataprep()
        inp = create_mock_ingest_input()

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock) as mock_status,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["Healthcare"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["chunk1"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_contextualization",
                new_callable=AsyncMock,
                side_effect=lambda chunks, inp, fid: (list(chunks), []),
            ),
            # The labeling stage yields NO documents -> zero graph batches.
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=([], []),
            ),
            patch.object(dp, "_process_batch", new_callable=AsyncMock) as mock_process_batch,
            patch.object(dp_module, "ArangoGraph"),
        ):
            result = await dp.ingest_file_with_guardrail(inp, lock_file=None)

        # Zero batches scheduled: no batch work ran, and the run still
        # completes 'Ingested' — never the UnboundLocalError -> 'Ingestion
        # Error' path.
        mock_process_batch.assert_not_awaited()
        assert result["status"] == 200
        status_calls = [c.args[1] for c in mock_status.call_args_list]
        assert "Ingesting" in status_calls
        assert "Ingested" in status_calls
        assert "Ingestion Error" not in status_calls

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
                return_value=(
                    [
                        {"text": "chunk1", "labels": ["Healthcare"]},
                    ],
                    [],
                ),
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
        # Story 2.9.7 (ADR-031) "threaded everywhere": a request WITHOUT a minted
        # version gets NO bundle_version stamp (the MagicMock default would be a
        # truthy mock — this asserts the strict None guard).
        assert doc.metadata.get("bundle_version") is None

    @pytest.mark.asyncio
    async def test_document_metadata_bundle_version_stamped(self):
        """Story 2.9.7: a request carrying bundle_version stamps EVERY chunk doc
        with it (version-pinned citation), and the value rides the metadata."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()
        inp.bundle_version = 3  # the minted version (absent on the base mock)

        captured_docs = []

        async def capture_batch(batch, *args, **kwargs):
            captured_docs.extend(batch)

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["A"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["chunk1", "chunk2"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=(
                    [
                        {"text": "chunk1", "labels": ["Healthcare"]},
                        {"text": "chunk2", "labels": ["Healthcare"]},
                    ],
                    [],
                ),
            ),
            patch.object(dp, "_process_batch", new_callable=AsyncMock, side_effect=capture_batch),
            patch.object(dp_module, "ArangoGraph"),
            patch.object(dp_module, "Document", side_effect=lambda **kw: type("Doc", (), kw)),
        ):
            await dp.ingest_file_with_guardrail(inp, lock_file=None)

        assert len(captured_docs) == 2
        for doc in captured_docs:
            assert doc.metadata["bundle_version"] == 3

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
                return_value=(
                    [
                        {"text": "c1", "labels": ["A"]},
                        {"text": "c2", "labels": ["B"]},
                        {"text": "c3", "labels": ["A"]},
                    ],
                    [],
                ),
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

    # -----------------------------------------------------------------
    # Zero-chunk outcome is LEADING, not trailing (2026-10-13 incident)
    #
    # The curator read the bundle Ingestion Log, saw "Starting retraction
    # analysis..." as the first line of a perfectly normal ingest, and
    # concluded his data was being deleted. Nothing was deleted: the
    # defensive pre-POST sweep found 0 chunks and moved on. These tests pin
    # the log SHAPE so the alarming intent-first line cannot come back.
    # -----------------------------------------------------------------

    @staticmethod
    def _empty_chunk_cursor():
        """A cursor yielding no chunks.

        Models the WORLD: the ArangoDB driver returns a cursor that is
        iterable, so a plain list-backed iterator is a faithful stand-in for
        the zero-row result set (a bare MagicMock would iterate as empty too,
        but would also silently satisfy any access pattern).
        """
        return MagicMock(__iter__=MagicMock(return_value=iter([])))

    @pytest.mark.asyncio
    async def test_zero_chunks_log_leads_with_reassuring_outcome(self):
        """The zero-chunk path must NOT emit an alarming intent-first line.

        Non-vacuous: reverting the production fix (restoring the unconditional
        "Starting retraction analysis..." line) fails this test.
        """
        dp = create_dataprep()
        dp.db.aql.execute = MagicMock(return_value=self._empty_chunk_cursor())

        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as mock_log,
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
        ):
            result = await dp.retract_file("file-zero", "GRAPH")

        messages = [call.args[3] for call in mock_log.await_args_list]
        assert messages, "the zero-chunk path must still log its outcome (audit trail)"

        # ROUTING, not just wording. _write_ingestion_log(self, file_id, level,
        # stage, message) — args[0] is the concept the row is filed UNDER.
        # The message assertions below CANNOT catch a mis-routed log: the
        # message interpolates the same local variable, so `assert "file-zero"
        # in messages[0]` is tautological and stays green even when the call is
        # filed under a different file_id. Proven by mutation: substituting a
        # different routing key left every other assertion passing. (Adversarial
        # review, 2026-10-13.)
        for logged_call in mock_log.await_args_list:
            assert logged_call.args[0] == "file-zero", (
                f"ingestion-log row filed under the wrong concept: {logged_call.args[0]!r}"
            )

        # The defect itself: an intent line that reads as "deletion starting"
        # must not appear at all when nothing is being deleted.
        for msg in messages:
            assert "Starting retraction analysis" not in msg, (
                f"zero-chunk path emitted an alarming intent-first line: {msg!r}"
            )

        # The outcome must be explicitly reassuring — a curator reading the
        # FIRST line alone must conclude "nothing happened", not "data is gone".
        first_line = messages[0].lower()
        assert "nothing to retract" in first_line, f"first log line is not reassuring: {messages[0]!r}"
        assert "no data was removed" in first_line, f"first log line lacks the no-deletion assurance: {messages[0]!r}"

        # Auditability is preserved: the find evidence (count, collection,
        # file_id) is still in the log, so the orphan-cleanup guard stays
        # reviewable after the fact.
        assert "0 chunks" in messages[0]
        assert "GRAPH_SOURCE" in messages[0]
        assert "file-zero" in messages[0]

        # Behaviour is unchanged: still a no-op retraction.
        assert result["status"] == 200
        assert result["message"] == "No chunks found."
        assert result["details"]["deleted_chunks"] == 0

    @pytest.mark.asyncio
    async def test_zero_chunks_still_runs_the_analysis(self):
        """The find MUST run even when nothing is found — it is the orphan guard.

        Guards against a "fix" that silences the noise by skipping the query:
        that would silently disable stale-chunk cleanup for every ingest.
        """
        dp = create_dataprep()
        dp.db.aql.execute = MagicMock(return_value=self._empty_chunk_cursor())

        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
        ):
            await dp.retract_file("file-zero", "GRAPH")

        # The chunk-find query executed against the SOURCE collection, bound
        # to this file_id.
        dp.db.aql.execute.assert_called_once()
        query = dp.db.aql.execute.call_args.args[0]
        bind_vars = dp.db.aql.execute.call_args.kwargs["bind_vars"]
        assert "@@col_source" in query
        assert bind_vars["@col_source"] == "GRAPH_SOURCE"
        assert bind_vars["file_id"] == "file-zero"

        # ...and exactly one query: no deletion AQL was issued.
        assert dp.db.aql.execute.call_count == 1

    @pytest.mark.asyncio
    async def test_nonzero_chunks_still_announces_retraction(self):
        """The reassuring-zero case must not have silenced the real retraction.

        When chunks DO exist, the intent line must still be emitted (post-find,
        pre-delete) so a genuine cascade delete is never invisible.
        """
        dp = create_dataprep()

        chunk_cursor = MagicMock(__iter__=MagicMock(return_value=iter([{"key": "c1", "id": "SOURCE/c1"}])))
        edge_cursor = MagicMock(__iter__=MagicMock(return_value=iter([])))
        del_chunk_cursor = MagicMock(__iter__=MagicMock(return_value=iter(["SOURCE/c1"])))
        del_links_cursor = MagicMock(__iter__=MagicMock(return_value=iter([])))
        orphan_cursor = MagicMock(__iter__=MagicMock(return_value=iter([])))

        dp.db.aql.execute = MagicMock(
            side_effect=[chunk_cursor, edge_cursor, del_chunk_cursor, del_links_cursor, orphan_cursor]
        )

        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as mock_log,
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
        ):
            result = await dp.retract_file("file-real", "GRAPH")

        messages = [call.args[3] for call in mock_log.await_args_list]
        announcement = [m for m in messages if "Starting retraction analysis" in m]
        assert len(announcement) == 1, f"a real retraction must be announced: {messages!r}"
        # The announcement carries its own evidence, so it can never read as a
        # false alarm on its own.
        assert "1 chunk(s)" in announcement[0]
        assert "file-real" in announcement[0]
        assert result["details"]["deleted_chunks"] == 1

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
        taxonomy = [
            {"name": "Healthcare", "children": [{"name": "Hospitals"}, {"name": "Clinics"}]},
            {"name": "Education", "children": ["Schools"]},
        ]

        labels = await _fetch_labels(taxonomy)

        assert "Healthcare" in labels
        assert "Hospitals" in labels
        assert "Schools" in labels

    @pytest.mark.asyncio
    async def test_the_labels_are_the_english_spelling_not_the_localized_name(self):
        """The taxonomy is the vocabulary every chunk_label is minted from.

        It must read the EN translation the tree publishes beside the
        localized name — not the localized name, which only happens to be
        English while the fetch carries no locale parameter.
        """
        taxonomy = [
            {
                "catKey": "2",
                "name": "Cultivos",
                "nameEN": "Crops",
                "children": [{"name": "Tomate", "nameEN": "Tomato"}],
            }
        ]

        labels = await _fetch_labels(taxonomy)

        assert labels == ["Crops", "Tomato"]

    @pytest.mark.asyncio
    async def test_a_legacy_payload_without_the_english_field_falls_back_to_the_name(self):
        """A backend older than the both-spellings tree publishes no nameEN.

        Its `name` at the default locale IS the English translation, so the
        fallback is the same vocabulary.
        """
        taxonomy = [
            {"name": "Healthcare", "children": ["Hospitals", {"name": "Clinics"}]},
        ]

        labels = await _fetch_labels(taxonomy)

        assert labels == ["Healthcare", "Clinics", "Hospitals"]

    @pytest.mark.asyncio
    async def test_a_category_without_any_name_does_not_cost_the_whole_vocabulary(self):
        """A category that carries neither spelling is malformed, not fatal.

        It cannot be named, but the categories around it still are a
        vocabulary — losing all of them would label every chunk with
        nothing at all.
        """
        taxonomy = [
            {"catKey": "1", "children": [{"name": "Births", "nameEN": "Births"}]},
            {
                "catKey": "2",
                "name": "Crops",
                "nameEN": "Crops",
                "children": [{"name": "Tomato", "nameEN": "Tomato"}],
            },
        ]

        labels = await _fetch_labels(taxonomy)

        assert "Births" in labels
        assert "Tomato" in labels

    @pytest.mark.asyncio
    async def test_a_nameless_category_does_not_borrow_the_previous_category_name(self):
        """A category the payload does not name keeps its own (empty) group.

        Its services are a group of their own — they are not filed under
        the name of the category that happens to precede them.
        """
        taxonomy = [
            {"catKey": "1", "name": "Crops", "nameEN": "Crops", "children": []},
            {"catKey": "2", "children": [{"name": "Tomato", "nameEN": "Tomato"}]},
        ]

        labels = await _fetch_labels(taxonomy)

        assert labels == ["Tomato", "Crops"]

    @pytest.mark.asyncio
    async def test_returns_empty_on_error(self):
        dp = create_dataprep()

        with patch.object(dp, "_service_headers", new_callable=AsyncMock, return_value=None):
            labels = await dp._fetch_all_labels()

        assert labels == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("taxonomy", "expected"),
        [
            (
                [
                    {"name": "Healthcare", "children": [{"name": "Hospitals"}, {"name": "Clinics"}]},
                    {"name": "Education", "children": ["Schools"]},
                ],
                ["Education", "Schools", "Healthcare", "Clinics", "Hospitals"],
            ),
            (
                # Two labels that differ only in case are two labels: they have
                # to sit next to each other, in an order that does not depend
                # on which of them arrived first.
                [
                    {"name": "onion", "children": []},
                    {"name": "Onion", "children": []},
                    {"name": "apple", "children": []},
                    {"name": "Banana", "children": []},
                ],
                ["apple", "Banana", "Onion", "onion"],
            ),
            (
                # A label listed twice appears once, and one without a usable
                # label — a category whose translation is missing — is dropped
                # rather than reaching the prompt as the text "None".
                [
                    {"name": "Healthcare", "children": ["Clinics", "Clinics", {"name": None}, ""]},
                    {"name": None, "children": []},
                ],
                ["Healthcare", "Clinics"],
            ),
        ],
        ids=["canonical", "case-variants", "duplicates-and-unusable"],
    )
    async def test_the_taxonomy_comes_back_in_a_canonical_order(self, taxonomy, expected):
        """The label list is embedded in the labelling prompt verbatim.

        Its order is therefore part of the prompt: two ingests of the same
        document have to send the same prompt, or the LLM may label the same
        chunk differently — a difference that is invisible in the stored
        result and shows up only as noise in an A/B comparison.
        """
        labels = await _fetch_labels(taxonomy)

        assert labels == expected

    @pytest.mark.asyncio
    async def test_the_order_does_not_depend_on_the_order_the_backend_returns(self):
        """The same taxonomy, returned in another order, is the same prompt."""
        labels = await _fetch_labels(
            [
                {"name": "Education", "children": ["Schools"]},
                {"name": "Healthcare", "children": [{"name": "Clinics"}, {"name": "Hospitals"}]},
            ]
        )

        assert labels == ["Education", "Schools", "Healthcare", "Clinics", "Hospitals"]

    @pytest.mark.asyncio
    async def test_entries_without_a_usable_label_are_counted_in_the_fetch_line(self):
        """A service whose translation is missing arrives as null.

        It has no label to offer, and it has to be reported: a taxonomy that
        reads as complete while a service is missing from it is worse than a
        noisy log. The taxonomy is fetched once per document and the reason
        does not change between documents, so the count is in the fetch line
        rather than in a warning per document.
        """
        with patch.object(dp_module, "logger") as logger:
            labels = await _fetch_labels(
                [
                    {"name": "Healthcare", "children": ["Clinics", None]},
                    {"name": None, "children": []},
                ]
            )

        assert labels == ["Healthcare", "Clinics"]
        lines = [call.args[0] for call in logger.info.call_args_list]
        assert any("2 without a usable label" in line for line in lines), lines
        assert any("0 malformed entries" in line for line in lines), lines

    @pytest.mark.asyncio
    async def test_a_malformed_entry_is_counted_apart_from_a_missing_translation(self):
        """The two causes have different remedies.

        A missing translation is a content problem; a payload the parser does
        not recognise is a contract problem between the dataprep and the
        backend. Counting them together would point the operator at the wrong
        one.
        """
        with patch.object(dp_module, "logger") as logger:
            await _fetch_labels(
                [
                    {"name": "Healthcare", "children": [123, {"name": 123}, {"children": ["Clinics"]}]},
                    {"children": []},
                    "not-an-object",
                ]
            )

        lines = [call.args[0] for call in logger.info.call_args_list]
        assert any("0 without a usable label" in line for line in lines), lines
        assert any("5 malformed entries" in line for line in lines), lines

    @pytest.mark.asyncio
    async def test_a_payload_that_is_not_a_taxonomy_tree_is_reported_as_malformed(self):
        """A 200 response the parser does not recognise is a contract problem.

        Reporting zero drops would point the operator at translations rather
        than at the contract.
        """
        with patch.object(dp_module, "logger") as logger:
            labels = await _fetch_labels({"categories": []})

        assert labels == []
        lines = [call.args[0] for call in logger.info.call_args_list]
        assert any("1 malformed entries" in line for line in lines), lines

    def test_the_same_taxonomy_yields_the_same_order_in_every_process(self):
        """Two interpreters, two hash seeds, one answer.

        ``PYTHONHASHSEED`` is randomised per process, which is what lets an
        unordered collection reach the prompt and the stored labels. The probe
        runs the real fetch — and the finalisation that decides what a chunk
        stores — in two processes, and compares what they return. Both probes
        run at once: each imports the whole service module, and the point of
        the test is the agreement, not the duration.
        """
        script = (
            "import asyncio, json, tests.conftest, tests.test_dataprep as t; "
            f'print("{_PROBE_MARKER}" + json.dumps(asyncio.run(t._probe_main())))'
        )

        def _run(seed):
            result = subprocess.run(
                [sys.executable, "-c", script],
                capture_output=True,
                text=True,
                cwd=str(OVERLAY_ROOT),
                env=dict(os.environ, PYTHONHASHSEED=seed),
                timeout=300,
            )
            assert result.returncode == 0, f"probe failed under PYTHONHASHSEED={seed}:\n{result.stderr}"
            # The result is marked, so a line the interpreter prints on the way
            # out cannot be mistaken for it.
            marked = [line for line in result.stdout.splitlines() if line.startswith(_PROBE_MARKER)]
            assert marked, f"probe printed no result under PYTHONHASHSEED={seed}:\n{result.stdout}"
            return json.loads(marked[-1][len(_PROBE_MARKER) :])

        with ThreadPoolExecutor(max_workers=2) as pool:
            outputs = list(pool.map(_run, ("0", "1")))

        assert outputs[0] == outputs[1]
        # The exact values, so the comparison above cannot pass on two empty
        # taxonomies: the probe would then guard nothing.
        assert outputs[0] == {
            "labels": ["Education", "Schools", "Healthcare", "Clinics", "Hospitals", "Onion", "onion"],
            "stored": ["Schools", "Clinics", "Hospitals"],
        }


class TestFinalizeChunkLabels:
    """The order of the labels a chunk stores."""

    @pytest.mark.asyncio
    async def test_the_stored_labels_are_in_the_canonical_order(self):
        """The stored array is a function of the label set alone.

        Not of the order the model answered in: two runs that pick the same
        labels have to store the same array.
        """
        dp = create_dataprep()

        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            labels = await dp._finalize_chunk_labels(
                0,
                ["Hospitals", "Clinics", "Schools"],
                ["Education", "Schools", "Healthcare", "Clinics", "Hospitals"],
                "file1",
            )

        assert labels == ["Schools", "Clinics", "Hospitals"]


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
    """The dataprep ingest payload contract.

    - `uploadDate` is document-repository metadata that dataprep never consumes
      (see `ingest_file_with_guardrail` — `upload_date` is never read). Requiring
      it caused a 422 → 500 whenever a legacy file had `uploaded_date == null` in
      the files collection. The field must be absent from the contract.
    - `chunkOverlap` is an optional per-request override for the
      `RecursiveCharacterTextSplitter` overlap. When omitted, dataprep falls back
      to the `DATAPREP_CHUNK_OVERLAP` env var (default 50). Negative values are
      rejected at runtime in `ingest_file_from_repo` to keep the splitter from
      collapsing into a single mega-chunk.
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

    def test_chunk_overlap_optional_default_none(self):
        """chunkOverlap is optional; defaults to None (dataprep falls back to env DATAPREP_CHUNK_OVERLAP)."""
        from dataprep.genieai_dataprep_microservice import DocRepoIngestPayload

        payload = DocRepoIngestPayload(**self._payload())
        assert payload.chunkOverlap is None

    def test_chunk_overlap_accepts_int_override(self):
        """chunkOverlap carries per-request override through the API contract."""
        from dataprep.genieai_dataprep_microservice import DocRepoIngestPayload

        payload = DocRepoIngestPayload(**self._payload(chunkOverlap=150))
        assert payload.chunkOverlap == 150

    @contextlib.contextmanager
    def _ingest_mocks(self):
        """Shared patch set for exercising the real ingest_file_from_repo.

        Yields (ms, mock_loader, flock_mock): the microservice module (so
        tests can patch against it), the loader mock, and the module-wide
        fcntl.flock mock.
        """
        with (
            patch.object(ms, "loader") as mock_loader,
            patch.object(ms, "tracer"),
            patch.object(ms, "active_ingestion_tasks", {}),
            patch.object(ms, "upload_folder", "/tmp/test-ingest"),
            patch("builtins.open", MagicMock()),
            patch("fcntl.flock") as flock_mock,
        ):
            mock_loader.ingest_file_with_guardrail = AsyncMock()
            yield ms, mock_loader, flock_mock

    @pytest.mark.asyncio
    @requires_fcntl
    async def test_chunk_overlap_rejects_negative(self):
        """Negative chunkOverlap would collapse the splitter into a single mega-chunk; rejected with 400 pre-lock."""
        from fastapi import HTTPException

        payload = ms.DocRepoIngestPayload(**self._payload(chunkOverlap=-50))
        with self._ingest_mocks() as (_ms, _loader, flock_mock), pytest.raises(HTTPException) as exc_info:
            await ms.ingest_file_from_repo(payload)
        assert exc_info.value.status_code == 400
        assert "chunkOverlap must be >= 0" in exc_info.value.detail
        # "Pre-lock" is a promise: the rejection must not even acquire it.
        flock_mock.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_name",
        ["../escape.md", "/absolute/path.md", "a\x00b.md", "..", ""],
    )
    @requires_fcntl
    async def test_file_name_must_be_bare(self, bad_name):
        """A non-bare fileName is a traversal write/delete primitive; rejected with 400 pre-lock."""
        from fastapi import HTTPException

        payload = ms.DocRepoIngestPayload(**self._payload(fileName=bad_name))
        with self._ingest_mocks() as (_ms, _loader, flock_mock), pytest.raises(HTTPException) as exc_info:
            await ms.ingest_file_from_repo(payload)
        assert exc_info.value.status_code == 400
        assert "bare file name" in exc_info.value.detail
        flock_mock.assert_not_called()

    @pytest.mark.asyncio
    @requires_fcntl
    async def test_failed_start_releases_the_lock(self):
        """A cancellation between lock acquisition and task creation must unlock.

        CancelledError is a BaseException: it bypasses the except handler, so
        only the finally can release the lock — the regression this test
        guards is the release moving back into the except.
        """
        payload = ms.DocRepoIngestPayload(**self._payload())
        lock_mock = MagicMock()
        with (
            self._ingest_mocks() as (_ms, _loader, flock_mock),
            patch.object(ms.os, "open", return_value=7),
            patch.object(ms.os, "fdopen", return_value=lock_mock),
            patch.object(ms.base64, "b64decode", side_effect=asyncio.CancelledError()),
            pytest.raises(asyncio.CancelledError),
        ):
            await ms.ingest_file_from_repo(payload)
        # fcntl.flock is patched module-wide by the helper; the handler
        # releases through that same mock.
        flock_mock.assert_any_call(lock_mock, fcntl.LOCK_UN)
        lock_mock.close.assert_called_once()

    @pytest.mark.asyncio
    @requires_fcntl
    async def test_successful_start_keeps_the_lock_with_the_task(self):
        """On the success path the handler must NOT release the lock or close
        the file: the background task owns both until it finishes."""
        payload = ms.DocRepoIngestPayload(**self._payload(fileBase64="aGk="))
        lock_mock = MagicMock()
        with self._ingest_mocks() as (_ms, mock_loader, flock_mock):
            fake_task = MagicMock()
            # A task that has just been created is NOT done. The bare
            # MagicMock answers every attribute with a truthy mock, so
            # `fake_task.done()` would claim the task had ALREADY FINISHED —
            # and the handler's slot-lifetime guard, which releases the lock
            # only when the task is finished or was never created, would then
            # take the lock away from a task that is still running. Model the
            # real thing: a live task.
            fake_task.done.return_value = False
            with (
                patch.object(ms.os, "open", return_value=7),
                patch.object(ms.os, "fdopen", return_value=lock_mock),
                patch.object(ms.asyncio, "create_task", return_value=fake_task),
            ):
                result = await ms.ingest_file_from_repo(payload)
        assert result["success"] is True
        mock_loader.ingest_file_with_guardrail.assert_called_once()
        # The lock and the file were handed to the task untouched: no unlock
        # call, no close.
        unlock_calls = [c for c in flock_mock.call_args_list if len(c.args) > 1 and c.args[1] == fcntl.LOCK_UN]
        assert unlock_calls == []
        lock_mock.close.assert_not_called()

    @pytest.mark.asyncio
    @requires_fcntl
    async def test_failed_start_removes_the_saved_file(self):
        """A failure after the upload was written but before the task exists
        must reclaim the partially written file."""
        payload = ms.DocRepoIngestPayload(**self._payload(fileBase64="aGk="))
        with (
            self._ingest_mocks() as (_ms, _loader, _flock),
            patch.object(ms.os, "open", return_value=7),
            patch.object(ms.os, "fdopen"),
            patch.object(
                ms,
                "ArangoDBDataprepRequestFromDocRepo",
                side_effect=RuntimeError("request build failed"),
            ),
            patch.object(ms.os, "remove") as remove_mock,
            patch.object(ms.os.path, "exists", return_value=True),
            pytest.raises(RuntimeError, match="request build failed"),
        ):
            await ms.ingest_file_from_repo(payload)
        remove_mock.assert_called_once()


# ---------------------------------------------------------------------------
# TestContextualRetrieval (Contextual Retrieval — spec-contextual-retrieval.md)
# ---------------------------------------------------------------------------


def _recordable_doc(**kwargs):
    """Stand-in for langchain ``Document`` (mocked by conftest) exposing kwargs as attrs."""
    from types import SimpleNamespace

    return SimpleNamespace(**kwargs)


def _scaffold():
    """The scaffolding of the mock ingest input the tests use."""
    return dp_module._doc_context_scaffold_chars(create_mock_ingest_input())


def _model_endpoint(monkeypatch, window=65536, endpoint="http://gpu-test", dead=False, model_id="test-model"):
    """Aim dataprep's window discovery at a fake /v1/models endpoint.

    Same seam the chatqna window tests use: the real core.model_cache runs
    (coercion, TTL, negative cache) but its HTTP probe is faked, and
    VLLM_ENDPOINT is aimed at it because dataprep discovers the window from
    the same endpoint it talks to. ``window=None`` serves a strict
    OpenAI-compatible payload with no ``max_model_len`` field; ``dead=True``
    serves an endpoint nothing answers.

    Clears the model cache first: it is module-global and shared across tests,
    so a previously cached window for this endpoint would shadow the new one
    for the whole TTL.
    """
    from core.model_cache import clear_cache

    clear_cache()
    monkeypatch.setenv("VLLM_ENDPOINT", endpoint)
    if dead:

        def _raise(*_args, **_kwargs):
            raise ConnectionError("endpoint unreachable")

        monkeypatch.setattr("httpx.get", _raise)
        return endpoint

    entry = {"id": model_id} if window is None else {"id": model_id, "max_model_len": window}
    resp = MagicMock()
    resp.json.return_value = {"data": [entry]}

    def _fake_get(_url, **_kwargs):
        return resp

    monkeypatch.setattr("httpx.get", _fake_get)
    return endpoint


class TestContextualRetrieval:
    """Tests for _apply_contextualization() / _context_single_call()."""

    @pytest.fixture(autouse=True)
    def _isolate_defaults(self, monkeypatch):
        """Explicit flags so tests don't depend on module defaults."""
        from core.model_cache import clear_cache

        monkeypatch.setattr(dp_module, "CONTEXTUAL_STRATEGY", "per_chunk")
        monkeypatch.setattr(dp_module, "CONTEXTUAL_LABEL_RAW", False)
        # The module-global "already warned" set and the module-global model
        # cache both outlive a test: reset them, or a previous test's window
        # (or warning) decides this one.
        monkeypatch.setattr(dp_module, "_WINDOW_WARNED", set())
        # The doc-context budget is DERIVED from the serving model's window.
        # Without a discovered window the derivation fails closed to the
        # smallest profile (2048) and every contextualization call is skipped
        # — correct in production, useless for tests that are exercising
        # contextualization itself. Tests that care about the fallback serve
        # their own window.
        _model_endpoint(monkeypatch, 65536)
        yield
        clear_cache()  # the cache is module-global: do not leak it onwards

    @pytest.mark.asyncio
    async def test_flag_off_returns_chunks_unchanged(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", False)
        mock_client = AsyncMock()
        chunks = ["chunk one", "chunk two"]
        with patch.object(dp_module, "AsyncOpenAI", return_value=mock_client):
            result, _degraded = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "file1")
        assert result == chunks
        mock_client.chat.completions.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_flag_off_empty_is_noop(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", False)
        with patch.object(dp_module, "AsyncOpenAI", return_value=AsyncMock()):
            result, _degraded = await dp._apply_contextualization([], create_mock_ingest_input(), "file1")
        assert result == []

    def test_build_doc_context_includes_filename_labels_and_truncates(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_DOC_BUDGET", 40)
        ctx = dp._build_doc_context(["aaaaaaaaaa" * 20, "tail"], create_mock_ingest_input(), 40)
        assert "Filename: test_document.pdf" in ctx
        assert "Document labels: Healthcare, Public Services" in ctx
        assert "[truncated]" in ctx  # joined content exceeded the 40-char budget

    # --- truncation must be VISIBLE, not just logged to container stdout ------
    #
    # A truncated document context silently degrades the chunk embedding AND the
    # graph extraction (both read the contextualized text) while ingestion still
    # reports success. For a whole corpus that is invisible: the only trace was
    # a logger.warning nobody reads. These tests pin that the fact now reaches
    # the admin Ingestion Log, and — just as important — that it does NOT fire
    # when the document fits.

    def test_doc_context_truncation_is_none_when_within_budget(self):
        dp = create_dataprep()
        assert dp._doc_context_truncation(["abc", "def"], 100) is None

    def test_doc_context_truncation_is_none_when_budget_disables_truncation(self):
        # <=0 disables truncation (documented contract), so it must never report.
        dp = create_dataprep()
        assert dp._doc_context_truncation(["a" * 5000], 0) is None
        assert dp._doc_context_truncation(["a" * 5000], -1) is None

    def test_doc_context_truncation_reports_kept_total_and_ratio(self):
        dp = create_dataprep()
        t = dp._doc_context_truncation(["x" * 900, "y" * 100], 500)
        assert t is not None
        assert t["kept"] == 500
        assert t["total"] == 1001  # 900 + 100 joined by a single "\n"
        assert t["pct"] == 49
        assert t["chunks"] == 2

    @pytest.mark.asyncio
    async def test_truncation_is_written_to_the_ingestion_log(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_DOC_BUDGET", 40)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        log = AsyncMock()
        dp._write_ingestion_log = log
        with patch.object(dp_module, "AsyncOpenAI", return_value=AsyncMock()):
            await dp._apply_contextualization(["aaaaaaaaaa" * 20, "tail"], create_mock_ingest_input(), "file1")

        # Contextualization writes other log lines on this path (LLM failure
        # fallbacks etc.), so assert on the TRUNCATION line specifically rather
        # than on a total call count.
        truncations = [c for c in log.await_args_list if len(c.args) > 3 and "truncated" in str(c.args[3]).lower()]
        assert len(truncations) == 1, [c.args for c in log.await_args_list]
        args = truncations[0].args
        assert args[0] == "file1"
        assert args[1] == "WARN"
        assert args[2] == "Contextualization"
        assert "40" in args[3]  # names the budget that was applied

    @pytest.mark.asyncio
    async def test_no_truncation_log_write_when_document_fits(self, monkeypatch):
        """The negative control: a warning that fires on every document is noise."""
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_DOC_BUDGET", 100000)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        log = AsyncMock()
        dp._write_ingestion_log = log
        with patch.object(dp_module, "AsyncOpenAI", return_value=AsyncMock()):
            await dp._apply_contextualization(["short one", "short two"], create_mock_ingest_input(), "file1")

        truncations = [c for c in log.await_args_list if len(c.args) > 3 and "truncated" in str(c.args[3]).lower()]
        assert truncations == []

    # --- the budget is DERIVED from the model window, not hard-coded ----------
    #
    # The shipped literal (6000) was sized for the T4 profile's 2048-token
    # window and applied to every deployment including the default 65536-token
    # one. These tests pin the three-way contract (unset=derive, >0=override,
    # <0=disable) and, most importantly, the property that actually matters:
    # the assembled request fits the window.
    #
    # The window itself comes from _serving_model_window (runtime discovery);
    # the budget from _resolve_doc_budget's arithmetic, which takes the window
    # as a parameter so the blocking probe never runs inside it.

    def test_explicit_positive_budget_is_an_override(self):
        # A window that fits the operator's value leaves it alone.
        dp = create_dataprep()
        assert dp._resolve_doc_budget(["abc"], 1234, 65536, scaffold_chars=_scaffold()) == (1234, "override")

    def test_explicit_budget_larger_than_a_known_window_is_capped(self):
        """An explicit budget is a MAXIMUM: a request the model cannot accept
        is rejected, and the batch falls back to raw chunks silently. When the
        window is known, the budget is capped to what fits — and the source
        says so, so the operator does not read their own number back as the
        applied budget."""
        dp = create_dataprep()
        budget, source = dp._resolve_doc_budget(["x" * 500] * 8, 100000, 4096, scaffold_chars=_scaffold())
        assert source == "window-capped"
        assert budget < 100000

    def test_explicit_budget_is_kept_when_the_window_is_only_a_guess(self):
        """The fail-closed fallback is a guess, not knowledge: capping an
        operator's deliberate budget against it would destroy a setting that
        may be exactly right."""
        dp = create_dataprep()
        budget, source = dp._resolve_doc_budget(["abc"], 1234, 2048, scaffold_chars=_scaffold(), authoritative=False)
        assert (budget, source) == (1234, "override")

    def test_negative_budget_disables_contextualization(self):
        dp = create_dataprep()
        budget, source = dp._resolve_doc_budget(["abc"], -1, 2048, scaffold_chars=_scaffold())
        assert budget is None and source == "disabled"

    def test_budget_scales_with_the_model_window(self):
        dp = create_dataprep()
        chunks = ["x" * 500] * 8
        small, _ = dp._resolve_doc_budget(chunks, 0, 16384, scaffold_chars=_scaffold())
        large, _ = dp._resolve_doc_budget(chunks, 0, 65536, scaffold_chars=_scaffold())
        assert large > small > 0

    def test_budget_is_sized_exactly_from_the_given_window(self):
        """The arithmetic, pinned to a literal — not merely "a positive number".

        A derivation that dropped the output reservation or mis-scaled
        CHARS_PER_TOKEN would pass a "> 0" assertion and ship a budget that
        overflows the window — the failure this whole derivation exists to
        prevent. The literal is an INDEPENDENT oracle: 65536 window - 254
        prompt tokens - 564 batch-text tokens - 2048 reserved output tokens
        - 256 reserved scaffolding tokens, times 4 chars per token. A change
        to the prompt text or to one of the knobs legitimately moves it —
        update the number then, and the diff shows the budget moved.
        """
        dp = create_dataprep()
        chunks = ["x" * 500] * 8
        budget, source = dp._resolve_doc_budget(chunks, 0, 65536, scaffold_chars=_scaffold())
        assert source == "derived"
        assert budget == 250708

    def test_window_discovery_ignores_the_vllm_max_model_len_env(self, monkeypatch):
        """Issue #1182: VLLM_MAX_MODEL_LEN is the vLLM-side memory knob
        (--max-model-len), not a dataprep input. A stale copy of it in the
        dataprep container must not override what the endpoint actually
        serves — that silent divergence is the bug."""
        monkeypatch.setenv("VLLM_MAX_MODEL_LEN", "2048")  # stale copy (T4-era)
        endpoint = _model_endpoint(monkeypatch, 65536)  # what the endpoint serves
        window, _ = dp_module._serving_model_window(endpoint)
        assert window == 65536
        endpoint = _model_endpoint(monkeypatch, 2048)  # what a T4 actually serves
        window, _ = dp_module._serving_model_window(endpoint)
        assert window == 2048

    def test_explicit_window_override_wins_over_discovery(self, monkeypatch):
        """DATAPREP_MAX_MODEL_LEN is the tier above discovery — and the only
        lever on a strict OpenAI-compatible provider, whose /v1/models never
        carries max_model_len."""
        monkeypatch.setattr(dp_module, "DATAPREP_MAX_MODEL_LEN", 4096)
        endpoint = _model_endpoint(monkeypatch, 65536)
        window, _ = dp_module._serving_model_window(endpoint)
        assert window == 4096

    def test_window_override_that_disagrees_with_the_served_window_is_flagged(self, monkeypatch):
        """An override LARGER than what the server accepts recreates exactly
        the silent overflow this issue exists to stop (requests rejected ->
        raw-chunk fallback). The disagreement is surfaced."""
        monkeypatch.setattr(dp_module, "DATAPREP_MAX_MODEL_LEN", 65536)
        endpoint = _model_endpoint(monkeypatch, 2048)  # the endpoint serves 2048
        dp_module.logger.warning.reset_mock()
        window, _ = dp_module._serving_model_window(endpoint)
        assert window == 65536
        warnings = [str(c.args[0]) for c in dp_module.logger.warning.call_args_list]
        assert any("DATAPREP_MAX_MODEL_LEN" in w and "2048" in w for w in warnings)

    def test_unknown_window_falls_back_to_the_smallest_profile(self, monkeypatch):
        """Fails closed: defaulting high would size for hardware nobody runs.

        A strict OpenAI-compatible provider (no max_model_len in /v1/models)
        yields no window; the fallback is DERIVE_FALLBACK_WINDOW, on which
        contextualization cannot run at all (the batch output reservation
        alone fills it), so every document is window-exhausted — and
        deterministically so within the cache TTL.
        """
        endpoint = _model_endpoint(monkeypatch, None)
        dp = create_dataprep()
        window, authoritative = dp_module._serving_model_window(endpoint)
        assert window == dp_module.DERIVE_FALLBACK_WINDOW
        assert authoritative is False, "the fail-closed fallback is a guess, not knowledge"
        assert dp._resolve_doc_budget(
            ["x" * 500], 0, window, scaffold_chars=_scaffold(), authoritative=authoritative
        ) == (
            None,
            "window-exhausted",
        )

    def test_fallback_window_is_loud_when_discovery_has_no_answer(self, monkeypatch):
        """The teeth of #1182: the old 2048 fallback was silent. Both
        no-answer shapes (strict provider, dead endpoint) must warn with the
        fallback value and the remedy, mirroring core.model_cache's own
        probe warnings — once per endpoint, not once per document."""

        def _fallback_warnings():
            return [str(c.args[0]) for c in dp_module.logger.warning.call_args_list]

        endpoint = _model_endpoint(monkeypatch, None)  # strict provider: field missing
        dp_module.logger.warning.reset_mock()
        dp_module._serving_model_window(endpoint)
        dp_module._serving_model_window(endpoint)  # second document: no second warning
        warnings = _fallback_warnings()
        assert len(warnings) == 1, warnings
        assert str(dp_module.DERIVE_FALLBACK_WINDOW) in warnings[0]
        assert "DATAPREP_MAX_MODEL_LEN" in warnings[0]

        endpoint = _model_endpoint(monkeypatch, dead=True, endpoint="http://gpu-dead")  # unreachable
        dp_module.logger.warning.reset_mock()
        dp_module._serving_model_window(endpoint)
        warnings = _fallback_warnings()
        assert len(warnings) == 1, warnings
        assert str(dp_module.DERIVE_FALLBACK_WINDOW) in warnings[0]
        assert "DATAPREP_MAX_MODEL_LEN" in warnings[0]

    def test_contextual_model_mismatch_is_flagged(self, monkeypatch):
        """Discovery reads the FIRST model /v1/models lists; the contexts are
        generated by DATAPREP_CONTEXTUAL_MODEL. When they differ, the
        discovered window may not be the one that model serves — the mismatch
        is surfaced and the operator is pointed at the override. When they
        are the same model, nothing is warned about."""
        _model_endpoint(monkeypatch, 65536)  # the endpoint lists "test-model"
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_MODEL", "other-model")
        dp_module.logger.warning.reset_mock()
        _client, _model, window, _authoritative = dp_module._build_vllm_client_and_window()
        assert window == 65536
        warnings = [str(c.args[0]) for c in dp_module.logger.warning.call_args_list]
        assert any("DATAPREP_MAX_MODEL_LEN" in w and "other-model" in w for w in warnings)

        # The same model, requested by the name the endpoint lists: no alarm.
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_MODEL", "test-model")
        dp_module.logger.warning.reset_mock()
        dp_module._build_vllm_client_and_window()
        assert dp_module.logger.warning.call_args_list == []

    @pytest.mark.asyncio
    async def test_window_discovery_does_not_block_the_event_loop(self, monkeypatch):
        """The discovery probe is a SYNC http call that can take its whole
        timeout when the endpoint does not answer. On the ingest path it must
        not run on the event loop: a blocked loop freezes the phase
        heartbeats and every concurrent request the process serves."""
        import time as _time

        ticks = 0
        ticks_during_probe = []

        def _slow_get(_url, **_kwargs):
            before = ticks
            _time.sleep(0.5)
            ticks_during_probe.append(ticks - before)
            resp = MagicMock()
            resp.json.return_value = {"data": [{"id": "test-model", "max_model_len": 65536}]}
            return resp

        monkeypatch.setattr("httpx.get", _slow_get)
        monkeypatch.setenv("VLLM_ENDPOINT", "http://gpu-slow")
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        dp = create_dataprep()

        async def _ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        ticker = asyncio.create_task(_ticker())
        await asyncio.sleep(0.05)  # let the ticker run BEFORE the probe starts
        try:
            with patch.object(dp_module, "AsyncOpenAI", return_value=AsyncMock()):
                await dp._apply_contextualization(["chunk one"], create_mock_ingest_input(), "file1")
        finally:
            ticker.cancel()
        assert ticks_during_probe, "the window discovery never probed the endpoint"
        # The blocking case yields 0 ticks (the loop is frozen for the whole
        # probe); an off-loop probe yields one per 10 ms. The bar is "> 0", not
        # a count: any count would be a timing claim that a loaded CI runner
        # can flake, and the blocking case is the only thing to separate.
        assert ticks_during_probe[0] > 0, (
            f"the event loop was blocked during window discovery ({ticks_during_probe[0]} ticks while the probe ran)"
        )

    def test_doc_level_budget_is_capped_by_the_window(self):
        """The doc_level knob is a MAXIMUM: the window caps it.

        One call per document, so the request carries the system prompt with
        the document context embedded in it and reserves ONE output budget.
        A deployment that serves 4096 tokens cannot take the 100000-char
        default (~25k tokens) — the call would be rejected and every document
        would silently fall back to raw chunks.
        """
        dp = create_dataprep()
        budget, source = dp._resolve_doc_budget(
            ["x" * 500] * 8, 100000, 4096, scaffold_chars=_scaffold(), single_call=True
        )
        assert source == "window-capped"
        # 4096 window - 164 prompt tokens - 512 reserved output - the measured
        # scaffolding, times 4 chars per token.
        assert budget == 13520
        # ...and a window that fits the operator's value leaves it alone.
        big, big_source = dp._resolve_doc_budget(
            ["x" * 500] * 8, 100000, 65536, scaffold_chars=_scaffold(), single_call=True
        )
        assert (big, big_source) == (100000, "override")

    def test_doc_level_budget_on_a_tiny_window_is_refused(self):
        """A window that cannot hold the prompt and the output reservation
        leaves no room for a context at all — refuse, do not send it."""
        dp = create_dataprep()
        assert dp._resolve_doc_budget(["x" * 500] * 8, 100000, 512, scaffold_chars=_scaffold(), single_call=True) == (
            None,
            "window-exhausted",
        )

    def test_contextual_model_alias_is_not_flagged(self, monkeypatch):
        """The same model under two names is not a mismatch: a vLLM server
        lists "ibm-granite/granite-4.1-8b" while the deployment names it
        "granite-4.1-8b". A false alarm here sends the operator to pin a
        window that was already right."""
        _model_endpoint(monkeypatch, 65536, model_id="ibm-granite/granite-4.1-8b")
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_MODEL", "granite-4.1-8b")
        dp_module.logger.warning.reset_mock()
        dp_module._build_vllm_client_and_window()
        assert dp_module.logger.warning.call_args_list == []

    @pytest.mark.asyncio
    async def test_labelling_model_probe_does_not_block_the_event_loop(self, monkeypatch):
        """The labelling path resolves the served model on the same endpoint,
        and that probe is a synchronous HTTP call: it must not run on the
        event loop either. A frozen loop stalls every concurrent request this
        process serves while the probe waits."""
        import time as _time

        import core.model_cache as model_cache

        ticks = 0
        ticks_during_probe = []

        def _slow_get_model_id(*_args, **_kwargs):
            before = ticks
            _time.sleep(0.5)
            ticks_during_probe.append(ticks - before)
            return "ci-discovered/model"

        monkeypatch.setattr(model_cache, "get_model_id", _slow_get_model_id)
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)
        monkeypatch.setenv("VLLM_ENDPOINT", "http://gpu-slow")
        dp = create_dataprep()

        async def _ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        ticker = asyncio.create_task(_ticker())
        await asyncio.sleep(0.05)  # let the ticker run BEFORE the probe starts
        try:
            with patch.object(dp_module, "AsyncOpenAI", return_value=AsyncMock()):
                await dp._label_with_llm(["chunk one"], ["Label"], [], "file1")
        finally:
            ticker.cancel()
        assert ticks_during_probe, "the model resolution never ran"
        assert ticks_during_probe[0] > 0, "the model probe blocked the event loop"

    def test_the_fallback_warning_fires_even_when_the_client_build_fails(self, monkeypatch):
        """The window is resolved BEFORE the client is built: when the
        endpoint is down the client build raises, but the operator must still
        be told that the window could not be discovered and what to set."""
        import core.model_cache as model_cache
        from core.model_cache import ModelDiscoveryError

        _model_endpoint(monkeypatch, dead=True, endpoint="http://gpu-dead")

        def _no_model(*_args, **_kwargs):
            raise ModelDiscoveryError("no model id discovered")

        monkeypatch.setattr(model_cache, "get_model_id", _no_model)
        dp_module.logger.warning.reset_mock()
        with pytest.raises(ModelDiscoveryError):
            dp_module._build_vllm_client_and_window()
        warnings = [str(c.args[0]) for c in dp_module.logger.warning.call_args_list]
        assert any("DATAPREP_MAX_MODEL_LEN" in w for w in warnings)

    def test_the_window_override_is_sanitised(self):
        """A negative value is not a window (it would silently disable the
        override) and an absurd one exceeds every real model — a budget sized
        for it overflows every window."""
        assert dp_module._sanitize_window_override(-5) == 0
        assert dp_module._sanitize_window_override(0) == 0
        assert dp_module._sanitize_window_override(4096) == 4096
        # An absurd value is treated as UNSET (discovery answers): clamping it
        # to "the largest sane window" is not a guard — ten million tokens
        # still overflows every real model.
        assert dp_module._sanitize_window_override(dp_module.MAX_SANE_MODEL_WINDOW_TOKENS + 1) == 0

    def test_contextual_model_in_a_different_namespace_is_flagged(self, monkeypatch):
        """Two different namespaces are not an alias: "org-a/granite" and
        "org-b/granite" can serve different windows, and the budget would be
        sized for the wrong one."""
        _model_endpoint(monkeypatch, 65536, model_id="org-a/granite-4.1-8b")
        monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_MODEL", "org-b/granite-4.1-8b")
        dp_module.logger.warning.reset_mock()
        dp_module._build_vllm_client_and_window()
        warnings = [str(c.args[0]) for c in dp_module.logger.warning.call_args_list]
        assert any("DATAPREP_MAX_MODEL_LEN" in w for w in warnings)

    def test_the_shipped_default_is_capped_even_when_the_window_is_a_guess(self):
        """A knob still at its shipped default is not a deliberate setting: on a
        deployment whose window is unknown (a strict provider) the doc_level
        default of 100000 chars is ~25k tokens, more than a small window
        holds. It must fail closed, not be sent as-is."""
        dp = create_dataprep()
        budget, source = dp._resolve_doc_budget(
            ["x" * 500] * 8,
            dp_module.DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL,
            dp_module.DERIVE_FALLBACK_WINDOW,
            scaffold_chars=_scaffold(),
            authoritative=False,
            single_call=True,
        )
        assert budget is None or budget < dp_module.DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL
        assert source in ("window-capped", "window-exhausted")

    def test_a_non_ascii_batch_is_reserved_by_its_serialized_length(self):
        """The request sends json.dumps(..., ensure_ascii=True): every
        non-ASCII character becomes a six-character escape. Reserving the RAW
        length under-counts a Spanish or French document by a third — and the
        request is then rejected."""
        dp = create_dataprep()
        ascii_chunks = ["x" * 500] * 8
        accented = ["á" * 500] * 8
        raw = dp._resolve_doc_budget(ascii_chunks, 0, 16384, scaffold_chars=_scaffold())
        escaped = dp._resolve_doc_budget(accented, 0, 16384, scaffold_chars=_scaffold())
        assert escaped[0] < raw[0], "the escaped payload must reserve more room than the raw text"

    def test_an_unbounded_filename_and_labels_are_measured(self):
        """The scaffolding is not a fixed allowance: a long file name and a long
        label list are per document and unbounded, and the BUDGET must shrink
        to make room for them."""
        from types import SimpleNamespace

        dp = create_dataprep()
        long_input = SimpleNamespace(
            storage_path="/tmp/" + ("a" * 900) + ".pdf",
            file_labels=["label-" + ("b" * 80)] * 15,
        )
        scaffold = dp_module._doc_context_scaffold_chars(long_input)
        assert scaffold > 1000, "a long filename and labels must be measured, not assumed"

        # ...and the budget the resolver derives shrinks with that scaffolding.
        short, _ = dp._resolve_doc_budget(
            ["x" * 500] * 8, 0, 65536, scaffold_chars=dp_module._doc_context_scaffold_chars(create_mock_ingest_input())
        )
        long_budget, _ = dp._resolve_doc_budget(
            ["x" * 500] * 8, 0, 65536, scaffold_chars=dp_module._doc_context_scaffold_chars(long_input)
        )
        assert long_budget < short

    @pytest.mark.asyncio
    async def test_the_applied_budget_accounts_for_the_real_scaffolding(self, monkeypatch):
        """The INGEST path must reserve the measured scaffolding: a long file
        name and a long label list shrink the budget that is applied, because
        they are part of the request and sit outside the budget."""
        monkeypatch.setattr(dp_module, "CONTEXTUAL_RETRIEVAL_ENABLED", True)
        monkeypatch.setenv("VLLM_API_KEY", "k")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        _model_endpoint(monkeypatch, 65536)

        async def _fake_create(*args, **kwargs):
            # Answer in the shape the call asks for: one context per item in a
            # batch, one context for a single call.
            user_turn = kwargs["messages"][-1]["content"]
            try:
                items = json.loads(user_turn)
            except (TypeError, ValueError):
                items = None
            body = {"contexts": ["ctx"] * len(items)} if isinstance(items, list) else {"context": "ctx"}
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.content = json.dumps(body)
            resp.usage = MagicMock(completion_tokens=10, prompt_tokens=10, total_tokens=20)
            return resp

        chunks = ["chunk body text. " * 160 for _ in range(200)]

        async def _applied_budget(input):
            dp = create_dataprep()
            log = AsyncMock()
            dp._write_ingestion_log = log
            client = AsyncMock()
            client.chat.completions.create = _fake_create
            with patch.object(dp_module, "AsyncOpenAI", return_value=client):
                await dp._apply_contextualization(chunks, input, "file1")
            truncations = [
                str(c.args[3]) for c in log.await_args_list if len(c.args) > 3 and "truncated" in str(c.args[3])
            ]
            assert truncations, "the document should have been truncated"
            kept = int(truncations[0].split("truncated to ")[1].split(" of ")[0])
            return kept

        short = await _applied_budget(create_mock_ingest_input())
        long = await _applied_budget(
            create_mock_ingest_input(
                storage_path="/uploads/" + ("a" * 900) + ".pdf",
                file_labels=["label-" + ("b" * 80)] * 15,
            )
        )
        assert long < short, "a long filename and labels must shrink the applied budget"

    def test_an_operator_stated_window_is_not_mismatch_checked(self):
        """The mismatch check belongs to a DISCOVERED window: an override is
        the operator's own statement (they set it precisely because discovery
        could not answer), so warning them about it would be self-referential."""
        monkeypatch = pytest.MonkeyPatch()
        try:
            monkeypatch.setattr(dp_module, "DATAPREP_MAX_MODEL_LEN", 65536)
            _model_endpoint(monkeypatch, 65536, model_id="org-a/granite-4.1-8b")
            monkeypatch.setattr(dp_module, "DATAPREP_CONTEXTUAL_MODEL", "org-b/granite-4.1-8b")
            dp_module.logger.warning.reset_mock()
            dp_module._build_vllm_client_and_window()
            assert dp_module.logger.warning.call_args_list == []
        finally:
            monkeypatch.undo()

    def test_the_output_token_reservation_is_sanitised(self):
        """0 or a negative reservation is not a reservation: it inflates the
        derived budget AND reaches the API as an invalid max_tokens."""
        assert dp_module._sanitize_output_tokens(0, 512) == 512
        assert dp_module._sanitize_output_tokens(-5, 512) == 512
        assert dp_module._sanitize_output_tokens(4096, 512) == 4096

    def test_window_exhausted_returns_none_not_zero(self):
        """A 0 budget means 'do not truncate' — the opposite of what we want."""
        dp = create_dataprep()
        budget, source = dp._resolve_doc_budget(["x" * 500] * 8, 0, 2048, scaffold_chars=_scaffold())  # T4
        assert budget is None, "must disable contextualization, not send the whole document"
        assert source == "window-exhausted"

    def test_assembled_prompt_fits_the_window(self, monkeypatch):
        """The property that matters, end to end.

        Builds the ACTUAL request the batched per-chunk path sends and checks
        prompt + completion against the discovered serving-model window. This
        is the assertion that would have caught the original bug: at 6000 on a
        2048-token window the request does not fit, and every batch silently
        falls back to raw chunks.
        """
        import json as _json

        dp = create_dataprep()
        # Deliberately LARGER than every budget under test, so the doc context
        # actually fills the derived budget. A document smaller than the budget
        # would never truncate, and the property would hold vacuously.
        chunks = ["chunk body text. " * 160 for _ in range(200)]  # 2720 chars each, ~500k total

        def _overhead_tokens():
            """Prompt + completion with ZERO document context — the floor."""
            largest = sorted(chunks, key=len, reverse=True)[: dp_module.LABEL_LLM_BATCH_SIZE]
            prompt = -(-len(dp_module.CONTEXTUAL_RETRIEVAL_PROMPT) // dp_module.CHARS_PER_TOKEN)
            batch_chars = dp_module._batch_user_turn_chars(largest)
            return (
                prompt + -(-batch_chars // dp_module.CHARS_PER_TOKEN),
                dp_module.CONTEXTUAL_MAX_TOKENS * dp_module.LABEL_LLM_BATCH_SIZE,
            )

        for window in (4096, 8192, 16384, 65536):
            budget, source = dp._resolve_doc_budget(chunks, 0, window, scaffold_chars=_scaffold())

            if budget is None:
                # Refusing is only CORRECT if the request genuinely could not
                # fit even with no document context at all. A refusal with room
                # to spare would silently disable the feature.
                prompt_tokens, completion = _overhead_tokens()
                assert prompt_tokens + completion >= window, (
                    f"refused at window={window} but the empty prompt fits in {prompt_tokens + completion} tokens"
                )
                continue

            assert source == "derived", f"window {window} produced {source}"
            assert budget < sum(len(c) for c in chunks), "budget must bind for this test to mean anything"

            doc_ctx = dp._build_doc_context(chunks, create_mock_ingest_input(), budget)
            system_prompt = dp_module.CONTEXTUAL_RETRIEVAL_PROMPT.replace("{document_context}", doc_ctx)
            batch = chunks[: dp_module.LABEL_LLM_BATCH_SIZE]
            user_turn = _json.dumps([{"index": i, "text": t} for i, t in enumerate(batch)])

            prompt_chars = len(system_prompt) + len(user_turn)
            prompt_tokens = -(-prompt_chars // dp_module.CHARS_PER_TOKEN)
            completion = dp_module.CONTEXTUAL_MAX_TOKENS * len(batch)
            assert prompt_tokens + completion <= window, (
                f"window={window} prompt={prompt_tokens} completion={completion} "
                f"budget={budget} — request would be rejected by vLLM"
            )

    def test_assembled_doc_level_request_fits_the_window(self):
        """The doc_level request carries the document context INSIDE the system
        prompt, and the scaffolding around it (filename line, labels line,
        header, truncation marker, user turn) sits OUTSIDE the budget. A
        request sized without that scaffolding overflows the window by
        exactly those characters — and the call is then rejected, retried and
        silently replaced by raw chunks."""
        import json as _json

        dp = create_dataprep()
        chunks = ["chunk body text. " * 160 for _ in range(200)]
        for window in (4096, 8192, 16384, 65536):
            budget, _source = dp._resolve_doc_budget(
                chunks, 100000, window, scaffold_chars=_scaffold(), single_call=True
            )
            if budget is None:
                continue  # window exhausted: nothing is sent at all
            doc_ctx = dp._build_doc_context(chunks, create_mock_ingest_input(), budget)
            system_prompt = dp_module._CONTEXTUAL_DOC_PROMPT_DEFAULT.replace("{document_context}", doc_ctx)
            user_turn = _json.dumps(["Write the document-level context."])
            prompt_tokens = -(-(len(system_prompt) + len(user_turn)) // dp_module.CHARS_PER_TOKEN)
            completion = dp_module.CONTEXTUAL_MAX_TOKENS
            assert prompt_tokens + completion <= window, (
                f"window={window} prompt={prompt_tokens} completion={completion} "
                f"budget={budget} — the request would be rejected by vLLM"
            )

    def test_the_old_fixed_6000_would_not_have_fit(self, monkeypatch):
        """Why deriving matters — this is the bug, stated as a test.

        The shipped literal (6000 chars) is not merely too small on a default
        install; on the constrained GPU profiles it is too LARGE, and every
        contextualization call overflows the window and silently falls back to
        raw chunks. This pins that fact so the derivation is not "simplified"
        back to a constant later.
        """
        import json as _json

        dp = create_dataprep()
        chunks = ["chunk body text. " * 160 for _ in range(200)]
        window = 4096

        budget, source = dp._resolve_doc_budget(chunks, 6000, window, scaffold_chars=_scaffold())  # the old literal
        assert source in ("window-capped", "window-exhausted"), "the old literal does not fit this window"
        assert budget is None or budget < 6000, "the old literal must not be sent as-is"

        # The historical claim, computed directly: the shipped literal DID
        # overflow this window, which is why the budget is derived.
        doc_ctx = dp._build_doc_context(chunks, create_mock_ingest_input(), 6000)
        system_prompt = dp_module.CONTEXTUAL_RETRIEVAL_PROMPT.replace("{document_context}", doc_ctx)
        batch = chunks[: dp_module.LABEL_LLM_BATCH_SIZE]
        user_turn = _json.dumps([{"index": i, "text": t} for i, t in enumerate(batch)])
        prompt_tokens = -(-(len(system_prompt) + len(user_turn)) // dp_module.CHARS_PER_TOKEN)
        completion = dp_module.CONTEXTUAL_MAX_TOKENS * len(batch)

        assert prompt_tokens + completion > window, (
            "expected the historical 6000-char budget to overflow this window; "
            "if it now fits, the overhead model changed and this test is stale"
        )

        # ...and the applied budget is one the window can accept (or none at
        # all): the system refuses or corrects the request rather than sending
        # it.
        capped, _source = dp._resolve_doc_budget(chunks, 0, window, scaffold_chars=_scaffold())
        assert capped is None or capped < 6000

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
            r = llm_response(json.dumps({"contexts": contexts}))
            return r

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=fake_create)
        chunks = ["alpha chunk text", "beta chunk text"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "file1")

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
            result, _degraded = await dp._apply_contextualization(
                ["raw zero", "raw one"], create_mock_ingest_input(), "f"
            )

        assert result[0] == "raw zero"  # empty context → raw chunk
        assert result[1] == "GOOD CONTEXT\n\nraw one"

    @pytest.mark.asyncio
    async def test_context_single_call_parses_json_context(self, monkeypatch):
        dp = create_dataprep()
        mock_response = llm_response(json.dumps({"context": "doc context"}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            ctx = await dp._context_single_call(mock_client, "m", "sys", 3, "chunk text", "file1")
        assert ctx == "doc context"
        assert mock_client.chat.completions.create.call_count == 1

    @pytest.mark.asyncio
    async def test_context_doc_call_uses_configurable_max_tokens(self, monkeypatch):
        """Doc-level context call must use CONTEXTUAL_MAX_TOKENS, not a hardcoded cap.

        Guards against the regression where max_tokens was hardcoded to 200 — too
        tight for large documents (the model writes ~196 tokens), so the JSON
        `{"context":"..."}` was intermittently truncated mid-string under concurrent
        vLLM load, yielding JSONDecodeError and a raw-chunk fallback.
        """
        dp = create_dataprep()
        monkeypatch.setattr(dp_module, "CONTEXTUAL_MAX_TOKENS", 333)
        mock_response = llm_response(json.dumps({"context": "ctx"}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            await dp._context_doc_call(mock_client, "m", "sys", "file1")
        # The call used the env-driven cap, not the legacy hardcoded 200.
        _, kwargs = mock_client.chat.completions.create.call_args
        assert kwargs["max_tokens"] == 333

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
            return contextualized, []

        async def fake_labels(chunks, all_labels, file_labels, file_id):
            captured["labels_in"] = list(chunks)
            return [{"text": c, "labels": ["L"]} for c in chunks], []

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
            return [{"text": c, "labels": ["L"]} for c in chunks], []

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
            result, _degraded = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
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
            result, _degraded = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
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
        mock_response = llm_response(json.dumps({"context": "CUCUMBER GUIDE"}))
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        chunks = ["c1", "c2", "c3"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
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
            result, _degraded = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
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
            r = llm_response(json.dumps({"contexts": ctxmap}))
            return r

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=fake_create)
        chunks = ["c0", "c1", "c2", "c3", "c4", "c5"]
        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _degraded = await dp._apply_contextualization(chunks, create_mock_ingest_input(), "f")
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
        bad = llm_response("not json")
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
            result, _degraded = await dp._apply_contextualization(["c0", "c1"], create_mock_ingest_input(), "f")
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
            return contextualized, []

        async def fake_labels(chunks, all_labels, file_labels, file_id):
            captured["labels_in"] = list(chunks)
            return [{"text": c, "labels": ["L"]} for c in chunks], []

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

    # ------------------------------------------------------------------
    # _context_batch_call — partial-response recovery (silent-fallback bug)
    # ------------------------------------------------------------------

    def _make_batch_response(self, contexts_dict: dict):
        """Build a mock chat completion response returning ``{"contexts": {...}}``."""
        mock_response = llm_response(json.dumps({"contexts": contexts_dict}))
        return mock_response

    @pytest.mark.asyncio
    async def test_batch_returns_all_contexts_on_full_success(self):
        """All chunk contexts present in the batch response → returned directly, no recovery."""
        dp = create_dataprep()
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=self._make_batch_response({"0": "ctx0", "1": "ctx1", "2": "ctx2"})
        )
        batch = [(0, "chunk0"), (1, "chunk1"), (2, "chunk2")]
        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_context_single_call", new_callable=AsyncMock) as single,
        ):
            result = await dp._context_batch_call(mock_client, "m", "sys", batch, "file1")
        assert result == {0: "ctx0", 1: "ctx1", 2: "ctx2"}
        single.assert_not_called()  # no recovery needed
        assert mock_client.chat.completions.create.call_count == 1  # one batch call

    @pytest.mark.asyncio
    async def test_batch_recovers_missing_chunks_on_partial_response(self):
        """Partial response (some contexts missing) → missing chunks recovered via per-chunk calls."""
        dp = create_dataprep()
        mock_client = AsyncMock()
        # Batch returns only 0 and 2 — index 1 is missing.
        mock_client.chat.completions.create = AsyncMock(
            return_value=self._make_batch_response({"0": "ctx0", "2": "ctx2"})
        )
        batch = [(0, "chunk0"), (1, "chunk1"), (2, "chunk2")]
        recovered = {}

        async def fake_single(client, model, sys_prompt, idx, text, file_id):
            recovered[idx] = f"recovered-{idx}"
            return recovered[idx]

        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_context_single_call", new=AsyncMock(side_effect=fake_single)),
        ):
            result = await dp._context_batch_call(mock_client, "m", "sys", batch, "file1")
        # All three chunks have a context — index 1 recovered, not raw.
        assert result == {0: "ctx0", 1: "recovered-1", 2: "ctx2"}
        assert 1 in recovered  # the missing chunk WAS recovered

    @pytest.mark.asyncio
    async def test_batch_recovers_all_missing_chunks_on_near_empty_response(self):
        """Near-empty response (1/4 returned) → all 3 missing chunks recovered."""
        dp = create_dataprep()
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=self._make_batch_response({"1": "ctx1"}))
        batch = [(0, "c0"), (1, "c1"), (2, "c2"), (3, "c3")]
        recovered = []

        async def fake_single(client, model, sys_prompt, idx, text, file_id):
            recovered.append(idx)
            return f"rec-{idx}"

        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_context_single_call", new=AsyncMock(side_effect=fake_single)),
        ):
            result = await dp._context_batch_call(mock_client, "m", "sys", batch, "file1")
        assert set(result.keys()) == {0, 1, 2, 3}
        assert sorted(recovered) == [0, 2, 3]  # exactly the missing ones

    @pytest.mark.asyncio
    async def test_batch_falls_back_to_per_chunk_on_empty_parse(self):
        """Batch response with NO valid contexts → full per-chunk fallback for all."""
        dp = create_dataprep()
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=self._make_batch_response({})  # empty
        )
        batch = [(0, "c0"), (1, "c1")]
        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as log,
            patch.object(
                dp,
                "_context_single_call",
                new=AsyncMock(side_effect=lambda *a, **k: "single-ctx"),
            ),
        ):
            result = await dp._context_batch_call(mock_client, "m", "sys", batch, "file1")
        assert result == {0: "single-ctx", 1: "single-ctx"}  # both via per-chunk fallback
        # WARN logged (parse failure → full fallback).
        assert any(call.args[1] == "WARN" for call in log.call_args_list)

    @pytest.mark.asyncio
    async def test_batch_falls_back_to_per_chunk_on_exception(self):
        """Batch call raises → full per-chunk fallback for all."""
        dp = create_dataprep()
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=RuntimeError("vLLM down"))
        batch = [(0, "c0"), (1, "c1")]
        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as log,
            patch.object(
                dp,
                "_context_single_call",
                new=AsyncMock(side_effect=lambda *a, **k: "single-ctx"),
            ),
        ):
            result = await dp._context_batch_call(mock_client, "m", "sys", batch, "file1")
        assert result == {0: "single-ctx", 1: "single-ctx"}
        assert any(call.args[1] == "WARN" for call in log.call_args_list)

    @pytest.mark.asyncio
    async def test_batch_single_chunk_skips_batch_call(self):
        """Single-chunk batch → direct per-chunk call (no batch API call)."""
        dp = create_dataprep()
        mock_client = AsyncMock()
        batch = [(0, "only chunk")]
        with (
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(
                dp,
                "_context_single_call",
                new=AsyncMock(return_value="single-ctx"),
            ) as single,
        ):
            result = await dp._context_batch_call(mock_client, "m", "sys", batch, "file1")
        assert result == {0: "single-ctx"}
        single.assert_awaited_once()
        mock_client.chat.completions.create.assert_not_called()  # no batch call for single


# ---------------------------------------------------------------------------
# Story 2.6a — ACL-label preserve (OKF gap G4)
# _finalize_chunk_labels previously used file_labels ONLY as a scope filter and
# never unioned ACL-prefixed (t:/r:/d:) file_labels into the output, so they
# never reached chunk_labels. _apply_labels now short-circuits the LLM call when
# file_labels carries ACL prefixes. These tests pin the fix + the no-regression
# contract for the free-form GRAPH corpus.
# ---------------------------------------------------------------------------


class TestAclPredicate:
    """The _is_acl_label predicate (module-level, single-sourced)."""

    def test_acl_predicate_membership(self):
        assert dp_module._is_acl_label("t:x") is True
        assert dp_module._is_acl_label("r:y") is True
        assert dp_module._is_acl_label("d:z") is True
        assert dp_module._is_acl_label("Healthcare") is False
        # Case-sensitive by design (pins the L4 canonicalization boundary).
        assert dp_module._is_acl_label("T:x") is False
        assert dp_module._is_acl_label("R:y") is False
        assert dp_module._is_acl_label("D:z") is False
        # Empty-value degenerate token still detected (value sanitization is
        # owned by the orchestrator 2.9.1 / L3, not 2.6a).
        assert dp_module._is_acl_label("t:") is True
        # Non-str guard (None / int must not raise AttributeError).
        assert dp_module._is_acl_label(None) is False
        assert dp_module._is_acl_label(123) is False


class TestFinalizeChunkLabelsAcl:
    """Direct unit tests for _finalize_chunk_labels — the G4 bug site."""

    @pytest.mark.asyncio
    async def test_acl_prefixed_file_labels_preserved(self):
        dp = create_dataprep()
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result = await dp._finalize_chunk_labels(
                0,
                ["Cucumber"],
                ["Cucumber"],
                "file1",
                ["Cucumber", "t:t1", "r:r1", "d:dom"],
            )
        # Cucumber survives scope (in file_labels); ACL labels unioned verbatim.
        assert "Cucumber" in result
        assert "t:t1" in result
        assert "r:r1" in result
        assert "d:dom" in result

    @pytest.mark.asyncio
    async def test_acl_only_file_labels_preserved_when_no_taxonomy_match(self):
        dp = create_dataprep()
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result = await dp._finalize_chunk_labels(0, [], ["Healthcare"], "file1", ["t:t1"])
        assert result == ["t:t1"]

    @pytest.mark.asyncio
    async def test_no_acl_no_behavior_change(self):
        """Free-form GRAPH corpus docs (no ACL prefixes) are a true no-op."""
        dp = create_dataprep()
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result = await dp._finalize_chunk_labels(0, ["Healthcare"], ["Healthcare"], "file1", ["Healthcare"])
        assert result == ["Healthcare"]

    @pytest.mark.asyncio
    async def test_finalize_excludes_acl_from_new_labels(self):
        """ACL labels must never trigger the 'add to Knowledge Hierarchy' WARN."""
        dp = create_dataprep()
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as log:
            await dp._finalize_chunk_labels(0, ["t:t1"], [], "file1", ["t:t1"])
        # No WARN emitted (new_labels excludes the ACL label) + label preserved.
        levels = [call.args[1] for call in log.await_args_list]
        assert "WARN" not in levels

    @pytest.mark.asyncio
    async def test_finalize_skips_null_suggestions_instead_of_crashing(self):
        """A malformed LLM response can put null/non-string entries in the
        suggestion list — they must be SKIPPED, never crash the file ingest
        (live 2026-09-14: vLLM returned a null label and `label.lower()`
        500'd every ingest of the affected file)."""
        dp = create_dataprep()
        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock):
            result = await dp._finalize_chunk_labels(
                0,
                ["Healthcare", None, "", 123],  # malformed entries ride along
                ["Healthcare"],
                "file1",
                ["Healthcare"],
            )
        assert result == ["Healthcare"]


class TestApplyLabelsAclPoolSemantics:
    """REVISED (David's directive, 2026-08-23 - the skip is REMOVED): bundle
    labels are a CANDIDATE POOL, never forced attachments. The strategy RUNS
    for ACL-carrying file_labels; per-chunk applicability is decided by
    content. The llm path scopes via _finalize_chunk_labels (pool intersect
    taxonomy + ACL verbatim); embedding/bm25 union ONLY the ACL tokens."""

    @pytest.mark.asyncio
    async def test_llm_runs_when_acl_present(self):
        """The strategy must NOT be skipped for ACL-carrying labels - the old
        blanket stamp made every chunk match every scoped query."""
        dp = create_dataprep()
        with (
            patch.object(dp, "_label_with_llm", new_callable=AsyncMock) as llm,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            llm.return_value = ([{"text": "chunk", "labels": ["Healthcare"]}], [])
            result, _reasons = await dp._apply_labels(
                ["chunk"], ["Healthcare"], ["t:t1", "r:r1", "d:dom", "Healthcare"], "file1"
            )
        llm.assert_called_once()
        assert result[0]["labels"] == ["Healthcare"]

    @pytest.mark.asyncio
    async def test_llm_still_called_when_no_acl(self):
        """Pins the predicate: file_labels WITHOUT ACL prefixes must still run
        the LLM (else every legacy Gov-Chat doc skips labeling)."""
        dp = create_dataprep()
        with (
            patch.object(dp, "_label_with_llm", new_callable=AsyncMock) as llm,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            llm.return_value = [{"text": "chunk", "labels": ["Healthcare"]}]
            await dp._apply_labels(["chunk"], ["Healthcare"], ["Healthcare"], "file1")
        llm.assert_called_once()

    @pytest.mark.asyncio
    async def test_embedding_strategy_runs_and_preserves_acl(self):
        dp = create_dataprep()
        with (
            patch.object(dp_module, "LABELING_STRATEGY", "embedding"),
            patch.object(dp, "_label_with_embedding") as emb,
            patch.object(dp, "_label_with_llm", new_callable=AsyncMock) as llm,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            emb.return_value = [{"text": "chunk", "labels": ["Healthcare"]}]
            result, _reasons = await dp._apply_labels(["chunk"], ["Healthcare"], ["t:t1", "Healthcare"], "file1")
        emb.assert_called_once()
        llm.assert_not_called()
        labels = result[0]["labels"]
        assert "Healthcare" in labels  # per-chunk applicability kept
        assert "t:t1" in labels  # ACL token unioned verbatim
        assert labels.count("t:t1") == 1  # dedup

    @pytest.mark.asyncio
    async def test_bm25_strategy_runs_and_preserves_acl(self):
        dp = create_dataprep()
        with (
            patch.object(dp_module, "LABELING_STRATEGY", "bm25"),
            patch.object(dp, "_label_with_bm25") as bm25,
            patch.object(dp, "_label_with_llm", new_callable=AsyncMock) as llm,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            bm25.return_value = [{"text": "chunk", "labels": ["Healthcare"]}]
            result, _reasons = await dp._apply_labels(["chunk"], ["Healthcare"], ["t:t1", "d:dom"], "file1")
        bm25.assert_called_once()
        llm.assert_not_called()
        labels = result[0]["labels"]
        assert "Healthcare" in labels
        assert "t:t1" in labels and "d:dom" in labels

    @pytest.mark.asyncio
    async def test_no_acl_embedding_labels_unchanged(self):
        """Without ACL tokens the embedding path returns selections untouched
        (legacy behavior)."""
        dp = create_dataprep()
        with (
            patch.object(dp_module, "LABELING_STRATEGY", "embedding"),
            patch.object(dp, "_label_with_embedding") as emb,
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            emb.return_value = [{"text": "chunk", "labels": ["Healthcare"]}]
            result, _reasons = await dp._apply_labels(["chunk"], ["Healthcare"], ["Healthcare"], "file1")
        assert result[0]["labels"] == ["Healthcare"]


class TestPerChunkFallbackAclPreserve:
    """The per-chunk fallback (_llm_call_single returns file_labels as suggested
    after exhausting retries) also preserves ACL labels via the
    _finalize_chunk_labels union (critic gap #1). Tested by calling
    _label_with_llm directly (Part 2 makes the fallback unreachable for ACL
    docs via _apply_labels in production)."""

    @pytest.mark.asyncio
    async def test_acl_survives_per_chunk_fallback(self, monkeypatch):
        dp = create_dataprep()
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")

        # Force the real _llm_call_single to exhaust its 3 retries and return
        # file_labels as suggested (the line-976 fallback).
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("LLM error"))

        with (
            patch.object(dp_module, "AsyncOpenAI", return_value=mock_client),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
        ):
            result, _reasons = await dp._label_with_llm(
                ["chunk"],
                ["Healthcare"],
                ["t:t1", "r:r1", "d:dom", "Healthcare"],
                "file1",
            )
        labels = result[0]["labels"]
        for acl in ("t:t1", "r:r1", "d:dom"):
            assert acl in labels
        assert "Healthcare" in labels
        assert mock_client.chat.completions.create.call_count == 3  # exhausted retries


class TestLlmLabelLogClassification:
    """David, 2026-09-15: transient LLM failures (self-healed by the retry
    ladder) are WARN, but the TERMINAL per-chunk fallback (all 3 attempts
    exhausted — the chunk permanently loses LLM labeling) must log at ERROR.
    Live: the shared vLLM gateway flapped 502s during the Bali ingest and 229
    permanently-degraded chunks sat in the log as warnings."""

    @pytest.mark.asyncio
    async def test_terminal_fallback_is_error_and_transients_are_warn(self):
        dp = create_dataprep()
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("502 Bad Gateway"))

        with patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock) as log:
            await dp._llm_call_single(mock_client, "test-model", "sys", 42, "chunk text", "file1", ["Healthcare"])

        levels = [call.args[1] for call in log.call_args_list]
        assert levels == ["WARN", "WARN", "WARN", "ERROR"]  # attempts 1-3 then the terminal row
        # The transient rows say they are retrying; the terminal row says the
        # chunk degraded to file labels.
        assert all("retrying" in call.args[3] for call in log.call_args_list[:3])
        assert "falls back to file labels" in log.call_args_list[3].args[3]


class TestAclLabelPreserveE2E:
    """End-to-end: ACL labels survive ingest_file_with_guardrail into the
    persisted chunk's metadata.chunk_labels. REVISED (2026-08-23): _apply_labels
    is still NOT mocked, but since the skip removal the REAL labeling strategy
    runs for ACL-bearing file_labels — the inner LLM call is mocked at
    _label_with_llm level (per-chunk applicability returns Healthcare), and the
    real _finalize_chunk_labels must preserve the ACL tokens verbatim."""

    @pytest.mark.asyncio
    async def test_acl_file_labels_reach_chunk_labels_metadata(self):
        dp = create_dataprep()
        inp = create_mock_ingest_input(file_labels=["t:tenant1", "r:repoA", "d:health", "Healthcare"])

        captured_docs = []

        async def capture_batch(batch, *args, **kwargs):
            captured_docs.extend(batch)

        with (
            patch.object(dp, "_update_doc_status", new_callable=AsyncMock),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["Healthcare"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["chunk1"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            # Pass-through: contextualization returns chunks unchanged so the
            # labeling input is the raw chunk (CONTEXTUAL_LABEL_RAW default).
            patch.object(dp, "_apply_contextualization", new_callable=AsyncMock, return_value=(["chunk1"], [])),
            # The real _apply_labels dispatches to the (mocked) LLM strategy;
            # the REAL _finalize_chunk_labels then scopes to the pool and
            # preserves the ACL tokens verbatim.
            patch.object(
                dp,
                "_label_with_llm",
                new_callable=AsyncMock,
                return_value=([{"text": "chunk1", "labels": ["Healthcare", "t:tenant1", "r:repoA", "d:health"]}], []),
            ),
            patch.object(dp, "_process_batch", new_callable=AsyncMock, side_effect=capture_batch),
            patch.object(dp_module, "ArangoGraph"),
            patch.object(dp_module, "Document", side_effect=lambda **kw: type("Doc", (), kw)),
        ):
            await dp.ingest_file_with_guardrail(inp, lock_file=None)

        assert len(captured_docs) == 1
        chunk_labels = captured_docs[0].metadata["chunk_labels"]
        # The 3 ACL prefixes + the taxonomy label all reach chunk_labels.
        assert "t:tenant1" in chunk_labels
        assert "r:repoA" in chunk_labels
        assert "d:health" in chunk_labels
        assert "Healthcare" in chunk_labels

    @pytest.mark.asyncio
    async def test_all_batches_failed_never_reports_ingested(self):
        """P0 (David, 2026-09-09, Kenya v8): batch/model failures (remote LLM
        502s) were swallowed per batch while the pipeline still reported
        'Ingested' — meta rows went 'indexed' with chunk_counts over a
        ZERO-write graph and an empty graph SERVED. The gather site must
        refuse success when every batch failed and nothing landed; the raise
        routes into the designed 'Ingestion Error' path."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()
        statuses = []

        async def fake_status(file_id, status, chunk_count=None, concept_id=None, error=None):
            statuses.append(status)

        async def failing_batch(batch_docs, *a, **k):
            return {"inserted": 0, "failed": True}

        with (
            patch.object(dp, "_update_doc_status", new=AsyncMock(side_effect=fake_status)),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["L"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["c1", "c2"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=([{"text": "c1", "labels": ["L"]}, {"text": "c2", "labels": ["L"]}], []),
            ),
            patch.object(dp, "_process_batch", new=AsyncMock(side_effect=failing_batch)),
            patch.object(dp, "retract_file", new_callable=AsyncMock),
            patch.object(dp_module, "ArangoGraph"),
            pytest.raises(HTTPException),
        ):
            await dp.ingest_file_with_guardrail(inp)

        assert "Ingested" not in statuses
        assert "Ingestion Error" in statuses

    @pytest.mark.asyncio
    async def test_honest_empty_extraction_stays_ingested(self):
        """A batch that completes WITHOUT exception and extracts no entities is
        an honest empty — not a failure. Zero inserts with zero failed batches
        keeps the 'Ingested' verdict (unchanged behavior, pinned so the P0
        refusal never over-fires on entity-free content)."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()
        statuses = []

        async def fake_status(file_id, status, chunk_count=None, concept_id=None, error=None):
            statuses.append(status)

        async def empty_batch(batch_docs, *a, **k):
            return {"inserted": 0, "failed": False}

        with (
            patch.object(dp, "_update_doc_status", new=AsyncMock(side_effect=fake_status)),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["L"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["c1"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp, "_apply_labels", new_callable=AsyncMock, return_value=([{"text": "c1", "labels": ["L"]}], [])
            ),
            # Not degraded: no vLLM is reachable here, and the real
            # _apply_contextualization would report a client-init degradation
            # unrelated to the empty-extraction behavior under test.
            patch.object(
                dp,
                "_apply_contextualization",
                new_callable=AsyncMock,
                side_effect=lambda chunks, inp, fid: (list(chunks), []),
            ),
            patch.object(dp, "_process_batch", new=AsyncMock(side_effect=empty_batch)),
            patch.object(dp_module, "ArangoGraph"),
        ):
            await dp.ingest_file_with_guardrail(inp)

        assert statuses[-1] == "Ingested"

    @pytest.mark.asyncio
    async def test_partial_batch_success_still_ingests(self):
        """Some batches landed, some failed -> 'Ingested' (per-batch warnings
        stay in the ingestion log); the P0 refusal fires only when NOTHING
        was written."""
        dp = create_dataprep()
        inp = create_mock_ingest_input()
        statuses = []

        async def fake_status(file_id, status, chunk_count=None, concept_id=None, error=None):
            statuses.append(status)

        async def mixed_batch(batch_docs, current_batch_num, *a, **k):
            if current_batch_num == 1:
                return {"inserted": 3, "failed": False}
            return {"inserted": 0, "failed": True}

        with (
            patch.object(dp, "_update_doc_status", new=AsyncMock(side_effect=fake_status)),
            patch.object(dp, "_write_ingestion_log", new_callable=AsyncMock),
            patch.object(dp, "_fetch_all_labels", new_callable=AsyncMock, return_value=["L"]),
            patch.object(dp, "_load_and_chunk", new_callable=AsyncMock, return_value=["c1", "c2", "c3", "c4"]),
            patch.object(dp, "_run_guardrail", new_callable=AsyncMock, return_value={"success": True}),
            patch.object(
                dp,
                "_apply_labels",
                new_callable=AsyncMock,
                return_value=([{"text": c, "labels": ["L"]} for c in ["c1", "c2", "c3", "c4"]], []),
            ),
            # Not degraded: with no vLLM reachable the real _apply_contextualization
            # reports a client-init degradation that flips the status for reasons
            # unrelated to the partial-batch behavior under test.
            patch.object(
                dp,
                "_apply_contextualization",
                new_callable=AsyncMock,
                side_effect=lambda chunks, inp, fid: (list(chunks), []),
            ),
            patch.object(dp, "_process_batch", new=AsyncMock(side_effect=mixed_batch)),
            patch.object(dp_module, "ArangoGraph"),
        ):
            await dp.ingest_file_with_guardrail(inp)

        assert statuses[-1] == "Ingested"


# ── Remote-LLM resilience (David, 2026-09-09) ──
class TestLlmResilience:
    def _patch_clock(self, monkeypatch):
        # No real waiting: delays collapse to zero, sleeps are recorded.
        # Module storm state resets per test (it is shared global state).
        dp_module._LLM_STORM_UNTIL = 0.0
        dp_module._LLM_STORM_STRIKES = 0
        calls = {"sleeps": [], "delays": []}
        monkeypatch.setattr(dp_module, "_llm_retry_delay_s", lambda attempt: calls["delays"].append(attempt) or 0.0)

        async def fake_sleep(s):
            calls["sleeps"].append(s)

        monkeypatch.setattr(dp_module.asyncio, "sleep", fake_sleep)
        return calls

    def test_transient_502_burst_recovers(self, monkeypatch):
        self._patch_clock(monkeypatch)
        attempts = {"n": 0}

        async def flaky():
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise RuntimeError("InternalServerError: 502 Bad Gateway")
            return "ok"

        import asyncio

        result = asyncio.run(dp_module._call_llm_resilient(flaky, what="test"))
        assert result == "ok"
        assert attempts["n"] == 3

    def test_permanent_502_exhausts_ladder_and_raises_last(self, monkeypatch):
        self._patch_clock(monkeypatch)
        attempts = {"n": 0}

        async def always_502():
            attempts["n"] += 1
            raise RuntimeError("InternalServerError: 502 Bad Gateway")

        import asyncio

        with pytest.raises(RuntimeError):
            asyncio.run(dp_module._call_llm_resilient(always_502, what="test"))
        assert attempts["n"] == dp_module._LLM_RETRY_ATTEMPTS

    def test_4xx_fails_fast(self, monkeypatch):
        calls = self._patch_clock(monkeypatch)
        attempts = {"n": 0}

        async def bad_request():
            attempts["n"] += 1
            raise RuntimeError("BadRequestError: 400")

        import asyncio

        with pytest.raises(RuntimeError):
            asyncio.run(dp_module._call_llm_resilient(bad_request, what="test"))
        assert attempts["n"] == 1
        assert calls["sleeps"] == []

    def test_storm_cooldown_advances_after_transient_failure(self, monkeypatch):
        self._patch_clock(monkeypatch)
        import asyncio

        async def once_502():
            raise RuntimeError("502 Bad Gateway")

        with pytest.raises(RuntimeError):
            asyncio.run(dp_module._call_llm_resilient(once_502, what="test"))
        assert dp_module._LLM_STORM_STRIKES >= 1
        assert dp_module._LLM_STORM_UNTIL > 0


class TestInitializeClient:
    """Tests for GenieArangoDataprep._initialize_client().

    Exercises the subclass override that replaced the import-time
    ``_parent_mod.ARANGO_DB_NAME`` monkeypatch (Story 1.4). The vendored parent
    reads module-level constants; this override must resolve the GENIE DB
    convention (``ARANGO_DB`` → ``ARANGO_DB_NAME`` → ``genie-ai``) with the
    parent's connection defaults (``ARANGO_USERNAME``/``ARANGO_URL``/
    ``ARANGO_PASSWORD``).
    """

    def _mock_arango(self):
        """Patch the ``arango`` package with a fake ArangoClient.

        Returns a 4-tuple: (patcher, fake_client, fake_db, client_kwargs_capture).
        The fake ArangoClient records the kwargs it was constructed with (hosts)
        so tests can assert the resolved ARANGO_URL default.
        """
        client_kwargs_capture = {}
        fake_client = MagicMock()
        fake_db = MagicMock()
        fake_db.has_database.return_value = False
        fake_client.db.return_value = fake_db

        def _fake_client_factory(**kw):
            client_kwargs_capture.update(kw)
            return fake_client

        fake_arango = MagicMock()
        fake_arango.ArangoClient = _fake_client_factory
        return (
            patch.dict("sys.modules", {"arango": fake_arango}),
            fake_client,
            fake_db,
            client_kwargs_capture,
        )

    def test_resolves_genie_db_default(self, monkeypatch):
        """Unset ARANGO_DB/ARANGO_DB_NAME → genie-ai (retriever's default)."""
        monkeypatch.delenv("ARANGO_DB", raising=False)
        monkeypatch.delenv("ARANGO_DB_NAME", raising=False)
        dp = create_dataprep()
        with self._mock_arango()[0]:
            dp._initialize_client()
        # First client.db() call is the _system handle; second is the target.
        calls = dp.client.db.call_args_list
        assert calls[0].kwargs["name"] == "_system"
        assert calls[1].kwargs["name"] == "genie-ai"

    def test_arango_db_wins_over_db_name(self, monkeypatch):
        """ARANGO_DB takes precedence over ARANGO_DB_NAME."""
        monkeypatch.setenv("ARANGO_DB", "genie-ai")
        monkeypatch.setenv("ARANGO_DB_NAME", "_system")
        dp = create_dataprep()
        with self._mock_arango()[0]:
            dp._initialize_client()
        calls = dp.client.db.call_args_list
        assert calls[1].kwargs["name"] == "genie-ai"

    def test_db_name_fallback_when_arango_db_unset(self, monkeypatch):
        """ARANGO_DB unset but ARANGO_DB_NAME set → uses ARANGO_DB_NAME."""
        monkeypatch.delenv("ARANGO_DB", raising=False)
        monkeypatch.setenv("ARANGO_DB_NAME", "legacy-db")
        dp = create_dataprep()
        with self._mock_arango()[0]:
            dp._initialize_client()
        calls = dp.client.db.call_args_list
        assert calls[1].kwargs["name"] == "legacy-db"

    def test_uses_arango_username_contract(self, monkeypatch):
        """The override reads ARANGO_USERNAME (parent/compose/retriever contract),
        not the misspelled ARANGO_USER — the env-var bug found in review."""
        monkeypatch.setenv("ARANGO_USERNAME", "dataprep-user")
        monkeypatch.delenv("ARANGO_USER", raising=False)
        dp = create_dataprep()
        with self._mock_arango()[0]:
            dp._initialize_client()
        sys_db_call = dp.client.db.call_args_list[0]
        assert sys_db_call.kwargs["username"] == "dataprep-user"

    def test_arango_user_fallback_for_backwards_compat(self, monkeypatch):
        """ARANGO_USERNAME unset → falls back to ARANGO_USER (legacy)."""
        monkeypatch.delenv("ARANGO_USERNAME", raising=False)
        monkeypatch.setenv("ARANGO_USER", "legacy-user")
        dp = create_dataprep()
        with self._mock_arango()[0]:
            dp._initialize_client()
        sys_db_call = dp.client.db.call_args_list[0]
        assert sys_db_call.kwargs["username"] == "legacy-user"

    def test_arango_url_default(self, monkeypatch):
        """ARANGO_URL unset → http://localhost:8529 (parent default)."""
        monkeypatch.delenv("ARANGO_URL", raising=False)
        dp = create_dataprep()
        patcher, _, _, client_kwargs = self._mock_arango()
        with patcher:
            dp._initialize_client()
        assert client_kwargs["hosts"] == "http://localhost:8529"

    def test_arango_url_from_env(self, monkeypatch):
        """ARANGO_URL set → used verbatim."""
        monkeypatch.setenv("ARANGO_URL", "http://arango-vector-db:8529")
        dp = create_dataprep()
        patcher, _, _, client_kwargs = self._mock_arango()
        with patcher:
            dp._initialize_client()
        assert client_kwargs["hosts"] == "http://arango-vector-db:8529"

    def test_creates_database_when_missing(self, monkeypatch):
        """Target DB missing → create_database called on the _system handle."""
        monkeypatch.setenv("ARANGO_DB", "genie-ai")
        dp = create_dataprep()
        patcher, _, fake_db, _ = self._mock_arango()
        with patcher:
            fake_db.has_database.return_value = False
            dp._initialize_client()
            fake_db.create_database.assert_called_once_with("genie-ai")

    def test_skips_create_database_when_present(self, monkeypatch):
        """Target DB exists → no create_database."""
        monkeypatch.setenv("ARANGO_DB", "genie-ai")
        dp = create_dataprep()
        patcher, _, fake_db, _ = self._mock_arango()
        with patcher:
            fake_db.has_database.return_value = True
            dp._initialize_client()
            fake_db.create_database.assert_not_called()


class TestResolveDoclingDevice:
    """DOCLING_DEVICE → docling AcceleratorDevice mapping (CUDA default, safe fallback)."""

    def test_cpu_forced(self):
        from dataprep.genieai_dataprep_utils import (
            AcceleratorDevice,
            _resolve_docling_device,
        )

        assert _resolve_docling_device("cpu") is AcceleratorDevice.CPU

    def test_cuda_used_when_gpu_available(self):
        from dataprep.genieai_dataprep_utils import (
            AcceleratorDevice,
            _resolve_docling_device,
        )

        assert _resolve_docling_device("cuda", cuda_available=True) is AcceleratorDevice.CUDA

    def test_cuda_falls_back_to_cpu_without_gpu(self):
        from dataprep.genieai_dataprep_utils import (
            AcceleratorDevice,
            _resolve_docling_device,
        )

        assert _resolve_docling_device("cuda", cuda_available=False) is AcceleratorDevice.CPU

    def test_non_cpu_value_treated_as_cuda(self):
        from dataprep.genieai_dataprep_utils import (
            AcceleratorDevice,
            _resolve_docling_device,
        )

        assert _resolve_docling_device("auto", cuda_available=True) is AcceleratorDevice.CUDA
