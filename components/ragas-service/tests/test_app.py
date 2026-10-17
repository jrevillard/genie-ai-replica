# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""App-surface tests: auth fail-closed, health/ready open, import/export
endpoints. These run WITHOUT the ragas/langchain stack (engine imports are
deferred) — fastapi + openpyxl + httpx only, via TestClient.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

import app as app_module


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("RAGAS_INTERNAL_SECRET", "test-secret")
    # Reimport so the middleware reads the patched env at call time anyway
    from importlib import reload

    reload(app_module)
    return TestClient(app_module.app)


def _auth(headers=None):
    return {"X-RAGAS-Secret": "test-secret", **(headers or {})}


def test_health_open_without_secret(client):
    assert client.get("/health").status_code == 200


def test_ready_open_without_secret(client):
    r = client.get("/ready")
    assert r.status_code in (200, 503)  # judge env decides; auth must not


def test_auth_fail_closed_no_secret(client, monkeypatch):
    monkeypatch.delenv("RAGAS_INTERNAL_SECRET", raising=False)
    monkeypatch.delenv("OKF_INTERNAL_SECRET", raising=False)
    r = client.post("/xlsx/export-suite", json={"name": "x", "entries": []}, headers=_auth())
    assert r.status_code == 503
    assert r.json()["error"] == "RAGAS_UNCONFIGURED"


def test_auth_rejects_wrong_secret(client):
    r = client.post("/xlsx/export-suite", json={"name": "x", "entries": []}, headers={"X-RAGAS-Secret": "nope"})
    assert r.status_code == 503


def test_export_import_suite_roundtrip_via_http(client):
    entries = [
        {
            "id": "new-1",
            "query": "Q?",
            "reference_answer": "A.",
            "reference_passages": ["P1", "P2"],
            "source_doc": "s",
            "difficulty": "d",
            "oos": False,
        }
    ]
    r = client.post("/xlsx/export-suite", json={"name": "demo", "entries": entries}, headers=_auth())
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    imp = client.post("/xlsx/import-suite", content=r.content, headers=_auth())
    assert imp.status_code == 200
    body = imp.json()
    assert body["entries"][0]["id"] == "new-1"
    assert body["entries"][0]["reference_passages"] == ["P1", "P2"]


def test_import_rejects_non_xlsx(client):
    r = client.post("/xlsx/import-suite", content=b"not an xlsx", headers=_auth())
    assert r.status_code == 400


def test_import_rejects_empty_entries(client):
    wb = Workbook()
    wb.active.title = "Test Dataset"
    wb.active.append(["id", "difficulty", "query", "answer", "passages", "source"])
    buf = io.BytesIO()
    wb.save(buf)
    r = client.post("/xlsx/import-suite", content=buf.getvalue(), headers=_auth())
    assert r.status_code == 400


def test_export_results_requires_unique_labels(client):
    suite = {"entries": []}
    runs = [{"label": "a", "results": [], "summary": {}}, {"label": "a", "results": [], "summary": {}}]
    r = client.post("/xlsx/export-results", json={"suite": suite, "runs": runs}, headers=_auth())
    assert r.status_code == 400


def test_generate_requires_documents(client):
    r = client.post("/generate-testset", json={"documents": [], "testset_size": 5}, headers=_auth())
    assert r.status_code == 400


def test_generate_503_when_judge_unconfigured(client, monkeypatch):
    monkeypatch.delenv("RAGAS_JUDGE_BASE_URL", raising=False)
    monkeypatch.delenv("RAGAS_JUDGE_MODEL", raising=False)
    # judge_configured reads env at call time
    r = client.post(
        "/generate-testset",
        json={"documents": [{"page_content": "x", "metadata": {}}], "testset_size": 2},
        headers=_auth(),
    )
    assert r.status_code == 503
