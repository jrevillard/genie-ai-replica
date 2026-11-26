# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The byte-identical event-stream gate.

The runtime port's migration is a MOVE: the orchestrator's event stream
must come out of it byte for byte identical, or the move changed
something it was not supposed to change. This test drives the ORCHESTRATOR
— the same path the run surface drives — captures the stream and compares
it with the recorded fixture.

The fixture is the REFERENCE, not a by-product: it was recorded from the
code BEFORE the port existed, and a change to it is a change to the wire.
A wire change belongs to the wire-freeze step, where it is deliberate and
recorded; it never rides in on a refactor.

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
from pathlib import Path

from conftest import FakeMetadataSource, ScriptedLoopModel, fake_port, multihop_turns, orchestrator_config

from agent.events import AgentEvent
from agent.orchestrator import AgentRunRequest, RequestOrchestrator
from capabilities.contract import CallerContext
from lane import AdmissionLane

FIXTURE = Path(__file__).parent / "fixtures" / "event_stream" / "orchestrated_run.json"
RECORD = os.environ.get("AGENT_RECORD_EVENT_STREAM") == "1"

CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
QUESTION = "How are complaints handled?"


def _capture(lane_dir: Path) -> list[dict]:
    """The events of one governed run, captured through the orchestrator."""

    collector: list[AgentEvent] = []
    model = ScriptedLoopModel(multihop_turns(answer="the answer", judge_reply='{"verdict": "grounded"}'))
    orchestrator = RequestOrchestrator(
        config=orchestrator_config(),
        lane=AdmissionLane(1, str(lane_dir)),
        model_client=model,
        port_factory=lambda context, bearer: fake_port(),
        metadata_source=FakeMetadataSource(),
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
