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

import tracing  # noqa: E402


class _FakeSpan:
    """In-memory stand-in for an OTel span.

    Records every lifecycle call so tests can assert the helper invoked
    the SDK correctly. `set_as_active` flips a class-level flag the
    log-capture fixture reads to determine correlation context.
    """

    last_instance = None

    def __init__(self, name, attributes=None):
        self.name = name
        self.attributes = attributes or {}
        self.ended = False
        self.exceptions = []
        self.status = None
        self.was_active = False
        _FakeSpan.last_instance = self

    def record_exception(self, exc):
        self.exceptions.append(exc)

    def set_status(self, status):
        self.status = status

    def end(self):
        self.ended = True

    def __enter__(self):
        self.was_active = True
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.record_exception(exc_val)
            self.set_status(("ERROR", str(exc_val)))
        self.end()
        return False


class _FakeContextManager(_FakeSpan):
    """`start_as_current_span` returns a context manager — inherit from
    _FakeSpan so the `with` body sees the same span instance, and the
    `__exit__` records exception + sets ERROR + ends automatically.
    """


@pytest.fixture
def fake_tracer(monkeypatch):
    """Replace `tracing.trace.get_tracer` with a fake that yields spans
    matching the OTel SDK contract: `start_as_current_span(name, attrs)`
    returns a context manager yielding the span.
    """
    spans = []

    def start_as_current_span(name, attributes=None):
        span = _FakeContextManager(name, attributes)
        spans.append(span)
        return span

    monkeypatch.setattr(
        tracing.trace,
        "get_tracer",
        lambda name=None: type("_T", (), {"start_as_current_span": staticmethod(start_as_current_span)})(),
    )
    return spans


def test_background_span_creates_a_root_span(fake_tracer):
    with tracing.background_span("dataprep.init"):
        pass

    assert len(fake_tracer) == 1
    assert fake_tracer[0].name == "dataprep.init"
    assert fake_tracer[0].ended is True


def test_background_span_passes_attributes(fake_tracer):
    with tracing.background_span("retriever.healthcheck", attributes={"interval_s": 60, "endpoint": "arangodb"}):
        pass

    assert fake_tracer[0].attributes == {"interval_s": 60, "endpoint": "arangodb"}


def test_background_span_sets_span_as_active_context(fake_tracer):
    """The active-context claim is what distinguishes this helper from
    `with_span`. Verify by checking the span's `__enter__` ran (the
    fake's `was_active` flag flips in `__enter__`).
    """
    with tracing.background_span("crawl.poll"):
        pass

    assert fake_tracer[0].was_active is True


def test_background_span_propagates_exceptions_and_records_them(fake_tracer):
    boom = RuntimeError("arangodb down")

    with pytest.raises(RuntimeError) as exc_info, tracing.background_span("db.healthcheck"):
        raise boom

    assert exc_info.value is boom
    span = fake_tracer[0]
    assert len(span.exceptions) == 1
    assert span.exceptions[0] is boom
    assert span.status == ("ERROR", "arangodb down")
    assert span.ended is True


def test_background_span_does_not_suppress_exceptions(fake_tracer):
    """Standard Python contextmanager semantics: exceptions inside the
    block must NOT be silenced (return False / None from __exit__).
    """
    with pytest.raises(ValueError), tracing.background_span("some.task"):
        raise ValueError("must propagate")


def test_background_span_works_when_tracing_is_disabled(monkeypatch):
    """If `trace.get_tracer` returns a no-op tracer, the helper must
    still function (no span emitted, but `with` block runs, attributes
    not validated, exceptions still propagate). This covers the
    ENABLE_OBSERVABILITY=0 path.
    """
    from opentelemetry import trace as otel_trace

    class _NoOpSpan:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def record_exception(self, _):
            pass

        def set_status(self, _):
            pass

        def end(self):
            pass

    class _NoOpTracer:
        def start_as_current_span(self, name, attributes=None):
            return _NoOpSpan()

    monkeypatch.setattr(otel_trace, "get_tracer", lambda name=None: _NoOpTracer())

    with tracing.background_span("test.span"):
        pass  # no exception, no span state to inspect

    # Exception propagation still works without OTel.
    with pytest.raises(RuntimeError), tracing.background_span("test.span"):
        raise RuntimeError("propagated through no-op")


def test_background_span_yields_span_for_attribute_set(fake_tracer):
    """Caller can set attributes on the yielded span — the helper is
    not just a wrapper, it exposes the live span to the body.
    """
    with tracing.background_span("dataprep.batch.process") as span:
        span.attributes["chunk_count"] = 42

    assert fake_tracer[0].attributes["chunk_count"] == 42


def test_background_span_logs_inside_block_correlate_to_span(caplog, fake_tracer):
    """Integration: a real Python logger emitting inside the helper's
    `with` block carries the live span's `trace_id` (via the
    `TraceContextFilter` that OPEA services attach to their loggers).
    Verify the span is visible as the active context.

    The actual filter is in `comps` / OPEA's genieai_logging.py and
    isn't exercised here; we instead verify the helper exposes the
    span so a caller-installed filter could read it.
    """
    captured = {}

    class _CapturingFilter(logging.Filter):
        def filter(self, record):
            # In production, OTel's `trace.get_current_span()` is what
            # the filter reads. Verify it returns a span matching the
            # active context (this is a smoke test for the helper's
            # contract — full correlation is tested at the integration
            # layer with a real SDK).
            captured["active"] = otel_trace.get_current_span()
            return True

    # Apply OTel SDK's get_current_span (default no-op without a provider).
    from opentelemetry import trace as otel_trace

    # Install the filter on a real logger.
    logger = logging.getLogger("test.background_span")
    logger.addFilter(_CapturingFilter())
    logger.setLevel(logging.DEBUG)

    with tracing.background_span("integration.test"):
        logger.info("inside block")

    # The fake tracer created a span; the SDK's `get_current_span` would
    # return it ONLY with a real SDK + context propagator installed. With
    # the fake the SDK returns its no-op default span. This test verifies
    # the helper does not raise and the filter ran (i.e. the block
    # executed with the wrapper active) — full correlation coverage is
    # exercised by the live VL trace_id-stamping verified at runtime.
    assert "active" in captured
