# Copyright (c) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Tests for Python log assertion helpers."""

import os
import re
import sys

import pytest

# Ensure the log-assertions directory is on the path
sys.path.insert(0, os.path.dirname(__file__))

from log_assertions import (
    LOG_SCHEMA_FIELDS,
    assert_log_contains,
    assert_log_schema,
    assert_non_zeroed_trace_id,
)


VALID_ENTRY = {
    "timestamp": "2026-05-28T14:30:00.123Z",
    "level": "info",
    "service": "genieai-chatqna",
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "span_id": "00f067aa0ba902b7",
    "message": "test message",
}


class TestAssertLogContains:
    def test_passes_when_all_fields_match(self):
        assert_log_contains(VALID_ENTRY, trace_id="4bf92f3577b34da6a3ce929d0e0e4736", level="info")

    def test_passes_with_regex_values(self):
        assert_log_contains(VALID_ENTRY, trace_id=re.compile(r"^[0-9a-f]{32}$"), message=re.compile(r"test"))

    def test_passes_with_substring_match(self):
        assert_log_contains(VALID_ENTRY, message="test")

    def test_throws_when_field_missing(self):
        with pytest.raises(AssertionError, match='Missing field "nonexistent"'):
            assert_log_contains(VALID_ENTRY, nonexistent="value")

    def test_throws_when_value_does_not_match(self):
        with pytest.raises(AssertionError, match="does not contain"):
            assert_log_contains(VALID_ENTRY, level="error")

    def test_throws_when_regex_does_not_match(self):
        with pytest.raises(AssertionError, match="does not match pattern"):
            assert_log_contains(VALID_ENTRY, trace_id=re.compile(r"^abc$"))

    def test_throws_for_non_dict(self):
        with pytest.raises(AssertionError, match="must be a dict"):
            assert_log_contains("not a dict", level="info")

    def test_throws_for_none(self):
        with pytest.raises(AssertionError, match="must be a dict"):
            assert_log_contains(None, level="info")

    def test_passes_with_exact_match(self):
        assert_log_contains(VALID_ENTRY, span_id="00f067aa0ba902b7")


class TestAssertLogSchema:
    def test_passes_for_valid_entry(self):
        assert_log_schema(VALID_ENTRY)

    def test_passes_for_error_level(self):
        assert_log_schema({**VALID_ENTRY, "level": "error"})

    def test_passes_for_warn_level(self):
        assert_log_schema({**VALID_ENTRY, "level": "warning"})

    @pytest.mark.parametrize("field", LOG_SCHEMA_FIELDS)
    def test_throws_when_required_field_missing(self, field):
        entry = dict(VALID_ENTRY)
        del entry[field]
        with pytest.raises(AssertionError, match=f'Missing required schema field "{field}"'):
            assert_log_schema(entry)

    def test_throws_for_invalid_trace_id_format(self):
        with pytest.raises(AssertionError, match="trace_id must be a 32-char hex string"):
            assert_log_schema({**VALID_ENTRY, "trace_id": "not-hex"})

    def test_throws_for_invalid_span_id_format(self):
        with pytest.raises(AssertionError, match="span_id must be a 16-char hex string"):
            assert_log_schema({**VALID_ENTRY, "span_id": "short"})

    def test_throws_for_invalid_level(self):
        with pytest.raises(AssertionError, match="level must be one of"):
            assert_log_schema({**VALID_ENTRY, "level": "verbose"})

    def test_passes_for_zeroed_ids(self):
        assert_log_schema({**VALID_ENTRY, "trace_id": "0" * 32, "span_id": "0" * 16})


class TestAssertNonZeroedTraceId:
    def test_passes_for_valid_non_zeroed_id(self):
        assert_non_zeroed_trace_id("4bf92f3577b34da6a3ce929d0e0e4736")

    def test_throws_for_zeroed_id(self):
        with pytest.raises(AssertionError, match="must not be zeroed"):
            assert_non_zeroed_trace_id("0" * 32)

    def test_throws_for_invalid_format(self):
        with pytest.raises(AssertionError, match="must be a 32-char hex string"):
            assert_non_zeroed_trace_id("abc")


class TestLogSchemaFields:
    def test_contains_all_required_fields(self):
        assert LOG_SCHEMA_FIELDS == ("timestamp", "level", "service", "trace_id", "span_id", "message")
