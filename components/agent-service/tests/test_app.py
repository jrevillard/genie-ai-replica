# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The agent service surface: liveness, readiness and the activation flag."""

from fastapi.testclient import TestClient

import app as app_module


def test_health_reports_ok():
    with TestClient(app_module.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_reports_the_service_can_serve():
    with TestClient(app_module.app) as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_ready_reflects_the_activation_flag(monkeypatch):
    """One contract, both states: the readiness answer reports the flag.

    The flag is read per request, not at import time - so the same app
    instance answers "parked" and "live" depending on the environment.
    """
    monkeypatch.setenv("AGENT_ENABLED", "1")
    with TestClient(app_module.app) as client:
        live = client.get("/ready").json()

    monkeypatch.setenv("AGENT_ENABLED", "0")
    with TestClient(app_module.app) as client:
        parked = client.get("/ready").json()

    assert live["agent_enabled"] is True
    assert parked["agent_enabled"] is False


def test_the_route_surface_is_pinned():
    """Pinning the route list keeps any later route from landing
    silently - a new route must arrive with its own pinned behavior."""
    with TestClient(app_module.app) as client:
        paths = client.get("/openapi.json").json()["paths"]

    assert sorted(paths) == ["/health", "/ready", "/v1/runs"]
