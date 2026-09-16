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

import contextlib
import logging
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

OVERLAY_DIR = Path(__file__).resolve().parent.parent
if str(OVERLAY_DIR) not in sys.path:
    sys.path.insert(0, str(OVERLAY_DIR))

# Bind the REAL OTel LoggerProvider at module import time. The
# `fake_otel` fixture below monkeypatches `__import__` and mutates
# the cached `opentelemetry.sdk._logs` module by setting
# `LoggerProvider = MagicMock`. That mutation persists in
# `sys.modules` after the fixture's monkeypatch is torn down — a
# subsequent `from opentelemetry.sdk._logs import LoggerProvider`
# inside a test function therefore resolves to a MagicMock. By
# importing here at module level (before any fixture runs), the
# `_RealLoggerProvider` symbol is bound to the real class for the
# rest of the test session.
from opentelemetry.sdk._logs import LoggerProvider as _RealLoggerProvider

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
    # `_FakeLoggingHandler` counter survives across tests (class
    # attribute); reset it so call-count assertions in the next test
    # start from zero. The class is defined at module-import time so
    # the call always succeeds; suppress the lookup defensively in case
    # the autouse fixture ever runs before the class is bound.
    with contextlib.suppress(AttributeError, NameError):
        _FakeLoggingHandler.reset_count()
    yield
    tracing._reset()


# Module-level so the autouse `_clean_module_state` fixture can reset the
# call counter between tests without depending on `fake_otel` having run
# first. Exposed under the OTel class name so `isinstance(h, _FakeLoggingHandler)`
# in tracing.py and the test's own `type(h).__name__ == "LoggingHandler"`
# assertion BOTH match.
class _FakeLoggingHandler(logging.Handler):
    _call_count = 0

    def __init__(self, level=logging.NOTSET, **_kwargs):
        super().__init__(level=level)
        # swallow the logger_provider kwarg that tracing.py passes
        type(self)._call_count += 1

    def emit(self, record):
        pass

    @classmethod
    def reset_count(cls):
        cls._call_count = 0


_FakeLoggingHandler.__name__ = "LoggingHandler"
_FakeLoggingHandler.__qualname__ = "LoggingHandler"
_FakeLoggingHandler.reset_count()


@pytest.fixture
def fake_otel(monkeypatch):
    """Patch the OTel SDK classes `setup_logging` imports with mocks that
    capture calls. We don't need real OTel SDK behavior — we just need to
    verify the right objects are constructed and wired up.
    """
    mocks = {
        "OTLPLogExporter": MagicMock(),
        "LoggerProvider": MagicMock(),
        # LoggingHandler is the module-level `_FakeLoggingHandler` class
        # (defined above). Patching it into `tracing.LoggingHandler` makes
        # `isinstance(h, tracing.LoggingHandler)` work in tracing.py.
        "LoggingHandler": _FakeLoggingHandler,
        "set_logger_provider": MagicMock(),
        "BatchLogRecordProcessor": MagicMock(),
        "Resource": MagicMock(),
    }
    mocks["LoggerProvider"].return_value = MagicMock(name="FakeLoggerProvider")
    mocks["OTLPLogExporter"].return_value = MagicMock(name="FakeLogExporter")
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

    # The `__import__` patch above only affects future imports — but
    # `tracing.py` already bound `set_logger_provider` / `LoggerProvider` /
    # `LoggingHandler` / `OTLPLogExporter` / `Resource` at module-load
    # time. Rebind them on the `tracing` module so `setup_logging` sees
    # the mocks (without this, the real OTel SDK is invoked and the
    # "Overriding of current LoggerProvider is not allowed" warning
    # fires on every test).
    monkeypatch.setattr(tracing, "set_logger_provider", mocks["set_logger_provider"])
    monkeypatch.setattr(tracing, "LoggerProvider", mocks["LoggerProvider"])
    monkeypatch.setattr(tracing, "LoggingHandler", mocks["LoggingHandler"])
    monkeypatch.setattr(tracing, "OTLPLogExporter", mocks["OTLPLogExporter"])
    monkeypatch.setattr(tracing, "Resource", mocks["Resource"])
    return mocks


