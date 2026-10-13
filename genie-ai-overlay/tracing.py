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


def redact_attributes(attrs: dict) -> dict:
    """Mirror of `components/gov-chat-backend/tracing-pii.js#redactAttributes`.

    Replace VALUES (not keys) for sensitive keys so the key is preserved
    for downstream filterability — Grafana can still filter by
    `db.system = postgresql` even when `password` is `[REDACTED]`. Same
    contract as the Node side: drop the value, keep the key.

    NOTE: Span-level redaction only fires for attributes passed at span
    construction (`with_span(..., attributes=...)`). Attributes set via
    `span.set_attribute(...)` after the span is already started bypass
    this processor — they reach the exporter verbatim. Callers handling
    PII must pass it via the constructor attrs. (The Node side has the
    same limitation; see Node tracing.js onStart.)
    """
    return {k: ("[REDACTED]" if _is_sensitive_key(k) else v) for k, v in attrs.items()}


class RedactingSpanProcessor(SpanProcessor):
    """Wraps a delegate `SpanProcessor` and scrubs PII from span attributes
    at `on_start` time. Mirrors `PIIRedactionProcessor` on the Node side
    (`components/gov-chat-backend/tracing.js:89-149`).

    The processor runs `redact_attributes(...)` over the attributes passed
    to `tracer.start_span(name, attributes=...)` / `start_as_current_span(...)`
    and writes the redacted values back via `span.set_attribute(...)`.
    After `on_start` the delegate (typically `BatchSpanProcessor` wrapping
    an `OTLPSpanExporter`) sees the redacted view.

    Why `on_start` (not `on_end`): once a span ends, its attributes become
    read-only on the OTel Python SDK — `set_attribute` raises. PII must
    be scrubbed before the span is finalised. Trade-off: attributes added
    via `span.set_attribute(...)` AFTER `on_start` returned are not
    caught. Documented contract; callers must pass sensitive data via
    the constructor attrs.
    """

    def __init__(self, delegate: SpanProcessor) -> None:
        self._delegate = delegate

    def on_start(self, span, parent_context=None) -> None:
        # `span._attributes` is the internal mutable dict on the OTel
        # Python `_Span` class. Read it (the SDK does the same in its
        # built-in samplers and attribute-limit processors) and apply the
        # redaction. Access is best-effort — some test doubles don't
        # implement `_attributes`; treat absence as "nothing to redact".
        raw = getattr(span, "_attributes", None) or {}
        if raw:
            redacted = redact_attributes(dict(raw))
            for key, value in redacted.items():
                try:
                    span.set_attribute(key, value)
                except Exception as exc:
                    # PII redaction failure must surface — silently
                    # suppressing would mean a leaked attribute lands
                    # in VictoriaTraces. Log loudly and re-raise so the
                    # SDK's batch processor records the exception on
                    # the span (visible in the trace UI).
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
    every log record. After the admin-logs SDK revert the OTel SDK logs
    path is gone (no SDK log provider / handler) — the single log emit
    path is python logging -> stdout -> fluentd driver -> OTel
    collector -> VictoriaLogs. The collector reads these record
    attributes (`trace_id`, `span_id`, `service`) from the JSON envelope
    and indexes them as first-class stream fields. The OTel Context API
    (used by `get_trace_context`) is the canonical correlation surface
    — no SDK logs dependency required.

    The PREVIOUS implementation prepended `trace_id="..."` /
    `span_id="..."` into `record.msg` itself. That corrupted the message
    body (every `_msg:` filter matched the prefix first instead of the
    real text) and wasted bandwidth on every log emit. Drop the body
    prepend — set the structured record attributes instead.
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
    # `comps.cores.mega.logger.CustomLogger` constructs its underlying
    # Python logger with `propagate=False` (comps owns its own stdout
    # handler and avoids walking up the hierarchy to prevent duplicate
    # log lines). Side effect: the root logger (and any future
    # configuration that adds handlers there) cannot see records from
    # this logger. Re-enable propagation so records flow up the
    # hierarchy — the comps CustomLogger's own stdout handler is
    # untouched (logs still reach docker stdout + fluentd via the
    # dual-logging driver).
    if logger.propagate is False:
        logger.propagate = True


