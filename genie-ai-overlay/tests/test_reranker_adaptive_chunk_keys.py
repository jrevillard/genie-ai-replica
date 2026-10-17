# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for rag.adaptive_chunk_keys — the explicit join for adaptive_breakdown.

`rag.adaptive_breakdown` entries carry `idx` and `original_index` but not the
chunk key, so joining them to `rag.candidate_chunk_keys` required knowing an
undocumented positional rule. This adds a parallel array rather than reshaping
the shipped attribute, because the eval harness already keys on it.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import reranker.genieai_tei_reranker as rtc_module
from core.span_attrs import ATTRIBUTE_NAMES as A
from core.span_attrs import UNRESOLVED, assert_no_free_text
from reranker.genieai_tei_reranker import GenieTEIReranking, _adaptive_chunk_keys


class _Doc:
    def __init__(self, metadata):
        self.metadata = metadata


class TestAdaptiveChunkKeys:
    def test_one_key_per_entry(self):
        docs = [_Doc({"chunk_key": "k0"}), _Doc({"chunk_key": "k1"}), _Doc({"chunk_key": "k2"})]
        breakdown = [{"idx": 0, "original_index": 0}, {"idx": 1, "original_index": 1}, {"idx": 2, "original_index": 2}]
        assert _adaptive_chunk_keys(docs, breakdown) == ["k0", "k1", "k2"]

    def test_key_follows_original_index_not_list_position(self):
        docs = [_Doc({"chunk_key": "k0"}), _Doc({"chunk_key": "k1"})]
        breakdown = [{"idx": 0, "original_index": 1}, {"idx": 1, "original_index": 0}]
        assert _adaptive_chunk_keys(docs, breakdown) == ["k1", "k0"]

    def test_unresolvable_entry_uses_the_reserved_token(self):
        """Not "unknown", not "" -- both read like real values."""
        docs = [_Doc({}), _Doc({"chunk_key": "k1"})]
        breakdown = [{"original_index": 0}, {"original_index": 1}]
        keys = _adaptive_chunk_keys(docs, breakdown)
        assert keys[0] == UNRESOLVED
        assert keys[1] == "k1"

    def test_out_of_range_index_does_not_raise(self):
        docs = [_Doc({"chunk_key": "k0"})]
        assert _adaptive_chunk_keys(docs, [{"original_index": 9}]) == [UNRESOLVED]

    def test_negative_index_does_not_wrap_around(self):
        docs = [_Doc({"chunk_key": "k0"}), _Doc({"chunk_key": "k1"})]
        assert _adaptive_chunk_keys(docs, [{"original_index": -1}]) == [UNRESOLVED]

    def test_missing_original_index_does_not_raise(self):
        docs = [_Doc({"chunk_key": "k0"})]
        assert _adaptive_chunk_keys(docs, [{"idx": 0}]) == [UNRESOLVED]

    def test_a_non_integer_index_does_not_raise(self):
        docs = [_Doc({"chunk_key": "k0"})]
        assert _adaptive_chunk_keys(docs, [{"original_index": "0"}]) == [UNRESOLVED]

    def test_a_non_string_chunk_key_is_unresolved(self):
        """A metadata value that is not a string would be stringified into the
        attribute and read like a real key downstream."""
        docs = [_Doc({"chunk_key": 7}), _Doc({"chunk_key": "k1"})]
        assert _adaptive_chunk_keys(docs, [{"original_index": 0}, {"original_index": 1}]) == [UNRESOLVED, "k1"]

    def test_empty_breakdown(self):
        assert _adaptive_chunk_keys([], []) == []

    def test_none_breakdown(self):
        assert _adaptive_chunk_keys([], None) == []

    def test_privacy(self):
        keys = _adaptive_chunk_keys([_Doc({"chunk_key": "k0"})], [{"original_index": 0}])
        assert_no_free_text({A["rag_adaptive_chunk_keys"]: keys})


