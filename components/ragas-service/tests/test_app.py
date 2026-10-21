# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""App-surface tests: auth fail-closed, health/ready open, import/export
endpoints, and the 202+poll background-job contract for the two model-bound
endpoints. These run WITHOUT the ragas/langchain stack (engine imports are
deferred; the engine functions are monkeypatched) — fastapi + openpyxl +
httpx only, via TestClient.
"""

from __future__ import annotations

import asyncio
import io
import time

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

import app as app_module


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("RAGAS_INTERNAL_SECRET", "test-secret")
    monkeypatch.setenv("RAGAS_JUDGE_BASE_URL", "http://localhost:1/v1")
    monkeypatch.setenv("RAGAS_JUDGE_MODEL", "test-model")
    # Reimport so the middleware reads the patched env at call time anyway
    from importlib import reload

    reload(app_module)
    # Context-managed: one long-lived portal whose event loop keeps the
    # background job tasks advancing between requests (a bare TestClient
    # opens a portal per request — tasks created by a POST would never run).
    with TestClient(app_module.app) as c:
        yield c


def _auth(headers=None):
    return {"X-RAGAS-Secret": "test-secret", **(headers or {})}


def _poll_job(client, job_id, timeout_s=10):
    """Poll until terminal; the TestClient portal loop advances the task."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = client.get(f"/jobs/{job_id}", headers=_auth())
        if r.status_code == 200:
            job = r.json()
            if job["status"] in ("done", "failed"):
                return job
        time.sleep(0.05)
    pytest.fail(f"job {job_id} did not finish in {timeout_s}s")


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


def test_auth_guards_job_poll(client):
    r = client.get("/jobs/whatever")
    assert r.status_code == 503  # behind the shared secret like everything else


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


def test_generate_is_202_plus_poll_with_result(client, monkeypatch):
    seen_kwargs = {}

    async def fake_generate(
        documents,
        testset_size,
        query_distribution=None,
        num_personas=3,
        progress=None,
        cancel_event=None,
        judge=None,
        embed=None,
    ):
        seen_kwargs.update({"testset_size": testset_size, "num_personas": num_personas})
        if progress:
            progress("synthesizing-questions")
        return {"samples": [{"user_input": "q"}], "generator": {}}

    monkeypatch.setattr(app_module.ragas_engine, "generate_testset", fake_generate)
    r = client.post(
        "/generate-testset",
        json={"documents": [{"page_content": "x", "metadata": {}}], "testset_size": 4, "num_personas": 6},
        headers=_auth(),
    )
    assert r.status_code == 202
    body = r.json()
    assert body["job_id"]
    job = _poll_job(client, body["job_id"])
    assert job["status"] == "done"
    assert job["kind"] == "generate-testset"
    assert job["phase"] == "synthesizing-questions"
    assert job["result"]["samples"][0]["user_input"] == "q"
    assert seen_kwargs == {"testset_size": 4, "num_personas": 6}


def test_generate_job_failure_surfaces_the_error(client, monkeypatch):
    async def fake_generate(*args, **kwargs):
        raise ValueError("bad distribution")

    monkeypatch.setattr(app_module.ragas_engine, "generate_testset", fake_generate)
    r = client.post(
        "/generate-testset",
        json={"documents": [{"page_content": "x", "metadata": {}}], "testset_size": 2},
        headers=_auth(),
    )
    assert r.status_code == 202
    job = _poll_job(client, r.json()["job_id"])
    assert job["status"] == "failed"
    assert "ValueError" in job["error"]
    assert "bad distribution" in job["error"]
    assert "result" not in job


def test_evaluate_is_202_plus_poll_with_result(client, monkeypatch):
    async def fake_evaluate(samples, metrics, timeout_s=600, progress=None, cancel_event=None, judge=None, embed=None):
        if progress:
            progress("scoring")
        return {"aggregate": {"faithfulness": 1.0}, "per_query": [], "n": 0, "dropped": []}

    monkeypatch.setattr(app_module.ragas_engine, "evaluate_samples", fake_evaluate)
    r = client.post("/evaluate", json={"samples": [{"user_input": "q"}]}, headers=_auth())
    assert r.status_code == 202
    job = _poll_job(client, r.json()["job_id"])
    assert job["status"] == "done"
    assert job["kind"] == "evaluate"
    assert job["result"]["aggregate"]["faithfulness"] == 1.0


def test_jobs_enforce_the_concurrency_cap(client, monkeypatch):
    monkeypatch.setattr(app_module, "MAX_CONCURRENT_JOBS", 1)

    async def slow_generate(*args, **kwargs):
        await asyncio.sleep(1.0)
        return {"samples": []}

    monkeypatch.setattr(app_module.ragas_engine, "generate_testset", slow_generate)
    first = client.post(
        "/generate-testset",
        json={"documents": [{"page_content": "x", "metadata": {}}], "testset_size": 1},
        headers=_auth(),
    )
    assert first.status_code == 202
    second = client.post(
        "/generate-testset",
        json={"documents": [{"page_content": "x", "metadata": {}}], "testset_size": 1},
        headers=_auth(),
    )
    assert second.status_code == 503
    assert "busy" in second.json()["detail"]
    job = _poll_job(client, first.json()["job_id"])
    assert job["status"] == "done"


