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


import json


class TestSilenceUvicornAccessLog:
    """Tests for tracing.silence_uvicorn_access_log()."""

    def test_empties_uvicorn_access_handlers(self):
        """After call, uvicorn.access logger has no handlers (uvicorn silenced)."""
        try:
            import uvicorn.config
        except ImportError:
            pytest.skip("uvicorn not installed")
        # Restore baseline if a prior test patched it
        uvicorn.config.LOGGING_CONFIG.setdefault("loggers", {}).setdefault("uvicorn.access", {"handlers": ["access"]})
        assert "access" in uvicorn.config.LOGGING_CONFIG["loggers"]["uvicorn.access"].get("handlers", [])

        tracing.silence_uvicorn_access_log()

        assert uvicorn.config.LOGGING_CONFIG["loggers"]["uvicorn.access"]["handlers"] == []

    def test_idempotent(self):
        """Calling twice doesn't break (no exception)."""
        tracing.silence_uvicorn_access_log()
        tracing.silence_uvicorn_access_log()  # no raise


class TestAccessLogASGIMiddleware:
    """Tests for tracing.AccessLogASGIMiddleware."""

    @pytest.mark.asyncio
    async def test_emits_json_with_method_path_status_duration(self):
        """Middleware logs JSON envelope with method, path, status, duration."""
        import json as _json

        from starlette.types import Message, Receive, Scope, Send

        captured: list[str] = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message: Message):
            if message["type"] == "http.response.start":
                captured.append(f"start:{message['status']}")
            elif message["type"] == "http.response.body":
                captured.append("body")

        async def inner_app(scope: Scope, receive: Receive, send: Send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        # Capture log output by replacing the logger handler
        logger = logging.getLogger("uvicorn.access")
        logger.setLevel(logging.DEBUG)  # ensure INFO-level records are not filtered
        # Ensure JsonLogFormatter is on at least one handler (setup_json_logging may not have run)
        if not any(isinstance(h.formatter, tracing.JsonLogFormatter) for h in logger.handlers if h.formatter):
            logger.addHandler(logging.StreamHandler())
            logger.handlers[-1].setFormatter(tracing.JsonLogFormatter())

        records = []

        class CaptureHandler(logging.Handler):
            def emit(self, record):
                records.append(self.format(record))

        cap = CaptureHandler()
        cap.setFormatter(tracing.JsonLogFormatter())
        logger.addHandler(cap)

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/health",
            "headers": [],
            "query_string": b"",
            "server": ("test", 80),
            "client": ("127.0.0.1", 12345),
            "scheme": "http",
        }

        middleware = tracing.AccessLogASGIMiddleware(inner_app)
        await middleware(scope, receive, send)

        assert len(records) == 1, f"expected 1 log record, got {len(records)}: {records}"
        parsed = _json.loads(records[0])
        assert parsed["method"] == "GET"
        assert parsed["path"] == "/health"
        assert parsed["status_code"] == 200
        assert "duration_ms" in parsed
        assert isinstance(parsed["duration_ms"], (int, float))
        assert parsed["duration_ms"] >= 0
        # JsonLogFormatter fields
        assert "timestamp" in parsed
        assert "level" in parsed
        assert parsed["level"] == "INFO"
        assert parsed["logger"] == "uvicorn.access"
        assert "message" in parsed  # human-readable summary


class TestInstallUvicornAccessLogMiddleware:
    """Tests for tracing.install_uvicorn_access_log_middleware()."""

    def test_patches_comps_httpservice_app_property(self):
        """After install, HTTPService.app property returns wrapped app."""
        try:
            from comps.cores.mega.http_service import HTTPService
        except ImportError:
            pytest.skip("comps not installed")

        original_descriptor = HTTPService.__class__.app if hasattr(HTTPService.__class__, "app") else None

        tracing.install_uvicorn_access_log_middleware()

        # Property descriptor is now wrapped (different from original)
        new_descriptor = HTTPService.__class__.app
        assert new_descriptor is not original_descriptor

    def test_idempotent(self):
        """Calling twice doesn't re-wrap (sentinel guard)."""
        try:
            from comps.cores.mega.http_service import HTTPService
        except ImportError:
            pytest.skip("comps not installed")

        _ = HTTPService.__class__.app
        tracing.install_uvicorn_access_log_middleware()
        second = HTTPService.__class__.app
        tracing.install_uvicorn_access_log_middleware()  # no change
        third = HTTPService.__class__.app
        assert second is third


