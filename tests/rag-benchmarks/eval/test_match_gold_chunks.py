"""Unit tests for match_gold_chunks.py.

Covers the two el-salvador fixes:
  - default chunk-text field is `chunk_text`, not `text`
  - verbatim-substring fallback uses a sliding window for chunker-split previews
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from match_gold_chunks import find_matches, parse_args  # noqa: E402


def _chunk(key: str, text: str) -> dict:
    return {"key": key, "text": text}


class TestFindMatchesWholePreview:
    """The whole preview is a substring of one chunk: single match."""

    def test_exact_verbatim_match(self):
        chunks = [_chunk("a", "The quick brown fox jumps over the lazy dog.")]
        matches = find_matches("quick brown fox", chunks)
        assert [m["key"] for m in matches] == ["a"]

    def test_normalizes_case_and_whitespace(self):
        chunks = [_chunk("a", "The QUICK   brown fox")]
        matches = find_matches("quick brown FOX", chunks)
        assert [m["key"] for m in matches] == ["a"]


class TestFindMatchesWindowFallback:
    """Preview is split across chunks: BOTH halves match via window fallback."""

    def test_split_preview_across_two_chunks(self):
        # Preview is 100 chars; chunk A has first 60, chunk B has last 60.
        preview = (
            "Rubber strips can seal lids. Silicone fills grooves. "
            "Check for leaks with water and listen for hissing after three minutes."
        )
        chunks = [
            _chunk("a", preview[:60] + " extra padding that makes this chunk longer"),
            _chunk("b", "totally unrelated content " + preview[40:]),
        ]
        matches = find_matches(preview, chunks)
        keys = sorted(m["key"] for m in matches)
        assert keys == ["a", "b"]

    def test_short_preview_uses_strict_whole_match(self):
        # A short preview only matches if a chunk contains the whole preview.
        chunks = [
            _chunk("a", "Some unrelated content"),
            _chunk("b", "This chunk contains the slug exactly"),
        ]
        matches = find_matches("contains the slug exactly", chunks)
        assert [m["key"] for m in matches] == ["b"]

    def test_no_match_returns_empty(self):
        chunks = [_chunk("a", "Apple banana cherry")]
        assert find_matches("zebra yak", chunks) == []


class TestParseArgsChunkTextField:
    """The default --chunk-text-field is `chunk_text`, matching the el-salvador schema."""

    def test_default_is_chunk_text(self, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["match_gold_chunks.py", "--gold-dataset", "x.json"])
        args = parse_args()
        assert args.chunk_text_field == "chunk_text"

    def test_override_takes_effect(self, monkeypatch):
        monkeypatch.setattr(
            sys,
            "argv",
            ["match_gold_chunks.py", "--gold-dataset", "x.json", "--chunk-text-field", "text"],
        )
        args = parse_args()
        assert args.chunk_text_field == "text"


class TestPassageRecall:
    """Passage-level recall: a passage counts only when ALL its chunks are retrieved."""

    def test_single_chunk_passage_retrieved(self):
        from run_eval import _passage_recall

        chunks = [{"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"}]
        recall, n, retrieved = _passage_recall(chunks, ["h1"])
        assert (recall, n, retrieved) == (1.0, 1, 1)

    def test_single_chunk_passage_missing(self):
        from run_eval import _passage_recall

        chunks = [{"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"}]
        recall, n, retrieved = _passage_recall(chunks, [])
        assert (recall, n, retrieved) == (0.0, 1, 0)

    def test_split_passage_fully_retrieved(self):
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"},
            {"chunk_key": "k2", "content_hash": "h2", "passage_id": "q1-p0"},
        ]
        recall, n, retrieved = _passage_recall(chunks, ["h1", "h2"])
        assert (recall, n, retrieved) == (1.0, 1, 1)

    def test_split_passage_partially_retrieved(self):
        """Half of a split passage is NOT a passage-level hit — recall = 0 for that passage."""
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"},
            {"chunk_key": "k2", "content_hash": "h2", "passage_id": "q1-p0"},
        ]
        recall, n, retrieved = _passage_recall(chunks, ["h1"])
        assert (recall, n, retrieved) == (0.0, 1, 0)

    def test_pre_refactor_gold_treats_each_chunk_as_own_passage(self):
        """Older gold sets lack passage_id — each chunk becomes its own singleton passage."""
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1"},  # no passage_id
            {"chunk_key": "k2", "content_hash": "h2"},
        ]
        recall, n, retrieved = _passage_recall(chunks, ["h1", "h2"])
        # 2 singleton passages, both retrieved → recall 1.0
        assert (recall, n, retrieved) == (1.0, 2, 2)

    def test_mixed_passage_and_singleton(self):
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"},
            {"chunk_key": "k2", "content_hash": "h2", "passage_id": "q1-p0"},
            {"chunk_key": "k3", "content_hash": "h3"},  # singleton
        ]
        # Passage q1-p0 needs h1+h2 (missing h2); singleton h3 needs h3 (present).
        # 1 of 2 passages retrieved → recall 0.5
        recall, n, retrieved = _passage_recall(chunks, ["h1", "h3"])
        assert (recall, n, retrieved) == (0.5, 2, 1)
