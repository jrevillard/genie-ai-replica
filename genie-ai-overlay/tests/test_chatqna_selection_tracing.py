# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the reranker-selection identity span emitted from align_outputs.

The span emits CONTENT HASHES (rag.candidate_chunk_hashes /
rag.selected_chunk_hashes / rag.selected_scores) — not ``_key`` values, which
langchain mangles during the retriever->chatqna handoff. These hashes are the
single source of truth consumed by the retrieval-quality eval harness
(tests/rag-benchmarks/eval/) to compute recall / precision / complete-recall /
noise.
"""

from unittest.mock import MagicMock, patch

import pytest

import chatqna.genieai_chatqna as chatqna_module


class TestRerankerSelectionSpan:
    """Verify _emit_reranker_selection_span emits the eval identity attributes."""

    @pytest.fixture
    def mock_tracer(self):
        tracer = MagicMock()
        span = MagicMock()
        span.__enter__ = MagicMock(return_value=span)
        span.__exit__ = MagicMock(return_value=False)
        tracer.start_as_current_span.return_value = span
        return tracer, span

    def test_span_name_and_chunk_hashes(self, mock_tracer):
        """Span named chatqna.reranker_selection; hashes computed from chunk TEXT."""
        tracer, span = mock_tracer
        h = chatqna_module._content_hash
        candidates = [
            {"text": "alpha", "score": 0.1},
            {"text": "beta content", "score": 0.9},
            {"text": "gamma", "score": 0.5},
        ]
        selected = [
            {"text": "beta content", "score": 0.9},
            {"text": "gamma", "score": 0.5},
        ]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span(candidates, selected)

        tracer.start_as_current_span.assert_called_once_with("chatqna.reranker_selection")
        span.set_attribute.assert_any_call("rag.candidate_chunk_hashes", [h("alpha"), h("beta content"), h("gamma")])
        span.set_attribute.assert_any_call("rag.selected_chunk_hashes", [h("beta content"), h("gamma")])
        span.set_attribute.assert_any_call("rag.selected_scores", [0.9, 0.5])
        span.set_attribute.assert_any_call("rag.candidate_count", 3)
        span.set_attribute.assert_any_call("rag.selected_count", 2)

    def test_hash_is_text_based_not_id(self, mock_tracer):
        """Identity must come from TEXT (id is unreliable — langchain-mangled)."""
        tracer, span = mock_tracer
        h = chatqna_module._content_hash
        # Same text, different (langchain-mangled) ids -> same hash.
        selected = [{"id": "mangled-uuid-1", "text": "same content", "score": 0.8}]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], selected)

        span.set_attribute.assert_any_call("rag.selected_chunk_hashes", [h("same content")])

    def test_selected_order_is_preserved(self, mock_tracer):
        """Selected hashes order must match input (eval relies on it)."""
        tracer, span = mock_tracer
        h = chatqna_module._content_hash
        selected = [
            {"text": "z last", "score": 0.2},
            {"text": "a first", "score": 0.8},
            {"text": "m mid", "score": 0.5},
        ]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], selected)

        span.set_attribute.assert_any_call("rag.selected_chunk_hashes", [h("z last"), h("a first"), h("m mid")])
        span.set_attribute.assert_any_call("rag.selected_scores", [0.2, 0.8, 0.5])

    def test_scores_are_rounded(self, mock_tracer):
        """Scores rounded to 6dp so traces stay compact + deterministic."""
        tracer, span = mock_tracer
        selected = [{"text": "c1", "score": 0.123456789}, {"text": "c2", "score": 0.5}]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], selected)

        span.set_attribute.assert_any_call("rag.selected_scores", [0.123457, 0.5])

    def test_empty_inputs_do_not_raise(self, mock_tracer):
        """Empty candidate + selected lists emit empty attrs, not raise."""
        tracer, span = mock_tracer

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], [])

        tracer.start_as_current_span.assert_called_once_with("chatqna.reranker_selection")
        span.set_attribute.assert_any_call("rag.candidate_chunk_hashes", [])
        span.set_attribute.assert_any_call("rag.selected_chunk_hashes", [])
        span.set_attribute.assert_any_call("rag.selected_scores", [])
        span.set_attribute.assert_any_call("rag.candidate_count", 0)
        span.set_attribute.assert_any_call("rag.selected_count", 0)
