# Copyright (c) 2025-2026 International Telecommunication Union (ITU)

import logging
from unittest.mock import MagicMock, patch

import pytest

import tracing


@pytest.fixture(autouse=True)
def _reset_tracing():
    """Reset tracing module state before each test."""
    tracing._reset()
    yield
    tracing._reset()


class TestGetTraceContext:
    """Tests for tracing.get_trace_context()."""

    def test_returns_zeroed_ids_when_no_active_span(self):
        """When no span is active, returns zeroed trace_id and span_id."""
        ctx = tracing.get_trace_context()
        assert ctx["trace_id"] == "0" * 32
        assert ctx["span_id"] == "0" * 16

    def test_returns_trace_context_from_active_span(self):
        """When a span is active, returns its trace_id and span_id."""
        from opentelemetry import trace
        from opentelemetry.trace import TraceFlags

        fake_trace_id = 0x4BF92F3577B34DA6A3CE929D0E0E4736
        fake_span_id = 0x00F067AA0BA902B7

        mock_span = MagicMock()
        mock_span.is_recording.return_value = True
        mock_context = MagicMock()
        mock_context.trace_id = fake_trace_id
        mock_context.span_id = fake_span_id
        mock_context.trace_flags = TraceFlags.SAMPLED
        mock_span.get_span_context.return_value = mock_context

        with patch.object(trace, "get_current_span", return_value=mock_span):
            ctx = tracing.get_trace_context()

        assert ctx["trace_id"] == format(fake_trace_id, "032x")
        assert ctx["span_id"] == format(fake_span_id, "016x")

    def test_returns_zeroed_ids_when_span_not_recording(self):
        """When span exists but is not recording, returns zeroed IDs."""
        from opentelemetry import trace

        mock_span = MagicMock()
        mock_span.is_recording.return_value = False

        with patch.object(trace, "get_current_span", return_value=mock_span):
            ctx = tracing.get_trace_context()

        assert ctx["trace_id"] == "0" * 32
        assert ctx["span_id"] == "0" * 16

    def test_trace_id_format_is_32_hex_chars(self):
        """trace_id must always be a 32-char lowercase hex string."""
        ctx = tracing.get_trace_context()
        assert len(ctx["trace_id"]) == 32
        assert all(c in "0123456789abcdef" for c in ctx["trace_id"])

    def test_span_id_format_is_16_hex_chars(self):
        """span_id must always be a 16-char lowercase hex string."""
        ctx = tracing.get_trace_context()
        assert len(ctx["span_id"]) == 16
        assert all(c in "0123456789abcdef" for c in ctx["span_id"])


class TestTraceContextFilter:
    """Tests for tracing.TraceContextFilter."""

    def test_injects_trace_context_into_log_record(self):
        """Filter adds trace_id, span_id, and service to log records."""
        from opentelemetry import trace
        from opentelemetry.trace import TraceFlags

        mock_span = MagicMock()
        mock_span.is_recording.return_value = True
        mock_context = MagicMock()
        mock_context.trace_id = 0xABCDEF1234567890ABCDEF1234567890
        mock_context.span_id = 0x1234567890ABCDEF
        mock_context.trace_flags = TraceFlags.SAMPLED
        mock_span.get_span_context.return_value = mock_context

        filt = tracing.TraceContextFilter(service_name="genieai-test")

        with patch.object(trace, "get_current_span", return_value=mock_span):
            record = logging.LogRecord("test", logging.INFO, "", 0, "test message", (), None)
            result = filt.filter(record)

        assert result is True
        assert record.trace_id == format(0xABCDEF1234567890ABCDEF1234567890, "032x")
        assert record.span_id == format(0x1234567890ABCDEF, "016x")
        assert record.service == "genieai-test"

    def test_injects_zeroed_ids_when_no_span(self):
        """Filter adds zeroed IDs and service name when no span is active."""
        filt = tracing.TraceContextFilter(service_name="genieai-test")
        record = logging.LogRecord("test", logging.INFO, "", 0, "test message", (), None)
        result = filt.filter(record)

        assert result is True
        assert record.trace_id == "0" * 32
        assert record.span_id == "0" * 16
        assert record.service == "genieai-test"

    def test_filter_always_returns_true(self):
        """Filter must always return True (never suppresses log records)."""
        filt = tracing.TraceContextFilter(service_name="genieai-test")
        record = logging.LogRecord("test", logging.DEBUG, "", 0, "msg", (), None)
        assert filt.filter(record) is True

    def test_multiple_records_get_different_contexts(self):
        """Each record gets the trace context at the time of logging."""
        from opentelemetry import trace
        from opentelemetry.trace import TraceFlags

        filt = tracing.TraceContextFilter(service_name="genieai-test")

        # First span
        span1 = MagicMock()
        span1.is_recording.return_value = True
        ctx1 = MagicMock()
        ctx1.trace_id = 0x11111111111111111111111111111111
        ctx1.span_id = 0x1111111111111111
        ctx1.trace_flags = TraceFlags.SAMPLED
        span1.get_span_context.return_value = ctx1

        with patch.object(trace, "get_current_span", return_value=span1):
            record1 = logging.LogRecord("test", logging.INFO, "", 0, "msg1", (), None)
            filt.filter(record1)

        # No span
        with patch.object(trace, "get_current_span", return_value=None):
            record2 = logging.LogRecord("test", logging.INFO, "", 0, "msg2", (), None)
            filt.filter(record2)

        assert record1.trace_id == format(0x11111111111111111111111111111111, "032x")
        assert record1.span_id == format(0x1111111111111111, "016x")
        assert record2.trace_id == "0" * 32
        assert record2.span_id == "0" * 16


class TestSetupTraceLogging:
    """Tests for tracing.setup_trace_logging()."""

    def test_adds_filter_to_named_logger(self):
        """setup_trace_logging() adds TraceContextFilter to the logger."""
        logger = logging.getLogger("test-trace-logger")
        logger.filters.clear()

        tracing.setup_trace_logging("test-trace-logger")

        trace_filters = [f for f in logger.filters if isinstance(f, tracing.TraceContextFilter)]
        assert len(trace_filters) == 1

        # Cleanup
        logger.filters.clear()

    def test_does_not_add_duplicate_filters(self):
        """Calling setup_trace_logging() twice does not add duplicate filters."""
        logger = logging.getLogger("test-dup-logger")
        logger.filters.clear()

        tracing.setup_trace_logging("test-dup-logger")
        tracing.setup_trace_logging("test-dup-logger")

        trace_filters = [f for f in logger.filters if isinstance(f, tracing.TraceContextFilter)]
        assert len(trace_filters) == 1

        # Cleanup
        logger.filters.clear()

    def test_log_record_includes_trace_context(self):
        """Log records from the configured logger include trace_id and span_id."""
        logger = logging.getLogger("test-output-logger")
        logger.filters.clear()
        logger.setLevel(logging.DEBUG)

        handler = logging.StreamHandler()
        handler.setLevel(logging.DEBUG)
        records = []
        handler.emit = lambda record: records.append(record)
        logger.addHandler(handler)

        tracing.setup_trace_logging("test-output-logger")

        logger.info("test message")

        assert len(records) == 1
        assert hasattr(records[0], "trace_id")
        assert hasattr(records[0], "span_id")
        assert hasattr(records[0], "service")
        assert records[0].trace_id == "0" * 32
        assert records[0].span_id == "0" * 16
        assert records[0].service == "test-output-logger"

        # Cleanup
        logger.filters.clear()
        logger.removeHandler(handler)