class TestSetupJsonLogging:
    """Tests for tracing.setup_json_logging()."""

    def test_replaces_handlers_with_json_formatter(self):
        """setup_json_logging() installs a JSON Formatter on every handler."""
        logger = logging.getLogger("test-json-logger")
        logger.handlers.clear()
        logger.setLevel(logging.DEBUG)
        # Add a baseline StreamHandler
        logger.addHandler(logging.StreamHandler())

        tracing.setup_json_logging("test-json-logger")

        assert len(logger.handlers) >= 1
        for handler in logger.handlers:
            assert handler.formatter is not None
            # JSON formatter output must be parseable JSON
            record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)
            output = handler.formatter.format(record)
            json.loads(output)  # raises if not valid JSON

    def test_json_output_includes_trace_context(self):
        """JSON output includes trace_id, span_id, service when filter present."""
        from opentelemetry import trace

        mock_span = MagicMock()
        mock_span.is_recording.return_value = True
        ctx = MagicMock()
        ctx.trace_id = 0xABCDEF1234567890ABCDEF1234567890
        ctx.span_id = 0x1234567890ABCDEF
        ctx.trace_flags = 1
        mock_span.get_span_context.return_value = ctx

        logger = logging.getLogger("test-json-trace")
        logger.handlers.clear()
        logger.setLevel(logging.DEBUG)
        logger.addFilter(tracing.TraceContextFilter(service_name="test-svc"))
        logger.addHandler(logging.StreamHandler())

        tracing.setup_json_logging("test-json-trace")

        captured = []
        logger.handlers[0].emit = lambda r: captured.append(r)

        with patch.object(trace, "get_current_span", return_value=mock_span):
            logger.info("hello")

        formatted = logger.handlers[0].formatter.format(captured[0])
        parsed = json.loads(formatted)
        assert parsed["trace_id"] == format(0xABCDEF1234567890ABCDEF1234567890, "032x")
        assert parsed["span_id"] == format(0x1234567890ABCDEF, "016x")
        assert parsed["service"] == "test-svc"
        assert parsed["message"] == "hello"
        assert parsed["level"] == "INFO"

    def test_setup_json_logging_replaces_uvicorn_access_formatter(self):
        """setup_json_logging() replaces the formatter on uvicorn.access handlers."""
        logger = logging.getLogger("uvicorn.access")
        # uvicorn.access may have no handlers yet (uvicorn not running in test env)
        # Add a baseline StreamHandler so we can test formatter replacement
        test_handler = logging.StreamHandler()
        logger.addHandler(test_handler)

        tracing.setup_json_logging("uvicorn.access")

        # The handler must now have a JSON formatter
        assert test_handler.formatter is not None, "Formatter should be set on uvicorn.access handler"
        record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)
        output = test_handler.formatter.format(record)
        json.loads(output)  # raises if not valid JSON


class TestInstallUvicornAccessLogging:
    """Tests for tracing.install_uvicorn_access_logging()."""

    def test_is_callable(self):
        """install_uvicorn_access_logging must be a callable."""
        assert callable(tracing.install_uvicorn_access_logging)

    def test_calls_all_four_setup_functions(self):
        """Should invoke setup_trace_logging, silence, setup_json_logging, install."""
        with (
            patch.object(tracing, "setup_trace_logging") as mock_setup_trace,
            patch.object(tracing, "silence_uvicorn_access_log") as mock_silence,
            patch.object(tracing, "setup_json_logging") as mock_setup_json,
            patch.object(tracing, "install_uvicorn_access_log_middleware") as mock_install_mw,
        ):
            tracing.install_uvicorn_access_logging()
            mock_setup_trace.assert_called_once_with("uvicorn.access")
            mock_silence.assert_called_once_with()
            mock_setup_json.assert_called_once_with("uvicorn.access")
            mock_install_mw.assert_called_once_with()
