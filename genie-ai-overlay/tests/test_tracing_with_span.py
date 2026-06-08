"""Tests for tracing.with_span context manager."""

import pytest
from unittest.mock import MagicMock, patch
from tracing import with_span


class TestWithSpan:
    """Tests for with_span context manager."""

    def test_returns_span_on_enter(self):
        """Context manager yields a span object."""
        with with_span("test.operation") as span:
            assert span is not None

    def test_returns_result_normally(self):
        """Code inside context manager runs normally."""
        result = None
        with with_span("test.op") as span:
            result = 42
        assert result == 42

    def test_propagates_exceptions(self):
        """Exceptions are not suppressed."""
        with pytest.raises(ValueError, match="test error"):
            with with_span("test.error") as span:
                raise ValueError("test error")

    def test_span_accepts_set_attribute(self):
        """Span accepts set_attribute without error (no-op or real)."""
        with with_span("test.attrs") as span:
            span.set_attribute("key", "value")
            span.set_attribute("count", 5)

    def test_tracer_name_parameter(self):
        """Custom tracer name is accepted without error."""
        with with_span("test.op", tracer_name="custom.module") as span:
            span.set_attribute("test", True)

    def test_attributes_parameter(self):
        """Initial attributes are accepted without error."""
        with with_span("test.attrs", attributes={"init.key": "val"}) as span:
            span.set_attribute("extra", True)

    def test_no_exception_ends_normally(self):
        """Normal execution path completes without error."""
        executed = False
        with with_span("test.normal") as span:
            executed = True
        assert executed
