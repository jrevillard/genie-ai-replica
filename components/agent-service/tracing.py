# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""OpenTelemetry wiring for the GENIE.AI agent service.

Ported from `genie-ai-overlay/tracing.py` (the OPEA tier's tracing module)
so the agent service emits spans and metrics into the same collector, with
the same PII redaction, without depending on the OPEA overlay package. The
overlay's two package-bound hooks — the micro-service bootstrap and the
HTTP-service access-log installer — are intentionally absent: they belong
to the overlay's own runtime, which this service does not use.

Public API (unchanged from the source module):

    setup_tracing(service_name)      initialise the providers + exporters
    get_tracer(name)                  a tracer from the global provider
    with_span(name, ...)              span context manager (not activated)
    background_span(name, ...)        span context manager (activated)
    get_meter()                       a meter from the global provider
    shutdown()                        flush + close the providers
"""

import atexit
import contextlib
import logging
import os
import re
import signal
import sys
from contextlib import contextmanager

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode

_provider = None
_meter_provider = None

# PII key patterns — case-insensitive regex, mirroring the Node side
# (`SENSITIVE_KEY_PATTERNS` in `components/gov-chat-backend/tracing-pii.js`).
# The set used to be an exact-match frozenset; widened to regex to catch the
# variants the services actually emit (`auth_token`, `openai_api_key`, ...).
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

# Backwards-compat exact-match set — same surface, exact key.
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
    """Return a copy of *attrs* with the PII keys removed."""
    return {k: v for k, v in attrs.items() if not _is_sensitive_key(k)}


def redact_attributes(attrs: dict) -> dict:
    """Replace the VALUES of sensitive keys, keeping the keys.

    Same contract as the Node side (`tracing-pii.js#redactAttributes`): the
    key survives so a dashboard can still filter on it, the value does not.

    NOTE: span-level redaction only fires for attributes passed at span
    construction. Attributes set with `span.set_attribute(...)` after the
    span started bypass this processor and reach the exporter verbatim.
    Callers handling PII must pass it through the constructor attributes.
    """
    return {k: ("[REDACTED]" if _is_sensitive_key(k) else v) for k, v in attrs.items()}


class RedactingSpanProcessor(SpanProcessor):
    """Wraps a delegate `SpanProcessor` and scrubs PII from span attributes.

    The processor runs `redact_attributes(...)` over the attributes passed
    to `tracer.start_span(...)` and writes the redacted values back with
    `span.set_attribute(...)`. After `on_start` the delegate (typically a
    `BatchSpanProcessor` wrapping an OTLP exporter) sees the redacted view.

    Why `on_start` and not `on_end`: once a span ends its attributes become
    read-only on the OTel Python SDK — `set_attribute` raises. PII must be
    scrubbed before the span is finalised.
    """

    def __init__(self, delegate: SpanProcessor) -> None:
        self._delegate = delegate

    def on_start(self, span, parent_context=None) -> None:
        # `span._attributes` is the internal mutable dict on the OTel Python
        # `_Span` class. Access is best-effort — a test double may not
        # implement it; treat absence as "nothing to redact".
        raw = getattr(span, "_attributes", None) or {}
        if raw:
            redacted = redact_attributes(dict(raw))
            for key, value in redacted.items():
                try:
                    span.set_attribute(key, value)
                except Exception as exc:
                    # A redaction failure must surface: silently suppressing it
                    # means a leaked attribute lands in the trace store.
                    logging.getLogger(__name__).warning(
                        "PII redaction set_attribute failed for %r: %s",
                        key,
                        exc,
                    )
                    raise
        self._delegate.on_start(span, parent_context)

    def on_end(self, span) -> None:
        self._delegate.on_end(span)

    def shutdown(self) -> None:
        self._delegate.shutdown()

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return self._delegate.force_flush(timeout_millis)


def setup_tracing(service_name: str) -> None:
    """Initialise the OTel TracerProvider and MeterProvider.

    Also enables FastAPI auto-instrumentation so incoming `traceparent`
    headers are extracted for distributed tracing.

    No-op when `ENABLE_OBSERVABILITY` is not "1": this is the single
    source-of-truth gate — with observability off the collector is not
    deployed, so any SDK init would only produce DNS resolution errors.
    """
    global _provider, _meter_provider

    if os.getenv("ENABLE_OBSERVABILITY") != "1":
        return

    endpoint_base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    if not endpoint_base:
        return

    # `OTEL_SERVICE_NAME` is the canonical OTel-spec env var; the argument is
    # the per-service default an operator can shadow per environment.
    service_name_resolved = os.getenv("OTEL_SERVICE_NAME") or service_name
    # `service.namespace` groups the services of a deployment: the OPEA
    # overlay services share "genieai", the application services
    # (backend, document-repository, agent-service) share "genie-core".
    service_namespace = "genie-core"
    service_version = os.getenv("OTEL_SERVICE_VERSION") or "1.0.0"
    resource = Resource.create(
        {
            "service.name": service_name_resolved,
            "service.namespace": service_namespace,
            "service.version": service_version,
            "deployment.environment": os.getenv("NODE_ENV", "development"),
        }
    )

    # --- Traces ---
    # The Python OTLP exporter requires the full URL, including /v1/traces.
    trace_endpoint = f"{endpoint_base.rstrip('/')}/v1/traces"

    trace_exporter = OTLPSpanExporter(endpoint=trace_endpoint)
    inner_processor = BatchSpanProcessor(trace_exporter)
    # Wrap the batch processor in a PII redactor: every span passes through
    # `RedactingSpanProcessor.on_start` BEFORE the exporter sees it, so the
    # sensitive keys are scrubbed before the span reaches the trace store.
    trace_processor = RedactingSpanProcessor(inner_processor)

    _provider = TracerProvider(resource=resource)
    _provider.add_span_processor(trace_processor)

    import logging as _logging

    _otel_sdk_logger = _logging.getLogger("opentelemetry.trace")
    _previous_level = _otel_sdk_logger.level
    _otel_sdk_logger.setLevel(_logging.ERROR)
    try:
        trace.set_tracer_provider(_provider)
    finally:
        _otel_sdk_logger.setLevel(_previous_level)

    # --- FastAPI auto-instrumentation ---
    # MUST run before the FastAPI app is created so the app is instrumented.
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor().instrument(
            # Health endpoints are excluded: the container health check hits
            # them every 30s and they would drown the trace search.
            excluded_urls="health,ready,alive",
        )
        logging.getLogger(__name__).debug("FastAPI global auto-instrumentation enabled")
    except Exception as exc:
        logging.getLogger(__name__).warning(
            "FastAPI auto-instrumentation unavailable (install opentelemetry-instrumentation-fastapi): %s", exc
        )

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

    # SIGTERM (Docker/Swarm) and SIGINT (Ctrl+C): flush the spans before the
    # process dies. `signal.signal()` is only valid in the main thread, so the
    # handlers are best-effort — `atexit` already covers a normal exit.
    for _signame in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(_signame, _sigterm_handler)
        except (ValueError, OSError):
            logging.getLogger(__name__).debug(
                f"signal.signal({_signame}) unavailable in this thread; falling back to atexit-only shutdown."
            )


def get_tracer(name: str = __name__):
    """Return a tracer from the globally configured provider.

    Safe to call before `setup_tracing()` — returns a no-op tracer.
    """
    return trace.get_tracer(name)


def with_span(name: str, tracer_name: str = __name__, attributes: dict | None = None):
    """Context manager that opens a span and records failures on it.

    Guarantees:
    - `set_status(ERROR)` + `record_exception` on any exception
    - `span.end()` always called
    - No-op when tracing is disabled
    """
    tracer = get_tracer(tracer_name)
    span = tracer.start_span(name, attributes=attributes)
    return _SpanContext(span)


@contextmanager
def background_span(name: str, tracer_name: str = __name__, attributes: dict | None = None):
    """Context manager that opens AND activates a root span.

    Use it for work that runs outside a request (periodic tasks, startup
    bursts): the span is active for the duration of the block, so anything
    reading the active context sees it.

    Difference from `with_span`: `with_span` uses `tracer.start_span` — the
    span is NOT active, so nothing inside inherits its context.
    """
    tracer = get_tracer(tracer_name)
    with tracer.start_as_current_span(name, attributes=attributes) as span:
        yield span


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
    """Return a meter from the global MeterProvider.

    Safe to call before `setup_tracing()` — returns a no-op meter.
    """
    return metrics.get_meter(
        os.getenv("OTEL_SERVICE_NAME") or os.getenv("SERVICE_NAME", "unknown"),
        os.getenv("OTEL_SERVICE_VERSION") or os.getenv("SERVICE_VERSION", "1.0.0"),
    )


def shutdown() -> None:
    """Flush and shut down the global providers (best-effort)."""
    global _provider, _meter_provider
    if _provider is None and _meter_provider is None:
        return
    # 15 s force-flush budget, matching the JS side's SHUTDOWN_TIMEOUT_MS so
    # both tiers flush symmetrically under Swarm's stop_grace_period.
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


def _reset() -> None:
    """Reset the module state. Only for testing."""
    global _provider, _meter_provider
    _provider = None
    _meter_provider = None


def _sigterm_handler(signum, frame):
    shutdown()
    sys.exit(0)
