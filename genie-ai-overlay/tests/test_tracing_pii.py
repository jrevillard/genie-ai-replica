"""Tests for `tracing_pii.PIIRedactingLogRecordProcessor` — the Python
analog of `tracing-pii-logs.js` on the Node side.

Mirrors the Node-side test surface (sensitive-key attribute scrubbing +
body-text PII redaction). Critical: the redactor is the security
boundary between user content and VictoriaLogs — failures must be
visible (a silent redaction failure is itself a security finding).
"""

import sys
from pathlib import Path

import pytest

OVERLAY_DIR = Path(__file__).resolve().parent.parent
if str(OVERLAY_DIR) not in sys.path:
    sys.path.insert(0, str(OVERLAY_DIR))

from tracing_pii import PIIRedactingLogRecordProcessor  # noqa: E402


class _FakeLogRecord:
    """Minimal stand-in for OTel SDK LogRecord — has the attributes/body
    fields the redactor touches and tracks calls to the inner processor.
    """
    def __init__(self, *, attributes=None, body=""):
        self.attributes = dict(attributes or {})
        self.body = body


class _FakeProcessor:
    """Inner processor that records the records it sees (post-redaction)."""
    def __init__(self):
        self.received = []
        self.shutdown_called = False
        self.force_flush_return = True

    def on_emit(self, log_record):
        self.received.append({
            "attributes": dict(log_record.attributes),
            "body": log_record.body,
        })

    def shutdown(self):
        self.shutdown_called = True

    def force_flush(self, timeout_millis=30_000):
        return self.force_flush_return


@pytest.fixture
def pipeline():
    inner = _FakeProcessor()
    redactor = PIIRedactingLogRecordProcessor(inner)
    return redactor, inner


# --- attribute redaction ------------------------------------------------

@pytest.mark.parametrize("key", [
    "password", "PASSWORD", "api_key", "api-key", "apiKey",
    "session_id", "session-id", "user_id", "email",
    "user_query", "llm_response", "document_text",
    "auth_token", "Bearer_Token", "secret_value",
    "api_secret", "private_key", "credential_id",
    "openai_api_key", "anthropic_api_key",
])
def test_redacts_known_sensitive_attribute_keys(pipeline, key):
    redactor, inner = pipeline
    record = _FakeLogRecord(attributes={key: "super-secret"})
    redactor.on_emit(record)

    assert len(inner.received) == 1
    assert inner.received[0]["attributes"][key] == "[REDACTED]"


def test_does_not_redact_non_sensitive_keys(pipeline):
    redactor, inner = pipeline
    record = _FakeLogRecord(attributes={
        "level": "info",
        "service": "test",
        "trace_id": "abc123",
        "duration_ms": 100,
        "db.system": "arangodb",
    })
    redactor.on_emit(record)

    assert inner.received[0]["attributes"] == {
        "level": "info",
        "service": "test",
        "trace_id": "abc123",
        "duration_ms": 100,
        "db.system": "arangodb",
    }


def test_preserves_key_when_redacting_value(pipeline):
    """The KEY is kept so downstream dashboards can still filter by
    attribute presence; only the VALUE is replaced.
    """
    redactor, inner = pipeline
    record = _FakeLogRecord(attributes={"session_id": "abc-123-xyz"})
    redactor.on_emit(record)

    # Key still present, value replaced
    assert "session_id" in inner.received[0]["attributes"]
    assert inner.received[0]["attributes"]["session_id"] == "[REDACTED]"


def test_handles_empty_attributes(pipeline):
    redactor, inner = pipeline
    record = _FakeLogRecord()
    redactor.on_emit(record)
    assert inner.received[0]["attributes"] == {}


# --- body redaction ------------------------------------------------------

def test_redacts_email_in_body(pipeline):
    redactor, inner = pipeline
    record = _FakeLogRecord(body="User john.doe@example.com logged in")
    redactor.on_emit(record)
    assert "john.doe@example.com" not in inner.received[0]["body"]
    assert "[REDACTED_EMAIL]" in inner.received[0]["body"]


def test_redacts_bearer_token_in_body(pipeline):
    redactor, inner = pipeline
    record = _FakeLogRecord(body="Authorization: Bearer abc123def456ghi789jkl012mno345pqr")
    redactor.on_emit(record)
    assert "abc123def456ghi789jkl012mno345pqr" not in inner.received[0]["body"]
    assert "[REDACTED_BEARER]" in inner.received[0]["body"]


def test_redacts_jwt_in_body(pipeline):
    redactor, inner = pipeline
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    record = _FakeLogRecord(body=f"token: {jwt}")
    redactor.on_emit(record)
    assert jwt not in inner.received[0]["body"]


def test_redacts_api_key_prefixes(pipeline):
    redactor, inner = pipeline
    record = _FakeLogRecord(body="using sk-proj1234567890abcdefghij")
    redactor.on_emit(record)
    assert "sk-proj1234567890abcdefghij" not in inner.received[0]["body"]


