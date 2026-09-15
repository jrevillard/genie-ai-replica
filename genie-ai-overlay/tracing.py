# Copyright (c) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Shared OpenTelemetry tracing initialization for OPEA microservices.

Usage::

    from tracing import setup_tracing, get_tracer

    setup_tracing("genieai-chatqna")
    tracer = get_tracer(__name__)

MUST be imported before the FastAPI app is created and before OPEA ``comps``
imports that might initialize HTTP clients.
"""

import atexit
import contextlib
import logging
import os
import re
import signal
import sys
from contextlib import contextmanager
from urllib.parse import urlparse

from opentelemetry import metrics, trace

# `set_logger_provider` lives in the API package, not the SDK
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode

_provider = None
_meter_provider = None
_logger_provider = None

# Shared PII keys — import from here in all services to avoid duplication
# PII key patterns — case-insensitive regex. Mirrors the Node side
# (`SENSITIVE_KEY_PATTERNS` in `tracing-pii.js`). The set used to be an
# exact-match frozenset; widened to regex to catch the variants our
# services actually emit (`auth_token`, `openai_api_key`, etc.).
_PII_KEY_PATTERNS = [
    re.compile(r"password", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"authorization", re.IGNORECASE),
    re.compile(r"credential", re.IGNORECASE),
    re.compile(r"api[_-]?key", re.IGNORECASE),
    re.compile(r"session[_-]?id", re.IGNORECASE),
    re.compile(r"user[_-]?id", re.IGNORECASE),
    re.compile(r"conversation[_-]?id", re.IGNORECASE),
    re.compile(r"email", re.IGNORECASE),
    re.compile(r"user[_-]?query", re.IGNORECASE),
    re.compile(r"llm[_-]?response", re.IGNORECASE),
    re.compile(r"document[_-]?text", re.IGNORECASE),
    re.compile(r"cookie", re.IGNORECASE),
    re.compile(r"private[_-]?key", re.IGNORECASE),
]

# Backwards-compat exact-match set — kept for callers that already use
# `k not in _PII_KEYS`. Same surface, exact-key.
_PII_KEYS = frozenset(
    {
        "user_query",
        "llm_response",
        "session_id",
        "conversation_id",
        "user_id",
        "email",
        "document_text",
        "password",
        "token",
    }
)


def _is_sensitive_key(key: str) -> bool:
    """True if *key* matches any PII key pattern. Mirrors the Node side."""
    return any(p.search(key) for p in _PII_KEY_PATTERNS)


def sanitize_attributes(attrs: dict) -> dict:
    """Return a copy of *attrs* with PII keys removed.

    Uses regex match against `_PII_KEY_PATTERNS` (case-insensitive) so
    `auth_token`, `openai_api_key`, etc. are caught as well as the exact
    keys in `_PII_KEYS`.
    """
    return {k: v for k, v in attrs.items() if not _is_sensitive_key(k)}


ZEROED_TRACE_ID = "0" * 32
ZEROED_SPAN_ID = "0" * 16


def get_trace_context():
    """Return a dict with trace_id and span_id from the active OTel span.

    Returns zeroed IDs when no span is active or the span is not recording.
    """
    span = trace.get_current_span()
    if span and span.is_recording():
        ctx = span.get_span_context()
        return {
            "trace_id": format(ctx.trace_id, "032x"),
            "span_id": format(ctx.span_id, "016x"),
        }
    return {"trace_id": ZEROED_TRACE_ID, "span_id": ZEROED_SPAN_ID}


class TraceContextFilter(logging.Filter):
    """Python logging Filter that stamps trace_id, span_id, and service on
    every log record. The OTel Python SDK's `LoggingHandler` propagates
    those record attributes into the OTel `LogRecord.trace_id` /
    `LogRecord.span_id` / `LogRecord.resource.attributes['service.name']`
    fields — VictoriaLogs indexes them as first-class stream fields.

    The PREVIOUS implementation prepended `trace_id="..."` /
    `span_id="..."` into `record.msg` itself. That corrupted the message
    body (every `_msg:` filter matched the prefix first instead of the
    real text) and wasted bandwidth on every log emit. The OTel SDK's
    structured fields are the canonical correlation surface — drop the
    body prepend.
    """

    def __init__(self, service_name="unknown"):
        super().__init__()
        self.service_name = service_name

    def filter(self, record):
        ctx = get_trace_context()
        record.trace_id = ctx["trace_id"]
        record.span_id = ctx["span_id"]
        record.service = self.service_name
        return True


def setup_trace_logging(logger_name):
    """Add TraceContextFilter to the named Python logger (idempotent).

    Call after creating the service logger (e.g. CustomLogger) to enable
    automatic trace context injection on all log entries.
    """
    logger = logging.getLogger(logger_name)
    for f in logger.filters:
        if isinstance(f, TraceContextFilter):
            return
    logger.addFilter(TraceContextFilter(service_name=logger_name))


def setup_tracing(service_name: str) -> None:
    """Initialize the OTel TracerProvider with an OTLP HTTP exporter.

    Also configures a MeterProvider for custom application metrics and
    enables FastAPI auto-instrumentation so incoming ``traceparent``
    headers are automatically extracted for distributed tracing.

    No-op when ENABLE_OBSERVABILITY is not "1".  This is the single
    source-of-truth gate: when observability is disabled the Collector
    container is not deployed, so any SDK init would only produce DNS
    resolution errors.  The OTEL_EXPORTER_OTLP_ENDPOINT fallback in
    docker-compose always provides a value, so it cannot be used as
    the gate.
    """
    global _provider, _meter_provider

    if os.getenv("ENABLE_OBSERVABILITY") != "1":
        return

    endpoint_base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    if not endpoint_base:
        return

    # `OTEL_SERVICE_NAME` is the canonical OTel-spec env var. The
    # function-arg `service_name` is a per-service default (e.g.
    # `genieai-chatqna`) that operators can shadow per environment by
    # setting `OTEL_SERVICE_NAME` in their compose override. This matches
    # the Node.js `logger.js:84` resolution order.
    service_name_resolved = os.getenv("OTEL_SERVICE_NAME") or service_name
    # `service.namespace` groups related services (e.g. all OPEA overlay
    # services share `genieai`). Grafana `service.namespace` filter lets
    # operators slice by tier. Overridable via env var.
    service_namespace = os.getenv("OTEL_SERVICE_NAMESPACE", "genieai")
    resource = Resource.create(
        {
            "service.name": service_name_resolved,
            "service.namespace": service_namespace,
            "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
            "deployment.environment": os.getenv("NODE_ENV", "development"),
        }
    )

    # --- Traces ---
    # Python OTLPSpanExporter requires the full URL including /v1/traces
    trace_endpoint = f"{endpoint_base.rstrip('/')}/v1/traces"

    trace_exporter = OTLPSpanExporter(endpoint=trace_endpoint)
    trace_processor = BatchSpanProcessor(trace_exporter)

    _provider = TracerProvider(resource=resource)
    _provider.add_span_processor(trace_processor)
    # OTel Python SDK logs a WARN ("Overriding of current TracerProvider
    # is not allowed") when a previous provider exists. Upstream OPEA's
    # `comps.cores.telemetry.opea_telemetry` installs one at import time
    # — running first because OPEA services `from comps.cores.telemetry
    # import ...` at module load. The override here is INTENTIONAL (our
    # provider has our resource + OTLP endpoint); suppress the warning
    # by silencing the SDK's internal logger for that one message.
    import logging as _logging
    _otel_sdk_logger = _logging.getLogger("opentelemetry.sdk.trace")
    _previous_level = _otel_sdk_logger.level
    _otel_sdk_logger.setLevel(_logging.ERROR)
    try:
        trace.set_tracer_provider(_provider)
    finally:
        _otel_sdk_logger.setLevel(_previous_level)

    # --- FastAPI auto-instrumentation (global) ---
    # MUST be called before any FastAPI app is created.  setup_tracing()
    # runs before OPEA comps imports, so all MicroService apps created
    # later are automatically instrumented — no per-service
    # FastAPIInstrumentor.instrument_app() calls needed.
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor().instrument(
            # Exclude health-check endpoints from tracing to reduce noise in
            # Grafana trace search.  Docker health checks hit these every 10s.
            excluded_urls="health,ready,alive",
        )
        logging.getLogger(__name__).debug("FastAPI global auto-instrumentation enabled")
    except Exception as exc:
        logging.getLogger(__name__).warning(
            "FastAPI auto-instrumentation unavailable (install opentelemetry-instrumentation-fastapi): %s", exc
        )

    # --- HTTP client auto-instrumentation (global) ---
    # Instrument the HTTP clients used by the OPEA ServiceOrchestrator
    # so that outgoing calls to sub-services (retriever, reranker, etc.)
    # automatically propagate ``traceparent``.
    #
    # Default operation names for client spans are just the HTTP method
    # (e.g. "POST") which is useless in Grafana trace search.  We use
    # request hooks to rename spans to "METHOD /path" so they read as
    # "POST /v1/retrieval" instead of just "POST".

    try:
        from opentelemetry.instrumentation.aiohttp_client import AioHttpClientInstrumentor

        def _aiohttp_request_hook(span, params):
            """Rename aiohttp client spans from 'POST' to 'POST /v1/retrieval'."""
            if span and span.is_recording() and hasattr(params, "url"):
                try:
                    parsed = urlparse(str(params.url))
                    if parsed.path:
                        span.update_name(f"{params.method} {parsed.path}")
                except Exception:
                    pass

        AioHttpClientInstrumentor().instrument(request_hook=_aiohttp_request_hook)
        logging.getLogger(__name__).debug("AioHttpClientInstrumentor enabled with path naming")
    except Exception as exc:
        logging.getLogger(__name__).debug("AioHttpClientInstrumentor unavailable (optional): %s", exc)

    try:
        from opentelemetry.instrumentation.requests import RequestsInstrumentor

        def _requests_request_hook(span, request):
            """Rename requests client spans from 'POST' to 'POST /v1/embeddings'."""
            if span and span.is_recording() and hasattr(request, "url"):
                try:
                    parsed = urlparse(str(request.url))
                    if parsed.path:
                        span.update_name(f"{request.method} {parsed.path}")
                except Exception:
                    pass

        RequestsInstrumentor().instrument(request_hook=_requests_request_hook)
        logging.getLogger(__name__).debug("RequestsInstrumentor enabled with path naming")
    except Exception as exc:
        logging.getLogger(__name__).debug("RequestsInstrumentor unavailable (optional): %s", exc)

    # --- Metrics ---
    try:
        metric_endpoint = f"{endpoint_base.rstrip('/')}/v1/metrics"

        metric_exporter = OTLPMetricExporter(endpoint=metric_endpoint)
        metric_reader = PeriodicExportingMetricReader(
            exporter=metric_exporter,
            export_interval_millis=15_000,
        )

        _meter_provider = MeterProvider(
            resource=resource,
            metric_readers=[metric_reader],
        )
        metrics.set_meter_provider(_meter_provider)
    except Exception as exc:
        logging.getLogger(__name__).warning("Failed to initialize OTel MeterProvider — metrics disabled: %s", exc)

    # --- Logs ---
    # Upstream OPEA GenAIComps telemetry scope is metrics + tracing only
    # (see https://github.com/opea-project/GenAIComps/comps/cores/telemetry).
    # Our overlay adds LOG export so Python services' log records reach
    # VictoriaLogs via OTLP with indexed `service.name` and correlated
    # `trace_id`. Without this, OPEA logs only arrive in VL via the Docker
    # fluentd driver → Collector fluentd receiver, which leaves the OTel
    # resource empty and trace correlation impossible.
    #
    # Mirrors the Node.js backend's approach (`components/gov-chat-backend/tracing.js`):
    # LoggerProvider + OTLPLogExporter + BatchLogRecordProcessor. OPEA's
    # Python `comps` library does NOT install a logging handler — the
    # `TraceContextFilter` reads `trace.get_current_span()` to inject
    # `trace_id` / `span_id` into every Python LogRecord.
    try:
        setup_logging(service_name, resource=resource, endpoint_base=endpoint_base)
    except Exception as exc:
        logging.getLogger(__name__).warning("Failed to initialize OTel LoggerProvider — log export disabled: %s", exc)

    atexit.register(shutdown)

    # Handle SIGTERM (Docker/Swarm sends SIGTERM on stop) and SIGINT
    # (interactive Ctrl+C). `signal.signal()` is only valid in the main
    # thread of the main interpreter — uvicorn's worker-thread model
    # raises ValueError if init runs in a worker. `atexit` already
    # handles shutdown on normal exit; the signal hooks are best-effort
    # and degrade silently if the thread model forbids it.
    for _signame in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(_signame, _sigterm_handler)
        except (ValueError, OSError):
            # Worker thread or non-main interpreter — atexit still
            # handles graceful shutdown. Log at debug level to avoid
            # noisy warnings in multi-worker deployments.
            logging.getLogger(__name__).debug(
                f"signal.signal({_signame}) unavailable in this thread "
                "(likely a uvicorn worker); falling back to atexit-only "
                "shutdown."
            )


def get_tracer(name: str = __name__):
    """Return a tracer from the globally configured provider.

    Safe to call before ``setup_tracing()`` — returns a no-op tracer.
    """
    return trace.get_tracer(name)


def setup_logging(
    service_name: str,
    resource: Resource | None = None,
    endpoint_base: str | None = None,
) -> LoggerProvider:
    """Initialize the OTel LoggerProvider with an OTLP HTTP exporter.

    Adds an OTel log SDK path parallel to the existing fluentd path.
    Python `LogRecord`s flow through this exporter (after the
    `comps`-supplied `TraceContextFilter` annotates them with
    `trace_id`/`span_id`) and out via OTLP to the Collector, then on to
    VictoriaLogs — where they land with the OTel resource attached
    (``service.name=genieai-X``, ``deployment.environment=...``, etc.).

    Without this, OPEA Python logs only reach VL via the fluentd path
    (no indexed OTel fields, no trace correlation). Upstream OPEA's
    GenAIComps telemetry scope is metrics + traces only (see
    https://github.com/opea-project/GenAIComps/comps/cores/telemetry).

    Called automatically by ``setup_tracing()``; may also be called
    independently if a service wants log export without spans/metrics.

    @param service_name  Service name stamped on every log record
                         (``service.name`` resource attribute). Must
                         match the name passed to ``setup_tracing()``
                         so log + trace correlation joins cleanly.
    @param resource      Optional pre-built Resource. If None, built
                         from the same env vars as ``setup_tracing()``
                         (``SERVICE_VERSION``, ``NODE_ENV``).
    @param endpoint_base OTLP base URL. If None, read from
                         ``OTEL_EXPORTER_OTLP_ENDPOINT``. Empty /
                         unset string → function is a no-op (same
                         observability-disabled semantics as
                         ``setup_tracing()``).
    @returns the registered ``LoggerProvider`` (or ``None`` when
             observability is disabled / endpoint missing).
    """
    global _logger_provider

    if os.getenv("ENABLE_OBSERVABILITY") != "1":
        return None

    if endpoint_base is None:
        endpoint_base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    if not endpoint_base:
        return None

    if resource is None:
        # `OTEL_SERVICE_NAME` is the canonical OTel-spec env var.
        # Same priority as `setup_tracing()` so log + trace correlation
        # joins cleanly under one filter.
        service_name_resolved = os.getenv("OTEL_SERVICE_NAME") or service_name
        service_namespace = os.getenv("OTEL_SERVICE_NAMESPACE", "genieai")
        resource = Resource.create(
            {
                "service.name": service_name_resolved,
                "service.namespace": service_namespace,
                "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
                "deployment.environment": os.getenv("NODE_ENV", "development"),
            }
        )

    log_endpoint = f"{endpoint_base.rstrip('/')}/v1/logs"
    log_exporter = OTLPLogExporter(endpoint=log_endpoint)
    # Wrap the inner BatchLogRecordProcessor with the PII redactor so
    # every LogRecord is scrubbed of sensitive attributes + body text
    # BEFORE the OTel exporter serialises it for VictoriaLogs. Without
    # this, user queries / emails / tokens / session IDs flow verbatim
    # to the log store — mirroring the Node.js `PIIRedactingLogRecordProcessor`
    # we ship on the backend + doc-repo side.
    from tracing_pii import PIIRedactingLogRecordProcessor  # local import — keeps
    # module-level import graph light; the file has no heavy deps.
    pii_safe_processor = PIIRedactingLogRecordProcessor(
        BatchLogRecordProcessor(log_exporter)
    )

    _logger_provider = LoggerProvider(resource=resource)
    _logger_provider.add_log_record_processor(pii_safe_processor)
    set_logger_provider(_logger_provider)

    # Attach the OTel LoggingHandler to the root Python logger so every
    # `logger.info(...)` call (including OPEA `comps`' CustomLogger)
    # emits a `LogRecord` through the LoggerProvider → OTLPLogExporter
    # → Collector → VictoriaLogs. Without this, the LoggerProvider sits
    # idle — Python's stdlib logging has no awareness of OTel logs
    # unless we wire a handler that converts `LogRecord`s.
    #
    # Default INFO (matches Python's stdlib default) — DEBUG would flood
    # OPEA's `comps` CustomLogger at production scale (~5-10x volume).
    # Operators can override with `LOG_LEVEL=DEBUG` (the env var
    # compose sets for backend + doc-repo, kept consistent for OPEA).
    handler_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    handler_level = getattr(logging, handler_level_name, logging.INFO)
    handler = LoggingHandler(level=handler_level, logger_provider=_logger_provider)

    # Attach at the ROOT logger so every child logger (comps CustomLogger
    # included) propagates to us. `force=False` to avoid clobbering
    # existing handlers (e.g. Uvicorn's stdout handler) — the OTel
    # handler is additive.
    root_logger = logging.getLogger()
    if not any(isinstance(h, LoggingHandler) for h in root_logger.handlers):
        root_logger.addHandler(handler)

    logging.getLogger(__name__).debug(
        "OTel LoggerProvider enabled for %s → %s (handler level=%s)",
        service_name,
        log_endpoint,
        handler_level_name,
    )
    return _logger_provider


def with_span(name: str, tracer_name: str = __name__, attributes: dict | None = None):
    """Context manager that wraps the common try/except pattern with built-in error handling.

    Usage::

        from tracing import with_span

        with with_span("service.operation", attributes={"key": "value"}) as span:
            result = do_work()
            span.set_attribute("result.count", len(result))

    Guarantees:
        - span.set_status(ERROR) + record_exception on any exception
        - span.end() always called (context manager)
        - No-op when tracing is disabled (OTEL_EXPORTER_OTLP_ENDPOINT unset)
    """
    tracer = get_tracer(tracer_name)
    span = tracer.start_span(name, attributes=attributes)
    return _SpanContext(span)


@contextmanager
def background_span(name: str, tracer_name: str = __name__, attributes: dict | None = None):
    """Context manager that wraps background work in a fresh OTel ROOT span AND
    sets it as the active context for the duration of the block.

    Use this for periodic tasks (health checks, log rollovers, cache eviction),
    module-load init log bursts, and post-request background tasks — anywhere a
    log is emitted without being inside a FastAPI request span. The OTel
    Python `TracingContextFilter` (`genieai_logging.py`) reads the active span
    to stamp ``trace_id`` / ``span_id`` on every log record; without an active
    span, those records are emitted with no trace correlation.

    Difference from `with_span`:
        - `with_span` uses `tracer.start_span` — does NOT make the span active,
          so logs emitted inside do not inherit the span's `trace_id`.
        - `background_span` uses `tracer.start_as_current_span` — both starts
          and activates the span. Logs emitted inside the `with` block (and
          any code they call) carry the live `trace_id`.

    Usage::

        from tracing import background_span

        def periodic_healthcheck():
            with background_span("dataprep.healthcheck", attributes={"interval_s": 60}):
                logger.info("pinging arangodb")  # trace_id stamped
                if not healthy:
                    logger.warning("arangodb unhealthy")  # trace_id stamped

    Guarantees:
        - span.end() always called (contextmanager)
        - Exceptions are recorded on the span, status set to ERROR, then
          re-raised (no suppression)
        - Safe to call before ``setup_tracing()`` — returns a no-op context
          that emits no span but still propagates exceptions
    """
    tracer = get_tracer(tracer_name)
    try:
        with tracer.start_as_current_span(name, attributes=attributes) as span:
            yield span
    except Exception as exc:
        # `start_as_current_span` already records the exception + sets ERROR
        # status + ends the span before propagating, so this re-raise is the
        # only thing left to do.
        raise exc from None


class _SpanContext:
    """Context manager wrapper that ensures error handling on spans."""

    def __init__(self, span):
        self._span = span

    def __enter__(self):
        return self._span

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self._span.record_exception(exc_val)
            self._span.set_status(Status(StatusCode.ERROR, str(exc_val)))
        self._span.end()
        return False  # don't suppress exceptions


def get_meter() -> metrics.Meter:
    """Return a meter from the global MeterProvider for creating custom instruments.

    Safe to call before ``setup_tracing()`` — returns a no-op meter.
    """
    return metrics.get_meter(
        os.getenv("SERVICE_NAME", "unknown"),
        os.getenv("SERVICE_VERSION", "1.0.0"),
    )


def shutdown() -> None:
    """Flush and shut down the global TracerProvider, MeterProvider, and
    LoggerProvider (best-effort)."""
    global _provider, _meter_provider, _logger_provider
    if _provider is None and _meter_provider is None and _logger_provider is None:
        return
    # Use a 15 s force_flush budget on both sides — matches the JS-side
    # `SHUTDOWN_TIMEOUT_MS=15000` so the JS + Python services flush
    # symmetrically under Swarm `stop_grace_period` (default 10 s +
    # grace = 30 s max). The previous 30 s Python budget was wasted
    # budget (Docker SIGKILLs at stop_grace_period regardless).
    force_flush_timeout_ms = 15_000
    with contextlib.suppress(Exception):
        _provider.force_flush(force_flush_timeout_ms)
    with contextlib.suppress(Exception):
        _provider.shutdown()
    _provider = None
    with contextlib.suppress(Exception):
        _meter_provider.force_flush(force_flush_timeout_ms)
    with contextlib.suppress(Exception):
        _meter_provider.shutdown()
    _meter_provider = None
    with contextlib.suppress(Exception):
        _logger_provider.force_flush(force_flush_timeout_ms)
    with contextlib.suppress(Exception):
        _logger_provider.shutdown()
    _logger_provider = None


def _reset() -> None:
    """Reset module state. Only for testing."""
    global _provider, _meter_provider, _logger_provider
    _provider = None
    _meter_provider = None
    _logger_provider = None


def _sigterm_handler(signum, frame):
    shutdown()
    sys.exit(0)
