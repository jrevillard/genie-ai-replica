"""PII redaction for OTel SDK log records.

Mirrors `components/{gov-chat-backend,document-repository}/src/tracing-pii-logs.js`
(Node.js side) for Python OTel logs. Wraps an inner `LogRecordProcessor`
(typically `BatchLogRecordProcessor`) and scrubs sensitive attributes
plus body text BEFORE the inner processor sees the record — user
queries, emails, tokens, session IDs never reach VictoriaLogs.

Usage::

    from opentelemetry.sdk._logs import LoggerProvider, set_logger_provider
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from tracing_pii import PIIRedactingLogRecordProcessor

    provider = LoggerProvider()
    inner = BatchLogRecordProcessor(OTLPLogExporter(endpoint=...))
    provider.add_log_record_processor(PIIRedactingLogRecordProcessor(inner))
    set_logger_provider(provider)

The KEY-PATTERN list is shared with `tracing._PII_KEY_PATTERNS` (which
also drives span attribute redaction via `sanitize_attributes`) — we
import it here to avoid drift. The body-text patterns are local to
this file (no Node equivalent for structured body walking — Node side
relies on the regex `redactValue` walker in `tracing-pii.js`).

What this does NOT cover (matching the Node side):
- The Python `TraceContextFilter` pre-pends `trace_id="..."` and
  `span_id="..."` into the body text — those are not redacted (they
  are OTel correlation context, not user data).
- The Python OTel SDK's built-in attribute validation. We rely on
  `LogRecord.set_attribute` to scrub a key/value pair in place.

Errors during redaction are NOT swallowed silently (a security control
that fails silently is itself a finding) — we log a warning to the
root logger so operators see redaction failures in `docker logs`.
"""

import logging
import re
from typing import Any

from opentelemetry.sdk._logs import LogRecordProcessor

# Reuse the canonical key patterns from `tracing.py` — single source
# of truth for both span attribute redaction (`sanitize_attributes`)
# AND log record attribute redaction (this redactor).
from tracing import _is_sensitive_key  # noqa: E402

# Body-text patterns. Mirrors `redactValue` regex set in the Node side
# `tracing-pii.js`.
_BODY_PATTERNS = [
    # RFC-5321 email — most permissive match (handles display names too)
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[REDACTED_EMAIL]"),
    # Bearer / OAuth tokens (Authorization header value or JSON field)
    (re.compile(r"(?i)(Bearer\s+|bearer\s+)[A-Za-z0-9._\-+/=]{8,}"), "[REDACTED_BEARER]"),
    # JWT-shaped strings (three base64url segments separated by dots)
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"), "[REDACTED_JWT]"),
    # API keys with common prefixes (sk-..., ghp_..., AKIA...)
    (re.compile(r"\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{36}|AKIA[A-Z0-9]{16})\b"), "[REDACTED_API_KEY]"),
    # 32+ char hex strings that look like secrets
    (re.compile(r"\b[a-f0-9]{32,}\b"), "[REDACTED_HEX]"),
]

_REDACTED_PLACEHOLDER = "[REDACTED]"


def _redact_body(body: Any, _seen: set | None = None) -> Any:
    """Best-effort body redaction. Bodies may be `str`, `dict`, `list`,
    or arbitrary Python objects (LogRecord.body is typed as Any). We
    always run the regex set on strings (not gated by `isinstance(str)`
    at the call site — the guard used to live in `on_emit` and let
    dict/list/tuple bodies bypass entirely). Structured bodies walk
    recursively; anything else is left verbatim.

    `_seen` (set of `id()`) guards against circular references — a
    self-referential dict or list would otherwise recurse forever and
    crash the OTel log pipeline with `RecursionError`. The marker
    `[CIRCULAR]` makes the cycle visible in VictoriaLogs so operators
    can spot the offending caller.
    """
    if _seen is None:
        _seen = set()
    body_id = id(body)
    if body_id in _seen:
        return "[CIRCULAR]"
    # Only track mutable containers that could legitimately cycle.
    if isinstance(body, (dict, list, tuple)):
        _seen.add(body_id)
    if isinstance(body, str):
        result = body
        for pattern, replacement in _BODY_PATTERNS:
            result = pattern.sub(replacement, result)
        return result
    if isinstance(body, dict):
        return {k: _redact_body(v, _seen) for k, v in body.items()}
    if isinstance(body, (list, tuple)):
        return type(body)(_redact_body(v, _seen) for v in body)
    return body