def test_redacts_long_hex_strings(pipeline):
    redactor, inner = pipeline
    # 32+ char hex — matches the SDK's "looks like a secret" pattern
    hex_str = "abcdef0123456789abcdef0123456789"
    record = _FakeLogRecord(body=f"token={hex_str}")
    redactor.on_emit(record)
    assert hex_str not in inner.received[0]["body"]


def test_does_not_redact_short_or_benign_strings(pipeline):
    redactor, inner = pipeline
    # 30-char string (under the 32 threshold) — should pass through
    benign = "trace-id:abc123"  # 11 chars, hex but short
    record = _FakeLogRecord(body=f"msg: {benign}")
    redactor.on_emit(record)
    # The hex redactor only kicks in at 32+ chars — short hex stays
    assert "[REDACTED_HEX]" not in inner.received[0]["body"]


# --- delegate / lifecycle ------------------------------------------------

def test_delegates_to_inner_processor(pipeline):
    redactor, inner = pipeline
    record = _FakeLogRecord(body="hello world")
    redactor.on_emit(record)
    assert len(inner.received) == 1
    assert inner.received[0]["body"] == "hello world"


def test_shutdown_delegates(pipeline):
    redactor, inner = pipeline
    redactor.shutdown()
    assert inner.shutdown_called is True


def test_force_flush_delegates(pipeline):
    redactor, inner = pipeline
    inner.force_flush_return = False
    assert redactor.force_flush(1000) is False


# --- integration: combined attributes + body ------------------------------

def test_redacts_both_attributes_and_body(pipeline):
    redactor, inner = pipeline
    record = _FakeLogRecord(
        attributes={"session_id": "secret-123", "level": "info"},
        body="user john@example.com sent a request",
    )
    redactor.on_emit(record)

    out = inner.received[0]
    assert out["attributes"]["session_id"] == "[REDACTED]"
    assert out["attributes"]["level"] == "info"
    assert "john@example.com" not in out["body"]
    assert "[REDACTED_EMAIL]" in out["body"]


# Regression tests for round-2 review findings: C2e + C2f
# (PII redactor body redaction only fired on str + only top-level
# keys → nested dict PII leaked to VL).


def test_redacts_pii_in_dict_body(pipeline):
    """Dict bodies must be walked recursively (round-2 finding C2e)."""
    redactor, inner = pipeline
    record = _FakeLogRecord(
        body={
            "user": {"email": "john@example.com", "name": "John"},
            "metadata": {"token": "Bearer xyz123abc456def"},
        }
    )
    redactor.on_emit(record)

    out = inner.received[0]
    body = out["body"]
    assert "john@example.com" not in body["user"]["email"]
    assert "[REDACTED_EMAIL]" in body["user"]["email"]
    assert "xyz123abc456def" not in body["metadata"]["token"]
    assert "[REDACTED_BEARER]" in body["metadata"]["token"]
    assert body["user"]["name"] == "John"  # non-PII preserved


def test_redacts_pii_in_attribute_values(pipeline):
    """Non-sensitive key, sensitive VALUE: redaction must scan string values (round-2 finding C2f)."""
    redactor, inner = pipeline
    record = _FakeLogRecord(
        attributes={
            "description": "User john@example.com logged in",
            "context": {"user_email": "x@y.com"},
            "metadata": {"request_id": "Bearer tok1234abcd"},
            "level": "info",
        }
    )
    redactor.on_emit(record)
    out = inner.received[0]["attributes"]
    assert "[REDACTED_EMAIL]" in out["description"]
    assert "john@example.com" not in out["description"]
    assert "[REDACTED_EMAIL]" in out["context"]["user_email"]
    assert "x@y.com" not in out["context"]["user_email"]
    assert "[REDACTED_BEARER]" in out["metadata"]["request_id"]
    assert out["level"] == "info"  # non-PII preserved


def test_redacts_pii_in_list_body(pipeline):
    """List bodies must be walked recursively too."""
    redactor, inner = pipeline
    record = _FakeLogRecord(body=["john@example.com", "no-pii", "Bearer xyz"])
    redactor.on_emit(record)
    out = inner.received[0]["body"]
    assert "[REDACTED_EMAIL]" in out[0]
    assert out[1] == "no-pii"
    assert "[REDACTED_BEARER]" in out[2]


def test_handles_inner_processor_failure(pipeline):
    """Inner processor.on_emit raising must not propagate (LogRecordProcessor contract)."""
    redactor, inner = pipeline
    inner.raise_on_emit = True
    original_on_emit = inner.on_emit

    def on_emit_with_raise(record):
        original_on_emit(record)
        raise RuntimeError("inner exploded")

    inner.on_emit = on_emit_with_raise

    record = _FakeLogRecord(body="hello")
    # Must not raise even if the inner processor throws.
    redactor.on_emit(record)
    assert inner.received[0]["body"] == "hello"


def test_redacts_jwt_in_attribute_value(pipeline):
    """JWT-shaped strings in non-sensitive keys must be caught."""
    redactor, inner = pipeline
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    record = _FakeLogRecord(attributes={"context": {"session": jwt}})
    redactor.on_emit(record)
    assert jwt not in inner.received[0]["attributes"]["context"]["session"]
