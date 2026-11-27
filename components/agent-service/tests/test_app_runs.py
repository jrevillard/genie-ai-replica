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
from functools import partial

import pytest
from conftest import (
    REQUIRED_KNOBS,
    SHIPPED_CATALOG,
    FakeConceptSource,
    FakeMetadataSource,
    HangingLoopModel,
    ScriptedLoopModel,
    SlowUnwindLoopModel,
    fake_port,
    multihop_turns,
    orchestrator_config,
)
from fastapi.testclient import TestClient

import app as app_module
from agent.events import BFF_FRAME_NAMES
from agent.orchestrator import AdmissionRefused, RequestOrchestrator
from agent.sources import DocumentToolSource
from assembly import build_web_search_port
from capabilities.contract import CallerContext, PreparedQuery, QueryPreparationStatus
from lane import AdmissionLane
from preparation.prepare import PreparationResult
from tool_catalog import DeclaredSource, build_tool_source_factory, load_catalog

CONTEXT = {"user_id": "u-1", "authorized_graph_names": ["GRAPH"]}
BODY = {"question": "How are complaints handled?", "deadline_ms": 5000, "context": CONTEXT, "language": "fr"}


def _runtime(model, tmp_path):
    """The app under test assembled over fakes: _RUNTIME carries the
    orchestrator itself (the module-level lazy singleton)."""
    lane = AdmissionLane(1, str(tmp_path / "lane.lock"))
    catalog = load_catalog(
        SHIPPED_CATALOG,
        served_names={DocumentToolSource.source_id: DocumentToolSource.served_tool_names},
        ceiling=orchestrator_config().operation_budget,
    )
    return RequestOrchestrator(
        config=orchestrator_config(),
        lane=lane,
        model_client=model,
        tool_source_factory=build_tool_source_factory(
            catalog=catalog,
            declared_sources=(
                DeclaredSource(
                    source_id=DocumentToolSource.source_id,
                    served_tool_names=DocumentToolSource.served_tool_names,
                    build=partial(DocumentToolSource.from_bundle, lambda context, bearer: fake_port()),
                ),
            ),
        ),
        metadata_source=FakeMetadataSource(),
        concept_source=FakeConceptSource(),
    )


def _frames(response) -> list[dict]:
    """The SSE data frames of a consumed stream, parsed."""
    frames = []
    for chunk in response.text.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            frames.append(json.loads(chunk[len("data: ") :]))
    return frames


