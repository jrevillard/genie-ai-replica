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
import signal
import sys
from urllib.parse import urlparse

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import Status, StatusCode
from opentelemetry.sdk.trace.export import BatchSpanProcessor

_provider = None
_meter_provider = None

# Shared PII keys — import from here in all services to avoid duplication
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


def sanitize_attributes(attrs: dict) -> dict:
    """Return a copy of *attrs* with PII keys removed."""
    return {k: v for k, v in attrs.items() if k not in _PII_KEYS}


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
    """Python logging Filter that injects trace_id, span_id, and service into every log record."""

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

    No-op when OTEL_EXPORTER_OTLP_ENDPOINT is empty or unset.
    This allows OPEA services to run without the observability stack
    deployed — the Collector not being deployed means the endpoint
    variable is never injected into the containers.
    """
    global _provider, _meter_provider

    endpoint_base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    if not endpoint_base:
        return

    resource = Resource.create(
        {
            "service.name": service_name,
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
    trace.set_tracer_provider(_provider)

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

    atexit.register(shutdown)

    # Handle SIGTERM (Docker/Swarm sends SIGTERM on stop)
    signal.signal(signal.SIGTERM, _sigterm_handler)


def get_tracer(name: str = __name__):
    """Return a tracer from the globally configured provider.

    Safe to call before ``setup_tracing()`` — returns a no-op tracer.
    """
    return trace.get_tracer(name)

def with_span(name: str, attributes: dict | None = None):
    """Context manager that wraps the common try/except pattern with built-in error handling.

    Usage::

        from tracing import with_span

        with with_span("service.operation", attributes={"key": "value"}) as span:
            result = do_work()
            span.set_attribute("result.count", len(result))

    Guarantees:
        - span.set_status(ERROR) + record_exception on any exception
        - span.end() always called (context manager)
        - No-op when tracing is disabled (TESTING env var)
    """
    tracer = get_tracer("with_span")
    span = tracer.start_span(name, attributes=attributes)
    return _SpanContext(span)


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
    """Flush and shut down the global TracerProvider and MeterProvider (best-effort)."""
    global _provider, _meter_provider
    if _provider is None and _meter_provider is None:
        return
    with contextlib.suppress(Exception):
        _provider.force_flush(30_000)
    with contextlib.suppress(Exception):
        _provider.shutdown()
    _provider = None
    with contextlib.suppress(Exception):
        _meter_provider.force_flush()
    with contextlib.suppress(Exception):
        _meter_provider.shutdown()
    _meter_provider = None


def _reset() -> None:
    """Reset module state. Only for testing."""
    global _provider, _meter_provider
    _provider = None
    _meter_provider = None


def _sigterm_handler(signum, frame):
    shutdown()
    sys.exit(0)
