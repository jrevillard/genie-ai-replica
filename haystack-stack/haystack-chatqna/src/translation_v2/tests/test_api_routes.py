"""Tests for the v2 FastAPI routes.

Uses a minimal FastAPI app that mounts just the v2 router, bypassing
src.main (which pulls in the entire production app with all its
startup hooks). The singleton router is injected via
`set_v2_router_for_testing`.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from translation_v2.api.bootstrap import (
    reset_v2_router,
    set_v2_router_for_testing,
)
from translation_v2.api.routes import router as v2_router
from translation_v2.router import Router


class FakeProvider:
    def __init__(self, name: str, result: str = "ok", fail: bool = False) -> None:
        self.name = name
        self._result = result
        self._fail = fail

    async def translate(self, text: str, source: str, target: str) -> str:
        if self._fail:
            raise RuntimeError(f"{self.name} down")
        return self._result

    async def translate_batch(self, texts, source, target):
        return [self._result] * len(texts)


@pytest.fixture
def app_with_v2():
    app = FastAPI()
    app.include_router(v2_router, prefix="/api/v2")
    return app


@pytest.fixture
def client(app_with_v2):
    return TestClient(app_with_v2)


@pytest.fixture(autouse=True)
def reset_router():
    # Ensure a clean singleton between tests
    reset_v2_router()
    yield
    reset_v2_router()


@pytest.fixture
def fake_router():
    primary = FakeProvider("openai", "cloud-result")
    fallback = FakeProvider("nllb", "local-result")
    r = Router(primary=primary, fallback=fallback, local=fallback)
    set_v2_router_for_testing(r)
    return r


class TestEnableGate:
    def test_disabled_returns_503(self, client, monkeypatch, fake_router):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", False
        )
        resp = client.post(
            "/api/v2/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
        )
        assert resp.status_code == 503
        assert "not enabled" in resp.json()["detail"]

    def test_enabled_globally_returns_200(self, client, monkeypatch, fake_router):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", True
        )
        resp = client.post(
            "/api/v2/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
        )
        assert resp.status_code == 200
        assert resp.json()["translated"] == "cloud-result"

    def test_header_bypass_when_global_flag_off(
        self, client, monkeypatch, fake_router
    ):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", False
        )
        resp = client.post(
            "/api/v2/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
            headers={"X-Translation-Pipeline": "v2"},
        )
        assert resp.status_code == 200

    def test_header_bypass_case_insensitive(
        self, client, monkeypatch, fake_router
    ):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", False
        )
        resp = client.post(
            "/api/v2/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
            headers={"X-Translation-Pipeline": "V2"},
        )
        assert resp.status_code == 200


class TestResponseShape:
    def test_response_includes_source_and_target(
        self, client, monkeypatch, fake_router
    ):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", True
        )
        resp = client.post(
            "/api/v2/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
        )
        body = resp.json()
        assert body["source"] == "en"
        assert body["target"] == "ma"
        assert body["translated"] == "cloud-result"

    def test_bad_request_422(self, client, monkeypatch, fake_router):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", True
        )
        resp = client.post(
            "/api/v2/agent/translate",
            json={"source": "en"},  # missing text
        )
        assert resp.status_code == 422


class TestProviderHeader:
    def test_x_v2_provider_header_routes_to_override(
        self, client, monkeypatch, fake_router
    ):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", True
        )
        # Override to "nllb" (the fallback/local in our fake_router)
        resp = client.post(
            "/api/v2/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
            headers={"X-V2-Provider": "nllb"},
        )
        assert resp.status_code == 200
        assert resp.json()["translated"] == "local-result"


class TestError502:
    def test_provider_failure_returns_502(self, client, monkeypatch):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", True
        )
        r = Router(primary=FakeProvider("openai", fail=True))
        set_v2_router_for_testing(r)

        resp = client.post(
            "/api/v2/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
        )
        assert resp.status_code == 502
        assert "translation failed" in resp.json()["detail"]


class TestHealth:
    def test_health_reports_providers(self, client, monkeypatch, fake_router):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", True
        )
        resp = client.get("/api/v2/agent/translate/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["pipeline_active"] is True
        assert body["primary_provider"] == "openai"
        assert "openai" in body["available_providers"]
        assert body["flags"]["USE_V2_TRANSLATION_PIPELINE"] is True

    def test_health_when_disabled(self, client, monkeypatch, fake_router):
        monkeypatch.setattr(
            "translation_v2.flags.USE_V2_TRANSLATION_PIPELINE", False
        )
        resp = client.get("/api/v2/agent/translate/health")
        assert resp.status_code == 200
        assert resp.json()["pipeline_active"] is False
