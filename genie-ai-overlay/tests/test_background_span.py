"""Tests for `tracing.background_span` — the Python helper that wraps
background emitters (periodic tasks, module-load init, post-request
background tasks) in a fresh OTel ROOT span AND sets it as the active
context, so emitted logs carry a real `trace_id` instead of being orphaned
or correlated to a closed parent span.

Difference vs `with_span`:
    - `with_span` uses `tracer.start_span` — does NOT make the span active,
      so logs emitted inside do not inherit the span's `trace_id`.
    - `background_span` uses `tracer.start_as_current_span` — both starts
      and activates the span. Logs emitted inside the `with` block (and
      any code they call) carry the live `trace_id`.

Uses the real OTel SDK (`InMemorySpanExporter` + `TracerProvider`) so the
suite asserts the helper actually drives the SDK contract — not just that
the context manager's `__enter__` ran. A separate fixture
(`fake_tracer` / `_FakeTracer`) covers the pre-setup (no provider) path
where the SDK returns a no-op tracer.

Tests run via `pytest tests/test_background_span.py` from the
`genie-ai-overlay/` directory.
"""

import logging
import sys
from pathlib import Path

import pytest

# Make `genie-ai-overlay/` importable so `import tracing` resolves whether
# the test is invoked from a worktree (cwd) or from the package dir.
OVERLAY_DIR = Path(__file__).resolve().parent.parent
if str(OVERLAY_DIR) not in sys.path:
    sys.path.insert(0, str(OVERLAY_DIR))

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import tracing  # noqa: E402


@pytest.fixture
def real_tracer(monkeypatch):
    """Wire a real OTel SDK TracerProvider + InMemorySpanExporter behind
    the `trace.get_tracer(...)` lookup. Tests then assert against the
    actual emitted spans.

    Returns the exporter — `exporter.get_finished_spans()` yields the
    spans the helper produced.

    Implementation note: `otel_trace.set_tracer_provider()` is a once-only
    operation (the OTel SDK uses a `Once` guard — subsequent calls are
    silently ignored). To get a fresh provider per test we go directly
    to `provider.get_tracer(name)` and patch `tracing.get_tracer` to
    return that tracer. This bypasses the global tracer registry, which
    is exactly what we want for test isolation.
    """
    provider = TracerProvider()
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    tracer = provider.get_tracer("test.background_span")
    monkeypatch.setattr(tracing, "get_tracer", lambda name=None: tracer)

    yield exporter

    provider.shutdown()
    exporter.clear()


class _FakeNoOpSpan:
    """No-op span matching the OTel SDK contract used when no provider
    is configured. Mirrors the SDK's `_NoOpSpan` for the attributes the
    helper + tests touch."""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def record_exception(self, _):
        pass

    def set_status(self, _):
        pass

    def set_attribute(self, *_args, **_kwargs):
        pass

    def end(self):
        pass

    def update_name(self, _):
        pass

    def is_recording(self):
        return False


class _FakeNoOpTracer:
    def start_as_current_span(self, name, attributes=None):
        return _FakeNoOpSpan()


@pytest.fixture
def noop_tracer(monkeypatch):
    """Replace the SDK tracer with a no-op tracer — exercises the
    `setup_tracing has not been called` path (the helper must still
    yield a span-shaped object without raising).
    """
    monkeypatch.setattr(tracing, "get_tracer", lambda name=None: _FakeNoOpTracer())
    yield


# ---------------------------------------------------------------------------
# Real SDK coverage — asserts the helper drives the actual OTel pipeline
# ---------------------------------------------------------------------------


def test_background_span_emits_span_with_expected_name(real_tracer):
    with tracing.background_span("dataprep.init"):
        pass

    spans = real_tracer.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "dataprep.init"


def test_background_span_passes_constructor_attributes(real_tracer):
    with tracing.background_span(
        "retriever.healthcheck",
        attributes={"interval_s": 60, "endpoint": "arangodb"},
    ):
        pass

    span = real_tracer.get_finished_spans()[0]
    assert span.attributes["interval_s"] == 60
    assert span.attributes["endpoint"] == "arangodb"


def test_background_span_yields_span_for_attribute_set(real_tracer):
    """Caller can set attributes on the yielded span — the helper is
    not just a wrapper, it exposes the live span to the body."""
    with tracing.background_span("dataprep.batch.process") as span:
        span.set_attribute("chunk_count", 42)

    span = real_tracer.get_finished_spans()[0]
    assert span.attributes["chunk_count"] == 42


def test_background_span_makes_span_active_for_context(real_tracer):
    """The active-context claim is what distinguishes this helper from
    `with_span`. Verify by checking `trace.get_current_span()` returns
    the active span (its `trace_id` matches the helper's emitted span)
    inside the `with` block."""
    with tracing.background_span("crawl.poll"):
        # `trace.get_current_span()` must return a span whose trace_id
        # matches the span the helper just started.
        from opentelemetry.trace import get_current_span

        current = get_current_span()
        ctx = current.get_span_context()
        assert ctx.trace_id != 0, "expected an active (non-zero) trace_id"

    # And the emitted span must carry that same trace_id.
    finished = real_tracer.get_finished_spans()[0]
    assert finished.get_span_context().trace_id == ctx.trace_id