class PIIRedactingLogRecordProcessor(LogRecordProcessor):
    """Wraps an inner processor and redacts PII before delegation.

    The redaction happens in-place on the `LogRecord` (we mutate
    attributes and body before calling the inner `on_emit`). The inner
    processor then sees the already-redacted record. We do NOT clone the
    record — cloning is unsupported by `LogRecord` per the OTel Python
    SDK contract.

    @param inner The wrapped processor (typically
                  `BatchLogRecordProcessor` with the OTel log exporter).
    """

    def __init__(self, inner: LogRecordProcessor) -> None:
        self._inner = inner

    def emit(self, log_data) -> None:
        # OTel SDK >= 1.40 renamed `on_emit` → `emit` on the
        # LogRecordProcessor ABC. Older SDKs (e.g. 1.36.0 still pinned
        # in some OPEA images) still call `on_emit` — defining both
        # keeps the class concrete on either ABC version, so
        # `setup_logging()` succeeds regardless of which SDK is in
        # the runtime image. Same implementation either way.
        log_record = log_data.log_record

        # Attribute redaction — both keys AND values.
        #
        # 1. Top-level key check: any key matching the sensitive patterns
        #    (password, token, session_id, etc.) gets replaced with
        #    `[REDACTED]` to match the Node-side contract.
        # 2. Value scan: even non-sensitive keys can carry PII in their
        #    string values (e.g. `description: "User foo@bar.com"` or
        #    `context.user.email: "x@y.com"`). Recurse via `_redact_body`
        #    so nested strings get the body-text regex applied. The
        #    previous implementation only checked top-level keys — nested
        #    PII leaked to VictoriaLogs.
        if log_record.attributes:
            try:
                for key in list(log_record.attributes.keys()):
                    value = log_record.attributes[key]
                    if _is_sensitive_key(key):
                        # Sensitive key → placeholder. Don't bother
                        # scanning the value — it's already redacted.
                        log_record.attributes[key] = _REDACTED_PLACEHOLDER
                    elif isinstance(value, str):
                        log_record.attributes[key] = _redact_body(value)
                    elif isinstance(value, (dict, list, tuple)):
                        # Structured value (e.g. `body: { user: { email: ... } }`)
                        # recurse so nested PII is caught.
                        log_record.attributes[key] = _redact_body(value)
            except Exception as exc:  # pragma: no cover — defensive
                # Security-control failure must be visible.
                logging.getLogger(__name__).warning(
                    "PII attribute redaction failed (attrs=%d): %s", len(log_record.attributes or {}), exc
                )

        # Body redaction — apply `_redact_body` unconditionally (handles
        # str / dict / list / tuple bodies). The previous isinstance(str)
        # guard let dict/list/tuple bodies bypass entirely.
        if log_record.body is not None:
            try:
                log_record.body = _redact_body(log_record.body)
            except Exception as exc:  # pragma: no cover — defensive
                logging.getLogger(__name__).warning("PII body redaction failed: %s", exc)

        # Delegate to the inner processor (typically BatchLogRecordProcessor
        # wrapping the OTLP exporter). Wrap in try/except so a failure in
        # the inner processor never escapes (LogRecordProcessor contract
        # — errors must not propagate to the SDK pipeline). `getattr` picks
        # the right method name (`emit` in SDK >= 1.40, `on_emit` in older).
        try:
            dispatch = getattr(self._inner, "emit", None) or self._inner.on_emit
            dispatch(log_data)
        except Exception as exc:  # pragma: no cover — defensive
            logging.getLogger(__name__).warning("Inner LogRecordProcessor.emit failed: %s", exc)

    # Legacy SDK (< 1.40) calls `on_emit` instead of `emit`. Defining both
    # makes the class concrete on either ABC version. Both dispatch into
    # the same body via the `emit` method above — keep them aliased here.
    def on_emit(self, log_data) -> None:  # noqa: D401 — legacy alias
        return self.emit(log_data)

    def shutdown(self) -> None:
        # Delegate so the inner processor's flush + shutdown still runs.
        self._inner.shutdown()

    def force_flush(self, timeout_millis: int = 15_000) -> bool:
        return self._inner.force_flush(timeout_millis)
