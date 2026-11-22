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
    REQUIRED_KNOBS,
    HangingLoopModel,
    ScriptedLoopModel,
    fake_port,
    multihop_turns,
    orchestrator_config,
)
from fastapi.testclient import TestClient

import app as app_module
from agent.events import BFF_FRAME_NAMES
from agent.orchestrator import RequestOrchestrator
from capabilities.contract import CallerContext, PreparedQuery, QueryPreparationStatus
from noagent.lane import AdmissionLane
from preparation.prepare import PreparationResult

CONTEXT = {"user_id": "u-1", "authorized_graph_names": ["GRAPH"]}
BODY = {"question": "How are complaints handled?", "deadline_ms": 5000, "context": CONTEXT, "language": "fr"}


def _runtime(model, tmp_path):
    """The app under test assembled over fakes: _RUNTIME carries the
    orchestrator itself (the module-level lazy singleton)."""
    lane = AdmissionLane(1, str(tmp_path / "lane.lock"))
    return RequestOrchestrator(
        config=orchestrator_config(), lane=lane, model_client=model, port_factory=lambda context, bearer: fake_port()
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
    monkeypatch.setattr(app_module, "_RUNTIME", _runtime(ScriptedLoopModel(multihop_turns()), tmp_path))

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


def test_an_unassembled_port_answers_503_naming_the_knob(monkeypatch):
    """The port assembly's own fail-closed reads (here: the doc-repo base
    URL) are the same honest 503 under a distinct code — never a raw 500
    traceback from the assembly wiring."""
    for knob in REQUIRED_KNOBS:
        monkeypatch.setenv(knob, "1")
    monkeypatch.delenv("AGENT_DOCREPO_URL", raising=False)
    monkeypatch.setattr(app_module, "_RUNTIME", None)
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    assert response.status_code == 503
    body = response.json()
    assert body["error"] == "run_surface_unconfigured"
    assert "AGENT_DOCREPO_URL" in body["message"]


def test_an_unimplemented_verdict_policy_answers_503_naming_the_knob(monkeypatch):
    """The release policy is deployment-level and iteration-1 ships
    verdict-marked only: a deployment asking for another value is refused
    at the config load — the same honest 503, the knob and the value named,
    never a silently-degraded policy."""
    for knob in REQUIRED_KNOBS:
        monkeypatch.setenv(knob, "1")
    monkeypatch.setenv("AGENT_VERDICT_POLICY", "verdict-silent")
    monkeypatch.setattr(app_module, "_RUNTIME", None)
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    assert response.status_code == 503
    body = response.json()
    assert body["error"] == "run_surface_unconfigured"
    assert "AGENT_VERDICT_POLICY" in body["message"]
    assert "verdict-silent" in body["message"]


@pytest.mark.parametrize(
    "broken_body",
    [
        {"question": "q", "context": CONTEXT},  # deadline_ms absent
        {"question": "q", "deadline_ms": 0, "context": CONTEXT},
        {"question": "q", "deadline_ms": -1, "context": CONTEXT},
        {"question": "  ", "deadline_ms": 5000, "context": CONTEXT},
        {"question": "q", "deadline_ms": 5000},  # context absent
        {"question": "q", "deadline_ms": 5000, "context": CONTEXT, "language": "x" * 33},  # over-length locale
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
    grounded_script = multihop_turns(judge_reply='{"verdict": "grounded"}')
    monkeypatch.setattr(app_module, "_RUNTIME", _runtime(ScriptedLoopModel(grounded_script), tmp_path))
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)
    assert response.headers["content-type"].startswith("text/event-stream")

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
        "verdict",  # after the last chunk-projecting event, before the terminal
        "run_finished",
    ]
    for frame in frames[:-1]:
        assert set(frame) == {"run_id", "call_id", "seq", "kind", "payload"}
        assert frame["kind"] not in BFF_FRAME_NAMES  # the seam never speaks the client dialect
    assert [frame["seq"] for frame in frames[:-1]] == list(range(10))

    # The verdict frame is the tri-state projection the BFF maps onto the
    # client frames: the pinned metadata fields plus the citation set.
    # (frames[-1] is the usage record; frames[-2] the terminal event.)
    verdict = frames[-3]["payload"]
    assert verdict["grounding_status"] == "grounded"
    assert verdict["is_grounded"] is True
    assert verdict["translation_mode"] == "none"
    assert verdict["policy"] == "verdict-marked"
    assert verdict["judge"]["outcome"] == "completed"
    assert verdict["citations"]  # the delivered set rides the payload
    assert verdict["marking"] == {"required": False, "reason": None}

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
        "language",
        "preparation_status",
        "injection_findings",
    }
    assert usage["outcome"] == "answered"
    assert usage["run_id"] == frames[0]["run_id"]
    assert usage["aux_model_calls"] == 1  # the grounding judge, tallied separately
    assert usage["language"] == "fr"  # the request's UI locale rides the record
    assert usage["injection_findings"] == 0  # a clean run records no attempt


