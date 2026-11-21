# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The seam's envelope and vocabulary ownership.

Mutation-sensitive pins: every event carries the exact envelope
``{run_id, call_id, seq, kind, payload}`` (no more, no less — ``extra``
fields are refused), the emitter assigns a strictly monotonic ``seq`` and
stamps the run id on everything, the vocabulary is AG-UI-shaped and
closed, and no kind value is a BFF frame name — the seam/BFF boundary
guard itself is pinned, so deleting it reddens this suite.
"""

import pytest
from pydantic import ValidationError

from agent.events import (
    BFF_FRAME_NAMES,
    AgentEvent,
    EventEmitter,
    EventKind,
    _vocabulary_never_carries_a_bff_frame_name,
)

EXPECTED_KINDS = {
    "run_started",
    "run_finished",
    "run_error",
    "text_message_started",
    "text_message_content",
    "text_message_finished",
    "tool_call_started",
    "tool_call_finished",
}


# ---------------------------------------------------------------------
# The vocabulary: AG-UI-shaped, closed, BFF-free
# ---------------------------------------------------------------------


def test_the_vocabulary_covers_the_three_lifecycles():
    assert {kind.value for kind in EventKind} == EXPECTED_KINDS


def test_the_bff_frame_snapshot_is_exactly_the_v05_inventory():
    # The snapshot is hand-maintained against the V05 client-contract
    # inventory: the five preserved frame types plus the two additive ones.
    # A frame missing from this set is a collision the import guard cannot
    # see — this pin is what keeps the snapshot from rotting with a green
    # suite.
    assert {
        "chunk",
        "done",
        "error",
        "metadata",
        "translation",
        "agent_activity",
        "agent_verdict",
    } == BFF_FRAME_NAMES


def test_no_kind_value_is_a_bff_frame_name():
    for kind in EventKind:
        assert kind.value not in BFF_FRAME_NAMES


def test_the_boundary_guard_fires_when_a_kind_collides_with_a_bff_frame(monkeypatch):
    # The guard reads the module constant; a collision must raise, or the
    # seam could grow a client frame name silently.
    monkeypatch.setattr("agent.events.BFF_FRAME_NAMES", frozenset({"run_started", "done"}))
    with pytest.raises(ValueError, match="BFF frame name"):
        _vocabulary_never_carries_a_bff_frame_name()


def test_the_import_time_guard_passes_on_the_shipped_vocabulary():
    # Calling it directly: the module-level call already ran at import —
    # this pin keeps it honest if the module-level call is deleted.
    _vocabulary_never_carries_a_bff_frame_name()


# ---------------------------------------------------------------------
# The envelope: exact, frozen, validated
# ---------------------------------------------------------------------


def test_the_envelope_is_exactly_the_five_seam_fields():
    event = AgentEvent(run_id="r-1", call_id=None, seq=0, kind=EventKind.RUN_STARTED, payload={})
    assert set(event.model_dump()) == {"run_id", "call_id", "seq", "kind", "payload"}


def test_the_envelope_refuses_unknown_fields_and_is_frozen():
    with pytest.raises(ValidationError):
        AgentEvent(run_id="r", call_id=None, seq=0, kind=EventKind.RUN_STARTED, payload={}, chunk="leaked")
    event = AgentEvent(run_id="r", call_id=None, seq=0, kind=EventKind.RUN_STARTED, payload={})
    with pytest.raises(ValidationError):
        event.seq = 1


def test_kind_refuses_a_value_outside_the_closed_vocabulary():
    with pytest.raises(ValidationError):
        AgentEvent(run_id="r", call_id=None, seq=0, kind="done", payload={})


# ---------------------------------------------------------------------
# The emitter: monotonic seq, run stamping, sink delivery
# ---------------------------------------------------------------------


def test_the_emitter_assigns_a_strictly_monotonic_seq_from_zero():
    emitter = EventEmitter(run_id="r-1")
    first = emitter.emit(EventKind.RUN_STARTED, {})
    second = emitter.emit(EventKind.TOOL_CALL_STARTED, {}, call_id="c-1")
    third = emitter.emit(EventKind.RUN_FINISHED, {})
    assert (first.seq, second.seq, third.seq) == (0, 1, 2)
    assert third.seq > second.seq > first.seq


def test_the_emitter_stamps_the_run_id_and_carries_the_call_id():
    emitter = EventEmitter(run_id="r-1")
    run_level = emitter.emit(EventKind.RUN_STARTED, {})
    call_level = emitter.emit(EventKind.TOOL_CALL_FINISHED, {}, call_id="c-9")
    assert run_level.run_id == "r-1" and run_level.call_id is None
    assert call_level.run_id == "r-1" and call_level.call_id == "c-9"


def test_the_emitter_hands_every_event_to_the_sink_in_order():
    collector: list[AgentEvent] = []
    emitter = EventEmitter(run_id="r-1", sink=collector.append)
    emitter.emit(EventKind.RUN_STARTED, {"a": 1})
    emitter.emit(EventKind.RUN_ERROR, {"code": "error"})
    assert [event.kind for event in collector] == [EventKind.RUN_STARTED, EventKind.RUN_ERROR]
    assert collector[0].payload == {"a": 1}


def test_a_none_payload_is_normalized_to_an_empty_dict():
    event = EventEmitter(run_id="r").emit(EventKind.TEXT_MESSAGE_FINISHED)
    assert event.payload == {}
