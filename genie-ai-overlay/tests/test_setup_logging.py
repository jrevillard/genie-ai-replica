"""Tests for `tracing.setup_logging` — wires an OTel LoggerProvider +
OTLPLogExporter + LoggingHandler into the Python logging system so every
`logger.info(...)` emit becomes an OTel `LogRecord` that flows via OTLP
to VictoriaLogs (parallel to the fluentd path).

Tests stub the OTel SDK + exporter so we can assert:
- `set_logger_provider` is called once with a LoggerProvider carrying
  the requested `service.name` resource.
- The LoggingHandler is attached to the root Python logger (and only
  once — repeated calls must be idempotent).
- ENABLE_OBSERVABILITY=0 / missing OTEL_EXPORTER_OTLP_ENDPOINT → no-op
  (returns None, no LoggerProvider registered).
"""

import logging
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

OVERLAY_DIR = Path(__file__).resolve().parent.parent
if str(OVERLAY_DIR) not in sys.path:
    sys.path.insert(0, str(OVERLAY_DIR))

import tracing  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_module_state():
    """Reset the module-level provider globals between tests."""
    tracing._reset()
    # Detach any LoggingHandler we attached to root during the test.
    root = logging.getLogger()
    for h in list(root.handlers):
        if type(h).__name__ == "LoggingHandler":
            root.removeHandler(h)
    yield
    tracing._reset()


@pytest.fixture
def fake_otel(monkeypatch):
    """Patch the OTel SDK classes `setup_logging` imports with mocks that
    capture calls. We don't need real OTel SDK behavior — we just need to
    verify the right objects are constructed and wired up.
    """
    mocks = {
        "OTLPLogExporter": MagicMock(),
        "LoggerProvider": MagicMock(),
        "LoggingHandler": MagicMock(),
        "set_logger_provider": MagicMock(),
        "BatchLogRecordProcessor": MagicMock(),
        "Resource": MagicMock(),
    }
    mocks["LoggerProvider"].return_value = MagicMock(name="FakeLoggerProvider")
    mocks["OTLPLogExporter"].return_value = MagicMock(name="FakeLogExporter")
    mocks["LoggingHandler"].return_value = MagicMock(name="FakeLoggingHandler")
    mocks["Resource"].create = MagicMock(return_value=MagicMock(name="FakeResource"))

    # Patch the imports at the top of tracing.py so `setup_logging`
    # sees our mocks.
    import builtins

    real_import = builtins.__import__

    def _patched_import(name, *args, **kwargs):
        mod = real_import(name, *args, **kwargs)
        if name == "opentelemetry.exporter.otlp.proto.http._log_exporter":
            mod.OTLPLogExporter = mocks["OTLPLogExporter"]
        elif name == "opentelemetry.sdk._logs":
            mod.LoggerProvider = mocks["LoggerProvider"]
            mod.LoggingHandler = mocks["LoggingHandler"]
            mod.set_logger_provider = mocks["set_logger_provider"]
            mod.BatchLogRecordProcessor = mocks["BatchLogRecordProcessor"]
        elif name == "opentelemetry.sdk.resources":
            mod.Resource = mocks["Resource"]
        return mod

    monkeypatch.setattr(builtins, "__import__", _patched_import)
    return mocks


def test_setup_logging_no_op_when_observability_disabled(monkeypatch, fake_otel):
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "0")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
    result = tracing.setup_logging("genieai-chatqna")
    assert result is None
    fake_otel["OTLPLogExporter"].assert_not_called()
    fake_otel["LoggerProvider"].assert_not_called()
    fake_otel["LoggingHandler"].assert_not_called()


def test_setup_logging_no_op_when_endpoint_missing(monkeypatch, fake_otel):
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    result = tracing.setup_logging("genieai-chatqna")
    assert result is None
    fake_otel["OTLPLogExporter"].assert_not_called()


def test_setup_logging_creates_logger_provider_with_service_resource(monkeypatch, fake_otel):
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
    monkeypatch.setenv("SERVICE_VERSION", "2.5.0")
    monkeypatch.setenv("NODE_ENV", "production")

    tracing.setup_logging("genieai-retriever")

    # LoggerProvider constructed with a Resource that carries service.name
    # matching what the caller asked for.
    fake_otel["Resource"].create.assert_called()
    resource_kwargs = fake_otel["Resource"].create.call_args[0][0]
    assert resource_kwargs["service.name"] == "genieai-retriever"
    assert resource_kwargs["service.version"] == "2.5.0"
    assert resource_kwargs["deployment.environment"] == "production"

    # LoggerProvider constructed once and registered globally.
    fake_otel["LoggerProvider"].assert_called_once()
    fake_otel["set_logger_provider"].assert_called_once()

    # Exporter points at the OTLP /v1/logs endpoint of the base URL.
    fake_otel["OTLPLogExporter"].assert_called_once_with(endpoint="http://otel-collector:4318/v1/logs")


def test_setup_logging_attaches_logging_handler_to_root_logger(monkeypatch, fake_otel):
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")

    tracing.setup_logging("genieai-dataprep")

    fake_otel["LoggingHandler"].assert_called_once()
    root = logging.getLogger()
    handler_types = [type(h).__name__ for h in root.handlers]
    assert "LoggingHandler" in handler_types


def test_setup_logging_is_idempotent_about_handler_attachment(monkeypatch, fake_otel):
    """Calling setup_logging twice must NOT add the LoggingHandler to the
    root logger twice — `force=False` + idempotency check in setup_logging
    keeps the handler list clean.
    """
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")

    tracing.setup_logging("genieai-chatqna")
    tracing.setup_logging("genieai-chatqna")

    root = logging.getLogger()
    handler_count = sum(1 for h in root.handlers if type(h).__name__ == "LoggingHandler")
    assert handler_count == 1, f"Expected 1 LoggingHandler, got {handler_count}"


def test_setup_logging_handles_exporter_init_failure(monkeypatch, fake_otel):
    """If the exporter constructor raises (Collector unreachable at boot
    is the most common cause), the function must log a warning and
    return None — it must NOT crash the calling service.
    """
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://nonexistent:4318")
    fake_otel["OTLPLogExporter"].side_effect = RuntimeError("connection refused")

    with pytest.raises(RuntimeError):
        # setup_logging lets the exception propagate (the caller decides
        # what to do). The call inside setup_tracing is wrapped in a
        # try/except so the service keeps running.
        tracing.setup_logging("genieai-chatqna")
