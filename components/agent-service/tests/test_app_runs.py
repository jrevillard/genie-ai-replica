# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The run surface (POST /v1/runs): the defined admission/cancellation behavior.

Mutation-sensitive pins: a saturated lane answers 429 (Retry-After set,
JSON naming the saturation) BEFORE any stream byte; unconfigured budget
knobs answer 503 naming EVERY knob; the stream carries the seam envelope
frames then its own terminal usage record (no client frame name); a budget
hit ends the stream honestly (run_error + budget_exhausted, no answer
text); a client disconnect cancels the in-flight call, emits no terminal
event and releases the lane slot.
"""

import asyncio
import json
from dataclasses import replace

import pytest
from conftest import (
    AgentFakePort,
    HangingLoopModel,
    ScriptedLoopModel,
    canned_read_result,
    canned_search_result,
    multihop_turns,
)
from fastapi.testclient import TestClient
from test_agent_orchestrator import REQUIRED_KNOBS

import app as app_module
from agent.events import BFF_FRAME_NAMES
from agent.orchestrator import OrchestratorConfig, RequestOrchestrator
from capabilities.contract import CallerContext, OperationBudget
from noagent.lane import AdmissionLane

CONTEXT = {"user_id": "u-1", "authorized_graph_names": ["GRAPH"]}
BODY = {"question": "How are complaints handled?", "deadline_ms": 5000, "context": CONTEXT}


def _config() -> OrchestratorConfig:
    return OrchestratorConfig(
        max_steps=6,
        max_model_calls=6,
        max_tool_calls=6,
        max_total_tokens=10000,
        max_evidence_bytes=1000000,
        wall_clock_ceiling_seconds=30.0,
        operation_budget=OperationBudget(timeout_ms=1000, max_results=8, max_result_bytes=65536),
        system_prompt="the system prompt",
    )


def _port() -> AgentFakePort:
    return AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())


def _runtime(model, port=None, slots=1, tmp_path=None):
    lane = AdmissionLane(slots, str(tmp_path / "lane.lock"))

    def port_factory(context, bearer):
        return port if port is not None else _port()

    return app_module.RunsRuntime(
        RequestOrchestrator(config=_config(), lane=lane, model_client=model, port_factory=port_factory)
    )


def _frames(response) -> list[dict]:
    """The SSE data frames of a consumed stream, parsed."""
    frames = []
    for chunk in response.text.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            frames.append(json.loads(chunk[len("data: ") :]))
    return frames


# ---------------------------------------------------------------------
# Admission: 429 before any stream byte; 503 for unconfigured knobs
# ---------------------------------------------------------------------


def test_a_saturated_lane_answers_429_before_any_stream_byte(tmp_path, monkeypatch):
    lane = AdmissionLane(1, str(tmp_path / "lane.lock"))
    monkeypatch.setattr(app_module, "_RUNTIME", _runtime(ScriptedLoopModel(multihop_turns()), tmp_path=tmp_path))

    async def scenario():
        # The slot is held OUTSIDE the app's process plumbing — the pool is
        # the slot files, so the app's own lane instance sees it held.
        async with lane.acquire():
            with TestClient(app_module.app) as client:
                return client.post("/v1/runs", json=BODY)

    response = asyncio.run(scenario())

    assert response.status_code == 429
    assert response.headers["retry-after"] == "1"
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["error"] == "admission_refused"
    assert "saturated" in body["message"]


def test_unconfigured_knobs_answer_503_naming_every_missing_knob(monkeypatch):
    for knob in REQUIRED_KNOBS:
        monkeypatch.setenv(knob, "")
    monkeypatch.setattr(app_module, "_RUNTIME", None)
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    assert response.status_code == 503
    body = response.json()
    assert body["error"] == "budget_configuration_missing"
    assert set(body["missing_knobs"]) == set(REQUIRED_KNOBS)


def test_a_configured_environment_admits_and_serves(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "_RUNTIME", _runtime(ScriptedLoopModel(multihop_turns()), tmp_path=tmp_path))
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")


@pytest.mark.parametrize(
    "broken_body",
    [
        {"question": "q", "context": CONTEXT},  # deadline_ms absent
        {"question": "q", "deadline_ms": 0, "context": CONTEXT},
        {"question": "q", "deadline_ms": -1, "context": CONTEXT},
        {"question": "  ", "deadline_ms": 5000, "context": CONTEXT},
        {"question": "q", "deadline_ms": 5000},  # context absent
    ],
)
def test_a_malformed_request_answers_422(monkeypatch, broken_body):
    # The validation precedes the assembly: no knobs are needed to refuse it.
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=broken_body)
    assert response.status_code == 422


# ---------------------------------------------------------------------
# The stream: the seam envelope, then the terminal usage record
# ---------------------------------------------------------------------


def test_the_stream_carries_the_seam_envelope_then_the_usage_record(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "_RUNTIME", _runtime(ScriptedLoopModel(multihop_turns()), tmp_path=tmp_path))
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    frames = _frames(response)
    assert [frame.get("kind") for frame in frames[:-1]] == [
        "run_started",
        "tool_call_started",
        "tool_call_finished",
        "tool_call_started",
        "tool_call_finished",
        "text_message_started",
        "text_message_content",
        "text_message_finished",
        "run_finished",
    ]
    for frame in frames[:-1]:
        assert set(frame) == {"run_id", "call_id", "seq", "kind", "payload"}
        assert frame["kind"] not in BFF_FRAME_NAMES  # the seam never speaks the client dialect
    assert [frame["seq"] for frame in frames[:-1]] == list(range(9))

    usage = frames[-1]["usage_record"]
    assert set(frames[-1]) == {"usage_record"}
    assert set(usage) == {
        "run_id",
        "outcome",
        "steps",
        "model_calls",
        "aux_model_calls",
        "tool_calls",
        "evidence_bytes",
        "prompt_tokens",
        "completion_tokens",
        "wall_clock_seconds",
        "error",
    }
    assert usage["outcome"] == "answered"
    assert usage["run_id"] == frames[0]["run_id"]


def test_a_budget_hit_ends_the_stream_honestly_with_no_answer_text(tmp_path, monkeypatch):
    exhausted = replace(_config(), max_model_calls=1)
    lane = AdmissionLane(1, str(tmp_path / "lane.lock"))
    monkeypatch.setattr(
        app_module,
        "_RUNTIME",
        app_module.RunsRuntime(
            RequestOrchestrator(
                config=exhausted,
                lane=lane,
                model_client=ScriptedLoopModel(multihop_turns(answer="a fabricated answer")),
                port_factory=lambda context, bearer: _port(),
            )
        ),
    )
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    frames = _frames(response)
    assert frames[-2]["kind"] == "run_error"
    assert frames[-2]["payload"]["code"] == "budget_exhausted"
    assert frames[-1]["usage_record"]["outcome"] == "budget_exhausted"
    assert frames[-1]["usage_record"]["model_calls"] == 1
    # Honest terminal: the spent answer never rode the stream.
    assert "a fabricated answer" not in response.text


# ---------------------------------------------------------------------
# Cancellation: the disconnect reaches the in-flight call, releases the slot
# ---------------------------------------------------------------------


def test_a_disconnected_client_cancels_the_run_and_releases_the_slot(tmp_path, monkeypatch):
    recorder: dict = {}
    runtime = _runtime(HangingLoopModel(recorder), tmp_path=tmp_path)
    orchestrator = runtime.orchestrator
    request = app_module.AgentRunRequest(
        question="q", deadline_ms=5000, context=CallerContext.model_validate(CONTEXT), bearer=None
    )
    seen_frames: list[str] = []

    async def drain(gen):
        async for frame in gen:
            seen_frames.append(json.loads(frame[len("data: ") :]).get("kind"))

    async def scenario():
        admit_ctx = orchestrator.admit()
        await admit_ctx.__aenter__()
        gen = app_module._run_stream(orchestrator, request, admit_ctx)
        task = asyncio.ensure_future(drain(gen))
        while "started" not in recorder:
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # The released slot admits the successor immediately.
        async with orchestrator.admit():
            pass

    asyncio.run(scenario())

    assert recorder["cancelled_in_flight"] is True  # the cancellation reached the in-flight model call
    assert seen_frames == ["run_started"]  # no terminal event for a cancelled run
    assert not any(kind in ("run_finished", "run_error") for kind in seen_frames)