def test_the_verdict_projects_citations_onto_the_frontend_source_documents_shape(tmp_path, monkeypatch):
    """FR-13: the delivered citations ride the verdict payload projected
    onto the exact envelope variants the frontend citation mapping reads —
    the run surface serves them, the BFF's frame writer forwards them."""
    grounded_script = multihop_turns(judge_reply='{"verdict": "grounded"}')
    monkeypatch.setattr(app_module, "_RUNTIME", _runtime(ScriptedLoopModel(grounded_script), tmp_path))
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json={key: value for key, value in BODY.items() if key != "language"})
    frames = _frames(response)

    verdict = frames[-3]["payload"]
    assert verdict["grounding_status"] == "grounded"
    assert verdict["source_documents"] == [
        {
            "document_id": "f-1",
            "document_name": "f-1",
            "url": "",
            "categoryLabels": [],
            "serviceLabels": [],
            "score": 0.9,
        }
    ]
    # No language on the request: the record says so, never a guessed locale.
    assert frames[-1]["usage_record"]["language"] is None
    assert frames[-1]["usage_record"]["preparation_status"] is None


def test_the_app_assembly_wires_preparation_into_the_run_surface(tmp_path, monkeypatch):
    """The real `_build_orchestrator` assembly carries the preparer factory:
    a run through POST /v1/runs searches THROUGH preparation (the prepared
    query reaches the port) and the usage record carries the preparation
    status — deleting the wiring reds here, not silently."""
    for knob in REQUIRED_KNOBS:
        monkeypatch.setenv(knob, "5000")

    class ScriptedPreparer:
        def __init__(self):
            self.calls: list = []

        async def prepare(self, text, source_language=None):
            self.calls.append(text)
            return PreparationResult(
                status=QueryPreparationStatus.TRANSLATED,
                query=PreparedQuery(
                    text="the prepared english query", preparation_status=QueryPreparationStatus.TRANSLATED
                ),
                history_text="the prepared english query",
                language="FR",
            )

    preparer = ScriptedPreparer()

    def fake_factory(env=None):
        return lambda monitor, language=None: preparer

    monkeypatch.setattr(app_module, "build_preparer_factory", fake_factory)
    port = fake_port()
    monkeypatch.setattr(
        app_module,
        "build_stateless_adapters",
        lambda config, env=None: type("Adapters", (), {"bind_executor": staticmethod(lambda context, bearer: port)})(),
    )
    monkeypatch.setattr(
        app_module,
        "ProbeModelClient",
        lambda config: ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}')),
    )
    monkeypatch.setattr(app_module, "_RUNTIME", None)
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    assert response.status_code == 200
    frames = _frames(response)
    assert frames[-1]["usage_record"]["outcome"] == "answered"
    assert frames[-1]["usage_record"]["preparation_status"] == "translated"
    assert preparer.calls == ["q"]  # the search's query went through preparation
    assert port.search_calls[0]["request"].query.text == "the prepared english query"
    assert port.search_calls[0]["request"].query.preparation_status == QueryPreparationStatus.TRANSLATED


def test_a_whitespace_only_language_records_none(tmp_path, monkeypatch):
    grounded_script = multihop_turns(judge_reply='{"verdict": "grounded"}')
    monkeypatch.setattr(app_module, "_RUNTIME", _runtime(ScriptedLoopModel(grounded_script), tmp_path))
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json={**BODY, "language": "   "})
    frames = _frames(response)
    assert frames[-1]["usage_record"]["language"] is None  # trimmed to nothing, never a blank locale


def test_a_budget_hit_ends_the_stream_honestly_with_no_answer_text(tmp_path, monkeypatch):
    exhausted = replace(orchestrator_config(), max_model_calls=1)
    lane = AdmissionLane(1, str(tmp_path / "lane.lock"))
    monkeypatch.setattr(
        app_module,
        "_RUNTIME",
        RequestOrchestrator(
            config=exhausted,
            lane=lane,
            model_client=ScriptedLoopModel(multihop_turns(answer="a fabricated answer")),
            port_factory=lambda context, bearer: fake_port(),
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
    orchestrator = _runtime(HangingLoopModel(recorder), tmp_path)
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
        # The disconnect closed the generator mid-stream: the cancellations
        # settle, then NOTHING stays pending on the loop — the re-armed
        # queue getter must not outlive the stream as a leaked waiter.
        await asyncio.sleep(0.05)
        leaked = [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
        assert leaked == []
        # The released slot admits the successor immediately.
        async with orchestrator.admit():
            pass

    asyncio.run(scenario())

    assert recorder["cancelled_in_flight"] is True  # the cancellation reached the in-flight model call
    assert seen_frames == ["run_started"]  # no terminal event for a cancelled run
