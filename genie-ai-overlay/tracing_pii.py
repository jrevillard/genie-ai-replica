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

from opentelemetry.sdk._logs import LogRecord
from opentelemetry.sdk._logs.export import LogRecordProcessor

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


def _redact_body(body: Any) -> Any:
    """Best-effort body redaction. Bodies may be `str`, `dict`, `list`,
    or arbitrary Python objects (LogRecord.body is typed as Any). For
    structured bodies we walk the dict/list; for strings we run the
    regex set; for anything else we leave it alone (the LogRecord will
    still be exported, but the inner processor's exporter may fail
    safely on unsupported types).
    """
    if isinstance(body, str):
        result = body
        for pattern, replacement in _BODY_PATTERNS:
            result = pattern.sub(replacement, result)
        return result
    if isinstance(body, dict):
        return {k: _redact_body(v) for k, v in body.items()}
    if isinstance(body, (list, tuple)):
        return type(body)(_redact_body(v) for v in body)
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

    def on_emit(self, log_record: LogRecord) -> None:
        # Attribute redaction. `LogRecord.attributes` is a dict — we
        # iterate and replace sensitive values in place.
        if log_record.attributes:
            try:
                for key in list(log_record.attributes.keys()):
                    if _is_sensitive_key(key):
                        log_record.attributes[key] = _REDACTED_PLACEHOLDER
            except Exception as exc:  # pragma: no cover — defensive
                # Security-control failure must be visible.
                logging.getLogger(__name__).warning(
                    "PII attribute redaction failed: %s", exc
                )

        # Body redaction. `LogRecord.body` is typed as Any — only strings
        # are safe to mutate. For other types we leave the inner
        # processor to handle.
        if isinstance(log_record.body, str):
            try:
                log_record.body = _redact_body(log_record.body)
            except Exception as exc:  # pragma: no cover — defensive
                logging.getLogger(__name__).warning(
                    "PII body redaction failed: %s", exc
                )

        # Delegate to the inner processor (typically BatchSpanProcessor
        # wrapping the OTLP exporter).
        self._inner.on_emit(log_record)

    def shutdown(self) -> None:
        # Delegate so the inner processor's flush + shutdown still runs.
        self._inner.shutdown()

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return self._inner.force_flush(timeout_millis)
