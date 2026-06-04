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

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
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

    Also configures a MeterProvider for custom application metrics.

    No-op when OTEL_EXPORTER_OTLP_ENDPOINT is empty or unset, or when
    ENABLE_OBSERVABILITY is not "1". This allows OPEA services to run
    without the observability stack deployed.
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
        logging.getLogger(__name__).warning(
            "Failed to initialize OTel MeterProvider — metrics disabled: %s", exc
        )

    atexit.register(shutdown)

    # Handle SIGTERM (Docker/Swarm sends SIGTERM on stop)
    signal.signal(signal.SIGTERM, _sigterm_handler)


def get_tracer(name: str = __name__):
    """Return a tracer from the globally configured provider.

    Safe to call before ``setup_tracing()`` — returns a no-op tracer.
    """
    return trace.get_tracer(name)


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
