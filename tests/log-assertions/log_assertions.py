# Copyright (c) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Structured log assertion helpers for Python service log output.

Usage::

    from log_assertions import assert_log_contains, assert_log_schema
    assert_log_contains(log_entry, trace_id="4bf92f3577b34da6a3ce929d0e0e4736")
"""

import re
from typing import Any

LOG_SCHEMA_FIELDS = ("timestamp", "level", "service", "trace_id", "span_id", "message")

_TRACE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_SPAN_ID_RE = re.compile(r"^[0-9a-f]{16}$")
_VALID_LEVELS = ("debug", "info", "warning", "warn", "error", "critical")


def assert_log_contains(log_entry: dict[str, Any], **expected: Any) -> None:
    """Assert that a structured log entry contains expected fields.

    Args:
        log_entry: Parsed log entry (dict).
        **expected: Key-value pairs to match. String values use substring match.

    Raises:
        AssertionError: If any expected field is missing or does not match.
    """
    assert isinstance(log_entry, dict), f"log_entry must be a dict, got {type(log_entry)}"

    for key, value in expected.items():
        assert key in log_entry, (
            f'Missing field "{key}" in log entry. Available: {", ".join(log_entry.keys())}'
        )

        if isinstance(value, type(re.compile(""))):
            assert value.search(str(log_entry[key])), (
                f'Field "{key}" value "{log_entry[key]}" does not match pattern {value.pattern}'
            )
        elif isinstance(value, str):
            assert value in str(log_entry[key]), (
                f'Field "{key}" value "{log_entry[key]}" does not contain "{value}"'
            )
        else:
            assert log_entry[key] == value, (
                f'Field "{key}" expected {value!r}, got {log_entry[key]!r}'
            )


def assert_log_schema(log_entry: dict[str, Any]) -> None:
    """Assert that a log entry conforms to the consistent log schema.

    Required fields: timestamp, level, trace_id, span_id, message.

    Raises:
        AssertionError: If any required field is missing or malformed.
    """
    assert isinstance(log_entry, dict), f"log_entry must be a dict, got {type(log_entry)}"

    for field in LOG_SCHEMA_FIELDS:
        assert field in log_entry, f'Missing required schema field "{field}" in log entry'

    assert _TRACE_ID_RE.match(log_entry["trace_id"]), (
        f'trace_id must be a 32-char hex string, got "{log_entry["trace_id"]}"'
    )
    assert _SPAN_ID_RE.match(log_entry["span_id"]), (
        f'span_id must be a 16-char hex string, got "{log_entry["span_id"]}"'
    )
    assert log_entry["level"].lower() in _VALID_LEVELS, (
        f'level must be one of {", ".join(_VALID_LEVELS)}, got "{log_entry["level"]}"'
    )


def assert_non_zeroed_trace_id(trace_id: str) -> None:
    """Assert that a trace ID is valid and non-zeroed.

    Raises:
        AssertionError: If the trace ID is zeroed or malformed.
    """
    assert _TRACE_ID_RE.match(trace_id), (
        f'trace_id must be a 32-char hex string, got "{trace_id}"'
    )
    assert trace_id != "0" * 32, "trace_id must not be zeroed (no active span)"
