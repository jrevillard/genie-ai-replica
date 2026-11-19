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
    monkeypatch.setenv("AGENT_ENABLED", "1")
    with TestClient(app_module.app) as client:
        response = client.get("/ready")

    assert response.json()["agent_enabled"] is True


def test_ready_reports_the_service_as_parked_when_the_flag_is_off(monkeypatch):
    monkeypatch.setenv("AGENT_ENABLED", "0")
    with TestClient(app_module.app) as client:
        response = client.get("/ready")

    assert response.json()["agent_enabled"] is False


def test_the_service_exposes_no_capability_surface():
    """Story 1.3 ships infrastructure only - the capability tools land later.

    Pinning the route list keeps a later story's capability routes from
    landing silently in this story.
    """
    with TestClient(app_module.app) as client:
        paths = client.get("/openapi.json").json()["paths"]

    assert sorted(paths) == ["/health", "/ready"]