class _OnlyStructuredAccessFilter(logging.Filter):
    """Filter that drops uvicorn.access records which lack method/path extras.

    Our middleware always emits with extra={method, path, status_code, duration_ms}.
    uvicorn's own emit uses plain %-format string with no extras — those records
    lack the `method` attribute. We block uvicorn's emit at the HANDLER level
    so uvicorn.access logger still receives the records (preserving any future
    debug logging) but the handler doesn't emit them.
    """

    def filter(self, record):
        return hasattr(record, "method")


class JsonLogFormatter(logging.Formatter):
    """JSON formatter that emits trace_id, span_id, service when present.

    Output schema (stable contract):
      {
        "timestamp": "<ISO-8601 UTC>",
        "level": "<INFO|WARN|...>",
        "logger": "<logger name>",
        "message": "<rendered msg>",
        "trace_id": "<32-hex>" | "<32 zeros>" when no active span,
        "span_id":  "<16-hex>" | "<16 zeros>" when no active span,
        "service":  "<service name from filter>"
      }
    """

    def format(self, record: logging.LogRecord) -> str:
        import json as _json

        payload = {
            "timestamp": self.formatTime(record, datefmt="%Y-%m-%dT%H:%M:%S.%fZ"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # TraceContextFilter stamps these on the record (zeroed when no span).
        if hasattr(record, "trace_id"):
            payload["trace_id"] = record.trace_id
        if hasattr(record, "span_id"):
            payload["span_id"] = record.span_id
        if hasattr(record, "service"):
            payload["service"] = record.service
        # AccessLogASGIMiddleware passes method/path/status_code/duration_ms
        # via `extra={}` — logging stores them as record attributes.
        for _field in ("method", "path", "status_code", "duration_ms"):
            if hasattr(record, _field):
                payload[_field] = getattr(record, _field)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return _json.dumps(payload, ensure_ascii=False)


def setup_json_logging(logger_name: str) -> None:
    """Replace handlers on the named logger with a JSON formatter.

    Idempotent: re-running swaps the formatter on existing handlers
    instead of duplicating them. Call after setup_trace_logging() so
    trace_id/span_id attributes are already populated by the filter.

    The comps CustomLogger creates its own stdout handler — we replace
    ITS formatter rather than add a competing handler (avoids duplicate
    lines in `docker logs`).
    """
    import json as _json  # noqa: F401  (kept for parity with JsonLogFormatter)

    logger = logging.getLogger(logger_name)
    formatter = JsonLogFormatter()
    if not logger.handlers:
        # comps CustomLogger normally adds a stdout handler — guard against
        # the rare case the named logger has none yet (test scenarios).
        logger.addHandler(logging.StreamHandler())
    for handler in logger.handlers:
        handler.setFormatter(formatter)


def silence_uvicorn_access_log() -> None:
    """Empty uvicorn.access logger's handler list — silences uvicorn's own access log.

    uvicorn writes access logs via `uvicorn.config.LOGGING_CONFIG["loggers"]
    ["uvicorn.access"]` which is configured in `Server.run()` via dictConfig.
    Removing the handlers here (BEFORE `Server.run()` mutates the dictConfig)
    means uvicorn never has a destination for the access log line — but the
    logger name `uvicorn.access` remains alive so our ASGI middleware can
    reuse it as the destination for our JSON access log emission.

    Why this works (and the dictConfig-patch approach doesn't):
    - dictConfig REPLACES the handlers on the logger whenever uvicorn calls
      it inside Server.run() — anything we attach at module-load gets wiped.
    - But if we EMPTY the handlers list in LOGGING_CONFIG itself, dictConfig
      installs an empty handler set — uvicorn emits nothing.
    - Our middleware then writes to the SAME logger name (`uvicorn.access`)
      with a JsonLogFormatter installed via setup_json_logging(). Different
      code path, no conflict.

    Idempotent: safe to call multiple times.
    """
    try:
        import uvicorn.config

        loggers = uvicorn.config.LOGGING_CONFIG.setdefault("loggers", {})
        uvicorn_access = loggers.setdefault("uvicorn.access", {})
        uvicorn_access["handlers"] = []
        # Disable propagation too — uvicorn.access shouldn't reach the root
        # logger (which uvicorn also configures and might write JSON envelopes
        # for, polluting the stream).
        uvicorn_access["propagate"] = False
        # Also set level above INFO so uvicorn's own logging (which uses
        # level INFO) is filtered out.  We can't remove the logger entry
        # entirely (dictConfig would recreate it with defaults), so we raise
        # the effective level.  Our middleware logs at INFO level AFTER this
        # is set, so we reset the level on the actual logger in
        # _install_json_handler().
        uvicorn_access["level"] = 100  # above INFO=20, blocks uvicorn's emits
        # Also set the Python logger level directly — configure_logging's
        # setLevel(log_level) call runs AFTER dictConfig and would reset
        # the level back to INFO, undoing our silencing.  By setting the
        # Python logger level directly here (above INFO), the setLevel in
        # configure_logging still applies but at a level that blocks
        # uvicorn's INFO messages.  Note: this blocks BOTH uvicorn's and
        # our middleware's messages, which is why _install_json_handler
        # resets the logger level to INFO after adding the handler.
        _uvicorn_access_logger = logging.getLogger("uvicorn.access")
        _uvicorn_access_logger.setLevel(100)
    except ImportError:
        pass  # uvicorn not installed (test env); no-op


class AccessLogASGIMiddleware:
    """Raw ASGI middleware that emits a JSON access log per request.

    Emits via `logging.getLogger("uvicorn.access").info(...)` so the JSON
    envelope reuses the existing `JsonLogFormatter` + `TraceContextFilter`
    pipeline (trace_id/span_id stamped automatically when an active OTel
    span context exists). The collector's `extract_envelope_trace_context`
    transform then lifts the values to VL attributes.

    Why raw ASGI (not Starlette `BaseHTTPMiddleware`): BaseHTTPMiddleware
    buffers the response body and breaks streaming responses. Raw ASGI
    sees the request and response lifecycle without buffering.

    Replaces uvicorn's own `uvicorn.access` output (which is silenced by
    `silence_uvicorn_access_log()`). Format is intentionally minimal —
    method/path/status/duration_ms; the rest of the envelope (timestamp,
    level, logger, message, trace_id, span_id, service) comes from
    JsonLogFormatter.
    """

    def __init__(self, inner_app):
        self._inner_app = inner_app
        self._logger = logging.getLogger("uvicorn.access")

    def __getattr__(self, name):
        # Delegate attribute access (e.g. router, add_api_route) to the
        # wrapped FastAPI/Starlette app so HTTPService.add_route() works.
        return getattr(self._inner_app, name)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            # ASGI lifespan / websocket — pass through
            await self._inner_app(scope, receive, send)
            return

        import time as _time

        method = scope.get("method", "-")
        path = scope.get("path", "-")
        status_code = 500  # default if inner_app crashes before sending start
        start = _time.monotonic()

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 500)
            await send(message)

        try:
            await self._inner_app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((_time.monotonic() - start) * 1000, 3)
            self._logger.info(
                "%s %s %d %.3fms",
                method,
                path,
                status_code,
                duration_ms,
                extra={
                    "method": method,
                    "path": path,
                    "status_code": status_code,
                    "duration_ms": duration_ms,
                },
            )


# Module-level sentinel — guards against double-patch (the class-level
# property reassignment is idempotent but logs a noisy warning each call).
_ACCESS_LOG_MIDDLEWARE_INSTALLED: bool = False


_logger = logging.getLogger(__name__)


def _install_via_micro_service_init() -> None:
    """Install uvicorn access-log middleware via a MicroService.__init__ hook.

    Called when ``install_uvicorn_access_log_middleware`` fails to import
    ``HTTPService`` at module-load time (the class is lazily loaded when
    ``MicroService`` is instantiated).  Monkey-patching ``MicroService.__init__``
    defers the install until the first ``MicroService()`` call, at which point
    ``HTTPService`` IS available.
    """
    try:
        from comps import MicroService  # noqa: F401
    except ImportError:
        return

    _original_init = MicroService.__init__

    def _deferred_init(self, *args, **kwargs):
        _original_init(self, *args, **kwargs)
        # HTTPService is now loaded (triggered by MicroService.__init__ super chain).
        # Recurse — will succeed this time and set the sentinel.
        install_uvicorn_access_log_middleware()

    # MicroService is a MagicMock in test env — assigning __init__ is not
    # supported on mocks.  Test suite mocks comps anyway, so the monkey-patch
    # is not needed in that context.
    with contextlib.suppress(AttributeError):
        MicroService.__init__ = _deferred_init


def _install_json_handler() -> None:
    """Re-attach the JsonLogFormatter handler to the uvicorn.access logger.

    Called as a FastAPI startup event so it runs AFTER uvicorn's dictConfig
    (in Server.run()) has cleared our earlier setup_json_logging() handler.
    The middleware logs via ``logging.getLogger("uvicorn.access")`` — without
    a handler with JsonLogFormatter, the JSON lines disappear into the void.
    """
    access_logger = logging.getLogger("uvicorn.access")
    for h in access_logger.handlers:
        if isinstance(h.formatter, JsonLogFormatter):
            return  # already installed
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    handler.addFilter(_OnlyStructuredAccessFilter())
    access_logger.addHandler(handler)
    # Reset the level that silence_uvicorn_access_log() raised to 100 (above INFO)
    # so our middleware's INFO-level messages are emitted.  propagate=False is kept
    # to prevent the root logger from seeing these records.
    access_logger.setLevel(logging.INFO)


def install_uvicorn_access_log_middleware() -> None:
    """Monkey-patch comps.HTTPService.app to wrap every FastAPI app with our middleware.

    comps' ``HTTPService`` (comps/cores/mega/http_service.py) is lazily loaded
    when ``MicroService`` is first instantiated.  If we are called before that
    point, the import of ``HTTPService`` fails silently.  To handle that, we
    also monkey-patch ``MicroService.__init__`` so that the FIRST instantiation
    of a MicroService (e.g. ``chatqna = MicroService(...)`` in chatqna's
    startup) retries the install — at which point ``HTTPService`` IS available.

    Idempotent: the ``_ACCESS_LOG_MIDDLEWARE_INSTALLED`` sentinel prevents
    repeated wrapping (which would otherwise stack middleware layers on
    every restart).

    Pair with ``silence_uvicorn_access_log()`` (call BEFORE this in the
    service entry point) to disable uvicorn's own plain-text access log.
    """
    global _ACCESS_LOG_MIDDLEWARE_INSTALLED
    if _ACCESS_LOG_MIDDLEWARE_INSTALLED:
        return
    try:
        from comps.cores.mega.http_service import HTTPService
    except ImportError:
        _logger.debug(
            "HTTPService not yet available at module-load time; deferring install to MicroService.__init__ hook."
        )
        _install_via_micro_service_init()
        return

    _original_app_property = HTTPService.app

    def _wrapped_app_getter(self):
        original_app = _original_app_property.fget(self)
        # Re-attach the JSON handler now — the OTel instrumented FastAPI doesn't
        # proxy add_startup_event, so we can't use a startup event.  The handler
        # survives because Server.run() calls dictConfig AFTER this, but the
        # StreamHandler we add here is NOT in LOGGING_CONFIG and therefore not
        # wiped.
        _install_json_handler()
        return AccessLogASGIMiddleware(original_app)

    HTTPService.app = property(_wrapped_app_getter)
    _ACCESS_LOG_MIDDLEWARE_INSTALLED = True


def install_uvicorn_access_logging() -> None:
    """One-line entry point for the 4-step uvicorn.access trace_id wiring.

    Replaces per-service 4-line wiring with a single call:
      - setup_trace_logging("uvicorn.access")   # stamp trace_id/span_id
      - silence_uvicorn_access_log()           # empty uvicorn's plain-text emit
      - setup_json_logging("uvicorn.access")   # install JsonLogFormatter
      - install_uvicorn_access_log_middleware()  # monkey-patch HTTPService.app

    Idempotent (each step is idempotent individually). Safe to call from
    any service entry point. Callers only need the single import::

        from tracing import install_uvicorn_access_logging
    """
    setup_trace_logging("uvicorn.access")
    silence_uvicorn_access_log()
    setup_json_logging("uvicorn.access")
    install_uvicorn_access_log_middleware()


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
    # `service.namespace` groups related services (all OPEA overlay services
    # share 'genieai'; backend + doc-repo use 'genie-core').
    service_namespace = "genieai"
    # `service.version` is hardcoded for the cross-version regression check
    # (see commit 1737bd52a) — operators shadow per environment via
    # `OTEL_SERVICE_VERSION` env var, mirroring the OTEL_SERVICE_NAME
    # pattern above. Default 1.0.0 matches the previous constant.
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
    # Python OTLPSpanExporter requires the full URL including /v1/traces
    trace_endpoint = f"{endpoint_base.rstrip('/')}/v1/traces"

    trace_exporter = OTLPSpanExporter(endpoint=trace_endpoint)
    inner_processor = BatchSpanProcessor(trace_exporter)
    # Wrap the BatchSpanProcessor in a PII redactor — every span passes
    # through `RedactingSpanProcessor.on_start` BEFORE the inner exporter
    # sees it, so sensitive keys (password / token / secret / api_key /
    # ...) are scrubbed to "[REDACTED]" before reaching VictoriaTraces.
    # Mirror of `PIIRedactionProcessor` on the Node side
    # (`components/gov-chat-backend/tracing.js:89-149`).
    trace_processor = RedactingSpanProcessor(inner_processor)

    _provider = TracerProvider(resource=resource)
    _provider.add_span_processor(trace_processor)
    # OTel Python SDK logs a WARN ("Overriding of current TracerProvider
    # is not allowed") when a previous provider exists. Upstream OPEA's
    # `comps.cores.telemetry.opea_telemetry` installs one at import time
    # — running first because OPEA services `from comps.cores.telemetry
    # import ...` at module load. The override here is INTENTIONAL (our
    # provider has our resource + OTLP endpoint); suppress the warning
    # by silencing the SDK's internal logger for that one message.
    #
    # TODO: switch to the OTel-spec `_SUPPRESS_INSTRUMENTATION_KEY` context
    # var (`opentelemetry.context._SUPPRESS_INSTRUMENTATION_KEY`) instead of
    # the racy logger-level manipulation. The current approach is acceptable
    # for now because (a) the warning fires once at process startup, (b) the
    # level is restored in the `finally` block, and (c) suppressing a single
    # WARN line is the documented workaround per the OTel Python issue
    # tracker.
    import logging as _logging

    _otel_sdk_logger = _logging.getLogger("opentelemetry.trace")
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

    Caveat: if `setup_tracing` has not been called, the OTel SDK returns a
    no-op tracer and `span` is a no-op. Attributes set on a no-op span
    are silently lost — callers should not rely on attribute presence
    (the OTel SDK guarantees the contract: a no-op span returns False
    from `is_recording()` and discards `set_attribute` calls).
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
    """Return a meter from the global MeterProvider for creating custom instruments.

    Safe to call before ``setup_tracing()`` — returns a no-op meter.

    The instrumentation-scope name resolves with the same precedence
    ``setup_tracing`` uses for the resource's ``service.name``:
    ``OTEL_SERVICE_NAME`` first, then the legacy ``SERVICE_NAME``. This
    function takes no arguments — ``setup_tracing`` is what accepts a
    per-service default, and compose supplies the OTel-spec var instead.
    Reading ``SERVICE_NAME`` alone gave every Python service the scope
    name ``"unknown"`` while its traces carried the real name, so
    instruments could not be attributed per service.
    """
    return metrics.get_meter(
        os.getenv("OTEL_SERVICE_NAME") or os.getenv("SERVICE_NAME", "unknown"),
        os.getenv("OTEL_SERVICE_VERSION") or os.getenv("SERVICE_VERSION", "1.0.0"),
    )


def shutdown() -> None:
    """Flush and shut down the global TracerProvider and MeterProvider
    (best-effort)."""
    global _provider, _meter_provider
    if _provider is None and _meter_provider is None:
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


def _reset() -> None:
    """Reset module state. Only for testing."""
    global _provider, _meter_provider
    _provider = None
    _meter_provider = None


def _sigterm_handler(signum, frame):
    shutdown()
    sys.exit(0)
