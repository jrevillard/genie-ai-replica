# Copyright (c) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Shared OpenTelemetry tracing initialization for OPEA microservices.

Usage::

    from tracing import setup_tracing, get_tracer

    setup_tracing("genieai-chatqna")
    tracer = get_tracer(__name__)

MUST be imported before the FastAPI app is created and before OPEA ``comps``
imports that might initialize HTTP clients.
"""

import atexit
import contextlib
import os
import signal
import sys

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

_provider = None


def setup_tracing(service_name: str) -> None:
    """Initialize the OTel TracerProvider with an OTLP HTTP exporter.

    Args:
        service_name: Logical service name (e.g. ``"genieai-chatqna"``).
    """
    global _provider

    endpoint_base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
    # Python OTLPSpanExporter requires the full URL including /v1/traces
    endpoint_url = f"{endpoint_base.rstrip('/')}/v1/traces"

    resource = Resource.create(
        {
            "service.name": service_name,
            "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
            "deployment.environment": os.getenv("NODE_ENV", "development"),
        }
    )

    exporter = OTLPSpanExporter(endpoint=endpoint_url)
    processor = BatchSpanProcessor(exporter)

    _provider = TracerProvider(resource=resource)
    _provider.add_span_processor(processor)
    trace.set_tracer_provider(_provider)

    atexit.register(shutdown)

    # Handle SIGTERM (Docker/Swarm sends SIGTERM on stop)
    signal.signal(signal.SIGTERM, _sigterm_handler)


def get_tracer(name: str = __name__):
    """Return a tracer from the globally configured provider.

    Safe to call before ``setup_tracing()`` — returns a no-op tracer.
    """
    return trace.get_tracer(name)


def shutdown() -> None:
    """Flush and shut down the global TracerProvider (best-effort)."""
    global _provider
    if _provider is None:
        return
    with contextlib.suppress(Exception):
        _provider.force_flush(30_000)
    with contextlib.suppress(Exception):
        _provider.shutdown()
    _provider = None


def _reset() -> None:
    """Reset module state. Only for testing."""
    global _provider
    _provider = None


def _sigterm_handler(signum, frame):
    shutdown()
    sys.exit(0)