async def drain(gen, sink=None):
    """Consume a run's stream to its end, discarding the frames or appending
    their parsed ``kind`` values to ``sink``."""
    async for frame in gen:
        if sink is not None:
            sink.append(json.loads(frame[len("data: ") :]).get("kind"))


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
    """The release policy is deployment-level and ships
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
        "abstention_reason",
        "injection_findings",
    }
    assert usage["outcome"] == "answered"
    assert usage["run_id"] == frames[0]["run_id"]
    assert usage["aux_model_calls"] == 1  # the grounding judge, tallied separately
    assert usage["language"] == "fr"  # the request's UI locale rides the record
    assert usage["injection_findings"] == 0  # a clean run records no attempt
    assert usage["abstention_reason"] is None  # a successful search fires no sink


def test_the_verdict_projects_citations_onto_the_frontend_source_documents_shape(tmp_path, monkeypatch):
    """The delivered citations ride the verdict payload projected
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
            # The DOCUMENT's name, as the document repository resolved it —
            # never the id (ADR agentic-009, F5).
            "document_name": "f-1 resolved.md",
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
    monkeypatch.setenv(
        "AGENT_TOOL_CATALOG_PATH",
        str(SHIPPED_CATALOG),
    )

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

    def fake_factory(transport, env=None):
        return lambda monitor, language=None: preparer

    monkeypatch.setattr(app_module, "build_preparer_factory", fake_factory)
    port = fake_port()
    monkeypatch.setattr(
        app_module,
        "build_stateless_adapters",
        lambda config, env=None: type(
            "Adapters",
            (),
            {
                "bind_executor": staticmethod(lambda context, bearer: port),
                # The document repository, through the port: the citation
                # cards carry the documents' names.
                "docrepo": FakeMetadataSource(),
                # The OKF server, through ITS port: the citation cards
                # carry the concepts' names.
                "okf": FakeConceptSource(),
            },
        )(),
    )
    monkeypatch.setattr(
        app_module,
        "VllmModelClient",
        lambda config, transport=None: ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}')),
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
    catalog = load_catalog(
        SHIPPED_CATALOG,
        served_names={DocumentToolSource.source_id: DocumentToolSource.served_tool_names},
        ceiling=exhausted.operation_budget,
    )
    monkeypatch.setattr(
        app_module,
        "_RUNTIME",
        RequestOrchestrator(
            config=exhausted,
            lane=lane,
            model_client=ScriptedLoopModel(multihop_turns(answer="a fabricated answer")),
            tool_source_factory=build_tool_source_factory(
                catalog=catalog,
                declared_sources=(
                    DeclaredSource(
                        source_id=DocumentToolSource.source_id,
                        served_tool_names=DocumentToolSource.served_tool_names,
                        build=partial(DocumentToolSource.from_bundle, lambda context, bearer: fake_port()),
                    ),
                ),
            ),
            metadata_source=FakeMetadataSource(),
            concept_source=FakeConceptSource(),
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

    async def scenario():
        admit_ctx = orchestrator.admit()
        await admit_ctx.__aenter__()
        gen = app_module._run_stream(orchestrator, request, admit_ctx)
        task = asyncio.ensure_future(drain(gen, seen_frames))
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


def test_the_slot_stays_held_while_the_cancelled_run_unwinds(tmp_path):
    """The admission claim wraps the cancelled run's WHOLE teardown: while
    the in-flight model call is still aborting (the disconnect's
    cancellation is unwinding), every lane slot is still held and a
    successor run is refused — the released slot must never admit the next
    run while the dying one is still racing it for the model endpoint."""
    recorder: dict = {"release_unwind": asyncio.Event()}
    orchestrator = _runtime(SlowUnwindLoopModel(recorder), tmp_path)
    request = app_module.AgentRunRequest(
        question="q", deadline_ms=5000, context=CallerContext.model_validate(CONTEXT), bearer=None
    )

    async def scenario():
        admit_ctx = orchestrator.admit()
        await admit_ctx.__aenter__()
        gen = app_module._run_stream(orchestrator, request, admit_ctx)
        task = asyncio.ensure_future(drain(gen))
        while "started" not in recorder:
            await asyncio.sleep(0.01)
        task.cancel()
        while "unwinding" not in recorder:
            await asyncio.sleep(0.01)
        # The cancelled run is mid-unwind: the slot is still held.
        with pytest.raises(AdmissionRefused):
            async with orchestrator.admit():
                pass
        recorder["release_unwind"].set()
        while "unwound" not in recorder:
            await asyncio.sleep(0.01)
        with pytest.raises(asyncio.CancelledError):
            await task
        # The run has fully terminated: the slot admits the successor.
        async with orchestrator.admit():
            pass

    asyncio.run(scenario())


# ---------------------------------------------------------------------
# The web-search knob pair: the second declared source, the shipped
# posture, and the half-wired deployment's honest 503
# ---------------------------------------------------------------------


def _catalog_entry(name, source, egress):
    """One catalog entry of the shipped shape — the tmp catalog's builder."""
    return {
        "name": name,
        "source": source,
        "server": None,
        "tool": None,
        "allow": True,
        "risk": "read",
        "requires_approval": False,
        "egress": egress,
        "scopes": [],
    }


def _assembled_app(monkeypatch, tmp_path, *, web_pair=False):
    """The real `_build_orchestrator` over fakes, with (or without) the
    web-search knob pair set. Returns the ScriptedLoopModel so the test can
    read the tool definitions the model was told."""
    for knob in REQUIRED_KNOBS:
        monkeypatch.setenv(knob, "5000")
    if web_pair:
        # The THREE-entry catalog is the test's OWN tmp file — NEVER the
        # shipped one (it is frozen at two tools; D4/G4): the knob points
        # at the copy this test wrote.
        catalog_path = tmp_path / "tool-catalog-web.json"
        catalog_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "tools": [
                        _catalog_entry("search_knowledge", "document", "internal"),
                        _catalog_entry("read_source", "document", "internal"),
                        _catalog_entry("web_search", "web", "open_web"),
                    ],
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setenv("AGENT_TOOL_CATALOG_PATH", str(catalog_path))
        monkeypatch.setenv("AGENT_SEARXNG_URL", "http://searxng:8080")
        monkeypatch.setenv("PII_SERVICE_URL", "http://pii-service:8000")
    else:
        monkeypatch.setenv("AGENT_TOOL_CATALOG_PATH", str(SHIPPED_CATALOG))
    model = ScriptedLoopModel(multihop_turns(answer="the answer", judge_reply='{"verdict": "grounded"}'))
    monkeypatch.setattr(
        app_module,
        "build_stateless_adapters",
        lambda config, env=None: type(
            "Adapters",
            (),
            {
                "bind_executor": staticmethod(lambda context, bearer: fake_port()),
                "docrepo": FakeMetadataSource(),
                "okf": FakeConceptSource(),
            },
        )(),
    )
    monkeypatch.setattr(
        app_module,
        "VllmModelClient",
        lambda config, transport=None: model,
    )
    monkeypatch.setattr(app_module, "_RUNTIME", None)
    return model


def test_the_assembly_declares_the_web_source_when_the_flag_and_the_pair_are_set(tmp_path, monkeypatch):
    """The host's SECOND declared source: with the deployment's INTENT
    (``AGENT_WEB_SEARCH_ENABLED``) and the knob pair set, the run's toolset
    carries web_search beside the two document tools. The build is the
    mechanical shape (``partial(WebSearchToolSource.from_bundle, ...)``)
    — the catalog's budgets arrive through the factory, not this site."""
    model = _assembled_app(monkeypatch, tmp_path, web_pair=True)
    monkeypatch.setenv("AGENT_WEB_SEARCH_ENABLED", "1")
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    assert response.status_code == 200
    names = [definition["function"]["name"] for definition in model.requests[0]["tool_definitions"]]
    assert names == ["search_knowledge", "read_source", "web_search"]


def test_the_shipped_posture_declares_no_web_source(tmp_path, monkeypatch):
    """The flag unset — the deployment declares NO web source, whatever the
    endpoints read. The ansible path renders the pii endpoint
    UNCONDITIONALLY, so a deployment holding one endpoint is not
    half-wired: it simply never asked for web search."""
    model = _assembled_app(monkeypatch, tmp_path, web_pair=False)
    monkeypatch.setenv("PII_SERVICE_URL", "http://pii-service:8000")
    monkeypatch.delenv("AGENT_SEARXNG_URL", raising=False)
    monkeypatch.delenv("AGENT_WEB_SEARCH_ENABLED", raising=False)
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    assert response.status_code == 200
    names = [definition["function"]["name"] for definition in model.requests[0]["tool_definitions"]]
    assert names == ["search_knowledge", "read_source"]


def test_a_half_wired_web_pair_answers_503_naming_the_missing_knob(monkeypatch):
    """The pair is fail-closed as a PAIR: an ENABLED deployment holding
    exactly one endpoint is a deployment that believes a lie (redacting
    without searching, or searching without redacting) — the honest 503
    names the missing one, before any run."""
    for knob in REQUIRED_KNOBS:
        monkeypatch.setenv(knob, "5000")
    monkeypatch.setenv("AGENT_TOOL_CATALOG_PATH", str(SHIPPED_CATALOG))
    monkeypatch.setenv("AGENT_SEARXNG_URL", "http://searxng:8080")
    monkeypatch.setenv("AGENT_WEB_SEARCH_ENABLED", "1")
    monkeypatch.delenv("PII_SERVICE_URL", raising=False)
    monkeypatch.setattr(
        app_module,
        "build_stateless_adapters",
        lambda config, env=None: type(
            "Adapters",
            (),
            {
                "bind_executor": staticmethod(lambda context, bearer: fake_port()),
                "docrepo": FakeMetadataSource(),
                "okf": FakeConceptSource(),
            },
        )(),
    )
    monkeypatch.setattr(app_module, "_RUNTIME", None)
    with TestClient(app_module.app) as client:
        response = client.post("/v1/runs", json=BODY)

    assert response.status_code == 503
    body = response.json()
    assert body["error"] == "run_surface_unconfigured"
    assert "PII_SERVICE_URL" in body["message"]


def test_the_web_search_port_follows_the_deployments_intent_and_its_knob_pair():
    """The DIRECT owner of ``build_web_search_port``'s return value: the
    app-level observable cannot prove the source's absence (the catalog
    filters the tool list, so the observable is identical with or without a
    web source), and the "no web source" half of the pair had NO owner.

    The flag decides the PRESENCE; the knob PAIR supplies the ENDPOINTS;
    an ENABLED deployment with an incomplete pair is refused with the
    honest ``ValueError`` naming the missing knob (the SearXNG-missing
    direction had no pin)."""
    endpoints = {"PII_SERVICE_URL": "http://pii-service:8000", "AGENT_SEARXNG_URL": "http://searxng:8080"}

    # The flag unset: NO web source, whatever the endpoints read.
    assert build_web_search_port(env=endpoints) is None

    # The flag set and the pair complete: a port.
    port = build_web_search_port(env={**endpoints, "AGENT_WEB_SEARCH_ENABLED": "1"})
    assert port is not None
    assert callable(getattr(port, "search", None))

    # The flag set and one endpoint missing: the honest refusal, naming the
    # missing knob.
    with pytest.raises(ValueError, match="PII_SERVICE_URL"):
        build_web_search_port(env={"AGENT_WEB_SEARCH_ENABLED": "1", "AGENT_SEARXNG_URL": "http://searxng:8080"})
    with pytest.raises(ValueError, match="AGENT_SEARXNG_URL"):
        build_web_search_port(env={"AGENT_WEB_SEARCH_ENABLED": "1", "PII_SERVICE_URL": "http://pii-service:8000"})
