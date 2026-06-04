# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for chatqna custom application metrics (Task 2).

All tests mock ``opentelemetry.metrics`` so no real OTel SDK is needed.
"""

from unittest.mock import MagicMock, patch

import pytest


# The module under test imports ``from opentelemetry import metrics as otel_metrics``.
# We patch the *source* of that name so every reload picks up the mock.
@pytest.fixture(autouse=True)
def _mock_tracing_meter():
    """Inject a mock tracing.get_meter before any import.

    Preserves the real sanitize_attributes and _PII_KEYS so PII tests
    exercise actual logic instead of MagicMock passthrough.
    """
    import sys

    # Grab real implementations before patching
    from tracing import _PII_KEYS as _real_pii_keys
    from tracing import sanitize_attributes as _real_sanitize

    fake_tracing = MagicMock()
    fake_meter = MagicMock()
    fake_tracing.get_meter.return_value = fake_meter

    # Preserve real implementations for PII tests
    fake_tracing.sanitize_attributes = _real_sanitize
    fake_tracing._PII_KEYS = _real_pii_keys

    with patch.dict(sys.modules, {"tracing": fake_tracing}):
        yield fake_tracing


# ---------------------------------------------------------------------------
# metrics.get_meter
# ---------------------------------------------------------------------------


class TestGetMeter:
    """Tests for the get_meter() wrapper function."""

    def test_get_meter_returns_meter(self, _mock_tracing_meter):
        mock_meter = MagicMock()
        _mock_tracing_meter.get_meter.return_value = mock_meter

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)
        result = chatqna.metrics.get_meter()
        assert result is mock_meter

    def test_get_meter_delegates_to_tracing(self, _mock_tracing_meter):
        """get_meter() must delegate to tracing.get_meter()."""
        _mock_tracing_meter.get_meter.return_value = MagicMock()

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)
        chatqna.metrics.get_meter()

        # Module-level instrument creation also calls get_meter, so at least 2 calls
        assert _mock_tracing_meter.get_meter.call_count >= 2


# ---------------------------------------------------------------------------
# Instrument creation
# ---------------------------------------------------------------------------


class TestInstrumentCreation:
    """Tests that instruments are created with correct configuration."""

    def test_chat_requests_total_counter_created(self, _mock_tracing_meter):
        mock_meter = MagicMock()
        _mock_tracing_meter.get_meter.return_value = mock_meter

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)

        mock_meter.create_counter.assert_called_with(
            "genie.ai/chat/request",
            description="Total chat requests",
        )

    def test_chat_rag_duration_histogram_created(self, _mock_tracing_meter):
        mock_meter = MagicMock()
        _mock_tracing_meter.get_meter.return_value = mock_meter

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)

        mock_meter.create_histogram.assert_called_with(
            "genie.ai/chat/rag/latency",
            description="Chat RAG pipeline duration",
            unit="s",
        )


# ---------------------------------------------------------------------------
# Exported attributes
# ---------------------------------------------------------------------------


class TestExports:
    """Tests that expected symbols are exported."""

    def test_exports_get_meter(self, _mock_tracing_meter):
        _mock_tracing_meter.get_meter.return_value = MagicMock()

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)
        assert hasattr(chatqna.metrics, "get_meter")
        assert callable(chatqna.metrics.get_meter)

    def test_exports_chat_requests_total(self, _mock_tracing_meter):
        mock_counter = MagicMock()
        mock_meter = MagicMock()
        mock_meter.create_counter.return_value = mock_counter
        _mock_tracing_meter.get_meter.return_value = mock_meter

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)
        assert chatqna.metrics.chat_requests_total is mock_counter

    def test_exports_chat_rag_duration(self, _mock_tracing_meter):
        mock_histogram = MagicMock()
        mock_meter = MagicMock()
        mock_meter.create_histogram.return_value = mock_histogram
        _mock_tracing_meter.get_meter.return_value = mock_meter

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)
        assert chatqna.metrics.chat_rag_duration_seconds is mock_histogram


# ---------------------------------------------------------------------------
# PII enforcement — _sanitize_attributes helper
# ---------------------------------------------------------------------------


class TestPIIEnforcement:
    """Tests that PII keys are stripped from metric attributes."""

    def test_sanitize_strips_pii_keys(self, _mock_tracing_meter):
        _mock_tracing_meter.get_meter.return_value = MagicMock()

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)

        attrs = {
            "response_type": "streaming",
            "user_query": "secret question",
            "llm_response": "secret answer",
            "session_id": "abc123",
            "conversation_id": "xyz789",
            "error": "true",
        }
        result = chatqna.metrics.sanitize_attributes(attrs)
        assert result == {"response_type": "streaming", "error": "true"}

    def test_pii_keys_include_expected_fields(self, _mock_tracing_meter):
        _mock_tracing_meter.get_meter.return_value = MagicMock()

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)

        # _PII_KEYS is re-exported from tracing module via chatqna.metrics
        importlib.reload(chatqna.metrics)
        pii = chatqna.metrics._PII_KEYS
        assert "user_query" in pii
        assert "llm_response" in pii
        assert "session_id" in pii
        assert "conversation_id" in pii

    def test_sanitize_returns_new_dict(self, _mock_tracing_meter):
        _mock_tracing_meter.get_meter.return_value = MagicMock()

        import importlib

        import chatqna.metrics

        importlib.reload(chatqna.metrics)

        attrs = {"response_type": "sync"}
        result = chatqna.metrics.sanitize_attributes(attrs)
        assert result is not attrs