def test_background_span_propagates_trace_id_across_block_boundaries(real_tracer):
    """A nested `with background_span(...)` must reuse the SAME trace_id
    (root span from the outer block stays active across the inner block)
    so emitted logs correlate end-to-end."""
    outer_trace_id = None
    inner_trace_id = None

    with tracing.background_span("outer.task") as outer_span:
        outer_trace_id = outer_span.get_span_context().trace_id
        with tracing.background_span("inner.task") as inner_span:
            inner_trace_id = inner_span.get_span_context().trace_id

    assert outer_trace_id != 0
    # Inner span inherits the outer's trace context (same trace_id,
    # different span_id) — this is what keeps nested background logs
    # correlate-able on the VictoriaLogs side.
    assert inner_trace_id == outer_trace_id

    finished = real_tracer.get_finished_spans()
    # Spans are reported in end-order: inner ends first (stack unwinds),
    # then outer. Same trace_id, different span_id — both correlate.
    assert sorted(s.name for s in finished) == ["inner.task", "outer.task"]


def test_background_span_records_exception_and_marks_error(real_tracer):
    """OTel SDK contract: a span that raises must have its exception
    recorded + status set to ERROR before the span ends. The helper
    relies on `start_as_current_span`'s context manager to do this."""
    boom = RuntimeError("arangodb down")

    with pytest.raises(RuntimeError) as exc_info, tracing.background_span("db.healthcheck"):
        raise boom

    assert exc_info.value is boom
    span = real_tracer.get_finished_spans()[0]
    assert span.name == "db.healthcheck"
    assert span.status.status_code.name == "ERROR"
    # The recorded exception is stored as an event with the exception type
    events = [e for e in span.events if e.name == "exception"]
    assert len(events) == 1
    assert "arangodb down" in str(events[0].attributes)


def test_background_span_does_not_suppress_exceptions(real_tracer):
    """Standard Python contextmanager semantics: exceptions inside the
    block must NOT be silenced — verify by raising and confirming the
    span still emits (i.e. the helper called `end()` rather than
    swallowing the exception path)."""
    with pytest.raises(ValueError), tracing.background_span("some.task"):
        raise ValueError("must propagate")

    assert len(real_tracer.get_finished_spans()) == 1


def test_background_span_attributes_set_on_yielded_span_land_on_span(real_tracer):
    """End-to-end: attribute mutation through the yielded span reaches
    the exporter — verifying the OTel SDK accepts `set_attribute` on
    the same instance the helper yielded."""
    with tracing.background_span("dataprep.batch") as span:
        span.set_attribute("chunks", 5)
        span.set_attribute("duration_ms", 123)
        span.set_attribute("file_id", "abc-123")

    finished = real_tracer.get_finished_spans()[0].attributes
    assert finished["chunks"] == 5
    assert finished["duration_ms"] == 123
    assert finished["file_id"] == "abc-123"


# ---------------------------------------------------------------------------
# Pre-setup coverage — no provider installed; helper must still work
# ---------------------------------------------------------------------------


def test_background_span_works_when_tracing_is_disabled(noop_tracer):
    """If `setup_tracing` has not been called, the OTel SDK returns a
    no-op tracer. The helper must still function (no span emitted, but
    the `with` block runs, exceptions still propagate)."""
    with tracing.background_span("test.span"):
        pass  # no exception, no span state to inspect

    # Exception propagation still works without a real tracer.
    with pytest.raises(RuntimeError), tracing.background_span("test.span"):
        raise RuntimeError("propagated through no-op")


def test_background_span_logs_inside_block_do_not_raise(noop_tracer, caplog):
    """A real Python logger emitting inside the helper's `with` block
    must NOT crash when no provider is installed — verifies the no-op
    path doesn't interfere with the logging pipeline.

    The actual `trace_id` stamping is the `TraceContextFilter`'s job;
    this test just asserts the helper does not break log emission on
    the no-op path."""
    logger = logging.getLogger("test.background_span.noop")
    logger.setLevel(logging.DEBUG)

    with tracing.background_span("noop.test"):
        logger.info("inside block")

    assert "inside block" in [r.getMessage() for r in caplog.records]


# NOTE: P10 (background_span exception handling) was investigated and
# REVOKED during the MR #383 multi-perspective review triage. The OTel
# Python SDK's `start_as_current_span` context manager auto-records
# exceptions on the span and flips status to ERROR on exit — verified
# by the existing `test_background_span_records_exception_and_marks_error`
# test added in commit 96f8ae5214. The original `yield span` body was
# correct; no production-side change is needed. The "P10" tests below
# were removed because they asserted via a mocked span and would have
# double-recorded the auto-recorded exception (2 events instead of 1).
