# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The seam's event envelope and vocabulary — owned by ``agent/``.

The internal envelope is ``{run_id, call_id, seq, kind, payload}`` and the
kind vocabulary is AG-UI-SHAPED — run lifecycle, text-message lifecycle,
tool-call lifecycle — as a *pattern*: no AG-UI dependency, no protocol
import. Both are owned by this module, which is what makes a runtime swap
cheap: a runtime adapts its native events TO this vocabulary; it never
renames it (a renamed vocabulary would couple every downstream consumer to
the runtime that happened to run first).

The vocabulary deliberately carries no BFF frame name. The BFF
parses this seam stream and writes every client frame,
so the client SSE dialect (``chunk``/``done``/``error``/``metadata``/
``agent_activity``/``agent_verdict``) must not leak into the seam — a name
shared between the two vocabularies would blur who owns the stream. A
module-level guard fails the import the day a kind value collides, and the
events suite pins the guard independently, so the collision fails in the
suite and at import instead of in the client stream.

The emitter assigns the monotonic ``seq``. Nothing downstream may derive
ordering from arrival order: the emitter stamps it, and the envelope
carries it, so a consumer that replays or reorders events can still
reconstruct the run's order.
"""

from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict

# The client-SSE frame names the BFF writes today (the five preserved event
# types plus the additive ones) — a snapshot, hand-maintained: the guard
# below cannot see a frame the BFF adds later, and the closed EventKind
# vocabulary plus the frozen envelope are what structurally keep the seam
# from speaking the client dialect. The vocabulary is checked against this
# set at import.
BFF_FRAME_NAMES = frozenset({"chunk", "done", "error", "metadata", "translation", "agent_activity", "agent_verdict"})


class EventKind(StrEnum):
    """The seam's event kinds — AG-UI-shaped, seam-owned, closed.

    Run lifecycle: ``run_started``; ``run_finished`` or ``run_error``
    terminal (a cancelled run emits NEITHER — a cancellation has no honest
    terminal state to fabricate). Text-message lifecycle:
    ``text_message_started``, ``text_message_content``,
    ``text_message_finished``. Tool-call lifecycle: ``tool_call_started``,
    ``tool_call_finished`` (the arguments ride the started payload, the
    result the finished one — dispatch is server-side, so unlike the AG-UI
    wire shape there is no separate args-delta event to model).
    """

    RUN_STARTED = "run_started"
    RUN_FINISHED = "run_finished"
    RUN_ERROR = "run_error"
    TEXT_MESSAGE_STARTED = "text_message_started"
    TEXT_MESSAGE_CONTENT = "text_message_content"
    TEXT_MESSAGE_FINISHED = "text_message_finished"
    TOOL_CALL_STARTED = "tool_call_started"
    TOOL_CALL_FINISHED = "tool_call_finished"


def _vocabulary_never_carries_a_bff_frame_name() -> None:
    """The seam/BFF boundary guard: no kind value may be a BFF frame name.

    Raises at import (and is pinned by the events suite, which calls it
    directly): a collision means the seam started speaking the client
    dialect, which is the leak the seam boundary exists to prevent.
    """
    collisions = sorted(kind.value for kind in EventKind if kind.value in BFF_FRAME_NAMES)
    if collisions:
        raise ValueError(f"the seam event vocabulary may not carry a BFF frame name: {collisions}")


_vocabulary_never_carries_a_bff_frame_name()


class AgentEvent(BaseModel):
    """The internal envelope of every seam event.

    ``call_id`` is the id of the tool call whose effect the event reports;
    run-level and text-message events carry ``None`` (they belong to the
    run, not to one call). ``seq`` is the emitter's monotonic per-run
    counter — the ordering contract of the stream.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str
    call_id: str | None
    seq: int
    kind: EventKind
    payload: dict


class EventSink(Protocol):
    """Where a run's events go (a collector in tests, a stream later)."""

    def __call__(self, event: AgentEvent) -> None: ...


class EventEmitter:
    """Stamps the envelope and assigns the monotonic ``seq``.

    One emitter per run — the ``run_id`` is fixed at construction, ``seq``
    counts from 0 and advances by one per event. The sink (when given)
    receives every event as it is emitted; the event is also returned, so a
    caller that needs the last event does not have to reach into the sink.
    """

    def __init__(self, run_id: str, sink: EventSink | None = None) -> None:
        self._run_id = run_id
        self._sink = sink
        self._seq = 0

    def emit(self, kind: EventKind, payload: dict | None = None, *, call_id: str | None = None) -> AgentEvent:
        """Stamp one event and hand it to the sink."""
        event = AgentEvent(run_id=self._run_id, call_id=call_id, seq=self._seq, kind=kind, payload=payload or {})
        self._seq += 1
        if self._sink is not None:
            self._sink(event)
        return event