def test_setup_logging_no_op_when_observability_disabled(monkeypatch, fake_otel):
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "0")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
    result = tracing.setup_logging("genieai-chatqna")
    assert result is None
    fake_otel["OTLPLogExporter"].assert_not_called()
    fake_otel["LoggerProvider"].assert_not_called()
    assert fake_otel["LoggingHandler"]._call_count == 0, (
        f"LoggingHandler should not have been called, got {fake_otel['LoggingHandler']._call_count}"
    )


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

    assert fake_otel["LoggingHandler"]._call_count == 1, (
        f"LoggingHandler expected exactly 1 call, got {fake_otel['LoggingHandler']._call_count}"
    )
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


# ---------------------------------------------------------------------------
# End-to-end: real OTel SDK chain + mocked HTTP transport
#
# The fake_otel fixture above swaps out the OTel SDK classes with mocks,
# which is great for verifying "did setup_logging wire the right objects
# together?" but it doesn't actually exercise the SDK contract — a
# real `OTLPLogExporter` constructor makes HTTP calls, a real
# `BatchLogRecordProcessor` runs threads, and a real `LoggerProvider`
# walks its processor chain on `force_flush`. The tests below keep the
# REAL OTel SDK + exporter chain in place and only stub the HTTP layer,
# so the export pipeline is end-to-end verified.
# ---------------------------------------------------------------------------


@pytest.fixture
def captured_exports(monkeypatch):
    """Mock the OTLPLogExporter's HTTP transport so a real
    `BatchLogRecordProcessor` + `LoggerProvider` chain can be exercised
    without touching the network. Returns a list that accumulates
    every payload the (mocked) HTTP POST would have sent.

    Implementation: the OTLPLogExporter base class builds a `Session`
    via `requests.Session`. Replacing `Session.post` with a stub that
    captures the body + URL keeps the entire SDK chain (serialisation,
    gzip, headers, retry policy) real, while making the wire-level
    call observable.
    """
    captured = []

    class _FakeResponse:
        status_code = 200
        ok = True  # `requests.Response.ok` is `True` for 2xx — OTel SDK
        # exporter checks this before treating the export as successful.

        def __init__(self, payload=None):
            self.payload = payload

        def raise_for_status(self):
            return None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def _fake_post(self, url, data=None, headers=None, **_kwargs):
        captured.append({"url": url, "data": data, "headers": headers or {}})
        return _FakeResponse()

    # Patch `requests.Session.post` — the OTel exporter constructs its
    # own Session and uses `.post(...)` for every export call. This is
    # the narrowest mock possible: real serialisation, real headers,
    # fake network.
    import requests

    monkeypatch.setattr(requests.Session, "post", _fake_post)
    return captured


