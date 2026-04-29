"""Tests for the v1 → v2 compatibility middleware.

Verifies:
  - Pass-through when flag is off and no header (legacy untouched).
  - Flag ON: both v1 endpoints served by v2 Router, with byte-identical v1 response shape.
  - Header override (X-Translation-Pipeline: v2) works even when flag is off.
  - Unsupported language returns 400 (mirrors legacy).
  - v2 Router failure returns 502.
  - Non-POST requests pass through.
  - Non-translate paths pass through (regression guard).
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from translation_v2.api.bootstrap import (
    reset_v2_router,
    set_v2_router_for_testing,
)
from translation_v2.api.v1_compat import V1ToV2CompatMiddleware
from translation_v2.router import Router


class FakeProvider:
    def __init__(self, name: str, suffix: str = "-MA") -> None:
        self.name = name
        self._suffix = suffix
        self.calls: list[tuple] = []

    async def translate(self, text, source, target):
        self.calls.append((text, source, target))
        return f"{text}{self._suffix}"

    async def translate_batch(self, texts, source, target):
        return [f"{t}{self._suffix}" for t in texts]


class FailingProvider:
    name = "openai"

    async def translate(self, *a, **kw):
        raise RuntimeError("primary down")


def _legacy_v1_stub(app: FastAPI) -> FastAPI:
    """Simulate the existing v1 translate endpoints for pass-through tests."""

    @app.post("/api/v1/agent/translate")
    async def legacy_translate(body: dict):
        return {
            "source": body["source"],
            "target": body["target"],
            "original": body["text"],
            "translated": f"LEGACY:{body['text']}",
        }

    @app.post("/api/v1/agent/translate/batch")
    async def legacy_batch(body: dict):
        return {
            "source": body["source"],
            "target": body["target"],
            "translations": {k: f"LEGACY:{v}" for k, v in body["texts"].items()},
        }

    @app.get("/api/v1/agent/ping")
    async def legacy_ping():
        return {"ok": True}

    return app


@pytest.fixture
def app_with_shim():
    app = FastAPI()
    _legacy_v1_stub(app)
    app.add_middleware(V1ToV2CompatMiddleware)
    return app


@pytest.fixture
def client(app_with_shim):
    return TestClient(app_with_shim)


@pytest.fixture(autouse=True)
def _reset():
    reset_v2_router()
    yield
    reset_v2_router()


@pytest.fixture
def wired_v2_router():
    primary = FakeProvider("openai", "-V2")
    r = Router(primary=primary)
    set_v2_router_for_testing(r)
    return r


class TestPassThrough:
    def test_flag_off_no_header_single(self, client, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", False)
        r = client.post(
            "/api/v1/agent/translate",
            json={"text": "hello", "source": "en", "target": "ma"},
        )
        assert r.status_code == 200
        assert r.json()["translated"] == "LEGACY:hello"

    def test_flag_off_no_header_batch(self, client, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", False)
        r = client.post(
            "/api/v1/agent/translate/batch",
            json={"texts": {"a": "hello"}, "source": "en", "target": "ma"},
        )
        assert r.status_code == 200
        assert r.json()["translations"] == {"a": "LEGACY:hello"}

    def test_non_post_passes_through(self, client, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.get("/api/v1/agent/ping")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_unrelated_path_passes_through(self, client, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.get("/api/v1/agent/ping")
        assert r.status_code == 200


class TestFlagOn:
    def test_single_routes_to_v2(self, client, monkeypatch, wired_v2_router):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.post(
            "/api/v1/agent/translate",
            json={"text": "hello", "source": "en", "target": "ma"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["translated"] == "hello-V2"
        assert body["original"] == "hello"
        assert body["source"] == "en"
        assert body["target"] == "ma"

    def test_batch_routes_to_v2(self, client, monkeypatch, wired_v2_router):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.post(
            "/api/v1/agent/translate/batch",
            json={"texts": {"a": "hi", "b": "bye"}, "source": "en", "target": "ma"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["translations"] == {"a": "hi-V2", "b": "bye-V2"}
        assert body["source"] == "en"
        assert body["target"] == "ma"

    def test_batch_response_shape_matches_legacy(
        self, client, monkeypatch, wired_v2_router
    ):
        """Result must use the exact same top-level keys as legacy."""
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.post(
            "/api/v1/agent/translate/batch",
            json={"texts": {"k": "v"}, "source": "en", "target": "ma"},
        )
        body = r.json()
        assert set(body.keys()) == {"source", "target", "translations"}

    def test_empty_string_passes_through_in_batch(
        self, client, monkeypatch, wired_v2_router
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.post(
            "/api/v1/agent/translate/batch",
            json={"texts": {"a": "", "b": "hi"}, "source": "en", "target": "ma"},
        )
        body = r.json()
        # Empty input short-circuits — no v2 call for "a"
        assert body["translations"]["a"] == ""
        assert body["translations"]["b"] == "hi-V2"


class TestHeaderOverride:
    def test_header_activates_when_flag_off(
        self, client, monkeypatch, wired_v2_router
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", False)
        r = client.post(
            "/api/v1/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
            headers={"X-Translation-Pipeline": "v2"},
        )
        assert r.status_code == 200
        assert r.json()["translated"] == "hi-V2"

    def test_header_case_insensitive(
        self, client, monkeypatch, wired_v2_router
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", False)
        r = client.post(
            "/api/v1/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
            headers={"X-Translation-Pipeline": "V2"},
        )
        assert r.status_code == 200
        assert r.json()["translated"] == "hi-V2"

    def test_header_other_value_passes_through(
        self, client, monkeypatch, wired_v2_router
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", False)
        r = client.post(
            "/api/v1/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
            headers={"X-Translation-Pipeline": "v1"},
        )
        # Falls through to legacy stub
        assert r.json()["translated"] == "LEGACY:hi"


class TestValidation:
    def test_unsupported_language_returns_400(
        self, client, monkeypatch, wired_v2_router
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.post(
            "/api/v1/agent/translate",
            json={"text": "hi", "source": "en", "target": "zz"},
        )
        assert r.status_code == 400
        assert "Unsupported language" in r.json()["detail"]

    def test_batch_texts_not_dict_returns_400(
        self, client, monkeypatch, wired_v2_router
    ):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.post(
            "/api/v1/agent/translate/batch",
            json={"texts": ["a", "b"], "source": "en", "target": "ma"},
        )
        assert r.status_code == 400

    def test_invalid_json_returns_400(self, client, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        r = client.post(
            "/api/v1/agent/translate",
            content=b"not-json",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400


class TestV2Failure:
    def test_v2_router_failure_returns_502(self, client, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_FOR_V1_ENDPOINTS", True)
        set_v2_router_for_testing(Router(primary=FailingProvider()))
        r = client.post(
            "/api/v1/agent/translate",
            json={"text": "hi", "source": "en", "target": "ma"},
        )
        assert r.status_code == 502
        assert "v2 translation failed" in r.json()["detail"]
