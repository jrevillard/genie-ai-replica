"""Tests for layout-aware chunking."""
from __future__ import annotations

import pytest

from translation_v2.rag.chunker import LayoutAwareChunker
from translation_v2.rag.pdf_loader import PageText


def _page(text: str, num: int = 0, is_scanned: bool = False) -> PageText:
    return PageText(
        page_num=num,
        text=text,
        has_images=False,
        is_scanned=is_scanned,
    )


class TestBasicChunking:
    def test_short_page_becomes_one_chunk(self):
        c = LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5)
        chunks = c.chunk_pages([_page("hello world")], doc_id="d")
        assert len(chunks) == 1
        assert chunks[0].text == "hello world"
        assert chunks[0].doc_id == "d"
        assert chunks[0].page == 0

    def test_long_page_splits(self):
        text = "sentence. " * 300  # ~3000 chars
        c = LayoutAwareChunker(chunk_size=800, overlap=100, min_chunk_size=50)
        chunks = c.chunk_pages([_page(text)], doc_id="d")
        assert len(chunks) > 1

    def test_chunks_have_page_metadata(self):
        c = LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5)
        chunks = c.chunk_pages(
            [_page("on page zero", 0), _page("on page one", 1)], doc_id="d"
        )
        pages = sorted({ch.page for ch in chunks})
        assert pages == [0, 1]

    def test_chunks_do_not_span_pages(self):
        # Two adjacent pages, each short enough to be one chunk — chunks must
        # not contain text from both pages.
        c = LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5)
        chunks = c.chunk_pages(
            [
                _page("Only on page zero content here.", 0),
                _page("Only on page one content here.", 1),
            ],
            doc_id="d",
        )
        for ch in chunks:
            # Each chunk only mentions one of the page markers
            assert not ("zero" in ch.text and "one" in ch.text)


class TestScannedPagesSkipped:
    def test_scanned_pages_produce_no_chunks(self):
        c = LayoutAwareChunker(chunk_size=1000, overlap=100, min_chunk_size=5)
        chunks = c.chunk_pages(
            [
                _page("real text page", 0, is_scanned=False),
                _page("", 1, is_scanned=True),
            ],
            doc_id="d",
        )
        assert all(ch.page == 0 for ch in chunks)


class TestOverlapAndProgress:
    def test_overlap_is_present(self):
        # Consecutive chunks should share some text due to overlap
        text = "abcdefghij " * 400  # ~4400 chars
        c = LayoutAwareChunker(chunk_size=600, overlap=100, min_chunk_size=50)
        chunks = c.chunk_pages([_page(text)], doc_id="d")
        # At least one pair of consecutive chunks shares a suffix/prefix region
        assert len(chunks) >= 2
        shared = 0
        for a, b in zip(chunks, chunks[1:]):
            # Check that the last ~50 chars of a appear at the start of b
            tail = a.text[-50:]
            if tail in b.text[:200]:
                shared += 1
        assert shared >= 1

    def test_terminates_on_pathological_no_progress(self):
        # chunk_size==overlap+1 → next_start advances by 1; must still terminate
        c = LayoutAwareChunker(chunk_size=10, overlap=9, min_chunk_size=1)
        chunks = c.chunk_pages([_page("abcdefghij" * 10)], doc_id="d")
        assert len(chunks) > 0  # must not hang and must produce something

    def test_min_chunk_size_drops_small_tail(self):
        # If the final chunk would be < min_chunk_size it should be dropped.
        c = LayoutAwareChunker(chunk_size=100, overlap=10, min_chunk_size=50)
        text = "A" * 150  # 150 chars; second window is 50-150 → ok
        chunks = c.chunk_pages([_page(text)], doc_id="d")
        for ch in chunks:
            assert len(ch.text) >= 50


class TestSentenceBoundaryPreference:
    def test_prefers_sentence_boundary_when_available(self):
        # Build a text where a sentence boundary falls in the soft-break zone.
        base = "A" * 700 + ". " + "B" * 100
        c = LayoutAwareChunker(chunk_size=800, overlap=100, min_chunk_size=10)
        chunks = c.chunk_pages([_page(base)], doc_id="d")
        # The first chunk should end at the sentence boundary, i.e. with "."
        assert chunks[0].text.endswith(".") or chunks[0].text.endswith(". ")


class TestConfigValidation:
    def test_overlap_must_be_less_than_chunk_size(self):
        with pytest.raises(ValueError):
            LayoutAwareChunker(chunk_size=100, overlap=100)

    def test_chunk_size_positive(self):
        with pytest.raises(ValueError):
            LayoutAwareChunker(chunk_size=0)
