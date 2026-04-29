"""PyMuPDF-backed PDF loader.

Extracts per-page text and flags pages as native vs scanned. "Scanned"
means: little or no extractable text AND at least one embedded image —
typical of an OCR'd scan where the PDF is a rasterized image.

OCR itself is NOT performed here. Scanned pages are surfaced upstream
(the ingest orchestrator logs them) and skipped in Step 4. Real OCR
(Tesseract / PaddleOCR / Google Document AI) is Step 4.5+.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from translation_v2 import flags

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PageText:
    page_num: int  # 0-indexed
    text: str
    has_images: bool
    is_scanned: bool


def load_pdf(
    path: str | Path,
    *,
    scanned_text_threshold: int | None = None,
) -> list[PageText]:
    """Load a PDF and return per-page text + scanned-detection flags.

    Parameters
    ----------
    path
        Filesystem path to a PDF file.
    scanned_text_threshold
        Below this many stripped characters *and* with at least one
        embedded image, a page is flagged scanned. Defaults to
        ``flags.V2_RAG_SCANNED_TEXT_THRESHOLD``.
    """
    import pymupdf  # local import; heavy native dep

    threshold = (
        scanned_text_threshold
        if scanned_text_threshold is not None
        else flags.V2_RAG_SCANNED_TEXT_THRESHOLD
    )
    path = Path(path)
    doc = pymupdf.open(path)
    try:
        pages: list[PageText] = []
        for i, page in enumerate(doc):
            text = page.get_text("text") or ""
            stripped = text.strip()
            images = page.get_images()
            has_images = bool(images)
            is_scanned = len(stripped) < threshold and has_images
            pages.append(
                PageText(
                    page_num=i,
                    text=text,
                    has_images=has_images,
                    is_scanned=is_scanned,
                )
            )
        return pages
    finally:
        doc.close()