# ---------------------------------------------------------------------------
# Wiring — the attribute must reach the span, not just the helper
# ---------------------------------------------------------------------------


class _SearchedDocBase:
    """Stand-in for ``comps.SearchedDoc``, which conftest mocks."""


class _Request(_SearchedDocBase):
    """The adaptive path's request, with every field it reads present."""

    def __init__(self, docs, strategy="adaptive"):
        self.retrieved_docs = docs
        self.initial_query = "q"
        self.reranking_strategy = strategy
        self.embedding = [1.0, 0.0]
        self.chunk_embeddings = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]][: len(docs)]

    def model_dump(self, exclude_none=True):
        return {"reranking_strategy": self.reranking_strategy}


class _ChunkDoc:
    def __init__(self, text, chunk_key):
        self.text = text
        self.metadata = {"chunk_key": chunk_key}


class _RerankingResponseData:
    def __init__(self, text, score):
        self.text = text
        self.score = score


class _RerankingResponse:
    """Captures what ``invoke`` decided to return.

    ``comps.RerankingResponse`` and ``RerankingResponseData`` are MagicMocks in
    the mocked protocol module, so the real selection list is invisible unless
    the constructors are replaced.
    """

    def __init__(self, reranked_docs):
        self.reranked_docs = reranked_docs


def _tei_session(scored):
    response = AsyncMock()
    response.json = AsyncMock(return_value=scored)
    response.status = 200
    response.__aenter__ = AsyncMock(return_value=response)
    response.__aexit__ = AsyncMock(return_value=False)
    session = AsyncMock()
    session.post = MagicMock(return_value=response)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


class TestAdaptiveChunkKeysReachTheSpan:
    @pytest.fixture(autouse=True)
    def patch_protocol(self, monkeypatch):
        monkeypatch.setattr(rtc_module, "SearchedDoc", _SearchedDocBase)
        monkeypatch.setattr(rtc_module, "RerankingResponse", _RerankingResponse)
        monkeypatch.setattr(rtc_module, "RerankingResponseData", _RerankingResponseData)
        monkeypatch.setattr(rtc_module, "MIN_VALUE_THRESHOLD", -1e9)

    @pytest.mark.asyncio
    async def test_span_carries_one_key_per_breakdown_entry(self, captured_spans):
        docs = [
            _ChunkDoc("t0", "k0"),
            _ChunkDoc("t1", "k1"),
            _ChunkDoc("t2", "k2"),
        ]
        # TEI returns score-sorted, so ranked order differs from input order:
        # a join by list position would read these keys off in the wrong order.
        scored = [{"index": 2, "score": 0.9}, {"index": 0, "score": 0.5}, {"index": 1, "score": 0.1}]

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=_tei_session(scored)):
            reranker = GenieTEIReranking.__new__(GenieTEIReranking)
            reranker.base_url = "http://tei-reranker:80"
            result = await reranker.invoke(_Request(docs))

        (span,) = captured_spans("reranker.tei_invoke")
        keys = list(span.attributes[A["rag_adaptive_chunk_keys"]])
        breakdown = json.loads(span.attributes["rag.adaptive_breakdown"])

        assert len(keys) == len(breakdown)
        assert keys == [docs[rec["original_index"]].metadata["chunk_key"] for rec in breakdown]
        # Rank order is the TEI order, NOT the retrieved_docs order.
        assert keys == ["k2", "k0", "k1"]

        # The keys join to the emitted selection: each returned document's text
        # belongs to the doc whose key the breakdown recorded at that position.
        selected_positions = [i for i, rec in enumerate(breakdown) if rec["selected"]]
        assert selected_positions, "fixture must select at least one chunk for this to test anything"
        text_to_key = {doc.text: doc.metadata["chunk_key"] for doc in docs}
        assert [text_to_key[d.text] for d in result.reranked_docs] == [keys[i] for i in selected_positions]
