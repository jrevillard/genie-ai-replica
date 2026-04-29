"""Pydantic models for the v2 PDF Q&A endpoints."""
from __future__ import annotations

from pydantic import BaseModel, Field


class IngestPathRequest(BaseModel):
    """Ingest a PDF already present on the server filesystem."""

    path: str = Field(..., description="Absolute path to a PDF file on the server")
    doc_id: str | None = None


class IngestResponse(BaseModel):
    doc_id: str
    pages: int
    scanned_pages: int
    chunks: int
    indexed: int


class PDFQueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    target: str = Field("ma", min_length=2, max_length=10)
    k: int = Field(5, ge=1, le=50)
    strategy: str | None = Field(
        None, description="answer_then_translate | cross_lingual_direct"
    )
    doc_id: str | None = None


class Citation(BaseModel):
    doc_id: str
    page: int | None
    score: float
    excerpt: str


class QEResultPayload(BaseModel):
    score: float
    metric: str
    passed: bool
    threshold: float
    notes: str | None = None


class PDFQueryResponse(BaseModel):
    answer: str
    strategy: str
    target: str
    retried: bool
    citations: list[Citation]
    qe: QEResultPayload | None = None
