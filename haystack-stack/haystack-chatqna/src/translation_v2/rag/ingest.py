"""PDF ingestion pipeline for v2 RAG.

Orchestrates: load → detect scanned → chunk → embed → store. Scanned
pages are logged and skipped in Step 4 (OCR integration lands later).

Not wired to any user-facing endpoint in Step 4. The CLI at
``translation_v2.rag.cli`` is the only entry point; its invocations
are manual validation, not production traffic.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from translation_v2.interfaces import Chunk
from translation_v2.rag.chunker import LayoutAwareChunker
from translation_v2.rag.pdf_loader import load_pdf

logger = logging.getLogger(__name__)


class IngestPipeline:
    """Composes chunker + embedder + vector store.

    The embedder and vector store are required; the chunker defaults
    to :class:`LayoutAwareChunker` with flag-driven parameters.
    """

    def __init__(
        self,
        embedder: Any,
        vector_store: Any,
        chunker: Any | None = None,
    ) -> None:
        self.chunker = chunker or LayoutAwareChunker()
        self.embedder = embedder
        self.vector_store = vector_store

    async def ingest_pdf(
        self, path: str | Path, doc_id: str | None = None
    ) -> dict:
        path = Path(path)
        pages = load_pdf(path)
        doc_id = doc_id or path.stem

        scanned = [p.page_num for p in pages if p.is_scanned]
        if scanned:
            logger.warning(
                "Scanned page(s) detected in %s (pages %s) — skipping; "
                "OCR is not wired in Step 4.",
                path,
                scanned,
            )

        chunks = self.chunker.chunk_pages(pages, doc_id=doc_id)
        summary = {
            "doc_id": doc_id,
            "pages": len(pages),
            "scanned_pages": len(scanned),
            "chunks": len(chunks),
            "indexed": 0,
        }
        if not chunks:
            return summary

        embeddings = await self.embedder.embed([c.text for c in chunks])
        if len(embeddings) != len(chunks):
            raise RuntimeError(
                f"Embedder returned {len(embeddings)} vectors for {len(chunks)} chunks"
            )
        await self.vector_store.add(chunks, embeddings)
        summary["indexed"] = len(chunks)
        return summary


async def ingest_pdf(
    path: str | Path,
    doc_id: str | None = None,
    *,
    embedder: Any,
    vector_store: Any,
    chunker: Any | None = None,
) -> dict:
    """Module-level convenience wrapper.

    Kept for parity with the Step 0 stub signature so any earlier
    caller (there are none in the repo — scaffolding only) continues
    to work. Returns an ingestion summary dict, not a list of chunks.
    """
    pipe = IngestPipeline(
        embedder=embedder, vector_store=vector_store, chunker=chunker
    )
    return await pipe.ingest_pdf(path, doc_id=doc_id)


__all__ = ["IngestPipeline", "ingest_pdf", "Chunk"]
