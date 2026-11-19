# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The OpenTelemetry wiring: the observability gate, the exported span and the
PII redaction that keeps sensitive attributes out of the trace store."""

import importlib

import pytest
from fastapi.testclient import TestClient
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import tracing as tracing_module


class _NoopMetricExporter:
    """Stands in for the OTLP metric exporter - the test asserts on spans."""

    def export(self, metrics_data, timeout_millis=10_000, **kwargs):
        return 0

    def force_flush(self, timeout_millis=10_000):
        return True

    def shutdown(self, timeout_millis=30_000, **kwargs):
        return None


def test_setup_tracing_is_a_noop_when_observability_is_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "0")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    built = []
    monkeypatch.setattr(tracing_module, "OTLPSpanExporter", lambda **kwargs: built.append(kwargs))
    provider_before = tracing_module._provider

    tracing_module.setup_tracing("agent-service")

    assert built == []
    assert tracing_module._provider is provider_before


def test_setup_tracing_is_a_noop_without_a_collector_endpoint(monkeypatch):
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    built = []
    monkeypatch.setattr(tracing_module, "OTLPSpanExporter", lambda **kwargs: built.append(kwargs))
    provider_before = tracing_module._provider

    tracing_module.setup_tracing("agent-service")

    assert built == []
    assert tracing_module._provider is provider_before


@pytest.fixture(scope="module")
def traced_app():
    """The exporter, the provider and an app that carries the OTel middleware.

    The SDK accepts ONE tracer provider per process, so the provider is set up
    once, here. The app module is reloaded afterwards: it creates its FastAPI
    instance at import time, and only an instance created AFTER the
    instrumentation patched `fastapi.FastAPI` carries the OTel middleware.
    """
    patch = pytest.MonkeyPatch()
    exporter = InMemorySpanExporter()
    patch.setattr(tracing_module, "OTLPSpanExporter", lambda **kwargs: exporter)
    patch.setattr(tracing_module, "OTLPMetricExporter", lambda **kwargs: _NoopMetricExporter())
    patch.setenv("ENABLE_OBSERVABILITY", "1")
    patch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.invalid:4318")

    tracing_module.setup_tracing("agent-service")
    provider = tracing_module._provider
    assert provider is not None, "setup_tracing did not install a provider"

    import app as app_module

    app_module = importlib.reload(app_module)

    yield exporter, provider, app_module

    tracing_module.shutdown()
    patch.undo()


def test_a_served_request_emits_a_server_span(traced_app):
    """The acceptance criterion: traces are emitted when observability is on.

    This drives a real request through the app. A test that only opened a span
    by hand would pass even when the app carried no OTel middleware at all -
    and even when the instrumentation package failed to import.
    """
    exporter, provider, app_module = traced_app

    with TestClient(app_module.app) as client:
        response = client.get("/health")

    assert response.status_code == 200

    provider.force_flush()
    names = [span.name for span in exporter.get_finished_spans()]
    assert any(name.startswith("GET /health") for name in names), names


def test_a_span_keeps_its_pii_attributes_redacted(traced_app):
    exporter, provider, _ = traced_app

    with tracing_module.with_span("agent.test.op", attributes={"user_query": "secret", "db.system": "arangodb"}):
        pass

    provider.force_flush()
    spans = [span for span in exporter.get_finished_spans() if span.name == "agent.test.op"]

    assert len(spans) == 1
    assert spans[0].attributes["user_query"] == "[REDACTED]"
    assert spans[0].attributes["db.system"] == "arangodb"
