"""Tests for the PyMuPDF-based PDF loader.

Fixtures synthesize tiny PDFs at test-time — no binary files committed.
"""
from __future__ import annotations

import pytest

from translation_v2.rag.pdf_loader import PageText, load_pdf


class TestNativePDF:
    def test_loads_single_page(self, make_native_pdf):
        pdf = make_native_pdf("one.pdf", ["Hello from page one."])
        pages = load_pdf(pdf)
        assert len(pages) == 1
        p = pages[0]
        assert isinstance(p, PageText)
        assert "Hello from page one." in p.text
        assert p.page_num == 0
        assert p.is_scanned is False

    def test_multiple_pages_in_order(self, make_native_pdf):
        pdf = make_native_pdf(
            "multi.pdf",
            ["First page content.", "Second page content.", "Third page content."],
        )
        pages = load_pdf(pdf)
        assert [p.page_num for p in pages] == [0, 1, 2]
        assert "First" in pages[0].text
        assert "Second" in pages[1].text
        assert "Third" in pages[2].text

    def test_native_page_not_flagged_scanned(self, make_native_pdf):
        pdf = make_native_pdf(
            "long.pdf",
            ["This is a page with plenty of text so the threshold can't trip."],
        )
        pages = load_pdf(pdf)
        assert all(not p.is_scanned for p in pages)


class TestScannedPDF:
    def test_page_with_image_no_text_is_scanned(self, make_scanned_pdf):
        pdf = make_scanned_pdf()
        pages = load_pdf(pdf)
        assert len(pages) == 1
        assert pages[0].has_images is True
        assert pages[0].is_scanned is True

    def test_scanned_threshold_override(self, make_native_pdf):
        # A page with text but a very low threshold + no images → not scanned
        pdf = make_native_pdf("short.pdf", ["tiny"])
        pages = load_pdf(pdf, scanned_text_threshold=1000)
        # Threshold high enough to declare "short text", but no images
        # → is_scanned must still be False (needs both conditions)
        assert pages[0].is_scanned is False


class TestEmptyDocument:
    def test_page_with_no_content(self, make_native_pdf):
        # Insert an empty string → page exists but has no extractable text
        pdf = make_native_pdf("empty.pdf", [""])
        pages = load_pdf(pdf)
        assert len(pages) == 1
        assert pages[0].text.strip() == ""
        # No image, no text → is_scanned=False (we can't improve an empty doc)
        assert pages[0].is_scanned is False
