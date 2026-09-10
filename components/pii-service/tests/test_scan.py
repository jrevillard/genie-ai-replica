# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Endpoint + redaction tests. A fake analyzer engine keeps unit tests fast and
model-free; one integration test (skipped when the spaCy model is absent) runs
the real engine. CI installs the model so the integration test executes there."""

import importlib.util

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import app


def _install_fake_analyzer(monkeypatch):
    """Fake analyzer returning one canned hit per text containing the trigger."""

    class FakeResult:
        def __init__(self, entity_type, start, end, score):
            self.entity_type = entity_type
            self.start = start
            self.end = end
            self.score = score

    class FakeAnalyzer:
        def analyze(self, text, language, entities, score_threshold):
            if "john.smith@example.org" in text:
                s = text.index("john.smith@example.org")
                return [FakeResult("EMAIL_ADDRESS", s, s + len("john.smith@example.org"), 0.9)]
            return []

    monkeypatch.setattr(app_module, "analyzer", FakeAnalyzer())


@pytest.fixture
def client(monkeypatch):
    _install_fake_analyzer(monkeypatch)
    return TestClient(app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_scan_clean(client):
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "c1", "text": "No PII here."}]})
    assert r.status_code == 200
    body = r.json()
    assert body["results"][0]["id"] == "c1"
    assert body["results"][0]["hits"] == []
    assert body["results"][0]["redacted_text"] == "No PII here."


def test_scan_email_redacted_with_typed_placeholder(client):
    text = "Contact john.smith@example.org for details."
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "c2", "text": text}]})
    assert r.status_code == 200
    res = r.json()["results"][0]
    assert res["counts_by_type"] == {"EMAIL_ADDRESS": 1}
    assert "[PII:EMAIL_ADDRESS]" in res["redacted_text"]
    assert "john.smith" not in res["redacted_text"]


def test_scan_batch(client):
    r = client.post(
        "/v1/pii/scan",
        json={
            "texts": [
                {"id": "a", "text": "clean"},
                {"id": "b", "text": "mail john.smith@example.org"},
            ]
        },
    )
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 2
    # Per-item correctness (code-review #18): the clean item stays untouched,
    # the PII item is redacted + typed-placeholder.
    by_id = {x["id"]: x for x in results}
    assert by_id["a"]["hits"] == []
    assert by_id["a"]["redacted_text"] == "clean"
    assert by_id["b"]["counts_by_type"] == {"EMAIL_ADDRESS": 1}
    assert "[PII:EMAIL_ADDRESS]" in by_id["b"]["redacted_text"]


def test_scan_rejects_unsupported_language(client):
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "x", "text": "hola", "language": "es"}]})
    assert r.status_code == 422  # pydantic validation (code-review #13)


def test_national_id_registry_config_shape():
    """The registry is config: every entry is entity -> [{name, regex, score}]."""
    for entity, patterns in app_module.NATIONAL_ID_PATTERNS.items():
        assert entity.endswith("_NATIONAL_ID")
        for p in patterns:
            assert set(p.keys()) == {"name", "regex", "score"}
            assert 0.0 < p["score"] < 1.0


def test_national_id_scores_above_default_threshold():
    """Code-review #6: a shipped recognizer below DEFAULT_SCORE_THRESHOLD is a
    silent no-op on the authoritative gate (presidio filters score >= threshold)
    -> personal data passes as 'clean'. This invariant can never self-disable."""
    for entity, patterns in app_module.NATIONAL_ID_PATTERNS.items():
        for p in patterns:
            assert p["score"] >= app_module.DEFAULT_SCORE_THRESHOLD, (
                f"{entity} {p['name']} score {p['score']} < threshold "
                f"{app_module.DEFAULT_SCORE_THRESHOLD} — silent false-negative"
            )


@pytest.mark.skipif(
    importlib.util.find_spec("en_core_web_md") is None,
    reason="spaCy model not installed locally — CI installs it",
)
def test_real_engine_detects_person():
    app_module.analyzer = None  # force real lazy load
    client = TestClient(app)
    r = client.post(
        "/v1/pii/scan",
        json={"texts": [{"id": "x", "text": "Maria Okafor lives in Maseru."}]},
    )
    assert r.status_code == 200
    types = r.json()["results"][0]["counts_by_type"]
    assert "PERSON" in types