def test_unknown_job_404(client):
    r = client.get("/jobs/nope", headers=_auth())
    assert r.status_code == 404


def test_cancel_stops_a_running_job_and_keeps_it_readable(client, monkeypatch):
    async def slow_generate(*args, **kwargs):
        await asyncio.sleep(30)
        return {"samples": []}

    monkeypatch.setattr(app_module.ragas_engine, "generate_testset", slow_generate)
    r = client.post(
        "/generate-testset",
        json={"documents": [{"page_content": "x", "metadata": {}}], "testset_size": 2},
        headers=_auth(),
    )
    job_id = r.json()["job_id"]
    mid = client.get(f"/jobs/{job_id}", headers=_auth()).json()
    assert mid["status"] == "running"
    d = client.delete(f"/jobs/{job_id}", headers=_auth())
    assert d.status_code == 200
    assert d.json()["status"] == "cancelled"
    # 2026-10-21 sidecar review F3: a cancelled job STAYS readable. Popping
    # it made the caller's next poll a 404, which the caller read as "the
    # sidecar restarted" and turned a WORKING cancel into a "job vanished"
    # failure.
    after = client.get(f"/jobs/{job_id}", headers=_auth())
    assert after.status_code == 200
    assert after.json()["status"] == "cancelled"


def test_cancel_of_a_terminal_job_is_idempotent(client, monkeypatch):
    async def fake_generate(*args, **kwargs):
        return {"samples": []}

    monkeypatch.setattr(app_module.ragas_engine, "generate_testset", fake_generate)
    r = client.post(
        "/generate-testset",
        json={"documents": [{"page_content": "x", "metadata": {}}], "testset_size": 1},
        headers=_auth(),
    )
    job_id = r.json()["job_id"]
    _poll_job(client, job_id)
    d = client.delete(f"/jobs/{job_id}", headers=_auth())
    assert d.status_code == 200
    assert d.json()["status"] == "done"


def test_phase_tracker_forwards_substep_and_elapsed():
    """2026-10-20 — the KG phase streams the ACTIVE transform's bar
    (step/done/total/eta) plus the job's elapsed time, so the UI can show
    WHAT runs and HOW LONG it has run (David: "the user needs more
    feedback than this")."""
    tracker = app_module._phase_tracker("t-substep")
    app_module.JOBS["t-substep"] = {
        "status": "running",
        "started_at": time.time() - 61,
    }
    try:
        tracker("building-knowledge-graph", 337, 1075, step="Applying CustomNodeFilter", rate_s=0.7, eta_s=1100.0)
        prog = app_module.JOBS["t-substep"]["progress"]
        assert prog["phase"] == "building-knowledge-graph"
        assert prog["done"] == 337
        assert prog["total"] == 1075
        assert prog["step"] == "Applying CustomNodeFilter"
        assert prog["eta_s"] == 1100.0
        assert prog["rate_s"] == 0.7
        assert 55 <= prog["elapsed_s"] <= 75  # the clock survives re-attach
    finally:
        app_module.JOBS.pop("t-substep", None)


def test_snapshot_refreshes_the_elapsed_clock_without_a_progress_call():
    """2026-10-21 (live): the clock was frozen between progress reports —
    the synthesis phase generates personas for minutes before the first
    sample resolves, and the UI showed a stopped clock next to a running
    job. The elapsed time is a READ-time derivation, so it must tick on
    every poll."""
    app_module.JOBS["t-clock"] = {
        "job_id": "t-clock",
        "kind": "generate",
        "status": "running",
        "phase": "synthesizing-questions",
        "started_at": time.time() - 120,
        "progress": {"phase": "synthesizing-questions", "done": 0, "elapsed_s": 61.0},
    }
    try:
        snap = app_module._snapshot(app_module.JOBS["t-clock"])
        assert snap["progress"]["elapsed_s"] >= 115
        # the stored payload is not mutated — the next report overwrites it
        assert app_module.JOBS["t-clock"]["progress"]["elapsed_s"] == 61.0
    finally:
        app_module.JOBS.pop("t-clock", None)


def test_phase_tracker_keeps_working_for_plain_phase_calls():
    """The old call shape (phase only, or phase+counts) must still produce a
    valid progress payload — synthesis bumps positions, not kwargs."""
    tracker = app_module._phase_tracker("t-plain")
    app_module.JOBS["t-plain"] = {"status": "running", "started_at": time.time()}
    try:
        tracker("synthesizing-questions")
        prog = app_module.JOBS["t-plain"]["progress"]
        assert prog == {"phase": "synthesizing-questions", "elapsed_s": prog["elapsed_s"]}
        tracker("synthesizing-questions", 7, None)
        assert app_module.JOBS["t-plain"]["progress"]["done"] == 7
    finally:
        app_module.JOBS.pop("t-plain", None)
