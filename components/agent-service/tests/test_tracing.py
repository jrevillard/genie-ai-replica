# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The OpenTelemetry wiring: the observability gate, the exported span and the
PII redaction that keeps sensitive attributes out of the trace store, plus
the run-path span tree and the outbound W3C traceparent
propagation."""

import importlib
import io

import httpx
import pytest
import requests
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


def test_the_service_identity_is_fixed_not_env_overridable(monkeypatch):
    """The resource's identity is the deployment's fixed decision: an
    operator's OTEL_SERVICE_NAME / OTEL_SERVICE_VERSION must not rename or
    re-version the service (the dashboards and the service-identity
    contract resolve on those attributes)."""
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.invalid:4318")
    monkeypatch.setenv("OTEL_SERVICE_NAME", "impostor")
    monkeypatch.setenv("OTEL_SERVICE_VERSION", "9.9.9")

    captured = {}
    real_create = tracing_module.Resource.create

    def capture_create(attributes=None, schema_url=None):
        captured.update(attributes or {})
        return real_create(attributes, schema_url)

    monkeypatch.setattr(tracing_module.Resource, "create", staticmethod(capture_create))
    monkeypatch.setattr(tracing_module.trace, "set_tracer_provider", lambda provider: None)
    monkeypatch.setattr(tracing_module.metrics, "set_meter_provider", lambda provider: None)

    tracing_module.setup_tracing("agent-service")

    assert captured["service.name"] == "agent-service"
    assert captured["service.namespace"] == "genie-core"
    assert captured["service.version"] == "1.0.0"


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


# ── the run-path span tree and the outbound propagation ─────────────────────


def _run_scripted_run():
    """One scripted governed run through the loop — the same wiring the
    orchestrator builds. Returns nothing; the spans land in the module
    exporter."""
    import asyncio

    from conftest import ScriptedLoopModel, _governed_loop, fake_port, multihop_turns

    loop, _collector, _monitor, _verifier = _governed_loop(
        ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}')), fake_port()
    )
    asyncio.run(loop.run("the question"))


def test_the_run_path_emits_the_span_tree(traced_app):
    """The AC: run-path spans exist for the pipeline stages — the agent.run
    parent with the per-model-call, per-tool-call, verification and judge
    children NESTED under it."""
    exporter, provider, _ = traced_app
    before = len(exporter.get_finished_spans())

    _run_scripted_run()
    provider.force_flush()

    spans = exporter.get_finished_spans()[before:]
    names = [span.name for span in spans]
    expected_names = (
        "agent.run",
        "agent.model_call",
        "agent.tool_call",
        "agent.verify_finalize",
        "agent.grounding_judge",
    )
    for expected in expected_names:
        assert expected in names, names

    by_name = {span.name: span for span in spans if span.name.startswith("agent.")}
    run_span = by_name["agent.run"]
    # The children parent to agent.run (the activation is what nests them),
    # and agent.run itself is a root here (no ambient server span in this
    # direct-drive suite).
    assert run_span.parent is None
    assert by_name["agent.model_call"].parent.span_id == run_span.context.span_id
    assert by_name["agent.tool_call"].parent.span_id == run_span.context.span_id
    assert by_name["agent.verify_finalize"].parent.span_id == run_span.context.span_id
    assert by_name["agent.grounding_judge"].parent.span_id == run_span.context.span_id


def test_the_run_path_span_attributes_carry_counters_and_ids_only(traced_app):
    exporter, provider, _ = traced_app
    before = len(exporter.get_finished_spans())

    _run_scripted_run()
    provider.force_flush()

    spans = exporter.get_finished_spans()[before:]
    for span in spans:
        if not span.name.startswith("agent."):
            continue
        serialized = str(dict(span.attributes or {})).lower()
        for marker in ("the question", "bearer", "password", "secret"):
            assert marker not in serialized
    tool_spans = [span for span in spans if span.name == "agent.tool_call"]
    assert tool_spans, "the scripted run dispatches one tool call"
    # The tool identity is an id pair (call_id + registered name) — never
    # the arguments or the result text.
    attributes = dict(tool_spans[0].attributes)
    assert attributes["tool"] == "search_knowledge"
    assert set(attributes) <= {"call_id", "tool", "errored"}


def test_outbound_httpx_calls_carry_the_traceparent(traced_app):
    """W3C propagation on the model/TEI hop: the httpx client injects a
    traceparent whose parent is the ACTIVE span (the instrumentation's own
    client span, parented to it)."""
    exporter, provider, _ = traced_app
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["traceparent"] = request.headers.get("traceparent")
        return httpx.Response(200, json={})

    with tracing_module.background_span("agent.parent") as span:
        parent_span_id = format(span.get_span_context().span_id, "016x")
        transport = httpx.MockTransport(handler)
        import asyncio

        asyncio.run(httpx.AsyncClient(transport=transport).get("http://endpoint.invalid/v1/models"))

    provider.force_flush()
    assert captured["traceparent"] is not None
    # The traceparent's span-id names the CLIENT span the instrumentation
    # created for the hop; that client span parents to the active span.
    client_span_id = captured["traceparent"].split("-")[2]
    client_spans = [s for s in exporter.get_finished_spans() if format(s.context.span_id, "016x") == client_span_id]
    assert len(client_spans) == 1
    assert client_spans[0].name.startswith("GET")
    assert format(client_spans[0].parent.span_id, "016x") == parent_span_id


class _CaptureAdapter(requests.adapters.BaseAdapter):
    """The doc-repo/okf hop's capture: the PreparedRequest headers as the
    (instrumented) send hands them to the adapter."""

    def __init__(self):
        self.headers = None

    def send(self, request, *args, **kwargs):  # noqa: D102 - test double
        self.headers = dict(request.headers)
        response = requests.models.Response()
        response.status_code = 200
        response.raw = io.BytesIO(b"{}")
        response.headers = {"Content-Type": "application/json"}
        response.request = request
        response.url = request.url
        return response

    def close(self):
        pass


def test_outbound_requests_calls_carry_the_traceparent(traced_app):
    """W3C propagation on the doc-repo/okf hop (the requests-based adapter
    transport)."""
    exporter, provider, _ = traced_app

    adapter = _CaptureAdapter()
    session = requests.Session()
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    with tracing_module.background_span("agent.parent") as span:
        expected_span_id = format(span.get_span_context().span_id, "016x")
        session.get("http://docrepo.invalid/api/files/f-1", timeout=5)

    provider.force_flush()
    assert adapter.headers is not None
    traceparent = adapter.headers.get("traceparent")
    assert traceparent is not None
    # The traceparent's span-id names the CLIENT span; it parents to the
    # active span — the full BFF → agent-service → doc-repo chain reads off
    # this one header plus the span tree.
    client_span_id = traceparent.split("-")[2]
    client_spans = [s for s in exporter.get_finished_spans() if format(s.context.span_id, "016x") == client_span_id]
    assert len(client_spans) == 1
    assert client_spans[0].name.startswith("GET")
    assert format(client_spans[0].parent.span_id, "016x") == expected_span_id
