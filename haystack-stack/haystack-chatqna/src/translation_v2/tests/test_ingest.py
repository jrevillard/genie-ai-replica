"""End-to-end ingestion tests using synthesized PDFs + a fake embedder."""
from __future__ import annotations

import pytest

from translation_v2.rag.chunker import LayoutAwareChunker
from translation_v2.rag.ingest import IngestPipeline, ingest_pdf
from translation_v2.rag.vector_store import InMemoryVectorStore


class TestNativeIngest:
    @pytest.mark.asyncio
    async def test_single_page_native_pdf(
        self, make_native_pdf, fake_embedder
    ):
        pdf = make_native_pdf(
            "native.pdf", ["A patient with headache and fever came to the clinic."]
        )
        store = InMemoryVectorStore()
        pipe = IngestPipeline(
            embedder=fake_embedder,
            vector_store=store,
            chunker=LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=10),
        )
        summary = await pipe.ingest_pdf(pdf)
        assert summary["pages"] == 1
        assert summary["scanned_pages"] == 0
        assert summary["chunks"] >= 1
        assert summary["indexed"] == summary["chunks"]
        assert len(store) == summary["chunks"]

    @pytest.mark.asyncio
    async def test_doc_id_defaults_to_filename_stem(
        self, make_native_pdf, fake_embedder
    ):
        pdf = make_native_pdf("MyReport.pdf", ["Some clinical content here."])
        store = InMemoryVectorStore()
        summary = await ingest_pdf(
            pdf,
            embedder=fake_embedder,
            vector_store=store,
            chunker=LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5),
        )
        assert summary["doc_id"] == "MyReport"

    @pytest.mark.asyncio
    async def test_explicit_doc_id_respected(self, make_native_pdf, fake_embedder):
        pdf = make_native_pdf("a.pdf", ["content"])
        store = InMemoryVectorStore()
        summary = await ingest_pdf(
            pdf,
            doc_id="explicit-id",
            embedder=fake_embedder,
            vector_store=store,
            chunker=LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5),
        )
        assert summary["doc_id"] == "explicit-id"


class TestScannedIngest:
    @pytest.mark.asyncio
    async def test_scanned_pages_counted_and_skipped(
        self, make_scanned_pdf, fake_embedder
    ):
        pdf = make_scanned_pdf()
        store = InMemoryVectorStore()
        pipe = IngestPipeline(embedder=fake_embedder, vector_store=store)
        summary = await pipe.ingest_pdf(pdf)
        assert summary["pages"] == 1
        assert summary["scanned_pages"] == 1
        assert summary["chunks"] == 0
        assert summary["indexed"] == 0
        assert len(store) == 0


class TestEmbedderContract:
    @pytest.mark.asyncio
    async def test_embedder_called_with_chunk_texts(
        self, make_native_pdf, fake_embedder
    ):
        pdf = make_native_pdf("a.pdf", ["First sentence about health."])
        store = InMemoryVectorStore()
        await ingest_pdf(
            pdf,
            embedder=fake_embedder,
            vector_store=store,
            chunker=LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5),
        )
        # Exactly one embed call, carrying the chunked texts
        assert len(fake_embedder.calls) == 1
        assert all(isinstance(s, str) for s in fake_embedder.calls[0])

    @pytest.mark.asyncio
    async def test_embedder_length_mismatch_raises(self, make_native_pdf):
        class BadEmbedder:
            async def embed(self, texts):
                return []  # pretend it returned zero vectors

        pdf = make_native_pdf("a.pdf", ["hello world"])
        store = InMemoryVectorStore()
        pipe = IngestPipeline(
            embedder=BadEmbedder(),
            vector_store=store,
            chunker=LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5),
        )
        with pytest.raises(RuntimeError):
            await pipe.ingest_pdf(pdf)


class TestMixedCorpusIntegration:
    @pytest.mark.asyncio
    async def test_multiple_pdfs_share_store(
        self, make_native_pdf, fake_embedder
    ):
        a = make_native_pdf("a.pdf", ["doc A content about headaches and fever"])
        b = make_native_pdf("b.pdf", ["doc B content about blood pressure checks"])
        store = InMemoryVectorStore()
        pipe = IngestPipeline(
            embedder=fake_embedder,
            vector_store=store,
            chunker=LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5),
        )
        await pipe.ingest_pdf(a, doc_id="A")
        await pipe.ingest_pdf(b, doc_id="B")
        assert len(store) >= 2

        # Can search and recover per-doc chunks
        vec = (await fake_embedder.embed(["anything"]))[0]
        results = await store.search(vec, k=10)
        doc_ids = {ch.doc_id for (ch, _) in results}
        assert doc_ids == {"A", "B"}
