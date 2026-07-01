# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the reranker-selection identity span emitted from align_outputs.

The span emits ``chunk_key`` (the ArangoDB ``_key``) lists — recovered in
align_outputs from the retriever's parallel ``data["metadata"]`` (same path as
chunk_embedding; TextDoc has no metadata field). The eval harness at
tests/rag-benchmarks/eval/ matches these against gold_dataset.json chunk_key
values to compute recall / precision / complete-recall / noise.
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

    def test_span_name_and_keys(self, mock_tracer):
        """Span named chatqna.reranker_selection; emits candidate/selected keys."""
        tracer, span = mock_tracer
        cand_keys = ["key_a", "key_b", "key_c"]
        sel_keys = ["key_b", "key_c"]
        sel_scores = [0.9, 0.5]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span(cand_keys, sel_keys, sel_scores)

        tracer.start_as_current_span.assert_called_once_with("chatqna.reranker_selection")
        span.set_attribute.assert_any_call("rag.candidate_chunk_keys", ["key_a", "key_b", "key_c"])
        span.set_attribute.assert_any_call("rag.selected_chunk_keys", ["key_b", "key_c"])
        span.set_attribute.assert_any_call("rag.selected_scores", [0.9, 0.5])
        span.set_attribute.assert_any_call("rag.candidate_count", 3)
        span.set_attribute.assert_any_call("rag.selected_count", 2)

    def test_selected_order_preserved(self, mock_tracer):
        """Selected keys + scores order must match input (eval relies on it)."""
        tracer, span = mock_tracer
        sel_keys = ["z_last", "a_first", "m_mid"]
        sel_scores = [0.2, 0.8, 0.5]

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], sel_keys, sel_scores)

        span.set_attribute.assert_any_call("rag.selected_chunk_keys", ["z_last", "a_first", "m_mid"])
        span.set_attribute.assert_any_call("rag.selected_scores", [0.2, 0.8, 0.5])

    def test_scores_rounded(self, mock_tracer):
        """Scores are passed as-is (rounding happens in align_outputs)."""
        tracer, span = mock_tracer

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], [], [0.123457, 0.5])

        span.set_attribute.assert_any_call("rag.selected_scores", [0.123457, 0.5])

    def test_empty_inputs_do_not_raise(self, mock_tracer):
        """Empty lists emit empty attrs, not raise."""
        tracer, span = mock_tracer

        with patch.object(chatqna_module, "align_tracer", tracer):
            chatqna_module._emit_reranker_selection_span([], [], [])

        tracer.start_as_current_span.assert_called_once_with("chatqna.reranker_selection")
        span.set_attribute.assert_any_call("rag.candidate_chunk_keys", [])
        span.set_attribute.assert_any_call("rag.selected_chunk_keys", [])
        span.set_attribute.assert_any_call("rag.selected_scores", [])
        span.set_attribute.assert_any_call("rag.candidate_count", 0)
        span.set_attribute.assert_any_call("rag.selected_count", 0)
