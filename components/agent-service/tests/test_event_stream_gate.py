# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The byte-identical event-stream gate.

The runtime port's migration is a MOVE: the orchestrator's event stream
must come out of it byte for byte identical, or the move changed
something it was not supposed to change. This test drives the ORCHESTRATOR
— the same path the run surface drives — captures the stream and compares
it with the recorded fixture.

The fixture is the REFERENCE, not a by-product: it is the frozen wire,
and a change to it is a change to the wire. A wire change belongs to the
wire-freeze step, where it is deliberate and recorded in an ADR; it never
rides in on a refactor.

**The pre-port baseline.** The fixture was recorded from the code BEFORE
the port existed — and it was re-recorded twice after, for two wire
changes that were each RECORDED (ADR agentic-004's runtime axis, ADR
agentic-009's F5 name). A reference that moves with the code cannot hold
the code: the gate would follow it. So the pre-port bytes stay in the
repository as an immutable baseline
(``orchestrated_run.pre-port.json``), and the second test below asserts
that the frozen fixture is EXACTLY that baseline plus the recorded
deltas — nothing else. A wire change that is not one of the recorded
ones reds there, whatever the fixture says.

The only field left out of the comparison is the ``run_id``: it is minted
per run by design (a uuid) and carries no behaviour. Everything else — the
sequence, the kinds, the call ids and the payloads, the execution-version
record included — is compared byte for byte.

Recording is a deliberate, manual step:

    AGENT_RECORD_EVENT_STREAM=1 python -m pytest tests/test_event_stream_gate.py

The recording rewrites the fixture; an ordinary run only compares. A test
that records on every run would pass by construction — the gate would
follow the code instead of holding it.
"""

import asyncio
import json
import os
from functools import partial
from pathlib import Path

from conftest import (
    FakeConceptSource,
    FakeMetadataSource,
    ScriptedLoopModel,
    fake_port,
    multihop_turns,
    orchestrator_config,
)

from agent.events import AgentEvent
from agent.orchestrator import AgentRunRequest, RequestOrchestrator
from agent.sources import DocumentToolSource
from capabilities.contract import CallerContext
from lane import AdmissionLane
from tool_catalog import DeclaredSource, build_tool_source_factory, load_catalog

FIXTURE = Path(__file__).parent / "fixtures" / "event_stream" / "orchestrated_run.json"
# The PRE-PORT recording: the bytes the port's migration had to leave
# alone. Immutable — a change here is a change to the migration's
# reference, and it is reviewed as one.
BASELINE = Path(__file__).parent / "fixtures" / "event_stream" / "orchestrated_run.pre-port.json"
RECORD = os.environ.get("AGENT_RECORD_EVENT_STREAM") == "1"

CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
QUESTION = "How are complaints handled?"


def _capture(lane_dir: Path) -> list[dict]:
    """The events of one governed run, captured through the orchestrator."""

    collector: list[AgentEvent] = []
    model = ScriptedLoopModel(multihop_turns(answer="the answer", judge_reply='{"verdict": "grounded"}'))
    catalog_path = lane_dir / "tool-catalog.json"
    catalog_path.parent.mkdir(parents=True, exist_ok=True)  # the lane creates its dir later
    catalog_document = {
        "tools": [
            {"source": "document", "name": "search_knowledge"},
            {"source": "document", "name": "read_source"},
        ]
    }
    catalog_path.write_text(json.dumps(catalog_document), encoding="utf-8")
    catalog = load_catalog(
        catalog_path,
        served_names={"document": frozenset({"search_knowledge", "read_source"})},
        ceiling=orchestrator_config().operation_budget,
    )
    orchestrator = RequestOrchestrator(
        config=orchestrator_config(),
        lane=AdmissionLane(1, str(lane_dir)),
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
    request = AgentRunRequest(question=QUESTION, deadline_ms=5000, context=CONTEXT, bearer="tok-1")
    asyncio.run(orchestrator.run(request, sink=collector.append))
    return [
        {"seq": event.seq, "kind": event.kind.value, "call_id": event.call_id, "payload": event.payload}
        for event in collector
    ]


def _canonical(events: list[dict]) -> str:
    """The comparison form: the events, canonically serialized."""

    return json.dumps(events, indent=2, sort_keys=True) + "\n"


def test_the_orchestrated_event_stream_is_byte_identical_to_the_recorded_one(tmp_path):
    captured = _canonical(_capture(tmp_path / "lane"))

    if RECORD:
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(captured, encoding="utf-8")
        return

    assert FIXTURE.exists(), "the recorded fixture is missing — record it deliberately"
    assert captured == FIXTURE.read_text(encoding="utf-8")


def test_the_frozen_stream_is_the_pre_port_baseline_plus_the_recorded_deltas():
    """The fixture moved only by the wire changes that were RECORDED.

    The pre-port bytes are the migration's reference; the frozen fixture
    is that reference plus the wire changes an ADR carries. This test
    states the delta set explicitly and CLOSED: a wire change that is
    not one of these reds here — the gate above would have followed it,
    because the fixture moves with the code.
    """

    assert BASELINE.exists(), "the pre-port baseline is missing — the migration's reference"
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))

    # Delta 1 — the execution-version record gained a ``runtime`` axis:
    # the runtime that served the run is part of the record (ADR
    # agentic-004).
    for record in baseline:
        versions = record.get("payload", {}).get("execution_versions")
        if isinstance(versions, dict):
            versions["runtime"] = {"id": "custom-minimal-loop"}

    # Delta 2 — the citation card carries the source's own NAME instead
    # of a label derived from its id (ADR agentic-009's F5).
    for record in baseline:
        for card in record.get("payload", {}).get("source_documents", []) or []:
            if card.get("document_id") == "f-1":
                card["document_name"] = "f-1 resolved.md"

    assert _canonical(baseline) == FIXTURE.read_text(encoding="utf-8"), (
        "the frozen stream is not the pre-port recording plus the recorded deltas: "
        "the wire moved by something no ADR carries"
    )
