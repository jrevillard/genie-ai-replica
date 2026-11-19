# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""A span reaches the exporter, with its PII attributes redacted on the way.

The observability gate is covered in `test_tracing.py`; this file covers the
export path itself.
"""

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


def test_a_span_is_exported_with_its_pii_attributes_redacted(monkeypatch):
    exporter = InMemorySpanExporter()
    monkeypatch.setattr(tracing_module, "OTLPSpanExporter", lambda **kwargs: exporter)
    monkeypatch.setattr(tracing_module, "OTLPMetricExporter", lambda **kwargs: _NoopMetricExporter())
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.invalid:4318")

    tracing_module.setup_tracing("agent-service")
    provider = tracing_module._provider
    assert provider is not None

    with tracing_module.with_span("agent.test.op", attributes={"user_query": "secret", "db.system": "arangodb"}):
        pass

    provider.force_flush()
    spans = exporter.get_finished_spans()

    assert [span.name for span in spans] == ["agent.test.op"]
    attributes = spans[0].attributes
    assert attributes["user_query"] == "[REDACTED]"
    assert attributes["db.system"] == "arangodb"

    tracing_module.shutdown()
