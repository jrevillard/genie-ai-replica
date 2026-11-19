# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The OpenTelemetry wiring: the observability gate, the export and the PII
redaction that keeps sensitive attributes out of the trace store."""


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