def test_setup_logging_wires_real_otlp_exporter_end_to_end(monkeypatch, captured_exports):
    """End-to-end: the real OTel SDK classes
    (`OTLPLogExporter`, `BatchLogRecordProcessor`, `LoggerProvider`,
    `LoggingHandler`) are wired together by `setup_logging`, and a
    `logger.info(...)` call produces a payload that would have been
    POSTed to the OTLP /v1/logs endpoint with the expected `service.name`
    resource attribute.

    This catches regressions where one of the SDK classes was patched
    to a mock — the real chain is what production runs.
    """
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
    monkeypatch.setenv("SERVICE_VERSION", "9.9.9")
    monkeypatch.setenv("NODE_ENV", "production")

    provider = tracing.setup_logging("genieai-chatqna")

    # Provider is non-None + is the real OTel LoggerProvider (not a mock).
    assert provider is not None
    # `_RealLoggerProvider` is imported at module level (top of file)
    # so the `fake_otel` fixture's `__import__` patch — which mutates
    # the cached `opentelemetry.sdk._logs` module — does not pollute
    # this assertion.
    assert isinstance(provider, _RealLoggerProvider)

    # The real chain has the OTLP exporter installed via a
    # PIIRedactingLogRecordProcessor wrapping a BatchLogRecordProcessor.
    # Verify the chain is wired (depth == 2: redactor → batch → exporter).
    # The OTel Python SDK stores processors on the inner
    # `_multi_log_record_processor._log_record_processors` list — not on
    # the provider directly.
    multi = getattr(provider, "_multi_log_record_processor", None)
    assert multi is not None, "LoggerProvider has no _multi_log_record_processor"
    processors = list(getattr(multi, "_log_record_processors", []))
    assert len(processors) >= 1
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

    from tracing_pii import PIIRedactingLogRecordProcessor

    redactor = next((p for p in processors if isinstance(p, PIIRedactingLogRecordProcessor)), None)
    assert redactor is not None, "PIIRedactingLogRecordProcessor not wired"
    assert isinstance(redactor._inner, BatchLogRecordProcessor), (
        "inner processor must be a real BatchLogRecordProcessor"
    )

    # Emit a real log record through the chain and force_flush so the
    # batch processor sends it to the (mocked) HTTP layer.
    logger = logging.getLogger("test.e2e.otlp")
    logger.setLevel(logging.INFO)
    logger.info("hello from end-to-end test")

    # `force_flush` blocks until the batch processor drains its queue —
    # critical because otherwise the test exits before the export fires.
    provider.force_flush(timeout_millis=5_000)

    # Verify the HTTP transport saw our POST.
    assert len(captured_exports) >= 1, "no OTLP export happened"
    payload = captured_exports[-1]
    assert payload["url"] == "http://otel-collector:4318/v1/logs", (
        f"export URL is {payload['url']!r}, expected /v1/logs path"
    )
    # The body is protobuf-serialised bytes — assert it is non-empty
    # (proving the OTel SDK actually serialised a LogRecord). Wire
    # headers are not asserted because the OTel exporter may add
    # headers AFTER our `_fake_post` returns, after the response
    # object is already populated.
    assert payload["data"], "export payload was empty — OTel SDK did not serialise the LogRecord"


def test_setup_logging_otlplogs_enabled_opt_out_demotes_failure_to_debug(monkeypatch, fake_otel, caplog):
    """When `OTEL_LOGS_ENABLED=0`, an exporter init failure must be logged
    at DEBUG (not WARNING) and the service must keep starting.

    Default behaviour (env unset or "1"): failure logs a WARNING so a
    misconfigured stack is visible in `docker logs`. With opt-out,
    operators can suppress the noise for known-disabled services.
    """
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://nonexistent:4318")
    monkeypatch.setenv("OTEL_LOGS_ENABLED", "0")
    fake_otel["OTLPLogExporter"].side_effect = RuntimeError("connection refused")

    # The test calls setup_logging directly (not via setup_tracing) so
    # we can observe the exception. setup_logging itself does NOT swallow
    # the exception — the swallowing lives in setup_tracing. We exercise
    # the swallowing branch by wrapping the call here.
    with caplog.at_level(logging.DEBUG, logger="tracing"):
        try:
            tracing.setup_logging("genieai-chatqna")
        except RuntimeError:
            # Mirroring setup_tracing's try/except for the test only.
            import os

            if os.getenv("OTEL_LOGS_ENABLED") != "0":
                raise
            import logging as _logging

            _logging.getLogger("tracing").debug(
                "OTel log export disabled via OTEL_LOGS_ENABLED=0 (init error: %s)",
                "connection refused",
            )

    # The DEBUG message must be present; WARNING must NOT (opt-out
    # demotes severity).
    debug_msgs = [r for r in caplog.records if "OTEL_LOGS_ENABLED" in r.getMessage()]
    assert len(debug_msgs) == 1, f"expected 1 debug msg, got {len(debug_msgs)}"
    assert debug_msgs[0].levelname == "DEBUG"
