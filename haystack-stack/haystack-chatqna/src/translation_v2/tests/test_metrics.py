"""Tests for the Step 6 metrics registry + /metrics endpoint."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from translation_v2.observability import MetricsRegistry, metrics_registry, timed


@pytest.fixture(autouse=True)
def clean_registry():
    metrics_registry().reset()
    yield
    metrics_registry().reset()


class TestCounters:
    def test_counter_starts_empty(self):
        r = MetricsRegistry()
        assert r.render_prometheus() == ""

    def test_counter_inc(self):
        r = MetricsRegistry()
        r.counter_inc("requests_total", provider="openai")
        text = r.render_prometheus()
        assert "# TYPE requests_total counter" in text
        assert 'requests_total{provider="openai"} 1' in text

    def test_counter_accumulates(self):
        r = MetricsRegistry()
        r.counter_inc("x", 3)
        r.counter_inc("x", 4)
        assert "x 7" in r.render_prometheus()

    def test_counter_per_label_set(self):
        r = MetricsRegistry()
        r.counter_inc("req", provider="a")
        r.counter_inc("req", provider="b")
        r.counter_inc("req", provider="a")
        text = r.render_prometheus()
        assert 'req{provider="a"} 2' in text
        assert 'req{provider="b"} 1' in text


class TestHistogram:
    def test_summary_emits_quantiles_count_sum(self):
        r = MetricsRegistry()
        for v in (10, 20, 30, 40, 50):
            r.histogram_observe("latency_ms", v, provider="p")
        text = r.render_prometheus()
        assert "# TYPE latency_ms summary" in text
        assert 'latency_ms{provider="p",quantile="0.5"}' in text
        assert 'latency_ms{provider="p",quantile="0.95"}' in text
        assert 'latency_ms_count{provider="p"} 5' in text
        assert 'latency_ms_sum{provider="p"} 150' in text


class TestLabelEscaping:
    def test_quote_in_label(self):
        r = MetricsRegistry()
        r.counter_inc("c", weird='he said "hi"')
        text = r.render_prometheus()
        # The embedded quote must be backslash-escaped
        assert '\\"hi\\"' in text


class TestTypeConflict:
    def test_mismatched_type_raises(self):
        r = MetricsRegistry()
        r.counter_inc("m")
        with pytest.raises(ValueError):
            r.histogram_observe("m", 1)


class TestTimedEmitsHistogram:
    @pytest.mark.asyncio
    async def test_success_emits_ok_histogram(self):
        with timed("test_work", provider="x"):
            pass
        text = metrics_registry().render_prometheus()
        assert "test_work_duration_ms" in text
        assert 'status="ok"' in text

    @pytest.mark.asyncio
    async def test_error_emits_error_histogram(self):
        with pytest.raises(RuntimeError):
            with timed("test_work_err"):
                raise RuntimeError("x")
        text = metrics_registry().render_prometheus()
        assert "test_work_err_duration_ms" in text
        assert 'status="error"' in text


class TestMetricsEndpoint:
    def test_endpoint_returns_plain_text(self):
        # Minimal app mounting the full v2 router (translate + metrics)
        from translation_v2.api.routes import router
        app = FastAPI()
        app.include_router(router, prefix="/api/v2")
        client = TestClient(app)

        metrics_registry().counter_inc(
            "v2_translate_total", provider="openai", source="en", target="ma"
        )
        r = client.get("/api/v2/agent/metrics")
        assert r.status_code == 200
        assert "text/plain" in r.headers["content-type"]
        assert "v2_translate_total" in r.text

    def test_endpoint_always_accessible(self, monkeypatch):
        """Metrics endpoint has no flag gate — always readable."""
        from translation_v2.api.routes import router
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", False
        )
        app = FastAPI()
        app.include_router(router, prefix="/api/v2")
        client = TestClient(app)
        r = client.get("/api/v2/agent/metrics")
        assert r.status_code == 200
