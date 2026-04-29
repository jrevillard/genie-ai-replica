"""FastAPI endpoints for the v2 PDF RAG pipeline.

Endpoints (all flag-gated on ``USE_V2_RAG``):
  POST /agent/pdf/ingest   — ingest a server-side PDF path
  POST /agent/pdf-query    — retrieve + answer, with optional QE

The in-memory vector store persists across requests *within the same
process*, but not across worker restarts or multiple uvicorn workers.
Persistent indexing through ArcadeDB is a Step 5.5 / 6 concern.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException

from translation_v2 import flags
from translation_v2.api.bootstrap import (
    get_ingest_pipeline,
    get_pdf_query_pipeline,
    get_vector_store,
    get_hybrid_retriever,
)
from translation_v2.api.rag_schemas import (
    IngestPathRequest,
    IngestResponse,
    PDFQueryRequest,
    PDFQueryResponse,
)
from translation_v2.observability import log_event, timed

logger = logging.getLogger(__name__)

router = APIRouter(tags=["translation_v2_rag"])


def _rag_enabled(header_override: str | None) -> bool:
    if flags.USE_V2_RAG:
        return True
    return (header_override or "").strip().lower() == "v2"


@router.post("/agent/pdf/ingest", response_model=IngestResponse)
async def v2_pdf_ingest(
    req: IngestPathRequest,
    x_translation_pipeline: str | None = Header(
        default=None, alias="X-Translation-Pipeline"
    ),
) -> IngestResponse:
    if not _rag_enabled(x_translation_pipeline):
        raise HTTPException(
            status_code=503,
            detail=(
                "v2 RAG pipeline is not enabled. Set USE_V2_RAG=true or send header "
                "'X-Translation-Pipeline: v2'."
            ),
        )

    pdf_path = Path(req.path)
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"PDF not found: {req.path}")
    if pdf_path.is_dir():
        raise HTTPException(status_code=400, detail="path is a directory, expected a file")

    try:
        ingest = get_ingest_pipeline()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    try:
        with timed("v2_rag_ingest", path=str(pdf_path)):
            summary = await ingest.ingest_pdf(pdf_path, doc_id=req.doc_id)
    except Exception as e:
        log_event("v2_rag_ingest_error", error=str(e), path=str(pdf_path))
        raise HTTPException(status_code=502, detail=f"ingest failed: {e}") from e

    # Rebuild BM25 index over the full corpus so subsequent queries see the new doc
    try:
        retriever = get_hybrid_retriever()
        retriever.index_corpus(get_vector_store().all_chunks())
    except Exception as e:
        log_event("v2_rag_reindex_error", error=str(e))
        # Non-fatal; dense-only search still works.

    return IngestResponse(**summary)


@router.post("/agent/pdf-query", response_model=PDFQueryResponse)
async def v2_pdf_query(
    req: PDFQueryRequest,
    x_translation_pipeline: str | None = Header(
        default=None, alias="X-Translation-Pipeline"
    ),
) -> PDFQueryResponse:
    if not _rag_enabled(x_translation_pipeline):
        raise HTTPException(
            status_code=503,
            detail="v2 RAG pipeline is not enabled.",
        )

    try:
        pipeline = get_pdf_query_pipeline()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    try:
        with timed("v2_rag_query", target=req.target, k=req.k):
            result = await pipeline.answer(
                question=req.question,
                target=req.target,
                k=req.k,
                strategy=req.strategy,
            )
    except Exception as e:
        log_event("v2_rag_query_error", error=str(e), target=req.target)
        raise HTTPException(status_code=502, detail=f"pdf-query failed: {e}") from e

    return PDFQueryResponse(**result)
