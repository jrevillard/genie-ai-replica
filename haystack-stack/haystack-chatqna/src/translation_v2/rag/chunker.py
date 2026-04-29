"""Layout-aware chunking for v2 RAG.

Character-based sliding window with a soft sentence-boundary
preference: within the last 20% of each target window, prefer to
break at the nearest ``. ``, ``! ``, or ``? ``.

Chunks do NOT span pages. This keeps citations simple and prevents
cross-page context pollution. Each chunk carries page + character-
offset metadata so the caller can reconstruct a precise citation
("page 12, §3.2" style).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Iterator

from translation_v2 import flags
from translation_v2.interfaces import Chunk
from translation_v2.rag.pdf_loader import PageText


# ``(?<=[.!?])\s+(?=[A-Z])`` — split on sentence-ending punct followed by
# whitespace and an uppercase letter. Not perfect (abbreviations, etc.)
# but good enough for the "soft preference" use here — if we don't find
# a boundary, we fall back to the hard character cap.
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


class LayoutAwareChunker:
    def __init__(
        self,
        chunk_size: int | None = None,
        overlap: int | None = None,
        min_chunk_size: int | None = None,
    ) -> None:
        self._size = (
            chunk_size if chunk_size is not None else flags.V2_RAG_CHUNK_SIZE_CHARS
        )
        self._overlap = (
            overlap if overlap is not None else flags.V2_RAG_CHUNK_OVERLAP_CHARS
        )
        self._min = (
            min_chunk_size
            if min_chunk_size is not None
            else flags.V2_RAG_MIN_CHUNK_CHARS
        )
        if self._size <= 0:
            raise ValueError("chunk_size must be > 0")
        if self._overlap < 0 or self._overlap >= self._size:
            raise ValueError("overlap must be 0 <= overlap < chunk_size")

    def chunk_pages(self, pages: Iterable[PageText], doc_id: str) -> list[Chunk]:
        out: list[Chunk] = []
        for page in pages:
            if page.is_scanned:
                # No text layer → nothing to chunk. Upstream logs this.
                continue
            for start, end, text in self._chunk_text(page.text):
                out.append(
                    Chunk(
                        text=text,
                        doc_id=doc_id,
                        page=page.page_num,
                        metadata={
                            "start_char": start,
                            "end_char": end,
                            "is_scanned": False,
                        },
                    )
                )
        return out

    def _chunk_text(self, text: str) -> Iterator[tuple[int, int, str]]:
        if not text or not text.strip():
            return
        n = len(text)
        if n <= self._size:
            stripped = text.strip()
            if len(stripped) >= self._min:
                yield (0, n, stripped)
            return

        start = 0
        while start < n:
            end = min(start + self._size, n)
            # Soft sentence-boundary preference in the last 20% of the window
            if end < n:
                search_start = start + int(self._size * 0.8)
                if search_start < end:
                    window = text[search_start:end]
                    last_match = None
                    for m in _SENTENCE_END.finditer(window):
                        last_match = m
                    if last_match is not None:
                        end = search_start + last_match.start() + 1  # keep the punct
            chunk = text[start:end].strip()
            if len(chunk) >= self._min:
                yield (start, end, chunk)
            if end >= n:
                break
            next_start = end - self._overlap
            # Ensure forward progress even with pathological inputs
            start = max(next_start, start + 1)
