# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the reranker-selection identity span emitted from align_outputs.

These attributes (rag.candidate_chunk_ids / rag.selected_chunk_ids /
rag.selected_scores) are the single source of truth consumed by the
retrieval-quality eval harness (tests/rag-benchmarks/eval/) to compute
recall / precision / complete-recall / noise.
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

    def test_span_name_and_chunk_ids(self, mock_tracer):
        """Span must be named chatqna.reranker_selection and carry both id sets."""
        tracer, span = mock_tracer
        candidates = [
            {"id": "chunk_a", "text": "alpha", "score": 0.1},
            {"id": "chunk_b", "text": "beta", "score": 0.9},
            {"id": "chunk_c", "text": "gamma", "score": 0.5},
        ]
        selected = [
            {"id": "chunk_b", "text": "beta", "score": 0.9},
            {"id": "chunk_c", "text": "gamma", "score": 0.5},
        ]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span(candidates, selected)

        tracer.start_as_current_span.assert_called_once_with("chatqna.reranker_selection")
        span.set_attribute.assert_any_call("rag.candidate_chunk_ids", ["chunk_a", "chunk_b", "chunk_c"])
        span.set_attribute.assert_any_call("rag.selected_chunk_ids", ["chunk_b", "chunk_c"])
        span.set_attribute.assert_any_call("rag.selected_scores", [0.9, 0.5])
        span.set_attribute.assert_any_call("rag.candidate_count", 3)
        span.set_attribute.assert_any_call("rag.selected_count", 2)

    def test_selected_order_is_preserved(self, mock_tracer):
        """Selected chunk_ids order must match the input order (eval relies on it)."""
        tracer, span = mock_tracer
        selected = [
            {"id": "z_last", "score": 0.2},
            {"id": "a_first", "score": 0.8},
            {"id": "m_mid", "score": 0.5},
        ]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], selected)

        span.set_attribute.assert_any_call("rag.selected_chunk_ids", ["z_last", "a_first", "m_mid"])
        span.set_attribute.assert_any_call("rag.selected_scores", [0.2, 0.8, 0.5])

    def test_missing_id_falls_back_to_na(self, mock_tracer):
        """A doc without an 'id' must serialize as 'N/A' (never raise)."""
        tracer, span = mock_tracer
        candidates = [{"text": "no-id"}, {"id": "has-id", "score": 0.4}]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span(candidates, [])

        span.set_attribute.assert_any_call("rag.candidate_chunk_ids", ["N/A", "has-id"])
        span.set_attribute.assert_any_call("rag.candidate_count", 2)
        span.set_attribute.assert_any_call("rag.selected_count", 0)

    def test_scores_are_rounded(self, mock_tracer):
        """Scores must be rounded to 6dp so traces stay compact + deterministic."""
        tracer, span = mock_tracer
        selected = [{"id": "c1", "score": 0.123456789}, {"id": "c2", "score": 0.5}]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], selected)

        span.set_attribute.assert_any_call("rag.selected_scores", [0.123457, 0.5])

    def test_empty_inputs_do_not_raise(self, mock_tracer):
        """Empty candidate + selected lists must emit empty attrs, not raise."""
        tracer, span = mock_tracer

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], [])

        tracer.start_as_current_span.assert_called_once_with("chatqna.reranker_selection")
        span.set_attribute.assert_any_call("rag.candidate_chunk_ids", [])
        span.set_attribute.assert_any_call("rag.selected_chunk_ids", [])
        span.set_attribute.assert_any_call("rag.selected_scores", [])
        span.set_attribute.assert_any_call("rag.candidate_count", 0)
        span.set_attribute.assert_any_call("rag.selected_count", 0)
